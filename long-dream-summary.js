import { buildLongDreamSummaryPayload, parseLongDreamMemoryResponse } from './long-dream-memory.js';
import { updateLongDreamMemoryState } from './long-dream.js';

// A response must never overwrite a decision or chapter saved while it ran.
export function summaryRevision(record) {
    return JSON.stringify([record.chapters, record.memory]);
}

export async function refreshLongDreamSummary({ record, request, readLatest, save }) {
    const payload = buildLongDreamSummaryPayload(record);
    const revision = summaryRevision(record);
    const response = await request(payload);
    const patch = parseLongDreamMemoryResponse(response?.text || response, {
        pendingChapterNumbers: record.chapters.map(chapter => chapter.number),
    });
    if (!patch.currentState?.trim()) throw new Error('概要返回为空，请重试');
    const latest = await readLatest();
    if (!latest || summaryRevision(latest) !== revision) return null;
    return save(updateLongDreamMemoryState(latest, patch.currentState));
}
