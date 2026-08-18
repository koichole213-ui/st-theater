import {
    LONG_DREAM_DRAFT_RESUME_STAGE,
    LONG_DREAM_DRAFT_STATUS,
    LONG_DREAM_MAX_CANDIDATES,
    appendLongDreamDraftCandidate,
    normalizeLongDreamRecord,
    promoteLongDreamDraft,
    saveLongDreamDraft,
} from './long-dream.js';
import { buildLongDreamChapterMessages, buildLongDreamChapterPayload } from './long-dream-payload.js';
import { targetCompletionChars } from './generation-job.js';
import { readableCharCount } from './text-counter.js';

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
    if (generated.startsWith(existing)) return generated;
    return `${existing}\n\n${generated}`;
}

function normalizeMaxRounds(value) {
    return Math.min(10, Math.max(1, Math.floor(Number(value) || 1)));
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
    checkpointIntervalMs = 3000,
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
        presetEntries = [],
        presetName = '',
        postProcessing = '',
        squashSystemMessages = false,
        addons = '',
        instruction,
        chapterTitle = '',
        targetChars,
        autoContinue = false,
        maxRounds = 3,
        maxOptionalContextChars = 32000,
        appendCandidate = false,
        apiRoute,
        identitySlots = {},
        protagonistAnchor = '',
    } = {}) {
        if (active) throw new Error('已有长梦章节正在生成');
        let currentRecord = normalizeLongDreamRecord(record);
        if (!currentRecord) throw new Error('长梦记录无效');
        if (currentRecord.draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW && !appendCandidate) {
            throw new Error('当前有一章等待确认，请先保存或放弃后再续写');
        }
        const retainedCandidates = Array.isArray(currentRecord.draft?.candidates)
            ? currentRecord.draft.candidates
            : [];
        if (appendCandidate && retainedCandidates.length >= LONG_DREAM_MAX_CANDIDATES) {
            throw new Error(`同一章最多保留 ${LONG_DREAM_MAX_CANDIDATES} 版候选`);
        }
        const retainedSelectedCandidateIndex = Math.min(
            Math.max(0, retainedCandidates.length - 1),
            Math.max(0, Math.floor(Number(currentRecord.draft?.selectedCandidateIndex) || 0)),
        );

        const controller = createAbortController();
        const existingDraftText = currentRecord.draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING
            ? currentRecord.draft.text
            : '';
        const resumeRendering = currentRecord.draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING
            && currentRecord.draft?.resumeStage === LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING
            && !!cleanText(existingDraftText);
        const normalizedTitle = cleanText(chapterTitle)
            || currentRecord.draft?.title
            || `第 ${currentRecord.chapters.length + 1} 章`;
        const normalizedInstruction = instruction === undefined
            ? String(currentRecord.draft?.instruction || '')
            : String(instruction || '');
        const normalizedTargetChars = targetChars === undefined
            ? (currentRecord.draft?.targetChars || 3000)
            : targetChars;
        const target = Math.max(500, Math.min(8000, Math.round(Number(normalizedTargetChars) || 3000)));
        const shouldAutoContinue = autoContinue !== false;
        const allowedRounds = shouldAutoContinue ? normalizeMaxRounds(maxRounds) : 1;
        const completionChars = targetCompletionChars(target);
        let accumulatedText = existingDraftText;
        let roundBaseText = accumulatedText;
        let streamedText = '';
        let hasStreamCheckpoint = false;
        let lastCheckpointAt = Number.NEGATIVE_INFINITY;
        let persistence = Promise.resolve(currentRecord);
        let payload = null;
        let requestResult = null;
        let completedRounds = 0;
        let pendingDraftSnapshot = null;
        let persistenceActive = false;

        const queueDraftPersistence = ({
            status,
            text,
            html = '',
            mode = 'text',
            resumeStage = LONG_DREAM_DRAFT_RESUME_STAGE.WRITING,
        }) => {
            pendingDraftSnapshot = {
                status,
                resumeStage,
                title: normalizedTitle,
                instruction: normalizedInstruction,
                targetChars: target,
                text,
                html,
                mode,
                candidates: retainedCandidates,
                selectedCandidateIndex: retainedSelectedCandidateIndex,
            };
            if (persistenceActive) return persistence;
            persistenceActive = true;
            persistence = persistence.then(async latestRecord => {
                try {
                    while (pendingDraftSnapshot) {
                        const nextSnapshot = pendingDraftSnapshot;
                        pendingDraftSnapshot = null;
                        const nextRecord = saveLongDreamDraft(latestRecord, nextSnapshot, now());
                        latestRecord = await storeRecord(nextRecord);
                    }
                    return latestRecord;
                } finally {
                    persistenceActive = false;
                }
            });
            return persistence;
        };

        const checkpointWritingDraft = (force = false) => {
            const checkpointAt = Number(clock());
            const firstStreamCheckpoint = !hasStreamCheckpoint && cleanText(streamedText);
            const draftText = composeDraftText(roundBaseText, streamedText);
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

        active = {
            controller,
            stage: resumeRendering
                ? LONG_DREAM_GENERATION_STAGE.RENDERING
                : LONG_DREAM_GENERATION_STAGE.WRITING,
            round: resumeRendering ? 0 : 1,
            maxRounds: allowedRounds,
            startedAt: Number(clock()),
            firstChunkAt: cleanText(existingDraftText) ? Number(clock()) : null,
            currentChars: readableCharCount(existingDraftText),
            targetChars: target,
            candidateNumber: retainedCandidates.length + 1,
            retainedCandidateCount: retainedCandidates.length,
        };

        try {
            if (!resumeRendering) {
                await checkpointWritingDraft(true);
                currentRecord = await persistence;
                emitState(LONG_DREAM_GENERATION_STAGE.WRITING, {
                    record: currentRecord,
                    chapterTitle: normalizedTitle,
                    targetChars: target,
                    round: 1,
                    maxRounds: allowedRounds,
                });

                for (let round = 1; round <= allowedRounds; round++) {
                    roundBaseText = accumulatedText;
                    streamedText = '';
                    hasStreamCheckpoint = false;
                    lastCheckpointAt = Number.NEGATIVE_INFINITY;
                    if (active) active.round = round;
                    payload = buildLongDreamChapterPayload({
                        record: currentRecord,
                        preset,
                        addons,
                        instruction: normalizedInstruction,
                        chapterTitle: normalizedTitle,
                        targetChars: target,
                        currentDraft: roundBaseText,
                        finishThisRound: !shouldAutoContinue || round === allowedRounds,
                        maxOptionalContextChars,
                        structuredPreset: true,
                        continuationRound: round > 1 || !!cleanText(roundBaseText),
                        hasIdentityContext: Object.values(identitySlots || {}).some(value => cleanText(value)),
                        protagonistAnchor,
                    });
                    const messages = buildLongDreamChapterMessages({
                        payload,
                        presetEntries,
                        slots: identitySlots,
                        squashSystemMessages,
                    });

                    requestResult = await requestChapter({
                        systemPrompt: payload.systemPrompt,
                        userPrompt: payload.userPrompt,
                        messages,
                        postProcessing,
                        presetName,
                        signal: controller.signal,
                        targetChars: payload.targetChars,
                        round,
                        maxRounds: allowedRounds,
                        apiRoute,
                        onChunk: cumulativeText => {
                            streamedText = String(cumulativeText || '');
                            const draftText = composeDraftText(roundBaseText, streamedText);
                            if (active && cleanText(streamedText)) {
                                if (!active.firstChunkAt) active.firstChunkAt = Number(clock());
                                active.currentChars = readableCharCount(draftText);
                            }
                            onStream({
                                generatedText: streamedText,
                                draftText,
                                round,
                                maxRounds: allowedRounds,
                            });
                            checkpointWritingDraft(false);
                        },
                    });
                    streamedText = String(requestResult?.text ?? requestResult ?? streamedText);
                    if (!cleanText(streamedText)) throw new Error('长梦正文请求没有返回有效内容');
                    accumulatedText = composeDraftText(roundBaseText, streamedText);
                    if (active) {
                        if (!active.firstChunkAt) active.firstChunkAt = Number(clock());
                        active.currentChars = readableCharCount(accumulatedText);
                    }
                    completedRounds = round;
                    await checkpointWritingDraft(true);
                    currentRecord = await persistence;

                    if (!shouldAutoContinue || readableCharCount(accumulatedText) >= completionChars) break;
                }
            }

            const finalText = accumulatedText;
            if (!finalText.trim()) throw new Error('长梦正文请求没有返回有效内容');

            currentRecord = await queueDraftPersistence({
                status: LONG_DREAM_DRAFT_STATUS.WRITING,
                resumeStage: LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING,
                text: finalText,
            });
            if (active) active.currentChars = readableCharCount(finalText);

            emitState(LONG_DREAM_GENERATION_STAGE.RENDERING, {
                record: currentRecord,
                chapterTitle: normalizedTitle,
                text: finalText,
                rounds: completedRounds,
            });
            const rendered = normalizeRenderedChapter(await renderChapter({
                text: finalText,
                chapterTitle: normalizedTitle,
                targetChars: target,
                signal: controller.signal,
                apiRoute,
            }));
            persistence = persistence.then(async latestRecord => {
                const nextRecord = appendLongDreamDraftCandidate(latestRecord, {
                    text: finalText,
                    html: rendered.html,
                    mode: rendered.mode,
                    createdAt: now(),
                }, now());
                return storeRecord(nextRecord);
            });
            currentRecord = await persistence;
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
                rounds: completedRounds,
                actualChars: readableCharCount(finalText),
                targetCompletionChars: completionChars,
                completedBelowTarget: readableCharCount(finalText) < completionChars,
                stage: LONG_DREAM_GENERATION_STAGE.REVIEW,
            };
        } catch (error) {
            try {
                if (active?.stage === LONG_DREAM_GENERATION_STAGE.RENDERING && cleanText(accumulatedText)) {
                    await queueDraftPersistence({
                        status: LONG_DREAM_DRAFT_STATUS.WRITING,
                        resumeStage: LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING,
                        text: accumulatedText,
                    });
                } else {
                    await checkpointWritingDraft(true);
                }
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
            return active ? {
                stage: active.stage,
                aborted: active.controller.signal.aborted,
                round: active.round,
                maxRounds: active.maxRounds,
                startedAt: active.startedAt,
                firstChunkAt: active.firstChunkAt,
                currentChars: active.currentChars,
                targetChars: active.targetChars,
                candidateNumber: active.candidateNumber,
                retainedCandidateCount: active.retainedCandidateCount,
            } : null;
        },
    };
}
