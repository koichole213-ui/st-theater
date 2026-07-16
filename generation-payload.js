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
    const userPrompt = [role, persona, worldBook, context, continuation, rules, fixed, instruction]
        .filter(Boolean).join('\n\n---\n\n');
    return {
        systemPrompt,
        userPrompt,
        tokenParts: { preset, role: role + persona, worldBook, context, continuation, rules: rules + fixed + addons, instruction },
    };
}

export function buildContinuationInstruction({ originalInstruction, targetChars, actualChars, round, maxRounds, tail, finishThisRound }) {
    const remaining = Math.max(0, targetChars - actualChars);
    return `这是同一篇小剧场的第 ${round} 次续写。

原始要求：${originalInstruction}
目标总字数：约 ${targetChars} 字
当前累计：约 ${actualChars} 字
距离目标还差：约 ${remaining} 字

上一段结尾：
${tail}

请直接承接上一段结尾继续正文：
1. 不要复述、改写或总结已经发生的内容；
2. 保持相同人物语气、视角、时态和叙事风格；
3. 只输出新增正文片段，不要输出前文、HTML、CSS、JavaScript或标题；
4. 目标总字数是应尽量写满的正文篇幅，不是可以提前收尾的上限。本轮尽量补足约 ${remaining} 字，允许为了自然完成而略微超出，但不要用复述、空话或重复情节凑字数；
5. ${finishThisRound
        ? '这是最后一轮自动补写：必须优先写足剩余篇幅，达到或略微超过目标后再自然收束，不要因为轮次将尽而提前结尾。'
        : '继续展开有效情节；在累计正文达到目标字数前，不要总结、收束或写出明显的终章式结尾。'}`;
}
