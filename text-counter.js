export function readableCharCount(text) {
    const matches = String(text || '').match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]/g);
    return matches ? matches.length : 0;
}

export function normalizeContinuationText(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function normalizeGeneratedText(text) {
    return String(text || '')
        .replace(/^```(?:html|markdown|text)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
}

export function tailText(text, maxChars = 1600) {
    const value = String(text || '').trim();
    return value.length > maxChars ? value.slice(-maxChars) : value;
}

export const MAX_CONTINUATION_CONTEXT_CHARS = 8000;

export function continuationContextWindow(text, maxChars = MAX_CONTINUATION_CONTEXT_CHARS) {
    const value = normalizeContinuationText(text);
    const limit = Math.max(1, Math.floor(Number(maxChars) || MAX_CONTINUATION_CONTEXT_CHARS));
    if (readableCharCount(value) <= limit) return value;

    const characters = Array.from(value);
    let readable = 0;
    let start = characters.length;
    for (let index = characters.length - 1; index >= 0; index--) {
        const isReadable = readableCharCount(characters[index]) > 0;
        if (isReadable && readable >= limit) break;
        if (isReadable) readable++;
        start = index;
    }
    return `…（更早内容已省略）\n\n${characters.slice(start).join('').trim()}`;
}
