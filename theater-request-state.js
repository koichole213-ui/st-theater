// theater-request-state: receives live state and cross-feature callbacks from index.js.
import { classifyRequestFailure } from './request-diagnostics.js';
import { markFailed } from './request-metrics.js';

export function createTheaterRequestState(runtime) {
// @theater-source-begin recordRequestMetrics
function recordRequestMetrics(metrics) {
    if (!metrics || metrics._recorded) return;
    metrics._recorded = true;
    runtime.requestMetricsLog.unshift(metrics);
    if (runtime.requestMetricsLog.length > 5) runtime.requestMetricsLog.length = 5;
}
// @theater-source-end recordRequestMetrics

// @theater-source-begin captureRequestIssue
function captureRequestIssue(error, { stage = '正文生成' } = {}) {
    const issue = classifyRequestFailure(error, { stage });
    runtime.lastRequestIssue = issue;
    markFailed(runtime.lastRequestMetrics, issue.signal);
    recordRequestMetrics(runtime.lastRequestMetrics);
    return issue;
}
// @theater-source-end captureRequestIssue

// @theater-source-begin clearRequestIssue
function clearRequestIssue() {
    runtime.lastRequestIssue = null;
}
// @theater-source-end clearRequestIssue

// @theater-source-begin requestFailureMessage
function requestFailureMessage(prefix, issue, { retained = false } = {}) {
    return `${prefix}：${issue.signal}\n\n请打开【诊断】查看“常见问题汇总”中的 ${issue.signal}。${retained ? '\n\n已保留此前已生成的正文。' : ''}`;
}
// @theater-source-end requestFailureMessage

// @theater-source-begin countSnapshotEntries
function countSnapshotEntries(snapshot) {
    return (snapshot?.books || []).reduce((total, book) => total + (Array.isArray(book?.entries) ? book.entries.length : 0), 0);
}
// @theater-source-end countSnapshotEntries

// @theater-source-begin formatRequestContextSummary
function formatRequestContextSummary(context) {
    if (!context) return '暂无插件请求摘要；本次无法判断实际组合输入。';
    if (context.kind === '模型列表') return '模型列表 · 只请求 API 的模型清单，不携带创作指令、聊天前文、角色卡或世界书。';
    if (context.kind === '连接测试') return '连接测试 · 只发送固定短测试语句，不携带创作指令、聊天前文、角色卡或世界书。';
    if (context.kind === 'AI 定梦建议') {
        return `AI 定梦建议 · 只读取所选第一章正文（约 ${context.sourceChars || 0} 字）· 不读取聊天前文或世界书 · 返回内容仅为待用户逐项确认的临时草稿。`;
    }
    if (context.kind === '长梦正文') {
        return `长梦正文 · 创作预设：${context.presetSource} · Char：${context.character ? '已参与' : '未读取'} · User 人设：${context.persona ? '已参与' : '未读取'} · 已保存章节：${context.chapterCount} · 本章检索梦脉：${context.memoryCount}/${context.activeMemoryCount ?? context.memoryCount} · 冻结世界书：${context.worldBookBooks} 本/${context.worldBookEntries} 条 · 聊天前文：不读取 · 文风补充：${context.styleAddon ? '已参与' : '未参与'} · NSFW 补充：${context.nsfwAddon ? '已参与' : '未参与'}`;
    }
    if (context.kind === '最终 HTML 排版') {
        return `最终 HTML 排版 · 来源正文约 ${context.sourceChars} 字 · 模板：${context.renderLabel || '当前模板'} · 原始指令：${context.designBrief ? '仅作为设计意图参与' : '不读取'} · 不携带聊天前文、角色卡或世界书。`;
    }
    return `${context.kind || '普通小剧场'} · 创作预设：${context.presetSource} · 聊天前文：${context.readChatContext ? `已参与 ${context.chatMessages} 条（设置 ${context.contextRange} 条）` : '不读取'} · 角色设定：${context.character ? '已参与' : '未参与'} · User 人设：${context.persona ? '已参与' : '未参与'} · 世界书：${context.worldBookBooks} 本/${context.worldBookEntries} 条 · 文风补充：${context.styleAddon ? '已参与' : '未参与'} · NSFW 补充：${context.nsfwAddon ? '已参与' : '未参与'}${context.continuation ? ' · 普通续写前情：已参与' : ''}`;
}
// @theater-source-end formatRequestContextSummary

return { recordRequestMetrics, captureRequestIssue, clearRequestIssue, requestFailureMessage, countSnapshotEntries, formatRequestContextSummary };
}
