// Theater Generator v1.2

const MODULE_NAME = 'theater_generator';
const VERSION = '1.2.0';

const DEFAULT_RENDER_TEMPLATE = `小剧场输出规范：

请输出一个完整的、可独立运行的HTML页面。要求如下：

1. 布局：单个居中容器（max-width: 480px），body背景transparent，内容区使用圆角卡片样式
2. 样式：简洁现代，使用无衬线字体，柔和配色，卡片带轻微阴影
3. 角色对话：用不同背景色区分不同角色的台词，角色名加粗
4. 旁白/叙述：用斜体或不同颜色与对话区分
5. 标题：用醒目但不夸张的样式
6. 响应式：适配手机屏幕
7. 不引用任何外部资源，所有样式内联
8. 所有代码放在一个完整的HTML文档中（DOCTYPE → html → head+style → body+内容）
9. 使用简体中文

输出格式：直接输出完整的HTML代码，不要用markdown代码块包裹。`;

const INTERACTIVE_ADDON = `

额外要求 - 交互模式：
- 必须包含可交互元素（按钮、选择、切换、展开收起等）
- 使用JavaScript实现点击事件和状态切换
- 可点击元素必须有:active缩放反馈
- 可包含：选项分支、隐藏内容揭示、角色回复切换、小游戏、投票等
- 交互必须有意义，不能是无效的伪交互`;

// ============================================================
// State
// ============================================================
let settings = {};
const defaultSettings = Object.freeze({
    contextRange: 20,
    instructionTemplates: [],
    renderTemplates: [],
    customSystemPrompt: '',
    useCurrentPreset: true,
    presetSections: [],
    presetSectionStates: [],
    history: [],
    interactiveMode: false,
    customCSS: '',
    useCustomAPI: false,
    apiUrl: '',
    apiKey: '',
    apiModel: '',
    userPersona: '',
    worldBookEntries: [],
    worldBookStates: [],
});

// ============================================================
// Init
// ============================================================
async function init() {
    const context = SillyTavern.getContext();
    const { extensionSettings, renderExtensionTemplateAsync, eventSource, event_types } = context;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    settings = extensionSettings[MODULE_NAME];

    // Settings panel
    const html = await renderExtensionTemplateAsync(`third-party/st-theater`, 'settings');
    $('#extensions_settings2').append(html);
    $('#theater-open-btn').on('click', openTheaterPopup);

    // Wand button - use APP_READY to ensure DOM is ready
    const addWandButton = () => {
        if ($('#theater-wand-btn').length) return;
        const $btn = $(`<div id="theater-wand-btn" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-masks-theater extensionsMenuExtensionButton"></div>小剧场
        </div>`);
        const $menu = $('#extensionsMenu');
        if ($menu.length) {
            $menu.append($btn);
            $btn.on('click', function (e) {
                e.stopPropagation();
                // Close the wand dropdown
                $(document).trigger('click');
                setTimeout(openTheaterPopup, 150);
            });
        }
    };

    // Try immediately + on APP_READY
    addWandButton();
    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, addWandButton);
    }

    applyCustomCSS();
    console.log(`[Theater] v${VERSION} loaded`);
}

// ============================================================
// Custom CSS
// ============================================================
function applyCustomCSS() {
    $('#theater-custom-css-inject').remove();
    if (settings.customCSS?.trim()) {
        $('head').append(`<style id="theater-custom-css-inject">${settings.customCSS}</style>`);
    }
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
        <p class="theater-subtitle">独立生成 · 不影响正文</p>
    </div>

    <div class="theater-tabs">
        <div class="theater-tab active" data-tab="instruct">指令</div>
        <div class="theater-tab" data-tab="template">模板</div>
        <div class="theater-tab" data-tab="preset">预设</div>
        <div class="theater-tab" data-tab="history">历史</div>
        <div class="theater-tab" data-tab="config">设置</div>
    </div>

    <div class="theater-panels-wrapper">

    <!-- ===== 指令 ===== -->
    <div class="theater-panel active" data-panel="instruct">
        <div class="theater-section">
            <label class="theater-label">小剧场指令</label>
            <textarea id="theater-instruction" class="theater-textarea" rows="4"
                placeholder="例如：暂停正文剧情，生成一个角色们一起吃火锅的番外小剧场"></textarea>

            <div class="theater-toggle-row">
                <label class="theater-toggle-label">
                    <input type="checkbox" id="theater-interactive-toggle" ${settings.interactiveMode ? 'checked' : ''}>
                    <span>交互模式</span>
                </label>
                <span class="theater-hint-inline">生成可点击/交互的小剧场</span>
            </div>

            <div class="theater-btn-row">
                <div id="theater-generate-btn" class="theater-btn primary generate">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>生成</span>
                </div>
                <div id="theater-save-instruction-btn" class="theater-btn">
                    <i class="fa-solid fa-floppy-disk"></i>
                    <span>存为模板</span>
                </div>
            </div>
        </div>

        <!-- Instruction template library -->
        <div class="theater-section">
            <div class="theater-section-header" id="theater-toggle-inst-lib">
                <label class="theater-label" style="margin:0;cursor:pointer;">
                    <i class="fa-solid fa-folder"></i> 指令模板库
                </label>
                <i class="fa-solid fa-chevron-down theater-chevron"></i>
            </div>
            <div id="theater-inst-lib-content" class="theater-collapsible">
                <div id="theater-instruction-list" class="theater-tag-list" style="margin-top:10px;">
                    ${inst.length === 0
                        ? '<p class="theater-empty">暂无保存的指令模板</p>'
                        : inst.map((t, i) => `
                            <div class="theater-tag" data-index="${i}">
                                <span class="theater-tag-text">${esc(t.name)}</span>
                                <span class="theater-tag-delete" data-index="${i}"><i class="fa-solid fa-xmark"></i></span>
                            </div>
                        `).join('')}
                </div>
            </div>
        </div>

        <!-- Output -->
        <div class="theater-section" id="theater-output-section" style="display:none;">
            <label class="theater-label">生成结果</label>
            <div id="theater-output-container">
                <iframe id="theater-output-frame" sandbox="allow-scripts allow-same-origin" class="theater-iframe"></iframe>
            </div>
            <div class="theater-btn-row">
                <div id="theater-save-history-btn" class="theater-btn"><i class="fa-solid fa-bookmark"></i><span>保存</span></div>
                <div id="theater-copy-html-btn" class="theater-btn"><i class="fa-solid fa-copy"></i><span>复制HTML</span></div>
            </div>
        </div>

        <div id="theater-loading" style="display:none;">
            <div class="theater-loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i><span>正在生成…</span></div>
        </div>
    </div>

    <!-- ===== 模板 ===== -->
    <div class="theater-panel" data-panel="template">
        <div class="theater-section">
            <label class="theater-label">渲染规则模板</label>
            <p class="theater-hint">控制小剧场的输出格式。可粘贴各位老师的小剧场规则作为模板。</p>

            <select id="theater-render-select" class="theater-select">
                <option value="__default__">默认模板（轻量卡片）</option>
                ${render.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}
            </select>

            <label class="theater-label" style="margin-top:14px;">模板内容</label>
            <textarea id="theater-render-content" class="theater-textarea" rows="8">${esc(DEFAULT_RENDER_TEMPLATE)}</textarea>

            <div class="theater-btn-row">
                <div id="theater-save-render-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存为新模板</span></div>
                <div id="theater-delete-render-btn" class="theater-btn danger" style="display:none;"><i class="fa-solid fa-trash"></i><span>删除当前</span></div>
            </div>
        </div>
    </div>

    <!-- ===== 预设 ===== -->
    <div class="theater-panel" data-panel="preset">

        <!-- API Source -->
        <div class="theater-section">
            <label class="theater-label">API 来源</label>
            <div class="theater-radio-group">
                <label class="theater-radio-label">
                    <input type="radio" name="theater-api-mode" value="main" ${!settings.useCustomAPI ? 'checked' : ''}>
                    <span>主 API（跟随当前设置）</span>
                </label>
                <label class="theater-radio-label">
                    <input type="radio" name="theater-api-mode" value="custom" ${settings.useCustomAPI ? 'checked' : ''}>
                    <span>独立 API</span>
                </label>
            </div>

            <div id="theater-custom-api-area" style="${settings.useCustomAPI ? '' : 'display:none'}; margin-top:10px;">
                <input id="theater-api-url" class="theater-input" placeholder="API URL（例如 https://api.openai.com）" value="${esc(settings.apiUrl || '')}">
                <input id="theater-api-key" class="theater-input" type="password" placeholder="API Key" value="${esc(settings.apiKey || '')}" style="margin-top:6px;">
                <input id="theater-api-model" class="theater-input" placeholder="模型名称（例如 gpt-4o）" value="${esc(settings.apiModel || '')}" style="margin-top:6px;">
                <div class="theater-btn-row">
                    <div id="theater-save-api-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div>
                </div>
            </div>
        </div>

        <!-- System Prompt -->
        <div class="theater-section">
            <label class="theater-label">System Prompt</label>
            <div class="theater-radio-group">
                <label class="theater-radio-label">
                    <input type="radio" name="theater-preset-mode" value="current" ${settings.useCurrentPreset ? 'checked' : ''}>
                    <span>跟随当前预设</span>
                </label>
                <label class="theater-radio-label">
                    <input type="radio" name="theater-preset-mode" value="custom" ${!settings.useCurrentPreset ? 'checked' : ''}>
                    <span>自定义</span>
                </label>
            </div>

            <div id="theater-custom-prompt-area" style="${settings.useCurrentPreset ? 'display:none' : ''}; margin-top:10px;">
                <textarea id="theater-custom-prompt" class="theater-textarea" rows="6"
                    placeholder="粘贴你想要的 System Prompt…">${esc(settings.customSystemPrompt || '')}</textarea>
                <div class="theater-btn-row">
                    <div id="theater-save-prompt-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div>
                </div>
            </div>
        </div>

        <!-- User Persona -->
        <div class="theater-section">
            <label class="theater-label">User 人设</label>
            <div class="theater-btn-row" style="margin-top:0;margin-bottom:8px;">
                <div id="theater-load-persona-btn" class="theater-btn"><i class="fa-solid fa-user"></i><span>从酒馆读取</span></div>
            </div>
            <textarea id="theater-user-persona" class="theater-textarea" rows="4"
                placeholder="填入你的人设信息，或者点击上方按钮从酒馆读取…">${esc(settings.userPersona || '')}</textarea>
            <div class="theater-btn-row">
                <div id="theater-save-persona-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div>
            </div>
        </div>

        <!-- World Book -->
        <div class="theater-section">
            <label class="theater-label">世界书</label>
            <div class="theater-btn-row" style="margin-top:0;margin-bottom:8px;">
                <div id="theater-load-worldbook-btn" class="theater-btn"><i class="fa-solid fa-book-atlas"></i><span>从酒馆读取</span></div>
                <div id="theater-wb-select-all" class="theater-btn"><i class="fa-solid fa-check-double"></i><span>全选</span></div>
                <div id="theater-wb-deselect-all" class="theater-btn"><i class="fa-solid fa-square"></i><span>全不选</span></div>
            </div>
            <div id="theater-worldbook-list">
                ${renderWorldBookEntries()}
            </div>
            <div class="theater-section-sub" style="margin-top:10px;">
                <label class="theater-label" style="font-size:.8em;">手动添加条目</label>
                <textarea id="theater-wb-manual" class="theater-textarea" rows="3"
                    placeholder="粘贴世界书内容，用空行分隔每个条目…"></textarea>
                <div class="theater-btn-row">
                    <div id="theater-wb-parse-btn" class="theater-btn"><i class="fa-solid fa-plus"></i><span>添加</span></div>
                </div>
            </div>
        </div>
    </div>

    <!-- ===== 历史 ===== -->
    <div class="theater-panel" data-panel="history">
        <div class="theater-section">
            <label class="theater-label">保存的小剧场</label>
            <div id="theater-history-list">
                ${hist.length === 0
                    ? '<p class="theater-empty">暂无保存的小剧场</p>'
                    : hist.map((h, i) => `
                        <div class="theater-history-item" data-index="${i}">
                            <div class="theater-history-header">
                                <span class="theater-history-title">${esc(h.title || `小剧场 #${i + 1}`)}</span>
                                <span class="theater-history-date">${h.date || ''}</span>
                            </div>
                            <div class="theater-history-actions">
                                <span class="theater-history-view" data-index="${i}"><i class="fa-solid fa-eye"></i> 查看</span>
                                <span class="theater-history-delete" data-index="${i}"><i class="fa-solid fa-trash"></i> 删除</span>
                            </div>
                        </div>
                    `).join('')}
            </div>
        </div>
    </div>

    <!-- ===== 设置 ===== -->
    <div class="theater-panel" data-panel="config">
        <div class="theater-section">
            <label class="theater-label">上下文消息数量 · <span id="theater-range-val">${settings.contextRange}</span> 条</label>
            <input id="theater-context-range" type="range" min="5" max="100" value="${settings.contextRange}" class="theater-slider">
            <p class="theater-hint">生成时读取最近多少条聊天消息作为剧情上下文。</p>
        </div>

        <div class="theater-section">
            <label class="theater-label">面板自定义 CSS</label>
            <p class="theater-hint">自定义插件面板样式。所有样式作用于 .theater-popup 内部。</p>
            <textarea id="theater-custom-css" class="theater-textarea theater-css-editor" rows="6"
                placeholder=".theater-popup { background: #1a1a2e; }&#10;.theater-tab.active { background: #e94560; }">${esc(settings.customCSS || '')}</textarea>
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
            </div>
        </div>

        <p class="theater-version">v${VERSION}</p>
    </div>

    </div>
</div>`;
}

function renderWorldBookEntries() {
    const entries = settings.worldBookEntries || [];
    const states = settings.worldBookStates || [];
    if (entries.length === 0) return '<p class="theater-empty">暂无世界书条目</p>';

    return entries.map((e, i) => `
        <div class="theater-preset-item">
            <label class="theater-preset-item-label">
                <input type="checkbox" class="theater-wb-check" data-index="${i}" ${states[i] !== false ? 'checked' : ''}>
                <span class="theater-preset-item-name">${esc(e.name || `条目 #${i + 1}`)}</span>
            </label>
            <div class="theater-preset-item-preview">${esc((e.content || '').substring(0, 100))}${(e.content || '').length > 100 ? '…' : ''}</div>
        </div>
    `).join('');
}

// ============================================================
// Open popup
// ============================================================
async function openTheaterPopup() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(buildPopupHTML(), POPUP_TYPE.TEXT, '', {
        wide: true,
        okButton: 'Close',
        allowVerticalScrolling: true,
    });
    const p = popup.show();
    await new Promise(r => setTimeout(r, 50));
    bindPopupEvents();
    await p;
}

// ============================================================
// Events
// ============================================================
function bindPopupEvents() {
    const $d = $(document);

    // Tabs
    $d.off('click.tt').on('click.tt', '.theater-tab', function () {
        $('.theater-tab').removeClass('active');
        $(this).addClass('active');
        $('.theater-panel').removeClass('active');
        $(`.theater-panel[data-panel="${$(this).data('tab')}"]`).addClass('active');
    });

    // Collapsible sections
    $d.off('click.tc').on('click.tc', '.theater-section-header', function () {
        $(this).next('.theater-collapsible').slideToggle(200);
        $(this).find('.theater-chevron').toggleClass('rotated');
    });

    // Generate
    $d.off('click.tg').on('click.tg', '#theater-generate-btn', generateTheater);

    // Interactive toggle
    $d.off('change.ti').on('change.ti', '#theater-interactive-toggle', function () {
        settings.interactiveMode = $(this).is(':checked');
        saveSettings();
    });

    // Save instruction
    $d.off('click.tsi').on('click.tsi', '#theater-save-instruction-btn', saveInstructionTemplate);

    // Tag click / delete
    $d.off('click.ttag').on('click.ttag', '.theater-tag .theater-tag-text', function () {
        const tmpl = settings.instructionTemplates[$(this).parent().data('index')];
        if (tmpl) $('#theater-instruction').val(tmpl.content);
    });
    $d.off('click.ttd').on('click.ttd', '.theater-tag-delete', function () {
        settings.instructionTemplates.splice($(this).data('index'), 1);
        saveSettings();
        refreshInstructionList();
    });

    // Render template
    $d.off('change.tr').on('change.tr', '#theater-render-select', function () {
        const v = $(this).val();
        if (v === '__default__') {
            $('#theater-render-content').val(DEFAULT_RENDER_TEMPLATE);
            $('#theater-delete-render-btn').hide();
        } else {
            const t = settings.renderTemplates[parseInt(v)];
            if (t) $('#theater-render-content').val(t.content);
            $('#theater-delete-render-btn').show();
        }
    });
    $d.off('click.tsr').on('click.tsr', '#theater-save-render-btn', saveRenderTemplate);
    $d.off('click.tdr').on('click.tdr', '#theater-delete-render-btn', deleteRenderTemplate);

    // API mode
    $d.off('change.tam').on('change.tam', 'input[name="theater-api-mode"]', function () {
        settings.useCustomAPI = $(this).val() === 'custom';
        $('#theater-custom-api-area').toggle(settings.useCustomAPI);
        saveSettings();
    });

    // Save API settings
    $d.off('click.tsa').on('click.tsa', '#theater-save-api-btn', function () {
        settings.apiUrl = $('#theater-api-url').val().trim().replace(/\/+$/, '');
        settings.apiKey = $('#theater-api-key').val().trim();
        settings.apiModel = $('#theater-api-model').val().trim();
        saveSettings();
        toastr.success('API 设置已保存');
    });

    // Preset mode
    $d.off('change.tp').on('change.tp', 'input[name="theater-preset-mode"]', function () {
        settings.useCurrentPreset = $(this).val() === 'current';
        $('#theater-custom-prompt-area').toggle(!settings.useCurrentPreset);
        saveSettings();
    });

    // Save custom prompt
    $d.off('click.tsp').on('click.tsp', '#theater-save-prompt-btn', function () {
        settings.customSystemPrompt = $('#theater-custom-prompt').val();
        saveSettings();
        toastr.success('已保存');
    });

    // User persona
    $d.off('click.tlp').on('click.tlp', '#theater-load-persona-btn', loadUserPersona);
    $d.off('click.tsper').on('click.tsper', '#theater-save-persona-btn', function () {
        settings.userPersona = $('#theater-user-persona').val();
        saveSettings();
        toastr.success('已保存');
    });

    // World book
    $d.off('click.tlw').on('click.tlw', '#theater-load-worldbook-btn', loadWorldBook);
    $d.off('change.twb').on('change.twb', '.theater-wb-check', function () {
        if (!settings.worldBookStates) settings.worldBookStates = [];
        settings.worldBookStates[$(this).data('index')] = $(this).is(':checked');
        saveSettings();
    });
    $d.off('click.twsa').on('click.twsa', '#theater-wb-select-all', function () {
        settings.worldBookStates = (settings.worldBookEntries || []).map(() => true);
        $('.theater-wb-check').prop('checked', true);
        saveSettings();
    });
    $d.off('click.twda').on('click.twda', '#theater-wb-deselect-all', function () {
        settings.worldBookStates = (settings.worldBookEntries || []).map(() => false);
        $('.theater-wb-check').prop('checked', false);
        saveSettings();
    });
    $d.off('click.twp').on('click.twp', '#theater-wb-parse-btn', function () {
        const text = $('#theater-wb-manual').val().trim();
        if (!text) return;
        const parts = text.split(/\n{2,}/).filter(s => s.trim());
        parts.forEach(p => {
            settings.worldBookEntries.push({
                name: p.substring(0, 30).replace(/\n/g, ' ').trim(),
                content: p.trim(),
            });
            settings.worldBookStates.push(true);
        });
        saveSettings();
        $('#theater-worldbook-list').html(renderWorldBookEntries());
        $('#theater-wb-manual').val('');
        toastr.success(`添加了 ${parts.length} 个条目`);
    });

    // History
    $d.off('click.tsh').on('click.tsh', '#theater-save-history-btn', saveToHistory);
    $d.off('click.tch').on('click.tch', '#theater-copy-html-btn', copyHtml);
    $d.off('click.thv').on('click.thv', '.theater-history-view', function () {
        const item = settings.history[$(this).data('index')];
        if (item) {
            showInIframe(item.html);
            $('.theater-tab').removeClass('active').filter('[data-tab="instruct"]').addClass('active');
            $('.theater-panel').removeClass('active').filter('[data-panel="instruct"]').addClass('active');
            $('#theater-output-section').show();
        }
    });
    $d.off('click.thd').on('click.thd', '.theater-history-delete', function () {
        settings.history.splice($(this).data('index'), 1);
        saveSettings();
        refreshHistoryList();
    });

    // Settings
    $d.off('input.trng').on('input.trng', '#theater-context-range', function () {
        const v = $(this).val();
        $('#theater-range-val').text(v);
        settings.contextRange = parseInt(v);
        saveSettings();
    });

    // CSS
    $d.off('click.tcss').on('click.tcss', '#theater-save-css-btn', function () {
        settings.customCSS = $('#theater-custom-css').val();
        saveSettings();
        applyCustomCSS();
        toastr.success('样式已应用');
    });
    $d.off('click.trcss').on('click.trcss', '#theater-reset-css-btn', function () {
        settings.customCSS = '';
        $('#theater-custom-css').val('');
        saveSettings();
        applyCustomCSS();
        toastr.info('已重置');
    });

    // Import / Export
    $d.off('click.tex').on('click.tex', '#theater-export-btn', exportData);
    $d.off('click.tim').on('click.tim', '#theater-import-btn', importData);
}

// ============================================================
// Load user persona from ST
// ============================================================
function loadUserPersona() {
    try {
        const ctx = SillyTavern.getContext();
        let persona = '';

        // Try power user settings
        if (ctx.powerUserSettings?.persona_description) {
            persona = ctx.powerUserSettings.persona_description;
        }

        // Add user name
        if (ctx.name1) {
            persona = `[用户名: ${ctx.name1}]\n${persona}`;
        }

        if (persona.trim()) {
            $('#theater-user-persona').val(persona.trim());
            settings.userPersona = persona.trim();
            saveSettings();
            toastr.success('已读取 User 人设');
        } else {
            toastr.warning('未找到 User 人设信息，请手动填写');
        }
    } catch (e) {
        console.error('[Theater] Load persona error:', e);
        toastr.error('读取失败，请手动填写');
    }
}

// ============================================================
// Load world book from ST
// ============================================================
function loadWorldBook() {
    try {
        const ctx = SillyTavern.getContext();
        let entries = [];

        // Try to get world info from chat metadata
        if (ctx.chatMetadata?.world_info_data) {
            const data = ctx.chatMetadata.world_info_data;
            if (data.entries) {
                entries = Object.values(data.entries).map(e => ({
                    name: e.comment || e.key?.join(', ') || '未命名',
                    content: e.content || '',
                })).filter(e => e.content);
            }
        }

        // Try extension settings world info
        if (entries.length === 0 && ctx.extensionSettings?.worldInfo) {
            const wi = ctx.extensionSettings.worldInfo;
            if (wi.entries) {
                entries = Object.values(wi.entries).map(e => ({
                    name: e.comment || e.key?.join(', ') || '未命名',
                    content: e.content || '',
                })).filter(e => e.content);
            }
        }

        if (entries.length > 0) {
            settings.worldBookEntries = entries;
            settings.worldBookStates = entries.map(() => true);
            saveSettings();
            $('#theater-worldbook-list').html(renderWorldBookEntries());
            toastr.success(`已读取 ${entries.length} 个世界书条目`);
        } else {
            toastr.warning('未能自动读取世界书，请手动添加条目');
        }
    } catch (e) {
        console.error('[Theater] Load world book error:', e);
        toastr.error('读取失败，请手动添加');
    }
}

// ============================================================
// Generation
// ============================================================
let lastGeneratedHtml = '';

async function generateTheater() {
    const instruction = $('#theater-instruction').val().trim();
    if (!instruction) { toastr.warning('请输入小剧场指令'); return; }

    const ctx = SillyTavern.getContext();
    const { chat, characters, characterId, name1, name2 } = ctx;

    if (!chat || chat.length === 0) { toastr.warning('当前没有聊天记录'); return; }

    // Chat context
    const recentChat = chat.slice(-(settings.contextRange || 20));
    const chatContext = recentChat.map(m => {
        const name = m.is_user ? (name1 || 'User') : (m.name || name2 || 'Character');
        return `${name}: ${m.mes}`;
    }).join('\n\n');

    // Character info
    let charInfo = '';
    if (characterId !== undefined && characters[characterId]) {
        const c = characters[characterId];
        const desc = c.data?.description || c.description || '';
        const pers = c.data?.personality || c.personality || '';
        if (desc) charInfo += `角色设定：\n${desc}\n\n`;
        if (pers) charInfo += `角色性格：\n${pers}\n\n`;
    }

    // User persona
    let personaInfo = '';
    if (settings.userPersona?.trim()) {
        personaInfo = `User人设：\n${settings.userPersona}\n\n`;
    }

    // World book
    let worldBookInfo = '';
    const wbEntries = (settings.worldBookEntries || [])
        .filter((_e, i) => settings.worldBookStates?.[i] !== false)
        .map(e => e.content);
    if (wbEntries.length > 0) {
        worldBookInfo = `世界书设定：\n${wbEntries.join('\n\n')}\n\n`;
    }

    // Render template
    let renderRules = DEFAULT_RENDER_TEMPLATE;
    const renderSel = $('#theater-render-select').val();
    if (renderSel !== '__default__') {
        const t = settings.renderTemplates[parseInt(renderSel)];
        if (t) renderRules = t.content;
    }
    if (settings.interactiveMode) renderRules += INTERACTIVE_ADDON;

    const prompt = `${charInfo}${personaInfo}${worldBookInfo}以下是最近的剧情内容：
${chatContext}

---

${renderRules}

---

用户指令：${instruction}

请根据以上角色设定、人设、世界观、剧情上下文和用户指令，生成一个小剧场。严格遵守渲染规则中的输出格式要求。`;

    let systemPrompt = '你是一个创意写作助手，擅长根据角色设定和剧情上下文生成生动有趣的小剧场/番外。你需要严格按照用户提供的渲染规则格式输出。';
    if (!settings.useCurrentPreset && settings.customSystemPrompt) {
        systemPrompt = settings.customSystemPrompt;
    }

    $('#theater-loading').show();
    $('#theater-output-section').hide();
    $('#theater-generate-btn').addClass('disabled');

    try {
        let result;

        if (settings.useCustomAPI && settings.apiUrl && settings.apiKey && settings.apiModel) {
            result = await callCustomAPI(systemPrompt, prompt);
        } else {
            const { generateRaw } = ctx;
            result = await generateRaw({ systemPrompt, prompt });
        }

        if (!result) { toastr.error('生成失败，API未返回内容'); return; }

        lastGeneratedHtml = extractHtml(result);
        showInIframe(lastGeneratedHtml);
        $('#theater-output-section').show();
        toastr.success('生成完成');
    } catch (err) {
        console.error('[Theater] Error:', err);
        toastr.error('生成失败: ' + (err.message || '未知错误'));
    } finally {
        $('#theater-loading').hide();
        $('#theater-generate-btn').removeClass('disabled');
    }
}

// ============================================================
// Custom API call
// ============================================================
async function callCustomAPI(systemPrompt, userPrompt) {
    const url = settings.apiUrl.replace(/\/+$/, '');
    const endpoint = url.includes('/v1') ? url + '/chat/completions' : url + '/v1/chat/completions';

    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
            model: settings.apiModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            stream: false,
        }),
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
}

// ============================================================
// HTML extraction
// ============================================================
function extractHtml(text) {
    const m1 = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/);
    if (m1) return m1[1].trim();
    const m2 = text.match(/(<!DOCTYPE[\s\S]*?<\/html>)/i);
    if (m2) return m2[1].trim();
    const m3 = text.match(/(<html[\s\S]*?<\/html>)/i);
    if (m3) return m3[1].trim();
    const m4 = text.match(/<snow>([\s\S]*?)<\/snow>/i);
    if (m4) {
        const inner = m4[1].match(/```(?:html)?\s*\n?([\s\S]*?)```/);
        if (inner) return inner[1].trim();
        return m4[1].trim();
    }
    if (text.includes('<div') || text.includes('<p') || text.includes('<style')) return text.trim();
    return `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:20px;max-width:480px;margin:0 auto;background:transparent}.card{background:#fafafa;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.1);line-height:1.7;font-size:15px}</style></head><body><div class="card">${text}</div></body></html>`;
}

function showInIframe(html) {
    const iframe = document.getElementById('theater-output-frame');
    if (!iframe) return;
    iframe.srcdoc = html;
    iframe.onload = () => {
        try {
            const h = (iframe.contentDocument || iframe.contentWindow.document).documentElement.scrollHeight;
            iframe.style.height = Math.min(Math.max(h + 20, 200), 600) + 'px';
        } catch { iframe.style.height = '400px'; }
    };
}

// ============================================================
// Template management
// ============================================================
async function saveInstructionTemplate() {
    const content = $('#theater-instruction').val().trim();
    if (!content) { toastr.warning('请先输入指令'); return; }
    const name = await SillyTavern.getContext().Popup.show.input('保存指令模板', '名字：', content.substring(0, 20));
    if (!name) return;
    settings.instructionTemplates.push({ name, content });
    saveSettings();
    refreshInstructionList();
    toastr.success('已保存');
}

async function saveRenderTemplate() {
    const content = $('#theater-render-content').val().trim();
    if (!content) { toastr.warning('内容不能为空'); return; }
    const name = await SillyTavern.getContext().Popup.show.input('保存渲染模板', '名字：');
    if (!name) return;
    settings.renderTemplates.push({ name, content });
    saveSettings();
    const idx = settings.renderTemplates.length - 1;
    $('#theater-render-select').append(`<option value="${idx}">${esc(name)}</option>`).val(idx.toString());
    $('#theater-delete-render-btn').show();
    toastr.success('已保存');
}

function deleteRenderTemplate() {
    const v = $('#theater-render-select').val();
    if (v === '__default__') { toastr.warning('默认模板不能删除'); return; }
    settings.renderTemplates.splice(parseInt(v), 1);
    saveSettings();
    const sel = $('#theater-render-select');
    sel.find('option:not([value="__default__"])').remove();
    settings.renderTemplates.forEach((t, i) => sel.append(`<option value="${i}">${esc(t.name)}</option>`));
    sel.val('__default__');
    $('#theater-render-content').val(DEFAULT_RENDER_TEMPLATE);
    $('#theater-delete-render-btn').hide();
}

// ============================================================
// History
// ============================================================
async function saveToHistory() {
    if (!lastGeneratedHtml) { toastr.warning('没有可保存的内容'); return; }
    const title = await SillyTavern.getContext().Popup.show.input('保存小剧场', '标题：', `小剧场 ${settings.history.length + 1}`);
    if (!title) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    settings.history.push({
        title, html: lastGeneratedHtml,
        instruction: $('#theater-instruction').val(),
        date: `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    });
    saveSettings();
    refreshHistoryList();
    toastr.success('已保存');
}

function copyHtml() {
    if (!lastGeneratedHtml) { toastr.warning('无内容'); return; }
    navigator.clipboard.writeText(lastGeneratedHtml).then(() => toastr.success('已复制')).catch(() => toastr.error('复制失败'));
}

// ============================================================
// Import / Export
// ============================================================
function exportData() {
    const blob = new Blob([JSON.stringify({
        version: VERSION,
        instructionTemplates: settings.instructionTemplates,
        renderTemplates: settings.renderTemplates,
        history: settings.history,
        customSystemPrompt: settings.customSystemPrompt,
        contextRange: settings.contextRange,
        customCSS: settings.customCSS,
        userPersona: settings.userPersona,
        worldBookEntries: settings.worldBookEntries,
        worldBookStates: settings.worldBookStates,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `theater-data-${Date.now()}.json`;
    a.click();
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const d = JSON.parse(await file.text());
            for (const k of ['instructionTemplates', 'renderTemplates', 'history', 'customSystemPrompt',
                'contextRange', 'customCSS', 'userPersona', 'worldBookEntries', 'worldBookStates']) {
                if (d[k] !== undefined) settings[k] = d[k];
            }
            saveSettings();
            applyCustomCSS();
            toastr.success('导入成功，请重新打开面板');
        } catch (err) { toastr.error('导入失败: ' + err.message); }
    };
    input.click();
}

// ============================================================
// UI helpers
// ============================================================
function refreshInstructionList() {
    const t = settings.instructionTemplates || [];
    $('#theater-instruction-list').html(t.length === 0
        ? '<p class="theater-empty">暂无保存的指令模板</p>'
        : t.map((item, i) => `<div class="theater-tag" data-index="${i}"><span class="theater-tag-text">${esc(item.name)}</span><span class="theater-tag-delete" data-index="${i}"><i class="fa-solid fa-xmark"></i></span></div>`).join(''));
}

function refreshHistoryList() {
    const h = settings.history || [];
    $('#theater-history-list').html(h.length === 0
        ? '<p class="theater-empty">暂无保存的小剧场</p>'
        : h.map((item, i) => `<div class="theater-history-item" data-index="${i}"><div class="theater-history-header"><span class="theater-history-title">${esc(item.title || `#${i + 1}`)}</span><span class="theater-history-date">${item.date || ''}</span></div><div class="theater-history-actions"><span class="theater-history-view" data-index="${i}"><i class="fa-solid fa-eye"></i> 查看</span><span class="theater-history-delete" data-index="${i}"><i class="fa-solid fa-trash"></i> 删除</span></div></div>`).join(''));
}

function esc(s) { return !s ? '' : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function saveSettings() { SillyTavern.getContext().saveSettingsDebounced(); }

jQuery(async () => { await init(); });
