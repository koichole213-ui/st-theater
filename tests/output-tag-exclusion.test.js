import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { outputExclusionTags, stripExcludedOutputTags } from '../context-exclusions.js';
import { createTheaterApi } from '../theater-api.js';
import { createTheaterGeneration } from '../theater-generation.js';
import { finalStoryOutput } from '../story-output.js';

const body = '她推开门，雨还在下，街灯一盏一盏亮起来。'.repeat(5);
const rules = [
    { type: 'tag', value: 'status', enabled: true },
    { type: 'tag', value: 'reasoning', enabled: true },
    { type: 'tag', value: 'hidden_note', enabled: false },
    { type: 'tag', value: 'div', enabled: true },
    { type: 'tag', value: 'content', enabled: true },
    { type: 'literal', value: '雨', enabled: true },
];

test('只用启用的“标签”规则；正文自己的 HTML 标签和 content 信封不拿来删正文', () => {
    assert.deepEqual(outputExclusionTags(rules), ['status', 'reasoning']);
    assert.deepEqual(outputExclusionTags([]), []);
});

test('生成的正文去掉这些标签整块，正文和排版原样保留', () => {
    const raw = `<reasoning>先想一想剧情</reasoning><div class="card"><p>${body}</p></div><status>好感 +5</status>`;
    const result = stripExcludedOutputTags(raw, rules);
    assert.equal(result.text, `<div class="card"><p>${body}</p></div>`);
    assert.equal(result.removed, 2);
    assert.equal(result.unwrapped, false);
    assert.equal(finalStoryOutput(result.text).text, result.text);
});

test('正文被整段包在这种标签里时，只去掉标签、保留文字并标记', () => {
    const result = stripExcludedOutputTags(`<status><p>${body}</p></status>`, rules);
    assert.equal(result.text, `<p>${body}</p>`);
    assert.equal(result.unwrapped, true);
});

test('标签没闭合时整段保留，不猜删除范围', () => {
    const raw = `<p>${body}</p><status>回复被截断`;
    assert.equal(stripExcludedOutputTags(raw, rules).text, raw);
});

test('没有规则或规则读不到时原样返回', () => {
    for (const value of [undefined, null, [], [{ type: 'tag', value: '<<bad>>' }]]) {
        assert.equal(stripExcludedOutputTags(`<status>x</status>${body}`, value).text, `<status>x</status>${body}`);
    }
});

test('普通生成（出字过程和最终结果）和长梦都接上了排除', () => {
    const generation = readFileSync(new URL('../theater-generation.js', import.meta.url), 'utf8');
    const dream = readFileSync(new URL('../long-dream-runtime.js', import.meta.url), 'utf8');
    assert.equal(generation.match(/stripExcludedOutputTags\(/g)?.length, 3, '正文两处 + 排版一处');
    assert.match(generation, /excluded\.unwrapped\) formatRecovered = 'extra-wrapper'/);
    assert.equal(dream.match(/stripExcludedOutputTags\(/g)?.length, 2);
});

import { reasoningSafeContent, filterTaggedReasoning } from '../reasoning-filter.js';

const longStory = '<p>' + '城里下了一夜的雨，她把伞收起来，推门进了茶馆。'.repeat(80) + '</p>';

test('只有结束思考标签：前面那段比后面长时整段保留，不丢正文', () => {
    const tail = '<p>' + '最后一段补充说明的文字内容。'.repeat(5) + '</p>';
    assert.equal(reasoningSafeContent(longStory + '</think>' + tail), longStory + tail);
});

test('代码块或脚本里出现的结束思考标签是作品内容，不当作思考结束', () => {
    const tail = '<p>' + '故事继续往下走，灯火通明。'.repeat(10) + '</p>';
    for (const inner of ['<pre><code>&lt;/think&gt;</think></code></pre>', '<script>const marker = "</think>"; console.log(marker);</script>']) {
        const value = longStory + inner + tail;
        assert.equal(reasoningSafeContent(value), value);
    }
});

test('思考里提到 script、pre、code 等标签名时，思考结束标签照样有效，正文不会被藏起来', () => {
    for (const thought of ['<thinking>我需要加一个<script>按钮脚本，再用<pre>展示</thinking>', '<think>计划用<code>写计数器</think>']) {
        const result = filterTaggedReasoning(thought + longStory + '<script>var n = 1;</script>');
        assert.equal(result.incomplete, false);
        assert.equal(result.content, longStory + '<script>var n = 1;</script>');
    }
});

test('只有结束思考标签、前面是短思考、后面是正文时，仍然去掉前面的思考', () => {
    const thought = '先想一下这一章要写什么。';
    assert.equal(reasoningSafeContent(thought + '</think>' + longStory), longStory);
});

test('数字数时不把样式和脚本代码算成正文：正文被包住时走“保留原文”', () => {
    const css = '<style>' + '.card{color:red;background:white;padding:12px;}'.repeat(10) + '</style>';
    const raw = css + '<story><p>' + '她慢慢走到窗边，看着楼下的人群。'.repeat(25) + '</p></story><button>继续</button>';
    const result = stripExcludedOutputTags(raw, [{ type: 'tag', value: 'story', enabled: true }]);
    assert.equal(result.unwrapped, true);
    assert.match(result.text, /她慢慢走到窗边/);
    assert.doesNotMatch(result.text, /<story>/);
    assert.match(result.text, /<style>/);
});

test('正文中间大段被这种标签包住时不删，保留文字并标记', () => {
    const outside = '<p>' + '开头的一段故事。'.repeat(12) + '</p>';
    const inside = '<p>' + '被标签包住的大段正文内容。'.repeat(40) + '</p>';
    const raw = outside + '<plot>' + inside + '</plot>' + outside;
    const result = stripExcludedOutputTags(raw, [{ type: 'tag', value: 'plot', enabled: true }]);
    assert.equal(result.unwrapped, true);
    assert.match(result.text, /被标签包住的大段正文内容/);
});

test('开头的长思考块照常去掉；保留原文时不动脚本里的同名字样', () => {
    const thinking = '<reasoning>' + '分析人物动机与场景安排。'.repeat(60) + '</reasoning>';
    const result = stripExcludedOutputTags(thinking + longStory, rules);
    assert.equal(result.text, longStory);
    assert.equal(result.unwrapped, false);
    const scripted = '<script>const s = "<status>";</script><status><p>' + '整篇正文都在这里面。'.repeat(20) + '</p></status>';
    const kept = stripExcludedOutputTags(scripted, rules);
    assert.equal(kept.unwrapped, true);
    assert.match(kept.text, /const s = "<status>"/);
});

// 排版那一步（独立排版 API、手动重新排版、排版重试、长梦最终排版）都走 requestFinalRenderedHtml。
async function layoutWith(responseHtml, rules, sourceText = '第一段正文写得很长，雨下了一整夜。\n\n第二段正文，天亮了她推开门。') {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ set innerHTML(v) { this.textContent = v.replace(/<[^>]*>/g, ''); }, querySelectorAll: () => [] }) };
    const logs = [];
    try {
        const config = { apiMode: 'custom', apiUrl: 'https://body.example/v1', apiModel: 'body-model', contextExclusionRules: rules };
        const runtime = { settings: config, extractHtml: v => v, runtimeLog: (level, message) => logs.push([level, message]), recordRequestMetrics() {},
            requestConfiguredGenerationApi: async () => ({ text: responseHtml }) };
        const apiRoute = createTheaterApi({ settings: config }).captureGenerationApiRoute({});
        const result = await createTheaterGeneration(runtime).requestFinalRenderedHtml({ sourceText, rules: '样式', apiRoute, ctx: {} });
        return { html: result.html, logs };
    } finally { globalThis.document = previousDocument; }
}
const STATUS_RULE = [{ type: 'tag', value: 'status', enabled: true }];

test('排版模型自己加的排除标签也会去掉，正文不受影响', async () => {
    const { html } = await layoutWith('<html><body><status>好感度 +5｜天气：雨</status><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>', STATUS_RULE);
    assert.doesNotMatch(html, /status|好感度/);
    assert.match(html, /第一段正文/);
    assert.match(html, /第二段正文/);
});

test('排版结果里排除标签包住了正文时不删正文', async () => {
    const { html } = await layoutWith('<html><body><status><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></status></body></html>', STATUS_RULE);
    assert.match(html, /第一段正文/);
    assert.match(html, /第二段正文/);
});

test('没有排除规则时，排版结果原样保留', async () => {
    const raw = '<html><body><status>好感度 +5</status><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>';
    const { html } = await layoutWith(raw, []);
    assert.match(html, /<status>好感度 \+5<\/status>/);
});

// 独立复查复现（2026-11-15）：只看“剩下的字数够不够”时，一小段被包住会被悄悄删掉。
test('排除标签只包住一两段正文时，一段都不能少，并在运行日志里说明', async () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `第${i + 1}段：雨一直下，她把伞往他那边又偏了一点，自己半边肩膀都湿了。`);
    const source = paragraphs.join('\n\n');
    const token = i => `{{THEATER_P${String(i + 1).padStart(4, '0')}}}`;
    const body = (wrap, extra = '') => paragraphs.map((_, i) => wrap.includes(i) ? `<status><p>${token(i)}</p></status>` : `<p>${token(i)}</p>`).join('') + extra;
    for (const [wrap, extra] of [[[9], ''], [[18, 19], '<status>电量 80%</status>']]) {
        const { html, logs } = await layoutWith(`<html><body>${body(wrap, extra)}</body></html>`, STATUS_RULE, source);
        for (const text of paragraphs) assert.ok(html.includes(text), text);
        assert.ok(logs.some(([level, message]) => level === 'warn' && /包住了正文段落/.test(message)));
    }
});
