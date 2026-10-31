import { redactRequestTraceText } from './request-trace.js';
import { redactRuntimeSecrets } from './runtime-log.js';

export const MAX_PROMPT_INSPECTIONS = 30;
export const MAX_PROMPT_INSPECTION_CHARS = 20000000;
const purposes = new Set(['creative', 'continuation', 'layout']);
const clean = value => redactRequestTraceText(redactRuntimeSecrets(String(value ?? '')));

export function snapshotPromptMessages(messages = []) {
    return Object.freeze(messages.filter(message => message && typeof message === 'object').map((message, index) => Object.freeze({
        index: index + 1, role: clean(message.role || 'system'),
        ...(message.name ? { name: clean(message.name) } : {}),
        source: clean(message.source || 'request'), sourceId: clean(message.sourceId || `message-${index + 1}`),
        content: clean(typeof message.content === 'string' ? message.content : Array.isArray(message.content)
            ? message.content.map(part => typeof part === 'string' ? part : part?.text || '').join('') : message.content || ''),
    })));
}

export function promptMessageSource(message) {
    const slots = { charDescription: 'Char 描述', charPersonality: 'Char 性格', personaDescription: 'User 人设', scenario: '角色场景', dialogueExamples: '示例对话', worldInfoBefore: '前置世界书', worldInfoAfter: '后置世界书', 'task-preamble': '小剧场任务说明', 'theater-task': '小剧场 · 本次任务' };
    if (slots[message.sourceId]) return slots[message.sourceId];
    const sources = { preset: '预设', 'preset-depth': '预设 · 深度条目', 'chat-history': '聊天背景', 'world-info-depth': '世界书 · 深度条目', 'world-info-author-note': '作者注', 'persona-depth': 'User 人设 · 深度条目', 'character-depth': '角色深度备注', 'fallback-slot': '补充资料', 'squashed-system': '合并后的 system', 'openai-compat': '发送前 · 合并消息', 'post-processing': '预设后处理' };
    return sources[message.source] || (message.source === 'request' ? '请求消息' : message.source);
}

export function createPromptInspectorStore({ maxRequests = MAX_PROMPT_INSPECTIONS, maxChars = MAX_PROMPT_INSPECTION_CHARS, clock = () => new Date().toISOString() } = {}) {
    let entries = [], serial = 0;
    const listeners = new Set();
    const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* inspection must never affect generation */ } } };
    const size = entry => [...entry.assembled, ...(entry.sent || [])].reduce((n, message) => n + message.content.length, 0);
    const prune = () => { while (entries.length > 1 && (entries.length > maxRequests || entries.reduce((n, entry) => n + size(entry), 0) > maxChars)) entries.shift(); };
    return {
        begin({ purpose = 'support', label = '', round = 1, presetName = '', route = '', protocol = '', messages, systemPrompt = '', userPrompt = '' } = {}) {
            if (!purposes.has(purpose)) return null;
            const id = `prompt-${++serial}`;
            const entry = Object.freeze({ id, capturedAt: clock(), purpose, label: clean(label || (purpose === 'layout' ? '最终排版' : purpose === 'continuation' ? '自动补写' : '普通生成')),
                round: Math.max(1, Math.floor(Number(round) || 1)), presetName: clean(presetName), route: clean(route), protocol: clean(protocol), transport: '', attempts: 0,
                assembled: snapshotPromptMessages(Array.isArray(messages) ? messages : [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]), sent: null });
            entries.push(entry); prune(); notify(); return id;
        },
        sent(id, details = {}) {
            const at = entries.findIndex(entry => entry.id === id);
            if (at < 0) return;
            let messages = details.messages || [];
            // These are canonical representations of the actual adapter payload:
            // Anthropic has one top-level system; CCS/custom drop example names.
            if (details.route === 'custom' && details.protocol === 'anthropic') {
                const system = messages.filter(message => message.role === 'system');
                messages = [...(system.length ? [{ role: 'system', content: system.map(message => message.content).join('\n\n'), source: 'protocol-system', sourceId: 'anthropic-system' }] : []), ...messages.filter(message => message.role !== 'system')];
            }
            if (details.route === 'custom' || details.transport === 'ChatCompletionService') messages = messages.map(({ name, ...message }) => message);
            entries[at] = Object.freeze({ ...entries[at], route: clean(details.route || entries[at].route), protocol: clean(details.protocol || entries[at].protocol),
                transport: clean(details.transport || ''), attempts: entries[at].attempts + 1, sent: snapshotPromptMessages(messages) });
            prune(); notify();
        },
        list() { return entries.slice(); },
        get(id) { return entries.find(entry => entry.id === id) || null; },
        clear() { entries = []; notify(); },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
}

export const promptInspectorStore = createPromptInspectorStore();
export function beginPromptInspection(details) { try { return promptInspectorStore.begin(details); } catch { return null; } }
export function recordSentInspection(id, details) { try { promptInspectorStore.sent(id, details); } catch { /* passive capture */ } }

export function inspectionBoundary(record, stage) {
    if (stage === 'assembled') return '插件组装的消息';
    if (!record.sent) return '尚未进入发送接口';
    if (record.route === 'custom') return record.protocol === 'anthropic' ? '独立 API · system 顶层字段与 messages' : '独立 API · 适配后的 messages';
    return record.transport === 'TavernHelper' ? '交给酒馆助手的 ordered_prompts' : '交给酒馆主 API 接口的 messages';
}

export function inspectionExport(record, stage = 'assembled') {
    if (!record) return null;
    const messages = stage === 'sent' ? record.sent : record.assembled;
    if (!messages) return null;
    return { request: { id: record.id, capturedAt: record.capturedAt, label: record.label, round: record.round, purpose: record.purpose,
        presetName: record.presetName, route: record.route, protocol: record.protocol, transport: record.transport, stage, boundary: inspectionBoundary(record, stage), attempts: record.attempts }, messages };
}

export function inspectionText(record, stage = 'assembled') {
    const data = inspectionExport(record, stage);
    return data ? `${data.request.label} · 第 ${data.request.round} 轮\n${data.request.boundary}\n\n` + data.messages.map(message =>
        `[${message.index}] ${message.role}${message.name ? ` (${message.name})` : ''} · ${promptMessageSource(message)}\n${message.content}`).join('\n\n') : '';
}
