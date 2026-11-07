import { MAX_CONTEXT_MESSAGES, normalizeContextRange } from './context-policy.js';
import { BAIBAI_MEMORY_HINTS, readBaiBaiMemory } from './baibai-memory.js';

export function chatContextSettingsHTML(settings = {}, ctx = {}) {
    const enabled = settings.readBaiBaiMemory === true;
    const memory = readBaiBaiMemory({ settings, ctx });
    const warning = !['ready', 'empty', 'disabled'].includes(memory.status);
    return `<div class="theater-section theater-context-reading">
        <label class="theater-label"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> 聊天前文</label>
        <div class="context-choice">
            <label class="theater-toggle-label"><input type="checkbox" id="theater-read-chat-context" ${settings.readChatContext !== false ? 'checked' : ''}><span>近期消息</span></label>
            <div id="theater-context-range-row" class="theater-context-count-control${settings.readChatContext === false ? ' is-disabled' : ''}">
                <span class="theater-context-count-label">最近</span>
                <input id="theater-context-range" type="number" min="0" max="${MAX_CONTEXT_MESSAGES}" step="1" inputmode="numeric" value="${normalizeContextRange(settings.contextRange)}" class="theater-input theater-number-input theater-context-number" aria-label="读取最近多少条消息" title="0 至 ${MAX_CONTEXT_MESSAGES} 条；填 0 不读取近期消息" ${settings.readChatContext === false ? 'disabled' : ''}>
                <span class="theater-context-count-unit">条</span>
            </div>
        </div>
        <div class="context-memory">
            <div class="context-choice"><label class="theater-toggle-label"><input type="checkbox" id="theater-read-baibai-memory" aria-describedby="theater-baibai-status" ${enabled ? 'checked' : ''}><span>读取柏宝书记忆</span></label></div>
            <p id="theater-baibai-status" class="context-memory-hint" role="status" data-warning="${warning}" ${enabled ? '' : 'hidden'}>${BAIBAI_MEMORY_HINTS[memory.status]}</p>
        </div>
    </div>`;
}

export function refreshBaiBaiMemoryStatus(settings, ctx, root = globalThis.document) {
    const hint = root?.querySelector?.('#theater-baibai-status');
    if (!hint) return;
    const memory = readBaiBaiMemory({ settings, ctx });
    hint.hidden = settings.readBaiBaiMemory !== true;
    hint.textContent = BAIBAI_MEMORY_HINTS[memory.status];
    hint.dataset.warning = String(!['ready', 'empty', 'disabled'].includes(memory.status));
}

export function bindBaiBaiMemoryUpdates({ getSettings, getContext, scheduleTokenEstimate, eventTarget = globalThis.window } = {}) {
    const refresh = () => {
        const settings = getSettings();
        refreshBaiBaiMemoryStatus(settings, getContext());
        if (settings.readBaiBaiMemory === true) scheduleTokenEstimate();
    };
    const events = ['st-baibai-book:ready', 'st-baibai-book:changed'];
    events.forEach(name => eventTarget?.addEventListener(name, refresh));
    return () => events.forEach(name => eventTarget?.removeEventListener(name, refresh));
}
