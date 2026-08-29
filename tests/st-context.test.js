import {
  createSTContext,
  detectCapabilities,
  getSTContext,
  STCapabilityError,
  STContextError,
} from "../src/st-context.js";

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
  } catch (error) {
    passed++;
    console.log(`  ✅ PASS: ${message} (threw: ${error.message})`);
  }
}

async function assertRejects(promise, predicate, message) {
  try {
    await promise;
    failed++;
    console.error(`  ❌ FAIL: ${message} (expected rejection but resolved)`);
  } catch (error) {
    const matches = typeof predicate === "function" ? predicate(error) : true;
    if (matches) {
      passed++;
      console.log(`  ✅ PASS: ${message}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${message} (unexpected error: ${error.message})`);
    }
  }
}

console.log("\n=== SillyTavern Context Adapter Tests ===\n");

function Popup() {}
Popup.show = { confirm: async () => true };

const calls = [];
const rawContext = {
  Popup,
  getWorldInfoNames() {
    calls.push(["names", this === rawContext]);
    return ["Book A"];
  },
  async loadWorldInfo(name) {
    calls.push(["load", name, this === rawContext]);
    return { entries: {}, name };
  },
  async saveWorldInfo(name, data) {
    calls.push(["save", name, data, this === rawContext]);
    return "saved";
  },
  reloadWorldInfoEditor() {
    calls.push(["reload", this === rawContext]);
    return "reloaded";
  },
  async generateRaw(request) {
    calls.push(["generate", request, this === rawContext]);
    return "generated";
  },
  ConnectionManagerRequestService: {
    getSupportedProfiles() {
      return [{ id: "fast", name: "Fast" }];
    },
    async sendRequest(...args) {
      calls.push(["profile", args]);
      return { content: "profile result" };
    },
  },
  eventSource: { on() {} },
  eventTypes: { CHAT_CHANGED: "chat_changed" },
};

const adapter = createSTContext(rawContext);
const capabilities = detectCapabilities(rawContext);
assert(adapter !== rawContext, "Creates an adapter without replacing the raw context");
assert(capabilities.worldInfoNames, "Detects lorebook-name capability");
assert(capabilities.loadWorldInfo, "Detects World Info load capability");
assert(capabilities.saveWorldInfo, "Detects World Info save capability");
assert(capabilities.reloadWorldInfoEditor, "Detects editor reload capability");
assert(capabilities.generateRaw, "Detects active-generation capability");
assert(capabilities.connectionProfiles, "Detects connection-profile listing capability");
assert(capabilities.connectionProfileRequests, "Detects connection-profile request capability");
assert(capabilities.events, "Detects event capability");
assert(
  JSON.stringify(adapter.capabilities) === JSON.stringify(capabilities),
  "Exposes the detected capability map",
);
assert(
  adapter.raw === rawContext && adapter.getContext() === rawContext,
  "Keeps access to the original context for UI-only values",
);
assert(
  adapter.Popup === Popup && typeof adapter.Popup.show.confirm === "function",
  "Preserves static properties on SillyTavern constructor APIs",
);

assert(
  JSON.stringify(adapter.getWorldInfoNames()) === JSON.stringify(["Book A"]),
  "Delegates lorebook-name reads",
);
assert(
  JSON.stringify(adapter.getConnectionProfiles()) ===
    JSON.stringify([{ id: "fast", name: "Fast" }]),
  "Lists supported connection profiles",
);

await (async () => {
  const loaded = await adapter.loadWorldInfo("Book A");
  const saved = await adapter.saveWorldInfo("Book A", loaded);
  const reloaded = await adapter.reloadWorldInfoEditor();
  const generated = await adapter.generateRaw({ prompt: "hello" });
  const profileResult = await adapter.sendRequest(
    "fast",
    [{ role: "user", content: "hello" }],
    128,
    { extractData: true },
    { json_schema: { type: "object" } },
  );

  assert(loaded.name === "Book A", "Delegates World Info loads with the book name");
  assert(saved === "saved", "Delegates World Info saves and returns the result");
  assert(reloaded === "reloaded", "Delegates editor reloads");
  assert(generated === "generated", "Delegates active connection generation");
  assert(profileResult.content === "profile result", "Routes profile requests through the adapter");
  assert(
    calls.every((call) => call[0] === "profile" || call[call.length - 1] === true),
    "Binds raw-context methods to the original context",
  );
})();

assert(getSTContext(adapter) === adapter, "Does not double-wrap an existing adapter");
assert(getSTContext(rawContext).raw === rawContext, "Wraps an explicitly supplied raw context");

const limitedContext = createSTContext({});
const limitedCapabilities = limitedContext.capabilities;
assert(!limitedCapabilities.loadWorldInfo, "Reports missing World Info load capability");
assert(!limitedCapabilities.generateRaw, "Reports missing generation capability");
assert(
  limitedContext.getConnectionProfiles().length === 0,
  "Treats missing optional connection profiles as an empty list",
);
await assertRejects(
  Promise.resolve().then(() => limitedContext.loadWorldInfo("Book A")),
  (error) =>
    error instanceof STCapabilityError &&
    error.code === "ST_CAPABILITY_MISSING" &&
    error.capability === "loadWorldInfo",
  "Rejects a load when the SillyTavern API is missing",
);
await assertRejects(
  Promise.resolve().then(() => limitedContext.generateRaw({ prompt: "hello" })),
  (error) => error instanceof STCapabilityError && error.capability === "generateRaw",
  "Rejects generation when the active connection API is missing",
);

const previousSillyTavern = globalThis.SillyTavern;
try {
  globalThis.SillyTavern = { getContext: () => rawContext };
  assert(
    getSTContext().raw === rawContext,
    "Gets the raw context through SillyTavern.getContext()",
  );
} finally {
  if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
  else globalThis.SillyTavern = previousSillyTavern;
}

try {
  delete globalThis.SillyTavern;
  getSTContext();
  failed++;
  console.error("  ❌ FAIL: Missing global SillyTavern context throws");
} catch (error) {
  assert(
    error instanceof STContextError && error.code === "ST_CONTEXT_UNAVAILABLE",
    "Missing global SillyTavern context throws a precise adapter error",
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
