// 从 core.test.js 拆出：api-runtime-custom
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { API_PROTOCOLS, MESSAGE_COMPATIBILITY, classifyTokenLimitError, isContentBlockedErrorMessage } from '../api-client.js';
import { CUSTOM_STREAM_IDLE_TIMEOUT_MS, readNonStreamingResponse, readSSEStream, requestCustomApi } from '../api-runtime.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, classifyRequestFailure, createDiagnosticError, diagnosticSignalInfo, diagnosticSignalCatalog, formatConnectionDiagnostics } from '../request-diagnostics.js';

test('独立 API 会在交付前隐藏思考标签，只有思考内容时给出稳定信号', async () => {
    const visibleChunks = [];
    const config = {
        apiUrl: 'https://api.example.com/v1',
        apiProtocol: API_PROTOCOLS.OPENAI,
        apiKey: 'secret',
        apiModel: 'model-name',
        maxOutputTokens: 1024,
    };
    const result = await requestCustomApi({
        config,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        onChunk: text => visibleChunks.push(text),
        fetchImpl: async () => new Response(JSON.stringify({
            choices: [{ message: { content: '<electric>3.7 Flash 私密思考</electric>可见正文' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(result.text, '可见正文');
    assert.deepEqual(visibleChunks, ['可见正文']);

    await assert.rejects(() => requestCustomApi({
        config,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        fetchImpl: async () => new Response(JSON.stringify({
            choices: [{ message: { content: '<thinking>只有思考，没有正文</thinking>' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }), error => error?.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.REASONING_ONLY
        && error?.code === 'THEATER_REASONING_ONLY');
});

test('独立 API 的独立思考字段不会被当成空流后再次请求', async () => {
    let calls = 0;
    await assert.rejects(() => requestCustomApi({
        config: {
            apiUrl: 'https://api.example.com/v1',
            apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'gemini-3.1-pro-preview',
            maxOutputTokens: 16384,
        },
        systemPrompt: '系统',
        userPrompt: '用户',
        fetchImpl: async () => {
            calls += 1;
            return new Response('data: {"choices":[{"delta":{"reasoning_content":"内部思考"},"finish_reason":"length"}]}\n\ndata: [DONE]\n', {
                headers: { 'content-type': 'text/event-stream' },
            });
        },
    }), error => error?.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.REASONING_ONLY
        && error?.code === 'THEATER_REASONING_ONLY');
    assert.equal(calls, 1);
});

test('独立 API 收到合法结束事件但没有正文时不会重复生成', async () => {
    let calls = 0;
    await assert.rejects(() => requestCustomApi({
        config: {
            apiUrl: 'https://api.example.com/v1',
            apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'model-name',
            maxOutputTokens: 1024,
        },
        systemPrompt: '系统',
        userPrompt: '用户',
        fetchImpl: async () => {
            calls += 1;
            return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n', {
                headers: { 'content-type': 'text/event-stream' },
            });
        },
    }), error => error?.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.EMPTY
        && error?.code === 'THEATER_RESPONSE_EMPTY');
    assert.equal(calls, 1);
});

test('独立 API 即使收到旧调用方附带的采样配置也不会发到线上', async () => {
    let requestBody;
    let requestTrace;
    const logs = [];
    const forbidden = [
        'temperature', 'top_p', 'top_k', 'top_a', 'min_p', 'frequency_penalty',
        'presence_penalty', 'repetition_penalty', 'seed', 'reasoning_effort',
    ];
    const result = await requestCustomApi({
        config: {
            apiUrl: 'https://api.example.com/v1',
            apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'gemini-3.1-pro-preview',
            maxOutputTokens: 16384,
            generationOptions: Object.fromEntries(forbidden.map(name => [name, 0.8])),
        },
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        onRequest: details => { requestTrace = details; },
        log: (level, message, details) => logs.push({ level, message, details }),
        fetchImpl: async (_url, options) => {
            requestBody = JSON.parse(options.body);
            return new Response(JSON.stringify({ choices: [{ message: { content: '默认采样成功' } }] }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(result.text, '默认采样成功');
    for (const name of forbidden) assert.equal(requestBody[name], undefined, `线上请求不应包含 ${name}`);
    assert.equal(requestTrace.presetGenerationOptionsInherited, false);
    assert.equal(requestTrace.messageCompatibility, MESSAGE_COMPATIBILITY.NATIVE);
    assert.match(JSON.stringify(logs), /not_inherited/);
    assert.match(JSON.stringify(logs), /message_compatibility/);
});

test('独立 API 的普通 400 不因预设采样参数再发第二次请求', async () => {
    let calls = 0;
    await assert.rejects(() => requestCustomApi({
        config: {
            apiUrl: 'https://api.example.com/v1', apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'model-name', maxOutputTokens: 1024, generationOptions: { top_k: 40 },
        },
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        fetchImpl: async () => {
            calls += 1;
            return new Response('{"error":{"message":"Unknown parameter: top_k"}}', { status: 400 });
        },
    }), error => error?.diagnosticSignal === 'T-API-PARAMETER-UNSUPPORTED');
    assert.equal(calls, 1);
});

test('独立 API 的 Token 降档继续生效且每一档都不带预设采样参数', async () => {
    const bodies = [];
    const fallbacks = [];
    const requestModes = [];
    const result = await requestCustomApi({
        config: {
            apiUrl: 'https://api.example.com/v1', apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'model-name', maxOutputTokens: 16384, generationOptions: { top_k: 40, temperature: 0.8 },
        },
        messages: [
            { role: 'user', content: '预设用户段' },
            { role: 'system', content: '人物世界书' },
            { role: 'user', content: '创作指令' },
            { role: 'system', content: '最终规则' },
        ],
        shouldStream: false,
        onRequest: details => requestModes.push(details.messageCompatibility),
        onFallback: value => fallbacks.push(value),
        fetchImpl: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            if (bodies.length === 1) return new Response('max_tokens must be less than or equal to 8192', { status: 400 });
            return new Response(JSON.stringify({ choices: [{ message: { content: '降档成功' } }] }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(result.text, '降档成功');
    assert.deepEqual(bodies.map(body => [body.max_tokens, body.top_k, body.temperature]), [
        [16384, undefined, undefined],
        [8192, undefined, undefined],
    ]);
    for (const body of bodies) assert.deepEqual(body.messages, [
        { role: 'user', content: '预设用户段' }, { role: 'system', content: '人物世界书' },
        { role: 'user', content: '创作指令' }, { role: 'system', content: '最终规则' },
    ]);
    assert.deepEqual(requestModes, [
        MESSAGE_COMPATIBILITY.NATIVE,
        MESSAGE_COMPATIBILITY.NATIVE,
    ]);
    assert.deepEqual(fallbacks, ['custom:max-token 16384→8192']);
});

test('独立 API 输入与总容量错误只请求一次，不误降输出，脱敏说明独立保留', async () => {
    const cases = [
        ['input exceeds maximum context length', 'INPUT_LIMIT'],
        ['prompt is too long: 210000 tokens > 200000 maximum context length', 'INPUT_LIMIT'],
        ['输入内容超过允许上限', 'INPUT_LIMIT'],
        ['input_too_long', 'INPUT_LIMIT'],
        ['maximum context length is 200000 tokens, requested 220000 tokens (156000 in messages, 64000 in completion)', 'CONTEXT_LIMIT'],
        ['input tokens + max_tokens exceed the limit of 200000', 'CONTEXT_LIMIT'],
        ['上下文窗口已满。减少对话历史记录、系统提示或工具', 'CONTEXT_LIMIT'],
    ];
    for (const protocol of [API_PROTOCOLS.OPENAI, API_PROTOCOLS.ANTHROPIC]) {
        for (const [message, kind] of cases) {
            const bodies = [], fallbacks = [], logs = [];
            const config = { apiUrl: 'https://example.invalid/v1', apiProtocol: protocol,
                apiKey: 'synthetic-placeholder', apiModel: 'fixture', maxOutputTokens: 64000 };
            await assert.rejects(requestCustomApi({ config, shouldStream: true,
                messages: [{ role: 'user', content: '虚构输入' }],
                onFallback: value => fallbacks.push(value), log: (...value) => logs.push(value),
                fetchImpl: async (_url, options) => {
                    bodies.push(JSON.parse(options.body));
                    return new Response(JSON.stringify({ error: { message: message + ' PRIVATE_ERROR_MARKER token=fixture-private-token' } }), { status: 400 });
                },
            }), error => {
                assert.equal(error.diagnosticSignal, REQUEST_DIAGNOSTIC_SIGNAL[kind], message);
                assert.equal(classifyRequestFailure(error).signal, REQUEST_DIAGNOSTIC_SIGNAL[kind]);
                const { providerMessage, ...safeError } = error;
                assert.match(providerMessage.original, /PRIVATE_ERROR_MARKER/);
                assert.doesNotMatch(JSON.stringify(safeError), /PRIVATE_ERROR_MARKER/);
                assert.doesNotMatch(JSON.stringify(error), /fixture-private-token/);
                assert.match(diagnosticSignalInfo(error.diagnosticSignal).detail, /没有/);
                return true;
            });
            assert.equal(bodies.length, 1, message);
            assert.equal(bodies[0].max_tokens, 64000);
            assert.equal(config.maxOutputTokens, 64000);
            assert.deepEqual(fallbacks, []);
            assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_ERROR_MARKER/);
        }
    }
});

test('独立 API 按明确输出边界调整，重试保留完整输入与设置', async () => {
    for (const [message, expected] of [
        ['max_tokens must be less than or equal to 32768', 32768],
        ['max_tokens must be less than 32768', 32767],
        ['maximum output tokens is 32,768', 32768],
        ['max_tokens: 64000 is too large. Maximum output tokens is 32768', 32768],
        ['max_tokens: 64000 exceeds the maximum allowed value of 32768', 32768],
        ['max_tokens must be between 1 and 32768', 32768],
        ['max_tokens exceeds maximum allowed output tokens of 32768', 32768],
        ['This model supports at most 32768 completion tokens, max_tokens was 64000', 32768],
        ['max_tokens exceeds the allowed limit', 16384],
    ]) {
        const bodies = [];
        const config = { apiUrl: 'https://example.invalid/v1', apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'fixture', maxOutputTokens: 64000 };
        const result = await requestCustomApi({ config, shouldStream: false,
            messages: [{ role: 'system', content: '保留设定' }, { role: 'user', content: '<article>保留前文</article>' }],
            fetchImpl: async (_url, options) => {
                bodies.push(JSON.parse(options.body));
                return bodies.length === 1 ? new Response(JSON.stringify({ error: { message } }), { status: 400 })
                    : new Response(JSON.stringify({ choices: [{ message: { content: '<article>虚构正文</article>' } }] }), { status: 200 });
            },
        });
        assert.deepEqual(bodies.map(body => body.max_tokens), [64000, expected], message);
        assert.deepEqual(bodies[1].messages, bodies[0].messages);
        assert.equal(config.maxOutputTokens, 64000);
        assert.equal(result.text, '<article>虚构正文</article>');
    }
});

test('Token 分类不从请求回显取限制，未知错误不触发降档', () => {
    for (const message of ['model not found', 'max_tokens must be a positive integer', 'requested tokens exceed limit',
        'max_tokens must be at least 1024; minimum limit is 1024']) {
        assert.equal(classifyTokenLimitError(400, message).kind, null);
    }
    assert.equal(classifyTokenLimitError(401, 'max_tokens exceeds limit').kind, null);
    assert.equal(classifyTokenLimitError(400, JSON.stringify({ error: { message: 'model not found' },
        request: { max_tokens: 64000, messages: 'max_tokens must be less than 1000' } })).kind, null);
});

test('独立 API 输出限制持续变化时最多尝试八次', async () => {
    const bodies = [];
    await assert.rejects(requestCustomApi({
        config: { apiUrl: 'https://example.invalid/v1', apiModel: 'fixture', maxOutputTokens: 64000 },
        shouldStream: false, messages: [{ role: 'user', content: '虚构内容' }],
        fetchImpl: async (_url, options) => {
            const body = JSON.parse(options.body);
            bodies.push(body);
            return new Response('max_tokens must be less than or equal to ' + (body.max_tokens - 1), { status: 400 });
        },
    }), error => error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.OUTPUT_LIMIT);
    assert.equal(bodies.length, 8);
    assert.equal(bodies[7].max_tokens, 63993);
});

test('独立 API 输出下限错误不会反向降低输出重试', async () => {
    let attempts = 0;
    await assert.rejects(requestCustomApi({
        config: { apiUrl: 'https://example.invalid/v1', apiModel: 'fixture', maxOutputTokens: 64000 },
        shouldStream: false, messages: [{ role: 'user', content: '虚构内容' }],
        fetchImpl: async () => {
            attempts++;
            return new Response('max_tokens is below the minimum limit of 1024', { status: 400 });
        },
    }), error => error.diagnosticSignal === 'T-HTTP-400');
    assert.equal(attempts, 1);
});

test('正式生成与连接测试都不再读取创作预设采样参数', () => {
    const source = readTheaterImplementation();
    assert.doesNotMatch(source, /cachedPresetGenerationOptions|extractPresetGenerationOptions|generationOptions/);
    const start = source.indexOf('async function testAPIConnection()');
    const end = source.indexOf('// Update', start);
    const connectionTestSource = source.slice(start, end);
    assert.match(connectionTestSource, /preset_generation_options: 'not_inherited'/);
    assert.match(connectionTestSource, /maxTokens: apiChannel\(config\) === 'custom' \? 16 : 256/);
    assert.doesNotMatch(connectionTestSource, /temperature|top_p|top_k|min_p|reasoning_effort/);
});

test('内容策略错误文字也会安全归类，不把上游回显带进错误对象', async () => {
    const upstreamMessage = 'Request blocked by content filter: 不应回显的服务端正文';
    assert.equal(isContentBlockedErrorMessage(upstreamMessage), true);
    await assert.rejects(
        readNonStreamingResponse(new Response(JSON.stringify({ error: { message: upstreamMessage } }), {
            headers: { 'content-type': 'application/json' },
        })),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && !error.message.includes('不应回显的服务端正文'),
    );
    await assert.rejects(
        readSSEStream(new Response(`data: ${JSON.stringify({ error: { message: upstreamMessage } })}\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
        })),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && !error.message.includes('不应回显的服务端正文'),
    );
});

test('API 运行层能累积 SSE 正文并保留结束原因', async () => {
    const chunks = [];
    const response = new Response([
        'data: {"choices":[{"delta":{"content":"第一段"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"第二段"},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
    ].join('\n'), { headers: { 'content-type': 'text/event-stream' } });
    const result = await readSSEStream(response, text => chunks.push(text), API_PROTOCOLS.OPENAI);
    assert.deepEqual(chunks, ['第一段', '第一段第二段']);
    assert.equal(result.text, '第一段第二段');
    assert.equal(result.stopReason, 'stop');
    assert.equal(result.rawStopReason, 'stop');
});

test('独立 API 收到 DONE 后立即结束，不等待上游关闭连接', async () => {
    const chunks = [];
    let cancelled = false;
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode([
                'data: {"choices":[{"delta":{"content":"完整正文"},"finish_reason":"stop"}]}',
                '',
                'data: [DONE]',
                '',
            ].join('\n')));
        },
        cancel() {
            cancelled = true;
        },
    }), { headers: { 'content-type': 'text/event-stream' } });

    const result = await readSSEStream(response, text => chunks.push(text), API_PROTOCOLS.OPENAI, { idleTimeoutMs: 50 });
    assert.equal(result.text, '完整正文');
    assert.deepEqual(chunks, ['完整正文']);
    assert.equal(cancelled, true);
});

test('独立 API 的心跳数据会刷新空闲等待，十分钟只限制连续静默而非总生成时长', async () => {
    assert.equal(CUSTOM_STREAM_IDLE_TIMEOUT_MS, 10 * 60 * 1000);
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"前半段"}}]}\n\n'));
            setTimeout(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 50);
            setTimeout(() => controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"后半段"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')), 100);
        },
    }), { headers: { 'content-type': 'text/event-stream' } });

    const result = await readSSEStream(response, () => {}, API_PROTOCOLS.OPENAI, { idleTimeoutMs: 75 });
    assert.equal(result.text, '前半段后半段');
});

test('共用独立 API 流在长时间无新数据时结束等待并保留已收到正文', async () => {
    const chunks = [];
    let cancelled = false;
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"已收到半段"}}]}\n\n'));
        },
        cancel() {
            cancelled = true;
        },
    }), { headers: { 'content-type': 'text/event-stream' } });

    await assert.rejects(
        readSSEStream(response, text => chunks.push(text), API_PROTOCOLS.OPENAI, { idleTimeoutMs: 20 }),
        error => {
            assert.equal(error.code, 'THEATER_STREAM_IDLE_TIMEOUT');
            assert.equal(error.diagnosticSignal, REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT);
            return true;
        },
    );
    assert.deepEqual(chunks, ['已收到半段']);
    assert.equal(cancelled, true);
});

test('普通生成与长梦正文、排版共用同一个线路请求入口', () => {
    const source = readTheaterImplementation();
    const longDreamRequest = source.slice(
        source.indexOf('async function requestLongDreamChapter'),
        source.indexOf('async function generateLongDreamCanonSuggestions'),
    );
    const finalRenderRequest = source.slice(
        source.indexOf('async function requestFinalRenderedHtml'),
        source.indexOf('function normalizeLongDreamResponseText'),
    );
    const ordinaryGeneration = source.slice(
        source.indexOf('async function runGeneration'),
        source.indexOf('function currentAutoInstruction'),
    );
    assert.match(longDreamRequest, /(?:runtime\.)?requestConfiguredGenerationApi/);
    assert.doesNotMatch(longDreamRequest, /(?:runtime\.)?settings\.apiMode|(?:runtime\.)?generateWithMainAPI|(?:runtime\.)?callCustomAPIStream/);
    assert.match(finalRenderRequest, /(?:runtime\.)?requestConfiguredGenerationApi/);
    assert.doesNotMatch(finalRenderRequest, /(?:runtime\.)?settings\.apiMode|(?:runtime\.)?generateWithMainAPI|(?:runtime\.)?callCustomAPIStream/);
    assert.match(ordinaryGeneration, /(?:runtime\.)?requestConfiguredGenerationApi/);
    assert.match(source, /function (?:runtime\.)?captureGenerationApiRoute/);
});

test('非流式内容过滤只给出固定错误信号，不回显服务端正文', async () => {
    const response = new Response(JSON.stringify({
        choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
        secret_echo: '不应出现在错误里',
    }), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(
        readNonStreamingResponse(response, () => {}, API_PROTOCOLS.OPENAI),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && error.message === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && error.theaterFailure?.rawStopReason === 'content_filter'
            && !error.message.includes('不应出现在错误里'),
    );
});

test('流式内容过滤不会被误当作空流而重发同一请求', async () => {
    let calls = 0;
    await assert.rejects(
        requestCustomApi({
            config: {
                apiUrl: 'https://example.com/v1',
                apiProtocol: API_PROTOCOLS.OPENAI,
                apiModel: 'test-model',
                maxOutputTokens: 1024,
            },
            systemPrompt: '系统',
            userPrompt: '用户',
            fetchImpl: async () => {
                calls += 1;
                return new Response('data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n', {
                    headers: { 'content-type': 'text/event-stream' },
                });
            },
        }),
        error => error.code === 'THEATER_CONTENT_FILTER' && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER,
    );
    assert.equal(calls, 1);
});

test('独立 API 遇到 429 会按 Retry-After 单次重试并读取非流式正文', async () => {
    const logs = [];
    let calls = 0;
    const result = await requestCustomApi({
        config: {
            apiUrl: 'https://example.com/v1',
            apiProtocol: API_PROTOCOLS.OPENAI,
            apiKey: 'test-key',
            apiModel: 'test-model',
            maxOutputTokens: 2048,
        },
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        log: (level, message, details) => logs.push({ level, message, details }),
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) return new Response('busy', { status: 429, headers: { 'retry-after': '0' } });
            return new Response(JSON.stringify({ choices: [{ message: { content: '重试成功' }, finish_reason: 'stop' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(calls, 2);
    assert.equal(result.text, '重试成功');
    assert.equal(logs.some(item => item.details?.auto_retry === true), true);
});

test('独立 API 空流会在同一轮改用非流式请求', async () => {
    const requestBodies = [];
    const requestTraces = [];
    const chunks = [];
    const fallbacks = [];
    const result = await requestCustomApi({
        config: {
            apiUrl: 'https://example.com/v1',
            apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'test-model',
            maxOutputTokens: 1024,
        },
        messages: [
            { role: 'user', content: '预设用户段' },
            { role: 'system', content: '人物世界书' },
            { role: 'user', content: '生成指令' },
        ],
        onChunk: text => chunks.push(text),
        onFallback: path => fallbacks.push(path),
        onRequest: details => requestTraces.push(details),
        fetchImpl: async (_url, options) => {
            requestBodies.push(JSON.parse(options.body));
            if (requestBodies.length === 1) {
                return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
            }
            return new Response(JSON.stringify({ choices: [{ message: { content: '非流式恢复正文' }, finish_reason: 'stop' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0].stream, true);
    assert.equal(requestBodies[1].stream, false);
    assert.deepEqual(requestBodies[0].messages, requestBodies[1].messages);
    assert.deepEqual(requestTraces.map(trace => trace.messageCompatibility), [
        MESSAGE_COMPATIBILITY.NATIVE,
        MESSAGE_COMPATIBILITY.NATIVE,
    ]);
    assert.deepEqual(chunks, ['非流式恢复正文']);
    assert.equal(result.text, '非流式恢复正文');
    assert.deepEqual(fallbacks, ['custom:stream→non-stream']);
});

test('独立 API 只使用显式配置，不读取或改写酒馆主线路', async () => {
    const originalOaiSettings = globalThis.oai_settings;
    globalThis.oai_settings = { openai_model: 'main-model', api_key: 'main-secret' };
    let captured;
    try {
        const result = await requestCustomApi({
            config: {
                apiUrl: 'https://custom.example/v1',
                apiProtocol: API_PROTOCOLS.OPENAI,
                apiKey: 'custom-secret',
                apiModel: 'custom-model',
                maxOutputTokens: 2048,
            },
            systemPrompt: '系统',
            userPrompt: '用户',
            shouldStream: false,
            fetchImpl: async (url, options) => {
                captured = { url, options, body: JSON.parse(options.body) };
                return new Response(JSON.stringify({
                    choices: [{ message: { content: '独立线路正文' } }],
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            },
        });

        assert.equal(captured.url, 'https://custom.example/v1/chat/completions');
        assert.equal(captured.options.headers.Authorization, 'Bearer custom-secret');
        assert.equal(captured.body.model, 'custom-model');
        assert.equal(JSON.stringify(captured).includes('main-secret'), false);
        assert.equal(result.text, '独立线路正文');
        assert.deepEqual(globalThis.oai_settings, { openai_model: 'main-model', api_key: 'main-secret' });
    } finally {
        globalThis.oai_settings = originalOaiSettings;
    }
});

test('两个独立 API 连接并发请求时各自只携带自己的地址、模型和 Key', async () => {
    const seen = [];
    const run = (label, apiUrl, apiKey, apiModel) => requestCustomApi({
        config: { apiUrl, apiKey, apiModel, apiProtocol: API_PROTOCOLS.OPENAI, maxOutputTokens: 1024 },
        systemPrompt: `系统-${label}`,
        userPrompt: `用户-${label}`,
        shouldStream: false,
        fetchImpl: async (url, options) => {
            seen.push({ label, url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
            return new Response(JSON.stringify({ choices: [{ message: { content: `完成-${label}` } }] }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    await Promise.all([
        run('A', 'https://a.example/v1', 'key-a', 'model-a'),
        run('B', 'https://b.example/v1', 'key-b', 'model-b'),
    ]);
    const a = seen.find(item => item.label === 'A');
    const b = seen.find(item => item.label === 'B');
    assert.equal(a.url, 'https://a.example/v1/chat/completions');
    assert.equal(a.authorization, 'Bearer key-a');
    assert.equal(a.body.model, 'model-a');
    assert.equal(a.body.messages[1].content, '用户-A');
    assert.equal(b.url, 'https://b.example/v1/chat/completions');
    assert.equal(b.authorization, 'Bearer key-b');
    assert.equal(b.body.model, 'model-b');
    assert.equal(b.body.messages[1].content, '用户-B');
});

test('独立API区分未取得响应、首块前断流、心跳后断流与非流式中断，诊断不含私密内容', async () => {
    for (const mode of ['connect', 'stream-empty', 'stream-heartbeat', 'stream-text', 'body']) {
        const traces = [], logs = [], chunks = [];
        let calls = 0, error;
        const wire = new TextEncoder().encode(mode === 'stream-text' ? 'data: {"choices":[{"delta":{"content":"合成正文"}}]}\n\n' : ': private-heartbeat\n\n');
        try {
            await requestCustomApi({ config: { apiUrl: 'https://example.invalid', apiKey: 'PRIVATE_API_KEY', apiProtocol: 'openai', apiModel: 'synthetic', maxOutputTokens: 1024 },
                messages: [{ role: 'user', content: 'PRIVATE_REQUEST_BODY' }], shouldStream: mode !== 'body',
                onConnection: info => traces.push(info), log: (...items) => logs.push(items), onChunk: text => chunks.push(text),
                fetchImpl: async () => {
                    calls++;
                    if (mode === 'connect') throw new TypeError('Failed to fetch PRIVATE_ERROR');
                    let reads = 0;
                    return { ok: true, status: 200, headers: { get: () => 'application/x-PRIVATE_HEADER;secret=PRIVATE' },
                        text: async () => { throw new TypeError('network error PRIVATE_ERROR'); },
                        body: { getReader: () => ({ read: async () => {
                            if (reads++ === 0 && ['stream-heartbeat','stream-text'].includes(mode)) return { done: false, value: wire };
                            throw new TypeError('network error PRIVATE_ERROR');
                        }, cancel: async () => {} }) },
                    };
                },
            });
        } catch (caught) { error = caught; }
        const signal = mode === 'connect' ? REQUEST_DIAGNOSTIC_SIGNAL.NO_RESPONSE : mode === 'body' ? REQUEST_DIAGNOSTIC_SIGNAL.BODY_INTERRUPTED : REQUEST_DIAGNOSTIC_SIGNAL.STREAM_INTERRUPTED;
        assert.equal(classifyRequestFailure(error).signal, signal, mode);
        assert.equal(calls, 1, '网络失败不自动重试');
        const trace = traces.at(-1);
        assert.equal(trace.state, 'failed'); assert.equal(trace.failureSignal, signal);
        assert.equal(trace.headersReceived, mode !== 'connect');
        assert.equal(trace.httpStatus, mode === 'connect' ? null : 200);
        assert.equal(trace.failedAt, mode === 'connect' ? 'awaiting-response' : mode === 'body' ? 'reading-body' : 'reading-stream');
        assert.equal(trace.receivedBytes, mode === 'body' ? null : ['stream-heartbeat','stream-text'].includes(mode) ? wire.byteLength : 0);
        assert.equal(trace.receivedChunks, mode === 'body' ? null : ['stream-heartbeat','stream-text'].includes(mode) ? 1 : 0);
        assert.equal(chunks.at(-1) || '', mode === 'stream-text' ? '合成正文' : '');
        assert.doesNotMatch(JSON.stringify({ traces, logs, error }) + formatConnectionDiagnostics(trace), /PRIVATE|private-heartbeat|合成正文/);
        assert.ok(trace.elapsedMs >= 0);
    }
});

test('独立API的停止与明确HTTP错误不被改写成网络分类', async () => {
    for (const mode of ['abort-before', 'abort-body', 'http400', 'http503']) {
        const traces = []; let error;
        try { await requestCustomApi({ config: { apiUrl: 'https://example.invalid', apiModel: 'synthetic', maxOutputTokens: 1024 }, shouldStream: false,
            onConnection: value => traces.push(value), fetchImpl: async () => {
                if (mode === 'abort-before') throw new DOMException('PRIVATE', 'AbortError');
                if (mode === 'abort-body') return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => { throw new DOMException('PRIVATE', 'AbortError'); } };
                return new Response('{}', { status: mode === 'http400' ? 400 : 503 });
            },
        }); } catch (caught) { error = caught; }
        if (mode.startsWith('abort')) { assert.equal(error.name, 'AbortError'); assert.equal(traces.at(-1).state, 'aborted'); assert.equal(traces.at(-1).failureSignal, null); }
        else { assert.equal(classifyRequestFailure(error).signal, mode === 'http400' ? 'T-HTTP-400' : 'T-HTTP-503'); assert.equal(traces.at(-1).state, 'failed'); }
        assert.doesNotMatch(JSON.stringify(traces), /PRIVATE/);
    }
});

test('独立API流式空回转非流式时重置连接计数，诊断回调异常不阻止正常生成', async () => {
    const traces = []; const bodies = [];
    const result = await requestCustomApi({ config: { apiUrl: 'https://example.invalid', apiModel: 'synthetic', maxOutputTokens: 1024 },
        onConnection: trace => { traces.push(trace); throw Error('observer failure'); },
        fetchImpl: async (_url, request) => {
            bodies.push(JSON.parse(request.body));
            return bodies.length === 1 ? new Response('', { headers: { 'content-type': 'text/event-stream' } })
                : new Response(JSON.stringify({ choices: [{ message: { content: '合成正常正文' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
        },
    });
    assert.equal(result.text, '合成正常正文'); assert.equal(bodies.length, 2);
    assert.equal(bodies[0].stream, true); assert.equal(bodies[1].stream, false);
    const trace = traces.at(-1); assert.equal(trace.attempt, 2); assert.equal(trace.state, 'complete');
    assert.equal(trace.transport, 'non-stream'); assert.equal(trace.receivedBytes, null);
    assert.equal(trace.failedAt, null); assert.equal(trace.failureSignal, null);
});

test('新增网络阶段分类出现在常见问题汇总，报告不把心跳字节当正文或猜测跨域', () => {
    const catalog = diagnosticSignalCatalog();
    for (const signal of [REQUEST_DIAGNOSTIC_SIGNAL.NO_RESPONSE, REQUEST_DIAGNOSTIC_SIGNAL.STREAM_INTERRUPTED, REQUEST_DIAGNOSTIC_SIGNAL.BODY_INTERRUPTED]) {
        const entry = catalog.find(item => item.signal === signal);
        assert.ok(entry?.detail && entry.action);
        assert.equal(classifyRequestFailure(createDiagnosticError(signal)).signal, signal);
    }
    assert.match(formatConnectionDiagnostics({ attempt: 1, transport: 'stream', state: 'failed', failedAt: 'reading-stream', headersReceived: true,
        headersMs: 3, httpStatus: 200, contentType: 'text/event-stream', receivedBytes: 15, receivedChunks: 1, elapsedMs: 20 }), /响应头已收到.*HTTP 200.*15 字节.*不等于正文.*读取流式数据/);
    assert.match(formatConnectionDiagnostics({ transport: 'non-stream', receivedBytes: null }), /字节未统计/);
    assert.doesNotMatch(formatConnectionDiagnostics({ state: 'PRIVATE', failedAt: 'PRIVATE', contentType: 'PRIVATE' }), /PRIVATE/);
});

test('真实独立API适配器保留失败阶段，切换主API发起请求时清除旧连接报告', async () => {
    const source = readTheaterImplementation();
    const dispatcher = source.match(/async function (?:runtime\.)?requestConfiguredGenerationApi\([^]*?^}$/m)[0];
    const custom = source.match(/async function (?:runtime\.)?callCustomAPIStream\([^]*?^}/m)[0];
    const scope = { settings: {}, lastRequestContext: null, lastRequestIssue: null, lastApiResponseSummary: null, lastApiConnectionSummary: null, lastRequestMetrics: null,
        createRequestMetrics: path => ({ path }), captureActualRequestTrace() {}, runtimeLog() {}, markFallback() {},
        requestCustomApi: options => requestCustomApi({ ...options, fetchImpl: async () => { throw new TypeError('Failed to fetch PRIVATE'); } }),
        generateWithMainAPI: async () => 'main-result',
    };
    runInNewContext(custom + '\n' + dispatcher, scope);
    const args = { ctx: {}, signal: null, onChunk() {}, systemPrompt: '合成', userPrompt: '测试',
        apiRoute: { mode: 'custom', protocol: 'openai', shouldStream: true, custom: { apiUrl: 'https://example.invalid', apiModel: 'synthetic', maxOutputTokens: 1024 } } };
    await assert.rejects(scope.requestConfiguredGenerationApi(args), error => error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.NO_RESPONSE);
    assert.equal(scope.lastApiConnectionSummary.state, 'failed');
    assert.equal(scope.lastApiConnectionSummary.failedAt, 'awaiting-response');
    const result = await scope.requestConfiguredGenerationApi({ ...args, apiRoute: { mode: 'main', shouldStream: true } });
    assert.equal(result, 'main-result'); assert.equal(scope.lastApiConnectionSummary, null);
});

test('流式请求收到HTML后按实际文本读取阶段诊断，完整HTML仍是非法响应且不重试', async () => {
    for (const interrupted of [true, false]) {
        const traces = []; let calls = 0, error;
        try { await requestCustomApi({ config: { apiUrl: 'https://example.invalid', apiModel: 'synthetic', maxOutputTokens: 1024 },
            onConnection: info => traces.push(info), fetchImpl: async () => {
                calls++;
                return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => {
                    if (interrupted) throw new TypeError('Failed to fetch PRIVATE');
                    return '<html>PRIVATE ERROR PAGE</html>';
                } };
            },
        }); } catch (caught) { error = caught; }
        assert.equal(calls, 1);
        assert.equal(classifyRequestFailure(error).signal, interrupted ? REQUEST_DIAGNOSTIC_SIGNAL.BODY_INTERRUPTED : REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE);
        assert.equal(traces.at(-1).failedAt, 'reading-body');
        assert.equal(traces.at(-1).receivedBytes, null); assert.equal(traces.at(-1).headersReceived, true);
        assert.doesNotMatch(JSON.stringify(traces), /PRIVATE/);
    }
});

test('主API定梦建议直达入口也清除独立API旧失败报告', async () => {
    const source = readTheaterImplementation();
    const main = source.match(/async function (?:runtime\.)?generateWithMainAPI\([^]*?^}$/m)[0];
    const scope = { lastRequestContext: null, lastRequestIssue: null, lastRequestMetrics: null, lastApiConnectionSummary: { state: 'failed' }, lastApiResponseSummary: { httpStatus: 500 }, settings: {},
        window: { TavernHelper: {} }, SillyTavern: { getContext: () => ({}) },
        captureActualRequestTrace() {}, runtimeLog() {}, markFallback() {},
        requestMainApi: async options => { assert.equal(scope.lastApiConnectionSummary, null); assert.equal(scope.lastApiResponseSummary, null); options.onResponse({ transport: 'ChatCompletionService', hasText: true }); return '合成主API正文'; },
    };
    runInNewContext(main, scope);
    const result = await scope.generateWithMainAPI({}, '合成', '合成', () => {}, true, null);
    assert.equal(result, '合成主API正文'); assert.equal(scope.lastApiConnectionSummary, null);
    assert.equal(scope.lastApiResponseSummary.hasText, true);
});
