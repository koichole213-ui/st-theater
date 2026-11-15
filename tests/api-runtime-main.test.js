// 从 core.test.js 拆出：api-runtime-main
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestMainApi } from '../api-runtime.js';
import { REQUEST_DIAGNOSTIC_SIGNAL } from '../request-diagnostics.js';

test('酒馆主 API 运行层优先使用 ChatCompletionService', async () => {
    const chunks = [];
    const requests = [];
    const ctx = {
        oai_settings: {
            chat_completion_source: 'openai',
            openai_model: 'main-model',
            openai_max_tokens: 4096,
        },
    };
    const result = await requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        onChunk: text => chunks.push(text),
        chatCompletionService: {
            processRequest: async request => {
                requests.push(request);
                return { choices: [{ message: { content: '主 API 正文' }, finish_reason: 'stop' }] };
            },
        },
        getContext: () => ctx,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'main-model');
    assert.equal(requests[0].max_tokens, 4096);
    assert.equal(requests[0].tools, undefined);
    assert.equal(requests[0].tool_choice, undefined);
    assert.deepEqual(chunks, ['主 API 正文']);
    assert.equal(result.text, '主 API 正文');
});

test('酒馆主 API 按官方形态传递预设并读取累计流式正文', async () => {
    const chunks = [];
    let capturedOptions;
    let capturedExtractData;
    const ctx = {
        oai_settings: {
            chat_completion_source: 'custom',
            openai_model: 'main-model',
            openai_max_tokens: 0,
        },
    };
    const result = await requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        presetName: '众生相',
        shouldStream: true,
        onChunk: text => chunks.push(text),
        chatCompletionService: {
            processRequest: async (_request, options, extractData) => {
                capturedOptions = options;
                capturedExtractData = extractData;
                return async function* () {
                    yield { text: '第一段', state: { reasoning: '思考中' } };
                    yield { text: '第一段第二段', state: { reasoning: '思考完成' } };
                };
            },
        },
        getContext: () => ctx,
    });
    assert.deepEqual(capturedOptions, { presetName: '众生相' });
    assert.equal(capturedExtractData, true);
    assert.deepEqual(chunks, ['第一段', '第一段第二段']);
    assert.equal(result.text, '第一段第二段');
});

test('酒馆主 API 已发出的空请求不会再降级重复生成', async () => {
    let helperCalls = 0;
    const ctx = { oai_settings: { chat_completion_source: 'custom', openai_model: 'main-model' } };
    await assert.rejects(() => requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: true,
        chatCompletionService: {
            processRequest: async () => async function* () {},
        },
        tavernHelper: {
            generateRaw: async () => {
                helperCalls += 1;
                return '不应重复生成';
            },
        },
        getContext: () => ctx,
    }), error => error?.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.EMPTY);
    assert.equal(helperCalls, 0);
});

test('酒馆主 API 没有 ChatCompletionService 时复用 TavernHelper 路径', async () => {
    const paths = [];
    let helperOptions;
    const result = await requestMainApi({
        ctx: { oai_settings: { openai_model: 'main-model' } },
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: true,
        onPath: path => paths.push(path),
        tavernHelper: {
            generateRaw: async options => {
                helperOptions = options;
                return 'TavernHelper 正文';
            },
        },
        getContext: () => ({}),
    });
    assert.deepEqual(paths, ['main:TavernHelper']);
    assert.equal(helperOptions.should_stream, true);
    assert.equal(helperOptions.ordered_prompts[1].content, '用户');
    assert.deepEqual(helperOptions.injects, []);
    assert.equal('tools' in helperOptions, false);
    assert.equal('tool_choice' in helperOptions, false);
    assert.equal(result.text, 'TavernHelper 正文');
});

test('酒馆主 API 隐藏 thinking，且只有思考内容时不会降级重发', async () => {
    const ctx = { oai_settings: { chat_completion_source: 'openai', openai_model: 'main-model' } };
    const chunks = [];
    const result = await requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        onChunk: text => chunks.push(text),
        chatCompletionService: {
            processRequest: async () => ({ content: '<thinking>主线路思考</thinking>主线路正文' }),
        },
        getContext: () => ctx,
    });
    assert.equal(result.text, '主线路正文');
    assert.deepEqual(chunks, ['主线路正文']);

    let helperCalls = 0;
    await assert.rejects(() => requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        chatCompletionService: {
            processRequest: async () => ({ content: '<thinking>只有思考</thinking>' }),
        },
        tavernHelper: {
            generateRaw: async () => {
                helperCalls++;
                return '不应重发';
            },
        },
        getContext: () => ctx,
    }), error => error?.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.REASONING_ONLY);
    assert.equal(helperCalls, 0);
});

test('酒馆主 API 无法识别 ChatCompletionService 字段时安全降级到 TavernHelper', async () => {
    const fallbacks = [];
    let serviceCalls = 0;
    let helperCalls = 0;
    const result = await requestMainApi({
        ctx: {},
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        chatCompletionService: {
            processRequest: async () => {
                serviceCalls++;
                return '不应调用';
            },
        },
        tavernHelper: {
            generateRaw: async () => {
                helperCalls++;
                return '兼容路径正文';
            },
        },
        getContext: () => ({}),
        onFallback: path => fallbacks.push(path),
    });
    assert.equal(serviceCalls, 0);
    assert.equal(helperCalls, 1);
    assert.deepEqual(fallbacks, ['main:ChatCompletionService']);
    assert.equal(result.text, '兼容路径正文');
});

test('酒馆上下文缺少线路字段时会读取全局主 API 设置，不瞬间降级', async () => {
    const originalSettings = globalThis.oai_settings;
    globalThis.oai_settings = { chat_completion_source: 'custom', custom_model: 'global-model' };
    let serviceCalls = 0;
    let helperCalls = 0;
    try {
        const result = await requestMainApi({
            ctx: { oai_settings: { openai_max_tokens: 0 } },
            systemPrompt: '系统',
            userPrompt: '用户',
            shouldStream: false,
            chatCompletionService: {
                processRequest: async request => {
                    serviceCalls += 1;
                    assert.equal(request.chat_completion_source, 'custom');
                    assert.equal(request.model, 'global-model');
                    return { content: '首选线路正文' };
                },
            },
            tavernHelper: {
                generateRaw: async () => {
                    helperCalls += 1;
                    return '不应降级';
                },
            },
            getContext: () => ({ oai_settings: { openai_max_tokens: 0 } }),
        });
        assert.equal(result.text, '首选线路正文');
        assert.equal(serviceCalls, 1);
        assert.equal(helperCalls, 0);
    } finally {
        globalThis.oai_settings = originalSettings;
    }
});

test('酒馆主 API 的内容策略错误不会降级重发到 TavernHelper', async () => {
    let helperCalls = 0;
    await assert.rejects(
        requestMainApi({
            ctx: { oai_settings: { chat_completion_source: 'openai', openai_model: 'test-model' } },
            chatCompletionService: {
                processRequest: async () => { throw new Error('Request blocked by content filter: 不应重发的正文'); },
            },
            tavernHelper: {
                generateRaw: async () => {
                    helperCalls++;
                    return '不应该收到这里的正文';
                },
            },
            getContext: () => ({ oai_settings: { chat_completion_source: 'openai', openai_model: 'test-model' } }),
        }),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && !error.message.includes('不应重发的正文'),
    );
    assert.equal(helperCalls, 0);
});
