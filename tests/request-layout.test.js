// 从 core.test.js 拆出：request-layout
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation } from './theater-source.js';
import { buildGenerationPayload } from '../generation-payload.js';
import { API_PROTOCOLS } from '../api-client.js';
import { requestCustomApi } from '../api-runtime.js';
import { PROMPT_POST_PROCESSING, WORLD_INFO_POSITION, applyPromptPostProcessing, composePresetMessages, normalizeRequestMessages, normalizeWorldInfoEntry, squashAdjacentSystemMessages } from '../request-layout.js';
import { createRequestTrace, formatRequestTrace } from '../request-trace.js';

test('用户本轮指令位于前情之后、最终规则之前', () => {
    const payload = buildGenerationPayload({
        preset: '系统预设',
        context: '聊天前情',
        continuation: '续写前情',
        instruction: '用户本轮指令',
        rules: '渲染规则',
        fixed: '最终创作约束',
    });
    assert.equal(payload.systemPrompt, '系统预设');
    assert.ok(payload.userPrompt.indexOf('续写前情') < payload.userPrompt.indexOf('用户本轮指令'));
    assert.ok(payload.userPrompt.indexOf('用户本轮指令') < payload.userPrompt.indexOf('渲染规则'));
    assert.ok(payload.userPrompt.indexOf('渲染规则') < payload.userPrompt.indexOf('最终创作约束'));
});

test('预设 prompt_order 的多角色顺序与动态锚点保持结构，不再压成 system/user 两段', () => {
    const messages = composePresetMessages({
        presetEntries: [
            { id: 'main', role: 'system', content: 'SYS-MAIN' },
            { id: 'personaDescription', role: 'system', content: '' },
            { id: 'custom-user', role: 'user', content: 'USR-CUSTOM' },
            { id: 'chatHistory', role: 'system', content: '' },
            { id: 'post', role: 'assistant', content: 'AST-POST' },
        ],
        slots: { personaDescription: 'PERSONA-SLOT' },
        chatMessages: [
            { role: 'user', content: 'CHAT-USER' },
            { role: 'assistant', content: 'CHAT-AST' },
        ],
        tailMessages: [{ role: 'user', content: 'CURRENT-INSTRUCTION', source: 'theater' }],
    });
    assert.deepEqual(messages.map(message => message.role), [
        'system', 'system', 'user', 'user', 'assistant', 'assistant', 'user',
    ]);
    assert.deepEqual(messages.map(message => message.content), [
        'SYS-MAIN', 'PERSONA-SLOT', 'USR-CUSTOM', 'CHAT-USER', 'CHAT-AST', 'AST-POST', 'CURRENT-INSTRUCTION',
    ]);
});

test('插件直接读取酒馆预设角色与绝对深度，并只压合相邻 system 段', () => {
    const messages = composePresetMessages({
        presetEntries: [
            { id: 'sys-a', role: 'system', content: 'SYSTEM-A', injectionPosition: 0 },
            { id: 'sys-b', role: 'system', content: 'SYSTEM-B', injectionPosition: 0 },
            { id: 'assistant-break', role: 'assistant', content: 'ASSISTANT-BREAK', injectionPosition: 0 },
            { id: 'sys-c', role: 'system', content: 'SYSTEM-C', injectionPosition: 0 },
            { id: 'depth-user', role: 'user', content: 'DEPTH-USER', injectionPosition: 1, injectionDepth: 1, injectionOrder: 80 },
            { id: 'chatHistory', role: 'system', content: '' },
        ],
        chatMessages: [
            { role: 'user', content: 'CHAT-OLD' },
            { role: 'assistant', content: 'CHAT-LATEST' },
        ],
        squashSystemMessages: true,
    });
    assert.deepEqual(messages.map(message => message.role), [
        'system', 'assistant', 'system', 'user', 'user', 'assistant',
    ]);
    assert.equal(messages[0].content, 'SYSTEM-A\n\nSYSTEM-B');
    assert.equal(messages[1].content, 'ASSISTANT-BREAK');
    assert.equal(messages[4].content, 'DEPTH-USER');
    assert.equal(messages.filter(message => message.content === 'DEPTH-USER').length, 1);
    assert.deepEqual(
        squashAdjacentSystemMessages([
            { role: 'system', content: '一' },
            { role: 'system', content: '二' },
            { role: 'assistant', content: '断开' },
            { role: 'system', content: '三' },
        ]).map(message => message.content),
        ['一\n\n二', '断开', '三'],
    );
});

test('世界书深度原样读取，不被插件自行限制为固定档位', () => {
    assert.equal(normalizeWorldInfoEntry({ content: '深层条目', position: 4, depth: 0 }).depth, 0);
    assert.equal(normalizeWorldInfoEntry({ content: '深层条目', position: 4, depth: 100 }).depth, 100);
    assert.equal(normalizeWorldInfoEntry({ content: '深层条目', position: 4, depth: 1000 }).depth, 1000);
});

test('世界书八种位置、同深度顺序和 outlet 宏按酒馆语义进入消息布局', () => {
    const wi = [
        { uid: 1, position: WORLD_INFO_POSITION.BEFORE_CHARACTER, order: 20, content: 'WB-BEFORE' },
        { uid: 2, position: WORLD_INFO_POSITION.AFTER_CHARACTER, order: 20, content: 'WB-AFTER' },
        { uid: 3, position: WORLD_INFO_POSITION.AUTHOR_NOTE_TOP, order: 20, content: 'AN-TOP' },
        { uid: 4, position: WORLD_INFO_POSITION.AUTHOR_NOTE_BOTTOM, order: 20, content: 'AN-BOTTOM' },
        { uid: 5, position: WORLD_INFO_POSITION.EXAMPLES_TOP, order: 20, content: 'EXAMPLE-TOP' },
        { uid: 6, position: WORLD_INFO_POSITION.EXAMPLES_BOTTOM, order: 20, content: 'EXAMPLE-BOTTOM' },
        { uid: 7, position: WORLD_INFO_POSITION.AT_DEPTH, depth: 1, order: 10, role: 1, content: 'DEPTH-FIRST' },
        { uid: 8, position: WORLD_INFO_POSITION.AT_DEPTH, depth: 1, order: 30, role: 2, content: 'DEPTH-SECOND' },
        { uid: 9, position: WORLD_INFO_POSITION.OUTLET, outletName: 'Lore', order: 20, content: 'OUTLET-ONLY-HERE' },
    ];
    const messages = composePresetMessages({
        presetEntries: [
            { id: 'worldInfoBefore', role: 'system', content: '' },
            { id: 'charDescription', role: 'system', content: '' },
            { id: 'worldInfoAfter', role: 'system', content: '' },
            { id: 'dialogueExamples', role: 'system', content: '' },
            { id: 'outlet-holder', role: 'system', content: '宏：{{outlet::Lore}}' },
            { id: 'chatHistory', role: 'system', content: '' },
        ],
        slots: { charDescription: 'CHAR', dialogueExamples: 'EXAMPLES' },
        worldInfoEntries: wi,
        chatMessages: [
            { role: 'user', content: 'CHAT-1' },
            { role: 'assistant', content: 'CHAT-2' },
        ],
    });
    const content = messages.map(message => message.content);
    assert.deepEqual(content, [
        'WB-BEFORE', 'CHAR', 'WB-AFTER', 'EXAMPLE-TOP\n\nEXAMPLES\n\nEXAMPLE-BOTTOM',
        '宏：OUTLET-ONLY-HERE', 'AN-TOP\nAN-BOTTOM', 'CHAT-1', 'DEPTH-SECOND', 'DEPTH-FIRST', 'CHAT-2',
    ]);
    assert.equal(content.filter(text => text.includes('OUTLET-ONLY-HERE')).length, 1);
    assert.equal(messages[7].role, 'assistant');
    assert.equal(messages[8].role, 'user');
});

test('请求后处理始终转换为 no-tools 变体，并清除 tool/function 消息与工具字段', () => {
    const source = [
        { role: 'system', content: '系统' },
        { role: 'assistant', content: '助手先说', tool_calls: [{ id: '不应保留' }] },
        { role: 'tool', content: '工具结果' },
        { role: 'user', content: '用户', tool_call_id: '不应保留' },
    ];
    const strict = applyPromptPostProcessing(source, PROMPT_POST_PROCESSING.STRICT_TOOLS);
    assert.deepEqual(strict.map(message => message.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(strict.some(message => message.content === '工具结果'), false);
    assert.equal(strict.every(message => !('tool_calls' in message) && !('tool_call_id' in message)), true);
    assert.deepEqual(normalizeRequestMessages(source).map(message => message.role), ['system', 'assistant', 'user']);
});

test('创作请求结构来自传输层输入且不包含正文、Key、Authorization 或接口 URL', async () => {
    let traceInput;
    let wireBody;
    await requestCustomApi({
        config: {
            apiUrl: 'https://secret-host.example/v1', apiProtocol: API_PROTOCOLS.OPENAI,
            apiKey: 'sk-super-secret-value', apiModel: 'trace-model', maxOutputTokens: 1024,
        },
        messages: [
            { role: 'system', content: '系统', source: 'preset', sourceId: 'main' },
            { role: 'user', content: '用户', source: 'theater', sourceId: 'instruction' },
        ],
        shouldStream: false,
        onRequest: input => { traceInput = input; },
        fetchImpl: async (_url, options) => {
            wireBody = JSON.parse(options.body);
            return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.deepEqual(traceInput.messages.map(({ role, content }) => ({ role, content })), wireBody.messages);
    const report = formatRequestTrace(createRequestTrace(traceInput));
    assert.doesNotMatch(report, /sk-super-secret|secret-host\.example|Authorization/i);
    assert.match(report, /工具：已强制禁用/);
    assert.match(report, /预设采样参数：未继承（使用线路默认值）/);
    assert.match(report, /消息兼容：原始消息结构/);
    assert.match(formatRequestTrace(createRequestTrace({ route: 'main' })), /预设采样参数：由酒馆主 API 决定/);
    assert.match(formatRequestTrace(createRequestTrace({ route: 'main' })), /消息兼容：由酒馆主 API 决定/);
    assert.doesNotMatch(report, /系统|用户|request\/system|request\/user/);
    assert.match(report, /system · preset\/main · 2 字符 · 约 3 token/);
    assert.match(report, /user · theater\/instruction · 2 字符 · 约 3 token/);

    const compatibilityReport = formatRequestTrace(createRequestTrace({
        route: 'custom',
        messageCompatibility: 'openai-system-first',
        messages: [{
            role: 'system', content: '折叠后的系统资料', source: 'openai-compat',
            sourceId: 'system-fold', foldedMessageCount: 4,
        }],
    }));
    assert.match(compatibilityReport, /消息兼容：旧版 system 前置/);
    assert.match(compatibilityReport, /合并 4 条/);
    assert.doesNotMatch(compatibilityReport, /折叠后的系统资料/);
});

test('诊断界面只展示创作请求结构，不渲染或复制真实消息正文', () => {
    const source = readTheaterImplementation();
    assert.match(source, /查看创作请求结构/);
    assert.match(source, /tracePurpose: round === 1 \? 'creative' : 'continuation'/);
    assert.match(source, /if \(purpose !== 'creative'\) return/);
    assert.doesNotMatch(source.match(/function (?:runtime\.)?runDiagnostics\(\)[\s\S]*?\n\}/)?.[0] || '', /message\.content|<pre>/);
});
