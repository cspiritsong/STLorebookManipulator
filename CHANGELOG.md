# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

---

_Started: 2026-05-31_
