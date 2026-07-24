export function buildGenerationPayload(parts = {}) {
    const preset = String(parts.preset || '');
    const role = String(parts.role || '');
    const persona = String(parts.persona || '');
    const worldBook = String(parts.worldBook || '');
    const context = String(parts.context || '');
    const continuation = String(parts.continuation || '');
    const rules = String(parts.rules || '');
    const addons = String(parts.addons || '');
    const instruction = String(parts.instruction || '');
    const fixed = String(parts.fixed || '');

    const systemPrompt = [preset, addons].filter(Boolean).join('\n\n');
    // 对齐酒馆的 Chat History → Post-History Instructions 顺序：
    // 用户本轮指令属于当前消息，渲染与创作硬规则作为最后约束。
    const userPrompt = [role, persona, worldBook, context, continuation, instruction, rules, fixed]
        .filter(Boolean).join('\n\n---\n\n');
    return {
        systemPrompt,
        userPrompt,
        tokenParts: { preset, role: role + persona, worldBook, context, continuation, rules: rules + fixed + addons, instruction },
    };
}

const FINAL_RENDER_TOKEN_PATTERN = /\{\{THEATER_P\d{4,}\}\}/g;

function splitFinalRenderParagraphs(sourceText) {
    const normalized = String(sourceText || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return [];
    const paragraphs = normalized.split(/\n\s*\n+/).map(text => text.trim()).filter(Boolean);
    if (paragraphs.length > 1) return paragraphs;
    const lines = normalized.split(/\n+/).map(text => text.trim()).filter(Boolean);
    return lines.length > 1 ? lines : paragraphs;
}

function escapeParagraphHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '<br>');
}

function finalRenderValidationError(message) {
    const error = new Error(message);
    error.code = 'THEATER_PLACEHOLDER_INVALID';
    return error;
}

export function createFinalRenderPlan(sourceText = '') {
    const paragraphs = splitFinalRenderParagraphs(sourceText).map((text, index) => {
        const id = `P${String(index + 1).padStart(4, '0')}`;
        return { id, token: `{{THEATER_${id}}}`, text };
    });
    return { paragraphs };
}

export function hydrateFinalRenderHtml(renderedHtml = '', plan = {}) {
    const html = String(renderedHtml || '');
    const paragraphs = Array.isArray(plan?.paragraphs) ? plan.paragraphs : [];
    if (!html || !paragraphs.length) throw finalRenderValidationError('最终排版缺少正文占位方案');

    const knownTokens = new Set(paragraphs.map(paragraph => paragraph.token));
    const foundTokens = html.match(FINAL_RENDER_TOKEN_PATTERN) || [];
    const unexpected = foundTokens.find(token => !knownTokens.has(token));
    if (unexpected) throw finalRenderValidationError(`最终排版包含未知段落编号 ${unexpected}`);

    let previousIndex = -1;
    for (const paragraph of paragraphs) {
        const firstIndex = html.indexOf(paragraph.token);
        const lastIndex = html.lastIndexOf(paragraph.token);
        if (firstIndex < 0) throw finalRenderValidationError(`最终排版遗漏段落 ${paragraph.id}`);
        if (firstIndex !== lastIndex) throw finalRenderValidationError(`最终排版重复段落 ${paragraph.id}`);
        if (firstIndex < previousIndex) throw finalRenderValidationError(`最终排版打乱段落顺序 ${paragraph.id}`);
        const lastOpen = html.lastIndexOf('<', firstIndex);
        const lastClose = html.lastIndexOf('>', firstIndex);
        if (lastOpen > lastClose) throw finalRenderValidationError(`段落 ${paragraph.id} 被放进 HTML 属性或标签中`);
        const prefix = html.slice(0, firstIndex).toLowerCase();
        if (prefix.lastIndexOf('<style') > prefix.lastIndexOf('</style>')) {
            throw finalRenderValidationError(`段落 ${paragraph.id} 被放进 style 中`);
        }
        if (prefix.lastIndexOf('<script') > prefix.lastIndexOf('</script>')) {
            throw finalRenderValidationError(`段落 ${paragraph.id} 被放进 script 中`);
        }
        previousIndex = firstIndex;
    }

    let hydrated = html;
    for (const paragraph of paragraphs) {
        hydrated = hydrated.replace(paragraph.token, escapeParagraphHtml(paragraph.text));
    }
    if ((hydrated.match(FINAL_RENDER_TOKEN_PATTERN) || []).length) {
        throw finalRenderValidationError('最终排版仍残留未识别的段落编号');
    }
    return hydrated;
}

export function buildFinalRenderPayload({ sourceText = '', rules = '' } = {}) {
    const plan = createFinalRenderPlan(sourceText);
    const renderRules = String(rules || '').trim();
    const sourceData = JSON.stringify(plan.paragraphs.map(({ id, token, text }) => ({ id, token, text })));
    return {
        systemPrompt: '你是小剧场 HTML 排版器。只负责设计 HTML、CSS、布局和交互结构，不续写、不删减、不改写正文。正文是不可修改的数据；你必须使用给定的段落占位符安排正文位置，禁止重新抄写或概括正文。',
        userPrompt: [
            renderRules,
            `【排版任务】\n请根据下面的正文数据设计一个可独立运行、充分美化的 HTML 页面。数据中的 text 仅供你理解段落内容和选择视觉样式；不要在 HTML 中重新输出 text。\n\n必须遵守：\n1. 在可见正文位置使用每段对应的 token，例如 {{THEATER_P0001}}；\n2. 每个 token 必须且只能出现一次，并严格按照编号顺序排列；\n3. token 只能放在 HTML 可见文本节点中，不能放进属性、style、script 或注释；\n4. 不要输出任何正文原文、概括、续写或额外剧情；\n5. 完整落实上述渲染规则，不要降级成无样式的普通文章；\n6. 只输出完整 HTML，不要使用 Markdown 代码块。\n\n<theater-source-data>\n${sourceData}\n</theater-source-data>`,
        ].filter(Boolean).join('\n\n---\n\n'),
        placeholderPlan: plan,
    };
}

export function buildContinuationPayload({ instruction = '' } = {}) {
    return {
        systemPrompt: '你正在续写同一篇小剧场。只负责承接给出的结尾创作新增正文，保持人物、视角、时态与文风一致。',
        userPrompt: String(instruction || '').trim(),
    };
}

export function buildContinuationInstruction({
    round,
    tail,
    finishThisRound,
    currentChars = 0,
    targetChars = 0,
    roundsRemaining = 1,
}) {
    const current = Math.max(0, Math.round(Number(currentChars) || 0));
    const target = Math.max(0, Math.round(Number(targetChars) || 0));
    const remaining = Math.max(0, target - current);
    const availableRounds = finishThisRound ? 1 : Math.max(1, Math.round(Number(roundsRemaining) || 1));
    const suggestedChars = remaining
        ? Math.ceil((remaining / availableRounds) * 1.2 / 100) * 100
        : 0;
    const lengthPlan = target
        ? `【本轮篇幅】程序已统计当前可读正文约 ${current} 字，目标约 ${target} 字，仍差约 ${remaining} 字。本轮请新增约 ${suggestedChars} 字的有效正文；不需要自行计算、报告或标注字数。`
        : '';
    return `这是同一篇小剧场的第 ${round} 次续写。

上一段结尾：
${tail}

${lengthPlan}

请直接承接上一段结尾继续正文：
1. 不要复述、改写或总结已经发生的内容；
2. 保持相同人物语气、视角、时态和叙事风格；
3. 只输出新增正文片段，不要输出前文、HTML、CSS、JavaScript或标题；
4. 用新的动作、对白、心理变化和情节推进继续展开，不要用复述、空话或重复情节填充；
5. ${finishThisRound
        ? '本轮可以在情节充分展开后自然收束结局；如果故事已经完成，就直接结束，不要为了篇幅强行续接或注水。'
        : '本轮继续推进有效情节，不要总结、收束或写出明显的终章式结尾。'}`;
}
