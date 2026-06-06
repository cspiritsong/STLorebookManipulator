import { generateRewrite, reviewEntries, resolveIssue } from "./llm.js";
import { computeDiff, renderInlineDiff, renderSideBySideDiff } from "./diff.js";
import { createBackup } from "./backup.js";
import {
  updateEntryFields,
  deleteEntry,
  getLorebookNames,
  loadLorebook,
  parseKeywordString,
} from "./lorebook.js";
import { escapeHtml, escapeAttr } from "./utils.js";
import { renderFriendlyError } from "./errors.js";

const PROMPT_PRESETS = {
  prune:
    "Shorten this entry for brevity while preserving all factual content. Remove redundancy and unnecessary elaboration.",
  clarify:
    "Improve clarity and readability without changing length or removing information. Rephrase awkward sentences.",
  grammar:
    "Correct grammar, spelling, and punctuation. Do not change meaning, structure, or length.",
};

export function getPromptText(preset, customPrompt) {
  if (preset === "custom" && customPrompt && customPrompt.trim()) {
    return customPrompt.trim();
  }
  return PROMPT_PRESETS[preset] || PROMPT_PRESETS.prune;
}

// Module-level session cache. The main popup is destroyed when closed, so
// without this, pressing Close throws away the selected lorebook, the review
// instructions, and (most painfully) the review results the user just spent
// tokens to generate. We keep that here so reopening restores it.
// review is { issues, batchCount, skippedBatches } and is invalidated when a
// different book is selected. fixedIssues is a Set of issue objects the user
// has resolved this session — tracked by object identity, which is stable
// because the cached review's issue objects are never recreated.
const sessionCache = {
  bookName: null,
  instructions: "",
  review: null,
  fixedIssues: new Set(),
};

export async function openMainPopup(settings, context) {
  const { Popup, POPUP_TYPE } = context;

  const bookNames = getLorebookNames(context);

  let optionsHtml =
    '<option value="" disabled selected>-- Choose a lorebook --</option>';
  for (const name of bookNames) {
    optionsHtml += `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`;
  }

  const popupHtml = `<div class="lm-main-popup lm-popup-layout">
        <div class="lm-popup-main">
            <h3>Lorebook Manipulator</h3>
            <label for="lm_popup_book_select">Select Lorebook</label>
            <select id="lm_popup_book_select" class="text_pole">${optionsHtml}</select>

            <div id="lm_review_section" class="lm-review-section" style="display:none;">
                <label for="lm_review_instructions">Review the whole book</label>
                <textarea id="lm_review_instructions" class="text_pole textarea_compact" rows="2"
                    placeholder="Optional: tell the AI what to focus on (e.g. 'find duplicate lore' or 'flag contradictions'). Leave blank for a general review."></textarea>
                <button type="button" id="lm_review_btn" class="menu_button menu_button_icon">
                    <i class="fa-solid fa-magnifying-glass"></i> Review &amp; Recommend Fixes
                </button>
                <div id="lm_review_status" class="lm-status"></div>
                <div id="lm_issue_list" class="lm-issue-list"></div>
            </div>

            <div id="lm_popup_entry_list" class="lm-entry-list" style="display:none; margin-top:10px;">
                <input id="lm_entry_search" type="text" class="text_pole" placeholder="Search entries by name, keys, or content..." style="margin-bottom: 8px;" />
            </div>
        </div>

        <div class="lm-popup-sidebar">
            <div id="lm_popup_settings" class="lm-popup-settings" style="display:none;">
                <h4>Settings</h4>
                <label for="lm_popup_connection_profile">Connection Profile</label>
                <select id="lm_popup_connection_profile" class="text_pole">
                    <option value="">Active connection (default)</option>
                </select>
                <small class="lm-field-hint">Which connection to use for rewriting and review.</small>

                <label for="lm_popup_max_tokens">Max Response Tokens</label>
                <input id="lm_popup_max_tokens" type="number" min="256" max="8192" step="256" class="text_pole" value="${settings.maxTokens || 1024}" />

                <label for="lm_popup_review_budget">Review Batch Budget (chars)</label>
                <input id="lm_popup_review_budget" type="number" min="2000" max="100000" step="1000" class="text_pole" value="${settings.reviewBatchBudget || 12000}" />
                <small class="lm-field-hint">Character budget per batch for review.</small>
            </div>

            <div id="lm_popup_backup_section" class="lm-popup-backup-section" style="display:none;">
                <h4>Backup History</h4>
                <div id="lm_popup_backup_history" class="lm-backup-history"></div>
                <button type="button" id="lm_popup_clear_backups" class="menu_button lm-clear-all-btn" style="margin-top: 10px;">
                    <i class="fa-solid fa-trash"></i> Clear All Backups
                </button>
            </div>
        </div>
    </div>`;

  const popup = new Popup(popupHtml, POPUP_TYPE.TEXT, "", {
    wide: true,
    large: true,
    okButton: false,
    cancelButton: "Close",
    allowVerticalScrolling: true,
  });

  popup.show();

  const container = document.querySelector(".lm-main-popup");
  if (!container) return;

  const select = container.querySelector("#lm_popup_book_select");
  const entryListEl = container.querySelector("#lm_popup_entry_list");
  const searchInput = container.querySelector("#lm_entry_search");
  const reviewSection = container.querySelector("#lm_review_section");
  const reviewBtn = container.querySelector("#lm_review_btn");
  const reviewInstructions = container.querySelector("#lm_review_instructions");
  const reviewStatus = container.querySelector("#lm_review_status");
  const issueListEl = container.querySelector("#lm_issue_list");
  const settingsSection = container.querySelector("#lm_popup_settings");
  const connectionProfileSelect = container.querySelector("#lm_popup_connection_profile");
  const maxTokensInput = container.querySelector("#lm_popup_max_tokens");
  const reviewBudgetInput = container.querySelector("#lm_popup_review_budget");
  const backupSection = container.querySelector("#lm_popup_backup_section");
  const backupHistoryEl = container.querySelector("#lm_popup_backup_history");
  const clearBackupsBtn = container.querySelector("#lm_popup_clear_backups");

  // Populate connection profile dropdown
  async function populatePopupConnectionProfiles() {
    if (!connectionProfileSelect) return;
    const service = context.ConnectionManagerRequestService;
    if (!service || typeof service.getSupportedProfiles !== "function") return;

    let profiles = [];
    try {
      profiles = service.getSupportedProfiles() || [];
    } catch (e) {
      console.warn("[LorebookManipulator] Could not list connection profiles:", e);
      return;
    }

    // Clear existing options except the first one
    connectionProfileSelect.querySelectorAll("option:not(:first-child)").forEach(opt => opt.remove());

    for (const profile of profiles) {
      const opt = document.createElement("option");
      opt.value = profile.id;
      opt.textContent = profile.name || profile.id;
      connectionProfileSelect.appendChild(opt);
    }

    // Restore saved selection
    connectionProfileSelect.value = settings.connectionProfileId || "";
  }

  // Initialize connection profiles on popup open
  populatePopupConnectionProfiles();

  // Wire up Connection Profile select
  connectionProfileSelect?.addEventListener("change", () => {
    settings.connectionProfileId = connectionProfileSelect.value;
    context.saveSettingsDebounced();
  });

  // Wire up Max Response Tokens input
  maxTokensInput?.addEventListener("change", () => {
    const val = parseInt(maxTokensInput.value, 10);
    settings.maxTokens = Math.max(256, Math.min(8192, val || 1024));
    context.saveSettingsDebounced();
  });

  // Wire up Review Batch Budget input
  reviewBudgetInput?.addEventListener("change", () => {
    const val = parseInt(reviewBudgetInput.value, 10);
    settings.reviewBatchBudget = Math.max(2000, Math.min(100000, val || 12000));
    context.saveSettingsDebounced();
  });

  // Wire up Clear All Backups button
  clearBackupsBtn?.addEventListener("click", async () => {
    if (!currentBookName) return;
    try {
      const { clearAllBackups } = await import("./backup.js");
      const confirmed = await context.Popup.show.confirm(
        "Clear All Backups",
        `Permanently delete ALL backups for "${currentBookName}"? This cannot be undone.`,
      );
      if (!confirmed) return;
      clearAllBackups(currentBookName);
      toastr.success(`All backups for "${currentBookName}" cleared.`);
      renderPopupBackupHistory(currentBookName);
    } catch (e) {
      console.error("[LorebookManipulator] Clear backups failed:", e);
      toastr.error(`Failed to clear backups: ${e.message}`);
    }
  });

  // Cached so review results (which reference entries by uid) can be mapped
  // back to the real entry objects for the rewrite flow.
  let currentEntries = [];
  let currentBookName = null;

  // Filter entries based on search text
  function filterEntries(entries, searchText) {
    if (!searchText || searchText.trim() === "") return entries;
    const query = searchText.toLowerCase().trim();
    return entries.filter((entry) => {
      const name = (entry.comment || "").toLowerCase();
      const keys = (entry.key || []).join(", ").toLowerCase();
      const content = (entry.content || "").toLowerCase();
      return (
        name.includes(query) || keys.includes(query) || content.includes(query)
      );
    });
  }

  // Re-render the entry list with current filter applied
  function renderFilteredList() {
    const searchText = searchInput ? searchInput.value : "";
    const filtered = filterEntries(currentEntries, searchText);
    renderEntryList(
      entryListEl,
      filtered,
      (entry) => {
        openRewritePopup(entry, currentBookName, settings, context, null, () =>
          loadAndRender(currentBookName),
        );
      },
      (entry) => handleDeleteEntry(entry, currentBookName),
    );
  }

  // Wire up search input
  searchInput?.addEventListener("input", () => {
    renderFilteredList();
  });

  // Render backup history in the popup with storage indicator
  async function renderPopupBackupHistory(bookName) {
    if (!backupHistoryEl) return;
    const { getBackupHistory, restoreBackup, downloadBackup, getBackupStorageUsage } = await import("./backup.js");
    const history = getBackupHistory(bookName);

    if (history.length === 0) {
      backupHistoryEl.innerHTML = '<p class="lm-no-backups">No backups yet.</p>';
      if (clearBackupsBtn) clearBackupsBtn.style.display = "none";
      return;
    }

    backupHistoryEl.innerHTML = "";
    if (clearBackupsBtn) clearBackupsBtn.style.display = "block";

    for (const backup of history) {
      const date = new Date(backup.timestamp).toLocaleString();
      const item = document.createElement("div");
      item.className = "lm-backup-item";
      item.innerHTML = `
        <span class="lm-backup-date">${escapeHtml(date)}</span>
        <div class="lm-backup-actions">
          <button type="button" class="menu_button lm-restore-btn" title="Restore this backup">Restore</button>
          <button type="button" class="menu_button lm-download-btn" title="Download as file">Download</button>
        </div>
      `;

      item.querySelector(".lm-restore-btn").addEventListener("click", async () => {
        try {
          const confirmed = await context.Popup.show.confirm(
            "Restore Backup",
            `Restore lorebook "${bookName}" to the state from ${date}? This will overwrite current data.`,
          );
          if (!confirmed) return;
          restoreBackup(bookName, backup.timestamp, (name, data) => context.saveWorldInfo(name, data), () => context.reloadWorldInfoEditor?.());
          toastr.success("Backup restored successfully.");
          await loadAndRender(bookName);
          renderPopupBackupHistory(bookName);
        } catch (e) {
          console.error("[LorebookManipulator] Restore failed:", e);
          toastr.error(`Restore failed: ${e.message}`);
        }
      });

      item.querySelector(".lm-download-btn").addEventListener("click", () => {
        try {
          const filename = downloadBackup(bookName, backup.timestamp);
          toastr.success(`Downloaded: ${filename}`);
        } catch (e) {
          console.error("[LorebookManipulator] Download failed:", e);
          toastr.error(`Download failed: ${e.message}`);
        }
      });

      backupHistoryEl.appendChild(item);
    }

    // Storage usage indicator
    const usage = getBackupStorageUsage();
    const statusClass = usage.isCritical ? "lm-storage-critical" : usage.isWarning ? "lm-storage-warning" : "lm-storage-ok";
    const statusIcon = usage.isCritical ? "⚠️" : usage.isWarning ? "⚠️" : "💾";
    const storageEl = document.createElement("div");
    storageEl.className = `lm-storage-indicator ${statusClass}`;
    storageEl.innerHTML = `
      <span class="lm-storage-label">${statusIcon} Storage:</span>
      <span class="lm-storage-usage">${usage.formatted} used</span>
      <span class="lm-storage-percent">(${usage.percentage}%)</span>
      ${usage.isCritical ? '<span class="lm-storage-alert">— clear old backups!</span>' : ""}
    `;
    backupHistoryEl.appendChild(storageEl);
  }

  // (Re)load the selected book's entries and render the list. Extracted so it
  // can be called after a delete to refresh the view.
  async function loadAndRender(bookName) {
    entryListEl.innerHTML = '<p class="lm-no-backups">Loading...</p>';
    entryListEl.style.display = "block";

    const entries = await loadLorebook(bookName, context);
    currentEntries = entries;
    currentBookName = bookName;

    reviewSection.style.display = entries.length > 0 ? "block" : "none";

    // Show settings and backup sections when a book is selected
    if (settingsSection) settingsSection.style.display = "block";
    if (backupSection) backupSection.style.display = "block";

    // Render backup history
    renderPopupBackupHistory(bookName);

    if (entries.length === 0) {
      // Clear and re-attach search input even when no entries
      const savedSearch = searchInput ? searchInput.value : "";
      entryListEl.innerHTML =
        '<p class="lm-no-backups">No entries in this lorebook.</p>';
      if (searchInput) {
        entryListEl.insertBefore(searchInput, entryListEl.firstChild);
        searchInput.value = savedSearch;
      }
      return;
    }

    // Preserve the search input when re-rendering
    const savedSearch = searchInput ? searchInput.value : "";
    entryListEl.innerHTML = "";
    if (searchInput) {
      entryListEl.appendChild(searchInput);
      searchInput.value = savedSearch;
    }

    renderFilteredList();
  }

  // Confirm, back up, delete, then refresh the list in place.
  async function handleDeleteEntry(entry, bookName) {
    const title = entry.comment || `Entry #${entry.uid}`;
    const confirmed = await context.Popup.show.confirm(
      "Delete Entry",
      `Permanently delete "${title}" from "${bookName}"? A backup is saved first, so you can restore it from Backup History.`,
    );
    if (!confirmed) return;

    try {
      const bookData = await context.loadWorldInfo(bookName);
      createBackup(bookName, bookData, settings.backupRetention);

      await deleteEntry(bookName, entry.uid, context);

      toastr.success(
        `Deleted "${title}". Restore from Backup History if needed.`,
      );
      await loadAndRender(bookName);
    } catch (e) {
      console.error("[LorebookManipulator] Delete failed:", e);
      entryListEl.innerHTML = renderFriendlyError(e, escapeHtml);
    }
  }

  select?.addEventListener("change", async () => {
    const bookName = select.value;
    if (!bookName) return;
    currentBookName = bookName;
    // Remember the choice; the previous review belonged to a different book.
    sessionCache.bookName = bookName;
    sessionCache.review = null;
    sessionCache.fixedIssues = new Set();

    try {
      issueListEl.innerHTML = "";
      showStatus(reviewStatus, "", "loading");
      reviewStatus.style.display = "none";

      await loadAndRender(bookName);
    } catch (e) {
      console.error("[LorebookManipulator] Failed to load entries:", e);
      entryListEl.style.display = "block";
      entryListEl.innerHTML = renderFriendlyError(e, escapeHtml);
    }
  });

  // Persist the review instructions as they type, so Close doesn't lose them.
  reviewInstructions?.addEventListener("input", () => {
    sessionCache.instructions = reviewInstructions.value;
  });

  // Render a review result (status line + issue list). Shared by the Review
  // button and by session restore, so reopening shows the results you already
  // generated instead of a blank panel.
  function showReview(reviewData) {
    const { issues, batchCount, skippedBatches } = reviewData;

    const skipNote =
      skippedBatches > 0
        ? ` (${skippedBatches} of ${batchCount} batch(es) couldn't be read and were skipped — try raising Max Response Tokens or a more capable model for a complete review.)`
        : "";

    if (issues.length === 0) {
      issueListEl.innerHTML = "";
      showStatus(
        reviewStatus,
        `No issues found across ${batchCount} batch(es). Your lorebook looks clean.${skipNote}`,
        skippedBatches > 0 ? "error" : "success",
      );
      return;
    }

    const fixedCount = issues.filter((it) =>
      sessionCache.fixedIssues.has(it),
    ).length;
    const fixedNote = fixedCount > 0 ? ` ${fixedCount} fixed so far.` : "";
    showStatus(
      reviewStatus,
      `Found ${issues.length} issue(s) across ${batchCount} batch(es). Click an entry to fix it.${fixedNote}${skipNote}`,
      "success",
    );

    // Called when an issue's fix succeeds (editor saved / resolution applied).
    // Mark it fixed, then cascade to any other unresolved issues that share
    // the same affected entry uids, refresh the list so badges show, and refresh entries.
    const markFixed = (issue) => {
      sessionCache.fixedIssues.add(issue);

      // Cascade: find all uids affected by the fixed issue, then mark any
      // other unresolved issue that references any of those uids as fixed too.
      const fixedUids = new Set(
        issue.entries.map((e) => e.uid).filter((uid) => uid !== null),
      );
      if (fixedUids.size > 0) {
        for (const otherIssue of issues) {
          if (sessionCache.fixedIssues.has(otherIssue)) continue;
          const otherUids = otherIssue.entries.map((e) => e.uid);
          if (otherUids.some((uid) => fixedUids.has(uid))) {
            sessionCache.fixedIssues.add(otherIssue);
          }
        }
      }

      showReview(reviewData);
      loadAndRender(currentBookName);
    };

    renderIssueList(
      issueListEl,
      issues,
      currentEntries,
      sessionCache.fixedIssues,
      (entry, issue) => {
        // Single-entry issue → open the editor on top; on success mark fixed.
        openRewritePopup(
          entry,
          currentBookName,
          settings,
          context,
          issue,
          null,
          () => markFixed(issue),
        );
      },
      (issue, affectedEntries) => {
        // Multi-entry issue → open the cross-entry resolve flow.
        openResolvePopup(
          issue,
          affectedEntries,
          currentBookName,
          settings,
          context,
          () => markFixed(issue),
        );
      },
    );
  }

  reviewBtn?.addEventListener("click", async () => {
    if (!currentBookName || currentEntries.length === 0) return;

    try {
      reviewBtn.disabled = true;
      issueListEl.innerHTML = "";
      showStatus(reviewStatus, "Reviewing entries...", "loading");

      const reviewData = await reviewEntries(
        currentEntries,
        reviewInstructions.value,
        settings.maxTokens,
        context,
        {
          profileId: settings.connectionProfileId || null,
          maxBatchChars: settings.reviewBatchBudget,
          onProgress: (current, total) => {
            showStatus(
              reviewStatus,
              `Reviewing... batch ${current} of ${total}`,
              "loading",
            );
          },
        },
      );

      // Cache the (token-costly) results so Close/reopen doesn't lose them.
      sessionCache.review = reviewData;
      sessionCache.fixedIssues = new Set();
      showReview(reviewData);
    } catch (e) {
      console.error("[LorebookManipulator] Review failed:", e);
      showFriendlyError(reviewStatus, e);
    } finally {
      reviewBtn.disabled = false;
    }
  });

  // Restore the previous session: reselect the last lorebook, refill the
  // instructions, and re-render the review results if we still have them.
  // Done without dispatching the select 'change' event so the cached review
  // isn't cleared.
  (async () => {
    if (reviewInstructions && sessionCache.instructions) {
      reviewInstructions.value = sessionCache.instructions;
    }
    if (sessionCache.bookName && bookNames.includes(sessionCache.bookName)) {
      select.value = sessionCache.bookName;
      currentBookName = sessionCache.bookName;
      try {
        await loadAndRender(sessionCache.bookName);
        if (sessionCache.review) {
          showReview(sessionCache.review);
        }
      } catch (e) {
        console.error("[LorebookManipulator] Session restore failed:", e);
      }
    }
  })();
}

// Render the clickable entry list into a container. Clicking the body opens
// the edit/rewrite flow; the trash button deletes (via onDeleteClick).
function renderEntryList(container, entries, onEntryClick, onDeleteClick) {
  container.innerHTML = "";
  container.style.display = "block";

  const sorted = [...entries].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

  for (const entry of sorted) {
    const name = entry.comment || `Entry #${entry.uid}`;
    const keys = (entry.key || []).join(", ") || "(no keys)";
    const preview =
      (entry.content || "").substring(0, 80) +
      ((entry.content || "").length > 80 ? "..." : "");
    const disabledClass = entry.disable ? " disabled" : "";

    const item = document.createElement("div");
    item.className = `lm-entry-item${disabledClass}`;

    const body = document.createElement("div");
    body.className = "lm-entry-body";
    body.innerHTML = `
            <div class="lm-entry-name">${escapeHtml(name)}</div>
            <div class="lm-entry-keys">${escapeHtml(keys)}</div>
            <div class="lm-entry-preview">${escapeHtml(preview)}</div>
        `;
    body.addEventListener("click", () => onEntryClick(entry));
    item.appendChild(body);

    if (typeof onDeleteClick === "function") {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "menu_button lm-entry-delete";
      del.title = "Delete this entry";
      del.innerHTML = '<i class="fa-solid fa-trash"></i>';
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onDeleteClick(entry);
      });
      item.appendChild(del);
    }

    container.appendChild(item);
  }
}

// Render the combined review issue list.
// - Single-entry issue: a clickable chip opens the editor (onFixClick).
// - Multi-entry issue: one "Resolve N entries together" button (onResolveClick)
//   because the fix is a single cross-entry resolution (e.g. merge + delete).
// - Issues in `fixedIssues` get a FIXED badge and are dimmed.
// Entries the review couldn't map back to a real uid are shown but disabled.
function renderIssueList(
  container,
  issues,
  entries,
  fixedIssues,
  onFixClick,
  onResolveClick,
) {
  container.innerHTML = "";

  const byUid = new Map(entries.map((e) => [e.uid, e]));

  for (const issue of issues) {
    const isFixed = fixedIssues && fixedIssues.has(issue);
    const card = document.createElement("div");
    card.className = `lm-issue-card lm-issue-${issue.severity}${isFixed ? " lm-issue-fixed" : ""}`;

    const header = document.createElement("div");
    header.className = "lm-issue-header";
    header.innerHTML = `
            <span class="lm-issue-type">${escapeHtml(issue.type)}</span>
            <span class="lm-issue-severity">${escapeHtml(issue.severity)}</span>
            ${isFixed ? '<span class="lm-issue-fixed-badge"><i class="fa-solid fa-circle-check"></i> FIXED!</span>' : ""}
        `;
    card.appendChild(header);

    const desc = document.createElement("div");
    desc.className = "lm-issue-desc";
    desc.textContent = issue.description;
    card.appendChild(desc);

    // Resolve only the entries we can actually map to the lorebook.
    const resolvable = issue.entries
      .map((ref) => byUid.get(ref.uid))
      .filter((e) => e);

    if (resolvable.length >= 2) {
      // Multi-entry issue: one button resolves them together.
      const names = document.createElement("div");
      names.className = "lm-issue-affected";
      names.textContent =
        "Affects: " +
        resolvable.map((e) => e.comment || `Entry #${e.uid}`).join(", ");
      card.appendChild(names);

      const resolveBtn = document.createElement("button");
      resolveBtn.type = "button";
      resolveBtn.className = "menu_button menu_button_icon lm-issue-resolve";
      resolveBtn.innerHTML = `<i class="fa-solid fa-object-group"></i> Resolve ${resolvable.length} entries together`;
      resolveBtn.addEventListener("click", () =>
        onResolveClick(issue, resolvable),
      );
      card.appendChild(resolveBtn);
    } else {
      // Single-entry (or only one resolvable) issue: per-entry chips.
      const chips = document.createElement("div");
      chips.className = "lm-issue-entries";

      for (const ref of issue.entries) {
        const entry = byUid.get(ref.uid);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "menu_button lm-issue-chip";

        if (entry) {
          chip.innerHTML = `<i class="fa-solid fa-wrench"></i> ${escapeHtml(entry.comment || `Entry #${entry.uid}`)}`;
          chip.addEventListener("click", () => onFixClick(entry, issue));
        } else {
          // The model referenced an entry we can't resolve (bad/missing uid).
          chip.disabled = true;
          chip.title = "This entry could not be matched to the lorebook.";
          chip.innerHTML = `<i class="fa-solid fa-question"></i> ${escapeHtml(ref.name || "Unknown entry")}`;
        }

        chips.appendChild(chip);
      }

      card.appendChild(chips);
    }

    container.appendChild(card);
  }
}

export async function openRewritePopup(
  entry,
  bookName,
  settings,
  context,
  issue = null,
  onClose = null,
  onSuccess = null,
) {
  const { Popup, POPUP_TYPE } = context;

  // Base instruction comes from the preset/custom prompt. When the user
  // arrived here from a review issue, append the issue so the rewrite
  // directly addresses what the review flagged.
  let promptText = getPromptText(settings.promptPreset, settings.customPrompt);
  if (issue && issue.description) {
    promptText = `${promptText}\n\nThis entry was flagged in a lorebook review (${issue.type}, ${issue.severity} severity):\n${issue.description}\n\nAddress this specific issue in your rewrite.`;
  }

  const popupHtml = buildPopupHtml(entry, issue);

  // cancelButton: false removes ST's built-in Cancel so the popup has exactly
  // one clearly-labelled dismiss (our "Back" button), avoiding two Cancels.
  const popup = new Popup(popupHtml, POPUP_TYPE.TEXT, "", {
    wide: true,
    okButton: false,
    cancelButton: false,
    allowVerticalScrolling: true,
  });

  // show() resolves when the popup is dismissed (Save, Back, or Esc).
  // Run onClose afterwards so the caller can refresh its view. We don't
  // await here because the handler setup below must run synchronously
  // while the popup's DOM is present.
  popup.show().then(() => {
    if (typeof onClose === "function") onClose();
  });

  const container = document.querySelector(".lm-rewrite-popup");
  if (!container) return;

  const generateBtn = container.querySelector("#lm_generate_btn");
  const approveBtn = container.querySelector("#lm_approve_btn");
  const rejectBtn = container.querySelector("#lm_reject_btn");
  const diffContainer = container.querySelector("#lm_diff_container");
  const justificationContainer = container.querySelector(
    "#lm_justification_container",
  );
  const statusEl = container.querySelector("#lm_status");
  const titleInput = container.querySelector("#lm_field_title");
  const keysInput = container.querySelector("#lm_field_keys");
  const secondaryInput = container.querySelector("#lm_field_secondary");
  const contentInput = container.querySelector("#lm_field_content");

  // Track original field values for change preview
  const originalFields = {
    comment: entry.comment || "",
    key: (entry.key || []).join(", "),
    keysecondary: (entry.keysecondary || []).join(", "),
    content: entry.content || "",
  };

  function getFieldChanges() {
    const changes = [];
    const current = {
      comment: titleInput ? titleInput.value : "",
      key: keysInput ? keysInput.value : "",
      keysecondary: secondaryInput ? secondaryInput.value : "",
      content: contentInput ? contentInput.value : "",
    };

    if (current.comment !== originalFields.comment) {
      changes.push({
        field: "Title",
        before: originalFields.comment,
        after: current.comment,
      });
    }
    if (current.key !== originalFields.key) {
      changes.push({
        field: "Primary Keys",
        before: originalFields.key,
        after: current.key,
      });
    }
    if (current.keysecondary !== originalFields.keysecondary) {
      changes.push({
        field: "Secondary Keys",
        before: originalFields.keysecondary,
        after: current.keysecondary,
      });
    }
    if (current.content !== originalFields.content) {
      changes.push({
        field: "Content",
        before: originalFields.content.substring(0, 100),
        after: current.content.substring(0, 100),
      });
    }

    return { changes, current };
  }

  generateBtn?.addEventListener("click", async () => {
    try {
      showStatus(statusEl, "Generating suggestion...", "loading");
      generateBtn.disabled = true;

      // Diff against whatever is currently in the box (the user may have
      // edited it by hand), and rewrite from that current text.
      const before = contentInput ? contentInput.value : entry.content;

      const result = await generateRewrite(
        before,
        promptText,
        settings.maxTokens,
        context,
        settings.connectionProfileId || null,
      );

      const diffResult = computeDiff(before, result.rewrittenContent);

      const diffHtml =
        settings.diffStyle === "side-by-side"
          ? renderSideBySideDiff(diffResult)
          : renderInlineDiff(diffResult);

      diffContainer.innerHTML = diffHtml;
      diffContainer.style.display = "block";
      justificationContainer.innerHTML = `<p class="lm-justification"><strong>Justification:</strong> ${escapeHtml(result.justification)}</p>`;
      justificationContainer.style.display = "block";

      // Drop the suggestion into the editable box so the user can tweak
      // it further before saving. The diff above shows what changed.
      if (contentInput) contentInput.value = result.rewrittenContent;

      showStatus(
        statusEl,
        "Suggestion applied to the content box. Review the diff, edit if needed, then Save.",
        "success",
      );
    } catch (e) {
      console.error("[LorebookManipulator] Generate failed:", e);
      showFriendlyError(statusEl, e);
    } finally {
      generateBtn.disabled = false;
    }
  });

  approveBtn?.addEventListener("click", async () => {
    try {
      // Get current field changes to preview
      const { changes, current } = getFieldChanges();

      // Check if title/keys/secondary changed (not just content via AI)
      const fieldChanges = changes.filter((c) => c.field !== "Content");

      // If field changes exist, show confirmation with preview
      if (fieldChanges.length > 0) {
        const previewText = fieldChanges
          .map(
            (c) => `${c.field}:
  Before: ${c.before || "(empty)"}
  After: ${c.after || "(empty)"}`,
          )
          .join("\n\n");

        const confirmed = await context.Popup.show.confirm(
          "Confirm Changes",
          `The following fields have been changed:\n\n${previewText}\n\nSave these changes?`,
        );
        if (!confirmed) return;
      }

      // Save all editable fields, reading content straight from the box
      // (covers both hand edits and AI suggestions).
      const fields = {
        comment: current.comment,
        key: parseKeywordString(keysInput ? keysInput.value : ""),
        keysecondary: parseKeywordString(
          secondaryInput ? secondaryInput.value : "",
        ),
        content: current.content,
      };

      showStatus(statusEl, "Saving changes...", "loading");
      approveBtn.disabled = true;
      rejectBtn.disabled = true;

      const bookData = await context.loadWorldInfo(bookName);
      createBackup(bookName, bookData, settings.backupRetention);

      await updateEntryFields(bookName, entry.uid, fields, context);

      showStatus(statusEl, "Changes saved successfully!", "success");
      toastr.success("Entry updated successfully.");

      // Mark the originating issue (if any) as fixed before dismissing.
      if (typeof onSuccess === "function") onSuccess();

      setTimeout(() => popup.completeCancelled(), 1000);
    } catch (e) {
      console.error("[LorebookManipulator] Save failed:", e);
      showFriendlyError(statusEl, e);
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
    }
  });

  rejectBtn?.addEventListener("click", () => {
    popup.completeCancelled();
  });
}

// Resolve a multi-entry issue with a single cross-entry plan. The plan is
// generated ON DEMAND (after review), shown as one action per entry
// (keep/rewrite/delete) with diffs and delete warnings, each toggleable.
// Applying backs up once, then applies only the checked actions.
export async function openResolvePopup(
  issue,
  affectedEntries,
  bookName,
  settings,
  context,
  onSuccess = null,
) {
  const { Popup, POPUP_TYPE } = context;

  const affectedList = affectedEntries
    .map(
      (e) =>
        `<li>${escapeHtml(e.comment || `Entry #${e.uid}`)} <span class="lm-resolve-uid">(uid ${escapeHtml(String(e.uid))})</span></li>`,
    )
    .join("");

  const popupHtml = `<div class="lm-resolve-popup">
        <h3 class="lm-popup-title">Resolve ${affectedEntries.length} entries together</h3>
        <div class="lm-issue-banner lm-issue-${escapeAttr(issue.severity)}">
            <strong>${escapeHtml(issue.type)} (${escapeHtml(issue.severity)}):</strong> ${escapeHtml(issue.description)}
        </div>
        <p class="lm-resolve-affected-title">Affected entries:</p>
        <ul class="lm-resolve-affected-list">${affectedList}</ul>

        <div id="lm_resolve_status" class="lm-status"></div>
        <div id="lm_resolve_plan" class="lm-resolve-plan"></div>

        <div class="lm-popup-actions">
            <button type="button" id="lm_resolve_generate" class="menu_button menu_button_icon">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Fix Plan
            </button>
            <button type="button" id="lm_resolve_apply" class="menu_button menu_button_icon" disabled>
                <i class="fa-solid fa-check"></i> Apply Selected
            </button>
            <button type="button" id="lm_resolve_cancel" class="menu_button menu_button_icon">
                <i class="fa-solid fa-arrow-left"></i> Back to issues
            </button>
        </div>
    </div>`;

  // okButton/cancelButton false → only our own buttons, so there's exactly
  // one clearly-labelled "Back to issues" dismiss (no duplicate Cancel).
  const popup = new Popup(popupHtml, POPUP_TYPE.TEXT, "", {
    wide: true,
    large: true,
    okButton: false,
    cancelButton: false,
    allowVerticalScrolling: true,
  });

  popup.show();

  const container = document.querySelector(".lm-resolve-popup");
  if (!container) return;

  const generateBtn = container.querySelector("#lm_resolve_generate");
  const applyBtn = container.querySelector("#lm_resolve_apply");
  const cancelBtn = container.querySelector("#lm_resolve_cancel");
  const planEl = container.querySelector("#lm_resolve_plan");
  const statusEl = container.querySelector("#lm_resolve_status");

  const byUid = new Map(affectedEntries.map((e) => [e.uid, e]));
  let currentActions = null; // set after generating the plan

  generateBtn?.addEventListener("click", async () => {
    try {
      showStatus(statusEl, "Generating a fix plan...", "loading");
      generateBtn.disabled = true;
      applyBtn.disabled = true;

      const plan = await resolveIssue(
        issue,
        affectedEntries,
        settings.maxTokens,
        context,
        settings.connectionProfileId || null,
      );
      currentActions = plan.actions;

      renderResolvePlan(planEl, plan, byUid, settings);

      applyBtn.disabled = false;
      const summary = plan.summary ? ` ${plan.summary}` : "";
      showStatus(
        statusEl,
        `Plan ready.${summary} Untick anything you don't want, then Apply Selected.`,
        "success",
      );
    } catch (e) {
      console.error("[LorebookManipulator] Resolve generate failed:", e);
      showFriendlyError(statusEl, e);
      currentActions = null;
    } finally {
      generateBtn.disabled = false;
    }
  });

  applyBtn?.addEventListener("click", async () => {
    if (!currentActions) return;

    // Collect only the checked actions that actually change something.
    const checkboxes = planEl.querySelectorAll(".lm-resolve-action-check");
    const toApply = [];
    checkboxes.forEach((cb) => {
      if (!cb.checked) return;
      const uid = Number(cb.dataset.uid);
      const action = currentActions.find((a) => a.uid === uid);
      if (
        action &&
        (action.action === "rewrite" || action.action === "delete")
      ) {
        toApply.push(action);
      }
    });

    if (toApply.length === 0) {
      showStatus(
        statusEl,
        "Nothing selected to apply. Tick at least one change, or go back.",
        "error",
      );
      return;
    }

    try {
      showStatus(statusEl, "Applying changes...", "loading");
      applyBtn.disabled = true;
      generateBtn.disabled = true;

      // One backup before the whole batch of changes.
      const bookData = await context.loadWorldInfo(bookName);
      createBackup(bookName, bookData, settings.backupRetention);

      // Apply rewrites first, then deletes (so a delete can't shift a
      // rewrite target — uids are stable anyway, but this is tidy).
      const rewrites = toApply.filter((a) => a.action === "rewrite");
      const deletes = toApply.filter((a) => a.action === "delete");

      for (const a of rewrites) {
        await updateEntryFields(
          bookName,
          a.uid,
          { content: a.newContent },
          context,
        );
      }
      for (const a of deletes) {
        await deleteEntry(bookName, a.uid, context);
      }

      showStatus(
        statusEl,
        `Applied ${rewrites.length} rewrite(s) and ${deletes.length} deletion(s). Backup saved.`,
        "success",
      );
      toastr.success("Issue resolved. Restore from Backup History if needed.");

      // Mark the issue fixed before dismissing back to the issue list.
      if (typeof onSuccess === "function") onSuccess();

      setTimeout(() => popup.completeCancelled(), 1200);
    } catch (e) {
      console.error("[LorebookManipulator] Resolve apply failed:", e);
      showFriendlyError(statusEl, e);
      applyBtn.disabled = false;
      generateBtn.disabled = false;
    }
  });

  cancelBtn?.addEventListener("click", () => {
    popup.completeCancelled();
  });
}

// Render the resolution plan: one row per action with a checkbox. Rewrites
// show a content diff; deletes show a clear warning. Defaults: rewrite/delete
// ticked, keep shown but disabled (nothing to apply).
function renderResolvePlan(container, plan, byUid, settings) {
  container.innerHTML = "";

  for (const action of plan.actions) {
    const entry = byUid.get(action.uid);
    const name = entry
      ? entry.comment || `Entry #${entry.uid}`
      : `Entry uid ${action.uid}`;

    const row = document.createElement("div");
    row.className = `lm-resolve-row lm-resolve-${action.action}`;

    const changes = action.action !== "keep";

    const header = document.createElement("label");
    header.className = "lm-resolve-row-header";
    const checkedAttr = changes ? "checked" : "";
    const disabledAttr = changes ? "" : "disabled";
    const actionLabel = action.action.toUpperCase();
    header.innerHTML = `
            <input type="checkbox" class="lm-resolve-action-check" data-uid="${escapeAttr(String(action.uid))}" ${checkedAttr} ${disabledAttr} />
            <span class="lm-resolve-action-tag lm-resolve-tag-${action.action}">${escapeHtml(actionLabel)}</span>
            <span class="lm-resolve-entry-name">${escapeHtml(name)}</span>
        `;
    row.appendChild(header);

    if (action.reason) {
      const reason = document.createElement("div");
      reason.className = "lm-resolve-reason";
      reason.textContent = action.reason;
      row.appendChild(reason);
    }

    if (action.action === "rewrite" && entry) {
      const diffResult = computeDiff(
        entry.content || "",
        action.newContent || "",
      );
      const diffHtml =
        settings.diffStyle === "side-by-side"
          ? renderSideBySideDiff(diffResult)
          : renderInlineDiff(diffResult);
      const diffWrap = document.createElement("div");
      diffWrap.className = "lm-resolve-diff";
      diffWrap.innerHTML = diffHtml;
      row.appendChild(diffWrap);
    } else if (action.action === "delete") {
      const warn = document.createElement("div");
      warn.className = "lm-resolve-delete-warning";
      warn.innerHTML =
        '<i class="fa-solid fa-triangle-exclamation"></i> This entry will be deleted. A backup is saved first.';
      row.appendChild(warn);
    }

    container.appendChild(row);
  }
}

function buildPopupHtml(entry, issue = null) {
  const entryTitle = entry.comment || "";
  const keysValue = (entry.key || []).join(", ");
  const secondaryValue = (entry.keysecondary || []).join(", ");

  const issueBanner =
    issue && issue.description
      ? `<div class="lm-issue-banner lm-issue-${escapeAttr(issue.severity)}">
                <strong>Flagged (${escapeHtml(issue.type)}, ${escapeHtml(issue.severity)}):</strong>
                ${escapeHtml(issue.description)}
           </div>`
      : "";

  // When opened from a review issue, dismissing returns to the issue list,
  // so label it "Back to issues". Otherwise it just closes the editor.
  const dismissLabel = issue
    ? '<i class="fa-solid fa-arrow-left"></i> Back to issues'
    : '<i class="fa-solid fa-xmark"></i> Cancel';

  return `<div class="lm-rewrite-popup">
        <h3 class="lm-popup-title">Edit Entry #${escapeHtml(String(entry.uid))}</h3>

        ${issueBanner}

        <label for="lm_field_title">Title / Memo</label>
        <input id="lm_field_title" type="text" class="text_pole" value="${escapeAttr(entryTitle)}" placeholder="(no title)" />

        <label for="lm_field_keys">Primary Keys (comma-separated)</label>
        <input id="lm_field_keys" type="text" class="text_pole" value="${escapeAttr(keysValue)}" placeholder="e.g. dragon, wyrm" />

        <label for="lm_field_secondary">Secondary Keys (comma-separated)</label>
        <input id="lm_field_secondary" type="text" class="text_pole" value="${escapeAttr(secondaryValue)}" placeholder="(optional)" />

        <label for="lm_field_content">Content</label>
        <textarea id="lm_field_content" class="text_pole textarea_compact lm-content-textarea" rows="8" placeholder="(empty)">${escapeHtml(entry.content || "")}</textarea>
        <small class="lm-field-hint">Edit the content directly, or click "Generate Suggestion" to have the AI rewrite it (you'll see a highlighted diff, and the box above updates to the suggestion).</small>

        <div id="lm_diff_container" class="lm-diff-container" style="display:none;"></div>

        <div id="lm_justification_container" style="display:none;"></div>

        <div id="lm_status" class="lm-status"></div>

        <div class="lm-popup-actions">
            <button type="button" id="lm_generate_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Suggestion
            </button>
            <button type="button" id="lm_approve_btn" class="menu_button menu_button_icon">
                <i class="fa-solid fa-check"></i> Save
            </button>
            <button type="button" id="lm_reject_btn" class="menu_button menu_button_icon">
                ${dismissLabel}
            </button>
        </div>
    </div>`;
}

function showStatus(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = `lm-status lm-status-${type}`;
  el.style.display = "block";
}

// Render a newbie-friendly error (title + what + how-to-fix) into a status area.
function showFriendlyError(el, error) {
  if (!el) return;
  el.className = "lm-status lm-status-error";
  el.innerHTML = renderFriendlyError(error, escapeHtml);
  el.style.display = "block";
}
