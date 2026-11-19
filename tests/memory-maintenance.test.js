import test from 'node:test';
import assert from 'node:assert/strict';
import { createLongDreamRecord, appendLongDreamChapter, normalizeLongDreamRecord, deleteLongDreamMemoryV2RecordItem, rejectLongDreamMemoryV2RecordItem } from '../long-dream.js';
import { applyLongDreamMemoryOperations } from '../long-dream-memory-model.js';
import { sanitizeLongDreamBackupRecord } from '../long-dream-backup.js';

function dream() {
    let record = createLongDreamRecord({ title: '雨夜', source: { text: '第一章。', html: '<p>1</p>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<p>2</p>' });
    return normalizeLongDreamRecord({ ...record, id: 1, memory: { ...record.memory, status: 'ready', pendingChapterNumbers: [], processedThroughChapter: 2,
        currentState: '第 1 章：她拿到账本。', storyEntries: [],
        states: [{ id: 'state-loc', subjects: ['林晚'], attribute: 'location', topic: '住处', value: '码头旁的旧楼', validFromChapter: 1, sourceChapterNumbers: [1] }],
        threads: [{ id: 'thread-key', threadKey: '银钥匙', kind: 'mystery', status: 'open', content: '银钥匙能开哪扇门', introducedAt: 1, lastTouchedAt: 1, subjects: ['林晚'], sourceChapterNumbers: [1] }] } });
}

test('普通删除：条目移除、记下删过，不让全篇概要变成待核对', () => {
    const record = dream();
    const deleted = deleteLongDreamMemoryV2RecordItem(record, 'thread', 'thread-key');
    assert.equal(deleted.memory.threads.length, 0);
    assert.deepEqual(deleted.memory.deletedItems.map(item => [item.kind, item.id, item.threadKey]), [['thread', 'thread-key', '银钥匙']]);
    assert.equal(deleted.memory.currentState, record.memory.currentState);
    assert.notEqual(deleted.memory.summaryDecisionsChanged, true);
    assert.equal(deleted.memory.rejections.length, 0);
    const rejected = rejectLongDreamMemoryV2RecordItem(record, 'thread', 'thread-key');
    assert.equal(rejected.memory.summaryDecisionsChanged, true, '“以后别再记”沿用原来的保护');
});

test('删掉的条目后面又被写到：当新内容记下，不弹“需要你决定”', () => {
    let memory = deleteLongDreamMemoryV2RecordItem(deleteLongDreamMemoryV2RecordItem(dream(), 'thread', 'thread-key'), 'state', 'state-loc').memory;
    const { memory: result } = applyLongDreamMemoryOperations(memory, [
        { op: 'set_state', targetId: 'state-loc', subjects: ['林晚'], attribute: 'location', topic: '住处', value: '搬去了城南', chapterNumber: 3 },
        { op: 'advance_thread', targetId: 'thread-key', progress: '在账本夹层找到对应的刻痕', chapterNumber: 3 },
    ], { worldLineRelation: 'canon' });
    assert.equal(result.pendingConflicts.length, 0);
    assert.equal(result.states.length, 1);
    assert.equal(result.states[0].value, '搬去了城南');
    assert.notEqual(result.states[0].id, 'state-loc');
    assert.equal(result.threads.length, 1);
    assert.equal(result.threads[0].threadKey, '银钥匙');
    assert.equal(result.threads[0].status, 'progressed');
    assert.match(result.threads[0].content, /刻痕/);
});

test('删掉的事项后来“解决 / 放弃”：直接跳过，不新建已结束的事项，也不弹窗', () => {
    const memory = deleteLongDreamMemoryV2RecordItem(dream(), 'thread', 'thread-key').memory;
    const { memory: result } = applyLongDreamMemoryOperations(memory, [
        { op: 'resolve_thread', threadKey: '银钥匙', resolution: '打开了仓库后门', chapterNumber: 3 },
        { op: 'abandon_thread', targetId: 'thread-key', reason: '钥匙丢了', chapterNumber: 3 },
    ], { worldLineRelation: 'canon' });
    assert.equal(result.pendingConflicts.length, 0);
    assert.equal(result.threads.length, 0);
});

test('不是被删掉的“找不到”照旧要问（保护不变）', () => {
    const { memory: result } = applyLongDreamMemoryOperations(dream().memory, [
        { op: 'advance_thread', targetId: 'thread-never-existed', progress: '有了进展', chapterNumber: 3 },
    ], { worldLineRelation: 'canon' });
    assert.equal(result.pendingConflicts.length, 1);
    assert.equal(result.pendingConflicts[0].reason, 'missing-target');
});

test('删过的记录刷新页面和备份后还在', () => {
    const deleted = deleteLongDreamMemoryV2RecordItem(dream(), 'state', 'state-loc');
    assert.equal(normalizeLongDreamRecord(JSON.parse(JSON.stringify(deleted))).memory.deletedItems.length, 1);
    assert.equal(sanitizeLongDreamBackupRecord(deleted).memory.deletedItems.length, 1);
});

import { weaveMemoryText } from '../long-dream-memory.js';

test('织梦脉的已有梦脉：不超长时原样发送；超长时先省概要和已结束事项，当前状态全部保留', () => {
    const states = Array.from({ length: 150 }, (_, i) => ({ id: 'state-' + i, subjects: ['林晚'], attribute: 'relationship', topic: '主题' + i, value: '表面疏离，私下仍会替对方遮掩。'.repeat(3), validFromChapter: 1, sourceChapterNumbers: [1] }));
    const transitions = Array.from({ length: 80 }, (_, i) => ({ id: 'tr-' + i, subjects: ['林晚'], domain: 'relationship', from: '提防', to: '同谋', cause: '码头那夜她替他挡下盘问。'.repeat(3), sourceChapterNumbers: [1] }));
    const threads = [
        { id: 'th-open', threadKey: '银钥匙', kind: 'mystery', status: 'open', content: '钥匙开哪扇门', introducedAt: 1, lastTouchedAt: 1, subjects: ['林晚'], sourceChapterNumbers: [1] },
        { id: 'th-done', threadKey: '旧信', kind: 'mystery', status: 'resolved', content: '旧信是谁写的', resolution: '是母亲', introducedAt: 1, lastTouchedAt: 2, subjects: ['林晚'], sourceChapterNumbers: [1] },
    ];
    const small = { currentState: '第 1 章：她拿到账本。', states: states.slice(0, 3), threads };
    assert.equal(weaveMemoryText(small, 16000).includes('【故事概要'), true);
    assert.equal(weaveMemoryText(small, 16000).includes('旧信'), true);
    assert.doesNotMatch(weaveMemoryText(small, 16000), /梦脉较多/);
    const big = { currentState: '第 1 章：她拿到账本。'.repeat(200), states, transitions, threads };
    const text = weaveMemoryText(big, 16000);
    assert.ok(text.length <= 16000);
    assert.match(text, /梦脉较多/);
    assert.doesNotMatch(text, /【故事概要/);
    assert.doesNotMatch(text, /旧信/);
    assert.match(text, /银钥匙/);
    assert.equal((text.match(/\[id=state-/g) || []).length, 150);
});

import { buildLongDreamMemoryPayload } from '../long-dream-memory.js';

test('织梦脉规则：同一人物同一方面只留一条当前状态', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<p>1</p>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<p>2</p>' });
    const { systemPrompt } = buildLongDreamMemoryPayload({ record });
    assert.match(systemPrompt, /同一方面只保留一条当前状态/);
    assert.match(systemPrompt, /必须带它的 targetId 更新/);
});

import { selectRelevantLongDreamMemoryItems } from '../long-dream-payload.js';

test('写正文挑梦脉：主角的身份、关系、知情状态固定带上，其余名额仍按相关度', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<p>1</p>' } });
    for (let n = 2; n <= 10; n++) record = appendLongDreamChapter(record, { text: `第${n}章。`, html: '<p>x</p>' });
    const main = [
        { id: 'main-id', subjects: ['林晚'], attribute: 'identity', topic: '身份', value: '码头账房，暗中替巡捕房做事', validFromChapter: 1, sourceChapterNumbers: [1] },
        { id: 'main-rel', subjects: ['林晚', '沈砚'], attribute: 'relationship', topic: '关系', value: '彼此试探的盟友', validFromChapter: 2, sourceChapterNumbers: [2] },
        { id: 'main-know', subjects: ['沈砚'], attribute: 'knowledge', topic: '账本', value: '不知道账本在林晚手里', validFromChapter: 3, sourceChapterNumbers: [3] },
        { id: 'main-loc', subjects: ['林晚'], attribute: 'location', topic: '住处', value: '旧楼', validFromChapter: 1, sourceChapterNumbers: [1] },
    ];
    const crowd = Array.from({ length: 40 }, (_, i) => ({ id: 'crowd-' + i, subjects: ['茶楼伙计' + i], attribute: 'other', topic: '茶楼', value: '在茶楼里听戏、喝茶、谈论码头', validFromChapter: 10, sourceChapterNumbers: [10] }));
    record = normalizeLongDreamRecord({ ...record, memory: { ...record.memory, states: [...main, ...crowd] } });
    const picked = selectRelevantLongDreamMemoryItems(record, { instruction: '写茶楼里众人听戏、喝茶、谈论码头的一场戏' })
        .filter(entry => entry.kind === 'state').map(entry => entry.item.id);
    for (const id of ['main-id', 'main-rel', 'main-know']) assert.ok(picked.includes(id), id + ' 应该被带上');
    assert.ok(picked.filter(id => id.startsWith('crowd-')).length >= 4, '其余名额仍给相关的条目');
});
