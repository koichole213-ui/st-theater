import test from 'node:test';
import assert from 'node:assert/strict';
import { reasoningSafeResult, emitReasoningSafeChunk } from '../api-response.js';
import * as story from '../story-output.js';
import { createLongDreamRecord } from '../long-dream.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';

const body = '故事里的人走到窗边，迎面吹来一阵带着雨水气息的风。'.repeat(6);
test('完整 HTML 正文后跟很长的附加块，仍走正常排版', () => {
    const html = '<article><p>完整的短篇正文</p></article>';
    for (const tag of ['tableedit', 'updatevariable', 'littletheatre']) {
        const value = html + '<' + tag + '>' + '附加内容'.repeat(35) + '</' + tag + '>';
        assert.deepEqual(story.finalStoryOutput(value), { text: html });
        assert.deepEqual(story.finalStoryOutput('她推开了门。' + value.slice(html.length), { plainText: true }), { text: '她推开了门。' });
        assert.deepEqual(story.finalStoryOutput('<content>她推开了门</content>' + value.slice(html.length), { plainText: true }), { text: '她推开了门' });
        assert.deepEqual(story.finalStoryOutput('<strong>门开了</strong>' + value.slice(html.length)), { text: '<strong>门开了</strong>' });
    }
});

test('首段正文被包住时，外面的短尾句不会让兜底丢掉首段', () => {
    const text = '<p>' + body + '</p><p>完</p>';
    assert.deepEqual(story.finalStoryOutput('<littletheatre><p>' + body + '</p></littletheatre><p>完</p>'), {
        text, formatRecovered: 'extra-wrapper',
    });
});
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

test('正常思考、正文信封、字数报告维持原结果；只有结束思考标签时去掉它前面的思考', () => {
    const value = '<think>思考</think><content>' + body + '</content><finish>字数报告 1200 字</finish>';
    assert.deepEqual(story.finalStoryOutput(value, { plainText: true }), { text: body });
    assert.deepEqual(story.finalStoryOutput('<finish>字数报告 1200 字</finish>'), { text: '' });
    assert.deepEqual(reasoningSafeResult('</think>' + body), { text: body });
    const logs = [];
    assert.deepEqual(reasoningSafeResult('前言</think>' + body, { log: (...args) => logs.push(args) }), { text: body });
    assert.equal(logs[0][0], 'warn');
    // 结束标签后面正文太少时整段保留，宁可多留也不丢正文。
    assert.deepEqual(reasoningSafeResult(body + '</think>完'), { text: body + '完' });
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

test('</content> 提前关上、后面接着写的正文：像正文的一大段接上保留，附加部件照旧去掉', () => {
    const head = '<content>她推开门，屋里还亮着那盏旧台灯。\n\n他抬起头，没有说话。</content>';
    const ending = '\n\n「你回来了。」他终于开口，声音比她记得的要轻。\n\n她把伞靠在门边，雨水顺着伞尖在地板上洇开一小片。她想说的话很多，最后只是点了点头，走过去坐在他对面。\n\n台灯的光落在两个人中间，窗外的雨还在下。她伸手把他面前那杯早就凉了的茶推开，替他倒了一杯热的。';
    const kept = [];
    const out = story.finalStoryOutput(head + ending, { plainText: true, onKeptTrailing: chars => kept.push(chars) });
    assert.equal(out.formatRecovered, undefined);
    // 每一段都在、顺序不变
    const paragraphs = [...(head.replace(/<\/?content>/g, '') + ending).split(/\n\n+/)].map(p => p.trim()).filter(Boolean);
    let at = -1;
    for (const paragraph of paragraphs) { const i = out.text.indexOf(paragraph); assert.ok(i > at, paragraph); at = i; }
    assert.equal(kept.length, 1);
    assert.ok(kept[0] >= 100);

    const drops = {
        短尾巴: '（完）',
        状态栏标题: '\n【状态栏】' + '时间：深夜。地点：旧公寓。她的心情很复杂，他也一样。'.repeat(4),
        一行行键值: '\n时间：深夜十一点\n地点：旧公寓客厅\n心情：复杂，想说又没说\n好感度：上升了一点点\n下一步：明天早上一起去买早餐。' + '附注。'.repeat(20),
        创作说明: '\n创作说明：本篇围绕重逢展开，重点写两个人之间没说出口的话。结尾停在倒茶的动作上，留出余韵。'.repeat(2),
        思考: '\n思考：这一章要让人物关系往前走一步，所以安排了倒茶这个细节。再检查一遍有没有写错称呼。'.repeat(2),
        带标签: '\n<StatusBlock>' + '她的心情很复杂。'.repeat(20) + '</StatusBlock>',
    };
    for (const [name, tail] of Object.entries(drops)) {
        const calls = [];
        const result = story.filterStoryOutput(head + tail, { plainText: true, onKeptTrailing: c => calls.push(c) });
        assert.equal(result, '她推开门，屋里还亮着那盏旧台灯。\n\n他抬起头，没有说话。', name);
        assert.equal(calls.length, 0, name);
    }
    // 对白里带冒号的正文不当成状态栏
    const dialogue = '\n\n她说：「明天还下雨吗？」\n\n他说：「不知道。」\n\n她又问：「那你还走吗？」\n\n他想了很久，最后说：「不走了。」窗外的雨声慢慢小了下去，她靠在沙发上，听着他在厨房里洗杯子的声音，觉得这个夜晚终于有了一点暖意。她想，等雨停了，就把阳台上那几盆快枯掉的花搬进来，再问问他明天早上想吃什么。';
    assert.match(story.filterStoryOutput(head + dialogue, { plainText: true }), /不走了。」窗外的雨声/);
    // 流式过程中：附加标签和思考不会漏出来
    const raw = head + ending + '<finish>字数 6000</finish>';
    for (let i = 0; i <= raw.length; i += 3) assert.doesNotMatch(story.filterStoryOutput(raw.slice(0, i), { plainText: true }), /<finish|字数 6000|<\/?content/);
    // 非纯文字模式不受影响
    assert.equal(story.filterStoryOutput(head + ending), head + ending);
});
