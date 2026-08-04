function safeName(value, fallback) {
    const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return name || fallback;
}

export function buildProtagonistAnchor({ userName = '', charName = '' } = {}) {
    const user = safeName(userName, 'User');
    const char = safeName(charName, 'Char');
    return `【主角锚定】除非本轮用户指令明确要求更换主角，本篇必须以当前 User（${user}）与当前 Char（${char}）为核心；不得把预设、示例对话或世界书中的其他姓名替换为本篇主角。其他角色可按本轮指令作为配角出现。`;
}
