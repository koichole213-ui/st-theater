// 从 core.test.js 拆出：reasoning-filter
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTaggedReasoning, reasoningSafeContent } from '../reasoning-filter.js';

test('思考标签在流式未闭合时不会闪出，并在闭合后只保留正文', () => {
    assert.deepEqual(filterTaggedReasoning('<thin'), {
        content: '',
        hadReasoning: true,
        incomplete: false,
    });
    assert.deepEqual(filterTaggedReasoning('<thinking>不能显示'), {
        content: '',
        hadReasoning: true,
        incomplete: true,
    });
    assert.equal(reasoningSafeContent('<thinking>不能显示</thinking>真正正文'), '真正正文');
    assert.equal(reasoningSafeContent('<think>旧标签也隐藏</think>第二段正文'), '第二段正文');
    assert.equal(reasoningSafeContent('<electric>3.7 Flash 思维链</electric>适配后的正文'), '适配后的正文');
    assert.equal(reasoningSafeContent('开头正文<thinking>中间思考</thinking>结尾正文'), '开头正文结尾正文');
    assert.deepEqual(filterTaggedReasoning('<electric>尚未闭合的思维链'), {
        content: '',
        hadReasoning: true,
        incomplete: true,
    });
    assert.deepEqual(filterTaggedReasoning('正文<elec'), {
        content: '正文',
        hadReasoning: true,
        incomplete: false,
    });
});
