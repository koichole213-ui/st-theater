import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAntiRoute } from '../anti-route.js';
import { buildApiRequest } from '../api-client.js';
import { requestCustomApi, requestMainApi } from '../api-runtime.js';
import { createTheaterApi } from '../theater-api.js';
import { captureLayoutApiSelection, resolveLayoutApiRoute } from '../layout-api.js';
import { createPromptInspectorStore } from '../prompt-inspector.js';

const header = /<!-- st-theater:[a-f0-9]{16} -->\n/g;
const original = () => [
    { role: 'system', content: '请按设定创作。保持人物一致，完成本次故事。', source: 'preset', sourceId: 'test' },
    { role: 'user', content: '请继续故事。人物走进屋内，发现一封信。' },
    { role: 'assistant', content: '<think>这里是预填充' },
];
const config = { apiUrl: 'https://example.invalid', apiModel: 'chosen-model', apiProtocol: 'openai', maxOutputTokens: 8192 };
const jsonReply = () => new Response(JSON.stringify({ choices: [{ message: { content: '测试正文。' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
const withoutVariation = text => text.replace(header, '').replace(/([，。；：、！？]) /g, '$1');

test('disabled and legacy callers preserve request content exactly', () => {
    const messages = original();
    assert.equal(applyAntiRoute(messages), messages);
    assert.equal(applyAntiRoute(messages, false), messages);
    const a = buildApiRequest({ url: config.apiUrl, model: config.apiModel, messages });
    const b = buildApiRequest({ url: config.apiUrl, model: config.apiModel, messages, antiRouteEnabled: false });
    assert.deepEqual(a, b);
});

test('request-local variations retain text, roles, names and immutable source messages', () => {
    const messages = original().map(Object.freeze); Object.freeze(messages);
    const a = applyAntiRoute(messages, true), b = applyAntiRoute(messages, true);
    assert.notEqual(a[0].content, b[0].content);
    assert.equal(a[2], messages[2]);
    for (let i = 0; i < a.length; i++) {
        assert.equal(withoutVariation(a[i].content), messages[i].content);
        assert.equal(a[i].role, messages[i].role);
        assert.equal(a[i].sourceId, messages[i].sourceId);
    }
    assert.ok(!messages[0].content.includes('st-theater:'));
});

test('code, macros, URLs, XML, JSON, tool turns and prefills stay intact', () => {
    const protectedTexts = [
        '```js\nconst t = "人物，故事。";\n```',
        '`人物，故事。`', '{{人物，故事。}}', 'https://example.invalid/人物，故事。',
        '<advice>人物，故事。</advice>', '{"text":"人物，故事。"}',
        '<think>', '<thinking>正在构思',
    ];
    for (const content of protectedTexts) {
        const source = [{ role: 'user', content }];
        assert.equal(applyAntiRoute(source, true)[0].content.replace(header, ''), content);
    }
    const tool = { role: 'tool', content: '人物，故事。' };
    assert.equal(applyAntiRoute([tool], true)[0], tool);
    const multi = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:test' } }] };
    assert.equal(applyAntiRoute([multi], true)[0], multi);
});

test('variation overhead is bounded and adds at most two headers', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'user' : 'system', content: '人物，故事。'.repeat(300) }));
    const result = applyAntiRoute(messages, true);
    const text = result.map(m => m.content).join('');
    assert.equal([...text.matchAll(header)].length, 2);
    assert.ok(text.length - messages.map(m => m.content).join('').length <= 64 + 2 * 38);
    assert.deepEqual(result.map(m => withoutVariation(m.content)), messages.map(m => m.content));
});

for (const protocol of ['openai', 'anthropic']) {
    test(`${protocol}: inspection matches actual payload, settings and source remain intact`, async () => {
        const source = original();
        const store = createPromptInspectorStore();
        const id = store.begin({ purpose: 'creative', messages: source });
        let payload, sent;
        await requestCustomApi({ config: { ...config, apiProtocol: protocol, apiKey: protocol === 'anthropic' ? 'synthetic-test-value' : '' },
            messages: source, antiRouteEnabled: true, shouldStream: false,
            onRequest: details => { sent = details; store.sent(id, details); },
            fetchImpl: async (_url, init) => { payload = JSON.parse(init.body); return jsonReply(); },
        });
        const actual = protocol === 'anthropic' ? [{ role: 'system', content: payload.system }, ...payload.messages] : payload.messages;
        assert.deepEqual(store.get(id).sent.map(({ role, content }) => ({ role, content })), actual);
        assert.equal(store.get(id).assembled[0].content, source[0].content);
        assert.equal(sent.model, config.apiModel);
        assert.equal(payload.model, config.apiModel); assert.equal(payload.max_tokens, 8192);
        assert.equal(payload.temperature, undefined); assert.equal(payload.top_p, undefined);
        assert.ok(actual[0].content.includes('st-theater:'));
    });
}

test('main CCS and helper fallback share one transformed request without duplicate headers', async () => {
    let sent, helperMessages, ccsMessages;
    const source = original();
    const ctx = { oai_settings: { chat_completion_source: 'custom', openai_model: 'chosen-model', openai_max_tokens: 8192 } };
    const result = await requestMainApi({ ctx, messages: source, antiRouteEnabled: true, shouldStream: false,
        getContext: () => ctx,
        chatCompletionService: { processRequest: async request => { ccsMessages = request.messages; throw new Error('synthetic unsupported path'); } },
        tavernHelper: { generateRaw: async request => { helperMessages = request.ordered_prompts; return '测试正文。'; } },
        onRequest: details => { sent = details.messages; },
    });
    assert.equal(result.text, '测试正文。');
    assert.deepEqual(ccsMessages, helperMessages.map(({ role, content }) => ({ role, content })));
    assert.equal(sent, helperMessages);
    assert.equal([...helperMessages.map(m => m.content).join('').matchAll(header)].length, 2);
    assert.equal(source[0].content, original()[0].content);
});

test('custom rate-limit retry reuses payload without accumulation or extra protection requests', async () => {
    const bodies = [];
    await requestCustomApi({ config, messages: original(), antiRouteEnabled: true,
        fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1
            ? new Response('{"error":{"message":"rate limit"}}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } }) : jsonReply(); },
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].stream, true); assert.equal(bodies[1].stream, true);
    assert.deepEqual(bodies[0].messages, bodies[1].messages);
});

test('captured task and independent layout preserve switch state across settings changes', () => {
    const settings = { apiMode: 'custom', ...config, antiRouteEnabled: true,
        layoutApiEnabled: true, layoutApiPresetId: 'layout', apiPresets: [{ id: 'layout', name: 'layout', ...config }] };
    const api = createTheaterApi({ settings });
    const route = api.captureGenerationApiRoute({});
    settings.antiRouteEnabled = false;
    assert.equal(route.antiRouteEnabled, true);
    assert.equal(resolveLayoutApiRoute(route, settings).antiRouteEnabled, true);
    assert.equal(captureLayoutApiSelection(settings).antiRouteEnabled, false);
});


test('unfenced code strings and arbitrary URL schemes are protected even when variation is always selected', t => {
    t.mock.method(Math, 'random', () => 0);
    const contents = [
        'print("人物，故事。")', "echo '人物，故事。'",
        'ftp://example.invalid/人物，故事。', 'mailto:人物，故事。@example.invalid',
        '请参阅 ftp://example.invalid/人物，故事。 继续故事。',
        'const name = 人物，故事。',
    ];
    for (const content of contents) {
        const result = applyAntiRoute([{ role: 'user', content }], true)[0].content.replace(header, '');
        assert.equal(result, content);
    }
    const varied = applyAntiRoute([{ role: 'user', content: '人物，故事。人物，故事。' }], true)[0].content.replace(header, '');
    assert.equal(varied, '人物， 故事。 人物， 故事。');
});
