import { buildLongDreamSummaryPayload, parseLongDreamMemoryResponse } from './long-dream-memory.js';
import { updateLongDreamMemoryState } from './long-dream.js';

// A response must never overwrite a decision or chapter saved while it ran.
export function summaryRevision(record) {
    return JSON.stringify([record.chapters, record.memory]);
}

export async function refreshLongDreamSummary({ record, request, readLatest, save, timeoutMs = 180000 }) {
    const payload = buildLongDreamSummaryPayload(record);
    const revision = summaryRevision(record);
    const controller = new AbortController();
    let timer;
    let response;
    try {
        response = await Promise.race([
            Promise.resolve().then(() => request(payload, { signal: controller.signal })),
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
    const patch = parseLongDreamMemoryResponse(response?.text || response, {
        pendingChapterNumbers: record.chapters.map(chapter => chapter.number),
    });
    if (!patch.currentState?.trim()) throw new Error('概要返回为空，请重试');
    const latest = await readLatest();
    if (!latest || summaryRevision(latest) !== revision) return null;
    const saved = await save(updateLongDreamMemoryState(latest, patch.currentState));
    if (!saved) {
        const error = new Error('概要保存失败');
        error.code = 'LONG_DREAM_SUMMARY_SAVE_FAILED';
        throw error;
    }
    return saved;
}
