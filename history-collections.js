// History organization is metadata only: story HTML and writing prompts are untouched.
export const historyKey = item => String(item?.chapterId || `saved:${item?.id}`);
export function newHistoryKey() {
    const source = globalThis.crypto;
    if (typeof source?.randomUUID === 'function') return source.randomUUID();
    // Some browser contexts expose random bytes but not the UUID convenience API.
    if (typeof source?.getRandomValues !== 'function') throw new Error('浏览器无法生成文件夹编号，请更新浏览器后重试');
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const historyOrder = item => Number(item.historyOrder) || Number(item.id) || 0;
export const orderedHistory = items => [...items].sort((a, b) => historyOrder(a) - historyOrder(b));

export function normalizeCollections(value, items) {
    const valid = items ? new Set(items.map(item => String(item.id))) : null;
    const owned = new Set(), ids = new Set();
    return (Array.isArray(value) ? value : []).filter(folder => folder && folder.id && !ids.has(String(folder.id)) && ids.add(String(folder.id))).map(folder => ({
        id: String(folder.id), title: String(folder.title || '未命名系列').trim() || '未命名系列',
        itemIds: (Array.isArray(folder.itemIds) ? folder.itemIds : []).map(String).filter(id => (!valid || valid.has(id)) && !owned.has(id) && owned.add(id)),
    }));
}

export function collectionChapters(folder, items) {
    const byId = new Map(items.map(item => [String(item.id), item]));
    const groups = new Map();
    for (const id of folder.itemIds) {
        const item = byId.get(String(id));
        if (!item) continue;
        const key = historyKey(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return [...groups.values()];
}

export function historyEntries(items, folders, { query = '', accepts = () => true } = {}) {
    const needle = query.trim().toLocaleLowerCase();
    const matches = value => String(value || '').toLocaleLowerCase().includes(needle);
    const normalized = normalizeCollections(folders, items);
    const owned = new Set(normalized.flatMap(folder => folder.itemIds));
    const entries = normalized.map(folder => {
        const all = collectionChapters(folder, items);
        const chapters = all.map(versions => versions.filter(item => accepts(item) && (matches(folder.title) || matches(item.title)))).filter(versions => versions.length);
        const positions = chapters.map(versions => all.findIndex(group => group.includes(versions[0])));
        return { folder, chapters, positions, count: all.length };
    }).filter(entry => entry.chapters.length || (!entry.count && matches(entry.folder.title)));
    for (const item of items) if (!owned.has(String(item.id)) && accepts(item) && matches(item.title)) entries.push({ item });
    // Preserve the legacy oldest-first list; a folder occupies its first saved work's position.
    const order = new Map(items.map((item, index) => [String(item.id), index]));
    return entries.sort((a, b) => {
        const position = entry => entry.item ? order.get(String(entry.item.id)) : Math.min(...entry.folder.itemIds.map(id => order.get(id) ?? Infinity));
        return position(a) - position(b);
    });
}

export function collectionPage(entries, page = 0, size = 8) {
    const pageCount = Math.max(1, Math.ceil(entries.length / size));
    page = Math.max(0, Math.min(pageCount - 1, Math.trunc(Number(page) || 0)));
    return { items: entries.slice(page * size, (page + 1) * size), page, pageCount, total: entries.length, pageSize: size };
}

export function moveCollectionItems(folders, ids, targetId = null) {
    const moved = new Set(ids.map(String));
    if (targetId !== null && !folders.some(folder => folder.id === targetId)) throw new Error('文件夹已不存在');
    return folders.map(folder => ({ ...folder, itemIds: [...folder.itemIds.filter(id => !moved.has(String(id))), ...(folder.id === targetId ? [...moved] : [])] }));
}

// A backup import gets fresh identities, so importing twice never joins unrelated copies.
export function remapHistoryImport(items, folders, makeKey = newHistoryKey) {
    const keys = new Map();
    const key = old => { if (!keys.has(old)) keys.set(old, makeKey()); return keys.get(old); };
    const next = items.map((item, index) => ({ ...item, chapterId: key(item.chapterId || (item.id != null ? historyKey(item) : `import:${index}`)), parentChapterId: item.parentChapterId ? key(item.parentChapterId) : '' }));
    return { items: next, folders: normalizeCollections(folders).map(folder => ({ ...folder, id: makeKey() })), chapterMapping: keys };
}

export function remapHistorySource(source, chapters, ids) {
    if (!source || typeof source !== 'object') return source;
    const sourceKey = source.chapterId || (source.id != null ? historyKey(source) : source.resultId);
    return { ...source,
        ...(source.id != null && ids.has(String(source.id)) ? { id: ids.get(String(source.id)) } : {}),
        ...(sourceKey && chapters.has(sourceKey) ? { chapterId: chapters.get(sourceKey) } : {}),
        ...(source.parentChapterId && chapters.has(source.parentChapterId) ? { parentChapterId: chapters.get(source.parentChapterId) } : {}),
        ...(Array.isArray(source.seriesSources) ? { seriesSources: source.seriesSources.map(item => remapHistorySource(item, chapters, ids)) } : {}),
    };
}

export function continuationHistoryMetadata(source, makeKey = newHistoryKey) {
    if (!source?.html) return {};
    const chapterId = source.chapterId || (source.id != null ? historyKey(source) : source.resultId || makeKey());
    const { seriesSources, ...snapshot } = source;
    return { chapterId: makeKey(), parentChapterId: chapterId,
        seriesSources: [...(Array.isArray(seriesSources) ? seriesSources : []), { ...snapshot, chapterId }] };
}

export function planHistorySave(items, folders, item, source = {}, makeKey = newHistoryKey) {
    const next = [...items];
    let collections = normalizeCollections(folders, items);
    const chapterId = source.chapterId || source.resultId || makeKey();
    const parentKey = String(source.parentChapterId || '');
    let parent = next.find(entry => historyKey(entry) === parentKey);
    const existing = next.find(entry => historyKey(entry) === chapterId);
    let folder = collections.find(folder => folder.itemIds.includes(String((existing || parent)?.id)));
    if (parentKey && !folder && !existing) {
        folder = { id: makeKey(), title: parent?.title || source.seriesSources?.[0]?.title || item.title, itemIds: [] };
        collections.push(folder);
    }
    if (parentKey && folder) {
        for (const ancestor of source.seriesSources || []) {
            let saved = next.find(entry => historyKey(entry) === ancestor.chapterId || (ancestor.id != null && String(entry.id) === String(ancestor.id)));
            // An explicitly deleted saved story is not recreated from an old result snapshot.
            if (!saved && ancestor.id != null) continue;
            if (!saved) {
                const { seriesSources, resultId, ...content } = ancestor;
                saved = { ...content, id: makeKey(), title: content.title || '系列前篇', date: content.date || content.time || item.date };
                next.push(saved);
            }
            const owner = collections.find(entry => entry.itemIds.includes(String(saved.id)));
            if (!owner) folder.itemIds.push(String(saved.id));
        }
        if (parent && !collections.some(entry => entry.itemIds.includes(String(parent.id)))) folder.itemIds.push(String(parent.id));
    }
    const saved = { ...item, id: makeKey(), chapterId, parentChapterId: parentKey };
    next.push(saved);
    if (folder) folder.itemIds.push(String(saved.id));
    return { items: next, folders: collections, saved };
}
