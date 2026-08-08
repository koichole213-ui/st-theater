import { LONG_DREAM_MEMORY_TYPES, LONG_DREAM_WORLD_LINE_RELATION } from './long-dream.js';
import { reasoningSafeContent } from './reasoning-filter.js';

export const DEFAULT_LONG_DREAM_MEMORY_PRESET = `你负责“梦脉织录”：只从已经确认保存的章节中提取可核对的连续性事实。

规则：
1. 不续写、不润色、不替故事补全空白，不把推测写成事实；
2. 只记录会影响后续连载的人物状态、人生经历、关系、世界线偏离、伏笔/约定、地点/物品、事件与关键原话；
3. 此梦设定和已保存章节高于原世界书参考；发现冲突时记录“世界线偏离”，不能把原设定覆盖回来；
4. “世界线偏离”必须在 content 中依次写清：原线事实 → 本梦改变 → 直接结果 → 此后不能再默认成立的关系/经历；缺少原线参考时明确写“原线未知”，不得猜测；
5. 每条内容必须简短、明确，并标出来源章节；quote 只保留确有必要的短句；
6. 对“某人物的当前位置”“两人的当前关系”等会变化的状态，使用稳定 key；同一 type + key 的新事实会原位更新，而不是无限追加旧版本；
7. 只能输出合法 JSON，不输出 Markdown、代码围栏、解释或创作建议。`;

const RELATION_GUIDANCE = Object.freeze({
    [LONG_DREAM_WORLD_LINE_RELATION.ISOLATED]: '完全隔离：原世界书不属于本梦事实，也不用于判断偏离。',
    [LONG_DREAM_WORLD_LINE_RELATION.PARALLEL]: '平行支线：世界背景可参考，原剧情、关系和人物现状不是本梦事实。',
    [LONG_DREAM_WORLD_LINE_RELATION.PREQUEL]: '前传补完：原设定是可能的未来参考；本梦已经造成的变化优先。',
    [LONG_DREAM_WORLD_LINE_RELATION.CANON_CONCURRENT]: '原线同期补完：原重大事件和人物关系默认成立，除非本梦已明确产生偏离。',
    [LONG_DREAM_WORLD_LINE_RELATION.SEQUEL]: '正史后续：原设定视为已经发生的历史；本梦后续变化优先。',
});

function cleanText(value, limit = 0) {
    const text = String(value || '').trim();
    return limit > 0 ? text.slice(0, limit) : text;
}

function boundedText(value, limit, tail = false) {
    const text = cleanText(value);
    if (!limit || text.length <= limit) return text;
    const marker = tail ? '……（前部已省略）\n' : '\n……（其余已省略）';
    const keep = Math.max(0, limit - marker.length);
    return tail ? `${marker}${text.slice(-keep)}` : `${text.slice(0, keep)}${marker}`;
}

function chapterText(chapter = {}) {
    return cleanText(chapter.text);
}

function activeMemoryText(memory = {}) {
    const state = cleanText(memory.currentState);
    const cards = (Array.isArray(memory.cards) ? memory.cards : [])
        .filter(card => card?.status !== 'dismissed')
        .map(card => `- [${cleanText(card.type) || '事实'}${card.key ? `｜${cleanText(card.key)}` : ''}｜来源第 ${(card.sourceChapterNumbers || [card.chapterNumber]).join('、')} 章] ${cleanText(card.content)}`)
        .filter(Boolean)
        .join('\n');
    return [state ? `当前脉象：${state}` : '', cards].filter(Boolean).join('\n');
}

function sourceReferenceText(record = {}) {
    if (record?.inheritance?.worldLineRelation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED) return '';
    const books = Array.isArray(record?.inheritance?.snapshot?.books) ? record.inheritance.snapshot.books : [];
    return books.map(book => {
        const entries = (Array.isArray(book?.entries) ? book.entries : [])
            .map(entry => {
                const content = cleanText(entry?.content);
                if (!content) return '';
                return `- ${cleanText(entry?.name) || '未命名条目'}：${content}`;
            })
            .filter(Boolean)
            .join('\n');
        return entries ? `《${cleanText(book?.name) || '未命名世界书'}》\n${entries}` : '';
    }).filter(Boolean).join('\n\n');
}

export function pendingLongDreamChapters(record = {}) {
    const processed = Math.max(0, Math.floor(Number(record?.memory?.processedThroughChapter) || 0));
    return (Array.isArray(record?.chapters) ? record.chapters : [])
        .filter(chapter => Number(chapter?.number) > processed && chapterText(chapter));
}

export function shouldWeaveLongDreamMemory(record = {}, { batchSize = 3, force = false } = {}) {
    const pending = pendingLongDreamChapters(record);
    if (!pending.length) return false;
    return force || pending.length >= Math.max(1, Math.min(10, Math.floor(Number(batchSize) || 3)));
}

export function buildLongDreamMemoryPayload({
    record = {},
    promptPreset = DEFAULT_LONG_DREAM_MEMORY_PRESET,
    maxExistingMemoryChars = 8000,
    maxSourceReferenceChars = 12000,
} = {}) {
    const pending = pendingLongDreamChapters(record);
    if (!pending.length) throw new Error('没有待织录的已确认章节');
    const relation = record?.inheritance?.worldLineRelation || LONG_DREAM_WORLD_LINE_RELATION.ISOLATED;
    const chapters = pending.map(chapter => `【第 ${chapter.number} 章 · ${cleanText(chapter.title) || `第 ${chapter.number} 章`}】\n${chapterText(chapter)}`).join('\n\n');
    const existing = boundedText(activeMemoryText(record.memory), maxExistingMemoryChars, true);
    const source = boundedText(sourceReferenceText(record), maxSourceReferenceChars);
    const allowedNumbers = pending.map(chapter => Number(chapter.number));
    const userPrompt = [
        `【长梦】${cleanText(record.title) || '未命名长梦'}`,
        `【与原世界线的关系】${RELATION_GUIDANCE[relation] || RELATION_GUIDANCE[LONG_DREAM_WORLD_LINE_RELATION.ISOLATED]}`,
        cleanText(record.canon) ? `【此梦设定｜硬事实】\n${cleanText(record.canon)}` : '【此梦设定】暂无额外硬事实。',
        existing ? `【已有梦脉｜不得无声删除或改写】\n${existing}` : '',
        source ? `【原世界书参考｜权威低于此梦设定和章节】\n${source}` : '',
        `【本次待织录章节】\n${chapters}`,
        `【输出 JSON 结构】
{
  "currentState": "截至第 ${allowedNumbers.at(-1)} 章的当前时间、地点、人物与关系状态，控制在 600 字内",
  "cards": [
    {
      "type": "人物状态|人生经历|关系|世界线偏离|伏笔/约定|地点/物品|事件|关键原话|事实",
      "key": "会变化状态的稳定槽位，例如 林岚/所在地点、林岚与周砚/关系；一次性事件可留空",
      "content": "可核对的简短事实",
      "chapterNumber": ${allowedNumbers.at(-1)},
      "quote": "可选的短原句",
      "tags": ["人物或地点关键词"]
    }
  ]
}
chapterNumber 只能使用本次章节编号：${allowedNumbers.join('、')}。没有新事实时 cards 输出空数组。`,
    ].filter(Boolean).join('\n\n---\n\n');
    return {
        systemPrompt: cleanText(promptPreset) || DEFAULT_LONG_DREAM_MEMORY_PRESET,
        userPrompt,
        pendingChapterNumbers: allowedNumbers,
        throughChapter: allowedNumbers.at(-1),
    };
}

function parseJsonObject(value) {
    const text = reasoningSafeContent(value).trim();
    const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('梦脉织录没有返回 JSON 对象');
    return JSON.parse(unfenced.slice(start, end + 1));
}

export function parseLongDreamMemoryResponse(value, { pendingChapterNumbers = [] } = {}) {
    const data = parseJsonObject(value);
    const allowed = new Set((Array.isArray(pendingChapterNumbers) ? pendingChapterNumbers : []).map(Number));
    const fallbackChapter = [...allowed].at(-1) || 1;
    const cards = (Array.isArray(data.cards) ? data.cards : [])
        .slice(0, 80)
        .map((card, index) => {
            const content = cleanText(card?.content, 1200);
            if (!content) return null;
            const requestedChapter = Math.floor(Number(card?.chapterNumber) || fallbackChapter);
            const chapterNumber = allowed.has(requestedChapter) ? requestedChapter : fallbackChapter;
            const tags = [...new Set((Array.isArray(card?.tags) ? card.tags : [])
                .map(tag => cleanText(tag, 80))
                .filter(Boolean))].slice(0, 20);
            const requestedType = cleanText(card?.type, 60) || '事实';
            const type = LONG_DREAM_MEMORY_TYPES.includes(requestedType) ? requestedType : '事实';
            return {
                id: `memory-${chapterNumber}-${Date.now().toString(36)}-${index + 1}`,
                type,
                key: cleanText(card?.key || card?.subject, 120),
                content,
                chapterId: `chapter-${chapterNumber}`,
                chapterNumber,
                sourceChapterNumbers: [chapterNumber],
                quote: cleanText(card?.quote, 240),
                status: 'active',
                tags,
            };
        })
        .filter(Boolean);
    return {
        currentState: cleanText(data.currentState, 5000),
        cards,
    };
}
