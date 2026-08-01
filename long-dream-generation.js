import {
    LONG_DREAM_DRAFT_STATUS,
    normalizeLongDreamRecord,
    promoteLongDreamDraft,
    saveLongDreamDraft,
} from './long-dream.js';
import { buildLongDreamChapterPayload } from './long-dream-payload.js';

export const LONG_DREAM_GENERATION_STAGE = Object.freeze({
    WRITING: 'writing',
    RENDERING: 'rendering',
    REVIEW: 'review',
    STOPPED: 'stopped',
    ERROR: 'error',
});

const noop = () => {};

function cleanText(value) {
    return String(value || '').trim();
}

function composeDraftText(existingText, generatedText) {
    const existing = cleanText(existingText);
    const generated = cleanText(generatedText);
    if (!existing) return generated;
    if (!generated || existing.endsWith(generated)) return existing;
    return `${existing}\n\n${generated}`;
}

function normalizeRenderedChapter(rendered, fallbackMode = 'html') {
    const html = typeof rendered === 'string' ? rendered : String(rendered?.html || '');
    if (!html.trim()) throw new Error('长梦最终排版没有返回有效 HTML');
    return {
        html,
        mode: cleanText(rendered?.mode) || fallbackMode,
    };
}

function attachRecord(error, record) {
    if (error && typeof error === 'object') error.longDreamRecord = record;
    return error;
}

export function createLongDreamGenerationController({
    requestChapter,
    renderChapter,
    persistRecord = async record => record,
    onState = noop,
    onStream = noop,
    checkpointIntervalMs = 750,
    clock = () => Date.now(),
    now = () => new Date(),
    createAbortController = () => new AbortController(),
} = {}) {
    if (typeof requestChapter !== 'function') throw new Error('长梦生成控制器缺少正文请求器');
    if (typeof renderChapter !== 'function') throw new Error('长梦生成控制器缺少最终排版器');
    if (typeof persistRecord !== 'function') throw new Error('长梦生成控制器缺少存储适配器');

    let active = null;

    async function storeRecord(record) {
        const stored = await persistRecord(record);
        if (stored === false || stored === null) throw new Error('长梦草稿保存失败');
        const normalized = normalizeLongDreamRecord(stored ?? record);
        if (!normalized) throw new Error('长梦存储返回了无效记录');
        return normalized;
    }

    const emitState = (stage, details = {}) => {
        if (active) active.stage = stage;
        onState({ stage, ...details });
    };

    async function run({
        record,
        preset = '',
        addons = '',
        instruction,
        chapterTitle = '',
        targetChars,
        maxOptionalContextChars = Infinity,
    } = {}) {
        if (active) throw new Error('已有长梦章节正在生成');
        let currentRecord = normalizeLongDreamRecord(record);
        if (!currentRecord) throw new Error('长梦记录无效');
        if (currentRecord.draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW) {
            throw new Error('当前有一章等待确认，请先保存或放弃后再续写');
        }

        const controller = createAbortController();
        const existingDraftText = currentRecord.draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING
            ? currentRecord.draft.text
            : '';
        const normalizedTitle = cleanText(chapterTitle)
            || currentRecord.draft?.title
            || `第 ${currentRecord.chapters.length + 1} 章`;
        const normalizedInstruction = instruction === undefined
            ? String(currentRecord.draft?.instruction || '')
            : String(instruction || '');
        const normalizedTargetChars = targetChars === undefined
            ? (currentRecord.draft?.targetChars || 3000)
            : targetChars;
        let streamedText = '';
        let hasStreamCheckpoint = false;
        let lastCheckpointAt = Number.NEGATIVE_INFINITY;
        let persistence = Promise.resolve(currentRecord);

        const queueDraftPersistence = ({ status, text, html = '', mode = 'text' }) => {
            const draftSnapshot = {
                status,
                title: normalizedTitle,
                instruction: normalizedInstruction,
                targetChars: payload.targetChars,
                text,
                html,
                mode,
            };
            persistence = persistence.then(async latestRecord => {
                const nextRecord = saveLongDreamDraft(latestRecord, draftSnapshot, now());
                return storeRecord(nextRecord);
            });
            return persistence;
        };

        const checkpointWritingDraft = (force = false) => {
            const checkpointAt = Number(clock());
            const firstStreamCheckpoint = !hasStreamCheckpoint && cleanText(streamedText);
            const draftText = composeDraftText(existingDraftText, streamedText);
            // 本章方向允许留空；在首个正文片段到来前，不制造一份完全空的草稿。
            if (!draftText && !cleanText(normalizedInstruction)) return persistence;
            if (!force && !firstStreamCheckpoint
                && checkpointAt - lastCheckpointAt < Math.max(0, Number(checkpointIntervalMs) || 0)) {
                return persistence;
            }
            if (firstStreamCheckpoint) hasStreamCheckpoint = true;
            lastCheckpointAt = checkpointAt;
            return queueDraftPersistence({
                status: LONG_DREAM_DRAFT_STATUS.WRITING,
                text: draftText,
            });
        };

        const payload = buildLongDreamChapterPayload({
            record: currentRecord,
            preset,
            addons,
            instruction: normalizedInstruction,
            chapterTitle: normalizedTitle,
            targetChars: normalizedTargetChars,
            currentDraft: existingDraftText,
            maxOptionalContextChars,
        });

        active = { controller, stage: LONG_DREAM_GENERATION_STAGE.WRITING };

        try {
            await checkpointWritingDraft(true);
            currentRecord = await persistence;
            emitState(LONG_DREAM_GENERATION_STAGE.WRITING, {
                record: currentRecord,
                chapterTitle: normalizedTitle,
                targetChars: payload.targetChars,
            });

            const requestResult = await requestChapter({
                systemPrompt: payload.systemPrompt,
                userPrompt: payload.userPrompt,
                signal: controller.signal,
                targetChars: payload.targetChars,
                onChunk: cumulativeText => {
                    streamedText = String(cumulativeText || '');
                    const draftText = composeDraftText(existingDraftText, streamedText);
                    onStream({ generatedText: streamedText, draftText });
                    checkpointWritingDraft(false);
                },
            });
            streamedText = String(requestResult?.text ?? requestResult ?? streamedText);
            const finalText = composeDraftText(existingDraftText, streamedText);
            if (!finalText.trim()) throw new Error('长梦正文请求没有返回有效内容');
            await checkpointWritingDraft(true);
            currentRecord = await persistence;

            emitState(LONG_DREAM_GENERATION_STAGE.RENDERING, {
                record: currentRecord,
                chapterTitle: normalizedTitle,
                text: finalText,
            });
            const rendered = normalizeRenderedChapter(await renderChapter({
                text: finalText,
                chapterTitle: normalizedTitle,
                targetChars: payload.targetChars,
                signal: controller.signal,
            }));
            currentRecord = await queueDraftPersistence({
                status: LONG_DREAM_DRAFT_STATUS.REVIEW,
                text: finalText,
                html: rendered.html,
                mode: rendered.mode,
            });
            emitState(LONG_DREAM_GENERATION_STAGE.REVIEW, {
                record: currentRecord,
                chapterTitle: normalizedTitle,
                text: finalText,
                html: rendered.html,
                mode: rendered.mode,
            });
            return {
                record: currentRecord,
                payload,
                requestResult,
                stage: LONG_DREAM_GENERATION_STAGE.REVIEW,
            };
        } catch (error) {
            try {
                await checkpointWritingDraft(true);
                currentRecord = await persistence;
            } catch (persistError) {
                attachRecord(persistError, currentRecord);
                throw persistError;
            }
            const stopped = controller.signal.aborted || error?.name === 'AbortError';
            emitState(stopped ? LONG_DREAM_GENERATION_STAGE.STOPPED : LONG_DREAM_GENERATION_STAGE.ERROR, {
                record: currentRecord,
                error,
            });
            throw attachRecord(error, currentRecord);
        } finally {
            active = null;
        }
    }

    async function confirm(record) {
        if (active) throw new Error('生成进行中，不能确认章节');
        const promoted = promoteLongDreamDraft(record, now());
        return storeRecord(promoted);
    }

    function abort(reason = 'user') {
        if (!active || active.controller.signal.aborted) return false;
        active.controller.abort(reason);
        return true;
    }

    return {
        run,
        confirm,
        abort,
        get active() {
            return active ? { stage: active.stage, aborted: active.controller.signal.aborted } : null;
        },
    };
}
