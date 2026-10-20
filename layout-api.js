import { normalizeMaxTokens, resolveProtocol } from './api-client.js';
import { normalizeApiPresetList } from './api-presets.js';

export const DEFAULT_LAYOUT_MAX_TOKENS = 131072;

// Capture only once per task. Never put this secret-bearing snapshot in storage or logs.
export function captureLayoutApiSelection(settings = {}) {
    if (settings.layoutApiEnabled !== true) return Object.freeze({ enabled: false });
    const preset = normalizeApiPresetList(settings.apiPresets).find(p => p.id === settings.layoutApiPresetId);
    return Object.freeze({
        enabled: true,
        custom: preset ? Object.freeze({
            apiUrl: preset.apiUrl, apiKey: preset.apiKey, apiModel: preset.apiModel,
            apiProtocol: preset.apiProtocol,
            maxOutputTokens: normalizeMaxTokens(settings.layoutMaxOutputTokens, DEFAULT_LAYOUT_MAX_TOKENS),
        }) : null,
        shouldStream: settings.streamEnabled !== false,
    });
}

export function resolveLayoutApiRoute(bodyRoute, settings = {}) {
    const selection = bodyRoute?.layoutSelection ?? captureLayoutApiSelection(settings);
    if (!selection.enabled) return bodyRoute;
    if (!selection.custom?.apiUrl || !selection.custom?.apiModel) {
        const error = new Error('独立排版 API 尚未绑定有效预设，请在设置中选择排版 API 预设后重试');
        error.code = 'THEATER_LAYOUT_API_MISSING';
        throw error;
    }
    return Object.freeze({ mode: 'custom', custom: selection.custom,
        protocol: resolveProtocol(selection.custom.apiProtocol, selection.custom.apiUrl),
        model: selection.custom.apiModel, maxTokens: selection.custom.maxOutputTokens,
        shouldStream: selection.shouldStream });
}
