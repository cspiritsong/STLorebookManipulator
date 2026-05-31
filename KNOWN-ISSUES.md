# Known Issues

## Current Issues

### Connection Profile Dropdown Is Populated Once at Load
- **What**: The Connection Profile dropdown is filled when the extension initializes. Profiles created/renamed/deleted in the Connection Manager *after* that are not reflected until SillyTavern is reloaded.
- **Impact**: Minor. A newly created profile won't appear in the dropdown until reload. If a selected profile is deleted, the next request through it errors with a clear message and the setting falls back to "Active connection" on the following load.
- **Workaround**: Reload the page after changing your connection profiles.
- **Fix planned**: A future release could subscribe to `CONNECTION_PROFILE_CREATED/UPDATED/DELETED` events (or use `ConnectionManagerRequestService.handleDropdown`) to keep the list live.

### Whole-Book Review Cannot Detect Cross-Batch Issues
- **What**: Large lorebooks are split into batches so each request fits the model's context window. The model only sees one batch at a time, so an issue spanning two batches (e.g. duplicate entries that land in different batches) will not be detected.
- **Impact**: On very large books, some duplicates/overlaps may be missed. Most personal lorebooks fit in a single batch and are unaffected.
- **Workaround**: Increase Max Tokens, or review subsets of the book. For now the batch budget (12000 chars) is generous enough that most books are one batch.
- **Fix planned**: A future "second pass" could re-check flagged candidates across batches, or send entry summaries first.

### LLM Fallback Parsing May Fail on Non-Compliant Models
- **What**: When the active API backend doesn't support native JSON schema, the extension falls back to prompt engineering asking for JSON in a code block. Some models (especially small local models or RP fine-tunes) may ignore this and return prose or malformed output.
- **Impact**: "Invalid response" error displayed to user. No data is lost or modified.
- **Workaround**: Use a model/API that supports structured output (OpenAI, Claude, Gemini). Or increase max tokens — truncated JSON is a common failure mode.
- **Fix planned**: A future release will add retry logic with progressively stricter prompts.

### localStorage Size Limits Not Monitored
- **What**: Backups are stored in localStorage, which typically has a 5-10MB limit per origin. Large lorebooks with many backup entries could approach this limit silently.
- **Impact**: Backup creation may fail (a visible error is shown via toast), blocking the apply.
- **Workaround**: Reduce backup retention count in settings. Manually clear old backups.
- **Fix planned**: A future release will add a storage usage indicator and graceful degradation (skip oldest backup when full).

### Diff Algorithm Is Word-Level Only
- **What**: The custom diff operates on whitespace-delimited words. It does not handle intra-word changes, punctuation-only changes, or reordering gracefully.
- **Impact**: Minor visual artifacts in diff highlighting when edits are within a single word or involve heavy rephrasing.
- **Workaround**: None needed — functional correctness is unaffected. Visual clarity may be imperfect.
- **Fix planned**: Evaluate character-level or sentence-level diff later if user feedback warrants it.

### No Validation of Lorebook Data Integrity Before Modification
- **What**: The extension trusts that `loadWorldInfo()` returns well-formed data. Corrupt or partially-saved lorebooks could cause unexpected behavior.
- **Impact**: Low — ST's own editor would also struggle with corrupt data. Extension errors are caught and surfaced via toast.
- **Fix planned**: A future release will add basic schema validation on load.

---

## Resolved Issues

- **`escapeAttr is not defined` in main popup** (v0.1) — escaping helpers were duplicated across files; consolidated into `src/utils.js`.
- **Clicking an entry did nothing** (v0.1) — code called a non-existent `popup.close()`; now uses ST's `completeCancelled()`.
- **Token limit ignored** (v0.1) — `generateRaw` expects `responseLength`, not `max_tokens`; corrected.
- **Quick-access button missing/non-functional** (v0.1) — now injected via MutationObserver and opens a standalone popup.
