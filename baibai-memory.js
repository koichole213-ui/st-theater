import { normalizeContextRange } from './context-policy.js';

export const BAIBAI_MEMORY_HINTS = Object.freeze({
    disabled: '',
    ready: '补充当前聊天的剧情摘要、人物、物品与计划状态。',
    empty: '当前聊天暂无可读取的记忆。',
    missing: '未检测到柏宝书，安装后即可读取。',
    outdated: '当前柏宝书版本不支持读取，请更新后重试。',
    partial: '部分楼层尚无摘要，本次只能读取已有记忆。',
    'no-chat': '请先打开需要读取记忆的聊天。',
    'chat-changed': '聊天或记忆正在切换，请稍后重试。',
    error: '柏宝书记忆读取失败，本次未加入记忆。',
});

const meaningful = value => value != null && (typeof value === 'string' ? !!value.trim()
    : typeof value === 'object' ? Object.values(value).some(meaningful) : true);

export function baiBaiChatId(ctx = {}) {
    return String(ctx.getCurrentChatId?.() ?? ctx.chatId ?? '');
}

// API v1 DTOs are read-only copies. Never inspect plugin internals or trigger
// summarization/recall; a disabled option must not even access the global API.
export function readBaiBaiMemory({ settings = {}, ctx = {}, api } = {}) {
    const result = (status, extra = {}) => ({ status, content: '', before: 0, missingFloors: 0, ...extra });
    if (settings.readBaiBaiMemory !== true) return result('disabled');
    try {
        const id = baiBaiChatId(ctx);
        const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
        if (!id) return result('no-chat');
        api ??= globalThis.STBaiBaiBook;
        if (!api) return result('missing');
        if (api.apiVersion !== 1 || typeof api.getHistory !== 'function' || typeof api.getSnapshot !== 'function') return result('outdated');
        const recentCount = settings.readChatContext === false ? 0 : Math.min(chat.length, normalizeContextRange(settings.contextRange));
        const before = chat.length - recentCount;
        const history = api.getHistory({ before });
        const snapshot = api.getSnapshot();
        const groupId = String(ctx.groupId ?? '');
        if ([history, snapshot].some(dto => dto?.apiVersion !== 1 || !dto.coverage || typeof dto.coverage.complete !== 'boolean'
            || !Array.isArray(dto.coverage.missingAiFloors))) return result('outdated');
        if ([history, snapshot].some(dto => dto.chat?.id !== id || dto.chat?.length !== chat.length || String(dto.chat?.groupId ?? '') !== groupId)
            || history.before !== before || snapshot.point?.upToExclusive !== chat.length || history.revision !== snapshot.revision) return result('chat-changed');
        // getHistory's relative dates are anchored before the cutoff, whereas
        // the state below is current. Absolute dates avoid a shifted "yesterday".
        const historyText = typeof history.text === 'string' ? history.text.trim() : '';
        // Only the agreed story resources are sent. Custom vars, logs, plugin
        // configuration, identifiers and other DTO metadata stay out of prompts.
        const state = Object.fromEntries(['state', 'protagonist', 'npcs', 'items', 'plans']
            .filter(key => meaningful(snapshot[key])).map(key => [key, snapshot[key]]));
        const missing = new Set([...history.coverage.missingAiFloors, ...snapshot.coverage.missingAiFloors]);
        const incomplete = history.coverage.complete === false || snapshot.coverage.complete === false;
        const blocks = [historyText ? `【近期原文之前的剧情摘要】\n${historyText}` : '',
            Object.keys(state).length ? `【当前人物、物品与计划状态】\n${JSON.stringify(state)}` : ''].filter(Boolean);
        const status = incomplete ? 'partial' : blocks.length ? 'ready' : 'empty';
        return result(status, {
            before, missingFloors: missing.size,
            content: blocks.length ? ['【柏宝书记忆｜当前聊天的背景资料】',
                '以下是原聊天的已有记录，仅作本篇背景参考；与近期原文、本篇已发生内容或本次指令冲突时，以后者为准。',
                incomplete ? '部分楼层尚无摘要，以下记录并非完整历史。' : '', ...blocks, '【柏宝书记忆结束】'].filter(Boolean).join('\n\n') : '',
        });
    } catch {
        // Error strings from another plugin may contain private data.
        return result('error');
    }
}
