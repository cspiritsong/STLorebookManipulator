import { parseResolveResponse } from "../src/llm.js";

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
    console.log(`  ✅ PASS: ${message}`);
  }
}

// The entries an issue affects (used to validate uids).
const affected = [
  { uid: 1, comment: "Dragon A", content: "Dragons breathe fire." },
  {
    uid: 2,
    comment: "Dragon B",
    content: "Dragons are big lizards that breathe fire.",
  },
];

console.log("\n=== parseResolveResponse Tests ===\n");

// A typical duplicate resolution: keep+rewrite uid 1, delete uid 2.
const dupePlan = JSON.stringify({
  summary: "Merge B into A and delete B.",
  actions: [
    {
      uid: 1,
      action: "rewrite",
      newContent: "Dragons are big lizards that breathe fire.",
      reason: "Merged details from B.",
    },
    { uid: 2, action: "delete", newContent: "", reason: "Duplicate of A." },
  ],
});
const dupe = parseResolveResponse(dupePlan, affected);
assert(dupe.summary === "Merge B into A and delete B.", "Preserves summary");
assert(dupe.actions.length === 2, "Returns all actions");
assert(
  dupe.actions[0].action === "rewrite" && dupe.actions[0].newContent.length > 0,
  "Rewrite action keeps newContent",
);
assert(dupe.actions[1].action === "delete", "Delete action preserved");

// Invalid action coerced to "keep"
const badAction = JSON.stringify({
  summary: "s",
  actions: [{ uid: 1, action: "explode", newContent: "", reason: "x" }],
});
assert(
  parseResolveResponse(badAction, affected).actions[0].action === "keep",
  'Unknown action coerced to "keep"',
);

// A "rewrite" with empty content is downgraded to "keep" (nothing to write)
const emptyRewrite = JSON.stringify({
  summary: "s",
  actions: [{ uid: 1, action: "rewrite", newContent: "   ", reason: "x" }],
});
assert(
  parseResolveResponse(emptyRewrite, affected).actions[0].action === "keep",
  'Empty rewrite downgraded to "keep"',
);

// String uid coerced to number
const stringUid = JSON.stringify({
  summary: "s",
  actions: [{ uid: "2", action: "delete", newContent: "", reason: "x" }],
});
assert(
  parseResolveResponse(stringUid, affected).actions[0].uid === 2,
  "String uid coerced to number",
);

// Actions referencing entries outside the issue are dropped
const strayUid = JSON.stringify({
  summary: "s",
  actions: [
    { uid: 1, action: "delete", newContent: "", reason: "x" },
    {
      uid: 999,
      action: "delete",
      newContent: "",
      reason: "not part of this issue",
    },
  ],
});
const stray = parseResolveResponse(strayUid, affected);
assert(
  stray.actions.length === 1 && stray.actions[0].uid === 1,
  "Drops actions for uids not in the issue",
);

// Bare array of actions (no wrapper object) is accepted
const bareArray = JSON.stringify([
  { uid: 1, action: "delete", newContent: "", reason: "x" },
]);
assert(
  parseResolveResponse(bareArray, affected).actions.length === 1,
  "Accepts a bare actions array",
);

// Differently-named array property is accepted
const altKey = JSON.stringify({
  plan: [{ uid: 1, action: "delete", newContent: "", reason: "x" }],
});
assert(
  parseResolveResponse(altKey, affected).actions.length === 1,
  "Accepts a differently-named array property",
);

// Code-fenced response is parsed
const fenced = "```json\n" + dupePlan + "\n```";
assert(
  parseResolveResponse(fenced, affected).actions.length === 2,
  "Parses a code-fenced resolution",
);

// Missing actions array throws
assertThrows(
  () => parseResolveResponse('{"summary": "s"}', affected),
  "Throws when no actions array is present",
);
assertThrows(
  () => parseResolveResponse("not json", affected),
  "Throws on non-JSON",
);

// All-keep / all-stray (no usable actions) throws
assertThrows(
  () =>
    parseResolveResponse(
      JSON.stringify({
        summary: "s",
        actions: [{ uid: 999, action: "delete", newContent: "", reason: "x" }],
      }),
      affected,
    ),
  "Throws when every action targets an out-of-issue uid",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
