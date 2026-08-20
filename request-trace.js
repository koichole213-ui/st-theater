import { estimateTokenCount } from './token-estimator.js';

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
    postProcessing = '', maxTokens = null, messages = [], purpose = 'creative',
    presetGenerationOptionsInherited = null,
} = {}) {
    return {
        capturedAt: new Date().toISOString(),
        route: String(route || 'unknown'),
        transport: String(transport || 'unknown'),
        protocol: String(protocol || 'unknown'),
        model: redactRequestTraceText(String(model || '未识别')),
        presetName: redactRequestTraceText(String(presetName || '未指定')),
        postProcessing: String(postProcessing || 'none'),
        purpose: String(purpose || 'creative'),
        toolsDisabled: true,
        presetGenerationOptionsInherited: presetGenerationOptionsInherited === null
            ? null
            : !!presetGenerationOptionsInherited,
        maxTokens: maxTokens !== null && maxTokens !== undefined && Number.isFinite(Number(maxTokens))
            ? Number(maxTokens)
            : null,
        messages: (Array.isArray(messages) ? messages : []).map((message, index) => {
            const content = String(message?.content || '');
            return {
                index: index + 1,
                role: String(message?.role || 'unknown'),
                source: String(message?.source || 'request'),
                sourceId: String(message?.sourceId || `message-${index + 1}`),
                chars: content.length,
                estimatedTokens: estimateTokenCount(content),
            };
        }),
    };
}

export function requestTraceMessageLabel(message = {}) {
    const source = String(message.source || '');
    const sourceId = String(message.sourceId || '');
    if (!source || source === 'request') return String(message.role || 'unknown');
    return `${message.role || 'unknown'} · ${source}${sourceId ? `/${sourceId}` : ''}`;
}

export function formatRequestTrace(trace) {
    if (!trace) return '暂无创作请求结构。';
    const header = [
        `创作请求结构 ${trace.capturedAt || ''}`.trim(),
        `线路：${trace.route} / ${trace.transport}`,
        `协议：${trace.protocol} · 模型：${trace.model} · 最大输出：${trace.maxTokens ?? '未指定'}`,
        `预设：${trace.presetName} · 后处理：${trace.postProcessing} · 工具：${trace.toolsDisabled ? '已强制禁用' : '未知'}`,
        `预设采样参数：${trace.route === 'custom' ? '未继承（使用线路默认值）' : '由酒馆主 API 决定'}`,
    ];
    const body = (trace.messages || []).map(message =>
        `[${message.index}] ${requestTraceMessageLabel(message)} · ${message.chars ?? 0} 字符 · 约 ${message.estimatedTokens ?? 0} token`
    );
    return [...header, ...body].join('\n');
}
