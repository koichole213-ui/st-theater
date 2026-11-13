import { filterTaggedReasoning } from './reasoning-filter.js';
import { recoverHtmlText } from './html-integrity.js';
import { readableCharCount } from './text-counter.js';

const EXTRA_NAMES = 'finish|ws_prologue|ws_galstatus|ws_todo|ws_activeworld|storystatus_1|storystatus_2|status_1|updatevariable|tableedit|secrets|meow_fm|branches|littletheatre|bbs';
const EXTRA_PATTERN = new RegExp(`<script(?=[\\s/>])[\\s\\S]*?(?:<\\/script\\s*>|$)|<style(?=[\\s/>])[\\s\\S]*?(?:<\\/style\\s*>|$)|<\\s*(\\/?)\\s*(${EXTRA_NAMES})(?=[\\s/>])[^>]*>`, 'gi');
const PARTIAL_EXTRA = new RegExp(`^<\\s*\\/?\\s*(?:${EXTRA_NAMES})(?=[\\s/])[^>]*$`, 'i');
const PARTIAL_NAMES = EXTRA_NAMES.split('|').flatMap(name => [`<${name}>`, `</${name}>`]);
const EXTRA_WRAPPERS = new RegExp(`<\\s*\\/?\\s*(?:${EXTRA_NAMES})(?=[\\s/>])[^>]*>`, 'gi');
const FINISH_REPORT = /<\s*finish(?=[\s/>])[^>]*?(?:\/\s*>|>[\s\S]*?(?:<\/\s*finish\s*>|$))/gi;
const SIMILAR_TAG = new RegExp(`<\\s*(?:think|thinking|electric|ecot|${EXTRA_NAMES})(?=[^\\w\\s/>])`, 'i');

export const FORMAT_RECOVERY_NOTICE = '模型输出格式异常（思考标签未闭合或正文被附加标签包裹），已保留原文，可重新 HTML 排版。';

export const STORY_OUTPUT_RULE = '【本次作品输出边界】本次只交付故事正文及所选模板的排版。预设中的角色与文风要求继续保留，但其旧篇幅范围不得覆盖本次目标；预设思考步骤继续保留，但思考过程（包括ECoT）不属于故事正文，若输出须以完整思考标签独立包裹，不得混入content正文，程序会隐藏。不要输出finish字数报告、数字联想、创作解释、状态栏、变量更新或其他预设附加部件。所选模板的丰富HTML、样式及故事内交互要求仍须保留。';

function startsWithWrappedBody(text) {
    let cursor = 0, depth = 0;
    const readable = value => readableCharCount(recoverHtmlText(value)) > 0;
    for (const match of text.matchAll(new RegExp(EXTRA_PATTERN))) {
        const prefix = text.slice(cursor, match.index);
        // A plain lead-in explicitly labelled "前言" can precede a wrapped story.
        if (readable(prefix) && !(cursor === 0 && !depth && /^前言\s*[:：]?$/.test(prefix.trim()))) return depth > 0;
        if (match[1]) depth = Math.max(0, depth - 1);
        else if (match[2] && !/\/\s*>$/.test(match[0])) depth++;
        cursor = match.index + match[0].length;
    }
    return depth > 0 && readable(text.slice(cursor));
}

export function filterStoryOutput(value, { plainText = false } = {}) {
    const text = filterTaggedReasoning(value).content;
    let result = '', cursor = 0, depth = 0;
    EXTRA_PATTERN.lastIndex = 0;
    for (let match; (match = EXTRA_PATTERN.exec(text));) {
        if (depth === 0) result += text.slice(cursor, match.index);
        if (/^<(?:script|style)(?=[\s/>])/i.test(match[0])) {
            if (depth === 0) result += match[0];
        } else if (match[1]) depth = Math.max(0, depth - 1);
        else if (!/\/\s*>$/.test(match[0])) depth++;
        cursor = EXTRA_PATTERN.lastIndex;
    }
    if (depth === 0) result += text.slice(cursor);
    const lastTag = result.lastIndexOf('<');
    if (lastTag >= 0) {
        const suffix = result.slice(lastTag).toLowerCase();
        if (!suffix.includes('>') && (PARTIAL_EXTRA.test(suffix) || [...PARTIAL_NAMES, ...(plainText ? ['<content>', '</content>'] : [])].some(name => name.startsWith(suffix)))) result = result.slice(0, lastTag);
    }
    if (plainText) {
        // Only an explicit leading story envelope defines a body boundary. Never guess from prose headings.
        if (/^\s*<content\b[^>]*>/i.test(result)) {
            const bodies = [...result.matchAll(/<content\b[^>]*>([\s\S]*?)(?:<\/content\s*>|$)/gi)].map(match => match[1]);
            return bodies.join('\n\n');
        }
        if (/^\s*<[^>]*$/.test(result) && '<content>'.startsWith(result.trim().toLowerCase())) return '';
    }
    return result;
}

export function finalStoryOutput(value, { plainText = false, formatRecovered, normalText } = {}) {
    const raw = String(value || '');
    const filtered = filterStoryOutput(raw, { plainText });
    if (formatRecovered === 'unclosed-reasoning') {
        return { text: raw.replace(FINISH_REPORT, '').replace(EXTRA_WRAPPERS, ''), formatRecovered };
    }
    const safe = filterTaggedReasoning(raw).content;
    // A valid finish report is metadata even when it is the only readable output.
    const withoutFinish = safe.replace(FINISH_REPORT, '');
    const candidate = withoutFinish.replace(EXTRA_WRAPPERS, '');
    const rawChars = readableCharCount(recoverHtmlText(candidate));
    const filteredChars = readableCharCount(recoverHtmlText(filtered));
    if (rawChars && (!filteredChars || (filteredChars < rawChars / 5 && startsWithWrappedBody(withoutFinish)))) {
        return { text: candidate, formatRecovered: 'extra-wrapper' };
    }
    if (filteredChars && SIMILAR_TAG.test(safe)) return { text: normalText ?? filtered, formatRecovered: 'custom-tag' };
    return { text: normalText ?? filtered };
}
