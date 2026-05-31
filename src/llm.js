// ── Schemas ──────────────────────────────────────────────────────────────

// Schema for a single-entry rewrite suggestion.
const REWRITE_SCHEMA = {
    name: 'LorebookRewrite',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            rewrittenContent: {
                type: 'string',
                description: 'The rewritten lorebook entry content.',
            },
            justification: {
                type: 'string',
                description: 'Brief explanation of what was changed and why.',
            },
        },
        required: ['rewrittenContent', 'justification'],
        additionalProperties: false,
    },
};

// Schema for a whole-book review. Returns a list of issues, each referencing
// the affected entries by uid + name so the UI can map an issue back to a
// concrete entry for the existing rewrite flow.
const REVIEW_SCHEMA = {
    name: 'LorebookReview',
    strict: true,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            issues: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['duplicate', 'overlap', 'verbose', 'contradiction', 'other'],
                            description: 'Category of the issue.',
                        },
                        severity: {
                            type: 'string',
                            enum: ['low', 'medium', 'high'],
                            description: 'How important it is to address.',
                        },
                        description: {
                            type: 'string',
                            description: 'Plain-language explanation of the issue and a suggested fix.',
                        },
                        entries: {
                            type: 'array',
                            description: 'The entries this issue affects.',
                            items: {
                                type: 'object',
                                properties: {
                                    uid: { type: 'number', description: 'The exact uid of the affected entry.' },
                                    name: { type: 'string', description: 'The name of the affected entry.' },
                                },
                                required: ['uid', 'name'],
                                additionalProperties: false,
                            },
                        },
                    },
                    required: ['type', 'severity', 'description', 'entries'],
                    additionalProperties: false,
                },
            },
        },
        required: ['issues'],
        additionalProperties: false,
    },
};

// ── LLM request router ───────────────────────────────────────────────────

// Normalize the many response shapes into a single JSON string so the parsers
// below can treat every backend uniformly.
//
// - generateRaw() with a jsonSchema returns a JSON *string*.
// - generateRaw() without a schema returns the message *string*.
// - ConnectionManagerRequestService.sendRequest() returns ExtractedData
//   ({ content, reasoning }); with json_schema set, `content` is an already
//   *parsed object*, otherwise it is a string.
export function normalizeLLMContent(result) {
    if (typeof result === 'string') {
        return result;
    }
    if (result && typeof result === 'object') {
        const content = Object.prototype.hasOwnProperty.call(result, 'content') ? result.content : result;
        if (typeof content === 'string') {
            return content;
        }
        // A parsed object (json_schema path) → re-stringify so the downstream
        // extractJson/JSON.parse logic works the same as the string paths.
        return JSON.stringify(content);
    }
    throw new Error('Empty or invalid response from LLM.');
}

// Send one structured request, routing through a chosen connection profile
// when `profileId` is set, otherwise through the active connection.
async function callLLM({ systemPrompt, prompt, responseLength, jsonSchema, profileId }, context) {
    // Route through a specific connection profile.
    if (profileId) {
        const service = context.ConnectionManagerRequestService;
        if (!service || typeof service.sendRequest !== 'function') {
            throw new Error('Connection Manager is not available. Pick "Active connection" or enable the Connection Manager extension.');
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ];

        // json_schema (snake_case) is passed as an override payload field.
        const overridePayload = jsonSchema ? { json_schema: jsonSchema } : {};
        const result = await service.sendRequest(
            profileId,
            messages,
            responseLength,
            { extractData: true },
            overridePayload,
        );
        return normalizeLLMContent(result);
    }

    // Default: use whatever API is active in SillyTavern.
    if (!context || typeof context.generateRaw !== 'function') {
        throw new Error('generateRaw is not available on the current SillyTavern context.');
    }
    // ST's generateRaw uses `responseLength` (not `max_tokens`).
    const result = await context.generateRaw({ systemPrompt, prompt, responseLength, jsonSchema });
    return normalizeLLMContent(result);
}

// ── Single-entry rewrite ─────────────────────────────────────────────────

export async function generateRewrite(entryContent, promptText, maxTokens, context, profileId = null) {
    if (!entryContent || typeof entryContent !== 'string') {
        throw new Error('Entry content is required and must be a non-empty string.');
    }

    const systemPrompt = `You are a lorebook editor. Your task is to rewrite lorebook entries according to the user's instructions.

RULES:
- Preserve ALL factual content, names, relationships, and world-building details.
- Do NOT add new information that is not present in the original.
- Do NOT remove key details unless explicitly instructed to prune.
- Maintain the same tone and style as the original unless instructed otherwise.
- Return ONLY valid JSON matching the required schema. No markdown, no commentary outside the JSON.`;

    const userPrompt = `## Instructions
${promptText}

## Original Entry
${entryContent}

Rewrite this entry according to the instructions above. Return your response as JSON with "rewrittenContent" and "justification" fields.`;

    try {
        const result = await callLLM({
            systemPrompt,
            prompt: userPrompt,
            responseLength: maxTokens || 1024,
            jsonSchema: REWRITE_SCHEMA,
            profileId,
        }, context);

        return parseLLMResponse(result);
    } catch (e) {
        console.error('[LorebookManipulator] LLM call failed:', e);
        throw new Error(`LLM request failed: ${e.message}. Check your API connection and try again.`);
    }
}

// ── Whole-book review ────────────────────────────────────────────────────

// Split entries into batches so each batch's combined text stays under a
// character budget. This keeps large lorebooks from blowing past the model's
// context window. Pure function (no I/O) so it can be unit-tested directly.
//
// NOTE: cross-batch issues (e.g. duplicates split across two batches) cannot
// be detected, since the model only sees one batch at a time. The budget is
// chosen so most personal lorebooks fit in a single batch. See KNOWN-ISSUES.
export function batchEntries(entries, maxBatchChars = 12000) {
    const list = Array.isArray(entries) ? entries : [];
    const batches = [];
    let current = [];
    let currentChars = 0;

    for (const entry of list) {
        // Approximate the prompt cost of this entry: content + name + per-entry overhead.
        const size = (entry?.content?.length || 0) + (entry?.comment?.length || 0) + 100;

        // Start a new batch if adding this entry would exceed the budget,
        // but never produce an empty batch (an oversized single entry gets its own).
        if (current.length > 0 && currentChars + size > maxBatchChars) {
            batches.push(current);
            current = [];
            currentChars = 0;
        }

        current.push(entry);
        currentChars += size;
    }

    if (current.length > 0) {
        batches.push(current);
    }

    return batches;
}

// Review all entries and return a combined list of issues. Auto-batches large
// books and reports progress via options.onProgress(currentBatch, totalBatches).
// options.profileId routes through a chosen connection profile (else active).
export async function reviewEntries(entries, instructions, maxTokens, context, options = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('There are no entries to review.');
    }

    const maxBatchChars = options.maxBatchChars || 12000;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const profileId = options.profileId || null;

    const batches = batchEntries(entries, maxBatchChars);
    const allIssues = [];

    const systemPrompt = `You are a lorebook auditor. You review SillyTavern lorebook entries and identify issues that could be improved.

Look for these issue types:
- duplicate: two or more entries containing essentially the same information.
- overlap: entries that partially repeat each other or could be merged.
- verbose: entries longer than necessary that could be tightened.
- contradiction: entries that state conflicting facts.
- other: any other clarity, consistency, or quality problem.

RULES:
- Identify each affected entry by its EXACT uid and name as provided. Never invent a uid.
- Be specific in the description and suggest how to fix it.
- If there are no issues, return an empty "issues" array.
- Return ONLY valid JSON matching the required schema. No markdown, no commentary outside the JSON.`;

    for (let i = 0; i < batches.length; i++) {
        if (onProgress) onProgress(i + 1, batches.length);

        const batch = batches[i];
        const entriesText = batch.map((e) => {
            const keys = (e.key || []).join(', ') || '(no keys)';
            return `--- Entry uid=${e.uid} | name="${e.comment || `Entry #${e.uid}`}" | keys=[${keys}] ---\n${e.content || ''}`;
        }).join('\n\n');

        const userPrompt = `## Instructions
${instructions && instructions.trim() ? instructions.trim() : 'Review these lorebook entries and report any issues you find (duplicates, overlap, verbosity, contradictions, or other quality problems).'}

## Lorebook Entries
${entriesText}

Report issues as JSON with an "issues" array. Reference each affected entry by its exact uid and name.`;

        try {
            const result = await callLLM({
                systemPrompt,
                prompt: userPrompt,
                responseLength: maxTokens || 2048,
                jsonSchema: REVIEW_SCHEMA,
                profileId,
            }, context);

            const parsed = parseReviewResponse(result);
            allIssues.push(...parsed.issues);
        } catch (e) {
            console.error(`[LorebookManipulator] Review batch ${i + 1}/${batches.length} failed:`, e);
            throw new Error(`Review failed on batch ${i + 1} of ${batches.length}: ${e.message}`);
        }
    }

    return { issues: allIssues, batchCount: batches.length };
}

// ── Response parsing ─────────────────────────────────────────────────────

// Extract a JSON object from raw model output. Tolerates code fences and
// surrounding prose. Shared by both the rewrite and review parsers so the
// extraction logic lives in exactly one place.
function extractJson(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('Empty or invalid response from LLM.');
    }

    let cleaned = rawText.trim();

    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
    }

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error('[LorebookManipulator] Failed to parse LLM response as JSON:', e);
        throw new Error(
            'Could not parse LLM response as JSON. The model may not support structured output. ' +
            'Try using a different model or API backend.'
        );
    }
}

export function parseLLMResponse(rawText) {
    const parsed = extractJson(rawText);

    if (typeof parsed.rewrittenContent !== 'string' || parsed.rewrittenContent.trim() === '') {
        throw new Error('LLM response missing "rewrittenContent" field or it is empty.');
    }

    if (typeof parsed.justification !== 'string') {
        parsed.justification = '(No justification provided)';
    }

    return {
        rewrittenContent: parsed.rewrittenContent.trim(),
        justification: parsed.justification.trim(),
    };
}

// Parse and sanitize a whole-book review response into a clean issue list.
// Defensive: drops malformed issues and coerces fields to safe defaults so a
// slightly-off model response still yields a usable result.
export function parseReviewResponse(rawText) {
    const parsed = extractJson(rawText);

    if (!parsed || !Array.isArray(parsed.issues)) {
        throw new Error('Review response missing "issues" array.');
    }

    const validSeverities = ['low', 'medium', 'high'];
    const validTypes = ['duplicate', 'overlap', 'verbose', 'contradiction', 'other'];

    const issues = parsed.issues
        .filter((it) => it && typeof it === 'object')
        .map((it) => ({
            type: validTypes.includes(it.type) ? it.type : 'other',
            severity: validSeverities.includes(it.severity) ? it.severity : 'medium',
            description: typeof it.description === 'string' ? it.description.trim() : '',
            entries: Array.isArray(it.entries)
                ? it.entries
                    .filter((e) => e && typeof e === 'object')
                    .map((e) => ({
                        uid: typeof e.uid === 'number'
                            ? e.uid
                            : (Number.isFinite(Number(e.uid)) ? Number(e.uid) : null),
                        name: typeof e.name === 'string' ? e.name : '',
                    }))
                : [],
        }))
        // An issue with no description is useless; drop it.
        .filter((it) => it.description !== '');

    return { issues };
}
