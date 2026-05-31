import { generateRewrite } from './llm.js';
import { computeDiff, renderInlineDiff, renderSideBySideDiff } from './diff.js';
import { createBackup } from './backup.js';
import { updateEntryContent } from './lorebook.js';

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

export async function openRewritePopup(entry, bookName, settings, context) {
    const { Popup, POPUP_TYPE } = context;

    const promptText = getPromptText(settings.promptPreset, settings.customPrompt);

    const popupHtml = buildPopupHtml(entry, settings);

    const popup = new Popup(popupHtml, POPUP_TYPE.TEXT, '', {
        wide: true,
        okButton: null,
        cancelButton: 'Close',
        allowVerticalScrolling: true,
    });

    popup.show();

    const container = document.querySelector('.lm-rewrite-popup');
    if (!container) return;

    const generateBtn = container.querySelector('#lm_generate_btn');
    const approveBtn = container.querySelector('#lm_approve_btn');
    const rejectBtn = container.querySelector('#lm_reject_btn');
    const diffContainer = container.querySelector('#lm_diff_container');
    const justificationContainer = container.querySelector('#lm_justification_container');
    const statusEl = container.querySelector('#lm_status');

    let currentSuggestion = null;

    generateBtn?.addEventListener('click', async () => {
        try {
            showStatus(statusEl, 'Generating suggestion...', 'loading');
            generateBtn.disabled = true;
            approveBtn.disabled = true;

            const result = await generateRewrite(
                entry.content,
                promptText,
                settings.maxTokens,
                context,
            );

            currentSuggestion = result.rewrittenContent;

            const diffResult = computeDiff(entry.content, result.rewrittenContent);

            const diffHtml = settings.diffStyle === 'side-by-side'
                ? renderSideBySideDiff(diffResult)
                : renderInlineDiff(diffResult);

            diffContainer.innerHTML = diffHtml;
            justificationContainer.innerHTML = `<p class="lm-justification"><strong>Justification:</strong> ${escapeHtml(result.justification)}</p>`;
            justificationContainer.style.display = 'block';

            approveBtn.disabled = false;
            showStatus(statusEl, 'Suggestion ready. Review the diff above.', 'success');
        } catch (e) {
            console.error('[LorebookManipulator] Generate failed:', e);
            showStatus(statusEl, e.message, 'error');
            currentSuggestion = null;
            approveBtn.disabled = true;
        } finally {
            generateBtn.disabled = false;
        }
    });

    approveBtn?.addEventListener('click', async () => {
        if (!currentSuggestion) return;

        try {
            showStatus(statusEl, 'Saving changes...', 'loading');
            approveBtn.disabled = true;
            rejectBtn.disabled = true;

            const bookData = await context.loadWorldInfo(bookName);
            createBackup(bookName, bookData, settings.backupRetention);

            await updateEntryContent(bookName, entry.uid, currentSuggestion, context);

            showStatus(statusEl, 'Changes applied successfully!', 'success');
            toastr.success('Entry updated successfully.');

            setTimeout(() => popup.close(), 1000);
        } catch (e) {
            console.error('[LorebookManipulator] Apply failed:', e);
            showStatus(statusEl, `Failed to apply: ${e.message}`, 'error');
            toastr.error(`Failed to save changes: ${e.message}`);
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
        }
    });

    rejectBtn?.addEventListener('click', () => {
        popup.close();
    });
}

function buildPopupHtml(entry, settings) {
    const entryTitle = entry.comment || `Entry #${entry.uid}`;
    const keysDisplay = (entry.key || []).join(', ') || '(no keys)';

    return `<div class="lm-rewrite-popup">
        <h3 class="lm-popup-title">${escapeHtml(entryTitle)}</h3>
        <p class="lm-popup-keys"><strong>Keys:</strong> ${escapeHtml(keysDisplay)}</p>

        <div id="lm_diff_container" class="lm-diff-container">
            <p class="lm-placeholder-text">Click "Generate Suggestion" to see a rewritten version.</p>
        </div>

        <div id="lm_justification_container" style="display:none;"></div>

        <div id="lm_status" class="lm-status"></div>

        <div class="lm-popup-actions">
            <button id="lm_generate_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Suggestion
            </button>
            <button id="lm_approve_btn" class="menu_button menu_button_icon" disabled>
                <i class="fa-solid fa-check"></i> Approve
            </button>
            <button id="lm_reject_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-xmark"></i> Reject
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
