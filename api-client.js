export const API_PROTOCOLS = Object.freeze({ AUTO: 'auto', OPENAI: 'openai', ANTHROPIC: 'anthropic' });
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

export function resolveMainApiModel(ctx, oai = ctx?.oai_settings) {
    const fromContext = typeof ctx?.getChatCompletionModel === 'function'
        ? ctx.getChatCompletionModel()
        : '';
    return String(fromContext || oai?.openai_model || oai?.model || '').trim();
}

export function normalizeMaxTokens(value, fallback = DEFAULT_MAX_OUTPUT_TOKENS) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(131072, Math.max(256, parsed));
}

export function resolveProtocol(selected, url = '') {
    if (selected === API_PROTOCOLS.OPENAI || selected === API_PROTOCOLS.ANTHROPIC) return selected;
    return /anthropic|claude/i.test(url) ? API_PROTOCOLS.ANTHROPIC : API_PROTOCOLS.OPENAI;
}

export function buildApiEndpoint(url, protocol) {
    const base = String(url || '').replace(/\/+$/, '');
    const path = protocol === API_PROTOCOLS.ANTHROPIC ? '/messages' : '/chat/completions';
    if (base.endsWith(path)) return base;
    if (base.endsWith('/v1')) return base + path;
    return base + '/v1' + path;
}

export function buildApiRequest({ url, protocol, key, model, systemPrompt, userPrompt, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS, stream = true }) {
    const resolved = resolveProtocol(protocol, url);
    const endpoint = buildApiEndpoint(url, resolved);
    if (resolved === API_PROTOCOLS.ANTHROPIC) {
        return {
            protocol: resolved, endpoint,
            headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: { model, max_tokens: maxTokens, stream, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] },
        };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    return {
        protocol: resolved, endpoint, headers,
        body: { model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream, max_tokens: maxTokens },
    };
}

export function maxTokenFallbackSequence(value) {
    const requested = normalizeMaxTokens(value);
    const standardLimits = [16384, 8192, 4096, 2048, 1024, 512, 256];
    return [requested, ...standardLimits.filter(limit => limit < requested)]
        .filter((limit, index, all) => all.indexOf(limit) === index);
}

export function isMaxTokenLimitError(status, body = '') {
    if (![400, 413, 422].includes(Number(status))) return false;
    const text = String(body || '');
    return /max[_\s-]?tokens|max(?:imum)?\s+output\s+tokens|maximum\s+context\s+length|context[_\s-]?length|requested\s+tokens/i.test(text)
        && /too\s+(?:large|high|many)|exceed|limit|maximum|at\s+most|less\s+than|must\s+be|<=|not\s+support/i.test(text);
}

export function normalizeStopReason(raw) {
    if (raw === 'length' || raw === 'max_tokens') return 'length';
    if (raw === 'stop' || raw === 'end_turn' || raw === 'stop_sequence') return 'stop';
    return raw ? 'unknown' : 'unknown';
}

export function isHtmlErrorResponse(contentType = '', text = '') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('text/html') || type.includes('application/xhtml+xml')) return true;
    return /^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(String(text || ''));
}

export function extractResponseMeta(json, protocol = API_PROTOCOLS.OPENAI) {
    const rawStopReason = protocol === API_PROTOCOLS.ANTHROPIC
        ? (json?.stop_reason || json?.delta?.stop_reason)
        : json?.choices?.[0]?.finish_reason;
    return { stopReason: normalizeStopReason(rawStopReason), rawStopReason: rawStopReason || null, usage: json?.usage || null };
}
