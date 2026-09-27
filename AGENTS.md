# STLorebookManipulator — local operating contract

## Mission and source of truth

- This repository is the cspiritsong public-OSS SillyTavern extension for safely reviewing, rewriting, pruning, creating, and restoring lorebook entries with an active LLM connection.
- Read `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `HANDOVER.md`, and `KNOWN-ISSUES.md` before changing behavior. Source, tests, and the current public `master` release path are the project contract.
- This is the cspiritsong personal/public-OSS lane. Inspect the remote before every write and never push it with the `badiyee85` work credential.

## Unified project baseline

- Keep one canonical checkout and one writer. Use **Look → Plan → Do → Check** and focused regression → red run → smallest fix → green run before the full gate.
- Preserve the user’s lorebook structure and recoverability. AI proposes; Badi reviews and decides. No modification, deletion, merge, or restore happens without explicit user approval in the product flow.
- Auto-backup must remain ahead of every mutation. Structural metadata that is outside the supported edit contract must survive unchanged.
- Never commit credentials, provider payloads, private lorebooks, chat contents, or backup data. Keep generated/local material inside `.gitignore`.
- Keep connection-profile selection, request pacing, retry/Continue behavior, batch limits, and plain-language errors fail-safe. Do not turn a provider failure into a destructive partial apply.

## Routing and verification

- The extension has no build step or runtime dependency. Use the documented `npm test`/`node tests/run-tests.js` and `npm run check` paths after reading the current scripts.
- Test review, cross-entry planning, cancellation, backup/restore, and apply boundaries with synthetic fixtures where possible.
- Separate local test evidence from any later SillyTavern installation or provider smoke test.
---

## Universal Engineering Policy & Model Routing

This repository operates under Badi's governing baseline at `/home/badi/policies/UNIVERSAL-AGENT-ENGINEERING-POLICY.md`:
- **Model Routing by Risk & Coupling:**
  - **Operator / Orchestrator (z-ai/glm-5.3-flash via xkiro @ max):** Fast default. Owns repository inspection, reading docs, git operations, reproduction, test/lint runs, logs, mechanical transformations, and isolated low-risk edits.
  - **Engineer (anthropic/claude-opus-5 via xkiro @ max):** Escalated for architecture, uncertain blast radius, coupled state transitions, persistence, durability, concurrency, security boundaries, and lifecycle machines.
  - **Adversary (fresh independent anthropic/claude-opus-5 context via xkiro @ max):** Independent review for consequential plans (Cut 2) and whole-system diffs. Never shares context with the authoring Engineer.
- **The Three Cuts Framework (Single-Operator Standard):**
  - **Cut 1 (Work Item & Subsystem Lane):** Handled by Bobby. WIP=1 per subsystem; map blast radius across related issues before coding.
  - **Cut 2 (Architecture Plan Gate — Fully Automated):** Opus Engineer designs the plan; mechanical plan gate and fresh-context Opus Adversary must both pass before code is written. Badi does not read intermediate plans/diffs.
  - **Cut 3 (Mark Ready / Release):** Badi's sole sign-off. Delivered via a plain-English brief (`BADI-BRIEF.md`) with a single choice: **Ship it / Hold it / Explain more**.
- **Execution & Durability Invariants:**
  - **Plan-Freeze Rule:** Once a plan passes Cut 2, follow it. If coding reveals an error: STOP → record evidence → reopen plan → adversarial review → resume. No improvising mid-code.
  - **Existing-Mechanisms-First:** Inventory and extend existing mechanisms before introducing new locks, queues, caches, state stores, or managers.
  - **Suppression Gate:** Any `skip`, `abort`, `suppress`, `defer`, or `early-return` on persistence, security, or lifecycle paths is high-risk by construction and requires explicit justification.
  - **Two-Part Verification ("Tests Pass" ≠ "The Fix Works"):** Differential proof (revert source change to catch inert logic) + End-to-end trace (real caller reaches changed code down to disk/database) + Interrupted-path testing.
- **Hermes Agent & Teknium Architectural Invariants:**
  - **Prompt Caching is Sacred:** Byte-stable system prompts and schemas. Deferred invalidation for tool/skill changes (`--now` opt-in).
  - **Footprint Ladder (Narrow Waist, Expansive Edges):** Extend existing code → CLI command + skill → service-gated tool → plugin → MCP server → core tool (last resort).
  - **Facade + Topical Siblings:** Files >2,000 LOC or functions >300 LOC split along `<stem>_<topic>.py` siblings behind a thin facade. Table-driven dispatch over `if/elif` chains ≥ 4.
  - **Contract Tests Over Snapshot Tests:** Assert invariants and relationships between data, never frozen snapshot counts or strings. Never read source files inside unit tests.
  - **Bare-Metal & Environmental Reality:** Never fake host platforms with `sys.platform` mocking. Test OS seams on native runners or isolated canaries (`wine2e`, real CDP). Verify actual responding PID/build.
  - **Supply-Chain Lockdown:** Upper/lower dependency bounds (`>=floor,<next_major`), 40-character commit SHA pinning on GitHub Actions, and locked manifests.
