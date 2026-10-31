import { normalizePromptRole } from './request-layout.js';

export function extractPresetEntries(data, { characterId } = {}) {
    if (!Array.isArray(data?.prompts)) return [];
    const groups = Array.isArray(data.prompt_order) ? data.prompt_order : [];
    const group = groups.find(item => characterId != null && String(item.character_id) === String(characterId))
        || groups.find(item => item.character_id === 100001)
        || groups.find(item => item.character_id === 100000) || groups[0];
    const order = Array.isArray(group?.order) ? group.order : null;
    const indices = new Map(order?.map((entry, index) => [entry.identifier, index]));
    const enabled = new Map(order?.map(entry => [entry.identifier, entry.enabled === true]));
    const slots = new Set(['worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality', 'scenario', 'personaDescription', 'dialogueExamples', 'chatHistory']);
    return data.prompts.filter(entry => !entry.forbid).map((entry, index) => {
        const id = entry.identifier || `prompt_${index}`;
        return { id, name: entry.name || id, role: normalizePromptRole(entry.role), content: String(entry.content || ''),
            enabledInST: order ? enabled.get(id) === true : entry.enabled !== false,
            injectionPosition: entry.injection_position ?? 0, injectionDepth: entry.injection_depth ?? 4,
            injectionOrder: entry.injection_order ?? 100, injectionTrigger: Array.isArray(entry.injection_trigger) ? [...entry.injection_trigger] : [],
            systemPrompt: entry.system_prompt !== false, marker: !!entry.marker, forbidOverrides: !!entry.forbid_overrides,
            index: indices.has(id) ? indices.get(id) : 10000 + index };
    }).filter(entry => entry.content.trim() || slots.has(entry.id))
        .sort((a, b) => a.index - b.index).map(({ index, ...entry }) => entry);
}
