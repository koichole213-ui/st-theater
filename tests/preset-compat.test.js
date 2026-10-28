import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolveTheaterPreset } from '../preset-compat.js';
import { filterTaggedReasoning } from '../reasoning-filter.js';
import { filterStoryOutput, STORY_OUTPUT_RULE } from '../story-output.js';
import { composePresetMessages } from '../request-layout.js';
import { buildApiRequest, API_PROTOCOLS } from '../api-client.js';
import { requestCustomApi } from '../api-runtime.js';
import { createGenerationJob, addGenerationSegment, shouldContinueJob } from '../generation-job.js';
import { readableCharCount } from '../text-counter.js';

const entry = content => ({ id: 'synthetic', role: 'system', content });
test('请求内变量按选择顺序展开，随机/嵌套/当前任务和名字均生效，输入不变', () => {
    const original = [entry('{{trim}}\n{{setvar::role::{{random::守夜人::向导}}}}'),
        entry('{{setvar::setting::{{user}}与{{char}}在雨夜相遇}}{{getvar::role}}：{{getvar::setting}}；任务={{lastUserMessage}}')];
    const before = JSON.stringify(original);
    const result = resolveTheaterPreset(original, { user: '甲', char: '乙', lastUserMessage: '合成任务' }, { random: () => .9 });
    assert.equal(result.entries[0].content, '');
    assert.equal(result.entries[1].content, '向导：甲与乙在雨夜相遇；任务=合成任务');
    assert.equal(JSON.stringify(original), before);
    assert.equal(result.stats.unsupportedMacros, 0);
});
test('请求间变量隔离、缺失变量为空、注释不执行嵌套副作用，不使用共享环境', () => {
    resolveTheaterPreset([entry('{{setvar::a::不应跨请求}}')]);
    assert.equal(resolveTheaterPreset([entry('{{getvar::a}}')]).entries[0].content, '');
    const result = resolveTheaterPreset([entry('{{// {{setvar::a::不应执行}} }}{{getvar::a}}')]);
    assert.equal(result.entries[0].content, '');
    assert.equal(resolveTheaterPreset([entry('{{setglobalvar::a::x}}')]).entries[0].content, '{{setglobalvar::a::x}}');
});
test('值包含分隔符、换行与多次赋值，随机未选分支不执行', () => {
    const input = '{{setvar::x::first::second\nline}}{{getvar::x}}|{{random::保持::{{setvar::x::changed}}}}{{getvar::x}}';
    const result = resolveTheaterPreset([entry(input)], {}, { random: () => 0 });
    assert.equal(result.entries[0].content, 'first::second\nline|保持first::second\nline');
});
test('当前任务中的宏样式只当数据，不递归执行或读取主聊天', () => {
    const result = resolveTheaterPreset([entry('{{lastUserMessage}} {{getvar::x}}')], { lastUserMessage: '{{setvar::x::注入}}' });
    assert.equal(result.entries[0].content, '{{setvar::x::注入}} ');
});
test('明确的预设字数范围服从目标，其他数值/角色内容和无目标请求保留', () => {
    const original = '## 字数要求\n- 正文<content>内输出~1703 - 2201字\n## 角色设定\n角色年龄29岁，年份1700。\n角色说：这是一封1700字的信。\n思考每步不少于142字，再输出正文。';
    const result = resolveTheaterPreset([entry(original)], {}, { targetChars: 10000 });
    assert.match(result.entries[0].content, /10000 字/);
    assert.doesNotMatch(result.entries[0].content, /2201/);
    assert.match(result.entries[0].content, /年份1700/);
    assert.match(result.entries[0].content, /每步不少于142字/);
    assert.equal(result.stats.lengthOverrides, 1);
    assert.match(result.entries[0].content, /1700字的信/);
    assert.equal(resolveTheaterPreset([entry(original)]).entries[0].content, original);
});
test('同一字数节中也不改思考每步字数、引文或示例数值', () => {
    const input = '## 字数要求\n- 正文2000字，并引用一封1700字的信。\n- 思考每步不少于142字\n- 示例：正文2000字只是用于说明，不是本轮目标。';
    const result = resolveTheaterPreset([entry(input)], {}, { targetChars: 10000 });
    assert.match(result.entries[0].content, /正文10000 字/);
    assert.match(result.entries[0].content, /一封1700字的信/);
    assert.match(result.entries[0].content, /每步不少于142字/);
    assert.match(result.entries[0].content, /示例：正文2000字/);
    assert.equal(result.stats.lengthOverrides, 1);
});
test('宏到真实OpenAI请求构建，role和顺序不变，参数不增设', () => {
    const resolved = resolveTheaterPreset([entry('{{setvar::v::设定}}{{getvar::v}}'), { ...entry('{{lastUserMessage}}'), role: 'assistant' }], { lastUserMessage: '本篇任务' });
    const request = buildApiRequest({ url: 'https://example.invalid/v1', protocol: API_PROTOCOLS.OPENAI, model: 'synthetic',
        messages: composePresetMessages({ presetEntries: resolved.entries, tailMessages: [{ role: 'user', content: '写一篇故事' }] }), maxTokens: 16384, stream: true });
    assert.deepEqual(request.body.messages.map(message => message.content), ['设定', '本篇任务', '写一篇故事']);
    assert.equal(request.body.max_tokens, 16384); assert.equal(request.body.stream, true);
    assert.equal('temperature' in request.body, false); assert.equal('thinking' in request.body, false);
});
test('ECoT大小写、属性、流式半标签与未闭合均不漏思考，think/electric仍隐藏', () => {
    for (const tag of ['ECoT', 'ecot', 'think', 'electric']) {
        const raw = `<${tag} data-x="1">PRIVATE_THOUGHT</${tag}><content>真正正文</content><finish>EXTRA</finish>`;
        for (let i = 0; i <= raw.length; i++) {
            const visible = filterStoryOutput(raw.slice(0, i), { plainText: true });
            assert.doesNotMatch(visible, /PRIVATE|EXTRA|<content|<finish|<ecot/i);
        }
        assert.equal(filterStoryOutput(raw, { plainText: true }), '真正正文');
    }
    assert.equal(filterTaggedReasoning('<ECoT>PRIVATE').content, '');
});
test('附加块在开头/中间/结尾、嵌套和未闭合时不参与正文，普通后记文字不误删', () => {
    assert.equal(filterStoryOutput('<ws_prologue>前置</ws_prologue>正文<finish>附加<ws_todo>待办</ws_todo></finish>结尾'), '正文结尾');
    assert.equal(filterStoryOutput('正文<finish>尚未闭合'), '正文');
    assert.equal(filterStoryOutput('故事里谈到“后记”“分析”和数字1860。'), '故事里谈到“后记”“分析”和数字1860。');
    assert.equal(filterStoryOutput('<content>甲</content><content>乙</content><finish>附加</finish>', { plainText: true }), '甲\n\n乙');
});
test('丰富HTML和脚本/样式中的标签字面量不破坏，排版仍可保留交互', () => {
    const html = '<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body><div>故事</div><script>const sample="<finish>literal</finish>";</script></body></html>';
    assert.equal(filterStoryOutput(html), html);
});
test('流式和非流式真实API入口隐藏ECoT，正文层再排除附加内容', async () => {
    for (const stream of [true, false]) {
        const raw = '<ECoT>PRIVATE_THOUGHT</ECoT><content>合成正文</content><finish>EXTRA</finish>';
        const visible = []; let calls = 0;
        const result = await requestCustomApi({ config: { apiUrl: 'https://example.invalid', apiModel: 'synthetic', maxOutputTokens: 16384 }, shouldStream: stream,
            onChunk: value => visible.push(filterStoryOutput(value, { plainText: true })), fetchImpl: async () => {
                calls++;
                return new Response(stream ? `data: ${JSON.stringify({ choices: [{ delta: { content: raw }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
                    : JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }), { headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' } });
            } });
        assert.equal(calls, 1); assert.equal(filterStoryOutput(result.text, { plainText: true }), '合成正文');
        assert.ok(visible.every(value => !/PRIVATE|EXTRA/.test(value)));
    }
});
test('一轮真实生成循环只计过滤后的正文，未达目标也不额外补写', async () => {
    const source = readFileSync(new URL('../theater-generation.js', import.meta.url), 'utf8');
    const start = source.indexOf("        let firstHtml = '';", source.indexOf('async function runGeneration('));
    const end = source.indexOf('        let layoutRetry = null;', start);
    const job = createGenerationJob({ targetChars: 10000, maxRounds: 1, autoContinue: false });
    let requests = 0, chunkBody = '';
    const raw = '<ECoT>PRIVATE_THOUGHT</ECoT><content>合成正文</content><finish>EXTRA</finish>';
    const run = runInNewContext('(async () => {' + source.slice(start, end) + '\nreturn currentRoundStreamText; })', {
        runtime: { currentGenerationJob: job, settings: {}, recordRequestMetrics() {}, runtimeLog() {},
            requestConfiguredGenerationApi: async () => { requests++; return { text: raw, stopReason: 'stop' }; } },
        payload: { systemPrompt: '系统', userPrompt: '任务' }, isPlainTextRender: true,
        popupAlive: () => false, apiRoute: {}, targetWordCount: 10000, onChunk: value => { chunkBody = value; },
        filterStoryOutput, htmlToPlainText: value => value, markCompleted() {}, addGenerationSegment, readableCharCount,
        shouldContinueJob, currentRoundStreamText: '', stagedMultiRoundMode: false,
    });
    await run();
    assert.equal(requests, 1); assert.deepEqual(job.segments, ['合成正文']);
    assert.equal(job.round, 1); assert.ok(job.actualChars < 10000); assert.equal(chunkBody, '');
    assert.equal(STORY_OUTPUT_RULE.includes('丰富HTML'), true);
});
