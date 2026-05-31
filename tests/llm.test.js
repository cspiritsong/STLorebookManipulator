import { parseLLMResponse } from '../src/llm.js';

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

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
