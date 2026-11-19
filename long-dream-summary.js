import { buildLongDreamSummaryPayload, parseLongDreamMemoryResponse } from './long-dream-memory.js';
import { mergeStoryResponse, saveStorySummary, hasPendingManualSummary, coveredStoryChapters, condenseSummaryPlan, saveCondensedSummary } from './long-dream-story-summary.js';
import { reasoningSafeContent } from './reasoning-filter.js';

// A response must never overwrite a decision or chapter saved while it ran.
export function summaryRevision(record) {
    return JSON.stringify([record.chapters, record.memory, record.canon, record.inheritance]);
}

export async function refreshLongDreamSummary({ record, request, readLatest, save, timeoutMs = 180000, replace = true }) {
    if (!replace && hasPendingManualSummary(record)) throw Object.assign(new Error('请先核对人工概要'), { code: 'LONG_DREAM_SUMMARY_MANUAL_REVIEW' });
    buildLongDreamSummaryPayload(record); // Validate before starting any request.
    const revision = summaryRevision(record);
    const existing = coveredStoryChapters(record);
    const sourceChapters = replace ? record.chapters : record.chapters.filter(chapter => !existing.has(chapter.number));
    const controller = new AbortController();
    let timer;
    let entries;
    let stage = 'request';
    let batch = 0;
    let expectedCount = 0;
    let receivedCount = 0;
    try {
        entries = await Promise.race([
            (async () => {
                const responses = [];
                // Bound output size without discarding early chapters. Commit only when all batches succeed.
                for (let start = 0; start < sourceChapters.length; start += 5) {
                    if (controller.signal.aborted) throw new Error('概要更新已停止');
                    const chapters = sourceChapters.slice(start, start + 5);
                    batch++;
                    expectedCount = chapters.length;
                    receivedCount = 0;
                    stage = 'request';
                    const payload = buildLongDreamSummaryPayload({ ...record, chapters });
                    const response = await request(payload, { signal: controller.signal });
                    if (controller.signal.aborted) throw new Error('概要更新已停止');
                    stage = 'parse';
                    const patch = parseLongDreamMemoryResponse(response?.text || response, { pendingChapterNumbers: chapters.map(chapter => chapter.number) });
                    stage = 'coverage';
                    receivedCount = Array.isArray(patch.storyEntries) ? patch.storyEntries.length : 0;
                    // Per-batch coverage must be complete; no partial version is saved.
                    mergeStoryResponse({ ...record, chapters }, patch.storyEntries, { replace: true });
                    responses.push(...patch.storyEntries);
                }
                return mergeStoryResponse(record, responses, { replace });
            })(),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new Error('概要更新等待超时');
                    error.code = 'LONG_DREAM_SUMMARY_TIMEOUT';
                    reject(error);
                    controller.abort();
                }, timeoutMs);
            }),
        ]);
    } catch (cause) {
        const knownCodes = ['MISSING_ENTRIES', 'COVERAGE', 'EMPTY_ENTRY', 'ENTRY_TOO_LONG', 'TIMEOUT'].map(code => `LONG_DREAM_SUMMARY_${code}`);
        const code = knownCodes.includes(cause?.code) ? cause.code : `LONG_DREAM_SUMMARY_${stage === 'parse' ? 'PARSE_FAILED' : 'REQUEST_FAILED'}`;
        const error = Object.assign(new Error('概要更新失败'), { code,
            summaryDiagnostic: { stage, batch, expectedCount, receivedCount } });
        // Preserve structured diagnostics and separately redacted provider wording.
        if (stage === 'request' && cause?.diagnosticSignal) {
            error.diagnosticSignal = cause.diagnosticSignal;
            if (cause.theaterFailure) error.theaterFailure = cause.theaterFailure;
            if (cause.providerMessage) error.providerMessage = cause.providerMessage;
            if (cause.apiConnectionSummary) error.apiConnectionSummary = cause.apiConnectionSummary;
            if (cause.apiResponseSummary) error.apiResponseSummary = cause.apiResponseSummary;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
    const latest = await readLatest();
    if (!latest || summaryRevision(latest) !== revision) return null;
    let saved;
    try {
        saved = await save(saveStorySummary(latest, entries, undefined, { replaceFull: replace }));
        if (!saved) throw new Error('save returned no record');
    } catch {
        const error = new Error('概要保存失败');
        error.code = 'LONG_DREAM_SUMMARY_SAVE_FAILED';
        error.summaryDiagnostic = { stage: 'save', batch, expectedCount, receivedCount };
        throw error;
    }
    return saved;
}

export function buildLongDreamCondensePayload(record, plan = condenseSummaryPlan(record)) {
    if (plan.reason) throw Object.assign(new Error(plan.reason), { code: 'LONG_DREAM_CONDENSE_UNAVAILABLE' });
    const systemPrompt = [
        '你负责把一部长篇故事较早章节的概要压缩成一段整篇概要，供之后续写时回顾前情。',
        '只依据提供的概要和此梦设定，不续写、不补充没有写到的情节、不评价。',
        '按时间先后保留：故事开端与人物相遇；每个关键转折的起因和结果；人物关系怎样一步步变化；尚未回收的伏笔、约定、秘密和误会；仍会影响后文的伤势、身份、物品去向。',
        '合并重复的内容，删去对后文没有影响的日常过程、对话细节和氛围描写。人物名、地名、物品名照原文写，不改称呼。',
        '过去发生的事照实写，不要用后来的状态改写当时的关系。',
        `目标约 ${plan.targetChars} 字，不超过 ${plan.maxChars} 字。`,
        '只输出概要正文，可以分几段；不加标题、章号、序号、Markdown 或任何说明。',
    ].join('\n');
    const canon = String(record.canon || '').trim();
    const userPrompt = [
        canon ? `【此梦设定】\n${canon}` : '',
        `【第 1～${plan.through} 章的现有概要】\n${plan.source}`,
        `请把以上第 1～${plan.through} 章的内容压缩成一段整篇概要。`,
    ].filter(Boolean).join('\n\n---\n\n');
    return { systemPrompt, userPrompt, through: plan.through };
}

export function cleanCondensedSummary(value) {
    return reasoningSafeContent(String(value ?? '')).trim()
        .replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function condenseLongDreamSummary({ record, request, readLatest, save, timeoutMs = 180000 }) {
    const plan = condenseSummaryPlan(record);
    const payload = buildLongDreamCondensePayload(record, plan);
    const revision = summaryRevision(record);
    const controller = new AbortController();
    let timer;
    let text;
    let stage = 'request';
    try {
        const response = await Promise.race([
            request(payload, { signal: controller.signal }),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(Object.assign(new Error('精简概要等待超时'), { code: 'LONG_DREAM_SUMMARY_TIMEOUT' }));
                    controller.abort();
                }, timeoutMs);
            }),
        ]);
        stage = 'check';
        text = cleanCondensedSummary(response?.text ?? response);
        if (!text) throw Object.assign(new Error('精简结果为空'), { code: 'LONG_DREAM_CONDENSE_EMPTY' });
        if (text.length > plan.maxChars) throw Object.assign(new Error('精简结果没有明显变短'), { code: 'LONG_DREAM_CONDENSE_NOT_SHORTER' });
        if (text.length < Math.min(200, plan.targetChars / 2)) throw Object.assign(new Error('精简结果太短'), { code: 'LONG_DREAM_CONDENSE_TOO_SHORT' });
    } catch (cause) {
        const known = ['LONG_DREAM_SUMMARY_TIMEOUT', 'LONG_DREAM_CONDENSE_EMPTY', 'LONG_DREAM_CONDENSE_NOT_SHORTER', 'LONG_DREAM_CONDENSE_TOO_SHORT'];
        const error = Object.assign(new Error('精简概要失败'), { code: known.includes(cause?.code) ? cause.code : 'LONG_DREAM_SUMMARY_REQUEST_FAILED',
            summaryDiagnostic: { stage, through: plan.through, sourceChars: plan.source.length, resultChars: text?.length || 0 } });
        if (stage === 'request' && cause?.diagnosticSignal) {
            for (const key of ['diagnosticSignal', 'theaterFailure', 'providerMessage', 'apiConnectionSummary', 'apiResponseSummary']) if (cause[key]) error[key] = cause[key];
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
    const latest = await readLatest();
    if (!latest || summaryRevision(latest) !== revision) return null;
    let saved;
    try {
        saved = await save(saveCondensedSummary(latest, text, plan.through));
        if (!saved) throw new Error('save returned no record');
    } catch {
        throw Object.assign(new Error('概要保存失败'), { code: 'LONG_DREAM_SUMMARY_SAVE_FAILED' });
    }
    return { saved, through: plan.through, beforeChars: plan.source.length, afterChars: text.length };
}
