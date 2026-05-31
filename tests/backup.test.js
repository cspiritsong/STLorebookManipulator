import { createBackup, getBackupHistory, restoreBackup, clearAllBackups } from '../src/backup.js';

let passed = 0;
let failed = 0;

// Minimal localStorage mock for Node.js
global.localStorage = (() => {
    const store = {};
    return {
        getItem(key) { return store[key] || null; },
        setItem(key, value) { store[key] = String(value); },
        removeItem(key) { delete store[key]; },
        clear() { Object.keys(store).forEach(k => delete store[k]); },
    };
})();

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

const TEST_BOOK = 'TestLorebook';
const SAMPLE_DATA = { entries: { '0': { uid: 0, content: 'Original entry.', key: ['test'] } } };

console.log('\n=== Backup Tests ===\n');

// Clean slate
clearAllBackups(TEST_BOOK);

// Create backup
const backup1 = createBackup(TEST_BOOK, SAMPLE_DATA, 5);
assert(backup1.timestamp > 0, 'Backup has valid timestamp');
assert(backup1.date !== undefined, 'Backup has ISO date string');
assert(JSON.stringify(backup1.data) === JSON.stringify(SAMPLE_DATA), 'Backup data matches original');

// Get history
const history1 = getBackupHistory(TEST_BOOK);
assert(history1.length === 1, 'History contains one backup after first create');
assert(history1[0].timestamp === backup1.timestamp, 'History returns correct backup');

// Create second backup
const sampleData2 = { entries: { '0': { uid: 0, content: 'Modified entry.', key: ['test'] } } };
const backup2 = createBackup(TEST_BOOK, sampleData2, 5);
const history2 = getBackupHistory(TEST_BOOK);
assert(history2.length === 2, 'History contains two backups');
assert(history2[0].timestamp === backup2.timestamp, 'Newest backup is first in history');

// Retention limit
clearAllBackups(TEST_BOOK);
for (let i = 0; i < 7; i++) {
    createBackup(TEST_BOOK, { entries: { i: { uid: i, content: `Entry ${i}` } } }, 3);
}
const limitedHistory = getBackupHistory(TEST_BOOK);
assert(limitedHistory.length === 3, 'Retention limit of 3 enforced after 7 backups');

// Deep clone verification (modifying original doesn't affect backup)
const mutableData = { entries: { '0': { uid: 0, content: 'Will change.' } } };
const backupDeep = createBackup(TEST_BOOK, mutableData, 5);
mutableData.entries['0'].content = 'Changed after backup.';
const retrievedHistory = getBackupHistory(TEST_BOOK);
const deepBackup = retrievedHistory.find(b => b.timestamp === backupDeep.timestamp);
assert(deepBackup.data.entries['0'].content === 'Will change.', 'Backup is a deep clone, unaffected by original mutation');

// Restore backup
clearAllBackups(TEST_BOOK);
const restoreData = { entries: { '0': { uid: 0, content: 'To be restored.' } } };
const restoreBackupEntry = createBackup(TEST_BOOK, restoreData, 5);
let savedData = null;
let editorReloaded = false;

restoreBackup(
    TEST_BOOK,
    restoreBackupEntry.timestamp,
    (name, data) => { savedData = data; },
    () => { editorReloaded = true; },
);

assert(savedData !== null, 'Restore calls saveWorldInfo with data');
assert(JSON.stringify(savedData) === JSON.stringify(restoreData), 'Restored data matches backup');
assert(editorReloaded === true, 'Restore triggers editor reload');

// Restore non-existent backup throws
assertThrows(
    () => restoreBackup(TEST_BOOK, 9999999999999, () => {}, () => {}),
    'Throws when restoring non-existent backup',
);

// Empty history for unknown book
const emptyHistory = getBackupHistory('NonExistentBook');
assert(emptyHistory.length === 0, 'Returns empty array for unknown lorebook');

// Clear all backups
clearAllBackups(TEST_BOOK);
const clearedHistory = getBackupHistory(TEST_BOOK);
assert(clearedHistory.length === 0, 'clearAllBackups removes all entries');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
