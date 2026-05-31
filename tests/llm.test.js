import { parseLLMResponse, normalizeLLMContent } from '../src/llm.js';

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
        console.log(`  ✅ PASS: ${message} (threw: "${e.message.substring(0, 50)}...")`);
    }
}

console.log('\n=== LLM Response Parsing Tests ===\n');

// Valid JSON response
const validJson = '{"rewrittenContent": "Shorter version.", "justification": "Removed redundancy."}';
try {
    const result = parseLLMResponse(validJson);
    assert(result.rewrittenContent === 'Shorter version.', 'Parses valid JSON rewrittenContent');
    assert(result.justification === 'Removed redundancy.', 'Parses valid JSON justification');
} catch (e) {
    failed++;
    console.error(`  ❌ FAIL: Valid JSON parsing threw: ${e.message}`);
}

// JSON wrapped in code block
const codeBlockJson = '```json\n{"rewrittenContent": "Fixed grammar.", "justification": "Corrected tense."}\n```';
try {
    const result = parseLLMResponse(codeBlockJson);
    assert(result.rewrittenContent === 'Fixed grammar.', 'Extracts JSON from code block');
} catch (e) {
    failed++;
    console.error(`  ❌ FAIL: Code block JSON parsing threw: ${e.message}`);
}

// JSON with surrounding text
const messyJson = 'Here is the result:\n{"rewrittenContent": "Cleaned up.", "justification": "Tightened prose."}\nHope this helps!';
try {
    const result = parseLLMResponse(messyJson);
    assert(result.rewrittenContent === 'Cleaned up.', 'Extracts JSON from surrounding text');
} catch (e) {
    failed++;
    console.error(`  ❌ FAIL: Messy JSON parsing threw: ${e.message}`);
}

// Missing justification defaults gracefully
const noJustification = '{"rewrittenContent": "No reason given."}';
try {
    const result = parseLLMResponse(noJustification);
    assert(result.rewrittenContent === 'No reason given.', 'Handles missing justification field');
    assert(typeof result.justification === 'string', 'Provides default justification string');
} catch (e) {
    failed++;
    console.error(`  ❌ FAIL: Missing justification handling threw: ${e.message}`);
}

// Empty response throws
assertThrows(() => parseLLMResponse(''), 'Throws on empty response');
assertThrows(() => parseLLMResponse(null), 'Throws on null response');

// Invalid JSON throws
assertThrows(() => parseLLMResponse('This is not JSON at all.'), 'Throws on non-JSON response');

// Empty rewrittenContent throws
assertThrows(
    () => parseLLMResponse('{"rewrittenContent": "", "justification": "test"}'),
    'Throws on empty rewrittenContent',
);

// Trimming whitespace
const whitespaceJson = '  \n  {"rewrittenContent": "  Trimmed.  ", "justification": "  Spaces removed.  "}  \n  ';
try {
    const result = parseLLMResponse(whitespaceJson);
    assert(result.rewrittenContent === 'Trimmed.', 'Trims whitespace from rewrittenContent');
    assert(result.justification === 'Spaces removed.', 'Trims whitespace from justification');
} catch (e) {
    failed++;
    console.error(`  ❌ FAIL: Whitespace trimming threw: ${e.message}`);
}

console.log('\n=== normalizeLLMContent Tests ===\n');

// generateRaw with jsonSchema returns a JSON string → passed through as-is
const jsonStr = '{"rewrittenContent": "Hi.", "justification": "x"}';
assert(normalizeLLMContent(jsonStr) === jsonStr, 'String input is returned unchanged');

// generateRaw without schema returns a plain message string
assert(normalizeLLMContent('plain text') === 'plain text', 'Plain string returned unchanged');

// ConnectionManagerRequestService ExtractedData with string content
const extractedString = { content: '{"issues": []}', reasoning: '' };
assert(normalizeLLMContent(extractedString) === '{"issues": []}', 'Extracts string content from ExtractedData');

// ExtractedData where content is an already-parsed object (json_schema path)
const extractedObject = { content: { rewrittenContent: 'Done.', justification: 'y' }, reasoning: '' };
const normalized = normalizeLLMContent(extractedObject);
assert(typeof normalized === 'string', 'Parsed-object content is re-stringified to a string');
const reparsed = JSON.parse(normalized);
assert(reparsed.rewrittenContent === 'Done.', 'Re-stringified content round-trips through JSON.parse');

// A bare object with no content field gets stringified whole
const bareObject = { issues: [] };
assert(JSON.parse(normalizeLLMContent(bareObject)).issues.length === 0, 'Bare object without content field is stringified whole');

// Null / undefined throw a clear error
assertThrows(() => normalizeLLMContent(null), 'Throws on null');
assertThrows(() => normalizeLLMContent(undefined), 'Throws on undefined');

// End-to-end: ExtractedData object content flows through parseLLMResponse
const e2e = parseLLMResponse(normalizeLLMContent({ content: { rewrittenContent: 'E2E.', justification: 'z' } }));
assert(e2e.rewrittenContent === 'E2E.', 'ExtractedData object content parses through parseLLMResponse');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
