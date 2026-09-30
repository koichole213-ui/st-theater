// theater-render-selection: receives live state and cross-feature callbacks from index.js.
import { DEFAULT_RENDER_TEMPLATE_PC, DEFAULT_RENDER_TEMPLATE_TEXT, DEFAULT_RENDER_TEMPLATE } from './theater-defaults.js';
import { isPlainTextSelection, PLAIN_TEXT_LIGHT_SELECTION, PLAIN_TEXT_DARK_SELECTION } from './plain-text-renderer.js';
import { adaptiveRenderProfile, adaptiveRenderProfiles } from './adaptive-render.js';

export function createTheaterRenderSelection(runtime) {
// @theater-source-begin isBuiltinRenderSelection
function isBuiltinRenderSelection(selection) {
    return runtime.BUILTIN_RENDER_SELECTIONS.has(selection);
}
// @theater-source-end isBuiltinRenderSelection

// @theater-source-begin renderTemplateContentForSelection
function renderTemplateContentForSelection(selection, customTemplates = []) {
    if (selection === '__default_pc__') return DEFAULT_RENDER_TEMPLATE_PC;
    if (isPlainTextSelection(selection)) return DEFAULT_RENDER_TEMPLATE_TEXT;
    const adaptive = adaptiveRenderProfile(selection);
    if (adaptive) return adaptive.rules;
    if (selection !== '__default__') {
        const custom = customTemplates[parseInt(selection)];
        if (custom) return custom.content;
    }
    return DEFAULT_RENDER_TEMPLATE;
}
// @theater-source-end renderTemplateContentForSelection

// @theater-source-begin normalizeRenderSelection
function normalizeRenderSelection(selection, customTemplates = []) {
    const value = String(selection || '__default__');
    if (isBuiltinRenderSelection(value)) return value;
    const index = Number.parseInt(value, 10);
    return Number.isInteger(index) && index >= 0 && customTemplates[index] ? String(index) : '__default__';
}
// @theater-source-end normalizeRenderSelection

// @theater-source-begin renderSelectionMeta
function renderSelectionMeta(selection, customTemplates = []) {
    const value = normalizeRenderSelection(selection, customTemplates);
    const adaptive = adaptiveRenderProfile(value);
    if (adaptive) return { value, name: adaptive.name, shortName: adaptive.shortName, icon: adaptive.icon, adaptive: true };
    if (value === '__default_pc__') return { value, name: '默认模板（PC端）', shortName: '默认 PC', icon: 'fa-desktop', adaptive: false };
    if (value === PLAIN_TEXT_LIGHT_SELECTION) return { value, name: '纯文字模板（亮色）', shortName: '纯文字·亮色', icon: 'fa-book-open', adaptive: false };
    if (value === PLAIN_TEXT_DARK_SELECTION) return { value, name: '纯文字模板（暗色夜读）', shortName: '纯文字·暗色', icon: 'fa-moon', adaptive: false };
    if (value === '__default__') return { value, name: '默认模板（移动端）', shortName: '默认美化', icon: 'fa-mobile-screen', adaptive: false };
    const custom = customTemplates[Number.parseInt(value, 10)];
    return { value, name: custom?.name || '自定义模板', shortName: custom?.name || '自定义模板', icon: 'fa-palette', adaptive: false };
}
// @theater-source-end renderSelectionMeta

// @theater-source-begin renderTemplateOptions
function renderTemplateOptions(selected, customTemplates = []) {
    const current = normalizeRenderSelection(selected, customTemplates);
    const option = (value, label) => `<option value="${runtime.esc(value)}" ${current === value ? 'selected' : ''}>${runtime.esc(label)}</option>`;
    const basic = [
        option('__default__', '默认模板（移动端）'),
        option('__default_pc__', '默认模板（PC端）'),
        option(PLAIN_TEXT_LIGHT_SELECTION, '纯文字模板（亮色）'),
        option(PLAIN_TEXT_DARK_SELECTION, '纯文字模板（暗色夜读）'),
    ].join('');
    const adaptive = adaptiveRenderProfiles().map(profile => option(profile.id, profile.name)).join('');
    const custom = customTemplates.map((template, index) => option(String(index), template.name)).join('');
    return [
        `<optgroup label="基础内置">${basic}</optgroup>`,
        `<optgroup label="剧情自适应">${adaptive}</optgroup>`,
        custom ? `<optgroup label="我的模板">${custom}</optgroup>` : '',
    ].join('');
}
// @theater-source-end renderTemplateOptions

// @theater-source-begin renderSelectionHint
function renderSelectionHint(selection) {
    const adaptive = adaptiveRenderProfile(selection);
    return adaptive
        ? adaptive.description
        : (isPlainTextSelection(selection)
            ? '纯文字亮色与暗色都只让模型输出正文；夜间配色由插件在本地显示。'
            : '普通美化模板沿用现有生成方式；5000 字起仍会在正文完成后独立排版。');
}
// @theater-source-end renderSelectionHint

// @theater-source-begin quickRenderState
function quickRenderState() {
    const customTemplates = runtime.settings.renderTemplates || [];
    const a = normalizeRenderSelection(runtime.settings.quickRenderA, customTemplates);
    const b = normalizeRenderSelection(runtime.settings.quickRenderB, customTemplates);
    const current = normalizeRenderSelection(runtime.settings.selectedRenderIndex, customTemplates);
    const slot = current === a ? 'A' : (current === b ? 'B' : '当前');
    return { a, b, current, slot, meta: renderSelectionMeta(current, customTemplates) };
}
// @theater-source-end quickRenderState

// @theater-source-begin quickRenderButtonContent
function quickRenderButtonContent() {
    const state = quickRenderState();
    return `<i class="fa-solid ${state.meta.icon}" aria-hidden="true"></i><span>${runtime.esc(state.slot)} · ${runtime.esc(state.meta.shortName)}</span>`;
}
// @theater-source-end quickRenderButtonContent

// @theater-source-begin refreshRenderSelectionControls
function refreshRenderSelectionControls({ refreshOptions = false } = {}) {
    const customTemplates = runtime.settings.renderTemplates || [];
    runtime.settings.selectedRenderIndex = normalizeRenderSelection(runtime.settings.selectedRenderIndex, customTemplates);
    runtime.settings.quickRenderA = normalizeRenderSelection(runtime.settings.quickRenderA, customTemplates);
    runtime.settings.quickRenderB = normalizeRenderSelection(runtime.settings.quickRenderB, customTemplates);
    const state = quickRenderState();
    const adaptive = adaptiveRenderProfile(state.current);

    if (refreshOptions) {
        $('#theater-render-select').html(renderTemplateOptions(state.current, customTemplates));
        $('#theater-quick-render-a').html(renderTemplateOptions(state.a, customTemplates));
        $('#theater-quick-render-b').html(renderTemplateOptions(state.b, customTemplates));
    } else {
        $('#theater-render-select').val(state.current);
        $('#theater-quick-render-a').val(state.a);
        $('#theater-quick-render-b').val(state.b);
    }
    $('#theater-render-content').val(renderTemplateContentForSelection(state.current, customTemplates));
    $('#theater-render-selection-hint').text(renderSelectionHint(state.current));
    const builtinSelection = isBuiltinRenderSelection(state.current);
    $('#theater-delete-render-btn')
        .prop('disabled', builtinSelection)
        .attr('title', builtinSelection ? '内置模板不可删除' : '删除当前选中的自定义模板')
        .find('span').text(builtinSelection ? '内置模板不可删除' : '删除这个自定义模板');
    $('#theater-quick-render-toggle')
        .html(quickRenderButtonContent())
        .toggleClass('is-adaptive', !!adaptive)
        .prop('disabled', runtime.isGenerating);
    runtime.scheduleTokenEstimate();
}
// @theater-source-end refreshRenderSelectionControls

// @theater-source-begin switchQuickRenderSelection
function switchQuickRenderSelection() {
    if (runtime.isGenerating) {
        toastr.info('本轮生成已经开始，完成后再切换模板');
        return;
    }
    const state = quickRenderState();
    runtime.settings.selectedRenderIndex = state.current === state.a ? state.b : state.a;
    runtime.save();
    refreshRenderSelectionControls();
}
// @theater-source-end switchQuickRenderSelection

// @theater-source-begin updateQuickRenderSetting
function updateQuickRenderSetting(slot, selection) {
    const field = slot === 'B' ? 'quickRenderB' : 'quickRenderA';
    const otherField = slot === 'B' ? 'quickRenderA' : 'quickRenderB';
    const customTemplates = runtime.settings.renderTemplates || [];
    const next = normalizeRenderSelection(selection, customTemplates);
    const previous = normalizeRenderSelection(runtime.settings[field], customTemplates);
    const other = normalizeRenderSelection(runtime.settings[otherField], customTemplates);
    if (next === other) {
        toastr.warning('模板 A 和模板 B 需要选择不同模板');
        $(`#theater-quick-render-${slot.toLowerCase()}`).val(previous);
        return;
    }
    runtime.settings[field] = next;
    if (normalizeRenderSelection(runtime.settings.selectedRenderIndex, customTemplates) === previous) {
        runtime.settings.selectedRenderIndex = next;
    }
    runtime.save();
    refreshRenderSelectionControls();
}
// @theater-source-end updateQuickRenderSetting

// @theater-source-begin renderSelectionAfterCustomDelete
function renderSelectionAfterCustomDelete(selection, deletedIndex) {
    if (isBuiltinRenderSelection(selection)) return selection;
    const index = Number.parseInt(selection, 10);
    if (!Number.isInteger(index) || index === deletedIndex) return '__default__';
    return String(index > deletedIndex ? index - 1 : index);
}
// @theater-source-end renderSelectionAfterCustomDelete

return { isBuiltinRenderSelection, renderTemplateContentForSelection, normalizeRenderSelection, renderSelectionMeta, renderTemplateOptions, renderSelectionHint, quickRenderState, quickRenderButtonContent, refreshRenderSelectionControls, switchQuickRenderSelection, updateQuickRenderSetting, renderSelectionAfterCustomDelete };
}
