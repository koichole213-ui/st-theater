export function readableCharCount(text) {
    const matches = String(text || '').match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]/g);
    return matches ? matches.length : 0;
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
