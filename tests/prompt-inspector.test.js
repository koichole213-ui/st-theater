import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptInspectorStore, snapshotPromptMessages, inspectionExport, inspectionText, inspectionBoundary, promptInspectorStore } from '../prompt-inspector.js';
import { promptInspectorHTML } from '../prompt-inspector-ui.js';
import { setRuntimeLogSecretProvider, clearRuntimeLogs, formatRuntimeLogs } from '../runtime-log.js';
import { createTheaterApi } from '../theater-api.js';
import { buildApiRequest, API_PROTOCOLS } from '../api-client.js';

const message = content => ({ role: 'user', content, source: 'theater-task', sourceId: 'theater-task' });
const begin = (store, content = 'FULL-CONTENT', extras = {}) => store.begin({ purpose: 'creative', messages: [message(content)], ...extras });

test('full snapshots retain roles, names and literal HTML without modifying input', () => {
    const original = [{ role: 'system', name: 'example_user', source: 'preset', sourceId: 'one', content: '<script>NOT_EXECUTED</script>\nhttps://example.invalid/path?a=1' }];
    const before = JSON.stringify(original); const snapshot = snapshotPromptMessages(original);
    assert.equal(snapshot[0].content, original[0].content);
    assert.equal(snapshot[0].name, 'example_user');
    assert.equal(JSON.stringify(original), before);
    assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot[0]));
});

test('known credentials and bearer strings are absent from captured content and exports', () => {
    setRuntimeLogSecretProvider(() => ['SYNTHETIC-CREDENTIAL-123']);
    try {
        const store = createPromptInspectorStore(); const id = begin(store, 'A SYNTHETIC-CREDENTIAL-123 Bearer abcdefghijk B');
        store.sent(id, { route: 'custom', protocol: 'openai', messages: [message('SYNTHETIC-CREDENTIAL-123')], headers: { Authorization: 'PRIVATE-HEADER' }, apiKey: 'PRIVATE-CONFIG' });
        const exported = JSON.stringify(inspectionExport(store.get(id), 'sent'));
        assert.doesNotMatch(exported + inspectionText(store.get(id)), /SYNTHETIC-CREDENTIAL-123|abcdefghijk|PRIVATE-HEADER|PRIVATE-CONFIG/);
        assert.match(exported, /REDACTED/);
    } finally { setRuntimeLogSecretProvider(() => []); }
});

test('separate rounds and layout requests keep their independent assembled and sent content', () => {
    const store = createPromptInspectorStore();
    const first = begin(store, 'ROUND1', { round: 1 });
    const second = begin(store, 'ROUND2', { purpose: 'continuation', round: 2 });
    const layout = begin(store, 'LAYOUT', { purpose: 'layout' });
    store.sent(second, { route: 'custom', messages: [message('ROUND2-SENT')] });
    assert.equal(store.get(first).assembled[0].content, 'ROUND1');
    assert.equal(store.get(second).sent[0].content, 'ROUND2-SENT');
    assert.equal(store.get(layout).purpose, 'layout');
    assert.equal(store.list().length, 3);
    assert.equal(inspectionExport(store.get(first), 'sent'), null);
});

test('support requests are excluded and observers cannot break capture', () => {
    const store = createPromptInspectorStore(); store.subscribe(() => { throw Error('UI failure'); });
    assert.equal(store.begin({ purpose: 'support', messages: [message('SUPPORT')] }), null);
    assert.equal(store.begin({ messages: [] }), null);
    assert.doesNotThrow(() => begin(store));
    assert.equal(store.list().length, 1);
});

test('retention evicts whole older requests without truncating the latest full text', () => {
    const store = createPromptInspectorStore({ maxRequests: 2, maxChars: 15 });
    const a = begin(store, 'AAAA'); begin(store, 'BBBB'); const last = begin(store, 'L'.repeat(100));
    assert.equal(store.get(a), null);
    assert.equal(store.list().length, 1);
    assert.equal(store.get(last).assembled[0].content.length, 100);
    store.clear(); assert.deepEqual(store.list(), []);
});

test('fallback updates the matching request and does not replace another round', () => {
    const store = createPromptInspectorStore(); const a = begin(store, 'A'); const b = begin(store, 'B');
    store.sent(a, { route: 'main', transport: 'ChatCompletionService', messages: [message('FIRST')] });
    store.sent(a, { route: 'main', transport: 'TavernHelper', messages: [message('FALLBACK')] });
    assert.equal(store.get(a).attempts, 2); assert.equal(store.get(a).sent[0].content, 'FALLBACK');
    assert.equal(store.get(b).sent, null);
    assert.match(inspectionBoundary(store.get(a), 'sent'), /酒馆助手/);
    assert.doesNotMatch(inspectionBoundary(store.get(a), 'sent'), /服务商最终/);
});

test('Anthropic canonical send view matches top-level system and body messages', () => {
    const original = [{ role: 'system', content: 'S1' }, message('U'), { role: 'system', content: 'S2' }];
    const request = buildApiRequest({ url: 'https://example.invalid', protocol: API_PROTOCOLS.ANTHROPIC, model: 'synthetic', messages: original });
    const store = createPromptInspectorStore(); const id = store.begin({ purpose: 'creative', messages: original });
    store.sent(id, { route: 'custom', protocol: 'anthropic', messages: request.messages });
    assert.equal(store.get(id).sent[0].content, request.body.system);
    assert.deepEqual(store.get(id).sent.slice(1).map(({ role, content }) => ({ role, content })), request.body.messages);
    assert.equal(store.get(id).assembled.length, 3);
});

test('send view removes names actually omitted by CCS/custom while preserving assembled names', () => {
    const store = createPromptInspectorStore(); const id = store.begin({ purpose: 'creative', messages: [{ ...message('U'), name: 'example_user' }] });
    store.sent(id, { route: 'main', transport: 'ChatCompletionService', messages: [{ ...message('U'), name: 'example_user' }] });
    assert.equal(store.get(id).assembled[0].name, 'example_user'); assert.equal('name' in store.get(id).sent[0], false);
});

test('v2 diagnostic shell has segmented stage, single expand toggle, search/copy row and icon export', () => {
    const html = promptInspectorHTML();
    for (const key of ['data-pi-stage="assembled"', 'data-pi-stage="sent"', 'data-pi-action="toggle"', 'data-pi-search', 'data-pi-action="copy"', 'aria-label="导出 JSON"']) assert.ok(html.includes(key));
    assert.doesNotMatch(html, /onclick=|<script|localStorage/);
});

test('real custom adapter capture matches the outgoing request while summary/logs exclude full text', async () => {
    const oldFetch = globalThis.fetch; promptInspectorStore.clear(); clearRuntimeLogs();
    const bodies = [];
    globalThis.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ choices: [{ message: { content: 'SYNTHETIC-REPLY' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }); };
    const runtime = { settings: { selectedPresetName: 'SYNTHETIC' }, runtimeLog() {}, lastRequestMetrics: null };
    const feature = createTheaterApi(runtime);
    const messages = [{ role: 'user', content: 'PRIVATE-PROMPT-START' }, { role: 'system', content: 'PRIVATE-PROMPT-END' }];
    try {
        const result = await feature.callCustomAPIStream('', '', () => {}, false, null, { messages, tracePurpose: 'creative', inspectionRound: 2, inspectionLabel: '自动补写', apiConfig: { apiUrl: 'https://example.invalid/v1', apiModel: 'synthetic', apiProtocol: 'openai' } });
        assert.match(result.text, /SYNTHETIC-REPLY/); assert.equal(bodies.length, 1);
        const record = promptInspectorStore.list()[0];
        assert.equal(record.round, 2); assert.equal(record.label, '自动补写');
        assert.deepEqual(record.assembled.map(({ role, content }) => ({ role, content })), messages);
        assert.deepEqual(record.sent.map(({ role, content }) => ({ role, content })), bodies[0].messages);
        assert.doesNotMatch(JSON.stringify(runtime.lastRequestTrace) + formatRuntimeLogs(), /PRIVATE-PROMPT/);
        assert.ok(inspectionText(record, 'sent').includes('PRIVATE-PROMPT-START'));
        for (const key of ['temperature', 'top_p']) assert.equal(key in bodies[0], false);
    } finally { globalThis.fetch = oldFetch; promptInspectorStore.clear(); }
});
