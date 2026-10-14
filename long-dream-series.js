import { chapterSummarySources, validStoryEntries, composeStorySummary, saveStorySummary } from './long-dream-story-summary.js';
import { buildLongDreamSummaryPayload, parseLongDreamMemoryResponse } from './long-dream-memory.js';
import { collectionChapters } from './history-collections.js';
import { createLongDreamChapter, normalizeLongDreamRecord } from './long-dream.js';

export function longDreamFolderSources(runtime) {
    if (runtime.storageReadErrors?.history || runtime.storageReadErrors?.collections) return [];
    const sourceOrder = new Map(runtime.historyCache.map((item, index) => [String(item.id), index]));
    return (runtime.historyCollections || []).map(folder => {
        // One saved version per chapter, with no new version-picking UI.
        const chapters = collectionChapters(folder, runtime.historyCache).map(group => {
            const item = group.at(-1);
            return { ...item, text: runtime.htmlToPlainText(item.html || ''), chapterTitle: item.title };
        });
        if (!chapters.length || chapters.some(chapter => !chapter.html?.trim() || !chapter.text?.trim())) return null;
        const first = chapters[0];
        return { ...first, key: `folder:${folder.id}`, kind: 'history-folder', refId: folder.id,
            title: folder.title, chapters, searchText: chapters.map(chapter => `${chapter.title || ''}\n${chapter.text}`).join('\n'),
            order: Math.max(...chapters.map(chapter => sourceOrder.get(String(chapter.id)) ?? -1)),
            date: chapters.at(-1).date || first.date || '' };
    }).filter(Boolean);
}

export function importLongDreamSeries(record, source, autoWeave) {
    if (source.kind !== 'history-folder') return record;
    if (!source.chapters?.length) throw new Error('文件夹中没有可带入的正文');
    return normalizeLongDreamRecord({ ...record, seriesMemoryAutoWeave: autoWeave === true,
        chapters: source.chapters.map((chapter, index) => ({ ...createLongDreamChapter(chapter, record.createdAt),
            id: `chapter-${index + 1}`, number: index + 1, title: chapter.title || `第 ${index + 1} 章` })),
        memory: { ...record.memory, processedThroughChapter: 0, pendingChapterNumbers: source.chapters.map((_, i) => i + 1) } });
}

export function nextSeriesMemoryBatch(record, { maxChapters = 3, maxChars = 24000 } = {}) {
    const result = [];
    let chars = 0;
    for (const chapter of record.chapters || []) {
        if (chapter.number <= (record.memory?.processedThroughChapter || 0)) continue;
        const length = String(chapter.text || '').length;
        if (result.length && (result.length >= maxChapters || chars + length > maxChars)) break;
        result.push(chapter); chars += length;
    }
    return result; // Even an oversized single chapter is preserved in full.
}

export async function runSeriesMemoryBatches({ read, save, weave, force = false, shouldStop = () => false }) {
    let record = read();
    if (!record || (!force && record.seriesMemoryAutoWeave !== true)) return;
    if (force && record.seriesMemoryAutoWeave !== true) {
        record = await save({ ...record, seriesMemoryAutoWeave: true });
        if (!record) return;
    }
    while ((record = read()) && record.seriesMemoryAutoWeave === true) {
        if (shouldStop()) { await save({ ...record, seriesMemoryAutoWeave: false }); return; }
        if (record.memory?.pendingConflicts?.length || record.memory?.status === 'failed') return;
        const batch = nextSeriesMemoryBatch(record);
        if (!batch.length) return;
        const before = record.memory?.processedThroughChapter || 0;
        await weave(batch);
        const latest = read();
        if (!latest || (latest.memory?.processedThroughChapter || 0) <= before) return;
    }
}

// Validate and save only this batch, using hashes from the complete chapter chain.
export function applySeriesStoryBatch(record, responseEntries, chapters) {
    if (!Array.isArray(responseEntries)) throw new Error('本批故事概要缺失');
    const sources = chapterSummarySources(record.chapters);
    const entries = validStoryEntries(record).filter(entry => !chapters.some(ch => ch.number === entry.chapterNumber));
    for (const chapter of chapters) {
        const matches = responseEntries.filter(entry => Number(entry?.chapterNumber) === chapter.number);
        if (matches.length !== 1 || typeof matches[0].text !== 'string' || !matches[0].text.trim() || matches[0].text.trim().length > 1200) throw new Error('本批故事概要未完整覆盖章节');
        entries.push({ chapterNumber: chapter.number, text: matches[0].text.trim(), source: sources[chapter.number - 1] });
    }
    entries.sort((a, b) => a.chapterNumber - b.chapterNumber);
    if (record.memory.pendingConflicts.length) return { ...record, memory: { ...record.memory, summaryNeedsRefresh: true } };
    if (entries.length === record.chapters.length) return saveStorySummary(record, entries);
    let through = 0; while (entries.some(entry => entry.chapterNumber === through + 1)) through++;
    return { ...record, memory: { ...record.memory, storyEntries: entries, currentState: composeStorySummary(entries), summaryThroughChapter: through, summaryNeedsRefresh: true } };
}

export async function refreshSeriesStorySummary({ record, request, readLatest, save, shouldStop = () => false, timeoutMs = 180000 }) {
    const initialChapters = JSON.stringify([record.chapters, record.canon, record.inheritance]);
    const initialDecisions = JSON.stringify([record.memory.states, record.memory.transitions, record.memory.threads, record.memory.deviations, record.memory.rejections]);
    let latest = record;
    while (latest) {
        if (shouldStop()) return null;
        const covered = new Set(validStoryEntries(latest).map(entry => entry.chapterNumber));
        const chapters = latest.chapters.filter(chapter => !covered.has(chapter.number)).slice(0, 3);
        if (!chapters.length) return latest;
        const revision = JSON.stringify(latest.memory);
        const payload = buildLongDreamSummaryPayload({ ...latest, chapters });
        const controller = new AbortController(); let timer;
        let response;
        try { response = await Promise.race([request(payload, { signal: controller.signal }), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('本批概要等待超时')); }, timeoutMs); })]); }
        finally { clearTimeout(timer); }
        const patch = parseLongDreamMemoryResponse(response?.text || response, { pendingChapterNumbers: chapters.map(chapter => chapter.number) });
        latest = await readLatest();
        if (!latest || JSON.stringify([latest.chapters, latest.canon, latest.inheritance]) !== initialChapters || JSON.stringify([latest.memory.states, latest.memory.transitions, latest.memory.threads, latest.memory.deviations, latest.memory.rejections]) !== initialDecisions || JSON.stringify(latest.memory) !== revision) return null;
        latest = await save(applySeriesStoryBatch(latest, patch.storyEntries, chapters));
        if (!latest) throw new Error('本批概要保存失败');
    }
    return null;
}
