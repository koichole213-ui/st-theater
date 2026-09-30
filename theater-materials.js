// theater-materials: receives live state and cross-feature callbacks from index.js.
import { normalizeTagList, normalizeTagFilter, TAG_UNCATEGORIZED } from './tag-system.js';
import { normalizeContextExclusionRules, MAX_CONTEXT_EXCLUSION_LENGTH, validateContextExclusionRule, MAX_CONTEXT_EXCLUSION_RULES, previewChatContext } from './context-exclusions.js';
import { estimateTokenCount, formatTokenCount } from './token-estimator.js';
import { syncPersonaToSettings } from './persona-follow.js';
import { presetEntryStatesForPreset } from './preset-entry-states.js';
import { normalizePromptRole, noToolsPostProcessingMode } from './request-layout.js';
import { worldBookEntryStrategy, shouldReadWorldBookEntry, rememberWorldBookEntryStates, syncFollowedWorldBooks } from './world-book-policy.js';

export function createTheaterMaterials(runtime) {
// @theater-source-begin knownInstructionTags
function knownInstructionTags() {
    return normalizeTagList(runtime.settings.instructionTags);
}
// @theater-source-end knownInstructionTags

// @theater-source-begin tagFilterSummary
function tagFilterSummary(filter, allLabel = '全部标签') {
    const selected = normalizeTagFilter(filter, knownInstructionTags());
    if (!selected.length) return allLabel;
    if (selected[0] === TAG_UNCATEGORIZED) return '未分类';
    return selected.join(' ＋ ');
}
// @theater-source-end tagFilterSummary

// @theater-source-begin historyTagFilterLabel
function historyTagFilterLabel() {
    const summary = tagFilterSummary(runtime.settings.historyTagFilter, '');
    return summary ? `筛选标签：${summary}` : '筛选标签';
}
// @theater-source-end historyTagFilterLabel

// @theater-source-begin contextExclusionSettingsHTML
function contextExclusionSettingsHTML() {
    return `<div class="theater-section theater-context-exclusions">
        <details class="theater-addon-details" id="theater-context-exclusions">
            <summary class="theater-addon-summary"><i class="fa-solid fa-filter" aria-hidden="true"></i> 前文排除规则 <span id="theater-exclusion-count">${normalizeContextExclusionRules(runtime.settings.contextExclusionRules).filter(rule => rule.enabled).length} 条启用</span></summary>
            <p class="theater-hint">排除小剧场读取的聊天内容，原消息不变。添加后自动保存，可随时停用或删除。</p>
            <div id="theater-exclusion-list">${contextExclusionRulesHTML()}</div>
            <label class="theater-label" for="theater-exclusion-type">添加规则</label>
            <select id="theater-exclusion-type" class="theater-select" data-select2-id="${runtime.theaterNativeSelectCompatId()}"><option value="literal">固定内容</option><option value="tag">标签区块</option></select>
            <label class="theater-exclusion-field-label" for="theater-exclusion-value" id="theater-exclusion-value-label">要排除的完整内容</label>
            <textarea id="theater-exclusion-value" class="theater-textarea" rows="3" maxlength="${MAX_CONTEXT_EXCLUSION_LENGTH}" aria-describedby="theater-exclusion-help" placeholder="粘贴固定收尾文字或完整 HTML…"></textarea>
            <p class="theater-hint" id="theater-exclusion-help">精确匹配，包括空格和换行；有 HTML 时请连同标签一起粘贴。</p>
            <div class="theater-btn-row"><button type="button" id="theater-exclusion-add" class="theater-btn primary"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>添加规则</span></button></div>
            <p class="theater-hint" id="theater-exclusion-feedback" role="status" hidden></p>
            <details class="theater-addon-details theater-exclusion-preview">
                <summary class="theater-addon-summary">过滤预览</summary>
                <label class="theater-exclusion-field-label" for="theater-exclusion-preview-input">测试消息</label>
                <textarea id="theater-exclusion-preview-input" class="theater-textarea" rows="4" placeholder="粘贴一段带标签或收尾标记的消息，仅在本地测试，不会保存…"></textarea>
                <p class="theater-hint">只应用上方已添加且启用的规则，再按生成时相同方式读取正文。</p>
                <div class="theater-btn-row"><button type="button" id="theater-exclusion-preview-run" class="theater-btn"><i class="fa-solid fa-eye" aria-hidden="true"></i><span>过滤预览</span></button></div>
                <p class="theater-hint" id="theater-exclusion-preview-status" role="status" hidden></p>
                <pre id="theater-exclusion-preview-output" aria-label="过滤后读取的正文" hidden></pre>
            </details>
        </details>
    </div>`;
}
// @theater-source-end contextExclusionSettingsHTML

// @theater-source-begin contextExclusionRulesHTML
function contextExclusionRulesHTML() {
    const rules = normalizeContextExclusionRules(runtime.settings.contextExclusionRules);
    if (!rules.length) return '<p class="theater-empty">尚未添加，按原方式读取聊天前文。</p>';
    return rules.map((rule, index) => `<div class="theater-exclusion-rule">
        <label class="theater-exclusion-rule-toggle"><input type="checkbox" data-exclusion-toggle="${index}" ${rule.enabled ? 'checked' : ''} aria-label="启用第 ${index + 1} 条排除规则"><span>${rule.type === 'tag' ? '标签区块' : '固定内容'}</span></label>
        <code class="theater-exclusion-rule-value">${runtime.esc(rule.value)}</code>
        <button type="button" class="theater-btn danger-soft" data-exclusion-delete="${index}" aria-label="删除第 ${index + 1} 条排除规则">删除</button>
    </div>`).join('');
}
// @theater-source-end contextExclusionRulesHTML

// @theater-source-begin refreshContextExclusionRules
function refreshContextExclusionRules() {
    $('#theater-exclusion-list').html(contextExclusionRulesHTML());
    $('#theater-exclusion-count').text(`${runtime.settings.contextExclusionRules.filter(rule => rule.enabled).length} 条启用`);
    $('#theater-exclusion-preview-output').empty().prop('hidden', true);
    $('#theater-exclusion-preview-status').text('规则已变化，请重新预览。').prop('hidden', false);
    runtime.save();
    runtime.scheduleTokenEstimate();
}
// @theater-source-end refreshContextExclusionRules

// @theater-source-begin addContextExclusionRule
function addContextExclusionRule() {
    const { rule, error } = validateContextExclusionRule({
        type: $('#theater-exclusion-type').val(), value: $('#theater-exclusion-value').val(),
    });
    const rules = normalizeContextExclusionRules(runtime.settings.contextExclusionRules);
    const duplicate = rule && rules.some(item => item.type === rule.type && item.value === rule.value);
    const problem = error || (duplicate ? '这条规则已经存在，可在上方启用。' : '')
        || (rules.length >= MAX_CONTEXT_EXCLUSION_RULES ? `最多添加 ${MAX_CONTEXT_EXCLUSION_RULES} 条规则。` : '');
    if (problem) { $('#theater-exclusion-feedback').text(problem).prop('hidden', false); return; }
    runtime.settings.contextExclusionRules = [...rules, rule];
    $('#theater-exclusion-value').val('');
    $('#theater-exclusion-feedback').text('已添加并保存。').prop('hidden', false);
    refreshContextExclusionRules();
}
// @theater-source-end addContextExclusionRule

// @theater-source-begin previewContextExclusions
function previewContextExclusions() {
    const source = $('#theater-exclusion-preview-input').val() || '';
    const { text, removed, unclosed } = previewChatContext(source, runtime.settings.contextExclusionRules);
    const status = !source ? '请先粘贴测试消息。'
        : `已排除 ${removed} 处。${unclosed ? '存在未闭合的匹配标签，相关区块已保留。' : ''}${text.trim() ? '下方为读取结果。' : '过滤后没有正文。'}`;
    $('#theater-exclusion-preview-status').text(status).prop('hidden', false);
    $('#theater-exclusion-preview-output').text(text).prop('hidden', !source);
}
// @theater-source-end previewContextExclusions

// @theater-source-begin worldBookCacheKey
function worldBookCacheKey(books = runtime.settings.selectedWorldBooks, readMode = runtime.settings.worldBookReadMode) {
    return JSON.stringify({ books: [...(Array.isArray(books) ? books : [])], readMode: String(readMode || 'all') });
}
// @theater-source-end worldBookCacheKey

// @theater-source-begin isWorldBookCacheCurrent
function isWorldBookCacheCurrent() {
    return runtime.wbLoadedCacheKey === worldBookCacheKey();
}
// @theater-source-end isWorldBookCacheCurrent

// @theater-source-begin wbEntryHTML
function wbEntryHTML(entry, i) {
    const checked = runtime.wbStates[i] !== false;
    const strategyBadge = entry.manual ? '' : ({
        blue: '<span class="theater-wb-strategy theater-wb-strategy-blue" title="酒馆蓝灯：无需关键词，常驻触发">● 蓝</span>',
        green: '<span class="theater-wb-strategy theater-wb-strategy-green" title="酒馆绿灯：由关键词触发">● 绿</span>',
        chain: '<span class="theater-wb-strategy theater-wb-strategy-chain" title="酒馆链式策略：允许向量相似度触发">● 链</span>',
    }[entry.strategy] || '');
    const deleteBtn = entry.manual
        ? `<span class="theater-wb-entry-delete" data-index="${i}" title="删除此手动添加的条目"><i class="fa-solid fa-trash-can"></i></span>`
        : '';
    const placementLabels = {
        0: '角色前', 1: '角色后', 2: '作者注释顶部', 3: '作者注释底部',
        5: '示例顶部', 6: '示例底部', 7: 'Outlet',
    };
    const placementBadge = entry.manual
        ? ''
        : Number(entry.position) === 4
            ? `<span class="theater-wb-placement" title="按酒馆世界书设置插入聊天历史">@D${Math.max(0, Math.floor(Number(entry.depth) || 0))} · ${entry.role === 'user' ? 'USR' : entry.role === 'assistant' ? 'AST' : 'SYS'}</span>`
            : `<span class="theater-wb-placement" title="酒馆世界书插入位置">${runtime.esc(placementLabels[Number(entry.position)] || '角色前')}</span>`;
    return `
<div class="theater-wb-entry ${checked ? '' : 'theater-wb-entry-off'}">
    <div class="theater-wb-entry-header" data-index="${i}">
        <input type="checkbox" class="theater-wb-check" data-index="${i}" ${checked ? 'checked' : ''}>
        <div class="theater-wb-entry-info">
            <span class="theater-wb-entry-name">${runtime.esc(entry.name || '#' + (i + 1))}</span>
            ${strategyBadge}
            ${placementBadge}
        </div>
        <div class="theater-wb-entry-actions">
            ${deleteBtn}
            <span class="theater-wb-entry-toggle" data-index="${i}"><i class="fa-solid fa-chevron-right"></i></span>
        </div>
    </div>
    <div class="theater-wb-entry-body" data-index="${i}" style="display:none;">
        <div class="theater-wb-entry-content">${runtime.esc(entry.content || '')}</div>
    </div>
</div>`;
}
// @theater-source-end wbEntryHTML

// @theater-source-begin wbBookBodyHTML
function wbBookBodyHTML(idxs) {
    const toolbar = `
<div class="theater-wb-body-toolbar">
    <input class="theater-input theater-wb-entry-filter" placeholder="筛选条目…">
    <span class="theater-wb-action-link theater-wb-book-all"><i class="fa-solid fa-check-double"></i> 全选</span>
    <span class="theater-wb-action-link theater-wb-book-none"><i class="fa-regular fa-square"></i> 全不选</span>
</div>`;
    const list = idxs.length ? idxs.map(i => wbEntryHTML(runtime.wbEntries[i], i)).join('') : '<p class="theater-empty">没有可用条目</p>';
    return toolbar + list;
}
// @theater-source-end wbBookBodyHTML

// @theater-source-begin renderWBTree
function renderWBTree() {
    const q = (runtime.wbSearch || '').toLowerCase().trim();
    const sel = runtime.settings.selectedWorldBooks || [];
    const names = runtime.wbBookNames.filter(n => !q || n.toLowerCase().includes(q));
    const manualCount = (runtime.settings.manualWBEntries || []).length;
    if (!runtime.wbBookNames.length && !manualCount) return '<p class="theater-empty">没找到世界书</p>';

    const nodes = names.map(name => {
        const selected = sel.includes(name);
        const idxs = [];
        if (selected) runtime.wbEntries.forEach((e, i) => { if (!e.manual && e.book === name) idxs.push(i); });
        const active = idxs.filter(i => runtime.wbStates[i] !== false).length;
        const collapsed = runtime.wbGroupCollapsed[name] !== false;
        return `
<div class="theater-wb-book-node" data-key="${runtime.esc(name)}">
    <div class="theater-wb-book-row${selected ? ' active' : ''}">
        <input type="checkbox" class="theater-wb-book-check" data-name="${runtime.esc(name)}" ${selected ? 'checked' : ''}>
        <span class="theater-wb-book-name">${runtime.esc(name)}</span>
        ${selected ? `<span class="theater-wb-group-count">${active}/${idxs.length}</span><i class="fa-solid fa-chevron-${collapsed ? 'right' : 'down'} theater-wb-group-arrow"></i>` : ''}
    </div>
    ${selected ? `<div class="theater-wb-group-body" style="${collapsed ? 'display:none;' : ''}">${wbBookBodyHTML(idxs)}</div>` : ''}
</div>`;
    });

    // 手动条目作为最后一个固定节点
    if (manualCount) {
        const idxs = [];
        runtime.wbEntries.forEach((e, i) => { if (e.manual) idxs.push(i); });
        const active = idxs.filter(i => runtime.wbStates[i] !== false).length;
        const collapsed = runtime.wbGroupCollapsed['__manual__'] !== false;
        nodes.push(`
<div class="theater-wb-book-node" data-key="__manual__">
    <div class="theater-wb-book-row active">
        <i class="fa-solid fa-pen" style="opacity:.6;"></i>
        <span class="theater-wb-book-name">手动添加</span>
        <span class="theater-wb-group-count">${active}/${idxs.length}</span>
        <i class="fa-solid fa-chevron-${collapsed ? 'right' : 'down'} theater-wb-group-arrow"></i>
    </div>
    <div class="theater-wb-group-body" style="${collapsed ? 'display:none;' : ''}">${wbBookBodyHTML(idxs)}</div>
</div>`);
    }

    if (!nodes.length) return `<p class="theater-empty">没找到包含「${runtime.esc(q)}」的世界书</p>`;
    return nodes.join('');
}
// @theater-source-end renderWBTree

// @theater-source-begin updateWBGroupCounts
function updateWBGroupCounts() {
    $('#theater-wb-books .theater-wb-book-node').each(function () {
        const $count = $(this).find('.theater-wb-group-count');
        if (!$count.length) return;
        const idxs = $(this).find('.theater-wb-check').map(function () { return parseInt($(this).data('index')); }).get();
        const active = idxs.filter(i => runtime.wbStates[i] !== false).length;
        $count.text(`${active}/${idxs.length}`);
    });
}
// @theater-source-end updateWBGroupCounts

// @theater-source-begin hasManualEntries
function hasManualEntries() {
    return (runtime.settings.manualWBEntries || []).length > 0;
}
// @theater-source-end hasManualEntries

// @theater-source-begin updateWBCount
function updateWBCount() {
    const total = runtime.wbEntries.length;
    let active = 0;
    const parts = [];
    for (let i = 0; i < total; i++) {
        if (runtime.wbStates[i] !== false) {
            active++;
            parts.push(runtime.wbEntries[i].content || '');
        }
    }
    // 与生成页实时预览使用同一份包装文本和同一个估算器，避免中文内容出现两套口径。
    const worldBookText = parts.length ? `世界书设定：\n${parts.join('\n\n')}` : '';
    const roughTokens = estimateTokenCount(worldBookText);
    $('#theater-wb-count').html(`${active}/${total} 个条目已勾选 · 已勾选上限约 ${formatTokenCount(roughTokens)} token`);
    $('#theater-wb-header').toggle(total > 0);
    updateWBGroupCounts();
}
// @theater-source-end updateWBCount

// @theater-source-begin refreshWBUI
function refreshWBUI() {
    $('#theater-wb-books').html(renderWBTree());
    updateWBCount();
    $('#theater-wb-clear-manual').toggle(hasManualEntries());
}
// @theater-source-end refreshWBUI

// @theater-source-begin setWBStateByIndex
function setWBStateByIndex(idx, on) {
    const entry = runtime.wbEntries[idx];
    if (!entry) return;
    while (runtime.wbStates.length <= idx) runtime.wbStates.push(true);
    runtime.wbStates[idx] = on;
    if (entry.manual) {
        const m = (runtime.settings.manualWBEntries || [])[entry.mIdx];
        if (m) m.on = on;
    } else if (entry.book) {
        if (!runtime.settings.worldBookStatesByBook) runtime.settings.worldBookStatesByBook = {};
        if (!runtime.settings.worldBookStatesByBook[entry.book]) runtime.settings.worldBookStatesByBook[entry.book] = {};
        const key = entryKey(entry);
        if (on) delete runtime.settings.worldBookStatesByBook[entry.book][key];
        else runtime.settings.worldBookStatesByBook[entry.book][key] = false;
    }
}
// @theater-source-end setWBStateByIndex

// @theater-source-begin syncManualIntoWB
function syncManualIntoWB() {
    const keep = [], keepStates = [];
    runtime.wbEntries.forEach((e, i) => { if (!e.manual) { keep.push(e); keepStates.push(runtime.wbStates[i]); } });
    (runtime.settings.manualWBEntries || []).forEach((m, j) => {
        keep.push({ manual: true, mIdx: j, name: m.name, content: m.content });
        keepStates.push(m.on !== false);
    });
    runtime.wbEntries = keep;
    runtime.wbStates = keepStates;
}
// @theater-source-end syncManualIntoWB

// @theater-source-begin loadPersona
function loadPersona(options = {}) {
    return syncPersonaToSettings(runtime.settings, runtime.save, runtime.theaterError, options);
}
// @theater-source-end loadPersona

// @theater-source-begin currentPresetEntryStates
function currentPresetEntryStates({ create = false } = {}) {
    return presetEntryStatesForPreset(
        runtime.settings.presetEntryStatesByPreset,
        runtime.settings.selectedPresetName,
        { create },
    );
}
// @theater-source-end currentPresetEntryStates

// @theater-source-begin renderPresetOptions
function renderPresetOptions() {
    const $select = $('#theater-preset-name-select');
    if (!$select.length) return;
    const q = (runtime.presetSearch || '').toLowerCase().trim();
    const names = runtime.presetNamesCache.filter(n => !q || n.toLowerCase().includes(q));
    $select.empty().append('<option value="">-- 选择预设 --</option>');
    names.forEach(n => $select.append(`<option value="${runtime.esc(n)}">${runtime.esc(n)}</option>`));
    if (runtime.settings.selectedPresetName && names.includes(runtime.settings.selectedPresetName)) $select.val(runtime.settings.selectedPresetName);
}
// @theater-source-end renderPresetOptions

// @theater-source-begin loadPresetNameList
async function loadPresetNameList() {
    const ctx = SillyTavern.getContext();
    const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
    let names = [];
    let source = '';

    // Strategy 0a: SillyTavern 官方 preset manager — ST 1.13+ 推荐 API
    if (!names.length) try {
        if (ctx?.getPresetManager) {
            const mgr = ctx.getPresetManager('openai');
            if (mgr && typeof mgr.getAllPresets === 'function') {
                const list = mgr.getAllPresets();
                if (Array.isArray(list) && list.length) {
                    names = list.filter(n => typeof n === 'string' && n.trim() && !n.startsWith('--'));
                    source = 'getPresetManager.getAllPresets()';
                }
            }
        }
    } catch (e) {
        console.warn('[Theater] getPresetManager.getAllPresets failed:', e);
    }

    // Strategy 0b: TavernHelper API — 第三方扩展，存在时优先
    if (!names.length && window.TavernHelper && typeof window.TavernHelper.getPresetNames === 'function') {
        try {
            const list = window.TavernHelper.getPresetNames();
            if (Array.isArray(list) && list.length) {
                names = list.filter(n => typeof n === 'string' && n.trim());
                source = 'TavernHelper.getPresetNames()';
            }
        } catch (e) {
            console.warn('[Theater] TavernHelper.getPresetNames failed:', e);
        }
    }

    // Strategy 1: Read from DOM — ONLY the Chat Completion preset selector
    // #settings_preset_openai is the exact ID for CC presets in ST
    if (!names.length) try {
        const $ccSelect = $('#settings_preset_openai');
        if ($ccSelect.length) {
            $ccSelect.find('option').each(function () {
                const text = $(this).text()?.trim();
                const val = $(this).val()?.trim();
                if (text && val && val !== 'default' && !text.startsWith('--') && !names.includes(text)) {
                    names.push(text);
                }
            });
            if (names.length) source = 'DOM #settings_preset_openai';
        }
    } catch (e) {
        console.warn('[Theater] DOM read failed:', e);
    }

    // Strategy 2: API POST /api/presets/search
    if (!names.length) {
        try {
            const r = await fetch('/api/presets/search', {
                method: 'POST', headers,
                body: JSON.stringify({ apiId: 'openai' }),
            });
            if (r.ok) {
                const data = await r.json();
                if (Array.isArray(data) && data.length) {
                    names = data.filter(n => typeof n === 'string' && n.trim());
                    source = 'API /api/presets/search';
                }
            }
        } catch {}
    }

    // Strategy 3: API GET /api/presets/openai
    if (!names.length) {
        try {
            const r = await fetch('/api/presets/openai', { method: 'GET', headers });
            if (r.ok) {
                const data = await r.json();
                if (Array.isArray(data) && data.length) {
                    names = data.filter(n => typeof n === 'string' && n.trim());
                    source = 'API GET /api/presets/openai';
                }
            }
        } catch {}
    }

    names.sort((a, b) => a.localeCompare(b));
    runtime.presetNamesCache = names;
    renderPresetOptions();
    console.log(`[Theater] Preset list: ${names.length} items from ${source || 'none'}`, names);

    if (!names.length) {
        toastr.warning('未找到 Chat Completion 预设，请确认酒馆已导入预设文件');
    }
}
// @theater-source-end loadPresetNameList

// @theater-source-begin parsePromptToEntries
function parsePromptToEntries(text, prefix) {
    const entries = [];
    const regex = /【([^】]+)】/g;
    let match;
    const matches = [];
    while ((match = regex.exec(text)) !== null) {
        matches.push({ name: match[1], start: match.index, headerEnd: match.index + match[0].length });
    }
    if (matches.length === 0) {
        // No section headers, return as single entry
        return [{ id: prefix + '_full', name: '完整内容', role: 'system', content: text.trim(), enabledInST: true }];
    }
    for (let i = 0; i < matches.length; i++) {
        const contentStart = matches[i].headerEnd;
        const contentEnd = i + 1 < matches.length ? matches[i + 1].start : text.length;
        const content = ('【' + matches[i].name + '】\n' + text.slice(contentStart, contentEnd).trim()).trim();
        entries.push({
            id: prefix + '_' + matches[i].name,
            name: matches[i].name,
            role: 'system',
            content,
            enabledInST: true,
        });
    }
    return entries;
}
// @theater-source-end parsePromptToEntries

// @theater-source-begin fetchPresetByName
async function fetchPresetByName(name) {
    // Strategy 0: SillyTavern 官方 preset manager — ST 1.13+ 推荐 API
    try {
        const ctx = SillyTavern.getContext();
        if (ctx?.getPresetManager) {
            const mgr = ctx.getPresetManager('openai');
            if (mgr && typeof mgr.getCompletionPresetByName === 'function') {
                const preset = mgr.getCompletionPresetByName(name);
                if (preset?.prompts && Array.isArray(preset.prompts)) {
                    console.log(`[Theater] Read preset "${name}" via getPresetManager (${preset.prompts.length} prompts)`);
                    return preset;
                }
            }
        }
    } catch (e) {
        console.warn('[Theater] getPresetManager.getCompletionPresetByName failed:', e);
    }

    // Strategy 1: TavernHelper API — 酒馆原生接口，最可靠
    if (window.TavernHelper && typeof window.TavernHelper.getPreset === 'function') {
        try {
            const preset = window.TavernHelper.getPreset(name);
            if (preset?.prompts && Array.isArray(preset.prompts)) {
                console.log(`[Theater] Read preset "${name}" via TavernHelper (${preset.prompts.length} prompts)`);
                return preset;
            }
            console.warn(`[Theater] TavernHelper returned preset but no valid prompts array`);
        } catch (e) {
            console.warn('[Theater] TavernHelper.getPreset failed:', e);
        }
    }

    // Strategy 2: 静态文件直读 (fallback for older ST)
    try {
        const r = await fetch(`/OpenAI Settings/${encodeURIComponent(name)}.settings`);
        if (r.ok) {
            const data = await r.json();
            if (data?.prompts && Array.isArray(data.prompts)) {
                console.log(`[Theater] Read preset "${name}" via static file (${data.prompts.length} prompts)`);
                return data;
            }
        }
    } catch (e) {
        console.warn('[Theater] Static file read failed:', e);
    }

    console.error(`[Theater] Failed to read preset: ${name}`);
    return null;
}
// @theater-source-end fetchPresetByName

// @theater-source-begin extractPromptsFromData
function extractPromptsFromData(data) {
    if (!data?.prompts || !Array.isArray(data.prompts)) return [];

    // SillyTavern 把"哪些 prompt 启用、按什么顺序"放在 prompt_order 里，
    // prompts 池里的 enabled 字段不可靠（很多预设默认 false 或缺失）。
    // 优先用 prompt_order；找不到再回退到 prompt.enabled。
    let orderEnabled = null;  // Map<identifier, boolean>
    let orderIndex = null;    // Map<identifier, number>
    if (Array.isArray(data.prompt_order) && data.prompt_order.length) {
        const orderEntry =
            data.prompt_order.find(o => o.character_id === 100001) ||
            data.prompt_order.find(o => o.character_id === 100000) ||
            data.prompt_order[0];
        if (orderEntry?.order && Array.isArray(orderEntry.order)) {
            orderEnabled = new Map(orderEntry.order.map(o => [o.identifier, o.enabled !== false]));
            orderIndex   = new Map(orderEntry.order.map((o, i) => [o.identifier, i]));
            const onCount  = orderEntry.order.filter(o => o.enabled !== false).length;
            const offCount = orderEntry.order.length - onCount;
            console.log(`[Theater] prompt_order found: ${onCount} enabled / ${offCount} disabled`);
        }
    } else {
        console.log('[Theater] prompt_order missing, falling back to prompts[].enabled');
    }

    const entries = data.prompts
        .filter(p => !p.forbid)
        .map((p, i) => {
            const id = p.identifier || `prompt_${i}`;
            const enabledInST = orderEnabled
                ? (orderEnabled.has(id) ? orderEnabled.get(id) : false)  // prompt_order 缺该项视为禁用（与 ST 行为一致）
                : (p.enabled !== false);
            return {
                id,
                name: p.name || p.identifier || `条目 ${i + 1}`,
                role: normalizePromptRole(p.role),
                content: String(p.content || ''),
                enabledInST,
                injectionPosition: p.injection_position ?? null,
                injectionDepth: p.injection_depth ?? null,
                injectionOrder: p.injection_order ?? null,
                systemPrompt: p.system_prompt !== false,
                marker: !!p.marker,
                forbidOverrides: !!p.forbid_overrides,
                _orderIdx: orderIndex?.has(id) ? orderIndex.get(id) : 10000 + i,
            };
        })
        .filter(entry => entry.content.trim() || [
            'worldInfoBefore', 'charDescription', 'charPersonality', 'scenario',
            'personaDescription', 'worldInfoAfter', 'dialogueExamples', 'chatHistory',
        ].includes(entry.id));

    entries.sort((a, b) => a._orderIdx - b._orderIdx);
    entries.forEach(e => delete e._orderIdx);
    return entries;
}
// @theater-source-end extractPromptsFromData

// @theater-source-begin setPresetEntryControlsEnabled
function setPresetEntryControlsEnabled(enabled) {
    $('#theater-preset-select-all, #theater-preset-deselect-all')
        .toggleClass('disabled', !enabled)
        .attr('aria-disabled', enabled ? 'false' : 'true');
}
// @theater-source-end setPresetEntryControlsEnabled

// @theater-source-begin currentPresetSnapshot
function currentPresetSnapshot() {
    const name = String(runtime.cachedPresetName || '');
    const entries = runtime.cachedPresetEntries.map(entry => Object.freeze({ ...entry }));
    const states = presetEntryStatesForPreset(runtime.settings.presetEntryStatesByPreset, name);
    const selectedEntries = entries.filter(entry => states[entry.id] !== false);
    return Object.freeze({
        status: runtime.cachedPresetLoadState,
        name,
        entries: Object.freeze(entries),
        selectedEntries: Object.freeze(selectedEntries),
        prompt: selectedEntries.map(entry => entry.content).join('\n\n'),
        postProcessing: runtime.cachedPresetPostProcessing,
        squashSystemMessages: runtime.cachedPresetSquashSystemMessages,
    });
}
// @theater-source-end currentPresetSnapshot

// @theater-source-begin loadPresetEntries
async function loadPresetEntries(expectedName = runtime.settings.selectedPresetName) {
    const sel = String(expectedName || '');
    if (String(runtime.settings.selectedPresetName || '') !== sel) return { status: 'stale', name: sel };
    if (runtime.presetLoadInFlight?.name === sel) return await runtime.presetLoadInFlight.promise;
    const requestId = ++runtime.presetLoadSequence;
    runtime.cachedPresetEntries = [];
    runtime.cachedPresetPostProcessing = '';
    runtime.cachedPresetSquashSystemMessages = false;
    runtime.cachedPresetName = sel;
    runtime.cachedPresetLoadState = sel ? 'loading' : 'default';

    if (!sel) {
        runtime.presetLoadInFlight = null;
        $('#theater-preset-entries').html('<p class="theater-empty">请选择预设</p>');
        $('#theater-preset-current').hide();
        setPresetEntryControlsEnabled(false);
        return currentPresetSnapshot();
    }

    $('#theater-preset-current').show();
    // 读取资料不改变用户的展开选择；新弹窗里的条目列表默认保持收起。
    $('#theater-preset-entries').html('<p class="theater-empty">正在读取预设…</p>');
    setPresetEntryControlsEnabled(false);

    const promise = (async () => {
        // Fetch preset by name from ST
        const data = await fetchPresetByName(sel);
        const entries = data ? extractPromptsFromData(data) : [];
        const postProcessing = data
            ? noToolsPostProcessingMode(
                data.custom_prompt_post_processing
                ?? data.prompt_post_processing
                ?? data.openai_settings?.custom_prompt_post_processing
                ?? '',
            )
            : '';
        const squashSystemMessages = !!data?.squash_system_messages;
        if (requestId !== runtime.presetLoadSequence || String(runtime.settings.selectedPresetName || '') !== sel) {
            return { status: 'stale', name: sel };
        }
        runtime.cachedPresetEntries = entries;
        runtime.cachedPresetPostProcessing = postProcessing;
        runtime.cachedPresetSquashSystemMessages = squashSystemMessages;
        runtime.cachedPresetName = sel;
        runtime.cachedPresetLoadState = !data ? 'error' : (entries.length ? 'ready' : 'empty');
        if (data) {
            console.log(`[Theater] Extracted ${runtime.cachedPresetEntries.length} entries from preset "${sel}"`);
        }

        if (!runtime.cachedPresetEntries.length) {
            const hint = data
                ? `预设「${sel}」已读取但无可用条目（可能是采样器预设而非 Prompt 预设）`
                : `预设「${sel}」读取失败，请打开浏览器控制台查看 [Theater] 日志`;
            toastr.warning(hint);
            $('#theater-preset-entries').html(`<p class="theater-empty">${runtime.esc(hint)}</p>`);
            setPresetEntryControlsEnabled(false);
            return currentPresetSnapshot();
        }

        // Init states
        const states = presetEntryStatesForPreset(runtime.settings.presetEntryStatesByPreset, sel, { create: true });
        runtime.cachedPresetEntries.forEach(e => {
            if (!runtime.hasOwn(states, e.id)) {
                states[e.id] = e.enabledInST;
            }
        });

        $('#theater-preset-current').show();
        $('#theater-preset-entries').html(renderPresetEntries());
        setPresetEntryControlsEnabled(true);
        runtime.scheduleTokenEstimate();
        return currentPresetSnapshot();
    })();
    runtime.presetLoadInFlight = { name: sel, requestId, promise };
    promise.then(() => {
        if (runtime.presetLoadInFlight?.requestId === requestId) runtime.presetLoadInFlight = null;
    }, () => {
        if (runtime.presetLoadInFlight?.requestId === requestId) runtime.presetLoadInFlight = null;
    });
    return await promise;
}
// @theater-source-end loadPresetEntries

// @theater-source-begin ensureSelectedPresetLoaded
async function ensureSelectedPresetLoaded() {
    for (let attempt = 0; attempt < 4; attempt++) {
        const selected = String(runtime.settings.selectedPresetName || '');
        if (runtime.cachedPresetName !== selected || runtime.cachedPresetLoadState === 'loading') {
            await loadPresetEntries(selected);
        }
        if (selected !== String(runtime.settings.selectedPresetName || '')) continue;
        if (runtime.cachedPresetName !== selected || runtime.cachedPresetLoadState === 'loading') continue;
        if (runtime.cachedPresetLoadState === 'error') {
            throw new Error(`所选预设「${selected}」读取失败，请刷新预设后重试`);
        }
        if (runtime.cachedPresetLoadState === 'empty') {
            throw new Error(`所选预设「${selected}」没有可用 Prompt 条目，请换一个预设后重试`);
        }
        return currentPresetSnapshot();
    }
    throw new Error('预设正在切换，请等读取完成后再生成');
}
// @theater-source-end ensureSelectedPresetLoaded

// @theater-source-begin renderPresetEntries
function renderPresetEntries() {
    if (!runtime.cachedPresetEntries.length) return '<p class="theater-empty">暂无预设条目</p>';
    const states = currentPresetEntryStates();
    return runtime.cachedPresetEntries.map(entry => {
        const checked = states[entry.id] !== false;
        const roleTag = entry.role === 'system' ? 'SYS' : entry.role === 'user' ? 'USR' : 'AST';
        const depth = Math.max(0, Math.floor(Number(entry.injectionDepth) || 0));
        const order = Number.isFinite(Number(entry.injectionOrder)) ? Number(entry.injectionOrder) : 100;
        const depthTag = Number(entry.injectionPosition) === 1
            ? `<span class="theater-preset-entry-depth" title="按酒馆设置插入聊天历史：深度 ${depth}，顺序 ${order}">@${depth}</span>`
            : '';
        return `
<div class="theater-wb-entry ${checked ? '' : 'theater-wb-entry-off'}">
    <div class="theater-preset-entry-header" data-id="${runtime.esc(entry.id)}">
        <input type="checkbox" class="theater-preset-check" data-id="${runtime.esc(entry.id)}" ${checked ? 'checked' : ''}>
        <span class="theater-wb-entry-source" title="酒馆预设角色：${runtime.esc(entry.role)}">${roleTag}</span>
        ${depthTag}
        <span class="theater-wb-entry-name">${runtime.esc(entry.name)}</span>
        <span class="theater-preset-entry-toggle" data-id="${runtime.esc(entry.id)}"><i class="fa-solid fa-chevron-right"></i></span>
    </div>
    <div class="theater-preset-entry-body" data-id="${runtime.esc(entry.id)}" style="display:none;">
        <div class="theater-wb-entry-content">${runtime.esc(entry.content)}</div>
    </div>
</div>`;
    }).join('');
}
// @theater-source-end renderPresetEntries

// @theater-source-begin getSelectedPresetPrompt
function getSelectedPresetPrompt() {
    if (!runtime.cachedPresetEntries.length) return '';
    const states = currentPresetEntryStates();
    return runtime.cachedPresetEntries
        .filter(e => states[e.id] !== false)
        .map(e => e.content)
        .join('\n\n');
}
// @theater-source-end getSelectedPresetPrompt

// @theater-source-begin getSelectedPresetEntries
function getSelectedPresetEntries() {
    const states = currentPresetEntryStates();
    return runtime.cachedPresetEntries.filter(entry => states[entry.id] !== false);
}
// @theater-source-end getSelectedPresetEntries

// @theater-source-begin loadWorldBookList
async function loadWorldBookList() {
    let names = [];
    const previousNames = [...runtime.wbBookNames];
    let serverListLoaded = false;

    try {
        const ctx = SillyTavern.getContext();
        const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };

        // DOM —— 只认这两个真正装着世界书名的下拉框。
        // 之前用 select[id*="world_info"] 通配，把排序方式下拉框（均匀排序/优先级/词符…）的选项也当成了书名
        $('#world_info_select option, #world_editor_select option').each(function () {
            const text = $(this).text()?.trim();
            if (text && text !== 'None' && text !== '--- None ---' && !text.startsWith('--')) {
                if (!names.includes(text)) names.push(text);
            }
        });

        // Character-bound
        if (ctx.characterId !== undefined && ctx.characters?.[ctx.characterId]) {
            const cw = ctx.characters[ctx.characterId].data?.extensions?.world;
            if (cw && !names.includes(cw)) names.push(cw);
        }

        // Chat-bound
        if (ctx.chatMetadata?.world_info) {
            const chatWI = ctx.chatMetadata.world_info;
            if (chatWI && !names.includes(chatWI)) names.push(chatWI);
        }

        // Server API：始终合并完整目录；页面下拉框可能只暴露当前使用的少数几本。
        try {
            const r = await fetch('/api/worldinfo/list', { method: 'GET', headers });
            if (r.ok) {
                const list = await r.json();
                (Array.isArray(list) ? list : list?.data || []).forEach(n => { if (n && !names.includes(n)) names.push(n); });
                serverListLoaded = true;
            }
        } catch { }
    } catch (e) { console.error('[Theater] WB list error:', e); }

    // 服务器暂时失败时保留上一次完整目录，避免可选项突然缩水；成功时以最新目录为准。
    if (!serverListLoaded) previousNames.forEach(name => { if (name && !names.includes(name)) names.push(name); });
    // 已选中但没被发现的书也要进列表，不然没法取消勾选
    (runtime.settings.selectedWorldBooks || []).forEach(b => { if (b && !names.includes(b)) names.push(b); });
    runtime.wbBookNames = names;
    $('#theater-wb-books').html(renderWBTree());
    console.log(`[Theater] Found ${names.length} world books`);
}
// @theater-source-end loadWorldBookList

// @theater-source-begin entryKey
function entryKey(e) {
    if (e?.uid !== undefined && e?.uid !== null) return String(e.uid);
    return 'm:' + (e?.name || '') + ':' + (e?.content || '').slice(0, 30);
}
// @theater-source-end entryKey

// @theater-source-begin reloadWorldBooks
function reloadWorldBooks({ silent = false, force = false, requireFresh = false } = {}) {
    const books = [...(runtime.settings.selectedWorldBooks || [])];
    const readMode = runtime.settings.worldBookReadMode;
    const cacheKey = worldBookCacheKey(books, readMode);
    if (!force && runtime.wbReloadInFlight?.cacheKey === cacheKey) return runtime.wbReloadInFlight.promise;
    const requestId = ++runtime.wbReloadSequence;
    const previousByBook = new Map();
    let previousCacheBooks = new Set();
    try {
        const previousCache = JSON.parse(runtime.wbLoadedCacheKey || '{}');
        if (String(previousCache.readMode || 'all') === String(readMode || 'all')) {
            previousCacheBooks = new Set(Array.isArray(previousCache.books) ? previousCache.books : []);
        }
    } catch {}
    runtime.wbEntries.forEach(entry => {
        if (entry.manual || !entry.book) return;
        if (!previousByBook.has(entry.book)) previousByBook.set(entry.book, []);
        previousByBook.get(entry.book).push(entry);
    });
    const promise = (async () => {
        const results = [];
        let loadedBooks = 0;
        try {
            const ctx = SillyTavern.getContext();
            const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
            for (const name of books) {
                try {
                    const resp = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name }) });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = await resp.json();
                    if (!data?.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) {
                        throw new Error('世界书返回格式不完整');
                    }
                    const sourceEntries = Object.entries(data.entries)
                        .filter(([, entry]) => entry.content)
                        .map(([entryId, entry]) => {
                            const source = { ...entry, uid: entry.uid ?? entryId, world: name };
                            return {
                                source,
                                normalized: {
                                    book: name,
                                    uid: source.uid,
                                    name: source.comment || (Array.isArray(source.key) ? source.key.join(', ') : String(source.key || '')) || '未命名',
                                    content: source.content,
                                    disabled: !!source.disable,
                                    strategy: worldBookEntryStrategy(source),
                                    position: Number.isFinite(Number(source.position)) ? Number(source.position) : 0,
                                    depth: Math.max(0, Math.floor(Number(source.depth) || 0)),
                                    order: Number.isFinite(Number(source.order)) ? Number(source.order) : 100,
                                    role: normalizePromptRole(source.role),
                                    outletName: String(source.outletName || source.outlet || ''),
                                    raw: source,
                                },
                            };
                        });
                    results.push({
                        name,
                        sourceKeys: sourceEntries.map(({ normalized }) => entryKey(normalized)),
                        entries: sourceEntries
                            .filter(({ source }) => shouldReadWorldBookEntry(source, readMode))
                            .map(({ normalized }) => normalized),
                        available: true,
                    });
                    loadedBooks++;
                } catch (error) {
                    console.error('[Theater] WB load error:', name, error);
                    const fallbackEntries = runtime.wbLoadedReadMode === String(readMode || 'all')
                        ? [...(previousByBook.get(name) || [])]
                        : [];
                    results.push({
                        name,
                        sourceKeys: null,
                        entries: fallbackEntries,
                        available: fallbackEntries.length > 0 || previousCacheBooks.has(name),
                    });
                    if (!silent && requestId === runtime.wbReloadSequence) toastr.error(`世界书「${name}」读取失败: ` + error.message);
                }
            }
        } catch (error) {
            console.error('[Theater] WB reload error:', error);
        }

        if (requestId !== runtime.wbReloadSequence || cacheKey !== worldBookCacheKey()) return false;

        // 到提交这一刻才读取条目开关，避免慢请求把用户刚刚的勾选覆盖掉。
        const currentStatesByBook = runtime.settings.worldBookStatesByBook || {};
        const currentKnownEntriesByBook = runtime.settings.worldBookKnownEntriesByBook || {};
        const committedStatesByBook = { ...currentStatesByBook };
        const committedKnownEntriesByBook = { ...currentKnownEntriesByBook };
        const all = [];
        const allStates = [];
        let complete = results.length === books.length;

        results.forEach(result => {
            if (!result.available) {
                complete = false;
                return;
            }
            if (Array.isArray(result.sourceKeys)) {
                const remembered = rememberWorldBookEntryStates(
                    result.sourceKeys,
                    currentKnownEntriesByBook[result.name],
                    currentStatesByBook[result.name],
                );
                committedStatesByBook[result.name] = remembered.savedStates;
                committedKnownEntriesByBook[result.name] = remembered.knownKeys;
            }
            const latestBookStates = committedStatesByBook[result.name] || currentStatesByBook[result.name] || {};
            result.entries.forEach(entry => {
                all.push(entry);
                allStates.push(latestBookStates[entryKey(entry)] !== false);
            });
        });

        runtime.settings.worldBookStatesByBook = committedStatesByBook;
        runtime.settings.worldBookKnownEntriesByBook = committedKnownEntriesByBook;
        runtime.wbEntries = all;
        runtime.wbStates = allStates;
        runtime.wbLoadedCacheKey = complete ? cacheKey : '';
        runtime.wbLoadedReadMode = String(readMode || 'all');
        syncManualIntoWB();
        runtime.save();
        refreshWBUI();
        runtime.scheduleTokenEstimate();
        if (!silent && books.length && complete) toastr.success(`已加载 ${loadedBooks} 本世界书 · ${all.length} 个条目`);
        return complete && (!requireFresh || loadedBooks === books.length);
    })();
    runtime.wbReloadInFlight = { cacheKey, requestId, promise };
    promise.then(() => {
        if (runtime.wbReloadInFlight?.requestId === requestId) runtime.wbReloadInFlight = null;
    }, () => {
        if (runtime.wbReloadInFlight?.requestId === requestId) runtime.wbReloadInFlight = null;
    });
    return promise;
}
// @theater-source-end reloadWorldBooks

// @theater-source-begin ensureWorldBooksCurrent
async function ensureWorldBooksCurrent({ silent = true } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const cacheKey = worldBookCacheKey();
        const active = runtime.wbReloadInFlight?.cacheKey === cacheKey ? runtime.wbReloadInFlight.promise : null;
        if (active) {
            await active;
        } else if (runtime.wbLoadedCacheKey !== cacheKey) {
            await reloadWorldBooks({ silent });
        }
        if (cacheKey !== worldBookCacheKey()) continue;
        if (runtime.wbLoadedCacheKey === cacheKey) return true;
    }
    throw new Error('当前选择的世界书读取失败，请检查世界书后重试');
}
// @theater-source-end ensureWorldBooksCurrent

// @theater-source-begin getCharBoundBooks
function getCharBoundBooks() {
    const books = [];
    try {
        const ctx = SillyTavern.getContext();
        const c = (ctx.characterId !== undefined && ctx.characterId !== null) ? ctx.characters?.[ctx.characterId] : null;
        const primary = c?.data?.extensions?.world;
        if (primary) books.push(primary);
        // 附加世界书（charLore）：不同 ST 版本暴露位置不一样，能拿到就用
        const avatar = c?.avatar;
        const charLore = ctx.worldInfoSettings?.charLore || window.world_info?.charLore;
        if (avatar && Array.isArray(charLore)) {
            const fileName = String(avatar).replace(/\.[^.]+$/, '');
            const found = charLore.find(e => e?.name === fileName);
            (found?.extraBooks || []).forEach(b => { if (b && !books.includes(b)) books.push(b); });
        }
        // 聊天绑定的世界书也算
        const chatBook = ctx.chatMetadata?.world_info;
        if (typeof chatBook === 'string' && chatBook && !books.includes(chatBook)) books.push(chatBook);
    } catch (e) { console.warn('[Theater] 读取角色绑定世界书失败:', e); }
    return books;
}
// @theater-source-end getCharBoundBooks

// @theater-source-begin applyCharBoundBooks
async function applyCharBoundBooks({ announce = false } = {}) {
    const books = getCharBoundBooks();
    const synced = syncFollowedWorldBooks(runtime.settings.selectedWorldBooks, runtime.settings.followedWorldBooks, books);
    runtime.settings.selectedWorldBooks = synced.selectedBooks;
    runtime.settings.followedWorldBooks = synced.followedBooks;
    runtime.save();
    if (announce) toastr.info(books.length ? `已跟随当前角色卡的 ${books.length} 本世界书，手动勾选会保留` : '这张卡没有绑定世界书，已撤下上一张卡自动带入的书');
    books.forEach(b => { if (!runtime.wbBookNames.includes(b)) runtime.wbBookNames.push(b); });
    if ($('#theater-wb-books').length) {
        $('#theater-wb-books').html(renderWBTree());
    }
    // 即使弹窗关闭也刷新缓存，避免自动生成沿用上一张角色卡的世界书。
    await reloadWorldBooks({ silent: true });
}
// @theater-source-end applyCharBoundBooks

return { knownInstructionTags, tagFilterSummary, historyTagFilterLabel, contextExclusionSettingsHTML, contextExclusionRulesHTML, refreshContextExclusionRules, addContextExclusionRule, previewContextExclusions, worldBookCacheKey, isWorldBookCacheCurrent, wbEntryHTML, wbBookBodyHTML, renderWBTree, updateWBGroupCounts, hasManualEntries, updateWBCount, refreshWBUI, setWBStateByIndex, syncManualIntoWB, loadPersona, currentPresetEntryStates, renderPresetOptions, loadPresetNameList, parsePromptToEntries, fetchPresetByName, extractPromptsFromData, setPresetEntryControlsEnabled, currentPresetSnapshot, loadPresetEntries, ensureSelectedPresetLoaded, renderPresetEntries, getSelectedPresetPrompt, getSelectedPresetEntries, loadWorldBookList, entryKey, reloadWorldBooks, ensureWorldBooksCurrent, getCharBoundBooks, applyCharBoundBooks };
}
