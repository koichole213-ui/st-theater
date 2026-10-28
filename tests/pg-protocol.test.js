import { filterStoryOutput } from '../story-output.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readSSEStream, requestCustomApi } from '../api-runtime.js';
import { API_PROTOCOLS } from '../api-client.js';
import { REQUEST_DIAGNOSTIC_SIGNAL as SIGNAL } from '../request-diagnostics.js';
import { createGenerationJob, generationTextWithLiveSegment } from '../generation-job.js';
import { readableCharCount } from '../text-counter.js';

const frame = (content, reason) => `data: ${JSON.stringify({ choices: [{ delta: content == null ? { role: 'assistant' } : { content }, ...(reason ? { finish_reason: reason } : {}) }] })}\n\n`;
const done = 'data: [DONE]\n\n';
const heartbeat = ': keep-alive\n\n';
function response(parts, type = 'text/event-stream') {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({ start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
    } }), { headers: { 'content-type': type } });
}
async function failure(parts) {
    const chunks = [];
    let error;
    try { await readSSEStream(response(parts), text => chunks.push(text)); } catch (caught) { error = caught; }
    assert.ok(error, '必须明确失败');
    assert.deepEqual(chunks, [], '协议原文不得进入正文回调');
    return error;
}

for (const reason of ['stop', 'length']) {
    test(`正常SSE、心跳及正文+${reason}保留正文且诊断不被结束帧重置`, async () => {
        const result = await readSSEStream(response([heartbeat, frame('合成正文'), frame(null, reason), done]));
        assert.equal(result.text, '合成正文');
        assert.equal(result.stopReason, reason);
        assert.equal(result.responseSummary.contentSeen, true);
        assert.equal(result.responseSummary.doneSeen, true);
        assert.equal(result.responseSummary.receivedChunks, 4);
        assert.equal(result.responseSummary.events, 2);
        assert.equal(result.responseSummary.parseFailures, 0);
    });
}
for (const [name, parts, signal] of [
    ['本次251条心跳及length无正文结束帧', [heartbeat.repeat(251), frame(null, 'length'), done], SIGNAL.TOKEN_LIMIT],
    ['只有心跳', [heartbeat.repeat(3)], SIGNAL.EMPTY],
    ['只有DONE', [done], SIGNAL.EMPTY],
    ['裸DONE', ['[DONE]'], SIGNAL.EMPTY],
    ['有效空协议', [frame(null, 'stop'), done], SIGNAL.EMPTY],
    ['损坏的SSE JSON', ['data: {"choices":[\n\n', done], SIGNAL.INVALID_RESPONSE],
    ['截断的SSE JSON', ['data: {"choices":['], SIGNAL.INVALID_RESPONSE],
    ['截断的完整JSON响应', ['{"choices":['], SIGNAL.INVALID_RESPONSE],
]) {
    test(`${name}不再充当正文`, async () => {
        const error = await failure(parts);
        assert.equal(error.diagnosticSignal, signal);
        assert.equal(error.apiResponseSummary.protocolDetected, true);
        assert.equal(error.apiResponseSummary.hasText, false);
        assert.equal(error.apiResponseSummary.contentSeen, signal === SIGNAL.INVALID_RESPONSE ? 'unknown' : false);
        assert.notEqual(error.code, 'THEATER_STREAM_EMPTY', '协议空正文不得触发非流式重发');
    });
}
for (const text of [
    '这是普通文本回复。',
    '[第一章]\n这是普通文本故事，讲述主角初次相见时发生的故事。',
    '{序幕}\n这也是普通文本故事，不是接口JSON响应。',
    '这是足够长的普通文本回复，没有任何协议结构，仍然需要兼容。',
    '角色说：“data: hello”，另一段文字写着“[DONE]”和 finish_reason。',
    '这是一段解释协议的普通正文。\ndata: hello\n[DONE]\nfinish_reason: length',
]) {
    test(`普通文本兼容：${text.slice(0, 12)}`, async () => {
        const result = await readSSEStream(response([text], 'text/plain'));
        assert.equal(result.text, text);
        assert.equal(result.responseSummary.protocolDetected, false);
        assert.equal(result.responseSummary.contentSeen, true);
    });
}
test('逐字节拆帧含UTF8中文、CRLF、DONE仍能正确拼接', async () => {
    const raw = (heartbeat + frame('跨块中文正文', 'length') + done).replaceAll('\n', '\r\n');
    const bytes = new TextEncoder().encode(raw);
    const result = await readSSEStream(new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } }));
    assert.equal(result.text, '跨块中文正文');
    assert.equal(result.responseSummary.receivedBytes, bytes.length - 2); // DONE行后立即结束，不再读取最后空行。
    assert.equal(result.responseSummary.receivedChunks, bytes.length - 2);
});
test('流式入口兼容完整的非流式JSON与Gemini协议', async () => {
    for (const json of [
        { choices: [{ message: { content: '合成正文' }, finish_reason: 'length' }] },
        { candidates: [{ content: { parts: [{ thought: true, text: '合成思考' }, { text: '合成正文' }] }, finishReason: 'MAX_TOKENS' }] },
    ]) {
        const result = await readSSEStream(response([JSON.stringify(json, null, 2)], 'application/json'));
        assert.equal(result.text, '合成正文');
        assert.equal(result.stopReason, 'length');
    }
});
test('未知协议结构和损坏结构不伪装成已确认无正文', async () => {
    for (const raw of ['data: {"unrecognized":true}\n\n', 'data: {broken}\n\n',
        'data: {"choices":"unsupported-shape"}\n\n',
        'data: {"type":"response.unsupported_extension"}\n\n',
        'data: {"choices":[{"delta":"unsupported-shape"}]}\n\n',
        ...[123, true, { unsupported: 'shape' }].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
        'data: {"candidates":[{"content":{"parts":[{"text":123}]}}]}\n\n']) {
        const error = await failure([raw]);
        assert.equal(error.apiResponseSummary.contentSeen, 'unknown');
        assert.equal(error.diagnosticSignal, SIGNAL.INVALID_RESPONSE);
    }
});
test('读取中断保留计数与未知状态，已见正文保持true，摘要不含原文', async () => {
    for (const body of [heartbeat, frame('PRIVATE_STORY')]) {
        let pulls = 0, error;
        try { await readSSEStream(new Response(new ReadableStream({ pull(controller) {
            if (pulls++ === 0) controller.enqueue(new TextEncoder().encode(body));
            else controller.error(new Error('PRIVATE_ERROR'));
        } }))); } catch (caught) { error = caught; }
        assert.ok(error);
        assert.equal(error.apiResponseSummary.receivedChunks, 1);
        assert.equal(error.apiResponseSummary.contentSeen, body === heartbeat ? 'unknown' : true);
        assert.doesNotMatch(JSON.stringify(error.apiResponseSummary), /PRIVATE/);
    }
});
test('只有思考不会被诊断为正文', async () => {
    const error = await failure(['data: {"choices":[{"delta":{"reasoning_content":"PRIVATE_THOUGHT"}}]}\n\n', done]);
    assert.equal(error.apiResponseSummary.contentSeen, false);
    assert.equal(error.apiResponseSummary.hasReasoning, true);
    assert.doesNotMatch(JSON.stringify(error.apiResponseSummary), /PRIVATE/);
});
test('协议无正文仅发起一次请求，不触发重试/降额度/下游正文回调', async () => {
    for (const body of [heartbeat.repeat(251) + frame(null, 'length') + done, heartbeat, 'data: {"choices":[']) {
        const requests = [], chunks = [], fallback = [], summaries = [];
        await assert.rejects(requestCustomApi({
            config: { apiUrl: 'https://example.invalid/v1', apiModel: 'synthetic', maxOutputTokens: 16384 },
            onChunk: text => chunks.push(text), onFallback: item => fallback.push(item), onResponse: item => summaries.push(item),
            fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return response([body]); },
        }));
        assert.equal(requests.length, 1);
        assert.equal(requests[0].max_tokens, 16384);
        assert.equal(requests[0].stream, true);
        assert.deepEqual(chunks, []);
        assert.deepEqual(fallback, []);
        assert.equal(summaries.length, 1);
        assert.equal(summaries[0].protocolDetected, true);
    }
});

test('真实普通生成/续写入口：协议失败不排版不存新作品，旧版本及前文保留', async () => {
    const source = readFileSync(new URL('../theater-generation.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function runGeneration(');
    const end = source.indexOf('// @theater-source-end runGeneration', start);
    for (const continuation of [false, true]) {
        const old = { html: '<p>旧作品</p>', text: '旧作品', mode: 'html' };
        const session = { source: { rounds: ['旧前文'] }, versions: [{ ...old }], selected: 0, historyMetadata: {} };
        const saved = [], archived = [], errors = [], shown = [];
        let requests = 0, renderRequests = 0;
        const ui = new Proxy(() => {}, { get: (_target, key) => key === 'length' ? 0 : () => ui });
        const runtime = {
            settings: { maxAutoRounds: 3, autoContinue: true, selectedWorldBooks: [] },
            continueContext: continuation ? '旧前文' : '', continuationSession: continuation ? session : null,
            lastGeneratedHtml: old.html, lastGeneratedText: old.text,
            knownInstructionTags: () => [], captureGenerationApiRoute: () => ({}), clearRequestIssue() {}, runtimeLog() {},
            archiveCurrentResult: async () => { archived.push({ html: runtime.lastGeneratedHtml, text: runtime.lastGeneratedText }); return true; },
            createCumulativeStreamRenderer: () => ({ update() {}, reset() {} }), recordRequestMetrics() {},
            requestConfiguredGenerationApi: options => requestCustomApi({
                config: { apiUrl: 'https://example.invalid/v1', apiModel: 'synthetic', maxOutputTokens: 16384 },
                onChunk: options.onChunk, fetchImpl: async () => { requests++; return response([heartbeat.repeat(251), frame(null, 'length'), done]); },
            }),
            storeCurrentResult: async item => { saved.push(item); return true; },
            captureRequestIssue: error => ({ signal: error.diagnosticSignal }), requestFailureMessage: () => '合成错误',
            theaterError: message => errors.push(message), showInIframe: (...args) => shown.push(args),
        };
        const run = runInNewContext(`${source.slice(start, end)}; runGeneration`, {
            runtime, filterStoryOutput, $: () => ui, AbortController, console: { error() {} },
            normalizeRoleSources: () => [], captureHistoryRoles: () => [], SillyTavern: { getContext: () => ({}) },
            resolveTargetWordCount: () => 6000, isStagedRenderTarget: () => true,
            resolveRenderSelection: () => ({ label: '合成模板', isPlainTextRender: false }), updateContinueHint() {},
            assembleGenerationPayload: async () => ({ ctx: {}, targetWordCount: 6000, isPlainTextRender: true }),
            textOutputModeForTheme: () => 'text', normalizeContextRange: value => value, itemTags: () => [], classifyLengthTier: () => 'long',
            createGenerationJob, generationTextWithLiveSegment, readableCharCount, htmlToPlainText: text => text,
            requestFinalRenderedHtml: async () => { renderRequests++; throw Error('不应进入排版'); },
        });
        await run('合成指令', false);
        assert.equal(requests, 1); assert.equal(renderRequests, 0); assert.equal(saved.length, 0);
        assert.equal(errors.length, 1); assert.deepEqual(archived, [{ html: old.html, text: old.text }]);
        assert.equal(runtime.continueContext, continuation ? '旧前文' : '');
        assert.deepEqual(session.versions, [old]); assert.deepEqual(session.source.rounds, ['旧前文']);
        if (continuation) assert.equal(runtime.lastGeneratedHtml, old.html);
        assert.equal(runtime.isGenerating, false);
    }
});

test('报告区分未知正文与无正文，并显示协议/DONE/计数', async () => {
    const { createTheaterDiagnostics } = await import('../theater-diagnostics.js');
    const format = createTheaterDiagnostics({}).formatApiResponseSummary;
    assert.equal(typeof format, 'function');
    const error = await failure(['data: {broken}\n\n']);
    const report = format(error.apiResponseSummary);
    assert.match(report, /正文 未知/); assert.match(report, /协议 是/); assert.match(report, /DONE 否/);
    assert.match(report, /解析失败 1/); assert.doesNotMatch(report, /broken/);
});
