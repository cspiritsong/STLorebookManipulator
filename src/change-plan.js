const hasOwn = Object.prototype.hasOwnProperty;

export const EDITABLE_ENTRY_FIELDS = Object.freeze([
  "content",
  "key",
  "keysecondary",
  "comment",
]);

const CREATE_DEFAULTS = Object.freeze({
  order: 100,
  position: 1,
  disable: false,
  constant: false,
  selective: false,
});

export class ChangePlanError extends Error {
  constructor(message, code = "CHANGE_PLAN_INVALID", details = undefined) {
    super(message);
    this.name = "ChangePlanError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeUid(uid, label = "entry UID") {
  const numeric = typeof uid === "number" ? uid : Number(uid);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new ChangePlanError(`${label} must be a non-negative integer.`);
  }
  return numeric;
}

/**
 * Return only fields that this extension is allowed to write. The function is
 * deliberately pure: it never returns references into the caller's object.
 */
export function sanitizeEntryFields(fields) {
  if (!isRecord(fields)) {
    throw new ChangePlanError("No fields provided to update.");
  }

  const clean = {};
  for (const name of EDITABLE_ENTRY_FIELDS) {
    if (!hasOwn.call(fields, name)) continue;
    const value = fields[name];

    if (name === "content" || name === "comment") {
      if (typeof value !== "string") {
        throw new ChangePlanError(`Field "${name}" must be a string.`);
      }
      clean[name] = value;
      continue;
    }

    if (!Array.isArray(value)) {
      throw new ChangePlanError(`Field "${name}" must be an array of strings.`);
    }
    clean[name] = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (Object.keys(clean).length === 0) {
    throw new ChangePlanError("No editable fields were provided.");
  }
  return clean;
}

function normalizeOperation(operation, index = 0) {
  if (!isRecord(operation)) {
    throw new ChangePlanError(
      `Change operation ${index + 1} must be an object.`,
      "CHANGE_OPERATION_INVALID",
    );
  }

  const rawType = String(operation.type || operation.action || "").toLowerCase();
  const typeAliases = {
    add: "create",
    edit: "update",
    remove: "delete",
  };
  const type = typeAliases[rawType] || rawType;

  if (type === "resolve" || type === "bulk") {
    const nested = operation.operations || operation.actions;
    if (!Array.isArray(nested)) {
      throw new ChangePlanError(
        `Change operation ${index + 1} must contain operations or actions.`,
        "CHANGE_OPERATION_INVALID",
      );
    }
    return nested.flatMap((item, nestedIndex) =>
      normalizeOperation(item, `${index + 1}.${nestedIndex + 1}`),
    );
  }

  if (type === "create") {
    return {
      type: "create",
      fields: sanitizeEntryFields(operation.fields || operation.entry || operation),
    };
  }

  if (type === "update" || type === "rewrite") {
    const uid = normalizeUid(operation.uid);
    const fields =
      type === "rewrite"
        ? { content: operation.newContent }
        : operation.fields || operation;
    return {
      type: "update",
      uid,
      fields: sanitizeEntryFields(fields),
      sourceType: type,
    };
  }

  if (type === "delete") {
    return {
      type: "delete",
      uid: normalizeUid(operation.uid),
      reason: typeof operation.reason === "string" ? operation.reason.trim() : "",
    };
  }

  if (type === "keep") {
    return {
      type: "keep",
      uid: normalizeUid(operation.uid),
      reason: typeof operation.reason === "string" ? operation.reason.trim() : "",
    };
  }

  throw new ChangePlanError(
    `Unsupported change operation "${rawType || "(missing type)"}".`,
    "CHANGE_OPERATION_INVALID",
  );
}

/**
 * Build a validated, serializable plan. Both createChangePlan("Book", ops)
 * and createChangePlan({ bookName: "Book", operations: ops }) are supported.
 */
export function createChangePlan(bookNameOrOptions, operations = []) {
  const options =
    typeof bookNameOrOptions === "string"
      ? { bookName: bookNameOrOptions, operations }
      : bookNameOrOptions || {};
  const bookName = typeof options.bookName === "string" ? options.bookName.trim() : "";
  if (!bookName) {
    throw new ChangePlanError("A lorebook name is required.", "BOOK_NAME_REQUIRED");
  }

  const rawOperations = options.operations || options.operation || [];
  const list = Array.isArray(rawOperations) ? rawOperations : [rawOperations];
  const normalizedOperations = list.flatMap((operation, index) =>
    normalizeOperation(operation, index),
  );

  return {
    version: 1,
    bookName,
    operations: normalizedOperations,
  };
}

export function planCreateEntry(bookName, fields) {
  return createChangePlan(bookName, [{ type: "create", fields }]);
}

export function planEditEntry(bookName, uid, fields) {
  return createChangePlan(bookName, [{ type: "update", uid, fields }]);
}

export function planRewriteEntry(bookName, uid, newContent) {
  return createChangePlan(bookName, [
    { type: "rewrite", uid, newContent },
  ]);
}

export function planDeleteEntry(bookName, uid, reason = "") {
  return createChangePlan(bookName, [{ type: "delete", uid, reason }]);
}

export function planResolveActions(bookName, actions) {
  if (!Array.isArray(actions)) {
    throw new ChangePlanError("Resolution actions must be an array.");
  }
  return createChangePlan(bookName, {
    type: "resolve",
    actions: actions.map((action) => ({
      type: action?.action || action?.type,
      uid: action?.uid,
      fields: action?.fields,
      newContent: action?.newContent,
      reason: action?.reason,
    })),
  });
}

export function summarizeChangePlan(plan) {
  const counts = {
    books: plan?.bookName ? 1 : 0,
    entries: 0,
    creates: 0,
    rewrites: 0,
    edits: 0,
    deletes: 0,
    keeps: 0,
  };
  for (const operation of plan?.operations || []) {
    if (operation.type === "create") {
      counts.creates++;
      counts.entries++;
    } else if (operation.type === "update") {
      counts.edits++;
      counts.entries++;
      if (operation.sourceType === "rewrite") counts.rewrites++;
    } else if (operation.type === "delete") {
      counts.deletes++;
      counts.entries++;
    } else if (operation.type === "keep") {
      counts.keeps++;
      counts.entries++;
    }
  }
  return counts;
}

/**
 * Merge plans by book without applying them. The returned Map is the ledger's
 * deterministic input: one plan means one backup/save/read-back per book.
 */
export function groupChangePlansByBook(plans) {
  if (!Array.isArray(plans)) {
    throw new ChangePlanError("Plans must be an array.");
  }
  const grouped = new Map();
  for (const plan of plans) {
    if (!plan || typeof plan.bookName !== "string") {
      throw new ChangePlanError("Every plan must have a lorebook name.");
    }
    const current = grouped.get(plan.bookName);
    grouped.set(
      plan.bookName,
      current
        ? createChangePlan(plan.bookName, [
            ...current.operations,
            ...plan.operations,
          ])
        : createChangePlan(plan.bookName, plan.operations),
    );
  }
  return grouped;
}

function entryKeyForUid(entries, uid) {
  return Object.keys(entries).find((key) => {
    const entry = entries[key];
    if (!isRecord(entry)) return false;
    const entryUid = entry.uid === undefined ? Number(key) : Number(entry.uid);
    return Number.isInteger(entryUid) && entryUid === uid;
  });
}

function nextUid(entries) {
  let max = 0;
  for (const [key, entry] of Object.entries(entries)) {
    const value = entry?.uid === undefined ? Number(key) : Number(entry.uid);
    if (Number.isInteger(value) && value >= 0) max = Math.max(max, value);
  }
  return max + 1;
}

function ensureBookDocument(bookData) {
  if (!isRecord(bookData) || !isRecord(bookData.entries)) {
    throw new ChangePlanError(
      "Cannot apply a change plan to a document without an entries object.",
      "LOREBOOK_DOCUMENT_INVALID",
    );
  }
}

/**
 * Apply a validated plan to a deep clone of a lorebook document. This is the
 * only place that mutates entries; it never writes a structural field during
 * edits/deletes and returns a per-operation result ledger.
 */
export function applyChangePlanToBook(bookData, plan) {
  ensureBookDocument(bookData);
  if (!plan || !Array.isArray(plan.operations)) {
    throw new ChangePlanError("A validated change plan is required.");
  }

  const data = deepClone(bookData);
  const results = [];
  const createdUids = [];

  for (let index = 0; index < plan.operations.length; index++) {
    const operation = plan.operations[index];
    if (operation.type === "keep") {
      const key = entryKeyForUid(data.entries, operation.uid);
      if (key === undefined) {
        throw new ChangePlanError(
          `Entry with UID ${operation.uid} was not found for keep.`,
          "ENTRY_NOT_FOUND",
          { operationIndex: index, uid: operation.uid },
        );
      }
      results.push({ index, uid: operation.uid, type: "keep", status: "kept" });
      continue;
    }

    if (operation.type === "create") {
      const uid = nextUid(data.entries);
      const fields = operation.fields;
      data.entries[String(uid)] = {
        uid,
        key: fields.key || [],
        keysecondary: fields.keysecondary || [],
        comment: fields.comment || "",
        content: fields.content || "",
        ...deepClone(CREATE_DEFAULTS),
      };
      createdUids.push(uid);
      results.push({ index, uid, type: "create", status: "created" });
      continue;
    }

    const key = entryKeyForUid(data.entries, operation.uid);
    if (key === undefined) {
      throw new ChangePlanError(
        `Entry with UID ${operation.uid} was not found for ${operation.type}.`,
        "ENTRY_NOT_FOUND",
        { operationIndex: index, uid: operation.uid },
      );
    }

    if (operation.type === "update") {
      for (const [field, value] of Object.entries(operation.fields)) {
        // The plan normalizer already filters this list. Keep this guard here
        // as a second boundary in case a caller passes a hand-built plan.
        if (!EDITABLE_ENTRY_FIELDS.includes(field)) continue;
        data.entries[key][field] = deepClone(value);
      }
      results.push({
        index,
        uid: operation.uid,
        type: operation.sourceType === "rewrite" ? "rewrite" : "update",
        status: "updated",
      });
      continue;
    }

    if (operation.type === "delete") {
      delete data.entries[key];
      results.push({
        index,
        uid: operation.uid,
        type: "delete",
        status: "deleted",
      });
      continue;
    }

    throw new ChangePlanError(
      `Unsupported normalized operation "${operation.type}".`,
      "CHANGE_OPERATION_INVALID",
    );
  }

  return { data, results, createdUids };
}

// Compatibility aliases for callers that prefer verb-oriented names.
export const makeChangePlan = createChangePlan;
export const applyChangePlan = applyChangePlanToBook;
