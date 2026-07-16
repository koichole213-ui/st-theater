export function estimateTokenCount(text) {
    const value = String(text || '');
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const other = Math.max(0, value.length - cjk);
    return value ? Math.max(1, Math.ceil(cjk * 1.5 + other / 4)) : 0;
}

export function estimateTokenBreakdown(parts = {}) {
    const result = {};
    let total = 0;
    for (const [key, value] of Object.entries(parts)) {
        const count = estimateTokenCount(value);
        result[key] = count;
        total += count;
    }
    return { ...result, total };
}

export function formatTokenCount(value) {
    const n = Math.max(0, Number(value) || 0);
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 1)}k` : String(Math.round(n));
}

export function debounce(fn, wait = 220) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}
