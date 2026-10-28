import { filterTaggedReasoning } from './reasoning-filter.js';

const EXTRA_NAMES = 'finish|ws_prologue|ws_galstatus|ws_todo|ws_activeworld|storystatus_1|storystatus_2|status_1|updatevariable|tableedit|secrets|meow_fm|branches|littletheatre|bbs';
const EXTRA_PATTERN = new RegExp(`<script\\b[\\s\\S]*?(?:<\\/script\\s*>|$)|<style\\b[\\s\\S]*?(?:<\\/style\\s*>|$)|<\\s*(\\/?)\\s*(${EXTRA_NAMES})\\b[^>]*>`, 'gi');
const PARTIAL_EXTRA = new RegExp(`^<\\s*\\/?\\s*(?:${EXTRA_NAMES})\\b[^>]*$`, 'i');
const PARTIAL_NAMES = EXTRA_NAMES.split('|').flatMap(name => [`<${name}>`, `</${name}>`]);

export const STORY_OUTPUT_RULE = '【本次作品输出边界】本次只交付故事正文及所选模板的排版。预设中的角色与文风要求继续保留，但其旧篇幅范围不得覆盖本次目标；预设思考步骤继续保留，但思考过程（包括ECoT）不属于故事正文，若输出须以完整思考标签独立包裹，不得混入content正文，程序会隐藏。不要输出finish字数报告、数字联想、创作解释、状态栏、变量更新或其他预设附加部件。所选模板的丰富HTML、样式及故事内交互要求仍须保留。';

export function filterStoryOutput(value, { plainText = false } = {}) {
    const text = filterTaggedReasoning(value).content;
    let result = '', cursor = 0, depth = 0;
    EXTRA_PATTERN.lastIndex = 0;
    for (let match; (match = EXTRA_PATTERN.exec(text));) {
        if (depth === 0) result += text.slice(cursor, match.index);
        if (/^<(?:script|style)\b/i.test(match[0])) {
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
