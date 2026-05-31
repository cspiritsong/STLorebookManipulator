# Architecture

## Overview

STLorebookManipulator is a SillyTavern browser-side extension. It runs entirely in the user's browser, making LLM calls through SillyTavern's active API connection. No external server or build step is required.

## File Structure

```
STLorebookManipulator/
├── manifest.json          # SillyTavern extension metadata and entry point config
├── index.js               # Entry point: initializes UI, wires events, loads settings
├── style.css              # Diff highlighting, popup layout, inline-drawer styling
├── settings.html          # Handlebars template for the settings panel
├── src/
│   ├── backup.js          # Backup history management, restore, file download
│   ├── lorebook.js        # Load/save/reload lorebook data via ST World Info API
│   ├── llm.js             # LLM calls via generateRaw(), JSON schema + fallback parsing
│   ├── diff.js            # Word-level diff computation, inline/side-by-side HTML rendering
│   └── ui.js              # Popup creation, approve/reject handlers, progress indicators
├── prompts/
│   └── rewrite.hbs        # Handlebars template for rewrite system/user prompts
├── tests/
│   ├── backup.test.js     # Unit tests for backup create/restore/download
│   ├── diff.test.js       # Unit tests for diff accuracy and rendering
│   └── llm.test.js        # Unit tests for LLM response parsing (mocked)
├── LICENSE
├── README.md
├── ARCHITECTURE.md         # This file
├── CHANGELOG.md
├── KNOWN-ISSUES.md
├── CONTRIBUTING.md
└── .gitignore
```

## Module Responsibilities

### index.js — Entry Point
- Runs on jQuery ready
- Renders settings panel via `renderExtensionTemplateAsync`
- Loads persisted settings from `extensionSettings`
- Wires event listeners for UI interactions
- Exposes no global functions (self-contained ES module)

### src/backup.js — Backup History
- **createBackup(bookName, bookData)**: Deep-clones lorebook data, stores in localStorage with timestamp. Enforces retention limit.
- **getBackupHistory(bookName)**: Returns array of backup entries sorted newest-first.
- **restoreBackup(bookName, timestamp)**: Retrieves backup by timestamp, saves via `saveWorldInfo()`, reloads editor.
- **downloadBackup(bookName, timestamp)**: Triggers browser file download of backup as `.json`.
- Storage key format: `lorebook_manipulator_backups_<bookName>`

### src/lorebook.js — Lorebook Data Access
- **getLorebookNames()**: Wraps `getWorldInfoNames()` to list available books.
- **loadLorebook(name)**: Wraps `loadWorldInfo(name)`, returns normalized entry array.
- **updateEntryContent(bookName, uid, newContent)**: Loads book, updates only `content` field of matching entry, saves, reloads editor. Never touches other fields.
- All functions are async and handle errors with visible toast notifications.

### src/llm.js — LLM Interaction
- **generateRewrite(entryContent, promptText, maxTokens)**: Calls `generateRaw()` with structured output.
  - Primary: JSON schema `{ rewrittenContent: string, justification: string }` via native mode.
  - Fallback: Prompt engineering asking for JSON in code block, parsed manually.
- **parseLLMResponse(rawText)**: Extracts JSON from response (handles code fences, surrounding text). Validates against expected shape. Throws descriptive error on failure.
- Uses active ST connection profile automatically — no separate API config needed.

### src/diff.js — Diff Computation & Rendering
- **computeDiff(oldText, newText)**: Word-level LCS-based diff. Returns array of `{ type: 'equal'|'insert'|'delete', value: string }`.
- **renderInlineDiff(diffResult)**: Single-column HTML with `<del>` (red strikethrough) and `<ins>` (green underline).
- **renderSideBySideDiff(diffResult)**: Two-column HTML, left = original with deletions marked, right = suggestion with insertions marked.
- Diff algorithm is custom and lightweight — no external dependencies. Sufficient for prose; not optimized for code.

### src/ui.js — Popup & Interaction
- **openRewritePopup(entry, settings)**: Creates ST Popup with diff view, preset selector, generate/approve/reject buttons.
- **showProgress(message)**: Displays loading state during LLM call.
- **showError(message)**: Displays error toast with actionable guidance.
- Approve triggers: backup → updateEntryContent → close popup → refresh entry list.
- Reject simply closes the popup.

### prompts/rewrite.hbs — Prompt Templates
- Handlebars template with variables: `{{entryContent}}`, `{{customInstructions}}`
- Three built-in presets injected as `customInstructions`:
  - **Prune**: "Shorten this entry for brevity while preserving all factual content. Remove redundancy."
  - **Clarify**: "Improve clarity and readability without changing length or removing information."
  - **Fix Grammar**: "Correct grammar, spelling, and punctuation. Do not change meaning or structure."
- Custom override replaces `customInstructions` entirely.

## Data Flow

```
User selects lorebook
    ↓
lorebook.js loads entries via ST API
    ↓
User clicks entry → ui.js opens popup
    ↓
User picks preset / custom prompt
    ↓
User clicks Generate → llm.js calls generateRaw() with JSON schema
    ↓
llm.js parses response → returns { rewrittenContent, justification }
    ↓
diff.js computes word diff between original and suggestion
    ↓
ui.js renders highlighted diff in popup
    ↓
User clicks Approve
    ↓
backup.js creates backup → lorebook.js updates content field → ST editor reloads
```

## Settings Persistence

Settings stored in `SillyTavern.getContext().extensionSettings['lorebook_manipulator']`:

```javascript
{
    diffStyle: 'inline',           // 'inline' | 'side-by-side'
    backupRetention: 5,            // number of backups to keep per lorebook
    promptPreset: 'prune',         // 'prune' | 'clarify' | 'grammar' | 'custom'
    customPrompt: '',              // user-defined prompt text
    maxTokens: 1024                // max LLM response tokens
}
```

Loaded on init, saved via `saveSettingsDebounced()` on every change.

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Vanilla JS, no build step | ST extensions load as ES modules directly. Build tools add complexity with no benefit for this scope. |
| JSON Schema over XML | Native structured output support on modern APIs eliminates parsing failures. XML prefill trick is fragile. |
| Only modify `content` field | Keys, triggers, and metadata are structural. Changing them risks breaking activation logic. Content-only is safest for v0.1. |
| Custom diff over library | Prose diffs don't need Myers/O(NP). A simple word-level LCS is <100 lines and zero dependencies. |
| localStorage for backups | Immediate, synchronous, no server round-trip. File download as secondary safety net. |
| Per-entry approval workflow | Bulk apply is risky. Individual review ensures user stays in control. Bulk mode deferred to v0.2. |

## Known Unstable Areas

- **LLM fallback parsing**: When native JSON schema isn't supported by the backend, we rely on prompt engineering + regex extraction. Models that ignore instructions may still produce unparseable output. This is mitigated by clear error messages but cannot be fully eliminated.
- **localStorage size limits**: Typically 5-10MB per origin. Large lorebooks with many backups could hit this. Backup retention limit exists to mitigate, but no warning is shown yet when approaching capacity.
- **ST API stability**: Extension uses `generateRaw()`, `loadWorldInfo()`, `saveWorldInfo()` which are internal ST APIs. Future ST updates could change signatures. Pinned to minimum_client_version 1.12.0 in manifest.
