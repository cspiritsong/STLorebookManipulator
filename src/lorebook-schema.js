function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function bookLabel(options = {}) {
  if (typeof options === "string" && options) return ` for "${options}"`;
  if (options && typeof options.bookName === "string" && options.bookName) {
    return ` for "${options.bookName}"`;
  }
  return "";
}

export class LorebookSchemaError extends Error {
  constructor(message, path = "") {
    super(message);
    this.name = "LorebookSchemaError";
    this.code = "LOREBOOK_INVALID";
    this.path = path;
  }
}

function invalid(message, path = "") {
  throw new LorebookSchemaError(message, path);
}

function normalizeUid(value, entryKey, location) {
  const candidate = value === undefined ? entryKey : value;
  if (
    candidate === null ||
    (typeof candidate === "string" && candidate.trim() === "") ||
    (typeof candidate !== "number" && typeof candidate !== "string")
  ) {
    invalid(`${location}.uid must be a non-negative integer.`, `${location}.uid`);
  }
  const uid = typeof candidate === "number" ? candidate : Number(candidate);
  if (!Number.isInteger(uid) || uid < 0) {
    invalid(`${location}.uid must be a non-negative integer.`, `${location}.uid`);
  }
  return uid;
}

function normalizeStringField(entry, name, location) {
  if (!Object.prototype.hasOwnProperty.call(entry, name)) return "";
  if (typeof entry[name] !== "string") {
    invalid(`${location}.${name} must be a string.`, `${location}.${name}`);
  }
  return entry[name];
}

function normalizeKeywordField(entry, name, location) {
  if (!Object.prototype.hasOwnProperty.call(entry, name)) return [];
  if (!Array.isArray(entry[name]) || entry[name].some((value) => typeof value !== "string")) {
    invalid(`${location}.${name} must be an array of strings.`, `${location}.${name}`);
  }
  return [...entry[name]];
}

export function normalizeLorebookEntry(entry, entryKey = "", options = {}) {
  const label = bookLabel(options);
  const location = `Invalid lorebook entry${label} at entries.${entryKey || "?"}`;
  if (!isRecord(entry)) {
    invalid(`${location}: expected an object.`, `entries.${entryKey}`);
  }

  const normalized = cloneValue(entry);
  normalized.uid = normalizeUid(entry.uid, entryKey, location);
  normalized.comment = normalizeStringField(entry, "comment", location);
  normalized.content = normalizeStringField(entry, "content", location);
  normalized.key = normalizeKeywordField(entry, "key", location);
  normalized.keysecondary = normalizeKeywordField(entry, "keysecondary", location);
  return normalized;
}

export function normalizeLorebook(data, options = {}) {
  const label = bookLabel(options);
  if (!isRecord(data)) {
    invalid(
      `Invalid lorebook data${label}: expected an object with an entries object.`,
      "",
    );
  }
  if (!Object.prototype.hasOwnProperty.call(data, "entries")) {
    invalid(`Invalid lorebook data${label}: entries is required.`, "entries");
  }
  if (!isRecord(data.entries)) {
    invalid(`Invalid lorebook data${label}: entries must be an object.`, "entries");
  }

  const normalized = cloneValue(data);
  normalized.entries = {};
  const seenUids = new Set();

  for (const [entryKey, entry] of Object.entries(data.entries)) {
    const normalizedEntry = normalizeLorebookEntry(entry, entryKey, options);
    if (seenUids.has(normalizedEntry.uid)) {
      invalid(
        `Invalid lorebook data${label}: duplicate entry UID ${normalizedEntry.uid}.`,
        `entries.${entryKey}.uid`,
      );
    }
    seenUids.add(normalizedEntry.uid);
    normalized.entries[entryKey] = normalizedEntry;
  }

  return normalized;
}

export function getLorebookEntries(data, options = {}) {
  return Object.values(normalizeLorebook(data, options).entries);
}
