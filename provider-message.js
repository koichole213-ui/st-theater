import { redactRuntimeSecrets } from './runtime-log.js';

export function isProviderMessageChinese(text) {
    return /[一-鿿]/.test(String(text ?? '').replace(/\[(?:地址|私钥|正文)已隐藏\]/g, ''));
}

export const PROVIDER_MESSAGE_MAX = 200;

const FAMILIES = [
    [/gemini|gemma|google/i, 'Gemini'], [/claude|anthropic/i, 'Claude'], [/deepseek/i, 'DeepSeek'],
    [/\bgpt|openai|\bo[134]\b/i, 'GPT'], [/grok|xai/i, 'Grok'], [/qwen|通义/i, '通义千问'],
];

// 顺序有意义：先匹配到的生效。
const PROVIDER_MESSAGE_RULES = [
    [/maintenance|under maintenance|维护中|正在维护/i, () => '服务商或中转正在维护。'],
    [/overload|over capacity|server is busy|服务器繁忙|负载过高|model is (?:currently )?(?:busy|unavailable)|\bUNAVAILABLE\b/i, f => `上游模型${f}当前负载过高，暂时无法处理请求。`],
    [/insufficient[_\s]?quota|exceeded your current quota|credit balance is too low|insufficient (?:credits?|balance|funds)|quota is not enough|余额不足|额度不足|额度已用尽|billing/i, () => '账户额度或余额不足。'],
    [/rate[\s_-]*limit|too many requests|RESOURCE_EXHAUSTED|resource (?:has been )?exhausted|请求过于频繁|限流|\b429\b/i, () => '请求过于频繁或配额暂时用尽，被服务商限流。'],
    [/invalid[\s_-]*(?:api[\s_-]*)?key|incorrect api key|api key not valid|invalid x-api-key|authentication[_\s]?error|unauthori[sz]ed|invalid (?:access )?token|令牌.{0,6}(?:无效|过期)|无效的令牌/i, () => '提供的 API Key 无效或已过期。'],
    [/user location is not supported|unsupported[_\s]country|(?:region|location|country).{0,30}not (?:supported|available)|地区.{0,6}不(?:支持|可用)/i, () => '服务商不支持当前所在地区访问。'],
    [/no available (?:channel|distributor|account)|无可用渠道|没有可用(?:的)?渠道|所有渠道/i, () => '中转当前没有可用的渠道来提供这个模型。'],
    [/model[_\s]?not[_\s]?found|model.{0,80}(?:not found|does not exist|not available|is not supported)|模型.{0,30}(?:不存在|不可用)/i, () => '服务商找不到这个模型，或这个模型当前不可用。'],
    [/permission[_\s]?denied|forbidden|not allowed to|do not have access|无权|没有权限/i, () => '这个 Key 没有使用该模型或功能的权限。'],
    [/context[_\s]?length|maximum context|prompt is too long|too many (?:input )?tokens|input.{0,30}too long|request (?:entity )?too large|上下文.{0,8}(?:超出|过长|超限)/i, () => '发送的内容太长，超出了模型能接收的上限。'],
    [/max[_\s]?(?:output[_\s]?)?tokens|max_completion_tokens|输出上限/i, () => '设置的单次输出上限超出了模型允许的范围。'],
    [/safety|content[\s_-]*(?:policy|filter|management)|prohibited[_\s]?content|blocked|flagged|moderation|违规|敏感|审核/i, () => '内容被服务商的安全规则拦截。'],
    [/time[\s_-]?d?\s?out|deadline[_\s]?exceeded|\b524\b|超时/i, () => '上游处理超时，没有在规定时间内完成。'],
    [/retr(?:y|ies).{0,30}(?:exhausted|failed|limit)|max(?:imum)? retries|重试.{0,10}(?:失败|用尽|次数)/i, () => '中转多次重试后仍然失败。'],
    [/bad gateway|upstream.{0,20}(?:error|connect|unavailable)|connection (?:reset|refused|closed|error)|\bEOF\b|socket hang up|上游.{0,6}(?:错误|异常|连接)/i, () => '中转与上游模型之间的连接出了问题。'],
    [/unknown (?:name|field|parameter)|unrecognized (?:field|parameter|request argument)|unsupported (?:parameter|field|value)|not support.{0,20}(?:stream|parameter|field)/i, () => '模型不支持请求中的某项参数。'],
    [/internal (?:server )?error|\bINTERNAL\b|内部错误/i, () => '服务商内部出错。'],
    [/invalid[_\s]?request|bad request|INVALID_ARGUMENT|参数错误/i, () => '服务商认为请求的格式或参数有误。'],
];

function redactProviderText(raw, secrets) {
    let text = String(raw ?? '');
    // Some providers append the rejected input to their error explanation.
    text = text.replace(/(\b(?:messages(?:\[\d+\](?:\.content)?)?|prompt|request[_ -]?body|input|story)["']?\s*[:=]\s*)[\s\S]*/i, '$1[正文已隐藏]');
    text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[私钥已隐藏]');
    text = text.replace(/(\b(?:proxy[-_])?authorization|\b(?:set[-_])?cookie)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]*)/gi, '$1: ****');
    text = text.replace(/\b(?:https?|wss?):\/\/[^\s<>"'`]+/gi, '[地址已隐藏]');
    text = text.replace(/(?:\/\/[\w.-]+\.[\w.-]+|\b[\w.-]+\.[a-z]{2,}(?=:\d+\/|\/)|\blocalhost(?=[:/])|\b(?:\d{1,3}\.){3}\d{1,3}(?=[:/]))[^\s<>"'\x60]*/gi, '[地址已隐藏]');
    text = text.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{6,}/g, 'sk-****');
    text = text.replace(/\bAIza[0-9A-Za-z_-]{10,}/g, 'AIza****');
    text = text.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ****');
    text = text.replace(/(\b(?:credential|api[-_]?key|apikey|x[-_]?api[-_]?key|key|(?:[a-z]+[-_])?token|secret|password)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^"',;\s}\\]+)/gi, '$1****');
    for (const secret of secrets) {
        if (typeof secret === 'string' && secret) text = text.replaceAll(secret, '[REDACTED]');
    }
    return redactRuntimeSecrets(text);
}

export function describeProviderMessage(raw, { secrets = [] } = {}) {
    let text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return null;
    if (/<(?:html|!doctype|body|head)\b/i.test(text)) return null; // 网关网页，不当原话显示
    text = redactProviderText(text, secrets).replace(/\s+/g, ' ');
    if (text.length > PROVIDER_MESSAGE_MAX) text = text.slice(0, PROVIDER_MESSAGE_MAX - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
    const family = FAMILIES.find(([re]) => re.test(text))?.[1];
    const f = family ? `（${family}）` : '';
    for (const [re, zh] of PROVIDER_MESSAGE_RULES) if (re.test(text)) return { original: text, zh: zh(f), known: true };
    const hasChinese = isProviderMessageChinese(text);
    return { original: text, zh: hasChinese ? text : '服务商返回了一段说明，插件暂时无法翻译；原文见“技术信息”。', known: hasChinese };
}

// Follow explicit error fields only. Gateways sometimes put JSON inside error.message.
export function extractProviderMessage(raw, { allowPlainText = false } = {}) {
    let value = raw;
    for (let depth = 0; depth < 3; depth++) {
        if (typeof value === 'string') {
            if (!/^\s*[{[]/.test(value)) return depth || allowPlainText ? value : '';
            try { value = JSON.parse(value); }
            catch { return depth || allowPlainText ? value : ''; }
        }
        if (!value || typeof value !== 'object') return '';
        const error = value.error;
        value = typeof error === 'string' ? error : error?.message || error?.error || value.message;
    }
    return typeof value === 'string' && !/^\s*[{[]/.test(value) ? value : '';
}
