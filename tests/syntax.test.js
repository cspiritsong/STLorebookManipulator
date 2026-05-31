import { execFileSync } from 'child_process';
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

console.log('\n=== Syntax Check Tests ===\n');

// Every shipped JS file must parse. This catches errors in files the other
// tests can't import (ui.js, index.js reference jQuery/SillyTavern/document
// globals), where a stray token would silently break module load at runtime
// and, for example, make the quick-access button never get injected.
// Regression test for v0.4.0: a stray "});" in ui.js broke the whole module.
const files = [
    'index.js',
    'src/ui.js',
    'src/lorebook.js',
    'src/llm.js',
    'src/diff.js',
    'src/backup.js',
    'src/utils.js',
];

for (const file of files) {
    let ok = true;
    let err = '';
    try {
        execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' });
    } catch (e) {
        ok = false;
        err = (e.stderr || e.stdout || e.message || '').toString().split('\n').slice(0, 2).join(' ');
    }
    assert(ok, `${file} parses without syntax errors${ok ? '' : ` (${err})`}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
