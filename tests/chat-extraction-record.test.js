import {
  getChatExtractionRecord,
  recordChatExtraction,
} from "../src/chat-extraction-record.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

const store = {};
globalThis.localStorage = {
  getItem: (key) => store[key] || null,
  setItem: (key, value) => {
    store[key] = String(value);
  },
};

console.log("\n=== Chat Extraction Record Tests ===\n");

assert(
  getChatExtractionRecord("chat-a", "Book A") === null,
  "Missing records return null",
);
assert(
  recordChatExtraction("chat-a", "Book A", 12) === 12 &&
    getChatExtractionRecord("chat-a", "Book A") === 12,
  "Records a successful extraction endpoint",
);
assert(
  recordChatExtraction("chat-a", "Book A", 6) === 12,
  "Overlapping older extraction does not move the record backward",
);
assert(
  recordChatExtraction("chat-a", "Book B", 4) === 4 &&
    getChatExtractionRecord("chat-a", "Book A") === 12,
  "Records are isolated by lorebook",
);
assert(
  recordChatExtraction("chat-b", "Book A", 7) === 7 &&
    getChatExtractionRecord("chat-a", "Book A") === 12,
  "Records are isolated by chat",
);
assert(
  recordChatExtraction("chat-a", "Book A", -1) === null &&
    getChatExtractionRecord("chat-a", "Book A") === 12,
  "Invalid endpoints do not alter a record",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
