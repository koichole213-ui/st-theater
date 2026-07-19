export const MAX_CONTEXT_MESSAGES = 500;

export function normalizeContextRange(value, fallback = 10) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return normalizeContextRange(fallback, 10);
    return Math.min(MAX_CONTEXT_MESSAGES, Math.max(0, Math.floor(parsed)));
}

export function takeRecentMessages(messages, value) {
    const list = Array.isArray(messages) ? messages : [];
    const count = normalizeContextRange(value);
    if (count === 0) return [];
    return list.slice(-count);
}
