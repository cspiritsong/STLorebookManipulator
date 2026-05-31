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
│   ├── llm.js             # LLM calls via generateRaw(): single-entry rewrite + whole-book review (batching, JSON schema parsing)
│   ├── diff.js            # Word-level diff computation, inline/side-by-side HTML rendering
│   ├── ui.js              # Popup creation, review/issue list, approve/reject handlers
│   └── utils.js           # Shared HTML escaping helpers (escapeHtml, escapeAttr)
├── prompts/
│   └── rewrite.hbs        # Handlebars template for rewrite system/user prompts
├── tests/
│   ├── backup.test.js     # Unit tests for backup create/restore/download
│   ├── diff.test.js       # Unit tests for diff accuracy and rendering
│   ├── llm.test.js        # Unit tests for rewrite response parsing
│   ├── review.test.js     # Unit tests for review batching + issue parsing
│   ├── utils.test.js      # Unit tests for HTML escaping helpers
│   └── run-tests.js       # Test runner
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
- **generateRewrite(entryContent, promptText, maxTokens, context)**: Calls `generateRaw()` with structured output for a single-entry rewrite. Returns `{ rewrittenContent, justification }`.
- **reviewEntries(entries, instructions, maxTokens, context, options)**: Whole-book review. Auto-batches entries via `batchEntries`, sends each batch to `generateRaw()` with the review JSON schema, and combines the results into one issue list. Reports progress via `options.onProgress(current, total)`. Returns `{ issues, batchCount }`.
- **batchEntries(entries, maxBatchChars=12000)**: Pure function that splits entries into batches so each batch's combined text stays under a character budget. An oversized single entry gets its own batch (never dropped). Unit-tested directly.
- **parseLLMResponse(rawText)**: Validates and returns the rewrite result.
- **parseReviewResponse(rawText)**: Validates and sanitizes the review result — drops malformed/description-less issues, coerces invalid type/severity to safe defaults, coerces string uids to numbers.
- **extractJson(rawText)** (internal): Shared JSON extraction (handles code fences, surrounding prose). Used by both parsers so the logic lives in one place.
- ST's `generateRaw` uses `responseLength` (not `max_tokens`) and, when `jsonSchema` is set, returns the extracted JSON string directly. Uses the active ST connection automatically.

### src/diff.js — Diff Computation & Rendering
- **computeDiff(oldText, newText)**: Word-level LCS-based diff. Returns array of `{ type: 'equal'|'insert'|'delete', value: string }`.
- **renderInlineDiff(diffResult)**: Single-column HTML with `<del>` (red strikethrough) and `<ins>` (green underline).
- **renderSideBySideDiff(diffResult)**: Two-column HTML, left = original with deletions marked, right = suggestion with insertions marked.
- Diff algorithm is custom and lightweight — no external dependencies. Sufficient for prose; not optimized for code.

### src/ui.js — Popup & Interaction
- **openMainPopup(settings, context)**: Standalone popup opened by the quick-access button. Shows the lorebook selector, the whole-book review panel (instruction box + Review button + issue list), and the entry list. Caches loaded entries so review results (which reference entries by uid) can be mapped back to real entry objects.
- **openRewritePopup(entry, bookName, settings, context, issue=null)**: Creates ST Popup with diff view and generate/approve/reject buttons. When `issue` is provided (from a review), it shows an issue banner and appends the issue to the rewrite instruction so the fix targets it.
- **renderEntryList(container, entries, onEntryClick)** (internal): Renders the clickable entry list.
- **renderIssueList(container, issues, entries, onFixClick)** (internal): Renders review issues as severity-colored cards with a clickable chip per affected entry. Chips for unresolvable uids are disabled.
- Approve triggers: backup → updateEntryContent → close popup. Reject simply closes the popup.

### src/utils.js — Shared Helpers
- **escapeHtml(text)**: Escapes `& < > " '` for safe insertion into HTML content. Pure string implementation (no DOM dependency) so it works in both browser and Node test environments.
- **escapeAttr(text)**: Escapes quotes for safe insertion into HTML attribute values.
- Centralizing these prevents the class of bug where a helper is used in one module but only defined in another.

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

### Whole-Book Review Flow

```
User selects lorebook → ui.js caches entries
    ↓
User (optionally) types focus instructions → clicks "Review & Recommend Fixes"
    ↓
llm.js batchEntries() splits entries to fit the context budget
    ↓
For each batch: generateRaw() with the review JSON schema (progress reported)
    ↓
llm.js parseReviewResponse() sanitizes + combines into one issue list
    ↓
ui.js renderIssueList() shows severity-colored cards with per-entry "fix" chips
    ↓
User clicks a chip → openRewritePopup(entry, ..., issue) stacked on top
    ↓
(continues into the single-entry rewrite flow above, pre-seeded with the issue)
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
| Per-entry approval workflow | Bulk apply is risky. Individual review ensures user stays in control. Bulk mode deferred. |
| Whole-book review returns an issue list, not direct rewrites | Keeps the user in control: the review surfaces problems, then each fix goes through the existing per-entry diff/approve flow. No mass changes. |
| Auto-batch by character budget | Large lorebooks exceed the model's context window. Batching by a char budget (default 12000) keeps each request safe. Tradeoff: issues spanning two batches can't be detected (see Known Unstable Areas). |

## Known Unstable Areas

- **Cross-batch review blind spot**: The whole-book review processes entries in batches. The model only sees one batch at a time, so an issue spanning two batches (e.g. duplicate entries that land in different batches) cannot be detected. Most personal lorebooks fit in a single batch, so this only affects very large books.
- **LLM fallback parsing**: When native JSON schema isn't supported by the backend, we rely on prompt engineering + regex extraction. Models that ignore instructions may still produce unparseable output. This is mitigated by clear error messages but cannot be fully eliminated.
- **localStorage size limits**: Typically 5-10MB per origin. Large lorebooks with many backups could hit this. Backup retention limit exists to mitigate, but no warning is shown yet when approaching capacity.
- **ST API stability**: Extension uses `generateRaw()`, `loadWorldInfo()`, `saveWorldInfo()` which are internal ST APIs. Future ST updates could change signatures. Pinned to minimum_client_version 1.12.0 in manifest.
