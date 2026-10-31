import { promptInspectorStore, promptMessageSource, inspectionBoundary, inspectionExport, inspectionText, MAX_PROMPT_INSPECTIONS } from './prompt-inspector.js';

export function promptInspectorHTML() {
    return `<details class="theater-section theater-prompt-inspector" data-theater-prompt-inspector open>
        <summary><span>完整提示词查看器</span></summary><div class="theater-pi-body">
        <div class="theater-pi-selects"><div class="theater-pi-field"><label for="theater-pi-request">选择请求</label><select id="theater-pi-request" class="theater-input" data-pi-request><option value="">暂无请求记录</option></select></div>
        <div class="theater-pi-field"><label>查看阶段</label><div class="theater-pi-segmented" role="group" aria-label="查看阶段"><button type="button" class="active" data-pi-stage="assembled" aria-pressed="true">组装消息</button><button type="button" data-pi-stage="sent" aria-pressed="false">发送前</button></div></div></div>
        <div class="theater-pi-meta" data-pi-meta></div><div class="theater-pi-tools"><button type="button" data-pi-action="toggle">全部展开</button><button type="button" class="theater-pi-export" data-pi-action="export" aria-label="导出 JSON" title="导出 JSON">⇩</button></div>
        <div class="theater-pi-search-row"><input class="theater-input" type="search" data-pi-search placeholder="搜索提示词内容或来源…" aria-label="搜索提示词"><button type="button" class="primary" data-pi-action="copy">复制全文</button></div>
        <p class="theater-pi-count" data-pi-count></p><div class="theater-pi-messages" data-pi-messages></div>
        <p class="theater-pi-notice">刷新后提示词将清空 · 仅保留最近 ${MAX_PROMPT_INSPECTIONS} 个请求 · 复制与导出会包含人物、世界书及聊天资料</p><p class="theater-pi-status" data-pi-status role="status"></p>
        </div></details>`;
}

const bindings = new WeakMap();
export function refreshPromptInspector(doc = globalThis.document) { bindings.get(doc)?.refresh(); }

export function bindPromptInspector({ document: doc = globalThis.document, copyToClipboard, downloadTextContent, store = promptInspectorStore } = {}) {
    if (!doc?.addEventListener || !doc.querySelector) return;
    if (bindings.has(doc)) { bindings.get(doc).refresh(); return bindings.get(doc); }
    let selected = '', stage = 'assembled', opened = new Set(), lastLatest = '';
    const rootFor = () => doc.querySelector('[data-theater-prompt-inspector]');
    const make = (tag, cls, content) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (content !== undefined) node.textContent = content; return node; };
    const status = (value, root = rootFor()) => { if (root) root.querySelector('[data-pi-status]').textContent = value; };
    const current = () => store.get(selected);
    const currentMessages = () => { const record = current(); return record ? stage === 'sent' ? record.sent || [] : record.assembled : []; };
    const syncToggle = root => { const messages = currentMessages(); root.querySelector('[data-pi-action="toggle"]').textContent = messages.length && messages.every(message => opened.has(message.index)) ? '全部收起' : '全部展开'; };
    const fillBody = (details, message) => {
        if (details.querySelector('.theater-pi-content-wrap')) return;
        const wrap = make('div', 'theater-pi-content-wrap');
        wrap.append(make('pre', 'theater-pi-content', message.content));
        const copy = make('button', 'theater-pi-inline-copy', '复制'); copy.type = 'button'; copy.dataset.piAction = 'copy-message'; copy.dataset.piIndex = String(message.index);
        wrap.append(copy); details.append(wrap);
    };
    const renderMessages = root => {
        const q = root.querySelector('[data-pi-search]').value.trim().toLowerCase();
        const messages = currentMessages();
        const visible = messages.filter(message => `${message.content} ${promptMessageSource(message)} ${message.sourceId} ${message.role}`.toLowerCase().includes(q));
        root.querySelector('[data-pi-count]').textContent = q ? `显示 ${visible.length} / ${messages.length} 条（保留原编号）` : '';
        const list = root.querySelector('[data-pi-messages]'); list.replaceChildren();
        if (!visible.length) list.append(make('p', 'theater-pi-empty', messages.length ? '没有匹配的消息' : current() && stage === 'sent' ? '此请求尚未进入发送接口。' : '生成一次小剧场后，可在这里查看本页会话的请求。'));
        for (const message of visible) {
            const d = make('details', 'theater-pi-message'); d.dataset.piMessage = String(message.index); d.open = opened.has(message.index);
            const summary = make('summary');
            for (const [cls, value] of [['theater-pi-number', String(message.index).padStart(2, '0')], [`theater-pi-role ${message.role}`, message.role], ['theater-pi-source', promptMessageSource(message)], ['theater-pi-size', `${message.content.length} 字符`]]) summary.append(make('span', cls, value));
            summary.title = [message.source, message.sourceId, message.name].filter(Boolean).join(' · ');
            d.append(summary); if (d.open) fillBody(d, message); list.append(d);
        }
        syncToggle(root);
    };
    const refresh = () => {
        const root = rootFor(); if (!root) return;
        const records = store.list(); const latest = records.at(-1)?.id || '';
        const isNewRoot = !root.dataset.piReady;
        if (isNewRoot || !store.get(selected) || selected === lastLatest && latest !== lastLatest) { selected = latest; opened = new Set(); }
        root.dataset.piReady = 'true'; lastLatest = latest;
        const select = root.querySelector('[data-pi-request]'); select.replaceChildren();
        if (!records.length) { const option = make('option', '', '暂无请求记录'); option.value = ''; select.append(option); }
        for (const record of records.slice().reverse()) {
            const roundLabel = record.purpose === 'layout' ? (record.round > 1 ? ` · 第 ${record.round} 次排版` : '') : ` · 第 ${record.round} 轮`;
            const option = make('option', '', `${record.label}${roundLabel} · ${new Date(record.capturedAt).toLocaleTimeString('zh-CN', { hour12: false })}${record.attempts > 1 ? ` · 发送尝试 ${record.attempts}` : ''}`);
            option.value = record.id; select.append(option);
        }
        select.value = selected;
        const record = current();
        for (const button of root.querySelectorAll('[data-pi-stage]')) { button.classList.toggle('active', button.dataset.piStage === stage); button.setAttribute('aria-pressed', String(button.dataset.piStage === stage)); }
        const meta = root.querySelector('[data-pi-meta]'); meta.replaceChildren();
        if (record) {
            const protocol = { openai: 'OpenAI', anthropic: 'Anthropic' }[record.protocol] || record.protocol || '待识别';
            const labels = [`${record.purpose === 'layout' ? '用途' : '预设'}：${record.purpose === 'layout' ? '最终排版' : record.presetName || '内置默认预设'}`, `${protocol} · ${record.route === 'main' ? '主 API' : '独立 API'}`, `${currentMessages().length} 条消息`];
            if (stage === 'sent') labels.push(inspectionBoundary(record, stage));
            for (const label of labels) meta.append(make('span', 'theater-pi-pill', label));
        }
        for (const button of root.querySelectorAll('[data-pi-action]')) button.disabled = !record || stage === 'sent' && !record.sent;
        renderMessages(root);
    };
    const onChange = event => { if (!event.target.closest?.('[data-theater-prompt-inspector]')) return; if (event.target.matches('[data-pi-request]')) { selected = event.target.value; opened.clear(); status(''); refresh(); } };
    const onInput = event => { if (event.target.matches?.('[data-pi-search]')) { const root = event.target.closest('[data-theater-prompt-inspector]'); if (root) renderMessages(root); } };
    const onToggle = event => {
        if (!event.target.matches?.('[data-pi-message]') || !event.target.closest('[data-theater-prompt-inspector]')) return;
        const index = Number(event.target.dataset.piMessage); const message = currentMessages().find(message => message.index === index);
        if (!message) return;
        if (event.target.open) { opened.add(index); fillBody(event.target, message); } else opened.delete(index);
        syncToggle(event.target.closest('[data-theater-prompt-inspector]'));
    };
    const onClick = async event => {
        const button = event.target.closest?.('[data-pi-action], [data-pi-stage]');
        const root = button?.closest('[data-theater-prompt-inspector]'); if (!root || button.disabled) return;
        if (button.dataset.piStage) { stage = button.dataset.piStage; opened.clear(); status(''); refresh(); return; }
        if (button.dataset.piAction === 'toggle') { const messages = currentMessages(); opened = messages.every(message => opened.has(message.index)) ? new Set() : new Set(messages.map(message => message.index)); renderMessages(root); return; }
        const record = current(); if (!record) return;
        if (button.dataset.piAction === 'export') {
            const data = inspectionExport(record, stage); if (!data) return;
            downloadTextContent?.(JSON.stringify(data, null, 2), `千夜浮梦-提示词-${record.id}-${stage}.json`, '已发起下载'); status('已发起 JSON 下载。'); return;
        }
        const value = button.dataset.piAction === 'copy-message' ? currentMessages().find(message => message.index === Number(button.dataset.piIndex))?.content : inspectionText(record, stage);
        if (value === undefined) return;
        try { const ok = await copyToClipboard?.(value, { requireVerification: true, manualTitle: '复制完整提示词', downloadName: '千夜浮梦-提示词.txt' }); if (ok !== false) status('复制操作已完成。'); }
        catch { status('复制未完成，可使用 JSON 导出。'); }
    };
    doc.addEventListener('change', onChange); doc.addEventListener('input', onInput); doc.addEventListener('click', onClick); doc.addEventListener('toggle', onToggle, true);
    const unsubscribe = store.subscribe(refresh);
    const binding = { refresh, destroy() { unsubscribe(); doc.removeEventListener('change', onChange); doc.removeEventListener('input', onInput); doc.removeEventListener('click', onClick); doc.removeEventListener('toggle', onToggle, true); bindings.delete(doc); } };
    bindings.set(doc, binding); refresh(); return binding;
}
