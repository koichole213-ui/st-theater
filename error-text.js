// 报错里给用户看的那句话。插件自己抛的中文提示原样保留；
// 浏览器、网络或解析器给的英文原话换成中文说明，原话写进运行日志给维护者看。
import { writeRuntimeLog } from './runtime-log.js';

const HAN = /[一-鿿]/;

const KNOWN_ERRORS = [
    [(name, text) => name === 'QuotaExceededError' || /quota/i.test(text),
        '浏览器存储空间不足，这次没存进去。请先导出备份，再清理浏览器空间。'],
    [(name, text) => /failed to fetch|networkerror|load failed|network ?error|err_connection/i.test(text),
        '连不上酒馆服务器。请确认酒馆还开着、网络正常，再试一次。'],
    [(name, text) => name === 'SyntaxError' || /\bjson\b|unexpected token|unexpected end of/i.test(text),
        '文件内容不是插件能读的格式，请确认选对了文件。'],
    [(name, text) => name === 'TimeoutError' || /timed? ?out/i.test(text),
        '等了太久没有回应，请稍后再试。'],
    [(name, text) => name === 'AbortError' || /aborted/i.test(text),
        '操作被中断了，这次没有完成，请再试一次。'],
];

export function readableErrorText(error, fallback = '原因不明，请刷新页面后再试。', { context = '' } = {}) {
    const name = String(error?.name || '');
    const text = String(error?.message ?? error ?? '').trim();
    if (HAN.test(text)) return text;
    const known = KNOWN_ERRORS.find(([test]) => test(name, text))?.[1];
    if (text || name) {
        writeRuntimeLog('warn', `${context || '报错'}：浏览器给出的原话`, { name: name || undefined, message: text.slice(0, 300) });
    }
    return known || fallback;
}
