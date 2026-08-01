import {
    API_PROTOCOLS,
    DEFAULT_MAX_OUTPUT_TOKENS,
    buildApiRequest,
    extractApiErrorMessage,
    extractResponseMeta,
    extractStreamText,
    isHtmlErrorResponse,
    isMaxTokenLimitError,
    isRateLimitErrorMessage,
    maxTokenFallbackSequence,
    resolveMainApiModel,
    retryAfterMilliseconds,
} from './api-client.js';

export const RATE_LIMIT_DEFAULT_WAIT_MS = 3000;
export const RATE_LIMIT_MAX_AUTO_WAIT_MS = 15000;

const noop = () => {};

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
            timeoutId = setTimeout(() => rejectTimeout?.(new Error(code)), milliseconds);
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
            firstPathController.abort();
            onFallback('main:ChatCompletionService');
            log('warn', '主 API 请求路径降级', { from: 'ChatCompletionService', to: 'TavernHelper' });
            console.warn('[Theater] ChatCompletionService failed, fallback to TavernHelper:', error);
            if (tavernHelper && typeof tavernHelper.generateRaw === 'function') {
                onPath('main:TavernHelper');
                return await callViaGenerateRaw({ tavernHelper, messages, signal, onChunk, shouldStream });
            }
            throwFriendlyMainApi(error, onChunk);
        } finally {
            clearTimeout(timeoutId);
            if (forwardAbort) signal?.removeEventListener('abort', forwardAbort);
        }
    }

    if (!tavernHelper || typeof tavernHelper.generateRaw !== 'function') {
        const tip = '当前酒馆没有可用的主 API 扩展接口。\n\n请改用【独立 API】模式，填写 API URL 和模型。';
        onChunk(tip);
        throw new Error(tip);
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
        const tip = '酒馆主 API 还没选好 source 或模型。\n\n请先在酒馆 API 设置里选好模型并确认正文能正常生成。';
        onChunk(tip);
        throw new Error(tip);
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

    const text = typeof result === 'string'
        ? result
        : (result?.text || result?.content || result?.choices?.[0]?.message?.content || '');
    if (!text) throw new Error('酒馆主 API 返回空内容');
    onChunk(text);
    return { text, ...extractResponseMeta(typeof result === 'object' ? result : {}, API_PROTOCOLS.OPENAI) };
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
    if (!full) throw new Error('酒馆主 API 流式返回空');
    return { text: full, ...meta };
}

export function throwFriendlyMainApi(error, onChunk = noop) {
    if (error?.name === 'AbortError') throw error;
    const message = String(error?.message || error || '');
    if (/api[_\s]?key[_\s]?missing|401|unauthorized/i.test(message)) {
        const tip = '酒馆主 API 的 Key 没有保存好。\n\n请回酒馆 API 设置里填写并保存 Key，再回来生成。';
        onChunk(tip);
        throw new Error(tip);
    }
    if (/502|524|529|gateway|timeout|ECONNRESET|socket hang up/i.test(message)) {
        const tip = `酒馆主 API 网关错误：${message.substring(0, 200)}\n\n建议改用【独立 API】模式直接填写 endpoint。`;
        onChunk(tip);
        throw new Error(tip);
    }
    throw error;
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
        { timeoutId = setTimeout(() => reject(new Error('主 API 5 分钟未返回，已放弃等待。')), timeoutMs); }
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
        if (!result) throw new Error('主 API 返回空内容');
        const text = typeof result === 'string' ? result : (result?.text || result?.content || '');
        if (!text) throw new Error('主 API 返回空内容');
        onChunk(text);
        return { text, ...extractResponseMeta(typeof result === 'object' ? result : {}, API_PROTOCOLS.OPENAI) };
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
    if (response.status === 429) {
        return new Error(`${label} 429：接口请求过于频繁，请稍后再试${body ? `（${body.substring(0, 160)}）` : ''}`);
    }
    return new Error(`${label} ${response.status}: ${body.substring(0, 200)}`);
}

export async function requestCustomApi({
    config = {},
    systemPrompt,
    userPrompt,
    onChunk = noop,
    shouldStream = true,
    signal,
    log = noop,
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
        if (request.protocol === API_PROTOCOLS.ANTHROPIC && !config.apiKey) throw new Error('Anthropic 接口需要 API Key');
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
                continue;
            }
            if (response.status === 429) {
                throw new Error(`API 429：接口请求过于频繁，请稍后再试${errorBody ? `（${errorBody.substring(0, 160)}）` : ''}`);
            }
            throw new Error(`API ${response.status}: ${errorBody.substring(0, 200)}`);
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
    throw new Error('模型不支持可用的单轮输出上限');
}

function htmlResponseError(raw) {
    const excerpt = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return new Error(`API 返回了 HTML 错误页${excerpt ? `：${excerpt}` : ''}`);
}

function streamPayloadError(message) {
    const error = new Error(`API 返回错误：${message}`);
    if (isRateLimitErrorMessage(message)) error.code = 'THEATER_RATE_LIMIT';
    return error;
}

export async function readNonStreamingResponse(response, onChunk = noop, protocol = API_PROTOCOLS.OPENAI) {
    const raw = await response.text();
    if (isHtmlErrorResponse(response.headers.get('content-type'), raw)) throw htmlResponseError(raw);
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('API 非流式返回空内容');

    let text = trimmed;
    let meta = { stopReason: 'unknown', rawStopReason: null, usage: null };
    try {
        const json = JSON.parse(trimmed);
        const apiError = extractApiErrorMessage(json);
        if (apiError) throw new Error(`API 返回错误：${apiError}`);
        text = extractStreamText(json, protocol);
        meta = extractResponseMeta(json, protocol);
        if (!text) {
            const stopDetail = meta.rawStopReason ? `（结束原因：${meta.rawStopReason}）` : '';
            throw new Error(`API 返回了 JSON，但其中没有可识别的正文${stopDetail}`);
        }
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
        const error = new Error('API 流式响应没有可读取的数据');
        error.code = 'THEATER_STREAM_EMPTY';
        throw error;
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
    if (!full) {
        const error = new Error('API 流式返回为空');
        error.code = 'THEATER_STREAM_EMPTY';
        throw error;
    }
    return { text: full, ...meta };
}
