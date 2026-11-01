import test from 'node:test';
import assert from 'node:assert/strict';
import { composePresetMessages, dialogueExampleMessages } from '../request-layout.js';
import { requestMainApi, requestCustomApi } from '../api-runtime.js';
import { API_PROTOCOLS } from '../api-client.js';

const names = { user: '旅人甲', char: '向导乙' };
const examples = '<START>\n{{user}}: 你好。\n{{char}}: 欢迎回来。\n请跟我来。';
const messages = squash => composePresetMessages({
    presetEntries: [{ id: 'main', role: 'system', content: '合成预设' }, { id: 'dialogueExamples', role: 'system', content: '' }, { id: 'chatHistory', role: 'system', content: '' }],
    slots: { dialogueExamples: examples }, layoutContext: { names }, squashSystemMessages: squash,
    taskMessages: [{ role: 'user', content: '合成本次任务' }],
});
const assertSpeakers = text => {
    assert.ok(text.includes('旅人甲: 你好。'), text);
    assert.ok(text.includes('向导乙: 欢迎回来。\n请跟我来。'), text);
    assert.ok(text.indexOf('旅人甲: 你好。') < text.indexOf('向导乙: 欢迎回来。'));
};

test('example names remain as metadata while original speaker labels and multiline text stay in content', () => {
    const raw = '<START>\n旅人甲: 你好。\n向导乙: 欢迎回来。\n请跟我来。';
    const parsed = dialogueExampleMessages(raw, names);
    assert.deepEqual(parsed.map(m => [m.role, m.name || '']), [['system', ''], ['system', 'example_user'], ['system', 'example_assistant']]);
    assertSpeakers(parsed.map(m => m.content).join('\n'));
    const narration = '<START>\n纯叙述示例，不含说话人前缀。';
    assert.equal(dialogueExampleMessages(narration, names)[0].content, '纯叙述示例，不含说话人前缀。');
    assert.equal(raw, '<START>\n旅人甲: 你好。\n向导乙: 欢迎回来。\n请跟我来。');
});

for (const protocol of [API_PROTOCOLS.OPENAI, API_PROTOCOLS.ANTHROPIC]) test(`${protocol}: actual fetch body preserves speakers with native, merged and deferred-system layouts`, async () => {
    for (const squash of [false, true]) for (const deferredSystem of [false, true]) for (const postProcessing of ['', 'merge', 'strict']) {
        const assembled = messages(squash), before = JSON.stringify(assembled); let body, calls = 0;
        const outgoing = deferredSystem ? [{ role: 'user', content: '更早聊天' }, ...assembled] : assembled;
        await requestCustomApi({ config: { apiUrl: 'https://example.invalid', apiProtocol: protocol, apiModel: 'synthetic', apiKey: 'synthetic-test-only' },
            messages: outgoing, postProcessing, shouldStream: false, fetchImpl: async (_url, options) => {
                calls++; body = JSON.parse(options.body);
                return new Response(JSON.stringify(protocol === API_PROTOCOLS.ANTHROPIC
                    ? { content: [{ type: 'text', text: '合成回复' }], stop_reason: 'end_turn' }
                    : { choices: [{ message: { content: '合成回复' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
            } });
        assert.equal(calls, 1); assertSpeakers([body.system || '', ...body.messages.map(m => m.content)].join('\n'));
        assert.equal(JSON.stringify(assembled), before); assert.equal(body.messages.at(-1).content.includes('合成本次任务'), true);
    }
});

test('actual CCS request retains example speakers without changing role/order, stopping or token settings', async () => {
    for (const postProcessing of ['', 'merge', 'strict']) {
        let body; const ctx = { oai_settings: { chat_completion_source: 'custom', custom_model: 'synthetic', openai_max_tokens: 8192 } };
        await requestMainApi({ ctx, getContext: () => ctx, messages: messages(false), postProcessing, shouldStream: false,
            chatCompletionService: { processRequest: async b => { body = b; return { text: '合成回复' }; } } });
        assertSpeakers(body.messages.map(m => m.content).join('\n')); assert.equal(body.max_tokens, 8192);
        assert.equal(body.messages.at(-1).role, 'user'); assert.equal(body.messages.at(-1).content.includes('合成本次任务'), true);
        assert.ok(body.messages.filter(m => /旅人甲:|向导乙:/.test(m.content)).every(m => m.role === 'system'));
    }
});

test('native Helper ordered prompts retain metadata and text labels, with no injected host generation settings', async () => {
    let sent;
    await requestMainApi({ ctx: {}, getContext: () => ({}), messages: messages(false), shouldStream: false,
        tavernHelper: { generateRaw: async options => { sent = options; return '合成回复'; } } });
    assertSpeakers(sent.ordered_prompts.map(m => m.content).join('\n'));
    assert.ok(sent.ordered_prompts.some(m => m.name === 'example_user'));
    assert.ok(sent.ordered_prompts.some(m => m.name === 'example_assistant'));
    assert.equal('max_tokens' in sent, false); assert.equal('temperature' in sent, false);
});
