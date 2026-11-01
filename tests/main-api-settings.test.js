import test from 'node:test';
import assert from 'node:assert/strict';
import { requestMainApi, callViaChatCompletionService } from '../api-runtime.js';

const config = (model, limit, source = 'custom') => ({ oai_settings: { chat_completion_source: source, custom_model: model, openai_max_tokens: limit } });
const base = { systemPrompt: '合成系统', userPrompt: '合成任务', shouldStream: false };

test('CCS send uses the same current model/source/limit and reports it, with one context read', async () => {
    const original = config('old-A', 1000), bodies = [], traces = [], logs = [];
    let current = config('new-B', 9000, 'openai'), reads = 0;
    const result = await requestMainApi({ ...base, ctx: original,
        getContext: () => { reads++; return current; },
        log: (_level, message, details) => logs.push({ message, details }),
        onRequest: details => { traces.push(details); current = config('next-C', 12000); },
        chatCompletionService: { processRequest: async body => { bodies.push(body); return { text: '合成正文' }; } } });
    assert.equal(result.text, '合成正文'); assert.equal(reads, 1);
    assert.equal(bodies[0].model, 'new-B'); assert.equal(bodies[0].chat_completion_source, 'openai'); assert.equal(bodies[0].max_tokens, 9000);
    assert.equal(traces[0].model, 'new-B'); assert.equal(traces[0].maxTokens, 9000);
    assert.equal(logs[0].details.model, 'new-B'); assert.equal(logs[0].details.max_tokens, 9000);
    assert.equal(original.oai_settings.openai_max_tokens, 1000);
});

test('successive rounds adopt the next settings without changing the request already sent', async () => {
    const bodies = [], traces = []; let complete, current = config('round-one', 4096);
    const service = { processRequest: body => { bodies.push(body); return bodies.length === 1
        ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ text: '第二轮正文' }); } };
    const args = { ...base, ctx: config('stale', 500), getContext: () => current, chatCompletionService: service, onRequest: d => traces.push(d) };
    const first = requestMainApi(args);
    current = config('round-two', 16384, 'openai');
    assert.equal(bodies[0].model, 'round-one'); assert.equal(bodies[0].max_tokens, 4096);
    complete({ text: '第一轮正文' }); await first; await requestMainApi(args);
    assert.deepEqual(bodies.map(b => [b.model, b.chat_completion_source, b.max_tokens]), [['round-one', 'custom', 4096], ['round-two', 'openai', 16384]]);
    assert.deepEqual(traces.map(t => t.maxTokens), [4096, 16384]);
});

test('current CCS instance takes precedence over the earlier context instance', async () => {
    const old = config('old', 1000), current = config('current', 8192);
    old.ChatCompletionService = { processRequest: async () => { assert.fail('旧上下文服务不应接收请求'); } };
    let calls = 0;
    current.ChatCompletionService = { processRequest: async b => { calls++; assert.equal(b.model, 'current'); assert.equal(b.max_tokens, 8192); return { text: '当前服务正文' }; } };
    await requestMainApi({ ...base, ctx: old, getContext: () => current }); assert.equal(calls, 1);
});

test('zero or invalid current limit is omitted instead of borrowing the old positive limit', async () => {
    for (const limit of [0, undefined, -1, NaN, Infinity, 'invalid']) {
        let body, trace;
        await requestMainApi({ ...base, ctx: config('old', 12000), getContext: () => config('new', limit),
            onRequest: d => { trace = d; }, chatCompletionService: { processRequest: async b => { body = b; return { text: '默认上限正文' }; } } });
        assert.equal(body.model, 'new'); assert.equal('max_tokens' in body, false); assert.equal(trace.maxTokens, undefined);
    }
});

test('absent live context still uses supplied context, and direct CCS callers retain explicit limits', async () => {
    const ctx = config('fallback', 8192), bodies = [];
    const CCS = { processRequest: async b => { bodies.push(b); return { text: '兼容正文' }; } };
    await requestMainApi({ ...base, ctx, getContext: () => undefined, chatCompletionService: CCS });
    await callViaChatCompletionService({ CCS, ctx, getContext: () => ctx, maxTokens: 2048, shouldStream: false, messages: [{ role: 'user', content: '合成' }] });
    assert.deepEqual(bodies.map(b => b.max_tokens), [8192, 2048]);
});

test('helper fallback after a settings switch reports its new native model without injecting limits', async () => {
    let current = config('CCS-model', 1000), request, traces = [];
    await requestMainApi({ ...base, ctx: current, getContext: () => current, onRequest: d => traces.push(d),
        chatCompletionService: { processRequest: async () => { current = config('helper-model', 9000); throw new Error('synthetic unavailable'); } },
        tavernHelper: { generateRaw: async options => { request = options; return '助手正文'; } } });
    assert.deepEqual(traces.map(t => t.model), ['CCS-model', 'helper-model']);
    assert.equal(traces[0].maxTokens, 1000); assert.equal(traces[1].maxTokens, null);
    assert.equal('max_tokens' in request, false); assert.equal('temperature' in request, false);
});
