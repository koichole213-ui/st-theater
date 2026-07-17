import { DEFAULT_MAX_OUTPUT_TOKENS, normalizeMaxTokens } from './api-client.js';

export const MAX_API_PRESETS = 30;
const VALID_PROTOCOLS = new Set(['auto', 'openai', 'anthropic']);

function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

export function createApiPresetId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeApiPreset(raw = {}) {
    const protocol = VALID_PROTOCOLS.has(raw.apiProtocol) ? raw.apiProtocol : 'auto';
    return {
        id: cleanText(raw.id, 100) || createApiPresetId(),
        name: cleanText(raw.name, 40),
        apiUrl: cleanText(raw.apiUrl, 1000).replace(/\/+$/, ''),
        apiKey: cleanText(raw.apiKey, 4000),
        apiModel: cleanText(raw.apiModel, 300),
        apiProtocol: protocol,
        maxOutputTokens: normalizeMaxTokens(raw.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
    };
}

export function normalizeApiPresetList(raw) {
    if (!Array.isArray(raw)) return [];
    const ids = new Set();
    const names = new Set();
    const presets = [];
    for (const item of raw) {
        const preset = normalizeApiPreset(item);
        const nameKey = preset.name.toLocaleLowerCase();
        if (!preset.name || ids.has(preset.id) || names.has(nameKey)) continue;
        ids.add(preset.id);
        names.add(nameKey);
        presets.push(preset);
        if (presets.length >= MAX_API_PRESETS) break;
    }
    return presets;
}

export function createApiPresetFromConfig(name, config = {}, id = '') {
    return normalizeApiPreset({
        id: id || createApiPresetId(),
        name,
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        apiModel: config.apiModel,
        apiProtocol: config.apiProtocol,
        maxOutputTokens: config.maxOutputTokens,
    });
}

export function apiPresetSecretValues(presets) {
    return normalizeApiPresetList(presets).map(preset => preset.apiKey).filter(Boolean);
}
