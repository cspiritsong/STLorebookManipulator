import { computeDiff, renderInlineDiff, renderSideBySideDiff } from '../src/diff.js';

// Minimal DOM mock for escapeHtml (uses document.createElement)
global.document = {
    createElement(tag) {
        if (tag === 'div') {
            let _text = '';
            return {
                set textContent(val) { _text = String(val); },
                get innerHTML() {
                    return _text
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
                },
            };
        }
        return {};
    },
};

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

console.log('\n=== Diff Computation Tests ===\n');

// Identical texts produce all 'equal' parts
const identical = computeDiff('hello world', 'hello world');
assert(identical.every(p => p.type === 'equal'), 'Identical texts produce only equal parts');
assert(identical.map(p => p.value).join('') === 'hello world', 'Identical text values preserved');

// Completely different texts
const totalReplace = computeDiff('old text', 'new words');
const hasDelete = totalReplace.some(p => p.type === 'delete');
const hasInsert = totalReplace.some(p => p.type === 'insert');
assert(hasDelete && hasInsert, 'Completely different texts have both delete and insert parts');

// Partial edit
const partialEdit = computeDiff('the quick brown fox', 'the slow brown fox');
const deletedQuick = partialEdit.some(p => p.type === 'delete' && p.value.includes('quick'));
const insertedSlow = partialEdit.some(p => p.type === 'insert' && p.value.includes('slow'));
const keptThe = partialEdit.some(p => p.type === 'equal' && p.value.includes('the'));
assert(deletedQuick, 'Partial edit detects deletion of "quick"');
assert(insertedSlow, 'Partial edit detects insertion of "slow"');
assert(keptThe, 'Partial edit preserves unchanged "the"');

// Empty old text (pure insertion)
const pureInsert = computeDiff('', 'brand new content');
assert(pureInsert.every(p => p.type === 'insert'), 'Empty old text produces only inserts');

// Empty new text (pure deletion)
const pureDelete = computeDiff('remove all of this', '');
assert(pureDelete.every(p => p.type === 'delete'), 'Empty new text produces only deletes');

// Both empty
const bothEmpty = computeDiff('', '');
assert(bothEmpty.length === 0, 'Both empty produces empty diff');

// Reconstruction check: concatenating equal+delete should give original
const testOld = 'alpha beta gamma delta';
const testNew = 'alpha BETA gamma epsilon';
const diffResult = computeDiff(testOld, testNew);
const reconstructedOld = diffResult.filter(p => p.type !== 'insert').map(p => p.value).join('');
const reconstructedNew = diffResult.filter(p => p.type !== 'delete').map(p => p.value).join('');
assert(reconstructedOld === testOld, 'Reconstructing old text from diff matches original');
assert(reconstructedNew === testNew, 'Reconstructing new text from diff matches suggestion');

console.log('\n=== Diff Rendering Tests ===\n');

// Inline diff contains expected tags
const sampleDiff = computeDiff('keep remove add', 'keep ADD add');
const inlineHtml = renderInlineDiff(sampleDiff);
assert(inlineHtml.includes('lm-diff-inline'), 'Inline diff has correct container class');
assert(inlineHtml.includes('<del'), 'Inline diff contains del tag for deletions');
assert(inlineHtml.includes('<ins'), 'Inline diff contains ins tag for insertions');
assert(inlineHtml.includes('lm-diff-equal'), 'Inline diff contains equal spans');

// Side-by-side diff structure
const sbsHtml = renderSideBySideDiff(sampleDiff);
assert(sbsHtml.includes('lm-diff-side-by-side'), 'Side-by-side diff has correct container class');
assert(sbsHtml.includes('lm-diff-original'), 'Side-by-side diff has original column');
assert(sbsHtml.includes('lm-diff-suggestion'), 'Side-by-side diff has suggestion column');
assert(sbsHtml.includes('Original'), 'Side-by-side diff labels original column');
assert(sbsHtml.includes('Suggestion'), 'Side-by-side diff labels suggestion column');

// HTML escaping
const xssDiff = [{ type: 'insert', value: '<script>alert("xss")</script>' }];
const escapedHtml = renderInlineDiff(xssDiff);
assert(!escapedHtml.includes('<script>'), 'HTML special characters are escaped in diff output');
assert(escapedHtml.includes('&lt;script&gt;'), 'Script tags are properly entity-encoded');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
