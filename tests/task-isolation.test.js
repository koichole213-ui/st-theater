import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createGenerationJob, abortGenerationJob, generationTextWithLiveSegment } from '../generation-job.js';
import { filterStoryOutput } from '../story-output.js';
import { readableCharCount } from '../text-counter.js';
import { requestMainApi, requestCustomApi, MAIN_FIRST_TOKEN_TIMEOUT_MS, MAIN_RESPONSE_TIMEOUT_MS, MAIN_STREAM_IDLE_TIMEOUT_MS } from '../api-runtime.js';
import { createTheaterAppearance } from '../theater-appearance.js';
import { clearRuntimeLogs, getRuntimeLogEntries } from '../runtime-log.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const source = readFileSync(new URL('../theater-generation.js', import.meta.url), 'utf8');
function productionFunction(name) { const start = source.indexOf(`${name === 'runGeneration' ? 'async ' : ''}function ${name}(`); return source.slice(start, source.indexOf(`// @theater-source-end ${name}`, start)); }
function generationHarness({ honorAbort = true } = {}) {
    const save = deferred(), requests = [], saved = [], updates = [], resets = [];
    const ui = new Proxy(() => {}, { get: (_target, key) => key === 'length' ? 0 : () => ui });
    const runtime = { settings: { maxAutoRounds: 1, autoContinue: false, selectedWorldBooks: [] },
        knownInstructionTags: () => [], captureGenerationApiRoute: () => ({}), clearRequestIssue() {}, runtimeLog() {},
        archiveCurrentResult: async () => true, createCumulativeStreamRenderer: () => ({ update: value => updates.push(value), reset: opts => resets.push(opts) }), recordRequestMetrics() {},
        requestConfiguredGenerationApi(options) { const request = { options, ...deferred() }; requests.push(request);
            if (honorAbort) options.signal.addEventListener('abort', () => request.reject(new DOMException('Aborted', 'AbortError')), { once: true });
            return request.promise;
        },
        async storeCurrentResult(item) { saved.push(item); await save.promise; return true; },
        textFallbackHtml: text => `<p>${text}</p>`, captureRequestIssue: error => ({ signal: error.name }), requestFailureMessage: () => '', theaterError() {}, showInIframe() {},
    };
    const sandbox = { runtime, $: () => ui, AbortController, DOMException, console: { error() {} }, toastr: { info() {}, warning() {} },
        normalizeRoleSources: () => [], captureHistoryRoles: () => [], SillyTavern: { getContext: () => ({}) },
        resolveTargetWordCount: () => 6000, isStagedRenderTarget: () => true, resolveRenderSelection: () => ({ label: 'synthetic', isPlainTextRender: false }), updateContinueHint() {},
        assembleGenerationPayload: async () => ({ ctx: {}, targetWordCount: 6000, isPlainTextRender: true }), textOutputModeForTheme: () => 'text', normalizeContextRange: value => value,
        itemTags: () => [], classifyLengthTier: () => 'long', createGenerationJob, abortGenerationJob, generationTextWithLiveSegment, filterStoryOutput, readableCharCount,
        htmlToPlainText: text => text, continuationRoundHistory: () => [], prepareContinuationContext: text => text, newHistoryKey: () => 'synthetic-id', markFirstToken() {},
    };
    const api = runInNewContext(productionFunction('runGeneration') + '\n' + productionFunction('stopGeneration') + '\n({run:runGeneration,stop:stopGeneration})', sandbox);
    return { ...api, runtime, save, requests, saved, updates, resets };
}

test('stop retains text and the busy lock until asynchronous preservation ends, then allows a new task', async () => {
    const h = generationHarness();
    const a = h.run('old', false); while (!h.requests.length) await tick();
    h.requests[0].options.onChunk('停止前的合成正文');
    h.stop(); while (!h.saved.length) await tick();
    assert.equal(h.runtime.isGenerating, true);
    assert.equal(h.runtime.abortController.signal.aborted, true);
    assert.equal(await h.run('must wait', false), false); assert.equal(h.requests.length, 1);
    assert.match(h.saved[0].html, /停止前的合成正文/); assert.equal(h.saved[0].complete, false);
    const count = h.updates.length;
    h.requests[0].options.onChunk('迟到内容'); assert.equal(h.updates.length, count);
    h.save.resolve(); await a;
    assert.equal(h.runtime.isGenerating, false); assert.equal(h.runtime.currentGenerationJob, null);
    const b = h.run('new', false); while (h.requests.length < 2) await tick();
    const currentJob = h.runtime.currentGenerationJob;
    h.requests[0].options.onChunk('旧回调'); assert.equal(h.runtime.currentGenerationJob, currentJob); assert.equal(h.runtime.bgStreamText, '');
    h.stop(); await b;
});

test('old cleanup cannot clear another task even if ownership has been replaced externally', async () => {
    const h = generationHarness(); const a = h.run('old', false); while (!h.requests.length) await tick();
    h.requests[0].options.onChunk('保留正文'); h.stop(); while (!h.saved.length) await tick();
    const job = createGenerationJob(), controller = new AbortController();
    h.runtime.currentGenerationJob = job; h.runtime.abortController = controller; h.runtime.isGenerating = true;
    h.save.resolve(); await a;
    assert.equal(h.runtime.currentGenerationJob, job); assert.equal(h.runtime.abortController, controller); assert.equal(h.runtime.isGenerating, true);
    assert.equal(h.resets.at(-1).flushPending, false);
});

test('a transport that ignores abort cannot turn a stopped task into a completed result', async () => {
    const h = generationHarness({ honorAbort: false }); const a = h.run('old', false); while (!h.requests.length) await tick();
    h.requests[0].options.onChunk('已收到正文'); h.stop(); h.requests[0].options.onChunk('停止后内容');
    h.requests[0].resolve({ text: '停止后完整返回', stopReason: 'stop' }); while (!h.saved.length) await tick();
    assert.match(h.saved[0].html, /已收到正文/); assert.doesNotMatch(h.saved[0].html, /停止后/); assert.equal(h.saved[0].complete, false);
    h.save.resolve(); await a;
});

for (const stream of [true, false]) test(`main ${stream ? 'stream' : 'non-stream'} timeout aborts transport and ignores late content`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const late = deferred(), chunks = [], summaries = []; let transportSignal, helperCalls = 0;
    const ctx = { oai_settings: { chat_completion_source: 'custom', custom_model: 'synthetic-model' } };
    const task = requestMainApi({ ctx, getContext: () => ctx, shouldStream: stream, systemPrompt: '合成', userPrompt: '任务', onChunk: value => chunks.push(value), onResponse: value => summaries.push(value),
        chatCompletionService: { processRequest: async (_body, _opts, _extract, signal) => { transportSignal = signal; return late.promise; } },
        tavernHelper: { generateRaw() { helperCalls++; return '不应重发'; } },
    });
    const rejected = assert.rejects(task, error => error.diagnosticSignal === 'T-NET-TIMEOUT');
    t.mock.timers.tick(stream ? MAIN_FIRST_TOKEN_TIMEOUT_MS : MAIN_RESPONSE_TIMEOUT_MS); await rejected;
    assert.equal(transportSignal.aborted, true);
    late.resolve({ choices: [{ message: { content: '迟到正文' }, finish_reason: 'stop' }] }); await tick();
    assert.deepEqual(chunks, []); assert.deepEqual(summaries, []); assert.equal(helperCalls, 0);
});

test('main stop stays aborted even when the host ignores its signal and resolves successfully', async () => {
    const abort = new AbortController(), late = deferred(), chunks = [], summaries = [];
    const ctx = { oai_settings: { chat_completion_source: 'custom', custom_model: 'synthetic-model' } };
    const task = requestMainApi({ ctx, getContext: () => ctx, signal: abort.signal, shouldStream: false,
        onChunk: value => chunks.push(value), onResponse: value => summaries.push(value), chatCompletionService: { processRequest: () => late.promise } });
    abort.abort();
    await assert.rejects(task, error => error.name === 'AbortError');
    late.resolve('应忽略的正文'); await tick(); assert.deepEqual(chunks, []); assert.deepEqual(summaries, []);
});

test('log cache is immediate, UI refresh is batched, and a broken UI never rejects a successful generation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] }); clearRuntimeLogs();
    let queries = 0;
    const oldJQuery = globalThis.$;
    globalThis.$ = () => { queries++; throw new Error('synthetic DOM failure'); };
    t.after(() => { if (oldJQuery === undefined) delete globalThis.$; else globalThis.$ = oldJQuery; clearRuntimeLogs(); });
    t.mock.method(console, 'info', () => {});
    const appearance = createTheaterAppearance({ esc: text => text });
    appearance.runtimeLog('info', 'first'); appearance.runtimeLog('info', 'second'); appearance.runtimeLog('info', 'third');
    assert.equal(getRuntimeLogEntries().length, 3); assert.equal(queries, 0);
    assert.doesNotThrow(() => t.mock.timers.tick(0)); assert.equal(queries, 1);
    let calls = 0;
    const result = await requestCustomApi({ config: { apiUrl: 'https://example.invalid', apiModel: 'synthetic' }, shouldStream: false, systemPrompt: '合成', userPrompt: '合成', log: appearance.runtimeLog,
        fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '完整合成正文' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }); } });
    assert.equal(calls, 1); assert.equal(result.text, '完整合成正文'); assert.doesNotThrow(() => t.mock.timers.tick(0));
    assert.equal(queries, 2);
});

test('a failing console observer cannot stop request logging', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] }); clearRuntimeLogs(); t.after(clearRuntimeLogs);
    t.mock.method(console, 'info', () => { throw Error('synthetic console failure'); });
    const appearance = createTheaterAppearance({});
    assert.doesNotThrow(() => appearance.runtimeLog('info', '缓存仍保留'));
    assert.equal(getRuntimeLogEntries().at(-1).message, '缓存仍保留');
    assert.doesNotThrow(() => t.mock.timers.tick(0));
});


test('main idle timeout retains already delivered text and suppresses subsequent stream chunks', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const late = deferred(), chunks = []; let transportSignal;
    const ctx = { oai_settings: { chat_completion_source: 'custom', custom_model: 'synthetic-model' } };
    const task = requestMainApi({ ctx, getContext: () => ctx, onChunk: text => chunks.push(text), chatCompletionService: {
        processRequest: async (_body, _opts, _extract, signal) => {
            transportSignal = signal;
            return async function* () { yield { text: '已经收到的首段' }; await late.promise; yield { text: '已经收到的首段与迟到内容' }; };
        },
    } });
    while (!chunks.length) await tick();
    const rejected = assert.rejects(task, error => error.code === 'MAIN_STREAM_IDLE_TIMEOUT');
    t.mock.timers.tick(MAIN_STREAM_IDLE_TIMEOUT_MS); await rejected;
    assert.equal(transportSignal.aborted, true);
    late.resolve(); await tick(); assert.deepEqual(chunks, ['已经收到的首段']);
});

test('main request already aborted never sends to either host path', async () => {
    const abort = new AbortController(); abort.abort(); let calls = 0;
    await assert.rejects(requestMainApi({ signal: abort.signal, chatCompletionService: { processRequest() { calls++; } }, tavernHelper: { generateRaw() { calls++; } } }), error => error.name === 'AbortError');
    assert.equal(calls, 0);
});

test('batched normal log rendering uses the latest 500-entry cache and clearing cannot resurrect entries', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] }); clearRuntimeLogs();
    let renders = 0, count, html;
    const oldJQuery = globalThis.$;
    const list = { length: 1, 0: { scrollHeight: 40 }, html(value) { renders++; html = value; } };
    globalThis.$ = selector => selector === '#theater-runtime-log-list' ? list : { text(value) { count = value; } };
    t.after(() => { if (oldJQuery === undefined) delete globalThis.$; else globalThis.$ = oldJQuery; clearRuntimeLogs(); });
    t.mock.method(console, 'info', () => {});
    const appearance = createTheaterAppearance({ esc: value => String(value) });
    for (let index = 0; index < 505; index++) appearance.runtimeLog('info', `synthetic-${index}`);
    assert.equal(getRuntimeLogEntries().length, 500); assert.equal(renders, 0);
    t.mock.timers.tick(0); assert.equal(renders, 1); assert.equal(count, 500);
    assert.equal((html.match(/class="theater-error-log-item /g) || []).length, 500);
    appearance.runtimeLog('info', 'pending'); clearRuntimeLogs(); appearance.renderRuntimeLog();
    t.mock.timers.tick(0); assert.equal(count, 0); assert.match(html, /暂无运行日志/);
});
