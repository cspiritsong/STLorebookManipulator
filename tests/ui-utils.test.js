import { filterEntries, computeCascadeFixedIssues } from "../src/ui.js";
import { getBackupStorageUsage } from "../src/backup.js";

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

// === filterEntries Tests ===

console.log("\n=== Entry Filter Tests ===\n");

const sampleEntries = [
  { comment: "Dragon Lore", key: ["dragon", "wyrm"], content: "Ancient fire-breathing creature of the mountains." },
  { comment: "Elven Kingdom", key: ["elves", "forest"], content: "Hidden realm deep in the enchanted forest." },
  { comment: "Dark Mage", key: ["wizard", "evil"], content: "A powerful sorcerer who serves the dragon lord." },
];

// Empty search returns all entries
assert(
  filterEntries(sampleEntries, "").length === 3,
  "Empty search returns all entries",
);

assert(
  filterEntries(sampleEntries, null).length === 3,
  "Null search returns all entries",
);

assert(
  filterEntries(sampleEntries, "  ").length === 3,
  "Whitespace-only search returns all entries",
);

// Match by entry name (comment)
assert(
  filterEntries(sampleEntries, "Elven").length === 1 &&
  filterEntries(sampleEntries, "Elven")[0].comment === "Elven Kingdom",
  "Matches entry name (case-insensitive)",
);

// Match by key
assert(
  filterEntries(sampleEntries, "wyrm").length === 1,
  "Matches primary key",
);

assert(
  filterEntries(sampleEntries, "forest").length === 1 &&
  filterEntries(sampleEntries, "forest")[0].comment === "Elven Kingdom",
  "Matches key from different entry",
);

// Match by content
assert(
  filterEntries(sampleEntries, "sorcerer").length === 1 &&
  filterEntries(sampleEntries, "sorcerer")[0].comment === "Dark Mage",
  "Matches content text",
);

// Multiple matches
assert(
  filterEntries(sampleEntries, "dragon").length === 2,
  "Matches multiple entries (Dragon Lore name + Dark Mage content)",
);

// Case insensitive
assert(
  filterEntries(sampleEntries, "DRAGON").length === 2,
  "Case-insensitive search",
);

// No matches
assert(
  filterEntries(sampleEntries, "nonexistent").length === 0,
  "No matches returns empty array",
);


// === computeCascadeFixedIssues Tests ===

console.log("\n=== FIXED Cascade Tests ===\n");

function makeIssue(uids, label = "") {
  return { entries: uids.map((uid) => ({ uid })), description: label };
}

const issueA = makeIssue([1, 2], "A");
const issueB = makeIssue([2, 3], "B");   // shares uid 2 with A
const issueC = makeIssue([4, 5], "C");   // no shared uids
const issueD = makeIssue([1], "D");      // shares uid 1 with A
const allIssues = [issueA, issueB, issueC, issueD];

// Basic cascade: fixing A should cascade to B and D (share uid 2 and 1 respectively)
const result1 = computeCascadeFixedIssues(issueA, allIssues, new Set());
assert(
  result1.has(issueA),
  "Fixed issue is included in result",
);
assert(
  result1.has(issueB),
  "Cascade includes issue sharing uid 2 with fixed issue A",
);
assert(
  result1.has(issueD),
  "Cascade includes issue sharing uid 1 with fixed issue A",
);
assert(
  !result1.has(issueC),
  "Cascade does not include unrelated issue C",
);

// Respects already-fixed set: fixing C while B is already fixed
const alreadyFixed = new Set([issueB]);
const result2 = computeCascadeFixedIssues(issueC, allIssues, alreadyFixed);
assert(
  result2.has(issueB),
  "Already-fixed set is preserved in result",
);
assert(
  result2.has(issueC),
  "Newly fixed issue C is added",
);
assert(
  result2.size === 2,
  "Only the two issues are in result (B already fixed + C newly fixed)",
);

// Null uid entries are ignored
const issueWithNull = makeIssue([null, 3], "Null");
const result3 = computeCascadeFixedIssues(issueWithNull, [issueA, issueB, issueWithNull], new Set());
assert(
  !result3.has(issueA),
  "Null uid is not used for cascade matching",
);
assert(
  result3.has(issueB),
  "Cascade matches uid 3 (ignoring null)",
);

// Single entry issue
const singleIssue = makeIssue([99], "Single");
const unrelatedIssue = makeIssue([100], "Unrelated");
const result4 = computeCascadeFixedIssues(singleIssue, [singleIssue, unrelatedIssue], new Set());
assert(
  result4.size === 1,
  "Single-issue fix only contains itself when no shared uids",
);


// === getBackupStorageUsage Tests ===

console.log("\n=== Storage Usage Formatting Tests ===\n");

// getBackupStorageUsage needs localStorage, which is available in the Node test runner
// (it returns empty results when there's no data, but we can test the shape).

// Patch localStorage for this test
const savedLocalStorage = globalThis.localStorage;

// Mock localStorage with some data
const mockStore = {};
globalThis.localStorage = {
  getItem: (key) => mockStore[key] || null,
  setItem: (key, val) => { mockStore[key] = val; },
  removeItem: (key) => { delete mockStore[key]; },
  get length() { return Object.keys(mockStore).length; },
  key: (i) => Object.keys(mockStore)[i] || null,
};

// Empty localStorage: usage should be 0
const emptyUsage = getBackupStorageUsage();
assert(
  emptyUsage.bytes >= 0,
  "Empty store returns non-negative bytes",
);
assert(
  emptyUsage.percentage === 0,
  "Empty store returns 0 percentage",
);
assert(
  typeof emptyUsage.formatted === "string",
  "Empty store returns a string for formatted",
);
assert(
  typeof emptyUsage.isWarning === "boolean",
  "isWarning is a boolean",
);
assert(
  typeof emptyUsage.isCritical === "boolean",
  "isCritical is a boolean",
);

// Populate mock data with the correct prefix key and test again
mockStore["lorebook_manipulator_backups_testBook"] = JSON.stringify({ backups: Array(50).fill({ timestamp: Date.now(), data: { entries: [] } }) });
const smallUsage = getBackupStorageUsage();
assert(
  smallUsage.bytes > 0,
  "Usage reports positive bytes when data exists",
);
assert(
  smallUsage.formatted.includes("B") || smallUsage.formatted.includes("KB") || smallUsage.formatted.includes("MB"),
  "Formatted value includes a unit (B, KB, or MB)",
);
assert(
  smallUsage.count === 1,
  "Count reports the number of backup books stored",
);

// Restore localStorage
globalThis.localStorage = savedLocalStorage;


// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
