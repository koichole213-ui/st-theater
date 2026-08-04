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
    return /max[_\s-]?tokens|max(?:imum)?\s+output\s+tokens|maximum\s+context\s+length|context[_\s-]?length|requested\s+tokens|上下文(?:窗口|长度)?|对话历史|系统提示/i.test(text)
        && /too\s+(?:large|high|many)|exceed|limit|maximum|at\s+most|less\s+than|must\s+be|<=|not\s+support|已满|超出|过长|减少|限制|上限/i.test(text);
}

export function retryAfterMilliseconds(value, now = Date.now()) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const seconds = Number(text);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
    const timestamp = Date.parse(text);
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, timestamp - Number(now || 0));
}

export function isRateLimitErrorMessage(value) {
    return /(?:\b429\b|too many requests|rate[\s_-]*limit|resource exhausted|quota (?:exceeded|exhausted)|请求过于频繁|限流)/i
        .test(String(value || ''));
}

const CONTENT_BLOCK_REASONS = Object.freeze({
    content_filter: 'content_filter',
    content_policy: 'content_policy',
    safety: 'safety',
    prohibited_content: 'prohibited_content',
    blocklist: 'blocklist',
    spii: 'spii',
    recitation: 'recitation',
    model_armor: 'model_armor',
    image_safety: 'image_safety',
    image_prohibited_content: 'image_prohibited_content',
    jailbreak: 'jailbreak',
    refusal: 'refusal',
});

export function contentBlockReason(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
    return CONTENT_BLOCK_REASONS[normalized] || null;
}

export function isContentBlockedStopReason(value) {
    return !!contentBlockReason(value);
}

export function isContentBlockedErrorMessage(value) {
    const text = String(value || '');
    return isContentBlockedStopReason(text)
        || /content[\s_-]*(?:filter|policy)|\bsafety(?:\s+filter)?\b|prohibited[\s_-]*content|blocklist|\bspii\b|recitation|model[\s_-]*armor|jailbreak/i.test(text);
}

export function normalizeStopReason(raw) {
    const value = String(raw || '').toLowerCase();
    if (value === 'length' || value === 'max_tokens' || value === 'max_tokens_reached') return 'length';
    if (value === 'stop' || value === 'end_turn' || value === 'stop_sequence') return 'stop';
    if (isContentBlockedStopReason(value)) return 'blocked';
    return raw ? 'unknown' : 'unknown';
}

export function isHtmlErrorResponse(contentType = '', text = '') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('text/html') || type.includes('application/xhtml+xml')) return true;
    return /^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(String(text || ''));
}

export function extractResponseMeta(json, protocol = API_PROTOCOLS.OPENAI) {
    const candidateReason = protocol === API_PROTOCOLS.ANTHROPIC
        ? (json?.stop_reason || json?.delta?.stop_reason)
        : (json?.choices?.[0]?.finish_reason || json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason);
    const promptBlockReason = json?.promptFeedback?.blockReason || json?.prompt_feedback?.block_reason || null;
    const rawStopReason = candidateReason || promptBlockReason || null;
    return {
        stopReason: normalizeStopReason(rawStopReason),
        rawStopReason,
        blockReason: contentBlockReason(candidateReason) || contentBlockReason(promptBlockReason),
        usage: json?.usage || null,
    };
}

export function textFromContentPart(part) {
    if (!part) return '';
    if (typeof part === 'string') return part;
    if (Array.isArray(part)) return part.map(textFromContentPart).join('');
    if (typeof part !== 'object') return '';
    return textFromContentPart(part.text)
        || textFromContentPart(part.content)
        || textFromContentPart(part.value)
        || textFromContentPart(part.output_text)
        || '';
}

export function extractStreamText(json, protocol = API_PROTOCOLS.OPENAI) {
    if (!json || typeof json !== 'object') return '';
    const isAnthropic = protocol === API_PROTOCOLS.ANTHROPIC;

    if (isAnthropic) {
        if (json.type === 'content_block_delta') return textFromContentPart(json.delta?.text || json.delta);
        if (json.type === 'message_delta') return textFromContentPart(json.delta?.text || json.delta?.content);
    }

    if (/\.output_text\.delta$/i.test(String(json.type || ''))) {
        return textFromContentPart(json.delta);
    }

    const choices = Array.isArray(json.choices) ? json.choices : [];
    for (const choice of choices) {
        const delta = choice?.delta || {};
        const message = choice?.message || {};
        const text = textFromContentPart(delta.content)
            || textFromContentPart(delta.text)
            || textFromContentPart(message.content)
            || textFromContentPart(choice?.text);
        if (text) return text;
    }

    const candidateText = textFromContentPart(
        (Array.isArray(json.candidates) ? json.candidates : [])
            .map(candidate => candidate?.content?.parts || candidate?.content),
    );
    if (candidateText) return candidateText;

    const outputText = textFromContentPart(
        (Array.isArray(json.output) ? json.output : [])
            .map(item => item?.content || item),
    );
    if (outputText) return outputText;

    return textFromContentPart(json.delta?.content)
        || textFromContentPart(json.delta?.text)
        || textFromContentPart(json.message?.content)
        || textFromContentPart(json.content)
        || textFromContentPart(json.response)
        || textFromContentPart(json.output_text)
        || '';
}

export function extractApiErrorMessage(json) {
    if (!json || typeof json !== 'object') return '';
    const error = json.error;
    if (typeof error === 'string') return error.trim();
    if (error && typeof error === 'object') {
        return String(error.message || error.detail || error.error || error.status || '').trim();
    }
    if (json.type === 'error') {
        return String(json.message || json.detail || json.delta?.message || '').trim();
    }
    return '';
}
