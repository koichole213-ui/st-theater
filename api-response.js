import { httpErrorReason } from './error-help.js';
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

export const CUSTOM_STREAM_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const noop = () => {};

export function emitReasoningSafeChunk(onChunk, value) {
    onChunk(filterTaggedReasoning(value).content);
}

export function reasoningOnlyError({ phase = 'body', transport = '' } = {}) {
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.REASONING_ONLY, {
        code: 'THEATER_REASONING_ONLY', phase, transport,
    });
}

export function reasoningSafeResult(result, { phase = 'body', transport = '' } = {}) {
    const rawText = typeof result === 'string'
        ? result
        : (result?.text || result?.content || '');
    const parsed = filterTaggedReasoning(rawText);
    if (!String(parsed.content || '').trim()) {
        if (parsed.hadReasoning) throw reasoningOnlyError({ phase, transport });
        throw noTextResponseError(result || {}, { phase, transport });
    }
    return typeof result === 'string'
        ? { text: parsed.content }
        : { ...result, text: parsed.content };
}

export function noTextResponseError(meta = {}, { phase = 'body', transport = '' } = {}) {
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

export function streamEmptyError({ phase = 'body', transport = 'stream' } = {}) {
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.EMPTY, {
        code: 'THEATER_STREAM_EMPTY', phase, transport,
    });
}

export function safeUsageSummary(usage = {}) {
    const number = (...values) => {
        const value = values.find(item => Number.isFinite(Number(item)));
        return value === undefined ? null : Number(value);
    };
    return {
        inputTokens: number(usage.prompt_tokens, usage.input_tokens, usage.promptTokenCount),
        outputTokens: number(usage.completion_tokens, usage.output_tokens, usage.candidatesTokenCount),
        reasoningTokens: number(
            usage?.completion_tokens_details?.reasoning_tokens,
            usage?.output_tokens_details?.reasoning_tokens,
            usage.thoughtsTokenCount,
        ),
        totalTokens: number(usage.total_tokens, usage.totalTokenCount),
    };
}

export function responseFormat(json = {}) {
    if (Array.isArray(json.choices)) return 'choices';
    if (Array.isArray(json.candidates)) return 'candidates';
    if (Array.isArray(json.output) || /response\./i.test(String(json.type || ''))) return 'responses';
    if (/content_block|message_/i.test(String(json.type || '')) || json.stop_reason) return 'anthropic';
    return 'json';
}

export function createResponseSummary({ response, transport, protocol, events = 0, json = null, meta = null, hasText = false, hasReasoning = false } = {}) {
    const usage = safeUsageSummary(meta?.usage || json?.usage || json?.usageMetadata || {});
    return {
        transport: String(transport || 'unknown'),
        protocol: String(protocol || 'unknown'),
        httpStatus: Number(response?.status) || null,
        contentType: String(response?.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase() || 'unknown',
        format: json ? responseFormat(json) : 'unknown',
        events: Math.max(0, Number(events) || 0),
        hasText: !!hasText,
        hasReasoning: !!hasReasoning,
        rawStopReason: meta?.rawStopReason || null,
        usage,
    };
}

export function publicResult(result = {}) {
    if (!result || typeof result !== 'object' || !('responseSummary' in result)) return result;
    const { responseSummary: _responseSummary, ...publicFields } = result;
    return publicFields;
}

export function attachResponseSummary(error, summary) {
    if (error && typeof error === 'object') error.apiResponseSummary = summary;
    return error;
}

export function statusError(status, body = '', { phase = 'body', transport = '' } = {}) {
    const numericStatus = Number(status) || null;
    if (numericStatus === 429) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT, {
            code: 'THEATER_RATE_LIMIT', status: numericStatus, phase, transport,
        });
    }
    const tokenLimit = classifyTokenLimitError(numericStatus, body);
    if (tokenLimit.kind === 'input' || tokenLimit.kind === 'context') {
        return createDiagnosticError(tokenLimit.kind === 'input'
            ? REQUEST_DIAGNOSTIC_SIGNAL.INPUT_LIMIT : REQUEST_DIAGNOSTIC_SIGNAL.CONTEXT_LIMIT, {
            code: tokenLimit.kind === 'input' ? 'THEATER_INPUT_LIMIT' : 'THEATER_CONTEXT_LIMIT',
            status: numericStatus, phase, transport,
        });
    }
    if (tokenLimit.kind === 'output') {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.OUTPUT_LIMIT, {
            code: 'THEATER_OUTPUT_LIMIT', status: numericStatus, phase, transport,
        });
    }
    const explicitReason = httpErrorReason(body);
    if (explicitReason) return createDiagnosticError(explicitReason, { code: 'THEATER_HTTP_STATUS', status: numericStatus, phase, transport });
    // A field named safety or an HTML gateway page is not a content-policy signal.
    if (!/<(?:html|!doctype)/i.test(String(body)) && /(?:"(?:code|status|type)"\s*:\s*"(?:SAFETY|CONTENT_FILTER|PROHIBITED_CONTENT)"|blocked.{0,40}(?:safety|content policy)|(?:content policy|safety).{0,30}(?:blocked|violation)|内容.{0,10}(?:策略拦截|审核未通过))/i.test(String(body))) {
        return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER, {
            code: 'THEATER_CONTENT_FILTER', status: numericStatus, phase, transport,
        });
    }
    const signal = numericStatus >= 400 && numericStatus <= 599
        ? `T-HTTP-${numericStatus}`
        : REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE;
    return createDiagnosticError(signal, {
        code: 'THEATER_HTTP_STATUS', status: numericStatus, phase, transport,
    });
}

export function normalizeFetchError(error, { phase = 'body', transport = '', networkSignal = REQUEST_DIAGNOSTIC_SIGNAL.NETWORK } = {}) {
    if (error?.name === 'AbortError' || error?.diagnosticSignal) return error;
    if (error instanceof TypeError
        || /failed to fetch|network(?:error| error)|load failed|connection reset|econnreset|socket hang up/i.test(String(error?.message || error || ''))) {
        return createDiagnosticError(networkSignal, {
            code: 'THEATER_NETWORK_FAILED', phase, transport,
        });
    }
    return error;
}

function htmlResponseError(raw) {
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE, {
        code: 'THEATER_RESPONSE_HTML', phase: 'body', transport: 'response',
    });
}

function streamPayloadError(message) {
    if (httpErrorReason(message) === 'T-API-MESSAGE-END') {
        return createDiagnosticError('T-API-MESSAGE-END', { code: 'THEATER_ASSISTANT_TAIL_UNSUPPORTED', phase: 'body', transport: 'stream' });
    }
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

async function readResponseText(response, protocol) {
    try { return await response.text(); }
    catch (error) { throw normalizeFetchError(error, { phase: 'reading-body', transport: protocol, networkSignal: REQUEST_DIAGNOSTIC_SIGNAL.BODY_INTERRUPTED }); }
}

export async function readNonStreamingResponse(response, onChunk = noop, protocol = API_PROTOCOLS.OPENAI) {
    const raw = await readResponseText(response, protocol);
    if (isHtmlErrorResponse(response.headers.get('content-type'), raw)) throw htmlResponseError(raw);
    const trimmed = raw.trim();
    if (!trimmed) throw noTextResponseError({}, { phase: 'body', transport: 'non_stream' });

    let text = trimmed;
    let meta = { stopReason: 'unknown', rawStopReason: null, usage: null };
    let responseSummary = createResponseSummary({ response, transport: 'non_stream', protocol });
    try {
        const json = JSON.parse(trimmed);
        const apiError = extractApiErrorMessage(json);
        if (apiError) throw streamPayloadError(apiError);
        text = extractStreamText(json, protocol);
        meta = extractResponseMeta(json, protocol);
        responseSummary = createResponseSummary({
            response, transport: 'non_stream', protocol, events: 1, json, meta,
            hasText: !!text, hasReasoning: hasReasoningContent(json),
        });
        if (!text && responseSummary.hasReasoning) {
            throw attachResponseSummary(reasoningOnlyError({ phase: 'body', transport: 'non_stream' }), responseSummary);
        }
        if (!text) throw attachResponseSummary(noTextResponseError(meta, { phase: 'body', transport: 'non_stream' }), responseSummary);
    } catch (error) {
        if (error instanceof SyntaxError) text = trimmed;
        else throw error;
    }
    onChunk(text);
    responseSummary.hasText = !!text;
    return { text, ...meta, responseSummary };
}

function streamIdleTimeoutError() {
    return createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT, {
        code: 'THEATER_STREAM_IDLE_TIMEOUT', phase: 'body', transport: 'stream',
    });
}

async function readStreamChunk(reader, idleTimeoutMs) {
    const timeout = Math.max(0, Number(idleTimeoutMs) || 0);
    let timeoutId = null;
    try {
        if (!timeout) return await reader.read();
        return await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(streamIdleTimeoutError()), timeout);
            }),
        ]);
    } catch (error) {
        if (error?.code === 'THEATER_STREAM_IDLE_TIMEOUT') {
            await reader.cancel('stream idle timeout').catch(() => {});
        }
        throw normalizeFetchError(error, { phase: 'reading-stream', transport: 'stream', networkSignal: REQUEST_DIAGNOSTIC_SIGNAL.STREAM_INTERRUPTED });
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function readSSEStream(
    response,
    onChunk = noop,
    protocol = API_PROTOCOLS.OPENAI,
    { idleTimeoutMs = CUSTOM_STREAM_IDLE_TIMEOUT_MS, onReadProgress = noop, onNonStreamingRead = noop } = {},
) {
    const contentType = response.headers.get('content-type') || '';
    if (isHtmlErrorResponse(contentType)) {
        onNonStreamingRead();
        throw htmlResponseError(await readResponseText(response, protocol));
    }
    if (!response.body?.getReader) throw streamEmptyError();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '', buffer = '', rawText = '';
    let eventData = [];
    let meta = { stopReason: 'unknown', rawStopReason: null, usage: null };
    let providerError = '';
    let hadReasoning = false;
    let eventCount = 0;
    let lastJson = null;
    let streamFinished = false;
    let protocolDetected = false;
    let parseFailures = 0, unsupportedEvents = 0;
    let receivedChunks = 0, receivedBytes = 0;
    let readComplete = false;
    let plainTextPreamble = false;

    // Only shape/counters are diagnosed; never retain payloads in summaries.
    const isApiObject = json => {
        if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
        const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
        const textValue = value => value == null || typeof value === 'string'
            || (Array.isArray(value) && value.every(textValue))
            || (object(value) && ['text', 'content', 'value', 'output_text'].some(key => Object.hasOwn(value, key))
                && ['text', 'content', 'value', 'output_text'].every(key => !Object.hasOwn(value, key) || textValue(value[key])));
        const textFields = value => ['text', 'content', 'output_text']
            .every(key => !Object.hasOwn(value, key) || textValue(value[key]));
        if (!textFields(json)) return false;
        if (typeof json.type === 'string' && ![
            'error', 'ping', 'message_start', 'message_delta', 'message_stop',
            'content_block_start', 'content_block_delta', 'content_block_stop',
            'response.created', 'response.in_progress', 'response.completed', 'response.failed', 'response.incomplete',
            'response.output_item.added', 'response.output_item.done', 'response.content_part.added', 'response.content_part.done',
            'response.output_text.delta', 'response.output_text.done', 'response.refusal.delta', 'response.refusal.done',
        ].includes(json.type)) return false;
        if (Object.hasOwn(json, 'choices')) {
            return Array.isArray(json.choices) && json.choices.every(choice => object(choice) && textFields(choice)
                && ['delta', 'message'].every(key => choice[key] == null || (object(choice[key]) && textFields(choice[key]))));
        }
        if (Object.hasOwn(json, 'candidates')) {
            return Array.isArray(json.candidates) && json.candidates.every(candidate => object(candidate)
                && (candidate.content == null || (object(candidate.content)
                    && (candidate.content.parts == null || (Array.isArray(candidate.content.parts)
                        && candidate.content.parts.every(part => object(part) && textFields(part)))))));
        }
        if (Object.hasOwn(json, 'output')) return Array.isArray(json.output);
        if (json.type) return true;
        return ['content', 'delta', 'message', 'response', 'output_text', 'error',
            'usage', 'usageMetadata', 'promptFeedback', 'prompt_feedback', 'stop_reason']
            .some(key => Object.hasOwn(json, key) && (json[key] == null
                || typeof json[key] === 'string' || typeof json[key] === 'object'));
    };
    const summary = () => {
        const bodySeen = !!String(filterTaggedReasoning(full).content || '').trim();
        const unknownReason = parseFailures ? 'parse_failed'
            : unsupportedEvents ? 'unsupported_format'
            : !readComplete && !streamFinished ? 'read_incomplete'
            : !protocolDetected && !full ? 'unobserved_format' : null;
        return {
            ...createResponseSummary({ response, transport: 'stream', protocol, events: eventCount,
                json: lastJson, meta, hasText: bodySeen, hasReasoning: hadReasoning }),
            receivedChunks, receivedBytes, protocolDetected, doneSeen: streamFinished,
            parseFailures, unsupportedEvents, readComplete,
            contentSeen: bodySeen ? true : unknownReason ? 'unknown' : false,
            contentObservationReason: bodySeen ? 'body_seen' : unknownReason || 'recognized_empty',
        };
    };
    const consumePayload = (payload, framed = false) => {
        const text = String(payload || '').trim();
        if (!text) return;
        if (text === '[DONE]') {
            protocolDetected = true;
            streamFinished = true;
            return;
        }
        let json;
        try { json = JSON.parse(text); } catch {
            // Bare JSON may span lines: defer its classification until the full body is available.
            if (framed) { protocolDetected = true; parseFailures += 1; }
            return;
        }
        eventCount += 1;
        lastJson = json;
        const recognized = isApiObject(json);
        protocolDetected ||= framed || recognized;
        if (!recognized) unsupportedEvents += 1;
        providerError ||= extractApiErrorMessage(json);
        hadReasoning ||= hasReasoningContent(json);
        const nextMeta = extractResponseMeta(json, protocol);
        if (nextMeta.rawStopReason) meta = nextMeta;
        else if (nextMeta.usage) meta.usage = nextMeta.usage;
        const delta = extractStreamText(json, protocol);
        if (delta) { full += delta; onChunk(full); }
    };
    const dispatchEvent = () => {
        if (!eventData.length) return;
        protocolDetected = true;
        consumePayload(eventData.join('\n'), true);
        eventData = [];
    };
    const consumeLine = line => {
        if (line === '') { dispatchEvent(); return; }
        // Once ordinary prose starts, protocol-looking lines belong to that plain reply.
        if (plainTextPreamble) return;
        // These are SSE fields at the start of a line, not keywords inside a story.
        if (line.startsWith(':') || /^(?:event|id|retry):/.test(line)) {
            protocolDetected = true;
            return;
        }
        if (line.startsWith('data:')) {
            protocolDetected = true;
            const data = line.slice(5).replace(/^ /, '');
            if (data.trim() === '[DONE]') { dispatchEvent(); consumePayload(data, true); return; }
            eventData.push(data);
            return;
        }
        const text = line.trim();
        if (text === '[DONE]' || text.startsWith('{') || text.startsWith('[')) consumePayload(text);
        else if (text && !protocolDetected) plainTextPreamble = true;
    };

    try {
        while (true) {
            const { done, value } = await readStreamChunk(reader, idleTimeoutMs);
            if (done) { readComplete = true; break; }
            receivedChunks += 1;
            receivedBytes += value?.byteLength || 0;
            onReadProgress(value?.byteLength || 0);
            const chunk = decoder.decode(value, { stream: true });
            rawText += chunk;
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) consumeLine(line.replace(/\r$/, ''));
            if (streamFinished) {
                await reader.cancel('stream completed').catch(() => {});
                break;
            }
        }
        const finalChunk = decoder.decode();
        rawText += finalChunk;
        buffer += finalChunk;
        if (buffer) consumeLine(buffer.replace(/\r$/, ''));
        dispatchEvent();

        if (!full && rawText.trim()) {
            const raw = rawText.trim();
            if (isHtmlErrorResponse(contentType, raw)) throw htmlResponseError(raw);
            // A complete JSON body remains supported even when stream=true was requested.
            if (!protocolDetected && /^[{[]/.test(raw)) {
                try {
                    const json = JSON.parse(raw);
                    lastJson = json;
                    eventCount = Math.max(1, eventCount);
                    protocolDetected = isApiObject(json);
                    unsupportedEvents = protocolDetected ? 0 : Math.max(1, unsupportedEvents);
                    providerError ||= extractApiErrorMessage(json);
                    hadReasoning ||= hasReasoningContent(json);
                    meta = extractResponseMeta(json, protocol);
                    full = extractStreamText(json, protocol);
                    if (full) onChunk(full);
                } catch (error) {
                    if (!(error instanceof SyntaxError)) throw error;
                    // A bracketed story heading is not JSON protocol evidence.
                    if (/application\/json/i.test(contentType)
                        || /^[{[]\s*(?:[{[]|"(?:choices|candidates|output|content|delta|message|response|output_text|error|usage|usageMetadata|promptFeedback|type)"\s*:)/.test(raw)) {
                        protocolDetected = true;
                        parseFailures += 1;
                    }
                }
            }
            if (!full && !protocolDetected && !unsupportedEvents && !parseFailures) {
                full = raw;
                onChunk(full);
            }
        }
        const responseSummary = summary();
        if (!full && providerError) throw streamPayloadError(providerError);
        if (!full && (parseFailures || unsupportedEvents)) {
            throw createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE, {
                code: 'THEATER_RESPONSE_PARSE', phase: 'body', transport: 'stream',
            });
        }
        if (!full && hadReasoning) throw reasoningOnlyError({ phase: 'body', transport: 'stream' });
        if (!full && (protocolDetected || eventCount > 0)) {
            // Protocol-only responses must not trigger the empty-transport compatibility retry.
            throw noTextResponseError(meta, { phase: 'body', transport: 'stream' });
        }
        if (!full) throw streamEmptyError();
        return { text: full, ...meta, responseSummary };
    } catch (error) {
        throw attachResponseSummary(error, summary());
    }
}
