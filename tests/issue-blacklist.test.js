import {
  clearIgnoredIssues,
  filterIgnoredIssues,
  getIgnoredIssueKeys,
  getIssueFingerprint,
  ignoreIssue,
} from "../src/issue-blacklist.js";

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

const originalStorage = globalThis.localStorage;
const store = {};
globalThis.localStorage = {
  getItem: (key) => store[key] || null,
  setItem: (key, value) => {
    store[key] = value;
  },
  removeItem: (key) => {
    delete store[key];
  },
};

console.log("\n=== Issue Blacklist Tests ===\n");

const issueA = { type: "verbose", entries: [{ uid: 5 }, { uid: 2 }] };
const issueAReworded = { type: "verbose", entries: [{ uid: 2 }, { uid: 5 }] };
const issueB = { type: "duplicate", entries: [{ uid: 2 }, { uid: 5 }] };

assert(
  getIssueFingerprint("Book", issueA) ===
    getIssueFingerprint("Book", issueAReworded),
  "Fingerprint is stable when entry order changes",
);
assert(
  getIssueFingerprint("Book", issueA) !== getIssueFingerprint("Book", issueB),
  "Fingerprint distinguishes issue types",
);

ignoreIssue("Book", issueA);
assert(
  getIgnoredIssueKeys("Book").size === 1,
  "Ignored issue is persisted per book",
);
assert(
  filterIgnoredIssues("Book", [issueAReworded, issueB]).length === 1,
  "Filtering hides the matching issue but keeps other types",
);
clearIgnoredIssues("Book");
assert(
  getIgnoredIssueKeys("Book").size === 0,
  "Clear removes ignored issue keys",
);

globalThis.localStorage = originalStorage;
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
