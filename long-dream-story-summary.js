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

function normalizeFullSummary(value, chapterCount = Infinity) {
    if (!value || typeof value.text !== 'string' || !value.text.trim() || !Number.isInteger(value.chapterNumber) || value.chapterNumber < 1 || value.chapterNumber > chapterCount || !Array.isArray(value.sources) || value.sources.length !== value.chapterNumber || !value.sources.every(source => typeof source === 'string')) return null;
    return { text: value.text, chapterNumber: value.chapterNumber, sources: value.sources.slice(), ...(value.needsReview ? { needsReview: true } : {}) };
}

export function manualFullSummary(record, includePending = false) {
    const full = normalizeFullSummary(record.memory?.manualFullSummary, record.chapters.length);
    const sources = chapterSummarySources(record.chapters);
    return full && (includePending || !full.needsReview) && full.sources.every((source, i) => source === sources[i]) ? full : null;
}

export function hasPendingManualSummary(record) {
    return pendingManualStoryEntries(record).length > 0 || manualFullSummary(record, true)?.needsReview === true;
}

export function coveredStoryChapters(record) {
    const covered = new Set(validStoryEntries(record).map(entry => entry.chapterNumber));
    const full = manualFullSummary(record);
    if (full) for (let number = 1; number <= full.chapterNumber; number++) covered.add(number);
    return covered;
}

export function savedStoryText(record, entries) {
    const full = manualFullSummary(record);
    return [full?.text || '', composeStorySummary(entries.filter(entry => !full || entry.chapterNumber > full.chapterNumber))].filter(Boolean).join('\n\n');
}

export function snapshotStorySummary(record, now = new Date()) {
    const memory = record.memory, sources = chapterSummarySources(record.chapters);
    const versions = normalizeStoryFields(memory, record.chapters.length).summaryVersions;
    const chapterNumber = Math.min(record.chapters.length, memory.summaryThroughChapter || memory.summaryHistory?.at(-1)?.chapterNumber || memory.processedThroughChapter || record.chapters.length);
    if (memory.currentState?.trim() && chapterNumber > 0 && !versions.some(version => version.text === memory.currentState && version.chapterNumber === chapterNumber)) {
        versions.push({ id: `legacy-${new Date(now).toISOString()}-${Math.random().toString(36).slice(2, 10)}`, text: memory.currentState, chapterNumber,
            createdAt: new Date(now).toISOString(), canRestore: !memory.summaryDecisionsChanged, sources: sources.slice(0, chapterNumber),
            storyEntries: validStoryEntries(record).filter(item => item.chapterNumber <= chapterNumber), manualFullSummary: manualFullSummary(record, true), summaryNeedsRefresh: memory.summaryNeedsRefresh === true });
    }
    return versions.slice(-5);
}

export function normalizeStoryFields(memory = {}, chapterCount = Infinity) {
    const entries = (Array.isArray(memory.storyEntries) ? memory.storyEntries : [])
        .filter(item => Number.isInteger(item?.chapterNumber) && item.chapterNumber > 0 && item.chapterNumber <= chapterCount
            && typeof item.text === 'string' && item.text.trim() && typeof item.source === 'string')
        .map(item => ({ chapterNumber: item.chapterNumber, text: item.text.trim().slice(0, 1200), source: item.source, ...(item.editedByUser === true ? { editedByUser: true } : {}), ...(item.needsReview === true ? { needsReview: true } : {}) }));
    const versions = (Array.isArray(memory.summaryVersions) ? memory.summaryVersions : [])
        .filter(item => typeof item?.id === 'string' && typeof item.text === 'string' && item.text.trim()
            && Number.isInteger(item.chapterNumber) && item.chapterNumber > 0 && item.chapterNumber <= chapterCount
            && Array.isArray(item.sources) && item.sources.length === item.chapterNumber && item.sources.every(source => typeof source === 'string'))
        .slice(-5).map(item => ({ id: item.id, text: item.text.trim(), chapterNumber: item.chapterNumber,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '', sources: item.sources.slice(), canRestore: item.canRestore !== false,
            storyEntries: normalizeStoryFields({ storyEntries: item.storyEntries }, item.chapterNumber).storyEntries, manualFullSummary: normalizeFullSummary(item.manualFullSummary, item.chapterNumber), summaryNeedsRefresh: item.summaryNeedsRefresh === true }));
    return { storyEntries: entries, summaryVersions: versions, manualFullSummary: normalizeFullSummary(memory.manualFullSummary, chapterCount), summaryDecisionsChanged: memory.summaryDecisionsChanged === true,
        summaryThroughChapter: Math.min(chapterCount, Math.max(0, Number(memory.summaryThroughChapter) || 0)) };
}

export function validStoryEntries(record) {
    const sources = chapterSummarySources(record.chapters);
    return normalizeStoryFields(record.memory, record.chapters.length).storyEntries
        .filter(entry => !entry.needsReview && entry.source === sources[entry.chapterNumber - 1]);
}

export function pendingManualStoryEntries(record) {
    const sources = chapterSummarySources(record.chapters);
    return normalizeStoryFields(record.memory, record.chapters.length).storyEntries
        .filter(entry => entry.editedByUser && entry.needsReview && entry.source === sources[entry.chapterNumber - 1]);
}

export function composeStorySummary(entries) {
    return entries.filter(entry => !entry.needsReview).sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(item => `第 ${item.chapterNumber} 章：${item.text}`).join('\n\n');
}

export function mergeStoryResponse(record, responseEntries, { replace = false } = {}) {
    const fail = (code, message) => { throw Object.assign(new Error(message), { code: `LONG_DREAM_SUMMARY_${code}` }); };
    if (!replace && hasPendingManualSummary(record)) fail('MANUAL_REVIEW', '梦脉事实已改变，请先编辑核对人工概要，或明确重新整理全篇。');
    if (!Array.isArray(responseEntries)) fail('MISSING_ENTRIES', '概要返回为空或缺少分章概要，请重试');
    // Normalize only unambiguous positive decimal chapter numbers; never guess by position.
    const normalized = responseEntries.map(item => ({ ...item, chapterNumber:
        typeof item?.chapterNumber === 'string' && /^[1-9]\d*$/.test(item.chapterNumber.trim())
            ? Number(item.chapterNumber.trim()) : item?.chapterNumber }));
    const sources = chapterSummarySources(record.chapters);
    const existing = replace ? [] : validStoryEntries(record);
    const covered = replace ? new Set() : coveredStoryChapters(record);
    const required = record.chapters.filter(chapter => !covered.has(chapter.number));
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

export function saveStorySummary(record, entries, now = new Date(), { replaceFull = false } = {}) {
    const createdAt = new Date(now).toISOString();
    const sources = chapterSummarySources(record.chapters);
    const full = replaceFull ? null : manualFullSummary(record);
    const target = { ...record, memory: { ...record.memory, manualFullSummary: full } };
    const text = savedStoryText(target, entries);
    const covered = new Set(entries.filter(entry => !entry.needsReview).map(entry => entry.chapterNumber));
    if (full) for (let number = 1; number <= full.chapterNumber; number++) covered.add(number);
    let through = 0; while (covered.has(through + 1)) through++;
    const incomplete = through < record.chapters.length;
    const id = `${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
    const versions = [...snapshotStorySummary(record, now), { id, text, chapterNumber: record.chapters.length, createdAt, canRestore: true, sources,
        storyEntries: entries, manualFullSummary: full, summaryNeedsRefresh: incomplete }].slice(-5);
    return { ...record, updatedAt: createdAt, memory: { ...record.memory, storyEntries: entries, manualFullSummary: full, summaryVersions: versions,
        summaryDecisionsChanged: false, currentState: text, summaryThroughChapter: through, summaryNeedsRefresh: incomplete, updatedAt: createdAt } };
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
        storyEntries: version.storyEntries, manualFullSummary: version.manualFullSummary, summaryThroughChapter: version.chapterNumber,
        summaryNeedsRefresh: version.summaryNeedsRefresh || version.chapterNumber < record.chapters.length, updatedAt } };
}

export function invalidateStoryDecisions(memory) {
    const manual = normalizeStoryFields(memory).storyEntries.filter(entry => entry.editedByUser).map(entry => ({ ...entry, needsReview: true }));
    const full = normalizeFullSummary(memory.manualFullSummary);
    return { storyEntries: manual, manualFullSummary: full ? { ...full, needsReview: true } : null, ...(manual.length || full ? { currentState: '' } : {}), summaryNeedsRefresh: true, summaryDecisionsChanged: true,
        summaryVersions: normalizeStoryFields(memory).summaryVersions.map(version => ({ ...version, canRestore: false })) };
}

export function validateStorySources(memory, chapters) {
    const sources = chapterSummarySources(chapters);
    const fields = normalizeStoryFields(memory, chapters.length);
    const entries = fields.storyEntries.filter(entry => entry.source === sources[entry.chapterNumber - 1]);
    const versions = fields.summaryVersions.filter(version => version.sources.every((source, i) => source === sources[i]));
    const full = fields.manualFullSummary && fields.manualFullSummary.sources.every((source, i) => source === sources[i]) ? fields.manualFullSummary : null;
    const originalFields = normalizeStoryFields(memory);
    const changed = entries.length !== originalFields.storyEntries.length || versions.length !== originalFields.summaryVersions.length || (!!originalFields.manualFullSummary !== !!full);
    return { ...memory, ...fields, manualFullSummary: full, storyEntries: entries, summaryVersions: versions,
        ...(changed ? { currentState: savedStoryText({ chapters, memory: { manualFullSummary: full } }, entries), summaryThroughChapter: Math.max(full && !full.needsReview ? full.chapterNumber : 0, entries.filter(entry => !entry.needsReview).at(-1)?.chapterNumber || 0), summaryNeedsRefresh: true } : {}) };
}
