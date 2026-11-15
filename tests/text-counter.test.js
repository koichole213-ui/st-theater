// 从 core.test.js 拆出：text-counter
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CONTINUATION_CONTEXT_CHARS, continuationContextWindow, normalizeContinuationText, readableCharCount } from '../text-counter.js';

test('旧截取工具仍兼容8000字窗口（已不用于普通续写入口）', () => {
    const previousRound = 'B'.repeat(MAX_CONTINUATION_CONTEXT_CHARS + 200);
    const context = continuationContextWindow(previousRound);
    assert.equal(context.endsWith('B'.repeat(MAX_CONTINUATION_CONTEXT_CHARS)), true);
    assert.equal(context.includes('A轮旧剧情'), false);
    assert.match(context, /更早内容已省略/);
    assert.equal(continuationContextWindow('本轮新增正文'), '本轮新增正文');
});

test('续写前情清理 HTML 排版空白，并按可读字符而非源码长度截取', () => {
    const indented = '\n        第一段。\n\n            第二段！        \n';
    assert.equal(normalizeContinuationText(indented), '第一段。\n\n第二段！');
    assert.equal(readableCharCount(normalizeContinuationText(indented)), 6);

    const whitespaceHeavy = `${'甲'.repeat(6)}\n\n${' '.repeat(200)}${'乙'.repeat(6)}`;
    const context = continuationContextWindow(whitespaceHeavy, 6);
    assert.equal(context.endsWith('乙'.repeat(6)), true);
    assert.equal(context.includes('甲'), false);
});
