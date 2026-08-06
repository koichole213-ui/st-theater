const SECRET_PATTERNS = [
    [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
    [/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED-KEY]'],
    [/(api[_-]?key|authorization|token|password)(\s*[:=]\s*)[^\s,;}]+/gi, '$1$2[REDACTED]'],
];

export function redactRequestTraceText(value = '') {
    return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value || ''));
}

export function createRequestTrace({
    route = '', transport = '', protocol = '', model = '', presetName = '',
    postProcessing = '', maxTokens = null, messages = [],
} = {}) {
    return {
        capturedAt: new Date().toISOString(),
        route: String(route || 'unknown'),
        transport: String(transport || 'unknown'),
        protocol: String(protocol || 'unknown'),
        model: redactRequestTraceText(String(model || '未识别')),
        presetName: redactRequestTraceText(String(presetName || '未指定')),
        postProcessing: String(postProcessing || 'none'),
        toolsDisabled: true,
        maxTokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : null,
        messages: (Array.isArray(messages) ? messages : []).map((message, index) => ({
            index: index + 1,
            role: String(message?.role || 'unknown'),
            source: String(message?.source || 'request'),
            sourceId: String(message?.sourceId || `message-${index + 1}`),
            content: redactRequestTraceText(String(message?.content || '')),
        })),
    };
}

export function formatRequestTrace(trace) {
    if (!trace) return '暂无实际请求快照。';
    const header = [
        `实际请求快照 ${trace.capturedAt || ''}`.trim(),
        `线路：${trace.route} / ${trace.transport}`,
        `协议：${trace.protocol} · 模型：${trace.model} · 最大输出：${trace.maxTokens ?? '未指定'}`,
        `预设：${trace.presetName} · 后处理：${trace.postProcessing} · 工具：${trace.toolsDisabled ? '已强制禁用' : '未知'}`,
    ];
    const body = (trace.messages || []).map(message =>
        `\n[${message.index}] ${message.role} · ${message.source}${message.sourceId ? `/${message.sourceId}` : ''}\n${message.content}`
    );
    return [...header, ...body].join('\n');
}
