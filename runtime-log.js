const MAX_RUNTIME_LOGS = 500;
const LEVELS = new Set(['info', 'warn', 'error']);
const entries = [];
let secretProvider = () => [];

function sensitiveFieldName(key) {
    return /^(?:authorization|key|private[-_]?key|client[-_]?secret|x[-_]?api[-_]?key|api[-_]?key|apikey|secret|password|credential|access[-_]?token|refresh[-_]?token)$/i.test(String(key || ''));
}

function safeStringify(value) {
    const seen = new WeakSet();
    try {
        return JSON.stringify(value, (key, current) => {
            if (sensitiveFieldName(key)) return '[REDACTED]';
            if (current && typeof current === 'object') {
                if (seen.has(current)) return '[Circular]';
                seen.add(current);
            }
            return current;
        });
    } catch {
        return String(value ?? '');
    }
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactKnownSecrets(text) {
    let result = text;
    let secrets = [];
    try {
        const provided = secretProvider?.();
        secrets = Array.isArray(provided) ? provided : [provided];
    } catch { }
    for (const secret of secrets) {
        const value = String(secret || '');
        if (value.length < 4) continue;
        result = result.replace(new RegExp(escapeRegExp(value), 'g'), '[REDACTED]');
    }
    return result;
}

export function sanitizeLogText(value) {
    let text = typeof value === 'string' ? value : safeStringify(value);
    text = text.replace(/\b(?:https?|wss?):\/\/[^\s<>"'`]+/gi, rawUrl => {
        try { return new URL(rawUrl).origin; } catch { return '[URL]'; }
    });
    // 原话被转成 JSON 字符串后，引号前会多出反斜杠（\"Authorization\":\"…\"），规则里都允许。
    // 值里可能有反斜杠转义（\\、\"），整段算作值，一起抹掉。
    text = text.replace(/((?:proxy-)?authorization\\*["']?\s*[:=]\s*\\*["']?)(?:(?:bearer|basic|token|digest)\s+)?((?:\\[^"\s]|[^"',;\s}\\])+)/gi, '$1[REDACTED]');
    // Cookie 的值里可能有引号、分号、空格：一直抹到这一行结束（宁可多抹）。
    text = text.replace(/((?:set-)?cookie\\*["']?\s*[:=]\s*)(?!\\*"?\[REDACTED\])(?:\\(?![nr])|[^\\\r\n])+/gi, '$1[REDACTED]');
    // Digest 等认证里的引号字段。
    text = text.replace(/(\b(?:response|nonce|cnonce|opaque|signature|sig)\s*=\s*)(?:\\*"[^"\\]*\\*"|[^\s,;"\\]+)/gi, '$1[REDACTED]');
    text = text.replace(/((?:key|private[-_]?key|client[-_]?secret|x[-_]?api[-_]?key|api[-_]?key|apikey|secret|password|credential|access[-_]?token|refresh[-_]?token|session[-_]?id|token)\\*["']?\s*[:=]\s*\\*["']?)((?:\\[^"\s]|[^"',;\s}\\])+)/gi, '$1[REDACTED]');
    text = text.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
    return redactKnownSecrets(text);
}

// Prompt inspection retains URLs and literal formatting; redact known credentials only.
export function redactRuntimeSecrets(value) { return redactKnownSecrets(String(value ?? '')); }

export function setRuntimeLogSecretProvider(provider) {
    secretProvider = typeof provider === 'function' ? provider : () => [];
}

// 按字段名先把整个值抹掉，再转成文字（转成文字、截断之后，引号和换行会让文字规则漏掉一部分）。
const SECRET_FIELD = /^(?:(?:proxy-)?authorization|(?:set-)?cookie|token|access[-_]?token|refresh[-_]?token|secret|client[-_]?secret|password|credential|api[-_]?key|apikey|x[-_]?api[-_]?key|private[-_]?key|key|session[-_]?id)$/i;
function redactSecretFields(value, depth = 0) {
    // 整段 JSON 原话（例如后台返回的报错）：先解析，按字段抹掉完整的值，再转回文字。
    if (typeof value === 'string' && depth <= 6 && /^\s*[[{]/.test(value)) {
        try { return JSON.stringify(redactSecretFields(JSON.parse(value), depth + 1)); } catch { return value; }
    }
    if (depth > 6 || !value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => redactSecretFields(item, depth + 1));
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = SECRET_FIELD.test(key) ? '[REDACTED]' : redactSecretFields(item, depth + 1);
    return result;
}

const MAX_LOG_MESSAGE_CHARS = 4000;

export function writeRuntimeLog(level, message, details) {
    const normalizedLevel = LEVELS.has(level) ? level : 'info';
    const detailText = details === undefined ? '' : ` ${safeStringify(redactSecretFields(details))}`;
    const entry = {
        time: new Date().toLocaleString('zh-CN', { hour12: false }),
        level: normalizedLevel,
        // 先脱敏、再截短：截短在前会把值切成半截，脱敏规则就认不全了。
        message: sanitizeLogText(`${String(message || '')}${detailText}`.trim()).slice(0, MAX_LOG_MESSAGE_CHARS),
    };
    entries.push(entry);
    if (entries.length > MAX_RUNTIME_LOGS) entries.splice(0, entries.length - MAX_RUNTIME_LOGS);
    return { ...entry };
}

export function getRuntimeLogEntries() {
    return entries.map(entry => ({ ...entry }));
}

export function formatRuntimeLogs() {
    if (!entries.length) return '暂无运行日志';
    return entries.map(entry => `${entry.time} [${entry.level.toUpperCase()}] ${entry.message}`).join('\n');
}

export function clearRuntimeLogs() {
    entries.length = 0;
}

export { MAX_RUNTIME_LOGS };
