# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
