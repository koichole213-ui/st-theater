export function createRequestMetrics(path = 'unknown') {
    return { path, requestStartedAt: Date.now(), firstTokenAt: null, completedAt: null, fallbackAt: null, fallbackFrom: null };
}

export function markFirstToken(metrics) {
    if (metrics && !metrics.firstTokenAt) metrics.firstTokenAt = Date.now();
}

export function markFallback(metrics, from) {
    if (!metrics) return;
    metrics.fallbackAt = Date.now();
    metrics.fallbackFrom = from;
}

export function markCompleted(metrics) {
    if (metrics) metrics.completedAt = Date.now();
}

export function summarizeMetrics(metrics) {
    if (!metrics) return '暂无请求计时';
    const start = metrics.requestStartedAt;
    const ms = value => value ? `+${Math.max(0, value - start)}ms` : '未发生';
    const started = new Date(start).toLocaleTimeString('zh-CN', { hour12: false });
    return `开始 ${started}；路径 ${metrics.path}；首字 ${ms(metrics.firstTokenAt)}；主体完成 ${ms(metrics.completedAt)}；fallback ${ms(metrics.fallbackAt)}${metrics.fallbackFrom ? `（来自 ${metrics.fallbackFrom}）` : ''}`;
}
