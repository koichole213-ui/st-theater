import test from 'node:test';
import assert from 'node:assert/strict';
import { createLongDreamRecord, appendLongDreamChapter, normalizeLongDreamRecord } from '../long-dream.js';
import { chapterSummarySources, saveStorySummary, condenseSummaryPlan, saveCondensedSummary, restoreStorySummary, validateStorySources, invalidateStoryDecisions } from '../long-dream-story-summary.js';
import { condenseLongDreamSummary, buildLongDreamCondensePayload, summaryRevision } from '../long-dream-summary.js';
import { buildLongDreamChapterPayload } from '../long-dream-payload.js';

const entryText = n => `第${n}章概要：` + '她在码头撞见旧友交易，带走账本，两人关系裂开，银钥匙的伏笔留了下来。'.repeat(6);

function dreamWithSummaries(count = 8) {
    let record = createLongDreamRecord({ title: '雨夜', canon: '林晚是码头账房。', source: { text: '第1章正文。', html: '<p>1</p>' } });
    for (let n = 2; n <= count; n++) record = appendLongDreamChapter(record, { text: `第${n}章正文。`, html: `<p>${n}</p>` });
    const sources = chapterSummarySources(record.chapters);
    record = saveStorySummary(record, record.chapters.map(chapter => ({ chapterNumber: chapter.number, text: entryText(chapter.number), source: sources[chapter.number - 1] })));
    return normalizeLongDreamRecord({ ...record, id: 1, memory: { ...record.memory, status: 'ready', pendingChapterNumbers: [], processedThroughChapter: count } });
}

test('精简范围：最近 3 章保留逐章，较早章节送去压缩；章节少或概要短时不精简', () => {
    const plan = condenseSummaryPlan(dreamWithSummaries(8));
    assert.equal(plan.through, 5);
    assert.match(plan.source, /第 1 章：第1章概要/);
    assert.match(plan.source, /第 5 章：第5章概要/);
    assert.doesNotMatch(plan.source, /第6章概要/);
    assert.ok(plan.targetChars < plan.maxChars && plan.maxChars < plan.source.length);
    assert.match(condenseSummaryPlan(dreamWithSummaries(4)).reason, /满 5 章/);
    const short = dreamWithSummaries(8);
    const sources = chapterSummarySources(short.chapters);
    const tiny = saveStorySummary(short, short.chapters.map(c => ({ chapterNumber: c.number, text: '短。', source: sources[c.number - 1] })));
    assert.match(condenseSummaryPlan(tiny).reason, /还不长/);
    const missing = { ...short, memory: { ...short.memory, storyEntries: short.memory.storyEntries.filter(e => e.chapterNumber !== 2) } };
    assert.match(condenseSummaryPlan(missing).reason, /缺少概要/);
});

test('精简后续写用整篇概要 + 最近 3 章逐章；逐章概要原样留着；旧版可恢复', () => {
    const record = dreamWithSummaries(8);
    const condensed = saveCondensedSummary(record, '精简后的前五章：她卷入码头账本风波，与旧友决裂，银钥匙未解。', 5);
    assert.equal(condensed.memory.manualFullSummary.chapterNumber, 5);
    assert.equal(condensed.memory.storyEntries.length, 8, '逐章概要留作后备');
    assert.match(condensed.memory.currentState, /^精简后的前五章/);
    assert.match(condensed.memory.currentState, /第 6 章：第6章概要/);
    assert.doesNotMatch(condensed.memory.currentState, /第 2 章：/);
    assert.equal(condensed.memory.summaryNeedsRefresh, false);
    const prompt = buildLongDreamChapterPayload({ record: condensed, instruction: '写第九章' }).userPrompt;
    assert.match(prompt, /精简后的前五章/);
    assert.doesNotMatch(prompt, /第 3 章：第3章概要/);
    const before = condensed.memory.summaryVersions.find(v => !v.manualFullSummary);
    assert.ok(before, '精简前的版本进了最近版本');
    const restored = restoreStorySummary(condensed, before.id);
    assert.equal(restored.memory.manualFullSummary, null);
    assert.match(restored.memory.currentState, /第 2 章：第2章概要/);
});

test('精简后改了较早章节正文：整篇概要失效，退回逐章概要，不会一下子什么都没有', () => {
    const condensed = saveCondensedSummary(dreamWithSummaries(8), '精简后的前五章。'.repeat(20), 5);
    const chapters = condensed.chapters.map(c => c.number === 2 ? { ...c, text: '第2章正文被改过。' } : c);
    const memory = validateStorySources(condensed.memory, chapters);
    assert.equal(memory.manualFullSummary, null);
    assert.match(memory.currentState, /第 1 章：第1章概要/, '没被改动的章节概要还在');
    assert.equal(memory.summaryNeedsRefresh, true, '改过的章节等着补概要');
});

test('改梦脉条目后精简版变成“待核对”（沿用现有保护）', () => {
    const condensed = saveCondensedSummary(dreamWithSummaries(8), '精简后的前五章。'.repeat(20), 5);
    const memory = { ...condensed.memory, ...invalidateStoryDecisions(condensed.memory) };
    assert.equal(memory.manualFullSummary.needsReview, true);
    assert.match(condenseSummaryPlan({ ...condensed, memory }).reason, /核对/);
});

test('精简请求：带上设定与较早概要；结果合格才保存', async () => {
    const record = dreamWithSummaries(8);
    const payload = buildLongDreamCondensePayload(record);
    assert.match(payload.userPrompt, /林晚是码头账房/);
    assert.match(payload.userPrompt, /第 1～5 章的现有概要/);
    assert.match(payload.systemPrompt, /不超过 \d+ 字/);
    let saved = null;
    const result = await condenseLongDreamSummary({ record, request: async () => ({ text: '<think>想一想</think>\n精简后的前五章：' + '账本风波。'.repeat(60) }),
        readLatest: async () => record, save: async next => (saved = next) });
    assert.equal(result.through, 5);
    assert.match(saved.memory.manualFullSummary.text, /^精简后的前五章/);
    assert.doesNotMatch(saved.memory.manualFullSummary.text, /想一想/);
});

test('精简失败时原概要原样保留：结果为空、没变短、太短、超时、等待期间作品被改', async () => {
    const record = dreamWithSummaries(8);
    const plan = condenseSummaryPlan(record);
    let saves = 0;
    const run = (text, extra = {}) => condenseLongDreamSummary({ record, request: async () => ({ text }), readLatest: async () => record, save: async () => { saves++; return true; }, ...extra });
    await assert.rejects(run('   '), { code: 'LONG_DREAM_CONDENSE_EMPTY' });
    await assert.rejects(run('长'.repeat(plan.maxChars + 1)), { code: 'LONG_DREAM_CONDENSE_NOT_SHORTER' });
    await assert.rejects(run('太短了。'), { code: 'LONG_DREAM_CONDENSE_TOO_SHORT' });
    await assert.rejects(condenseLongDreamSummary({ record, timeoutMs: 20, request: () => new Promise(() => {}), readLatest: async () => record, save: async () => { saves++; return true; } }), { code: 'LONG_DREAM_SUMMARY_TIMEOUT' });
    const changed = { ...record, canon: '设定改了' };
    assert.equal(await run('精简。'.repeat(80), { readLatest: async () => changed }), null);
    assert.equal(saves, 0);
});

import { saveManualStorySummary } from '../long-dream-summary-editor.js';

test('小砚①：精简后在“编辑概要”原样保存，被盖住的逐章记录仍保留；之后改旧章正文也不会完全没有概要', () => {
    const condensed = saveCondensedSummary(dreamWithSummaries(8), '精简后的前五章。'.repeat(20), 5);
    const resaved = saveManualStorySummary(condensed, [6, 7, 8].map(n => ({ chapterNumber: n, text: entryText(n) })), summaryRevision(condensed), undefined,
        { fullSummary: { text: condensed.memory.manualFullSummary.text, chapterNumber: 5 } });
    assert.deepEqual(resaved.memory.storyEntries.map(e => e.chapterNumber), [1, 2, 3, 4, 5, 6, 7, 8]);
    const chapters = resaved.chapters.map(c => c.number === 4 ? { ...c, text: '第4章被改过。' } : c);
    const memory = validateStorySources(resaved.memory, chapters);
    assert.match(memory.currentState, /第 1 章：第1章概要/);
    assert.match(memory.currentState, /第 3 章：第3章概要/);
});

test('小砚⑤：整篇概要已经写进最近三章时不精简', () => {
    const record = dreamWithSummaries(8);
    const sources = chapterSummarySources(record.chapters);
    const handFull = { ...record, memory: { ...record.memory, manualFullSummary: { text: '手写整篇。'.repeat(180), chapterNumber: 8, sources } } };
    assert.match(condenseSummaryPlan(handFull).reason, /包含了最近 3 章/);
    const four = dreamWithSummaries(4);
    const handFour = { ...four, memory: { ...four.memory, manualFullSummary: { text: '手写整篇。'.repeat(180), chapterNumber: 4, sources: chapterSummarySources(four.chapters) } } };
    assert.ok(condenseSummaryPlan(handFour).reason);
});

test('小砚⑥：“最近版本”满 5 版、恢复最老一版后再精简，刚才那版仍能找回', () => {
    let record = dreamWithSummaries(8);
    const sources = chapterSummarySources(record.chapters);
    for (let round = 1; round <= 5; round++) {
        record = saveStorySummary(record, record.chapters.map(c => ({ chapterNumber: c.number, text: `第${round}版：` + entryText(c.number), source: sources[c.number - 1] })));
    }
    assert.equal(record.memory.summaryVersions.length, 5);
    const oldest = record.memory.summaryVersions[0];
    record = restoreStorySummary(record, oldest.id);
    const before = record.memory.currentState;
    const condensed = saveCondensedSummary(record, '精简后的前五章。'.repeat(20), 5);
    assert.ok(condensed.memory.summaryVersions.some(v => v.text === before), '精简前那一版还在最近版本里');
});
