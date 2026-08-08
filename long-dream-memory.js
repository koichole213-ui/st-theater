import { LONG_DREAM_MEMORY_TYPES, LONG_DREAM_WORLD_LINE_RELATION } from './long-dream.js';
import {
    LONG_DREAM_MEMORY_OPERATION_TYPES,
    normalizeLongDreamMemoryOperation,
} from './long-dream-memory-model.js';
import { reasoningSafeContent } from './reasoning-filter.js';

const FIXED_LONG_DREAM_MEMORY_RULES = `你负责“梦脉增量织录”：阅读已经确认保存的新章节，对照已有梦脉，只提取本批章节造成的连续性变化。

你的职责不是重新总结整部故事，而是判断：哪些当前状态发生了改变，哪些关键变化值得长期保留，哪些未完事项被建立、推进、解决或明确放弃，以及是否产生世界线偏离。

不可修改的规则：
1. 不续写、不润色、不补全空白，不把猜测、可能性或常识当成章节事实；
2. 只依据此梦设定、已有梦脉、允许使用的冻结世界书参考和本批已保存章节；此梦设定与已保存章节高于梦脉，梦脉高于冻结世界书；
3. 只输出本批章节带来的新增或变化，不重复输出没有变化的旧记忆；
4. 当前仍成立的地点、伤势、身份、知情、物品归属、关系、行动和目标使用 set_state；更新已有记录时优先使用它的 targetId；
5. 会长期影响人物性格、关系、选择或后续因果的变化使用 append_transition；普通动作和日常流水账不得记录；
6. 伏笔、约定、秘密、谜团、任务和威胁使用 open_thread、advance_thread、resolve_thread 或 abandon_thread 管理；更新请求中已经列出的事项必须使用 targetId；只有引用本批 operations 中刚刚 open_thread、尚无 id 的事项时才使用完全相同的 threadKey；长时间没有提及不等于解决或放弃；
7. 关系正式改变时，通常同时更新当前关系状态并记录一次关系变化；
8. 完全隔离模式不得生成世界线偏离；其他模式仅在原线事实确有参考时使用 upsert_deviation，不得猜测原线；
9. 不得删除、隐藏、否定或覆盖用户锁定的记忆；发现冲突时仍可提出操作，但不得自行解决；
10. chapterNumber 只能使用本批章节编号；quote 只保留能直接证明事实的必要短句；
11. currentState 是只读阅读摘要，用自然语言概括时间、地点、在场核心人物、当前关系、正在推进的局面与仍影响行动的重要状态，不超过 600 字；
12. 只能输出合法 JSON，不输出 Markdown、代码围栏、解释、分析或创作建议。`;

export const LEGACY_DEFAULT_LONG_DREAM_MEMORY_PRESET = `你负责“梦脉织录”：只从已经确认保存的章节中提取可核对的连续性事实。

规则：
1. 不续写、不润色、不替故事补全空白，不把推测写成事实；
2. 只记录会影响后续连载的人物状态、人生经历、关系、世界线偏离、伏笔/约定、地点/物品、事件与关键原话；
3. 此梦设定和已保存章节高于原世界书参考；发现冲突时记录“世界线偏离”，不能把原设定覆盖回来；
4. “世界线偏离”必须在 content 中依次写清：原线事实 → 本梦改变 → 直接结果 → 此后不能再默认成立的关系/经历；缺少原线参考时明确写“原线未知”，不得猜测；
5. 每条内容必须简短、明确，并标出来源章节；quote 只保留确有必要的短句；
6. 对“某人物的当前位置”“两人的当前关系”等会变化的状态，使用稳定 key；同一 type + key 的新事实会原位更新，而不是无限追加旧版本；
7. 只能输出合法 JSON，不输出 Markdown、代码围栏、解释或创作建议。`;

export const DEFAULT_LONG_DREAM_MEMORY_PRESET = `判断一项内容是否值得进入长期梦脉时，优先保留人物当前状态、人物弧光、关系转折、仍未结束的因果，以及会改变后续默认前提的世界线偏离。普通动作、气氛描写和不影响后文的日常细节不进入梦脉。`;

const RELATION_GUIDANCE = Object.freeze({
    [LONG_DREAM_WORLD_LINE_RELATION.ISOLATED]: '完全隔离：原世界书不属于本梦事实，也不用于判断偏离；不得输出 upsert_deviation。',
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

function memorySources(item = {}) {
    const values = item.sourceChapterNumbers || [item.chapterNumber || item.validFromChapter || item.introducedAt];
    return (Array.isArray(values) ? values : []).filter(Boolean).join('、') || '?';
}

function activeMemoryText(memory = {}) {
    const sections = [];
    const state = cleanText(memory.currentState);
    if (state) sections.push(`【当前脉象｜只读摘要】\n${state}`);

    const states = (Array.isArray(memory.states) ? memory.states : [])
        .filter(item => !item.hiddenFromPrompt)
        .map(item => `- [id=${cleanText(item.id)}｜${(item.subjects || []).join('、')}｜${cleanText(item.attribute)}${item.topic ? `｜${cleanText(item.topic)}` : ''}｜从第 ${item.validFromChapter} 章起${item.lockedByUser ? '｜用户锁定' : ''}] ${cleanText(item.value)}`)
        .join('\n');
    if (states) sections.push(`【已有当前状态】\n${states}`);

    const transitions = (Array.isArray(memory.transitions) ? memory.transitions : [])
        .filter(item => !item.hiddenFromPrompt)
        .map(item => `- [id=${cleanText(item.id)}｜${cleanText(item.domain)}｜来源第 ${memorySources(item)} 章${item.lockedByUser ? '｜用户锁定' : ''}] ${(item.subjects || []).join('、')}：${cleanText(item.from)} → ${cleanText(item.to)}；原因：${cleanText(item.cause)}${item.impact ? `；长期影响：${cleanText(item.impact)}` : ''}`)
        .join('\n');
    if (transitions) sections.push(`【已有关键变化】\n${transitions}`);

    const threads = (Array.isArray(memory.threads) ? memory.threads : [])
        .filter(item => !item.hiddenFromPrompt)
        .map(item => `- [id=${cleanText(item.id)}｜${cleanText(item.kind)}｜${cleanText(item.status)}｜初见第 ${item.introducedAt} 章｜最近第 ${item.lastTouchedAt} 章${item.lockedByUser ? '｜用户锁定' : ''}] ${cleanText(item.threadKey)}：${cleanText(item.content)}${item.progress ? `；当前进展：${cleanText(item.progress)}` : ''}${item.resolution ? `；解决：${cleanText(item.resolution)}` : ''}${item.abandonedReason ? `；放弃原因：${cleanText(item.abandonedReason)}` : ''}`)
        .join('\n');
    if (threads) sections.push(`【已有未完事项及生命周期】\n${threads}`);

    const deviations = (Array.isArray(memory.deviations) ? memory.deviations : [])
        .filter(item => !item.hiddenFromPrompt)
        .map(item => `- [id=${cleanText(item.id)}｜${cleanText(item.deviationKey)}｜来源第 ${memorySources(item)} 章${item.lockedByUser ? '｜用户锁定' : ''}] 原线：${cleanText(item.originalCanon) || '未知'}；本梦：${cleanText(item.dreamChange)}；后果：${(item.directConsequences || []).join('；') || '暂无'}；失效默认：${(item.invalidatedAssumptions || []).join('；') || '暂无'}`)
        .join('\n');
    if (deviations) sections.push(`【已有世界线偏离】\n${deviations}`);

    const legacyCards = [
        ...(Array.isArray(memory.legacyCards) ? memory.legacyCards : []),
        ...(Array.isArray(memory.cards) ? memory.cards : []),
    ];
    const seen = new Set();
    const legacy = legacyCards
        .filter(card => card?.status !== 'dismissed')
        .filter(card => {
            const key = `${card?.id || ''}\u0000${card?.content || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(card => `- [${cleanText(card.type) || '旧版记忆'}${card.key ? `｜${cleanText(card.key)}` : ''}｜来源第 ${memorySources(card)} 章] ${cleanText(card.content)}`)
        .filter(Boolean)
        .join('\n');
    if (legacy) sections.push(`【旧版兼容梦脉｜不得丢弃】\n${legacy}`);

    const rejections = (Array.isArray(memory.rejections) ? memory.rejections : [])
        .map(item => `- [${cleanText(item.kind)}] ${cleanText(item.signature)}${item.reason ? `；原因：${cleanText(item.reason)}` : ''}`)
        .join('\n');
    if (rejections) sections.push(`【用户否定的错误记忆｜不得重新添加】\n${rejections}`);
    return sections.join('\n\n');
}

function sourceReferenceText(record = {}) {
    if (record?.inheritance?.worldLineRelation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED) return '';
    const books = Array.isArray(record?.inheritance?.snapshot?.books) ? record.inheritance.snapshot.books : [];
    return books.map(book => {
        const entries = (Array.isArray(book?.entries) ? book.entries : [])
            .map(entry => {
                const content = cleanText(entry?.content);
                return content ? `- ${cleanText(entry?.name) || '未命名条目'}：${content}` : '';
            }).filter(Boolean).join('\n');
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
    return pending.length > 0 && (force || pending.length >= Math.max(1, Math.min(10, Math.floor(Number(batchSize) || 3))));
}

function outputContract(allowedNumbers) {
    const last = allowedNumbers.at(-1);
    return `【固定 JSON 输出合同｜字段名和操作名不可修改】
{
  "currentState": "截至第 ${last} 章的最新只读当前脉象，不超过600字",
  "operations": [
    { "op": "set_state", "targetId": "更新已有状态时填写其 id；新建留空", "subjects": ["主体"], "attribute": "location|physical_condition|relationship|knowledge|identity|possession|condition|ongoing_action|goal|other", "topic": "同类状态的具体主题，可空", "value": "当前值", "chapterNumber": ${last}, "quote": "", "tags": [] },
    { "op": "append_transition", "domain": "character|relationship|identity|experience|world", "subjects": ["主体"], "from": "变化前", "to": "变化后", "cause": "原因", "impact": "长期影响", "chapterNumber": ${last}, "quote": "", "tags": [] },
    { "op": "open_thread", "threadKey": "新事项稳定名称", "kind": "foreshadow|promise|mystery|secret|task|threat", "subjects": [], "content": "事项内容", "progress": "可空", "chapterNumber": ${last}, "quote": "", "tags": [] },
    { "op": "advance_thread", "targetId": "已有事项 id；同批刚新建时留空", "threadKey": "仅同批刚新建时填写完全相同的名称", "progress": "本章新进展", "chapterNumber": ${last}, "quote": "", "tags": [] },
    { "op": "resolve_thread", "targetId": "已有事项 id；同批刚新建时留空", "threadKey": "仅同批刚新建时填写完全相同的名称", "resolution": "明确解决结果", "chapterNumber": ${last}, "quote": "", "tags": [] },
    { "op": "abandon_thread", "targetId": "已有事项 id；同批刚新建时留空", "threadKey": "仅同批刚新建时填写完全相同的名称", "reason": "章节明确写出的取消或失效原因", "chapterNumber": ${last}, "quote": "", "tags": [] },
    { "op": "upsert_deviation", "targetId": "更新已有偏离时填写其 id；新建留空", "deviationKey": "稳定名称", "subjects": [], "originalCanon": "原线事实", "dreamChange": "本梦改变", "directConsequences": [], "invalidatedAssumptions": [], "chapterNumber": ${last}, "quote": "", "tags": [] }
  ]
}
chapterNumber 只能使用本次章节编号：${allowedNumbers.join('、')}。没有新变化时 operations 输出空数组，但仍返回最新 currentState。不得输出 ${['delete', 'reject', 'hide', 'unlock', 'overwrite_user_edit'].join('、')}。`;
}

export function buildLongDreamMemoryPayload({
    record = {},
    promptPreset = DEFAULT_LONG_DREAM_MEMORY_PRESET,
    maxExistingMemoryChars = 16000,
    maxSourceReferenceChars = 12000,
} = {}) {
    const pending = pendingLongDreamChapters(record);
    if (!pending.length) throw new Error('没有待织录的已确认章节');
    const relation = record?.inheritance?.worldLineRelation || LONG_DREAM_WORLD_LINE_RELATION.ISOLATED;
    const chapters = pending.map(chapter => `【第 ${chapter.number} 章 · ${cleanText(chapter.title) || `第 ${chapter.number} 章`}】\n${chapterText(chapter)}`).join('\n\n');
    const existing = boundedText(activeMemoryText(record.memory), maxExistingMemoryChars, true);
    const source = boundedText(sourceReferenceText(record), maxSourceReferenceChars);
    const allowedNumbers = pending.map(chapter => Number(chapter.number));
    const focus = cleanText(promptPreset) || DEFAULT_LONG_DREAM_MEMORY_PRESET;
    const userPrompt = [
        `【长梦】${cleanText(record.title) || '未命名长梦'}`,
        `【与原世界线的关系】${RELATION_GUIDANCE[relation] || RELATION_GUIDANCE[LONG_DREAM_WORLD_LINE_RELATION.ISOLATED]}`,
        cleanText(record.canon) ? `【此梦设定｜硬事实】\n${cleanText(record.canon)}` : '【此梦设定】暂无额外硬事实。',
        existing || '【已有梦脉】尚无结构化梦脉。',
        source ? `【原世界书参考｜权威低于此梦设定和章节】\n${source}` : '',
        `【本次待织录章节】\n${chapters}`,
        outputContract(allowedNumbers),
    ].filter(Boolean).join('\n\n---\n\n');
    return {
        systemPrompt: `${FIXED_LONG_DREAM_MEMORY_RULES}\n\n【可编辑的分析侧重点】\n${focus}`,
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

function parseLegacyCards(data, pendingChapterNumbers) {
    const allowed = new Set((Array.isArray(pendingChapterNumbers) ? pendingChapterNumbers : []).map(Number));
    const fallbackChapter = [...allowed].at(-1) || 1;
    return (Array.isArray(data.cards) ? data.cards : []).slice(0, 80).map((card, index) => {
        const content = cleanText(card?.content, 1200);
        if (!content) return null;
        const requestedChapter = Math.floor(Number(card?.chapterNumber) || fallbackChapter);
        const chapterNumber = allowed.has(requestedChapter) ? requestedChapter : fallbackChapter;
        const requestedType = cleanText(card?.type, 60) || '事实';
        return {
            id: `memory-${chapterNumber}-${Date.now().toString(36)}-${index + 1}`,
            type: LONG_DREAM_MEMORY_TYPES.includes(requestedType) ? requestedType : '事实',
            key: cleanText(card?.key || card?.subject, 120),
            content,
            chapterId: `chapter-${chapterNumber}`,
            chapterNumber,
            sourceChapterNumbers: [chapterNumber],
            quote: cleanText(card?.quote, 240),
            status: 'active',
            tags: [...new Set((Array.isArray(card?.tags) ? card.tags : []).map(tag => cleanText(tag, 80)).filter(Boolean))].slice(0, 20),
        };
    }).filter(Boolean);
}

export function parseLongDreamMemoryResponse(value, { pendingChapterNumbers = [] } = {}) {
    const data = parseJsonObject(value);
    if (!Array.isArray(data.operations) && Array.isArray(data.cards)) {
        return {
            currentState: cleanText(data.currentState, 5000),
            cards: parseLegacyCards(data, pendingChapterNumbers),
            legacyResponse: true,
        };
    }
    const rawOperations = Array.isArray(data.operations) ? data.operations.slice(0, 120) : [];
    const allowedChapters = new Set((Array.isArray(pendingChapterNumbers) ? pendingChapterNumbers : []).map(Number));
    const correctedChapterCount = rawOperations.filter(operation => !allowedChapters.has(Math.floor(Number(operation?.chapterNumber)))).length;
    const operations = rawOperations
        .map(operation => normalizeLongDreamMemoryOperation(operation, { pendingChapterNumbers }))
        .filter(Boolean);
    return {
        currentState: cleanText(data.currentState, 5000),
        operations,
        invalidOperationCount: rawOperations.length - operations.length,
        correctedChapterCount,
        operationTypes: [...new Set(operations.map(operation => operation.op).filter(type => LONG_DREAM_MEMORY_OPERATION_TYPES.includes(type)))],
    };
}
