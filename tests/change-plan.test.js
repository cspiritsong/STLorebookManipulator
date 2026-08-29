import {
  EDITABLE_ENTRY_FIELDS,
  applyChangePlanToBook,
  createChangePlan,
  groupChangePlansByBook,
  planCreateEntry,
  planDeleteEntry,
  planEditEntry,
  planResolveActions,
  planRewriteEntry,
  sanitizeEntryFields,
} from "../src/change-plan.js";

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

console.log("\n=== Change Plan Tests ===\n");

assert(
  JSON.stringify(EDITABLE_ENTRY_FIELDS) ===
    JSON.stringify(["content", "key", "keysecondary", "comment"]),
  "Editable field contract is explicit and narrow",
);

const clean = sanitizeEntryFields({
  content: "Updated",
  key: [" dragon ", "", "wyrm"],
  keysecondary: ["beast"],
  comment: "Dragon",
  uid: 999,
  order: 1,
});
assert(
  JSON.stringify(clean) ===
    JSON.stringify({
      content: "Updated",
      key: ["dragon", "wyrm"],
      keysecondary: ["beast"],
      comment: "Dragon",
    }),
  "Sanitization strips structural and unknown fields",
);

const original = {
  bookMeta: { keep: true },
  entries: {
    "3": {
      uid: 3,
      comment: "Old",
      content: "Old body",
      key: ["old"],
      keysecondary: [],
      position: 7,
      order: 91,
      probability: 0.4,
      customExtensionData: { keep: "yes" },
    },
    "8": {
      uid: 8,
      comment: "Delete me",
      content: "Remove",
      key: [],
      keysecondary: [],
      position: 2,
    },
  },
};
const originalSnapshot = JSON.stringify(original);

const editPlan = planEditEntry("Book", 3, {
  content: "New body",
  comment: "New title",
  position: 999,
});
const edited = applyChangePlanToBook(original, editPlan);
assert(
  edited.data.entries["3"].content === "New body" &&
    edited.data.entries["3"].comment === "New title",
  "Edit plan changes only requested editable fields",
);
assert(
  edited.data.entries["3"].position === 7 &&
    edited.data.entries["3"].order === 91 &&
    edited.data.entries["3"].probability === 0.4 &&
    edited.data.entries["3"].customExtensionData.keep === "yes",
  "Edit plan preserves structural and unknown fields",
);
assert(
  JSON.stringify(original) === originalSnapshot,
  "Applying a plan does not mutate the source document",
);
assert(edited.results[0].status === "updated", "Edit reports an updated result");

const deletePlan = planDeleteEntry("Book", 8);
const deleted = applyChangePlanToBook(original, deletePlan);
assert(
  deleted.data.entries["8"] === undefined && deleted.data.entries["3"],
  "Delete plan removes only the requested entry",
);
assert(deleted.results[0].status === "deleted", "Delete reports a deleted result");

const createPlan = planCreateEntry("Book", {
  comment: "New entry",
  content: "Created body",
  key: ["new"],
  keysecondary: [],
});
const created = applyChangePlanToBook(original, createPlan);
assert(
  created.createdUids.length === 1 &&
    created.data.entries[String(created.createdUids[0])].content === "Created body",
  "Create plan allocates and reports a new UID",
);
assert(
  created.data.entries[String(created.createdUids[0])].position === 1 &&
    created.data.entries[String(created.createdUids[0])].order === 100,
  "Create plan uses explicit safe defaults for new structural fields",
);

const rewritePlan = planRewriteEntry("Book", 3, "Rewritten body");
const resolved = applyChangePlanToBook(
  original,
  createChangePlan({
    bookName: "Book",
    operations: [
      ...rewritePlan.operations,
      ...planResolveActions("Book", [
        { uid: 8, action: "delete", reason: "Duplicate" },
        { uid: 3, action: "keep" },
      ]).operations,
    ],
  }),
);
assert(
  resolved.data.entries["3"].content === "Rewritten body" &&
    resolved.data.entries["8"] === undefined,
  "Rewrite and resolution actions compose into one plan",
);
assert(
  resolved.results.filter((result) => result.status !== "kept").length === 2,
  "Resolution results distinguish applied changes from keep actions",
);

const grouped = groupChangePlansByBook([
  planEditEntry("Book A", 1, { content: "a" }),
  planDeleteEntry("Book A", 2),
  planCreateEntry("Book B", { content: "b", comment: "B" }),
]);
assert(grouped.size === 2, "Bulk plans group by lorebook name");
assert(
  grouped.get("Book A").operations.length === 2 &&
    grouped.get("Book B").operations.length === 1,
  "Grouped plans preserve every per-book operation",
);

assertThrows(
  () => planEditEntry("Book", 3, { order: 1 }),
  "Plans reject calls with no editable fields",
);
assertThrows(
  () => applyChangePlanToBook(original, planDeleteEntry("Book", 999)),
  "Applying a plan rejects a missing entry instead of silently succeeding",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
