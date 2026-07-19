import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokenBreakdown } from '../token-estimator.js';
import { buildContinuationInstruction, buildContinuationPayload, buildFinalRenderPayload, buildGenerationPayload } from '../generation-payload.js';
import { API_PROTOCOLS, DEFAULT_MAX_OUTPUT_TOKENS, buildApiRequest, extractResponseMeta, isHtmlErrorResponse, isMaxTokenLimitError, maxTokenFallbackSequence, normalizeMaxTokens, resolveMainApiModel } from '../api-client.js';
import { abortGenerationJob, addGenerationSegment, authorizeFinish, createGenerationJob, shouldAuthorizeFinishRound, shouldContinueJob, targetCompletionChars } from '../generation-job.js';
import { readableCharCount } from '../text-counter.js';
import { injectResizeReporter, sandboxPermissions } from '../safe-renderer.js';
import { createRequestMetrics, markCompleted, markFallback, markFirstToken, summarizeMetrics } from '../request-metrics.js';
import { MAX_RUNTIME_LOGS, clearRuntimeLogs, formatRuntimeLogs, getRuntimeLogEntries, setRuntimeLogSecretProvider, writeRuntimeLog } from '../runtime-log.js';
import { apiPresetSecretValues, createApiPresetFromConfig, normalizeApiPresetList } from '../api-presets.js';
import { splitInstructionTextFile } from '../instruction-import.js';
import { LENGTH_TIERS, classifyLengthTier, firstRoundGuidance, parseTargetWordCount, resolveTargetWordCount, stripTargetWordCountRequirement } from '../length-policy.js';
import { AUTO_CONTINUE_SCHEMA, migrateAutoContinueDefault } from '../settings-migration.js';
import { createInstructionBackup, parseInstructionBackup } from '../instruction-backup.js';
import { WORLD_BOOK_STRATEGIES, shouldReadWorldBookEntry, worldBookEntryStrategy } from '../world-book-policy.js';
import { scanWorldBookEntriesWithSillyTavern } from '../world-book-runtime.js';
import { MAX_CONTEXT_MESSAGES, normalizeContextRange, takeRecentMessages } from '../context-policy.js';

test('聊天前文楼层数支持 0、任意正整数并限制异常值', () => {
    assert.equal(MAX_CONTEXT_MESSAGES, 500);
    assert.equal(normalizeContextRange(0), 0);
    assert.equal(normalizeContextRange('5'), 5);
    assert.equal(normalizeContextRange(10.9), 10);
    assert.equal(normalizeContextRange(-4), 0);
    assert.equal(normalizeContextRange(MAX_CONTEXT_MESSAGES + 50), MAX_CONTEXT_MESSAGES);
    assert.equal(normalizeContextRange('not-a-number'), 10);
});

test('酒馆主 API 在请求日志和实际请求前都能解析出模型名', () => {
    assert.equal(resolveMainApiModel({ getChatCompletionModel: () => 'main-model' }, { model: 'fallback' }), 'main-model');
    assert.equal(resolveMainApiModel({}, { openai_model: 'openai-model' }), 'openai-model');
    assert.equal(resolveMainApiModel({}, { model: 'legacy-model' }), 'legacy-model');
    assert.equal(resolveMainApiModel({}, {}), '');
});

test('聊天前文设为 0 时不读取任何消息，而不是误读全部消息', () => {
    const messages = Array.from({ length: 12 }, (_, index) => `第${index + 1}条`);
    assert.deepEqual(takeRecentMessages(messages, 0), []);
    assert.deepEqual(takeRecentMessages(messages, 5), messages.slice(-5));
    assert.deepEqual(takeRecentMessages(messages, 10), messages.slice(-10));
});

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

test('API 预设保存地址、协议、Key、模型和输出上限', () => {
    const preset = createApiPresetFromConfig('备用线路', {
        apiUrl: 'https://api.example.com/v1///',
        apiKey: 'secret-key',
        apiModel: 'model-name',
        apiProtocol: 'anthropic',
        maxOutputTokens: 8192,
    }, 'preset-1');
    assert.deepEqual(preset, {
        id: 'preset-1', name: '备用线路', apiUrl: 'https://api.example.com/v1', apiKey: 'secret-key',
        apiModel: 'model-name', apiProtocol: 'anthropic', maxOutputTokens: 8192,
    });
});

test('API 预设会过滤空名称和重复名称，并提供全部 Key 给日志脱敏', () => {
    const presets = normalizeApiPresetList([
        { id: 'one', name: '主线路', apiKey: 'key-one' },
        { id: 'two', name: '主线路', apiKey: 'duplicate' },
        { id: 'three', name: '', apiKey: 'empty-name' },
        { id: 'four', name: '备用线路', apiKey: 'key-two' },
    ]);
    assert.deepEqual(presets.map(item => item.name), ['主线路', '备用线路']);
    assert.deepEqual(apiPresetSecretValues(presets), ['key-one', 'key-two']);
});

test('未启用的 API 预设 Key 也不会进入可复制日志', () => {
    clearRuntimeLogs();
    const presets = normalizeApiPresetList([{ id: 'backup', name: '备用', apiKey: 'inactive-secret-key' }]);
    setRuntimeLogSecretProvider(() => ['current-secret-key', ...apiPresetSecretValues(presets)]);
    writeRuntimeLog('error', '请求失败', { current: 'current-secret-key', backup: 'inactive-secret-key' });
    const output = formatRuntimeLogs();
    assert.doesNotMatch(output, /current-secret-key|inactive-secret-key/);
    assert.match(output, /\[REDACTED\]/);
    clearRuntimeLogs();
});

test('TXT 指令导入兼容 Windows、Unix 和旧式换行', () => {
    assert.deepEqual(splitInstructionTextFile('第一条\r\n---\r\n第二条'), ['第一条', '第二条']);
    assert.deepEqual(splitInstructionTextFile('第一条\n --- \n第二条'), ['第一条', '第二条']);
    assert.deepEqual(splitInstructionTextFile('第一条\r---\r第二条'), ['第一条', '第二条']);
});

test('TXT 指令导入只把独立一行的三横线视为分隔符', () => {
    assert.deepEqual(splitInstructionTextFile('正文里的---不是分隔符\r\n下一行'), ['正文里的---不是分隔符\n下一行']);
});

test('指令备份跨设备导入时保留分组与空文件夹', () => {
    const exported = createInstructionBackup(['甜文', '空文件夹'], [
        { name: '雨夜', content: '写雨夜重逢', group: '甜文' },
        { name: '散装', content: '写一顿晚饭' },
    ]);
    const restored = parseInstructionBackup(JSON.parse(JSON.stringify(exported)));
    assert.deepEqual(restored.groups, ['甜文', '空文件夹']);
    assert.equal(restored.templates[0].group, '甜文');
    assert.equal(restored.templates[1].group, undefined);
});

test('世界书读取并区分酒馆蓝灯、绿灯与链式策略', () => {
    assert.equal(worldBookEntryStrategy({ constant: true }), WORLD_BOOK_STRATEGIES.BLUE);
    assert.equal(worldBookEntryStrategy({ constant: false }), WORLD_BOOK_STRATEGIES.GREEN);
    assert.equal(worldBookEntryStrategy({ vectorized: true }), WORLD_BOOK_STRATEGIES.CHAIN);
    assert.equal(shouldReadWorldBookEntry({ constant: true }, 'lights'), true);
    assert.equal(shouldReadWorldBookEntry({ constant: false }, 'lights'), true);
    assert.equal(shouldReadWorldBookEntry({ vectorized: true }, 'lights'), false);
    assert.equal(shouldReadWorldBookEntry({ constant: true, disable: true }, 'lights'), false);
});

test('小剧场把勾选条目交给酒馆扫描，并只接回本轮触发结果', async () => {
    let listener;
    let removed = false;
    const eventSource = {
        on(_event, callback) { listener = callback; },
        removeListener(_event, callback) { removed = callback === listener; listener = null; },
    };
    const entries = [
        { uid: 1, world: '测试书', constant: true, content: '蓝灯内容' },
        { uid: 2, world: '测试书', constant: false, key: ['月亮'], content: '命中绿灯' },
        { uid: 3, world: '测试书', constant: false, key: ['太阳'], content: '未命中绿灯' },
    ];
    const activated = await scanWorldBookEntriesWithSillyTavern({
        entries,
        chat: ['User: 今晚一起看月亮'],
        maxContext: 8192,
        globalScanData: { trigger: 'quiet' },
        eventSource,
        eventType: 'worldinfo_entries_loaded',
        checkWorldInfo: async chat => {
            const payload = { globalLore: [{ uid: 99 }], characterLore: [{ uid: 98 }], chatLore: [], personaLore: [] };
            await listener(payload);
            assert.deepEqual(payload.globalLore.map(entry => entry.uid), [1, 2, 3]);
            assert.deepEqual(payload.characterLore, []);
            const scanText = chat.join('\n');
            const matches = payload.globalLore.filter(entry => entry.constant || entry.key?.some(key => scanText.includes(key)));
            return { allActivatedEntries: new Set(matches) };
        },
    });
    assert.deepEqual(activated.map(entry => entry.content), ['蓝灯内容', '命中绿灯']);
    assert.equal(removed, true);
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

test('自动续写达到目标的 90% 后停止', () => {
    const job = createGenerationJob({ targetChars: 100, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(50), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    addGenerationSegment(job, '字'.repeat(39), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    addGenerationSegment(job, '字', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.actualChars, 90);
    assert.equal(targetCompletionChars(100), 90);
});

test('续写提示不携带总字数、原始指令或 HTML 结构', () => {
    const prompt = buildContinuationInstruction({
        round: 2, tail: '上一段结尾原文', finishThisRound: true,
    });
    const payload = buildContinuationPayload({ instruction: prompt });
    assert.match(payload.userPrompt, /上一段结尾原文/);
    assert.match(payload.userPrompt, /只输出新增正文片段/);
    assert.match(payload.userPrompt, /可以.*自然收束结局/);
    assert.doesNotMatch(payload.userPrompt, /5000|目标总字数|原始要求/);
    assert.doesNotMatch(payload.userPrompt, /输出完整 HTML/);
});

test('四档分诊边界与轻量首轮引导符合定稿', () => {
    assert.equal(classifyLengthTier(null), LENGTH_TIERS.UNSPECIFIED);
    assert.equal(classifyLengthTier(3000), LENGTH_TIERS.SHORT);
    assert.equal(classifyLengthTier(3001), LENGTH_TIERS.COMFORT);
    assert.equal(classifyLengthTier(5000), LENGTH_TIERS.COMFORT);
    assert.equal(classifyLengthTier(5001), LENGTH_TIERS.LONG);
    assert.match(firstRoundGuidance(2000), /精悍的短篇/);
    assert.doesNotMatch(firstRoundGuidance(2000), /充分展开剧情/);
    assert.match(firstRoundGuidance(8000), /充分展开剧情，不急于收尾/);
    assert.doesNotMatch(firstRoundGuidance(8000), /8000|必须|写满/);
});

test('明确字数会被程序解析，但不会进入发给首轮模型的指令', () => {
    for (const source of ['写一个8000字的小剧场', '正文至少八千字，写雨夜重逢', '篇幅5000字左右；围绕误会展开']) {
        assert.ok(parseTargetWordCount(source) >= 5000);
        const cleaned = stripTargetWordCountRequirement(source);
        assert.doesNotMatch(cleaned, /8000|5000|八千|字左右|至少.*字/);
    }
    assert.equal(stripTargetWordCountRequirement('写一个8000字的小剧场'), '写一个小剧场');
});

test('独立目标字数默认不接管，开启后覆盖指令中的目标', () => {
    assert.equal(resolveTargetWordCount('写5000字'), 5000);
    assert.equal(resolveTargetWordCount('写5000字', { manualEnabled: true, manualTarget: 8000 }), 8000);
    assert.equal(resolveTargetWordCount('没有字数要求', { manualEnabled: true, manualTarget: 2000 }), 2000);
});

test('旧用户升级时默认开启目标字数自动补写，迁移只执行一次', () => {
    const settings = { autoContinue: false };
    assert.equal(migrateAutoContinueDefault(settings), true);
    assert.equal(settings.autoContinue, true);
    assert.equal(settings.autoContinueSchema, AUTO_CONTINUE_SCHEMA);
    settings.autoContinue = false;
    assert.equal(migrateAutoContinueDefault(settings), false);
    assert.equal(settings.autoContinue, false);
});

test('动态收束轮正常完成但不足 90% 时直接结束，不再请求', () => {
    const job = createGenerationJob({ targetChars: 1000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(500), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(shouldAuthorizeFinishRound(job, readableCharCount), true);
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '字'.repeat(300), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.actualChars, 800);
    assert.equal(job.completedBelowTarget, true);
    assert.equal(job.round, 2);
});

test('动态收束轮若被 Token 截断，仍可在轮数范围内继续', () => {
    const job = createGenerationJob({ targetChars: 1000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(500), 'stop');
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '字'.repeat(300), 'length');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(job.completedBelowTarget, false);
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
