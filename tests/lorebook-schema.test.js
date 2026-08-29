import {
  getLorebookEntries,
  LorebookSchemaError,
  normalizeLorebook,
  normalizeLorebookEntry,
} from "../src/lorebook-schema.js";

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

function assertThrows(fn, predicate, message) {
  try {
    fn();
    failed++;
    console.error(`  ❌ FAIL: ${message} (expected error but none thrown)`);
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

console.log("\n=== Lorebook Schema and Normalization Tests ===\n");

const source = {
  name: "Book A",
  metadata: { owner: "Badi", nested: { stable: true } },
  entries: {
    "7": {
      uid: 7,
      comment: "  Dragon  ",
      content: "Dragon lore.",
      key: ["dragon", "wyrm"],
      keysecondary: [],
      position: 2,
      order: 42,
      selectiveLogic: "and",
      extensionData: { customFlag: true, nested: { value: 9 } },
    },
  },
};

const normalized = normalizeLorebook(source, { bookName: "Book A" });
assert(normalized !== source, "Returns a new lorebook object");
assert(normalized.entries !== source.entries, "Clones the entries container");
assert(
  normalized.metadata !== source.metadata &&
    normalized.metadata.nested !== source.metadata.nested,
  "Deep-clones unknown root fields",
);
assert(normalized.entries["7"].uid === 7, "Keeps the entry UID");
assert(
  normalized.entries["7"].position === 2 && normalized.entries["7"].order === 42,
  "Keeps structural activation fields",
);
assert(
  normalized.entries["7"].selectiveLogic === "and" &&
    normalized.entries["7"].extensionData.nested.value === 9,
  "Preserves unknown entry fields and nested values",
);
assert(
  JSON.stringify(getLorebookEntries(source)) ===
    JSON.stringify([source.entries["7"]]),
  "Returns entry values without mutating the source",
);

normalized.entries["7"].extensionData.nested.value = 100;
normalized.metadata.nested.stable = false;
assert(
  source.entries["7"].extensionData.nested.value === 9 &&
    source.metadata.nested.stable === true,
  "Mutating normalized data cannot mutate the source book",
);

const entry = normalizeLorebookEntry(
  { content: "Body", extension: { keep: "me" } },
  "12",
  { bookName: "Book B" },
);
assert(entry.uid === 12, "Uses a numeric entry key when UID is omitted");
assert(
  Array.isArray(entry.key) && entry.key.length === 0 &&
    Array.isArray(entry.keysecondary),
  "Fills missing keyword arrays with empty arrays",
);
assert(entry.comment === "", "Fills a missing comment with an empty string");
assert(entry.extension.keep === "me", "Keeps unknown fields on normalized entries");

const empty = normalizeLorebook({ entries: {} }, { bookName: "Empty" });
assert(Object.keys(empty.entries).length === 0, "Accepts an explicitly empty lorebook");
assert(getLorebookEntries(empty).length === 0, "Returns no entries for an empty lorebook");

const invalidCases = [
  [null, "expected an object"],
  [{}, "entries"],
  [{ entries: [] }, "entries"],
  [{ entries: { one: null } }, "entry"],
  [{ entries: { one: { uid: 1, key: "dragon" } } }, "key"],
  [{ entries: { one: { uid: 1, key: [], keysecondary: ["ok", 2] } } }, "keysecondary"],
  [{ entries: { one: { uid: null } } }, "uid"],
  [
    { entries: { one: { uid: 1 }, two: { uid: 1 } } },
    "duplicate",
  ],
];
for (const [value, expectedText] of invalidCases) {
  assertThrows(
    () => normalizeLorebook(value, { bookName: "Broken" }),
    (error) =>
      error instanceof LorebookSchemaError &&
      error.code === "LOREBOOK_INVALID" &&
      error.message.toLowerCase().includes(expectedText),
    `Rejects malformed lorebook data (${expectedText})`,
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
