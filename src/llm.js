// ── Schemas ──────────────────────────────────────────────────────────────

// Schema for a single-entry rewrite suggestion.
const REWRITE_SCHEMA = {
  name: "LorebookRewrite",
  strict: true,
  value: {
    $schema: "http://json-schema.org/draft-04/schema#",
    type: "object",
    properties: {
      rewrittenContent: {
        type: "string",
        description: "The rewritten lorebook entry content.",
      },
      justification: {
        type: "string",
        description: "Brief explanation of what was changed and why.",
      },
    },
    required: ["rewrittenContent", "justification"],
    additionalProperties: false,
  },
};

// Schema for creating or revising one new lorebook entry from an explicit
// chat-message range. It is distinct from REWRITE_SCHEMA so a chat draft can
// never be mistaken for a rewrite of an existing entry.
const CHAT_ENTRY_SCHEMA = {
  name: "ChatRangeLorebookEntry",
  strict: true,
  value: {
    $schema: "http://json-schema.org/draft-04/schema#",
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "A concise title or memo for the new lorebook entry.",
      },
      primaryKeys: {
        type: "array",
        description: "Specific activation keys for the entry.",
        items: { type: "string" },
      },
      secondaryKeys: {
        type: "array",
        description: "Optional secondary activation keys for the entry.",
        items: { type: "string" },
      },
      content: {
        type: "string",
        description:
          "Concise factual lorebook content derived from the chat range.",
      },
      justification: {
        type: "string",
        description: "Brief explanation of which facts were captured.",
      },
    },
    required: [
      "title",
      "primaryKeys",
      "secondaryKeys",
      "content",
      "justification",
    ],
    additionalProperties: false,
  },
};

const ENTRY_IMPACT_SCHEMA = {
  name: "LorebookEntryImpact",
  strict: true,
  value: {
    $schema: "http://json-schema.org/draft-04/schema#",
    type: "object",
    properties: {
      impacts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            uid: { type: "number" },
            name: { type: "string" },
            type: { type: "string", enum: ["duplicate", "overlap", "contradiction"] },
            description: { type: "string" },
          },
          required: ["uid", "name", "type", "description"],
          additionalProperties: false,
        },
      },
    },
    required: ["impacts"],
    additionalProperties: false,
  },
};

// Schema for a whole-book review. Returns a list of issues, each referencing
// the affected entries by uid + name so the UI can map an issue back to a
// concrete entry for the existing rewrite flow.
const REVIEW_SCHEMA = {
  name: "LorebookReview",
  strict: true,
  value: {
    $schema: "http://json-schema.org/draft-04/schema#",
    type: "object",
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "duplicate",
                "overlap",
                "verbose",
                "contradiction",
                "other",
              ],
              description: "Category of the issue.",
            },
            severity: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "How important it is to address.",
            },
            description: {
              type: "string",
              description:
                "Plain-language explanation of the issue and a suggested fix.",
            },
            entries: {
              type: "array",
              description: "The entries this issue affects.",
              items: {
                type: "object",
                properties: {
                  uid: {
                    type: "number",
                    description: "The exact uid of the affected entry.",
                  },
                  name: {
                    type: "string",
                    description: "The name of the affected entry.",
                  },
                },
                required: ["uid", "name"],
                additionalProperties: false,
              },
            },
          },
          required: ["type", "severity", "description", "entries"],
          additionalProperties: false,
        },
      },
    },
    required: ["issues"],
    additionalProperties: false,
  },
};

// Schema for resolving a single review issue that affects one or more entries.
// The model returns one action per affected entry: keep it as-is, rewrite its
// content, or delete it (e.g. when merging duplicates into one keeper).
const RESOLVE_SCHEMA = {
  name: "LorebookResolution",
  strict: true,
  value: {
    $schema: "http://json-schema.org/draft-04/schema#",
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One sentence explaining the overall plan.",
      },
      actions: {
        type: "array",
        description: "One action per affected entry.",
        items: {
          type: "object",
          properties: {
            uid: {
              type: "number",
              description: "The exact uid of the entry this action applies to.",
            },
            action: {
              type: "string",
              enum: ["keep", "rewrite", "delete"],
              description:
                "keep = leave unchanged; rewrite = replace content; delete = remove entry.",
            },
            newContent: {
              type: "string",
              description:
                'The new content when action is "rewrite". Empty otherwise.',
            },
            reason: {
              type: "string",
              description: "Brief reason for this action.",
            },
          },
          required: ["uid", "action", "newContent", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "actions"],
    additionalProperties: false,
  },
};

// ── LLM request router ───────────────────────────────────────────────────

// Every provider request passes through one queue. This prevents concurrent
// extension workflows from bursting calls into a provider and rate-limiting
// each other.
export const DEFAULT_REQUEST_INTERVAL_MS = 5000;
let requestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS;
let requestQueue = Promise.resolve();
let queuedRequestCount = 0;
let lastRequestStartedAt = 0;

// Test controls keep unit tests fast while production retains the safe default.
export function setRequestRateLimitForTests(intervalMs = DEFAULT_REQUEST_INTERVAL_MS) {
  requestIntervalMs = Math.max(0, Number(intervalMs) || 0);
}

export function resetRequestRateLimiterForTests() {
  requestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS;
  requestQueue = Promise.resolve();
  queuedRequestCount = 0;
  lastRequestStartedAt = 0;
}

function reportRequestProgress(onProgress, state, details = {}) {
  if (typeof onProgress === "function") onProgress({ state, ...details });
}

async function waitForRequestSlot(waitMs, intervalMs, onProgress, signal) {
  const startedAt = Date.now();
  while (true) {
    if (signal?.aborted) throw new Error("Request cancelled.");
    const remainingMs = Math.max(0, waitMs - (Date.now() - startedAt));
    reportRequestProgress(onProgress, "waiting", { remainingMs, intervalMs });
    if (remainingMs === 0) return;
    await sleep(Math.min(remainingMs, 250));
  }
}

function queueLLMRequest(task, { onProgress, signal, requestDelayMs } = {}) {
  const position = ++queuedRequestCount;
  reportRequestProgress(onProgress, "queued", { position });

  const run = async () => {
    try {
      if (signal?.aborted) throw new Error("Request cancelled.");
      const intervalMs = Number.isFinite(requestDelayMs)
        ? Math.max(1000, Math.min(30000, requestDelayMs))
        : requestIntervalMs;
      const waitMs = Math.max(
        0,
        lastRequestStartedAt + intervalMs - Date.now(),
      );
      await waitForRequestSlot(waitMs, intervalMs, onProgress, signal);
      if (signal?.aborted) throw new Error("Request cancelled.");
      lastRequestStartedAt = Date.now();
      reportRequestProgress(onProgress, "running");
      const result = await task();
      reportRequestProgress(onProgress, "complete");
      return result;
    } finally {
      queuedRequestCount--;
    }
  };

  const queued = requestQueue.then(run, run);
  // A failed request must not block subsequent requests forever.
  requestQueue = queued.catch(() => {});
  return queued;
}

// Normalize the many response shapes into a single JSON string so the parsers
// below can treat every backend uniformly.
//
// - generateRaw() with a jsonSchema returns a JSON *string*.
// - generateRaw() without a schema returns the message *string*.
// - ConnectionManagerRequestService.sendRequest() returns ExtractedData
//   ({ content, reasoning }); with json_schema set, `content` is an already
//   *parsed object*, otherwise it is a string.
export function normalizeLLMContent(result) {
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object") {
    const content = Object.prototype.hasOwnProperty.call(result, "content")
      ? result.content
      : result;
    if (typeof content === "string") {
      return content;
    }
    // A parsed object (json_schema path) → re-stringify so the downstream
    // extractJson/JSON.parse logic works the same as the string paths.
    return JSON.stringify(content);
  }
  throw new Error("Empty or invalid response from LLM.");
}

// Pause helper for pacing/backoff.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Decide whether a failed request is worth retrying. Rate limits, generic
// API failures, and transient network/proxy hiccups are retryable; auth and
// "bad request" style errors are not (retrying won't help).
function isRetryableError(error) {
  const msg = (
    error && error.message ? error.message : String(error || "")
  ).toLowerCase();
  const retryable = [
    "rate limit",
    "rate-limit",
    "429",
    "too many requests",
    "quota",
    "api request failed",
    "request failed",
    "<none>",
    "timeout",
    "timed out",
    "etimedout",
    "network",
    "fetch failed",
    "failed to fetch",
    "econnrefused",
    "503",
    "502",
    "500",
    "overloaded",
  ];
  // Don't retry clear client errors (bad key, forbidden, context too long).
  const nonRetryable = [
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "api key",
    "invalid key",
    "context length",
    "context window",
    "too long",
  ];
  if (nonRetryable.some((n) => msg.includes(n))) return false;
  return retryable.some((r) => msg.includes(r));
}

// Send one structured request with retry-and-backoff. Retries transient
// failures (rate limits, proxy hiccups, network blips) with exponential
// backoff so a burst of requests (e.g. Apply All on a large book) doesn't
// fail the moment the provider throttles. maxRetries=2 means up to 3 attempts.
async function callLLM(args, context, maxRetries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queueLLMRequest(() => callLLMOnce(args, context), args);
    } catch (e) {
      lastError = e;
      // Stop early if the error isn't worth retrying, or we're out of attempts.
      if (attempt === maxRetries || !isRetryableError(e)) {
        if (typeof args.onRequestFailure === "function" && !args.signal?.aborted) {
          const shouldContinue = await args.onRequestFailure(e);
          if (shouldContinue) return callLLM(args, context, maxRetries);
        }
        throw e;
      }
      // Exponential backoff: 1s, 2s, 4s ... with a little jitter.
      const delay =
        1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
      console.warn(
        `[LorebookManipulator] Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
        e.message,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

// Send one structured request, routing through a chosen connection profile
// when `profileId` is set, otherwise through the active connection.
async function callLLMOnce(
  { systemPrompt, prompt, responseLength, jsonSchema, profileId, signal },
  context,
) {
  if (signal?.aborted) {
    throw new Error("Request cancelled.");
  }
  // Route through a specific connection profile.
  if (profileId) {
    const service = context.ConnectionManagerRequestService;
    if (!service || typeof service.sendRequest !== "function") {
      throw new Error(
        'Connection Manager is not available. Pick "Active connection" or enable the Connection Manager extension.',
      );
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    // json_schema (snake_case) is passed as an override payload field.
    const overridePayload = jsonSchema ? { json_schema: jsonSchema } : {};
    const result = await service.sendRequest(
      profileId,
      messages,
      responseLength,
      { extractData: true, signal },
      overridePayload,
    );
    return normalizeLLMContent(result);
  }

  // Default: use whatever API is active in SillyTavern.
  if (!context || typeof context.generateRaw !== "function") {
    throw new Error(
      "generateRaw is not available on the current SillyTavern context.",
    );
  }
  // ST's generateRaw uses `responseLength` (not `max_tokens`).
  const result = await context.generateRaw({
    systemPrompt,
    prompt,
    responseLength,
    jsonSchema,
  });
  return normalizeLLMContent(result);
}

// ── Single-entry rewrite ─────────────────────────────────────────────────

export async function generateRewrite(
  entryContent,
  promptText,
  maxTokens,
  context,
  profileId = null,
  requestOptions = {},
) {
  if (!entryContent || typeof entryContent !== "string") {
    throw new Error(
      "Entry content is required and must be a non-empty string.",
    );
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
    const result = await callLLM(
      {
        systemPrompt,
        prompt: userPrompt,
        responseLength: maxTokens || 1024,
        jsonSchema: REWRITE_SCHEMA,
        profileId,
        ...requestOptions,
      },
      context,
    );

    return parseLLMResponse(result);
  } catch (e) {
    console.error("[LorebookManipulator] LLM call failed:", e);
    throw new Error(
      `LLM request failed: ${e.message}. Check your API connection and try again.`,
    );
  }
}

// ── Create a lorebook entry from a chat-message range ─────────────────────

export async function generateEntryFromChat(
  messages,
  instructions,
  maxTokens,
  context,
  profileId = null,
  requestOptions = {},
) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error(
      "Choose at least one non-system chat message to summarize.",
    );
  }

  const chatText = messages
    .map((message) => {
      const number = Number.isInteger(message.index) ? `#${message.index}` : "";
      const speaker = message.name || (message.is_user ? "User" : "Character");
      return `--- Message ${number} | ${speaker} ---\n${message.mes || ""}`;
    })
    .join("\n\n");

  const systemPrompt = `You convert explicit SillyTavern chat-message ranges into one new lorebook entry.

RULES:
- Use ONLY facts established in the supplied messages. Never invent details, motives, names, or outcomes.
- Produce a concise, factual reference entry useful in future chats.
- Prefer specific proper nouns or distinctive phrases for primary keys. Do not use broad common words such as "the world", "powers", "war", or "current status" unless the user explicitly asks for them.
- Do not include dialogue transcripts, speculation, or meta commentary in content.
- Return ONLY valid JSON matching the required schema.`;

  const userPrompt = `## User Instructions
${instructions && instructions.trim() ? instructions.trim() : "Summarize the durable facts established in this chat range as one new lorebook entry."}

## Chat Messages
${chatText}

Create one new lorebook entry from this range. Return title, primaryKeys, secondaryKeys, content, and justification as JSON.`;

  try {
    const result = await callLLM(
      {
        systemPrompt,
        prompt: userPrompt,
        responseLength: maxTokens || 1024,
        jsonSchema: CHAT_ENTRY_SCHEMA,
        profileId,
        ...requestOptions,
      },
      context,
    );
    return parseChatEntryResponse(result);
  } catch (e) {
    console.error(
      "[LorebookManipulator] Chat-range entry generation failed:",
      e,
    );
    throw new Error(
      `LLM request failed: ${e.message}. Check your API connection and try again.`,
    );
  }
}

// Generate a complete, editable new entry from the user's own instructions.
// The result is never saved here; the popup remains the approval boundary.
export async function generateEntryFromInstructions(
  instructions,
  maxTokens,
  context,
  profileId = null,
  requestOptions = {},
) {
  if (!instructions || !instructions.trim()) {
    throw new Error("Describe the lorebook entry you want to create.");
  }
  const result = await callLLM({
    systemPrompt: "You create one concise SillyTavern lorebook entry from user instructions. Create specific activation keys, avoid broad common words, and do not claim facts the user did not provide. Return only JSON matching the schema.",
    prompt: `## User Instructions\n${instructions.trim()}\n\nCreate one editable lorebook entry with title, primaryKeys, secondaryKeys, content, and justification.`,
    responseLength: maxTokens || 1024,
    jsonSchema: CHAT_ENTRY_SCHEMA,
    profileId,
    ...requestOptions,
  }, context);
  return parseChatEntryResponse(result);
}

export async function checkEntryImpact(
  draft,
  entries,
  maxTokens,
  context,
  profileId = null,
  requestOptions = {},
) {
  const existing = (Array.isArray(entries) ? entries : [])
    .map((entry) => `uid=${entry.uid}; name=${entry.comment || "(untitled)"}; keys=${(entry.key || []).join(", ")}\n${entry.content || ""}`)
    .join("\n\n");
  const proposed = [
    "## Proposed Entry",
    `Title: ${draft.title || "(untitled)"}`,
    `Keys: ${(draft.primaryKeys || []).join(", ")}`,
    `Secondary Keys: ${(draft.secondaryKeys || []).join(", ")}`,
    `Content: ${draft.content || ""}`,
    "",
    "## Existing Entries",
    existing || "(none)",
  ].join("\n");
  const result = await callLLM({
    systemPrompt: "You check a proposed lorebook entry against existing entries. Report only genuine duplicates, overlaps, or contradictions. Return an empty impacts array when none exist. Return only JSON matching the schema.",
    prompt: proposed,
    responseLength: maxTokens || 1024,
    jsonSchema: ENTRY_IMPACT_SCHEMA,
    profileId,
    ...requestOptions,
  }, context);
  const parsed = extractJson(result);
  const valid = ["duplicate", "overlap", "contradiction"];
  return {
    impacts: (Array.isArray(parsed.impacts) ? parsed.impacts : [])
      .filter((impact) => impact && typeof impact.description === "string")
      .map((impact) => ({
        uid: Number.isFinite(Number(impact.uid)) ? Number(impact.uid) : null,
        name: typeof impact.name === "string" ? impact.name : "Unknown entry",
        type: valid.includes(impact.type) ? impact.type : "overlap",
        description: impact.description.trim(),
      })),
  };
}

// Revise a generated chat-range draft without losing its grounding in the
// source messages. The caller owns the editable draft and only applies it
// after explicit approval.
export async function reviseChatEntryDraft(
  messages,
  draft,
  instructions,
  maxTokens,
  context,
  profileId = null,
  requestOptions = {},
) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error(
      "Choose at least one non-system chat message to revise this draft.",
    );
  }
  if (!draft || typeof draft.content !== "string" || !draft.content.trim()) {
    throw new Error(
      "Generate or enter a draft before asking the AI to revise it.",
    );
  }
  if (!instructions || !instructions.trim()) {
    throw new Error("Describe how you want the draft revised.");
  }

  const chatText = messages
    .map((message) => {
      const number = Number.isInteger(message.index) ? `#${message.index}` : "";
      const speaker = message.name || (message.is_user ? "User" : "Character");
      return `--- Message ${number} | ${speaker} ---\n${message.mes || ""}`;
    })
    .join("\n\n");

  const systemPrompt = `You revise a draft lorebook entry that was created from an explicit SillyTavern chat-message range.

RULES:
- Follow the user's revision instruction, but use ONLY facts established in the supplied source messages.
- Preserve factual content from the current draft unless the user explicitly asks to remove it or it is unsupported by the source messages.
- Never invent details, motives, names, or outcomes.
- Keep primary keys specific; avoid broad common words such as "the world", "powers", "war", or "current status" unless explicitly requested.
- Return ONLY valid JSON matching the required schema.`;

  const userPrompt = `## Source Chat Messages
${chatText}

## Current Draft
Title: ${draft.title || "(untitled)"}
Primary Keys: ${(draft.primaryKeys || []).join(", ") || "(none)"}
Secondary Keys: ${(draft.secondaryKeys || []).join(", ") || "(none)"}
Content:
${draft.content}

## Revision Instruction
${instructions.trim()}

Revise the draft. Return title, primaryKeys, secondaryKeys, content, and justification as JSON.`;

  try {
    const result = await callLLM(
      {
        systemPrompt,
        prompt: userPrompt,
        responseLength: maxTokens || 1024,
        jsonSchema: CHAT_ENTRY_SCHEMA,
        profileId,
        ...requestOptions,
      },
      context,
    );
    return parseChatEntryResponse(result);
  } catch (e) {
    console.error("[LorebookManipulator] Chat-range draft revision failed:", e);
    throw new Error(
      `LLM request failed: ${e.message}. Check your API connection and try again.`,
    );
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
    const size =
      (entry?.content?.length || 0) + (entry?.comment?.length || 0) + 100;

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
export async function reviewEntries(
  entries,
  instructions,
  maxTokens,
  context,
  options = {},
) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("There are no entries to review.");
  }

  const maxBatchChars = options.maxBatchChars || 12000;
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const profileId = options.profileId || null;
  const signal = options.signal || null;

  const batches = batchEntries(entries, maxBatchChars);
  const allIssues = [];
  let skippedBatches = 0; // batches whose reply couldn't be read, even after a retry
  let cancelled = false;

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

  // The exact shape we want back, repeated when the first reply is unreadable.
  const formatReminder =
    'Your previous reply could not be read. Respond with ONLY a JSON object of this exact shape, nothing else: {"issues": [{"type": "duplicate|overlap|verbose|contradiction|other", "severity": "low|medium|high", "description": "...", "entries": [{"uid": <number>, "name": "..."}]}]}. If there are no issues, reply exactly {"issues": []}.';

  for (let i = 0; i < batches.length; i++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    if (onProgress) onProgress(i + 1, batches.length);

    const batch = batches[i];
    const entriesText = batch
      .map((e) => {
        const keys = (e.key || []).join(", ") || "(no keys)";
        return `--- Entry uid=${e.uid} | name="${e.comment || `Entry #${e.uid}`}" | keys=[${keys}] ---\n${e.content || ""}`;
      })
      .join("\n\n");

    const userPrompt = `## Instructions
${instructions && instructions.trim() ? instructions.trim() : "Review these lorebook entries and report any issues you find (duplicates, overlap, verbosity, contradictions, or other quality problems)."}

## Lorebook Entries
${entriesText}

Report issues as JSON with an "issues" array. Reference each affected entry by its exact uid and name.`;

    // Attempt the batch; on a parse/read failure, retry once with a stricter
    // format reminder. If it still fails, skip this batch rather than losing
    // the whole review.
    let parsed = null;
    for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
      try {
        const prompt =
          attempt === 0 ? userPrompt : `${userPrompt}\n\n${formatReminder}`;
        const result = await callLLM(
          {
            systemPrompt,
            prompt,
            responseLength: maxTokens || 2048,
            jsonSchema: REVIEW_SCHEMA,
            profileId,
            signal,
            requestDelayMs: options.requestDelayMs,
            onProgress: options.onRequestProgress,
            onRequestFailure: options.onRequestFailure,
          },
          context,
        );

        parsed = parseReviewResponse(result);
      } catch (e) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
        console.error(
          `[LorebookManipulator] Review batch ${i + 1}/${batches.length} attempt ${attempt + 1} failed:`,
          e,
        );
      }
    }

    if (cancelled) break;

    if (parsed === null) {
      skippedBatches++;
    } else {
      allIssues.push(...parsed.issues);
    }

    // Pace requests between batches so a large book doesn't fire many calls
    // back-to-back and trip the provider's rate limit. callLLM already retries
    // with backoff, but spacing reduces the chance of throttling up front.
    // Skip the wait after the final batch.
    if (i < batches.length - 1) {
      await sleep(600);
    }
  }

  // Only treat the whole review as failed if EVERY batch was unreadable.
  if (!cancelled && skippedBatches === batches.length) {
    throw new Error(
      "Could not parse LLM response as JSON. The model may not support structured output. Try a more capable model or raise Max Response Tokens.",
    );
  }

  return {
    issues: allIssues,
    batchCount: batches.length,
    skippedBatches,
    cancelled,
  };
}

// ── Resolve a single issue across its affected entries ───────────────────

// Generate a resolution plan for one review issue. `affectedEntries` is the
// array of full entry objects the issue points at. Returns
// { summary, actions: [{ uid, action, newContent, reason }] }.
export async function resolveIssue(
  issue,
  affectedEntries,
  maxTokens,
  context,
  profileId = null,
  requestOptions = {},
) {
  if (!issue || typeof issue !== "object") {
    throw new Error("No issue provided to resolve.");
  }
  if (!Array.isArray(affectedEntries) || affectedEntries.length === 0) {
    throw new Error("No affected entries to resolve.");
  }

  const systemPrompt = `You are a lorebook editor resolving a specific problem that spans one or more entries.

You will be given the problem and the full text of every affected entry. Produce a concrete plan with ONE action per entry:
- "keep": leave the entry unchanged.
- "rewrite": replace the entry's content (provide newContent).
- "delete": remove the entry entirely.

GUIDELINES:
- For duplicates/overlap: pick ONE entry to keep (rewrite it to hold the merged, complete information) and mark the others "delete". Don't lose unique facts — fold them into the kept entry.
- For verbosity: "rewrite" the entry more concisely.
- For contradictions: "rewrite" the entries so they agree.
- Preserve all unique factual content. Never invent new facts.
- Use the EXACT uid of each entry. Include an action for every affected entry.
- Return ONLY valid JSON matching the schema. No markdown, no commentary outside the JSON.`;

  const entriesText = affectedEntries
    .map((e) => {
      const keys = (e.key || []).join(", ") || "(no keys)";
      return `--- Entry uid=${e.uid} | name="${e.comment || `Entry #${e.uid}`}" | keys=[${keys}] ---\n${e.content || ""}`;
    })
    .join("\n\n");

  const userPrompt = `## Problem (${issue.type}, ${issue.severity})
${issue.description}

## Affected Entries
${entriesText}

Produce a resolution plan as JSON with a "summary" and an "actions" array (one action per entry, referenced by exact uid).`;

  const result = await callLLM(
    {
      systemPrompt,
      prompt: userPrompt,
      responseLength: maxTokens || 2048,
      jsonSchema: RESOLVE_SCHEMA,
      profileId,
      ...requestOptions,
    },
    context,
  );

  return parseResolveResponse(result, affectedEntries);
}

// ── Response parsing ─────────────────────────────────────────────────────

// Extract a JSON object from raw model output. Tolerates code fences and
// surrounding prose. Shared by both the rewrite and review parsers so the
// extraction logic lives in exactly one place.
function extractJson(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Empty or invalid response from LLM.");
  }

  let cleaned = rawText.trim();

  const codeBlockMatch = cleaned.match(
    /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i,
  );
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Trim to the outermost JSON value. The model may wrap the JSON in prose.
  // Handle both an object ({...}) and a bare array ([...]) — whichever the
  // model returned. We pick the bracket type that appears first.
  const objStart = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");
  const useArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);

  if (useArray) {
    const arrEnd = cleaned.lastIndexOf("]");
    if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
      cleaned = cleaned.substring(arrStart, arrEnd + 1);
    }
  } else {
    const objEnd = cleaned.lastIndexOf("}");
    if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
      cleaned = cleaned.substring(objStart, objEnd + 1);
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error(
      "[LorebookManipulator] Failed to parse LLM response as JSON:",
      e,
    );
    throw new Error(
      "Could not parse LLM response as JSON. The model may not support structured output. " +
        "Try using a different model or API backend.",
    );
  }
}

export function parseLLMResponse(rawText) {
  const parsed = extractJson(rawText);

  if (
    typeof parsed.rewrittenContent !== "string" ||
    parsed.rewrittenContent.trim() === ""
  ) {
    throw new Error(
      'LLM response missing "rewrittenContent" field or it is empty.',
    );
  }

  if (typeof parsed.justification !== "string") {
    parsed.justification = "(No justification provided)";
  }

  return {
    rewrittenContent: parsed.rewrittenContent.trim(),
    justification: parsed.justification.trim(),
  };
}

// Parse and normalize a generated entry from a chat range. Keys are sanitized
// here so the UI can pass the result directly to createEntry after approval.
export function parseChatEntryResponse(rawText) {
  const parsed = extractJson(rawText);

  if (typeof parsed.content !== "string" || parsed.content.trim() === "") {
    throw new Error(
      'Chat summary response missing "content" field or it is empty.',
    );
  }

  const normalizeKeys = (value) =>
    Array.isArray(value)
      ? value
          .filter((key) => typeof key === "string")
          .map((key) => key.trim())
          .filter(Boolean)
      : [];

  return {
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    primaryKeys: normalizeKeys(parsed.primaryKeys),
    secondaryKeys: normalizeKeys(parsed.secondaryKeys),
    content: parsed.content.trim(),
    justification:
      typeof parsed.justification === "string" && parsed.justification.trim()
        ? parsed.justification.trim()
        : "(No justification provided)",
  };
}

// Parse and sanitize a whole-book review response into a clean issue list.
// Forgiving by design — models phrase structured output inconsistently:
//   - { "issues": [...] }            (the schema we ask for)
//   - [ ... ]                        (a bare array)
//   - { "results": [...] } etc.      (a differently-named array property)
//   - { }                            (an object with no array -> treat as "no issues")
// Malformed individual issues are dropped and fields coerced to safe defaults.
export function parseReviewResponse(rawText) {
  const parsed = extractJson(rawText);

  // Find the array of issues from whatever shape we got.
  let rawIssues;
  if (Array.isArray(parsed)) {
    rawIssues = parsed;
  } else if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.issues)) {
      rawIssues = parsed.issues;
    } else {
      // Accept the first array-valued property (e.g. "results", "items").
      const arrayProp = Object.values(parsed).find((v) => Array.isArray(v));
      if (arrayProp) {
        rawIssues = arrayProp;
      } else if (Object.keys(parsed).length === 0) {
        // A bare {} is a valid "I found nothing" answer.
        rawIssues = [];
      } else {
        throw new Error('Review response missing "issues" array.');
      }
    }
  } else {
    throw new Error('Review response missing "issues" array.');
  }

  const validSeverities = ["low", "medium", "high"];
  const validTypes = [
    "duplicate",
    "overlap",
    "verbose",
    "contradiction",
    "other",
  ];

  const issues = rawIssues
    .filter((it) => it && typeof it === "object")
    .map((it) => ({
      type: validTypes.includes(it.type) ? it.type : "other",
      severity: validSeverities.includes(it.severity) ? it.severity : "medium",
      description:
        typeof it.description === "string" ? it.description.trim() : "",
      entries: Array.isArray(it.entries)
        ? it.entries
            .filter((e) => e && typeof e === "object")
            .map((e) => ({
              uid:
                typeof e.uid === "number"
                  ? e.uid
                  : Number.isFinite(Number(e.uid))
                    ? Number(e.uid)
                    : null,
              name: typeof e.name === "string" ? e.name : "",
            }))
        : [],
    }))
    // An issue with no description is useless; drop it.
    .filter((it) => it.description !== "");

  return { issues };
}

// Parse and sanitize a resolution plan. `affectedEntries` is used to coerce
// uids and to ignore actions referencing entries that aren't part of the issue.
// Returns { summary, actions: [{ uid, action, newContent, reason }] }.
export function parseResolveResponse(rawText, affectedEntries = []) {
  const parsed = extractJson(rawText);

  // Locate the actions array from a few possible shapes.
  let rawActions;
  if (Array.isArray(parsed)) {
    rawActions = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray(parsed.actions)
  ) {
    rawActions = parsed.actions;
  } else if (parsed && typeof parsed === "object") {
    const arrayProp = Object.values(parsed).find((v) => Array.isArray(v));
    rawActions = arrayProp || null;
  } else {
    rawActions = null;
  }

  if (!Array.isArray(rawActions)) {
    throw new Error('Resolution response missing an "actions" array.');
  }

  const validActions = ["keep", "rewrite", "delete"];
  const allowedUids = new Set(affectedEntries.map((e) => e.uid));

  const actions = rawActions
    .filter((a) => a && typeof a === "object")
    .map((a) => {
      const uid =
        typeof a.uid === "number"
          ? a.uid
          : Number.isFinite(Number(a.uid))
            ? Number(a.uid)
            : null;
      return {
        uid,
        action: validActions.includes(a.action) ? a.action : "keep",
        newContent: typeof a.newContent === "string" ? a.newContent : "",
        reason: typeof a.reason === "string" ? a.reason.trim() : "",
      };
    })
    // Only keep actions that target an entry actually part of this issue.
    .filter(
      (a) =>
        a.uid !== null && (allowedUids.size === 0 || allowedUids.has(a.uid)),
    )
    // A "rewrite" with no new content is meaningless; treat it as "keep".
    .map((a) =>
      a.action === "rewrite" && a.newContent.trim() === ""
        ? { ...a, action: "keep" }
        : a,
    );

  if (actions.length === 0) {
    throw new Error("Resolution response had no usable actions.");
  }

  const summary =
    parsed && typeof parsed.summary === "string" ? parsed.summary.trim() : "";

  return { summary, actions };
}
