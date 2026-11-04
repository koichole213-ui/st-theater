import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPromptPostProcessing, composeGenerationContinuationMessages } from '../request-layout.js';
import { buildApiRequest } from '../api-client.js';
import { createIndependentRequest } from '../independent-request.js';
import { requestCustomApi, requestMainApi } from '../api-runtime.js';
import { statusError, readNonStreamingResponse, readSSEStream } from '../api-response.js';
import { httpErrorReason } from '../error-help.js';
import { createPromptInspectorStore } from '../prompt-inspector.js';
import { createTheaterGeneration } from '../theater-generation.js';
import { buildLongDreamChapterMessages, buildLongDreamChapterPayload } from '../long-dream-payload.js';
import { createLongDreamRecord } from '../long-dream.js';
import { nativeStrict, convertGooglePrompt } from './fixtures/sillytavern-strict-1.15.js';

const pair = messages => messages.map(({ role, content }) => ({ role, content }));
const roles = ['system', 'user', 'assistant'];
const sequence = ['system', 'assistant', 'system', 'user', 'system', 'assistant', 'system'];
const screenshot = sequence.map((role, i) => ({ role, content: `VIRTUAL_${i + 1}`, source: 'preset', sourceId: `p${i}` }));
const response = (stream = false, protocol = 'openai') => new Response(stream
    ? 'data: {"choices":[{"delta":{"content":"VIRTUAL_REPLY"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    : JSON.stringify(protocol === 'anthropic' ? { content: [{ type: 'text', text: 'VIRTUAL_REPLY' }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content: 'VIRTUAL_REPLY' }, finish_reason: 'stop' }] }),
{ headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' } });
const ctx = (source = 'custom', model = 'synthetic') => ({
    oai_settings: { chat_completion_source: source, custom_model: model, google_model: model, openai_max_tokens: 8192 },
    getChatCompletionModel: () => model,
});
const config = (channel = 'custom', model = 'synthetic') => ({
    apiChannel: channel, apiProtocol: 'openai', apiUrl: 'https://example.invalid/v1', apiModel: model,
    apiKey: 'synthetic-test-only', vertexCredentialId: 'synthetic-ref', vertexLocation: 'global', maxOutputTokens: 8192,
});
const assertTailError = error => error?.diagnosticSignal === 'T-API-MESSAGE-END';

test('strict and strict_tools match upstream 1.15 across every S/U/A sequence through six turns', () => {
    let compared = 0;
    for (let length = 0; length <= 6; length++) {
        for (let encoded = 0; encoded < 3 ** length; encoded++) {
            let value = encoded;
            const messages = Array.from({ length }, (_, i) => {
                const role = roles[value % 3]; value = Math.floor(value / 3);
                return Object.freeze({ role, content: `TEXT_${i}`, source: 'synthetic', sourceId: `p${i}` });
            });
            const before = JSON.stringify(messages), expected = pair(nativeStrict(messages));
            for (const mode of ['strict', 'strict_tools']) {
                const result = applyPromptPostProcessing(messages, mode);
                assert.deepEqual(pair(result), expected, `${mode}: ${messages.map(m => m.role)}`);
                assert.deepEqual(pair(applyPromptPostProcessing(result, mode)), expected, 'strict must be idempotent');
                compared++;
            }
            assert.equal(JSON.stringify(messages), before);
        }
    }
    assert.equal(compared, 2186);
});

test('native strict keeps all screenshot text in order and leaves the system-tail content last', () => {
    const request = buildApiRequest({ url: 'https://example.invalid', protocol: 'openai', model: 'synthetic', messages: screenshot, postProcessing: 'strict' });
    assert.deepEqual(request.body.messages, pair(nativeStrict(screenshot)));
    assert.deepEqual(request.body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    assert.deepEqual(request.body.messages.at(-1), { role: 'user', content: 'VIRTUAL_7' });
    const joined = request.body.messages.map(m => m.content).join('\n');
    let last = -1;
    for (const m of screenshot) {
        assert.equal(joined.split(m.content).length - 1, 1);
        assert.ok(joined.indexOf(m.content) > last); last = joined.indexOf(m.content);
    }
});

test('strict merges named turns using upstream name prefixes and never mutates metadata input', () => {
    const input = [
        { role: 'system', name: 'example_user', content: '旅人: 示例' },
        { role: 'system', name: 'example_assistant', content: '向导: 示例' },
        { role: 'user', name: '旅人', content: '询问' },
        { role: 'user', name: '乙', content: '另一个人: 提问' },
        { role: 'assistant', name: '向导', content: '向导: 有意预填' },
    ];
    const before = structuredClone(input);
    assert.deepEqual(pair(applyPromptPostProcessing(input, 'strict')), pair(nativeStrict(input)));
    assert.deepEqual(input, before);
});

for (const channel of ['custom', 'glm', 'volc', 'deepseek', 'qwen', 'kimi', 'silicon', 'router', 'vertex']) {
    test(`${channel}: real fetch and inspection receive native strict output, streaming and non-streaming`, async () => {
        for (const stream of [false, true]) {
            const store = createPromptInspectorStore();
            const id = store.begin({ purpose: 'creative', messages: screenshot });
            const bodies = [], configs = config(channel, channel === 'vertex' ? 'gemini-4-argon' : 'synthetic');
            const before = JSON.stringify(configs);
            await requestCustomApi({ config: configs, messages: screenshot, postProcessing: 'strict', shouldStream: stream,
                getHeaders: () => ({ 'Content-Type': 'application/json' }),
                onRequest: details => store.sent(id, details),
                fetchImpl: async (url, options) => {
                    if (url === '/api/secrets/read') return new Response(JSON.stringify({ vertexai_service_account_json: [{ id: 'synthetic-ref', active: true }] }));
                    bodies.push(JSON.parse(options.body)); return response(stream);
                },
            });
            assert.equal(bodies.length, 1);
            assert.deepEqual(bodies[0].messages, pair(nativeStrict(screenshot)));
            assert.deepEqual(pair(store.get(id).sent), bodies[0].messages);
            assert.deepEqual(pair(store.get(id).assembled), pair(screenshot));
            assert.equal(bodies[0].max_tokens, 8192);
            assert.equal('temperature' in bodies[0], false);
            assert.equal('tools' in bodies[0], false);
            assert.equal(JSON.stringify(configs), before);
        }
    });
}

test('Anthropic strict sends only the leading system to its system field; tail remains last', async () => {
    let body;
    await requestCustomApi({ config: { ...config(), apiProtocol: 'anthropic' }, messages: screenshot, postProcessing: 'strict', shouldStream: false,
        fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return response(false, 'anthropic'); } });
    const expected = pair(nativeStrict(screenshot));
    assert.equal(body.system, expected[0].content);
    assert.deepEqual(body.messages, expected.slice(1));
});

test('Google native conversion after plugin strict preserves the trailing content as a user turn', async () => {
    const request = await createIndependentRequest(config('vertex', 'gemini-4-argon'), { messages: screenshot, postProcessing: 'strict' }, { getHeaders: () => ({}) });
    const google = convertGooglePrompt(structuredClone(request.body.messages), 'gemini-4-argon', true, { charName: '', userName: '', startsWithGroupName: () => false });
    assert.equal(google.contents.at(-1).role, 'user');
    assert.ok(google.contents.at(-1).parts.some(part => part.text === 'VIRTUAL_7'));
    assert.equal(google.system_instruction.parts.some(part => part.text.includes('VIRTUAL_7')), false);
});

for (const transport of ['CCS', 'Helper', 'CCS-fallback']) test(`${transport}: actual main handoff matches native strict and capture`, async () => {
    const host = ctx(), store = createPromptInspectorStore();
    const id = store.begin({ purpose: 'creative', messages: screenshot });
    const sent = [], fallbacks = [];
    await requestMainApi({ ctx: host, getContext: () => host, messages: screenshot, postProcessing: 'strict', shouldStream: false,
        onFallback: value => fallbacks.push(value), onRequest: details => store.sent(id, details),
        chatCompletionService: transport === 'Helper' ? undefined : { processRequest: async payload => {
            if (transport === 'CCS-fallback') throw Error('synthetic transport failure');
            sent.push(payload.messages); assert.equal(payload.custom_prompt_post_processing, '');
            assert.equal(payload.max_tokens, 8192); return { text: 'VIRTUAL_REPLY' };
        } },
        tavernHelper: { generateRaw: async options => {
            sent.push(options.ordered_prompts); assert.deepEqual(options.injects, []); return 'VIRTUAL_REPLY';
        } },
    });
    assert.equal(sent.length, 1);
    assert.deepEqual(pair(sent[0]), pair(nativeStrict(screenshot)));
    assert.deepEqual(pair(store.get(id).sent), pair(sent[0]));
    assert.equal(fallbacks.length, transport === 'CCS-fallback' ? 1 : 0);
});

test('ordinary first round, continuation and long-dream composition stay intact through strict sends', async () => {
    const previous = globalThis.SillyTavern;
    const entries = [{ id: 'main', role: 'system', content: 'VIRTUAL_PRESET' }, { id: 'charDescription', role: 'system', content: '' },
        { id: 'personaDescription', role: 'system', content: '' }, { id: 'chatHistory', role: 'system', content: '' },
        { id: 'assistant', role: 'assistant', content: 'VIRTUAL_ASSISTANT' }, { id: 'tail', role: 'system', content: 'VIRTUAL_TAIL' }];
    const host = { ...ctx(), name1: 'U', name2: 'C', chat: [], characterId: 0, characters: [{ data: { description: 'VIRTUAL_CHAR' } }] };
    globalThis.SillyTavern = { getContext: () => host };
    try {
        const runtime = { settings: { contextRange: 10, readChatContext: true, selectedWorldBooks: [], manualTargetEnabled: true, manualTargetChars: 4000, followUserPersona: true, renderTemplates: [] },
            wbEntries: [], wbStates: [], normalizeRenderSelection: () => '__default__', ensureWorldBooksCurrent: async () => {},
            ensureSelectedPresetLoaded: async () => ({ name: 'synthetic', selectedEntries: entries, prompt: 'VIRTUAL_PRESET', disabledSlotIds: [], postProcessing: 'strict' }),
            loadPersona: () => 'VIRTUAL_PERSONA', readPromptPlacement: () => ({ names: { user: 'U', char: 'C' }, personaPosition: 0 }), HTML_RENDER_FINAL_GUARDRAILS: '', continueContext: '' };
        const feature = createTheaterGeneration(runtime);
        const first = await feature.assembleGenerationPayload('VIRTUAL_TASK', { continuationText: 'VIRTUAL_DRAFT', forcePlainText: true });
        const continuation = feature.buildGenerationContinuationRoundPayload({ foundation: first.generationFoundation, instruction: 'VIRTUAL_NEXT', ctx: host });
        const record = createLongDreamRecord({ source: { text: 'VIRTUAL_STORY', html: '<p>VIRTUAL_STORY</p>' } });
        const payload = buildLongDreamChapterPayload({ record, instruction: 'VIRTUAL_CHAPTER', structuredPreset: true });
        const dream = buildLongDreamChapterMessages({ payload, presetEntries: entries, slots: { charDescription: 'VIRTUAL_CHAR' } });
        for (const messages of [first.messages, continuation.messages, dream]) {
            let actual;
            await requestCustomApi({ config: config(), messages, postProcessing: 'strict', shouldStream: false,
                fetchImpl: async (_url, options) => { actual = JSON.parse(options.body).messages; return response(); } });
            assert.deepEqual(actual, pair(nativeStrict(messages)));
            assert.deepEqual(actual.at(-1), { role: 'user', content: 'VIRTUAL_TAIL' });
            assert.ok(actual.some(m => m.content.includes('VIRTUAL_ASSISTANT')));
        }
    } finally { globalThis.SillyTavern = previous; }
});

test('no-processing keeps original system positions; strict tail support never rewrites a custom assistant tail', async () => {
    const input = [{ role: 'system', content: 'HEAD' }, { role: 'user', content: 'TASK' }, { role: 'system', content: 'TAIL' }, { role: 'assistant', content: 'INTENTIONAL_PREFILL' }];
    for (const mode of ['', 'strict']) {
        let actual;
        await requestCustomApi({ config: config('custom', 'gemini-4-argon'), messages: input, postProcessing: mode, shouldStream: false,
            fetchImpl: async (_url, options) => { actual = JSON.parse(options.body).messages; return response(); } });
        assert.deepEqual(actual.at(-1), input.at(-1));
        if (!mode) assert.deepEqual(actual, input);
    }
});

test('known direct Vertex Argon rejects intentional assistant tail before credential lookup or generation', async () => {
    let calls = 0;
    const input = [...screenshot, { role: 'assistant', content: 'INTENTIONAL_PREFILL' }], before = structuredClone(input);
    await assert.rejects(requestCustomApi({ config: config('vertex', 'gemini-4-argon'), messages: input, postProcessing: 'strict',
        getHeaders: () => { calls++; return {}; }, fetchImpl: async () => { calls++; return response(); } }), assertTailError);
    assert.equal(calls, 0); assert.deepEqual(input, before);
    const host = ctx('vertexai', 'gemini-4-argon');
    await assert.rejects(requestMainApi({ ctx: host, getContext: () => host, messages: input, postProcessing: 'strict',
        chatCompletionService: { processRequest: async () => { calls++; return { text: 'never' }; } },
        tavernHelper: { generateRaw: async () => { calls++; return 'never'; } } }), assertTailError);
    assert.equal(calls, 0);
});

test('explicit API tail rejection is reported without retry, fallback, leaked text or injected user', async () => {
    const input = [{ role: 'user', content: 'TASK' }, { role: 'assistant', content: 'INTENTIONAL_PREFILL' }];
    let calls = 0, fallbacks = 0;
    await assert.rejects(requestCustomApi({ config: config(), messages: input, shouldStream: false, onFallback: () => fallbacks++,
        fetchImpl: async (_url, options) => {
            calls++; assert.deepEqual(JSON.parse(options.body).messages, input);
            return new Response(JSON.stringify({ error: { message: 'Requests ending with a model turn are not supported. PRIVATE_SERVER_TEXT' } }), { status: 400 });
        } }), error => assertTailError(error) && error.theaterFailure.status === 400 && !JSON.stringify(error).includes('PRIVATE_SERVER_TEXT'));
    assert.equal(calls, 1); assert.equal(fallbacks, 0);
    for (const transport of ['CCS', 'Helper']) {
        const host = ctx(); let helperCalls = 0;
        await assert.rejects(requestMainApi({ ctx: host, getContext: () => host, messages: input, shouldStream: false,
            chatCompletionService: transport === 'Helper' ? undefined : { processRequest: async () => { throw Error('This model does not support assistant message prefill'); } },
            tavernHelper: { generateRaw: async () => { helperCalls++; throw Error('This model does not support assistant message prefill'); } },
        }), assertTailError);
        assert.equal(helperCalls, transport === 'Helper' ? 1 : 0);
    }
});

test('SSE and 200 JSON explicit tail errors use the same public diagnostic', async () => {
    const error = JSON.stringify({ error: { message: 'The last message must be user. PRIVATE_SERVER_TEXT' } });
    await assert.rejects(readNonStreamingResponse(new Response(error, { headers: { 'content-type': 'application/json' } })), assertTailError);
    await assert.rejects(readSSEStream(new Response(`data: ${error}\n\n`, { headers: { 'content-type': 'text/event-stream' } })), assertTailError);
    assert.equal(httpErrorReason(JSON.stringify({ echo: { message: 'The last message must be user' } })), null);
    assert.equal(httpErrorReason('Bad request'), null);
});


test('classified main tail refusal never falls back regardless of internal error code', async () => {
    const host = ctx(); let helperCalls = 0;
    await assert.rejects(requestMainApi({ ctx: host, getContext: () => host,
        messages: [{ role: 'user', content: 'TASK' }, { role: 'assistant', content: 'PREFILL' }],
        chatCompletionService: { processRequest: async () => { throw statusError(400, JSON.stringify({ error: { message: 'Requests ending with a model turn are not supported.' } })); } },
        tavernHelper: { generateRaw: async () => { helperCalls++; return 'never'; } },
    }), assertTailError);
    assert.equal(helperCalls, 0);
    assert.equal(httpErrorReason('Requests ending with a model turn are supported. Unknown parameter: fixture'), 'T-API-PARAMETER-UNSUPPORTED');
});
