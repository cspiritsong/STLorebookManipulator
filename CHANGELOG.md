# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
