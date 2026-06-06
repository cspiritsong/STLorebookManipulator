import {
  sanitizeEntryFields,
  parseKeywordString,
  updateEntryFields,
  updateEntryContent,
  deleteEntry,
  createEntry,
} from "../src/lorebook.js";

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

async function assertRejects(promise, message) {
  try {
    await promise;
    failed++;
    console.error(`  ❌ FAIL: ${message} (expected rejection but resolved)`);
  } catch (e) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

// Build a fresh mock SillyTavern context backed by an in-memory book.
function makeMockContext(initialEntries) {
  const store = { entries: {} };
  for (const e of initialEntries) {
    store.entries[String(e.uid)] = { ...e };
  }
  const calls = { saved: 0, reloaded: 0 };
  return {
    calls,
    _store: store,
    async loadWorldInfo() {
      // Return a deep clone so the function under test must save to persist.
      return JSON.parse(JSON.stringify(store));
    },
    async saveWorldInfo(name, data) {
      store.entries = JSON.parse(JSON.stringify(data.entries));
      calls.saved++;
    },
    reloadWorldInfoEditor() {
      calls.reloaded++;
    },
  };
}

console.log("\n=== parseKeywordString Tests ===\n");

assert(
  JSON.stringify(parseKeywordString("a, b, c")) ===
    JSON.stringify(["a", "b", "c"]),
  "Splits comma-separated keywords",
);
assert(
  JSON.stringify(parseKeywordString(" dragon ,  wyrm ")) ===
    JSON.stringify(["dragon", "wyrm"]),
  "Trims whitespace around keywords",
);
assert(
  JSON.stringify(parseKeywordString("a,,b, ,c")) ===
    JSON.stringify(["a", "b", "c"]),
  "Drops empty entries",
);
assert(
  JSON.stringify(parseKeywordString("")) === JSON.stringify([]),
  "Empty string yields empty array",
);
assert(
  JSON.stringify(parseKeywordString(null)) === JSON.stringify([]),
  "Null yields empty array",
);

console.log("\n=== sanitizeEntryFields Tests ===\n");

const clean1 = sanitizeEntryFields({
  comment: "Title",
  content: "Body",
  key: ["a", "b"],
  keysecondary: ["c"],
});
assert(
  clean1.comment === "Title" && clean1.content === "Body",
  "Keeps string fields",
);
assert(
  JSON.stringify(clean1.key) === JSON.stringify(["a", "b"]),
  "Keeps key array",
);

// Strips unknown/structural fields
const clean2 = sanitizeEntryFields({
  content: "x",
  position: 5,
  order: 99,
  uid: 3,
});
assert(
  Object.keys(clean2).length === 1 && clean2.content === "x",
  "Ignores non-editable fields (position/order/uid)",
);

// Trims and drops empty keywords in arrays
const clean3 = sanitizeEntryFields({ key: [" a ", "", "  ", "b"] });
assert(
  JSON.stringify(clean3.key) === JSON.stringify(["a", "b"]),
  "Trims and drops empty keywords in arrays",
);

// Type errors throw
assertThrows(
  () => sanitizeEntryFields({ content: 123 }),
  "Throws when content is not a string",
);
assertThrows(
  () => sanitizeEntryFields({ key: "not-an-array" }),
  "Throws when key is not an array",
);
assertThrows(
  () => sanitizeEntryFields({}),
  "Throws when no editable fields provided",
);
assertThrows(() => sanitizeEntryFields(null), "Throws when fields is null");

console.log("\n=== updateEntryFields Tests ===\n");

await (async () => {
  const ctx = makeMockContext([
    {
      uid: 1,
      comment: "Old",
      content: "Old body",
      key: ["x"],
      keysecondary: [],
      position: 1,
      order: 100,
    },
  ]);

  await updateEntryFields("Book", 1, { comment: "New", key: ["y", "z"] }, ctx);

  const saved = ctx._store.entries["1"];
  assert(saved.comment === "New", "updateEntryFields updates comment");
  assert(
    JSON.stringify(saved.key) === JSON.stringify(["y", "z"]),
    "updateEntryFields updates key",
  );
  assert(
    saved.content === "Old body",
    "updateEntryFields leaves untouched fields (content) intact",
  );
  assert(
    saved.position === 1 && saved.order === 100,
    "updateEntryFields preserves structural fields",
  );
  assert(ctx.calls.saved === 1, "updateEntryFields saves once");
  assert(ctx.calls.reloaded === 1, "updateEntryFields reloads editor");
})();

await (async () => {
  const ctx = makeMockContext([
    { uid: 2, comment: "A", content: "B", key: [], keysecondary: [] },
  ]);
  await assertRejects(
    updateEntryFields("Book", 999, { comment: "X" }, ctx),
    "updateEntryFields rejects unknown uid",
  );
  assert(
    ctx.calls.saved === 0,
    "updateEntryFields does not save when uid not found",
  );
})();

console.log("\n=== updateEntryContent (wrapper) Tests ===\n");

await (async () => {
  const ctx = makeMockContext([
    { uid: 1, comment: "T", content: "Original", key: ["k"], keysecondary: [] },
  ]);
  await updateEntryContent("Book", 1, "Rewritten", ctx);
  assert(
    ctx._store.entries["1"].content === "Rewritten",
    "updateEntryContent updates content",
  );
  assert(
    JSON.stringify(ctx._store.entries["1"].key) === JSON.stringify(["k"]),
    "updateEntryContent leaves keys intact",
  );
  await assertRejects(
    updateEntryContent("Book", 1, 123, ctx),
    "updateEntryContent rejects non-string content",
  );
})();

console.log("\n=== deleteEntry Tests ===\n");

await (async () => {
  const ctx = makeMockContext([
    { uid: 1, comment: "Keep", content: "a", key: [], keysecondary: [] },
    { uid: 2, comment: "Remove", content: "b", key: [], keysecondary: [] },
  ]);

  await deleteEntry("Book", 2, ctx);

  assert(
    ctx._store.entries["2"] === undefined,
    "deleteEntry removes the target entry",
  );
  assert(
    ctx._store.entries["1"] !== undefined,
    "deleteEntry leaves other entries intact",
  );
  assert(ctx.calls.saved === 1, "deleteEntry saves once");
  assert(ctx.calls.reloaded === 1, "deleteEntry reloads editor");

  await assertRejects(
    deleteEntry("Book", 999, ctx),
    "deleteEntry rejects unknown uid",
  );
})();

console.log("\n=== createEntry Tests ===\n");

await (async () => {
  const ctx = makeMockContext([
    { uid: 1, comment: "Existing", content: "a", key: ["k"], keysecondary: [] },
  ]);

  const newUid = await createEntry("Book", {
    comment: "New Dragon",
    content: "Dragon lore content",
    key: ["dragon", "wyrm"],
    keysecondary: ["creature"],
  }, ctx);

  assert(
    newUid === 2,
    "createEntry returns next uid (max existing + 1)",
  );
  assert(
    ctx._store.entries["2"] !== undefined,
    "createEntry adds new entry to the store",
  );
  assert(
    ctx._store.entries["2"].comment === "New Dragon",
    "createEntry sets the title",
  );
  assert(
    ctx._store.entries["2"].content === "Dragon lore content",
    "createEntry sets the content",
  );
  assert(
    JSON.stringify(ctx._store.entries["2"].key) === JSON.stringify(["dragon", "wyrm"]),
    "createEntry sets the primary keys",
  );
  assert(
    JSON.stringify(ctx._store.entries["2"].keysecondary) === JSON.stringify(["creature"]),
    "createEntry sets the secondary keys",
  );
  assert(
    ctx._store.entries["1"] !== undefined,
    "createEntry preserves existing entries",
  );
  assert(ctx.calls.saved === 1, "createEntry saves once");
  assert(ctx.calls.reloaded === 1, "createEntry reloads editor");

  // Create in empty book
  const ctx2 = makeMockContext([]);
  const firstUid = await createEntry("Book", {
    comment: "First",
    content: "First entry",
    key: [],
    keysecondary: [],
  }, ctx2);
  assert(
    firstUid === 1,
    "createEntry starts at uid 1 for empty lorebook",
  );
})();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
