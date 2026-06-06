# Known Issues

## Current Issues

### Field Edits (Title / Keys) Have No Diff Preview
- **What**: The before/after diff preview only covers the **content** field (when you click Generate Suggestion). Edits to title, primary keys, or secondary keys are applied directly on Save with no diff.
- **Impact**: Minor. Field edits are small and visible in the input boxes. A pre-delete/pre-save backup still protects against mistakes.
- **Workaround**: Restore from Backup History if a field edit was wrong.
- **Fix planned**: ~~Could add a simple field-level before/after summary on Save if requested.~~ **Implemented** — a confirmation dialog now shows before/after previews for changed Title/Primary Keys/Secondary Keys when you click Save.

### Connection Profile Dropdown Is Populated Once at Load
- **What**: The Connection Profile dropdown is filled when the extension initializes. Profiles created/renamed/deleted in the Connection Manager *after* that are not reflected until SillyTavern is reloaded.
- **Impact**: Minor. A newly created profile won't appear in the dropdown until reload. If a selected profile is deleted, the next request through it errors with a clear message and the setting falls back to "Active connection" on the following load.
- **Workaround**: Reload the page after changing your connection profiles. The quick-access button also refreshes the dropdown on each click.
- **Fix planned**: A future release could subscribe to `CONNECTION_PROFILE_CREATED/UPDATED/DELETED` events (or use `ConnectionManagerRequestService.handleDropdown`) to keep the list live. The quick-access button already calls `populateConnectionProfiles()` on open.

### Whole-Book Review Cannot Detect Cross-Batch Issues
- **What**: Large lorebooks are split into batches so each request fits the model's context window. The model only sees one batch at a time, so an issue spanning two batches (e.g. duplicate entries that land in different batches) will not be detected.
- **Impact**: On very large books, some duplicates/overlaps may be missed. Most personal lorebooks fit in a single batch and are unaffected.
- **Workaround**: Increase the Review Batch Budget setting (default 12000 chars) to keep more entries per batch, or review subsets of the book.
- **Fix planned**: A future "second pass" could re-check flagged candidates across batches, or send entry summaries first.

### LLM May Not Produce Valid Structured Output On Weak Models
- **What**: Some models (especially small local models or RP fine-tunes) struggle to return clean JSON. For a single-entry rewrite this surfaces as a friendly "AI did not reply in the right format" error. For a whole-book review, each batch is retried once with a strict format reminder; batches that still can't be read are skipped (you keep the rest), and the UI reports how many were skipped.
- **Impact**: A rewrite may need a retry; a review may be partial on weak models. No data is lost or modified.
- **Workaround**: Use a model/API that supports structured output (OpenAI, Claude, Gemini), and/or raise Max Response Tokens — truncated JSON is a common cause.
- **Fix planned**: None needed for now; the retry + skip behavior handles this gracefully.

### localStorage Size Limits Not Monitored
- **What**: Backups are stored in localStorage, which typically has a 5-10MB limit per origin. Large lorebooks with many backup entries could approach this limit silently.
- **Impact**: Backup creation may fail (a visible error is shown via toast), blocking the apply.
- **Workaround**: Reduce backup retention count in settings. The backup history panel now shows a storage usage indicator (green/yellow/red) so you can see when you're approaching the limit.
- **Fix planned**: ~~A future release will add a storage usage indicator and graceful degradation (skip oldest backup when full).~~ **Storage indicator implemented** — shows usage percentage with color-coded warnings (>70% yellow, >90% red). Graceful degradation on full storage still pending.

### Diff Algorithm Is Word-Level Only
- **What**: The custom diff operates on whitespace-delimited words. It does not handle intra-word changes, punctuation-only changes, or reordering gracefully.
- **Impact**: Minor visual artifacts in diff highlighting when edits are within a single word or involve heavy rephrasing.
- **Workaround**: None needed — functional correctness is unaffected. Visual clarity may be imperfect.
- **Fix planned**: Evaluate character-level or sentence-level diff later if user feedback warrants it.

### No Validation of Lorebook Data Integrity Before Modification
- **What**: The extension trusts that `loadWorldInfo()` returns well-formed data. Corrupt or partially-saved lorebooks could cause unexpected behavior.
- **Impact**: Low — ST's own editor would also struggle with corrupt data. Extension errors are caught and surfaced via toast.
- **Fix planned**: A future release will add basic schema validation on load.

### "Create New Entry" Button Not Visible in Popup (Bug)
- **What**: The "Create New Entry" button is not appearing in the popup after selecting a lorebook. The dynamic button creation via `buildCreateButton()` is not rendering in the browser despite working in tests.
- **Impact**: Users cannot create new entries from the popup UI.
- **Workaround**: Use SillyTavern's built-in lorebook editor to create entries.
- **Fix planned**: Debug the DOM rendering — possibly a CSS conflict or SillyTavern popup constraint preventing the button from appearing.

---

## Resolved Issues

- **Book icon disappeared after v0.4.0 update** (v0.4.1) — a stray `});` in `ui.js` broke module load. Fixed, and added `tests/syntax.test.js` (`node --check` on every JS file) to catch this class of error before release.
- **`escapeAttr is not defined` in main popup** (v0.1) — escaping helpers were duplicated across files; consolidated into `src/utils.js`.
- **Clicking an entry did nothing** (v0.1) — code called a non-existent `popup.close()`; now uses ST's `completeCancelled()`.
- **Token limit ignored** (v0.1) — `generateRaw` expects `responseLength`, not `max_tokens`; corrected.
- **Quick-access button missing/non-functional** (v0.1) — now injected via MutationObserver and opens a standalone popup.
