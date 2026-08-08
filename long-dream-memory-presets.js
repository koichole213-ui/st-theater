import { DEFAULT_LONG_DREAM_MEMORY_PRESET } from './long-dream-memory.js';

export const LONG_DREAM_MEMORY_PRESET_FORMAT = 'st-theater-long-dream-memory-preset';
export const LONG_DREAM_MEMORY_PRESET_VERSION = 2;
export const LONG_DREAM_MEMORY_OUTPUT_CONTRACT = 'long-dream-memory-v2';
export const LONG_DREAM_MEMORY_BUILTIN_PRESET_ID = 'builtin-memory-continuity-v2';
export const MAX_LONG_DREAM_MEMORY_PRESETS = 50;
export const MAX_LONG_DREAM_MEMORY_PRESET_BYTES = 256 * 1024;

function cleanText(value, limit = 0) {
    const text = String(value || '').trim();
    return limit > 0 ? text.slice(0, limit) : text;
}

function cleanList(values, limit = 20) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
        const text = cleanText(value, 80);
        const key = text.toLocaleLowerCase();
        if (!text || seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

export function builtinLongDreamMemoryPreset() {
    return {
        id: LONG_DREAM_MEMORY_BUILTIN_PRESET_ID,
        format: LONG_DREAM_MEMORY_PRESET_FORMAT,
        version: LONG_DREAM_MEMORY_PRESET_VERSION,
        name: '内置 · 连续性梦脉 v2',
        author: '千夜浮梦',
        description: '平衡人物状态、人物弧光、关系变化、未完因果和世界线偏离。',
        focusPrompt: DEFAULT_LONG_DREAM_MEMORY_PRESET,
        outputContract: LONG_DREAM_MEMORY_OUTPUT_CONTRACT,
        tags: ['连续性', '人物弧光', '因果'],
        homepage: '',
        license: '',
        builtin: true,
    };
}

export function normalizeLongDreamMemoryPreset(preset = {}, index = 0) {
    if (!preset || typeof preset !== 'object') return null;
    const focusPrompt = cleanText(preset.focusPrompt || preset.systemPrompt, 50000);
    const name = cleanText(preset.name, 120);
    if (!name || !focusPrompt) return null;
    return {
        id: cleanText(preset.id, 120) || `memory-preset-${Date.now().toString(36)}-${index + 1}`,
        format: LONG_DREAM_MEMORY_PRESET_FORMAT,
        version: LONG_DREAM_MEMORY_PRESET_VERSION,
        name,
        author: cleanText(preset.author, 120),
        description: cleanText(preset.description, 1000),
        focusPrompt,
        outputContract: LONG_DREAM_MEMORY_OUTPUT_CONTRACT,
        tags: cleanList(preset.tags),
        homepage: cleanText(preset.homepage, 500),
        license: cleanText(preset.license, 120),
        builtin: preset.id === LONG_DREAM_MEMORY_BUILTIN_PRESET_ID || preset.builtin === true,
    };
}

export function normalizeLongDreamMemoryPresetList(values = []) {
    const builtin = builtinLongDreamMemoryPreset();
    const result = [builtin];
    const names = new Set([builtin.name.toLocaleLowerCase()]);
    for (const value of Array.isArray(values) ? values : []) {
        const preset = normalizeLongDreamMemoryPreset(value, result.length);
        if (!preset || preset.builtin) continue;
        let name = preset.name;
        let suffix = 2;
        while (names.has(name.toLocaleLowerCase())) name = `${preset.name} ${suffix++}`.slice(0, 120);
        names.add(name.toLocaleLowerCase());
        result.push({ ...preset, name, builtin: false });
        if (result.length >= MAX_LONG_DREAM_MEMORY_PRESETS) break;
    }
    return result;
}

export function createLongDreamMemoryPreset({ name, author = '', description = '', focusPrompt = DEFAULT_LONG_DREAM_MEMORY_PRESET } = {}) {
    return normalizeLongDreamMemoryPreset({
        id: `memory-preset-${Date.now().toString(36)}`,
        name: cleanText(name, 120) || '梦脉预设副本',
        author,
        description,
        focusPrompt,
        builtin: false,
    });
}

export function exportLongDreamMemoryPreset(preset = {}) {
    const normalized = normalizeLongDreamMemoryPreset(preset);
    if (!normalized) throw new Error('梦脉预设无效');
    return {
        format: LONG_DREAM_MEMORY_PRESET_FORMAT,
        version: LONG_DREAM_MEMORY_PRESET_VERSION,
        name: normalized.name,
        author: normalized.author,
        description: normalized.description,
        focusPrompt: normalized.focusPrompt,
        outputContract: LONG_DREAM_MEMORY_OUTPUT_CONTRACT,
        tags: normalized.tags,
        homepage: normalized.homepage,
        license: normalized.license,
    };
}

export function parseLongDreamMemoryPreset(value) {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    if (!data || typeof data !== 'object' || data.format !== LONG_DREAM_MEMORY_PRESET_FORMAT) {
        throw new Error('这不是千夜浮梦梦脉预设');
    }
    if (Number(data.version) !== LONG_DREAM_MEMORY_PRESET_VERSION) {
        throw new Error(`不支持的梦脉预设版本：${data.version ?? '未知'}`);
    }
    if (data.outputContract !== LONG_DREAM_MEMORY_OUTPUT_CONTRACT) {
        throw new Error('这个预设使用了不兼容的梦脉输出合同');
    }
    const preset = createLongDreamMemoryPreset(data);
    if (!preset) throw new Error('梦脉预设缺少名称或分析侧重点');
    return preset;
}
