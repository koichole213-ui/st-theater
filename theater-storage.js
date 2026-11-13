// theater-storage: receives live state and cross-feature callbacks from index.js.
import { normalizeCollections, historyOrder, remapHistoryImport, newHistoryKey, historyKey, remapHistorySource, orderedHistory } from './history-collections.js';
import { normalizeLongDreamRecord, recoverInterruptedLongDreamMemory } from './long-dream.js';
import { normalizeTagList, itemTags } from './tag-system.js';
import { previousResults } from './result-text-edit.js';
import { createArchiveSafety } from './archive-fingerprints.js';
import { archiveRevision, createArchiveSync } from './archive-sync.js';

export function createTheaterStorage(runtime, archiveOptions) {
runtime.archiveSafety = createArchiveSafety(runtime, archiveOptions);
runtime.archiveSync = createArchiveSync(runtime, archiveOptions);
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
    const done = new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
    // A request may reject before its caller reaches the transaction await.
    void done.catch(() => {});
    return done;
}
// @theater-source-end idbTransactionDone

// @theater-source-begin storageInit
async function storageInit() {
    if (runtime.historyMigrationPreview) {
        const previous = runtime.historyMigrationPreview;
        runtime.historyCache = runtime.historyCache.filter(item => !previous.items.includes(item));
        runtime.historyCollections = runtime.historyCollections.filter(folder => !previous.folders.includes(folder));
        runtime.historyMigrationPreview = null;
    }
    runtime.storageReadErrors = {};
    try {
        runtime.idb = await new Promise((resolve, reject) => {
            const req = indexedDB.open('st-theater', 2);
            let finished = false;
            const finish = (error, db) => {
                if (finished) { db?.close(); return; }
                finished = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve(db);
            };
            const timer = setTimeout(() => finish(new DOMException('IndexedDB open timed out', 'TimeoutError')), 10000);
            req.onupgradeneeded = () => {
                if (finished) { req.transaction?.abort(); return; }
                const db = req.result;
                if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('dreams')) db.createObjectStore('dreams', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
            };
            req.onsuccess = () => finish(null, req.result);
            req.onerror = () => finish(req.error || new Error('open failed'));
            req.onblocked = () => finish(new DOMException('IndexedDB open blocked', 'BlockedError'));
        });
    } catch (e) {
        console.warn('[Theater] IndexedDB 不可用，回退到 settings 存储:', e);
        runtime.runtimeLog('warn', '本地存档：IndexedDB 不可用，回退到 settings 内存储');
        runtime.idb = null;
        runtime.storageReadErrors.database = true;
        const message = e?.name === 'VersionError'
            ? '数据库版本比当前插件新，请使用较新的插件后刷新；数据没有被删除。'
            : ['BlockedError', 'TimeoutError'].includes(e?.name)
                ? '数据库可能被其他页面占用，请关闭其他酒馆页面后刷新；数据没有被删除。'
                : '本地数据库暂时无法打开，当前仅显示旧设置中仍保留的存档；这不代表数据库中的历史已被删除。请先保留站点数据，稍后重新加载。';
        toastr.warning(message, '小剧场存档读取失败', { timeOut: 0, extendedTimeOut: 0, closeButton: true });
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

    const opened = runtime.idb;
    if (runtime.archiveSync) {
        runtime.archiveSync.open();
        opened.onversionchange = () => {
            opened.close();
            runtime.archiveSync.markStale();
        };
    }
    void runtime.archiveSafety?.inspectProtection();
    const fallbackCurrentResult = runtime.settings.currentGenerationResult?.html ? runtime.settings.currentGenerationResult : null;
    let legacyCurrent = fallbackCurrentResult;
    // 迁移：把还留在 settings 里的旧数据搬进 IndexedDB（搬成功才清空 settings）
    try {
        if (Array.isArray(runtime.settings.history) && runtime.settings.history.length) {
            const n = runtime.settings.history.length;
            runtime.runtimeLog('info', '存档迁移开始', { type: 'history', count: n });
            const mapping = new Map();
            const imported = remapHistoryImport(runtime.settings.history, runtime.settings.historyCollections);
            const transaction = runtime.idb.transaction(['history', 'kv'], 'readwrite');
            const completed = idbTransactionDone(transaction);
            const store = transaction.objectStore('history');
            const kv = transaction.objectStore('kv');
            try {
                const [existing, existingFolders] = await Promise.all([
                    idbReq(store.getAll()), idbReq(kv.get('history-collections')),
                ]);
                if (runtime.archiveStale) throw new Error('本页存档已过期，请刷新后重试迁移');
                let order = Math.max(0, ...(existing || []).map(historyOrder));
                const migrated = imported.items.map((h, index) => {
                    const id = newHistoryKey();
                    mapping.set(String(runtime.settings.history[index].id), id);
                    return { ...h, id, chapterId: h.chapterId || historyKey(h), historyOrder: ++order, tags: normalizeTagList(h.tags) };
                });
                const migratedFolders = imported.folders.map(folder => ({ ...folder, itemIds: folder.itemIds.map(id => mapping.get(id)).filter(Boolean) }));
                for (const h of migrated) store.add(h);
                kv.put([...(existingFolders || []), ...migratedFolders], 'history-collections');
            } catch (error) {
                try { transaction.abort(); } catch { /* already aborted */ }
                await completed.catch(() => {});
                throw error;
            }
            await completed;
            runtime.archiveSync?.publish('legacy-history');
            if (Array.isArray(runtime.settings.recentGenerations)) runtime.settings.recentGenerations = runtime.settings.recentGenerations.map(item => remapHistorySource(item, imported.chapterMapping, mapping));
            runtime.settings.historyCollections = [];
            if (fallbackCurrentResult) {
                legacyCurrent = remapHistorySource(fallbackCurrentResult, imported.chapterMapping, mapping);
                runtime.settings.currentGenerationResult = legacyCurrent;
            }
            runtime.settings.history = [];
            runtime.save();
            runtime.runtimeLog('info', '存档迁移完成', { type: 'history', count: n });
            console.log(`[Theater] ${n} 条历史已迁移到 IndexedDB`);
        }
        if (!runtime.settings.history?.length && Array.isArray(runtime.settings.historyCollections) && runtime.settings.historyCollections.length) {
            const tx = runtime.idb.transaction('kv', 'readwrite');
            const done = idbTransactionDone(tx);
            const kv = tx.objectStore('kv');
            try {
                const existingFolders = await idbReq(kv.get('history-collections'));
                if (runtime.archiveStale) throw new Error('本页存档已过期，请刷新后重试迁移');
                kv.put([...(existingFolders || []), ...normalizeCollections(runtime.settings.historyCollections).map(folder => ({ ...folder, id: newHistoryKey(), itemIds: [] }))], 'history-collections');
            } catch (error) {
                try { tx.abort(); } catch { /* already aborted */ }
                await done.catch(() => {});
                throw error;
            }
            await done;
            runtime.archiveSync?.publish('legacy-folders');
            runtime.settings.historyCollections = []; runtime.save();
        }
        const legacyRecent = Array.isArray(runtime.settings.recentGenerations) ? runtime.settings.recentGenerations : [];
        if (legacyCurrent || legacyRecent.length) {
            await runtime.archiveSync.migrateResults(runtime.idb, legacyCurrent, legacyRecent, idbReq, idbTransactionDone);
            runtime.settings.currentGenerationResult = null;
            runtime.settings.recentGenerations = [];
            runtime.save();
            runtime.runtimeLog('info', '存档迁移完成', { type: 'recent' });
        }
        if (Array.isArray(runtime.settings.longDreams) && runtime.settings.longDreams.length) {
            if (runtime.archiveStale) throw new Error('本页存档已过期，请刷新后重试迁移');
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
            runtime.archiveSync?.publish('legacy-dreams');
            runtime.settings.longDreams = [];
            runtime.save();
            runtime.runtimeLog('info', '存档迁移完成', { type: 'long-dream', count: dreams.length });
        }
    } catch (e) {
        console.error('[Theater] 存档迁移失败:', e);
        runtime.runtimeLog('error', '存档迁移失败', { message: e?.message || String(e) });
        toastr.error('小剧场存档迁移失败，旧数据保留在原位：' + (e?.message || e));
    }

    const pendingHistory = Array.isArray(runtime.settings.history) ? runtime.settings.history : [];

    // Each read owns its failure path: a secondary failure must not erase history.
    async function readArchive(key, label, load, apply) {
        try {
            const value = await load();
            apply(value);
        } catch (e) {
            runtime.storageReadErrors[key] = true;
            runtime.runtimeLog('error', '本地存档读取失败', { type: key });
            console.error(`[Theater] 读取${label}失败:`, e);
            toastr.error(`${label}读取失败，已读成功的其他存档仍保留；这不代表原数据已被删除。请先保留站点数据，稍后重新加载。`, '小剧场存档读取失败', { timeOut: 0, extendedTimeOut: 0, closeButton: true });
        }
    }
    await readArchive('history', '普通历史',
        () => idbReq(runtime.idb.transaction('history').objectStore('history').getAll()),
        rows => { runtime.historyCache = orderedHistory(rows || []); });
    await readArchive('collections', '历史文件夹',
        () => idbReq(runtime.idb.transaction('kv').objectStore('kv').get('history-collections')),
        folders => {
            runtime.historyCollectionsStoredJson = runtime.archiveSync?.folderSignature(folders);
            runtime.historyCollections = normalizeCollections(folders || (pendingHistory.length ? [] : runtime.settings.historyCollections), runtime.storageReadErrors.history ? undefined : runtime.historyCache);
        });
    await readArchive('recent', '最近生成结果',
        () => idbReq(runtime.idb.transaction('kv').objectStore('kv').get('recent')),
        rows => { runtime.recentCache = rows || []; });
    await readArchive('current', '当前生成结果',
        () => idbReq(runtime.idb.transaction('kv').objectStore('kv').get('current-result')),
        item => { runtime.currentGenerationResult = item || null; });
    await readArchive('dreams', '长梦',
        () => idbReq(runtime.idb.transaction('dreams').objectStore('dreams').getAll()),
        rows => {
            runtime.longDreamCache = (rows || [])
                .map(record => normalizeLongDreamRecord(record))
                .map(record => recoverInterruptedLongDreamMemory(record))
                .filter(Boolean);
        });

    // Display unmigrated legacy copies without giving them database identities.
    // All history writes stay blocked until a later initialization migrates them.
    if (pendingHistory.length) {
        const reserved = new Set([
            ...runtime.historyCache.flatMap(item => [String(item.id), historyKey(item)]),
            ...runtime.historyCollections.map(folder => String(folder.id)),
        ]);
        let sequence = 0;
        const temporaryKey = () => {
            let key;
            do { key = `legacy-pending:${++sequence}`; } while (reserved.has(key));
            reserved.add(key);
            return key;
        };
        const legacy = remapHistoryImport(pendingHistory, runtime.settings.historyCollections, temporaryKey);
        const ids = new Map();
        const items = legacy.items.map((item, index) => {
            const id = temporaryKey();
            ids.set(String(pendingHistory[index].id), id);
            return { ...item, id };
        });
        const folders = legacy.folders.map(folder => ({ ...folder, itemIds: folder.itemIds.map(id => ids.get(id)).filter(Boolean) }));
        runtime.historyMigrationPreview = { items, folders };
        runtime.historyCache = [...runtime.historyCache, ...items];
        runtime.historyCollections = [...runtime.historyCollections, ...folders];
        runtime.storageReadErrors.history = true;
        runtime.storageReadErrors.collections = true;
        runtime.storageReadErrors.historyMigration = true;
        toastr.warning('旧历史尚未迁移完成，已临时显示保留的旧副本。可在历史页使用“导出全部历史”保存一份；暂停历史修改和删除，请保留站点数据并稍后重新加载。', '小剧场存档迁移未完成', { timeOut: 0, extendedTimeOut: 0, closeButton: true });
    }

    runtime.archiveSafety?.inspect();
}
// @theater-source-end storageInit

// @theater-source-begin histAdd
function histAdd(item) { return queueHistoryWrite(() => histAddStorage(item)); }
// @theater-source-end histAdd

// @theater-source-begin histAddStorage
async function histAddStorage(item) {
    if (runtime.archiveSync?.allowWrite() === false) return false;
    if (runtime.storageReadErrors?.historyMigration) {
        toastr.error('旧历史迁移尚未完成，暂时不能修改历史；请先导出备份并重新加载。');
        return false;
    }
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
        runtime.archiveSafety?.record();
        runtime.archiveSync?.publish('history-add');
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
    if (runtime.archiveSync?.allowWrite() === false) return false;
    if (runtime.storageReadErrors?.historyMigration) {
        toastr.error('旧历史迁移尚未完成，暂时不能修改历史；请先导出备份并重新加载。');
        return false;
    }
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
        runtime.archiveSafety?.record();
        runtime.archiveSync?.publish('history-delete');
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
    if (runtime.archiveSync?.allowWrite() === false) return false;
    if (runtime.storageReadErrors?.recent || runtime.storageReadErrors?.current) {
        toastr.error('最近或当前结果尚未读取成功，暂时不能覆盖保存；请先重新加载，并复制保留新生成的正文。');
        return false;
    }
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
        runtime.archiveSync?.publish('recent');
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

async function persistResultLayout(item, updated, canCommit) {
    if (runtime.archiveSync?.allowWrite() === false) return false;
    // A reader may still pin an item that has already aged out of local storage.
    if (runtime.currentGenerationResult !== item && !runtime.recentCache.includes(item)) return true;
    if (runtime.storageReadErrors?.current || runtime.storageReadErrors?.recent) return false;
    try {
        const tx = runtime.idb.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        const done = idbTransactionDone(tx);
        const current = store.get('current-result');
        const recent = store.get('recent');
        let changed = false;
        const match = row => row?.resultId === item.resultId;
        const unchanged = row => row.html === item.html && row.mode === item.mode
            && row.layoutSource?.text === item.layoutSource?.text
            && row.layoutSource?.targetChars === item.layoutSource?.targetChars
            && row.layoutSource?.originalInstruction === item.layoutSource?.originalInstruction;
        const change = row => ({ ...row, html: updated.html, mode: updated.mode, ...(row.layoutRetry ? { layoutRetry: null } : {}) });
        // Both requests belong to this transaction; the second result sees the latest pair.
        recent.onsuccess = () => {
            if (!canCommit() || runtime.archiveStale) return;
            const rows = Array.isArray(recent.result) ? recent.result : [];
            const targets = [current.result, ...rows].filter(match);
            if (!targets.length || targets.some(row => !unchanged(row))) return;
            if (match(current.result)) store.put(change(current.result), 'current-result');
            if (rows.some(match)) store.put(rows.map(row => match(row) ? change(row) : row), 'recent');
            changed = true;
        };
        await done;
        if (!changed) toastr.info('结果已变更，原有排版已保留');
        else runtime.archiveSync?.publish('result-layout');
        return changed;
    } catch (error) {
        console.error('[Theater] 保存结果排版失败:', error);
        toastr.error('本地保存失败，原有排版已保留');
        return false;
    }
}

// @theater-source-begin updateResultItem
function updateResultItem(item, html, mode, { layoutOnly = false, canCommit = () => true } = {}) {
    return queueResultStorage(async () => {
        if (!canCommit()) return false;
        const updated = { ...item, html, mode };
        if (!layoutOnly) {
            updated.continuationRounds = [runtime.htmlToPlainText(html)];
            if (item.layoutSource) updated.layoutSource = null;
        }
        if (item.layoutRetry) updated.layoutRetry = null;
        const next = runtime.recentCache.map(entry => entry === item ? updated : entry);
        const current = runtime.currentGenerationResult === item ? updated : runtime.currentGenerationResult;
        let saved;
        if (!layoutOnly) saved = await recentPersist(next, current);
        else if (runtime.idb) saved = await persistResultLayout(item, updated, canCommit);
        else {
            const previousRecent = runtime.settings.recentGenerations;
            const previousCurrent = runtime.settings.currentGenerationResult;
            try { saved = await recentPersist(next, current); }
            catch (error) {
                runtime.settings.recentGenerations = previousRecent;
                runtime.settings.currentGenerationResult = previousCurrent;
                throw error;
            }
        }
        if (!saved) return false;
        // Keep the reader's pinned identity so completing a generation never replaces it.
        Object.assign(item, updated);
        return true;
    });
}
// @theater-source-end updateResultItem

// @theater-source-begin longDreamAdd
async function longDreamAdd(record) {
    if (runtime.archiveSync?.allowWrite() === false) return false;
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
        copy.revision = 0;
        const tx = runtime.idb.transaction('dreams', 'readwrite');
        const done = idbTransactionDone(tx);
        const id = await idbReq(tx.objectStore('dreams').add(copy));
        await done;
        copy.id = id;
        runtime.longDreamCache.unshift(copy);
        runtime.archiveSafety?.record();
        runtime.archiveSync?.publish('dream-add');
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
    if (runtime.archiveSync?.allowWrite() === false) return false;
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
        const cached = runtime.longDreamCache.find(item => item.id === normalized.id);
        const revision = runtime.archiveSync?.revision(cached);
        if (runtime.archiveSync && (!cached || runtime.archiveSync.revision(normalized) !== revision)) {
            runtime.archiveSync.markStale();
            return false;
        }
        const tx = runtime.idb.transaction('dreams', 'readwrite');
        const done = idbTransactionDone(tx);
        const store = tx.objectStore('dreams');
        if (revision === undefined) {
            await idbReq(store.put(normalized));
        } else {
            const read = store.get(normalized.id);
            read.onsuccess = () => {
                if (runtime.archiveStale || !read.result || runtime.archiveSync.revision(read.result) !== revision) {
                    runtime.archiveSync.markStale();
                    tx.abort();
                    return;
                }
                normalized.revision = revision + 1;
                store.put(normalized);
            };
        }
        await done;
        const index = runtime.longDreamCache.findIndex(item => item.id === normalized.id);
        if (index !== -1) runtime.longDreamCache[index] = normalized;
        runtime.archiveSync?.publish('dream-put');
        return normalized;
    } catch (e) {
        console.error('[Theater] 更新长梦失败:', e);
        if (!runtime.archiveStale) toastr.error('更新长梦失败（本地数据库写入出错）：' + (e?.message || e));
        return false;
    }
}
// @theater-source-end longDreamPut

async function updateLongDreamLayout(id, changeLayout) {
    if (runtime.archiveSync?.allowWrite() === false) return false;
    const indexForDream = () => runtime.longDreamCache.findIndex(item => item.id === id);
    let updated;
    try {
        if (!runtime.idb) {
            const index = indexForDream();
            if (index < 0) return false;
            updated = changeLayout(runtime.longDreamCache[index]);
            if (!updated) return false;
            const previous = runtime.settings.longDreams;
            const records = runtime.longDreamCache.slice();
            records[index] = updated;
            runtime.settings.longDreams = records;
            try { runtime.save(); }
            catch (error) {
                runtime.settings.longDreams = previous;
                throw error;
            }
            runtime.longDreamCache[index] = updated;
            return true;
        }
        const tx = runtime.idb.transaction('dreams', 'readwrite');
        const store = tx.objectStore('dreams');
        const done = idbTransactionDone(tx);
        const read = store.get(id);
        read.onsuccess = () => {
            if (runtime.archiveStale || !read.result || indexForDream() < 0) return;
            updated = changeLayout(read.result);
            if (updated) {
                updated.revision = archiveRevision(read.result) + 1;
                store.put(updated);
            }
        };
        await done;
        if (!updated) return false;
        const index = indexForDream();
        if (index >= 0) runtime.longDreamCache[index] = normalizeLongDreamRecord(updated) || updated;
        runtime.archiveSync?.publish('dream-layout');
        return true;
    } catch (error) {
        console.error('[Theater] 保存长梦排版失败:', error);
        toastr.error('本地保存失败，原有排版已保留');
        return false;
    }
}

// @theater-source-begin longDreamDelete
async function longDreamDelete(id) {
    if (runtime.archiveSync?.allowWrite() === false) return false;
    if (!id) return false;
    if (!runtime.idb) {
        runtime.longDreamCache = runtime.longDreamCache.filter(item => item.id !== id);
        runtime.settings.longDreams = runtime.longDreamCache;
        runtime.save();
        return true;
    }
    try {
        const tx = runtime.idb.transaction('dreams', 'readwrite');
        const done = idbTransactionDone(tx);
        await idbReq(tx.objectStore('dreams').delete(id));
        await done;
        runtime.longDreamCache = runtime.longDreamCache.filter(item => item.id !== id);
        runtime.archiveSafety?.record();
        runtime.archiveSync?.publish('dream-delete');
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
    if (runtime.archiveSync?.allowWrite() === false) return false;
    if (runtime.storageReadErrors?.historyMigration) {
        toastr.error('旧历史迁移尚未完成，暂时不能修改历史；请先导出备份并重新加载。');
        return false;
    }
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
        runtime.archiveSync?.publish('history-put');
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

return { idbReq, idbTransactionDone, storageInit, histAdd, histAddStorage, histDelete, histDeleteStorage, recentPersist, queueResultStorage, archiveCurrentResult, storeCurrentResult, updateResultItem, longDreamAdd, longDreamPut, updateLongDreamLayout, longDreamDelete, histPut, histPutStorage, queueHistoryWrite };
}
