import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

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

console.log('\n=== Button Type Safety Tests ===\n');

// SillyTavern renders popups inside a native <dialog>. A <button> with no
// explicit type defaults to type="submit", and clicking a submit button inside
// a dialog closes the dialog — the "ragequit on Generate" bug (v0.6.x).
// Every button we create inside a popup MUST be type="button".
// This test statically scans ui.js so the bug can't silently come back.

const src = readFileSync(join(root, 'src/ui.js'), 'utf-8');

// 1. Template-literal buttons: every "<button" must declare type="button".
const openTags = src.match(/<button\b[^>]*>/g) || [];
const untypedTags = openTags.filter((tag) => !/type\s*=\s*"button"/.test(tag));
assert(openTags.length > 0, `Found ${openTags.length} <button> tag(s) to check`);
assert(
    untypedTags.length === 0,
    untypedTags.length === 0
        ? 'Every <button> tag declares type="button"'
        : `These <button> tags are missing type="button": ${untypedTags.join(' | ')}`,
);

// 2. createElement('button') buttons: each must get a `.type = 'button'`.
const created = (src.match(/createElement\(['"]button['"]\)/g) || []).length;
const typedAssignments = (src.match(/\.type\s*=\s*['"]button['"]/g) || []).length;
assert(
    created === 0 || typedAssignments >= created,
    created === 0 || typedAssignments >= created
        ? `All ${created} createElement('button') call(s) set .type = 'button'`
        : `Found ${created} createElement('button') call(s) but only ${typedAssignments} .type='button' assignment(s)`,
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
