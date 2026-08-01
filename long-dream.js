export const LONG_DREAM_SCHEMA_VERSION = 3;

export const LONG_DREAM_STATUS = Object.freeze({
    ACTIVE: 'active',
    COMPLETE: 'complete',
});

export const LONG_DREAM_WORLD_BOOK_POLICY = Object.freeze({
    BRANCH_ONLY: 'branch-only',
    SELECTED: 'selected',
});

export const LONG_DREAM_DRAFT_STATUS = Object.freeze({
    WRITING: 'writing',
    REVIEW: 'review',
});

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
                        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : null,
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

function normalizeDraft(draft, chapterNumber, fallbackDate) {
    if (!draft || typeof draft !== 'object') return null;
    const text = String(draft.text || '');
    const html = String(draft.html || '');
    const instruction = String(draft.instruction || '');
    if (!text.trim() && !html.trim() && !instruction.trim()) return null;
    return {
        status: draft.status === LONG_DREAM_DRAFT_STATUS.REVIEW ? LONG_DREAM_DRAFT_STATUS.REVIEW : LONG_DREAM_DRAFT_STATUS.WRITING,
        chapterNumber,
        title: cleanText(draft.title, 80) || `第 ${chapterNumber} 章`,
        instruction,
        targetChars: Math.max(500, Math.min(8000, Math.round(Number(draft.targetChars) || 3000))),
        text,
        html,
        mode: cleanText(draft.mode, 40) || (html.trim() ? 'html' : 'text'),
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
                    position: raw.position,
                    order: raw.order,
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
    return {
        schemaVersion: LONG_DREAM_SCHEMA_VERSION,
        title: cleanText(title, 80) || cleanText(source.title, 80) || '未命名长梦',
        status: LONG_DREAM_STATUS.ACTIVE,
        createdAt,
        updatedAt: createdAt,
        canon: String(canon || '').trim(),
        inheritance: {
            worldBookPolicy: normalizedPolicy,
            worldBookNames: normalizedPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? cleanStringList(worldBookNames)
                : [],
            snapshot: normalizedPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
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
        memory: {
            status: 'not-started',
            cards: [],
            updatedAt: '',
        },
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
            worldBookPolicy: policy,
            worldBookNames: policy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? cleanStringList(record?.inheritance?.worldBookNames)
                : [],
            snapshot: normalizeWorldBookSnapshot(record?.inheritance?.snapshot, createdAt),
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
        memory: {
            status: cleanText(record?.memory?.status, 40) || 'not-started',
            cards: Array.isArray(record?.memory?.cards) ? record.memory.cards : [],
            updatedAt: cleanText(record?.memory?.updatedAt, 60),
        },
        draft: normalizeDraft(record?.draft, chapters.length + 1, normalizeIsoDate(record.updatedAt, createdAt)),
    };
}

export function updateLongDreamDefinition(record, { title, canon, worldBookPolicy, worldBookNames, worldBookSnapshot } = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const policy = worldBookPolicy === undefined
        ? normalized.inheritance.worldBookPolicy
        : (worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
            ? LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
            : LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY);
    return {
        ...normalized,
        title: cleanText(title, 80) || normalized.title,
        canon: String(canon ?? normalized.canon).trim(),
        inheritance: {
            worldBookPolicy: policy,
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
    return {
        ...normalized,
        chapters: normalized.chapters.slice(0, index + 1),
        status: LONG_DREAM_STATUS.ACTIVE,
        draft: null,
        updatedAt: normalizeIsoDate(now, new Date().toISOString()),
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

export function saveLongDreamDraft(record, draft = {}, now = new Date()) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) throw new Error('长梦记录无效');
    const updatedAt = normalizeIsoDate(now, new Date().toISOString());
    const nextDraft = normalizeDraft({ ...draft, updatedAt }, normalized.chapters.length + 1, updatedAt);
    if (!nextDraft) throw new Error('长梦草稿不能为空');
    return { ...normalized, draft: nextDraft, updatedAt };
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
    const withChapter = appendLongDreamChapter(normalized, normalized.draft, now);
    return { ...withChapter, draft: null };
}
