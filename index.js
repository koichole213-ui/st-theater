// 小剧场生成器 / Theater Generator
// by 褚禾 & 小克

const MODULE_NAME = 'theater_generator';
const VERSION = '1.0.0';

// ============================================================
// Default render template (lightweight card style)
// ============================================================
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
    history: [],
});

// ============================================================
// Initialization
// ============================================================
async function init() {
    const context = SillyTavern.getContext();
    const { extensionSettings, renderExtensionTemplateAsync } = context;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    settings = extensionSettings[MODULE_NAME];

    const html = await renderExtensionTemplateAsync(
        `third-party/st-theater`,
        'settings'
    );
    $('#extensions_settings2').append(html);
    $('#theater-open-btn').on('click', openTheaterPopup);

    console.log(`[Theater] v${VERSION} loaded`);
}

// ============================================================
// Build popup HTML
// ============================================================
function buildPopupHTML() {
    const instructionTemplates = settings.instructionTemplates || [];
    const renderTemplates = settings.renderTemplates || [];
    const history = settings.history || [];

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

    <!-- 指令 -->
    <div class="theater-panel active" data-panel="instruct">
        <div class="theater-section">
            <label class="theater-label">小剧场指令</label>
            <textarea id="theater-instruction" class="theater-textarea" rows="4"
                placeholder="例如：暂停正文剧情，生成一个角色们一起吃火锅的番外小剧场"></textarea>
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

        <div class="theater-section" id="theater-instruction-templates">
            <label class="theater-label">已保存的指令模板</label>
            <div id="theater-instruction-list" class="theater-tag-list">
                ${instructionTemplates.length === 0
                    ? '<p class="theater-empty">暂无保存的指令模板</p>'
                    : instructionTemplates.map((t, i) => `
                        <div class="theater-tag" data-index="${i}">
                            <span class="theater-tag-text">${escapeHtml(t.name)}</span>
                            <span class="theater-tag-delete" data-index="${i}"><i class="fa-solid fa-xmark"></i></span>
                        </div>
                    `).join('')}
            </div>
        </div>

        <div class="theater-section" id="theater-output-section" style="display:none;">
            <label class="theater-label">生成结果</label>
            <div id="theater-output-container">
                <iframe id="theater-output-frame" sandbox="allow-scripts allow-same-origin" class="theater-iframe"></iframe>
            </div>
            <div class="theater-btn-row">
                <div id="theater-save-history-btn" class="theater-btn">
                    <i class="fa-solid fa-bookmark"></i>
                    <span>保存</span>
                </div>
                <div id="theater-copy-html-btn" class="theater-btn">
                    <i class="fa-solid fa-copy"></i>
                    <span>复制HTML</span>
                </div>
            </div>
        </div>

        <div id="theater-loading" style="display:none;">
            <div class="theater-loading-spinner">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <span>正在生成小剧场…</span>
            </div>
        </div>
    </div>

    <!-- 模板 -->
    <div class="theater-panel" data-panel="template">
        <div class="theater-section">
            <label class="theater-label">渲染规则模板</label>
            <p class="theater-hint">控制小剧场的输出格式。默认模板提供简洁卡片样式，也可以粘贴其他老师的小剧场规则。</p>

            <label class="theater-label" style="margin-top:12px;">当前模板</label>
            <select id="theater-render-select" class="theater-select">
                <option value="__default__">默认模板（轻量卡片）</option>
                ${renderTemplates.map((t, i) => `
                    <option value="${i}">${escapeHtml(t.name)}</option>
                `).join('')}
            </select>

            <label class="theater-label" style="margin-top:14px;">模板内容</label>
            <textarea id="theater-render-content" class="theater-textarea" rows="8">${escapeHtml(DEFAULT_RENDER_TEMPLATE)}</textarea>

            <div class="theater-btn-row">
                <div id="theater-save-render-btn" class="theater-btn primary">
                    <i class="fa-solid fa-floppy-disk"></i>
                    <span>保存为新模板</span>
                </div>
                <div id="theater-delete-render-btn" class="theater-btn danger" style="display:none;">
                    <i class="fa-solid fa-trash"></i>
                    <span>删除当前</span>
                </div>
            </div>
        </div>
    </div>

    <!-- 预设 -->
    <div class="theater-panel" data-panel="preset">
        <div class="theater-section">
            <label class="theater-label">生成预设</label>
            <p class="theater-hint">选择小剧场生成时使用的系统提示词风格。</p>

            <div class="theater-radio-group">
                <label class="theater-radio-label">
                    <input type="radio" name="theater-preset-mode" value="current" ${settings.useCurrentPreset ? 'checked' : ''}>
                    <span>跟随当前 API 设置</span>
                </label>
                <label class="theater-radio-label">
                    <input type="radio" name="theater-preset-mode" value="custom" ${!settings.useCurrentPreset ? 'checked' : ''}>
                    <span>自定义 System Prompt</span>
                </label>
            </div>

            <div id="theater-custom-prompt-area" style="${settings.useCurrentPreset ? 'display:none' : ''}; margin-top:12px;">
                <textarea id="theater-custom-prompt" class="theater-textarea" rows="8"
                    placeholder="粘贴你想要的预设 System Prompt…">${escapeHtml(settings.customSystemPrompt || '')}</textarea>
                <div class="theater-btn-row">
                    <div id="theater-save-prompt-btn" class="theater-btn primary">
                        <i class="fa-solid fa-floppy-disk"></i>
                        <span>保存</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 历史 -->
    <div class="theater-panel" data-panel="history">
        <div class="theater-section">
            <label class="theater-label">保存的小剧场</label>
            <div id="theater-history-list">
                ${history.length === 0
                    ? '<p class="theater-empty">暂无保存的小剧场</p>'
                    : history.map((h, i) => `
                        <div class="theater-history-item" data-index="${i}">
                            <div class="theater-history-header">
                                <span class="theater-history-title">${escapeHtml(h.title || `小剧场 #${i + 1}`)}</span>
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

    <!-- 设置 -->
    <div class="theater-panel" data-panel="config">
        <div class="theater-section">
            <label class="theater-label">上下文消息数量 · <span id="theater-range-val">${settings.contextRange}</span> 条</label>
            <input id="theater-context-range" type="range" min="5" max="100" value="${settings.contextRange}" class="theater-slider">
            <p class="theater-hint">生成时读取最近多少条聊天消息作为剧情上下文。</p>
        </div>

        <div class="theater-section">
            <label class="theater-label">数据管理</label>
            <div class="theater-btn-row">
                <div id="theater-export-btn" class="theater-btn">
                    <i class="fa-solid fa-download"></i>
                    <span>导出</span>
                </div>
                <div id="theater-import-btn" class="theater-btn">
                    <i class="fa-solid fa-upload"></i>
                    <span>导入</span>
                </div>
            </div>
        </div>

        <p class="theater-version">v${VERSION} · 褚禾 & 小克</p>
    </div>
</div>`;
}

// ============================================================
// Open popup
// ============================================================
async function openTheaterPopup() {
    const context = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = context;

    const html = buildPopupHTML();
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        wide: true,
        okButton: 'Close',
        allowVerticalScrolling: true,
    });

    const popupPromise = popup.show();
    await new Promise(r => setTimeout(r, 50));
    bindPopupEvents();
    await popupPromise;
}

// ============================================================
// Bind popup events
// ============================================================
function bindPopupEvents() {
    // Tab switching
    $(document).off('click.theater-tab').on('click.theater-tab', '.theater-tab', function () {
        const tab = $(this).data('tab');
        $('.theater-tab').removeClass('active');
        $(this).addClass('active');
        $('.theater-panel').removeClass('active');
        $(`.theater-panel[data-panel="${tab}"]`).addClass('active');
    });

    // Generate
    $(document).off('click.theater-gen').on('click.theater-gen', '#theater-generate-btn', generateTheater);

    // Save instruction template
    $(document).off('click.theater-save-inst').on('click.theater-save-inst', '#theater-save-instruction-btn', saveInstructionTemplate);

    // Instruction tag click → fill
    $(document).off('click.theater-tag').on('click.theater-tag', '.theater-tag .theater-tag-text', function () {
        const idx = $(this).parent().data('index');
        const tmpl = settings.instructionTemplates[idx];
        if (tmpl) $('#theater-instruction').val(tmpl.content);
    });

    // Instruction tag delete
    $(document).off('click.theater-tag-del').on('click.theater-tag-del', '.theater-tag-delete', function () {
        const idx = $(this).data('index');
        settings.instructionTemplates.splice(idx, 1);
        saveSettings();
        refreshInstructionList();
    });

    // Render template select
    $(document).off('change.theater-render').on('change.theater-render', '#theater-render-select', function () {
        const val = $(this).val();
        if (val === '__default__') {
            $('#theater-render-content').val(DEFAULT_RENDER_TEMPLATE);
            $('#theater-delete-render-btn').hide();
        } else {
            const idx = parseInt(val);
            const tmpl = settings.renderTemplates[idx];
            if (tmpl) $('#theater-render-content').val(tmpl.content);
            $('#theater-delete-render-btn').show();
        }
    });

    // Save / delete render template
    $(document).off('click.theater-save-render').on('click.theater-save-render', '#theater-save-render-btn', saveRenderTemplate);
    $(document).off('click.theater-del-render').on('click.theater-del-render', '#theater-delete-render-btn', deleteRenderTemplate);

    // Preset mode toggle
    $(document).off('change.theater-preset').on('change.theater-preset', 'input[name="theater-preset-mode"]', function () {
        const isCustom = $(this).val() === 'custom';
        settings.useCurrentPreset = !isCustom;
        $('#theater-custom-prompt-area').toggle(isCustom);
        saveSettings();
    });

    // Save custom prompt
    $(document).off('click.theater-save-prompt').on('click.theater-save-prompt', '#theater-save-prompt-btn', function () {
        settings.customSystemPrompt = $('#theater-custom-prompt').val();
        saveSettings();
        toastr.success('已保存');
    });

    // History
    $(document).off('click.theater-save-hist').on('click.theater-save-hist', '#theater-save-history-btn', saveToHistory);
    $(document).off('click.theater-copy').on('click.theater-copy', '#theater-copy-html-btn', copyHtmlToClipboard);

    $(document).off('click.theater-hist-view').on('click.theater-hist-view', '.theater-history-view', function () {
        const idx = $(this).data('index');
        const item = settings.history[idx];
        if (item) {
            showInIframe(item.html);
            $('.theater-tab').removeClass('active');
            $('.theater-tab[data-tab="instruct"]').addClass('active');
            $('.theater-panel').removeClass('active');
            $('.theater-panel[data-panel="instruct"]').addClass('active');
            $('#theater-output-section').show();
        }
    });

    $(document).off('click.theater-hist-del').on('click.theater-hist-del', '.theater-history-delete', function () {
        const idx = $(this).data('index');
        settings.history.splice(idx, 1);
        saveSettings();
        refreshHistoryList();
        toastr.info('已删除');
    });

    // Context range
    $(document).off('input.theater-range').on('input.theater-range', '#theater-context-range', function () {
        const val = $(this).val();
        $('#theater-range-val').text(val);
        settings.contextRange = parseInt(val);
        saveSettings();
    });

    // Import / export
    $(document).off('click.theater-export').on('click.theater-export', '#theater-export-btn', exportData);
    $(document).off('click.theater-import').on('click.theater-import', '#theater-import-btn', importData);
}

// ============================================================
// Generation
// ============================================================
let lastGeneratedHtml = '';

async function generateTheater() {
    const instruction = $('#theater-instruction').val().trim();
    if (!instruction) {
        toastr.warning('请输入小剧场指令');
        return;
    }

    const context = SillyTavern.getContext();
    const { chat, characters, characterId, name1, name2, generateRaw } = context;

    if (!chat || chat.length === 0) {
        toastr.warning('当前没有聊天记录');
        return;
    }

    const rangeCount = settings.contextRange || 20;
    const recentChat = chat.slice(-rangeCount);
    const chatContext = recentChat.map(msg => {
        const name = msg.is_user ? (name1 || 'User') : (msg.name || name2 || 'Character');
        return `${name}: ${msg.mes}`;
    }).join('\n\n');

    let charInfo = '';
    if (characterId !== undefined && characters[characterId]) {
        const char = characters[characterId];
        const desc = char.data?.description || char.description || '';
        const persona = char.data?.personality || char.personality || '';
        if (desc) charInfo += `角色设定：\n${desc}\n\n`;
        if (persona) charInfo += `角色性格：\n${persona}\n\n`;
    }

    const renderSelect = $('#theater-render-select').val();
    let renderRules = DEFAULT_RENDER_TEMPLATE;
    if (renderSelect !== '__default__') {
        const idx = parseInt(renderSelect);
        if (settings.renderTemplates[idx]) {
            renderRules = settings.renderTemplates[idx].content;
        }
    }

    const prompt = `${charInfo}以下是最近的剧情内容：
${chatContext}

---

${renderRules}

---

用户指令：${instruction}

请根据以上角色设定、剧情上下文和用户指令，生成一个小剧场。严格遵守渲染规则中的输出格式要求。`;

    let systemPrompt = '你是一个创意写作助手，擅长根据角色设定和剧情上下文生成生动有趣的小剧场/番外。你需要严格按照用户提供的渲染规则格式输出。';
    if (!settings.useCurrentPreset && settings.customSystemPrompt) {
        systemPrompt = settings.customSystemPrompt;
    }

    $('#theater-loading').show();
    $('#theater-output-section').hide();
    $('#theater-generate-btn').addClass('disabled');

    try {
        const result = await generateRaw({ systemPrompt, prompt });

        if (!result) {
            toastr.error('生成失败，API未返回内容');
            return;
        }

        const htmlContent = extractHtml(result);
        lastGeneratedHtml = htmlContent;
        showInIframe(htmlContent);
        $('#theater-output-section').show();
        toastr.success('生成完成');
    } catch (err) {
        console.error('[Theater] Generation error:', err);
        toastr.error('生成失败: ' + (err.message || '未知错误'));
    } finally {
        $('#theater-loading').hide();
        $('#theater-generate-btn').removeClass('disabled');
    }
}

// ============================================================
// HTML extraction
// ============================================================
function extractHtml(text) {
    const codeBlockMatch = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    const htmlDocMatch = text.match(/(<!DOCTYPE[\s\S]*?<\/html>)/i);
    if (htmlDocMatch) return htmlDocMatch[1].trim();

    const htmlTagMatch = text.match(/(<html[\s\S]*?<\/html>)/i);
    if (htmlTagMatch) return htmlTagMatch[1].trim();

    const snowMatch = text.match(/<snow>([\s\S]*?)<\/snow>/i);
    if (snowMatch) {
        const innerCode = snowMatch[1].match(/```(?:html)?\s*\n?([\s\S]*?)```/);
        if (innerCode) return innerCode[1].trim();
        return snowMatch[1].trim();
    }

    if (text.includes('<div') || text.includes('<p') || text.includes('<style')) {
        return text.trim();
    }

    return `<!DOCTYPE html>
<html><head><style>
body{font-family:system-ui,sans-serif;padding:20px;max-width:480px;margin:0 auto;background:transparent}
.card{background:#fafafa;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.1);line-height:1.7;font-size:15px}
</style></head><body><div class="card">${text}</div></body></html>`;
}

// ============================================================
// Iframe
// ============================================================
function showInIframe(html) {
    const iframe = document.getElementById('theater-output-frame');
    if (!iframe) return;
    iframe.srcdoc = html;
    iframe.onload = function () {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            const h = doc.documentElement.scrollHeight || doc.body.scrollHeight;
            iframe.style.height = Math.min(Math.max(h + 20, 200), 600) + 'px';
        } catch (e) {
            iframe.style.height = '400px';
        }
    };
}

// ============================================================
// Template management
// ============================================================
async function saveInstructionTemplate() {
    const content = $('#theater-instruction').val().trim();
    if (!content) { toastr.warning('请先输入指令'); return; }

    const { Popup } = SillyTavern.getContext();
    const name = await Popup.show.input('保存指令模板', '给这条指令起个名字：', content.substring(0, 20));
    if (!name) return;

    settings.instructionTemplates.push({ name, content });
    saveSettings();
    refreshInstructionList();
    toastr.success('已保存');
}

async function saveRenderTemplate() {
    const content = $('#theater-render-content').val().trim();
    if (!content) { toastr.warning('内容不能为空'); return; }

    const { Popup } = SillyTavern.getContext();
    const name = await Popup.show.input('保存渲染模板', '给模板起个名字：');
    if (!name) return;

    settings.renderTemplates.push({ name, content });
    saveSettings();
    const idx = settings.renderTemplates.length - 1;
    $('#theater-render-select').append(`<option value="${idx}">${escapeHtml(name)}</option>`).val(idx.toString());
    $('#theater-delete-render-btn').show();
    toastr.success('已保存');
}

function deleteRenderTemplate() {
    const val = $('#theater-render-select').val();
    if (val === '__default__') { toastr.warning('默认模板不能删除'); return; }

    settings.renderTemplates.splice(parseInt(val), 1);
    saveSettings();
    const select = $('#theater-render-select');
    select.find('option:not([value="__default__"])').remove();
    settings.renderTemplates.forEach((t, i) => {
        select.append(`<option value="${i}">${escapeHtml(t.name)}</option>`);
    });
    select.val('__default__');
    $('#theater-render-content').val(DEFAULT_RENDER_TEMPLATE);
    $('#theater-delete-render-btn').hide();
    toastr.info('已删除');
}

// ============================================================
// History
// ============================================================
async function saveToHistory() {
    if (!lastGeneratedHtml) { toastr.warning('没有可保存的内容'); return; }

    const { Popup } = SillyTavern.getContext();
    const title = await Popup.show.input('保存小剧场', '起个标题：', `小剧场 ${settings.history.length + 1}`);
    if (!title) return;

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    settings.history.push({ title, html: lastGeneratedHtml, instruction: $('#theater-instruction').val(), date });
    saveSettings();
    refreshHistoryList();
    toastr.success('已保存');
}

function copyHtmlToClipboard() {
    if (!lastGeneratedHtml) { toastr.warning('没有可复制的内容'); return; }
    navigator.clipboard.writeText(lastGeneratedHtml)
        .then(() => toastr.success('已复制'))
        .catch(() => toastr.error('复制失败'));
}

// ============================================================
// Import / Export
// ============================================================
function exportData() {
    const data = {
        version: VERSION,
        instructionTemplates: settings.instructionTemplates,
        renderTemplates: settings.renderTemplates,
        history: settings.history,
        customSystemPrompt: settings.customSystemPrompt,
        contextRange: settings.contextRange,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `theater-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('已导出');
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (data.instructionTemplates) settings.instructionTemplates = data.instructionTemplates;
            if (data.renderTemplates) settings.renderTemplates = data.renderTemplates;
            if (data.history) settings.history = data.history;
            if (data.customSystemPrompt !== undefined) settings.customSystemPrompt = data.customSystemPrompt;
            if (data.contextRange !== undefined) settings.contextRange = data.contextRange;
            saveSettings();
            toastr.success('导入成功，请重新打开面板');
        } catch (err) {
            toastr.error('导入失败: ' + err.message);
        }
    };
    input.click();
}

// ============================================================
// UI helpers
// ============================================================
function refreshInstructionList() {
    const list = $('#theater-instruction-list');
    const t = settings.instructionTemplates || [];
    list.html(t.length === 0
        ? '<p class="theater-empty">暂无保存的指令模板</p>'
        : t.map((item, i) => `
            <div class="theater-tag" data-index="${i}">
                <span class="theater-tag-text">${escapeHtml(item.name)}</span>
                <span class="theater-tag-delete" data-index="${i}"><i class="fa-solid fa-xmark"></i></span>
            </div>`).join(''));
}

function refreshHistoryList() {
    const list = $('#theater-history-list');
    const h = settings.history || [];
    list.html(h.length === 0
        ? '<p class="theater-empty">暂无保存的小剧场</p>'
        : h.map((item, i) => `
            <div class="theater-history-item" data-index="${i}">
                <div class="theater-history-header">
                    <span class="theater-history-title">${escapeHtml(item.title || `小剧场 #${i + 1}`)}</span>
                    <span class="theater-history-date">${item.date || ''}</span>
                </div>
                <div class="theater-history-actions">
                    <span class="theater-history-view" data-index="${i}"><i class="fa-solid fa-eye"></i> 查看</span>
                    <span class="theater-history-delete" data-index="${i}"><i class="fa-solid fa-trash"></i> 删除</span>
                </div>
            </div>`).join(''));
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ============================================================
// Entry
// ============================================================
jQuery(async () => { await init(); });
