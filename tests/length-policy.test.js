// 从 core.test.js 拆出：length-policy
import test from 'node:test';
import assert from 'node:assert/strict';
import { LENGTH_TIERS, LONG_FORM_SPLIT_THRESHOLD, STAGED_RENDER_THRESHOLD, classifyLengthTier, continuationFirstRoundGuidance, firstRoundGuidance, isLongFormTarget, isStagedRenderTarget, longFormFirstRoundGuidance, longFormFirstRoundTarget, parseTargetWordCount, resolveTargetWordCount, stripTargetWordCountRequirement } from '../length-policy.js';
import { AUTO_CONTINUE_SCHEMA, migrateAutoContinueDefault } from '../settings-migration.js';

test('普通续写单轮明确一次新增目标，多轮总目标排除旧前情', () => {
    for (const target of [4000, 20000]) {
        const single = continuationFirstRoundGuidance(target);
        assert.match(single, new RegExp(`本轮一次性充分展开约 ${target} 字`));
        assert.match(single, /本次只生成这一轮/);
        assert.match(single, /旧正文、聊天前文和其他参考资料均不计入/);
        assert.match(single, /不含 HTML、CSS、JavaScript 和排版代码/);
        assert.doesNotMatch(single, /从开篇开始|前半部分|只输出新增正文片段/);
        const multi = continuationFirstRoundGuidance(target, { maxRounds: 3 });
        assert.match(multi, /最多允许 3 轮/);
        assert.match(multi, new RegExp(`${target} 字是这些轮次新增正文的合计目标`));
        assert.match(multi, /不要因为允许后续补写就只输出短段/);
        assert.doesNotMatch(multi, /本次只生成这一轮/);
    }
    assert.doesNotMatch(continuationFirstRoundGuidance(null), /NaN|约 0 字|undefined/);
});

test('四档分诊边界保留，首轮明确告诉模型目标正文字数', () => {
    assert.equal(classifyLengthTier(null), LENGTH_TIERS.UNSPECIFIED);
    assert.equal(classifyLengthTier(3000), LENGTH_TIERS.SHORT);
    assert.equal(classifyLengthTier(3001), LENGTH_TIERS.COMFORT);
    assert.equal(classifyLengthTier(5000), LENGTH_TIERS.COMFORT);
    assert.equal(classifyLengthTier(5001), LENGTH_TIERS.LONG);
    assert.match(firstRoundGuidance(2000), /目标约为 2000 字/);
    assert.match(firstRoundGuidance(8000), /目标约为 8000 字/);
    assert.match(firstRoundGuidance(8000), /不含 HTML、CSS、JavaScript 和排版代码/);
    assert.match(firstRoundGuidance(8000), /不要在正文中报告或标注字数/);
    assert.doesNotMatch(firstRoundGuidance(8000), /写满|统计注释/);
});

test('5000 字起正文与 HTML 分离，旧长度分类工具不再决定轮数上限', () => {
    assert.equal(STAGED_RENDER_THRESHOLD, 5000);
    assert.equal(LONG_FORM_SPLIT_THRESHOLD, 8000);
    assert.equal(isStagedRenderTarget(4999), false);
    assert.equal(isStagedRenderTarget(5000), true);
    assert.equal(isStagedRenderTarget(7500), true);
    assert.equal(isLongFormTarget(7999), false);
    assert.equal(isLongFormTarget(8000), true);
    assert.equal(longFormFirstRoundTarget(8000), 4000);
    assert.equal(longFormFirstRoundTarget(6500), 3300);
    const stagedGuidance = longFormFirstRoundGuidance(5000);
    assert.match(stagedGuidance, /多个纯正文轮共同完成/);
    assert.match(stagedGuidance, /前半部分，目标约 2500 字/);
    assert.match(stagedGuidance, /不要把本轮压缩成独立完结篇/);
    const guidance = longFormFirstRoundGuidance(8000);
    assert.match(guidance, /总目标约为 8000 字/);
    assert.match(guidance, /前半部分，目标约 4000 字/);
    assert.match(guidance, /停在剧情发展途中/);
    assert.match(guidance, /不要总结、收束、写出结局/);
    assert.match(guidance, /不要.*未完待续/);
});

test('明确字数由程序解析、从原指令清理后作为统一篇幅目标发给首轮模型', () => {
    for (const source of ['写一个8000字的小剧场', '正文至少八千字，写雨夜重逢', '篇幅5000字左右；围绕误会展开']) {
        const target = parseTargetWordCount(source);
        assert.ok(target >= 5000);
        const cleaned = stripTargetWordCountRequirement(source);
        assert.doesNotMatch(cleaned, /8000|5000|八千|字左右|至少.*字/);
        assert.match(firstRoundGuidance(target), new RegExp(`目标约为 ${target} 字`));
    }
    assert.equal(stripTargetWordCountRequirement('写一个8000字的小剧场'), '写一个小剧场');
});

test('独立目标字数默认不接管，开启后覆盖指令中的目标', () => {
    assert.equal(resolveTargetWordCount('写5000字'), 5000);
    assert.equal(resolveTargetWordCount('写5000字', { manualEnabled: true, manualTarget: 8000 }), 8000);
    assert.equal(resolveTargetWordCount('没有字数要求', { manualEnabled: true, manualTarget: 2000 }), 2000);
});

test('常见篇幅说法统一为近似目标，清理完整要求且不误取故事数字', () => {
    for (const phrase of ['不得少于7000字', '不能少于7000字', '不可少于7000字', '不可低于7000字', '不低于7000字',
        '不得超过7000字', '不超过7000字', '最多7000字', '至少7000字', '大约7000字',
        '七千字左右', '7千字左右', '7k字左右', '7,000字左右', '0.7万字左右',
        '字数要求：7000', '篇幅：7000字']) {
        const instruction = `描写雨夜重逢。${phrase}。保持人物性格。`;
        assert.equal(resolveTargetWordCount(instruction), 7000, phrase);
        const cleaned = stripTargetWordCountRequirement(instruction);
        assert.match(cleaned, /描写雨夜重逢/);
        assert.match(cleaned, /保持人物性格/);
        assert.doesNotMatch(cleaned, /7000|七千|7千|7k|7,000|0\.7万|不得|不能|不可|不超过|字数要求|篇幅/);
    }
    for (const phrase of ['7000字', '7千字', '7k字', '7,000字', '七千字']) {
        assert.equal(resolveTargetWordCount(`雨夜重逢\n${phrase}`), 7000);
    }
    for (const instruction of ['两人在7000年前相遇', '她读完一封7000字的信', '没有字数要求']) {
        assert.equal(resolveTargetWordCount(instruction), null);
    }
    assert.equal(resolveTargetWordCount('不得少于7000字', { manualEnabled: true, manualTarget: 9000 }), 9000);
});

test('旧用户升级时默认开启目标字数自动补写，迁移只执行一次', () => {
    const settings = { autoContinue: false };
    assert.equal(migrateAutoContinueDefault(settings), true);
    assert.equal(settings.autoContinue, true);
    assert.equal(settings.autoContinueSchema, AUTO_CONTINUE_SCHEMA);
    settings.autoContinue = false;
    assert.equal(migrateAutoContinueDefault(settings), false);
    assert.equal(settings.autoContinue, false);
});
