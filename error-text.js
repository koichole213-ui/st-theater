// 报错里给用户看的那句话。插件自己抛的中文提示原样保留；
// 浏览器、网络或解析器给的英文原话换成中文说明，原话写进运行日志给维护者看。
import { writeRuntimeLog } from './runtime-log.js';

const HAN = /[一-鿿]/;

function httpStatusText(status) {
    if (status === 401 || status === 403) return `酒馆拒绝了这次请求，可能是登录过期了，请刷新页面后再试（HTTP ${status}）。`;
    if (status === 404) return '找不到要读取的内容，可能已经改名或删除了（HTTP 404）。';
    if (status === 413) return '内容太大，酒馆没有接收（HTTP 413）。';
    if (status === 429) return '请求太频繁，请稍等一会儿再试（HTTP 429）。';
    if (status >= 500) return `酒馆服务器出错了（HTTP ${status}），请稍后再试；仍不行可以看看酒馆的后台窗口。`;
    return `酒馆返回了 HTTP ${status}，请稍后再试。`;
}

// file：这个报错发生在“读用户选的文件”时（导入）。其他地方读不懂的多半是酒馆返回的内容。
const KNOWN_ERRORS = [
    [(name, text) => name === 'QuotaExceededError' || /quota/i.test(text),
        () => '浏览器存储空间不足，这次没存进去。请先导出备份，再清理浏览器空间。'],
    [(name, text) => /^HTTP \d{3}\b/.test(text),
        (name, text) => httpStatusText(Number(text.slice(5, 8)))],
    [(name, text) => /failed to fetch|networkerror|load failed|network ?error|err_connection/i.test(text),
        () => '连不上酒馆服务器。请确认酒馆还开着、网络正常，再试一次。'],
    [(name, text) => name === 'SyntaxError' || /\bjson\b|unexpected token|unexpected end of/i.test(text),
        (name, text, file) => (file ? '文件内容不是插件能读的格式，请确认选对了文件。' : '酒馆返回的内容读不懂，可能是登录过期或被网络代理拦住了，请刷新页面后再试。')],
    [(name, text) => name === 'TimeoutError' || /timed? ?out/i.test(text),
        () => '等了太久没有回应，请稍后再试。'],
    [(name, text) => name === 'AbortError' || /aborted/i.test(text),
        () => '操作被中断了，这次没有完成，请再试一次。'],
];

export function readableErrorText(error, fallback = '原因不明，请刷新页面后再试。', { context = '', file = false } = {}) {
    const name = String(error?.name || '');
    const text = String(error?.message ?? error ?? '').trim();
    if (HAN.test(text)) return text;
    const rule = KNOWN_ERRORS.find(([test]) => test(name, text));
    if (text || name) {
        writeRuntimeLog('warn', `${context || '报错'}：浏览器给出的原话`, { name: name || undefined, message: text.slice(0, 300) });
    }
    return rule ? rule[1](name, text, file) : fallback;
}
