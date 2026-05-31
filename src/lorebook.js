export function getLorebookNames(context) {
    if (!context || typeof context.getWorldInfoNames !== 'function') {
        console.error('[LorebookManipulator] getContext().getWorldInfoNames is not available.');
        return [];
    }
    try {
        return context.getWorldInfoNames() || [];
    } catch (e) {
        console.error('[LorebookManipulator] Failed to get lorebook names:', e);
        return [];
    }
}

export async function loadLorebook(name, context) {
    if (!name) {
        throw new Error('No lorebook name provided.');
    }
    if (!context || typeof context.loadWorldInfo !== 'function') {
        throw new Error('loadWorldInfo is not available on the current SillyTavern context.');
    }

    try {
        const data = await context.loadWorldInfo(name);
        if (!data || !data.entries) {
            return [];
        }

        return Object.values(data.entries).map(entry => ({
            uid: entry.uid,
            key: entry.key || [],
            keysecondary: entry.keysecondary || [],
            comment: entry.comment || '',
            content: entry.content || '',
            order: entry.order ?? 100,
            position: entry.position ?? 1,
            disable: entry.disable ?? false,
            constant: entry.constant ?? false,
            selective: entry.selective ?? false,
        }));
    } catch (e) {
        console.error(`[LorebookManipulator] Failed to load lorebook "${name}":`, e);
        throw new Error(`Could not load lorebook "${name}". ${e.message}`);
    }
}

export async function updateEntryContent(bookName, uid, newContent, context) {
    if (!bookName) throw new Error('No lorebook name provided.');
    if (uid === undefined || uid === null) throw new Error('No entry UID provided.');
    if (typeof newContent !== 'string') throw new Error('New content must be a string.');

    if (!context || typeof context.loadWorldInfo !== 'function' || typeof context.saveWorldInfo !== 'function') {
        throw new Error('Required SillyTavern API functions are not available.');
    }

    try {
        const data = await context.loadWorldInfo(bookName);

        if (!data || !data.entries) {
            throw new Error(`Lorebook "${bookName}" has no entries.`);
        }

        const entryKey = Object.keys(data.entries).find(k => data.entries[k].uid === uid);

        if (entryKey === undefined) {
            throw new Error(`Entry with UID ${uid} not found in "${bookName}".`);
        }

        data.entries[entryKey].content = newContent;

        await context.saveWorldInfo(bookName, data);

        if (typeof context.reloadWorldInfoEditor === 'function') {
            context.reloadWorldInfoEditor();
        }

        return true;
    } catch (e) {
        console.error(`[LorebookManipulator] Failed to update entry ${uid} in "${bookName}":`, e);
        throw new Error(`Failed to save changes: ${e.message}`);
    }
}
