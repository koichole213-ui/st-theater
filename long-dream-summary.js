import { buildLongDreamSummaryPayload, parseLongDreamMemoryResponse } from './long-dream-memory.js';
import { mergeStoryResponse, saveStorySummary, validStoryEntries } from './long-dream-story-summary.js';

// A response must never overwrite a decision or chapter saved while it ran.
export function summaryRevision(record) {
    return JSON.stringify([record.chapters, record.memory, record.canon, record.inheritance]);
}

export async function refreshLongDreamSummary({ record, request, readLatest, save, timeoutMs = 180000, replace = true }) {
    buildLongDreamSummaryPayload(record); // Validate before starting any request.
    const revision = summaryRevision(record);
    const existing = new Set(validStoryEntries(record).map(item => item.chapterNumber));
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
        // Preserve the existing classified network hint, never arbitrary response/error text.
        if (stage === 'request' && cause?.diagnosticSignal) error.diagnosticSignal = cause.diagnosticSignal;
        throw error;
    } finally {
        clearTimeout(timer);
    }
    const latest = await readLatest();
    if (!latest || summaryRevision(latest) !== revision) return null;
    let saved;
    try {
        saved = await save(saveStorySummary(latest, entries));
        if (!saved) throw new Error('save returned no record');
    } catch {
        const error = new Error('概要保存失败');
        error.code = 'LONG_DREAM_SUMMARY_SAVE_FAILED';
        error.summaryDiagnostic = { stage: 'save', batch, expectedCount, receivedCount };
        throw error;
    }
    return saved;
}
