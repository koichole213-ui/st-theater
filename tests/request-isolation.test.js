import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterApi } from '../theater-api.js';
import { createRequestMetrics } from '../request-metrics.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';
import { createLongDreamRecord } from '../long-dream.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const record = () => createLongDreamRecord({ source: { text: '已保存首章', html: '<p>已保存首章</p>' } });
const response = text => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
const route = { mode: 'custom', protocol: 'openai', shouldStream: false, custom: { apiUrl: 'https://example.invalid/v1', apiModel: 'synthetic', maxOutputTokens: 1024 } };

function apiHarness(t) {
    const old$ = globalThis.$, oldToast = globalThis.toastr;
    const values = { '#theater-api-url': 'https://example.invalid/v1', '#theater-api-model': 'synthetic', '#theater-api-protocol': 'openai' };
    const ui = selector => new Proxy({}, { get: (_o, k) => k === 'val' ? () => values[selector] : () => ui(selector) });
    globalThis.$ = ui; globalThis.toastr = { success() {}, warning() {} };
    t.after(() => { globalThis.$ = old$; globalThis.toastr = oldToast; });
    const metrics = createRequestMetrics('creative'), context = { kind: '普通小剧场' }, issue = { signal: 'creative-error' };
    const runtime = { readApiFormConfig: () => ({ apiUrl: values['#theater-api-url'], apiKey: '', apiModel: values['#theater-api-model'], apiProtocol: values['#theater-api-protocol'] }), settings: {}, isGenerating: true, lastRequestContext: context, lastRequestMetrics: metrics, lastRequestIssue: issue,
        lastApiResponseSummary: { hasText: true }, lastApiConnectionSummary: { state: 'reading-stream' }, lastRequestTrace: { purpose: 'creative' },
        esc: x => x, runtimeLog() {}, requestFailureMessage: (_prefix, i) => i.signal, theaterError() {}, recorded: [],
        recordRequestMetrics(m) { this.recorded.push(m); } };
    return { runtime, api: createTheaterApi(runtime), metrics, context, issue };
}

for (const operation of ['fetchModelList', 'testAPIConnection']) test(`${operation}: success and failure during generation preserve the complete creative diagnostic`, async t => {
    const h = apiHarness(t);
    const before = { context: h.runtime.lastRequestContext, metrics: h.runtime.lastRequestMetrics, issue: h.runtime.lastRequestIssue,
        response: h.runtime.lastApiResponseSummary, connection: h.runtime.lastApiConnectionSummary, trace: h.runtime.lastRequestTrace };
    let fail = false;
    t.mock.method(globalThis, 'fetch', async () => fail ? new Response('', { status: 503 }) : new Response(JSON.stringify({ data: [{ id: 'synthetic' }] })));
    for (fail of [false, true]) {
        await h.api[operation]();
        assert.equal(h.runtime.lastRequestContext, before.context); assert.equal(h.runtime.lastRequestMetrics, before.metrics);
        assert.equal(h.runtime.lastRequestIssue, before.issue); assert.equal(h.runtime.lastApiResponseSummary, before.response);
        assert.equal(h.runtime.lastApiConnectionSummary, before.connection); assert.equal(h.runtime.lastRequestTrace, before.trace);
    }
    assert.equal(h.runtime.recorded.length, 2);
    assert.match(h.runtime.recorded[0].path, /^support:/); assert.equal(h.runtime.recorded[1].failureSignal, 'T-HTTP-503');
});

test('a support check started while idle cannot overwrite a later creative request when it fails late', async t => {
    const h = apiHarness(t), late = deferred(); h.runtime.isGenerating = false;
    t.mock.method(globalThis, 'fetch', () => late.promise);
    const support = h.api.testAPIConnection();
    assert.equal(h.runtime.lastRequestContext.kind, '连接测试');
    assert.equal(h.runtime.lastApiResponseSummary, null); assert.equal(h.runtime.lastApiConnectionSummary, null); assert.equal(h.runtime.lastRequestTrace, null);
    const context = { kind: '新创作任务' }, metrics = createRequestMetrics('new-creative'), issue = { signal: 'new-error' };
    h.runtime.lastRequestContext = context; h.runtime.lastRequestMetrics = metrics; h.runtime.lastRequestIssue = issue;
    h.runtime.isGenerating = true;
    late.resolve(new Response('', { status: 503 })); await support;
    assert.equal(h.runtime.lastRequestContext, context); assert.equal(h.runtime.lastRequestIssue, issue); assert.equal(h.runtime.lastRequestMetrics, metrics);
    assert.equal(metrics.failedAt, null);
});

test('idle support operations show coherent own diagnostics and late older support failures cannot replace the newest check', async t => {
    const h = apiHarness(t), pending = []; h.runtime.isGenerating = false;
    t.mock.method(globalThis, 'fetch', () => { const d = deferred(); pending.push(d); return d.promise; });
    const older = h.api.testAPIConnection(), newer = h.api.fetchModelList();
    const metrics = h.runtime.lastRequestMetrics;
    pending[1].resolve(new Response(JSON.stringify({ data: [{ id: 'synthetic' }] }))); await newer;
    pending[0].resolve(new Response('', { status: 503 })); await older;
    assert.equal(h.runtime.lastRequestContext.kind, '模型列表'); assert.equal(h.runtime.lastRequestMetrics, metrics);
    assert.equal(h.runtime.lastRequestIssue, null); assert.equal(metrics.failedAt, null);
});

test('real custom adapters keep out-of-order response/connection summaries on their own request', async t => {
    const h = apiHarness(t), pending = [];
    t.mock.method(globalThis, 'fetch', () => { const d = deferred(); pending.push(d); return d.promise; });
    const args = { apiRoute: route, ctx: {}, systemPrompt: '合成', userPrompt: '任务', onChunk() {} };
    const a = h.api.requestConfiguredGenerationApi(args);
    h.runtime.lastRequestContext = { kind: '第二项创作' };
    const b = h.api.requestConfiguredGenerationApi(args), bMetrics = h.runtime.lastRequestMetrics;
    pending[1].resolve(response('乙的合成正文')); await b;
    const summary = h.runtime.lastApiResponseSummary, connection = h.runtime.lastApiConnectionSummary;
    pending[0].resolve(response('甲的迟到正文')); await a;
    assert.equal(h.runtime.lastRequestMetrics, bMetrics); assert.equal(h.runtime.lastApiResponseSummary, summary);
    assert.equal(h.runtime.lastApiConnectionSummary, connection); assert.equal(connection.state, 'complete');
});

for (const outcome of ['stop', 'failure', 'success']) test(`long dream ${outcome}: finished old callbacks cannot save, emit progress or touch a new run`, async () => {
    const requests = [], saved = [], streams = [];
    const controller = createLongDreamGenerationController({ checkpointIntervalMs: 0,
        requestChapter(options) { const d = deferred(); requests.push({ ...d, ...options }); return d.promise; },
        renderChapter: async ({ text }) => `<article>${text}</article>`,
        persistRecord: async r => { saved.push(r); return r; }, onStream: s => streams.push(s) });
    const runA = controller.run({ record: record(), targetChars: 500 });
    while (!requests.length) await tick();
    requests[0].onChunk('停止前已收到的正文');
    if (outcome === 'success') { requests[0].resolve({ text: '完成正文' }); await runA; }
    else {
        if (outcome === 'stop') controller.abort();
        const rejection = assert.rejects(runA, error => { assert.match(error.longDreamRecord.draft.text, /停止前已收到/); return true; });
        requests[0].reject(outcome === 'stop' ? new DOMException('Aborted', 'AbortError') : new Error('合成失败')); await rejection;
    }
    assert.equal(controller.active, null);
    const n = saved.length, s = streams.length;
    requests[0].onChunk('结束后的旧回调'); await tick(); assert.equal(saved.length, n); assert.equal(streams.length, s);
    const runB = controller.run({ record: record(), targetChars: 500 });
    while (requests.length < 2) await tick();
    const progress = controller.active;
    requests[0].onChunk('不能污染新任务'); await tick();
    assert.deepEqual(controller.active, progress); assert.equal(saved.length, n); assert.equal(streams.length, s);
    requests[1].resolve({ text: '新任务正文' }); await runB;
    assert.doesNotMatch(saved.at(-1).draft.text, /旧回调|污染/);
});

test('long dream round-one callback is disabled during round two and final layout', async () => {
    const callbacks = [], saved = [], streams = [];
    const controller = createLongDreamGenerationController({ checkpointIntervalMs: 0,
        requestChapter: async ({ onChunk, round }) => {
            callbacks.push(onChunk);
            if (round === 2) callbacks[0]('不属于第二轮的迟到正文');
            return { text: round === 1 ? '甲'.repeat(2500) : '乙'.repeat(2100) };
        },
        renderChapter: async ({ text }) => { const n = saved.length, s = streams.length; callbacks.forEach(cb => cb('排版期间旧回调')); await tick(); assert.equal(saved.length, n); assert.equal(streams.length, s); return `<article>${text}</article>`; },
        onStream: value => streams.push(value), persistRecord: async r => { saved.push(r); return r; } });
    const result = await controller.run({ record: record(), targetChars: 5000, autoContinue: true, maxRounds: 3 });
    assert.equal(result.rounds, 2); assert.equal(result.actualChars, 4600); assert.equal(streams.length, 0);
    assert.doesNotMatch(result.record.draft.text, /迟到|旧回调/);
});

test('long dream ignored abort response preserves accepted text, holds busy through save, and never starts layout', async () => {
    const responsePending = deferred(), save = deferred(); let callbacks, saves = 0, renders = 0;
    const controller = createLongDreamGenerationController({ checkpointIntervalMs: 0,
        requestChapter: options => { callbacks = options.onChunk; return responsePending.promise; },
        renderChapter: async () => { renders++; return '<p>不应调用</p>'; },
        persistRecord: async r => { saves++; await save.promise; return r; } });
    const a = controller.run({ record: record(), targetChars: 500 });
    while (!callbacks) await tick(); callbacks('停止前正文'); controller.abort(); callbacks('停止后正文');
    responsePending.resolve({ text: '无视停止的成功返回' });
    while (!saves) await tick();
    assert.ok(controller.active); await assert.rejects(controller.run({ record: record() }), /已有长梦/);
    const rejected = assert.rejects(a, error => { assert.equal(error.name, 'AbortError'); assert.equal(error.longDreamRecord.draft.text, '停止前正文'); return true; });
    save.resolve(); await rejected; assert.equal(renders, 0); assert.equal(controller.active, null);
});
