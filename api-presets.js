import { channelFields, apiChannel } from './api-channels.js';
import { DEFAULT_MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_SCHEMA, normalizeMaxTokens } from './api-client.js';

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
        apiKey: apiChannel(raw) === 'vertex' ? '' : cleanText(raw.apiKey, 4000),
        apiModel: cleanText(raw.apiModel, 300),
        apiProtocol: protocol,
        maxOutputTokens: normalizeMaxTokens(raw.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
        ...channelFields(raw),
    };
}

// 单轮输出上限默认值升级：还停在旧默认值（8192 → 16384 → 32768）的一起调上去，自己改过的不动。
// API 预设里存着 16384 的也调（套用预设会把它写回设置）。返回改了哪些，没改返回 null。
export function migrateMaxOutputDefault(settings) {
    if (!settings || Number(settings.maxOutputTokensSchema || 0) >= MAX_OUTPUT_TOKENS_SCHEMA) return null;
    const oldDefaults = Number(settings.maxOutputTokensSchema || 0) < 2 ? [8192, 16384] : [16384];
    const from = Number(settings.maxOutputTokens);
    const changed = { settings: null, presets: 0 };
    if (oldDefaults.includes(from)) {
        settings.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
        changed.settings = from;
    }
    if (Array.isArray(settings.apiPresets)) {
        for (const preset of settings.apiPresets) {
            if (preset && typeof preset === 'object' && Number(preset.maxOutputTokens) === 16384) {
                preset.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
                changed.presets += 1;
            }
        }
    }
    settings.maxOutputTokensSchema = MAX_OUTPUT_TOKENS_SCHEMA;
    return changed;
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
        ...channelFields(config),
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
