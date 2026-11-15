import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { outputExclusionTags, stripExcludedOutputTags } from '../context-exclusions.js';
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
    assert.equal(generation.match(/stripExcludedOutputTags\(/g)?.length, 2);
    assert.match(generation, /excluded\.unwrapped\) formatRecovered = 'extra-wrapper'/);
    assert.equal(dream.match(/stripExcludedOutputTags\(/g)?.length, 2);
});
