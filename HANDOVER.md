# Handover Guide

_For the next AI or developer who takes over this project._

Read this document first. It summarizes everything the project is, what's built, what's left, and how to continue it.

---

## Project Overview

**STLorebookManipulator** is a SillyTavern extension for safely rewriting and pruning lorebook entries using the user's active LLM connection. The core insight: lorebooks accumulate entries that become verbose, redundant, or contradictory over time. There was no safe, visual way to ask an LLM to tighten existing entries while preserving their structure. This extension gives the user full control over every change, with diffs and backups protecting everything.

**Identity:** a tidying/cleanup tool — not a lorebook *generator* (WREC already does that well).

**Primary user:** the person managing a roleplay lorebook who wants to prune/merge/dedupe entries. Personal tool first; community-friendly second.

**Repo:** https://github.com/cspiritsong/STLorebookManipulator

**License:** MIT

---

## How to Install

In SillyTavern: Extensions → Install Extension → paste:
```
https://github.com/cspiritsong/STLorebookManipulator
```

Then enable it. The extension lives in `SillyTavern/public/scripts/extensions/third-party/STLorebookManipulator/`.

---

## What's Built (current: v0.7.0)

### Core features
1. **Quick-access book icon** on the character sheet, group panel, and right-hand button bar. Opens the main popup.
2. **Lorebook selector + entry list**. Each entry shows title, keys, and content preview. Click an entry to edit. Trash icon to delete.
3. **Per-entry editor popup** with editable title (comment/memo), primary keys, secondary keys, and content textarea. Optional **Generate Suggestion** button calls the LLM to rewrite the content, shows a highlighted diff (inline or side-by-side), and drops the suggestion into the content box for further tweaking.
4. **Whole-book review** (the big feature). Review button sends all entries to the LLM in auto-batched chunks. Returns a severity-colored issue list (duplicate / overlap / verbose / contradiction / other). A failed batch retries once with a strict format reminder; if it still fails, it's skipped. Only errors if *every* batch fails.
5. **Single-entry issue fixing**. Clicking an issue that affects one entry opens the editor pre-filled with the issue. Save applies all four fields; Back returns to the issue list.
6. **Multi-entry resolve**. An issue affecting 2+ entries shows a single **"Resolve N entries together"** button. The resolve popup generates a plan: one action per entry (keep/rewrite/delete), with diffs and delete warnings, each checkbox-toggleable. Apply Selected backs up once, then applies only the ticked actions.
7. **FIXED! indicator**. After a successful save/apply, the issue is badged FIXED! and dimmed in the list. Tracked in a `Session` cache (a `Set` of issue objects, by identity), so the FIXED state survives Close/reopen. Resets on a new review or book change.
8. **Session persistence** (the "memory function"). The select lorebook, review instructions, and review results all survive closing the popup. Reopening restores them — so an accidental Close doesn't waste tokens.
9. **Backup history** with configurable retention (default 5). Every edit, delete, and apply backs up first. Restore from any point. Downloadable as `.json` files for offline safety.
10. **Connection profile selection** in settings. Choose any SillyTavern connection for rewriting/review, independent of the active chat connection. Defaults to "Active connection" (preserves original behavior).
11. **Plain-language errors**. When something fails, the user sees "here's the problem, here's how to fix it" instead of a cryptic technical message. Covers AI format errors, no connection, rate limit, API key problems, context length, network issues, empty lorebook, storage full.
12. **Custom rewrite presets**. Three presets (Prune / Clarify / Fix Grammar) plus a custom override.

---

## Architecture

Full file-by-file breakdown is in `ARCHITECTURE.md`. Summary here for quick reference.

### Entry point
- `index.js` — initializes on jQuery ready, renders the settings drawer, wires dropdown handlers, injects the quick-access book icon via MutationObserver + ST events.

### Source modules (`src/`)
| File | Purpose |
|---|---|
| `lorebook.js` | Data access layer for SillyTavern's World Info API: `getLorebookNames`, `loadLorebook`, `updateEntryFields`, `updateEntryContent`, `deleteEntry`, `sanitizeEntryFields`, `parseKeywordString`. |
| `llm.js` | LLM interaction: `generateRewrite` (single entry), `reviewEntries` (whole-book review with auto-batching + retry/skip), `resolveIssue` (multi-entry fix plan). Schemas: `REWRITE_SCHEMA`, `REVIEW_SCHEMA`, `RESOLVE_SCHEMA`. Parsers: `parseLLMResponse`, `parseReviewResponse`, `parseResolveResponse`. `callLLM` routes through `ConnectionManagerRequestService.sendRequest()` when profile is set, otherwise through `generateRaw()` on the active connection. `normalizeLLMContent` unifies response shapes. |
| `diff.js` | Word-level LCS-based diff. Pure function + DOM rendering (inline and side-by-side). |
| `backup.js` | localStorage-backed backup history. `createBackup`, `getBackupHistory`, `restoreBackup`, `downloadBackup`, `clearAllBackups`. |
| `ui.js` | All popup logic: `openMainPopup` (main), `openRewritePopup` (editor), `openResolvePopup` (multi-entry). `renderEntryList`, `renderIssueList`, `renderResolvePlan`. Session cache at module scope. |
| `errors.js` | `explainError` and `renderFriendlyError`. Pattern-matches common AI errors into plain-language guidance. Pure, no I/O. |
| `utils.js` | `escapeHtml` and `escapeAttr`. Shared across all files. |

### Other files
- `manifest.json` — ST extension metadata. Version, entry point (`index.js`), style (`style.css`), minimum ST version, GitHub home.
- `settings.html` — handlebars template rendered into the Extensions drawer. Contains the settings UI (lorebook selector, connection profile dropdown, diff style, backup retention, prompt preset, custom prompt textarea, max tokens, backup history).
- `style.css` — all styles.
- `tests/` — 10 test files + runner. 180 tests pass. Covers: syntax safety, all buttons typed, HTML escaping, parse functions, batching resilience, review fixed-tracking, backup, lorebook CRUD, resolve parsing.

---

## How to Develop

### Local setup
The dev repo lives at `/Users/badiyee/STLorebookmanipulator`. The **installed copy** that SillyTavern runs is at `/Users/badiyee/SillyTavern/public/scripts/extensions/third-party/STLorebookManipulator/`. After every change:
1. `git commit + push` from the dev repo
2. Pull into the installed copy: `git -C /Users/badiyee/SillyTavern/public/scripts/extensions/third-party/STLorebookManipulator fetch origin && git -C /Users/badiyee/SillyTavern/public/scripts/extensions/third-party/STLorebookManipulator reset --hard origin/master`
3. Hard-refresh the browser (Cmd+Shift+R) — ST caches ES modules aggressively.

Or click "Update" on the extension in ST's Extensions panel, but this may hit browser cache anyway; hard-refresh is more reliable.

### Testing
```bash
node tests/run-tests.js
```
180 tests. Every bug fix must include a regression test (per the user's brief). `tests/syntax.test.js` runs `node --check` on every shipped JS file to guard against load-breaking errors. `tests/button-type.test.js` scans `ui.js` for two common ST-popup bugs: buttons missing `type="button"` (submit default closes `<dialog>`) and `okButton: null` (leaves ST's default OK button visible, which also closes popups). Both of these have caused real bugs.

### Committing
Commit messages follow `<type>: <short description>` (feat/fix/refactor/docs/test/chore). Tag every release with `gh release create vX.Y.Z --repo cspiritsong/STLorebookManipulator`.

---

## What's Next (WREC Parity)

We benchmarked against the [World Info Recommender](https://github.com/bmen25124/SillyTavern-WorldInfo-Recommender) extension. Three buckets, in order of value to our primary goal (tidy/prune existing lorebooks):

**Bucket A — directly serves tidy/prune (high value)**
- [x] Edit keys/triggers/title (not just content)
- [x] Delete entries
- [x] Multi-lorebook view (one book at a time currently)
- [x] **Apply All** for review fixes (bulk apply across issues) — *Implemented in unreleased*
- [x] Connection profile selection

**Bucket B — power-user / automation**
- [ ] Slash commands / headless run
- [ ] Savable prompt presets (currently: presets + custom, but not persisted as named presets)
- [ ] Blacklist (don't re-flag this issue)

**Bucket C — different use case (likely out of scope)**
- [ ] Generate brand-new entries (WREC's main feature; not our goal)
- [ ] Chat-aware context (uses chat history for suggestions)
- [ ] Streaming responses

**User's explicit direction** on Bucket C: "skip C, or at most do it much later if you personally find you want it." Bucket C turns this from a cleanup tool into a WREC clone.

**Recommended next session** (ask the user before starting): **multi-lorebook view** or **Apply All**. Both directly complete the tidy/prune workflow.

---

## Known Issues & Caveats

- **Whole-book review cannot detect cross-batch issues** (e.g. duplicates across two batches). Most personal lorebooks fit in one batch. Documented in KNOWN-ISSUES.md.
- **Connection profile dropdown is populated once at load.** Creating/renaming/deleting profiles afterward requires a reload. Future: subscribe to ST events.
- **FIXED tracking is per-session memory**, not a real re-check. If you fix one duplicate but a separate issue references the same entry, that other issue won't auto-badge. Intentional (no extra token cost), but the user should know.
- **Prompt template `prompts/rewrite.hbs` was unused and has been removed** — the rewrite prompt is hardcoded in `llm.js`.
- **Review uses `settings.maxTokens`** (the rewrite setting). A separate token budget for reviews would make the model more thorough for large books. Not yet built.
- **Tests can't cover popup/DOM wiring** (close/restore/back behavior) without mocking all of SillyTavern's Popup+DOM. `syntax.test.js` and `button-type.test.js` guard structure; the *behavior* needs a manual smoke test.

---

## Session History

All releases on GitHub: https://github.com/cspiritsong/STLorebookManipulator/releases

| Version | What's new | Notes |
|---|---|---|
| v0.1.0 | Initial feature: browse entries, single-entry rewrite, diff preview, backup history | 4 patches before stable: `escapeAttr` ReferenceError, quick-access button issues, `popup.close()` undefined, `responseLength` vs `max_tokens` |
| v0.2.0 | Whole-book review with issue list | Auto-batching. Large books split into chunks. |
| v0.3.0 | Connection profile selection | Route LLM calls through any configured connection. |
| v0.4.0 | Edit fields (title/keys/secondary) + delete entries | Single-source-of-truth `EDITABLE_FIELDS`. |
| v0.5.0 | Plain-language errors + resizable content textarea | `explainError` maps common errors to clear guidance. |
| v0.6.0 | Multi-entry resolve with plan/diff/checklists | Per-action keep/rewrite/delete with diffs and delete warnings. |
| v0.7.0 | Back-to-issues navigation + FIXED! indicator | Clearer dismiss button; progress tracking through issues. |

---

## Working with the User

The user (PM) follows a two-mode workflow:
1. **Plan mode** — discuss, clarify, write the plan. No code. Don't build until they explicitly say "go."
2. **Build mode** — execute the plan exactly. One feature per session. Test it. Document it. Commit it.

Rules from their brief (`how-to-work-with-me.md`):
- Ask what they mean, don't assume.
- If you think they're describing the wrong solution to the right problem, say so.
- Every bug fix needs a regression test.
- Never add dependencies without telling them.
- Never commit secrets or personal data.
- Document as you go (README, ARCHITECTURE, CHANGELOG, KNOWN-ISSUES).

---

## Key Decisions (from ARCHITECTURE.md)

- **Vanilla JS, no build step.** ST loads extensions as ES modules directly. Simpler for users to install and fork.
- **JSON Schema structured output.** Native support on modern APIs eliminates XML parsing failures that plague WREC.
- **Editable fields limited to content/key/keysecondary/comment.** Structural fields (position, order, probability) stay untouched so edits can't break activation logic.
- **LLM only suggests content, not keys/title.** Keeps structured output simple and low-risk. Users edit keys by hand where they have full control.
- **Delete requires confirm + backup.** Every destructive action is recoverable.
- **Review batches are resilient.** A failed batch retries once with a format reminder. If it still fails, it's skipped. Only errors if *every* batch fails.
- **Backups in localStorage.** Immediate + synchronous. Downloadable as files as a secondary safety net.
- **Auto-batch by character budget.** Large lorebooks stay within the model's context window. Tradeoff: cross-batch issues can't be detected.

---

## How to Read This Project

New to this codebase? Start here:
1. **README.md** — what it does, how to install/use.
2. **ARCHITECTURE.md** — every file, what it does, decision log.
3. **KNOWN-ISSUES.md** — known limitations and planned fixes.
4. **HANDOVER.md** (this file) — project context, history, how to continue.
5. **CONTRIBUTING.md** — how to contribute (for external developers).
6. **tests/** — the test suite is the most honest documentation of what works.

---

_Last updated: 2026-06-01 by spiritsong. Current version: v0.7.0._
