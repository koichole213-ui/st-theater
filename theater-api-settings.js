// theater-api-settings: receives live state and cross-feature callbacks from index.js.
import { normalizeMaxTokens } from './api-client.js';
import { normalizeApiPresetList, MAX_API_PRESETS } from './api-presets.js';
import { SOUND_PRESETS } from './theater-defaults.js';

export function createTheaterApiSettings(runtime) {
// @theater-source-begin readApiFormConfig
function readApiFormConfig() {
    return {
        apiUrl: ($('#theater-api-url').val() || '').trim().replace(/\/+$/, ''),
        apiKey: ($('#theater-api-key').val() || '').trim(),
        apiModel: ($('#theater-api-model').val() || '').trim(),
        apiProtocol: $('#theater-api-protocol').val() || 'auto',
        maxOutputTokens: normalizeMaxTokens($('#theater-max-output-tokens').val()),
    };
}
// @theater-source-end readApiFormConfig

// @theater-source-begin writeApiFormConfig
function writeApiFormConfig(config) {
    $('#theater-api-url').val(config.apiUrl || '');
    $('#theater-api-key').val(config.apiKey || '');
    $('#theater-api-model').val(config.apiModel || '');
    $('#theater-api-protocol').val(config.apiProtocol || 'auto');
    $('#theater-max-output-tokens').val(normalizeMaxTokens(config.maxOutputTokens));
    $('#theater-api-model-select').empty().hide();
}
// @theater-source-end writeApiFormConfig

// @theater-source-begin apiPresetDefaultName
function apiPresetDefaultName(config) {
    if (config.apiModel) return config.apiModel.slice(0, 40);
    try { return new URL(config.apiUrl).hostname.slice(0, 40); } catch { return '我的 API'; }
}
// @theater-source-end apiPresetDefaultName

// @theater-source-begin apiPresetDisplayLabel
function apiPresetDisplayLabel(preset) {
    const model = String(preset?.apiModel || '').trim();
    return `${preset?.name || '未命名'}${model ? ` · ${model.slice(0, 60)}` : ''}`;
}
// @theater-source-end apiPresetDisplayLabel

// @theater-source-begin validateApiPresetConfig
function validateApiPresetConfig(config) {
    if (!config.apiUrl) { toastr.warning('请先填写 API URL'); return false; }
    if (!config.apiModel) { toastr.warning('请先填写模型名称'); return false; }
    return true;
}
// @theater-source-end validateApiPresetConfig

// @theater-source-begin persistCurrentApiConfig
function persistCurrentApiConfig(config = readApiFormConfig()) {
    runtime.settings.apiMode = $('#theater-api-mode').val() || 'custom';
    runtime.settings.apiUrl = config.apiUrl;
    runtime.settings.apiKey = config.apiKey;
    runtime.settings.apiModel = config.apiModel;
    runtime.settings.apiProtocol = config.apiProtocol;
    runtime.settings.maxOutputTokens = config.maxOutputTokens;
    runtime.settings.autoContinue = $('#theater-auto-continue').is(':checked');
    runtime.settings.maxAutoRounds = Math.min(10, Math.max(1, parseInt($('#theater-max-auto-rounds').val()) || 3));
    $('#theater-max-output-tokens').val(runtime.settings.maxOutputTokens);
    $('#theater-max-auto-rounds').val(runtime.settings.maxAutoRounds);
    runtime.save();
}
// @theater-source-end persistCurrentApiConfig

// @theater-source-begin refreshApiPresetControls
function refreshApiPresetControls(selectedId = runtime.settings.selectedApiPresetId || '') {
    runtime.settings.apiPresets = normalizeApiPresetList(runtime.settings.apiPresets);
    if (!runtime.settings.apiPresets.some(preset => preset.id === selectedId)) selectedId = '';
    runtime.settings.selectedApiPresetId = selectedId;
    const $select = $('#theater-api-preset-select');
    if ($select.length) {
        $select.empty().append('<option value="">选择已保存的 API 预设</option>');
        runtime.settings.apiPresets.forEach(preset => {
            $select.append($('<option>').val(preset.id).text(apiPresetDisplayLabel(preset)));
        });
        $select.val(selectedId);
    }
    $('#theater-api-preset-count').text(`${runtime.settings.apiPresets.length}/${MAX_API_PRESETS}`);
    $('#theater-update-api-preset-btn,#theater-rename-api-preset-btn,#theater-delete-api-preset-btn')
        .toggleClass('disabled', !selectedId)
        .prop('disabled', !selectedId);
    if (!runtime.settings.apiPresets.some(preset => preset.id === runtime.settings.longDreamMemoryApiPresetId)) {
        runtime.settings.longDreamMemoryApiPresetId = '';
    }
    const $memorySelect = $('#theater-dream-memory-api-preset');
    if ($memorySelect.length) {
        $memorySelect.empty().append('<option value="">尚未绑定（暂停自动织录）</option>');
        runtime.settings.apiPresets.forEach(preset => {
            $memorySelect.append($('<option>').val(preset.id).text(apiPresetDisplayLabel(preset)));
        });
        $memorySelect.val(runtime.settings.longDreamMemoryApiPresetId || '');
    }
    const memoryPreset = runtime.settings.apiPresets.find(preset => preset.id === runtime.settings.longDreamMemoryApiPresetId);
    $('#theater-dream-memory-summary').text(memoryPreset
        ? `${memoryPreset.name} · 每 ${Math.max(1, Number(runtime.settings.longDreamMemoryBatchSize) || 3)} 章`
        : '尚未绑定副 API');
}
// @theater-source-end refreshApiPresetControls

// @theater-source-begin refreshConfigSummaries
function refreshConfigSummaries() {
    const soundLabel = SOUND_PRESETS.find(preset => preset.id === runtime.settings.soundPreset)?.label || '铃·清脆';
    $('#theater-sound-summary').text(soundLabel);
    $('#theater-auto-summary').text(`每 ${Math.max(1, Math.min(50, Number(runtime.settings.autoInterval) || 10))} 层 AI 回复`);
}
// @theater-source-end refreshConfigSummaries

// @theater-source-begin findApiPreset
function findApiPreset(id = runtime.settings.selectedApiPresetId) {
    return normalizeApiPresetList(runtime.settings.apiPresets).find(preset => preset.id === id) || null;
}
// @theater-source-end findApiPreset

return { readApiFormConfig, writeApiFormConfig, apiPresetDefaultName, apiPresetDisplayLabel, validateApiPresetConfig, persistCurrentApiConfig, refreshApiPresetControls, refreshConfigSummaries, findApiPreset };
}
