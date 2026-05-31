# STLorebookManipulator

A SillyTavern extension for safely rewriting and pruning lorebook entries using your active LLM connection.

## What It Does

- Browse entries in any of your SillyTavern lorebooks
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
   https://github.com/YOUR_USERNAME/STLorebookManipulator
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

1. Open **Extensions** tab → expand **Lorebook Manipulator** drawer
2. Select a lorebook from the dropdown
3. Click an entry to open the rewrite popup
4. Choose a rewrite preset (Prune / Clarify / Fix Grammar) or enter a custom prompt
5. Click **Generate Suggestion**
6. Review the highlighted diff
7. Click **Approve** to apply or **Reject** to discard
8. Use **Backup History** in settings to restore any previous state

## Configuration

Open the extension settings drawer to configure:

- **Diff Style**: Inline (single column) or Side-by-Side (two columns)
- **Backup Retention**: Number of backups to keep (default: 5)
- **Rewrite Prompt**: Choose a preset or enter custom instructions
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
