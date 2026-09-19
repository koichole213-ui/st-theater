// Narrative history is separate from mutable character/location memory.
export function chapterSummarySources(chapters = []) {
    let hash = 2166136261;
    return chapters.map(chapter => {
        const source = JSON.stringify([chapter.number, chapter.text]);
        for (let i = 0; i < source.length; i++) {
            hash = Math.imul(hash ^ source.charCodeAt(i), 16777619) >>> 0;
        }
        return `${chapter.number}:${hash.toString(16)}`;
    });
}

export function normalizeStoryFields(memory = {}, chapterCount = Infinity) {
    const entries = (Array.isArray(memory.storyEntries) ? memory.storyEntries : [])
        .filter(item => Number.isInteger(item?.chapterNumber) && item.chapterNumber > 0 && item.chapterNumber <= chapterCount
            && typeof item.text === 'string' && item.text.trim() && typeof item.source === 'string')
        .map(item => ({ chapterNumber: item.chapterNumber, text: item.text.trim().slice(0, 1200), source: item.source }));
    const versions = (Array.isArray(memory.summaryVersions) ? memory.summaryVersions : [])
        .filter(item => typeof item?.id === 'string' && typeof item.text === 'string' && item.text.trim()
            && Number.isInteger(item.chapterNumber) && item.chapterNumber > 0 && item.chapterNumber <= chapterCount
            && Array.isArray(item.sources) && item.sources.length === item.chapterNumber && item.sources.every(source => typeof source === 'string'))
        .slice(-5).map(item => ({ id: item.id, text: item.text.trim(), chapterNumber: item.chapterNumber,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '', sources: item.sources.slice(), canRestore: item.canRestore !== false,
            storyEntries: normalizeStoryFields({ storyEntries: item.storyEntries }, item.chapterNumber).storyEntries }));
    return { storyEntries: entries, summaryVersions: versions, summaryDecisionsChanged: memory.summaryDecisionsChanged === true,
        summaryThroughChapter: Math.min(chapterCount, Math.max(0, Number(memory.summaryThroughChapter) || 0)) };
}

export function validStoryEntries(record) {
    const sources = chapterSummarySources(record.chapters);
    return normalizeStoryFields(record.memory, record.chapters.length).storyEntries
        .filter(entry => entry.source === sources[entry.chapterNumber - 1]);
}

export function composeStorySummary(entries) {
    return entries.slice().sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(item => `第 ${item.chapterNumber} 章：${item.text}`).join('\n\n');
}

export function mergeStoryResponse(record, responseEntries, { replace = false } = {}) {
    const fail = (code, message) => { throw Object.assign(new Error(message), { code: `LONG_DREAM_SUMMARY_${code}` }); };
    if (!Array.isArray(responseEntries)) fail('MISSING_ENTRIES', '概要返回为空或缺少分章概要，请重试');
    // Normalize only unambiguous positive decimal chapter numbers; never guess by position.
    const normalized = responseEntries.map(item => ({ ...item, chapterNumber:
        typeof item?.chapterNumber === 'string' && /^[1-9]\d*$/.test(item.chapterNumber.trim())
            ? Number(item.chapterNumber.trim()) : item?.chapterNumber }));
    const sources = chapterSummarySources(record.chapters);
    const existing = replace ? [] : validStoryEntries(record);
    const required = record.chapters.filter(chapter => !existing.some(entry => entry.chapterNumber === chapter.number));
    const entries = existing.slice();
    for (const chapter of required) {
        const matches = normalized.filter(item => item.chapterNumber === chapter.number);
        if (matches.length !== 1) fail('COVERAGE', '概要未完整覆盖已保存章节，或章号重复，原概要已保留');
        if (typeof matches[0].text !== 'string' || !matches[0].text.trim()) fail('EMPTY_ENTRY', '分章概要内容为空，原概要已保留');
        if (matches[0].text.trim().length > 1200) fail('ENTRY_TOO_LONG', '单章概要超过1200字符，原概要已保留');
        entries.push({ chapterNumber: chapter.number, text: matches[0].text.trim(), source: sources[chapter.number - 1] });
    }
    return entries.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

export function saveStorySummary(record, entries, now = new Date()) {
    const createdAt = new Date(now).toISOString();
    const sources = chapterSummarySources(record.chapters);
    const text = composeStorySummary(entries);
    const memory = record.memory;
    let versions = normalizeStoryFields(memory, record.chapters.length).summaryVersions;
    // Preserve the pre-migration synopsis too; never manufacture chapter paragraphs from it.
    if (!versions.length && memory.currentState?.trim()) {
        const chapterNumber = memory.summaryThroughChapter || memory.summaryHistory?.at(-1)?.chapterNumber || memory.processedThroughChapter || record.chapters.length;
        versions.push({ id: `legacy-${createdAt}`, text: memory.currentState, chapterNumber,
            createdAt, canRestore: !memory.summaryDecisionsChanged, sources: sources.slice(0, chapterNumber), storyEntries: validStoryEntries(record).filter(item => item.chapterNumber <= chapterNumber) });
    }
    const id = `${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
    versions = [...versions, { id, text, chapterNumber: record.chapters.length, createdAt, canRestore: true, sources, storyEntries: entries }].slice(-5);
    return { ...record, updatedAt: createdAt, memory: { ...memory, storyEntries: entries, summaryVersions: versions,
        summaryDecisionsChanged: false, currentState: text, summaryThroughChapter: record.chapters.length, summaryNeedsRefresh: false, updatedAt: createdAt } };
}

export function restoreStorySummary(record, id, now = new Date()) {
    if (record.memory.status === 'weaving' || record.memory.pendingConflicts?.length || record.memory.pendingChapterNumbers?.length) {
        throw new Error('请先完成补织和冲突确认');
    }
    const version = normalizeStoryFields(record.memory, record.chapters.length).summaryVersions.find(item => item.id === id);
    const sources = chapterSummarySources(record.chapters);
    if (!version || version.canRestore === false || version.sources.some((source, index) => source !== sources[index])) throw new Error('这版概要对应的正文已改变，不能恢复');
    const updatedAt = new Date(now).toISOString();
    return { ...record, updatedAt, memory: { ...record.memory, currentState: version.text,
        storyEntries: version.storyEntries, summaryThroughChapter: version.chapterNumber,
        summaryNeedsRefresh: version.chapterNumber < record.chapters.length, updatedAt } };
}

export function invalidateStoryDecisions(memory) {
    return { storyEntries: [], summaryNeedsRefresh: true, summaryDecisionsChanged: true,
        summaryVersions: normalizeStoryFields(memory).summaryVersions.map(version => ({ ...version, canRestore: false })) };
}

export function validateStorySources(memory, chapters) {
    const sources = chapterSummarySources(chapters);
    const fields = normalizeStoryFields(memory, chapters.length);
    const entries = fields.storyEntries.filter(entry => entry.source === sources[entry.chapterNumber - 1]);
    const versions = fields.summaryVersions.filter(version => version.sources.every((source, i) => source === sources[i]));
    const originalFields = normalizeStoryFields(memory);
    const changed = entries.length !== originalFields.storyEntries.length || versions.length !== originalFields.summaryVersions.length;
    return { ...memory, ...fields, storyEntries: entries, summaryVersions: versions,
        ...(changed ? { currentState: composeStorySummary(entries), summaryThroughChapter: entries.at(-1)?.chapterNumber || 0, summaryNeedsRefresh: true } : {}) };
}
