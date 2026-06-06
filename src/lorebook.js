export function getLorebookNames(context) {
  if (!context || typeof context.getWorldInfoNames !== "function") {
    console.error(
      "[LorebookManipulator] getContext().getWorldInfoNames is not available.",
    );
    return [];
  }
  try {
    return context.getWorldInfoNames() || [];
  } catch (e) {
    console.error("[LorebookManipulator] Failed to get lorebook names:", e);
    return [];
  }
}

export async function loadLorebook(name, context) {
  if (!name) {
    throw new Error("No lorebook name provided.");
  }
  if (!context || typeof context.loadWorldInfo !== "function") {
    throw new Error(
      "loadWorldInfo is not available on the current SillyTavern context.",
    );
  }

  try {
    const data = await context.loadWorldInfo(name);
    if (!data || !data.entries) {
      return [];
    }

    return Object.values(data.entries).map((entry) => ({
      uid: entry.uid,
      key: entry.key || [],
      keysecondary: entry.keysecondary || [],
      comment: entry.comment || "",
      content: entry.content || "",
      order: entry.order ?? 100,
      position: entry.position ?? 1,
      disable: entry.disable ?? false,
      constant: entry.constant ?? false,
      selective: entry.selective ?? false,
    }));
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to load lorebook "${name}":`,
      e,
    );
    throw new Error(`Could not load lorebook "${name}". ${e.message}`);
  }
}

// Fields this extension is allowed to write. Everything else (position, order,
// probability, selectiveLogic, etc.) is structural and left untouched so we
// never break a lorebook's activation behaviour.
const EDITABLE_FIELDS = ["content", "key", "keysecondary", "comment"];

// Validate and normalize an incoming set of field changes. Returns a clean
// object containing ONLY known editable fields with the correct types.
// Throws on type errors so a bad call fails loudly rather than corrupting data.
export function sanitizeEntryFields(fields) {
  if (!fields || typeof fields !== "object") {
    throw new Error("No fields provided to update.");
  }

  const clean = {};

  for (const name of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields, name)) continue;
    const value = fields[name];

    if (name === "content" || name === "comment") {
      if (typeof value !== "string") {
        throw new Error(`Field "${name}" must be a string.`);
      }
      clean[name] = value;
    } else {
      // key / keysecondary are arrays of non-empty strings.
      if (!Array.isArray(value)) {
        throw new Error(`Field "${name}" must be an array of strings.`);
      }
      clean[name] = value
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter((k) => k.length > 0);
    }
  }

  if (Object.keys(clean).length === 0) {
    throw new Error("No editable fields were provided.");
  }

  return clean;
}

// Parse a comma-separated keyword string into a clean array (UI helper).
export function parseKeywordString(str) {
  if (!str || typeof str !== "string") return [];
  return str
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

// Update one or more editable fields of an entry. Only content/key/
// keysecondary/comment can be changed; all other fields are preserved.
export async function updateEntryFields(bookName, uid, fields, context) {
  if (!bookName) throw new Error("No lorebook name provided.");
  if (uid === undefined || uid === null)
    throw new Error("No entry UID provided.");

  if (
    !context ||
    typeof context.loadWorldInfo !== "function" ||
    typeof context.saveWorldInfo !== "function"
  ) {
    throw new Error("Required SillyTavern API functions are not available.");
  }

  const clean = sanitizeEntryFields(fields);

  try {
    const data = await context.loadWorldInfo(bookName);

    if (!data || !data.entries) {
      throw new Error(`Lorebook "${bookName}" has no entries.`);
    }

    const entryKey = Object.keys(data.entries).find(
      (k) => data.entries[k].uid === uid,
    );

    if (entryKey === undefined) {
      throw new Error(`Entry with UID ${uid} not found in "${bookName}".`);
    }

    // Write only the sanitized editable fields; never touch anything else.
    for (const [name, value] of Object.entries(clean)) {
      data.entries[entryKey][name] = value;
    }

    await context.saveWorldInfo(bookName, data);

    if (typeof context.reloadWorldInfoEditor === "function") {
      context.reloadWorldInfoEditor();
    }

    return true;
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to update entry ${uid} in "${bookName}":`,
      e,
    );
    throw new Error(`Failed to save changes: ${e.message}`);
  }
}

// Backward-compatible thin wrapper: update only the content field.
export async function updateEntryContent(bookName, uid, newContent, context) {
  if (typeof newContent !== "string")
    throw new Error("New content must be a string.");
  return updateEntryFields(bookName, uid, { content: newContent }, context);
}

// Create a new entry in a lorebook. Returns the new entry's UID.
export async function createEntry(bookName, fields, context) {
  if (!bookName) throw new Error("No lorebook name provided.");

  if (
    !context ||
    typeof context.loadWorldInfo !== "function" ||
    typeof context.saveWorldInfo !== "function"
  ) {
    throw new Error("Required SillyTavern API functions are not available.");
  }

  const clean = sanitizeEntryFields(fields);

  try {
    const data = await context.loadWorldInfo(bookName);

    if (!data) {
      throw new Error(`Lorebook "${bookName}" not found.`);
    }

    if (!data.entries) {
      data.entries = {};
    }

    // Find the next available UID
    const existingUids = Object.values(data.entries).map((e) => e.uid || 0);
    const nextUid = existingUids.length > 0 ? Math.max(...existingUids) + 1 : 1;

    // Build the new entry with sensible defaults for structural fields
    const newEntry = {
      uid: nextUid,
      key: clean.key || [],
      keysecondary: clean.keysecondary || [],
      comment: clean.comment || "",
      content: clean.content || "",
      order: 100,
      position: 1,
      disable: false,
      constant: false,
      selective: false,
    };

    // Store under a string key (ST convention)
    data.entries[String(nextUid)] = newEntry;

    await context.saveWorldInfo(bookName, data);

    if (typeof context.reloadWorldInfoEditor === "function") {
      context.reloadWorldInfoEditor();
    }

    return nextUid;
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to create entry in "${bookName}":`,
      e,
    );
    throw new Error(`Failed to create entry: ${e.message}`);
  }
}

// Permanently delete an entry from a lorebook. Caller is responsible for
// creating a backup first (the UI does this) so the deletion is recoverable.
export async function deleteEntry(bookName, uid, context) {
  if (!bookName) throw new Error("No lorebook name provided.");
  if (uid === undefined || uid === null)
    throw new Error("No entry UID provided.");

  if (
    !context ||
    typeof context.loadWorldInfo !== "function" ||
    typeof context.saveWorldInfo !== "function"
  ) {
    throw new Error("Required SillyTavern API functions are not available.");
  }

  try {
    const data = await context.loadWorldInfo(bookName);

    if (!data || !data.entries) {
      throw new Error(`Lorebook "${bookName}" has no entries.`);
    }

    const entryKey = Object.keys(data.entries).find(
      (k) => data.entries[k].uid === uid,
    );

    if (entryKey === undefined) {
      throw new Error(`Entry with UID ${uid} not found in "${bookName}".`);
    }

    delete data.entries[entryKey];

    await context.saveWorldInfo(bookName, data);

    if (typeof context.reloadWorldInfoEditor === "function") {
      context.reloadWorldInfoEditor();
    }

    return true;
  } catch (e) {
    console.error(
      `[LorebookManipulator] Failed to delete entry ${uid} in "${bookName}":`,
      e,
    );
    throw new Error(`Failed to delete entry: ${e.message}`);
  }
}
