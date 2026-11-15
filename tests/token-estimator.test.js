// 从 core.test.js 拆出：token-estimator
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation } from './theater-source.js';
import { createTokenBreakdownEstimator, estimateTokenBreakdown, estimateTokenCount } from '../token-estimator.js';

test('输入预估只重新计数变化项，删除资料或切换资料时不会沿用旧计数', () => {
    const scanned = [];
    const estimate = createTokenBreakdownEstimator(text => { scanned.push(text); return estimateTokenCount(text); });
    const parts = { worldBook: '合成设定'.repeat(1000), context: '前文', instruction: '一' };
    assert.deepEqual(estimate(parts), estimateTokenBreakdown(parts));
    scanned.length = 0;
    parts.instruction = '一二';
    assert.deepEqual(estimate(parts), estimateTokenBreakdown(parts));
    assert.deepEqual(scanned, ['一二']);
    parts.worldBook = '替换后的设定';
    delete parts.context;
    assert.deepEqual(estimate(parts), estimateTokenBreakdown(parts));
    assert.deepEqual(estimate({}), { total: 0 });
    scanned.length = 0;
    estimate(parts);
    assert.deepEqual(scanned, Object.values(parts));
});

test('Token 分类相加等于总数', () => {
    const result = estimateTokenBreakdown({ preset: '预设内容', context: '聊天上下文', instruction: '写一段故事' });
    assert.equal(result.total, result.preset + result.context + result.instruction);
});

test('世界书勾选上限与生成预览复用同一个 Token 估算口径', () => {
    const source = readTheaterImplementation();
    const worldBookText = `世界书设定：\n${['第一条设定。', '第二条设定。'].join('\n\n')}`;
    assert.equal(estimateTokenBreakdown({ worldBook: worldBookText }).worldBook, estimateTokenCount(worldBookText));
    const updateSource = source.match(/function (?:runtime\.)?updateWBCount\(\)[\s\S]*?\n\}/)?.[0] || '';
    assert.match(updateSource, /estimateTokenCount\(worldBookText\)/);
    assert.match(updateSource, /已勾选上限约/);
    assert.doesNotMatch(updateSource, /chars\s*\/\s*1\.5/);
});
