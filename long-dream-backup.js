import { LONG_DREAM_SCHEMA_VERSION, normalizeLongDreamRecord } from './long-dream.js';

export const LONG_DREAM_BACKUP_FORMAT = 'st-theater-long-dream';
export const LONG_DREAM_BACKUP_VERSION = 1;
export const MAX_LONG_DREAM_BACKUP_BYTES = 25 * 1024 * 1024;

function cleanText(value, limit = 0) {
    const text = String(value || '').trim();
    return limit > 0 ? text.slice(0, limit) : text;
}

function cleanList(values, limit = 100) {
    const result = [];
    const seen = new Set();
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

function safeDate(value, fallback) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function safeReference(value, limit = 160) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text ? text.slice(0, limit) : null;
}

function safeSourceConfig(config = {}) {
    return {
        metadataCaptured: config?.metadataCaptured === true,
        presetName: cleanText(config?.presetName, 300),
        selectedWorldBooks: cleanList(config?.selectedWorldBooks),
        readChatContext: config?.readChatContext !== false,
        contextRange: Math.max(0, Math.floor(Number(config?.contextRange) || 0)),
        renderSelection: cleanText(config?.renderSelection, 100),
        renderLabel: cleanText(config?.renderLabel, 200),
        textTheme: cleanText(config?.textTheme, 40),
    };
}

function safeSnapshot(snapshot = null, fallbackDate) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const books = (Array.isArray(snapshot.books) ? snapshot.books : []).map(book => {
        const name = cleanText(book?.name, 300);
        if (!name) return null;
        const entries = (Array.isArray(book.entries) ? book.entries : []).map(entry => {
            const content = String(entry?.content || '');
            if (!content.trim()) return null;
            return {
                uid: safeReference(entry?.uid),
                name: cleanText(entry?.name, 300),
                content,
                keys: cleanList(entry?.keys),
                secondaryKeys: cleanList(entry?.secondaryKeys),
                constant: entry?.constant === true,
                vectorized: entry?.vectorized === true,
                selective: entry?.selective === true,
                selectiveLogic: Number.isFinite(Number(entry?.selectiveLogic)) ? Number(entry.selectiveLogic) : null,
                caseSensitive: entry?.caseSensitive === true,
                matchWholeWords: entry?.matchWholeWords === true,
                position: Number.isFinite(Number(entry?.position)) ? Number(entry.position) : null,
                order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : null,
            };
        }).filter(Boolean);
        return { name, entries };
    }).filter(Boolean);
    return books.length ? { capturedAt: safeDate(snapshot.capturedAt, fallbackDate), books } : null;
}

function safeChapter(chapter = {}, fallbackDate, index = 0) {
    const text = String(chapter?.text || '');
    const html = String(chapter?.html || '');
    if (!text.trim() && !html.trim()) return null;
    return {
        id: `chapter-${index + 1}`,
        number: index + 1,
        title: cleanText(chapter?.title, 80) || `第 ${index + 1} 章`,
        instruction: String(chapter?.instruction || ''),
        targetChars: Math.max(500, Math.min(8000, Math.round(Number(chapter?.targetChars) || 3000))),
        text,
        html,
        mode: cleanText(chapter?.mode, 40) || (html.trim() ? 'html' : 'text'),
        createdAt: safeDate(chapter?.createdAt, fallbackDate),
    };
}

function safeDraft(draft = null, fallbackDate, nextNumber, { includeReviewDraft = false } = {}) {
    if (!draft || typeof draft !== 'object') return null;
    const hasCandidates = Array.isArray(draft.candidates) && draft.candidates.length > 0;
    if ((draft.status === 'review' || hasCandidates) && !includeReviewDraft) return null;
    const text = String(draft.text || '');
    const html = String(draft.html || '');
    const instruction = String(draft.instruction || '');
    if (!text.trim() && !html.trim() && !instruction.trim()) return null;
    const status = draft.status === 'review' && text.trim() && html.trim() ? 'review' : 'writing';
    return {
        status,
        resumeStage: status === 'writing' && draft.resumeStage === 'rendering' && text.trim()
            ? 'rendering'
            : 'writing',
        chapterNumber: nextNumber,
        title: cleanText(draft.title, 80) || `第 ${nextNumber} 章`,
        instruction,
        targetChars: Math.max(500, Math.min(8000, Math.round(Number(draft.targetChars) || 3000))),
        text,
        html,
        mode: cleanText(draft.mode, 40) || (html.trim() ? 'html' : 'text'),
        updatedAt: safeDate(draft.updatedAt, fallbackDate),
    };
}

function safeMemory(memory = {}, fallbackDate) {
    const cards = (Array.isArray(memory?.cards) ? memory.cards : []).map((card, index) => {
        if (typeof card === 'string') {
            const content = cleanText(card, 2000);
            return content ? { id: `legacy-memory-${index + 1}`, type: 'note', title: '', content, quote: '', status: 'confirmed', tags: [], chapterId: '', chapterNumber: null, createdAt: fallbackDate, updatedAt: fallbackDate } : null;
        }
        const content = cleanText(card?.content || card?.text || card?.summary, 4000);
        if (!content) return null;
        return {
            id: cleanText(card?.id, 120) || `memory-${index + 1}`,
            type: cleanText(card?.type, 80) || 'note',
            title: cleanText(card?.title, 200),
            content,
            quote: cleanText(card?.quote, 1000),
            status: cleanText(card?.status, 40) || 'confirmed',
            tags: cleanList(card?.tags, 50),
            chapterId: cleanText(card?.chapterId, 120),
            chapterNumber: Number.isFinite(Number(card?.chapterNumber)) ? Math.max(1, Math.floor(Number(card.chapterNumber))) : null,
            createdAt: safeDate(card?.createdAt, fallbackDate),
            updatedAt: safeDate(card?.updatedAt, fallbackDate),
        };
    }).filter(Boolean);
    return {
        status: cleanText(memory?.status, 40) || 'not-started',
        cards,
        currentState: cleanText(memory?.currentState, 5000),
        processedThroughChapter: Math.max(0, Math.floor(Number(memory?.processedThroughChapter) || 0)),
        pendingChapterNumbers: (Array.isArray(memory?.pendingChapterNumbers) ? memory.pendingChapterNumbers : [])
            .map(value => Math.max(1, Math.floor(Number(value) || 0)))
            .filter(Boolean),
        updatedAt: safeDate(memory?.updatedAt, fallbackDate),
        lastErrorSignal: cleanText(memory?.lastErrorSignal, 80),
    };
}

export function sanitizeLongDreamBackupRecord(record = {}, { includeReviewDraft = false } = {}) {
    const normalized = normalizeLongDreamRecord(record);
    if (!normalized) return null;
    const createdAt = safeDate(normalized.createdAt, new Date().toISOString());
    const chapters = normalized.chapters.map((chapter, index) => safeChapter(chapter, createdAt, index)).filter(Boolean);
    if (!chapters.length) return null;
    const updatedAt = safeDate(normalized.updatedAt, createdAt);
    return {
        schemaVersion: LONG_DREAM_SCHEMA_VERSION,
        title: cleanText(normalized.title, 80) || '导入的长梦',
        status: normalized.status === 'complete' ? 'complete' : 'active',
        createdAt,
        updatedAt,
        canon: String(normalized.canon || '').trim(),
        inheritance: {
            worldBookPolicy: normalized.inheritance?.worldBookPolicy === 'selected' ? 'selected' : 'branch-only',
            worldLineRelation: cleanText(normalized.inheritance?.worldLineRelation, 40),
            worldBookNames: cleanList(normalized.inheritance?.worldBookNames),
            snapshot: safeSnapshot(normalized.inheritance?.snapshot, createdAt),
        },
        source: {
            kind: cleanText(normalized.source?.kind, 30) || 'unknown',
            refId: safeReference(normalized.source?.refId),
            title: cleanText(normalized.source?.title, 120),
            instruction: String(normalized.source?.instruction || ''),
            capturedAt: safeDate(normalized.source?.capturedAt, createdAt),
        },
        sourceConfig: safeSourceConfig(normalized.sourceConfig),
        chapters,
        memory: safeMemory(normalized.memory, updatedAt),
        draft: safeDraft(normalized.draft, updatedAt, chapters.length + 1, { includeReviewDraft }),
    };
}

export function createLongDreamBackup(records = [], { now = new Date() } = {}) {
    const dreams = (Array.isArray(records) ? records : [])
        .map(record => sanitizeLongDreamBackupRecord(record))
        .filter(Boolean);
    return {
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        exportedAt: safeDate(now, new Date().toISOString()),
        dreams,
    };
}

export function parseLongDreamBackup(data) {
    if (!data || typeof data !== 'object' || data.format !== LONG_DREAM_BACKUP_FORMAT) {
        throw new Error('这不是千夜浮梦长梦备份文件');
    }
    const version = Number(data.version || 0);
    if (!Number.isInteger(version) || version < 1 || version > LONG_DREAM_BACKUP_VERSION) {
        throw new Error(`不支持的长梦备份版本：${data.version ?? '未知'}`);
    }
    const dreams = (Array.isArray(data.dreams) ? data.dreams : [])
        .map(record => sanitizeLongDreamBackupRecord(record, { includeReviewDraft: true }))
        .filter(Boolean);
    if (!dreams.length) throw new Error('备份中没有可导入的有效长梦');
    return dreams;
}
