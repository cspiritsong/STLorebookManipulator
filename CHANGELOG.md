# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Instruction-based entry drafts**: Create New Entry can now generate editable title, keys, secondary keys, and content from user instructions, show field/content before-after previews, and optionally check the draft for duplicate, overlap, or contradiction risks before saving.
- **Chat extraction resume record**: Create from Chat Range now records the highest successfully added end-message index per chat and lorebook. Reopening the same chat/lorebook shows the last endpoint and suggests the next range.
- **Configurable conservative request delay**: request pacing now defaults to 5 seconds and can be adjusted from 1 to 30 seconds in both settings panels. The wait progress reports the selected delay.
- **Central request rate limiter and visible progress**: all AI actions now share a paced request queue. Status panels show queued, rate-limit waiting, active, and complete states with a progress bar.
- **Continue after AI failure**: after automatic retries are exhausted, a failed AI request pauses with a Continue button. Continuing retries only that request, retaining completed review batches and bulk-fix progress.
- **Apply All Fixes button**: after a whole-book review, you can now apply all recommended fixes in one click. The bulk operation creates a single backup, then processes each issue (single-entry rewrites and multi-entry resolve plans) sequentially, handling errors gracefully and showing progress. At the end, all successfully applied issues are automatically marked FIXED, with cascade marking for any other issues referencing the same entries.
- **Friendly error for generic API failures**: "API request failed" / empty-cause errors now explain likely causes (rate limiting after a burst, oversized request, proxy hiccup) and how to recover.
- **Create from Chat Range**: select a target lorebook, enter inclusive 0-based start/end message numbers from the current chat, and generate one structured entry draft. Title, keys, secondary keys, and content remain editable before the backup-protected Add to Lorebook action.
- **Chat-range draft revision**: generated drafts now support a follow-up revise session. Tell the AI how to change the live draft, review each revised version, and keep refining before adding it. Unfinished drafts and their revision notes survive closing/reopening the popup for the same lorebook.
- **Ignore review issue**: each issue now has an Ignore action. Ignored issue fingerprints are stored per lorebook and filtered from future reviews.
- **`/lm-chat` slash command**: `/lm-chat <start> <end> [instructions]` opens the popup with an inclusive 0-based chat range prefilled for Create from Chat Range.
- **Multi-lorebook review**: choose Review Multiple Books, select lorebooks, and receive one combined issue list. Every issue displays its source lorebook; reviews remain independent per book so UIDs never collide.
- **Current Lorebooks filter**: the main popup can now narrow its selector to World Info books currently active in SillyTavern, with an All Lorebooks reset.

### Changed
- **Request-feedback refactor**: moved shared request progress and Continue-control rendering from the popup workflow module into `src/request-status.js`, without changing behavior.
- **Rate-limit resilience**: every LLM request now retries transient failures (rate limits, proxy hiccups, network blips) with exponential backoff (up to 3 attempts). Auth and context-length errors are not retried (retrying wouldn't help).
- **Request pacing**: whole-book review and Apply All now pace requests (~600ms between batches/issues) so a large book doesn't fire many calls back-to-back and trip the provider's rate limit.
- **Cancellable review**: the review panel now has Cancel Review. Connection-profile calls abort immediately; active-connection calls use SillyTavern's generation stop and then retain any completed-batch results.
- **Multi-lorebook Apply All safety**: bulk fixes now create one backup per affected book and only resolve entries within that issue's source book.

## [0.8.0] - 2026-06-06

### Added
- **Review Batch Budget setting**: independent character budget for whole-book review batching (default 12000). Previously shared `maxTokens`; now configurable via Settings panel under "Review Batch Budget (chars)". Large books can use a higher budget to reduce missed cross-batch duplicates.
- **Storage usage indicator**: backup history panel now shows a color-coded storage indicator (green/yellow/red) with percentage of localStorage used. Shows a warning at >70% and critical alert at >90%.
- **Clear All Backups button**: new button at bottom of backup history to delete all backups for the current lorebook with confirmation dialog.
- **Search/filter entries**: search input above entry list in both popup and settings drawer to filter by name, keys, or content.
- **Title/key change preview**: when saving an entry with changed title, primary keys, or secondary keys, a confirmation dialog shows before/after values before saving.
- **FIXED cascade marking**: when you fix an issue that affects an entry, other unresolved issues referencing the same entry are automatically marked FIXED.
- **Self-contained popup with side panel layout**: the quick-access popup now holds everything — main content (lorebook selector, review, entry list) on the left, and a right side panel with all settings (Connection Profile, Max Response Tokens, Review Batch Budget) plus backup history with storage indicator and Clear All Backups. No need to open the settings drawer.

### Changed
- **Connection profile dropdown refreshes on popup open**: newly created/renamed profiles appear without a page reload.
- **Removed unused `prompts/rewrite.hbs` template**: the rewrite prompt was already hardcoded in `llm.js`; the template file added confusion.
- **Formatted all JS files with Prettier**: consistent code style across all 19 JS files.

## [0.7.0] - 2026-06-01

### Added
- **"FIXED!" indicator**: after you save a single-entry fix or apply a multi-entry resolution, that issue is badged **FIXED!** and dimmed in the list, so you can see your progress through the issues. The status line also shows "N fixed so far." Fixed-tracking resets when you run a new review or switch lorebooks.

### Changed
- **Clearer navigation out of the editor/resolve popups.** When you open an entry editor or the resolve view from a review issue, the dismiss button now reads **"← Back to issues"** (instead of "Cancel") and returns you to the issue list — your review results are still there. Removed SillyTavern's duplicate built-in Cancel button so each popup has exactly one, clearly-labelled dismiss control.
- An issue is only marked FIXED on a successful save/apply — backing out without saving leaves it unfixed.
- Bumped version to 0.7.0.

## [0.6.3] - 2026-06-01

### Fixed
- **The real ragequit fix.** The popup closed whenever you clicked the OK/"go" button because SillyTavern's `POPUP_TYPE.TEXT` shows its own built-in **OK button** unless you pass `okButton: false` — and we were passing `okButton: null`, which leaves it visible. That default OK button closes the popup by design. All three popups now pass `okButton: false`, so only our own action buttons (and Cancel) remain.
- Added an `okButton: null` guard to `tests/button-type.test.js` so this can't return.

### Note
- The v0.6.2 `type="button"` change was not the actual cause (ST's dialog has no `<form>`, so submit buttons never closed it). It's harmless and correct practice, but this release (`okButton: false`) is the one that fixes the close-on-click behavior.

## [0.6.2] - 2026-06-01

### Fixed
- **The popup closed instantly when clicking Generate / Review / any action button** (the "ragequit" you saw). SillyTavern renders popups inside a native `<dialog>`, and a `<button>` with no explicit `type` defaults to `type="submit"` — clicking a submit button inside a dialog closes it. Every button the extension creates is now `type="button"`. This affected Generate Suggestion, Save, Review & Recommend Fixes, the resolve-plan buttons, the delete trash icon, and issue chips.
- Added `tests/button-type.test.js`, which statically scans `ui.js` and fails if any button is missing `type="button"` — so this can't silently come back.

## [0.6.1] - 2026-06-01

### Fixed
- Pressing **Close** on the main popup no longer throws away your work. The selected lorebook, the review instructions you typed, and the review results you generated are now remembered for the session. Reopening the popup restores your last lorebook and re-shows the issue list — so an accidental Close doesn't cost you another (token-spending) review. Selecting a different lorebook clears the cached review, since it belonged to the old book.

## [0.6.0] - 2026-06-01

### Added
- **Resolve multiple entries together**: when a review issue affects 2+ entries (e.g. a duplicate between two entries), the issue card now shows a single **"Resolve N entries together"** button instead of per-entry chips. The fix is generated **on demand, after** the review — never during it.
- Clicking it opens a resolution popup. Press **Generate Fix Plan** and the LLM proposes one action per entry: **keep / rewrite / delete** (e.g. merge duplicates into one entry and delete the rest), each with a reason. Rewrites show a content diff; deletes show a clear warning.
- Every action has a **checkbox** — you control exactly what applies. **Apply Selected** takes one backup, then applies only the ticked rewrites and deletes.
- New `resolveIssue()` / `parseResolveResponse()` and `RESOLVE_SCHEMA` in `src/llm.js`; `openResolvePopup()` in `src/ui.js`; `tests/resolve.test.js` (14 tests).

### Changed
- Single-entry issues keep the existing per-entry editor flow unchanged.
- Bumped version to 0.6.0.

## [0.5.1] - 2026-06-01

### Fixed
- A single unreadable batch no longer kills the whole review. Previously, if the AI's reply for one batch couldn't be parsed (e.g. "Review failed on batch 3 of 13"), the entire review was thrown away. Now each batch is retried once with a strict format reminder, and if it still can't be read it is **skipped** — you keep the issues from every readable batch. The review only fails outright if *every* batch is unreadable.
- The UI now reports how many batches were skipped (e.g. "2 of 13 couldn't be read and were skipped"), with a hint to raise Max Response Tokens or use a more capable model.

### Changed
- `parseReviewResponse` is now more forgiving about the AI's output shape: it accepts the expected `{"issues": [...]}`, a bare top-level array, a differently-named array property (e.g. `results`), and treats an empty `{}` as "no issues found" rather than an error.
- `extractJson` now handles a bare top-level JSON array in addition to an object.
- `reviewEntries` returns a `skippedBatches` count alongside `issues` and `batchCount`.

## [0.5.0] - 2026-06-01

### Added
- **Newbie-friendly errors**: when something fails (review, generate, save, delete, load), the extension now shows a plain-language block — what went wrong and how to fix it — instead of a raw technical message. Covers bad AI format, no connection, missing/disabled Connection Manager, rate limits/quota, API-key problems, context-length, network/timeout, empty lorebook, and full backup storage. Unknown errors fall back to generic guidance and keep the raw detail for debugging.
- New `src/errors.js` (`explainError`, `renderFriendlyError`) and `tests/errors.test.js` (21 tests).
- The entry editor now shows the **current content in an editable textarea** (previously content was only visible as a diff after clicking Generate). You can edit content by hand and Save without using the AI at all.

### Changed
- **Generate Suggestion** now diffs against the current content box (including your hand edits) and drops the suggestion into the box so you can tweak it before saving.
- **Save** always writes the content from the box, so manual content edits persist.
- Bumped version to 0.5.0.

## [0.4.2] - 2026-05-31

### Fixed
- Pressing **Cancel** (or Esc) in the entry editor closed the entire manipulator instead of returning to the entry list. The editor now stacks on top of the main popup and returns to it on close. The entry list also refreshes on close so saved edits show immediately. Renamed the editor's close button from "Close" to "Cancel" for clarity.

## [0.4.1] - 2026-05-31

### Fixed
- A stray `});` in `src/ui.js` caused a syntax error that broke the whole module load, which made the quick-access book icon disappear after the v0.4.0 update. Removed the duplicate token.

### Added
- `tests/syntax.test.js`: runs `node --check` on every shipped JS file (including `ui.js`/`index.js`, which the other tests can't import because they reference browser/SillyTavern globals). This would have caught the v0.4.0 break before release.

## [0.4.0] - 2026-05-31

### Added
- **Edit entry fields**: the entry editor popup now lets you change the **title (comment)**, **primary keys**, and **secondary keys** directly — not just content. Keys are entered as comma-separated lists.
- **Delete entries**: each entry in the list has a trash button. Deleting asks for confirmation and saves a backup first, so it's recoverable from Backup History.
- `updateEntryFields`, `deleteEntry`, `sanitizeEntryFields`, and `parseKeywordString` in `src/lorebook.js`. `EDITABLE_FIELDS` is the single source of truth for what may be written.
- `tests/lorebook.test.js`: 29 tests for field editing, deletion, sanitization, and keyword parsing (mocked context).

### Changed
- The single-entry popup is now a general **editor** (Save/Cancel) rather than rewrite-only. Generating a content suggestion is optional; you can save field edits without regenerating.
- `updateEntryContent` is now a thin backward-compatible wrapper over `updateEntryFields`.
- Only `content`, `comment`, `key`, and `keysecondary` are ever written; all other structural fields are preserved.
- Bumped version to 0.4.0.

## [0.3.0] - 2026-05-31

### Added
- **Connection profile selection**: a "Connection Profile" dropdown in settings lets you choose which SillyTavern connection to use for rewriting and review, independent of your active chat connection. Default "Active connection" preserves the previous behavior.
- `callLLM` request router in `src/llm.js`: routes through `ConnectionManagerRequestService.sendRequest()` when a profile is chosen, otherwise `generateRaw()`.
- `normalizeLLMContent` helper to unify response shapes across the two paths (string vs ExtractedData with parsed-object content). Threaded `profileId` through `generateRewrite` and `reviewEntries`.
- 9 tests for `normalizeLLMContent` in `tests/llm.test.js`.

### Changed
- Bumped version to 0.3.0.

## [0.2.0] - 2026-05-31

### Added
- **Whole-book review**: a "Review & Recommend Fixes" panel in the main popup that asks the LLM to scan all entries and report issues (duplicate, overlap, verbose, contradiction, other).
- Optional custom focus instructions for the review (e.g. "find duplicate lore"). Blank = general review.
- Auto-batching of large lorebooks (`batchEntries`) so reviews stay within the model's context window.
- Combined, severity-colored issue list. Clicking an affected entry opens the rewrite popup pre-seeded with the flagged issue, then flows through the existing diff/approve path.
- `reviewEntries` / `parseReviewResponse` in `src/llm.js`, with a dedicated review JSON schema.
- `tests/review.test.js`: 23 tests covering batching and issue-response parsing.

### Changed
- `openRewritePopup` now accepts an optional `issue` argument and shows an issue banner when fixing a flagged entry.
- Refactored JSON extraction in `src/llm.js` into a shared `extractJson` helper used by both the rewrite and review parsers.
- Bumped version to 0.2.0.

## [0.1.0] - 2026-05-31

### Added
- Project scaffolding: LICENSE, README, ARCHITECTURE, CONTRIBUTING, KNOWN-ISSUES
- Initial extension structure (manifest.json, index.js, settings.html)
- Backup history system with configurable retention and restore
- Lorebook data access layer (load/save/reload via ST API)
- LLM integration via generateRaw() with JSON schema + fallback parsing
- Word-level diff computation with inline and side-by-side rendering
- Rewrite popup with approve/reject workflow
- Three prompt presets (Prune, Clarify, Fix Grammar) + custom override
- Settings panel for diff style, backup retention, prompt selection, max tokens
- Quick-access button on character sheet, group panel, and right sidebar
- Standalone main popup (opened by quick-access button) with lorebook selector and entry list
- Shared `src/utils.js` module for HTML escaping helpers
- Unit tests for backup, diff, LLM parsing, and escaping utilities

### Fixed
- Quick-access button now uses MutationObserver + ST events so it appears on dynamically rendered UI
- Quick-access button opens a standalone popup instead of trying to navigate to a settings drawer
- `escapeAttr is not defined` ReferenceError when opening the main popup (helper was used in ui.js but only defined in index.js). Consolidated escaping helpers into `src/utils.js` and added a regression test.
- Clicking an entry did nothing because the code called `popup.close()`, which does not exist on SillyTavern's Popup class. Now uses `completeCancelled()` (3 call sites).
- LLM token limit was silently ignored: `generateRaw` expects `responseLength`, not `max_tokens`. Corrected the parameter name in `src/llm.js`.

---

_Started: 2026-05-31_
