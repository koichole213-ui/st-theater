import test from 'node:test';
import assert from 'node:assert/strict';
import { createLongDreamGenerationController, longDreamWritingPlan } from '../long-dream-generation.js';
import { createLongDreamRecord, saveLongDreamDraft, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_DRAFT_RESUME_STAGE } from '../long-dream.js';

const makeRecord = () => createLongDreamRecord({ canon: '保留本梦事实', source: { text: '上一章完整正文与既有关系。', html: '<p>上一章完整正文与既有关系。</p>' } });
async function exercise({ target, auto = true, max = 3, pieces, draft = '', resumeRendering = false }) {
    let record = makeRecord();
    if (draft) record = saveLongDreamDraft(record, { status: LONG_DREAM_DRAFT_STATUS.WRITING, title: '本章', instruction: '当前方向', targetChars: target,
        text: draft, resumeStage: resumeRendering ? LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING : LONG_DREAM_DRAFT_RESUME_STAGE.WRITING });
    const chaptersBefore = JSON.stringify(record.chapters);
    const requests = [], renders = [], persisted = [];
    const controller = createLongDreamGenerationController({
        requestChapter: async request => {
            const text = pieces[requests.length];
            assert.notEqual(text, undefined, '不得突破约定轮次继续请求');
            requests.push(request);
            request.onChunk(text);
            return { text, stopReason: 'stop' };
        },
        renderChapter: async request => { renders.push(request); return `<article>${request.text}</article>`; },
        persistRecord: async value => { persisted.push(value); return value; },
    });
    const result = await controller.run({ record, instruction: '当前方向', chapterTitle: '本章', targetChars: target, autoContinue: auto, maxRounds: max });
    assert.equal(JSON.stringify(result.record.chapters), chaptersBefore);
    assert.equal(result.record.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(renders.length, 1);
    assert.equal(renders[0].text, result.record.draft.text);
    assert.ok(persisted.length > 0);
    assert.equal(controller.active, null);
    return { result, requests, renders };
}

for (const target of [3000, 4999]) {
    test(`长梦${target}字小目标与普通生成一致：即使允许多轮也只请求一轮`, async () => {
        const { result, requests } = await exercise({ target, pieces: ['甲'.repeat(1500)] });
        assert.equal(result.rounds, 1); assert.equal(requests[0].maxRounds, 1);
        assert.equal(result.completedBelowTarget, true);
        assert.doesNotMatch(requests[0].userPrompt, /本轮只写本章前半部分/);
        assert.match(requests[0].userPrompt, /本次只生成这一轮/);
        assert.match(requests[0].userPrompt, /【单轮停笔要求】/);
        assert.match(requests[0].userPrompt, /用户为本章指定的关键情节/);
        assert.match(requests[0].userPrompt, /最后一句须表达完整/);
        assert.match(requests[0].userPrompt, /只完成本章，不结束整部长卷/);
        assert.doesNotMatch(requests[0].userPrompt, /若本轮同时输出HTML/);
    });
}
test('5000边界大目标新章至少两轮，首轮半章后统一排版', async () => {
    const { result, requests } = await exercise({ target: 5000, pieces: ['甲'.repeat(2500), '乙'.repeat(2100)] });
    assert.equal(result.rounds, 2); assert.equal(result.completedBelowTarget, false);
    assert.match(requests[0].userPrompt, /本轮只写本章前半部分，目标约 2500 字/);
    assert.match(requests[1].userPrompt, /本章已有约 2500 字/);
    assert.match(requests[1].userPrompt, /上一章完整正文与既有关系/);
    assert.match(requests[1].userPrompt, /保留本梦事实/);
    assert.equal(requests[0].targetChars, 5000);
});
test('首轮已达到九成仍保留第二轮收尾，不能直接进入排版', async () => {
    const { result, requests } = await exercise({ target: 6000, pieces: ['甲'.repeat(5700), '乙'.repeat(100)] });
    assert.equal(result.rounds, 2); assert.equal(result.actualChars, 5800);
    assert.match(requests[0].userPrompt, /本轮不形成章末/);
    assert.ok(requests.every(request => !request.userPrompt.includes('【单轮停笔要求】')));
    assert.match(requests[1].userPrompt, /本轮可以在本章情节充分展开后自然收束/);
});
for (const config of [{ auto: false, max: 3 }, { auto: true, max: 1 }]) {
    test(`长梦关闭补写或仅一轮仍整章一次写，不强制半章：${JSON.stringify(config)}`, async () => {
        const { result, requests } = await exercise({ target: 6000, ...config, pieces: ['甲'.repeat(2000)] });
        assert.equal(result.rounds, 1); assert.equal(requests[0].maxRounds, 1);
        assert.doesNotMatch(requests[0].userPrompt, /本轮只写本章前半部分/);
        assert.match(requests[0].userPrompt, /本次只生成这一轮/);
        assert.match(requests[0].userPrompt, /【单轮停笔要求】/);
        assert.match(requests[0].userPrompt, /用户为本章指定的关键情节/);
        assert.match(requests[0].userPrompt, /最后一句须表达完整/);
        assert.match(requests[0].userPrompt, /只完成本章，不结束整部长卷/);
        assert.doesNotMatch(requests[0].userPrompt, /若本轮同时输出HTML/);
    });
}
test('恢复同章草稿按普通续写承接，不重启半章或强制第二轮', async () => {
    const draft = '旧'.repeat(3000);
    const { result, requests } = await exercise({ target: 6000, draft, pieces: [draft + '新'.repeat(2500)] });
    assert.equal(result.rounds, 1); assert.equal(result.actualChars, 5500);
    assert.equal(result.record.draft.text, draft + '新'.repeat(2500));
    assert.doesNotMatch(requests[0].userPrompt, /本轮只写本章前半部分/);
    assert.match(requests[0].userPrompt, /本章已有约 3000 字/);
});
test('允许收尾但仍不足九成时继续补写，不把许可当达标', async () => {
    const { result, requests } = await exercise({ target: 8000, max: 4, pieces: ['甲'.repeat(4000), '乙'.repeat(100), '丙'.repeat(3500)] });
    assert.equal(result.rounds, 3); assert.equal(result.actualChars, 7600);
    assert.match(requests[1].userPrompt, /本轮可以在本章情节充分展开后自然收束/);
    assert.match(requests[2].userPrompt, /收尾许可不等于字数达标/);
});
test('达到最大轮数仍不足时保存完整候选并明确不足，不越界继续', async () => {
    const { result, requests } = await exercise({ target: 8000, max: 2, pieces: ['甲'.repeat(100), '乙'.repeat(100)] });
    assert.equal(requests.length, 2); assert.equal(result.completedBelowTarget, true);
    assert.equal(result.actualChars, 200); assert.equal(result.record.chapters.length, 1);
});
test('已完成正文的排版恢复只排版，不重新写作或占用正文轮数', async () => {
    const { result, requests } = await exercise({ target: 6000, draft: '旧'.repeat(5500), resumeRendering: true, pieces: [] });
    assert.equal(requests.length, 0); assert.equal(result.rounds, 0); assert.equal(result.actualChars, 5500);
});
test('强制第二轮中失败仍保存首轮及已收到的新正文，不改正式章节', async () => {
    const record = makeRecord(); let renderCalls = 0;
    const controller = createLongDreamGenerationController({ checkpointIntervalMs: 0,
        requestChapter: async ({ round, onChunk }) => {
            if (round === 1) return { text: '甲'.repeat(5700), stopReason: 'stop' };
            onChunk('乙'.repeat(100)); throw new Error('synthetic network failure');
        },
        renderChapter: async () => { renderCalls++; return ''; },
    });
    await assert.rejects(controller.run({ record, targetChars: 6000, autoContinue: true, maxRounds: 3 }), error => {
        assert.equal(error.longDreamRecord.draft.text, '甲'.repeat(5700) + '\n\n' + '乙'.repeat(100));
        assert.equal(error.longDreamRecord.chapters.length, 1);
        return true;
    });
    assert.equal(renderCalls, 0); assert.equal(controller.active, null);
});
test('预估和生成共享同一分轮计划，草稿/小目标/单轮边界一致', () => {
    assert.deepEqual(longDreamWritingPlan({ targetChars: 3000, autoContinue: true, maxRounds: 3 }), { shouldAutoContinue: false, allowedRounds: 1, stagedMultiRound: false });
    assert.equal(longDreamWritingPlan({ targetChars: 5000, autoContinue: true, maxRounds: 3 }).stagedMultiRound, true);
    assert.equal(longDreamWritingPlan({ targetChars: 5000, autoContinue: true, maxRounds: 3, existingDraftText: '旧正文' }).stagedMultiRound, false);
    assert.equal(longDreamWritingPlan({ targetChars: 8000, autoContinue: true, maxRounds: 1 }).allowedRounds, 1);
});
