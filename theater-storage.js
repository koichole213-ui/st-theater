// theater-storage: receives live state and cross-feature callbacks from index.js.
import { normalizeCollections, historyOrder, remapHistoryImport, newHistoryKey, historyKey, remapHistorySource, orderedHistory } from './history-collections.js';
import { normalizeLongDreamRecord, recoverInterruptedLongDreamMemory } from './long-dream.js';
import { normalizeTagList, itemTags } from './tag-system.js';
import { previousResults } from './result-text-edit.js';

export function createTheaterStorage(runtime) {
// @theater-source-begin idbReq
function idbReq(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB error'));
    });
}
// @theater-source-end idbReq

// @theater-source-begin idbTransactionDone
function idbTransactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
}
// @theater-source-end idbTransactionDone

// @theater-source-begin storageInit
async function storageInit() {
    try {
        runtime.idb = await new Promise((resolve, reject) => {
            const req = indexedDB.open('st-theater', 2);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('dreams')) db.createObjectStore('dreams', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('open failed'));
        });
    } catch (e) {
        console.warn('[Theater] IndexedDB 不可用，回退到 settings 存储:', e);
        runtime.runtimeLog('warn', '本地存档：IndexedDB 不可用，回退到 settings 内存储');
        runtime.idb = null;
    }

    if (!runtime.idb) {
        runtime.runtimeLog('info', '存档迁移：使用 settings 回退路径，无需迁移');
        // 回退模式：直接引用 settings 里的数组，行为和旧版一致
        if (!Array.isArray(runtime.settings.history)) runtime.settings.history = [];
        if (!Array.isArray(runtime.settings.recentGenerations)) runtime.settings.recentGenerations = [];
        if (!Array.isArray(runtime.settings.longDreams)) runtime.settings.longDreams = [];
        runtime.settings.history.forEach((h, i) => { if (h.id === undefined || h.id === null) h.id = i + 1; });
        runtime.historyCache = runtime.settings.history;
        runtime.historyCollections = normalizeCollections(runtime.settings.historyCollections, runtime.historyCache);
        runtime.recentCache = runtime.settings.recentGenerations;
        runtime.currentGenerationResult = runtime.settings.currentGenerationResult || null;
        runtime.longDreamCache = runtime.settings.longDreams
            .map(record => normalizeLongDreamRecord(record))
            .map(record => recoverInterruptedLongDreamMemory(record))
            .filter(Boolean);
        runtime.settings.longDreams = runtime.longDreamCache;
        return;
    }

    const fallbackCurrentResult = runtime.settings.currentGenerationResult?.html ? runtime.settings.currentGenerationResult : null;
    if (runtime.settings.currentGenerationResult?.html && !runtime.settings.history?.length) {
        try {
            await idbReq(runtime.idb.transaction('kv', 'readwrite').objectStore('kv').put(runtime.settings.currentGenerationResult, 'current-result'));
            runtime.settings.currentGenerationResult = null;
            runtime.save();
        } catch { toastr.warning('当前生成结果迁移失败，原数据仍保留'); }
    }
    // 迁移：把还留在 settings 里的旧数据搬进 IndexedDB（搬成功才清空 settings）
    try {
        if (Array.isArray(runtime.settings.history) && runtime.settings.history.length) {
            const n = runtime.settings.history.length;
            runtime.runtimeLog('info', '存档迁移开始', { type: 'history', count: n });
            const existing = (await idbReq(runtime.idb.transaction('history').objectStore('history').getAll())) || [];
            const existingFolders = (await idbReq(runtime.idb.transaction('kv').objectStore('kv').get('history-collections'))) || [];
            let order = Math.max(0, ...existing.map(historyOrder));
            const mapping = new Map();
            const imported = remapHistoryImport(runtime.settings.history, runtime.settings.historyCollections);
            const migrated = imported.items.map((h, index) => {
                const id = newHistoryKey();
                mapping.set(String(runtime.settings.history[index].id), id);
                return { ...h, id, chapterId: h.chapterId || historyKey(h), historyOrder: ++order, tags: normalizeTagList(h.tags) };
            });
            const migratedFolders = imported.folders.map(folder => ({ ...folder, itemIds: folder.itemIds.map(id => mapping.get(id)).filter(Boolean) }));
            const transaction = runtime.idb.transaction(['history', 'kv'], 'readwrite');
            const completed = idbTransactionDone(transaction);
            const store = transaction.objectStore('history');
            for (const h of migrated) store.add(h);
            transaction.objectStore('kv').put([...existingFolders, ...migratedFolders], 'history-collections');
            if (fallbackCurrentResult) transaction.objectStore('kv').put(remapHistorySource(fallbackCurrentResult, imported.chapterMapping, mapping), 'current-result');
            await completed;
            if (Array.isArray(runtime.settings.recentGenerations)) runtime.settings.recentGenerations = runtime.settings.recentGenerations.map(item => remapHistorySource(item, imported.chapterMapping, mapping));
            runtime.settings.historyCollections = [];
            if (fallbackCurrentResult) runtime.settings.currentGenerationResult = null;
            runtime.settings.history = [];
            runtime.save();
            runtime.runtimeLog('info', '存档迁移完成', { type: 'history', count: n });
            console.log(`[Theater] ${n} 条历史已迁移到 IndexedDB`);
        }
        if (!runtime.settings.history?.length && Array.isArray(runtime.settings.historyCollections) && runtime.settings.historyCollections.length) {
            const existingFolders = (await idbReq(runtime.idb.transaction('kv').objectStore('kv').get('history-collections'))) || [];
            const tx = runtime.idb.transaction('kv', 'readwrite');
            const done = idbTransactionDone(tx);
            tx.objectStore('kv').put([...existingFolders, ...normalizeCollections(runtime.settings.historyCollections).map(folder => ({ ...folder, id: newHistoryKey(), itemIds: [] }))], 'history-collections');
            await done;
            runtime.settings.historyCollections = []; runtime.save();
        }
        if (Array.isArray(runtime.settings.recentGenerations) && runtime.settings.recentGenerations.length) {
            runtime.runtimeLog('info', '存档迁移开始', { type: 'recent', count: runtime.settings.recentGenerations.length });
            await idbReq(runtime.idb.transaction('kv', 'readwrite').objectStore('kv').put(runtime.settings.recentGenerations.slice(0, 3), 'recent'));
            runtime.settings.recentGenerations = [];
            runtime.save();
            runtime.runtimeLog('info', '存档迁移完成', { type: 'recent' });
        }
        if (Array.isArray(runtime.settings.longDreams) && runtime.settings.longDreams.length) {
            const dreams = runtime.settings.longDreams.map(normalizeLongDreamRecord).filter(Boolean);
            runtime.runtimeLog('info', '存档迁移开始', { type: 'long-dream', count: dreams.length });
            const transaction = runtime.idb.transaction('dreams', 'readwrite');
            const completed = idbTransactionDone(transaction);
            const store = transaction.objectStore('dreams');
            for (const dream of dreams) {
                const copy = { ...dream };
                delete copy.id;
                store.add(copy);
            }
            await completed;
            runtime.settings.longDreams = [];
            runtime.save();
            runtime.runtimeLog('info', '存档迁移完成', { type: 'long-dream', count: dreams.length });
        }
    } catch (e) {
        console.error('[Theater] 存档迁移失败:', e);
        runtime.runtimeLog('error', '存档迁移失败', { message: e?.message || String(e) });
        toastr.error('小剧场存档迁移失败，旧数据保留在原位：' + (e?.message || e));
    }

    try {
        runtime.historyCache = orderedHistory((await idbReq(runtime.idb.transaction('history').objectStore('history').getAll())) || []);
        runtime.historyCollections = normalizeCollections((await idbReq(runtime.idb.transaction('kv').objectStore('kv').get('history-collections'))) || runtime.settings.historyCollections, runtime.historyCache);
        runtime.recentCache = (await idbReq(runtime.idb.transaction('kv').objectStore('kv').get('recent'))) || [];
        runtime.currentGenerationResult = (await idbReq(runtime.idb.transaction('kv').objectStore('kv').get('current-result'))) || null;
        runtime.longDreamCache = ((await idbReq(runtime.idb.transaction('dreams').objectStore('dreams').getAll())) || [])
            .map(record => normalizeLongDreamRecord(record))
            .map(record => recoverInterruptedLongDreamMemory(record))
            .filter(Boolean);
    } catch (e) {
        console.error('[Theater] 读取本地仓库失败:', e);
        runtime.historyCache = [];
        runtime.recentCache = [];
        runtime.longDreamCache = [];
        toastr.error('读取小剧场存档失败：' + (e?.message || e));
    }
}
// @theater-source-end storageInit

// @theater-source-begin histAdd
function histAdd(item) { return queueHistoryWrite(() => histAddStorage(item)); }
// @theater-source-end histAdd

// @theater-source-begin histAddStorage
async function histAddStorage(item) {
    if (!runtime.idb) {
        item.id = runtime.historyCache.reduce((m, h) => Math.max(m, Number(h.id) || 0), 0) + 1;
        runtime.historyCache.push(item);
        runtime.save();
        return true;
    }
    try {
        const tx = runtime.idb.transaction('history', 'readwrite');
        const done = idbTransactionDone(tx);
        item.id = await idbReq(tx.objectStore('history').add(item));
        await done;
        runtime.historyCache.push(item);
        return true;
    } catch (e) {
        console.error('[Theater] 保存历史失败:', e);
        toastr.error('保存失败（本地数据库写入出错）：' + (e?.message || e));
        return false;
    }
}
// @theater-source-end histAddStorage

// @theater-source-begin histDelete
function histDelete(ids) { return queueHistoryWrite(() => histDeleteStorage(ids)); }
// @theater-source-end histDelete

// @theater-source-begin histDeleteStorage
async function histDeleteStorage(ids) {
    const removeFromCache = () => {
        for (const id of ids) {
            const i = runtime.historyCache.findIndex(h => h.id === id);
            if (i !== -1) runtime.historyCache.splice(i, 1);
        }
    };
    if (!runtime.idb) {
        removeFromCache();
        runtime.save();
        return true;
    }
    try {
        const tx = runtime.idb.transaction('history', 'readwrite');
        const store = tx.objectStore('history');
        for (const id of ids) store.delete(id);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('aborted'));
        });
        removeFromCache();
        return true;
    } catch (e) {
        console.error('[Theater] 删除历史失败:', e);
        toastr.error('删除失败（本地数据库出错）：' + (e?.message || e));
        return false;
    }
}
// @theater-source-end histDeleteStorage

// @theater-source-begin recentPersist
async function recentPersist(recent = runtime.recentCache, current = runtime.currentGenerationResult) {
    if (!runtime.idb) {
        runtime.settings.recentGenerations = recent.slice(0, 3);
        runtime.settings.currentGenerationResult = current;
        runtime.save(); return true;
    }
    try {
        const tx = runtime.idb.transaction('kv', 'readwrite');
        const done = new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('aborted'));
        });
        tx.objectStore('kv').put(recent.slice(0, 3), 'recent');
        tx.objectStore('kv').put(current, 'current-result');
        await done;
        return true;
    } catch (e) {
        console.error('[Theater] 保存最近生成失败:', e);
        toastr.error('本地保存失败，原有结果已保留，请先保存重要作品');
        return false;
    }
}
// @theater-source-end recentPersist

// @theater-source-begin queueResultStorage
function queueResultStorage(operation) {
    const task = runtime.resultStorageQueue.then(operation);
    runtime.resultStorageQueue = task.catch(() => {});
    return task;
}
// @theater-source-end queueResultStorage

// @theater-source-begin archiveCurrentResult
function archiveCurrentResult() {
    return queueResultStorage(async () => {
        if (!runtime.currentGenerationResult) return true;
        const next = previousResults(runtime.currentGenerationResult, runtime.recentCache);
        if (!await recentPersist(next, null)) return false;
        runtime.recentCache = next;
        runtime.currentGenerationResult = null;
        runtime.resultReader?.refresh();
        return true;
    });
}
// @theater-source-end archiveCurrentResult

// @theater-source-begin storeCurrentResult
function storeCurrentResult(item) {
    return queueResultStorage(async () => {
        if (!await recentPersist(runtime.recentCache, item)) return false;
        runtime.currentGenerationResult = item;
        return true;
    });
}
// @theater-source-end storeCurrentResult

// @theater-source-begin updateResultItem
function updateResultItem(item, html, mode) {
    return queueResultStorage(async () => {
        const text = runtime.htmlToPlainText(html);
        const updated = { ...item, html, mode, continuationRounds: [text] };
        const next = runtime.recentCache.map(entry => entry === item ? updated : entry);
        const current = runtime.currentGenerationResult === item ? updated : runtime.currentGenerationResult;
        if (!await recentPersist(next, current)) return false;
        // Keep the reader's pinned identity so completing a generation never replaces it.
        Object.assign(item, updated);
        return true;
    });
}
// @theater-source-end updateResultItem

// @theater-source-begin longDreamAdd
async function longDreamAdd(record) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) return false;
    if (!runtime.idb) {
        normalized.id = runtime.longDreamCache.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
        runtime.longDreamCache.unshift(normalized);
        runtime.settings.longDreams = runtime.longDreamCache;
        runtime.save();
        return normalized;
    }
    try {
        const copy = { ...normalized };
        delete copy.id;
        copy.id = await idbReq(runtime.idb.transaction('dreams', 'readwrite').objectStore('dreams').add(copy));
        runtime.longDreamCache.unshift(copy);
        return copy;
    } catch (e) {
        console.error('[Theater] 保存长梦失败:', e);
        toastr.error('保存长梦失败（本地数据库写入出错）：' + (e?.message || e));
        return false;
    }
}
// @theater-source-end longDreamAdd

// @theater-source-begin longDreamPut
async function longDreamPut(record) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized?.id) return false;
    if (!runtime.idb) {
        const index = runtime.longDreamCache.findIndex(item => item.id === normalized.id);
        if (index === -1) return false;
        runtime.longDreamCache[index] = normalized;
        runtime.settings.longDreams = runtime.longDreamCache;
        runtime.save();
        return normalized;
    }
    try {
        await idbReq(runtime.idb.transaction('dreams', 'readwrite').objectStore('dreams').put(normalized));
        const index = runtime.longDreamCache.findIndex(item => item.id === normalized.id);
        if (index !== -1) runtime.longDreamCache[index] = normalized;
        return normalized;
    } catch (e) {
        console.error('[Theater] 更新长梦失败:', e);
        toastr.error('更新长梦失败（本地数据库写入出错）：' + (e?.message || e));
        return false;
    }
}
// @theater-source-end longDreamPut

// @theater-source-begin longDreamDelete
async function longDreamDelete(id) {
    if (!id) return false;
    if (!runtime.idb) {
        runtime.longDreamCache = runtime.longDreamCache.filter(item => item.id !== id);
        runtime.settings.longDreams = runtime.longDreamCache;
        runtime.save();
        return true;
    }
    try {
        await idbReq(runtime.idb.transaction('dreams', 'readwrite').objectStore('dreams').delete(id));
        runtime.longDreamCache = runtime.longDreamCache.filter(item => item.id !== id);
        return true;
    } catch (e) {
        console.error('[Theater] 删除长梦失败:', e);
        toastr.error('删除长梦失败（本地数据库写入出错）：' + (e?.message || e));
        return false;
    }
}
// @theater-source-end longDreamDelete

// @theater-source-begin histPut
function histPut(item) { return queueHistoryWrite(() => histPutStorage(item)); }
// @theater-source-end histPut

// @theater-source-begin histPutStorage
async function histPutStorage(item) {
    if (!item?.id) return false;
    const normalized = { ...item, tags: itemTags(item, runtime.settings.instructionTags) };
    const index = runtime.historyCache.findIndex(history => history.id === item.id);
    if (!runtime.idb) {
        if (index !== -1) runtime.historyCache[index] = normalized;
        runtime.settings.history = runtime.historyCache;
        runtime.save();
        return true;
    }
    try {
        const tx = runtime.idb.transaction('history', 'readwrite');
        const done = idbTransactionDone(tx);
        tx.objectStore('history').put(normalized);
        await done;
        if (index !== -1) runtime.historyCache[index] = normalized;
        return true;
    } catch (e) {
        console.error('[Theater] 更新历史失败:', e);
        toastr.error('更新历史失败（本地数据库写入出错）：' + (e?.message || e));
        return false;
    }
}
// @theater-source-end histPutStorage

// @theater-source-begin queueHistoryWrite
function queueHistoryWrite(operation) {
    const next = runtime.historyWriteQueue.then(operation, operation);
    runtime.historyWriteQueue = next.catch(() => {});
    return next;
}
// @theater-source-end queueHistoryWrite

return { idbReq, idbTransactionDone, storageInit, histAdd, histAddStorage, histDelete, histDeleteStorage, recentPersist, queueResultStorage, archiveCurrentResult, storeCurrentResult, updateResultItem, longDreamAdd, longDreamPut, longDreamDelete, histPut, histPutStorage, queueHistoryWrite };
}
