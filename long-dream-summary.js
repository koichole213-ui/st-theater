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
    try {
        entries = await Promise.race([
            (async () => {
                const responses = [];
                // Bound output size without discarding early chapters. Commit only when all batches succeed.
                for (let start = 0; start < sourceChapters.length; start += 5) {
                    if (controller.signal.aborted) throw new Error('概要更新已停止');
                    const chapters = sourceChapters.slice(start, start + 5);
                    const payload = buildLongDreamSummaryPayload({ ...record, chapters });
                    const response = await request(payload, { signal: controller.signal });
                    if (controller.signal.aborted) throw new Error('概要更新已停止');
                    const patch = parseLongDreamMemoryResponse(response?.text || response, { pendingChapterNumbers: chapters.map(chapter => chapter.number) });
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
    } finally {
        clearTimeout(timer);
    }
    const latest = await readLatest();
    if (!latest || summaryRevision(latest) !== revision) return null;
    const saved = await save(saveStorySummary(latest, entries));
    if (!saved) {
        const error = new Error('概要保存失败');
        error.code = 'LONG_DREAM_SUMMARY_SAVE_FAILED';
        throw error;
    }
    return saved;
}
