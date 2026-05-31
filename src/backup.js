const STORAGE_PREFIX = 'lorebook_manipulator_backups_';

export function createBackup(bookName, bookData, retention = 5) {
    const key = STORAGE_PREFIX + bookName;
    let history = getBackupHistory(bookName);

    const backup = {
        timestamp: Date.now(),
        date: new Date().toISOString(),
        data: JSON.parse(JSON.stringify(bookData)),
    };

    history.unshift(backup);

    if (history.length > retention) {
        history = history.slice(0, retention);
    }

    try {
        localStorage.setItem(key, JSON.stringify(history));
    } catch (e) {
        console.error(`[LorebookManipulator] Failed to save backup for "${bookName}":`, e);
        throw new Error(`Backup failed: storage may be full. Try reducing backup retention in settings.`);
    }

    return backup;
}

export function getBackupHistory(bookName) {
    const key = STORAGE_PREFIX + bookName;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        console.error(`[LorebookManipulator] Failed to load backup history for "${bookName}":`, e);
        return [];
    }
}

export function restoreBackup(bookName, timestamp, saveWorldInfoFn, reloadEditorFn) {
    const history = getBackupHistory(bookName);
    const backup = history.find(b => b.timestamp === timestamp);

    if (!backup) {
        throw new Error(`Backup from ${new Date(timestamp).toLocaleString()} not found for "${bookName}".`);
    }

    saveWorldInfoFn(bookName, backup.data);

    if (reloadEditorFn) {
        reloadEditorFn();
    }

    return backup;
}

export function downloadBackup(bookName, timestamp) {
    const history = getBackupHistory(bookName);
    const backup = history.find(b => b.timestamp === timestamp);

    if (!backup) {
        throw new Error(`Backup from ${new Date(timestamp).toLocaleString()} not found for "${bookName}".`);
    }

    const blob = new Blob([JSON.stringify(backup.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeName = bookName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeName}_backup_${new Date(timestamp).toISOString().replace(/[:.]/g, '-')}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
}

export function clearAllBackups(bookName) {
    const key = STORAGE_PREFIX + bookName;
    localStorage.removeItem(key);
}
