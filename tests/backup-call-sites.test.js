import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexSource = readFileSync(join(root, "index.js"), "utf8");
const uiSource = readFileSync(join(root, "src", "ui.js"), "utf8");

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

console.log("\n=== Backup Call-Site Safety Tests ===\n");

assert(
  /async function renderBackupHistory\s*\(/.test(indexSource),
  "Settings-drawer backup history renderer is asynchronous",
);
assert(
  /const history = await getBackupHistory\(/.test(indexSource),
  "Settings-drawer awaits backup-history reads",
);
assert(
  /await restoreLorebookBackup\(/.test(indexSource),
  "Settings-drawer awaits verified restore pipeline",
);
assert(
  !/\brestoreBackup\(/.test(indexSource),
  "Settings-drawer does not bypass the verified restore pipeline",
);
assert(
  /const filename = await downloadBackup\(/.test(indexSource),
  "Settings-drawer awaits backup downloads",
);
assert(
  /await clearAllBackups\(/.test(indexSource),
  "Settings-drawer awaits backup deletion",
);
assert(
  /openRewritePopup\(\s*entry,\s*bookName,\s*settings,\s*context,\s*null,\s*async/.test(indexSource),
  "Settings-drawer editor supplies a close callback for backup refresh",
);
assert(
  !/\bcreateBackup\(/.test(uiSource),
  "Popup workflows do not create duplicate un-awaited backups outside the mutation pipeline",
);
assert(
  /await executeChangePlans\(/.test(uiSource),
  "Multi-entry resolution uses the grouped verified mutation pipeline",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
