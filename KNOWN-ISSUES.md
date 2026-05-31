# Known Issues

## Current Issues

### LLM Fallback Parsing May Fail on Non-Compliant Models
- **What**: When the active API backend doesn't support native JSON schema, the extension falls back to prompt engineering asking for JSON in a code block. Some models (especially small local models or RP fine-tunes) may ignore this and return prose or malformed output.
- **Impact**: "Invalid response" error displayed to user. No data is lost or modified.
- **Workaround**: Use a model/API that supports structured output (OpenAI, Claude, Gemini). Or increase max tokens — truncated JSON is a common failure mode.
- **Fix planned**: v0.2 will add retry logic with progressively stricter prompts.

### localStorage Size Limits Not Monitored
- **What**: Backups are stored in localStorage, which typically has a 5-10MB limit per origin. Large lorebooks with many backup entries could approach this limit silently.
- **Impact**: Backup creation may fail without visible error if storage is full.
- **Workaround**: Reduce backup retention count in settings. Manually clear old backups.
- **Fix planned**: v0.2 will add storage usage indicator and graceful degradation (skip oldest backup when full).

### Diff Algorithm Is Word-Level Only
- **What**: The custom diff operates on whitespace-delimited words. It does not handle intra-word changes, punctuation-only changes, or reordering gracefully.
- **Impact**: Minor visual artifacts in diff highlighting when edits are within a single word or involve heavy rephrasing.
- **Workaround**: None needed — functional correctness is unaffected. Visual clarity may be imperfect.
- **Fix planned**: Evaluate character-level or sentence-level diff for v0.2 if user feedback warrants it.

### No Validation of Lorebook Data Integrity Before Modification
- **What**: The extension trusts that `loadWorldInfo()` returns well-formed data. Corrupt or partially-saved lorebooks could cause unexpected behavior.
- **Impact**: Low — ST's own editor would also struggle with corrupt data. Extension errors are caught and surfaced via toast.
- **Fix planned**: v0.2 will add basic schema validation on load.

---

## Resolved Issues

_None yet._
