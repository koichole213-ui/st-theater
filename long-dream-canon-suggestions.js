import { reasoningSafeContent } from './reasoning-filter.js';

export const LONG_DREAM_CANON_SUGGESTION_CATEGORIES = Object.freeze([
    '人物关系',
    '时间地点',
    '已发生事件',
    '不可违反事实',
]);

const CATEGORY_ALIASES = Object.freeze({
    人物: '人物关系',
    关系: '人物关系',
    人物关系: '人物关系',
    时间: '时间地点',
    地点: '时间地点',
    时空: '时间地点',
    时间地点: '时间地点',
    事件: '已发生事件',
    剧情事件: '已发生事件',
    已发生事件: '已发生事件',
    事实: '不可违反事实',
    硬事实: '不可违反事实',
    约束: '不可违反事实',
    不可违反事实: '不可违反事实',
});

function cleanText(value, limit = 0) {
    const text = String(value || '').replace(/\r\n?/g, '\n').trim();
    return limit > 0 ? text.slice(0, limit) : text;
}

function boundedFirstChapter(value, limit = 32000) {
    const text = cleanText(value);
    if (text.length <= limit) return text;
    const tailLength = Math.min(8000, Math.floor(limit / 3));
    const marker = '\n\n……（第一章中段因长度省略）……\n\n';
    const headLength = Math.max(0, limit - tailLength - marker.length);
    return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function parseJsonValue(value) {
    const text = reasoningSafeContent(value).trim();
    const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const objectStart = unfenced.indexOf('{');
    const arrayStart = unfenced.indexOf('[');
    const start = unfenced.startsWith('[') ? 0 : (objectStart >= 0 ? objectStart : arrayStart);
    if (start < 0) throw new Error('AI 定梦建议没有返回 JSON');
    const opener = unfenced[start];
    const end = opener === '{' ? unfenced.lastIndexOf('}') : unfenced.lastIndexOf(']');
    if (end <= start) throw new Error('AI 定梦建议 JSON 不完整');
    return JSON.parse(unfenced.slice(start, end + 1));
}

function normalizeCategory(value) {
    const category = cleanText(value, 30).replace(/[\s/／_-]+/g, '');
    return CATEGORY_ALIASES[category] || LONG_DREAM_CANON_SUGGESTION_CATEGORIES.find(item => category.includes(item)) || '不可违反事实';
}

function normalizeUncertain(item = {}) {
    if (item.uncertain === true || item.needsConfirmation === true) return true;
    const confidence = cleanText(item.confidence || item.status || '').toLocaleLowerCase();
    return ['low', 'uncertain', 'unknown', 'needs-confirmation', '不确定', '需要确认', '待确认'].some(token => confidence.includes(token));
}

function suggestionList(data) {
    if (Array.isArray(data)) return data;
    for (const key of ['items', 'suggestions', 'canonSuggestions']) {
        if (Array.isArray(data?.[key])) return data[key];
    }
    return [];
}

export function buildLongDreamCanonSuggestionPayload({ sourceTitle = '', sourceText = '' } = {}) {
    const chapter = boundedFirstChapter(sourceText);
    if (!chapter) throw new Error('第一章没有可分析的正文');
    return {
        systemPrompt: `你负责从一篇已经完成的第一章中整理“定梦建议”。这些建议只是一份等待用户逐项确认的草稿，不是已经成立的设定。

规则：
1. 只依据提供的第一章正文，不读取、不猜测任何聊天前文、世界书或作者未写出的设定；
2. 只提取会影响长期续写的事实，分为：人物关系、时间地点、已发生事件、不可违反事实；
3. 不把氛围、文风、愿望、可能性或常识推断写成硬事实；
4. 无法从正文唯一确定的内容必须将 uncertain 设为 true，并用 uncertaintyNote 简短说明歧义；
5. 不续写、不评价、不润色，不替用户决定人物关系；
6. 只输出合法 JSON，不输出 Markdown、代码围栏或解释。`,
        userPrompt: `【第一章标题】${cleanText(sourceTitle, 200) || '未命名第一章'}

【第一章正文】
${chapter}

【输出 JSON 结构】
{
  "items": [
    {
      "category": "人物关系|时间地点|已发生事件|不可违反事实",
      "content": "一条简短、可核对、适合作为续章约束的事实",
      "uncertain": false,
      "uncertaintyNote": "仅在不确定时说明需要用户确认什么"
    }
  ]
}

没有可靠事实时 items 输出空数组。每条只写一个事实，总数不超过 24 条。`,
        sourceChars: chapter.length,
    };
}

export function parseLongDreamCanonSuggestions(value) {
    const data = parseJsonValue(value);
    const seen = new Set();
    const items = suggestionList(data)
        .slice(0, 40)
        .map(item => {
            const content = cleanText(typeof item === 'string' ? item : item?.content, 800);
            if (!content) return null;
            const category = normalizeCategory(item?.category || item?.type);
            const fingerprint = `${category}\u0000${content.toLocaleLowerCase()}`;
            if (seen.has(fingerprint)) return null;
            seen.add(fingerprint);
            const uncertain = normalizeUncertain(item);
            return {
                id: `canon-suggestion-${seen.size}`,
                category,
                content,
                uncertain,
                uncertaintyNote: uncertain
                    ? cleanText(item?.uncertaintyNote || item?.reason || item?.note, 300)
                    : '',
                accepted: false,
            };
        })
        .filter(Boolean)
        .slice(0, 24);
    return items;
}

export function composeLongDreamCanon(manualCanon = '', suggestions = []) {
    const manual = cleanText(manualCanon);
    const accepted = [];
    const seen = new Set();
    for (const item of Array.isArray(suggestions) ? suggestions : []) {
        if (item?.accepted !== true) continue;
        const content = cleanText(item.content, 800);
        if (!content) continue;
        const fingerprint = content.toLocaleLowerCase();
        if (seen.has(fingerprint) || manual.toLocaleLowerCase().includes(fingerprint)) continue;
        seen.add(fingerprint);
        accepted.push(`- 【${normalizeCategory(item.category)}】${content}`);
    }
    if (!accepted.length) return manual;
    const acceptedBlock = `【逐项确认的 AI 定梦建议】\n${accepted.join('\n')}`;
    return [manual, acceptedBlock].filter(Boolean).join('\n\n');
}
