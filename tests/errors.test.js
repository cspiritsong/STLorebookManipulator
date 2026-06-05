import { explainError, renderFriendlyError } from "../src/errors.js";

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

// Simple HTML escaper for the render test (mirrors src/utils.js behaviour).
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

console.log("\n=== explainError Tests ===\n");

// Every result must have the three guidance fields.
function hasShape(info) {
  return (
    typeof info.title === "string" &&
    info.title.length > 0 &&
    typeof info.what === "string" &&
    info.what.length > 0 &&
    typeof info.fix === "string" &&
    info.fix.length > 0
  );
}

// JSON / parsing failures
const jsonErr = explainError(
  new Error("Could not parse LLM response as JSON."),
);
assert(hasShape(jsonErr), "JSON error returns full guidance shape");
assert(/format/i.test(jsonErr.title), "JSON error title mentions format");

// Invalid XML phrasing (WREC-style) should also map to the format rule
const xmlErr = explainError("No results from AI/Invalid XML");
assert(
  /format/i.test(xmlErr.title),
  "Invalid XML phrasing maps to format guidance",
);

// Connection Manager missing
const cmErr = explainError(new Error("Connection Manager is not available"));
assert(
  /connection manager/i.test(cmErr.title),
  "Connection Manager error recognized",
);

// Profile missing
const profErr = explainError(new Error("Profile not found (ID: abc)"));
assert(/profile/i.test(profErr.title), "Missing profile error recognized");

// No connection
const noConnErr = explainError(new Error("No API is connected"));
assert(
  /no ai connection/i.test(noConnErr.title),
  "No-connection error recognized",
);

// Quota / rate limit
const quotaErr = explainError(
  new Error("Request failed with status 429: quota exceeded"),
);
assert(
  /rate-limit|quota/i.test(quotaErr.title),
  "Quota/rate-limit error recognized",
);

// Auth
const authErr = explainError(new Error("401 Unauthorized: invalid api key"));
assert(/api key/i.test(authErr.title), "Auth/API-key error recognized");

// Context length
const ctxErr = explainError(
  new Error("This model maximum context length exceeded"),
);
assert(
  /too big|context/i.test(ctxErr.title),
  "Context-length error recognized",
);

// Network/timeout
const netErr = explainError(new Error("fetch failed: ETIMEDOUT"));
assert(
  /reach the ai|network/i.test(netErr.title),
  "Network/timeout error recognized",
);

// No entries
const emptyErr = explainError(new Error("There are no entries to review."));
assert(/no entries/i.test(emptyErr.title), "Empty-lorebook error recognized");

// Storage
const storageErr = explainError(
  new Error("Backup failed: storage may be full"),
);
assert(/backup storage/i.test(storageErr.title), "Storage error recognized");

// Unknown error -> generic fallback, and keeps the raw detail
const unknownErr = explainError(new Error("Kaboom 12345 weird thing"));
assert(hasShape(unknownErr), "Unknown error still returns full guidance shape");
assert(
  unknownErr.raw === "Kaboom 12345 weird thing",
  "Unknown error preserves raw detail",
);

// Accepts plain strings and null safely
assert(hasShape(explainError("some string error")), "Accepts a plain string");
assert(hasShape(explainError(null)), "Handles null without throwing");

console.log("\n=== renderFriendlyError Tests ===\n");

const html = renderFriendlyError(new Error("Could not parse JSON"), escapeHtml);
assert(
  html.includes("lm-friendly-error"),
  "Rendered HTML has the friendly-error container",
);
assert(html.includes("lm-error-title"), "Rendered HTML has a title element");
assert(html.includes("lm-error-fix"), "Rendered HTML has a fix element");

// XSS safety: a malicious raw message must be escaped in the output.
const xssHtml = renderFriendlyError(
  new Error("<script>alert(1)</script>"),
  escapeHtml,
);
assert(
  !xssHtml.includes("<script>"),
  "Raw error text is escaped (no live script tag)",
);
assert(xssHtml.includes("&lt;script&gt;"), "Raw error text is entity-encoded");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
