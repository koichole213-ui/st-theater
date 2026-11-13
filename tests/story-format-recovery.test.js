import test from 'node:test';
import assert from 'node:assert/strict';
import { reasoningSafeResult, emitReasoningSafeChunk } from '../api-response.js';
import * as story from '../story-output.js';
import { createLongDreamRecord } from '../long-dream.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';

const body = '故事里的人走到窗边，迎面吹来一阵带着雨水气息的风。'.repeat(6);
test('G1 未闭合思考标签只在最终结果保留长正文，流式仍隐藏', () => {
    const value = '<think>' + body;
    emitReasoningSafeChunk(text => assert.equal(text, ''), value);
    assert.deepEqual(reasoningSafeResult(value), { text: body, formatRecovered: 'unclosed-reasoning' });
    assert.throws(() => reasoningSafeResult('<think>纯思考'), { code: 'THEATER_REASONING_ONLY' });
    assert.throws(() => reasoningSafeResult(value, { recoverFormat: false }), { code: 'THEATER_REASONING_ONLY' });
    const combined = reasoningSafeResult(value + '<finish>只用于统计的字数报告</finish>');
    assert.deepEqual(story.finalStoryOutput(combined.text, combined), { text: body, formatRecovered: 'unclosed-reasoning' });
});

test('G2、G2b 被预设附加标签包裹的正文在纯文本或 HTML 均可保留', () => {
    for (const plainText of [true, false]) {
        for (const prefix of ['', '前言', '<finish/>']) {
            const output = story.finalStoryOutput(prefix + '<littletheatre><p>' + body + '</p></littletheatre>', { plainText });
            assert.ok(output.text.includes(body));
            assert.equal(output.formatRecovered, 'extra-wrapper');
        }
    }
});

test('G4 相似前缀的自定义 HTML 元素不会被当成思考或附加标签', () => {
    const value = '<think-bubble><bbs-card>' + body + '</bbs-card></think-bubble>';
    assert.equal(reasoningSafeResult(value).text, value);
    assert.equal(story.filterStoryOutput(value), value);
    assert.ok(story.finalStoryOutput(value).formatRecovered);
});

test('正常思考、正文信封、字数报告和只有闭合标签的回复维持原结果', () => {
    const value = '<think>思考</think><content>' + body + '</content><finish>字数报告 1200 字</finish>';
    assert.deepEqual(story.finalStoryOutput(value, { plainText: true }), { text: body });
    assert.deepEqual(story.finalStoryOutput('<finish>字数报告 1200 字</finish>'), { text: '' });
    assert.deepEqual(reasoningSafeResult('</think>' + body), { text: body });
    const logs = [];
    assert.deepEqual(reasoningSafeResult('前言</think>' + body, { log: (...args) => logs.push(args) }), { text: '前言' + body });
    assert.equal(logs[0][0], 'warn');
});

test('长梦第二轮的异常回复连同第一轮保存为可重排草稿，重试不重新生成', async () => {
    const record = createLongDreamRecord({ source: { text: '首章', html: '<p>首章</p>' } });
    let saved, requests = 0, layouts = 0;
    const controller = createLongDreamGenerationController({
        requestChapter: async () => ++requests === 1 ? { text: '第一轮合成正文' } : { text: body, formatRecovered: 'extra-wrapper' },
        renderChapter: async ({ text }) => { layouts++; return '<p>' + text + '</p>'; },
        persistRecord: async next => { saved = next; return next; },
    });
    await assert.rejects(controller.run({ record, instruction: '测试', targetChars: 5000, autoContinue: true, maxRounds: 2 }),
        { formatRecovered: 'extra-wrapper' });
    assert.match(saved.draft.text, /第一轮合成正文/);
    assert.ok(saved.draft.text.includes(body));
    assert.equal(saved.draft.formatRecovered, 'extra-wrapper');
    assert.equal(saved.draft.resumeStage, 'rendering');
    assert.equal(layouts, 0);
    await controller.run({ record: saved });
    assert.equal(requests, 2);
    assert.equal(layouts, 1);
});
