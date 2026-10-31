import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractPresetEntries } from '../preset-layout.js';
import { resolveTheaterPreset } from '../preset-compat.js';
import { composePresetMessages, composeGenerationContinuationMessages, insertMessagesAtDepth, dialogueExampleMessages } from '../request-layout.js';
import { createTheaterGeneration } from '../theater-generation.js';
import { buildLongDreamChapterMessages, buildLongDreamChapterPayload } from '../long-dream-payload.js';
import { createLongDreamRecord } from '../long-dream.js';
import { buildApiRequest, API_PROTOCOLS } from '../api-client.js';

const marker = (id, extra = {}) => ({ id, role: 'system', content: '', ...extra });
const text = messages => messages.map(message => message.content).join('\n');
const task = content => ({ role: 'user', content });
const slots = { charDescription: 'CHAR', charPersonality: 'PERSONALITY', personaDescription: 'PERSONA' };
const history = [{ role: 'user', content: 'CHAT-OLD' }, { role: 'assistant', content: 'CHAT-NEW' }];

// Independent reference model of ST 1.15/1.17 populationInjectionPrompts:
// reverse input, group each original depth by descending priority and S/U/A,
// splice with a separate inserted-message count, then reverse the result.
function nativeDepthReference(chat, entries) {
    const result = structuredClone(chat).reverse();
    let inserted = 0;
    const max = Math.max(0, ...entries.map(entry => entry.depth));
    for (let depth = 0; depth <= max; depth++) {
        const atDepth = entries.filter(entry => entry.depth === depth && entry.content.trim());
        const priorities = [...new Set(atDepth.map(entry => entry.order ?? 100))].sort((a, b) => b - a);
        const additions = [];
        for (const priority of priorities) for (const role of ['system', 'user', 'assistant']) {
            const content = atDepth.filter(entry => (entry.order ?? 100) === priority && entry.role === role).map(entry => entry.content.trim()).join('\n');
            if (content) additions.push({ role, content });
        }
        result.splice(depth + inserted, 0, ...additions);
        inserted += additions.length;
    }
    return result.reverse().map(({ role, content }) => ({ role, content }));
}

test('depth matches host reference across chat lengths, priorities, role ties and overflow', () => {
    for (const length of [0, 1, 2, 7]) for (const depth of [0, 1, 4, 10]) {
        const chat = Array.from({ length }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `C${index}` }));
        const entries = ['system', 'user', 'assistant'].flatMap(role => [50, 100, 999].flatMap(order =>
            [0, 1].map(index => ({ role, depth, order, content: `${role}-${order}-${index}` }))));
        entries.push({ role: 'system', depth: depth + 2, order: 100, content: 'OTHER-DEPTH' });
        assert.deepEqual(insertMessagesAtDepth(chat, entries).map(({ role, content }) => ({ role, content })), nativeDepthReference(chat, entries));
    }
});

test('dynamic char/persona/world slots survive depth injection, including depth zero', () => {
    for (const id of ['charDescription', 'charPersonality', 'personaDescription', 'worldInfoBefore', 'worldInfoAfter']) {
        const messages = composePresetMessages({ presetEntries: [marker(id, { injectionPosition: 1, injectionDepth: 0 }), marker('chatHistory')], slots,
            worldInfoEntries: [{ content: 'WORLD-BEFORE', position: 0 }, { content: 'WORLD-AFTER', position: 1 }], chatMessages: history, taskMessages: [task('CURRENT')] });
        const expected = slots[id] || (id === 'worldInfoBefore' ? 'WORLD-BEFORE' : 'WORLD-AFTER');
        assert.ok(messages.some(message => message.content === expected));
        assert.ok(messages.findIndex(message => message.content === expected) > messages.findIndex(message => message.sourceId === 'theater-task'));
    }
});

test('two preset layouts keep their different identities order and put task before preset tail/prefill', () => {
    for (const order of [['worldInfoBefore', 'charDescription', 'personaDescription'], ['personaDescription', 'charDescription', 'worldInfoBefore']]) {
        const messages = composePresetMessages({ presetEntries: [...order.map(id => marker(id)), marker('chatHistory'), { id: 'tail', role: 'system', content: 'TAIL' }, { id: 'prefill', role: 'assistant', content: 'PREFILL' }],
            slots: { charDescription: 'CHAR', personaDescription: 'PERSONA' }, worldInfoEntries: [{ position: 0, content: 'WORLD' }], chatMessages: history, taskMessages: [task('PREVIOUS-STORY'), task('ENHANCEMENT'), task('CURRENT'), task('FORMAT')] });
        assert.deepEqual(messages.filter(message => order.includes(message.sourceId)).map(message => message.sourceId), order);
        const current = messages.find(message => message.sourceId === 'theater-task');
        assert.equal(current.role, 'user');
        assert.equal(current.content, 'PREVIOUS-STORY\n\nENHANCEMENT\n\nCURRENT\n\nFORMAT');
        assert.ok(messages.indexOf(current) < messages.findIndex(message => message.content === 'TAIL'));
        assert.equal(messages.at(-1).content, 'PREFILL');
    }
});

test('depth counts combined current task once, and never counts preamble or preset tail', () => {
    const messages = composePresetMessages({ presetEntries: [marker('chatHistory'), { id: 'd1', content: 'DEPTH1', injectionPosition: 1, injectionDepth: 1 }, { id: 'd0', content: 'DEPTH0', injectionPosition: 1, injectionDepth: 0 }, { id: 'tail', content: 'TAIL' }],
        chatMessages: history, taskMessages: [task('FIRST'), task('SECOND')] });
    assert.deepEqual(messages.slice(1).map(message => message.content), ['CHAT-OLD', 'CHAT-NEW', 'DEPTH1', 'FIRST\n\nSECOND', 'DEPTH0', 'TAIL']);
});

test('explicitly disabled dynamic anchors do not reappear as fallback', () => {
    const messages = composePresetMessages({ presetEntries: [marker('chatHistory')], slots, worldInfoEntries: [{ content: 'WORLD', position: 0 }],
        layoutContext: { disabledSlotIds: ['charDescription', 'charPersonality', 'personaDescription', 'worldInfoBefore'] }, taskMessages: [task('CURRENT')] });
    assert.doesNotMatch(text(messages), /CHAR|PERSONALITY|PERSONA|WORLD/);
    assert.match(text(messages), /CURRENT/);
});

test('disabled chat hides background while preserving current theater task', () => {
    const messages = composePresetMessages({ presetEntries: [], chatMessages: history, layoutContext: { disabledSlotIds: ['chatHistory'] }, taskMessages: [task('CURRENT')] });
    assert.doesNotMatch(text(messages), /CHAT-OLD|CHAT-NEW/);
    assert.match(text(messages), /CURRENT/);
});

test('persona follows in-prompt, depth, author-note top/bottom and none positions', () => {
    for (const position of [0, 2, 3, 4, 9]) {
        const messages = composePresetMessages({ presetEntries: [marker('personaDescription'), marker('chatHistory')], slots: { personaDescription: 'PERSONA' }, chatMessages: history,
            layoutContext: { personaPosition: position, personaDepth: 0, personaRole: 1, authorNote: { content: 'NOTE', position: 1, depth: 1 } }, taskMessages: [task('CURRENT')] });
        const count = text(messages).split('PERSONA').length - 1;
        assert.equal(count, position === 9 ? 0 : 1);
        if (position === 4) { assert.equal(messages.at(-1).content, 'PERSONA'); assert.equal(messages.at(-1).role, 'user'); }
        if (position === 2) assert.ok(text(messages).includes('PERSONA\nNOTE'));
        if (position === 3) assert.ok(text(messages).includes('NOTE\nPERSONA'));
    }
});

test('world author-note content uses configured note depth/role and surrounds the same note', () => {
    const messages = composePresetMessages({ presetEntries: [marker('chatHistory')], chatMessages: history,
        worldInfoEntries: [{ position: 2, content: 'TOP' }, { position: 3, content: 'BOTTOM' }],
        layoutContext: { authorNote: { content: 'NOTE', depth: 0, role: 1, position: 1 } }, taskMessages: [task('CURRENT')] });
    assert.equal(messages.at(-1).content, 'TOP\nNOTE\nBOTTOM');
    assert.equal(messages.at(-1).role, 'user');
});

test('relative author note follows main even when main is a depth prompt', () => {
    for (const mainDepth of [false, true]) {
        const messages = composePresetMessages({ presetEntries: [{ id: 'main', content: 'MAIN', injectionPosition: mainDepth ? 1 : 0, injectionDepth: 0 }, marker('chatHistory')],
            layoutContext: { authorNote: { content: 'NOTE', position: 2 } }, taskMessages: [task('CURRENT')] });
        assert.ok(text(messages).indexOf('NOTE') < text(messages).indexOf('MAIN'));
        assert.equal(text(messages).split('NOTE').length - 1, 1);
    }
});

test('world order ties reverse as host does, while outlet order is descending', () => {
    const messages = composePresetMessages({ presetEntries: [marker('worldInfoBefore'), { id: 'outlet', content: '{{outlet::X}}' }],
        worldInfoEntries: [{ position: 0, order: 100, content: 'A' }, { position: 0, order: 100, content: 'B' },
            { position: 7, order: 10, outletName: 'X', content: 'LOW' }, { position: 7, order: 90, outletName: 'X', content: 'HIGH' }] });
    assert.equal(messages[0].content, 'B\n\nA');
    assert.equal(messages[1].content, 'HIGH\n\nLOW');
});

test('example conversations retain separate named user/assistant example messages', () => {
    const examples = dialogueExampleMessages('<START>\n{{user}}: QUESTION\n{{char}}: ANSWER\nNEXT-LINE');
    assert.deepEqual(examples.map(message => message.name || ''), ['', 'example_user', 'example_assistant']);
    assert.equal(examples.at(-1).content, 'ANSWER\nNEXT-LINE');
});

test('variable, plain and mixed entries retain order; placeholders are not treated as variables', () => {
    const original = [{ id: 'set', content: '{{setvar::format::BODY}}' }, { id: 'plain', content: 'PLAIN {{char}} {{小剧场名字}}' },
        { id: 'get', content: '{{getvar::format}}' }];
    const result = resolveTheaterPreset(original, { char: 'CHAR' });
    assert.deepEqual(result.entries.map(entry => entry.content), ['', 'PLAIN CHAR {{小剧场名字}}', 'BODY']);
    assert.equal(original[0].content, '{{setvar::format::BODY}}');
});

test('generation-trigger filtering happens before variable side effects', () => {
    const result = resolveTheaterPreset([{ id: 'set', content: '{{setvar::x::WRONG}}', injectionTrigger: ['impersonate'] }, { id: 'get', content: '{{getvar::x}}' }]);
    assert.deepEqual(result.entries.map(entry => entry.content), ['']);
    assert.deepEqual(result.inactiveIds, ['set']);
});

test('card prompt overrides obey forbidOverrides and leave other preset entries untouched', () => {
    const result = resolveTheaterPreset([{ id: 'main', content: 'MAIN' }, { id: 'jailbreak', content: 'TAIL', forbidOverrides: true }, { id: 'custom', content: 'CUSTOM' }],
        { systemPromptOverride: 'CARD-MAIN', jailbreakPromptOverride: 'CARD-TAIL' });
    assert.deepEqual(result.entries.map(entry => entry.content), ['CARD-MAIN', 'TAIL', 'CUSTOM']);
});

test('parser keeps per-preset layout and trigger fields without importing sampler data', () => {
    const data = { temperature: .4, top_p: .2, prompts: [{ identifier: 'b', content: 'B', role: 'assistant', injection_position: 1, injection_depth: 1, injection_order: 999, injection_trigger: ['normal'] },
        { identifier: 'a', content: 'A', role: 'user' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }] }] };
    const parsed = extractPresetEntries(data);
    assert.deepEqual(parsed.map(entry => entry.id), ['a', 'b']);
    assert.equal(parsed[1].enabledInST, false);
    assert.equal(parsed[1].injectionDepth, 1);
    assert.deepEqual(parsed[1].injectionTrigger, ['normal']);
    assert.ok(parsed.every(entry => !('temperature' in entry) && !('top_p' in entry)));
    const request = buildApiRequest({ url: 'https://example.invalid/v1', protocol: API_PROTOCOLS.OPENAI, model: 'synthetic', messages: composePresetMessages({ presetEntries: parsed.filter(entry => entry.enabledInST) }) });
    for (const key of ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty']) assert.equal(key in request.body, false);
});

test('read host placement settings without copying any sampling options', () => {
    const source = readFileSync(new URL('../persona-follow.js', import.meta.url), 'utf8');
    const fn = new Function('power_user', `return ${source.slice(source.indexOf('export function readPromptPlacement')).replace('export ', '')}`)({});
    const placement = fn({ powerUserSettings: { persona_description_position: 4, persona_description_depth: 7, persona_description_role: 1, temperature: .1 },
        name1: 'U', name2: 'C', chatMetadata: { note_prompt: 'NOTE', note_depth: 2, note_position: 1 } });
    assert.equal(placement.personaPosition, 4);
    assert.equal(placement.personaDepth, 7);
    assert.equal(placement.authorNote.content, 'NOTE');
    assert.equal('temperature' in placement, false);
});

test('ordinary real assembly puts all task parts in chat and leaves preset assistant tail last', async () => {
    const previousHost = globalThis.SillyTavern;
    const entries = [marker('personaDescription'), marker('charDescription'), marker('chatHistory'), { id: 'tail', role: 'system', content: 'PRESET-TAIL' }, { id: 'assistant', role: 'assistant', content: 'PREFILL' }];
    const snapshot = { name: 'synthetic', selectedEntries: entries, prompt: 'PRESET', disabledSlotIds: [] };
    const ctx = { name1: 'U', name2: 'C', chat: [{ is_user: false, mes: 'BACKGROUND' }], characterId: 0, characters: [{ data: { description: 'CHAR' } }] };
    globalThis.SillyTavern = { getContext: () => ctx };
    try {
        const runtime = { settings: { contextRange: 10, readChatContext: true, selectedWorldBooks: [], manualTargetEnabled: true, manualTargetChars: 4000, followUserPersona: true, renderTemplates: [] },
            wbEntries: [], wbStates: [], normalizeRenderSelection: () => '__default__', ensureWorldBooksCurrent: async () => {}, ensureSelectedPresetLoaded: async () => snapshot,
            loadPersona: () => 'PERSONA', readPromptPlacement: () => ({ names: { user: 'U', char: 'C' }, personaPosition: 0 }), HTML_RENDER_FINAL_GUARDRAILS: '', continueContext: '' };
        const feature = createTheaterGeneration(runtime);
        const payload = await feature.assembleGenerationPayload('CURRENT', { continuationText: 'STORY-DRAFT', forcePlainText: true });
        const current = payload.messages.find(message => message.sourceId === 'theater-task');
        assert.match(current.content, /STORY-DRAFT/);
        assert.match(current.content, /CURRENT/);
        assert.match(current.content, /4000/);
        assert.match(current.content, /最后一句须表达完整/);
        assert.ok(payload.messages.indexOf(current) < payload.messages.findIndex(message => message.content === 'PRESET-TAIL'));
        assert.equal(payload.messages.at(-1).content, 'PREFILL');
        const continuation = feature.buildGenerationContinuationRoundPayload({ foundation: payload.generationFoundation, instruction: 'NEXT-ROUND', ctx });
        assert.equal(continuation.messages.at(-1).content, 'PREFILL');
        assert.match(text(continuation.messages), /CHAR|PERSONA/);
    } finally { globalThis.SillyTavern = previousHost; }
});

test('long dream expands variable preset and keeps current chapter before preset tail/prefill', () => {
    const record = createLongDreamRecord({ source: { text: 'PREVIOUS-CHAPTER', html: '<p>PREVIOUS-CHAPTER</p>' } });
    const payload = buildLongDreamChapterPayload({ record, instruction: 'CURRENT-DIRECTION', structuredPreset: true });
    const messages = buildLongDreamChapterMessages({ payload, presetEntries: [{ id: 'set', content: '{{setvar::style::DREAM-STYLE}}' }, marker('charDescription'), marker('chatHistory'),
        { id: 'tail', content: '{{getvar::style}}' }, { id: 'assistant', role: 'assistant', content: 'PREFILL' }], slots: { charDescription: 'CHAR' } });
    assert.doesNotMatch(text(messages), /\{\{(?:setvar|getvar)/);
    assert.ok(messages.findIndex(message => message.sourceId === 'theater-task') < messages.findIndex(message => message.content === 'DREAM-STYLE'));
    assert.equal(messages.at(-1).content, 'PREFILL');
    assert.match(text(messages), /PREVIOUS-CHAPTER/);
    assert.match(text(messages), /CURRENT-DIRECTION/);
});

test('empty author-note text still allows world-note content on scheduled turns', () => {
    const source = readFileSync(new URL('../persona-follow.js', import.meta.url), 'utf8');
    const read = new Function('power_user', `return ${source.slice(source.indexOf('export function readPromptPlacement')).replace('export ', '')}`)({});
    const ctx = { chatMetadata: { note_prompt: '', note_interval: 2 }, extensionPrompts: { '2_floating_prompt': { value: '' } }, chat: [{ is_user: true }, { is_user: true }] };
    const placement = read(ctx);
    assert.equal(placement.authorNote.enabled, true);
    const messages = composePresetMessages({ presetEntries: [marker('chatHistory')], taskMessages: [task('CURRENT')],
        worldInfoEntries: [{ position: 2, content: 'WORLD-NOTE' }], layoutContext: placement });
    assert.match(text(messages), /WORLD-NOTE/);
    ctx.chat.pop();
    assert.equal(read(ctx).authorNote.enabled, false);
});

test('structural chat marker cannot discard current task when its unused depth fields are set', () => {
    const messages = composePresetMessages({ presetEntries: [marker('chatHistory', { injectionPosition: 1, injectionDepth: 2 }), { id: 'tail', role: 'assistant', content: 'PREFILL' }],
        chatMessages: history, taskMessages: [task('CURRENT')] });
    assert.match(text(messages), /CHAT-OLD/);
    assert.match(text(messages), /CURRENT/);
    assert.equal(messages.at(-1).content, 'PREFILL');
});

test('mixed preset/WI depth uses host extension bucket: preset first, WI internally sorted at priority100', () => {
    const messages = composePresetMessages({ presetEntries: [marker('chatHistory'), { id: 'preset', content: 'PRESET', role: 'system', injectionPosition: 1, injectionDepth: 0, injectionOrder: 100 }],
        worldInfoEntries: [{ position: 4, depth: 0, role: 'system', order: 150, content: 'WORLD-HIGH' }, { position: 4, depth: 0, role: 'system', order: 50, content: 'WORLD-LOW' }],
        taskMessages: [task('CURRENT')] });
    assert.equal(messages.at(-1).content, 'PRESET\nWORLD-LOW\nWORLD-HIGH');
    assert.equal(messages.filter(message => message.content.includes('WORLD-')).length, 1);
});

test('relative author note preserves its own role independently from main', () => {
    const messages = composePresetMessages({ presetEntries: [{ id: 'main', role: 'system', content: 'MAIN' }, marker('chatHistory')],
        layoutContext: { authorNote: { position: 2, role: 1, content: 'NOTE' } }, taskMessages: [task('CURRENT')] });
    const note = messages.find(message => message.content === 'NOTE');
    assert.equal(note.role, 'user');
    assert.equal(messages[messages.indexOf(note) + 1].content, 'MAIN');
});

test('long dream excludes live chat notes and character depth notes while keeping persona depth and frozen WI', () => {
    const messages = buildLongDreamChapterMessages({ payload: { systemPrompt: 'DREAM-RULE', userPrompt: 'DREAM-TASK',
        worldInfoEntries: [{ position: 2, content: 'FROZEN-WORLD-NOTE' }] }, presetEntries: [marker('chatHistory')], slots: { personaDescription: 'PERSONA' },
        layoutContext: { personaPosition: 4, personaDepth: 0, authorNote: { position: 1, depth: 0, content: 'LIVE-CHAT-NOTE' }, characterDepth: { depth: 0, content: 'ORIGINAL-WORLD-DEPTH' } } });
    assert.doesNotMatch(text(messages), /LIVE-CHAT-NOTE|ORIGINAL-WORLD-DEPTH/);
    assert.match(text(messages), /PERSONA/);
    assert.match(text(messages), /FROZEN-WORLD-NOTE/);
});

test('host extension keys order AN, character-depth, persona-depth, then world depth after preset', () => {
    const messages = composePresetMessages({ presetEntries: [marker('chatHistory'), { id: 'p', content: 'PRESET', injectionPosition: 1, injectionDepth: 0 }],
        slots: { personaDescription: 'PERSONA' }, worldInfoEntries: [{ position: 4, depth: 0, content: 'WORLD' }], taskMessages: [task('CURRENT')],
        layoutContext: { personaPosition: 4, personaDepth: 0, authorNote: { content: 'NOTE', position: 1, depth: 0 }, characterDepth: { content: 'CHAR-NOTE', depth: 0 } } });
    assert.equal(messages.at(-1).content, 'PRESET\nNOTE\nCHAR-NOTE\nPERSONA\nWORLD');
});

test('persona at author-note top or bottom surrounds the whole WI-wrapped note', () => {
    for (const personaPosition of [2, 3]) {
        const messages = composePresetMessages({ presetEntries: [marker('chatHistory')], slots: { personaDescription: 'PERSONA' },
            worldInfoEntries: [{ position: 2, content: 'WI-TOP' }, { position: 3, content: 'WI-BOTTOM' }], taskMessages: [task('CURRENT')],
            layoutContext: { personaPosition, authorNote: { content: 'NOTE', position: 1, depth: 0 } } });
        assert.equal(messages.at(-1).content, personaPosition === 2 ? 'PERSONA\nWI-TOP\nNOTE\nWI-BOTTOM' : 'WI-TOP\nNOTE\nWI-BOTTOM\nPERSONA');
    }
});
