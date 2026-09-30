// theater-popup-ui: receives live state and cross-feature callbacks from index.js.
import { adaptiveRenderProfile } from './adaptive-render.js';
import { getRuntimeLogEntries } from './runtime-log.js';
import { normalizeApiPresetList, MAX_API_PRESETS } from './api-presets.js';
import { normalizeLongDreamMemoryPresetList } from './long-dream-memory-presets.js';
import { normalizeManualTarget } from './length-policy.js';
import { LAMP_SVG_HTML, SKIN_LABELS, SOUND_PRESETS } from './theater-defaults.js';
import { normalizeBookmarkSide } from './result-bookmark.js';
import { readerPaneHTML } from './result-reader.js';
import { MAX_CONTEXT_MESSAGES } from './context-policy.js';
import { DEFAULT_LONG_DREAM_MEMORY_PRESET } from './long-dream-memory.js';
import { normalizeMaxTokens } from './api-client.js';
import { TAG_UNCATEGORIZED } from './tag-system.js';

export function createTheaterPopupUi(runtime) {
// @theater-source-begin theaterNativeSelectCompatId
function theaterNativeSelectCompatId() {
    return `${runtime.theaterNativeSelectCompatPrefix}-${++runtime.theaterNativeSelectCompatCounter}`;
}
// @theater-source-end theaterNativeSelectCompatId

// @theater-source-begin guardTheaterNativeSelectEvent
function guardTheaterNativeSelectEvent(event) {
    if (event.target?.closest?.('.theater-popup select.theater-select')) {
        event.stopPropagation();
    }
}
// @theater-source-end guardTheaterNativeSelectEvent

// @theater-source-begin buildPopupHTML
function buildPopupHTML(initialTab = runtime.settings.lastTheaterTab) {
    initialTab = runtime.normalizeTheaterTab(initialTab);
    const activeTabClass = tab => initialTab === tab ? ' active' : '';
    const configGroupOrder = { api: 1, generation: 2, automation: 3, materials: 4, access: 5, extension: 6 };
    const configGroupStart = (id, icon, title) => `<section class="theater-config-card" data-config-group="${id}" style="order:${configGroupOrder[id]}"><div class="theater-config-card-title"><span><i class="fa-solid ${icon}"></i>${title}</span></div><div class="theater-config-card-body">`;
    const configGroupEnd = '</div></section>';
    const inst = runtime.settings.instructionTemplates || [];
    const render = runtime.settings.renderTemplates || [];
    const allHistory = runtime.historyCache;
    const hist = initialTab === 'history' ? runtime.filterHistoryAll(allHistory) : [];

    const selRender = runtime.settings.selectedRenderIndex || '__default__';
    const selectedAdaptiveRender = adaptiveRenderProfile(selRender);
    const runtimeEntries = getRuntimeLogEntries();
    const apiPresets = normalizeApiPresetList(runtime.settings.apiPresets);
    const memoryPresets = normalizeLongDreamMemoryPresetList(runtime.settings.longDreamMemoryPresets);
    const activeMemoryPreset = memoryPresets.find(preset => preset.id === runtime.settings.longDreamMemoryPresetId) || memoryPresets[0];

    const skin = runtime.settings.skinMode || 'default';
    return `
<div class="theater-popup" data-skin="${skin}">
    <div class="theater-popup-header">
        <p class="theater-title">千夜浮梦</p>
        <p class="theater-function">小剧场生成插件</p>
        <p class="theater-subtitle">独立生成 · 不影响正文</p>
    </div>
    <div class="theater-tabs">
        <div class="theater-tab${activeTabClass('generate')}" data-tab="generate">生成</div>
        <div class="theater-tab${activeTabClass('long-dream')}" data-tab="long-dream">长梦</div>
        <div class="theater-tab${activeTabClass('setting')}" data-tab="setting">设定</div>
        <div class="theater-tab${activeTabClass('dialogue')}" data-tab="dialogue">对话</div>
        <div class="theater-tab${activeTabClass('rules')}" data-tab="rules">规则</div>
        <div class="theater-tab${activeTabClass('history')}" data-tab="history">历史</div>
        <div class="theater-tab${activeTabClass('theme')}" data-tab="theme">美化</div>
        <div class="theater-tab${activeTabClass('diagnostics')}" data-tab="diagnostics">诊断</div>
        <div class="theater-tab${activeTabClass('config')}" data-tab="config">设置${runtime.hasRemoteUpdate() ? runtime.updateBadgeHTML() : ''}</div>
    </div>
    <div class="theater-panels-wrapper">

    <!-- ===== 1. 生成 ===== -->
    <div class="theater-panel${activeTabClass('generate')}" data-panel="generate">
        <nav class="theater-result-subnav" aria-label="生成与阅读">
            <button type="button" data-result-tab="generate" aria-selected="true">生成</button>
            <button type="button" data-result-tab="read" aria-selected="false">阅读</button>
        </nav>
        <div class="theater-workspace-page" data-result-page="generate">
        <div id="theater-continuation-session">${runtime.continuationSessionHTML()}</div>
        <div class="theater-section">
            <div class="theater-instruction-heading-row">
                <button type="button" id="theater-quick-render-toggle" class="theater-quick-render-toggle${selectedAdaptiveRender ? ' is-adaptive' : ''}" title="在设置中指定的 A/B 两个模板之间切换" aria-label="切换生成模板">${runtime.quickRenderButtonContent()}</button>
                <label class="theater-label" id="theater-instruction-label" for="theater-instruction">${runtime.continuationSession ? '本段续写方向' : '小剧场指令'}</label>
            </div>
            <textarea id="theater-instruction" class="theater-textarea" rows="4" placeholder="${runtime.continuationSession ? '可留空自然续写，也可填写本段方向…' : '例如：生成一个角色们一起吃火锅的番外小剧场'}">${runtime.esc(runtime.continuationSession ? runtime.continuationSession.direction : (runtime.settings.lastInstruction || ''))}</textarea>
            <details id="theater-manual-target-control" class="theater-target-details ${runtime.settings.manualTargetEnabled ? 'is-enabled' : ''}" ${runtime.settings.manualTargetPanelOpen ? 'open' : ''}>
                <summary class="theater-target-summary">
                    <span><i class="fa-solid fa-bullseye"></i> 独立设置目标字数</span>
                    <span id="theater-manual-target-state" class="theater-target-summary-state">${runtime.settings.manualTargetEnabled ? `约 ${normalizeManualTarget(runtime.settings.manualTargetChars)} 字` : '默认关闭'}</span>
                </summary>
                <div class="theater-target-control-body">
                    <label class="theater-toggle-label">
                        <input type="checkbox" id="theater-manual-target-enabled" ${runtime.settings.manualTargetEnabled ? 'checked' : ''}>
                        <span>启用独立目标</span>
                    </label>
                    <div class="theater-target-input-wrap">
                        <input id="theater-manual-target-chars" class="theater-input theater-number-input" type="number" min="100" max="100000" step="100" value="${normalizeManualTarget(runtime.settings.manualTargetChars)}" ${runtime.settings.manualTargetEnabled ? '' : 'disabled'}>
                        <span>字</span>
                    </div>
                    <span class="theater-hint-inline">开启后覆盖指令里的字数；关闭时仍识别指令中的明确字数</span>
                </div>
            </details>
            <div id="theater-token-summary" style="display:flex;justify-content:space-between;gap:8px;font-size:.78em;opacity:.68;margin:5px 1px 7px;cursor:pointer;white-space:nowrap;overflow:hidden;">
                <span id="theater-token-summary-value">正在估算…</span><span>明细 ▾</span>
            </div>
            <div id="theater-token-details" class="theater-hint-inline" style="display:none;margin:-2px 1px 8px;line-height:1.6;"></div>
            <div class="theater-btn-row">
                <button type="button" id="theater-save-instruction-btn" class="theater-btn generate"><i class="fa-solid fa-floppy-disk"></i><span>存为模板</span></button>
                <button type="button" id="theater-clear-instruction-btn" class="theater-btn generate"><i class="fa-solid fa-eraser"></i><span>清空</span></button>
                <div id="theater-random-btn" class="theater-btn generate" style="${runtime.settings.randomEnabled ? '' : 'display:none;'}"><i class="fa-solid fa-dice"></i><span>抽一个</span></div>
            </div>
            <div class="theater-btn-row">
                <div id="theater-generate-btn" class="theater-btn primary generate">${LAMP_SVG_HTML}<span>生成</span></div>
                <div id="theater-stop-btn" class="theater-btn danger generate" style="display:none;"><i class="fa-solid fa-stop"></i><span>停止</span></div>
            </div>
        </div>
        <div class="theater-section" id="theater-stream-section" style="display:none;">
            <label class="theater-label"><i class="fa-solid fa-feather"></i> 实时输出</label>
            <pre id="theater-stream-text" class="theater-stream-pre"></pre>
        </div>
        <div class="theater-section" id="theater-output-section" style="display:none;">
            <div class="theater-result-head">
                <label class="theater-label">生成结果</label>
            </div>
            <div class="theater-result-meta-row">
                <div class="theater-recent-nav" id="theater-recent-nav" style="display:none;">
                    <span id="theater-recent-prev" class="theater-recent-arrow" title="上一条"><i class="fa-solid fa-chevron-left"></i></span>
                    <span id="theater-recent-indicator"></span>
                    <span id="theater-recent-next" class="theater-recent-arrow" title="下一条"><i class="fa-solid fa-chevron-right"></i></span>
                </div>
                <div class="theater-result-toolbox ${runtime.settings.resultBookmarkEnabled !== false ? `is-bookmark is-${normalizeBookmarkSide(runtime.settings.resultBookmarkSide)}` : 'is-inline-menu'}">
                    <div id="theater-result-actions" class="theater-btn-row theater-result-actions" role="menu" aria-label="生成结果操作">
                        <div id="theater-save-history-btn" class="theater-btn" role="menuitem"><i class="fa-solid fa-bookmark"></i><span>保存</span></div>
                        <div id="theater-copy-html-btn" class="theater-btn" role="menuitem"><i class="fa-solid fa-copy"></i><span>复制文字</span></div>
                        <div id="theater-fullscreen-btn" class="theater-btn" role="menuitem"><i class="fa-solid fa-expand"></i><span>全屏阅读</span></div>
                        <div id="theater-continue-btn" class="theater-btn" role="menuitem"><i class="fa-solid fa-forward"></i><span>续写</span></div>
                        <div id="theater-edit-result-btn" class="theater-btn" role="menuitem"><i class="fa-solid fa-pen-to-square"></i><span>编辑文字</span></div>
                        <div id="theater-delete-result-btn" class="theater-btn danger-soft" role="menuitem"><i class="fa-solid fa-trash-can"></i><span>移除结果</span></div>
                        <div id="theater-save-edit-btn" class="theater-btn primary" role="menuitem" style="display:none;"><i class="fa-solid fa-check"></i><span>应用修改</span></div>
                        <div id="theater-cancel-edit-btn" class="theater-btn" role="menuitem" style="display:none;"><i class="fa-solid fa-xmark"></i><span>退出编辑</span></div>
                    </div>
                    <button id="theater-result-actions-toggle" class="theater-result-actions-toggle" type="button" aria-expanded="false" aria-controls="theater-result-actions" title="结果操作；可上下拖动并吸附左右页边">
                        <span class="theater-result-bookmark-lamp">${LAMP_SVG_HTML}</span>
                        <span class="theater-result-bookmark-label">操作</span>
                        <span class="theater-result-bookmark-grip" aria-hidden="true"><i></i><i></i><i></i></span>
                        <span class="theater-result-inline-more" aria-hidden="true">•••</span>
                    </button>
                </div>
            </div>
            <div id="theater-length-hint" class="theater-hint-inline" style="display:none; margin:-4px 0 8px;"></div>
            <div id="theater-result-characters" class="theater-result-character-count"></div>
            <div id="theater-continuation-result" hidden>
                <div class="theater-continuation-versions">
                    <button type="button" class="theater-btn" id="theater-cont-version-prev" aria-label="查看本段上一版">‹</button>
                    <span id="theater-cont-version-label"></span>
                    <button type="button" class="theater-btn" id="theater-cont-version-next" aria-label="查看本段下一版">›</button>
                </div>
                <div class="theater-continuation-actions">
                    <button type="button" class="theater-btn" id="theater-cont-rewrite">重写本段</button>
                    <button type="button" class="theater-btn primary" id="theater-cont-next">接着这一版续写</button>
                </div>
            </div>
            <div id="theater-output-container">
                <iframe id="theater-output-frame" sandbox="" class="theater-iframe"></iframe>
                <div id="theater-output-text-fallback" class="theater-output-text-fallback" role="document" style="display:none;"></div>
            </div>
            <textarea id="theater-result-text-editor" class="theater-textarea" rows="12" style="display:none;margin-top:8px;" placeholder="编辑小剧场正文…"></textarea>
            <p id="theater-continuation-retention" class="theater-hint-inline theater-continuation-retention" hidden>本段版本临时保留；接写下一段、退出或刷新前，请保存重要版本。</p>
        </div>
        </div>
        ${readerPaneHTML(LAMP_SVG_HTML)}
    </div>

    <!-- ===== 长梦续章 ===== -->
    <div class="theater-panel${activeTabClass('long-dream')}" data-panel="long-dream">
        <div id="theater-long-dream-root">${runtime.longDreamPanelHTML()}</div>
    </div>

    <!-- ===== 2. 设定 ===== -->
    <div class="theater-panel${activeTabClass('setting')}" data-panel="setting">
        <!-- Preset -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-shield-halved"></i> 生成预设</label>
            <input id="theater-preset-search" class="theater-input" placeholder="搜索预设…" style="margin-bottom:6px;">
            <select id="theater-preset-name-select" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}" style="margin-bottom:8px;">
                <option value="">-- 选择预设 --</option>
            </select>

            <div id="theater-preset-current" style="margin-top:10px; display:none;">
                <div class="theater-btn-row" style="margin:0 0 8px;">
                    <div id="theater-load-preset-btn" class="theater-btn"><i class="fa-solid fa-arrows-rotate"></i><span>刷新</span></div>
                    <span id="theater-preset-select-all" class="theater-wb-action-link" style="padding:8px;"><i class="fa-solid fa-check-double"></i> 全选</span>
                    <span id="theater-preset-deselect-all" class="theater-wb-action-link" style="padding:8px;"><i class="fa-regular fa-square"></i> 全不选</span>
                    <span id="theater-preset-collapse-btn" class="theater-wb-action-link" style="padding:8px;"><i class="fa-solid fa-chevron-down"></i> 展开</span>
                </div>
                <div id="theater-preset-entries" class="theater-wb-list" style="display:none;"></div>
            </div>
        </div>

        <!-- Style & NSFW Addons -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-feather-pointed"></i> 自定义补充</label>

            <details class="theater-addon-details">
                <summary class="theater-addon-summary"><i class="fa-solid fa-pen-nib"></i> 文风补充 ${runtime.settings.customStyleAddon ? '· 已填写' : ''}</summary>
                <textarea id="theater-style-addon" class="theater-textarea" rows="4" placeholder="补充你想要的写作风格要求…" style="margin-top:8px;">${runtime.esc(runtime.settings.customStyleAddon || '')}</textarea>
                <div class="theater-btn-row"><div id="theater-save-style-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div></div>
            </details>

            <details class="theater-addon-details" style="margin-top:8px;">
                <summary class="theater-addon-summary"><i class="fa-solid fa-lock-open"></i> NSFW 补充 ${runtime.settings.customNsfwAddon ? '· 已填写' : ''}</summary>
                <textarea id="theater-nsfw-addon" class="theater-textarea" rows="4" placeholder="补充NSFW/尺度相关指导…" style="margin-top:8px;">${runtime.esc(runtime.settings.customNsfwAddon || '')}</textarea>
                <div class="theater-btn-row"><div id="theater-save-nsfw-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div></div>
            </details>
        </div>

        <!-- World Book -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-book-atlas"></i> 世界书 <span class="theater-hint-inline">可多选</span></label>
            <div class="theater-toggle-row" style="margin-bottom:8px;">
                <label class="theater-toggle-label"><input type="checkbox" id="theater-wb-follow" ${runtime.settings.followCharCard ? 'checked' : ''}><span>跟随角色卡</span></label>
                <span class="theater-hint-inline">切角色时只替换卡自动带入的书，手动勾选会保留</span>
            </div>
            <input id="theater-wb-search" class="theater-input" placeholder="搜索世界书…" style="margin-bottom:6px;">
            <div class="theater-wb-entries-header" id="theater-wb-header" style="display:none;">
                <span id="theater-wb-count" class="theater-wb-entries-count"></span>
            </div>
            <div id="theater-wb-books" class="theater-wb-list"></div>

            <details class="theater-wb-manual-details">
                <summary class="theater-wb-manual-summary"><i class="fa-solid fa-plus"></i> 手动添加条目</summary>
                <textarea id="theater-wb-manual" class="theater-textarea" rows="3" placeholder="粘贴世界书内容，空行分隔多个条目…" style="margin-top:8px;"></textarea>
                <div class="theater-btn-row" style="align-items:center; gap:var(--t-space-3);">
                    <div id="theater-wb-parse-btn" class="theater-btn"><i class="fa-solid fa-plus"></i><span>添加</span></div>
                    <span id="theater-wb-clear-manual" class="theater-wb-action-link theater-wb-clear-manual" style="display:none;"><i class="fa-solid fa-trash-can"></i> 清空已添加的手动条目</span>
                </div>
            </details>
        </div>
    </div>

    <!-- ===== 3. 对话 ===== -->
    <div class="theater-panel${activeTabClass('dialogue')}" data-panel="dialogue">
        <!-- User Persona -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-user"></i> User 人设</label>
            <div class="theater-toggle-row" style="margin-bottom:8px;">
                <label class="theater-toggle-label"><input type="checkbox" id="theater-persona-follow" ${runtime.settings.followUserPersona ? 'checked' : ''}><span>跟随当前 User 人设</span></label>
            </div>
            <div class="theater-btn-row" style="margin:0 0 8px;"><div id="theater-load-persona-btn" class="theater-btn"><i class="fa-solid fa-download"></i><span>从酒馆读取</span></div></div>
            <textarea id="theater-user-persona" class="theater-textarea" rows="3" placeholder="用户人设信息…">${runtime.esc(runtime.settings.userPersona || '')}</textarea>
            <div class="theater-btn-row"><div id="theater-save-persona-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存</span></div></div>
        </div>

        <!-- Context Range -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-layer-group"></i> 聊天前文</label>
            <div class="theater-toggle-row" style="margin-bottom:8px;">
                <label class="theater-toggle-label"><input type="checkbox" id="theater-read-chat-context" ${runtime.settings.readChatContext !== false ? 'checked' : ''}><span>读取聊天前文</span></label>
                <span class="theater-hint-inline">关闭后只使用角色设定、世界书和指令</span>
            </div>
            <div id="theater-context-range-row" class="theater-context-count-control${runtime.settings.readChatContext === false ? ' is-disabled' : ''}">
                <span class="theater-context-count-label">读取最近</span>
                <input id="theater-context-range" type="number" min="0" max="${MAX_CONTEXT_MESSAGES}" step="1" inputmode="numeric" value="${runtime.settings.contextRange}" class="theater-input theater-number-input theater-context-number" aria-label="读取最近多少条消息" ${runtime.settings.readChatContext === false ? 'disabled' : ''}>
                <span class="theater-context-count-unit">条消息</span>
                <span class="theater-hint-inline theater-context-count-hint">填 0 表示不读取聊天消息，最多 ${MAX_CONTEXT_MESSAGES} 条</span>
            </div>
        </div>
        ${runtime.contextExclusionSettingsHTML()}
    </div>

    <!-- ===== 3. 规则 ===== -->
    <div class="theater-panel${activeTabClass('rules')}" data-panel="rules">
        <!-- Instruction Templates -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-pen-fancy"></i> 指令模板库</label>
            <div class="theater-btn-row" style="margin:0 0 10px;">
                <div id="theater-import-inst-btn" class="theater-btn"><i class="fa-solid fa-file-import"></i><span>导入</span></div>
                <div id="theater-export-inst-btn" class="theater-btn"><i class="fa-solid fa-file-export"></i><span>导出</span></div>
            </div>
            <div id="theater-inst-drawer" class="theater-drawer ${inst.length ? '' : 'empty'}">
                <div class="theater-drawer-toggle" id="theater-inst-toggle">
                    <span><i class="fa-solid fa-folder"></i> 已保存 · <span id="theater-inst-count">${inst.length}</span> 个</span>
                    <i class="fa-solid fa-chevron-down theater-drawer-arrow"></i>
                </div>
                <div class="theater-drawer-body" style="display:none;">
                    <div class="theater-inst-toolbar">
                        <button type="button" id="theater-inst-tag-filter" class="theater-btn theater-tag-filter-btn"><i class="fa-solid fa-filter"></i><span>${runtime.esc(runtime.tagFilterSummary(runtime.settings.instructionTagFilter))}</span></button>
                        <div id="theater-inst-new-tag-btn" class="theater-btn theater-inst-tool-btn" title="新建标签"><i class="fa-solid fa-tag"></i></div>
                        <div id="theater-inst-manage-tag-btn" class="theater-btn theater-inst-tool-btn" title="管理标签"><i class="fa-solid fa-gear"></i></div>
                    </div>
                    <div class="theater-inst-search-row">
                        <input type="text" id="theater-inst-search" class="theater-input theater-inst-search-input" placeholder="搜索模板名…" value="${runtime.esc(runtime.instSearch || '')}">
                        <div id="theater-inst-select-all-btn" class="theater-btn theater-inst-select-all-btn" title="全选本页模板"><i class="fa-solid fa-list-check"></i><span>全选本页</span></div>
                    </div>
                    <div id="theater-inst-bulk-bar" class="theater-inst-bulk-bar" style="display:none;">
                        <span class="theater-inst-bulk-label">已选 <b id="theater-inst-bulk-count">0</b> 个</span>
                        <div class="theater-inst-bulk-actions">
                            <div id="theater-inst-bulk-tags-btn" class="theater-btn primary"><i class="fa-solid fa-tags"></i><span>改标签</span></div>
                            <div id="theater-inst-bulk-delete-btn" class="theater-btn danger"><i class="fa-solid fa-trash"></i><span>删除</span></div>
                            <div id="theater-inst-bulk-clear-btn" class="theater-btn"><i class="fa-solid fa-xmark"></i><span>取消</span></div>
                        </div>
                    </div>
                    <div id="theater-instruction-list" data-pending-list="true"></div>
                </div>
            </div>
        </div>

        <!-- Render Templates -->
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-palette"></i> 渲染规则模板</label>
            <select id="theater-render-select" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                ${runtime.renderTemplateOptions(selRender, render)}
            </select>
            <p class="theater-hint" id="theater-render-selection-hint" style="margin:7px 1px 0;">${runtime.esc(runtime.renderSelectionHint(selRender))}</p>
            <textarea id="theater-render-content" class="theater-textarea" rows="6" style="margin-top:10px;">${runtime.esc(runtime.renderTemplateContentForSelection(selRender, render))}</textarea>
            <div class="theater-btn-row">
                <div id="theater-save-render-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存为新模板</span></div>
                <button type="button" id="theater-delete-render-btn" class="theater-btn danger" ${runtime.isBuiltinRenderSelection(selRender) ? 'disabled title="内置模板不可删除"' : ''}><i class="fa-solid fa-trash"></i><span>${runtime.isBuiltinRenderSelection(selRender) ? '内置模板不可删除' : '删除这个自定义模板'}</span></button>
            </div>
        </div>
    </div>

    <!-- ===== 4. 历史 ===== -->
    <div class="theater-panel${activeTabClass('history')}${runtime.histBatchMode ? ' is-batch-managing' : ''}" data-panel="history">
        <div class="theater-section">
            <div class="theater-history-top-bar theater-history-collection-bar">
                <label class="theater-label" style="margin:0;"><i class="fa-solid fa-clock-rotate-left"></i> 保存的小剧场</label>
                <div class="theater-history-six-buttons">
                <button type="button" id="theater-export-all-history" class="theater-btn" ><i class="fa-solid fa-download"></i><span>批量导出</span></button>
                <button type="button" id="theater-import-history-btn" class="theater-btn"><i class="fa-solid fa-file-import"></i><span>导入备份</span></button>
                <button type="button" id="theater-history-tag-filter" class="theater-btn"><i class="fa-solid fa-filter"></i><span>${runtime.esc(runtime.historyTagFilterLabel())}</span></button>
                <button type="button" id="theater-history-manage-tags" class="theater-btn"><i class="fa-solid fa-tags"></i><span>管理标签</span></button>
                <button type="button" id="theater-hist-batch-enter" class="theater-btn" ><i class="fa-solid fa-list-check"></i><span>批量管理</span></button>
                <button type="button" id="theater-history-new-folder" class="theater-btn"><i class="fa-solid fa-folder-plus"></i><span>新建文件夹</span></button>
                </div>
                <div id="theater-hist-batch-bar" style="display:none;">
                    <div id="theater-hist-select-all" class="theater-btn"><i class="fa-solid fa-check-double"></i><span>全选本页</span></div>
                    <div id="theater-hist-tag-selected" class="theater-btn primary"><i class="fa-solid fa-tags"></i><span>改标签</span></div>
                    <div id="theater-hist-delete-selected" class="theater-btn danger"><i class="fa-solid fa-trash-can"></i><span>删除选中 (<span id="theater-hist-sel-count">0</span>)</span></div>
                    <div id="theater-hist-batch-cancel" class="theater-btn"><i class="fa-solid fa-xmark"></i><span>取消</span></div>
                </div>
            </div>
            <div class="theater-history-search-wrap"><input id="theater-history-search" type="search" class="theater-input" value="${runtime.esc(runtime.historyQuery)}" placeholder="搜索剧场标题或文件夹名称" aria-label="搜索剧场标题或文件夹名称"><button type="button" id="theater-history-clear-search" aria-label="清空搜索">×</button></div>
            <p class="theater-hint" style="margin:-2px 1px 10px;">批量导出的 ZIP 可直接从这里恢复；同时兼容旧版 ZIP 和 JSON 备份。</p>
            <div id="theater-history-list"${initialTab === 'history' ? '' : ' data-pending-list="true"'}>${initialTab !== 'history' ? '' : runtime.renderHistoryList()}</div>
        </div>
    </div>

    <!-- ===== 5. 美化 ===== -->
    <div class="theater-panel${activeTabClass('theme')}" data-panel="theme">
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-palette"></i> 风格</label>
            <div class="theater-drawer">
                <div class="theater-drawer-toggle" id="theater-skin-toggle">
                    <span><i class="fa-solid fa-swatchbook"></i> 当前 · <span id="theater-skin-current-label">${SKIN_LABELS[skin]}</span></span>
                    <i class="fa-solid fa-chevron-down theater-drawer-arrow"></i>
                </div>
                <div class="theater-drawer-body" style="display:none;">
                    <label class="theater-skin-row${skin === 'default' ? ' active' : ''}">
                        <input type="radio" name="theater-skin" value="default"${skin === 'default' ? ' checked' : ''}>
                        <span class="theater-skin-row-name">内置默认</span>
                        <span class="theater-skin-row-desc">粉彩 · 衬线 · 大圆角</span>
                    </label>
                    <label class="theater-skin-row${skin === 'theater' ? ' active' : ''}">
                        <input type="radio" name="theater-skin" value="theater"${skin === 'theater' ? ' checked' : ''}>
                        <span class="theater-skin-row-name">跟随酒馆</span>
                        <span class="theater-skin-row-desc">用酒馆当前主题色</span>
                    </label>
                    <label class="theater-skin-row${skin === 'custom' ? ' active' : ''}">
                        <input type="radio" name="theater-skin" value="custom"${skin === 'custom' ? ' checked' : ''}>
                        <span class="theater-skin-row-name">自定义</span>
                        <span class="theater-skin-row-desc">下方 CSS 完全接管</span>
                    </label>
                </div>
            </div>
        </div>
        <div class="theater-section">
            <details class="theater-addon-details"${runtime.settings.customCSS || skin === 'custom' ? ' open' : ''}>
                <summary class="theater-addon-summary"><i class="fa-solid fa-brush"></i> 自定义 CSS${runtime.settings.customCSS ? ' · 已填写' : ''}</summary>
                <textarea id="theater-custom-css" class="theater-textarea theater-css-editor" rows="8" placeholder=".theater-popup { background: #1a1a2e; }">${runtime.esc(runtime.settings.customCSS || '')}</textarea>
                <p class="theater-hint" style="margin:4px 0 8px;">所有规则会自动限定在小剧场弹窗内，不会污染酒馆界面。写 <code>body</code> 等同写 <code>.theater-popup</code>。</p>
                <div class="theater-btn-row">
                    <div id="theater-save-css-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存并应用</span></div>
                    <div id="theater-reset-css-btn" class="theater-btn danger"><i class="fa-solid fa-rotate-left"></i><span>重置</span></div>
                </div>
            </details>
        </div>
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-text-height"></i> 字体大小</label>
            <div class="theater-inline-setting">
                <span>插件界面字号</span>
                <input id="theater-ui-font-size" class="theater-input theater-number-input" type="number" min="12" max="20" step="0.5" value="${runtime.normalizeUIFontSize(runtime.settings.uiFontSize)}">
                <span>px</span>
            </div>
            <div class="theater-btn-row">
                <div id="theater-save-font-size-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存字号</span></div>
                <div id="theater-reset-font-size-btn" class="theater-btn"><i class="fa-solid fa-rotate-left"></i><span>恢复默认</span></div>
            </div>
        </div>
    </div>

    <!-- ===== 6. 诊断 ===== -->
    <div class="theater-panel${activeTabClass('diagnostics')}" data-panel="diagnostics">
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-terminal"></i> 运行日志终端（<span id="theater-runtime-log-count">${runtimeEntries.length}</span>/200）</label>
            <div class="theater-btn-row">
                <div class="theater-copy-runtime-log-btn theater-btn"><i class="fa-solid fa-copy"></i><span>复制日志</span></div>
                <div id="theater-clear-runtime-log-btn" class="theater-btn"><i class="fa-solid fa-eraser"></i><span>清空日志</span></div>
            </div>
            <div id="theater-runtime-log-list" class="theater-error-log-list">
                ${runtimeEntries.length ? runtimeEntries.map(entry => `
                <div class="theater-error-log-item theater-runtime-log-${entry.level}">
                    <span class="theater-error-log-meta">${runtime.esc(entry.time)}</span>
                    <span class="theater-runtime-log-level">[${runtime.esc(entry.level.toUpperCase())}]</span>
                    <span class="theater-runtime-log-message">${runtime.esc(entry.message)}</span>
                </div>`).join('') : '<p class="theater-empty">暂无运行日志</p>'}
            </div>
        </div>
        <div class="theater-section">
            <label class="theater-label"><i class="fa-solid fa-stethoscope"></i> 插件诊断</label>
            <div class="theater-btn-row">
                <div id="theater-run-diagnostics-btn" class="theater-btn primary"><i class="fa-solid fa-list-check"></i><span>生成诊断报告</span></div>
                <div id="theater-export-diagnostics-btn" class="theater-btn"><i class="fa-solid fa-download"></i><span>导出排查 TXT</span></div>
                <div id="theater-copy-diagnostics-btn" class="theater-btn" style="display:none;"><i class="fa-solid fa-copy"></i><span>复制报告</span></div>
                <div id="theater-toggle-diagnostics-btn" class="theater-btn" style="display:none;"><i class="fa-solid fa-chevron-up"></i><span>收起报告</span></div>
            </div>
            <div id="theater-diagnostics-output" class="theater-diagnostic-report" style="display:none;"></div>
        </div>
        <div class="theater-section theater-diagnostic-library-section">
            <details class="theater-diagnostic-catalog theater-diagnostic-library">
                <summary><span><i class="fa-solid fa-book-medical"></i> 常见问题汇总</span><small>按弹窗里的错误信号查原因</small></summary>
                <div class="theater-diagnostic-catalog-list">${runtime.diagnosticCatalogHTML()}</div>
            </details>
        </div>
    </div>

    <!-- ===== 7. 设置 ===== -->
    <div class="theater-panel${activeTabClass('config')}" data-panel="config">
        <div class="theater-config-layout"><div class="theater-config-groups">
        ${configGroupStart('api', 'fa-server', '正文生成线路')}
        <div class="theater-section" data-config-section="api">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-plug"></i> 正文线路</label>
            <div class="theater-api-mode-switch" role="group" aria-label="API 模式">
                <button type="button" data-theater-api-mode="custom" class="${(runtime.settings.apiMode || 'custom') === 'custom' ? 'active' : ''}" aria-pressed="${(runtime.settings.apiMode || 'custom') === 'custom'}"><i class="fa-solid fa-key"></i><span>独立 API</span></button>
                <button type="button" data-theater-api-mode="main" class="${runtime.settings.apiMode === 'main' ? 'active' : ''}" aria-pressed="${runtime.settings.apiMode === 'main'}"><i class="fa-solid fa-wine-glass"></i><span>酒馆主 API</span></button>
            </div>
            <select id="theater-api-mode" class="theater-api-mode-select" data-select2-id="${theaterNativeSelectCompatId()}" aria-hidden="true" tabindex="-1">
                <option value="custom" ${(runtime.settings.apiMode || 'custom') === 'custom' ? 'selected' : ''}>独立 API（推荐）</option>
                <option value="main" ${runtime.settings.apiMode === 'main' ? 'selected' : ''}>酒馆主 API（实验）</option>
            </select>
            <div id="theater-custom-api-area" class="theater-config-api-fields" style="${runtime.settings.apiMode === 'main' ? 'display:none;' : ''}">
                <div class="theater-api-preset-card">
                    <div class="theater-api-preset-heading">
                        <span><i class="fa-solid fa-layer-group"></i> API 预设</span>
                        <span id="theater-api-preset-count" class="theater-api-preset-count">${apiPresets.length}/${MAX_API_PRESETS}</span>
                    </div>
                    <div class="theater-api-preset-control">
                        <select id="theater-api-preset-select" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                            <option value="">选择已保存的 API 预设</option>
                            ${apiPresets.map(preset => `<option value="${runtime.esc(preset.id)}" ${preset.id === runtime.settings.selectedApiPresetId ? 'selected' : ''}>${runtime.esc(runtime.apiPresetDisplayLabel(preset))}</option>`).join('')}
                        </select>
                        <div class="theater-api-preset-actions" aria-label="管理 API 预设">
                            <button type="button" id="theater-save-api-preset-btn" class="theater-config-icon-btn" title="另存为新预设" aria-label="另存为新预设"><i class="fa-solid fa-plus"></i></button>
                            <button type="button" id="theater-update-api-preset-btn" class="theater-config-icon-btn ${runtime.settings.selectedApiPresetId ? '' : 'disabled'}" title="更新当前预设" aria-label="更新当前预设" ${runtime.settings.selectedApiPresetId ? '' : 'disabled'}><i class="fa-solid fa-arrows-rotate"></i></button>
                            <button type="button" id="theater-rename-api-preset-btn" class="theater-config-icon-btn ${runtime.settings.selectedApiPresetId ? '' : 'disabled'}" title="重命名当前预设" aria-label="重命名当前预设" ${runtime.settings.selectedApiPresetId ? '' : 'disabled'}><i class="fa-solid fa-pen"></i></button>
                            <button type="button" id="theater-delete-api-preset-btn" class="theater-config-icon-btn danger ${runtime.settings.selectedApiPresetId ? '' : 'disabled'}" title="删除当前预设" aria-label="删除当前预设" ${runtime.settings.selectedApiPresetId ? '' : 'disabled'}><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <p class="theater-api-preset-note"><i class="fa-solid fa-shield-halved"></i> 预设会保存地址、协议、Key、模型和单轮输出上限；请勿把 settings.json 分享给他人。</p>
                </div>
                <div class="theater-config-field">
                    <label for="theater-api-protocol"><b>请求格式</b><small>多数兼容服务保持自动即可</small></label>
                    <select id="theater-api-protocol" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                        <option value="auto" ${(runtime.settings.apiProtocol || 'auto') === 'auto' ? 'selected' : ''}>自动判断（默认）</option>
                        <option value="openai" ${runtime.settings.apiProtocol === 'openai' ? 'selected' : ''}>OpenAI Chat Completions 兼容格式</option>
                        <option value="anthropic" ${runtime.settings.apiProtocol === 'anthropic' ? 'selected' : ''}>Anthropic Messages 兼容格式</option>
                    </select>
                </div>
                <div class="theater-config-field">
                    <label for="theater-api-url"><b>接口地址</b><small>只用于插件独立请求</small></label>
                    <input id="theater-api-url" class="theater-input" placeholder="API URL" value="${runtime.esc(runtime.settings.apiUrl || '')}">
                </div>
                <div class="theater-config-field">
                    <label for="theater-api-key"><b>API Key</b><small>不会进入日志或备份</small></label>
                    <input id="theater-api-key" class="theater-input" type="password" placeholder="API Key" value="${runtime.esc(runtime.settings.apiKey || '')}">
                </div>
                <div class="theater-config-field">
                    <label for="theater-api-model"><b>模型</b><small>可以手填或读取线路列表</small></label>
                    <div class="theater-config-model-control">
                        <select id="theater-api-model-select" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}" style="display:none;"></select>
                        <input id="theater-api-model" class="theater-input" placeholder="模型名称" value="${runtime.esc(runtime.settings.apiModel || '')}">
                        <button type="button" id="theater-fetch-models-btn" class="theater-config-field-action" title="获取模型列表"><i class="fa-solid fa-arrows-rotate"></i><span>获取</span></button>
                    </div>
                </div>
                <div class="theater-config-api-actions">
                    <button type="button" id="theater-test-api-btn" class="theater-btn"><i class="fa-solid fa-plug"></i><span>测试连接</span></button>
                    <button type="button" id="theater-save-api-btn" class="theater-btn primary"><i class="fa-solid fa-floppy-disk"></i><span>保存设置</span></button>
                </div>
            </div>
            <details class="theater-memory-api-card">
                <summary><span><i class="fa-solid fa-route"></i><b>梦脉织录</b></span><small id="theater-dream-memory-summary">${runtime.settings.longDreamMemoryApiPresetId ? `${runtime.esc(apiPresets.find(preset => preset.id === runtime.settings.longDreamMemoryApiPresetId)?.name || '已绑定副 API')} · 每 ${Number(runtime.settings.longDreamMemoryBatchSize) || 3} 章` : '尚未绑定副 API'}</small><i class="fa-solid fa-chevron-down"></i></summary>
                <div class="theater-memory-api-body">
                    <p>正文线路与梦脉完全分开。确认章节只加入待织录队列，默认累计三章后在后台批量整理。</p>
                    <label><span>副 API 预设</span><select id="theater-dream-memory-api-preset" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                        <option value="">尚未绑定（暂停自动织录）</option>
                        ${apiPresets.map(preset => `<option value="${runtime.esc(preset.id)}" ${preset.id === runtime.settings.longDreamMemoryApiPresetId ? 'selected' : ''}>${runtime.esc(runtime.apiPresetDisplayLabel(preset))}</option>`).join('')}
                    </select></label>
                    <label class="theater-memory-batch-row"><span>自动批量</span><select id="theater-dream-memory-batch-size" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                        ${[1, 3, 5].map(size => `<option value="${size}" ${Number(runtime.settings.longDreamMemoryBatchSize || 3) === size ? 'selected' : ''}>每 ${size} 章${size === 3 ? '（推荐）' : ''}</option>`).join('')}
                    </select></label>
                    <details class="theater-memory-prompt-details">
                        <summary>梦脉分析预设库</summary>
                        <label><span>当前预设</span><select id="theater-dream-memory-analysis-preset" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">${memoryPresets.map(preset => `<option value="${runtime.esc(preset.id)}" ${preset.id === activeMemoryPreset.id ? 'selected' : ''}>${runtime.esc(preset.name)}${preset.author ? ` · ${runtime.esc(preset.author)}` : ''}</option>`).join('')}</select></label>
                        <small id="theater-dream-memory-preset-description">${runtime.esc(activeMemoryPreset.description || '只改变梦脉的分析侧重点；数据结构和输出合同由程序固定。')}</small>
                        <textarea id="theater-dream-memory-prompt" class="theater-textarea" rows="10" ${activeMemoryPreset.builtin ? 'readonly' : ''}>${runtime.esc(activeMemoryPreset.focusPrompt || DEFAULT_LONG_DREAM_MEMORY_PRESET)}</textarea>
                        <div class="theater-memory-preset-actions">
                            <button type="button" id="theater-copy-dream-memory-preset" class="theater-btn theater-config-text-button"><i class="fa-solid fa-copy"></i><span>新建副本</span></button>
                            <button type="button" id="theater-import-dream-memory-preset" class="theater-btn theater-config-text-button"><i class="fa-solid fa-file-import"></i><span>导入 JSON</span></button>
                            <button type="button" id="theater-export-dream-memory-preset" class="theater-btn theater-config-text-button"><i class="fa-solid fa-file-export"></i><span>导出当前</span></button>
                            <button type="button" id="theater-delete-dream-memory-preset" class="theater-btn theater-config-text-button danger" ${activeMemoryPreset.builtin ? 'hidden' : ''}><i class="fa-solid fa-trash"></i><span>删除当前</span></button>
                            <button type="button" id="theater-reset-dream-memory-prompt" class="theater-btn theater-config-text-button"><i class="fa-solid fa-rotate-left"></i><span>切回内置</span></button>
                        </div>
                    </details>
                </div>
            </details>
        </div>
        ${configGroupEnd}
        ${configGroupStart('generation', 'fa-sliders', '生成控制')}
        <div class="theater-section" data-config-section="generation">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-sliders"></i> 生成策略</label>
            <div class="theater-config-quick-render">
                <div class="theater-config-setting-copy"><b>生成页双模板切换</b><small>选择按钮一按即可往返的两个模板</small></div>
                <div class="theater-config-quick-render-grid">
                    <label><span>模板 A</span><select id="theater-quick-render-a" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">${runtime.renderTemplateOptions(runtime.settings.quickRenderA, render)}</select></label>
                    <label><span>模板 B</span><select id="theater-quick-render-b" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">${runtime.renderTemplateOptions(runtime.settings.quickRenderB, render)}</select></label>
                </div>
                <small>可以选择任意内置或自定义模板；三个剧情自适应模板分别侧重阅读、参与和探索。</small>
            </div>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>流式实时显示</b><small>逐字生成正文，可实时查看效果</small></span>
                <label class="theater-config-switch" aria-label="流式实时显示"><input type="checkbox" id="theater-stream-enabled" ${runtime.settings.streamEnabled !== false ? 'checked' : ''}><span></span></label>
            </div>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>字数不足时自动补写</b><small>达到 Token 限制时继续生成后续</small></span>
                <label class="theater-config-switch" aria-label="字数不足时自动补写"><input type="checkbox" id="theater-auto-continue" ${runtime.settings.autoContinue ? 'checked' : ''}><span></span></label>
            </div>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>最多补写轮数</b><small>防止无限循环请求</small></span>
                <div class="theater-config-stepper" role="group" aria-label="最多补写轮数">
                    <button type="button" data-theater-number-step="-1" data-theater-number-target="theater-max-auto-rounds" aria-label="减少一轮">−</button>
                    <input id="theater-max-auto-rounds" class="theater-input theater-number-input" type="number" inputmode="numeric" min="1" max="10" step="1" value="${Math.min(10, Math.max(1, Number(runtime.settings.maxAutoRounds) || 3))}" aria-label="最多补写轮数">
                    <button type="button" data-theater-number-step="1" data-theater-number-target="theater-max-auto-rounds" aria-label="增加一轮">＋</button>
                </div>
            </div>
            <details class="theater-config-extra-details">
                <summary><span><i class="fa-solid fa-gear"></i> 高级参数设置</span><i class="fa-solid fa-chevron-down"></i></summary>
                <div class="theater-config-extra-body" data-config-extra-body="generation">
                    <div class="theater-config-field theater-config-token-field">
                        <label for="theater-max-output-tokens"><b>单轮 Max Output Tokens</b><small>模型不支持时会自动降低重试</small></label>
                        <input id="theater-max-output-tokens" class="theater-input theater-number-input" type="number" min="256" max="131072" step="256" value="${normalizeMaxTokens(runtime.settings.maxOutputTokens)}">
                    </div>
                </div>
            </details>
        </div>
        ${configGroupEnd}
        ${configGroupStart('materials', 'fa-book-atlas', '素材与提示')}
        <div class="theater-section" data-config-section="worldbook">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-book-atlas"></i> 世界书读取</label>
            <div class="theater-config-choice-row">
                <span><b>世界书读取范围</b><small>控制素材注入的精细度</small></span>
                <select id="theater-wb-read-mode" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                    <option value="all" ${(runtime.settings.worldBookReadMode || 'all') === 'all' ? 'selected' : ''}>全部条目</option>
                    <option value="enabled" ${runtime.settings.worldBookReadMode === 'enabled' ? 'selected' : ''}>酒馆开启条目（含链式）</option>
                    <option value="lights" ${runtime.settings.worldBookReadMode === 'lights' ? 'selected' : ''}>按酒馆蓝灯与绿灯触发</option>
                </select>
            </div>
        </div>
        <div class="theater-section" data-config-section="sound">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-bell"></i> 生成完毕提示音</label>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>生成完毕提示音</b><small>后台完成时播报音频</small></span>
                <label class="theater-config-switch" aria-label="开启提示音"><input type="checkbox" id="theater-sound-enabled" ${runtime.settings.soundEnabled ? 'checked' : ''}><span></span></label>
            </div>
            <div class="theater-config-choice-row">
                <span><b>提示音样式</b><small id="theater-sound-summary">${runtime.esc(SOUND_PRESETS.find(p => p.id === runtime.settings.soundPreset)?.label || '铃·清脆')}</small></span>
                <div class="theater-config-inline-control">
                    <select id="theater-sound-preset" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                        ${SOUND_PRESETS.map(p => `<option value="${runtime.esc(p.id)}" ${runtime.settings.soundPreset === p.id ? 'selected' : ''}>${runtime.esc(p.label)}</option>`).join('')}
                    </select>
                    <button type="button" id="theater-sound-preview-btn" class="theater-btn"><i class="fa-solid fa-play"></i><span>试听</span></button>
                </div>
            </div>
            <div class="theater-config-choice-row">
                <span><b>提示音量</b><small>调整完成提示的播放音量</small></span>
                <div class="theater-config-range-control">
                    <input id="theater-sound-volume" type="range" min="0" max="100" step="5" value="${Number(runtime.settings.soundVolume) || 0}">
                    <span id="theater-sound-volume-num">${Number(runtime.settings.soundVolume) || 0}</span>
                </div>
            </div>
        </div>
        ${configGroupEnd}
        ${configGroupStart('automation', 'fa-wand-magic-sparkles', '指令与自动生成')}
        <div class="theater-section" data-config-section="random">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-dice"></i> 随机抽取指令</label>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>开启「抽一个」按钮</b><small>从所选范围随机填入生成指令</small></span>
                <label class="theater-config-switch" aria-label="开启抽一个按钮"><input type="checkbox" id="theater-random-enabled" ${runtime.settings.randomEnabled ? 'checked' : ''}><span></span></label>
            </div>
            <div class="theater-config-choice-row">
                <span><b>抽取范围</b><small>多个标签表示同时包含</small></span>
                <div class="theater-config-inline-control theater-tag-source-control">
                    <select id="theater-random-scope" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                        <option value="__current__" ${runtime.settings.randomScope === '__current__' ? 'selected' : ''}>跟随筛选</option>
                        <option value="__all__" ${runtime.settings.randomScope === '__all__' ? 'selected' : ''}>全部模板</option>
                        <option value="${TAG_UNCATEGORIZED}" ${runtime.settings.randomScope === TAG_UNCATEGORIZED ? 'selected' : ''}>未分类</option>
                        <option value="__tags__" ${runtime.settings.randomScope === '__tags__' ? 'selected' : ''}>指定标签</option>
                    </select>
                    <button type="button" id="theater-random-tag-picker" class="theater-btn" ${runtime.settings.randomScope === '__tags__' ? '' : 'hidden'} title="${runtime.esc(runtime.tagFilterSummary(runtime.settings.randomTagFilter))}"><i class="fa-solid fa-tags"></i><span>${runtime.esc(runtime.tagFilterSummary(runtime.settings.randomTagFilter, '选择'))}</span></button>
                </div>
            </div>
        </div>
        <div class="theater-section" data-config-section="auto">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-wand-magic-sparkles"></i> 自动生成</label>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>开启自动模式</b><small>按聊天分别累计 AI 回复层数</small></span>
                <label class="theater-config-switch" aria-label="开启自动模式"><input type="checkbox" id="theater-auto-enabled" ${runtime.settings.autoMode ? 'checked' : ''}><span></span></label>
            </div>
            <div class="theater-config-choice-row">
                <span><b>触发间隔</b><small id="theater-auto-summary">每 ${Math.max(1, Math.min(50, Number(runtime.settings.autoInterval) || 10))} 层 AI 回复</small></span>
                <div class="theater-config-stepper">
                    <button type="button" data-theater-number-step="-1" data-theater-number-target="theater-auto-interval" aria-label="触发间隔减一">−</button>
                    <input id="theater-auto-interval" type="number" min="1" max="50" step="1" inputmode="numeric" value="${Math.max(1, Math.min(50, Number(runtime.settings.autoInterval) || 10))}" class="theater-input" aria-label="触发间隔，1 到 50 层">
                    <button type="button" data-theater-number-step="1" data-theater-number-target="theater-auto-interval" aria-label="触发间隔加一">＋</button>
                </div>
            </div>
            <div class="theater-config-choice-row">
                <span><b>指令来源</b><small>选择自动生成时使用的指令</small></span>
                <div class="theater-config-inline-control theater-tag-source-control">
                    <select id="theater-auto-source" class="theater-select" data-select2-id="${theaterNativeSelectCompatId()}">
                        <option value="__last__" ${runtime.settings.autoSource === '__last__' ? 'selected' : ''}>上次指令</option>
                        <option value="__all__" ${runtime.settings.autoSource === '__all__' ? 'selected' : ''}>全部模板</option>
                        <option value="${TAG_UNCATEGORIZED}" ${runtime.settings.autoSource === TAG_UNCATEGORIZED ? 'selected' : ''}>未分类</option>
                        <option value="__tags__" ${runtime.settings.autoSource === '__tags__' ? 'selected' : ''}>指定标签</option>
                    </select>
                    <button type="button" id="theater-auto-tag-picker" class="theater-btn" ${runtime.settings.autoSource === '__tags__' ? '' : 'hidden'} title="${runtime.esc(runtime.tagFilterSummary(runtime.settings.autoTagFilter))}"><i class="fa-solid fa-tags"></i><span>${runtime.esc(runtime.tagFilterSummary(runtime.settings.autoTagFilter, '选择'))}</span></button>
                </div>
            </div>
        </div>
        ${configGroupEnd}
        ${configGroupStart('access', 'fa-circle-dot', '界面与快捷入口')}
        <div class="theater-section" data-config-section="result-actions">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-bookmark"></i> 生成结果操作</label>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>显示页边操作书签</b><small>关闭后仍可从分页右侧打开全部操作</small></span>
                <label class="theater-config-switch" aria-label="显示页边操作书签"><input type="checkbox" id="theater-result-bookmark-enabled" ${runtime.settings.resultBookmarkEnabled !== false ? 'checked' : ''}><span></span></label>
            </div>
        </div>
        <div class="theater-section" data-config-section="floating">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-circle-dot"></i> 快捷入口</label>
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>显示快捷悬浮球</b><small>可在酒馆主界面随时呼出</small></span>
                <label class="theater-config-switch" aria-label="显示快捷悬浮球"><input type="checkbox" id="theater-floating-ball-toggle" ${runtime.settings.floatingBall ? 'checked' : ''}><span></span></label>
            </div>
        </div>
        <div class="theater-section" data-config-section="floating-extra">
            <div class="theater-config-setting-row">
                <span class="theater-config-setting-copy"><b>悬浮球贴边收纳</b><small>闲置时自动缩到屏幕边缘</small></span>
                <label class="theater-config-switch" aria-label="悬浮球贴边收纳"><input type="checkbox" id="theater-floating-ball-tuck-toggle" ${runtime.settings.floatingBallTuck !== false ? 'checked' : ''}><span></span></label>
            </div>
        </div>
        ${configGroupEnd}
        ${configGroupStart('extension', 'fa-toolbox', '扩展管理')}
        <div class="theater-section" data-config-section="extension">
            <label class="theater-label theater-config-section-label"><i class="fa-solid fa-arrows-rotate"></i> 扩展入口</label>
            <div class="theater-update-notice" ${runtime.hasRemoteUpdate() ? '' : 'hidden'}>
                <i class="fa-solid fa-circle-arrow-up"></i>
                <span>${runtime.hasRemoteUpdate() ? runtime.esc(runtime.remoteUpdateLabel()) : ''}</span>
            </div>
            <div class="theater-config-action-row theater-update-actions">
                <span><b>插件更新</b></span>
                <div class="theater-update-button-stack">
                    <button type="button" id="theater-update-btn" class="theater-btn primary"><i class="fa-solid fa-cloud-arrow-down"></i><span>检查更新</span></button>
                    <button type="button" id="theater-reload-after-update-btn" class="theater-btn theater-reload-after-update" ${runtime.updateReadyToReload ? '' : 'hidden'}><i class="fa-solid fa-rotate-right"></i><span>刷新酒馆并启用</span></button>
                </div>
            </div>
            <p id="theater-update-ready-hint" class="theater-update-ready-hint" ${runtime.updateReadyToReload ? '' : 'hidden'}><i class="fa-solid fa-circle-check"></i><span>更新文件已下载；你可以稍后刷新，不会自动打断当前操作。</span></p>
        </div>
        ${configGroupEnd}
        <p class="theater-version" style="order:7">当前版本 v${runtime.VERSION}</p>
        </div></div>
    </div>

    </div>
</div>`;
}
// @theater-source-end buildPopupHTML

// @theater-source-begin decorateConfigLayout
function decorateConfigLayout() {
    const $panel = $('.theater-panel[data-panel="config"]');
    if (!$panel.length || $panel.children('.theater-config-layout').length) return;
    const groups = [
        { id: 'api', icon: 'fa-server', title: '正文生成线路', sections: ['api'] },
        { id: 'generation', icon: 'fa-sliders', title: '生成控制', sections: ['generation'] },
        { id: 'automation', icon: 'fa-wand-magic-sparkles', title: '指令与自动生成', sections: ['random', 'auto'] },
        { id: 'materials', icon: 'fa-book-atlas', title: '素材与提示', sections: ['worldbook', 'sound'] },
        { id: 'access', icon: 'fa-circle-dot', title: '界面与快捷入口', sections: ['result-actions', 'floating', 'floating-extra'] },
        { id: 'extension', icon: 'fa-toolbox', title: '扩展管理', sections: ['extension'] },
    ];
    const $layout = $('<div class="theater-config-layout">');
    const $groups = $('<div class="theater-config-groups">');
    groups.forEach(group => {
        const $card = $(`<section class="theater-config-card" data-config-group="${group.id}">`);
        $card.append(`<div class="theater-config-card-title"><span><i class="fa-solid ${group.icon}"></i>${group.title}</span></div>`);
        const $body = $('<div class="theater-config-card-body">');
        group.sections.forEach(section => $body.append($panel.children(`[data-config-section="${section}"]`)));
        $card.append($body);
        $groups.append($card);
    });
    $layout.append($groups);
    $panel.prepend($layout);
    $groups.append($panel.children('.theater-version'));
}
// @theater-source-end decorateConfigLayout

return { theaterNativeSelectCompatId, guardTheaterNativeSelectEvent, buildPopupHTML, decorateConfigLayout };
}
