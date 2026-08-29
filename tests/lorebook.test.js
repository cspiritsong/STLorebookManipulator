import {
  sanitizeEntryFields,
  parseKeywordString,
  updateEntryFields,
  updateEntryContent,
  deleteEntry,
  createEntry,
  loadLorebook,
  loadLorebookData,
  executeChangePlan,
  executeChangePlans,
  restoreLorebookBackup,
} from "../src/lorebook.js";
import {
  clearAllBackups,
  getBackupHistory,
} from "../src/backup.js";
import {
  planDeleteEntry,
  planEditEntry,
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
      uid: 3,
      comment: "Preserve me",
      content: "Original body",
      key: ["keep"],
      keysecondary: [],
      position: 2,
      order: 77,
      selectiveLogic: "and",
      customExtensionData: { nested: true },
    },
  ]);
  const loadedDocument = await loadLorebookData("Book", ctx);
  assert(
    loadedDocument.entries["3"].customExtensionData.nested === true,
    "loadLorebookData returns a normalized full document for backups",
  );
  const loaded = await loadLorebook("Book", ctx);
  assert(
    loaded[0].selectiveLogic === "and" &&
      loaded[0].customExtensionData.nested === true,
    "loadLorebook preserves unknown entry fields",
  );

  await updateEntryFields("Book", 3, { content: "Updated body" }, ctx);
  assert(
    ctx._store.entries["3"].selectiveLogic === "and" &&
      ctx._store.entries["3"].customExtensionData.nested === true,
    "Updating an entry preserves unknown fields on the saved round trip",
  );
})();

await (async () => {
  const emptyContext = {
    async loadWorldInfo() {
      return { entries: {} };
    },
  };
  const entries = await loadLorebook("Empty", emptyContext);
  assert(entries.length === 0, "loadLorebook accepts an explicitly empty book");

  const malformedContext = {
    async loadWorldInfo() {
      return { entries: null };
    },
  };
  await assertRejects(
    loadLorebook("Broken", malformedContext),
    "loadLorebook rejects malformed book data",
  );

  await assertRejects(
    loadLorebook("Missing API", {}),
    "loadLorebook rejects a missing loadWorldInfo capability",
  );

  let attemptedSave = 0;
  let attemptedReload = 0;
  const saveFailureContext = {
    async loadWorldInfo() {
      return {
        entries: {
          "1": {
            uid: 1,
            comment: "Original",
            content: "Original body",
            key: [],
            keysecondary: [],
          },
        },
      };
    },
    async saveWorldInfo() {
      attemptedSave++;
      throw new Error("save transport unavailable");
    },
    reloadWorldInfoEditor() {
      attemptedReload++;
    },
  };
  await assertRejects(
    updateEntryFields("Book", 1, { content: "Changed" }, saveFailureContext),
    "updateEntryFields reports a save failure",
  );
  assert(attemptedSave === 1, "Save failure is attempted once");
  assert(attemptedReload === 0, "Editor reload is not reported after a failed save");
})();

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

console.log("\n=== Safe mutation pipeline Tests ===\n");

await (async () => {
  const ctx = makeMockContext([
    {
      uid: 4,
      comment: "Original",
      content: "Original body",
      key: ["original"],
      keysecondary: [],
      position: 3,
      order: 88,
      customExtensionData: { keep: true },
    },
  ]);
  await executeChangePlan(
    "Pipeline Book",
    planEditEntry("Pipeline Book", 4, { content: "Changed" }),
    ctx,
  );
  const history = await getBackupHistory("Pipeline Book");
  assert(history.length === 1, "Mutation pipeline creates a backup before saving");
  assert(
    ctx._store.entries["4"].position === 3 &&
      ctx._store.entries["4"].customExtensionData.keep === true,
    "Mutation pipeline preserves structural and unknown fields",
  );
})();

await (async () => {
  const store = {
    entries: {
      "1": {
        uid: 1,
        comment: "Original",
        content: "Original body",
        key: [],
        keysecondary: [],
        order: 100,
      },
    },
  };
  let reloads = 0;
  const mismatchContext = {
    async loadWorldInfo() {
      return JSON.parse(JSON.stringify(store));
    },
    async saveWorldInfo() {
      // Simulate a transport that reports success but did not persist.
    },
    reloadWorldInfoEditor() {
      reloads++;
    },
  };
  await assertRejects(
    executeChangePlan(
      "Mismatch Book",
      planEditEntry("Mismatch Book", 1, { content: "Should not claim success" }),
      mismatchContext,
    ),
    "Read-back mismatch rejects instead of claiming a successful save",
  );
  assert(reloads === 0, "Read-back mismatch does not refresh the editor as success");
})();

await (async () => {
  const stores = {
    A: {
      entries: {
        "1": { uid: 1, comment: "A1", content: "A", key: [], keysecondary: [] },
        "2": { uid: 2, comment: "A2", content: "A2", key: [], keysecondary: [] },
      },
    },
    B: {
      entries: {
        "1": { uid: 1, comment: "B1", content: "B", key: [], keysecondary: [] },
      },
    },
  };
  const saves = { A: 0, B: 0 };
  const bulkContext = {
    async loadWorldInfo(name) {
      return JSON.parse(JSON.stringify(stores[name]));
    },
    async saveWorldInfo(name, data) {
      saves[name]++;
      stores[name].entries = JSON.parse(JSON.stringify(data.entries));
    },
    reloadWorldInfoEditor() {},
  };
  const ledger = await executeChangePlans(
    [
      planEditEntry("A", 1, { content: "A updated" }),
      planDeleteEntry("A", 2),
      planEditEntry("B", 1, { content: "B updated" }),
    ],
    bulkContext,
  );
  assert(saves.A === 1 && saves.B === 1, "Bulk pipeline saves once per affected book");
  assert(
    ledger.results.every((result) => result.ok) &&
      ledger.results.find((result) => result.bookName === "A").operations.length === 2,
    "Bulk pipeline returns a per-book success ledger",
  );
})();

await (async () => {
  const restoreBook = "Restore Pipeline Book";
  await clearAllBackups(restoreBook);
  const source = { entries: { "1": { uid: 1, comment: "Old", content: "Old", key: [], keysecondary: [] } } };
  const ctx = {
    current: JSON.parse(JSON.stringify(source)),
    async loadWorldInfo() {
      return JSON.parse(JSON.stringify(this.current));
    },
    async saveWorldInfo(_name, data) {
      this.current = JSON.parse(JSON.stringify(data));
    },
    async reloadWorldInfoEditor() {},
  };
  await executeChangePlan(
    restoreBook,
    planEditEntry(restoreBook, 1, { content: "New" }),
    ctx,
  );
  const backup = (await getBackupHistory(restoreBook))[0];
  await restoreLorebookBackup(restoreBook, backup.timestamp, ctx);
  assert(ctx.current.entries["1"].content === "Old", "Restore pipeline waits for and verifies the restored save");
})();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
