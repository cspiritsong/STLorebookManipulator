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

### Cross-Batch Review Uses Lexical Candidate Gating
- **What**: Large lorebooks are split into batches. A bounded second pass now checks cross-batch pairs that share activation keys or meaningful title terms, but it does not compare every possible pair.
- **Impact**: Semantic duplicates with no shared lexical signal can still be missed; the candidate cap also trades completeness for predictable request cost.
- **Workaround**: Increase the Review Batch Budget, review a smaller subset, or temporarily use focused instructions with distinctive keys/titles.
- **Status**: Targeted cross-batch candidate review is implemented and reports candidate count/skips in the review metadata.

### LLM May Not Produce Valid Structured Output On Weak Models
- **What**: Some models (especially small local models or RP fine-tunes) struggle to return clean JSON. For a single-entry rewrite this surfaces as a friendly "AI did not reply in the right format" error. For a whole-book review, each batch is retried once with a strict format reminder; batches that still can't be read are skipped (you keep the rest), and the UI reports how many were skipped.
- **Impact**: A rewrite may need a retry; a review may be partial on weak models. No data is lost or modified.
- **Workaround**: Use a model/API that supports structured output (OpenAI, Claude, Gemini), and/or raise Max Response Tokens — truncated JSON is a common cause.
- **Fix planned**: None needed for now; the retry + skip behavior handles this gracefully.

### Provider Errors Cannot Be Fully Prevented
- **What**: The extension now queues all AI requests with a configurable delay (5 seconds by default) and retries transient failures, but it cannot prevent authentication failures, provider outages, quota exhaustion, or requests that exceed a model's context window.
- **Impact**: An operation can still pause at a failed AI request.
- **Workaround**: Read the visible error guidance, correct the underlying problem, then click **Continue** to retry only that request. Completed review batches and bulk-fix progress remain intact.
- **Fix planned**: None. These failures originate outside the extension; pacing and resumable requests are the safe mitigation.

### Browser Backup Storage Limits
- **What**: The backup layer now uses a storage abstraction and reports explicit capacity/write failures, but the default browser store is still localStorage, which typically has a 5-10MB limit per origin.
- **Impact**: Backup creation may fail (a visible error is shown via toast), blocking the apply.
- **Workaround**: Reduce backup retention count in settings. The backup history panel now shows a storage usage indicator (green/yellow/red) so you can see when you're approaching the limit.
- **Fix planned**: Evaluate IndexedDB as the primary large-book store while retaining downloadable JSON backups and a visible non-destructive fallback.

### Diff Algorithm Is Word-Level Only
- **What**: The custom diff operates on whitespace-delimited words. It does not handle intra-word changes, punctuation-only changes, or reordering gracefully.
- **Impact**: Minor visual artifacts in diff highlighting when edits are within a single word or involve heavy rephrasing.
- **Workaround**: None needed — functional correctness is unaffected. Visual clarity may be imperfect.
- **Fix planned**: Evaluate character-level or sentence-level diff later if user feedback warrants it.

### Chat Range Uses Internal 0-Based Message Indexes
- **What**: Create from Chat Range accepts SillyTavern's internal chat indexes, starting at 0, with both endpoints included.
- **Impact**: Users who count visible messages starting at 1 can select an off-by-one range.
- **Workaround**: The popup shows the valid range (for example, `#0` to `#63`). Use those index numbers.
- **Fix planned**: Consider an optional visible-message picker if users find numeric indexes cumbersome.

### Chat Extraction Record Is Local to This Browser
- **What**: The last-extracted message record is stored in browser localStorage, keyed by chat and lorebook.
- **Impact**: Clearing browser site data or moving to another browser/device resets the suggested next range. No lorebook data is affected.
- **Workaround**: The displayed message index can be noted manually; users can always set any range by hand.
- **Fix planned**: None. Local storage avoids modifying chat metadata or lorebook data for a convenience feature.

---

## Resolved Issues

- **Malformed lorebook data could reach mutation workflows** (post-v0.8.0) — `src/st-context.js` now isolates SillyTavern API capabilities, and `src/lorebook-schema.js` validates/deep-clones World Info data before load, backup, or mutation. Unknown entry fields are preserved and malformed books receive recoverable guidance.
- **Book icon disappeared after v0.4.0 update** (v0.4.1) — a stray `});` in `ui.js` broke the whole module. Fixed, and added `tests/syntax.test.js` (`node --check` on every JS file) to catch this class of error before release.
- **`escapeAttr is not defined` in main popup** (v0.1) — escaping helpers were duplicated across files; consolidated into `src/utils.js`.
- **Clicking an entry did nothing** (v0.1) — code called a non-existent `popup.close()`; now uses ST's `completeCancelled()`.
- **Token limit ignored** (v0.1) — `generateRaw` expects `responseLength`, not `max_tokens`; corrected.
- **Quick-access button missing/non-functional** (v0.1) — now injected via MutationObserver and opens a standalone popup.
