import {
  generateEntryFromChat,
  generateEntryFromInstructions,
  checkEntryImpact,
  chatAboutLore,
  generateRewrite,
  reviewEntries,
  reviseChatEntryDraft,
  resolveIssue,
} from "./llm.js";
import { computeDiff, renderInlineDiff, renderSideBySideDiff } from "./diff.js";
import {
  executeChangePlans,
  restoreLorebookBackup,
  updateEntryFields,
  deleteEntry,
  createEntry,
  getLorebookNames,
  loadLorebook,
  parseKeywordString,
} from "./lorebook.js";
import { planResolveActions, planRewriteEntry } from "./change-plan.js";
import { escapeHtml, escapeAttr } from "./utils.js";
import { renderFriendlyError } from "./errors.js";
import { filterIgnoredIssues, ignoreIssue } from "./issue-blacklist.js";
import {
  createRequestOptions,
  createRequestProgressReporter,
  waitForRequestContinue,
} from "./request-status.js";
import {
  getChatExtractionRecord,
  recordChatExtraction,
} from "./chat-extraction-record.js";
import { getSTContext } from "./st-context.js";
import {
  beginUIOperation,
  cancelUIOperation,
  completeUIOperation,
  createUIState,
  failUIOperation,
  isCurrentUIOperation,
  selectBook,
} from "./ui-state.js";

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

// Pure utility functions for testability

/**
 * Filter lorebook entries by search text across name, keys, and content.
 * @param {Array} entries - Array of lorebook entry objects
 * @param {string} searchText - Text to search for (case-insensitive)
 * @returns {Array} Filtered entries
 */
export function filterEntries(entries, searchText) {
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

/**
 * Compute cascade of issues to mark as FIXED when one issue is resolved.
 * Given a fixed issue and the full issue list, returns a Set of all issues
 * (including the originally fixed one) that share affected entry uids.
 * @param {Object} fixedIssue - The issue that was just fixed
 * @param {Array} allIssues - All issues from the review
 * @param {Set} alreadyFixed - Set of issues already marked fixed
 * @returns {Set} Extended set of issues to mark as fixed
 */
export function computeCascadeFixedIssues(fixedIssue, allIssues, alreadyFixed) {
  const result = new Set(alreadyFixed);
  result.add(fixedIssue);
  const fixedBookName = fixedIssue.bookName || "";

  const fixedUids = new Set(
    fixedIssue.entries.map((e) => e.uid).filter((uid) => uid !== null),
  );

  if (fixedUids.size > 0) {
    for (const otherIssue of allIssues) {
      if (result.has(otherIssue)) continue;
      // UIDs are only unique inside a lorebook. Never cascade from Book A
      // uid 5 to Book B uid 5.
      if ((otherIssue.bookName || "") !== fixedBookName) continue;
      const otherUids = otherIssue.entries.map((e) => e.uid);
      if (otherUids.some((uid) => fixedUids.has(uid))) {
        result.add(otherIssue);
      }
    }
  }

  return result;
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
  entriesByBook: new Map(),
  // Active chat-range draft survives an accidental Close/reopen for the same
  // lorebook. It stays in memory only; Add to Lorebook is still explicit.
  chatDraft: null,
  loreAssistantHistory: new Map(),
};

function captureActiveElement() {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  return active && active !== document.body ? active : null;
}

function restoreFocus(element) {
  if (!element || typeof element.focus !== "function") return;
  setTimeout(() => {
    if (element.isConnected === false) return;
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }, 0);
}

function whenPopupCloses(popup, callback) {
  const result = popup.show();
  if (result && typeof result.then === "function") {
    result.then(() => callback?.(), () => callback?.());
  } else {
    callback?.();
  }
  return result;
}

export async function openMainPopup(
  settings,
  context,
  chatRangeRequest = null,
) {
  context = getSTContext(context);
  const { Popup, POPUP_TYPE } = context;
  const focusReturn = captureActiveElement();

  let bookNames = [];
  try {
    bookNames = getLorebookNames(context);
  } catch (error) {
    console.error("[LorebookManipulator] Failed to list lorebooks:", error);
    if (typeof toastr !== "undefined" && typeof toastr.error === "function") {
      toastr.error(`SillyTavern compatibility issue: ${error.message}`);
    }
    return;
  }

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
            <div class="lm-lorebook-filter-actions">
                <button type="button" id="lm_current_lorebooks_btn" class="menu_button">
                    <i class="fa-solid fa-location-crosshairs"></i> Current Lorebooks
                </button>
                <button type="button" id="lm_all_lorebooks_btn" class="menu_button">
                    <i class="fa-solid fa-list"></i> All Lorebooks
                </button>
            </div>

            <div id="lm_review_section" class="lm-review-section" style="display:none;">
                <label for="lm_review_instructions">Review the whole book</label>
                <textarea id="lm_review_instructions" class="text_pole textarea_compact" rows="2"
                    placeholder="Optional: tell the AI what to focus on (e.g. 'find duplicate lore' or 'flag contradictions'). Leave blank for a general review."></textarea>
                <button type="button" id="lm_review_btn" class="menu_button menu_button_icon">
                    <i class="fa-solid fa-magnifying-glass"></i> Review &amp; Recommend Fixes
                </button>
                <button type="button" id="lm_multi_review_btn" class="menu_button menu_button_icon">
                    <i class="fa-solid fa-books"></i> Review Multiple Books
                </button>
                <button type="button" id="lm_review_cancel" class="menu_button menu_button_icon" style="display:none;">
                    <i class="fa-solid fa-ban"></i> Cancel Review
                </button>
                <div id="lm_review_status" class="lm-status" role="status" aria-live="polite" aria-atomic="true"></div>
                <div id="lm_issue_list" class="lm-issue-list"></div>
            </div>

            <div id="lm_chat_range_section" class="lm-chat-range-section" style="display:none;">
                <h4>Create from Chat Range</h4>
                <small id="lm_chat_range_hint" class="lm-field-hint"></small>
                <small id="lm_chat_extraction_record" class="lm-field-hint"></small>
                <div class="lm-chat-range-inputs">
                    <label for="lm_chat_start">Start message #</label>
                    <input id="lm_chat_start" type="number" min="0" step="1" class="text_pole" />
                    <label for="lm_chat_end">End message #</label>
                    <input id="lm_chat_end" type="number" min="0" step="1" class="text_pole" />
                </div>
                <label for="lm_chat_instructions">What should this entry capture?</label>
                <textarea id="lm_chat_instructions" class="text_pole textarea_compact" rows="2"
                    placeholder="Optional: e.g. Summarize the newly established facts about Vanessa."></textarea>
                <button type="button" id="lm_chat_generate" class="menu_button menu_button_icon">
                    <i class="fa-solid fa-file-circle-plus"></i> Generate Entry from Messages
                </button>
                <div id="lm_chat_status" class="lm-status" role="status" aria-live="polite" aria-atomic="true"></div>
                <div id="lm_chat_preview" style="display:none;">
                    <label for="lm_chat_title">Title</label>
                    <input id="lm_chat_title" type="text" class="text_pole" />
                    <label for="lm_chat_keys">Primary Keys (comma-separated)</label>
                    <input id="lm_chat_keys" type="text" class="text_pole" />
                    <label for="lm_chat_secondary">Secondary Keys (comma-separated)</label>
                    <input id="lm_chat_secondary" type="text" class="text_pole" />
                    <label for="lm_chat_content">New Entry Content</label>
                    <textarea id="lm_chat_content" class="text_pole lm-content-textarea" rows="8"></textarea>
                    <div id="lm_chat_justification" class="lm-justification"></div>
                    <label for="lm_chat_refine">Refine this draft</label>
                    <textarea id="lm_chat_refine" class="text_pole textarea_compact" rows="2"
                        placeholder="e.g. Make it shorter, emphasize the relationship, remove the timeline."></textarea>
                    <button type="button" id="lm_chat_refine_btn" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Revise Draft
                    </button>
                    <div id="lm_chat_history" class="lm-chat-history"></div>
                    <button type="button" id="lm_chat_add" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-plus"></i> Add to Lorebook
                    </button>
                </div>
            </div>

            <div id="lm_popup_entry_controls" style="display:none; margin-top:10px;">
                <button type="button" id="lm_popup_create_entry" class="menu_button menu_button_icon lm-create-entry-button">
                    <i class="fa-solid fa-plus"></i> Create New Lorebook Entry
                </button>
                <input id="lm_entry_search" type="text" class="text_pole" placeholder="Search entries by name, keys, or content..." style="margin: 8px 0;" />
            </div>
            <div id="lm_popup_entry_list" class="lm-entry-list" style="display:none;"></div>
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

                <label for="lm_popup_review_tokens">Review Response Tokens</label>
                <input id="lm_popup_review_tokens" type="number" min="256" max="8192" step="256" class="text_pole" value="${settings.reviewMaxTokens || 2048}" />

                <label for="lm_popup_resolve_tokens">Resolve Response Tokens</label>
                <input id="lm_popup_resolve_tokens" type="number" min="256" max="8192" step="256" class="text_pole" value="${settings.resolveMaxTokens || 2048}" />

                <label for="lm_popup_chat_tokens">Chat / Draft Response Tokens</label>
                <input id="lm_popup_chat_tokens" type="number" min="256" max="8192" step="256" class="text_pole" value="${settings.chatMaxTokens || 1024}" />

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

  whenPopupCloses(popup, () => restoreFocus(focusReturn));

  const container = document.querySelector(".lm-main-popup");
  if (!container) return;

  const select = container.querySelector("#lm_popup_book_select");
  const currentLorebooksBtn = container.querySelector(
    "#lm_current_lorebooks_btn",
  );
  const allLorebooksBtn = container.querySelector("#lm_all_lorebooks_btn");
  const entryListEl = container.querySelector("#lm_popup_entry_list");
  const entryControlsEl = container.querySelector("#lm_popup_entry_controls");
  const createEntryBtn = container.querySelector("#lm_popup_create_entry");
  const searchInput = container.querySelector("#lm_entry_search");
  const reviewSection = container.querySelector("#lm_review_section");
  const reviewBtn = container.querySelector("#lm_review_btn");
  const multiReviewBtn = container.querySelector("#lm_multi_review_btn");
  const reviewCancelBtn = container.querySelector("#lm_review_cancel");
  const reviewInstructions = container.querySelector("#lm_review_instructions");
  const reviewStatus = container.querySelector("#lm_review_status");
  const issueListEl = container.querySelector("#lm_issue_list");
  const chatRangeSection = container.querySelector("#lm_chat_range_section");
  const chatRangeHint = container.querySelector("#lm_chat_range_hint");
  const chatExtractionRecord = container.querySelector(
    "#lm_chat_extraction_record",
  );
  const chatStartInput = container.querySelector("#lm_chat_start");
  const chatEndInput = container.querySelector("#lm_chat_end");
  const chatInstructions = container.querySelector("#lm_chat_instructions");
  const chatGenerateBtn = container.querySelector("#lm_chat_generate");
  const chatStatus = container.querySelector("#lm_chat_status");
  const chatPreview = container.querySelector("#lm_chat_preview");
  const chatTitleInput = container.querySelector("#lm_chat_title");
  const chatKeysInput = container.querySelector("#lm_chat_keys");
  const chatSecondaryInput = container.querySelector("#lm_chat_secondary");
  const chatContentInput = container.querySelector("#lm_chat_content");
  const chatJustification = container.querySelector("#lm_chat_justification");
  const chatRefineInput = container.querySelector("#lm_chat_refine");
  const chatRefineBtn = container.querySelector("#lm_chat_refine_btn");
  const chatHistory = container.querySelector("#lm_chat_history");
  const chatAddBtn = container.querySelector("#lm_chat_add");
  const settingsSection = container.querySelector("#lm_popup_settings");
  const connectionProfileSelect = container.querySelector(
    "#lm_popup_connection_profile",
  );
  const maxTokensInput = container.querySelector("#lm_popup_max_tokens");
  const reviewTokensInput = container.querySelector("#lm_popup_review_tokens");
  const resolveTokensInput = container.querySelector("#lm_popup_resolve_tokens");
  const chatTokensInput = container.querySelector("#lm_popup_chat_tokens");
  const reviewBudgetInput = container.querySelector("#lm_popup_review_budget");
  const backupSection = container.querySelector("#lm_popup_backup_section");
  const backupHistoryEl = container.querySelector("#lm_popup_backup_history");
  const clearBackupsBtn = container.querySelector("#lm_popup_clear_backups");

  // Populate connection profile dropdown
  async function populatePopupConnectionProfiles() {
    if (!connectionProfileSelect) return;

    let profiles = [];
    try {
      profiles = context.getConnectionProfiles();
    } catch (e) {
      console.warn(
        "[LorebookManipulator] Could not list connection profiles:",
        e,
      );
      return;
    }

    // Clear existing options except the first one
    connectionProfileSelect
      .querySelectorAll("option:not(:first-child)")
      .forEach((opt) => opt.remove());

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

  reviewTokensInput?.addEventListener("change", () => {
    const val = parseInt(reviewTokensInput.value, 10);
    settings.reviewMaxTokens = Math.max(256, Math.min(8192, val || 2048));
    context.saveSettingsDebounced();
  });

  resolveTokensInput?.addEventListener("change", () => {
    const val = parseInt(resolveTokensInput.value, 10);
    settings.resolveMaxTokens = Math.max(256, Math.min(8192, val || 2048));
    context.saveSettingsDebounced();
  });

  chatTokensInput?.addEventListener("change", () => {
    const val = parseInt(chatTokensInput.value, 10);
    settings.chatMaxTokens = Math.max(256, Math.min(8192, val || 1024));
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
      await clearAllBackups(currentBookName);
      toastr.success(`All backups for "${currentBookName}" cleared.`);
      await renderPopupBackupHistory(currentBookName);
    } catch (e) {
      console.error("[LorebookManipulator] Clear backups failed:", e);
      toastr.error(`Failed to clear backups: ${e.message}`);
    }
  });

  // Cached so review results (which reference entries by uid) can be mapped
  // back to the real entry objects for the rewrite flow.
  let currentEntries = [];
  let currentBookName = null;
  let reviewController = null;
  let activeReviewToken = null;
  let pendingChatRange = chatRangeRequest;
  let uiState = createUIState();

  function resetReviewControls() {
    if (reviewBtn) reviewBtn.disabled = false;
    if (multiReviewBtn) multiReviewBtn.disabled = false;
    if (reviewCancelBtn) {
      reviewCancelBtn.style.display = "none";
      reviewCancelBtn.disabled = false;
    }
  }

  // A book change invalidates both the current review token and the request
  // controller. SillyTavern's active-connection generation cannot always abort
  // immediately, so the token check remains the authoritative stale-result
  // guard even after the controller has been signalled.
  function invalidateActiveReview() {
    const controller = reviewController;
    reviewController = null;
    controller?.abort();
    if (
      activeReviewToken &&
      isCurrentUIOperation(uiState, activeReviewToken)
    ) {
      uiState = cancelUIOperation(uiState, activeReviewToken);
    }
    activeReviewToken = null;
    resetReviewControls();
  }

  function startReviewOperation(bookName) {
    const operation = beginUIOperation(uiState, "review", { bookName });
    uiState = operation.state;
    activeReviewToken = operation.token;
    return operation.token;
  }

  function isCurrentReview(token) {
    return isCurrentUIOperation(uiState, token);
  }

  function renderBookOptions(names, selectedName = "") {
    if (!select) return;
    select.innerHTML =
      '<option value="" disabled>-- Choose a lorebook --</option>';
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    select.value = names.includes(selectedName) ? selectedName : "";
  }

  function getCurrentLorebookNames() {
    // #world_info is SillyTavern's active World Info selector. Its selected
    // options are the books currently attached to this chat/character context.
    const selected = [
      ...document.querySelectorAll("#world_info option:checked"),
    ]
      .map((option) => option.textContent.trim())
      .filter((name) => bookNames.includes(name));
    const chatBook = context.chatMetadata?.world_info;
    if (typeof chatBook === "string" && bookNames.includes(chatBook)) {
      selected.push(chatBook);
    }
    return [...new Set(selected)];
  }

  currentLorebooksBtn?.addEventListener("click", () => {
    const currentBooks = getCurrentLorebookNames();
    if (currentBooks.length === 0) {
      toastr.info("No currently selected lorebooks were found for this chat.");
      return;
    }
    renderBookOptions(currentBooks, currentBookName);
    toastr.info(`Showing ${currentBooks.length} current lorebook(s).`);
  });

  allLorebooksBtn?.addEventListener("click", () => {
    renderBookOptions(bookNames, currentBookName);
  });

  // Return the selected inclusive message range, preserving original chat
  // indexes so the user can refer to the same numbers they entered.
  function getSelectedChatMessages() {
    const chat = Array.isArray(context.chat) ? context.chat : [];
    const start = Number(chatStartInput?.value);
    const end = Number(chatEndInput?.value);

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new Error("Enter whole-number start and end message indexes.");
    }
    if (start < 0 || end < start || end >= chat.length) {
      throw new Error(
        `Choose a valid inclusive range from 0 to ${Math.max(0, chat.length - 1)}.`,
      );
    }

    const messages = chat
      .slice(start, end + 1)
      .map((message, offset) => ({ ...message, index: start + offset }))
      .filter(
        (message) => !message.is_system && String(message.mes || "").trim(),
      );

    if (messages.length === 0) {
      throw new Error(
        "That range contains no usable chat messages. Try a different range.",
      );
    }
    return messages;
  }

  function readChatDraftFromInputs() {
    return {
      title: chatTitleInput?.value || "",
      primaryKeys: parseKeywordString(chatKeysInput?.value || ""),
      secondaryKeys: parseKeywordString(chatSecondaryInput?.value || ""),
      content: chatContentInput?.value || "",
    };
  }

  function renderChatDraft(draft) {
    if (chatTitleInput) chatTitleInput.value = draft.title || "";
    if (chatKeysInput)
      chatKeysInput.value = (draft.primaryKeys || []).join(", ");
    if (chatSecondaryInput)
      chatSecondaryInput.value = (draft.secondaryKeys || []).join(", ");
    if (chatContentInput) chatContentInput.value = draft.content || "";
    if (chatJustification) {
      chatJustification.innerHTML = `<strong>Why this entry:</strong> ${escapeHtml(draft.justification || "(No justification provided)")}`;
    }
    if (chatPreview) chatPreview.style.display = "block";
  }

  function renderChatRevisionHistory(history = []) {
    if (!chatHistory) return;
    if (history.length === 0) {
      chatHistory.innerHTML = "";
      return;
    }
    chatHistory.innerHTML = `<strong>Draft session</strong>${history
      .map(
        (item) =>
          `<div class="lm-chat-history-item"><span>You:</span> ${escapeHtml(item.instruction)}<br><span>AI:</span> ${escapeHtml(item.justification)}</div>`,
      )
      .join("")}`;
  }

  function rememberChatDraft(draft, history = []) {
    sessionCache.chatDraft = {
      bookName: currentBookName,
      start: Number(chatStartInput?.value),
      end: Number(chatEndInput?.value),
      instructions: chatInstructions?.value || "",
      ...draft,
      history,
    };
    renderChatRevisionHistory(history);
  }

  // Generate a proposed new entry, but leave every field editable until the
  // user explicitly chooses Add to Lorebook.
  chatGenerateBtn?.addEventListener("click", async () => {
    if (!currentBookName) return;
    try {
      const messages = getSelectedChatMessages();
      showStatus(
        chatStatus,
        `Summarizing ${messages.length} message(s)...`,
        "loading",
      );
      chatGenerateBtn.disabled = true;

      const result = await generateEntryFromChat(
        messages,
        chatInstructions?.value || "",
        settings.chatMaxTokens || settings.maxTokens,
        context,
        settings.connectionProfileId || null,
        createRequestOptions(chatStatus, "Generating entry draft", settings.requestDelayMs),
      );

      rememberChatDraft(result);
      renderChatDraft(result);
      showStatus(
        chatStatus,
        "Entry draft ready. Edit anything you want, then Add to Lorebook.",
        "success",
      );
    } catch (e) {
      console.error("[LorebookManipulator] Chat-range generation failed:", e);
      showFriendlyError(chatStatus, e);
    } finally {
      chatGenerateBtn.disabled = false;
    }
  });

  // Continue a draft session with a user-directed revision grounded in the
  // same source-message range. Any manual field edits are included too.
  chatRefineBtn?.addEventListener("click", async () => {
    if (!currentBookName) return;
    try {
      const instruction = chatRefineInput?.value || "";
      const messages = getSelectedChatMessages();
      const draft = readChatDraftFromInputs();
      showStatus(
        chatStatus,
        "Revising draft from the selected messages...",
        "loading",
      );
      chatRefineBtn.disabled = true;

      const result = await reviseChatEntryDraft(
        messages,
        draft,
        instruction,
        settings.chatMaxTokens || settings.maxTokens,
        context,
        settings.connectionProfileId || null,
        createRequestOptions(chatStatus, "Revising entry draft", settings.requestDelayMs),
      );
      const history = [
        ...(sessionCache.chatDraft?.bookName === currentBookName
          ? sessionCache.chatDraft.history || []
          : []),
        { instruction, justification: result.justification },
      ];
      rememberChatDraft(result, history);
      renderChatDraft(result);
      if (chatRefineInput) chatRefineInput.value = "";
      showStatus(
        chatStatus,
        "Draft revised. Keep refining, edit it by hand, or Add to Lorebook.",
        "success",
      );
    } catch (e) {
      console.error(
        "[LorebookManipulator] Chat-range draft revision failed:",
        e,
      );
      showFriendlyError(chatStatus, e);
    } finally {
      chatRefineBtn.disabled = false;
    }
  });

  chatAddBtn?.addEventListener("click", async () => {
    if (!currentBookName) return;
    try {
      const fields = {
        comment: chatTitleInput?.value || "",
        key: parseKeywordString(chatKeysInput?.value || ""),
        keysecondary: parseKeywordString(chatSecondaryInput?.value || ""),
        content: chatContentInput?.value || "",
      };
      if (!fields.content.trim()) {
        throw new Error("New entry content cannot be empty.");
      }

      showStatus(chatStatus, "Adding entry to lorebook...", "loading");
      chatAddBtn.disabled = true;
      const uid = await createEntry(currentBookName, fields, context);
      const selectedEnd = Number(chatEndInput?.value);
      const recordedEnd = recordChatExtraction(
        context.chatId,
        currentBookName,
        selectedEnd,
      );

      if (chatPreview) chatPreview.style.display = "none";
      sessionCache.chatDraft = null;
      renderChatRevisionHistory();
      toastr.success(`Created entry #${uid}.`);
      showStatus(
        chatStatus,
        recordedEnd === null
          ? "Entry added. A backup was saved first."
          : `Entry added. A backup was saved first. Recorded through message #${recordedEnd}.`,
        "success",
      );
      await loadAndRender(currentBookName);
      await renderPopupBackupHistory(currentBookName);
    } catch (e) {
      console.error("[LorebookManipulator] Adding chat-range entry failed:", e);
      showFriendlyError(chatStatus, e);
    } finally {
      chatAddBtn.disabled = false;
    }
  });

  // Re-render the entry list with current filter applied
  function renderFilteredList() {
    const searchText = searchInput ? searchInput.value : "";
    const filtered = filterEntries(currentEntries, searchText);
    const bookName = currentBookName;
    renderEntryList(
      entryListEl,
      filtered,
      (entry) => {
        openRewritePopup(
          entry,
          bookName,
          settings,
          context,
          null,
          () =>
            currentBookName === bookName ? loadAndRender(bookName) : undefined,
        );
      },
      (entry) => handleDeleteEntry(entry, bookName),
    );
  }

  // Wire up search input
  searchInput?.addEventListener("input", () => {
    renderFilteredList();
  });

  createEntryBtn?.addEventListener("click", () => {
    if (!currentBookName) return;
    const bookName = currentBookName;
    openCreateEntryPopup(
      bookName,
      settings,
      context,
      (name) => (currentBookName === name ? loadAndRender(name) : undefined),
    );
  });

  // Render backup history in the popup with storage indicator
  async function renderPopupBackupHistory(bookName, isCurrent = () => true) {
    if (!backupHistoryEl) return true;
    const {
      getBackupHistory,
      downloadBackup,
      getBackupStorageUsage,
    } = await import("./backup.js");
    const history = await getBackupHistory(bookName);
    if (!isCurrent()) return false;

    if (history.length === 0) {
      backupHistoryEl.innerHTML =
        '<p class="lm-no-backups">No backups yet.</p>';
      if (clearBackupsBtn) clearBackupsBtn.style.display = "none";
      return true;
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

      item
        .querySelector(".lm-restore-btn")
        .addEventListener("click", async () => {
          try {
            const confirmed = await context.Popup.show.confirm(
              "Restore Backup",
              `Restore lorebook "${bookName}" to the state from ${date}? This will overwrite current data.`,
            );
            if (!confirmed) return;
            await restoreLorebookBackup(bookName, backup.timestamp, context);
            toastr.success("Backup restored successfully.");
            if (currentBookName === bookName) {
              await loadAndRender(bookName);
              if (currentBookName === bookName) {
                await renderPopupBackupHistory(bookName);
              }
            }
          } catch (e) {
            console.error("[LorebookManipulator] Restore failed:", e);
            toastr.error(`Restore failed: ${e.message}`);
          }
        });

      item.querySelector(".lm-download-btn").addEventListener("click", async () => {
        try {
          const filename = await downloadBackup(bookName, backup.timestamp);
          toastr.success(`Downloaded: ${filename}`);
        } catch (e) {
          console.error("[LorebookManipulator] Download failed:", e);
          toastr.error(`Download failed: ${e.message}`);
        }
      });

      backupHistoryEl.appendChild(item);
    }

    // Storage usage indicator
    const usage = await getBackupStorageUsage();
    if (!isCurrent()) return false;
    const statusClass = usage.isCritical
      ? "lm-storage-critical"
      : usage.isWarning
        ? "lm-storage-warning"
        : "lm-storage-ok";
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
    return true;
  }

  // (Re)load the selected book's entries and render the list. Extracted so it
  // can be called after a delete to refresh the view.
  async function loadAndRender(bookName) {
    if (uiState.selectedBook !== bookName) {
      uiState = selectBook(uiState, bookName);
    }
    const operation = beginUIOperation(uiState, "load", { bookName });
    uiState = operation.state;
    const operationToken = operation.token;
    entryListEl.innerHTML = '<p class="lm-no-backups">Loading...</p>';
    entryListEl.style.display = "block";
    entryListEl.setAttribute("aria-busy", "true");
    if (entryControlsEl) entryControlsEl.style.display = "block";

    let entries;
    try {
      entries = await loadLorebook(bookName, context);
    } catch (error) {
      if (isCurrentUIOperation(uiState, operationToken)) {
        uiState = failUIOperation(uiState, operationToken);
        entryListEl.setAttribute("aria-busy", "false");
        throw error;
      }
      return false;
    }
    if (!isCurrentUIOperation(uiState, operationToken)) return false;

    currentEntries = entries;
    currentBookName = bookName;
    sessionCache.entriesByBook.set(bookName, entries);

    reviewSection.style.display = entries.length > 0 ? "block" : "none";

    // Show settings and backup sections when a book is selected
    if (settingsSection) settingsSection.style.display = "block";
    if (backupSection) backupSection.style.display = "block";

    // Chat-range generation can create an entry even for an empty lorebook.
    const chatCount = Array.isArray(context.chat) ? context.chat.length : 0;
    if (chatRangeSection) {
      chatRangeSection.style.display = chatCount > 0 ? "block" : "none";
    }
    if (chatCount > 0) {
      if (chatRangeHint) {
        chatRangeHint.textContent = `Current chat has ${chatCount} messages. Use 0-based, inclusive indexes (#0 to #${chatCount - 1}).`;
      }
      if (chatStartInput) {
        chatStartInput.max = String(chatCount - 1);
        if (!chatStartInput.value)
          chatStartInput.value = String(Math.max(0, chatCount - 10));
      }
      if (chatEndInput) {
        chatEndInput.max = String(chatCount - 1);
        if (!chatEndInput.value) chatEndInput.value = String(chatCount - 1);
      }

      const lastExtracted = getChatExtractionRecord(
        context.chatId,
        bookName,
      );
      if (chatExtractionRecord) {
        chatExtractionRecord.textContent =
          lastExtracted === null
            ? "No messages have been recorded for this chat and lorebook yet."
            : `Last extracted through message #${lastExtracted}.`;
      }
      const nextStart = lastExtracted === null ? null : lastExtracted + 1;
      if (nextStart !== null && nextStart < chatCount && chatStartInput) {
        chatStartInput.value = String(nextStart);
        if (chatEndInput) chatEndInput.value = String(chatCount - 1);
        if (chatExtractionRecord) {
          chatExtractionRecord.textContent += ` Next range starts at #${nextStart}.`;
        }
      } else if (nextStart !== null && chatExtractionRecord) {
        chatExtractionRecord.textContent +=
          " All current messages have already been recorded; choose a range manually to extract more.";
      }

      if (pendingChatRange) {
        if (chatStartInput)
          chatStartInput.value = String(pendingChatRange.start);
        if (chatEndInput) chatEndInput.value = String(pendingChatRange.end);
        if (chatInstructions)
          chatInstructions.value = pendingChatRange.instructions || "";
        pendingChatRange = null;
      }

      // Restore an unfinished draft only for the lorebook it belongs to.
      const savedDraft = sessionCache.chatDraft;
      if (
        savedDraft?.bookName === bookName &&
        Number.isInteger(savedDraft.start) &&
        Number.isInteger(savedDraft.end) &&
        savedDraft.start >= 0 &&
        savedDraft.end >= savedDraft.start &&
        savedDraft.end < chatCount
      ) {
        if (chatStartInput) chatStartInput.value = String(savedDraft.start);
        if (chatEndInput) chatEndInput.value = String(savedDraft.end);
        if (chatInstructions)
          chatInstructions.value = savedDraft.instructions || "";
        renderChatDraft(savedDraft);
        renderChatRevisionHistory(savedDraft.history || []);
      } else if (chatPreview) {
        chatPreview.style.display = "none";
        renderChatRevisionHistory();
      }
    }

    // Render backup history
    await renderPopupBackupHistory(bookName, () =>
      isCurrentUIOperation(uiState, operationToken),
    );
    if (!isCurrentUIOperation(uiState, operationToken)) return false;

    uiState = completeUIOperation(uiState, operationToken, {
      bookName,
      entries,
    });

    if (entries.length === 0) {
      entryListEl.innerHTML =
        '<p class="lm-no-backups">No entries in this lorebook.</p>';
      entryListEl.setAttribute("aria-busy", "false");
      return true;
    }

    entryListEl.innerHTML = "";
    renderFilteredList();
    entryListEl.setAttribute("aria-busy", "false");
    return true;
  }

  // Apply fixes for all unresolved issues in bulk.
  async function applyAllFixes(allIssues, reviewData, statusEl) {
    const targetBookName = currentBookName;
    if (!targetBookName || sessionCache.review !== reviewData) return;

    // Find issues not yet fixed
    const unresolved = allIssues.filter(
      (issue) => !sessionCache.fixedIssues.has(issue),
    );
    if (unresolved.length === 0) {
      toastr.info("All issues are already fixed.");
      return;
    }

    // Confirm before making sweeping changes
    const confirmed = await context.Popup.show.confirm(
      "Apply All Fixes",
      `Apply fixes for ${unresolved.length} issue(s)? Each will be rewritten or deleted according to the review's recommendations.\n\nOne backup per affected lorebook will be created before its first change.`,
    );
    if (!confirmed) return;
    if (currentBookName !== targetBookName || sessionCache.review !== reviewData) {
      return;
    }

    const mutationOperation = beginUIOperation(uiState, "mutation", {
      bookName: targetBookName,
    });
    uiState = mutationOperation.state;
    const mutationToken = mutationOperation.token;

    showStatus(
      statusEl,
      `Applying fixes for ${unresolved.length} issues...`,
      "loading",
    );

    let successCount = 0;
    let failCount = 0;
    const newFixed = new Set(sessionCache.fixedIssues); // start with already-fixed
    const generatedPlans = [];
    const instructions = sessionCache.instructions || "";

    // First generate every approved operation plan without mutating any book.
    // The plans are applied together below, grouped by lorebook.
    for (let i = 0; i < unresolved.length; i++) {
      if (!isCurrentUIOperation(uiState, mutationToken)) return;
      const issue = unresolved[i];
      showStatus(
        statusEl,
        `Preparing fix ${i + 1}/${unresolved.length}: ${issue.description || "issue"}...`,
        "loading",
      );

      try {
        const issueBookName = issue.bookName || targetBookName;
        const issueEntries =
          sessionCache.entriesByBook.get(issueBookName) || currentEntries;
        if (issue.entries.length === 1) {
          const entryUid = issue.entries[0].uid;
          const entryObj = issueEntries.find((e) => e.uid === entryUid);
          if (!entryObj) {
            console.warn(`[ApplyAll] Entry ${entryUid} not found, skipping`);
            failCount++;
            continue;
          }

          const rewriteInstructions = `${instructions || "Rewrite this entry to address the review issue."}\n\nThis entry was flagged in a lorebook review (${issue.type}, ${issue.severity} severity):\n${issue.description}\n\nAddress this specific issue in your rewrite.`;
          const rewrite = await generateRewrite(
            entryObj.content,
            rewriteInstructions,
            settings.maxTokens,
            context,
            settings.connectionProfileId || null,
            createRequestOptions(
              statusEl,
              `Preparing fix ${i + 1}/${unresolved.length}`,
              settings.requestDelayMs,
            ),
          );
          if (!isCurrentUIOperation(uiState, mutationToken)) return;
          generatedPlans.push({
            issue,
            plan: planRewriteEntry(
              issueBookName,
              entryUid,
              rewrite.rewrittenContent,
            ),
          });
        } else {
          const affectedEntries = issue.entries
            .map((e) => issueEntries.find((en) => en.uid === e.uid))
            .filter(Boolean);

          if (affectedEntries.length === 0) {
            console.warn(
              `[ApplyAll] No valid affected entries for issue, skipping`,
            );
            failCount++;
            continue;
          }

          const resolution = await resolveIssue(
            issue,
            affectedEntries,
            settings.resolveMaxTokens || settings.maxTokens,
            context,
            settings.connectionProfileId || null,
            createRequestOptions(
              statusEl,
              `Preparing fix ${i + 1}/${unresolved.length}`,
              settings.requestDelayMs,
            ),
          );
          if (!isCurrentUIOperation(uiState, mutationToken)) return;
          const actionable = (resolution.actions || []).filter((action) =>
            ["rewrite", "delete"].includes(action.action),
          );
          if (actionable.length === 0) {
            console.warn(
              `[ApplyAll] Resolve produced no actionable changes for issue, skipping`,
            );
            failCount++;
            continue;
          }
          generatedPlans.push({
            issue,
            plan: planResolveActions(issueBookName, actionable),
          });
        }
      } catch (e) {
        console.error(
          "[LorebookManipulator] ApplyAll planning failed for issue:",
          issue.description,
          e,
        );
        failCount++;
      }

      // Pace requests so we don't hammer the provider. callLLM already retries
      // with backoff on rate limits, but a small gap between issues reduces the
      // chance of tripping the limit in the first place. Skip the wait after
      // the last issue.
      if (i < unresolved.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (!isCurrentUIOperation(uiState, mutationToken)) return;
      }
    }

    if (generatedPlans.length > 0) {
      if (!isCurrentUIOperation(uiState, mutationToken)) return;
      showStatus(
        statusEl,
        `Applying ${generatedPlans.length} verified fix plan(s)...`,
        "loading",
      );
      let result;
      try {
        result = await executeChangePlans(
          generatedPlans.map(({ plan }) => plan),
          context,
          { backupRetention: settings.backupRetention },
        );
      } catch (error) {
        if (isCurrentUIOperation(uiState, mutationToken)) {
          uiState = failUIOperation(uiState, mutationToken);
        }
        throw error;
      }
      if (!isCurrentUIOperation(uiState, mutationToken)) return;
      const resultsByBook = new Map(
        result.results.map((bookResult) => [bookResult.bookName, bookResult]),
      );
      for (const { issue } of generatedPlans) {
        const bookName = issue.bookName || targetBookName;
        const bookResult = resultsByBook.get(bookName);
        if (bookResult?.ok) {
          newFixed.add(issue);
          successCount++;
        } else {
          failCount++;
          console.error(
            "[LorebookManipulator] ApplyAll mutation failed for book:",
            bookName,
            bookResult?.error,
          );
        }
      }
    }

    // Compute cascade: any other issue that shares a uid with a now-fixed issue becomes fixed too.
    const finalFixed = new Set(newFixed);
    for (const issue of allIssues) {
      if (finalFixed.has(issue)) continue;
      const uids = issue.entries
        .map((e) => e.uid)
        .filter((uid) => uid !== null);
      if (
        uids.some((uid) => {
          for (const fixedIssue of finalFixed) {
            if (
              (fixedIssue.bookName || targetBookName) ===
                (issue.bookName || targetBookName) &&
              fixedIssue.entries.some((fe) => fe.uid === uid)
            )
              return true;
          }
          return false;
        })
      ) {
        finalFixed.add(issue);
      }
    }

    sessionCache.fixedIssues = finalFixed;
    if (!isCurrentUIOperation(uiState, mutationToken)) return;
    uiState = completeUIOperation(uiState, mutationToken);

    // Refresh the UI
    showReview(reviewData);
    await loadAndRender(targetBookName);

    // Final status
    const msg =
      failCount > 0
        ? `Applied ${successCount} fix(es), ${failCount} failed.`
        : `Successfully applied all ${successCount} fixes!`;
    showStatus(statusEl, msg, failCount > 0 ? "error" : "success");
    if (failCount === 0) {
      toastr.success(msg);
    } else {
      toastr.warning(msg);
    }
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
      await deleteEntry(bookName, entry.uid, context);

      toastr.success(
        `Deleted "${title}". Restore from Backup History if needed.`,
      );
      if (currentBookName === bookName) await loadAndRender(bookName);
    } catch (e) {
      console.error("[LorebookManipulator] Delete failed:", e);
      entryListEl.innerHTML = renderFriendlyError(e, escapeHtml);
    }
  }

  select?.addEventListener("change", async () => {
    const bookName = select.value;
    if (!bookName) return;
    invalidateActiveReview();
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
      entryListEl.setAttribute("aria-busy", "false");
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
    const {
      issues,
      batchCount,
      skippedBatches,
      localIssueCount = 0,
      crossBatchCandidateCount = 0,
      crossBatchSkipped = false,
      emptyObjectResponses = 0,
    } = reviewData;
    const reviewBookName = currentBookName;
    const visibleIssues = issues.filter(
      (issue) =>
        filterIgnoredIssues(issue.bookName || currentBookName, [issue]).length >
        0,
    );
    const ignoredCount = issues.length - visibleIssues.length;

    const skipNote =
      skippedBatches > 0
        ? ` (${skippedBatches} of ${batchCount} batch(es) couldn't be read and were skipped — try raising Max Response Tokens or a more capable model for a complete review.)`
        : "";
    const preflightNote =
      localIssueCount > 0
        ? ` ${localIssueCount} local preflight finding(s) included.`
        : "";
    const crossBatchNote =
      crossBatchCandidateCount > 0
        ? ` Checked ${crossBatchCandidateCount} cross-batch candidate pair(s)${crossBatchSkipped ? "; that pass was incomplete" : ""}.`
        : "";
    const weakFormatNote =
      emptyObjectResponses > 0
        ? ` ${emptyObjectResponses} empty-object response(s) were treated as weak-format results.`
        : "";

    if (visibleIssues.length === 0) {
      issueListEl.innerHTML = "";
      showStatus(
        reviewStatus,
        issues.length === 0
          ? `No issues found across ${batchCount} batch(es). Your lorebook looks clean.${skipNote}`
          : `All ${issues.length} detected issue(s) are ignored for this lorebook.${skipNote}`,
        skippedBatches > 0 ? "error" : "success",
      );
      return;
    }

    const fixedCount = visibleIssues.filter((it) =>
      sessionCache.fixedIssues.has(it),
    ).length;
    const fixedNote = fixedCount > 0 ? ` ${fixedCount} fixed so far.` : "";
    const ignoredNote = ignoredCount > 0 ? ` ${ignoredCount} ignored.` : "";
    showStatus(
      reviewStatus,
      `Found ${visibleIssues.length} issue(s) across ${batchCount} batch(es). Click an entry to fix it.${fixedNote}${ignoredNote}${preflightNote}${crossBatchNote}${weakFormatNote}${skipNote}`,
      "success",
    );

    // Called when an issue's fix succeeds (editor saved / resolution applied).
    // Mark it fixed, then cascade to any other unresolved issues that share
    // the same affected entry uids, refresh the list so badges show, and refresh entries.
    const markFixed = (issue) => {
      if (
        currentBookName !== reviewBookName ||
        sessionCache.review !== reviewData
      ) {
        return;
      }
      sessionCache.fixedIssues = computeCascadeFixedIssues(
        issue,
        issues,
        sessionCache.fixedIssues,
      );

      showReview(reviewData);
      void loadAndRender(reviewBookName);
    };

    renderIssueList(
      issueListEl,
      visibleIssues,
      currentEntries,
      sessionCache.fixedIssues,
      (entry, issue) => {
        // Single-entry issue → open the editor on top; on success mark fixed.
        const issueBookName = issue.bookName || reviewBookName;
        openRewritePopup(
          entry,
          issueBookName,
          settings,
          context,
          issue,
          null,
          () => markFixed(issue),
        );
      },
      (issue, affectedEntries) => {
        // Multi-entry issue → open the cross-entry resolve flow.
        const issueBookName = issue.bookName || reviewBookName;
        openResolvePopup(
          issue,
          affectedEntries,
          issueBookName,
          settings,
          context,
          () => markFixed(issue),
        );
      },
      (issue) => {
        if (currentBookName !== reviewBookName || sessionCache.review !== reviewData) {
          return;
        }
        ignoreIssue(issue.bookName || reviewBookName, issue);
        toastr.success(
          "Issue ignored for this lorebook. It will not appear in future reviews.",
        );
        showReview(reviewData);
      },
      sessionCache.entriesByBook,
    );

    // Add "Apply All Fixes" button for bulk resolution
    const oldBtn = issueListEl.querySelector(".lm-apply-all-btn");
    oldBtn?.remove();

    const applyAllBtn = document.createElement("button");
    applyAllBtn.type = "button";
    applyAllBtn.className = "menu_button lm-apply-all-btn";
    applyAllBtn.innerHTML = '<i class="fa-solid fa-broom"></i> Apply All Fixes';
    applyAllBtn.style.marginTop = "10px";
    applyAllBtn.addEventListener("click", async () => {
      applyAllBtn.disabled = true;
      try {
        await applyAllFixes(visibleIssues, reviewData, reviewStatus);
      } finally {
        applyAllBtn.disabled = false;
      }
    });
    // Insert at the TOP of the issue list so it's immediately visible
    // (a large book can generate many issue cards, burying a bottom button).
    issueListEl.insertBefore(applyAllBtn, issueListEl.firstChild);
  }

  reviewCancelBtn?.addEventListener("click", () => {
    if (!reviewController) return;
    reviewController.abort();
    // Active-connection generateRaw has no per-request AbortSignal. Stop only
    // when this extension's own review is being cancelled by the user.
    if (!settings.connectionProfileId) context.stopGeneration?.();
    showStatus(
      reviewStatus,
      "Cancelling review after the current request...",
      "loading",
    );
    reviewCancelBtn.disabled = true;
  });

  async function runMultiBookReview(bookNames) {
    const selectedBooks = [...new Set(bookNames)].filter(Boolean);
    if (selectedBooks.length === 0) return;

    const reviewToken = startReviewOperation(currentBookName);
    const controller = new AbortController();
    reviewController = controller;

    try {
      reviewBtn.disabled = true;
      multiReviewBtn.disabled = true;
      if (reviewCancelBtn) {
        reviewCancelBtn.disabled = false;
        reviewCancelBtn.style.display = "inline-block";
      }
      issueListEl.innerHTML = "";
      showStatus(
        reviewStatus,
        `Loading ${selectedBooks.length} lorebook(s)...`,
        "loading",
      );

      const aggregate = {
        issues: [],
        batchCount: 0,
        skippedBatches: 0,
        cancelled: false,
        localIssueCount: 0,
        crossBatchCandidateCount: 0,
        crossBatchSkipped: false,
        emptyObjectResponses: 0,
      };
      sessionCache.entriesByBook = new Map();

      for (let bookIndex = 0; bookIndex < selectedBooks.length; bookIndex++) {
        if (!isCurrentReview(reviewToken) || controller.signal.aborted) {
          aggregate.cancelled = true;
          break;
        }
        const bookName = selectedBooks[bookIndex];
        const entries = await loadLorebook(bookName, context);
        if (!isCurrentReview(reviewToken)) return;
        sessionCache.entriesByBook.set(bookName, entries);
        if (entries.length === 0) continue;

        const reportRequestProgress = createRequestProgressReporter(
          reviewStatus,
          `Reviewing ${bookName}`,
        );

        const review = await reviewEntries(
          entries,
          reviewInstructions.value,
          settings.reviewMaxTokens || settings.maxTokens,
          context,
          {
            profileId: settings.connectionProfileId || null,
            maxBatchChars: settings.reviewBatchBudget,
            reviewResponseLength: settings.reviewMaxTokens || settings.maxTokens,
            signal: controller.signal,
            requestDelayMs: settings.requestDelayMs,
            onRequestProgress: (progress) => {
              if (isCurrentReview(reviewToken)) reportRequestProgress(progress);
            },
            onRequestFailure: (error) =>
              isCurrentReview(reviewToken)
                ? waitForRequestContinue(
                    reviewStatus,
                    `Reviewing ${bookName}`,
                    error,
                    controller.signal,
                  )
                : false,
            onProgress: (current, total) => {
              if (!isCurrentReview(reviewToken)) return;
              showStatus(
                reviewStatus,
                `Reviewing ${bookIndex + 1}/${selectedBooks.length}: ${bookName} (batch ${current}/${total})`,
                "loading",
              );
            },
          },
        );
        if (!isCurrentReview(reviewToken)) return;
        aggregate.issues.push(
          ...review.issues.map((issue) => ({ ...issue, bookName })),
        );
        aggregate.batchCount += review.batchCount;
        aggregate.skippedBatches += review.skippedBatches;
        aggregate.localIssueCount += review.localIssueCount || 0;
        aggregate.crossBatchCandidateCount += review.crossBatchCandidateCount || 0;
        aggregate.crossBatchSkipped ||= Boolean(review.crossBatchSkipped);
        aggregate.emptyObjectResponses += review.emptyObjectResponses || 0;
        if (review.cancelled) {
          aggregate.cancelled = true;
          break;
        }
      }

      if (!isCurrentReview(reviewToken)) return;
      uiState = completeUIOperation(uiState, reviewToken, {
        review: aggregate,
      });
      sessionCache.review = aggregate;
      sessionCache.fixedIssues = new Set();
      showReview(aggregate);
      if (aggregate.cancelled) {
        showStatus(
          reviewStatus,
          "Multi-lorebook review cancelled. Completed-book results were kept.",
          "success",
        );
      }
    } catch (e) {
      console.error("[LorebookManipulator] Multi-lorebook review failed:", e);
      if (isCurrentReview(reviewToken)) {
        uiState = failUIOperation(uiState, reviewToken);
        showFriendlyError(reviewStatus, e);
      }
    } finally {
      if (activeReviewToken === reviewToken) {
        activeReviewToken = null;
        if (reviewController === controller) reviewController = null;
        resetReviewControls();
      }
    }
  }

  multiReviewBtn?.addEventListener("click", () => {
    const checks = bookNames
      .map(
        (name) =>
          `<label><input type="checkbox" value="${escapeAttr(name)}" ${name === currentBookName ? "checked" : ""}> ${escapeHtml(name)}</label>`,
      )
      .join("<br>");
    const popup = new Popup(
      `<div class="lm-multi-review-popup"><h3>Review Multiple Lorebooks</h3><p>Select books to review independently. Results stay book-scoped, so entries with the same UID in different books are never mixed.</p><div class="lm-multi-review-checks">${checks}</div><div class="lm-popup-actions"><button type="button" id="lm_multi_review_start" class="menu_button">Review Selected Books</button></div></div>`,
      POPUP_TYPE.TEXT,
      "",
      { okButton: false, cancelButton: "Cancel", allowVerticalScrolling: true },
    );
    popup.show();
    const picker = document.querySelector(".lm-multi-review-popup");
    picker
      ?.querySelector("#lm_multi_review_start")
      ?.addEventListener("click", () => {
        const names = [...picker.querySelectorAll("input:checked")].map(
          (input) => input.value,
        );
        popup.completeCancelled();
        runMultiBookReview(names);
      });
  });

  reviewBtn?.addEventListener("click", async () => {
    if (!currentBookName || currentEntries.length === 0) return;

    const reviewToken = startReviewOperation(currentBookName);
    const controller = new AbortController();
    reviewController = controller;

    try {
      reviewBtn.disabled = true;
      if (reviewCancelBtn) {
        reviewCancelBtn.disabled = false;
        reviewCancelBtn.style.display = "inline-block";
      }
      issueListEl.innerHTML = "";
      showStatus(reviewStatus, "Reviewing entries...", "loading");

      const reportRequestProgress = createRequestProgressReporter(
        reviewStatus,
        "Reviewing lorebook",
      );

      const reviewData = await reviewEntries(
        currentEntries,
        reviewInstructions.value,
        settings.reviewMaxTokens || settings.maxTokens,
        context,
        {
          profileId: settings.connectionProfileId || null,
          maxBatchChars: settings.reviewBatchBudget,
          reviewResponseLength: settings.reviewMaxTokens || settings.maxTokens,
          signal: controller.signal,
          requestDelayMs: settings.requestDelayMs,
          onRequestProgress: (progress) => {
            if (isCurrentReview(reviewToken)) reportRequestProgress(progress);
          },
          onRequestFailure: (error) =>
            isCurrentReview(reviewToken)
              ? waitForRequestContinue(
                  reviewStatus,
                  "Reviewing lorebook",
                  error,
                  controller.signal,
                )
              : false,
          onProgress: (current, total) => {
            if (!isCurrentReview(reviewToken)) return;
            showStatus(
              reviewStatus,
              `Reviewing... batch ${current} of ${total}`,
              "loading",
            );
          },
        },
      );

      if (!isCurrentReview(reviewToken)) return;
      uiState = completeUIOperation(uiState, reviewToken, {
        review: reviewData,
      });

      // Cache the (token-costly) results so Close/reopen doesn't lose them.
      sessionCache.review = reviewData;
      sessionCache.fixedIssues = new Set();
      showReview(reviewData);
      if (reviewData.cancelled) {
        showStatus(
          reviewStatus,
          `Review cancelled. Kept results from completed batches (${reviewData.issues.length} issue(s)).`,
          "success",
        );
      }
    } catch (e) {
      console.error("[LorebookManipulator] Review failed:", e);
      if (isCurrentReview(reviewToken)) {
        uiState = failUIOperation(uiState, reviewToken);
        showFriendlyError(reviewStatus, e);
      }
    } finally {
      if (activeReviewToken === reviewToken) {
        activeReviewToken = null;
        if (reviewController === controller) reviewController = null;
        resetReviewControls();
      }
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
    body.setAttribute("role", "button");
    body.tabIndex = 0;
    body.setAttribute("aria-label", `Edit ${name}`);
    body.innerHTML = `
            <div class="lm-entry-name">${escapeHtml(name)}</div>
            <div class="lm-entry-keys">${escapeHtml(keys)}</div>
            <div class="lm-entry-preview">${escapeHtml(preview)}</div>
        `;
    const openEditor = () => onEntryClick(entry);
    body.addEventListener("click", openEditor);
    body.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openEditor();
    });
    item.appendChild(body);

    if (typeof onDeleteClick === "function") {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "menu_button lm-entry-delete";
      del.title = "Delete this entry";
      del.setAttribute("aria-label", `Delete ${name}`);
      del.innerHTML = '<i class="fa-solid fa-trash"></i>';
      del.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (del.disabled) return;
        del.disabled = true;
        try {
          await onDeleteClick(entry);
        } finally {
          del.disabled = false;
        }
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
  onIgnoreClick,
  entriesByBook = null,
) {
  container.innerHTML = "";

  for (const issue of issues) {
    const issueEntries =
      issue.bookName && entriesByBook?.get(issue.bookName)
        ? entriesByBook.get(issue.bookName)
        : entries;
    const byUid = new Map(issueEntries.map((e) => [e.uid, e]));
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

    if (issue.bookName) {
      const source = document.createElement("div");
      source.className = "lm-issue-source";
      source.textContent = `Lorebook: ${issue.bookName}`;
      card.appendChild(source);
    }

    if (typeof onIgnoreClick === "function") {
      const ignoreBtn = document.createElement("button");
      ignoreBtn.type = "button";
      ignoreBtn.className = "menu_button lm-issue-ignore";
      ignoreBtn.title = "Ignore this issue in future reviews";
      ignoreBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Ignore';
      ignoreBtn.addEventListener("click", () => onIgnoreClick(issue));
      card.appendChild(ignoreBtn);
    }

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
  context = getSTContext(context);
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
  const assistantInput = container.querySelector("#lm_assistant_message");
  const assistantSendBtn = container.querySelector("#lm_assistant_send");
  const assistantHistoryEl = container.querySelector("#lm_assistant_history");
  const assistantApplyBtn = container.querySelector("#lm_assistant_apply");
  const assistantKey = `${bookName}:${entry.uid}`;
  const assistantHistory = sessionCache.loreAssistantHistory.get(assistantKey) || [];

  function renderAssistantHistory() {
    if (!assistantHistoryEl) return;
    assistantHistoryEl.innerHTML = assistantHistory
      .map((turn) => `<div class="lm-chat-history-item"><span>${turn.role === "assistant" ? "Assistant" : "You"}:</span> ${escapeHtml(turn.content)}</div>`)
      .join("");
  }
  renderAssistantHistory();

  assistantSendBtn?.addEventListener("click", async () => {
    const message = assistantInput?.value || "";
    try {
      assistantSendBtn.disabled = true;
      const reply = await chatAboutLore(
        message,
        assistantHistory,
        `Editing entry: ${entry.comment || "(untitled)"}\n${contentInput?.value || ""}`,
        settings.chatMaxTokens || settings.maxTokens,
        context,
        settings.connectionProfileId || null,
        createRequestOptions(statusEl, "Lore Assistant", settings.requestDelayMs),
      );
      assistantHistory.push({ role: "user", content: message }, { role: "assistant", content: reply });
      if (assistantHistory.length > 20) assistantHistory.splice(0, assistantHistory.length - 20);
      sessionCache.loreAssistantHistory.set(assistantKey, assistantHistory);
      if (assistantInput) assistantInput.value = "";
      renderAssistantHistory();
    } catch (e) { showFriendlyError(statusEl, e); } finally { assistantSendBtn.disabled = false; }
  });

  assistantApplyBtn?.addEventListener("click", () => {
    if (assistantHistory.length === 0) return;
    promptText += `\n\nUse this Lore Assistant conversation as additional user guidance:\n${assistantHistory.map((turn) => `${turn.role}: ${turn.content}`).join("\n")}`;
    showStatus(statusEl, "Assistant guidance will be used for the next Generate Suggestion.", "success");
  });

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
        createRequestOptions(
          statusEl,
          "Generating suggestion",
          settings.requestDelayMs,
        ),
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
  context = getSTContext(context);
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

        <div id="lm_resolve_status" class="lm-status" role="status" aria-live="polite" aria-atomic="true"></div>
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
        settings.resolveMaxTokens || settings.maxTokens,
        context,
        settings.connectionProfileId || null,
        createRequestOptions(
          statusEl,
          "Generating fix plan",
          settings.requestDelayMs,
        ),
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

      const rewrites = toApply.filter((a) => a.action === "rewrite");
      const deletes = toApply.filter((a) => a.action === "delete");
      const result = await executeChangePlans(
        [planResolveActions(bookName, toApply)],
        context,
        { backupRetention: settings.backupRetention },
      );
      if (!result.ok) {
        throw new Error(
          result.failed?.[0]?.error?.message ||
            "The approved resolution could not be verified after saving.",
        );
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

// Open a popup to create a new lorebook entry. On success, the entry list is refreshed.
export async function openCreateEntryPopup(
  bookName,
  settings,
  context,
  onRefresh,
) {
  context = getSTContext(context);
  const { Popup, POPUP_TYPE } = context;

  const popupHtml = `<div class="lm-create-entry-popup">
    <h3>Create New Entry</h3>
    <label for="lm_ce_title">Title</label>
    <input id="lm_ce_title" type="text" class="text_pole" placeholder="Entry name (e.g. 'Dragon Lore')" />

    <label for="lm_ce_keys">Primary Keys <small>(comma-separated)</small></label>
    <input id="lm_ce_keys" type="text" class="text_pole" placeholder="dragon, wyrm, fire" />

    <label for="lm_ce_secondary_keys">Secondary Keys <small>(comma-separated, optional)</small></label>
    <input id="lm_ce_secondary_keys" type="text" class="text_pole" placeholder="creature, beast" />

    <label for="lm_ce_content">Content</label>
    <textarea id="lm_ce_content" class="text_pole" rows="8" placeholder="The lore text for this entry..."></textarea>

    <label for="lm_ce_instructions">Generate from Instructions</label>
    <textarea id="lm_ce_instructions" class="text_pole textarea_compact" rows="3" placeholder="Describe the entry you want the AI to draft..."></textarea>
    <div class="lm-popup-actions">
      <button type="button" id="lm_ce_generate" class="menu_button">Generate Draft</button>
      <button type="button" id="lm_ce_impact" class="menu_button">Check Lorebook Impact</button>
    </div>
    <div id="lm_ce_status" class="lm-status" role="status" aria-live="polite" aria-atomic="true"></div>
    <div id="lm_ce_diff" class="lm-diff-container" style="display:none;"></div>
    <div id="lm_ce_impact_results" class="lm-issue-list"></div>
    <div class="lm-chat-range-section"><h4>Lore Assistant</h4><div id="lm_ce_assistant_history" class="lm-chat-history"></div><textarea id="lm_ce_assistant_message" class="text_pole textarea_compact" rows="2" placeholder="Talk through the entry idea naturally..."></textarea><div class="lm-popup-actions"><button type="button" id="lm_ce_assistant_send" class="menu_button">Send</button><button type="button" id="lm_ce_assistant_draft" class="menu_button">Create Draft from Conversation</button></div></div>
  </div>`;

  const popup = new Popup(popupHtml, POPUP_TYPE.TEXT, "", {
    wide: false,
    large: false,
    okButton: "Create",
    cancelButton: "Cancel",
    allowVerticalScrolling: true,
  });

  const popupResult = popup.show();

  const container = document.querySelector(".lm-create-entry-popup");
  if (!container) return;

  const titleInput = container.querySelector("#lm_ce_title");
  const keysInput = container.querySelector("#lm_ce_keys");
  const secondaryKeysInput = container.querySelector("#lm_ce_secondary_keys");
  const contentInput = container.querySelector("#lm_ce_content");
  const instructionsInput = container.querySelector("#lm_ce_instructions");
  const generateBtn = container.querySelector("#lm_ce_generate");
  const impactBtn = container.querySelector("#lm_ce_impact");
  const statusEl = container.querySelector("#lm_ce_status");
  const diffEl = container.querySelector("#lm_ce_diff");
  const impactEl = container.querySelector("#lm_ce_impact_results");
  const assistantMessage = container.querySelector("#lm_ce_assistant_message");
  const assistantSend = container.querySelector("#lm_ce_assistant_send");
  const assistantDraft = container.querySelector("#lm_ce_assistant_draft");
  const assistantHistoryEl = container.querySelector("#lm_ce_assistant_history");
  const assistantKey = `new:${bookName}`;
  const assistantHistory = sessionCache.loreAssistantHistory.get(assistantKey) || [];
  let previousDraft = { title: "", primaryKeys: [], secondaryKeys: [], content: "" };

  function renderCreateAssistant() {
    if (assistantHistoryEl) assistantHistoryEl.innerHTML = assistantHistory.map((turn) => `<div class="lm-chat-history-item"><span>${turn.role === "assistant" ? "Assistant" : "You"}:</span> ${escapeHtml(turn.content)}</div>`).join("");
  }
  renderCreateAssistant();

  function readDraft() {
    return {
      title: titleInput?.value || "",
      primaryKeys: parseKeywordString(keysInput?.value || ""),
      secondaryKeys: parseKeywordString(secondaryKeysInput?.value || ""),
      content: contentInput?.value || "",
    };
  }

  function showDraftDiff(nextDraft) {
    const fieldDiff = (name, before, after) =>
      `<div class="lm-field-change"><div class="lm-field-change-name">${name}</div><div class="lm-field-change-before">${escapeHtml(before || "(empty)")}</div><div class="lm-field-change-after">${escapeHtml(after || "(empty)")}</div></div>`;
    const contentDiff = renderInlineDiff(
      computeDiff(previousDraft.content, nextDraft.content),
    );
    diffEl.innerHTML = fieldDiff("Title", previousDraft.title, nextDraft.title) +
      fieldDiff("Primary Keys", previousDraft.primaryKeys.join(", "), nextDraft.primaryKeys.join(", ")) +
      fieldDiff("Secondary Keys", previousDraft.secondaryKeys.join(", "), nextDraft.secondaryKeys.join(", ")) +
      `<div class="lm-field-change"><div class="lm-field-change-name">Content</div>${contentDiff}</div>`;
    diffEl.style.display = "block";
  }

  generateBtn?.addEventListener("click", async () => {
    try {
      generateBtn.disabled = true;
      const draft = await generateEntryFromInstructions(
        instructionsInput?.value || "",
        settings.chatMaxTokens || settings.maxTokens,
        context,
        settings.connectionProfileId || null,
        createRequestOptions(statusEl, "Generating entry draft", settings.requestDelayMs),
      );
      showDraftDiff(draft);
      previousDraft = draft;
      if (titleInput) titleInput.value = draft.title;
      if (keysInput) keysInput.value = draft.primaryKeys.join(", ");
      if (secondaryKeysInput) secondaryKeysInput.value = draft.secondaryKeys.join(", ");
      if (contentInput) contentInput.value = draft.content;
      showStatus(statusEl, "Draft ready. Edit it, check impact, then Create when approved.", "success");
    } catch (e) {
      showFriendlyError(statusEl, e);
    } finally {
      generateBtn.disabled = false;
    }
  });

  assistantSend?.addEventListener("click", async () => {
    try {
      assistantSend.disabled = true;
      const message = assistantMessage?.value || "";
      const reply = await chatAboutLore(message, assistantHistory, "Creating a new lorebook entry.", settings.chatMaxTokens || settings.maxTokens, context, settings.connectionProfileId || null, createRequestOptions(statusEl, "Lore Assistant", settings.requestDelayMs));
      assistantHistory.push({ role: "user", content: message }, { role: "assistant", content: reply });
      if (assistantHistory.length > 20) assistantHistory.splice(0, assistantHistory.length - 20);
      sessionCache.loreAssistantHistory.set(assistantKey, assistantHistory);
      if (assistantMessage) assistantMessage.value = "";
      renderCreateAssistant();
    } catch (e) { showFriendlyError(statusEl, e); } finally { assistantSend.disabled = false; }
  });

  assistantDraft?.addEventListener("click", async () => {
    if (assistantHistory.length === 0) return;
    if (instructionsInput) instructionsInput.value = assistantHistory.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
    generateBtn?.click();
  });

  impactBtn?.addEventListener("click", async () => {
    try {
      impactBtn.disabled = true;
      const impact = await checkEntryImpact(
        readDraft(),
        await loadLorebook(bookName, context),
        settings.chatMaxTokens || settings.maxTokens,
        context,
        settings.connectionProfileId || null,
        createRequestOptions(statusEl, "Checking lorebook impact", settings.requestDelayMs),
      );
      impactEl.innerHTML = impact.impacts.length === 0
        ? '<p class="lm-no-backups">No likely duplicate, overlap, or contradiction found.</p>'
        : impact.impacts.map((item) => `<div class="lm-issue-card lm-issue-medium"><strong>${escapeHtml(item.type)}: ${escapeHtml(item.name)}</strong><div class="lm-issue-desc">${escapeHtml(item.description)}</div></div>`).join("");
      showStatus(statusEl, "Impact check complete. Review the results before creating.", "success");
    } catch (e) {
      showFriendlyError(statusEl, e);
    } finally {
      impactBtn.disabled = false;
    }
  });

  // Focus the title field
  setTimeout(() => titleInput?.focus(), 100);

  // Wait for the user to confirm or cancel
  const result = await popupResult;
  if (result === undefined || result === null || result === false) return;

  const title = titleInput?.value?.trim() || "";
  const keys = parseKeywordString(keysInput?.value || "");
  const secondaryKeys = parseKeywordString(secondaryKeysInput?.value || "");
  const content = contentInput?.value || "";

  if (!content.trim()) {
    toastr.warning("Content cannot be empty.");
    return;
  }

  try {
    const newUid = await createEntry(
      bookName,
      {
        comment: title,
        key: keys,
        keysecondary: secondaryKeys,
        content: content,
      },
      context,
    );

    toastr.success(`Entry created (UID ${newUid}).`);
    if (typeof onRefresh === "function") await onRefresh(bookName);
  } catch (e) {
    console.error("[LorebookManipulator] Create entry failed:", e);
    toastr.error(`Failed to create entry: ${e.message}`);
  }
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

        <div class="lm-chat-range-section">
          <h4>Lore Assistant</h4><small class="lm-field-hint">Talk through the idea in plain language. Nothing is saved until you approve it.</small>
          <div id="lm_assistant_history" class="lm-chat-history"></div>
          <textarea id="lm_assistant_message" class="text_pole textarea_compact" rows="2" placeholder="Explain what you want to improve or add..."></textarea>
          <div class="lm-popup-actions"><button type="button" id="lm_assistant_send" class="menu_button">Send</button><button type="button" id="lm_assistant_apply" class="menu_button">Apply as Suggestion Guidance</button></div>
        </div>

        <div id="lm_diff_container" class="lm-diff-container" style="display:none;"></div>

        <div id="lm_justification_container" style="display:none;"></div>

        <div id="lm_status" class="lm-status" role="status" aria-live="polite" aria-atomic="true"></div>

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
