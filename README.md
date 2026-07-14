# STLorebookManipulator

[![Release](https://img.shields.io/github/v/release/cspiritsong/STLorebookManipulator)](https://github.com/cspiritsong/STLorebookManipulator/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A SillyTavern extension for safely rewriting and pruning lorebook entries using your active LLM connection.

## What It Does

- Browse entries in any of your SillyTavern lorebooks
- **Review the whole book**: ask the LLM to scan all entries and recommend fixes (duplicates, overlap, verbosity, contradictions). Large books are auto-batched to fit the model's context window.
- **Resolve issues that span multiple entries** with a single cross-entry plan (e.g. merge duplicates into one and delete the rest), generated on demand and applied only after you approve each action
- **Edit an entry's title, primary keys, secondary keys, and content** directly — by hand or with AI help
- Send individual entries to the LLM with a rewrite/prune prompt
- **Delete entries** (with automatic backup first) to clear out duplicates and dead weight
- **Choose any connection profile** for the work, independent of your active chat connection
- Review suggested changes in a highlighted before/after diff (inline or side-by-side)
- **Plain-language errors**: when something fails, you get a clear explanation of what went wrong and how to fix it — not a cryptic technical message
- **Visible request pacing and recovery**: every AI request shows its queue/wait/progress state. If the provider still fails after retries, use **Continue** to retry just that request without restarting the whole operation.
- Auto-backup history before every change, with restore from any point

## Why It Exists

Lorebooks accumulate entries over time. Entries become verbose, redundant, or unclear. There was no safe, visual way to ask an LLM to tighten existing entries while preserving their structure (keys, triggers, metadata). Manual copy-paste loses formatting. Existing tools had parsing bugs and no diff preview.

This extension solves that by keeping you in control at every step: the LLM suggests, you review, you decide.

## Installation

1. Open SillyTavern
2. Go to **Extensions** → **Install Extension**
3. Paste this repository URL:
   ```
   https://github.com/cspiritsong/STLorebookManipulator
   ```
4. Enable **Lorebook Manipulator** in the extensions list

Or manually:
1. Clone/download this repo into `data/<user-handle>/extensions/STLorebookManipulator/`
2. Reload SillyTavern

## Requirements

- SillyTavern ≥ 1.12.0
- A working API connection configured in SillyTavern (any backend: OpenAI, Claude, local, etc.)
- At least one lorebook with entries

## Usage

Click the book icon (open-book) added to the character sheet, group panel, and right-hand button bar to open the manipulator. Then:

1. Select a lorebook from the dropdown
2. The entry list appears, along with a **Review the whole book** panel

**To edit a single entry:**
1. Click an entry to open the editor popup
2. Edit the **Title**, **Primary Keys**, **Secondary Keys**, or **Content** directly (keys are comma-separated; content is a normal text box)
3. Optionally click **Generate Suggestion** to have the AI rewrite the content. You'll see a highlighted diff, and the suggestion drops into the content box so you can tweak it further
4. Click **Save** to apply (auto-backs up first) or **Cancel** to return to the entry list

**To delete an entry:**
1. Click the trash icon on the right of any entry in the list
2. Confirm. A backup is saved first, so you can restore it from Backup History if needed

**To review the whole book:**
1. (Optional) Type what to focus on in the review box (e.g. "find duplicate lore"). Leave blank for a general review.
2. Click **Review & Recommend Fixes**. Large books are automatically split into batches.
3. A list of issues appears, color-coded by severity (duplicate, overlap, verbose, contradiction, other). The review only *finds* problems — fixes are generated later, on demand.
4. **For an issue affecting one entry**: click it to open the editor, pre-filled with the issue, and fix it through the normal diff/save flow.
5. **For an issue affecting two or more entries** (e.g. a duplicate): click **Resolve N entries together**. In the popup, click **Generate Fix Plan** — the AI proposes one action per entry (keep / rewrite / delete), e.g. merge the duplicates into one entry and delete the rest. Each action has a checkbox; untick anything you don't want, then **Apply Selected** (a backup is saved first).
6. After you save/apply, the issue is badged **FIXED!** and dimmed so you can track your progress. Use **← Back to issues** to return to the list without losing your review (your results are kept for the session, even if you Close and reopen).

Use **Backup History** in the extension settings drawer to restore any previous state.

## Configuration

Open the **Extensions** tab → **Lorebook Manipulator** settings drawer to configure:

- **Connection Profile**: Which SillyTavern connection to use for rewriting and review. Leave on "Active connection" to use whatever your chat is currently using, or pick a specific profile (e.g. a cheaper/faster model just for lorebook work). Requires the built-in Connection Manager.
- **Diff Style**: Inline (single column) or Side-by-Side (two columns)
- **Backup Retention**: Number of backups to keep (default: 5)
- **Rewrite Prompt**: Choose a preset (Prune / Clarify / Fix Grammar) or enter custom instructions
- **Max Tokens**: Maximum response length for LLM calls
- **Request Delay**: Minimum delay between AI requests. Defaults to a conservative 5 seconds; lower it only when your provider explicitly supports faster requests.

## Safety

- Auto-backup is created before *every* modification, including deletes
- Only `content`, `title (comment)`, `primary keys`, and `secondary keys` can be changed — position, order, probability, insertion logic, and all other structural metadata are preserved
- Deleting an entry asks for confirmation and backs up the book first, so any delete is recoverable from Backup History
- Original data is always recoverable via backup restore
- No changes are applied without explicit user approval

## Tech Stack

- Vanilla JavaScript (ES modules) — no build step required
- SillyTavern Extension API (`generateRaw`, `loadWorldInfo`, `saveWorldInfo`)
- JSON Schema structured output (native mode with fallback)
- Custom word-level diff algorithm
- Handlebars templates for UI

## License

MIT — see [LICENSE](./LICENSE)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)
