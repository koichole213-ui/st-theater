import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokenBreakdown } from '../token-estimator.js';
import { buildContinuationInstruction, buildFinalRenderPayload, buildGenerationPayload } from '../generation-payload.js';
import { API_PROTOCOLS, DEFAULT_MAX_OUTPUT_TOKENS, buildApiRequest, extractResponseMeta, isHtmlErrorResponse, isMaxTokenLimitError, maxTokenFallbackSequence, normalizeMaxTokens } from '../api-client.js';
import { abortGenerationJob, addGenerationSegment, createGenerationJob, shouldContinueJob } from '../generation-job.js';
import { readableCharCount } from '../text-counter.js';
import { injectResizeReporter, sandboxPermissions } from '../safe-renderer.js';
import { createRequestMetrics, markCompleted, markFallback, markFirstToken, summarizeMetrics } from '../request-metrics.js';
import { MAX_RUNTIME_LOGS, clearRuntimeLogs, formatRuntimeLogs, getRuntimeLogEntries, setRuntimeLogSecretProvider, writeRuntimeLog } from '../runtime-log.js';

test('Token 分类相加等于总数', () => {
    const result = estimateTokenBreakdown({ preset: '预设内容', context: '聊天上下文', instruction: '写一段故事' });
    assert.equal(result.total, result.preset + result.context + result.instruction);
});

test('关闭上下文后的 payload 不包含聊天内容', () => {
    const payload = buildGenerationPayload({ preset: '系统预设', context: '', instruction: '用户指令' });
    assert.equal(payload.userPrompt.includes('聊天秘密'), false);
    assert.equal(payload.userPrompt.includes('用户指令'), true);
});

test('OpenAI 请求使用 chat completions 与 Bearer', () => {
    const req = buildApiRequest({ url: 'https://example.com/v1', protocol: API_PROTOCOLS.OPENAI, key: 'secret', model: 'm', systemPrompt: 's', userPrompt: 'u' });
    assert.equal(req.endpoint, 'https://example.com/v1/chat/completions');
    assert.equal(req.headers.Authorization, 'Bearer secret');
    assert.equal(req.body.messages[0].role, 'system');
});

test('单轮输出默认 16384，低上限模型按标准档位回落', () => {
    assert.equal(DEFAULT_MAX_OUTPUT_TOKENS, 16384);
    assert.equal(normalizeMaxTokens(undefined), 16384);
    assert.deepEqual(maxTokenFallbackSequence(16384), [16384, 8192, 4096, 2048, 1024, 512, 256]);
    assert.equal(isMaxTokenLimitError(400, 'max_tokens must be less than or equal to 8192'), true);
    assert.equal(isMaxTokenLimitError(401, 'invalid api key'), false);
});

test('Anthropic 请求使用 messages 与 x-api-key', () => {
    const req = buildApiRequest({ url: 'https://example.com', protocol: API_PROTOCOLS.ANTHROPIC, key: 'secret', model: 'm', systemPrompt: 's', userPrompt: 'u' });
    assert.equal(req.endpoint, 'https://example.com/v1/messages');
    assert.equal(req.headers['x-api-key'], 'secret');
    assert.equal(req.body.system, 's');
});

test('两种协议都能解析长度停止原因', () => {
    assert.equal(extractResponseMeta({ choices: [{ finish_reason: 'length' }] }, API_PROTOCOLS.OPENAI).stopReason, 'length');
    assert.equal(extractResponseMeta({ stop_reason: 'max_tokens' }, API_PROTOCOLS.ANTHROPIC).stopReason, 'length');
});

test('HTML 网关错误页不会被当作模型正文', () => {
    assert.equal(isHtmlErrorResponse('text/html; charset=UTF-8', 'Cloudflare error'), true);
    assert.equal(isHtmlErrorResponse('text/plain', '<!DOCTYPE html><html><body>524</body></html>'), true);
    assert.equal(isHtmlErrorResponse('text/plain', '<article>合法的小剧场片段</article>'), false);
});

test('自动续写必须写满目标字数后才停止', () => {
    const job = createGenerationJob({ targetChars: 100, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(50), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    addGenerationSegment(job, '字'.repeat(42), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    addGenerationSegment(job, '字'.repeat(8), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('续写提示要求补足目标后再收束', () => {
    const prompt = buildContinuationInstruction({
        originalInstruction: '写约5000字', targetChars: 5000, actualChars: 4600,
        round: 3, maxRounds: 3, tail: '上一段', finishThisRound: true,
    });
    assert.match(prompt, /距离目标还差：约 400 字/);
    assert.match(prompt, /达到或略微超过目标后再自然收束/);
});

test('多轮正文的最终 HTML 排版要求完整保留正文', () => {
    const payload = buildFinalRenderPayload({ sourceText: '第一段。\n\n第二段。', rules: '输出完整 HTML。' });
    assert.match(payload.systemPrompt, /不续写、不删减、不改写/);
    assert.match(payload.userPrompt, /第一段。\n\n第二段。/);
    assert.match(payload.userPrompt, /逐段保留全部正文/);
    assert.match(payload.userPrompt, /输出完整 HTML/);
});

test('达到最大轮数或用户停止后不再续写', () => {
    const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(1000), 'length');
    job.round = 3;
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    job.round = 1;
    abortGenerationJob(job);
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('5000 字首轮 1700 字，无论正常停止或长度停止都继续', () => {
    for (const reason of ['stop', 'length']) {
        const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
        addGenerationSegment(job, '字'.repeat(1700), reason);
        assert.equal(shouldContinueJob(job, readableCharCount), true);
    }
});

test('三轮仍不足时绝不进入第四轮', () => {
    const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    job.round = 2;
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    job.round = 3;
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.segments.length, 3);
});

test('没有目标字数时只生成一轮', () => {
    const job = createGenerationJob({ targetChars: null, maxRounds: 10, autoContinue: true });
    addGenerationSegment(job, '普通内容', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('安全 iframe 永远不开放 allow-same-origin', () => {
    assert.equal(sandboxPermissions(false), 'allow-scripts');
    assert.equal(sandboxPermissions(true), 'allow-scripts');
    assert.equal(sandboxPermissions(true).includes('allow-same-origin'), false);
});

test('安全 iframe 在 body 末尾注入尺寸与可见正文上报脚本', () => {
    const html = injectResizeReporter('<html><body><p>正文</p></body></html>');
    assert.match(html, /st-theater:height/);
    assert.match(html, /textLength/);
    assert.ok(html.indexOf('st-theater:height') < html.indexOf('</body>'));
});

test('请求诊断记录开始、首字、完成和 fallback 时间', () => {
    const metrics = createRequestMetrics('main:first');
    metrics.requestStartedAt = 1000;
    const originalNow = Date.now;
    try {
        Date.now = () => 1120;
        markFirstToken(metrics);
        Date.now = () => 1400;
        markFallback(metrics, 'main:first');
        Date.now = () => 1800;
        markCompleted(metrics);
    } finally {
        Date.now = originalNow;
    }
    const summary = summarizeMetrics(metrics);
    assert.match(summary, /首字 \+120ms/);
    assert.match(summary, /主体完成 \+800ms/);
    assert.match(summary, /fallback \+400ms/);
});

test('运行日志统一脱敏密钥、Authorization 与 URL 路径', () => {
    clearRuntimeLogs();
    const secret = 'sk-super-secret-value';
    setRuntimeLogSecretProvider(() => [secret]);
    writeRuntimeLog('info', '请求发出', {
        url: 'https://api.example.com/v1/chat/completions?debug=1',
        apiKey: secret,
        key: 'bare-key-secret',
        Authorization: 'Bearer another-secret',
        max_tokens: 16384,
    });
    writeRuntimeLog('error', `Authorization: Bearer ${secret}; x-api-key=raw-secret`);
    const output = formatRuntimeLogs();
    assert.match(output, /\[INFO\] 请求发出/);
    assert.match(output, /https:\/\/api\.example\.com/);
    assert.match(output, /max_tokens/);
    assert.doesNotMatch(output, /v1\/chat|debug=1|sk-super|another-secret|raw-secret|bare-key-secret/);
    assert.match(output, /\[REDACTED\]/);
});

test('运行日志只保留最近 200 条且不写入外部设置', () => {
    clearRuntimeLogs();
    setRuntimeLogSecretProvider(() => []);
    for (let index = 0; index < MAX_RUNTIME_LOGS + 5; index++) writeRuntimeLog('info', `entry-${index}`);
    const entries = getRuntimeLogEntries();
    assert.equal(entries.length, MAX_RUNTIME_LOGS);
    assert.equal(entries[0].message, 'entry-5');
    assert.equal(entries.at(-1).message, `entry-${MAX_RUNTIME_LOGS + 4}`);
    clearRuntimeLogs();
});
