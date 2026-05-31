# STLorebookManipulator

[![Release](https://img.shields.io/github/v/release/cspiritsong/STLorebookManipulator)](https://github.com/cspiritsong/STLorebookManipulator/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A SillyTavern extension for safely rewriting and pruning lorebook entries using your active LLM connection.

## What It Does

- Browse entries in any of your SillyTavern lorebooks
- **Review the whole book**: ask the LLM to scan all entries and recommend fixes (duplicates, overlap, verbosity, contradictions). Large books are auto-batched to fit the model's context window.
- Send individual entries to the LLM with a rewrite/prune prompt
- Review suggested changes in a highlighted before/after diff (inline or side-by-side)
- Approve or reject each suggestion individually
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

**To rewrite a single entry:**
1. Click an entry to open the rewrite popup
2. Click **Generate Suggestion** (uses your configured rewrite preset or custom prompt)
3. Review the highlighted diff
4. Click **Approve** to apply (auto-backs up first) or **Reject** to discard

**To review the whole book:**
1. (Optional) Type what to focus on in the review box (e.g. "find duplicate lore"). Leave blank for a general review.
2. Click **Review & Recommend Fixes**. Large books are automatically split into batches.
3. A list of issues appears, color-coded by severity (duplicate, overlap, verbose, contradiction, other)
4. Click an affected entry on any issue to open the rewrite popup, pre-filled with that issue, and fix it through the normal diff/approve flow

Use **Backup History** in the extension settings drawer to restore any previous state.

## Configuration

Open the **Extensions** tab → **Lorebook Manipulator** settings drawer to configure:

- **Diff Style**: Inline (single column) or Side-by-Side (two columns)
- **Backup Retention**: Number of backups to keep (default: 5)
- **Rewrite Prompt**: Choose a preset (Prune / Clarify / Fix Grammar) or enter custom instructions
- **Max Tokens**: Maximum response length for LLM calls

## Safety

- Auto-backup is created before *every* modification
- Only the `content` field is ever changed — keys, triggers, position, priority, and all other metadata are preserved
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
