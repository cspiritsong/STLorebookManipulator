import { escapeHtml, escapeAttr } from "../src/utils.js";

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

console.log("\n=== HTML Escaping Utility Tests ===\n");

// Regression test for the bug where escapeAttr was used in ui.js but only
// defined in index.js, causing "ReferenceError: escapeAttr is not defined"
// when opening the main popup. Both functions must be importable and callable.
assert(
  typeof escapeHtml === "function",
  "escapeHtml is exported and importable",
);
assert(
  typeof escapeAttr === "function",
  "escapeAttr is exported and importable",
);

// escapeHtml escapes all dangerous characters
assert(
  escapeHtml("<script>") === "&lt;script&gt;",
  "escapeHtml escapes angle brackets",
);
assert(escapeHtml("a & b") === "a &amp; b", "escapeHtml escapes ampersands");
assert(
  escapeHtml('"quoted"') === "&quot;quoted&quot;",
  "escapeHtml escapes double quotes",
);
assert(escapeHtml("it's") === "it&#39;s", "escapeHtml escapes single quotes");

// escapeHtml handles null/undefined gracefully
assert(escapeHtml(null) === "", "escapeHtml returns empty string for null");
assert(
  escapeHtml(undefined) === "",
  "escapeHtml returns empty string for undefined",
);

// escapeHtml escapes ampersand before other entities (no double-escaping)
assert(
  escapeHtml("<") === "&lt;",
  "escapeHtml does not double-escape angle bracket",
);

// escapeAttr escapes quotes for attribute safety
assert(
  escapeAttr('say "hi"') === "say &quot;hi&quot;",
  "escapeAttr escapes double quotes",
);
assert(
  escapeAttr("it's mine") === "it&#39;s mine",
  "escapeAttr escapes single quotes",
);

// escapeAttr handles null/undefined gracefully
assert(escapeAttr(null) === "", "escapeAttr returns empty string for null");
assert(
  escapeAttr(undefined) === "",
  "escapeAttr returns empty string for undefined",
);

// A lorebook name with a quote should not break the option value attribute
const trickyName = 'Bob\'s "Epic" Lore';
const escaped = escapeAttr(trickyName);
assert(
  !escaped.includes('"'),
  "escapeAttr removes raw double quotes that would break attributes",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
