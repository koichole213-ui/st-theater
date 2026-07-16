const MAX_RUNTIME_LOGS = 200;
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
    text = text.replace(/((?:authorization)["']?\s*[:=]\s*["']?)(?:bearer\s+)?([^"',;\s}\\]+)/gi, '$1[REDACTED]');
    text = text.replace(/((?:key|private[-_]?key|client[-_]?secret|x[-_]?api[-_]?key|api[-_]?key|apikey|secret|password|credential|access[-_]?token|refresh[-_]?token)["']?\s*[:=]\s*["']?)([^"',;\s}\\]+)/gi, '$1[REDACTED]');
    text = text.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
    return redactKnownSecrets(text);
}

export function setRuntimeLogSecretProvider(provider) {
    secretProvider = typeof provider === 'function' ? provider : () => [];
}

export function writeRuntimeLog(level, message, details) {
    const normalizedLevel = LEVELS.has(level) ? level : 'info';
    const detailText = details === undefined ? '' : ` ${safeStringify(details)}`;
    const entry = {
        time: new Date().toLocaleString('zh-CN', { hour12: false }),
        level: normalizedLevel,
        message: sanitizeLogText(`${String(message || '')}${detailText}`.trim()),
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
