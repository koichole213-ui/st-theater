import { LONG_DREAM_WORLD_BOOK_POLICY, LONG_DREAM_WORLD_LINE_RELATION } from './long-dream.js';
import { composePresetMessages } from './request-layout.js';
import { readableCharCount } from './text-counter.js';

function cleanText(value) {
    return String(value || '').trim();
}

function chapterText(chapter = {}) {
    const text = cleanText(chapter.text);
    if (text) return text;
    return cleanText(chapter.html)
        .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>|<\/div>|<\/section>|<\/article>|<\/li>|<\/h[1-6]>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;|&#34;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();
}

function memoryText(cards = []) {
    return (Array.isArray(cards) ? cards : [])
        .map((card, index) => {
            if (typeof card === 'string') return cleanText(card);
            const status = cleanText(card?.status).toLocaleLowerCase();
            if (status && !['active', 'confirmed', 'accepted', '已确认'].includes(status)) return '';
            const title = cleanText(card?.title || card?.type || `记忆 ${index + 1}`);
            const content = cleanText(card?.content || card?.text || card?.summary);
            const slot = cleanText(card?.key);
            const sources = (Array.isArray(card?.sourceChapterNumbers) ? card.sourceChapterNumbers : [card?.chapterNumber])
                .map(Number).filter(Number.isFinite);
            return content ? `${title}${slot ? `｜${slot}` : ''}${sources.length ? `（来源第 ${sources.join('、')} 章）` : ''}：${content}` : '';
        })
        .filter(Boolean)
        .join('\n');
}

function relevanceTerms(value = '') {
    const text = cleanText(value).toLocaleLowerCase();
    const terms = new Set((text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g) || []).slice(0, 80));
    for (const sequence of text.match(/[\u3400-\u9fff]{3,}/g) || []) {
        for (let index = 0; index < sequence.length - 1 && terms.size < 120; index++) {
            terms.add(sequence.slice(index, index + 2));
        }
    }
    return [...terms];
}

export function selectRelevantLongDreamMemoryCards(record = {}, {
    instruction = '',
    recentChapterCount = 4,
    maxCards = 30,
} = {}) {
    const cards = (Array.isArray(record?.memory?.cards) ? record.memory.cards : [])
        .filter(card => card?.status !== 'dismissed');
    if (cards.length <= maxCards) return cards;
    const chapterCount = Array.isArray(record?.chapters) ? record.chapters.length : 0;
    const recentStart = Math.max(1, chapterCount - Math.max(1, recentChapterCount) + 1);
    const query = cleanText(instruction).toLocaleLowerCase();
    const terms = relevanceTerms(instruction);
    const importantTypes = new Set(['人物状态', '关系', '世界线偏离', '伏笔/约定', '地点/物品']);
    return cards.map((card, index) => {
        const haystack = [card.type, card.key, card.content, ...(card.tags || [])].join(' ').toLocaleLowerCase();
        const tagHit = (card.tags || []).some(tag => query.includes(cleanText(tag).toLocaleLowerCase()));
        const keyHit = card.key && (query.includes(cleanText(card.key).toLocaleLowerCase())
            || cleanText(card.key).toLocaleLowerCase().includes(query));
        const termHits = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
        const sources = Array.isArray(card.sourceChapterNumbers) ? card.sourceChapterNumbers : [card.chapterNumber];
        const recent = sources.some(number => Number(number) >= recentStart);
        const score = (card.editedByUser ? 40 : 0)
            + (keyHit ? 24 : 0)
            + (tagHit ? 18 : 0)
            + Math.min(18, termHits * 2)
            + (recent ? 12 : 0)
            + (importantTypes.has(card.type) ? 6 : 0)
            + Math.min(5, Math.max(0, Number(card.chapterNumber) || 0) / Math.max(1, chapterCount) * 5);
        return { card, score, index };
    }).sort((a, b) => b.score - a.score || Number(b.card.chapterNumber) - Number(a.card.chapterNumber) || a.index - b.index)
        .slice(0, Math.max(1, Math.floor(Number(maxCards) || 30)))
        .sort((a, b) => Number(a.card.chapterNumber) - Number(b.card.chapterNumber) || a.index - b.index)
        .map(item => item.card);
}

function v2ItemText(kind, item = {}) {
    const subjects = (item.subjects || []).join('、');
    const sources = (item.sourceChapterNumbers || [item.chapterNumber || item.validFromChapter || item.introducedAt])
        .map(Number).filter(Number.isFinite);
    const source = sources.length ? `（来源第 ${sources.join('、')} 章）` : '';
    if (kind === 'state') {
        return `当前状态｜${subjects}｜${item.attribute}${item.topic ? `｜${item.topic}` : ''}${source}：${item.value}`;
    }
    if (kind === 'transition') {
        return `关键变化｜${item.domain}｜${subjects}${source}：${item.from ? `${item.from} → ` : ''}${item.to || ''}${item.cause ? `；原因：${item.cause}` : ''}${item.impact ? `；长期影响：${item.impact}` : ''}`;
    }
    if (kind === 'thread') {
        const ending = item.status === 'resolved'
            ? `；已经解决：${item.resolution}`
            : (item.status === 'abandoned' ? `；已经放弃：${item.abandonedReason}` : (item.progress ? `；当前进展：${item.progress}` : ''));
        return `事项｜${item.kind}｜${item.status}｜${item.threadKey}${source}：${item.content}${ending}`;
    }
    if (kind === 'deviation') {
        return `世界线偏离｜${item.deviationKey}${source}：原线：${item.originalCanon || '未知'}；本梦改变：${item.dreamChange}；直接后果：${(item.directConsequences || []).join('、') || '暂无'}；失效默认：${(item.invalidatedAssumptions || []).join('、') || '暂无'}`;
    }
    return memoryText([item]);
}

function v2ItemHaystack(kind, item = {}) {
    return [
        kind,
        ...(item.subjects || []),
        item.attribute,
        item.topic,
        item.value,
        item.domain,
        item.from,
        item.to,
        item.cause,
        item.impact,
        item.threadKey,
        item.kind,
        item.content,
        item.progress,
        item.resolution,
        item.deviationKey,
        item.originalCanon,
        item.dreamChange,
        ...(item.directConsequences || []),
        ...(item.invalidatedAssumptions || []),
        ...(item.tags || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function scoreV2Item(kind, item, query, terms, recentStart, chapterCount) {
    const haystack = v2ItemHaystack(kind, item);
    const tags = item.tags || [];
    const tagHit = tags.some(tag => query.includes(cleanText(tag).toLocaleLowerCase()));
    const subjectHit = (item.subjects || []).some(subject => query.includes(cleanText(subject).toLocaleLowerCase()));
    const key = cleanText(item.threadKey || item.deviationKey || item.topic);
    const keyHit = key && (query.includes(key.toLocaleLowerCase()) || key.toLocaleLowerCase().includes(query));
    const termHits = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
    const sources = item.sourceChapterNumbers || [item.chapterNumber || item.validFromChapter || item.lastTouchedAt];
    const recent = sources.some(number => Number(number) >= recentStart);
    const newest = Math.max(0, ...sources.map(Number).filter(Number.isFinite));
    const layer = kind === 'state' ? 12 : (kind === 'thread' && ['open', 'progressed'].includes(item.status) ? 10 : (kind === 'deviation' ? 7 : 5));
    const closedPenalty = kind === 'thread' && ['resolved', 'abandoned'].includes(item.status) && !keyHit && !tagHit && !subjectHit ? -30 : 0;
    return (item.editedByUser ? 40 : 0)
        + (item.lockedByUser ? 25 : 0)
        + (keyHit ? 24 : 0)
        + (subjectHit ? 20 : 0)
        + (tagHit ? 18 : 0)
        + Math.min(18, termHits * 2)
        + (recent ? 12 : 0)
        + layer
        + Math.min(5, newest / Math.max(1, chapterCount) * 5)
        + closedPenalty;
}

export function selectRelevantLongDreamMemoryItems(record = {}, {
    instruction = '',
    recentChapterCount = 4,
    maxItems = 30,
    quotas = { state: 12, thread: 8, deviation: 5, transition: 5 },
} = {}) {
    const memory = record?.memory || {};
    const legacySeen = new Set();
    const legacy = [...(memory.legacyCards || []), ...(memory.cards || [])]
        .filter(item => item?.status !== 'dismissed')
        .filter(item => {
            const key = `${item?.id || ''}\u0000${item?.content || ''}`;
            if (legacySeen.has(key)) return false;
            legacySeen.add(key);
            return true;
        });
    const raw = [
        ...(memory.states || []).filter(item => !item.hiddenFromPrompt).map(item => ({ kind: 'state', item })),
        ...(memory.threads || []).filter(item => !item.hiddenFromPrompt).map(item => ({ kind: 'thread', item })),
        ...(memory.deviations || []).filter(item => !item.hiddenFromPrompt).map(item => ({ kind: 'deviation', item })),
        ...(memory.transitions || []).filter(item => !item.hiddenFromPrompt).map(item => ({ kind: 'transition', item })),
        ...legacy.map(item => ({ kind: 'legacy', item })),
    ];
    if (!raw.length) return [];
    const chapterCount = Array.isArray(record?.chapters) ? record.chapters.length : 0;
    const recentStart = Math.max(1, chapterCount - Math.max(1, recentChapterCount) + 1);
    const query = cleanText(instruction).toLocaleLowerCase();
    const terms = relevanceTerms(instruction);
    const scored = raw.map((entry, index) => ({
        ...entry,
        index,
        text: v2ItemText(entry.kind, entry.item),
        score: scoreV2Item(entry.kind, entry.item, query, terms, recentStart, chapterCount),
    })).sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = [];
    const selectedIds = new Set();
    for (const kind of ['state', 'thread', 'deviation', 'transition']) {
        const limit = Math.max(0, Math.floor(Number(quotas[kind]) || 0));
        for (const entry of scored.filter(candidate => candidate.kind === kind).slice(0, limit)) {
            selected.push(entry);
            selectedIds.add(`${kind}:${entry.item.id}`);
        }
    }
    const target = Math.max(1, Math.floor(Number(maxItems) || 30));
    for (const entry of scored) {
        if (selected.length >= target) break;
        const id = `${entry.kind}:${entry.item.id}`;
        if (selectedIds.has(id)) continue;
        selected.push(entry);
        selectedIds.add(id);
    }
    for (const entry of scored.filter(candidate => candidate.kind === 'legacy')) {
        if (selectedIds.has(`legacy:${entry.item.id}`) || entry.score <= 5 || selected.length < target) continue;
        const replaceIndex = selected.reduce((lowest, candidate, index) => candidate.score < selected[lowest].score ? index : lowest, 0);
        if (entry.score <= selected[replaceIndex].score) continue;
        selectedIds.delete(`${selected[replaceIndex].kind}:${selected[replaceIndex].item.id}`);
        selected[replaceIndex] = entry;
        selectedIds.add(`legacy:${entry.item.id}`);
    }
    return selected.slice(0, target).sort((a, b) => {
        const order = { state: 0, thread: 1, deviation: 2, transition: 3, legacy: 4 };
        return order[a.kind] - order[b.kind] || b.score - a.score || a.index - b.index;
    });
}

export function longDreamWorldBookContext(record = {}) {
    if (record?.inheritance?.worldBookPolicy !== LONG_DREAM_WORLD_BOOK_POLICY.SELECTED) return '';
    const books = Array.isArray(record?.inheritance?.snapshot?.books)
        ? record.inheritance.snapshot.books
        : [];
    return books.map(book => {
        const entries = (Array.isArray(book?.entries) ? book.entries : [])
            .map((entry, index) => {
                const content = cleanText(entry?.content);
                if (!content) return '';
                const name = cleanText(entry?.name) || `条目 ${index + 1}`;
                return `- ${name}：${content}`;
            })
            .filter(Boolean)
            .join('\n');
        return entries ? `《${cleanText(book?.name) || '未命名世界书'}》\n${entries}` : '';
    }).filter(Boolean).join('\n\n');
}

export function longDreamWorldBookEntries(record = {}) {
    if (record?.inheritance?.worldBookPolicy !== LONG_DREAM_WORLD_BOOK_POLICY.SELECTED) return [];
    const books = Array.isArray(record?.inheritance?.snapshot?.books)
        ? record.inheritance.snapshot.books
        : [];
    return books.flatMap((book, bookIndex) => (Array.isArray(book?.entries) ? book.entries : [])
        .map((entry, entryIndex) => ({
            ...entry,
            content: cleanText(entry?.content),
            sourceId: `long-dream-world-book-${bookIndex + 1}-${entry?.uid ?? entryIndex + 1}`,
        }))
        .filter(entry => entry.content));
}

export function longDreamChapterContext(record = {}, {
    instruction = '',
    recentChapterCount = 4,
    maxMemoryCards = 30,
    maxOlderOutlineChars = 12000,
} = {}) {
    const allChapters = Array.isArray(record.chapters) ? record.chapters : [];
    const keepRecent = Math.max(1, Math.floor(Number(recentChapterCount) || 4));
    const recentChapters = allChapters.slice(-keepRecent);
    const olderChapters = allChapters.slice(0, Math.max(0, allChapters.length - recentChapters.length));
    const chapters = recentChapters
        .map((chapter, index) => {
            const text = chapterText(chapter);
            if (!text) return '';
            const number = Number(chapter.number) || olderChapters.length + index + 1;
            return `【第 ${number} 章 · ${cleanText(chapter.title) || `第 ${number} 章`}】\n${text}`;
        })
        .filter(Boolean)
        .join('\n\n');
    const olderOutlineItems = olderChapters.map(chapter => {
        const text = chapterText(chapter);
        const excerpt = text.length > 180 ? `${text.slice(0, 90)}……${text.slice(-90)}` : text;
        return `- 第 ${chapter.number} 章《${cleanText(chapter.title) || `第 ${chapter.number} 章`}》${chapter.instruction ? `；原方向：${cleanText(chapter.instruction).slice(0, 100)}` : ''}${excerpt ? `；首尾摘记：${excerpt}` : ''}`;
    });
    const outlineLimit = Math.max(1000, Math.floor(Number(maxOlderOutlineChars) || 12000));
    let olderOutline = olderOutlineItems.join('\n');
    if (olderOutline.length > outlineLimit) {
        const first = olderOutlineItems[0] || '';
        const marker = '- ……（更早章节索引已压缩；连续事实以梦脉为准）';
        const tail = [];
        let used = first.length + marker.length + 2;
        for (let index = olderOutlineItems.length - 1; index > 0; index--) {
            const item = olderOutlineItems[index];
            if (used + item.length + 1 > outlineLimit) break;
            tail.unshift(item);
            used += item.length + 1;
        }
        olderOutline = [first, marker, ...tail].filter(Boolean).join('\n');
    }
    const currentState = cleanText(record?.memory?.currentState);
    const selectedItems = selectRelevantLongDreamMemoryItems(record, {
        instruction,
        recentChapterCount: keepRecent,
        maxItems: maxMemoryCards,
    });
    const cards = selectedItems.map(entry => entry.text).filter(Boolean).join('\n');
    const v2Count = ['states', 'transitions', 'threads', 'deviations']
        .reduce((count, key) => count + (record?.memory?.[key] || []).filter(item => !item.hiddenFromPrompt).length, 0);
    const legacyCount = (record?.memory?.cards || []).filter(card => card?.status !== 'dismissed').length;
    return {
        canon: cleanText(record.canon),
        chapters,
        olderOutline,
        memory: [currentState ? `当前脉象：${currentState}` : '', cards].filter(Boolean).join('\n'),
        selectedMemoryCount: selectedItems.length,
        selectedMemoryItems: selectedItems,
        activeMemoryCount: v2Count + legacyCount,
        worldBook: longDreamWorldBookContext(record),
        worldLineRelation: record?.inheritance?.worldLineRelation || LONG_DREAM_WORLD_LINE_RELATION.ISOLATED,
        chapterCount: allChapters.length,
        recentChapterCount: recentChapters.length,
        olderChapterCount: olderChapters.length,
    };
}

function worldLineRelationInstruction(relation) {
    if (relation === LONG_DREAM_WORLD_LINE_RELATION.PARALLEL) {
        return '本梦是平行支线：冻结世界书只提供世界背景与人物素材；其中的原剧情、关系、年龄和人物现状不是本梦事实。';
    }
    if (relation === LONG_DREAM_WORLD_LINE_RELATION.PREQUEL) {
        return '本梦是前传补完：冻结世界书中的原设定属于可能的未来参考；本梦已经写出的变化优先，不能为了回归原线而抹掉变化。';
    }
    if (relation === LONG_DREAM_WORLD_LINE_RELATION.CANON_CONCURRENT) {
        return '本梦是原线同期补完：冻结世界书中的重大事件和人物关系默认成立，但此梦设定、已保存章节和梦脉中明确产生的偏离优先。';
    }
    if (relation === LONG_DREAM_WORLD_LINE_RELATION.SEQUEL) {
        return '本梦是正史后续：冻结世界书属于已经发生的历史；后续仍以此梦设定、已保存章节和梦脉中的最新状态为准。';
    }
    return '本梦与原世界书完全隔离；不得猜测、恢复或注入原世界线。';
}

function takeBudgeted(value, state, key, { keepTail = false } = {}) {
    const text = cleanText(value);
    if (!text) return '';
    if (!Number.isFinite(state.remaining)) {
        state.included.push(key);
        return text;
    }
    if (state.remaining <= 0) {
        state.omitted.push(key);
        return '';
    }
    if (text.length <= state.remaining) {
        state.remaining -= text.length;
        state.included.push(key);
        return text;
    }
    const marker = keepTail ? '……（较早内容已按上下文预算截断）\n' : '\n……（已按上下文预算截断）';
    const keep = Math.max(0, state.remaining - marker.length);
    state.remaining = 0;
    state.truncated.push(key);
    return keepTail ? `${marker}${keep ? text.slice(-keep) : ''}` : `${text.slice(0, keep)}${marker}`;
}

function continuationTail(value, maxChars = 4000) {
    const text = cleanText(value);
    const limit = Math.max(1000, Math.floor(Number(maxChars) || 4000));
    if (text.length <= limit) return text;
    return `……（同章较早正文已省略，只保留结尾继续）\n${text.slice(-limit)}`;
}

export function buildLongDreamChapterPayload({
    record = {},
    preset = '',
    addons = '',
    instruction = '',
    chapterTitle = '',
    targetChars = 3000,
    currentDraft = '',
    finishThisRound = true,
    maxOptionalContextChars = Infinity,
    structuredPreset = false,
    continuationRound = false,
    continuationTailChars = 4000,
    hasIdentityContext = false,
    protagonistAnchor = '',
} = {}) {
    const direction = cleanText(instruction) || '自然承接上一章尚未解决的动作、情绪与伏笔。';
    const context = longDreamChapterContext(record, { instruction: direction });
    if (!context.chapters) throw new Error('长梦缺少可续写的已保存章节');
    const target = Math.max(500, Math.min(8000, Math.round(Number(targetChars) || 3000)));
    const draft = cleanText(currentDraft);
    const draftChars = readableCharCount(draft);
    const remainingChars = Math.max(0, target - draftChars);
    const title = cleanText(chapterTitle) || `第 ${context.chapterCount + 1} 章`;
    const requestedBudget = Number(maxOptionalContextChars);
    const budget = Number.isFinite(requestedBudget) && requestedBudget >= 0 ? Math.floor(requestedBudget) : Infinity;
    const budgetState = { remaining: budget, included: [], truncated: [], omitted: [] };

    // 预算只裁剪可替代上下文。用户本章方向、定梦和输出协议永远完整保留。
    const draftForPrompt = continuationRound ? continuationTail(draft, continuationTailChars) : draft;
    const current = takeBudgeted(draftForPrompt, budgetState, 'currentDraft', { keepTail: true });
    const chapters = continuationRound ? '' : takeBudgeted(context.chapters, budgetState, 'chapters', { keepTail: true });
    const memory = takeBudgeted(context.memory, budgetState, 'memory');
    const olderOutline = continuationRound ? '' : takeBudgeted(context.olderOutline, budgetState, 'olderChapterOutline');
    // 用户明确勾选并冻结的条目属于基础资料，不再由程序二次触发或按可选预算裁掉。
    const worldInfoEntries = structuredPreset ? longDreamWorldBookEntries(record) : [];
    if (worldInfoEntries.length) budgetState.included.push('worldBookSnapshot');
    const worldBook = structuredPreset
        ? worldInfoEntries.map(entry => entry.content).join('\n\n')
        : takeBudgeted(context.worldBook, budgetState, 'worldBookSnapshot');
    const style = takeBudgeted([
        structuredPreset ? '' : cleanText(preset),
        cleanText(addons),
    ].filter(Boolean).join('\n\n'), budgetState, 'style');

    const systemPrompt = [
        '你正在续写一部长篇支线故事。你只能依据用户已经确认的此梦世界线、这部长卷自身的章节与已确认梦脉继续创作；不得读取、猜测或恢复原聊天前文、普通续写缓存及未提供的世界书设定。此梦设定是不可静默推翻的硬事实；若本章方向与它冲突，应停止创作并明确指出冲突。',
        worldLineRelationInstruction(context.worldLineRelation),
        hasIdentityContext ? '【人物继承规则】角色卡与 User 人设用于保持人物身份、核心性格、说话方式和行为倾向；其中若含有与此梦设定或已保存章节冲突的原世界线事实，以此梦设定和本卷已经发生的内容为准。' : '',
        cleanText(protagonistAnchor),
        style ? `【写作风格｜只控制表达，不得改写事实】\n${style}` : '',
    ].filter(Boolean).join('\n\n');
    const sections = [
        `【本章方向｜用户本次明确要求】\n章名：${title}\n创作方向：${direction}\n${draft
            ? `目标是本章完整正文约 ${target} 字；本章已有约 ${draftChars} 字，本轮只补写为接近总目标仍需新增的内容（约 ${remainingChars} 字，可随情节自然浮动），不要报告或标注字数。`
            : `目标正文约 ${target} 字；不需要自行统计、报告或标注字数。`}`,
        context.canon ? `【此梦设定｜用户已确认的持续硬事实】\n${context.canon}` : '【此梦设定】\n暂无额外设定；以已保存章节中已经成立的事实为准。',
        chapters
            ? `【近期已保存章节｜最近 ${context.recentChapterCount} 章全文，只作前情不得复述】\n${chapters}`
            : (continuationRound
                ? '【同章补写】\n本轮承接下方本章已有正文继续创作；不再重复发送整部长卷前情。人物身份、此梦设定、梦脉和冻结资料仍然有效。'
                : '【近期已保存章节】\n受本次上下文预算限制，未附带章节原文；不得自行补入其他世界线。'),
        olderOutline ? `【较早章节压缩索引｜${context.olderChapterCount} 章】\n${olderOutline}` : '',
        current ? `【本章可恢复草稿｜只承接结尾，不得重复】\n${current}` : '',
        memory ? `【已确认梦脉｜辅助核对，不得覆盖原章节】\n${memory}` : '',
        worldBook
            ? (structuredPreset
                ? '【用户主动允许的冻结世界书快照】\n已按所选预设的位置、深度与角色注入；其权威级别低于此梦设定与已保存章节。'
                : `【用户主动允许的冻结世界书快照｜仅作低于定梦与章节的参考】\n${worldBook}`)
            : `【世界书继承】\n${record?.inheritance?.worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED
                ? '这部长卷没有可用的冻结快照，本次不得读取或补入当前酒馆世界书。'
                : '本长卷与原世界书隔离，不得读取或自行补入原世界线设定。'}`,
        `【输出协议】\n1. 只输出本章新增的纯正文，不输出标题、HTML、CSS、JavaScript、Markdown 代码块或创作说明；\n2. 不复述、改写或总结已保存章节${current ? '及本章已有正文' : ''}；\n3. 延续既有视角、时态、人物语气、叙事质感与因果；\n4. 用新的动作、对白、心理变化和情节推进承接上一章；\n5. ${finishThisRound ? '本轮可以在本章情节充分展开后自然收束，但不要结束整部长卷。' : '本轮继续充分推进本章，不要为了提前结束而仓促总结或收束；若内容已经充分达到目标，可以自然形成章末，但不要结束整部长卷。'}`,
    ].filter(Boolean);
    return {
        systemPrompt,
        userPrompt: sections.join('\n\n---\n\n'),
        worldInfoEntries,
        context,
        targetChars: target,
        budget: {
            maxOptionalContextChars: budget,
            remaining: budgetState.remaining,
            included: budgetState.included,
            truncated: budgetState.truncated,
            omitted: budgetState.omitted,
        },
        continuationRound,
    };
}

export function buildLongDreamChapterMessages({
    payload,
    presetEntries = [],
    slots = {},
    squashSystemMessages = false,
} = {}) {
    if (!payload?.systemPrompt || !payload?.userPrompt) {
        throw new Error('长梦结构化消息缺少请求载荷');
    }
    return composePresetMessages({
        presetEntries,
        slots: {
            charDescription: String(slots.charDescription || ''),
            charPersonality: String(slots.charPersonality || ''),
            scenario: String(slots.scenario || ''),
            personaDescription: String(slots.personaDescription || ''),
            dialogueExamples: String(slots.dialogueExamples || ''),
        },
        worldInfoEntries: payload.worldInfoEntries || [],
        chatMessages: [{
            role: 'user',
            content: payload.userPrompt,
            source: 'long-dream',
            sourceId: 'chapter-context',
        }],
        tailMessages: [{
            role: 'system',
            content: payload.systemPrompt,
            source: 'long-dream',
            sourceId: 'continuity-rules',
        }],
        squashSystemMessages,
    });
}
