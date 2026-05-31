import { batchEntries, parseReviewResponse } from '../src/llm.js';

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

function assertThrows(fn, message) {
    try {
        fn();
        failed++;
        console.error(`  ❌ FAIL: ${message} (expected error but none thrown)`);
    } catch (e) {
        passed++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

console.log('\n=== Review Batching Tests ===\n');

// Helper to build an entry of a given content size
const makeEntry = (uid, chars) => ({ uid, comment: `E${uid}`, key: [], content: 'x'.repeat(chars) });

// Small book fits in a single batch
const small = [makeEntry(1, 100), makeEntry(2, 100), makeEntry(3, 100)];
const smallBatches = batchEntries(small, 12000);
assert(smallBatches.length === 1, 'Small book produces a single batch');
assert(smallBatches[0].length === 3, 'Single batch contains all entries');

// Large book splits into multiple batches
const large = [];
for (let i = 0; i < 10; i++) large.push(makeEntry(i, 5000));
const largeBatches = batchEntries(large, 12000);
assert(largeBatches.length > 1, 'Large book splits into multiple batches');

// Every entry appears exactly once across batches (no loss, no duplication)
const flattened = largeBatches.flat();
assert(flattened.length === 10, 'All entries preserved across batches');
const uids = new Set(flattened.map(e => e.uid));
assert(uids.size === 10, 'No entry is duplicated across batches');

// A single oversized entry still gets its own batch (never dropped)
const oversized = [makeEntry(1, 50000)];
const oversizedBatches = batchEntries(oversized, 12000);
assert(oversizedBatches.length === 1, 'Single oversized entry produces one batch');
assert(oversizedBatches[0].length === 1, 'Oversized entry is not dropped');

// Empty input produces no batches
assert(batchEntries([], 12000).length === 0, 'Empty entry list produces no batches');
assert(batchEntries(null, 12000).length === 0, 'Null entry list handled gracefully');

// Batches never exceed budget except for unavoidable oversized singles
const mixed = [makeEntry(1, 6000), makeEntry(2, 6000), makeEntry(3, 6000)];
const mixedBatches = batchEntries(mixed, 12000);
const allBatchesValid = mixedBatches.every(
    b => b.length === 1 || b.reduce((sum, e) => sum + e.content.length + e.comment.length + 100, 0) <= 12000 + 6100,
);
assert(allBatchesValid, 'Batches respect the character budget (allowing single oversized entries)');

console.log('\n=== Review Response Parsing Tests ===\n');

// Valid review response
const validReview = JSON.stringify({
    issues: [
        { type: 'duplicate', severity: 'high', description: 'Entries 1 and 2 are the same.', entries: [{ uid: 1, name: 'A' }, { uid: 2, name: 'B' }] },
    ],
});
const parsed = parseReviewResponse(validReview);
assert(parsed.issues.length === 1, 'Parses a valid review with one issue');
assert(parsed.issues[0].type === 'duplicate', 'Preserves issue type');
assert(parsed.issues[0].entries.length === 2, 'Preserves affected entries');
assert(parsed.issues[0].entries[0].uid === 1, 'Preserves entry uid');

// Empty issues array is valid (clean book)
const emptyReview = JSON.stringify({ issues: [] });
assert(parseReviewResponse(emptyReview).issues.length === 0, 'Empty issues array yields no issues');

// Invalid type/severity get coerced to safe defaults
const messyReview = JSON.stringify({
    issues: [
        { type: 'nonsense', severity: 'critical', description: 'Weird one.', entries: [{ uid: 5, name: 'X' }] },
    ],
});
const messyParsed = parseReviewResponse(messyReview);
assert(messyParsed.issues[0].type === 'other', 'Invalid issue type coerced to "other"');
assert(messyParsed.issues[0].severity === 'medium', 'Invalid severity coerced to "medium"');

// Issues with no description are dropped (useless)
const noDescReview = JSON.stringify({
    issues: [
        { type: 'verbose', severity: 'low', description: '', entries: [] },
        { type: 'overlap', severity: 'low', description: 'Real issue.', entries: [] },
    ],
});
const noDescParsed = parseReviewResponse(noDescReview);
assert(noDescParsed.issues.length === 1, 'Issues with empty description are dropped');
assert(noDescParsed.issues[0].description === 'Real issue.', 'Keeps issues that have a description');

// String uid coerced to number (models sometimes return strings)
const stringUidReview = JSON.stringify({
    issues: [
        { type: 'other', severity: 'low', description: 'String uid.', entries: [{ uid: '7', name: 'Y' }] },
    ],
});
const stringUidParsed = parseReviewResponse(stringUidReview);
assert(stringUidParsed.issues[0].entries[0].uid === 7, 'String uid coerced to number');

// Code-fenced review response is parsed
const fencedReview = '```json\n' + JSON.stringify({ issues: [{ type: 'other', severity: 'low', description: 'Fenced.', entries: [] }] }) + '\n```';
assert(parseReviewResponse(fencedReview).issues.length === 1, 'Parses code-fenced review response');

// Missing issues array throws
assertThrows(() => parseReviewResponse('{"notIssues": []}'), 'Throws when "issues" array is missing');
assertThrows(() => parseReviewResponse('not json'), 'Throws on non-JSON review response');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
