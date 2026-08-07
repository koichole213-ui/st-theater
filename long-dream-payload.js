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
            return content ? `${title}：${content}` : '';
        })
        .filter(Boolean)
        .join('\n');
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

export function longDreamChapterContext(record = {}) {
    const chapters = (Array.isArray(record.chapters) ? record.chapters : [])
        .map((chapter, index) => {
            const text = chapterText(chapter);
            if (!text) return '';
            return `【第 ${index + 1} 章 · ${cleanText(chapter.title) || `第 ${index + 1} 章`}】\n${text}`;
        })
        .filter(Boolean)
        .join('\n\n');
    const currentState = cleanText(record?.memory?.currentState);
    const cards = memoryText(record?.memory?.cards);
    return {
        canon: cleanText(record.canon),
        chapters,
        memory: [currentState ? `当前脉象：${currentState}` : '', cards].filter(Boolean).join('\n'),
        worldBook: longDreamWorldBookContext(record),
        worldLineRelation: record?.inheritance?.worldLineRelation || LONG_DREAM_WORLD_LINE_RELATION.ISOLATED,
        chapterCount: Array.isArray(record.chapters) ? record.chapters.length : 0,
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

function takeBudgetedEntries(entries, state, key) {
    const source = (Array.isArray(entries) ? entries : []).filter(entry => cleanText(entry?.content));
    if (!source.length) return [];
    if (!Number.isFinite(state.remaining)) {
        state.included.push(key);
        return source;
    }
    if (state.remaining <= 0) {
        state.omitted.push(key);
        return [];
    }
    const result = [];
    for (const entry of source) {
        const content = cleanText(entry.content);
        if (content.length <= state.remaining) {
            result.push({ ...entry, content });
            state.remaining -= content.length;
            continue;
        }
        const marker = '\n……（已按上下文预算截断）';
        const keep = Math.max(0, state.remaining - marker.length);
        if (keep) result.push({ ...entry, content: `${content.slice(0, keep)}${marker}` });
        state.remaining = 0;
        state.truncated.push(key);
        return result;
    }
    state.included.push(key);
    return result;
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
} = {}) {
    const context = longDreamChapterContext(record);
    if (!context.chapters) throw new Error('长梦缺少可续写的已保存章节');
    const target = Math.max(500, Math.min(8000, Math.round(Number(targetChars) || 3000)));
    const draft = cleanText(currentDraft);
    const draftChars = readableCharCount(draft);
    const remainingChars = Math.max(0, target - draftChars);
    const direction = cleanText(instruction) || '自然承接上一章尚未解决的动作、情绪与伏笔。';
    const title = cleanText(chapterTitle) || `第 ${context.chapterCount + 1} 章`;
    const requestedBudget = Number(maxOptionalContextChars);
    const budget = Number.isFinite(requestedBudget) && requestedBudget >= 0 ? Math.floor(requestedBudget) : Infinity;
    const budgetState = { remaining: budget, included: [], truncated: [], omitted: [] };

    // 预算只裁剪可替代上下文。用户本章方向、定梦和输出协议永远完整保留。
    const current = takeBudgeted(draft, budgetState, 'currentDraft', { keepTail: true });
    const chapters = takeBudgeted(context.chapters, budgetState, 'chapters', { keepTail: true });
    const memory = takeBudgeted(context.memory, budgetState, 'memory');
    const worldInfoEntries = structuredPreset
        ? takeBudgetedEntries(longDreamWorldBookEntries(record), budgetState, 'worldBookSnapshot')
        : [];
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
        style ? `【写作风格｜只控制表达，不得改写事实】\n${style}` : '',
    ].filter(Boolean).join('\n\n');
    const sections = [
        `【本章方向｜用户本次明确要求】\n章名：${title}\n创作方向：${direction}\n${draft
            ? `目标是本章完整正文约 ${target} 字；本章已有约 ${draftChars} 字，本轮只补写为接近总目标仍需新增的内容（约 ${remainingChars} 字，可随情节自然浮动），不要报告或标注字数。`
            : `目标正文约 ${target} 字；不需要自行统计、报告或标注字数。`}`,
        context.canon ? `【此梦设定｜用户已确认的持续硬事实】\n${context.canon}` : '【此梦设定】\n暂无额外设定；以已保存章节中已经成立的事实为准。',
        chapters ? `【已保存章节｜只作前情，不得复述】\n${chapters}` : '【已保存章节】\n受本次上下文预算限制，未附带章节原文；不得自行补入其他世界线。',
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
    };
}

export function buildLongDreamChapterMessages({
    payload,
    presetEntries = [],
    squashSystemMessages = false,
} = {}) {
    if (!payload?.systemPrompt || !payload?.userPrompt) {
        throw new Error('长梦结构化消息缺少请求载荷');
    }
    return composePresetMessages({
        presetEntries,
        slots: {
            charDescription: '',
            charPersonality: '',
            scenario: '',
            personaDescription: '',
            dialogueExamples: '',
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
