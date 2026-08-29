const STORAGE_PREFIX = "lorebook_manipulator_backups_";
const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024; // 5MB typical localStorage limit
const fallbackStorage = new Map();
let configuredStorage = null;

export class BackupStorageError extends Error {
  constructor(message, code = "BACKUP_STORAGE_WRITE_FAILED", cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BackupStorageError";
    this.code = code;
    this.capacity = code === "BACKUP_STORAGE_FULL";
    if (cause !== undefined) this.cause = cause;
  }
}

export function configureBackupStorage(storage) {
  configuredStorage = storage || null;
}

export function resetBackupStorage() {
  configuredStorage = null;
}

export function createBackupStorage(storage) {
  return {
    getItem: (key) => storageGet(storage, key),
    setItem: (key, value) => storageSet(storage, key, value),
    removeItem: (key) => storageRemove(storage, key),
    keys: () => storageKeys(storage),
  };
}

function isPromiseLike(value) {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function";
}

function getDefaultStorage() {
  const browserStorage = globalThis?.localStorage;
  if (
    browserStorage &&
    typeof browserStorage.getItem === "function" &&
    typeof browserStorage.setItem === "function"
  ) {
    return browserStorage;
  }
  return fallbackStorage;
}

function resolveStorage(storage) {
  return storage || configuredStorage || getDefaultStorage();
}

function storageGet(storage, key) {
  if (typeof storage?.getItem === "function") return storage.getItem(key);
  if (typeof storage?.get === "function") return storage.get(key);
  throw new BackupStorageError(
    "Backup storage does not expose a get operation.",
    "BACKUP_STORAGE_UNAVAILABLE",
  );
}

function storageSet(storage, key, value) {
  if (typeof storage?.setItem === "function") return storage.setItem(key, value);
  if (typeof storage?.set === "function") return storage.set(key, value);
  throw new BackupStorageError(
    "Backup storage does not expose a set operation.",
    "BACKUP_STORAGE_UNAVAILABLE",
  );
}

function storageRemove(storage, key) {
  if (typeof storage?.removeItem === "function") return storage.removeItem(key);
  if (typeof storage?.delete === "function") return storage.delete(key);
  throw new BackupStorageError(
    "Backup storage does not expose a remove operation.",
    "BACKUP_STORAGE_UNAVAILABLE",
  );
}

function storageKeys(storage) {
  if (typeof storage?.keys === "function") return storage.keys();
  if (Number.isInteger(storage?.length) && typeof storage?.key === "function") {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index));
  }
  if (storage instanceof Map) return [...storage.keys()];
  throw new BackupStorageError(
    "Backup storage does not expose a key-list operation.",
    "BACKUP_STORAGE_UNAVAILABLE",
  );
}

function cloneData(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function parseHistory(raw, bookName) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(
      `[LorebookManipulator] Failed to parse backup history for "${bookName}":`,
      error,
    );
    return [];
  }
}

export function getBackupHistory(bookName, storage = undefined) {
  const resolved = resolveStorage(storage);
  const key = STORAGE_PREFIX + bookName;
  try {
    const raw = storageGet(resolved, key);
    if (isPromiseLike(raw)) {
      return Promise.resolve(raw)
        .then((value) => parseHistory(value, bookName))
        .catch((error) => {
          console.error(
            `[LorebookManipulator] Failed to load backup history for "${bookName}":`,
            error,
          );
          return [];
        });
    }
    return parseHistory(raw, bookName);
  } catch (error) {
    console.error(
      `[LorebookManipulator] Failed to load backup history for "${bookName}":`,
      error,
    );
    return [];
  }
}

function storageWriteError(bookName, error) {
  const quotaError =
    error?.name === "QuotaExceededError" ||
    error?.code === 22 ||
    error?.code === "QUOTA_EXCEEDED" ||
    /quota|storage.*full|exceed/i.test(error?.message || "");
  const code = quotaError
    ? "BACKUP_STORAGE_FULL"
    : "BACKUP_STORAGE_WRITE_FAILED";
  return new BackupStorageError(
    quotaError
      ? `Backup failed for "${bookName}": backup storage is full. Reduce retention or download and clear old backups.`
      : `Backup failed for "${bookName}": backup storage could not be written.`,
    code,
    error,
  );
}

function writeHistory(storage, key, history, bookName, backup) {
  const serialized = JSON.stringify(history);
  try {
    const result = storageSet(storage, key, serialized);
    if (isPromiseLike(result)) {
      return Promise.resolve(result)
        .then(() => backup)
        .catch((error) => {
          throw storageWriteError(bookName, error);
        });
    }
    return backup;
  } catch (error) {
    // No remove/clear fallback is attempted: a failed set must leave the
    // previous history untouched and must never destroy the source book.
    throw storageWriteError(bookName, error);
  }
}

function finishCreateBackup(bookName, bookData, retention, storage, history) {
  const backup = {
    timestamp: Date.now(),
    date: new Date().toISOString(),
    data: cloneData(bookData),
  };
  const limit = Number.isInteger(retention) && retention > 0 ? retention : 1;
  const nextHistory = [backup, ...history].slice(0, limit);
  return writeHistory(
    storage,
    STORAGE_PREFIX + bookName,
    nextHistory,
    bookName,
    backup,
  );
}

export function createBackup(bookName, bookData, retention = 5, storage = undefined) {
  const resolved = resolveStorage(storage);
  const history = getBackupHistory(bookName, resolved);
  if (isPromiseLike(history)) {
    return history.then((items) =>
      finishCreateBackup(bookName, bookData, retention, resolved, items),
    );
  }
  return finishCreateBackup(bookName, bookData, retention, resolved, history);
}

function findBackup(bookName, timestamp, history) {
  const backup = history.find((item) => item.timestamp === timestamp);
  if (!backup) {
    throw new Error(
      `Backup from ${new Date(timestamp).toLocaleString()} not found for "${bookName}".`,
    );
  }
  return backup;
}

function verifyRestored(bookName, backup, verifyWorldInfoFn) {
  if (!verifyWorldInfoFn) return backup;
  const verification = verifyWorldInfoFn(bookName, cloneData(backup.data));
  if (isPromiseLike(verification)) {
    return Promise.resolve(verification).then((result) => {
      if (result === false) {
        throw new Error(`Read-back verification failed while restoring "${bookName}".`);
      }
      return backup;
    });
  }
  if (verification === false) {
    throw new Error(`Read-back verification failed while restoring "${bookName}".`);
  }
  return backup;
}

function completeRestore(
  bookName,
  backup,
  reloadEditorFn,
  verifyWorldInfoFn,
) {
  try {
    const reloaded = reloadEditorFn ? reloadEditorFn() : undefined;
    if (isPromiseLike(reloaded)) {
      return Promise.resolve(reloaded).then(() =>
        verifyRestored(bookName, backup, verifyWorldInfoFn),
      );
    }
    return verifyRestored(bookName, backup, verifyWorldInfoFn);
  } catch (error) {
    throw error;
  }
}

export function restoreBackup(
  bookName,
  timestamp,
  saveWorldInfoFn,
  reloadEditorFn,
  verifyWorldInfoFn = undefined,
  storage = undefined,
) {
  if (typeof saveWorldInfoFn !== "function") {
    throw new Error("Restore requires a saveWorldInfo function.");
  }

  const history = getBackupHistory(bookName, storage);
  const finish = (items) => {
    const backup = findBackup(bookName, timestamp, items);
    const saved = saveWorldInfoFn(bookName, cloneData(backup.data));

    // The returned Promise deliberately includes reload and verification, so
    // callers cannot display a success state before the full restore settles.
    if (isPromiseLike(saved)) {
      return Promise.resolve(saved).then(() =>
        completeRestore(bookName, backup, reloadEditorFn, verifyWorldInfoFn),
      );
    }
    return completeRestore(bookName, backup, reloadEditorFn, verifyWorldInfoFn);
  };

  if (isPromiseLike(history)) return history.then(finish);
  return finish(history);
}

export function downloadBackup(bookName, timestamp, storage = undefined) {
  const history = getBackupHistory(bookName, storage);
  const finish = (items) => {
    const backup = findBackup(bookName, timestamp, items);
    const blob = new Blob([JSON.stringify(backup.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const safeName = bookName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeName}_backup_${new Date(timestamp).toISOString().replace(/[:.]/g, "-")}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return filename;
  };
  return isPromiseLike(history) ? history.then(finish) : finish(history);
}

export function clearAllBackups(bookName, storage = undefined) {
  return storageRemove(resolveStorage(storage), STORAGE_PREFIX + bookName);
}

function byteLength(value) {
  if (typeof TextEncoder === "function") return new TextEncoder().encode(value).length;
  return value.length;
}

function finishStorageUsage(storage, keys) {
  const relevantKeys = (keys || []).filter(
    (key) => typeof key === "string" && key.startsWith(STORAGE_PREFIX),
  );
  const readValues = relevantKeys.map((key) => {
    try {
      return storageGet(storage, key);
    } catch {
      return "";
    }
  });

  const makeResult = (values) => {
    const totalBytes = values.reduce(
      (total, value, index) =>
        total + byteLength(relevantKeys[index] + (value || "")),
      0,
    );
    const percentage =
      STORAGE_LIMIT_BYTES > 0 ? (totalBytes / STORAGE_LIMIT_BYTES) * 100 : 0;
    return {
      bytes: totalBytes,
      formatted: formatBytes(totalBytes),
      percentage: Math.round(percentage),
      count: relevantKeys.length,
      isWarning: percentage > 70,
      isCritical: percentage > 90,
    };
  };

  return readValues.some(isPromiseLike)
    ? Promise.all(readValues).then(makeResult)
    : makeResult(readValues);
}

export function getBackupStorageUsage(storage = undefined) {
  const resolved = resolveStorage(storage);
  try {
    const keys = storageKeys(resolved);
    return isPromiseLike(keys)
      ? Promise.resolve(keys).then((items) => finishStorageUsage(resolved, items))
      : finishStorageUsage(resolved, keys);
  } catch (error) {
    console.error("[LorebookManipulator] Failed to measure backup storage:", error);
    return {
      bytes: 0,
      formatted: "0 B",
      percentage: 0,
      count: 0,
      isWarning: false,
      isCritical: false,
    };
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i] || "B"}`;
}

export { STORAGE_PREFIX, STORAGE_LIMIT_BYTES };
