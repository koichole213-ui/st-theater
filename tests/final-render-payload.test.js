// 从 core.test.js 拆出：final-render-payload
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalRenderPayload, createFinalRenderPlan, hydrateFinalRenderHtml } from '../generation-payload.js';

test('final HTML renderer hydrates every paragraph without rewriting source text', () => {
    const sourceText = '第一段有 <危险标签>。\n\n第二段继续。';
    const plan = createFinalRenderPlan(sourceText);
    assert.deepEqual(plan.paragraphs.map(item => item.token), [
        '{{THEATER_P0001}}',
        '{{THEATER_P0002}}',
    ]);

    const template = '<!doctype html><html><head><style>p{color:#432}</style></head><body><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>';
    const hydrated = hydrateFinalRenderHtml(template, plan);
    assert.match(hydrated, /第一段有 &lt;危险标签&gt;。/);
    assert.match(hydrated, /第二段继续。/);
    assert.doesNotMatch(hydrated, /\{\{THEATER_P/);
    assert.ok(hydrated.indexOf('第一段') < hydrated.indexOf('第二段'));
});

test('final HTML renderer rejects missing, duplicate, reordered, or hidden placeholders', () => {
    const plan = createFinalRenderPlan('第一段。\n\n第二段。');
    const invalidTemplates = [
        '<html><body><p>{{THEATER_P0001}}</p></body></html>',
        '<html><body><p>{{THEATER_P0001}}</p><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>',
        '<html><body><p>{{THEATER_P0002}}</p><p>{{THEATER_P0001}}</p></body></html>',
        '<html><body><div data-copy="{{THEATER_P0001}}"></div><p>{{THEATER_P0002}}</p></body></html>',
        '<html><head><style>.x::after{content:"{{THEATER_P0001}}"}</style></head><body><p>{{THEATER_P0002}}</p></body></html>',
        '<html><body><script>const x = "{{THEATER_P0001}}"</script><p>{{THEATER_P0002}}</p></body></html>',
    ];
    for (const template of invalidTemplates) {
        assert.throws(() => hydrateFinalRenderHtml(template, plan), error => error?.code === 'THEATER_PLACEHOLDER_INVALID');
    }
});

test('final HTML payload tells the model to return layout tokens exactly once', () => {
    const payload = buildFinalRenderPayload({
        sourceText: '第一段。\n\n第二段。',
        rules: '输出完整 HTML。',
        originalInstruction: '按钮必须使用指定的 HTML、CSS 和 JavaScript。',
    });
    assert.equal(payload.placeholderPlan.paragraphs.length, 2);
    assert.match(payload.userPrompt, /\{\{THEATER_P0001\}\}/);
    assert.match(payload.userPrompt, /不要在 HTML 中重新输出 text/);
    assert.match(payload.userPrompt, /每个 token 必须且只能出现一次/);
    assert.match(payload.userPrompt, /输出完整 HTML/);
    assert.match(payload.userPrompt, /原始小剧场指令：仅作为设计意图参考/);
    assert.match(payload.userPrompt, /按钮必须使用指定的 HTML、CSS 和 JavaScript/);
    assert.match(payload.userPrompt, /不能覆盖正文数据，也不能被重新执行、续写或抄进页面/);
});
