const REASONING_TAG_NAMES = new Set(['think', 'thinking', 'electric', 'ecot']);
const COMPLETE_TAG_PATTERN = /<\s*(\/?)\s*(think|thinking|electric|ecot)(?=[\s/>])[^>]*>/gi;
const TAG_PREFIXES = Object.freeze([
    '<think>',
    '</think>',
    '<thinking>',
    '</thinking>',
    '<ecot>',
    '</ecot>',
    '<electric>',
    '</electric>',
]);

import { recoverHtmlText } from './html-integrity.js';
import { readableCharCount } from './text-counter.js';

// 只数读者看得到的字：样式、脚本里的代码不算。
const readableLength = value => readableCharCount(recoverHtmlText(value));
// 代码、脚本、样式里出现的 </think> 是作品内容，不当作思考结束标签。
const RAW_REGION = /<(script|style|pre|code|textarea)(?=[\s/>])[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
function rawRegions(text) {
    return [...text.matchAll(new RegExp(RAW_REGION))].map(match => [match.index, match.index + match[0].length]);
}

function trailingPartialTagLength(value) {
    const text = String(value || '');
    const start = text.lastIndexOf('<');
    if (start < 0) return 0;
    const suffix = text.slice(start).toLocaleLowerCase();
    if (suffix.includes('>')) return 0;
    return TAG_PREFIXES.some(tag => tag.startsWith(suffix))
        || /^<\s*\/?\s*(?:think|thinking|electric|ecot)(?=[\s/])[^>]*$/i.test(suffix)
        ? text.length - start : 0;
}

/**
 * Removes model reasoning wrapped in <thinking>, <think>, or <electric>
 * without exposing an unfinished block during cumulative streaming updates.
 */
export function filterTaggedReasoning(value) {
    const text = String(value || '');
    if (!text) return { content: '', hadReasoning: false, incomplete: false };

    let content = '';
    let cursor = 0;
    let depth = 0;
    let hadReasoning = false;
    let loneClose = -1;
    let regions = null;
    COMPLETE_TAG_PATTERN.lastIndex = 0;

    let match;
    while ((match = COMPLETE_TAG_PATTERN.exec(text)) !== null) {
        const segment = text.slice(cursor, match.index);
        if (depth === 0) content += segment;
        cursor = COMPLETE_TAG_PATTERN.lastIndex;
        regions ??= rawRegions(text);
        const at = match.index;
        if (regions.some(([start, end]) => at > start && at < end)) {
            // 代码、脚本、样式里的这类字样是作品内容，原样保留。
            if (depth === 0) content += match[0];
            continue;
        }

        const closing = match[1] === '/';
        const name = String(match[2] || '').toLocaleLowerCase();
        if (REASONING_TAG_NAMES.has(name)) {
            hadReasoning = true;
            if (closing && depth === 0) loneClose = content.length;
            else if (closing) depth--;
            else depth++;
        }
    }

    if (depth === 0) {
        let tail = text.slice(cursor);
        const partialLength = trailingPartialTagLength(tail);
        if (partialLength) {
            hadReasoning = true;
            tail = tail.slice(0, -partialLength);
        }
        content += tail;
        // 只有结束标签、没有开始标签：结束标签之前多半是没包起来的思考。只有当后面有足够正文（至少 50 个字），
        // 而且前面那段不比后面长时，才只保留后面；否则整段保留，宁可多留也不丢正文。
        if (loneClose >= 0) {
            const after = readableLength(content.slice(loneClose));
            if (after >= 50 && readableLength(content.slice(0, loneClose)) <= after) content = content.slice(loneClose);
        }
    }

    return {
        content,
        hadReasoning,
        incomplete: depth > 0,
    };
}

export function reasoningSafeContent(value) {
    return filterTaggedReasoning(value).content;
}

export function unclosedReasoningText(value) {
    const text = String(value || '');
    let start = -1, depth = 0;
    for (const match of text.matchAll(new RegExp(COMPLETE_TAG_PATTERN))) {
        if (match[1]) depth = Math.max(0, depth - 1);
        else if (depth++ === 0) start = match.index + match[0].length;
    }
    return depth > 0 ? text.slice(start) : '';
}
