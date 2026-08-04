import {
    API_PROTOCOLS,
    DEFAULT_MAX_OUTPUT_TOKENS,
    buildApiRequest,
    extractApiErrorMessage,
    extractResponseMeta,
    extractStreamText,
    isContentBlockedErrorMessage,
    isContentBlockedStopReason,
    isHtmlErrorResponse,
    isMaxTokenLimitError,
    isRateLimitErrorMessage,
    maxTokenFallbackSequence,
    resolveMainApiModel,
    retryAfterMilliseconds,
} from './api-client.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, createDiagnosticError } from './request-diagnostics.js';

export const RATE_LIMIT_DEFAULT_WAIT_MS = 3000;
export const RATE_LIMIT_MAX_AUTO_WAIT_MS = 15000;

const noop = () => {};

function noTextResponseError(meta = {}, { phase = 'body', transport = '' } = {}) {
    const rawStopReason = meta?.rawStopReason || meta?.blockReason || null;
    if (meta?.blockReason || isContentBlockedStopReason(rawStopReason)) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER, {
            code: 'THEATER_CONTENT_FILTER', rawStopReason, phase, transport,
        });
    }
    if (meta?.stopReason === 'length') {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TOKEN_LIMIT, {
            code: 'THEATER_OUTPUT_LIMIT', rawStopReason, phase, transport,
        });
    }
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.EMPTY, {
        code: 'THEATER_RESPONSE_EMPTY', rawStopReason, phase, transport,
    });
}

function streamEmptyError({ phase = 'body', transport = 'stream' } = {}) {
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.EMPTY, {
        code: 'THEATER_STREAM_EMPTY', phase, transport,
    });
}

function statusError(status, body = '', { phase = 'body', transport = '' } = {}) {
    const numericStatus = Number(status) || null;
    if (numericStatus === 429) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT, {
            code: 'THEATER_RATE_LIMIT', status: numericStatus, phase, transport,
        });
    }
    if (isMaxTokenLimitError(numericStatus, body)) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TOKEN_LIMIT, {
            code: 'THEATER_OUTPUT_LIMIT', status: numericStatus, phase, transport,
        });
    }
    const signal = numericStatus >= 400 && numericStatus <= 599
        ? `T-HTTP-${numericStatus}`
        : REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE;
    return createDiagnosticError(signal, {
        code: 'THEATER_HTTP_STATUS', status: numericStatus, phase, transport,
    });
}

function shouldNotFallbackMainApi(error) {
    return ['THEATER_CONTENT_FILTER', 'THEATER_RATE_LIMIT', 'THEATER_OUTPUT_LIMIT', 'THEATER_CONFIG'].includes(error?.code);
}

function normalizeMainApiFallbackError(error) {
    if (error?.name === 'AbortError' || error?.diagnosticSignal) return error;
    const message = String(error?.message || error || '');
    if (isContentBlockedErrorMessage(message)) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER, {
            code: 'THEATER_CONTENT_FILTER', phase: 'main', transport: 'ChatCompletionService',
        });
    }
    if (isRateLimitErrorMessage(message)) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT, {
            code: 'THEATER_RATE_LIMIT', phase: 'main', transport: 'ChatCompletionService',
        });
    }
    if (/max[_\s-]?tokens|max(?:imum)?\s+(?:output|context)|输出上限|上下文上限|上下文(?:窗口|长度)?(?:已满|超出)|减少对话历史/i.test(message)) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TOKEN_LIMIT, {
            code: 'THEATER_OUTPUT_LIMIT', phase: 'main', transport: 'ChatCompletionService',
        });
    }
    return error;
}

export async function requestMainApi({
    ctx,
    systemPrompt,
    userPrompt,
    onChunk = noop,
    shouldStream = true,
    signal,
    log = noop,
    onFallback = noop,
    onPath = noop,
    tavernHelper = globalThis.window?.TavernHelper,
    getContext = () => globalThis.SillyTavern?.getContext?.(),
    chatCompletionService,
} = {}) {
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
    const oai = ctx?.oai_settings || globalThis.oai_settings;
    const maxTokens = oai?.openai_max_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const model = resolveMainApiModel(ctx, oai) || '未识别';
    const CCS = chatCompletionService || ctx?.ChatCompletionService || getContext?.()?.ChatCompletionService;

    log('info', '请求发出', {
        mode: 'main',
        channel: CCS && typeof CCS.processRequest === 'function' ? 'ChatCompletionService' : 'TavernHelper',
        model,
        max_tokens: maxTokens,
    });

    if (CCS && typeof CCS.processRequest === 'function') {
        const firstPathController = new AbortController();
        let forwardAbort = null;
        if (signal) {
            if (signal.aborted) firstPathController.abort();
            else {
                forwardAbort = () => firstPathController.abort();
                signal.addEventListener('abort', forwardAbort, { once: true });
            }
        }
        let timeoutId;
        let rejectTimeout;
        const armTimeout = (milliseconds, code) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => rejectTimeout?.(createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT, {
                code, phase: 'main', transport: 'ChatCompletionService',
            })), milliseconds);
        };
        const firstAwareChunk = text => {
            if (String(text || '').trim() && shouldStream) {
                armTimeout(45000, 'MAIN_STREAM_IDLE_TIMEOUT');
            }
            onChunk(text);
        };
        try {
            const timeout = new Promise((_, reject) => {
                rejectTimeout = reject;
                armTimeout(shouldStream ? 10000 : 45000, shouldStream ? 'MAIN_FIRST_TOKEN_TIMEOUT' : 'MAIN_RESPONSE_TIMEOUT');
            });
            return await Promise.race([
                callViaChatCompletionService({
                    CCS,
                    messages,
                    maxTokens,
                    signal: firstPathController.signal,
                    onChunk: firstAwareChunk,
                    shouldStream,
                    ctx,
                    getContext,
                }),
                timeout,
            ]);
        } catch (error) {
            clearTimeout(timeoutId);
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const safeError = normalizeMainApiFallbackError(error);
            if (shouldNotFallbackMainApi(safeError)) throw safeError;
            firstPathController.abort();
            onFallback('main:ChatCompletionService');
            log('warn', '主 API 请求路径降级', { from: 'ChatCompletionService', to: 'TavernHelper' });
            console.warn('[Theater] ChatCompletionService failed, fallback to TavernHelper:', safeError?.code || safeError?.name || 'unknown');
            if (tavernHelper && typeof tavernHelper.generateRaw === 'function') {
                onPath('main:TavernHelper');
                return await callViaGenerateRaw({ tavernHelper, messages, signal, onChunk, shouldStream });
            }
            throwFriendlyMainApi(safeError, onChunk);
        } finally {
            clearTimeout(timeoutId);
            if (forwardAbort) signal?.removeEventListener('abort', forwardAbort);
        }
    }

    if (!tavernHelper || typeof tavernHelper.generateRaw !== 'function') {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG, {
            code: 'THEATER_CONFIG', phase: 'main', transport: 'TavernHelper',
        });
    }
    onPath('main:TavernHelper');
    return await callViaGenerateRaw({ tavernHelper, messages, signal, onChunk, shouldStream });
}

export async function callViaChatCompletionService({
    CCS,
    messages,
    maxTokens,
    signal,
    onChunk = noop,
    shouldStream = true,
    ctx,
    getContext = () => globalThis.SillyTavern?.getContext?.(),
} = {}) {
    const currentContext = getContext?.() || ctx;
    const oai = currentContext?.oai_settings || globalThis.oai_settings;
    const source = oai?.chat_completion_source;
    const model = resolveMainApiModel(currentContext, oai);
    if (!source || !model) {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG, {
            code: 'THEATER_CONFIG', phase: 'main', transport: 'ChatCompletionService',
        });
    }

    const result = await CCS.processRequest(
        { messages, model, chat_completion_source: source, max_tokens: maxTokens, stream: shouldStream },
        { signal },
        false,
        signal,
    );

    if (typeof result === 'function') {
        return await consumeStreamThunk(result, onChunk);
    }

    const meta = extractResponseMeta(typeof result === 'object' ? result : {}, API_PROTOCOLS.OPENAI);
    const text = typeof result === 'string'
        ? result
        : (result?.text || result?.content || result?.choices?.[0]?.message?.content || '');
    if (!text) throw noTextResponseError(meta, { phase: 'main', transport: 'ChatCompletionService' });
    onChunk(text);
    return { text, ...meta };
}

export async function consumeStreamThunk(streamThunk, onChunk = noop) {
    let full = '';
    let meta = { stopReason: 'unknown', rawStopReason: null, usage: null };
    for await (const chunk of streamThunk()) {
        const delta = typeof chunk === 'string'
            ? chunk
            : extractStreamText(chunk, API_PROTOCOLS.OPENAI);
        if (typeof chunk === 'object') {
            const nextMeta = extractResponseMeta(chunk, API_PROTOCOLS.OPENAI);
            if (nextMeta.rawStopReason) meta = nextMeta;
            else if (nextMeta.usage) meta.usage = nextMeta.usage;
        }
        if (delta) {
            full += delta;
            onChunk(full);
        }
    }
    if (!full) throw noTextResponseError(meta, { phase: 'main', transport: 'stream' });
    return { text: full, ...meta };
}

export function throwFriendlyMainApi(error, onChunk = noop) {
    if (error?.name === 'AbortError') throw error;
    if (error?.diagnosticSignal) throw error;
    const message = String(error?.message || error || '');
    if (isContentBlockedErrorMessage(message)) {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER, {
            code: 'THEATER_CONTENT_FILTER', phase: 'main', transport: 'TavernHelper',
        });
    }
    if (isRateLimitErrorMessage(message)) {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT, {
            code: 'THEATER_RATE_LIMIT', phase: 'main', transport: 'TavernHelper',
        });
    }
    if (/max[_\s-]?tokens|max(?:imum)?\s+(?:output|context)|输出上限|上下文上限/i.test(message)) {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TOKEN_LIMIT, {
            code: 'THEATER_OUTPUT_LIMIT', phase: 'main', transport: 'TavernHelper',
        });
    }
    if (/api[_\s]?key[_\s]?missing|401|unauthorized/i.test(message)) {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG, {
            code: 'THEATER_CONFIG', phase: 'main', transport: 'TavernHelper',
        });
    }
    if (/502|524|529|gateway|timeout|ECONNRESET|socket hang up/i.test(message)) {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT, {
            code: 'THEATER_MAIN_GATEWAY', phase: 'main', transport: 'TavernHelper',
        });
    }
    throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.UNKNOWN, {
        code: 'THEATER_MAIN_UNKNOWN', phase: 'main', transport: 'TavernHelper',
    });
}

export async function callViaGenerateRaw({
    tavernHelper,
    messages,
    signal,
    onChunk = noop,
    shouldStream = true,
} = {}) {
    const timeoutMs = 5 * 60 * 1000;
    let abortHandler = null;
    let timeoutId = null;
    const abortPromise = signal
        ? new Promise((_, reject) => {
            if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
            else {
                abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
                signal.addEventListener('abort', abortHandler, { once: true });
            }
        })
        : new Promise(() => {});
    const timeoutPromise = new Promise((_, reject) =>
        { timeoutId = setTimeout(() => reject(createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT, {
            code: 'THEATER_MAIN_TIMEOUT', phase: 'main', transport: 'TavernHelper',
        })), timeoutMs); }
    );

    try {
        const result = await Promise.race([
            tavernHelper.generateRaw({
                user_input: '',
                ordered_prompts: messages,
                overrides: {
                    world_info_before: '', world_info_after: '',
                    persona_description: '', char_description: '',
                    char_personality: '', scenario: '',
                    dialogue_examples: '',
                    chat_history: { prompts: [], with_depth_entries: false, author_note: '' },
                },
                injects: [],
                max_chat_history: 0,
                should_stream: shouldStream,
                signal,
            }),
            abortPromise,
            timeoutPromise,
        ]);
        if (!result) throw noTextResponseError({}, { phase: 'main', transport: 'TavernHelper' });
        const text = typeof result === 'string' ? result : (result?.text || result?.content || '');
        const meta = extractResponseMeta(typeof result === 'object' ? result : {}, API_PROTOCOLS.OPENAI);
        if (!text) throw noTextResponseError(meta, { phase: 'main', transport: 'TavernHelper' });
        onChunk(text);
        return { text, ...meta };
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throwFriendlyMainApi(error, onChunk);
    } finally {
        clearTimeout(timeoutId);
        if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    }
}

export function waitForApiRetry(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        let timer = null;
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export async function retryRateLimitedResponse(response, retryRequest, details = {}, {
    signal,
    log = noop,
} = {}) {
    if (response.status !== 429) return { response, retried: false };
    const requestedWait = retryAfterMilliseconds(response.headers.get('retry-after')) ?? RATE_LIMIT_DEFAULT_WAIT_MS;
    if (requestedWait > RATE_LIMIT_MAX_AUTO_WAIT_MS) {
        log('warn', '接口请求较多，建议稍后重试', { ...details, retry_after_ms: requestedWait, auto_retry: false });
        return { response, retried: false };
    }
    log('warn', '接口暂时繁忙，当前轮等待后重试一次', { ...details, retry_after_ms: requestedWait, auto_retry: true });
    await waitForApiRetry(requestedWait, signal);
    return { response: await retryRequest(), retried: true };
}

export async function customApiStatusError(response, label = 'API') {
    const body = await response.text().catch(() => '');
    return statusError(response.status, body, { phase: label, transport: 'non_stream' });
}

export async function requestCustomApi({
    config = {},
    systemPrompt,
    userPrompt,
    onChunk = noop,
    shouldStream = true,
    signal,
    log = noop,
    onFallback = noop,
    fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
    const url = String(config.apiUrl || '').replace(/\/+$/, '');
    const candidates = maxTokenFallbackSequence(config.maxOutputTokens);
    for (let index = 0; index < candidates.length; index++) {
        const maxTokens = candidates[index];
        const request = buildApiRequest({
            url,
            protocol: config.apiProtocol || API_PROTOCOLS.AUTO,
            key: config.apiKey,
            model: config.apiModel,
            systemPrompt,
            userPrompt,
            maxTokens,
            stream: shouldStream,
        });
        if (request.protocol === API_PROTOCOLS.ANTHROPIC && !config.apiKey) {
            throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG, {
                code: 'THEATER_CONFIG', phase: 'body', transport: request.protocol,
            });
        }
        log('info', '请求发出', { mode: 'custom', url: request.endpoint, protocol: request.protocol, max_tokens: maxTokens });
        const performRequest = body => fetchImpl(request.endpoint, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(body),
            signal,
        });
        let response = await performRequest(request.body);
        let rateLimitRetried = false;
        const rateLimitResult = await retryRateLimitedResponse(response, () => performRequest(request.body), {
            protocol: request.protocol,
            max_tokens: maxTokens,
        }, { signal, log });
        response = rateLimitResult.response;
        rateLimitRetried = rateLimitResult.retried;
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            const nextLimit = candidates[index + 1];
            if (nextLimit && isMaxTokenLimitError(response.status, errorBody)) {
                log('warn', '模型拒绝单轮输出上限，自动降低后重试', { status: response.status, from: maxTokens, to: nextLimit });
                onFallback(`custom:max-token ${maxTokens}→${nextLimit}`);
                continue;
            }
            throw statusError(response.status, errorBody, { phase: 'body', transport: request.protocol });
        }
        if (shouldStream) {
            while (true) {
                try {
                    return await readSSEStream(response, onChunk, request.protocol);
                } catch (streamError) {
                    if (streamError?.code === 'THEATER_RATE_LIMIT' && !rateLimitRetried) {
                        rateLimitRetried = true;
                        log('warn', '接口在流内报告限流，当前轮等待后重试一次', {
                            protocol: request.protocol,
                            max_tokens: maxTokens,
                            retry_after_ms: RATE_LIMIT_DEFAULT_WAIT_MS,
                        });
                        await waitForApiRetry(RATE_LIMIT_DEFAULT_WAIT_MS, signal);
                        response = await performRequest(request.body);
                        if (!response.ok) throw await customApiStatusError(response);
                        continue;
                    }
                    if (streamError?.code !== 'THEATER_STREAM_EMPTY') throw streamError;
                    onFallback('custom:stream→non-stream');
                    log('warn', '流式返回为空，当前轮自动改用非流式重试', {
                        protocol: request.protocol,
                        max_tokens: maxTokens,
                        fallback: 'non_stream',
                    });
                    log('info', '请求发出', {
                        mode: 'custom',
                        url: request.endpoint,
                        protocol: request.protocol,
                        max_tokens: maxTokens,
                        transport: 'non_stream_fallback',
                    });
                    const fallbackBody = { ...request.body, stream: false };
                    let fallbackResponse = await performRequest(fallbackBody);
                    if (!rateLimitRetried) {
                        const fallbackRateLimit = await retryRateLimitedResponse(fallbackResponse, () => performRequest(fallbackBody), {
                            protocol: request.protocol,
                            max_tokens: maxTokens,
                            transport: 'non_stream_fallback',
                        }, { signal, log });
                        fallbackResponse = fallbackRateLimit.response;
                        rateLimitRetried = fallbackRateLimit.retried;
                    }
                    if (!fallbackResponse.ok) {
                        throw await customApiStatusError(fallbackResponse, 'API 非流式重试');
                    }
                    return await readNonStreamingResponse(fallbackResponse, onChunk, request.protocol);
                }
            }
        }
        return await readNonStreamingResponse(response, onChunk, request.protocol);
    }
    throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TOKEN_LIMIT, {
        code: 'THEATER_OUTPUT_LIMIT', phase: 'body', transport: 'custom',
    });
}

function htmlResponseError(raw) {
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE, {
        code: 'THEATER_RESPONSE_HTML', phase: 'body', transport: 'response',
    });
}

function streamPayloadError(message) {
    if (isContentBlockedErrorMessage(message)) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER, {
            code: 'THEATER_CONTENT_FILTER', rawStopReason: message, phase: 'body', transport: 'stream',
        });
    }
    if (isRateLimitErrorMessage(message)) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT, {
            code: 'THEATER_RATE_LIMIT', phase: 'body', transport: 'stream',
        });
    }
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE, {
        code: 'THEATER_RESPONSE_PARSE', phase: 'body', transport: 'stream',
    });
}

export async function readNonStreamingResponse(response, onChunk = noop, protocol = API_PROTOCOLS.OPENAI) {
    const raw = await response.text();
    if (isHtmlErrorResponse(response.headers.get('content-type'), raw)) throw htmlResponseError(raw);
    const trimmed = raw.trim();
    if (!trimmed) throw noTextResponseError({}, { phase: 'body', transport: 'non_stream' });

    let text = trimmed;
    let meta = { stopReason: 'unknown', rawStopReason: null, usage: null };
    try {
        const json = JSON.parse(trimmed);
        const apiError = extractApiErrorMessage(json);
        if (apiError) throw streamPayloadError(apiError);
        text = extractStreamText(json, protocol);
        meta = extractResponseMeta(json, protocol);
        if (!text) throw noTextResponseError(meta, { phase: 'body', transport: 'non_stream' });
    } catch (error) {
        if (error instanceof SyntaxError) text = trimmed;
        else throw error;
    }
    onChunk(text);
    return { text, ...meta };
}

export async function readSSEStream(response, onChunk = noop, protocol = API_PROTOCOLS.OPENAI) {
    const contentType = response.headers.get('content-type') || '';
    if (isHtmlErrorResponse(contentType)) throw htmlResponseError(await response.text());
    if (!response.body?.getReader) {
        throw streamEmptyError();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '', buffer = '', rawText = '';
    let meta = { stopReason: 'unknown', rawStopReason: null, usage: null };
    let providerError = '';

    const consumePayload = (payload) => {
        const text = String(payload || '').trim();
        if (!text || text === '[DONE]') return;
        let json;
        try { json = JSON.parse(text); } catch { return; }
        providerError ||= extractApiErrorMessage(json);
        const nextMeta = extractResponseMeta(json, protocol);
        if (nextMeta.rawStopReason) meta = nextMeta;
        else if (nextMeta.usage) meta.usage = nextMeta.usage;
        const delta = extractStreamText(json, protocol);
        if (delta) {
            full += delta;
            onChunk(full);
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawText += chunk;
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
            const text = line.trim();
            if (!text || text.startsWith('event:') || text === 'data: [DONE]') continue;
            if (text.startsWith('data:')) consumePayload(text.slice(5));
            else if (text.startsWith('{') || text.startsWith('[')) consumePayload(text);
        }
    }
    const finalChunk = decoder.decode();
    rawText += finalChunk;
    buffer += finalChunk;
    if (buffer.trim()) {
        const text = buffer.trim();
        if (text.startsWith('data:')) consumePayload(text.slice(5));
        else if (text.startsWith('{') || text.startsWith('[')) consumePayload(text);
    }

    if (!full && rawText.trim()) {
        try {
            const json = JSON.parse(rawText.trim());
            const apiError = extractApiErrorMessage(json);
            if (apiError) throw streamPayloadError(apiError);
            full = extractStreamText(json, protocol);
            if (full) {
                onChunk(full);
                return { text: full, ...extractResponseMeta(json, protocol) };
            }
            const rawMeta = extractResponseMeta(json, protocol);
            if (rawMeta.rawStopReason || rawMeta.blockReason) meta = rawMeta;
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
        const raw = rawText.trim();
        if (isHtmlErrorResponse(contentType, raw)) throw htmlResponseError(raw);
        if (raw.length > 20 && !raw.startsWith('{') && !raw.startsWith('data:')) {
            full = raw;
            onChunk(full);
        }
    }

    if (!full && providerError) throw streamPayloadError(providerError);
    if (!full && (meta.blockReason || isContentBlockedStopReason(meta.rawStopReason))) {
        throw noTextResponseError(meta, { phase: 'body', transport: 'stream' });
    }
    if (!full) throw streamEmptyError();
    return { text: full, ...meta };
}
