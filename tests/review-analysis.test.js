import {
  buildCrossBatchCandidates,
  dedupeReviewIssues,
  findLocalReviewIssues,
  formatCrossBatchCandidates,
  normalizeReviewText,
} from "../src/review-analysis.js";

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

console.log("\n=== Review Analysis Tests ===\n");

assert(
  normalizeReviewText(" Dragon-Lore  ") === "dragon lore",
  "Review text normalization is stable",
);

const entries = [
  {
    uid: 1,
    comment: "Dragon Lore",
    content: "Dragons live beneath the eastern mountain and guard the old gate.",
    key: ["dragon"],
    keysecondary: [],
  },
  {
    uid: 2,
    comment: "Dragon Lore",
    content: "Dragons live beneath the eastern mountain and guard the old gate.",
    key: ["dragon"],
    keysecondary: [],
  },
  {
    uid: 3,
    comment: "Empty Note",
    content: "",
    key: ["empty-note"],
    keysecondary: [],
  },
  {
    uid: 4,
    comment: "Long Note",
    content: "x".repeat(1200),
    key: [],
    keysecondary: [],
  },
];

const localIssues = findLocalReviewIssues(entries, { verboseChars: 100 });
assert(
  localIssues.some((issue) => issue.type === "duplicate" && issue.entries.length === 2),
  "Local preflight detects duplicate titles/content",
);
assert(
  localIssues.some((issue) => issue.type === "overlap" && issue.entries.length === 2),
  "Local preflight detects shared activation keys",
);
assert(
  localIssues.some((issue) => issue.type === "other" && issue.entries[0].uid === 3),
  "Local preflight detects empty content",
);
assert(
  localIssues.some((issue) => issue.type === "verbose" && issue.entries[0].uid === 4),
  "Local preflight detects locally oversized content",
);

const crossBatchEntries = [
  { uid: 10, comment: "Eastern Gate", content: "A", key: ["mountain gate"], keysecondary: [] },
  { uid: 11, comment: "Western Camp", content: "B", key: [], keysecondary: [] },
  { uid: 12, comment: "Eastern Gate", content: "C", key: ["mountain gate"], keysecondary: [] },
];
const batches = [[crossBatchEntries[0], crossBatchEntries[1]], [crossBatchEntries[2]]];
const candidates = buildCrossBatchCandidates(crossBatchEntries, batches);
assert(candidates.length === 1, "Cross-batch candidates exclude same-batch pairs");
assert(candidates[0].left.uid === 10 && candidates[0].right.uid === 12, "Candidate keeps exact entry UIDs");
assert(candidates[0].reason.includes("shared keys"), "Candidate explains why it was selected");
assert(formatCrossBatchCandidates(candidates).includes("uid=10"), "Candidate prompt includes source entries");

const duplicateIssues = dedupeReviewIssues([
  { type: "duplicate", entries: [{ uid: 2 }, { uid: 1 }], description: "first" },
  { type: "duplicate", entries: [{ uid: 1 }, { uid: 2 }], description: "reworded" },
  { type: "overlap", entries: [{ uid: 1 }, { uid: 2 }], description: "different" },
]);
assert(duplicateIssues.length === 2, "Review issue deduplication preserves distinct issue types");
assert(duplicateIssues[0].description === "first", "Stable issue key keeps the first finding");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
