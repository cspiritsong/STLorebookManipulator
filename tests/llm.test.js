import {
  generateEntryFromChat,
  generateRewrite,
  parseChatEntryResponse,
  parseLLMResponse,
  normalizeLLMContent,
  DEFAULT_REQUEST_INTERVAL_MS,
  resetRequestRateLimiterForTests,
  reviseChatEntryDraft,
  setRequestRateLimitForTests,
} from "../src/llm.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    console.error(`  ❌ FAIL: ${message} (expected error but none thrown)`);
  } catch (e) {
    passed++;
    console.log(
      `  ✅ PASS: ${message} (threw: "${e.message.substring(0, 50)}...")`,
    );
  }
}

console.log("\n=== LLM Response Parsing Tests ===\n");

// Valid JSON response
const validJson =
  '{"rewrittenContent": "Shorter version.", "justification": "Removed redundancy."}';
try {
  const result = parseLLMResponse(validJson);
  assert(
    result.rewrittenContent === "Shorter version.",
    "Parses valid JSON rewrittenContent",
  );
  assert(
    result.justification === "Removed redundancy.",
    "Parses valid JSON justification",
  );
} catch (e) {
  failed++;
  console.error(`  ❌ FAIL: Valid JSON parsing threw: ${e.message}`);
}

// JSON wrapped in code block
const codeBlockJson =
  '```json\n{"rewrittenContent": "Fixed grammar.", "justification": "Corrected tense."}\n```';
try {
  const result = parseLLMResponse(codeBlockJson);
  assert(
    result.rewrittenContent === "Fixed grammar.",
    "Extracts JSON from code block",
  );
} catch (e) {
  failed++;
  console.error(`  ❌ FAIL: Code block JSON parsing threw: ${e.message}`);
}

// JSON with surrounding text
const messyJson =
  'Here is the result:\n{"rewrittenContent": "Cleaned up.", "justification": "Tightened prose."}\nHope this helps!';
try {
  const result = parseLLMResponse(messyJson);
  assert(
    result.rewrittenContent === "Cleaned up.",
    "Extracts JSON from surrounding text",
  );
} catch (e) {
  failed++;
  console.error(`  ❌ FAIL: Messy JSON parsing threw: ${e.message}`);
}

// Missing justification defaults gracefully
const noJustification = '{"rewrittenContent": "No reason given."}';
try {
  const result = parseLLMResponse(noJustification);
  assert(
    result.rewrittenContent === "No reason given.",
    "Handles missing justification field",
  );
  assert(
    typeof result.justification === "string",
    "Provides default justification string",
  );
} catch (e) {
  failed++;
  console.error(
    `  ❌ FAIL: Missing justification handling threw: ${e.message}`,
  );
}

// Empty response throws
assertThrows(() => parseLLMResponse(""), "Throws on empty response");
assertThrows(() => parseLLMResponse(null), "Throws on null response");

// Invalid JSON throws
assertThrows(
  () => parseLLMResponse("This is not JSON at all."),
  "Throws on non-JSON response",
);

// Empty rewrittenContent throws
assertThrows(
  () => parseLLMResponse('{"rewrittenContent": "", "justification": "test"}'),
  "Throws on empty rewrittenContent",
);

// Trimming whitespace
const whitespaceJson =
  '  \n  {"rewrittenContent": "  Trimmed.  ", "justification": "  Spaces removed.  "}  \n  ';
try {
  const result = parseLLMResponse(whitespaceJson);
  assert(
    result.rewrittenContent === "Trimmed.",
    "Trims whitespace from rewrittenContent",
  );
  assert(
    result.justification === "Spaces removed.",
    "Trims whitespace from justification",
  );
} catch (e) {
  failed++;
  console.error(`  ❌ FAIL: Whitespace trimming threw: ${e.message}`);
}

console.log("\n=== normalizeLLMContent Tests ===\n");

// generateRaw with jsonSchema returns a JSON string → passed through as-is
const jsonStr = '{"rewrittenContent": "Hi.", "justification": "x"}';
assert(
  normalizeLLMContent(jsonStr) === jsonStr,
  "String input is returned unchanged",
);

// generateRaw without schema returns a plain message string
assert(
  normalizeLLMContent("plain text") === "plain text",
  "Plain string returned unchanged",
);

// ConnectionManagerRequestService ExtractedData with string content
const extractedString = { content: '{"issues": []}', reasoning: "" };
assert(
  normalizeLLMContent(extractedString) === '{"issues": []}',
  "Extracts string content from ExtractedData",
);

// ExtractedData where content is an already-parsed object (json_schema path)
const extractedObject = {
  content: { rewrittenContent: "Done.", justification: "y" },
  reasoning: "",
};
const normalized = normalizeLLMContent(extractedObject);
assert(
  typeof normalized === "string",
  "Parsed-object content is re-stringified to a string",
);
const reparsed = JSON.parse(normalized);
assert(
  reparsed.rewrittenContent === "Done.",
  "Re-stringified content round-trips through JSON.parse",
);

// A bare object with no content field gets stringified whole
const bareObject = { issues: [] };
assert(
  JSON.parse(normalizeLLMContent(bareObject)).issues.length === 0,
  "Bare object without content field is stringified whole",
);

// Null / undefined throw a clear error
assertThrows(() => normalizeLLMContent(null), "Throws on null");
assertThrows(() => normalizeLLMContent(undefined), "Throws on undefined");

// End-to-end: ExtractedData object content flows through parseLLMResponse
const e2e = parseLLMResponse(
  normalizeLLMContent({
    content: { rewrittenContent: "E2E.", justification: "z" },
  }),
);
assert(
  e2e.rewrittenContent === "E2E.",
  "ExtractedData object content parses through parseLLMResponse",
);

console.log("\n=== Chat Range Entry Parsing Tests ===\n");

const chatEntryJson = JSON.stringify({
  title: "Vanessa's Moonblast Discovery",
  primaryKeys: ["Vanessa Albright", "Moonblast"],
  secondaryKeys: ["Glimmer"],
  content: "Vanessa discovered that Moonblast fragments amplify her gifts.",
  justification: "Captures the durable discovery from the selected messages.",
});
const chatEntry = parseChatEntryResponse(chatEntryJson);
assert(
  chatEntry.title === "Vanessa's Moonblast Discovery",
  "Parses generated chat-entry title",
);
assert(
  chatEntry.primaryKeys.length === 2 &&
    chatEntry.primaryKeys[1] === "Moonblast",
  "Parses generated chat-entry primary keys",
);
assert(
  chatEntry.secondaryKeys[0] === "Glimmer",
  "Parses generated chat-entry secondary keys",
);
assert(
  chatEntry.content.includes("amplify her gifts"),
  "Parses generated chat-entry content",
);

const chatEntryMessyKeys = parseChatEntryResponse(
  JSON.stringify({
    title: "  Test  ",
    primaryKeys: ["  alpha ", "", 42, "beta"],
    secondaryKeys: "not an array",
    content: "  A factual summary.  ",
    justification: 123,
  }),
);
assert(
  JSON.stringify(chatEntryMessyKeys.primaryKeys) ===
    JSON.stringify(["alpha", "beta"]),
  "Sanitizes chat-entry keys",
);
assert(
  chatEntryMessyKeys.secondaryKeys.length === 0,
  "Coerces invalid secondary keys to empty array",
);
assert(
  chatEntryMessyKeys.content === "A factual summary.",
  "Trims chat-entry content",
);
assertThrows(
  () =>
    parseChatEntryResponse(
      '{"title":"Test","content":"","primaryKeys":[],"secondaryKeys":[],"justification":"x"}',
    ),
  "Throws when generated chat-entry content is empty",
);

console.log("\n=== Chat Range Generation Request Tests ===\n");

// Keep request-router tests fast; production uses a five-second safe default.
resetRequestRateLimiterForTests();
setRequestRateLimitForTests(0);

const chatCalls = [];
const chatContext = {
  generateRaw: async (request) => {
    chatCalls.push(request);
    return JSON.stringify({
      title: "Chat Fact",
      primaryKeys: ["Vanessa"],
      secondaryKeys: [],
      content: "Vanessa learned a durable fact.",
      justification: "Derived from the selected messages.",
    });
  },
};
const sourceMessages = [
  { index: 4, is_user: true, name: "User", mes: "Vanessa found the fragment." },
  {
    index: 5,
    is_user: false,
    name: "Vanessa",
    mes: "The fragment amplifies my gift.",
  },
];
const generatedFromChat = await generateEntryFromChat(
  sourceMessages,
  "Capture the discovery.",
  512,
  chatContext,
);
assert(
  generatedFromChat.title === "Chat Fact",
  "Generates a structured entry from chat messages",
);
assert(
  chatCalls[0].prompt.includes("Message #4 | User") &&
    chatCalls[0].prompt.includes("Message #5 | Vanessa"),
  "Chat generation includes indexed source messages",
);
assert(
  chatCalls[0].jsonSchema.name === "ChatRangeLorebookEntry",
  "Chat generation uses the dedicated JSON schema",
);

const revisedFromChat = await reviseChatEntryDraft(
  sourceMessages,
  generatedFromChat,
  "Make it shorter.",
  512,
  chatContext,
);
assert(
  revisedFromChat.content === "Vanessa learned a durable fact.",
  "Revises a chat-derived draft",
);
assert(
  chatCalls[1].prompt.includes("## Current Draft") &&
    chatCalls[1].prompt.includes("Make it shorter."),
  "Draft revision includes current draft and follow-up instruction",
);

console.log("\n=== Rate Limiter and Resume Tests ===\n");

assert(
  DEFAULT_REQUEST_INTERVAL_MS === 5000,
  "Production request limiter defaults to a conservative five-second delay",
);

resetRequestRateLimiterForTests();
setRequestRateLimitForTests(0);
const startedAt = [];
const progressStates = [];
const pacedContext = {
  async generateRaw() {
    startedAt.push(Date.now());
    return JSON.stringify({ rewrittenContent: "Rewritten.", justification: "x" });
  },
};
await Promise.all([
  generateRewrite("First entry", "Shorten it.", 256, pacedContext, null, {
    onProgress: (event) => progressStates.push(event.state),
    requestDelayMs: 25,
  }),
  generateRewrite("Second entry", "Shorten it.", 256, pacedContext, null, {
    requestDelayMs: 25,
  }),
]);
assert(
  startedAt[1] - startedAt[0] >= 15,
  "Configured request delay enforces a gap between concurrent LLM calls",
);
assert(
  progressStates.includes("queued") &&
    progressStates.includes("running") &&
    progressStates.includes("complete"),
  "Request queue reports queued, running, and complete progress states",
);

resetRequestRateLimiterForTests();
setRequestRateLimitForTests(0);
let attempts = 0;
let continuePrompts = 0;
const resumeContext = {
  async generateRaw() {
    attempts++;
    if (attempts <= 3) throw new Error("503 overloaded");
    return JSON.stringify({ rewrittenContent: "Recovered.", justification: "x" });
  },
};
const resumed = await generateRewrite(
  "Original entry",
  "Shorten it.",
  256,
  resumeContext,
  null,
  {
    onRequestFailure: async () => {
      continuePrompts++;
      return true;
    },
  },
);
assert(
  resumed.rewrittenContent === "Recovered." && attempts === 4,
  "Continue retries only the failed LLM request after automatic retries",
);
assert(
  continuePrompts === 1,
  "Failed request pauses once for a Continue decision",
);

resetRequestRateLimiterForTests();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
