import { getSTContext } from "./st-context.js";
import { normalizeLorebook } from "./lorebook-schema.js";
import {
  createBackup,
  restoreBackup,
} from "./backup.js";
import {
  applyChangePlanToBook,
  createChangePlan,
  deepClone,
  groupChangePlansByBook,
  planCreateEntry,
  planDeleteEntry,
  planEditEntry,
  sanitizeEntryFields,
} from "./change-plan.js";

function isBoundaryError(error) {
  return [
    "ST_CAPABILITY_MISSING",
    "ST_CONTEXT_UNAVAILABLE",
    "LOREBOOK_INVALID",
    "LOREBOOK_READBACK_MISMATCH",
    "BACKUP_STORAGE_FULL",
    "BACKUP_STORAGE_WRITE_FAILED",
  ].includes(error?.code);
}

function cloneForCompare(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneForCompare);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, cloneForCompare(value[key])]),
  );
}

function deepEqual(left, right) {
  return JSON.stringify(cloneForCompare(left)) === JSON.stringify(cloneForCompare(right));
}

function describeDifference(expected, actual, path = "") {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual) return path || "(root)";
  if (expected === null || actual === null) return path || "(root)";
  if (typeof expected !== "object") return path || "(root)";
  if (Array.isArray(expected) !== Array.isArray(actual)) return path || "(root)";
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) return path || "(root)";
    for (let i = 0; i < expected.length; i++) {
      const difference = describeDifference(expected[i], actual[i], `${path}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    const difference = describeDifference(
      expected[key],
      actual[key],
      path ? `${path}.${key}` : key,
    );
    if (difference) return difference;
  }
  return null;
}

export class LorebookReadbackError extends Error {
  constructor(bookName, expected, actual) {
    const path = describeDifference(expected, actual);
    super(
      `Read-back verification failed for lorebook "${bookName}"${
        path ? ` at ${path}` : ""
      }. The saved state did not match the approved change; no success was reported.`,
    );
    this.name = "LorebookReadbackError";
    this.code = "LOREBOOK_READBACK_MISMATCH";
    this.bookName = bookName;
    this.expected = deepClone(expected);
    this.actual = deepClone(actual);
    this.differencePath = path;
  }
}

function getPlanForBook(bookName, plan) {
  if (!plan || !Array.isArray(plan.operations)) {
    throw new Error("A validated change plan is required.");
  }
  return createChangePlan({
    bookName,
    operations: plan.operations,
  });
}

export function getLorebookNames(context) {
  const stContext = getSTContext(context);
  try {
    const names = stContext.getWorldInfoNames() || [];
    if (!Array.isArray(names)) {
      throw new Error("SillyTavern returned an invalid lorebook-name list.");
    }
    return names;
  } catch (e) {
    console.error("[LorebookManipulator] Failed to get lorebook names:", e);
    if (isBoundaryError(e)) throw e;
    throw new Error(`Could not list lorebooks. ${e.message}`);
  }
}

export async function loadLorebookData(name, context) {
  if (!name) {
    throw new Error("No lorebook name provided.");
  }
  const stContext = getSTContext(context);

  try {
    const data = await stContext.loadWorldInfo(name);
    if (!data) {
      throw new Error(`Lorebook "${name}" was not found.`);
    }
    return normalizeLorebook(data, { bookName: name });
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to load lorebook "${name}":`,
      e,
    );
    if (isBoundaryError(e)) throw e;
    throw new Error(`Could not load lorebook "${name}". ${e.message}`);
  }
}

export async function loadLorebook(name, context) {
  const data = await loadLorebookData(name, context);
  return Object.values(data.entries);
}

export { sanitizeEntryFields };

export function parseKeywordString(str) {
  if (!str || typeof str !== "string") return [];
  return str
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Execute exactly one plan for one freshly loaded book. A plan is prepared on
 * a deep clone, backed up before persistence, saved once, read back, compared
 * to the approved result, and only then reloaded in the editor.
 */
export async function executeChangePlan(bookName, plan, context, options = {}) {
  if (!bookName) throw new Error("No lorebook name provided.");
  const stContext = getSTContext(context);
  stContext.requireCapability("loadWorldInfo");
  stContext.requireCapability("saveWorldInfo");

  const validatedPlan = getPlanForBook(bookName, plan);
  if (validatedPlan.operations.length === 0) {
    throw new Error("Cannot apply an empty change plan.");
  }

  const rawData = await stContext.loadWorldInfo(bookName);
  if (!rawData) throw new Error(`Lorebook "${bookName}" was not found.`);
  const current = normalizeLorebook(rawData, { bookName });

  // The backup is created before any write. Capacity or storage failures stop
  // here, leaving SillyTavern's source document untouched.
  const backup = options.skipBackup
    ? null
    : await createBackup(
        bookName,
        current,
        options.backupRetention ?? 5,
        options.storage,
      );

  const prepared = applyChangePlanToBook(current, validatedPlan);
  const expected = normalizeLorebook(prepared.data, { bookName });

  await stContext.saveWorldInfo(bookName, deepClone(expected));

  const readBackRaw = await stContext.loadWorldInfo(bookName);
  if (!readBackRaw) {
    throw new LorebookReadbackError(bookName, expected, readBackRaw);
  }
  const actual = normalizeLorebook(readBackRaw, { bookName });
  if (!deepEqual(actual, expected)) {
    throw new LorebookReadbackError(bookName, expected, actual);
  }

  // Reload is intentionally after read-back. A caller only receives a
  // successful result after both persistence and the visible editor refresh.
  await stContext.reloadWorldInfoEditor();

  return {
    ok: true,
    bookName,
    plan: validatedPlan,
    backup,
    data: actual,
    operations: prepared.results,
    createdUids: prepared.createdUids,
  };
}

/**
 * Apply many plans as independent per-book transactions. Each book is loaded,
 * backed up, saved, read back, and reloaded once; a failure in one book is
 * recorded without hiding successes in the other books.
 */
export async function executeChangePlans(plans, context, options = {}) {
  const grouped = groupChangePlansByBook(plans);
  const results = [];

  for (const [bookName, plan] of grouped) {
    try {
      const result = await executeChangePlan(bookName, plan, context, options);
      results.push({
        ok: true,
        bookName,
        operations: result.operations,
        createdUids: result.createdUids,
        backupTimestamp: result.backup?.timestamp || null,
      });
    } catch (error) {
      results.push({
        ok: false,
        bookName,
        operations: plan.operations.map((operation, index) => ({
          index,
          type: operation.type,
          uid: operation.uid,
          status: "failed",
        })),
        error: {
          code: error?.code || "MUTATION_FAILED",
          message: error?.message || String(error),
        },
      });
    }
  }

  return {
    ok: results.every((result) => result.ok),
    results,
    succeeded: results.filter((result) => result.ok),
    failed: results.filter((result) => !result.ok),
  };
}

export async function restoreLorebookBackup(bookName, timestamp, context, options = {}) {
  const stContext = getSTContext(context);
  stContext.requireCapability("loadWorldInfo");
  stContext.requireCapability("saveWorldInfo");

  let readBack;
  const backup = await restoreBackup(
    bookName,
    timestamp,
    (name, data) => stContext.saveWorldInfo(name, data),
    () => stContext.reloadWorldInfoEditor(),
    async (name, expected) => {
      const rawData = await stContext.loadWorldInfo(name);
      if (!rawData) throw new LorebookReadbackError(name, expected, rawData);
      readBack = normalizeLorebook(rawData, { bookName: name });
      const expectedNormalized = normalizeLorebook(expected, { bookName: name });
      if (!deepEqual(readBack, expectedNormalized)) {
        throw new LorebookReadbackError(name, expectedNormalized, readBack);
      }
      return true;
    },
    options.storage,
  );

  return { ok: true, backup, data: readBack };
}

export async function updateEntryFields(bookName, uid, fields, context, options = {}) {
  if (!bookName) throw new Error("No lorebook name provided.");
  if (uid === undefined || uid === null) {
    throw new Error("No entry UID provided.");
  }

  try {
    await executeChangePlan(
      bookName,
      planEditEntry(bookName, uid, fields),
      context,
      options,
    );
    return true;
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to update entry ${uid} in "${bookName}":`,
      e,
    );
    if (isBoundaryError(e)) throw e;
    throw new Error(`Failed to save changes: ${e.message}`, { cause: e });
  }
}

export async function updateEntryContent(bookName, uid, newContent, context, options = {}) {
  if (typeof newContent !== "string") {
    throw new Error("New content must be a string.");
  }
  return updateEntryFields(bookName, uid, { content: newContent }, context, options);
}

export async function createEntry(bookName, fields, context, options = {}) {
  if (!bookName) throw new Error("No lorebook name provided.");

  try {
    const result = await executeChangePlan(
      bookName,
      planCreateEntry(bookName, fields),
      context,
      options,
    );
    return result.createdUids[0];
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to create entry in "${bookName}":`,
      e,
    );
    if (isBoundaryError(e)) throw e;
    throw new Error(`Failed to create entry: ${e.message}`, { cause: e });
  }
}

export async function deleteEntry(bookName, uid, context, options = {}) {
  if (!bookName) throw new Error("No lorebook name provided.");
  if (uid === undefined || uid === null) {
    throw new Error("No entry UID provided.");
  }

  try {
    await executeChangePlan(
      bookName,
      planDeleteEntry(bookName, uid),
      context,
      options,
    );
    return true;
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to delete entry ${uid} in "${bookName}":`,
      e,
    );
    if (isBoundaryError(e)) throw e;
    throw new Error(`Failed to delete entry: ${e.message}`, { cause: e });
  }
}