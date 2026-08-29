import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "src", "ui.js"), "utf8");
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

console.log("\n=== UI Runtime Safety Tests ===\n");
assert(
  /function captureActiveElement\s*\(/.test(source),
  "Popup focus capture helper is defined",
);
assert(
  /function restoreFocus\s*\(/.test(source),
  "Popup focus restore helper is defined",
);
assert(
  /function whenPopupCloses\s*\(/.test(source),
  "Popup close lifecycle helper is defined",
);
assert(
  /uiState\s*=\s*selectBook\(uiState, bookName\)/.test(source),
  "Book loading establishes selected-book state before token checks",
);
assert(
  /if \(!isCurrentUIOperation\(uiState, operationToken\)\) return false;/.test(source),
  "Late load results are rejected before repainting the UI",
);
assert(
  /function renderPopupBackupHistory\(bookName, isCurrent/.test(source),
  "Backup-history rendering accepts an operation-currentness guard",
);
assert(
  /await renderPopupBackupHistory\(bookName,\s*\(\) =>\s*isCurrentUIOperation\(uiState, operationToken\)\s*,?\s*\)/.test(source),
  "Book loading guards the asynchronous backup-history repaint",
);
assert(
  /const popupResult = popup\.show\(\);/.test(source) &&
    /const result = await popupResult;/.test(source),
  "Entry creation waits for the popup result instead of reading it before completion",
);
assert(
  !/const result = await popup\.result;/.test(source),
  "Entry creation does not await the non-Promise popup result property",
);
assert(
  /activeReviewToken/.test(source) &&
    /beginUIOperation\(uiState, "review"/.test(source),
  "Review workflows receive an operation-scoped state token",
);
assert(
  /if \(!isCurrentReview\(reviewToken\)\)/.test(source),
  "Late review results are checked against the current selected-book operation",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
