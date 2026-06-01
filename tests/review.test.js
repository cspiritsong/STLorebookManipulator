import { batchEntries, parseReviewResponse, reviewEntries } from '../src/llm.js';

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

async function assertRejects(promise, message) {
    try {
        await promise;
        failed++;
        console.error(`  ❌ FAIL: ${message} (expected rejection but resolved)`);
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

// ── Forgiving parser shapes (resilience) ──

// A bare array (no wrapping object) is accepted
const bareArray = JSON.stringify([
    { type: 'duplicate', severity: 'high', description: 'Bare array issue.', entries: [] },
]);
assert(parseReviewResponse(bareArray).issues.length === 1, 'Accepts a bare top-level array');

// A differently-named array property is accepted (e.g. "results")
const altKey = JSON.stringify({ results: [
    { type: 'overlap', severity: 'low', description: 'Alt-keyed issue.', entries: [] },
] });
assert(parseReviewResponse(altKey).issues.length === 1, 'Accepts a differently-named array property');

// An empty object {} means "no issues found", not an error
assert(parseReviewResponse('{}').issues.length === 0, 'Empty object yields no issues (not an error)');

// A bare empty array means "no issues found"
assert(parseReviewResponse('[]').issues.length === 0, 'Empty bare array yields no issues');

// An object with only non-array properties is genuinely unreadable -> throws
assertThrows(() => parseReviewResponse('{"foo": "bar"}'), 'Throws when no array can be found');
assertThrows(() => parseReviewResponse('not json'), 'Throws on non-JSON review response');

console.log('\n=== reviewEntries Resilience Tests ===\n');

// Mock context whose generateRaw returns a scripted reply per call. `replies`
// is an array of strings; each call returns the next one.
function makeMockContext(replies) {
    let call = 0;
    return {
        calls: () => call,
        async generateRaw() {
            const reply = replies[call] ?? replies[replies.length - 1];
            call++;
            return reply;
        },
    };
}

// Entries small enough to each be their own batch is hard to force; instead use
// large entries so batchEntries splits them. Each ~5000 chars, budget 12000 ->
// roughly 2 per batch. Use 6 entries -> 3 batches.
const bigEntries = [];
for (let i = 1; i <= 6; i++) bigEntries.push({ uid: i, comment: `E${i}`, key: [], content: 'x'.repeat(5000) });
const expectedBatches = batchEntries(bigEntries, 12000).length;

await (async () => {
    // Every batch returns a good (empty) result -> no skips.
    const good = JSON.stringify({ issues: [] });
    const ctx = makeMockContext([good]);
    const res = await reviewEntries(bigEntries, '', 2048, ctx);
    assert(res.skippedBatches === 0, 'No batches skipped when all replies are readable');
    assert(res.batchCount === expectedBatches, 'Reports the correct batch count');
})();

await (async () => {
    // First batch is unreadable on BOTH the initial attempt and the retry,
    // remaining batches are good. That batch should be skipped, not fatal.
    // Call order: batch1 attempt1 (bad), batch1 attempt2 (bad), then good...
    const bad = 'totally not json';
    const goodWithIssue = JSON.stringify({ issues: [{ type: 'other', severity: 'low', description: 'Found one.', entries: [] }] });
    const ctx = makeMockContext([bad, bad, goodWithIssue]);
    const res = await reviewEntries(bigEntries, '', 2048, ctx);
    assert(res.skippedBatches === 1, 'One unreadable batch is skipped (after retry), not fatal');
    assert(res.issues.length >= 1, 'Issues from the readable batches are still returned');
})();

await (async () => {
    // First attempt of a batch fails, but the retry succeeds -> not skipped.
    const bad = 'nope';
    const good = JSON.stringify({ issues: [] });
    // batch1: bad then good (retry works); subsequent batches: good.
    const ctx = makeMockContext([bad, good]);
    const res = await reviewEntries(bigEntries, '', 2048, ctx);
    assert(res.skippedBatches === 0, 'A batch that succeeds on retry is not skipped');
})();

await (async () => {
    // Every reply is unreadable -> the whole review fails.
    const ctx = makeMockContext(['garbage']);
    await assertRejects(reviewEntries(bigEntries, '', 2048, ctx), 'Whole review rejects only when every batch is unreadable');
})();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
