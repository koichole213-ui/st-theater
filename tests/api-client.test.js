// 从 core.test.js 拆出：api-client
import test from 'node:test';
import assert from 'node:assert/strict';
import { API_PROTOCOLS, DEFAULT_MAX_OUTPUT_TOKENS, MESSAGE_COMPATIBILITY, buildApiRequest, contentBlockReason, extractApiErrorMessage, extractResponseMeta, extractStreamText, hasReasoningContent, isContentBlockedStopReason, isHtmlErrorResponse, isMaxTokenLimitError, isRateLimitErrorMessage, maxTokenFallbackSequence, normalizeMaxTokens, resolveMainApiModel, retryAfterMilliseconds } from '../api-client.js';

test('流式解析兼容 OpenAI、Gemini 原生与 Responses API 正文格式', () => {
    assert.equal(extractStreamText({ choices: [{ delta: { content: 'OpenAI 正文' } }] }), 'OpenAI 正文');
    assert.equal(extractStreamText({ candidates: [{ content: { parts: [{ text: 'Gemini 正文' }] } }] }), 'Gemini 正文');
    assert.equal(extractStreamText({ type: 'response.output_text.delta', delta: 'Responses 正文' }), 'Responses 正文');
    assert.equal(extractStreamText({ output: [{ content: [{ type: 'output_text', text: '完整响应正文' }] }] }), '完整响应正文');
    assert.equal(extractStreamText({ candidates: [{ content: { parts: [{ thought: true, text: '内部思考' }, { text: '可见正文' }] } }] }), '可见正文');
    assert.equal(extractStreamText({ candidates: [{ content: { parts: [{ thought: true, text: '只有思考' }] } }] }), '');
});

test('独立 API 请求构造层不会继承任何创作预设采样参数', () => {
    const forbidden = [
        'temperature', 'top_p', 'top_k', 'top_a', 'min_p', 'frequency_penalty',
        'presence_penalty', 'repetition_penalty', 'seed', 'reasoning_effort',
    ];
    for (const protocol of [API_PROTOCOLS.OPENAI, API_PROTOCOLS.ANTHROPIC]) {
        const request = buildApiRequest({
            url: 'https://example.com/v1',
            protocol,
            key: 'secret',
            model: 'model',
            systemPrompt: '系统',
            userPrompt: '用户',
            generationOptions: Object.fromEntries(forbidden.map(name => [name, 0.8])),
        });
        for (const name of forbidden) assert.equal(request.body[name], undefined, `${protocol} 不应发送 ${name}`);
        assert.equal('tools' in request.body, false);
        assert.equal('response_format' in request.body, false);
        assert.equal(request.headers.Accept, 'text/event-stream');
    }
});

test('独立 OpenAI/auto 不额外重排 system，保留选定模式的消息排列', () => {
    const messages = [
        { role: 'user', content: '预设用户段一' },
        { role: 'system', content: '人物与世界书一' },
        { role: 'assistant', content: '助手预设' },
        { role: 'system', content: '最终规则二' },
    ];
    for (const protocol of [API_PROTOCOLS.OPENAI, API_PROTOCOLS.AUTO]) {
        const request = buildApiRequest({ url: 'https://example.invalid/v1', protocol, model: 'synthetic', messages });
        assert.deepEqual(request.body.messages, messages);
        assert.equal(request.messageCompatibility, MESSAGE_COMPATIBILITY.NATIVE);
    }
});

test('严格后处理将系统尾留在原处转 user，真正的助手尾原样保留', () => {
    const messages = [
        { role: 'system', content: '开头系统' },
        { role: 'user', content: '本轮任务' },
        { role: 'assistant', content: '助手预设' },
        { role: 'system', content: '尾部系统' },
    ];
    const options = { url: 'https://example.invalid/v1', protocol: 'openai', model: 'synthetic', postProcessing: 'strict' };
    const request = buildApiRequest({ ...options, messages });
    assert.deepEqual(request.body.messages, messages.map((m,i) => ({ ...m, role: i === 3 ? 'user' : m.role })));
    const withPrefill = buildApiRequest({ ...options, messages: [...messages, { role: 'assistant', content: '有意保留的预填' }] });
    assert.deepEqual(withPrefill.body.messages.at(-1), { role: 'assistant', content: '有意保留的预填' });
});

test('Anthropic 严格模式仅开头 system 进入顶层，系统尾内容留在对话末尾', () => {
    const request = buildApiRequest({ url: 'https://example.invalid/v1', protocol: 'anthropic', key: 'synthetic', model: 'synthetic', postProcessing: 'strict', messages: [
        { role: 'system', content: '开头系统' }, { role: 'user', content: '本轮任务' },
        { role: 'assistant', content: '助手预设' }, { role: 'system', content: '尾部系统' },
    ] });
    assert.equal(request.messageCompatibility, MESSAGE_COMPATIBILITY.ANTHROPIC_TOP_LEVEL_SYSTEM);
    assert.equal(request.body.system, '开头系统');
    assert.deepEqual(request.body.messages.map(m => m.role), ['user', 'assistant', 'user']);
    assert.equal(request.body.messages.at(-1).content, '尾部系统');
});

test('OpenAI 兼容线路识别独立思考字段和思考 Token', () => {
    assert.equal(hasReasoningContent({ choices: [{ message: { reasoning_content: '内部思考' } }] }), true);
    assert.equal(hasReasoningContent({ usage: { completion_tokens_details: { reasoning_tokens: 1024 } } }), true);
    assert.equal(hasReasoningContent({ candidates: [{ content: { parts: [{ thought: true, text: '摘要' }] } }] }), true);
    assert.equal(hasReasoningContent({ choices: [{ message: { content: '只有正文' } }] }), false);
});

test('流式解析能取出状态为 200 的错误事件，而不是只报告空流', () => {
    assert.equal(extractApiErrorMessage({ error: { message: 'upstream overloaded' } }), 'upstream overloaded');
    assert.equal(extractApiErrorMessage({ type: 'error', message: 'model unavailable' }), 'model unavailable');
    assert.equal(extractApiErrorMessage({ choices: [] }), '');
});

test('内容策略结束原因会被统一识别，不把用户指令直接定性为 NSFW', () => {
    assert.equal(contentBlockReason('content_filter'), 'content_filter');
    assert.equal(contentBlockReason('SAFETY'), 'safety');
    assert.equal(isContentBlockedStopReason('PROHIBITED_CONTENT'), true);
    assert.equal(isContentBlockedStopReason('length'), false);

    const openAi = extractResponseMeta({ choices: [{ finish_reason: 'content_filter' }] }, API_PROTOCOLS.OPENAI);
    const gemini = extractResponseMeta({ candidates: [{ finishReason: 'SAFETY' }] }, API_PROTOCOLS.OPENAI);
    const promptBlocked = extractResponseMeta({ promptFeedback: { blockReason: 'BLOCKLIST' } }, API_PROTOCOLS.OPENAI);
    assert.equal(openAi.stopReason, 'blocked');
    assert.equal(openAi.blockReason, 'content_filter');
    assert.equal(gemini.blockReason, 'safety');
    assert.equal(promptBlocked.blockReason, 'blocklist');
});

test('429 限流识别支持 Retry-After 秒数、日期和常见错误文字', () => {
    assert.equal(retryAfterMilliseconds('2.5', 0), 2500);
    assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:08 GMT', 5000), 3000);
    assert.equal(retryAfterMilliseconds('invalid', 0), null);
    assert.equal(isRateLimitErrorMessage('429 Too Many Requests'), true);
    assert.equal(isRateLimitErrorMessage('RESOURCE_EXHAUSTED: quota exceeded'), true);
    assert.equal(isRateLimitErrorMessage('普通参数错误'), false);
});

test('酒馆主 API 在请求日志和实际请求前都能解析出模型名', () => {
    assert.equal(resolveMainApiModel({ getChatCompletionModel: () => 'main-model' }, { model: 'fallback' }), 'main-model');
    assert.equal(resolveMainApiModel({}, { openai_model: 'openai-model' }), 'openai-model');
    assert.equal(resolveMainApiModel({}, { model: 'legacy-model' }), 'legacy-model');
    assert.equal(resolveMainApiModel({}, {}), '');
});

test('OpenAI 请求使用 chat completions 与 Bearer', () => {
    const req = buildApiRequest({ url: 'https://example.com/v1', protocol: API_PROTOCOLS.OPENAI, key: 'secret', model: 'm', systemPrompt: 's', userPrompt: 'u' });
    assert.equal(req.endpoint, 'https://example.com/v1/chat/completions');
    assert.equal(req.headers.Authorization, 'Bearer secret');
    assert.equal(req.body.messages[0].role, 'system');
    assert.equal('tools' in req.body, false);
    assert.equal('tool_choice' in req.body, false);
});

test('单轮输出默认 32768，低上限模型按标准档位回落', () => {
    assert.equal(DEFAULT_MAX_OUTPUT_TOKENS, 32768);
    assert.equal(normalizeMaxTokens(undefined), 32768);
    assert.deepEqual(maxTokenFallbackSequence(32768), [32768, 16384, 8192, 4096, 2048, 1024, 512, 256]);
    assert.deepEqual(maxTokenFallbackSequence(65536), [65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256]);
    assert.deepEqual(maxTokenFallbackSequence(16384), [16384, 8192, 4096, 2048, 1024, 512, 256]);
    assert.equal(isMaxTokenLimitError(400, 'max_tokens must be less than or equal to 8192'), true);
    assert.equal(isMaxTokenLimitError(400, 'status_code=400,上下文窗口已满。减少对话历史记录、系统提示或工具'), false);
    assert.equal(isMaxTokenLimitError(401, 'invalid api key'), false);
});

test('Anthropic 请求使用 messages 与 x-api-key', () => {
    const req = buildApiRequest({ url: 'https://example.com', protocol: API_PROTOCOLS.ANTHROPIC, key: 'secret', model: 'm', systemPrompt: 's', userPrompt: 'u' });
    assert.equal(req.endpoint, 'https://example.com/v1/messages');
    assert.equal(req.headers['x-api-key'], 'secret');
    assert.equal(req.body.system, 's');
    assert.equal('tools' in req.body, false);
    assert.equal('tool_choice' in req.body, false);
});

test('两种协议都能解析长度停止原因', () => {
    assert.equal(extractResponseMeta({ choices: [{ finish_reason: 'length' }] }, API_PROTOCOLS.OPENAI).stopReason, 'length');
    assert.equal(extractResponseMeta({ stop_reason: 'max_tokens' }, API_PROTOCOLS.ANTHROPIC).stopReason, 'length');
    assert.equal(extractResponseMeta({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, API_PROTOCOLS.OPENAI).stopReason, 'length');
});

test('HTML 网关错误页不会被当作模型正文', () => {
    assert.equal(isHtmlErrorResponse('text/html; charset=UTF-8', 'Cloudflare error'), true);
    assert.equal(isHtmlErrorResponse('text/plain', '<!DOCTYPE html><html><body>524</body></html>'), true);
    assert.equal(isHtmlErrorResponse('text/plain', '<article>合法的小剧场片段</article>'), false);
});
