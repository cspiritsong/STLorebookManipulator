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

export async function generateRewrite(entryContent, promptText, maxTokens, context) {
    if (!entryContent || typeof entryContent !== 'string') {
        throw new Error('Entry content is required and must be a non-empty string.');
    }
    if (!context || typeof context.generateRaw !== 'function') {
        throw new Error('generateRaw is not available on the current SillyTavern context.');
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
        // ST's generateRaw uses `responseLength` (not `max_tokens`).
        // When `jsonSchema` is set, it returns the extracted JSON string directly.
        const result = await context.generateRaw({
            systemPrompt,
            prompt: userPrompt,
            responseLength: maxTokens || 1024,
            jsonSchema: REWRITE_SCHEMA,
        });

        return parseLLMResponse(result);
    } catch (e) {
        console.error('[LorebookManipulator] LLM call failed:', e);
        throw new Error(`LLM request failed: ${e.message}. Check your API connection and try again.`);
    }
}

export function parseLLMResponse(rawText) {
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

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (e) {
        console.error('[LorebookManipulator] Failed to parse LLM response as JSON:', e);
        throw new Error(
            'Could not parse LLM response as JSON. The model may not support structured output. ' +
            'Try using a different model or API backend.'
        );
    }

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
