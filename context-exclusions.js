export const MAX_CONTEXT_EXCLUSION_RULES = 30;
export const MAX_CONTEXT_EXCLUSION_LENGTH = 16000;

export function validateContextExclusionRule(candidate = {}) {
    const type = candidate?.type;
    let value = typeof candidate?.value === 'string' ? candidate.value : '';
    if (type !== 'tag' && type !== 'literal') return { error: '请选择规则类型。' };
    if (!value.trim()) return { error: '请填写要排除的标签名或固定内容。' };
    if (type === 'tag') {
        value = value.trim().replace(/^<\/?([A-Za-z][\w:.-]*)\s*>$/, '$1');
        if (!/^[A-Za-z][\w:.-]{0,63}$/.test(value)) return { error: '请填写单个标签名，例如 anti_cut，不要填写属性或正文。' };
        value = value.toLowerCase();
    } else if (value.length > MAX_CONTEXT_EXCLUSION_LENGTH) {
        return { error: `单条固定内容最多 ${MAX_CONTEXT_EXCLUSION_LENGTH} 个字符，请缩小匹配范围。` };
    }
    return { rule: { type, value, enabled: candidate.enabled !== false } };
}

export function normalizeContextExclusionRules(candidates = []) {
    const result = [];
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const { rule } = validateContextExclusionRule(candidate);
        if (rule) result.push(rule);
        if (result.length === MAX_CONTEXT_EXCLUSION_RULES) break;
    }
    return result;
}

// 扫描源字符串而不创建 DOM：保留其余 HTML 原样，也不执行消息中的脚本。
function excludeTagBlocks(source, tagName) {
    const tokens = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/?([A-Za-z][\w:.-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
    let depth = 0;
    let start = 0;
    let cursor = 0;
    let removed = 0;
    let text = '';
    let rawTextTag = '';
    for (const token of source.matchAll(tokens)) {
        const name = token[1]?.toLowerCase();
        if (!name) continue;
        const closing = token[0].startsWith('</');
        // script/style 内的标签文本不是标签；允许排除 script/style 自身。
        if (rawTextTag && !(closing && name === rawTextTag)) continue;
        if (closing && name === rawTextTag) rawTextTag = '';
        else if (!closing && /^(script|style|textarea|title)$/.test(name)) rawTextTag = name;
        if (name !== tagName) continue;
        const end = token.index + token[0].length;
        if (!closing && /\/\s*>$/.test(token[0])) {
            if (depth === 0) {
                text += source.slice(cursor, token.index);
                cursor = end;
                removed++;
            }
        } else if (!closing) {
            if (depth === 0) start = token.index;
            depth++;
        } else if (depth > 0 && --depth === 0) {
            text += source.slice(cursor, start);
            cursor = end;
            removed++;
        }
    }
    // 缺失闭合标签时保留该区块，不能猜测删除范围而吞掉后续故事。
    return { text: text + source.slice(cursor), removed, unclosed: depth > 0 ? 1 : 0 };
}

function previewWithRules(source, rules) {
    let filtered = String(source ?? '');
    let removed = 0;
    let unclosed = 0;
    for (const rule of rules) {
        if (!rule.enabled) continue;
        if (rule.type === 'literal') {
            const pieces = filtered.split(rule.value);
            removed += pieces.length - 1;
            filtered = pieces.join('');
        } else {
            const result = excludeTagBlocks(filtered, rule.value);
            filtered = result.text;
            removed += result.removed;
            unclosed += result.unclosed;
        }
    }
    // 沿用原有 <content> 正文读取；先排除原消息中的区块，再选取正文。
    const content = filtered.match(/<content>([\s\S]*?)<\/content>/i);
    return { text: content ? content[1].trim() : filtered, removed, unclosed };
}

export function previewChatContext(source, rules = []) {
    return previewWithRules(source, normalizeContextExclusionRules(rules));
}

export function createChatContextReader(rules = []) {
    const snapshot = normalizeContextExclusionRules(rules);
    return source => previewWithRules(source, snapshot).text;
}

// 生成的正文也去掉“内容排除”（原名“前文排除”）里填的标签（只用“标签”类规则，固定内容类规则不动正文）。
// 正文本身的 HTML 标签（div、p、style……）和正文信封 content 不会被拿来删正文，免得把整篇排版删掉。
const STORY_HTML_TAGS = new Set(('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup '
    + 'content data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 head header hgroup hr '
    + 'html i iframe img input ins kbd label legend li link main map mark marquee menu meta meter nav noscript object ol optgroup option output p param '
    + 'picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup svg table tbody td '
    + 'template textarea tfoot th thead time title tr track u ul var video wbr center big tt strike font math g path circle rect line polyline polygon '
    + 'ellipse text tspan defs use symbol lineargradient radialgradient stop clippath mask pattern filter image foreignobject').split(' '));
const readableChars = value => String(value || '').replace(/<[^>]*>/g, '').match(/[\p{Script=Han}\p{L}\p{N}]/gu)?.length || 0;

export function outputExclusionTags(rules = []) {
    return [...new Set(normalizeContextExclusionRules(rules)
        .filter(rule => rule.enabled && rule.type === 'tag' && !STORY_HTML_TAGS.has(rule.value))
        .map(rule => rule.value))];
}

export function stripExcludedOutputTags(source, rules = []) {
    const original = String(source ?? '');
    const tags = outputExclusionTags(rules);
    if (!tags.length || !original) return { text: original, removed: 0, unwrapped: false };
    let text = original, removed = 0;
    for (const tag of tags) {
        const result = excludeTagBlocks(text, tag);
        text = result.text;
        removed += result.removed;
    }
    const before = readableChars(original);
    // 去掉后几乎什么都不剩、原文又有不少文字：多半是正文被包在这个标签里了。只去掉标签本身，保留文字。
    if (removed && before >= 50 && readableChars(text) < before / 5) {
        const marker = new RegExp(`<\\s*\\/?\\s*(?:${tags.map(tag => tag.replace(/[.]/g, '\\.')).join('|')})(?=[\\s/>])[^>]*>`, 'gi');
        return { text: original.replace(marker, ''), removed, unwrapped: true };
    }
    return { text, removed, unwrapped: false };
}
