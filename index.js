import { getLorebookNames, loadLorebook } from "./src/lorebook.js";
import {
  getBackupHistory,
  restoreBackup,
  downloadBackup,
  getBackupStorageUsage,
  clearAllBackups,
} from "./src/backup.js";
import {
  openRewritePopup,
  openMainPopup,
  getPromptText,
  filterEntries,
} from "./src/ui.js";
import { escapeHtml, escapeAttr } from "./src/utils.js";

const MODULE_NAME = "lorebook_manipulator";

const DEFAULT_SETTINGS = Object.freeze({
  diffStyle: "inline",
  backupRetention: 5,
  promptPreset: "prune",
  customPrompt: "",
  maxTokens: 1024,
  reviewBatchBudget: 12000,
  connectionProfileId: "",
  requestDelayMs: 5000,
});

let currentBookName = null;
let currentEntries = [];
let slashCommandRegistered = false;

jQuery(async () => {
  const context = SillyTavern.getContext();

  const settingsHtml = await context.renderExtensionTemplateAsync(
    "third-party/STLorebookManipulator",
    "settings",
  );
  $("#extensions_settings2").append(settingsHtml);

  initSettings(context);
  await populateLorebookSelector(context);
  populateConnectionProfiles(context);

  $("#lm_lorebook_select").on("change", async function () {
    currentBookName = $(this).val();
    if (currentBookName) {
      await loadAndDisplayEntries(currentBookName, context);
      renderBackupHistory(currentBookName, context);
    } else {
      $("#lm_entry_list_container").hide();
      currentEntries = [];
    }
  });

  $("#lm_entry_search").on("input", function () {
    if (currentEntries.length > 0) {
      renderEntryList(context);
    }
  });

  $("#lm_connection_profile").on("change", function () {
    getSettings(context).connectionProfileId = $(this).val();
    context.saveSettingsDebounced();
  });

  $("#lm_diff_style").on("change", function () {
    getSettings(context).diffStyle = $(this).val();
    context.saveSettingsDebounced();
  });

  $("#lm_backup_retention").on("change", function () {
    const val = parseInt($(this).val(), 10);
    getSettings(context).backupRetention = Math.max(1, Math.min(50, val || 5));
    context.saveSettingsDebounced();
  });

  $("#lm_prompt_preset").on("change", function () {
    const preset = $(this).val();
    getSettings(context).promptPreset = preset;
    context.saveSettingsDebounced();
    toggleCustomPrompt(preset);
  });

  $("#lm_custom_prompt").on("input", function () {
    getSettings(context).customPrompt = $(this).val();
    context.saveSettingsDebounced();
  });

  $("#lm_max_tokens").on("change", function () {
    const val = parseInt($(this).val(), 10);
    getSettings(context).maxTokens = Math.max(256, Math.min(8192, val || 1024));
    context.saveSettingsDebounced();
  });

  $("#lm_review_batch_budget").on("change", function () {
    const val = parseInt($(this).val(), 10);
    getSettings(context).reviewBatchBudget = Math.max(
      2000,
      Math.min(100000, val || 12000),
    );
    context.saveSettingsDebounced();
  });

  $("#lm_request_delay").on("change", function () {
    const seconds = Number($(this).val());
    getSettings(context).requestDelayMs = Math.round(
      Math.max(1, Math.min(30, Number.isFinite(seconds) ? seconds : 5)) * 1000,
    );
    $(this).val(getSettings(context).requestDelayMs / 1000);
    context.saveSettingsDebounced();
  });

  registerChatRangeSlashCommand(context);
  observeForQuickAccessButtons();
});

function registerChatRangeSlashCommand(context) {
  if (slashCommandRegistered) return;
  const {
    SlashCommandParser,
    SlashCommand,
    SlashCommandArgument,
    ARGUMENT_TYPE,
  } = context;
  if (
    !SlashCommandParser ||
    !SlashCommand ||
    !SlashCommandArgument ||
    !ARGUMENT_TYPE
  ) {
    console.warn("[LorebookManipulator] Slash-command API is unavailable.");
    return;
  }

  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: "lm-chat",
      helpString:
        "Open Lorebook Manipulator with a chat range prefilled. Usage: /lm-chat <start> <end> [instructions]",
      splitUnnamedArgument: true,
      splitUnnamedArgumentCount: 2,
      unnamedArgumentList: [
        SlashCommandArgument.fromProps({
          description: "0-based starting message index",
          typeList: [ARGUMENT_TYPE.NUMBER],
          isRequired: true,
        }),
        SlashCommandArgument.fromProps({
          description: "0-based ending message index (inclusive)",
          typeList: [ARGUMENT_TYPE.NUMBER],
          isRequired: true,
        }),
        SlashCommandArgument.fromProps({
          description: "Optional instruction for the entry draft",
          typeList: [ARGUMENT_TYPE.STRING],
          isRequired: false,
        }),
      ],
      callback: async (_args, [startText, endText, instructions = ""]) => {
        const start = Number(startText);
        const end = Number(endText);
        const chatLength = Array.isArray(context.chat)
          ? context.chat.length
          : 0;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end < start ||
          end >= chatLength
        ) {
          return `Invalid chat range. Choose inclusive indexes from 0 to ${Math.max(0, chatLength - 1)}.`;
        }
        openMainPopup(getSettings(context), context, {
          start,
          end,
          instructions,
        });
        return `Opened Lorebook Manipulator with messages #${start} through #${end} selected.`;
      },
    }),
  );
  slashCommandRegistered = true;
}

function getSettings(context) {
  if (!context.extensionSettings[MODULE_NAME]) {
    context.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
  }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!Object.hasOwn(context.extensionSettings[MODULE_NAME], key)) {
      context.extensionSettings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
    }
  }
  return context.extensionSettings[MODULE_NAME];
}

function initSettings(context) {
  const settings = getSettings(context);

  $("#lm_diff_style").val(settings.diffStyle);
  $("#lm_backup_retention").val(settings.backupRetention);
  $("#lm_prompt_preset").val(settings.promptPreset);
  $("#lm_custom_prompt").val(settings.customPrompt);
  $("#lm_max_tokens").val(settings.maxTokens);
  $("#lm_review_batch_budget").val(settings.reviewBatchBudget);
  $("#lm_request_delay").val(settings.requestDelayMs / 1000);

  toggleCustomPrompt(settings.promptPreset);
}

// Populate the connection profile dropdown from SillyTavern's Connection
// Manager. The first option ("Active connection") is always present and means
// "use whatever API the chat is currently using" (settings.connectionProfileId
// === ''). If the Connection Manager extension is unavailable, the dropdown is
// left with just that default so the extension still works.
function populateConnectionProfiles(context) {
  const select = $("#lm_connection_profile");
  const settings = getSettings(context);

  const service = context.ConnectionManagerRequestService;
  if (!service || typeof service.getSupportedProfiles !== "function") {
    // Connection Manager not available — keep just the "Active connection" default.
    select.val("");
    return;
  }

  let profiles = [];
  try {
    profiles = service.getSupportedProfiles() || [];
  } catch (e) {
    console.warn(
      "[LorebookManipulator] Could not list connection profiles:",
      e,
    );
    select.val("");
    return;
  }

  // Rebuild options: keep the default, then one per supported profile.
  select.find("option:not(:first)").remove();
  for (const profile of profiles) {
    select.append(
      `<option value="${escapeAttr(profile.id)}">${escapeHtml(profile.name || profile.id)}</option>`,
    );
  }

  // Restore the saved selection if it still exists; otherwise fall back to default.
  const saved = settings.connectionProfileId || "";
  const stillExists = saved === "" || profiles.some((p) => p.id === saved);
  if (!stillExists) {
    settings.connectionProfileId = "";
    context.saveSettingsDebounced();
  }
  select.val(settings.connectionProfileId || "");
}

function toggleCustomPrompt(preset) {
  if (preset === "custom") {
    $("#lm_custom_prompt_container").show();
  } else {
    $("#lm_custom_prompt_container").hide();
  }
}

async function populateLorebookSelector(context) {
  const names = getLorebookNames(context);
  const select = $("#lm_lorebook_select");
  select
    .empty()
    .append(
      '<option value="" disabled selected>-- Choose a lorebook --</option>',
    );

  for (const name of names) {
    select.append(
      `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`,
    );
  }
}

async function loadAndDisplayEntries(bookName, context) {
  try {
    currentEntries = await loadLorebook(bookName, context);
    renderEntryList(context);
    $("#lm_entry_list_container").show();
  } catch (e) {
    console.error("[LorebookManipulator] Failed to load entries:", e);
    toastr.error(`Failed to load lorebook: ${e.message}`);
    $("#lm_entry_list_container").hide();
  }
}

function renderEntryList(context) {
  const container = $("#lm_entry_list");
  container.empty();

  const searchInput = document.getElementById("lm_entry_search");
  const searchText = searchInput ? searchInput.value : "";
  const filteredEntries = filterEntries(currentEntries, searchText);

  if (filteredEntries.length === 0) {
    container.html(
      currentEntries.length === 0
        ? '<p class="lm-no-backups">No entries in this lorebook.</p>'
        : '<p class="lm-no-backups">No entries match your search.</p>',
    );
    return;
  }

  const sortedEntries = [...filteredEntries].sort(
    (a, b) => (b.order ?? 0) - (a.order ?? 0),
  );

  for (const entry of sortedEntries) {
    const name = entry.comment || `Entry #${entry.uid}`;
    const keys = (entry.key || []).join(", ") || "(no keys)";
    const preview =
      (entry.content || "").substring(0, 80) +
      ((entry.content || "").length > 80 ? "..." : "");
    const disabledClass = entry.disable ? " disabled" : "";

    const item = $(`
            <div class="lm-entry-item${disabledClass}" data-uid="${entry.uid}">
                <div class="lm-entry-name">${escapeHtml(name)}</div>
                <div class="lm-entry-keys">${escapeHtml(keys)}</div>
                <div class="lm-entry-preview">${escapeHtml(preview)}</div>
            </div>
        `);

    item.on("click", () => {
      const settings = getSettings(context);
      openRewritePopup(entry, currentBookName, settings, context);
    });

    container.append(item);
  }
}

function renderBackupHistory(bookName, context) {
  const container = $("#lm_backup_history");
  const history = getBackupHistory(bookName);

  if (history.length === 0) {
    container.html('<p class="lm-no-backups">No backups yet.</p>');
    return;
  }

  container.empty();

  for (const backup of history) {
    const date = new Date(backup.timestamp).toLocaleString();
    const item = $(`
            <div class="lm-backup-item">
                <span class="lm-backup-date">${escapeHtml(date)}</span>
                <div class="lm-backup-actions">
                    <button class="menu_button lm-restore-btn" title="Restore this backup">Restore</button>
                    <button class="menu_button lm-download-btn" title="Download as file">Download</button>
                </div>
            </div>
        `);

    item.find(".lm-restore-btn").on("click", async () => {
      try {
        const confirmed = await context.Popup.show.confirm(
          "Restore Backup",
          `Restore lorebook "${bookName}" to the state from ${date}? This will overwrite current data.`,
        );
        if (!confirmed) return;

        restoreBackup(
          bookName,
          backup.timestamp,
          (name, data) => context.saveWorldInfo(name, data),
          () => context.reloadWorldInfoEditor?.(),
        );

        toastr.success("Backup restored successfully.");
        await loadAndDisplayEntries(bookName, context);
        renderBackupHistory(bookName, context);
      } catch (e) {
        console.error("[LorebookManipulator] Restore failed:", e);
        toastr.error(`Restore failed: ${e.message}`);
      }
    });

    item.find(".lm-download-btn").on("click", () => {
      try {
        const filename = downloadBackup(bookName, backup.timestamp);
        toastr.success(`Downloaded: ${filename}`);
      } catch (e) {
        console.error("[LorebookManipulator] Download failed:", e);
        toastr.error(`Download failed: ${e.message}`);
      }
    });

    container.append(item);
  }

  // Storage usage indicator
  const usage = getBackupStorageUsage();
  const statusClass = usage.isCritical
    ? "lm-storage-critical"
    : usage.isWarning
      ? "lm-storage-warning"
      : "lm-storage-ok";
  const statusIcon = usage.isCritical ? "⚠️" : usage.isWarning ? "⚠️" : "💾";
  const storageHtml = `<div class="lm-storage-indicator ${statusClass}">
        <span class="lm-storage-label">${statusIcon} Storage:</span>
        <span class="lm-storage-usage">${usage.formatted} used</span>
        <span class="lm-storage-percent">(${usage.percentage}%)</span>
        ${usage.isCritical ? '<span class="lm-storage-alert">— clear old backups!</span>' : ""}
    </div>`;
  container.append(storageHtml);

  // Clear all backups button
  const clearBtn =
    $(`<button type="button" class="menu_button lm-clear-all-btn" style="margin-top: 10px;">
        <i class="fa-solid fa-trash"></i> Clear All Backups
    </button>`);
  clearBtn.on("click", async () => {
    try {
      const confirmed = await context.Popup.show.confirm(
        "Clear All Backups",
        `Permanently delete ALL ${history.length} backups for "${bookName}"? This cannot be undone.`,
      );
      if (!confirmed) return;

      clearAllBackups(bookName);
      toastr.success(`All backups for "${bookName}" cleared.`);
      renderBackupHistory(bookName, context);
    } catch (e) {
      console.error("[LorebookManipulator] Clear backups failed:", e);
      toastr.error(`Failed to clear backups: ${e.message}`);
    }
  });
  container.append(clearBtn);
}

function injectQuickAccessButtons() {
  const selectors = [
    ".form_create_bottom_buttons_block",
    "#GroupFavDelOkBack",
    "#rm_buttons_container",
    "#form_character_search_form",
  ];

  selectors.forEach((selector) => {
    const target = document.querySelector(selector);
    if (!target) return;
    if (target.querySelector(".lm-quick-access-icon")) return;

    const icon = document.createElement("div");
    icon.className =
      "menu_button fa-solid fa-book-open interactable lm-quick-access-icon";
    icon.title = "Lorebook Manipulator";

    icon.addEventListener("click", () => {
      const context = SillyTavern.getContext();
      const settings = getSettings(context);
      populateConnectionProfiles(context);
      openMainPopup(settings, context);
    });

    target.prepend(icon);
  });
}

function observeForQuickAccessButtons() {
  injectQuickAccessButtons();

  const observer = new MutationObserver(() => {
    injectQuickAccessButtons();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  const context = SillyTavern.getContext();
  if (context?.eventSource && context?.eventTypes) {
    const events = [
      context.eventTypes.CHAT_CHANGED,
      context.eventTypes.CHARACTER_SELECTED,
      context.eventTypes.GROUP_SELECTED,
      context.eventTypes.APP_READY,
    ];
    events.forEach((evt) => {
      if (evt)
        context.eventSource.on(evt, () =>
          setTimeout(injectQuickAccessButtons, 200),
        );
    });
  }
}
