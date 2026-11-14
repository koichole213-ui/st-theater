import { ERROR_HELP } from './error-help.js';
export const REQUEST_DIAGNOSTIC_SIGNAL = Object.freeze({
    CONTENT_FILTER: 'T-API-CONTENT-FILTER',
    EMPTY: 'T-API-EMPTY',
    REASONING_ONLY: 'T-API-REASONING-ONLY',
    TRUNCATED: 'T-API-TRUNCATED',
    RATE_LIMIT: 'T-HTTP-429',
    HTTP_SERVER: 'T-HTTP-5XX',
    HTTP_CLIENT: 'T-HTTP-4XX',
    TIMEOUT: 'T-NET-TIMEOUT',
    NETWORK: 'T-NET-FAILED',
    NO_RESPONSE: 'T-NET-NO-RESPONSE',
    STREAM_INTERRUPTED: 'T-NET-STREAM-INTERRUPTED',
    BODY_INTERRUPTED: 'T-NET-BODY-INTERRUPTED',
    TOKEN_LIMIT: 'T-API-TOKEN-LIMIT',
    INPUT_LIMIT: 'T-API-INPUT-LIMIT',
    CONTEXT_LIMIT: 'T-API-CONTEXT-LIMIT',
    OUTPUT_LIMIT: 'T-API-OUTPUT-LIMIT',
    INVALID_RESPONSE: 'T-API-INVALID-RESPONSE',
    PROVIDER_ERROR: 'T-API-PROVIDER-ERROR',
    RENDER_INVALID: 'T-RENDER-INVALID',
    CONFIG: 'T-API-CONFIG',
    AUTO_NO_INSTRUCTION: 'T-AUTO-NO-INSTRUCTION',
    UNKNOWN: 'T-UNKNOWN',
});

export function safeDiagnosticReason(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text.length > 80) return null;
    return /^[a-z0-9_.:-]+$/.test(text) ? text : null;
}

export function diagnosticSignalInfo(signal) {
    const key = Object.hasOwn(ERROR_HELP, signal) ? signal
        : /^T-HTTP-5\d\d$/.test(signal) ? REQUEST_DIAGNOSTIC_SIGNAL.HTTP_SERVER
        : /^T-HTTP-4\d\d$/.test(signal) ? REQUEST_DIAGNOSTIC_SIGNAL.HTTP_CLIENT
        : REQUEST_DIAGNOSTIC_SIGNAL.UNKNOWN;
    const info = ERROR_HELP[key];
    return { ...info, detail: info.what, action: info.steps[0] };
}

export function diagnosticSignalCatalog() {
    return Object.keys(ERROR_HELP).map(signal => ({ signal, ...diagnosticSignalInfo(signal) }));
}

export function formatConnectionDiagnostics(connection) {
    if (!connection) return '暂无独立 API 连接记录；主 API 使用酒馆请求服务。';
    const phases = { 'awaiting-response': '等待响应头', 'headers-received': '已收到响应头',
        'reading-stream': '读取流式数据', 'reading-body': '读取非流式响应', complete: '读取完成', failed: '失败', aborted: '已停止' };
    const number = value => value != null && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
    const status = number(connection.httpStatus);
    const mime = ['text/event-stream', 'application/json', 'text/html', 'text/plain', 'other', 'unknown'].includes(connection.contentType) ? connection.contentType : 'unknown';
    const bytes = number(connection.receivedBytes);
    const chunks = number(connection.receivedChunks);
    return `尝试 ${number(connection.attempt) ?? 0} · ${connection.transport === 'stream' ? '流式' : '非流式'} · ${phases[connection.state] || '阶段未知'}`
        + ` · 响应头${connection.headersReceived ? `已收到（+${number(connection.headersMs) ?? 0}ms）` : '未取得'}`
        + ` · HTTP ${status >= 100 && status <= 599 ? status : '未知'} · 类型 ${mime}`
        + ` · 已接收${bytes === null ? '字节未统计（非流式）' : ` ${bytes} 字节 / ${chunks ?? 0} 块（不等于正文）`}`
        + ` · 耗时 ${number(connection.elapsedMs) ?? 0}ms`
        + (connection.failedAt ? ` · 停止阶段：${phases[connection.failedAt] || '未知'}` : '');
}

export function createDiagnosticError(signal, {
    code = '',
    rawStopReason = null,
    status = null,
    phase = '',
    transport = '',
    providerMessage = null,
} = {}) {
    const error = new Error(signal);
    error.name = 'TheaterRequestError';
    error.code = code || signal;
    error.diagnosticSignal = signal;
    if (providerMessage) error.providerMessage = providerMessage;
    error.theaterFailure = {
        signal,
        rawStopReason: safeDiagnosticReason(rawStopReason),
        status: Number(status) >= 100 && Number(status) <= 599 ? Number(status) : null,
        phase: String(phase || ''),
        transport: String(transport || ''),
    };
    return error;
}

export function classifyRequestFailure(error, { stage = '正文生成' } = {}) {
    const code = String(error?.code || '');
    const message = String(error?.message || error || '');
    const failure = error?.theaterFailure || {};
    const response = error?.apiResponseSummary;
    const connection = error?.apiConnectionSummary;
    const main = error?.mainApiDiagnostic;
    const httpStatus = [failure.status, response?.httpStatus, connection?.httpStatus]
        .map(Number).find(status => status >= 100 && status <= 599) ?? null;
    let signal = error?.diagnosticSignal || failure.signal || '';

    if (!Object.hasOwn(ERROR_HELP, signal) && !/^T-HTTP-[45]\d\d$/.test(signal)) {
        const statusFromMessage = `${code} ${message}`.match(/\b([45]\d\d)\b/);
        if (httpStatus === 429) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT;
        } else if (httpStatus >= 400 && httpStatus <= 599) {
            signal = `T-HTTP-${httpStatus}`;
        } else if (statusFromMessage?.[1] === '429') {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT;
        } else if (statusFromMessage?.[1]) {
            signal = `T-HTTP-${statusFromMessage[1]}`;
        } else if (code === 'THEATER_CONTENT_FILTER' || /content[_\s-]*filter|\b(?:safety|blocklist|spii|recitation|prohibited_content)\b/i.test(message)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER;
        } else if (code === 'THEATER_RATE_LIMIT' || /\b429\b|rate[\s_-]*limit|quota|请求过于频繁|限流/i.test(message)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.RATE_LIMIT;
        } else if (/TIMEOUT|超时|gateway|\b(?:502|503|504|524|529)\b/i.test(`${code} ${message}`)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT;
        } else if (code === 'THEATER_NETWORK_FAILED' || /failed to fetch|network(?:error| error)|load failed|connection reset|econnreset|socket hang up/i.test(message)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.NETWORK;
        } else if (code === 'THEATER_OUTPUT_LIMIT' || /max[_\s-]?tokens|max(?:imum)?\s+(?:output|context)|输出上限|上下文上限|上下文(?:窗口|长度)?(?:已满|超出)|减少对话历史/i.test(message)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.TOKEN_LIMIT;
        } else if (['THEATER_STREAM_EMPTY', 'THEATER_RESPONSE_EMPTY'].includes(code) || /返回空内容|没有可识别的正文|没有返回内容/i.test(message)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.EMPTY;
        } else if (['THEATER_PLACEHOLDER_INVALID', 'THEATER_RENDER_VALIDATION'].includes(code)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.RENDER_INVALID;
        } else if (/API URL|API Key|模型|source|主 API|配置/i.test(message)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.CONFIG;
        } else if (/HTML 错误页|响应格式|解析|JSON/i.test(message)) {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE;
        } else {
            signal = REQUEST_DIAGNOSTIC_SIGNAL.UNKNOWN;
        }
    }

    const info = diagnosticSignalInfo(signal);
    return {
        signal,
        status: info.status,
        title: info.title,
        detail: info.detail,
        action: info.action,
        stage: String(stage || '正文生成'),
        rawStopReason: safeDiagnosticReason(failure.rawStopReason || error?.rawStopReason),
        httpStatus,
        transport: main || failure.phase === 'main' ? 'main' : response?.transport || connection?.transport || failure.transport,
        mainMode: main?.mode,
        elapsedMs: main?.elapsedMs ?? connection?.elapsedMs,
        heartbeats: response?.heartbeats,
        hasText: response?.hasText,
        ...(error?.providerMessage ? { providerMessage: error.providerMessage } : {}),
    };
}

export function signalForStopReason(stopReason) {
    const value = safeDiagnosticReason(stopReason);
    return ['length', 'max_tokens', 'max_tokens_reached'].includes(value)
        ? REQUEST_DIAGNOSTIC_SIGNAL.TRUNCATED
        : null;
}
