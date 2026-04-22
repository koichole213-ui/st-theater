// Theater Generator v1.5.0

const MODULE_NAME = 'theater_generator';
const VERSION = '1.5.0';

const DEFAULT_RENDER_TEMPLATE = `小剧场输出规范：
请输出一个完整的、可独立运行的HTML页面。要求如下：
1. 布局：单个居中容器（max-width: 480px），body背景transparent，内容区圆角卡片
2. 样式：简洁现代，无衬线字体，柔和配色，卡片带轻微阴影
3. 角色对话：不同背景色区分角色，角色名加粗
4. 旁白/叙述：斜体或不同颜色
5. 响应式，适配手机。不引用外部资源。使用简体中文
6. 输出完整HTML文档（DOCTYPE→html→head+style→body+内容）
输出格式：直接输出完整HTML代码，不要用markdown代码块包裹。`;

const INTERACTIVE_ADDON = `
额外要求 - 交互模式：
- 必须包含可交互元素（按钮、选择、切换、展开收起等）
- 使用JavaScript实现交互逻辑
- 可点击元素有:active缩放反馈
- 可包含选项分支、隐藏内容、角色回复切换、小游戏等`;

// 精简模式下用的 system prompt（不把正文那一堆预设带进来）
const MINIMAL_SYSTEM_PROMPT = '你是创意写作助手，擅长根据角色设定和剧情上下文生成生动有趣的小剧场/番外。严格按照用户提供的渲染规则输出完整的 HTML 页面。不要输出 HTML 之外的任何说明文字。';

// 单条世界书内容长度软限制（字符数），超过会截断，避免拼出超长 prompt 导致 524
const WB_ENTRY_SOFT_LIMIT = 1200;

// ============================================================
let settings = {};
const defaultSettings = Object.freeze({
    contextRange: 10,
    instructionTemplates: [],
    renderTemplates: [],
    customSystemPrompt: '',
    // 'minimal' 精简 | 'selected' 从当前预设勾选条目 | 'custom' 自定义
    presetMode: 'minimal',
    // { [identifier]: true }  —— 在 selected 模式下生效
    presetSelection: {},
    history: [],
    interactiveMode: false,
    customCSS: '',
    useCustomAPI: false, apiUrl: '', apiKey: '', apiModel: '',
    userPersona: '',

    // 世界书（v1.5: 单选切换制）
    activeWorldBook: '',
    activeWBEntries: [],
    activeWBStates: [],
    wbStatesCache: {},   // { [bookName]: [bool, ...] }

    // 手动条目（独立，不受世界书切换影响）
    manualEntries: [],
    manualStates: [],
});

// ============================================================
// Init
// ============================================================
async function init() {
    const ctx = SillyTavern.getContext();
    const { extensionSettings, renderExtensionTemplateAsync, eventSource, event_types } = ctx;

    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    for (const k of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], k)) extensionSettings[MODULE_NAME][k] = structuredClone(defaultSettings[k]);
    }
    migrateOldData(extensionSettings[MODULE_NAME]);
    settings = extensionSettings[MODULE_NAME];

    const html = await renderExtensionTemplateAsync('third-party/st-theater', 'settings');
    $('#extensions_settings2').append(html);
    $('#theater-open-btn').on('click', openTheaterPopup);

    const addWand = () => {
        if ($('#theater-wand-btn').length) return;
        const $btn = $('<div id="theater-wand-btn" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-masks-theater extensionsMenuExtensionButton"></div>小剧场</div>');
        $('#extensionsMenu').append($btn);
        $btn.on('click', e => { e.stopPropagation(); $(document).trigger('click'); setTimeout(openTheaterPopup, 150); });
    };
    addWand();
    if (event_types?.APP_READY) eventSource.on(event_types.APP_READY, addWand);

    applyCustomCSS();
    console.log(`[Theater] v${VERSION} loaded`);
}

// 1.4.x -> 1.5.0 静默迁移
function migrateOldData(s) {
    if (s.presetMode === 'current') s.presetMode = 'minimal';
    if (!s.presetSelection) s.presetSelection = {};

    // 旧的 worldBookEntries 里的「手动」条目迁到 manualEntries
    if (Array.isArray(s.worldBookEntries) && s.worldBookEntries.length) {
        if (!Array.isArray(s.manualEntries)) s.manualEntries = [];
        if (!Array.isArray(s.manualStates)) s.manualStates = [];
        s.worldBookEntries.forEach((e, i) => {
            if (!e) return;
            if (e.source === '手动' || !e.source) {
                s.manualEntries.push({ name: e.name || '', content: e.content || '' });
                s.manualStates.push((s.worldBookStates || [])[i] !== false);
            }
        });
        delete s.worldBookEntries;
        delete s.worldBookStates;
        delete s.selectedWorldBooks;
    }
    if (!Array.isArray(s.activeWBEntries)) s.activeWBEntries = [];
    if (!Array.isArray(s.activeWBStates)) s.activeWBStates = [];
    if (!s.wbStatesCache || typeof s.wbStatesCache !== 'object') s.wbStatesCache = {};
    if (!Array.isArray(s.manualEntries)) s.manualEntries = [];
    if (!Array.isArray(s.manualStates)) s.manualStates = [];
}

function applyCustomCSS() {
    $('#theater-custom-css-inject').remove();
    if (settings.customCSS?.trim()) $('head').append(`<style id="theater-custom-css-inject">${settings.customCSS}</style>`);
}

// ============================================================
// Popup HTML
// ============================================================
function buildPopupHTML() {
    const inst = settings.instructionTemplates || [];
    const render = settings.renderTemplates || [];
    const hist = settings.history || [];

    return `
<div class="theater-popup">
    <div class="theater-popup-header">
        <p class="theater-title">小剧场生成器</p>
        <p class="theater-subtitle">独立生成 · 不影响正文 · v${VERSION}</p>
    </div>
    <div class="theater-tabs">
        <div class="theater-tab active" data-tab="generate">生成</div>
        <div class="theater-tab" data-tab="context">上下文</div>
        <div class="theater-tab" data-tab="template">模板</div>
        <div class="theater-tab" data-tab="history">历史</div>
        <div class="theater-tab" data-tab="config">设置</div>
    </div>
    <div class="theater-panels-wrapper">

    <!-- ===== 生成 ===== -->
    <div class="theater-panel active" data-panel="generate">
        <div class="theater-section">
            <label class="theater-label">小剧场指令</label>
            <textarea id="theater-instruction" class="theater-textarea" rows="4" placeholder="例如：生成一个角色们一起吃火锅的番外小剧场"></textarea>
            <div class="theater-toggle-row">
                <label class="theater-toggle-label"><input type="checkbox" id="theater-interactive-toggle" ${settings.interactiveMode ? 'checked' : ''}><span>交互模式</span></label>
                <span class="theater-hint-inline">生成可交互的小剧场</span>
            </div>
            <div class="theater-btn-row">
                <div id="theater-generate-btn" class="theater-btn primary generate"><i class="fa-solid fa-wand-magic-sparkles"></i><span>生成</span></div>
                <div id="theater-stop-btn" class="theater-btn danger generate" style="display:none;"><i class="fa-solid fa-stop"></i><span>停止</span></div>
                <div id="theater-save-instruction-btn" class="theater-btn"><i class="fa-solid fa-floppy-disk"></i><span>存为模板</span></div>
            </div>
        </div>
        <div class="theater-section" id="theater-stream-section" style="display:none;">
            <label class="theater-label"><i class="fa-solid fa-feather"></i> 实时输出</label>
            <pre id="theater-stream-text" class="theater-stream-pre"></pre>
        </div>
        <div class="theater-section" id="theater-output-section" style="display:none;">
            <label class="theater-label">生成结果</label>
            <div id="theater-output-container"><iframe id="theater-output-frame" sandbox="allow-scripts allow-same-origin" class="theater-iframe"></iframe></div>
            <div class="theater-btn-row">
                <div id="theater-save-history-btn" class="theater-btn"><i class="fa-solid fa-bookmark"></i><span>保存</span></div>
                <div id="theater-copy-html-btn" class="theater-btn"><i class="fa-solid fa-copy"></i><span>复制HTML</span></div>
            </div>
        </div>
    </div>

    <!-- ===== 上下文 ===== -->
    <div class="theater-panel" data-panel="context">

        <!-- 系统提示 / 预设（v1.5: 三模式） -->
        <div class="theater-section">
            <label class="theater-label">系统提示（预设）</label>
            <p class="theater-hint">小剧场是独立生成，推荐精简模式 —— 把正文的整套预设全部带进来，就相当于让模型先写一遍正文再写小剧场，很容易 502/524。</p>
            <select id="theater-preset-select" class="theater-select">
                <option value="minimal" ${settings.presetMode === 'minimal' ? 'selected' : ''}>精简（推荐，只用小剧场通用提示）</option>
                <option value="selected" ${settings.presetMode === 'selected' ? 'selected' : ''}>从当前预设选条目</option>
                <option value="custom" ${settings.presetMode === 'custom' ? 'selected' : ''}>自定义 System Prompt</option>
            </select>

            <div id="theater-preset-selected-area" style="${settings.presetMode === 'selected' ? '' : 'display:none'}; margin-top:10px;">
                <div class="theater-btn-row" style="margin:0 0 8px;">
                    <div id="theater-preset-refresh-btn" class="theater-btn"><i class="fa-solid fa-rotate"></i><span>刷新条目</span></div>
                    <div id="theater-preset-select-all" class="theater-btn"><i class="fa-solid fa-check-double"></i><span>全选</span></div>
                    <div id="theater-preset-deselect-all" class="theater-btn"><i class="fa-regular fa-square"></i><span>全不选</span></div>
                </div>
                <div id="theater-preset-items" class="theater-preset-items-list">
                    <p class="theater-empty">点「刷新条目」加载当前预设</p>
                </div>
            </div>

            <div id="theater-custom-prompt-area" style="${settings.presetMode === 'custom' ? '' : 'display:none'}; margin-top:10px;">
                <textarea id="theater-custom-prompt" class="theater-textarea" rows="6" placeholder="粘贴 System Prompt…">${esc(settings.customSystemPrompt || '')}</textarea>
                <div class="theater-btn-row"><div id="theater-save-prompt-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div></div>
            </div>
        </div>

        <!-- User Persona -->
        <div class="theater-section">
            <label class="theater-label">User 人设</label>
            <div class="theater-btn-row" style="margin:0 0 8px;"><div id="theater-load-persona-btn" class="theater-btn"><i class="fa-solid fa-user"></i><span>从酒馆读取</span></div></div>
            <textarea id="theater-user-persona" class="theater-textarea" rows="3" placeholder="用户人设信息…">${esc(settings.userPersona || '')}</textarea>
            <div class="theater-btn-row"><div id="theater-save-persona-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div></div>
        </div>

        <!-- 世界书（v1.5: 切换即替换） -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-book-atlas"></i> 世界书</label>
            <p class="theater-hint">切换世界书 = 替换下方条目列表。每本书的勾选状态会单独记忆。</p>

            <select id="theater-wb-book-select" class="theater-select">
                <option value="">-- 不使用世界书 --</option>
            </select>

            <div class="theater-wb-entries-header" id="theater-wb-entries-header" style="display:none;">
                <span class="theater-wb-entries-count" id="theater-wb-count"></span>
                <div class="theater-wb-entries-actions">
                    <span id="theater-wb-select-all" class="theater-wb-action-link"><i class="fa-solid fa-check-double"></i> 全选</span>
                    <span id="theater-wb-deselect-all" class="theater-wb-action-link"><i class="fa-regular fa-square"></i> 全不选</span>
                    <span id="theater-wb-toggle-all" class="theater-wb-action-link"><i class="fa-solid fa-chevron-down"></i> 展开</span>
                </div>
            </div>
            <div id="theater-worldbook-list" class="theater-wb-list"></div>
        </div>

        <!-- 手动条目（独立保存） -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-keyboard"></i> 手动条目</label>
            <p class="theater-hint">独立保存，不受世界书切换影响。</p>
            <details class="theater-wb-manual-details">
                <summary class="theater-wb-manual-summary">添加新条目</summary>
                <textarea id="theater-wb-manual" class="theater-textarea" rows="3" placeholder="粘贴内容，空行分隔多个条目…" style="margin-top:8px;"></textarea>
                <div class="theater-btn-row"><div id="theater-wb-parse-btn" class="theater-btn"><i class="fa-solid fa-plus"></i><span>添加</span></div></div>
            </details>
            <div id="theater-manual-list" class="theater-wb-list" style="margin-top:10px;"></div>
        </div>

        <!-- 上下文条数 -->
        <div class="theater-section">
            <label class="theater-label">上下文消息数量 · <span id="theater-range-val">${settings.contextRange}</span> 条</label>
            <input id="theater-context-range" type="range" min="3" max="80" value="${settings.contextRange}" class="theater-slider">
            <p class="theater-hint">越多 prompt 越长，越容易 502/524。建议 10~20。</p>
        </div>
    </div>

    <!-- ===== 模板 ===== -->
    <div class="theater-panel" data-panel="template">
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-pen-fancy"></i> 指令模板库</label>
            <div id="theater-instruction-list" class="theater-tag-list">
                ${inst.length === 0 ? '<p class="theater-empty">暂无保存的指令模板</p>' : inst.map((t, i) => `<div class="theater-tag" data-index="${i}"><span class="theater-tag-text">${esc(t.name)}</span><span class="theater-tag-delete" data-index="${i}"><i class="fa-solid fa-xmark"></i></span></div>`).join('')}
            </div>
        </div>
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-palette"></i> 渲染规则模板</label>
            <p class="theater-hint">控制小剧场输出格式，可粘贴各位老师的小剧场规则。</p>
            <select id="theater-render-select" class="theater-select">
                <option value="__default__">默认模板（轻量卡片）</option>
                ${render.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}
            </select>
            <textarea id="theater-render-content" class="theater-textarea" rows="6" style="margin-top:10px;">${esc(DEFAULT_RENDER_TEMPLATE)}</textarea>
            <div class="theater-btn-row">
                <div id="theater-save-render-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存为新模板</span></div>
                <div id="theater-delete-render-btn" class="theater-btn danger" style="display:none;"><i class="fa-solid fa-trash"></i><span>删除当前</span></div>
            </div>
        </div>
    </div>

    <!-- ===== 历史 ===== -->
    <div class="theater-panel" data-panel="history">
        <div class="theater-section">
            <label class="theater-label">保存的小剧场</label>
            <div id="theater-history-list">${hist.length === 0 ? '<p class="theater-empty">暂无保存的小剧场</p>' : hist.map((h, i) => historyItemHTML(h, i)).join('')}</div>
        </div>
    </div>

    <!-- ===== 设置 ===== -->
    <div class="theater-panel" data-panel="config">
        <div class="theater-section">
            <label class="theater-label">API 来源</label>
            <select id="theater-api-select" class="theater-select">
                <option value="main" ${!settings.useCustomAPI ? 'selected' : ''}>主 API（跟随当前）</option>
                <option value="custom" ${settings.useCustomAPI ? 'selected' : ''}>独立 API</option>
            </select>
            <p class="theater-hint" style="margin-top:6px;">两种模式都走流式。独立 API 直接 SSE，主 API 先试流式再回退非流式。</p>
            <div id="theater-custom-api-area" style="${settings.useCustomAPI ? '' : 'display:none'}; margin-top:10px;">
                <input id="theater-api-url" class="theater-input" placeholder="API URL（如 https://api.openai.com）" value="${esc(settings.apiUrl || '')}">
                <input id="theater-api-key" class="theater-input" type="password" placeholder="API Key" value="${esc(settings.apiKey || '')}" style="margin-top:6px;">
                <input id="theater-api-model" class="theater-input" placeholder="模型名称" value="${esc(settings.apiModel || '')}" style="margin-top:6px;">
                <div class="theater-btn-row"><div id="theater-save-api-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div></div>
            </div>
        </div>
        <div class="theater-section">
            <label class="theater-label">面板自定义 CSS</label>
            <textarea id="theater-custom-css" class="theater-textarea theater-css-editor" rows="5" placeholder=".theater-popup { background: #1a1a2e; }">${esc(settings.customCSS || '')}</textarea>
            <div class="theater-btn-row">
                <div id="theater-save-css-btn" class="theater-btn primary"><i class="fa-solid fa-palette"></i><span>保存并应用</span></div>
                <div id="theater-reset-css-btn" class="theater-btn danger"><i class="fa-solid fa-rotate-left"></i><span>重置</span></div>
            </div>
        </div>
        <div class="theater-section">
            <label class="theater-label">数据管理</label>
            <div class="theater-btn-row">
                <div id="theater-export-btn" class="theater-btn"><i class="fa-solid fa-download"></i><span>导出</span></div>
                <div id="theater-import-btn" class="theater-btn"><i class="fa-solid fa-upload"></i><span>导入</span></div>
                <div id="theater-update-btn" class="theater-btn primary"><i class="fa-solid fa-arrows-rotate"></i><span>更新扩展</span></div>
            </div>
        </div>
        <p class="theater-version">v${VERSION}</p>
    </div>

    </div>
</div>`;
}

function historyItemHTML(h, i) {
    return `<div class="theater-history-item" data-index="${i}"><div class="theater-history-header"><span class="theater-history-title">${esc(h.title || '#' + (i + 1))}</span><span class="theater-history-date">${h.date || ''}</span></div><div class="theater-history-actions"><span class="theater-history-view" data-index="${i}"><i class="fa-solid fa-eye"></i> 查看</span><span class="theater-history-delete" data-index="${i}"><i class="fa-solid fa-trash"></i> 删除</span></div></div>`;
}

// ============================================================
// 渲染：世界书条目 / 手动条目
// ============================================================
function renderWBEntriesHTML() {
    const entries = settings.activeWBEntries || [];
    const states = settings.activeWBStates || [];
    if (!entries.length) {
        return settings.activeWorldBook
            ? '<p class="theater-empty">该世界书没有有效条目</p>'
            : '<p class="theater-empty">未选择世界书</p>';
    }
    return entries.map((entry, i) => entryRow(entry, states[i] !== false, i, 'wb')).join('');
}

function renderManualHTML() {
    const entries = settings.manualEntries || [];
    const states = settings.manualStates || [];
    if (!entries.length) return '<p class="theater-empty">暂无手动条目</p>';
    return entries.map((entry, i) => entryRow(entry, states[i] !== false, i, 'manual')).join('');
}

function entryRow(entry, checked, i, kind) {
    const name = entry.name || '#' + (i + 1);
    const content = entry.content || '';
    const removeBtn = kind === 'manual'
        ? `<span class="theater-wb-entry-remove" data-index="${i}"><i class="fa-solid fa-xmark"></i></span>`
        : '';
    return `
<div class="theater-wb-entry ${checked ? '' : 'theater-wb-entry-off'}" data-kind="${kind}">
    <div class="theater-wb-entry-header" data-index="${i}">
        <input type="checkbox" class="theater-wb-check" data-kind="${kind}" data-index="${i}" ${checked ? 'checked' : ''}>
        <span class="theater-wb-entry-name">${esc(name)}</span>
        ${removeBtn}
        <span class="theater-wb-entry-toggle" data-kind="${kind}" data-index="${i}"><i class="fa-solid fa-chevron-right"></i></span>
    </div>
    <div class="theater-wb-entry-body" data-kind="${kind}" data-index="${i}" style="display:none;">
        <div class="theater-wb-entry-content">${esc(content)}</div>
    </div>
</div>`;
}

function refreshWBUI() {
    $('#theater-worldbook-list').html(renderWBEntriesHTML());
    const has = (settings.activeWBEntries || []).length > 0;
    $('#theater-wb-entries-header').toggle(has);
    updateWBCount();
}

function refreshManualUI() {
    $('#theater-manual-list').html(renderManualHTML());
}

function updateWBCount() {
    const entries = settings.activeWBEntries || [];
    const states = settings.activeWBStates || [];
    if (!entries.length) { $('#theater-wb-count').text(''); return; }
    const on = entries.filter((_e, i) => states[i] !== false).length;
    $('#theater-wb-count').text(`${on} / ${entries.length} 启用`);
}

// ============================================================
// Open
// ============================================================
async function openTheaterPopup() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(buildPopupHTML(), POPUP_TYPE.TEXT, '', { wide: true, okButton: 'Close', allowVerticalScrolling: true });
    const p = popup.show();
    await new Promise(r => setTimeout(r, 50));
    bindEvents();
    await loadWorldBookList();
    // 渲染已持久化的世界书/手动条目
    refreshWBUI();
    refreshManualUI();
    // 如果是 selected 模式，尝试自动加载一次预设条目
    if (settings.presetMode === 'selected') refreshPresetItems(true);
    refreshInstList();
    refreshHistList();
    await p;
}

// ============================================================
// Events
// ============================================================
function bindEvents() {
    const $d = $(document);

    // Tabs
    $d.off('click.tt').on('click.tt', '.theater-tab', function () {
        const t = $(this).data('tab');
        $('.theater-tab').removeClass('active'); $(this).addClass('active');
        $('.theater-panel').removeClass('active'); $(`.theater-panel[data-panel="${t}"]`).addClass('active');
    });

    // Generate
    $d.off('click.tg').on('click.tg', '#theater-generate-btn', generateTheater);
    $d.off('click.tstop').on('click.tstop', '#theater-stop-btn', stopGeneration);
    $d.off('change.ti').on('change.ti', '#theater-interactive-toggle', function () { settings.interactiveMode = $(this).is(':checked'); save(); });

    // Instruction templates
    $d.off('click.tsi').on('click.tsi', '#theater-save-instruction-btn', saveInstructionTpl);
    $d.off('click.ttag').on('click.ttag', '.theater-tag .theater-tag-text', function () {
        const t = settings.instructionTemplates[$(this).parent().data('index')];
        if (t) { $('#theater-instruction').val(t.content); $('.theater-tab[data-tab="generate"]').click(); }
    });
    $d.off('click.ttd').on('click.ttd', '.theater-tag-delete', function () {
        settings.instructionTemplates.splice($(this).data('index'), 1); save(); refreshInstList();
    });

    // Render templates
    $d.off('change.tr').on('change.tr', '#theater-render-select', function () {
        const v = $(this).val();
        if (v === '__default__') { $('#theater-render-content').val(DEFAULT_RENDER_TEMPLATE); $('#theater-delete-render-btn').hide(); }
        else { const t = settings.renderTemplates[parseInt(v)]; if (t) $('#theater-render-content').val(t.content); $('#theater-delete-render-btn').show(); }
    });
    $d.off('click.tsr').on('click.tsr', '#theater-save-render-btn', saveRenderTpl);
    $d.off('click.tdr').on('click.tdr', '#theater-delete-render-btn', deleteRenderTpl);

    // Preset mode
    $d.off('change.tp').on('change.tp', '#theater-preset-select', function () {
        settings.presetMode = $(this).val();
        $('#theater-preset-selected-area').toggle(settings.presetMode === 'selected');
        $('#theater-custom-prompt-area').toggle(settings.presetMode === 'custom');
        save();
        if (settings.presetMode === 'selected') refreshPresetItems(true);
    });
    $d.off('click.tsp').on('click.tsp', '#theater-save-prompt-btn', function () {
        settings.customSystemPrompt = $('#theater-custom-prompt').val(); save(); toastr.success('已保存');
    });

    // Preset items (selected mode)
    $d.off('click.tpr').on('click.tpr', '#theater-preset-refresh-btn', () => refreshPresetItems(false));
    $d.off('click.tpsa').on('click.tpsa', '#theater-preset-select-all', () => setAllPresetSelection(true));
    $d.off('click.tpda').on('click.tpda', '#theater-preset-deselect-all', () => setAllPresetSelection(false));
    $d.off('change.tpc').on('change.tpc', '.theater-preset-check', function () {
        const id = $(this).data('id');
        if (!id) return;
        settings.presetSelection[id] = $(this).is(':checked');
        $(this).closest('.theater-preset-item').toggleClass('theater-preset-item-off', !$(this).is(':checked'));
        save();
    });

    // Persona
    $d.off('click.tlp').on('click.tlp', '#theater-load-persona-btn', loadPersona);
    $d.off('click.tsper').on('click.tsper', '#theater-save-persona-btn', function () {
        settings.userPersona = $('#theater-user-persona').val(); save(); toastr.success('已保存');
    });

    // 世界书 - 切换
    $d.off('change.twbs').on('change.twbs', '#theater-wb-book-select', function () {
        switchWorldBook($(this).val() || '');
    });

    // 条目：checkbox（世界书/手动共用）
    $d.off('change.twb').on('change.twb', '.theater-wb-check', function (e) {
        e.stopPropagation();
        const kind = $(this).data('kind');
        const idx = parseInt($(this).data('index'));
        const arr = kind === 'manual' ? settings.manualStates : settings.activeWBStates;
        while (arr.length <= idx) arr.push(true);
        arr[idx] = $(this).is(':checked');
        $(this).closest('.theater-wb-entry').toggleClass('theater-wb-entry-off', !arr[idx]);
        if (kind === 'wb' && settings.activeWorldBook) {
            settings.wbStatesCache[settings.activeWorldBook] = settings.activeWBStates.slice();
        }
        save(); updateWBCount();
    });

    // 条目：全选/全不选（世界书）
    $d.off('click.twsa').on('click.twsa', '#theater-wb-select-all', () => {
        settings.activeWBStates = (settings.activeWBEntries || []).map(() => true);
        if (settings.activeWorldBook) settings.wbStatesCache[settings.activeWorldBook] = settings.activeWBStates.slice();
        save(); refreshWBUI();
    });
    $d.off('click.twda').on('click.twda', '#theater-wb-deselect-all', () => {
        settings.activeWBStates = (settings.activeWBEntries || []).map(() => false);
        if (settings.activeWorldBook) settings.wbStatesCache[settings.activeWorldBook] = settings.activeWBStates.slice();
        save(); refreshWBUI();
    });

    // 条目：展开/收起
    $d.off('click.twet').on('click.twet', '.theater-wb-entry-toggle', function (e) {
        e.stopPropagation();
        const kind = $(this).data('kind');
        const idx = $(this).data('index');
        const $body = $(`.theater-wb-entry-body[data-kind="${kind}"][data-index="${idx}"]`);
        const $icon = $(this).find('i');
        $body.slideToggle(150);
        $icon.toggleClass('fa-chevron-right fa-chevron-down');
    });
    $d.off('click.tweh').on('click.tweh', '.theater-wb-entry-header', function (e) {
        if ($(e.target).is('input[type="checkbox"]') || $(e.target).closest('.theater-wb-entry-toggle').length || $(e.target).closest('.theater-wb-entry-remove').length) return;
        $(this).find('.theater-wb-entry-toggle').trigger('click');
    });
    $d.off('click.twta').on('click.twta', '#theater-wb-toggle-all', function () {
        const anyHidden = $('#theater-worldbook-list .theater-wb-entry-body:hidden').length > 0;
        if (anyHidden) {
            $('#theater-worldbook-list .theater-wb-entry-body').slideDown(150);
            $('#theater-worldbook-list .theater-wb-entry-toggle i').removeClass('fa-chevron-right').addClass('fa-chevron-down');
            $(this).html('<i class="fa-solid fa-chevron-up"></i> 收起');
        } else {
            $('#theater-worldbook-list .theater-wb-entry-body').slideUp(150);
            $('#theater-worldbook-list .theater-wb-entry-toggle i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
            $(this).html('<i class="fa-solid fa-chevron-down"></i> 展开');
        }
    });

    // 手动条目 - 添加
    $d.off('click.twp').on('click.twp', '#theater-wb-parse-btn', function () {
        const text = $('#theater-wb-manual').val().trim(); if (!text) return;
        const parts = text.split(/\n{2,}/).filter(s => s.trim());
        parts.forEach(p => {
            settings.manualEntries.push({ name: p.substring(0, 30).replace(/\n/g, ' '), content: p.trim() });
            settings.manualStates.push(true);
        });
        save(); refreshManualUI(); $('#theater-wb-manual').val('');
        toastr.success(`添加了 ${parts.length} 个条目`);
    });
    // 手动条目 - 删除
    $d.off('click.twre').on('click.twre', '.theater-wb-entry-remove', function (e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('index'));
        settings.manualEntries.splice(idx, 1);
        settings.manualStates.splice(idx, 1);
        save(); refreshManualUI();
    });

    // Context range
    $d.off('input.trng').on('input.trng', '#theater-context-range', function () {
        $('#theater-range-val').text($(this).val()); settings.contextRange = parseInt($(this).val()); save();
    });

    // API
    $d.off('change.tam').on('change.tam', '#theater-api-select', function () {
        settings.useCustomAPI = $(this).val() === 'custom';
        $('#theater-custom-api-area').toggle(settings.useCustomAPI);
        save();
    });
    $d.off('click.tsa').on('click.tsa', '#theater-save-api-btn', function () {
        settings.apiUrl = $('#theater-api-url').val().trim().replace(/\/+$/, '');
        settings.apiKey = $('#theater-api-key').val().trim();
        settings.apiModel = $('#theater-api-model').val().trim();
        save(); toastr.success('API 已保存');
    });

    // CSS
    $d.off('click.tcss').on('click.tcss', '#theater-save-css-btn', function () {
        settings.customCSS = $('#theater-custom-css').val(); save(); applyCustomCSS(); toastr.success('样式已应用');
    });
    $d.off('click.trcss').on('click.trcss', '#theater-reset-css-btn', function () {
        settings.customCSS = ''; $('#theater-custom-css').val(''); save(); applyCustomCSS();
    });

    // History
    $d.off('click.tsh').on('click.tsh', '#theater-save-history-btn', saveToHistory);
    $d.off('click.tch').on('click.tch', '#theater-copy-html-btn', copyHtml);
    $d.off('click.thv').on('click.thv', '.theater-history-view', function () {
        const item = settings.history[$(this).data('index')]; if (!item) return;
        showInIframe(item.html); $('.theater-tab[data-tab="generate"]').click(); $('#theater-output-section').show();
    });
    $d.off('click.thd').on('click.thd', '.theater-history-delete', function () {
        settings.history.splice($(this).data('index'), 1); save(); refreshHistList();
    });

    // Import / Export / Update
    $d.off('click.tex').on('click.tex', '#theater-export-btn', exportData);
    $d.off('click.tim').on('click.tim', '#theater-import-btn', importData);
    $d.off('click.tup').on('click.tup', '#theater-update-btn', updateExtension);
}

// ============================================================
// Persona
// ============================================================
function loadPersona() {
    try {
        const ctx = SillyTavern.getContext();
        let persona = '';
        if (ctx.name1) persona = `[用户名: ${ctx.name1}]\n`;
        if (ctx.powerUserSettings?.persona_description) persona += ctx.powerUserSettings.persona_description;
        if (persona.trim()) { $('#theater-user-persona').val(persona.trim()); settings.userPersona = persona.trim(); save(); toastr.success('已读取'); }
        else toastr.warning('未找到人设，请手动填写');
    } catch (e) { toastr.error('读取失败'); }
}

// ============================================================
// 世界书列表
// ============================================================
async function loadWorldBookList() {
    const $select = $('#theater-wb-book-select');
    $select.find('option:not(:first)').remove();

    const names = [];
    try {
        const ctx = SillyTavern.getContext();
        const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };

        // 1. DOM 读取
        $('#world_info_select option, #world_editor_select option, select[id*="world_info"] option').each(function () {
            const val = $(this).val();
            const text = $(this).text()?.trim();
            if (val && text && text !== 'None' && text !== '--- None ---' && !text.startsWith('--')) {
                if (!names.includes(text)) names.push(text);
            }
        });

        // 2. 角色绑定
        if (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) {
            const charWI = ctx.characters[ctx.characterId].data?.extensions?.world;
            if (charWI && !names.includes(charWI)) names.push(charWI);
        }

        // 3. 聊天绑定
        if (ctx.chatMetadata?.world_info) {
            const chatWI = ctx.chatMetadata.world_info;
            if (chatWI && !names.includes(chatWI)) names.push(chatWI);
        }

        // 4. 服务器 API
        if (names.length < 2) {
            try {
                const r = await fetch('/api/worldinfo/list', { method: 'GET', headers });
                if (r.ok) {
                    const list = await r.json();
                    const arr = Array.isArray(list) ? list : (list?.data || []);
                    arr.forEach(n => { if (n && !names.includes(n)) names.push(n); });
                }
            } catch (e) { console.log('[Theater] WI list API failed:', e.message); }
        }
    } catch (e) {
        console.error('[Theater] loadWorldBookList error:', e);
    }

    names.forEach(n => $select.append(`<option value="${esc(n)}">${esc(n)}</option>`));
    // 恢复持久化的选中
    if (settings.activeWorldBook && names.includes(settings.activeWorldBook)) {
        $select.val(settings.activeWorldBook);
    } else {
        $select.val('');
    }
    console.log(`[Theater] Found ${names.length} world books, active: "${settings.activeWorldBook}"`);
}

// ============================================================
// 世界书 - 切换（替换）
// ============================================================
async function switchWorldBook(name) {
    // 先保存当前书的勾选状态到缓存
    if (settings.activeWorldBook) {
        settings.wbStatesCache[settings.activeWorldBook] = (settings.activeWBStates || []).slice();
    }

    if (!name) {
        settings.activeWorldBook = '';
        settings.activeWBEntries = [];
        settings.activeWBStates = [];
        save(); refreshWBUI();
        return;
    }

    // 如果切换回同一本（理论上不会触发 change，但做个兜底）
    if (name === settings.activeWorldBook && (settings.activeWBEntries || []).length) {
        refreshWBUI();
        return;
    }

    const $sel = $('#theater-wb-book-select');
    $sel.prop('disabled', true);
    $('#theater-worldbook-list').html('<p class="theater-empty">读取中…</p>');

    try {
        const entries = await fetchWorldBookEntries(name);
        settings.activeWorldBook = name;
        settings.activeWBEntries = entries;

        // 恢复缓存的状态（长度对齐：多了补 true，少了裁剪）
        const cached = settings.wbStatesCache[name];
        if (Array.isArray(cached) && cached.length) {
            const out = entries.map((_e, i) => cached[i] !== false);
            settings.activeWBStates = out;
        } else {
            settings.activeWBStates = entries.map(() => true);
        }
        settings.wbStatesCache[name] = settings.activeWBStates.slice();
        save();
        refreshWBUI();

        if (!entries.length) toastr.warning(`「${name}」没有有效条目`);
        else toastr.success(`已切换至「${name}」（${entries.length} 个条目）`);
    } catch (err) {
        console.error('[Theater] switchWorldBook error:', err);
        toastr.error(`读取「${name}」失败: ${err.message}`);
        // 失败回退空状态
        settings.activeWorldBook = '';
        settings.activeWBEntries = [];
        settings.activeWBStates = [];
        save(); refreshWBUI();
        $sel.val('');
    } finally {
        $sel.prop('disabled', false);
    }
}

async function fetchWorldBookEntries(wiName) {
    const ctx = SillyTavern.getContext();
    const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };

    const resp = await fetch('/api/worldinfo/get', {
        method: 'POST', headers,
        body: JSON.stringify({ name: wiName }),
    });
    if (!resp.ok) throw new Error(`WI API ${resp.status}`);

    const data = await resp.json();
    if (!data?.entries) return [];
    const raw = Object.values(data.entries);
    return raw
        .filter(e => e.content && !e.disable)
        .map(e => ({
            name: e.comment || (Array.isArray(e.key) ? e.key.join(', ') : String(e.key || '')) || '未命名',
            content: e.content,
        }));
}

// ============================================================
// 预设条目（selected 模式）
// ============================================================
function getPresetPromptsRaw() {
    try {
        const ctx = SillyTavern.getContext();
        const oai = ctx.chatCompletionSettings;
        if (!oai?.prompts || !Array.isArray(oai.prompts)) return [];
        // 过滤：有内容、非 forbid、system 或 user/assistant（都暴露给用户选）
        return oai.prompts
            .filter(p => p && p.content && !p.forbid)
            .map(p => ({
                identifier: p.identifier || p.name || ('p_' + Math.random().toString(36).slice(2, 8)),
                name: p.name || p.identifier || '(未命名)',
                role: p.role || 'system',
                content: p.content,
            }));
    } catch (e) {
        console.error('[Theater] getPresetPromptsRaw error:', e);
        return [];
    }
}

function refreshPresetItems(silent) {
    const items = getPresetPromptsRaw();
    const $list = $('#theater-preset-items');
    if (!items.length) {
        $list.html('<p class="theater-empty">未找到预设条目（请确认当前是 Chat Completion 模式且预设已加载）</p>');
        if (!silent) toastr.warning('未找到预设条目');
        return;
    }
    // 清理已失效的选择
    const currentIds = new Set(items.map(it => it.identifier));
    Object.keys(settings.presetSelection).forEach(k => {
        if (!currentIds.has(k)) delete settings.presetSelection[k];
    });
    save();

    $list.html(items.map(it => {
        const checked = settings.presetSelection[it.identifier] === true;
        const preview = (it.content || '').substring(0, 80).replace(/\n/g, ' ');
        return `
<div class="theater-preset-item ${checked ? '' : 'theater-preset-item-off'}">
    <label class="theater-preset-item-label">
        <input type="checkbox" class="theater-preset-check" data-id="${esc(it.identifier)}" ${checked ? 'checked' : ''}>
        <span class="theater-preset-item-name">${esc(it.name)}</span>
        <span class="theater-preset-item-role">${esc(it.role)}</span>
    </label>
    <div class="theater-preset-item-preview">${esc(preview)}${it.content.length > 80 ? '…' : ''}</div>
</div>`;
    }).join(''));
    if (!silent) toastr.success(`已加载 ${items.length} 个预设条目`);
}

function setAllPresetSelection(on) {
    const items = getPresetPromptsRaw();
    if (!items.length) return;
    items.forEach(it => { settings.presetSelection[it.identifier] = !!on; });
    save();
    refreshPresetItems(true);
}

// ============================================================
// 取 system prompt
// ============================================================
function buildSystemPrompt() {
    if (settings.presetMode === 'custom') {
        return (settings.customSystemPrompt || '').trim() || MINIMAL_SYSTEM_PROMPT;
    }
    if (settings.presetMode === 'selected') {
        const items = getPresetPromptsRaw();
        const picked = items.filter(it => settings.presetSelection[it.identifier] === true);
        if (!picked.length) return MINIMAL_SYSTEM_PROMPT;
        return picked.map(p => p.content).join('\n\n');
    }
    // minimal
    return MINIMAL_SYSTEM_PROMPT;
}

// ============================================================
// 生成
// ============================================================
let lastGeneratedHtml = '';
let abortController = null;

function stopGeneration() {
    if (abortController) { abortController.abort(); abortController = null; }
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.substring(0, n) + '…[已截断]' : s;
}

async function generateTheater() {
    const instruction = $('#theater-instruction').val().trim();
    if (!instruction) { toastr.warning('请输入指令'); return; }

    const ctx = SillyTavern.getContext();
    const { chat, characters, characterId, name1, name2 } = ctx;
    if (!chat?.length) { toastr.warning('无聊天记录'); return; }

    // 上下文剧情
    const chatCtx = chat.slice(-(settings.contextRange || 10)).map(m =>
        `${m.is_user ? (name1 || 'User') : (m.name || name2 || 'Char')}: ${m.mes}`
    ).join('\n\n');

    // 角色信息
    let charInfo = '';
    if (characterId !== undefined && characters[characterId]) {
        const c = characters[characterId];
        const d = c.data?.description || c.description || '';
        const p = c.data?.personality || c.personality || '';
        if (d) charInfo += `角色设定：\n${truncate(d, 3000)}\n\n`;
        if (p) charInfo += `角色性格：\n${truncate(p, 1500)}\n\n`;
    }

    // User 人设
    const personaInfo = settings.userPersona?.trim() ? `User人设：\n${settings.userPersona}\n\n` : '';

    // 世界书（活动条目 + 手动条目，都受勾选状态控制）
    const wbParts = [];
    (settings.activeWBEntries || []).forEach((e, i) => {
        if ((settings.activeWBStates || [])[i] !== false && e.content) {
            wbParts.push(truncate(e.content, WB_ENTRY_SOFT_LIMIT));
        }
    });
    (settings.manualEntries || []).forEach((e, i) => {
        if ((settings.manualStates || [])[i] !== false && e.content) {
            wbParts.push(truncate(e.content, WB_ENTRY_SOFT_LIMIT));
        }
    });
    const wbInfo = wbParts.length ? `世界书设定：\n${wbParts.join('\n\n')}\n\n` : '';

    // 渲染规则
    let renderRules = DEFAULT_RENDER_TEMPLATE;
    const rs = $('#theater-render-select').val();
    if (rs !== '__default__') { const t = settings.renderTemplates[parseInt(rs)]; if (t) renderRules = t.content; }
    if (settings.interactiveMode) renderRules += INTERACTIVE_ADDON;

    const prompt = `${charInfo}${personaInfo}${wbInfo}以下是最近的剧情内容：\n${chatCtx}\n\n---\n\n${renderRules}\n\n---\n\n用户指令：${instruction}\n\n请根据以上所有信息生成小剧场，严格遵守渲染规则。`;

    const systemPrompt = buildSystemPrompt();

    // 长度警告
    const total = (systemPrompt || '').length + (prompt || '').length;
    if (total > 40000) {
        toastr.warning(`Prompt 约 ${Math.round(total / 1000)}k 字符，过长容易 502/524，建议减少上下文或关闭部分条目`, '', { timeOut: 6000 });
    }

    // UI 切换
    $('#theater-output-section').hide();
    $('#theater-stream-section').show();
    $('#theater-stream-text').text('');
    $('#theater-generate-btn').hide();
    $('#theater-stop-btn').show();
    abortController = new AbortController();

    const onChunk = (text) => {
        const $el = $('#theater-stream-text');
        $el.text(text);
        const el = $el[0];
        if (el) el.scrollTop = el.scrollHeight;
    };

    try {
        let result;
        if (settings.useCustomAPI && settings.apiUrl && settings.apiKey && settings.apiModel) {
            result = await callCustomAPIStream(systemPrompt, prompt, onChunk);
        } else {
            result = await generateWithMainAPI(ctx, systemPrompt, prompt, onChunk);
        }
        if (!result) { toastr.error('API未返回内容'); return; }
        lastGeneratedHtml = extractHtml(result);
        showInIframe(lastGeneratedHtml);
        $('#theater-stream-section').hide();
        $('#theater-output-section').show();
        toastr.success('生成完成');
    } catch (err) {
        if (err.name === 'AbortError') { toastr.info('已停止'); return; }
        console.error('[Theater]', err);
        toastr.error('生成失败: ' + (err.message || ''));
    } finally {
        $('#theater-generate-btn').show();
        $('#theater-stop-btn').hide();
        abortController = null;
    }
}

// ============================================================
// 主 API 流式
// ============================================================
async function generateWithMainAPI(ctx, systemPrompt, prompt, onChunk) {
    try {
        const result = await callSTStream(ctx, systemPrompt, prompt, onChunk);
        if (result) return result;
    } catch (e) {
        console.warn('[Theater] ST stream attempt failed:', e.message, '— falling back to generateRaw');
    }
    $('#theater-stream-text').text('（回退到非流式模式…）');
    return await generateWithRetry(ctx, systemPrompt, prompt, 2);
}

async function callSTStream(ctx, systemPrompt, prompt, onChunk) {
    const headers = {};
    if (ctx.getRequestHeaders) Object.assign(headers, ctx.getRequestHeaders());
    headers['Content-Type'] = 'application/json';

    const body = {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ],
        stream: true,
    };

    const resp = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: abortController?.signal,
    });

    if (!resp.ok) throw new Error(`ST endpoint returned ${resp.status}`);

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') || contentType.includes('text/plain') || resp.body) {
        return await readSSEStream(resp, onChunk, false);
    } else {
        const data = await resp.json();
        const text = extractTextFromResponse(data);
        if (text) onChunk(text);
        return text;
    }
}

function extractTextFromResponse(data) {
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data?.content?.[0]?.text) return data.content[0].text;
    if (typeof data === 'string') return data;
    return '';
}

// ============================================================
// 自定义 API 流式
// ============================================================
async function callCustomAPIStream(sys, user, onChunk) {
    const url = settings.apiUrl.replace(/\/+$/, '');
    const isAnthropic = /anthropic|claude/i.test(url);
    let endpoint, body, headers;

    if (isAnthropic) {
        endpoint = url.includes('/v1') ? url + '/messages' : url + '/v1/messages';
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': settings.apiKey,
            'anthropic-version': '2023-06-01',
        };
        body = JSON.stringify({
            model: settings.apiModel,
            max_tokens: 8192,
            stream: true,
            system: sys,
            messages: [{ role: 'user', content: user }],
        });
    } else {
        endpoint = url.includes('/v1') ? url + '/chat/completions' : url + '/v1/chat/completions';
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`,
        };
        body = JSON.stringify({
            model: settings.apiModel,
            messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
            stream: true,
        });
    }

    const r = await fetch(endpoint, { method: 'POST', headers, body, signal: abortController?.signal });
    if (!r.ok) {
        const errText = await r.text().catch(() => '');
        throw new Error(`API ${r.status}: ${errText.substring(0, 200)}`);
    }
    return await readSSEStream(r, onChunk, isAnthropic);
}

// ============================================================
// SSE Reader
// ============================================================
async function readSSEStream(response, onChunk, isAnthropic) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('event:') || trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                try {
                    const json = JSON.parse(data);
                    let delta = '';
                    if (isAnthropic) {
                        if (json.type === 'content_block_delta') delta = json.delta?.text || '';
                    } else {
                        delta = json.choices?.[0]?.delta?.content || '';
                    }
                    if (delta) { full += delta; onChunk(full); }
                } catch { /* skip */ }
            } else if (!trimmed.startsWith(':')) {
                full += trimmed;
                onChunk(full);
            }
        }
    }
    if (buffer.trim() && buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
        try {
            const json = JSON.parse(buffer.trim().slice(6));
            const delta = isAnthropic ? (json.delta?.text || '') : (json.choices?.[0]?.delta?.content || '');
            if (delta) { full += delta; onChunk(full); }
        } catch { }
    }
    if (!full) throw new Error('Stream returned empty');
    return full;
}

// ============================================================
// generateRaw 重试
// ============================================================
async function generateWithRetry(ctx, systemPrompt, prompt, maxRetries) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const wait = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
                toastr.info(`重试中…(${attempt}/${maxRetries})`, '', { timeOut: wait });
                await new Promise(r => setTimeout(r, wait));
            }
            return await ctx.generateRaw({ systemPrompt, prompt });
        } catch (err) {
            lastError = err;
            const status = String(err?.status || err?.message || '');
            const isRetryable = /502|529|524|timeout|ECONNRESET|network/i.test(status);
            if (!isRetryable || attempt >= maxRetries) throw err;
            console.warn(`[Theater] Attempt ${attempt + 1} failed (${status}), retrying...`);
        }
    }
    throw lastError;
}

// ============================================================
// HTML 提取
// ============================================================
function extractHtml(t) {
    let m;
    if ((m = t.match(/```(?:html)?\s*\n?([\s\S]*?)```/))) return m[1].trim();
    if ((m = t.match(/(<!DOCTYPE[\s\S]*?<\/html>)/i))) return m[1].trim();
    if ((m = t.match(/(<html[\s\S]*?<\/html>)/i))) return m[1].trim();
    if ((m = t.match(/<snow>([\s\S]*?)<\/snow>/i))) { const inner = m[1].match(/```(?:html)?\s*\n?([\s\S]*?)```/); return inner ? inner[1].trim() : m[1].trim(); }
    if (t.includes('<div') || t.includes('<style')) return t.trim();
    return `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:20px;max-width:480px;margin:0 auto;background:transparent}.card{background:#fafafa;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.1);line-height:1.7;font-size:15px}</style></head><body><div class="card">${t}</div></body></html>`;
}

function showInIframe(html) {
    const f = document.getElementById('theater-output-frame'); if (!f) return;
    f.srcdoc = html;
    f.onload = () => { try { f.style.height = Math.min(Math.max((f.contentDocument || f.contentWindow.document).documentElement.scrollHeight + 20, 200), 600) + 'px'; } catch { f.style.height = '400px'; } };
}

// ============================================================
// 模板 / 历史
// ============================================================
async function saveInstructionTpl() {
    const c = $('#theater-instruction').val().trim(); if (!c) { toastr.warning('请先输入指令'); return; }
    const n = await SillyTavern.getContext().Popup.show.input('保存指令模板', '名字：', c.substring(0, 20)); if (!n) return;
    settings.instructionTemplates.push({ name: n, content: c }); save(); refreshInstList(); toastr.success('已保存');
}
async function saveRenderTpl() {
    const c = $('#theater-render-content').val().trim(); if (!c) return;
    const n = await SillyTavern.getContext().Popup.show.input('保存渲染模板', '名字：'); if (!n) return;
    settings.renderTemplates.push({ name: n, content: c }); save();
    const i = settings.renderTemplates.length - 1;
    $('#theater-render-select').append(`<option value="${i}">${esc(n)}</option>`).val(i.toString());
    $('#theater-delete-render-btn').show(); toastr.success('已保存');
}
function deleteRenderTpl() {
    const v = $('#theater-render-select').val(); if (v === '__default__') return;
    settings.renderTemplates.splice(parseInt(v), 1); save();
    const s = $('#theater-render-select'); s.find('option:not([value="__default__"])').remove();
    settings.renderTemplates.forEach((t, i) => s.append(`<option value="${i}">${esc(t.name)}</option>`));
    s.val('__default__'); $('#theater-render-content').val(DEFAULT_RENDER_TEMPLATE); $('#theater-delete-render-btn').hide();
}
async function saveToHistory() {
    if (!lastGeneratedHtml) return;
    const t = await SillyTavern.getContext().Popup.show.input('保存', '标题：', `小剧场 ${settings.history.length + 1}`); if (!t) return;
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    settings.history.push({ title: t, html: lastGeneratedHtml, instruction: $('#theater-instruction').val(), date: `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}` });
    save(); refreshHistList(); toastr.success('已保存');
}
function copyHtml() {
    if (!lastGeneratedHtml) return;
    navigator.clipboard.writeText(lastGeneratedHtml).then(() => toastr.success('已复制')).catch(() => toastr.error('失败'));
}

// ============================================================
// 更新扩展（修复：global 参数 + 双重尝试 + 回退打开 GitHub）
// ============================================================
async function updateExtension() {
    const EXT_NAME = 'third-party/st-theater';
    const REPO_URL = 'https://github.com/koichole213-ui/st-theater';

    const tryOnce = async (isGlobal) => {
        const ctx = SillyTavern.getContext();
        const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const resp = await fetch('/api/extensions/update', {
            method: 'POST', headers,
            body: JSON.stringify({ extensionName: EXT_NAME, global: !!isGlobal }),
        });
        return { ok: resp.ok, status: resp.status, text: await resp.text().catch(() => '') };
    };

    toastr.info('正在检查更新…', '', { timeOut: 3000 });
    try {
        // 先试 user 级（SillyTavern UI 安装的第三方扩展默认是 user 级）
        let r = await tryOnce(false);
        if (!r.ok && (r.status === 404 || /not\s*found|no such|missing/i.test(r.text))) {
            // 回退到 global
            r = await tryOnce(true);
        }
        if (r.ok) {
            toastr.success('更新成功，请刷新页面（F5）', '', { timeOut: 6000 });
            return;
        }
        // 都失败 → 给用户一个出路
        console.error('[Theater] update failed:', r.status, r.text);
        toastr.warning(`自动更新失败（${r.status}）。已为你打开仓库页面，可以手动 git pull`, '', { timeOut: 6000 });
        window.open(REPO_URL, '_blank', 'noopener');
    } catch (e) {
        console.error('[Theater] update error:', e);
        toastr.error(`更新失败: ${e.message}。请手动更新`, '', { timeOut: 6000 });
        window.open(REPO_URL, '_blank', 'noopener');
    }
}

// ============================================================
// 导入 / 导出（修复：append to body）
// ============================================================
function exportData() {
    try {
        const payload = { version: VERSION };
        for (const k of Object.keys(defaultSettings)) {
            payload[k] = settings[k];
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `theater-data-${Date.now()}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        toastr.success('已导出');
    } catch (e) {
        console.error('[Theater] exportData error:', e);
        toastr.error('导出失败: ' + e.message);
    }
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async (e) => {
        try {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            const d = JSON.parse(text);
            let count = 0;
            for (const k of Object.keys(defaultSettings)) {
                if (d[k] !== undefined) { settings[k] = d[k]; count++; }
            }
            migrateOldData(settings);
            save();
            applyCustomCSS();
            toastr.success(`导入成功（${count} 项），请重新打开面板`);
        } catch (err) {
            console.error('[Theater] importData error:', err);
            toastr.error('导入失败: ' + err.message);
        } finally {
            if (input.parentNode) input.parentNode.removeChild(input);
        }
    };
    input.click();
}

// ============================================================
// Helpers
// ============================================================
function refreshInstList() {
    const t = settings.instructionTemplates || [];
    $('#theater-instruction-list').html(t.length === 0 ? '<p class="theater-empty">暂无</p>' : t.map((item, i) => `<div class="theater-tag" data-index="${i}"><span class="theater-tag-text">${esc(item.name)}</span><span class="theater-tag-delete" data-index="${i}"><i class="fa-solid fa-xmark"></i></span></div>`).join(''));
}
function refreshHistList() {
    const h = settings.history || [];
    $('#theater-history-list').html(h.length === 0 ? '<p class="theater-empty">暂无</p>' : h.map((item, i) => historyItemHTML(item, i)).join(''));
}
function esc(s) { return !s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function save() { SillyTavern.getContext().saveSettingsDebounced(); }

jQuery(async () => { await init(); });
