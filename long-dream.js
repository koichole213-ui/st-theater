export const LONG_DREAM_SCHEMA_VERSION = 4;

export const LONG_DREAM_STATUS = Object.freeze({
    ACTIVE: 'active',
    COMPLETE: 'complete',
});

export const LONG_DREAM_WORLD_BOOK_POLICY = Object.freeze({
    BRANCH_ONLY: 'branch-only',
    SELECTED: 'selected',
});

export const LONG_DREAM_WORLD_LINE_RELATION = Object.freeze({
    ISOLATED: 'isolated',
    PARALLEL: 'parallel',
    PREQUEL: 'prequel',
    CANON_CONCURRENT: 'canon-concurrent',
    SEQUEL: 'sequel',
});

export const LONG_DREAM_MEMORY_STATUS = Object.freeze({
    NOT_STARTED: 'not-started',
    PENDING: 'pending',
    WEAVING: 'weaving',
    READY: 'ready',
    FAILED: 'failed',
});

export const LONG_DREAM_MEMORY_TYPES = Object.freeze([
    '人物状态', '人生经历', '关系', '世界线偏离', '伏笔/约定', '地点/物品', '事件', '关键原话', '事实',
]);

export const LONG_DREAM_DRAFT_STATUS = Object.freeze({
    WRITING: 'writing',
    REVIEW: 'review',
});

export const LONG_DREAM_DRAFT_RESUME_STAGE = Object.freeze({
    WRITING: 'writing',
    RENDERING: 'rendering',
});

export const LONG_DREAM_MAX_CANDIDATES = 3;

function cleanText(value, maxLength = 0) {
    const text = String(value || '').trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function cleanStringList(values, limit = 100) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
        const text = cleanText(value, 300);
        const key = text.toLocaleLowerCase();
        if (!text || seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

function normalizeIsoDate(value, fallback) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeWorldBookSnapshot(snapshot, fallbackDate = '') {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const books = (Array.isArray(snapshot.books) ? snapshot.books : [])
        .map(book => {
            const name = cleanText(book?.name, 300);
            if (!name) return null;
            const entries = (Array.isArray(book?.entries) ? book.entries : [])
                .map(entry => {
                    const content = String(entry?.content || '');
                    if (!content.trim()) return null;
                    return {
                        uid: entry?.uid ?? null,
                        name: cleanText(entry?.name, 300),
                        content,
                        keys: cleanStringList(entry?.keys, 100),
                        secondaryKeys: cleanStringList(entry?.secondaryKeys, 100),
                        constant: entry?.constant === true,
                        vectorized: entry?.vectorized === true,
                        selective: entry?.selective === true,
                        selectiveLogic: Number.isFinite(Number(entry?.selectiveLogic)) ? Number(entry.selectiveLogic) : null,
                        caseSensitive: entry?.caseSensitive === true,
                        matchWholeWords: entry?.matchWholeWords === true,
                        position: Number.isFinite(Number(entry?.position)) ? Number(entry.position) : null,
                        depth: Number.isFinite(Number(entry?.depth)) ? Math.max(0, Math.floor(Number(entry.depth))) : 4,
                        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : null,
                        role: ['system', 'user', 'assistant'].includes(String(entry?.role || '').toLowerCase())
                            ? String(entry.role).toLowerCase()
                            : 'system',
                        outletName: cleanText(entry?.outletName, 300),
                    };
                })
                .filter(Boolean);
            return { name, entries };
        })
        .filter(Boolean);
    if (!books.length) return null;
    return {
        capturedAt: normalizeIsoDate(snapshot.capturedAt, fallbackDate || new Date().toISOString()),
        books,
    };
}

function normalizeWorldLineRelation(value, worldBookPolicy) {
    const allowed = new Set(Object.values(LONG_DREAM_WORLD_LINE_RELATION));
    if (allowed.has(value)) return value;
    return worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
        ? LONG_DREAM_WORLD_LINE_RELATION.PARALLEL
        : LONG_DREAM_WORLD_LINE_RELATION.ISOLATED;
}

function normalizeMemoryCard(card, index = 0) {
    if (!card || typeof card !== 'object') return null;
    const content = cleanText(card.content || card.text || card.summary, 1200);
    if (!content) return null;
    const chapterNumber = Math.max(1, Math.floor(Number(card.chapterNumber) || 1));
    const status = ['dismissed', '废止'].includes(cleanText(card.status, 30).toLocaleLowerCase())
        ? 'dismissed'
        : 'active';
    const sourceChapterNumbers = [...new Set([
        ...(Array.isArray(card.sourceChapterNumbers) ? card.sourceChapterNumbers : []),
        card.chapterNumber,
    ].map(value => Math.floor(Number(value))).filter(value => value >= 1))].sort((a, b) => a - b);
    return {
        id: cleanText(card.id, 100) || `memory-${chapterNumber}-${index + 1}`,
        type: cleanText(card.type, 60) || '事实',
        key: cleanText(card.key || card.subject, 120),
        content,
        chapterId: cleanText(card.chapterId, 100) || `chapter-${chapterNumber}`,
        chapterNumber,
        sourceChapterNumbers: sourceChapterNumbers.length ? sourceChapterNumbers : [chapterNumber],
        quote: cleanText(card.quote, 240),
        status,
        tags: cleanStringList(card.tags, 20),
        editedByUser: card.editedByUser === true,
        updatedAt: cleanText(card.updatedAt, 60),
    };
}

function resetMemoryForChapters(chapters = []) {
    const numbers = chapters.map(chapter => Math.max(1, Math.floor(Number(chapter?.number) || 1)));
    return normalizeMemory({
        status: numbers.length ? LONG_DREAM_MEMORY_STATUS.PENDING : LONG_DREAM_MEMORY_STATUS.NOT_STARTED,
        cards: [],
        currentState: '',
        processedThroughChapter: 0,
        pendingChapterNumbers: numbers,
        updatedAt: '',
        lastErrorSignal: '',
    }, numbers.length);
}

function normalizeMemory(memory = {}, chapterCount = 0) {
    const processedThroughChapter = Math.max(0, Math.min(chapterCount, Math.floor(Number(memory?.processedThroughChapter) || 0)));
    const pendingSet = new Set((Array.isArray(memory?.pendingChapterNumbers) ? memory.pendingChapterNumbers : [])
        .map(value => Math.floor(Number(value)))
        .filter(value => value > processedThroughChapter && value <= chapterCount));
    for (let number = processedThroughChapter + 1; number <= chapterCount; number++) pendingSet.add(number);
    const pendingChapterNumbers = [...pendingSet].sort((a, b) => a - b);
    const rawStatus = cleanText(memory?.status, 40);
    const status = rawStatus === LONG_DREAM_MEMORY_STATUS.WEAVING || rawStatus === LONG_DREAM_MEMORY_STATUS.FAILED
        ? rawStatus
        : (pendingChapterNumbers.length
            ? LONG_DREAM_MEMORY_STATUS.PENDING
            : (processedThroughChapter ? LONG_DREAM_MEMORY_STATUS.READY : LONG_DREAM_MEMORY_STATUS.NOT_STARTED));
    return {
        status,
        cards: (Array.isArray(memory?.cards) ? memory.cards : []).map(normalizeMemoryCard).filter(Boolean),
        currentState: cleanText(memory?.currentState, 5000),
        processedThroughChapter,
        pendingChapterNumbers,
        updatedAt: cleanText(memory?.updatedAt, 60),
        lastErrorSignal: cleanText(memory?.lastErrorSignal, 80),
    };
}

function normalizeDraftCandidate(candidate, fallbackDate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const text = String(candidate.text || '');
    const html = String(candidate.html || '');
    if (!text.trim() || !html.trim()) return null;
    return {
        text,
        html,
        mode: cleanText(candidate.mode, 40) || 'html',
        createdAt: normalizeIsoDate(candidate.createdAt || candidate.updatedAt, fallbackDate),
    };
}

function normalizeDraft(draft, chapterNumber, fallbackDate) {
    if (!draft || typeof draft !== 'object') return null;
    const draftText = String(draft.text || '');
    const draftHtml = String(draft.html || '');
    const instruction = String(draft.instruction || '');
    const candidates = (Array.isArray(draft.candidates) ? draft.candidates : [])
        .map(candidate => normalizeDraftCandidate(candidate, fallbackDate))
        .filter(Boolean)
        .slice(0, LONG_DREAM_MAX_CANDIDATES);
    if (!candidates.length && draft.status === LONG_DREAM_DRAFT_STATUS.REVIEW) {
        const legacyCandidate = normalizeDraftCandidate({
            text: draftText,
            html: draftHtml,
            mode: draft.mode,
            createdAt: draft.updatedAt,
        }, fallbackDate);
        if (legacyCandidate) candidates.push(legacyCandidate);
    }
    if (!draftText.trim() && !draftHtml.trim() && !instruction.trim() && !candidates.length) return null;
    const selectedCandidateIndex = candidates.length
        ? Math.min(candidates.length - 1, Math.max(0, Math.floor(Number(draft.selectedCandidateIndex) || 0)))
        : 0;
    const status = draft.status === LONG_DREAM_DRAFT_STATUS.REVIEW && candidates.length
        ? LONG_DREAM_DRAFT_STATUS.REVIEW
        : LONG_DREAM_DRAFT_STATUS.WRITING;
    const selectedCandidate = status === LONG_DREAM_DRAFT_STATUS.REVIEW
        ? candidates[selectedCandidateIndex]
        : null;
    const resumeStage = status === LONG_DREAM_DRAFT_STATUS.WRITING
        && draft.resumeStage === LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING
        && draftText.trim()
        ? LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING
        : LONG_DREAM_DRAFT_RESUME_STAGE.WRITING;
    return {
        status,
        resumeStage,
        chapterNumber,
        title: cleanText(draft.title, 80) || `第 ${chapterNumber} 章`,
        instruction,
        targetChars: Math.max(500, Math.min(8000, Math.round(Number(draft.targetChars) || 3000))),
        text: selectedCandidate?.text ?? draftText,
        html: selectedCandidate?.html ?? draftHtml,
        mode: selectedCandidate?.mode || cleanText(draft.mode, 40) || (draftHtml.trim() ? 'html' : 'text'),
        candidates,
        selectedCandidateIndex,
        updatedAt: normalizeIsoDate(draft.updatedAt, fallbackDate),
    };
}

export function createLongDreamWorldBookSnapshot({ bookNames = [], entries = [] } = {}, now = new Date()) {
    const names = cleanStringList(bookNames);
    const allowed = new Set(names.map(name => name.toLocaleLowerCase()));
    const capturedAt = normalizeIsoDate(now, new Date().toISOString());
    const books = names.map(name => ({
        name,
        entries: (Array.isArray(entries) ? entries : [])
            .filter(entry => cleanText(entry?.book, 300).toLocaleLowerCase() === name.toLocaleLowerCase() && entry?.enabled !== false)
            .map(entry => {
                const raw = entry?.raw || {};
                return {
                    uid: entry?.uid ?? raw.uid ?? null,
                    name: cleanText(entry?.name || raw.comment, 300),
                    content: String(entry?.content || raw.content || ''),
                    keys: Array.isArray(raw.key) ? raw.key : [],
                    secondaryKeys: Array.isArray(raw.keysecondary) ? raw.keysecondary : [],
                    constant: raw.constant === true,
                    vectorized: raw.vectorized === true,
                    selective: raw.selective === true,
                    selectiveLogic: raw.selectiveLogic,
                    caseSensitive: raw.caseSensitive === true,
                    matchWholeWords: raw.matchWholeWords === true,
                    position: entry?.position ?? raw.position,
                    depth: entry?.depth ?? raw.depth,
                    order: entry?.order ?? raw.order,
                    role: entry?.role ?? raw.role,
                    outletName: entry?.outletName ?? raw.outletName ?? raw.outlet,
                };
            })
            .filter(entry => entry.content.trim()),
    })).filter(book => allowed.has(book.name.toLocaleLowerCase()));
    return normalizeWorldBookSnapshot({ capturedAt, books }, capturedAt);
}

export function createLongDreamChapter(source = {}, now = new Date()) {
    const createdAt = normalizeIsoDate(now, new Date().toISOString());
    const text = String(source.text || '');
    const html = String(source.html || '');
    if (!text.trim() || !html.trim()) throw new Error('长梦第一章必须同时包含纯正文与最终 HTML');
    return {
        id: 'chapter-1',
        number: 1,
        title: cleanText(source.chapterTitle, 80) || '第一章',
        instruction: String(source.instruction || ''),
        text,
        html,
        mode: cleanText(source.mode, 40) || 'html',
        createdAt,
    };
}

export function createLongDreamRecord({
    title,
    canon = '',
    worldBookPolicy = LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY,
    worldLineRelation,
    worldBookNames = [],
    worldBookSnapshot = null,
    source = {},
    sourceConfig = {},
    now = new Date(),
} = {}) {
    const createdAt = normalizeIsoDate(now, new Date().toISOString());
    const chapter = createLongDreamChapter(source, createdAt);
    const normalizedPolicy = worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
        ? LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
        : LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY;
    const normalizedRelation = normalizeWorldLineRelation(worldLineRelation, normalizedPolicy);
    const effectivePolicy = normalizedRelation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED
        ? LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY
        : LONG_DREAM_WORLD_BOOK_POLICY.SELECTED;
    return {
        schemaVersion: LONG_DREAM_SCHEMA_VERSION,
        title: cleanText(title, 80) || cleanText(source.title, 80) || '未命名长梦',
        status: LONG_DREAM_STATUS.ACTIVE,
        createdAt,
        updatedAt: createdAt,
        canon: String(canon || '').trim(),
        inheritance: {
            worldBookPolicy: effectivePolicy,
            worldLineRelation: normalizedRelation,
            worldBookNames: effectivePolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? cleanStringList(worldBookNames)
                : [],
            snapshot: effectivePolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? normalizeWorldBookSnapshot(worldBookSnapshot, createdAt)
                : null,
        },
        source: {
            kind: cleanText(source.kind, 30) || 'unknown',
            refId: source.refId ?? null,
            title: cleanText(source.title, 120),
            instruction: String(source.instruction || ''),
            capturedAt: createdAt,
        },
        sourceConfig: {
            metadataCaptured: sourceConfig.metadataCaptured === true,
            presetName: cleanText(sourceConfig.presetName, 300),
            selectedWorldBooks: cleanStringList(sourceConfig.selectedWorldBooks),
            readChatContext: sourceConfig.readChatContext !== false,
            contextRange: Math.max(0, Math.floor(Number(sourceConfig.contextRange) || 0)),
            renderSelection: cleanText(sourceConfig.renderSelection, 100),
            renderLabel: cleanText(sourceConfig.renderLabel, 200),
            textTheme: cleanText(sourceConfig.textTheme, 40),
        },
        chapters: [chapter],
        memory: normalizeMemory({}, 1),
        draft: null,
    };
}

export function normalizeLongDreamRecord(record = {}) {
    const now = new Date().toISOString();
    const createdAt = normalizeIsoDate(record.createdAt, now);
    const chapters = (Array.isArray(record.chapters) ? record.chapters : [])
        .map((chapter, index) => {
            const text = String(chapter?.text || '');
            const html = String(chapter?.html || '');
            if (!text.trim() && !html.trim()) return null;
            return {
                id: cleanText(chapter?.id, 80) || `chapter-${index + 1}`,
                number: index + 1,
                title: cleanText(chapter?.title, 80) || `第 ${index + 1} 章`,
                instruction: String(chapter?.instruction || ''),
                text,
                html,
                mode: cleanText(chapter?.mode, 40) || 'html',
                createdAt: normalizeIsoDate(chapter?.createdAt, createdAt),
            };
        })
        .filter(Boolean);
    if (!chapters.length) return null;
    const policy = record?.inheritance?.worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
        ? LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
        : LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY;
    const relation = normalizeWorldLineRelation(record?.inheritance?.worldLineRelation, policy);
    const effectivePolicy = relation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED
        ? LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY
        : LONG_DREAM_WORLD_BOOK_POLICY.SELECTED;
    return {
        ...record,
        id: record.id,
        schemaVersion: LONG_DREAM_SCHEMA_VERSION,
        title: cleanText(record.title, 80) || '未命名长梦',
        status: record.status === LONG_DREAM_STATUS.COMPLETE ? LONG_DREAM_STATUS.COMPLETE : LONG_DREAM_STATUS.ACTIVE,
        createdAt,
        updatedAt: normalizeIsoDate(record.updatedAt, createdAt),
        canon: String(record.canon || '').trim(),
        inheritance: {
            worldBookPolicy: effectivePolicy,
            worldLineRelation: relation,
            worldBookNames: effectivePolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? cleanStringList(record?.inheritance?.worldBookNames)
                : [],
            snapshot: effectivePolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? normalizeWorldBookSnapshot(record?.inheritance?.snapshot, createdAt)
                : null,
        },
        source: {
            kind: cleanText(record?.source?.kind, 30) || 'unknown',
            refId: record?.source?.refId ?? null,
            title: cleanText(record?.source?.title, 120),
            instruction: String(record?.source?.instruction || ''),
            capturedAt: normalizeIsoDate(record?.source?.capturedAt, createdAt),
        },
        sourceConfig: {
            metadataCaptured: record?.sourceConfig?.metadataCaptured === true,
            presetName: cleanText(record?.sourceConfig?.presetName, 300),
            selectedWorldBooks: cleanStringList(record?.sourceConfig?.selectedWorldBooks),
            readChatContext: record?.sourceConfig?.readChatContext !== false,
            contextRange: Math.max(0, Math.floor(Number(record?.sourceConfig?.contextRange) || 0)),
            renderSelection: cleanText(record?.sourceConfig?.renderSelection, 100),
            renderLabel: cleanText(record?.sourceConfig?.renderLabel, 200),
            textTheme: cleanText(record?.sourceConfig?.textTheme, 40),
        },
        chapters,
        memory: normalizeMemory(record?.memory, chapters.length),
        draft: normalizeDraft(record?.draft, chapters.length + 1, normalizeIsoDate(record.updatedAt, createdAt)),
    };
}

export function updateLongDreamDefinition(record, { title, canon, worldBookPolicy, worldLineRelation, worldBookNames, worldBookSnapshot } = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const requestedPolicy = worldBookPolicy === undefined
        ? normalized.inheritance.worldBookPolicy
        : (worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
            ? LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
            : LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY);
    const relationInput = worldLineRelation !== undefined
        ? worldLineRelation
        : (worldBookPolicy !== undefined
            ? (requestedPolicy === LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY
                ? LONG_DREAM_WORLD_LINE_RELATION.ISOLATED
                : (normalized.inheritance.worldLineRelation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED
                    ? LONG_DREAM_WORLD_LINE_RELATION.PARALLEL
                    : normalized.inheritance.worldLineRelation))
            : normalized.inheritance.worldLineRelation);
    const relation = normalizeWorldLineRelation(relationInput, requestedPolicy);
    const policy = relation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED
        ? LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY
        : LONG_DREAM_WORLD_BOOK_POLICY.SELECTED;
    return {
        ...normalized,
        title: cleanText(title, 80) || normalized.title,
        canon: String(canon ?? normalized.canon).trim(),
        inheritance: {
            worldBookPolicy: policy,
            worldLineRelation: relation,
            worldBookNames: policy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? cleanStringList(worldBookNames ?? normalized.inheritance.worldBookNames)
                : [],
            snapshot: policy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? normalizeWorldBookSnapshot(worldBookSnapshot ?? normalized.inheritance.snapshot, normalized.createdAt)
                : null,
        },
        updatedAt: normalizeIsoDate(now, new Date().toISOString()),
    };
}

export function migrateLongDreamRecord(record = {}) {
    return normalizeLongDreamRecord(record);
}

export function latestLongDreamChapter(record) {
    const chapters = Array.isArray(record?.chapters) ? record.chapters : [];
    return chapters.length ? chapters[chapters.length - 1] : null;
}

export function appendLongDreamChapter(record, source = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const text = String(source.text || '');
    const html = String(source.html || '');
    if (!text.trim() || !html.trim()) throw new Error('正式章节必须同时包含纯正文与最终 HTML');
    const number = normalized.chapters.length + 1;
    const createdAt = normalizeIsoDate(now, new Date().toISOString());
    return {
        ...normalized,
        updatedAt: createdAt,
        memory: normalizeMemory(normalized.memory, number),
        chapters: [
            ...normalized.chapters,
            {
                id: `chapter-${number}`,
                number,
                title: cleanText(source.title, 80) || `第 ${number} 章`,
                instruction: String(source.instruction || ''),
                text,
                html,
                mode: cleanText(source.mode, 40) || 'html',
                createdAt,
            },
        ],
    };
}

export function updateLongDreamChapter(record, chapterId, changes = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const index = normalized.chapters.findIndex(chapter => String(chapter.id) === String(chapterId));
    if (index < 0) throw new Error('没有找到要更新的章节');
    const previous = normalized.chapters[index];
    const text = String(changes.text ?? previous.text);
    const html = String(changes.html ?? previous.html);
    if (!text.trim() || !html.trim()) throw new Error('正式章节必须同时包含纯正文与最终 HTML');
    const chapters = normalized.chapters.slice();
    chapters[index] = {
        ...previous,
        title: cleanText(changes.title ?? previous.title, 80) || previous.title,
        instruction: String(changes.instruction ?? previous.instruction),
        text,
        html,
        mode: cleanText(changes.mode ?? previous.mode, 40) || previous.mode,
    };
    return { ...normalized, chapters, updatedAt: normalizeIsoDate(now, new Date().toISOString()) };
}

export function truncateLongDreamAfter(record, chapterId, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const index = normalized.chapters.findIndex(chapter => String(chapter.id) === String(chapterId));
    if (index < 0) throw new Error('没有找到截断位置');
    const chapters = normalized.chapters.slice(0, index + 1);
    if (chapters.length === normalized.chapters.length && !normalized.draft) return normalized;
    return {
        ...normalized,
        chapters,
        memory: resetMemoryForChapters(chapters),
        status: LONG_DREAM_STATUS.ACTIVE,
        draft: null,
        updatedAt: normalizeIsoDate(now, new Date().toISOString()),
    };
}

export function deleteLongDreamFrom(record, chapterId, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const index = normalized.chapters.findIndex(chapter => String(chapter.id) === String(chapterId));
    if (index < 0) throw new Error('没有找到删除位置');
    if (index === 0) throw new Error('第一章不能单独删除；如需移除请删除整部长卷');
    return truncateLongDreamAfter(normalized, normalized.chapters[index - 1].id, now);
}

export function createLongDreamBranch(record, chapterId, {
    includeChapter = true,
    title = '',
} = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const index = normalized.chapters.findIndex(chapter => String(chapter.id) === String(chapterId));
    if (index < 0) throw new Error('没有找到分支位置');
    const end = includeChapter ? index + 1 : index;
    if (end < 1) throw new Error('不能在第一章之前创建空长卷');
    const createdAt = normalizeIsoDate(now, new Date().toISOString());
    const chapters = normalized.chapters.slice(0, end);
    return {
        ...normalized,
        id: undefined,
        title: cleanText(title, 80) || `${normalized.title}（第 ${includeChapter ? index + 1 : index} 章支线）`,
        status: LONG_DREAM_STATUS.ACTIVE,
        createdAt,
        updatedAt: createdAt,
        source: {
            kind: 'long-dream-branch',
            refId: normalized.id ?? null,
            title: normalized.title,
            instruction: '',
            capturedAt: createdAt,
        },
        chapters,
        memory: resetMemoryForChapters(chapters),
        draft: null,
    };
}

export function setLongDreamStatus(record, status, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    return {
        ...normalized,
        status: status === LONG_DREAM_STATUS.COMPLETE ? LONG_DREAM_STATUS.COMPLETE : LONG_DREAM_STATUS.ACTIVE,
        updatedAt: normalizeIsoDate(now, new Date().toISOString()),
    };
}

export function setLongDreamMemoryStatus(record, status, { errorSignal = '' } = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const allowed = new Set(Object.values(LONG_DREAM_MEMORY_STATUS));
    const nextStatus = allowed.has(status) ? status : normalized.memory.status;
    return {
        ...normalized,
        memory: {
            ...normalized.memory,
            status: nextStatus,
            lastErrorSignal: nextStatus === LONG_DREAM_MEMORY_STATUS.FAILED ? cleanText(errorSignal, 80) : '',
        },
        updatedAt: normalizeIsoDate(now, new Date().toISOString()),
    };
}

export function recoverInterruptedLongDreamMemory(record, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) return null;
    if (normalized.memory.status !== LONG_DREAM_MEMORY_STATUS.WEAVING) return normalized;
    const status = normalized.memory.pendingChapterNumbers.length
        ? LONG_DREAM_MEMORY_STATUS.PENDING
        : (normalized.memory.processedThroughChapter
            ? LONG_DREAM_MEMORY_STATUS.READY
            : LONG_DREAM_MEMORY_STATUS.NOT_STARTED);
    return setLongDreamMemoryStatus(normalized, status, {}, now);
}

export function applyLongDreamMemoryPatch(record, patch = {}, throughChapter, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const processedThroughChapter = Math.max(
        normalized.memory.processedThroughChapter,
        Math.min(normalized.chapters.length, Math.floor(Number(throughChapter) || 0)),
    );
    const cards = normalized.memory.cards.slice();
    for (const rawCard of Array.isArray(patch.cards) ? patch.cards : []) {
        const card = normalizeMemoryCard(rawCard, cards.length);
        if (!card) continue;
        const exactIndex = cards.findIndex(existing => existing.status !== 'dismissed'
            && `${existing.type}\u0000${existing.content}`.toLocaleLowerCase()
                === `${card.type}\u0000${card.content}`.toLocaleLowerCase());
        if (exactIndex >= 0) {
            cards[exactIndex] = normalizeMemoryCard({
                ...cards[exactIndex],
                sourceChapterNumbers: [
                    ...(cards[exactIndex].sourceChapterNumbers || []),
                    ...(card.sourceChapterNumbers || []),
                ],
                tags: [...(cards[exactIndex].tags || []), ...(card.tags || [])],
                quote: card.quote || cards[exactIndex].quote,
                updatedAt: normalizeIsoDate(now, new Date().toISOString()),
            }, exactIndex);
            continue;
        }
        const slotIndex = card.key ? cards.findIndex(existing => existing.status !== 'dismissed'
            && existing.type.toLocaleLowerCase() === card.type.toLocaleLowerCase()
            && existing.key.toLocaleLowerCase() === card.key.toLocaleLowerCase()) : -1;
        if (slotIndex >= 0) {
            const previous = cards[slotIndex];
            cards[slotIndex] = normalizeMemoryCard({
                ...previous,
                ...(previous.editedByUser ? {} : card),
                id: previous.id,
                sourceChapterNumbers: [
                    ...(previous.sourceChapterNumbers || []),
                    ...(card.sourceChapterNumbers || []),
                ],
                tags: [...(previous.tags || []), ...(card.tags || [])],
                quote: previous.editedByUser ? previous.quote : (card.quote || previous.quote),
                updatedAt: normalizeIsoDate(now, new Date().toISOString()),
            }, slotIndex);
            continue;
        }
        cards.push({ ...card, updatedAt: normalizeIsoDate(now, new Date().toISOString()) });
    }
    const updatedAt = normalizeIsoDate(now, new Date().toISOString());
    const memory = normalizeMemory({
        ...normalized.memory,
        cards,
        currentState: cleanText(patch.currentState || normalized.memory.currentState, 5000),
        processedThroughChapter,
        pendingChapterNumbers: normalized.chapters
            .map(chapter => chapter.number)
            .filter(number => number > processedThroughChapter),
        status: LONG_DREAM_MEMORY_STATUS.READY,
        updatedAt,
        lastErrorSignal: '',
    }, normalized.chapters.length);
    return { ...normalized, memory, updatedAt };
}

export function updateLongDreamMemoryCard(record, cardId, changes = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const index = normalized.memory.cards.findIndex(card => String(card.id) === String(cardId));
    if (index < 0) throw new Error('没有找到要修改的梦脉');
    const previous = normalized.memory.cards[index];
    const updatedAt = normalizeIsoDate(now, new Date().toISOString());
    const next = normalizeMemoryCard({
        ...previous,
        type: changes.type ?? previous.type,
        key: changes.key ?? previous.key,
        content: changes.content ?? previous.content,
        tags: changes.tags ?? previous.tags,
        quote: changes.quote ?? previous.quote,
        editedByUser: true,
        updatedAt,
    }, index);
    if (!next) throw new Error('梦脉内容不能为空');
    const cards = normalized.memory.cards.slice();
    cards[index] = next;
    return {
        ...normalized,
        memory: { ...normalized.memory, cards, updatedAt },
        updatedAt,
    };
}

export function setLongDreamMemoryCardStatus(record, cardId, status, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const index = normalized.memory.cards.findIndex(card => String(card.id) === String(cardId));
    if (index < 0) throw new Error('没有找到要处理的梦脉');
    const updatedAt = normalizeIsoDate(now, new Date().toISOString());
    const cards = normalized.memory.cards.slice();
    cards[index] = {
        ...cards[index],
        status: status === 'dismissed' ? 'dismissed' : 'active',
        editedByUser: true,
        updatedAt,
    };
    return {
        ...normalized,
        memory: { ...normalized.memory, cards, updatedAt },
        updatedAt,
    };
}

export function updateLongDreamMemoryState(record, currentState, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const updatedAt = normalizeIsoDate(now, new Date().toISOString());
    return {
        ...normalized,
        memory: {
            ...normalized.memory,
            currentState: cleanText(currentState, 5000),
            updatedAt,
        },
        updatedAt,
    };
}

export function saveLongDreamDraft(record, draft = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const updatedAt = normalizeIsoDate(now, new Date().toISOString());
    const nextDraft = normalizeDraft({ ...draft, updatedAt }, normalized.chapters.length + 1, updatedAt);
    if (!nextDraft) throw new Error('长梦草稿不能为空');
    return { ...normalized, draft: nextDraft, updatedAt };
}

export function appendLongDreamDraftCandidate(record, candidate = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized?.draft) throw new Error('没有可加入候选的长梦草稿');
    const nextCandidate = normalizeDraftCandidate(candidate, normalizeIsoDate(now, new Date().toISOString()));
    if (!nextCandidate) throw new Error('待确认候选必须同时包含纯正文与最终 HTML');
    const candidates = Array.isArray(normalized.draft.candidates) ? normalized.draft.candidates : [];
    if (candidates.length >= LONG_DREAM_MAX_CANDIDATES) throw new Error(`同一章最多保留 ${LONG_DREAM_MAX_CANDIDATES} 版候选`);
    const nextCandidates = [...candidates, nextCandidate];
    return saveLongDreamDraft(normalized, {
        ...normalized.draft,
        status: LONG_DREAM_DRAFT_STATUS.REVIEW,
        text: nextCandidate.text,
        html: nextCandidate.html,
        mode: nextCandidate.mode,
        candidates: nextCandidates,
        selectedCandidateIndex: nextCandidates.length - 1,
    }, now);
}

export function selectLongDreamDraftCandidate(record, candidateIndex, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized?.draft || normalized.draft.status !== LONG_DREAM_DRAFT_STATUS.REVIEW) {
        throw new Error('当前没有可切换的待确认候选');
    }
    const candidates = normalized.draft.candidates || [];
    const index = Math.floor(Number(candidateIndex));
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) throw new Error('候选版本不存在');
    return saveLongDreamDraft(normalized, {
        ...normalized.draft,
        selectedCandidateIndex: index,
    }, now);
}

export function discardLongDreamWritingAttempt(record, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized?.draft) throw new Error('没有可放弃的长梦草稿');
    if (normalized.draft.status !== LONG_DREAM_DRAFT_STATUS.WRITING || !normalized.draft.candidates?.length) {
        return clearLongDreamDraft(normalized, now);
    }
    const index = Math.min(
        normalized.draft.candidates.length - 1,
        Math.max(0, Math.floor(Number(normalized.draft.selectedCandidateIndex) || 0)),
    );
    const candidate = normalized.draft.candidates[index];
    return saveLongDreamDraft(normalized, {
        ...normalized.draft,
        status: LONG_DREAM_DRAFT_STATUS.REVIEW,
        text: candidate.text,
        html: candidate.html,
        mode: candidate.mode,
        selectedCandidateIndex: index,
    }, now);
}

export function clearLongDreamDraft(record, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    return { ...normalized, draft: null, updatedAt: normalizeIsoDate(now, new Date().toISOString()) };
}

export function promoteLongDreamDraft(record, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized?.draft) throw new Error('没有可保存的长梦草稿');
    if (normalized.draft.status !== LONG_DREAM_DRAFT_STATUS.REVIEW) throw new Error('草稿尚未进入确认保存状态');
    const candidate = normalized.draft.candidates?.[normalized.draft.selectedCandidateIndex];
    if (!candidate) throw new Error('没有选中的待确认候选');
    const withChapter = appendLongDreamChapter(normalized, {
        ...normalized.draft,
        ...candidate,
    }, now);
    return { ...withChapter, draft: null };
}
