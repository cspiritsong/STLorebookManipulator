import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tests = [
    'syntax.test.js',
    'button-type.test.js',
    'utils.test.js',
    'errors.test.js',
    'llm.test.js',
    'review.test.js',
    'resolve.test.js',
    'diff.test.js',
    'backup.test.js',
    'lorebook.test.js',
];

let totalPassed = true;

console.log('╔══════════════════════════════════════╗');
console.log('║   STLorebookManipulator Test Suite   ║');
console.log('╚══════════════════════════════════════╝\n');

for (const test of tests) {
    const testPath = join(__dirname, test);
    console.log(`▶ Running ${test}...`);
    try {
        const output = execSync(`node --experimental-vm-modules "${testPath}"`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        console.log(output);
    } catch (e) {
        console.error(e.stdout || '');
        console.error(e.stderr || '');
        totalPassed = false;
    }
    console.log('─'.repeat(40));
}

if (totalPassed) {
    console.log('\n✅ All test files completed successfully.\n');
    process.exit(0);
} else {
    console.log('\n❌ Some tests failed. See output above.\n');
    process.exit(1);
}
