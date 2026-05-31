import { generateRewrite, reviewEntries } from './llm.js';
import { computeDiff, renderInlineDiff, renderSideBySideDiff } from './diff.js';
import { createBackup } from './backup.js';
import { updateEntryFields, deleteEntry, getLorebookNames, loadLorebook, parseKeywordString } from './lorebook.js';
import { escapeHtml, escapeAttr } from './utils.js';

const PROMPT_PRESETS = {
    prune: 'Shorten this entry for brevity while preserving all factual content. Remove redundancy and unnecessary elaboration.',
    clarify: 'Improve clarity and readability without changing length or removing information. Rephrase awkward sentences.',
    grammar: 'Correct grammar, spelling, and punctuation. Do not change meaning, structure, or length.',
};

export function getPromptText(preset, customPrompt) {
    if (preset === 'custom' && customPrompt && customPrompt.trim()) {
        return customPrompt.trim();
    }
    return PROMPT_PRESETS[preset] || PROMPT_PRESETS.prune;
}

export async function openMainPopup(settings, context) {
    const { Popup, POPUP_TYPE } = context;

    const bookNames = getLorebookNames(context);

    let optionsHtml = '<option value="" disabled selected>-- Choose a lorebook --</option>';
    for (const name of bookNames) {
        optionsHtml += `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`;
    }

    const popupHtml = `<div class="lm-main-popup">
        <h3>Lorebook Manipulator</h3>
        <label for="lm_popup_book_select">Select Lorebook</label>
        <select id="lm_popup_book_select" class="text_pole">${optionsHtml}</select>

        <div id="lm_review_section" class="lm-review-section" style="display:none;">
            <label for="lm_review_instructions">Review the whole book</label>
            <textarea id="lm_review_instructions" class="text_pole textarea_compact" rows="2"
                placeholder="Optional: tell the AI what to focus on (e.g. 'find duplicate lore' or 'flag contradictions'). Leave blank for a general review."></textarea>
            <button id="lm_review_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-magnifying-glass"></i> Review &amp; Recommend Fixes
            </button>
            <div id="lm_review_status" class="lm-status"></div>
            <div id="lm_issue_list" class="lm-issue-list"></div>
        </div>

        <div id="lm_popup_entry_list" class="lm-entry-list" style="display:none; margin-top:10px;"></div>
    </div>`;

    const popup = new Popup(popupHtml, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        okButton: null,
        cancelButton: 'Close',
        allowVerticalScrolling: true,
    });

    popup.show();

    const container = document.querySelector('.lm-main-popup');
    if (!container) return;

    const select = container.querySelector('#lm_popup_book_select');
    const entryListEl = container.querySelector('#lm_popup_entry_list');
    const reviewSection = container.querySelector('#lm_review_section');
    const reviewBtn = container.querySelector('#lm_review_btn');
    const reviewInstructions = container.querySelector('#lm_review_instructions');
    const reviewStatus = container.querySelector('#lm_review_status');
    const issueListEl = container.querySelector('#lm_issue_list');

    // Cached so review results (which reference entries by uid) can be mapped
    // back to the real entry objects for the rewrite flow.
    let currentEntries = [];
    let currentBookName = null;

    // (Re)load the selected book's entries and render the list. Extracted so it
    // can be called after a delete to refresh the view.
    async function loadAndRender(bookName) {
        entryListEl.innerHTML = '<p class="lm-no-backups">Loading...</p>';
        entryListEl.style.display = 'block';

        const entries = await loadLorebook(bookName, context);
        currentEntries = entries;

        reviewSection.style.display = entries.length > 0 ? 'block' : 'none';

        if (entries.length === 0) {
            entryListEl.innerHTML = '<p class="lm-no-backups">No entries in this lorebook.</p>';
            return;
        }

        renderEntryList(
            entryListEl,
            entries,
            (entry) => {
                // Stack the editor on top of this popup so Cancel returns here
                // instead of closing everything. Refresh the list on close so
                // any saved title/key/content edits are reflected.
                openRewritePopup(entry, bookName, settings, context, null, () => loadAndRender(bookName));
            },
            (entry) => handleDeleteEntry(entry, bookName),
        );
    }

    // Confirm, back up, delete, then refresh the list in place.
    async function handleDeleteEntry(entry, bookName) {
        const title = entry.comment || `Entry #${entry.uid}`;
        const confirmed = await context.Popup.show.confirm(
            'Delete Entry',
            `Permanently delete "${title}" from "${bookName}"? A backup is saved first, so you can restore it from Backup History.`,
        );
        if (!confirmed) return;

        try {
            const bookData = await context.loadWorldInfo(bookName);
            createBackup(bookName, bookData, settings.backupRetention);

            await deleteEntry(bookName, entry.uid, context);

            toastr.success(`Deleted "${title}". Restore from Backup History if needed.`);
            await loadAndRender(bookName);
        } catch (e) {
            console.error('[LorebookManipulator] Delete failed:', e);
            toastr.error(`Failed to delete entry: ${e.message}`);
        }
    }

    select?.addEventListener('change', async () => {
        const bookName = select.value;
        if (!bookName) return;
        currentBookName = bookName;

        try {
            issueListEl.innerHTML = '';
            showStatus(reviewStatus, '', 'loading');
            reviewStatus.style.display = 'none';

            await loadAndRender(bookName);
        } catch (e) {
            console.error('[LorebookManipulator] Failed to load entries:', e);
            entryListEl.innerHTML = `<p class="lm-no-backups">Error: ${escapeHtml(e.message)}</p>`;
        }
    });

    reviewBtn?.addEventListener('click', async () => {
        if (!currentBookName || currentEntries.length === 0) return;

        try {
            reviewBtn.disabled = true;
            issueListEl.innerHTML = '';
            showStatus(reviewStatus, 'Reviewing entries...', 'loading');

            const { issues, batchCount } = await reviewEntries(
                currentEntries,
                reviewInstructions.value,
                settings.maxTokens,
                context,
                {
                    profileId: settings.connectionProfileId || null,
                    onProgress: (current, total) => {
                        showStatus(reviewStatus, `Reviewing... batch ${current} of ${total}`, 'loading');
                    },
                },
            );

            if (issues.length === 0) {
                showStatus(reviewStatus, `No issues found across ${batchCount} batch(es). Your lorebook looks clean.`, 'success');
                return;
            }

            showStatus(reviewStatus, `Found ${issues.length} issue(s) across ${batchCount} batch(es). Click an entry to fix it.`, 'success');
            renderIssueList(issueListEl, issues, currentEntries, (entry, issue) => {
                // Stack the rewrite popup on top so the issue list survives.
                openRewritePopup(entry, currentBookName, settings, context, issue);
            });
        } catch (e) {
            console.error('[LorebookManipulator] Review failed:', e);
            showStatus(reviewStatus, e.message, 'error');
        } finally {
            reviewBtn.disabled = false;
        }
    });
}

// Render the clickable entry list into a container. Clicking the body opens
// the edit/rewrite flow; the trash button deletes (via onDeleteClick).
function renderEntryList(container, entries, onEntryClick, onDeleteClick) {
    container.innerHTML = '';
    container.style.display = 'block';

    const sorted = [...entries].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

    for (const entry of sorted) {
        const name = entry.comment || `Entry #${entry.uid}`;
        const keys = (entry.key || []).join(', ') || '(no keys)';
        const preview = (entry.content || '').substring(0, 80) + ((entry.content || '').length > 80 ? '...' : '');
        const disabledClass = entry.disable ? ' disabled' : '';

        const item = document.createElement('div');
        item.className = `lm-entry-item${disabledClass}`;

        const body = document.createElement('div');
        body.className = 'lm-entry-body';
        body.innerHTML = `
            <div class="lm-entry-name">${escapeHtml(name)}</div>
            <div class="lm-entry-keys">${escapeHtml(keys)}</div>
            <div class="lm-entry-preview">${escapeHtml(preview)}</div>
        `;
        body.addEventListener('click', () => onEntryClick(entry));
        item.appendChild(body);

        if (typeof onDeleteClick === 'function') {
            const del = document.createElement('button');
            del.className = 'menu_button lm-entry-delete';
            del.title = 'Delete this entry';
            del.innerHTML = '<i class="fa-solid fa-trash"></i>';
            del.addEventListener('click', (ev) => {
                ev.stopPropagation();
                onDeleteClick(entry);
            });
            item.appendChild(del);
        }

        container.appendChild(item);
    }
}

// Render the combined review issue list. Each issue shows its type/severity,
// description, and a clickable chip per affected entry that opens the rewrite
// flow pre-seeded with the issue. Entries the review couldn't map back to a
// real uid are shown but disabled.
function renderIssueList(container, issues, entries, onFixClick) {
    container.innerHTML = '';

    const byUid = new Map(entries.map((e) => [e.uid, e]));

    for (const issue of issues) {
        const card = document.createElement('div');
        card.className = `lm-issue-card lm-issue-${issue.severity}`;

        const header = document.createElement('div');
        header.className = 'lm-issue-header';
        header.innerHTML = `
            <span class="lm-issue-type">${escapeHtml(issue.type)}</span>
            <span class="lm-issue-severity">${escapeHtml(issue.severity)}</span>
        `;
        card.appendChild(header);

        const desc = document.createElement('div');
        desc.className = 'lm-issue-desc';
        desc.textContent = issue.description;
        card.appendChild(desc);

        const chips = document.createElement('div');
        chips.className = 'lm-issue-entries';

        for (const ref of issue.entries) {
            const entry = byUid.get(ref.uid);
            const chip = document.createElement('button');
            chip.className = 'menu_button lm-issue-chip';

            if (entry) {
                chip.innerHTML = `<i class="fa-solid fa-wrench"></i> ${escapeHtml(entry.comment || `Entry #${entry.uid}`)}`;
                chip.addEventListener('click', () => onFixClick(entry, issue));
            } else {
                // The model referenced an entry we can't resolve (bad/missing uid).
                chip.disabled = true;
                chip.title = 'This entry could not be matched to the lorebook.';
                chip.innerHTML = `<i class="fa-solid fa-question"></i> ${escapeHtml(ref.name || 'Unknown entry')}`;
            }

            chips.appendChild(chip);
        }

        card.appendChild(chips);
        container.appendChild(card);
    }
}

export async function openRewritePopup(entry, bookName, settings, context, issue = null, onClose = null) {
    const { Popup, POPUP_TYPE } = context;

    // Base instruction comes from the preset/custom prompt. When the user
    // arrived here from a review issue, append the issue so the rewrite
    // directly addresses what the review flagged.
    let promptText = getPromptText(settings.promptPreset, settings.customPrompt);
    if (issue && issue.description) {
        promptText = `${promptText}\n\nThis entry was flagged in a lorebook review (${issue.type}, ${issue.severity} severity):\n${issue.description}\n\nAddress this specific issue in your rewrite.`;
    }

    const popupHtml = buildPopupHtml(entry, issue);

    const popup = new Popup(popupHtml, POPUP_TYPE.TEXT, '', {
        wide: true,
        okButton: null,
        cancelButton: 'Cancel',
        allowVerticalScrolling: true,
    });

    // show() resolves when the popup is dismissed (Save, Cancel, or Esc).
    // Run onClose afterwards so the caller can refresh its view. We don't
    // await here because the handler setup below must run synchronously
    // while the popup's DOM is present.
    popup.show().then(() => {
        if (typeof onClose === 'function') onClose();
    });

    const container = document.querySelector('.lm-rewrite-popup');
    if (!container) return;

    const generateBtn = container.querySelector('#lm_generate_btn');
    const approveBtn = container.querySelector('#lm_approve_btn');
    const rejectBtn = container.querySelector('#lm_reject_btn');
    const diffContainer = container.querySelector('#lm_diff_container');
    const justificationContainer = container.querySelector('#lm_justification_container');
    const statusEl = container.querySelector('#lm_status');
    const titleInput = container.querySelector('#lm_field_title');
    const keysInput = container.querySelector('#lm_field_keys');
    const secondaryInput = container.querySelector('#lm_field_secondary');

    // null until the user generates a rewrite; when set, content is saved too.
    let currentSuggestion = null;

    generateBtn?.addEventListener('click', async () => {
        try {
            showStatus(statusEl, 'Generating suggestion...', 'loading');
            generateBtn.disabled = true;

            const result = await generateRewrite(
                entry.content,
                promptText,
                settings.maxTokens,
                context,
                settings.connectionProfileId || null,
            );

            currentSuggestion = result.rewrittenContent;

            const diffResult = computeDiff(entry.content, result.rewrittenContent);

            const diffHtml = settings.diffStyle === 'side-by-side'
                ? renderSideBySideDiff(diffResult)
                : renderInlineDiff(diffResult);

            diffContainer.innerHTML = diffHtml;
            justificationContainer.innerHTML = `<p class="lm-justification"><strong>Justification:</strong> ${escapeHtml(result.justification)}</p>`;
            justificationContainer.style.display = 'block';

            showStatus(statusEl, 'Suggestion ready. Review the diff, then Save.', 'success');
        } catch (e) {
            console.error('[LorebookManipulator] Generate failed:', e);
            showStatus(statusEl, e.message, 'error');
            currentSuggestion = null;
        } finally {
            generateBtn.disabled = false;
        }
    });

    approveBtn?.addEventListener('click', async () => {
        try {
            // Collect field edits. Content is only included if regenerated.
            const fields = {
                comment: titleInput ? titleInput.value : entry.comment,
                key: parseKeywordString(keysInput ? keysInput.value : ''),
                keysecondary: parseKeywordString(secondaryInput ? secondaryInput.value : ''),
            };
            if (currentSuggestion !== null) {
                fields.content = currentSuggestion;
            }

            showStatus(statusEl, 'Saving changes...', 'loading');
            approveBtn.disabled = true;
            rejectBtn.disabled = true;

            const bookData = await context.loadWorldInfo(bookName);
            createBackup(bookName, bookData, settings.backupRetention);

            await updateEntryFields(bookName, entry.uid, fields, context);

            showStatus(statusEl, 'Changes saved successfully!', 'success');
            toastr.success('Entry updated successfully.');

            setTimeout(() => popup.completeCancelled(), 1000);
        } catch (e) {
            console.error('[LorebookManipulator] Save failed:', e);
            showStatus(statusEl, `Failed to save: ${e.message}`, 'error');
            toastr.error(`Failed to save changes: ${e.message}`);
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
        }
    });

    rejectBtn?.addEventListener('click', () => {
        popup.completeCancelled();
    });
}

function buildPopupHtml(entry, issue = null) {
    const entryTitle = entry.comment || '';
    const keysValue = (entry.key || []).join(', ');
    const secondaryValue = (entry.keysecondary || []).join(', ');

    const issueBanner = issue && issue.description
        ? `<div class="lm-issue-banner lm-issue-${escapeAttr(issue.severity)}">
                <strong>Flagged (${escapeHtml(issue.type)}, ${escapeHtml(issue.severity)}):</strong>
                ${escapeHtml(issue.description)}
           </div>`
        : '';

    return `<div class="lm-rewrite-popup">
        <h3 class="lm-popup-title">Edit Entry #${escapeHtml(String(entry.uid))}</h3>

        ${issueBanner}

        <label for="lm_field_title">Title / Memo</label>
        <input id="lm_field_title" type="text" class="text_pole" value="${escapeAttr(entryTitle)}" placeholder="(no title)" />

        <label for="lm_field_keys">Primary Keys (comma-separated)</label>
        <input id="lm_field_keys" type="text" class="text_pole" value="${escapeAttr(keysValue)}" placeholder="e.g. dragon, wyrm" />

        <label for="lm_field_secondary">Secondary Keys (comma-separated)</label>
        <input id="lm_field_secondary" type="text" class="text_pole" value="${escapeAttr(secondaryValue)}" placeholder="(optional)" />

        <label>Content</label>
        <div id="lm_diff_container" class="lm-diff-container">
            <p class="lm-placeholder-text">Click "Generate Suggestion" to rewrite the content, or just edit the fields above and Save.</p>
        </div>

        <div id="lm_justification_container" style="display:none;"></div>

        <div id="lm_status" class="lm-status"></div>

        <div class="lm-popup-actions">
            <button id="lm_generate_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Suggestion
            </button>
            <button id="lm_approve_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-check"></i> Save
            </button>
            <button id="lm_reject_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-xmark"></i> Cancel
            </button>
        </div>
    </div>`;
}

function showStatus(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = `lm-status lm-status-${type}`;
    el.style.display = 'block';
}
