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
│   ├── llm.js             # LLM calls: single-entry rewrite, whole-book review (batching), multi-entry resolve; JSON schema parsing
│   ├── diff.js            # Word-level diff computation, inline/side-by-side HTML rendering
│   ├── ui.js              # Popup creation, entry editor, review/issue list, resolve flow, handlers
│   ├── errors.js          # Maps raw errors to newbie-friendly title/what/fix guidance
│   └── utils.js           # Shared HTML escaping helpers (escapeHtml, escapeAttr)
├── tests/
│   ├── backup.test.js     # Unit tests for backup create/restore/download
│   ├── diff.test.js       # Unit tests for diff accuracy and rendering
│   ├── llm.test.js        # Unit tests for rewrite parsing + response normalization
│   ├── review.test.js     # Unit tests for review batching, parsing, resilience
│   ├── resolve.test.js    # Unit tests for multi-entry resolution parsing
│   ├── lorebook.test.js   # Unit tests for field editing, deletion, sanitization
│   ├── errors.test.js     # Unit tests for friendly error mapping
│   ├── utils.test.js      # Unit tests for HTML escaping helpers
│   ├── syntax.test.js     # node --check on every shipped JS file
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
- **sanitizeEntryFields(fields)**: Validates/normalizes an incoming field set. Keeps only the four editable fields (`content`, `key`, `keysecondary`, `comment`), enforces types, trims/drops empty keywords. Throws on type errors so bad input fails loudly. Unit-tested.
- **parseKeywordString(str)**: UI helper — splits a comma-separated keyword string into a clean array.
- **updateEntryFields(bookName, uid, fields, context)**: Loads book, writes only the sanitized editable fields of the matching entry, saves, reloads editor. All other (structural) fields are preserved.
- **updateEntryContent(bookName, uid, newContent, context)**: Backward-compatible thin wrapper over `updateEntryFields` that updates only `content`.
- **deleteEntry(bookName, uid, context)**: Permanently removes an entry. Caller (the UI) creates a backup first so the deletion is recoverable.
- `EDITABLE_FIELDS` constant is the single source of truth for what this extension may write; everything else stays untouched.
- All functions are async and handle errors with visible toast notifications.

### src/llm.js — LLM Interaction
- **generateRewrite(entryContent, promptText, maxTokens, context, profileId=null)**: Single-entry rewrite with structured output. Returns `{ rewrittenContent, justification }`.
- **reviewEntries(entries, instructions, maxTokens, context, options)**: Whole-book review. Auto-batches entries via `batchEntries`, sends each batch with the review JSON schema, and combines results into one issue list. Retries an unreadable batch once with a strict format reminder, then skips it (non-fatal). Reports progress via `options.onProgress(current, total)`. `options.profileId` selects a connection profile. Returns `{ issues, batchCount, skippedBatches }`; throws only if every batch is unreadable.
- **resolveIssue(issue, affectedEntries, maxTokens, context, profileId=null)**: Generates a cross-entry resolution plan for one multi-entry issue. Returns `{ summary, actions: [{ uid, action: 'keep'|'rewrite'|'delete', newContent, reason }] }` via `RESOLVE_SCHEMA`.
- **callLLM({ systemPrompt, prompt, responseLength, jsonSchema, profileId }, context)** (internal): The request router. When `profileId` is set, sends through `ConnectionManagerRequestService.sendRequest()` (json_schema passed as an override payload); otherwise uses `generateRaw()` on the active connection. Returns a normalized string.
- **normalizeLLMContent(result)**: Collapses every response shape into a single JSON string. `generateRaw` returns a string; `ConnectionManagerRequestService` returns `ExtractedData` whose `.content` is a string normally but an already-*parsed object* when json_schema is used. This helper re-stringifies parsed objects so the parsers below work identically across backends. Unit-tested.
- **batchEntries(entries, maxBatchChars=12000)**: Pure function that splits entries into batches so each batch's combined text stays under a character budget. An oversized single entry gets its own batch (never dropped). Unit-tested directly.
- **parseLLMResponse(rawText)**: Validates and returns the rewrite result.
- **parseReviewResponse(rawText)**: Forgiving review parser — accepts `{issues:[...]}`, a bare array, a differently-named array property, or an empty `{}` (= no issues). Drops malformed/description-less issues, coerces invalid type/severity to safe defaults, coerces string uids to numbers.
- **parseResolveResponse(rawText, affectedEntries)**: Forgiving resolution parser — finds the actions array, coerces uids/actions, downgrades an empty rewrite to "keep", and drops actions targeting uids outside the issue. Throws if no usable actions remain.
- **extractJson(rawText)** (internal): Shared JSON extraction (handles code fences, surrounding prose, and a bare top-level object **or** array). Used by all parsers so the logic lives in one place.
- ST's `generateRaw` uses `responseLength` (not `max_tokens`) and, when `jsonSchema` is set, returns the extracted JSON string directly.

### src/diff.js — Diff Computation & Rendering
- **computeDiff(oldText, newText)**: Word-level LCS-based diff. Returns array of `{ type: 'equal'|'insert'|'delete', value: string }`.
- **renderInlineDiff(diffResult)**: Single-column HTML with `<del>` (red strikethrough) and `<ins>` (green underline).
- **renderSideBySideDiff(diffResult)**: Two-column HTML, left = original with deletions marked, right = suggestion with insertions marked.
- Diff algorithm is custom and lightweight — no external dependencies. Sufficient for prose; not optimized for code.

### src/ui.js — Popup & Interaction
- **openMainPopup(settings, context)**: Standalone popup opened by the quick-access button. Shows the lorebook selector, the whole-book review panel (instruction box + Review button + issue list), and the entry list. Caches loaded entries so review results (which reference entries by uid) can be mapped back to real entry objects. Holds `loadAndRender` (refreshes the list, e.g. after a delete) and `handleDeleteEntry` (confirm → backup → delete → refresh).
- **openRewritePopup(entry, bookName, settings, context, issue=null, onClose=null, onSuccess=null)**: The entry editor popup. Editable inputs for title, primary keys, secondary keys, and an always-visible **content textarea** (shows the current content). Optional **Generate Suggestion** rewrites the content: it diffs against the current box text, shows the highlighted diff, and drops the suggestion into the box for further tweaking. **Save** writes all four editable fields (content read straight from the box), backs up first, then calls `updateEntryFields`, and fires `onSuccess` (used to mark a review issue FIXED). Stacks on top of the main popup; `onClose` runs whenever the popup is dismissed. When opened from a review `issue`, shows an issue banner, appends the issue to the rewrite instruction, and labels the dismiss button "← Back to issues". Errors surface via `showFriendlyError`.
- **renderEntryList(container, entries, onEntryClick, onDeleteClick)** (internal): Renders each entry with a clickable body (opens editor) and a trash button (delete). The trash click stops propagation so it doesn't also open the editor.
- **renderIssueList(container, issues, entries, fixedIssues, onFixClick, onResolveClick)** (internal): Renders review issues as severity-colored cards. A single-entry issue shows a per-entry chip (→ `onFixClick`, opens the editor). A multi-entry issue shows one "Resolve N entries together" button (→ `onResolveClick`). Issues in the `fixedIssues` Set get a **FIXED!** badge and are dimmed. Chips for unresolvable uids are disabled.
- **openResolvePopup(issue, affectedEntries, bookName, settings, context, onSuccess=null)**: The cross-entry resolution popup. **Generate Fix Plan** calls `resolveIssue` on demand; the plan renders one row per action (keep/rewrite/delete) with a checkbox, a content diff for rewrites, and a warning for deletes. **Apply Selected** takes one backup, then applies only the ticked rewrites (`updateEntryFields`) and deletes (`deleteEntry`), and fires `onSuccess` to mark the issue FIXED. Stacks on top; dismiss button reads "← Back to issues".
- Fixed-tracking lives in `sessionCache.fixedIssues` (a Set of issue objects, by identity), so the FIXED badge survives Close/reopen and resets on a new review or book change.
- **renderResolvePlan(container, plan, byUid, settings)** (internal): Renders the action rows; rewrite/delete are ticked by default, keep is shown disabled.
- Save triggers: backup → updateEntryFields → close popup. Delete triggers: confirm → backup → deleteEntry → refresh list. Resolve triggers: generate plan → user toggles actions → backup → apply checked. Cancel simply closes.

### src/utils.js — Shared Helpers
- **escapeHtml(text)**: Escapes `& < > " '` for safe insertion into HTML content. Pure string implementation (no DOM dependency) so it works in both browser and Node test environments.
- **escapeAttr(text)**: Escapes quotes for safe insertion into HTML attribute values.
- Centralizing these prevents the class of bug where a helper is used in one module but only defined in another.

### src/errors.js — Friendly Error Guidance
- **explainError(error)**: Pure function. Pattern-matches an error message (case-insensitive substrings) against an ordered rule list and returns `{ title, what, fix }` — a short label, a plain explanation, and a concrete fix step. Unknown errors get generic guidance plus the original `raw` message. First matching rule wins, so specific patterns are listed before general ones.
- **renderFriendlyError(error, escapeHtml)**: Renders the explanation as an HTML block. `escapeHtml` is injected so the module stays DOM-free and testable.
- Used by `ui.js` (`showFriendlyError`) wherever an operation can fail: review, generate, save, delete, and lorebook load.

## Data Flow

```
User selects lorebook
    ↓
lorebook.js loads entries via ST API
    ↓
User clicks entry → ui.js opens editor popup
    ↓
User edits title / keys / secondary keys directly (optional)
    ↓
User clicks Generate → llm.js rewrites content with JSON schema (optional)
    ↓
diff.js computes word diff → ui.js renders highlighted diff
    ↓
User clicks Save
    ↓
backup.js creates backup → lorebook.js updateEntryFields (only editable fields) → ST editor reloads

Delete path:
User clicks trash icon → confirm dialog → backup.js creates backup
    → lorebook.js deleteEntry → list refreshes
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
    maxTokens: 1024,               // max LLM response tokens (rewrite & review)
    reviewBatchBudget: 12000,      // char budget per batch for whole-book review
    connectionProfileId: ''        // '' = active connection; else a Connection Manager profile id
}
```

Loaded on init, saved via `saveSettingsDebounced()` on every change.

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Vanilla JS, no build step | ST extensions load as ES modules directly. Build tools add complexity with no benefit for this scope. |
| JSON Schema over XML | Native structured output support on modern APIs eliminates parsing failures. XML prefill trick is fragile. |
| Editable fields limited to content/key/keysecondary/comment | These are the fields a human actually tidies. Structural fields (position, order, probability, insertion logic) are left untouched so edits can't break activation behaviour. Enforced centrally via `EDITABLE_FIELDS` + `sanitizeEntryFields`. |
| LLM only suggests content, not keys/title | Keeping the model's output to prose (content) keeps structured output simple and low-risk. Keys/title are edited by hand in the popup, where the user has full control. |
| Delete requires confirm + backup | Deletion is destructive. A confirmation dialog plus an automatic pre-delete backup makes every delete recoverable from Backup History. |
| Custom diff over library | Prose diffs don't need Myers/O(NP). A simple word-level LCS is <100 lines and zero dependencies. |
| localStorage for backups | Immediate, synchronous, no server round-trip. File download as secondary safety net. |
| Per-entry approval workflow | Bulk apply is risky. Individual review ensures user stays in control. Bulk mode deferred. |
| Whole-book review returns an issue list, not direct rewrites | Keeps the user in control: the review surfaces problems, then each fix goes through the existing per-entry diff/approve flow. No mass changes. |
| Auto-batch by character budget | Large lorebooks exceed the model's context window. Batching by a char budget (default 12000) keeps each request safe. Tradeoff: issues spanning two batches can't be detected (see Known Unstable Areas). |
| Connection profile routing via `callLLM` | Lets the user run lorebook work on a different model than their chat (e.g. cheaper/faster). Default ('') keeps the original `generateRaw` behavior so nothing breaks when Connection Manager is absent. `normalizeLLMContent` hides the response-shape difference between the two paths so parsers/tests stay unchanged. |

## Known Unstable Areas

- **Cross-batch review blind spot**: The whole-book review processes entries in batches. The model only sees one batch at a time, so an issue spanning two batches (e.g. duplicate entries that land in different batches) cannot be detected. Most personal lorebooks fit in a single batch, so this only affects very large books.
- **LLM fallback parsing**: When native JSON schema isn't supported by the backend, we rely on prompt engineering + regex extraction. Models that ignore instructions may still produce unparseable output. This is mitigated by clear error messages but cannot be fully eliminated.
- **localStorage size limits**: Typically 5-10MB per origin. Large lorebooks with many backups could hit this. Backup retention limit exists to mitigate, but no warning is shown yet when approaching capacity.
- **ST API stability**: Extension uses `generateRaw()`, `loadWorldInfo()`, `saveWorldInfo()` which are internal ST APIs. Future ST updates could change signatures. Pinned to minimum_client_version 1.12.0 in manifest.
