// Conservative local recognition: never search inside the body for a title.
// Only the first line (or a whole-text paired label) can be a title, and the body must not be empty.
const BLOCKED_NAMES = /^(?:指令|正文|内容|要求|规则|任务|注意事项|输出格式|角色设定|背景设定|写作要求|创作要求|系统提示|system|user|char|assistant|instructions?|rules?|context|note|html|head|body|div|p|span|script|style|article|section|main|header|footer|title|em|i|b|strong|ul|ol|li|details|summary|table|tr|td|h[1-6])$/i;
const BLOCKED_STARTS = /^(?:请|禁止|不得|不要|不许|严格|现在|暂停|生成|输出|你是|你需要|你必须)/;
// 「标题：」这类前缀（也用在括号里面，比如【标题：雨夜来信】）。
const NAME_KEYS = '标题|题目|主题|名称|模板名称|模板名|剧场名|小剧场|title|name';
const KEY_PREFIX = new RegExp(`^(?:${NAME_KEYS})\\s*[:：]\\s*`, 'iu');
// 两边对称的装饰：星星、花、心、月亮、音符和各种 emoji。
const DECOR = '[✨⭐🌟★☆◆◇✦✧❀✿❁❤♡♥☾☽♪♫※❄❅❆·•\\p{Extended_Pictographic}\\uFE0F\\u200D]';
// 两边对称的线：=== 标题 ===、—— 标题 ——、--- 标题 ---、~~ 标题 ~~。
const RULE = '(?:={2,}|[—─━]{1,}|-{2,}|[~～]{1,}|\\*{3,}|#{3,}(?=\\s))';

export function recognizeInstructionTitle(value) {
    const original = String(value ?? '').trim();
    const unchanged = { name: '', content: original, recognized: false };
    const validTitle = name => name.length > 0 && name.length <= 60
        && !/[\r\n<>{}]/.test(name)
        && !BLOCKED_NAMES.test(name)
        && !BLOCKED_STARTS.test(name);
    // 一边没有明确的收口时（比如只在前面放了 emoji），再加一道：短、而且不像一句话。
    const titleLike = name => name.length <= 30 && !/[。！？!?；;，,]$/.test(name) && !/[。；;]/.test(name);
    const result = (name, body, { loose = false } = {}) => {
        name = name.trim().replace(KEY_PREFIX, '').trim();
        const content = body.trim();
        return validTitle(name) && (!loose || titleLike(name)) && content ? { name, content, recognized: true } : unchanged;
    };
    // Custom paired labels may share the first line with the instruction body.
    // Accept an escaped closing slash as commonly copied from chat messages.
    const wrapped = original.match(/^<([^<>\r\n]{1,60})>\s*([\s\S]*?)\s*\\?<\/\1>$/u);
    if (wrapped) return result(wrapped[1], wrapped[2]);
    const firstBreak = original.search(/\r?\n/);
    if (firstBreak < 0) return unchanged;
    const first = original.slice(0, firstBreak).trim();
    let body = original.slice(firstBreak).trim();
    // Setext 标题：第一行是标题，第二行全是 === 或 ---。
    const setext = body.match(/^(?:={3,}|-{3,})[ \t]*(?:\r?\n|$)/);
    if (setext && !/^[=\-\s]+$/.test(first)) return result(first, body.slice(setext[0].length), { loose: true });
    const strict = first.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/u)
        || first.match(new RegExp(`^(?:${NAME_KEYS})\\s*[:：]\\s*(.+)$`, 'iu'))
        || first.match(/^<(?:标题|名称|title|name)>\s*([^<>]+?)\s*<\/(?:标题|名称|title|name)>$/iu)
        || first.match(/^【([^【】]+)】$/u)
        || first.match(/^《([^《》]+)》$/u)
        || first.match(/^「([^「」]+)」$/u)
        || first.match(/^『([^『』]+)』$/u)
        || first.match(/^〖([^〖〗]+)〗$/u)
        || first.match(/^〔([^〔〕]+)〕$/u)
        || first.match(/^〈([^〈〉]+)〉$/u)
        || first.match(/^[[［]([^\[\]［］]+)[\]］]$/u)
        || first.match(/^\*\*([^*]+)\*\*$/u)
        || first.match(/^__([^_]+)__$/u)
        || first.match(new RegExp(`^${DECOR}+\\s*(.+?)\\s*${DECOR}+$`, 'u'))
        || first.match(new RegExp(`^${RULE}\\s*(.+?)\\s*${RULE}$`, 'u'));
    if (strict) return result(strict[1], body);
    // 宽一点的写法：【番外】雨夜来信 —— 只认短的、不像句子的一行，整行当名称。
    // 只在一边加装饰（✨雨夜来信）仍不算，免得把普通开场句当标题。
    const tagged = first.match(/^【[^【】]{1,12}】\s*([^【】\s].*)$/u);
    if (tagged && validTitle(tagged[1].trim())) return result(first, body, { loose: true });
    return unchanged;
}
