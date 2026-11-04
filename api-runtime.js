import { httpErrorReason } from './error-help.js';
import { beginVertexRequest } from './vertex-credentials.js';
import { createIndependentRequest, checkVertexCredential, assertSupportedMessageTail } from './independent-request.js';
import { apiChannel } from './api-channels.js';
import { emitReasoningSafeChunk, reasoningOnlyError, reasoningSafeResult, noTextResponseError, safeUsageSummary, publicResult, statusError, normalizeFetchError, readNonStreamingResponse, readSSEStream } from './api-response.js';
export { CUSTOM_STREAM_IDLE_TIMEOUT_MS, readNonStreamingResponse, readSSEStream } from './api-response.js';
import {
    API_PROTOCOLS,
    buildApiRequest,
    extractApiErrorMessage,
    extractResponseMeta,
    extractStreamText,
    hasReasoningContent,
    isContentBlockedErrorMessage,
    isContentBlockedStopReason,
    isHtmlErrorResponse,
    classifyTokenLimitError,
    isRateLimitErrorMessage,
    maxTokenFallbackSequence,
    resolveMainApiModel,
    retryAfterMilliseconds,
} from './api-client.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, createDiagnosticError } from './request-diagnostics.js';
import { filterTaggedReasoning } from './reasoning-filter.js';
import { applyPromptPostProcessing } from './request-layout.js';

export const RATE_LIMIT_DEFAULT_WAIT_MS = 3000;
export const RATE_LIMIT_MAX_AUTO_WAIT_MS = 15000;
export const MAIN_FIRST_TOKEN_TIMEOUT_MS = 180000;
export const MAIN_STREAM_IDLE_TIMEOUT_MS = 120000;
export const MAIN_RESPONSE_TIMEOUT_MS = 300000;
export const MAIN_HELPER_RESPONSE_TIMEOUT_MS = 15 * 60 * 1000;

const noop = () => {};

async function performCustomFetch(fetchRequest, { phase = 'body', transport = '' } = {}) {
    try {
        return await fetchRequest();
    } catch (error) {
        throw normalizeFetchError(error, { phase, transport });
    }
}

function shouldNotFallbackMainApi(error) {
    if (error?.diagnosticSignal === 'T-API-MESSAGE-END') return true;
    return [
        'THEATER_ASSISTANT_TAIL_UNSUPPORTED',
        'THEATER_CONTENT_FILTER', 'THEATER_RATE_LIMIT', 'THEATER_OUTPUT_LIMIT', 'THEATER_CONFIG',
        'THEATER_REASONING_ONLY', 'THEATER_RESPONSE_EMPTY', 'THEATER_STREAM_EMPTY',
        'MAIN_FIRST_TOKEN_TIMEOUT', 'MAIN_STREAM_IDLE_TIMEOUT', 'MAIN_RESPONSE_TIMEOUT',
    ].includes(error?.code);
}

function normalizeMainApiFallbackError(error) {
    if (error?.name === 'AbortError' || error?.diagnosticSignal) return error;
    const message = String(error?.message || error || '');
    if (httpErrorReason(message) === 'T-API-MESSAGE-END') {
        return createDiagnosticError('T-API-MESSAGE-END', { code: 'THEATER_ASSISTANT_TAIL_UNSUPPORTED', phase: 'main', transport: 'ChatCompletionService' });
    }
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

// Read one configuration per outgoing CCS request, not per whole generation.
// Keep scalar fields together so a later round can adopt newly selected settings.
function captureMainApiRequestSettings(ctx, getContext) {
    const currentContext = getContext?.() || ctx;
    const currentOai = currentContext?.oai_settings;
    const ctxOai = ctx?.oai_settings;
    const globalOai = globalThis.oai_settings;
    const oai = currentOai || ctxOai || globalOai;
    const source = currentOai?.chat_completion_source
        || ctxOai?.chat_completion_source
        || globalOai?.chat_completion_source;
    const model = resolveMainApiModel(currentContext, currentOai)
        || resolveMainApiModel(ctx, ctxOai)
        || resolveMainApiModel({}, globalOai);
    const configuredMaxTokens = Number(oai?.openai_max_tokens);
    // 0 means the host/preset decides; never send max_tokens: 0.
    const maxTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
        ? Math.floor(configuredMaxTokens) : undefined;
    return { context: currentContext, source, model, maxTokens };
}

export async function requestMainApi({
    ctx,
    systemPrompt,
    userPrompt,
    messages,
    postProcessing = '',
    presetName = '',
    onChunk = noop,
    onRequest = noop,
    shouldStream = true,
    signal,
    log = noop,
    onFallback = noop,
    onPath = noop,
    onResponse = noop,
    tavernHelper = globalThis.window?.TavernHelper,
    getContext = () => globalThis.SillyTavern?.getContext?.(),
    chatCompletionService,
} = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const finalMessages = applyPromptPostProcessing(
        Array.isArray(messages) ? messages : [
            { role: 'system', content: systemPrompt, source: 'request', sourceId: 'system' },
            { role: 'user', content: userPrompt, source: 'request', sourceId: 'user' },
        ],
        postProcessing,
    );
    const mainApiSettings = captureMainApiRequestSettings(ctx, getContext);
    assertSupportedMessageTail(mainApiSettings, finalMessages);
    const { maxTokens } = mainApiSettings;
    const model = mainApiSettings.model || '未识别';
    const CCS = chatCompletionService || mainApiSettings.context?.ChatCompletionService || ctx?.ChatCompletionService;

    log('info', '请求发出', {
        mode: 'main',
        channel: CCS && typeof CCS.processRequest === 'function' ? 'ChatCompletionService' : 'TavernHelper',
        model,
        max_tokens: maxTokens ?? 'preset',
    });

    if (CCS && typeof CCS.processRequest === 'function') {
        const firstPathController = new AbortController();
        let firstPathActive = true;
        let rejectAbort;
        const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
        let forwardAbort = null;
        if (signal) {
            if (signal.aborted) firstPathController.abort();
            else {
                forwardAbort = () => {
                    firstPathActive = false;
                    firstPathController.abort();
                    rejectAbort(new DOMException('Aborted', 'AbortError'));
                };
                signal.addEventListener('abort', forwardAbort, { once: true });
            }
        }
        let timeoutId;
        let rejectTimeout;
        const armTimeout = (milliseconds, code) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                firstPathActive = false;
                rejectTimeout?.(createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT, {
                    code, phase: 'main', transport: 'ChatCompletionService',
                }));
                firstPathController.abort();
            }, milliseconds);
        };
        const firstAwareChunk = text => {
            if (!firstPathActive || firstPathController.signal.aborted) return;
            if (String(text || '').trim() && shouldStream) {
                armTimeout(MAIN_STREAM_IDLE_TIMEOUT_MS, 'MAIN_STREAM_IDLE_TIMEOUT');
            }
            emitReasoningSafeChunk(onChunk, text);
        };
        try {
            const timeout = new Promise((_, reject) => {
                rejectTimeout = reject;
                armTimeout(
                    shouldStream ? MAIN_FIRST_TOKEN_TIMEOUT_MS : MAIN_RESPONSE_TIMEOUT_MS,
                    shouldStream ? 'MAIN_FIRST_TOKEN_TIMEOUT' : 'MAIN_RESPONSE_TIMEOUT',
                );
            });
            const result = await Promise.race([
                callViaChatCompletionService({
                    CCS,
                    messages: finalMessages,
                    maxTokens,
                    signal: firstPathController.signal,
                    onChunk: firstAwareChunk,
                    shouldStream,
                    ctx,
                    getContext,
                    mainApiSettings,
                    onRequest,
                    presetName,
                    postProcessing,
                }),
                timeout,
                abortPromise,
            ]);
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const finalized = reasoningSafeResult(result, { phase: 'main', transport: 'ChatCompletionService' });
            onResponse({
                transport: 'ChatCompletionService', protocol: API_PROTOCOLS.OPENAI,
                httpStatus: null, contentType: 'sillytavern', format: 'sillytavern', events: null,
                hasText: true, hasReasoning: !!String(result?.reasoning || result?.state?.reasoning || '').trim(),
                rawStopReason: finalized.rawStopReason || null,
                usage: safeUsageSummary(finalized.usage || {}),
            });
            return finalized;
        } catch (error) {
            firstPathActive = false;
            clearTimeout(timeoutId);
            firstPathController.abort();
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const safeError = normalizeMainApiFallbackError(error);
            if (shouldNotFallbackMainApi(safeError)) throw safeError;
            onFallback('main:ChatCompletionService');
            log('warn', '主 API 请求路径降级', { from: 'ChatCompletionService', to: 'TavernHelper' });
            console.warn('[Theater] ChatCompletionService failed, fallback to TavernHelper:', safeError?.code || safeError?.name || 'unknown');
            if (tavernHelper && typeof tavernHelper.generateRaw === 'function') {
                onPath('main:TavernHelper');
                const result = await callViaGenerateRaw({
                    tavernHelper, messages: finalMessages, signal,
                    onChunk: text => emitReasoningSafeChunk(onChunk, text),
                    shouldStream,
                    onRequest,
                    model: captureMainApiRequestSettings(ctx, getContext).model || model,
                    presetName,
                    postProcessing,
                });
                const finalized = reasoningSafeResult(result, { phase: 'main', transport: 'TavernHelper' });
                onResponse({
                    transport: 'TavernHelper', protocol: API_PROTOCOLS.OPENAI,
                    httpStatus: null, contentType: 'sillytavern', format: 'sillytavern', events: null,
                    hasText: true, hasReasoning: !!String(result?.reasoning || result?.state?.reasoning || '').trim(),
                    rawStopReason: finalized.rawStopReason || null,
                    usage: safeUsageSummary(finalized.usage || {}),
                });
                return finalized;
            }
            throwFriendlyMainApi(safeError, onChunk);
        } finally {
            firstPathActive = false;
            clearTimeout(timeoutId);
            firstPathController.abort();
            if (forwardAbort) signal?.removeEventListener('abort', forwardAbort);
        }
    }

    if (!tavernHelper || typeof tavernHelper.generateRaw !== 'function') {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG, {
            code: 'THEATER_CONFIG', phase: 'main', transport: 'TavernHelper',
        });
    }
    onPath('main:TavernHelper');
    const result = await callViaGenerateRaw({
        tavernHelper, messages: finalMessages, signal,
        onChunk: text => emitReasoningSafeChunk(onChunk, text),
        shouldStream,
        onRequest,
        model,
        presetName,
        postProcessing,
    });
    const finalized = reasoningSafeResult(result, { phase: 'main', transport: 'TavernHelper' });
    onResponse({
        transport: 'TavernHelper', protocol: API_PROTOCOLS.OPENAI,
        httpStatus: null, contentType: 'sillytavern', format: 'sillytavern', events: null,
        hasText: true, hasReasoning: !!String(result?.reasoning || result?.state?.reasoning || '').trim(),
        rawStopReason: finalized.rawStopReason || null,
        usage: safeUsageSummary(finalized.usage || {}),
    });
    return finalized;
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
    mainApiSettings,
    onRequest = noop,
    presetName = '',
    postProcessing = '',
} = {}) {
    const settings = mainApiSettings || captureMainApiRequestSettings(ctx, getContext);
    const { source, model } = settings;
    // Preserve explicit limits for direct callers; normal dispatch uses the full current snapshot.
    if (mainApiSettings || maxTokens === undefined) maxTokens = settings.maxTokens;
    if (!source || !model) {
        throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG, {
            // 这里只能说明当前版本的 ChatCompletionService 字段没有被识别；
            // TavernHelper 仍可能完整继承酒馆当前连接，因此允许安全降级一次。
            code: 'THEATER_MAIN_CONTEXT_UNRECOGNIZED', phase: 'main', transport: 'ChatCompletionService',
        });
    }

    onRequest({
        route: 'main', transport: 'ChatCompletionService', protocol: API_PROTOCOLS.OPENAI,
        model, presetName, postProcessing, maxTokens, messages,
    });
    const result = await CCS.processRequest(
        {
            messages: messages.map(message => ({ role: message.role, content: message.content })),
            model,
            chat_completion_source: source,
            ...(Number(maxTokens) > 0 ? { max_tokens: maxTokens } : {}),
            stream: shouldStream,
            // 消息角色与后处理已由插件按所选预设完成；显式覆盖这些字段，
            // 只让酒馆补齐连接与采样器，不把工具或结构化输出带回创作请求。
            custom_prompt_post_processing: '',
            tools: undefined,
            tool_choice: undefined,
            functions: undefined,
            function_call: undefined,
            json_schema: undefined,
            response_format: undefined,
        },
        { presetName },
        true,
        signal,
    );

    if (typeof result === 'function') {
        return await consumeStreamThunk(result, onChunk);
    }

    const meta = extractResponseMeta(typeof result === 'object' ? result : {}, API_PROTOCOLS.OPENAI);
    const text = typeof result === 'string'
        ? result
        : (result?.text || result?.content || result?.choices?.[0]?.message?.content || '');
    if (!text && String(result?.reasoning || result?.state?.reasoning || '').trim()) {
        throw reasoningOnlyError({ phase: 'main', transport: 'ChatCompletionService' });
    }
    if (!text) throw noTextResponseError(meta, { phase: 'main', transport: 'ChatCompletionService' });
    onChunk(text);
    return { text, ...meta };
}

export async function consumeStreamThunk(streamThunk, onChunk = noop) {
    let full = '';
    let meta = { stopReason: 'unknown', rawStopReason: null, usage: null };
    let hadReasoning = false;
    for await (const chunk of streamThunk()) {
        const cumulativeText = typeof chunk === 'object' && typeof chunk?.text === 'string'
            ? chunk.text
            : null;
        const delta = cumulativeText === null
            ? (typeof chunk === 'string' ? chunk : extractStreamText(chunk, API_PROTOCOLS.OPENAI))
            : '';
        if (typeof chunk === 'object') {
            const nextMeta = extractResponseMeta(chunk, API_PROTOCOLS.OPENAI);
            if (nextMeta.rawStopReason) meta = nextMeta;
            else if (nextMeta.usage) meta.usage = nextMeta.usage;
            hadReasoning ||= hasReasoningContent(chunk) || !!String(chunk?.state?.reasoning || '').trim();
        }
        if (cumulativeText !== null && cumulativeText !== full) {
            full = cumulativeText;
            onChunk(full);
        } else if (delta) {
            full += delta;
            onChunk(full);
        }
    }
    if (!full && hadReasoning) throw reasoningOnlyError({ phase: 'main', transport: 'stream' });
    if (!full) throw noTextResponseError(meta, { phase: 'main', transport: 'stream' });
    return { text: full, ...meta };
}

export function throwFriendlyMainApi(error, onChunk = noop) {
    if (error?.name === 'AbortError') throw error;
    if (error?.diagnosticSignal) throw error;
    const message = String(error?.message || error || '');
    if (httpErrorReason(message) === 'T-API-MESSAGE-END') {
        throw createDiagnosticError('T-API-MESSAGE-END', { code: 'THEATER_ASSISTANT_TAIL_UNSUPPORTED', phase: 'main', transport: 'TavernHelper' });
    }
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
    onRequest = noop,
    model = '',
    presetName = '',
    postProcessing = '',
} = {}) {
    const timeoutMs = MAIN_HELPER_RESPONSE_TIMEOUT_MS;
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
        onRequest({
            route: 'main', transport: 'TavernHelper', protocol: API_PROTOCOLS.OPENAI,
            model, presetName, postProcessing, maxTokens: null, messages,
        });
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
        if (!text && String(result?.reasoning || result?.state?.reasoning || '').trim()) {
            throw reasoningOnlyError({ phase: 'main', transport: 'TavernHelper' });
        }
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
    messages,
    postProcessing = '',
    presetName = '',
    onChunk = noop,
    onRequest = noop,
    shouldStream = true,
    signal,
    log = noop,
    onFallback = noop,
    onResponse = noop,
    onConnection = noop,
    fetchImpl = (...args) => globalThis.fetch(...args),
    getHeaders,
} = {}) {
    const releaseVertex = apiChannel(config) === 'vertex' ? beginVertexRequest() : noop;
    const candidates = maxTokenFallbackSequence(config.maxOutputTokens);
    const safeChunk = text => emitReasoningSafeChunk(onChunk, text);
    let connection = null;
    let connectionStartedAt = 0;
    let connectionAttempt = 0;
    const publishConnection = (changes, announce = true) => {
        if (!connection) return;
        connection = { ...connection, ...changes, elapsedMs: Math.max(0, Date.now() - connectionStartedAt) };
        // Only fixed categories, numeric timing and counters are exposed. Never error text or headers.
        try { onConnection({ ...connection }); } catch {}
        if (announce) { try { log(connection.state === 'failed' ? 'warn' : 'info', '独立 API 连接过程', { ...connection }); } catch {} }
    };
    const receiveBytes = bytes => {
        const first = connection.receivedChunks === 0;
        publishConnection({ receivedBytes: connection.receivedBytes + bytes, receivedChunks: connection.receivedChunks + 1 }, first);
    };
    const reportResponse = (summary = {}) => {
        const safeSummary = { ...summary };
        onResponse(safeSummary);
        log(safeSummary.hasText ? 'info' : 'warn', '接口响应摘要', safeSummary);
    };
    const finalize = (result, transport) => {
        reportResponse(result?.responseSummary || {});
        const finalized = publicResult(reasoningSafeResult(result, { phase: 'body', transport }));
        publishConnection({ state: 'complete' });
        return finalized;
    };
    try {
    for (let index = 0; index < candidates.length && index < 8; index++) {
        const maxTokens = candidates[index];
        const preparedRequest = createIndependentRequest(config, {
            systemPrompt, userPrompt, messages, postProcessing, maxTokens, stream: shouldStream,
        }, { getHeaders });
        const request = preparedRequest?.then ? await preparedRequest : preparedRequest;
        if (request.protocol === API_PROTOCOLS.ANTHROPIC && !config.apiKey) {
            throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG, {
                code: 'THEATER_CONFIG', phase: 'body', transport: request.protocol,
            });
        }
        log('info', '请求发出', {
            mode: 'custom', url: request.endpoint, protocol: request.protocol, max_tokens: maxTokens,
            preset_generation_options: 'not_inherited',
            message_compatibility: request.messageCompatibility,
        });
        onRequest({
            route: 'custom', transport: shouldStream ? 'stream' : 'non-stream', protocol: request.protocol,
            model: config.apiModel, presetName, postProcessing, maxTokens, messages: request.messages,
            presetGenerationOptionsInherited: false,
            messageCompatibility: request.messageCompatibility,
        });
        const performRequest = async body => {
            connectionStartedAt = Date.now();
            connection = { attempt: ++connectionAttempt, transport: body.stream ? 'stream' : 'non-stream',
                state: 'awaiting-response', headersReceived: false, headersMs: null, httpStatus: null,
                contentType: 'unknown', receivedBytes: body.stream ? 0 : null, receivedChunks: body.stream ? 0 : null,
                failedAt: null, failureSignal: null };
            publishConnection({});
            let response;
            try {
                if (apiChannel(config) === 'vertex') await checkVertexCredential(config, { fetchImpl, getHeaders, signal });
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                response = await fetchImpl(request.endpoint, { method: 'POST', headers: request.headers, body: JSON.stringify(body), signal });
            } catch (error) {
                throw normalizeFetchError(error, { phase: 'awaiting-response', transport: request.protocol, networkSignal: REQUEST_DIAGNOSTIC_SIGNAL.NO_RESPONSE });
            }
            const mime = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
            publishConnection({ state: 'headers-received', headersReceived: true, headersMs: Math.max(0, Date.now() - connectionStartedAt),
                httpStatus: Number(response.status) >= 100 && Number(response.status) <= 599 ? Number(response.status) : null,
                contentType: ['text/event-stream', 'application/json', 'text/html', 'text/plain'].includes(mime) ? mime : (mime ? 'other' : 'unknown') });
            return response;
        };
        let response;
        try {
            response = await performCustomFetch(() => performRequest(request.body), {
                phase: 'body', transport: request.protocol,
            });
        } catch (error) {
            throw normalizeFetchError(error, { phase: 'body', transport: request.protocol });
        }
        let rateLimitRetried = false;
        const rateLimitResult = await retryRateLimitedResponse(response, () => performCustomFetch(
            () => performRequest(request.body),
            { phase: 'body', transport: request.protocol },
        ), {
            protocol: request.protocol,
            max_tokens: maxTokens,
        }, { signal, log });
        response = rateLimitResult.response;
        rateLimitRetried = rateLimitResult.retried;
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            const tokenLimit = classifyTokenLimitError(response.status, errorBody);
            if (tokenLimit.kind === 'output' && tokenLimit.outputLimit && tokenLimit.outputLimit < maxTokens) {
                candidates.splice(index + 1, candidates.length, ...maxTokenFallbackSequence(tokenLimit.outputLimit));
            }
            const nextLimit = candidates[index + 1];
            if (nextLimit && index < 7 && tokenLimit.kind === 'output') {
                log('warn', '模型拒绝单轮输出上限，自动降低后重试', { status: response.status, from: maxTokens, to: nextLimit });
                onFallback(`custom:max-token ${maxTokens}→${nextLimit}`);
                continue;
            }
            throw statusError(response.status, errorBody, { phase: 'body', transport: request.protocol });
        }
        if (shouldStream) {
            while (true) {
                try {
                    publishConnection({ state: 'reading-stream' });
                    return finalize(await readSSEStream(response, safeChunk, request.protocol, {
                        onReadProgress: receiveBytes,
                        onNonStreamingRead: () => publishConnection({ state: 'reading-body', receivedBytes: null, receivedChunks: null }),
                    }), request.protocol);
                } catch (streamError) {
                    if (streamError?.apiResponseSummary) reportResponse(streamError.apiResponseSummary);
                    if (streamError?.code === 'THEATER_RATE_LIMIT' && !rateLimitRetried) {
                        rateLimitRetried = true;
                        log('warn', '接口在流内报告限流，当前轮等待后重试一次', {
                            protocol: request.protocol,
                            max_tokens: maxTokens,
                            retry_after_ms: RATE_LIMIT_DEFAULT_WAIT_MS,
                        });
                        await waitForApiRetry(RATE_LIMIT_DEFAULT_WAIT_MS, signal);
                        response = await performCustomFetch(() => performRequest(request.body), {
                            phase: 'body', transport: request.protocol,
                        });
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
                        message_compatibility: request.messageCompatibility,
                    });
                    onRequest({
                        route: 'custom', transport: 'non-stream-fallback', protocol: request.protocol,
                        model: config.apiModel, presetName, postProcessing, maxTokens, messages: request.messages,
                        presetGenerationOptionsInherited: false,
                        messageCompatibility: request.messageCompatibility,
                    });
                    const fallbackBody = { ...request.body, stream: false };
                    let fallbackResponse = await performCustomFetch(() => performRequest(fallbackBody), {
                        phase: 'body', transport: 'non_stream_fallback',
                    });
                    if (!rateLimitRetried) {
                        const fallbackRateLimit = await retryRateLimitedResponse(fallbackResponse, () => performCustomFetch(
                            () => performRequest(fallbackBody),
                            { phase: 'body', transport: 'non_stream_fallback' },
                        ), {
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
                    publishConnection({ state: 'reading-body' });
                    return finalize(await readNonStreamingResponse(fallbackResponse, safeChunk, request.protocol), request.protocol);
                }
            }
        }
        publishConnection({ state: 'reading-body' });
        return finalize(await readNonStreamingResponse(response, safeChunk, request.protocol), request.protocol);
    }
    throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TOKEN_LIMIT, {
        code: 'THEATER_OUTPUT_LIMIT', phase: 'body', transport: 'custom',
    });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        const knownSignal = Object.values(REQUEST_DIAGNOSTIC_SIGNAL).includes(error?.diagnosticSignal)
            || /^T-HTTP-[45]\d\d$/.test(error?.diagnosticSignal || '');
        publishConnection({ state: aborted ? 'aborted' : 'failed', failedAt: connection?.state || null,
            failureSignal: aborted ? null : (knownSignal ? error.diagnosticSignal : REQUEST_DIAGNOSTIC_SIGNAL.UNKNOWN) });
        throw error;
    } finally { releaseVertex(); }
}
