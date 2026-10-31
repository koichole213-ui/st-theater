import { activePresetEntries } from './preset-compat.js';

export const PROMPT_POST_PROCESSING = Object.freeze({
    NONE: '',
    MERGE: 'merge',
    MERGE_TOOLS: 'merge_tools',
    SEMI: 'semi',
    SEMI_TOOLS: 'semi_tools',
    STRICT: 'strict',
    STRICT_TOOLS: 'strict_tools',
    SINGLE: 'single',
});

export const WORLD_INFO_POSITION = Object.freeze({
    BEFORE_CHARACTER: 0,
    AFTER_CHARACTER: 1,
    AUTHOR_NOTE_TOP: 2,
    AUTHOR_NOTE_BOTTOM: 3,
    AT_DEPTH: 4,
    EXAMPLES_TOP: 5,
    EXAMPLES_BOTTOM: 6,
    OUTLET: 7,
});

const VALID_ROLES = new Set(['system', 'user', 'assistant']);

export function normalizePromptRole(value, fallback = 'system') {
    const role = String(value || '').trim().toLowerCase();
    if (VALID_ROLES.has(role)) return role;
    const numeric = Number(value);
    if (numeric === 1) return 'user';
    if (numeric === 2) return 'assistant';
    return fallback;
}

export function normalizeRequestMessages(messages = []) {
    return (Array.isArray(messages) ? messages : [])
        .filter(message => message && typeof message === 'object')
        .filter(message => !['tool', 'function'].includes(String(message.role || '').toLowerCase()))
        .map((message, index) => {
            const content = typeof message.content === 'string'
                ? message.content
                : (Array.isArray(message.content)
                    ? message.content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('')
                    : String(message.content ?? ''));
            return {
                role: normalizePromptRole(message.role),
                content,
                ...(message.name ? { name: String(message.name) } : {}),
                source: String(message.source || 'request'),
                sourceId: String(message.sourceId || `message-${index + 1}`),
            };
        })
        .filter(message => message.content.trim());
}

function mergeAdjacentMessages(messages) {
    const merged = [];
    for (const message of messages) {
        const previous = merged[merged.length - 1];
        if (previous?.role === message.role && previous?.name === message.name) {
            previous.content = [previous.content, message.content].filter(Boolean).join('\n\n');
            previous.source = previous.source === message.source ? previous.source : 'merged';
            previous.sourceId = [previous.sourceId, message.sourceId].filter(Boolean).join('+');
        } else {
            merged.push({ ...message });
        }
    }
    return merged;
}

export function squashAdjacentSystemMessages(messages = []) {
    const normalized = normalizeRequestMessages(messages);
    const squashed = [];
    for (const message of normalized) {
        const previous = squashed[squashed.length - 1];
        const isDialogueExample = message.sourceId === 'dialogueExamples'
            || previous?.sourceId === 'dialogueExamples';
        if (message.role === 'system' && previous?.role === 'system' && !isDialogueExample) {
            previous.content = [previous.content, message.content].filter(Boolean).join('\n\n');
            previous.source = previous.source === message.source ? previous.source : 'squashed-system';
            previous.sourceId = [previous.sourceId, message.sourceId].filter(Boolean).join('+');
        } else {
            squashed.push({ ...message });
        }
    }
    return squashed;
}

export function noToolsPostProcessingMode(value = '') {
    const mode = String(value || '').toLowerCase();
    if (mode === PROMPT_POST_PROCESSING.MERGE_TOOLS) return PROMPT_POST_PROCESSING.MERGE;
    if (mode === PROMPT_POST_PROCESSING.SEMI_TOOLS) return PROMPT_POST_PROCESSING.SEMI;
    if (mode === PROMPT_POST_PROCESSING.STRICT_TOOLS) return PROMPT_POST_PROCESSING.STRICT;
    return Object.values(PROMPT_POST_PROCESSING).includes(mode) ? mode : PROMPT_POST_PROCESSING.NONE;
}

export function applyPromptPostProcessing(messages = [], mode = '', placeholder = '[Start a new chat]') {
    const normalized = normalizeRequestMessages(messages);
    const safeMode = noToolsPostProcessingMode(mode);
    if (safeMode === PROMPT_POST_PROCESSING.NONE) return normalized;
    if (safeMode === PROMPT_POST_PROCESSING.SINGLE) {
        const content = normalized.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n');
        return content ? [{ role: 'user', content, source: 'post-processing', sourceId: 'single' }] : [];
    }

    const merged = mergeAdjacentMessages(normalized);
    if (safeMode !== PROMPT_POST_PROCESSING.STRICT) return merged;

    const result = [];
    for (const message of merged) {
        const previous = result[result.length - 1];
        if (message.role === 'system') {
            result.push(message);
            continue;
        }
        if (!previous || previous.role === 'system') {
            if (message.role === 'assistant') {
                result.push({ role: 'user', content: placeholder, source: 'post-processing', sourceId: 'strict-placeholder' });
            }
        } else if (previous.role === message.role) {
            result.push({
                role: message.role === 'user' ? 'assistant' : 'user',
                content: placeholder,
                source: 'post-processing',
                sourceId: 'strict-placeholder',
            });
        }
        result.push(message);
    }
    return result;
}

function numeric(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function normalizeWorldInfoEntry(entry = {}, index = 0) {
    const raw = entry.raw || entry;
    return {
        ...entry,
        content: String(entry.content ?? raw.content ?? '').trim(),
        position: numeric(entry.position ?? raw.position, WORLD_INFO_POSITION.BEFORE_CHARACTER),
        depth: Math.max(0, Math.floor(numeric(entry.depth ?? raw.depth, 4))),
        order: numeric(entry.order ?? raw.order, 100),
        role: normalizePromptRole(entry.role ?? raw.role),
        outletName: String(entry.outletName ?? raw.outletName ?? raw.outlet ?? '').trim(),
        sourceId: String(entry.sourceId ?? entry.uid ?? raw.uid ?? `world-info-${index + 1}`),
        _index: index,
    };
}

export function classifyWorldInfoEntries(entries = []) {
    const result = {
        before: [], after: [], authorNoteTop: [], authorNoteBottom: [],
        examplesTop: [], examplesBottom: [], atDepth: [], outlets: new Map(),
    };
    const normalized = (Array.isArray(entries) ? entries : [])
        .map(normalizeWorldInfoEntry)
        .filter(entry => entry.content)
        .sort((a, b) => a.order - b.order || b._index - a._index);
    for (const entry of normalized) {
        if (entry.position === WORLD_INFO_POSITION.AFTER_CHARACTER) result.after.push(entry);
        else if (entry.position === WORLD_INFO_POSITION.AUTHOR_NOTE_TOP) result.authorNoteTop.push(entry);
        else if (entry.position === WORLD_INFO_POSITION.AUTHOR_NOTE_BOTTOM) result.authorNoteBottom.push(entry);
        else if (entry.position === WORLD_INFO_POSITION.AT_DEPTH) result.atDepth.push(entry);
        else if (entry.position === WORLD_INFO_POSITION.EXAMPLES_TOP) result.examplesTop.push(entry);
        else if (entry.position === WORLD_INFO_POSITION.EXAMPLES_BOTTOM) result.examplesBottom.push(entry);
        else if (entry.position === WORLD_INFO_POSITION.OUTLET) {
            if (!entry.outletName) continue;
            if (!result.outlets.has(entry.outletName)) result.outlets.set(entry.outletName, []);
            result.outlets.get(entry.outletName).push(entry);
        } else result.before.push(entry);
    }
    for (const entries of result.outlets.values()) entries.sort((a, b) => b.order - a.order || a._index - b._index);
    return result;
}

function entriesText(entries) {
    return entries.map(entry => entry.content).filter(Boolean).join('\n\n');
}

export function expandWorldInfoOutlets(content = '', outlets = new Map()) {
    return String(content || '').replace(/\{\{outlet::([^}]+)\}\}/gi, (_match, name) => {
        const wanted = String(name || '').trim().toLowerCase();
        const found = [...outlets.entries()].find(([key]) => String(key).trim().toLowerCase() === wanted);
        return found ? entriesText(found[1]) : '';
    });
}

export function insertMessagesAtDepth(chatMessages = [], entries = []) {
    // Match ST populationInjectionPrompts: depth counts original chat messages,
    // not earlier injections. Same depth/order/role is one message; the host
    // builds newest-first and reverses, so the final role order is A, U, S.
    const chat = normalizeRequestMessages(chatMessages);
    const groups = new Map();
    for (const [index, entry] of entries.entries()) {
        const content = String(entry?.content || '').trim();
        if (!content) continue;
        const depth = Math.max(0, Math.floor(numeric(entry.depth, 4)));
        const order = numeric(entry.order, 100);
        const role = normalizePromptRole(entry.role);
        const key = `${depth}:${order}:${role}`;
        if (!groups.has(key)) groups.set(key, { depth, order, role, items: [] });
        groups.get(key).items.push({ content, source: entry.source || 'depth-injection', sourceId: String(entry.sourceId || `depth-${index + 1}`) });
    }
    const ordered = [...groups.values()].sort((a, b) => b.depth - a.depth || a.order - b.order
        || ['assistant', 'user', 'system'].indexOf(a.role) - ['assistant', 'user', 'system'].indexOf(b.role));
    const result = [];
    for (let boundary = 0; boundary <= chat.length; boundary++) {
        for (const group of ordered.filter(group => Math.max(0, chat.length - group.depth) === boundary)) {
            result.push({ role: group.role, content: group.items.map(item => item.content).join('\n'),
                source: group.items.every(item => item.source === group.items[0].source) ? group.items[0].source : 'depth-injection',
                sourceId: group.items.map(item => item.sourceId).join('+') });
        }
        if (boundary < chat.length) result.push(chat[boundary]);
    }
    return result;
}

export function insertWorldInfoAtDepth(chatMessages = [], entries = []) {
    return insertMessagesAtDepth(chatMessages, (Array.isArray(entries) ? entries : []).map((entry, index) => {
        const normalized = normalizeWorldInfoEntry(entry, index);
        return { ...normalized, source: 'world-info-depth' };
    }));
}

const SLOT_IDENTIFIERS = Object.freeze({
    worldInfoBefore: 'worldInfoBefore',
    charDescription: 'charDescription',
    charPersonality: 'charPersonality',
    scenario: 'scenario',
    personaDescription: 'personaDescription',
    worldInfoAfter: 'worldInfoAfter',
    dialogueExamples: 'dialogueExamples',
    chatHistory: 'chatHistory',
});

function addMessage(target, role, content, source, sourceId) {
    if (!String(content || '').trim()) return;
    target.push({ role: normalizePromptRole(role), content: String(content), source, sourceId });
}

export const THEATER_TASK_PREAMBLE = '【小剧场任务说明】本次创作独立小剧场；聊天记录是背景资料，本篇已有正文及当前创作要求见本次用户任务。保留所选预设的人物塑造与文风；本次明确选择的正文目标和输出格式以本次任务为准。';

function identityNames(text, context) {
    return String(text || '').replace(/\{\{(user|char)\}\}/gi, (macro, key) => context?.[key.toLowerCase()] ?? macro);
}

export function dialogueExampleMessages(text = '', names = {}) {
    const result = [];
    for (const block of String(text).split(/<START>/gi).filter(block => block.trim())) {
        const messages = [];
        for (const line of block.split('\n')) {
            const user = [names.user, '{{user}}'].filter(Boolean).find(name => line.startsWith(`${name}:`));
            const char = [names.char, '{{char}}'].filter(Boolean).find(name => line.startsWith(`${name}:`));
            if (user || char) messages.push({ role: 'system', name: user ? 'example_user' : 'example_assistant', content: line.slice((user || char).length + 1).trim(), source: 'preset-slot', sourceId: 'dialogueExamples' });
            else if (messages.length) messages[messages.length - 1].content += `\n${line}`;
        }
        if (messages.length) result.push({ role: 'system', content: '[Example Chat]', source: 'preset-slot', sourceId: 'dialogueExamples' }, ...messages);
        else if (block.trim()) result.push({ role: 'system', content: block.trim(), source: 'preset-slot', sourceId: 'dialogueExamples' });
    }
    return result;
}

export function composePresetMessages({
    presetEntries = [], slots = {}, worldInfoEntries = [], chatMessages = [],
    tailMessages = [], taskMessages = [], layoutContext = {},
    postProcessing = '', squashSystemMessages = false,
} = {}) {
    const world = classifyWorldInfoEntries(worldInfoEntries);
    const names = layoutContext.names || {};
    const selected = Array.isArray(presetEntries) ? presetEntries : [];
    const entries = activePresetEntries(selected, layoutContext.generationType || 'normal');
    const disabled = new Set([...(layoutContext.disabledSlotIds || []), ...selected.filter(entry => !entries.includes(entry)).map(entry => entry.id)]);
    const taskParts = normalizeRequestMessages(taskMessages);
    const task = taskParts.length ? [{ role: 'user', content: taskParts.map(message => message.content).join('\n\n'), source: 'theater-task', sourceId: 'theater-task' }] : [];
    const messages = task.length ? [{ role: 'system', content: THEATER_TASK_PREAMBLE, source: 'theater-task', sourceId: 'task-preamble' }] : [];
    const structural = entry => ['chatHistory', 'dialogueExamples'].includes(entry.id);
    const relativeEntries = entries.filter(entry => structural(entry) || Number(entry?.injectionPosition) !== 1);
    const absoluteEntries = entries.filter(entry => !structural(entry) && Number(entry?.injectionPosition) === 1);
    const hasSlot = new Set(entries.map(entry => SLOT_IDENTIFIERS[entry.id]).filter(Boolean));
    const personaPosition = numeric(layoutContext.personaPosition, 0);
    const slotText = {
        worldInfoBefore: entriesText(world.before), worldInfoAfter: entriesText(world.after),
        charDescription: String(slots.charDescription || ''), charPersonality: String(slots.charPersonality || ''),
        scenario: String(slots.scenario || ''),
        personaDescription: [0, 1].includes(personaPosition) ? String(slots.personaDescription || '') : '',
        dialogueExamples: [entriesText(world.examplesTop), slots.dialogueExamples, entriesText(world.examplesBottom)].filter(Boolean).join('\n\n'),
    };
    const contentFor = entry => identityNames(expandWorldInfoOutlets(
        SLOT_IDENTIFIERS[entry.id] && entry.id !== 'chatHistory' ? slotText[entry.id] : entry.content || '', world.outlets), names);
    const depthEntries = [
        ...absoluteEntries.filter(entry => !disabled.has(entry.id)).map((entry, index) => ({
            content: contentFor(entry), depth: entry.injectionDepth ?? 4, order: entry.injectionOrder ?? 100,
            role: entry.role, source: 'preset-depth', sourceId: String(entry.id || `preset-depth-${index + 1}`),
        })),
    ];
    // ST first collects ordered preset injections, then its extension prompt
    // bucket at priority 100. WI order only sorts inside its depth/role bucket.
    const extensions = [];
    const worldDepth = new Map();
    for (const entry of world.atDepth) {
        const key = `${entry.depth}:${entry.role}`;
        if (!worldDepth.has(key)) worldDepth.set(key, { ...entry, content: [], ids: [] });
        worldDepth.get(key).content.push(entry.content);
        worldDepth.get(key).ids.push(entry.sourceId);
    }
    for (const entry of worldDepth.values()) extensions.push({ ...entry, content: entry.content.join('\n'),
        order: 100, source: 'world-info-depth', sourceId: entry.ids.join('+'), extensionKey: `customWI${entry.depth}-${entry.role}` });
    if (personaPosition === 4 && slots.personaDescription) extensions.push({ content: slots.personaDescription,
        depth: layoutContext.personaDepth ?? 2, role: layoutContext.personaRole, order: 100, source: 'persona-depth', sourceId: 'personaDescription', extensionKey: 'PERSONA_DESCRIPTION' });
    if (layoutContext.characterDepth?.content) extensions.push({ ...layoutContext.characterDepth,
        order: 100, source: 'character-depth', sourceId: 'characterDepth', extensionKey: 'DEPTH_PROMPT' });
    const note = layoutContext.authorNote || {};
    const noteParts = [personaPosition === 2 ? slots.personaDescription : '', entriesText(world.authorNoteTop), note.content,
        entriesText(world.authorNoteBottom), personaPosition === 3 ? slots.personaDescription : ''].filter(Boolean);
    const noteContent = note.enabled === false ? '' : identityNames(noteParts.join('\n'), names);
    let beforeMain = '', afterMain = '';
    if (noteContent) {
        if (Number(note.position ?? 1) === 1) extensions.push({ content: noteContent, depth: note.depth ?? 4, role: note.role, order: 100, source: 'world-info-author-note', sourceId: 'authorsNote', extensionKey: '2_floating_prompt' });
        else if (Number(note.position) === 2) beforeMain = noteContent;
        else afterMain = noteContent;
    }
    extensions.sort((a, b) => a.extensionKey < b.extensionKey ? -1 : a.extensionKey > b.extensionKey ? 1 : 0);
    depthEntries.push(...extensions);
    const depthMain = depthEntries.find(entry => entry.sourceId === 'main');
    if (depthMain) depthMain.content = [beforeMain, depthMain.content, afterMain].filter(Boolean).join('\n');
    const baseChat = disabled.has('chatHistory') ? [] : normalizeRequestMessages(chatMessages);
    const history = insertMessagesAtDepth([...baseChat, ...task], depthEntries.map(entry => ({ ...entry, content: identityNames(entry.content, names) })));
    const addSlot = (entry, source = 'preset-slot') => {
        if (disabled.has(entry.id)) return;
        if (entry.id === 'chatHistory') { messages.push(...history); return; }
        if (entry.id === 'dialogueExamples') { messages.push(...dialogueExampleMessages(contentFor(entry), names)); return; }
        addMessage(messages, entry.role, contentFor(entry), source, entry.id || entry.sourceId);
    };
    for (const entry of relativeEntries) {
        if (entry.id === 'main') { addMessage(messages, note.role, beforeMain, 'world-info-author-note', 'authorsNote'); }
        addSlot(entry, SLOT_IDENTIFIERS[entry.id] ? 'preset-slot' : 'preset');
        if (entry.id === 'main') addMessage(messages, note.role, afterMain, 'world-info-author-note', 'authorsNote');
    }
    // ST appends dynamic prompts missing from the preset, but an explicitly
    // disabled marker must stay disabled. Preserve that distinction.
    for (const slot of ['worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality', 'scenario', 'personaDescription']) {
        if (!hasSlot.has(slot) && !disabled.has(slot)) addSlot({ id: slot, role: 'system' }, 'fallback-slot');
    }
    if (!hasSlot.has('chatHistory')) messages.push(...history);
    messages.push(...normalizeRequestMessages(tailMessages));
    const processed = squashSystemMessages ? squashAdjacentSystemMessages(messages) : messages;
    return applyPromptPostProcessing(processed, postProcessing);
}

export function composeGenerationContinuationMessages({
    presetEntries = [], slots = {}, worldInfoEntries = [], chatMessages = [], foundationTailMessages = [],
    continuationSystemPrompt = '', continuationUserPrompt = '', squashSystemMessages = false, layoutContext = {},
} = {}) {
    const referenceChatMessages = normalizeRequestMessages(chatMessages).map(message => ({ ...message,
        content: `【聊天正文参考开始｜仅作背景，不是本轮补写对象】\n${message.content}\n【聊天正文参考结束】` }));
    return composePresetMessages({ presetEntries, slots, worldInfoEntries, chatMessages: referenceChatMessages,
        taskMessages: [...normalizeRequestMessages(foundationTailMessages),
            { role: 'user', content: continuationUserPrompt, sourceId: 'continuation-round' },
            { role: 'user', content: continuationSystemPrompt, sourceId: 'continuation-rules' }],
        squashSystemMessages, layoutContext });
}
