import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ERROR_HELP } from '../error-help.js';
import { describeProviderMessage, PROVIDER_MESSAGE_MAX } from '../provider-message.js';
import { statusError, providerPayloadError, readSSEStream, readNonStreamingResponse } from '../api-response.js';
import { requestCustomApi, throwFriendlyMainApi } from '../api-runtime.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, classifyRequestFailure, createDiagnosticError, diagnosticSignalInfo } from '../request-diagnostics.js';
import { errorHelpHTML, errorCopyText } from '../error-help-ui.js';
import { setRuntimeLogSecretProvider } from '../runtime-log.js';
import { createTheaterApi } from '../theater-api.js';

const json = message => JSON.stringify({ error: { message } });
const sse = body => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
const providerError = 'upstream gemini 503: model overloaded';
const translated = '上游模型（Gemini）当前负载过高，暂时无法处理请求。';

test('上游说明匹配中文规则、未知英语与中文原话', () => {
    for (const [message, expected] of [
        ["upstream gemini 503: model overloaded", "上游模型（Gemini）当前负载过高，暂时无法处理请求。"],
        ["The model is overloaded. Please try again later.", "上游模型当前负载过高，暂时无法处理请求。"],
        ["{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}", "上游模型当前负载过高，暂时无法处理请求。"],
        ["You exceeded your current quota, please check your plan and billing details.", "账户额度或余额不足。"],
        ["Your credit balance is too low to access the Anthropic API.", "账户额度或余额不足。"],
        ["Rate limit reached for gpt-4o in organization org-xxx on tokens per min.", "请求过于频繁或配额暂时用尽，被服务商限流。"],
        ["Resource has been exhausted (e.g. check quota).", "请求过于频繁或配额暂时用尽，被服务商限流。"],
        ["Incorrect API key provided: sk-abcdef1234567890.", "提供的 API Key 无效或已过期。"],
        ["API key not valid. Please pass a valid API key.", "提供的 API Key 无效或已过期。"],
        ["invalid x-api-key", "提供的 API Key 无效或已过期。"],
        ["无效的令牌 (request id: 2026111418)", "提供的 API Key 无效或已过期。"],
        ["User location is not supported for the API use.", "服务商不支持当前所在地区访问。"],
        ["当前分组 default 下对于模型 gemini-2.5-pro 无可用渠道", "中转当前没有可用的渠道来提供这个模型。"],
        ["The model `gpt-5-turbo` does not exist or you do not have access to it.", "服务商找不到这个模型，或这个模型当前不可用。"],
        ["This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.", "发送的内容太长，超出了模型能接收的上限。"],
        ["prompt is too long: 210000 tokens > 200000 maximum", "发送的内容太长，超出了模型能接收的上限。"],
        ["max_tokens: 100000 > 64000, which is the maximum allowed number of output tokens for claude-sonnet", "设置的单次输出上限超出了模型允许的范围。"],
        ["Request blocked by safety settings (PROHIBITED_CONTENT)", "内容被服务商的安全规则拦截。"],
        ["context deadline exceeded (Client.Timeout exceeded while awaiting headers)", "上游处理超时，没有在规定时间内完成。"],
        ["retry attempts exhausted after 5 tries", "中转多次重试后仍然失败。"],
        ["upstream connect error or disconnect/reset before headers. reset reason: connection termination", "中转与上游模型之间的连接出了问题。"],
        ["Unknown name \"thinking_config\": Cannot find field.", "模型不支持请求中的某项参数。"],
        ["Internal server error", "服务商内部出错。"],
        ["渠道维护中，请稍后再试", "服务商或中转正在维护。"],
        ["Service Unavailable: scheduled maintenance", "服务商或中转正在维护。"],
        ["该令牌所属分组已被禁用", "该令牌所属分组已被禁用"],
        ["Something completely unexpected happened in the zorblax module", "服务商返回了一段说明，插件暂时无法翻译；原文见“技术信息”。"],
        ["limit is 500 tokens per request id 401", "服务商返回了一段说明，插件暂时无法翻译；原文见“技术信息”。"],
        ["<html><body><h1>502 Bad Gateway</h1></body></html>", null]
    ]) assert.equal(describeProviderMessage(message)?.zh ?? null, expected, message);
});

test('服务商说明脱敏后才截断，HTML 网关页不保留', t => {
    setRuntimeLogSecretProvider(() => ['my-own-key-123']);
    t.after(() => setRuntimeLogSecretProvider());
    const secrets = ['sk-abcdef1234567890', 'AIzaSyabcdefghijk', 'abc.def', 'my-own-key-123',
        'https://example.invalid/key', 'fixture-password', 'rk-abcdef1234567890'];
    const result = describeProviderMessage('密码 ' + secrets[0] + ' ' + secrets[1] + ' Bearer ' + secrets[2]
        + ' ' + secrets[3] + ' ' + secrets[4] + ' password=' + secrets[5] + ' ' + secrets[6] + ' ' + 'x'.repeat(250));
    assert.equal(result.original.length, PROVIDER_MESSAGE_MAX);
    assert.match(result.original, /…$/);
    for (const secret of secrets) {
        assert.ok(!result.original.includes(secret));
        assert.ok(!result.zh.includes(secret));
    }
    assert.equal(describeProviderMessage('<html><body>502 Bad Gateway</body></html>'), null);
    for (const [original, secret] of [
        ['Authorization: Basic Zml4dHVyZTpwYXNz', 'Zml4dHVyZTpwYXNz'],
        ['Cookie: session=fixture; second=fixture-second', 'fixture-second'],
        ['Invalid password="fixture spaced password"', 'spaced password'],
        ['Credential: -----BEGIN PRIVATE KEY-----FIXTURE-----END PRIVATE KEY-----', 'FIXTURE'],
    ]) {
        const sanitized = describeProviderMessage(original);
        assert.ok(!sanitized.original.includes(secret));
        const issue = { signal: 'T-HTTP-401', providerMessage: sanitized };
        assert.ok(!errorHelpHTML(issue).includes(secret));
        assert.ok(!errorCopyText(issue).includes(secret));
    }
});

test('64 次心跳后的服务商错误保留 HTTP 200、中文说明和脱敏原话', async () => {
    await assert.rejects(readSSEStream(sse(': keep-alive\n\n'.repeat(64) + 'data: ' + json(providerError) + '\n\n')), error => {
        const issue = classifyRequestFailure(error);
        assert.equal(error.code, 'THEATER_PROVIDER_ERROR');
        assert.equal(issue.signal, 'T-API-PROVIDER-ERROR');
        assert.equal(issue.httpStatus, 200);
        assert.equal(issue.heartbeats, 64);
        assert.equal(issue.hasText, false);
        assert.equal(issue.transport, 'stream');
        assert.deepEqual(issue.providerMessage, { original: providerError, zh: translated, known: true });
        return true;
    });
    await assert.rejects(readNonStreamingResponse(Response.json(JSON.parse(json(providerError)))), error => {
        const issue = classifyRequestFailure(error);
        assert.equal(issue.transport, 'non_stream');
        assert.equal(issue.httpStatus, 200);
        assert.equal(issue.signal, 'T-API-PROVIDER-ERROR');
        return true;
    });
});

test('流式中转错误不改变既有重试、格式分类或已收到的正文', async () => {
    const body = '合成正文片段';
    const delta = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\n';
    assert.equal((await readSSEStream(sse(delta + 'data: ' + json(providerError) + '\n\n'))).text, body);
    for (const [raw, signal] of [
        ['data: {invalid}\n\n', 'T-API-INVALID-RESPONSE'],
        ['data: ' + json('Request blocked by safety settings') + '\n\n', 'T-API-CONTENT-FILTER'],
        ['data: ' + json('429 Rate limit') + '\n\n', 'T-HTTP-429'],
        ['data: ' + json('The last message must be user') + '\n\n', 'T-API-MESSAGE-END'],
        [': keep-alive\n\ndata: [DONE]\n\n', 'T-API-EMPTY'],
    ]) {
        await assert.rejects(readSSEStream(sse(raw)), error => error.diagnosticSignal === signal, signal);
    }
    let calls = 0;
    await assert.rejects(requestCustomApi({
        config: { apiUrl: 'https://example.invalid/v1', apiKey: 'fixture-key', apiModel: 'fixture', apiProtocol: 'openai' },
        shouldStream: true, messages: [{ role: 'user', content: 'fixture' }],
        fetchImpl: async () => { calls++; return sse('data: ' + json(providerError) + '\n\n'); },
        onFallback: () => assert.fail('服务商错误不应触发兼容重试'),
    }), error => classifyRequestFailure(error).signal === 'T-API-PROVIDER-ERROR');
    assert.equal(calls, 1);
});

test('HTTP 与酒馆主 API 保留各自错误码并带上说明', () => {
    const issue = classifyRequestFailure(statusError(503, json('Service Unavailable: maintenance')));
    assert.equal(issue.signal, 'T-HTTP-503');
    assert.equal(issue.providerMessage.zh, '服务商或中转正在维护。');
    assert.equal(statusError(502, '<html>Bad Gateway</html>').providerMessage, undefined);
    assert.throws(() => throwFriendlyMainApi(new Error('[proxy] overloaded')), error => {
        assert.equal(error.providerMessage.original, '[proxy] overloaded');
        return true;
    });
    const nested = statusError(503, json(json(json('scheduled maintenance'))));
    assert.equal(nested.providerMessage.original, 'scheduled maintenance');
    for (const [message, signal, code] of [
        ['502 Bad Gateway', 'T-HTTP-502', 'THEATER_MAIN_GATEWAY'],
        ['Request timeout', 'T-NET-TIMEOUT', 'THEATER_MAIN_GATEWAY'],
        ['529 Overloaded', 'T-HTTP-5XX', 'THEATER_MAIN_GATEWAY'],
        ['socket hang up', 'T-NET-FAILED', 'THEATER_MAIN_GATEWAY'],
        ['401 Unauthorized', 'T-HTTP-401', 'THEATER_CONFIG'],
        ['unexpected upstream explanation', 'T-UNKNOWN', 'THEATER_MAIN_UNKNOWN'],
    ]) {
        assert.throws(() => throwFriendlyMainApi(new Error(message)), error => {
            assert.equal(error.code, code);
            assert.equal(error.diagnosticSignal, signal);
            assert.equal(classifyRequestFailure(error).transport, 'main');
            assert.equal(error.providerMessage.original, message);
            return true;
        });
    }
});

test('弹窗和常见问题从同一张文案表取标题、说明和建议', () => {
    const sides = ['far', 'net', 'settings', 'content', 'local', 'unknown'];
    for (const [signal, entry] of Object.entries(ERROR_HELP)) {
        const info = diagnosticSignalInfo(signal);
        assert.match(signal, /^T-[A-Z0-9-]+$/);
        assert.equal(info.title, entry.title);
        assert.equal(info.detail, entry.what);
        assert.equal(info.action, entry.steps[0]);
        assert.ok(sides.includes(entry.side));
    }
    for (const signal of Object.values(REQUEST_DIAGNOSTIC_SIGNAL)) assert.ok(ERROR_HELP[signal], signal);
    assert.deepEqual(diagnosticSignalInfo('T-HTTP-529'), diagnosticSignalInfo('T-HTTP-5XX'));
    assert.deepEqual(diagnosticSignalInfo('T-HTTP-418'), diagnosticSignalInfo('T-HTTP-4XX'));
});

test('弹窗状态按当前操作显示，原文转义后只在技术信息中', () => {
    const provider = describeProviderMessage('model overloaded <script>alert(1)</script>');
    const base = { signal: 'T-API-PROVIDER-ERROR', stage: '正文生成', httpStatus: 200, hasText: false,
        heartbeats: 64, transport: 'stream', elapsedMs: 205000, providerMessage: provider };
    const html = errorHelpHTML(base, { actions: true, version: '4.4.8d' });
    assert.match(html, /正文生成时出错/);
    assert.match(html, /<span>T-API-PROVIDER-ERROR<\/span>/);
    assert.match(html, /teh-side-far/);
    assert.doesNotMatch(html, /<script|<span>HTTP 200/);
    assert.match(html, /<details>[\s\S]*&lt;script[\s\S]*连接本身是通的[\s\S]*64 次心跳，0 字正文/);
    assert.ok(html.indexOf('data-error-copy') < html.indexOf('data-error-diagnostics'));
    for (const [changes, expected] of [
        [{ contextNote: '原概要已保留' }, '原概要已保留'],
        [{ signal: 'T-STORAGE-WRITE' }, '这次的内容还没存进浏览器'],
        [{ signal: 'T-RENDER-INVALID' }, '正文已保留，只是排版没有完成'],
        [{ stage: '重新 HTML 排版' }, '正文已保留，只是排版没有完成'],
        [{ retainedChars: 1421 }, '已保留此前写好的 1,421 字。'],
        [{ retained: true }, '此前写好的正文已保留。'],
        [{ stage: '模型列表' }, '这只是连接检查，不影响任何作品。'],
        [{ stage: '排版 API 连接测试' }, '这只是连接检查，不影响任何作品。'],
        [{}, '这次没有收到正文。已保存的作品不受影响。'],
    ]) assert.ok(errorHelpHTML({ ...base, ...changes }).includes(expected), expected);

    const chinese = errorHelpHTML({ ...base, providerMessage: describeProviderMessage('该令牌所属分组已被禁用') });
    assert.match(chinese, /该令牌所属分组已被禁用/);
    assert.doesNotMatch(chinese, /英文原文见/);
    assert.doesNotMatch(errorHelpHTML({ ...base, providerMessage: null }), /中转返回的说明/);
    const copied = errorCopyText({ ...base, providerMessage: describeProviderMessage(providerError + ' token=fixture-token https://example.invalid/v1') },
        { version: '4.4.8d', time: new Date(2026, 10, 14, 18, 28) });
    assert.match(copied, /时间：2026-11-14 18:28\n在做什么：正文生成\n结果：中转服务在生成途中报错/);
    assert.match(copied, /HTTP 状态：200\n线路：独立 API · 流式\n用时：205 秒/);
    assert.match(copied, /英文原文：upstream gemini 503: model overloaded token=\*{4} \[地址已隐藏\]/);
    assert.doesNotMatch(copied, /fixture-token|https:\/\/|<script>/);
});

test('转发的报错和复制信息去掉明确回显的正文和接口地址', () => {
    for (const message of [
        'Content policy violation in messages[1].content: "Synthetic input leaked by gateway"',
        'Request rejected: {"messages":[{"role":"user","content":"Synthetic input leaked by gateway"}]}',
        'Proxy could not reach //private.example/v1 or localhost:8001/api/v1',
    ]) {
        const issue = classifyRequestFailure(statusError(400, json(message)));
        const protectedText = /Synthetic input leaked by gateway|private\.example|localhost:8001/;
        assert.doesNotMatch(issue.providerMessage.original, protectedText);
        assert.doesNotMatch(JSON.stringify(issue), protectedText);
        assert.doesNotMatch(errorHelpHTML(issue), protectedText);
        assert.doesNotMatch(errorCopyText(issue), protectedText);
    }
});

test('连接检查保留结构化错误，并隐藏未保存的测试 Key', () => {
    const payload = JSON.stringify({ error: { code: 'content_filter' } });
    const error = providerPayloadError('', 'non_stream', { status: 200, payload });
    assert.equal(error.diagnosticSignal, 'T-API-CONTENT-FILTER');
    const key = 'fixture-custom-unsaved';
    const issue = classifyRequestFailure(statusError(401, json('Invalid API key: ' + key), {
        transport: 'non_stream', secrets: [key],
    }), { stage: '连接测试' });
    assert.equal(issue.signal, 'T-HTTP-401');
    assert.equal(issue.transport, 'non_stream');
    assert.match(errorHelpHTML(issue), /这只是连接检查，不影响任何作品/);
    assert.ok(!JSON.stringify(issue).includes(key));
    assert.ok(!errorCopyText(issue).includes(key));
});

test('SSE 心跳注释和具名心跳分别计数，同一帧只计一次', async () => {
    const heartbeats = ': heartbeat\n\n'
        + 'event: heartbeat\n\nevent: ping\ndata: {"type":"ping"}\n\n'
        + 'data: {"type":"ping"}\n\ndata: {"type":"heartbeat"}\n\n';
    await assert.rejects(readSSEStream(sse(heartbeats + 'data: ' + json(providerError) + '\n\n')), error => {
        const issue = classifyRequestFailure(error);
        assert.equal(issue.heartbeats, 5);
        assert.equal(issue.signal, 'T-API-PROVIDER-ERROR');
        return true;
    });
});

test('主 API 故障的技术信息使用本次实际提交的流式设置和计时', async t => {
    const host = { oai_settings: { chat_completion_source: 'openai', openai_model: 'fixture' },
        ChatCompletionService: { async processRequest() { throw Error('502 Bad Gateway'); } } };
    for (const [key, value] of [['window', {}], ['SillyTavern', { getContext: () => host }]]) {
        const original = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
        t.after(() => {
            if (original) Object.defineProperty(globalThis, key, original);
            else delete globalThis[key];
        });
    }
    const api = createTheaterApi({ settings: {}, runtimeLog() {} });
    for (const [shouldStream, route] of [[true, '主 API · 流式'], [false, '主 API · 非流式']]) {
        await assert.rejects(api.generateWithMainAPI(host, 'fixture', 'fixture', () => {}, shouldStream), error => {
            const issue = classifyRequestFailure(error);
            assert.equal(issue.signal, 'T-HTTP-502');
            assert.ok(Number.isFinite(issue.elapsedMs));
            assert.ok(errorCopyText(issue).includes(route));
            return true;
        });
    }
});

test('长梦新草稿写入失败时交给手动复制，并显示保存失败而非正文未收到', async () => {
    const source = readFileSync(new URL('../long-dream-runtime.js', import.meta.url), 'utf8');
    const entry = source.split('// @theater-source-begin generateNextLongDreamChapter')[1]
        .split('// @theater-source-end generateNextLongDreamChapter')[0];
    const dream = { id: 1, chapters: [] };
    const unsaved = { text: '合成的未存草稿', formatRecovered: 'fixture' };
    const runtime = {
        activeLongDreamId: 1, longDreamCache: [dream], longDreamCanonSuggestionState: {}, settings: {},
        getLongDreamComposerDraft: () => ({}), setLongDreamComposerDraft() {},
        longDreamActiveMemoryCount: () => 0, countSnapshotEntries: () => 0, clearRequestIssue() {},
        captureGenerationApiRoute: () => ({}), runtimeLog() {}, stopLongDreamProgressTicker() {},
        renderLongDreamPanel() {}, captureRequestIssue: classifyRequestFailure, requestFailureMessage: () => '',
        showManualCopyPanel(text) { assert.equal(this.reported.requestIssue.signal, 'T-STORAGE-WRITE'); this.copied = text; },
        theaterError(_message, _title, options) { this.reported = options; },
    };
    const controller = { async run() { throw Object.assign(Error('synthetic write error'), { unsavedLongDreamDraft: unsaved }); } };
    const scope = {
        runtime, console: { error() {} }, toastr: { warning() {}, info() {} },
        $: () => ({ length: 0 }), normalizeManualTarget: () => 800,
        getLongDreamGenerationController: () => controller, LONG_DREAM_DRAFT_STATUS: { REVIEW: 'review' },
        creativeEnhancementPrompt: () => '', resolveLongDreamRequestFoundation: async () => ({ identitySlots: {} }),
        selectRelevantLongDreamMemoryItems: () => [], resetLongDreamStreamRenderer() {}, resetLongDreamRenderProgress() {},
        SillyTavern: { getContext: () => ({}) }, DEFAULT_SYSTEM_PROMPT: '', createDiagnosticError,
        readableCharCount: text => text.length,
    };
    await runInNewContext(entry + '\ngenerateNextLongDreamChapter()', scope);
    assert.equal(runtime.copied, unsaved.text);
    assert.equal(runtime.unsavedLongDreamDrafts.get('1'), unsaved);
    assert.equal(runtime.reported.requestIssue.signal, 'T-STORAGE-WRITE');
    assert.equal(runtime.reported.retained, false);
    assert.match(errorHelpHTML(runtime.reported.requestIssue), /这次的内容还没存进浏览器/);
    assert.doesNotMatch(errorCopyText(runtime.reported.requestIssue), /合成的未存草稿/);
});
