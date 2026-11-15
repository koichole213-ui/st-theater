// 从 core.test.js 拆出：long-dream-memory
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { LONG_DREAM_MEMORY_STATUS, LONG_DREAM_SCHEMA_VERSION, LONG_DREAM_WORLD_BOOK_POLICY, LONG_DREAM_WORLD_LINE_RELATION, appendLongDreamChapter, applyLongDreamMemoryPatch, createLongDreamBranch, createLongDreamRecord, deleteLongDreamFrom, normalizeLongDreamRecord, prepareLongDreamMemoryRegeneration, rejectLongDreamMemoryV2RecordItem, resolveLongDreamMemoryV2RecordConflict, setLongDreamMemoryCardStatus, updateLongDreamDefinition, updateLongDreamMemoryCard, updateLongDreamMemoryV2RecordItem } from '../long-dream.js';
import { longDreamChapterContext, selectRelevantLongDreamMemoryCards, selectRelevantLongDreamMemoryItems } from '../long-dream-payload.js';
import { createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { buildLongDreamMemoryPayload, parseLongDreamMemoryResponse, pendingLongDreamChapters, shouldWeaveLongDreamMemory } from '../long-dream-memory.js';
import { LONG_DREAM_MEMORY_OUTPUT_CONTRACT, builtinLongDreamMemoryPreset, exportLongDreamMemoryPreset, normalizeLongDreamMemoryPresetList, parseLongDreamMemoryPreset } from '../long-dream-memory-presets.js';

test('梦脉织录按三章批量、只读已确认章节，并以补丁追加而不删除旧记忆', () => {
    let record = createLongDreamRecord({
        canon: '故事发生在旧港。',
        source: { text: '第一章正文。', html: '<main>第一章正文。</main>' },
    });
    record = appendLongDreamChapter(record, { text: '第二章正文。', html: '<main>第二章正文。</main>' });
    assert.equal(shouldWeaveLongDreamMemory(record, { batchSize: 3 }), false);
    record = appendLongDreamChapter(record, { text: '第三章正文。', html: '<main>第三章正文。</main>' });
    assert.deepEqual(pendingLongDreamChapters(record).map(chapter => chapter.number), [1, 2, 3]);
    assert.equal(shouldWeaveLongDreamMemory(record, { batchSize: 3 }), true);

    record.memory.cards = [{ type: '伏笔', content: '旧钥匙尚未使用。', chapterNumber: 1, status: 'active' }];
    const request = buildLongDreamMemoryPayload({ record });
    assert.deepEqual(request.pendingChapterNumbers, [1, 2, 3]);
    assert.match(request.systemPrompt, /梦脉增量织录/);
    assert.match(request.userPrompt, /固定 JSON 输出合同/);
    assert.match(request.userPrompt, /第一章正文/);
    assert.match(request.userPrompt, /第三章正文/);
    assert.match(request.userPrompt, /旧钥匙尚未使用/);

    const patch = parseLongDreamMemoryResponse(JSON.stringify({
        currentState: '两人目前位于旧港钟楼。',
        cards: [{ type: '地点/物品', content: '旧钥匙打开了钟楼侧门。', chapterNumber: 3, tags: ['旧钥匙', '钟楼'] }],
    }), { pendingChapterNumbers: request.pendingChapterNumbers });
    const updated = applyLongDreamMemoryPatch(record, patch, request.throughChapter);
    assert.equal(updated.memory.processedThroughChapter, 3);
    assert.deepEqual(updated.memory.pendingChapterNumbers, []);
    assert.equal(updated.memory.cards.some(card => card.content === '旧钥匙尚未使用。'), true);
    assert.equal(updated.memory.cards.some(card => card.content === '旧钥匙打开了钟楼侧门。'), true);
    assert.equal(updated.memory.currentState, ''); // Legacy cards remain compatible, but a recent-only synopsis cannot replace story history.
    assert.equal(updated.memory.summaryNeedsRefresh, true);
});

test('梦脉用 type + key 原位更新有效状态，并保留人工修改的用户主权', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<main>第二章。</main>' });
    record = applyLongDreamMemoryPatch(record, {
        cards: [{ type: '人物状态', key: '林岚/所在地点', content: '林岚在旧港。', chapterNumber: 1, sourceChapterNumbers: [1], tags: ['林岚', '旧港'] }],
    }, 1);
    record = applyLongDreamMemoryPatch(record, {
        cards: [{ type: '人物状态', key: '林岚/所在地点', content: '林岚已进入钟楼。', chapterNumber: 2, sourceChapterNumbers: [2], tags: ['林岚', '钟楼'] }],
    }, 2);
    assert.equal(record.memory.cards.length, 1);
    assert.equal(record.memory.cards[0].content, '林岚已进入钟楼。');
    assert.deepEqual(record.memory.cards[0].sourceChapterNumbers, [1, 2]);

    record = updateLongDreamMemoryCard(record, record.memory.cards[0].id, {
        content: '林岚正在钟楼顶层，而不是入口。', tags: ['林岚', '钟楼顶层'],
    });
    record = applyLongDreamMemoryPatch(record, {
        cards: [{ type: '人物状态', key: '林岚/所在地点', content: '林岚回到旧港。', chapterNumber: 2, sourceChapterNumbers: [2] }],
    }, 2);
    assert.equal(record.memory.cards[0].content, '林岚正在钟楼顶层，而不是入口。');
    assert.equal(record.memory.cards[0].editedByUser, true);

    record = setLongDreamMemoryCardStatus(record, record.memory.cards[0].id, 'dismissed');
    assert.equal(selectRelevantLongDreamMemoryCards(record, { instruction: '寻找林岚' }).length, 0);
    record = setLongDreamMemoryCardStatus(record, record.memory.cards[0].id, 'active');
    assert.equal(selectRelevantLongDreamMemoryCards(record, { instruction: '寻找林岚' }).length, 1);
});

test('梦脉 v2 按章节顺序应用状态增量，旧值进入历史且新值不继承旧来源', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<main>第二章。</main>' });
    record = appendLongDreamChapter(record, { text: '第三章。', html: '<main>第三章。</main>' });
    const patch = parseLongDreamMemoryResponse(JSON.stringify({
        storyEntries: [1, 2, 3].map(chapterNumber => ({ chapterNumber, text: `第${chapterNumber}章经历` })),
        operations: [
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 },
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '钟楼顶层', chapterNumber: 3 },
        ],
    }), { pendingChapterNumbers: [1, 2, 3] });
    record = applyLongDreamMemoryPatch(record, patch, 3);
    assert.equal(record.memory.schemaVersion, 2);
    assert.equal(record.memory.states.length, 1);
    assert.equal(record.memory.states[0].value, '钟楼顶层');
    assert.equal(record.memory.states[0].validFromChapter, 3);
    assert.deepEqual(record.memory.states[0].sourceChapterNumbers, [3]);
    assert.deepEqual(record.memory.states[0].history.map(item => item.value), ['旧港入口']);
    assert.deepEqual(record.memory.states[0].history[0].sourceChapterNumbers, [1]);
    assert.match(record.memory.currentState, /第 1 章：第1章经历[\s\S]*第 3 章：第3章经历/);
});

test('梦脉 v2 未完事项保存推进历史、解决结果，并阻止已关闭事项静默重开', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    for (let number = 2; number <= 4; number++) record = appendLongDreamChapter(record, { text: `第${number}章。`, html: `<main>第${number}章。</main>` });
    record = applyLongDreamMemoryPatch(record, {
        currentState: '两人仍在调查。',
        operations: [
            { op: 'open_thread', threadKey: '失踪列车记录', kind: 'mystery', content: '寻找失踪列车记录', chapterNumber: 1 },
            { op: 'advance_thread', threadKey: '失踪列车记录', progress: '发现列车编号', chapterNumber: 2 },
            { op: 'resolve_thread', threadKey: '失踪列车记录', resolution: '在钟楼暗门后找到完整记录', chapterNumber: 3 },
        ],
    }, 3);
    assert.equal(record.memory.threads.length, 1);
    assert.equal(record.memory.threads[0].status, 'resolved');
    assert.equal(record.memory.threads[0].resolution, '在钟楼暗门后找到完整记录');
    assert.deepEqual(record.memory.threads[0].progressHistory.map(item => item.content), ['发现列车编号']);
    record = applyLongDreamMemoryPatch(record, {
        currentState: '这段摘要不应覆盖。',
        operations: [{ op: 'open_thread', threadKey: '失踪列车记录', kind: 'mystery', content: '重新寻找记录', chapterNumber: 4 }],
    }, 4);
    assert.equal(record.memory.threads.length, 1);
    assert.equal(record.memory.pendingConflicts.length, 1);
    assert.equal(record.memory.currentState, '两人仍在调查。');
});

test('梦脉冲突提示展示原梦脉和本章新变化，不再只给冲突类型', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    for (let number = 2; number <= 4; number++) record = appendLongDreamChapter(record, { text: `第${number}章。`, html: `<main>第${number}章。</main>` });
    record = applyLongDreamMemoryPatch(record, { operations: [
        { op: 'open_thread', threadKey: '失踪列车记录', kind: 'mystery', content: '寻找失踪列车记录', chapterNumber: 1 },
        { op: 'resolve_thread', threadKey: '失踪列车记录', resolution: '在钟楼暗门后找到完整记录', chapterNumber: 3 },
    ] }, 3);
    record = applyLongDreamMemoryPatch(record, { operations: [
        { op: 'open_thread', threadKey: '失踪列车记录', kind: 'mystery', content: '重新寻找记录', chapterNumber: 4 },
    ] }, 4);
    const source = readTheaterImplementation();
    const helpers = source.slice(source.indexOf('function longDreamMemoryConflictTarget('), source.indexOf('function longDreamMemoryCardsHTML('));
    const scope = { longDreamExcerpt: (value, limit) => String(value || '').slice(0, limit) };
    const result = runInNewContext(`${helpers}\nlongDreamMemoryConflictDetails(memory, conflict);`, {
        ...scope,
        memory: record.memory,
        conflict: record.memory.pendingConflicts[0],
    });
    assert.match(result.original, /失踪列车记录[\s\S]*已解决[\s\S]*钟楼暗门/);
    assert.match(result.incoming, /失踪列车记录[\s\S]*重新寻找记录/);

    const operations = [
        [{ op: 'set_state', subjects: '林岚', attribute: 'location', value: '钟楼顶层' }, /林岚[\s\S]*钟楼顶层/],
        [{ op: 'append_transition', subjects: ['林岚', '周砚'], from: '互相试探', to: '共同承担风险', cause: '坦白身份' }, /林岚、周砚[\s\S]*互相试探 → 共同承担风险[\s\S]*坦白身份/],
        [{ op: 'advance_thread', threadKey: '失踪列车记录', progress: '发现列车编号' }, /失踪列车记录[\s\S]*发现列车编号/],
        [{ op: 'resolve_thread', threadKey: '失踪列车记录', resolution: '找回完整记录' }, /本章提出已解决[\s\S]*找回完整记录/],
        [{ op: 'abandon_thread', threadKey: '旧约定', reason: '双方明确取消' }, /本章提出已放弃[\s\S]*双方明确取消/],
        [{ op: 'upsert_deviation', deviationKey: '人物关系', dreamChange: '两人没有血缘关系' }, /人物关系[\s\S]*没有血缘关系/],
    ];
    for (const [operation, expected] of operations) {
        const text = runInNewContext(`${helpers}\nlongDreamMemoryConflictOperationText(operation);`, { ...scope, operation });
        assert.match(text, expected);
    }
    const restored = normalizeLongDreamRecord({
        ...record,
        memory: {
            ...record.memory,
            pendingConflicts: [{
                id: 'legacy-string-subjects',
                reason: 'locked-by-user',
                operation: { op: 'set_state', subjects: '旧备份主体', attribute: 'location', value: '旧港入口', chapterNumber: 4 },
                chapterNumber: 4,
            }],
        },
    });
    const restoredDetails = runInNewContext(`${helpers}\nlongDreamMemoryConflictDetails(memory, conflict);`, {
        ...scope,
        memory: restored.memory,
        conflict: restored.memory.pendingConflicts[0],
    });
    assert.match(restoredDetails.incoming, /旧备份主体[\s\S]*旧港入口/);
});

test('用户锁定状态产生持久冲突，用户可选择采用新变化或保留原记忆', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<main>第二章。</main>' });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 }],
    }, 1);
    record = updateLongDreamMemoryV2RecordItem(record, 'state', record.memory.states[0].id, { value: '旧港钟楼入口' });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', targetId: record.memory.states[0].id, subjects: ['林岚'], attribute: 'location', value: '钟楼顶层', chapterNumber: 2 }],
    }, 2);
    assert.equal(record.memory.states[0].value, '旧港钟楼入口');
    assert.equal(record.memory.pendingConflicts[0].reason, 'locked-by-user');

    const accepted = resolveLongDreamMemoryV2RecordConflict(record, record.memory.pendingConflicts[0].id, 'accept');
    assert.equal(accepted.memory.states[0].value, '钟楼顶层');
    assert.equal(accepted.memory.pendingConflicts.length, 0);

    const conflictAgain = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', targetId: record.memory.states[0].id, subjects: ['林岚'], attribute: 'location', value: '钟楼顶层', chapterNumber: 2 }],
    }, 2);
    const kept = resolveLongDreamMemoryV2RecordConflict(conflictAgain, conflictAgain.memory.pendingConflicts[0].id, 'keep');
    assert.equal(kept.memory.states[0].value, '旧港钟楼入口');
    assert.equal(kept.memory.rejections.length, 1);
});

test('用户否定的错误梦脉不会被同一增量直接复活', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 }],
    }, 1);
    record = rejectLongDreamMemoryV2RecordItem(record, 'state', record.memory.states[0].id, '章节没有写过这件事');
    assert.equal(record.memory.states.length, 0);
    assert.equal(record.memory.rejections.length, 1);
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 }],
    }, 1);
    assert.equal(record.memory.states.length, 0);
    assert.equal(record.memory.pendingConflicts[0].reason, 'rejected-by-user');
});

test('完全隔离的长梦拒绝世界线偏离操作，但仍应用同批合法状态', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = applyLongDreamMemoryPatch(record, {
        operations: [
            { op: 'upsert_deviation', deviationKey: '人物关系', dreamChange: '两人不是兄妹', chapterNumber: 1 },
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港', chapterNumber: 1 },
        ],
    }, 1);
    assert.equal(record.memory.deviations.length, 0);
    assert.equal(record.memory.states.length, 1);
});

test('梦脉 v2 主 API 检索按层选择，不让所有记忆继续争同一类卡片排名', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = applyLongDreamMemoryPatch(record, {
        currentState: '林岚在旧港等待退潮。',
        operations: [
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港钟楼', chapterNumber: 1, tags: ['林岚', '旧港'] },
            { op: 'append_transition', domain: 'relationship', subjects: ['林岚', '周砚'], from: '互相试探', to: '共同承担风险', cause: '周砚坦白身份', chapterNumber: 1 },
            { op: 'open_thread', threadKey: '退潮暗门', kind: 'mystery', content: '等待退潮后开启暗门', chapterNumber: 1, tags: ['暗门'] },
        ],
    }, 1);
    record = updateLongDreamDefinition(record, {
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldLineRelation: LONG_DREAM_WORLD_LINE_RELATION.PARALLEL,
    });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'upsert_deviation', deviationKey: '林岚与周砚/关系', subjects: ['林岚', '周砚'], originalCanon: '原线是兄妹', dreamChange: '本梦没有血缘关系', chapterNumber: 1 }],
    }, 1);
    const selected = selectRelevantLongDreamMemoryItems(record, { instruction: '林岚和周砚去打开退潮暗门。' });
    assert.deepEqual(new Set(selected.map(item => item.kind)), new Set(['state', 'thread', 'deviation', 'transition']));
    const context = longDreamChapterContext(record, { instruction: '林岚和周砚去打开退潮暗门。' });
    assert.match(context.memory, /故事概要.*：林岚在旧港等待退潮/);
    assert.match(context.memory, /当前状态|关键变化|事项|世界线偏离/);
});

test('旧版梦脉保守迁移稳定状态，原卡片和 v2 备份字段都不会丢失', () => {
    const record = normalizeLongDreamRecord({
        title: '旧卷',
        chapters: [{ text: '第一章。', html: '<main>第一章。</main>' }],
        memory: {
            cards: [{ id: 'old-state', type: '人物状态', key: '林岚/所在地点', content: '林岚位于旧港。', chapterNumber: 1, editedByUser: true }],
            currentState: '旧版人工脉象。',
        },
    });
    assert.equal(record.memory.cards.length, 1);
    assert.equal(record.memory.states.length, 1);
    assert.equal(record.memory.states[0].attribute, 'location');
    assert.equal(record.memory.states[0].lockedByUser, true);
    const imported = parseLongDreamBackup(createLongDreamBackup([record]));
    assert.equal(imported[0].memory.cards[0].content, '林岚位于旧港。');
    assert.equal(imported[0].memory.states[0].value, '林岚位于旧港。');
    assert.equal(imported[0].memory.currentState, '旧版人工脉象。');
});

test('梦脉二创 JSON 只能携带分析侧重点，输出合同固定且未知配置被忽略', () => {
    const preset = parseLongDreamMemoryPreset(JSON.stringify({
        format: 'st-theater-long-dream-memory-preset',
        version: 2,
        name: '人物弧光版',
        author: '小澄',
        focusPrompt: '优先识别人物长期变化。',
        outputContract: LONG_DREAM_MEMORY_OUTPUT_CONTRACT,
        apiKey: '不应保留',
        executable: '<script>bad()</script>',
    }));
    const exported = exportLongDreamMemoryPreset(preset);
    assert.equal(exported.focusPrompt, '优先识别人物长期变化。');
    assert.equal(exported.outputContract, 'long-dream-memory-v2');
    assert.equal('apiKey' in exported, false);
    assert.equal('executable' in exported, false);
});

test('重新生成整部梦脉会清理自动结果并保留人工校正、隐藏与否定记录', () => {
    let record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章', html: '<main>第二章</main>' });
    record.memory = {
        ...record.memory,
        schemaVersion: LONG_DREAM_SCHEMA_VERSION,
        processedThroughChapter: 2,
        pendingChapterNumbers: [],
        status: LONG_DREAM_MEMORY_STATUS.READY,
        currentState: '旧的自动摘要',
        states: [
            { id: 'auto-state', subjects: ['林岚'], attribute: 'location', value: '旧站', validFromChapter: 1 },
            { id: 'locked-state', subjects: ['林岚'], attribute: 'location', value: '港口', validFromChapter: 2, lockedByUser: true, editedByUser: true },
            { id: 'hidden-state', subjects: ['周遥'], attribute: 'goal', value: '离开', validFromChapter: 2, hiddenFromPrompt: true },
        ],
        cards: [
            { id: 'auto-card', type: '事实', content: '自动旧记录', chapterNumber: 1, status: 'active' },
            { id: 'edited-card', type: '事实', content: '手动修正记录', chapterNumber: 2, status: 'active', editedByUser: true },
            { id: 'dismissed-card', type: '事实', content: '已经否定的记录', chapterNumber: 1, status: 'dismissed' },
        ],
        rejections: [{ id: 'rejection-1', kind: 'state', signature: '错误地点', reason: '用户否定' }],
    };

    const regenerated = prepareLongDreamMemoryRegeneration(record, new Date('2026-08-12T08:00:00.000Z'));
    assert.equal(regenerated.memory.currentState, '旧的自动摘要');
    assert.equal(regenerated.memory.summaryNeedsRefresh, true);
    assert.equal(regenerated.memory.processedThroughChapter, 0);
    assert.deepEqual(regenerated.memory.pendingChapterNumbers, [1, 2]);
    assert.equal(regenerated.memory.status, LONG_DREAM_MEMORY_STATUS.PENDING);
    assert.deepEqual(regenerated.memory.states.map(item => item.id).sort(), ['hidden-state', 'locked-state']);
    assert.deepEqual(regenerated.memory.cards.map(item => item.id).sort(), ['dismissed-card', 'edited-card']);
    assert.equal(regenerated.memory.rejections[0].signature, '错误地点');
});

test('旧章分支、重写与删除保留原卷和范围内梦脉，移除越界记忆', () => {
    let original = createLongDreamRecord({
        title: '原卷',
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    original = appendLongDreamChapter(original, { text: '第二章', html: '<main>第二章</main>' });
    original = appendLongDreamChapter(original, { title: '岔路', instruction: '进入北门', text: '第三章', html: '<main>第三章</main>' });
    original = appendLongDreamChapter(original, { text: '第四章', html: '<main>第四章</main>' });
    original.id = 42;
    original.memory.cards = [{ id: 'old-memory', type: '事实', content: '旧时间线事实', chapterNumber: 3, status: 'active' }];
    original.memory.currentState = '旧时间线现状';

    const branch = createLongDreamBranch(original, 'chapter-3', {
        includeChapter: true,
        title: '北门支线',
    }, new Date('2026-08-08T01:00:00.000Z'));
    const rewrite = createLongDreamBranch(original, 'chapter-3', {
        includeChapter: false,
        title: '重写第三章',
    }, new Date('2026-08-08T02:00:00.000Z'));
    const deleted = deleteLongDreamFrom(original, 'chapter-3');

    assert.equal(original.chapters.length, 4);
    assert.equal(original.memory.cards.length, 1);
    assert.equal(branch.id, undefined);
    assert.equal(branch.title, '北门支线');
    assert.equal(branch.source.kind, 'long-dream-branch');
    assert.equal(branch.source.refId, 42);
    assert.equal(branch.chapters.length, 3);
    assert.equal(branch.memory.cards.length, 1);
    assert.deepEqual(branch.memory.pendingChapterNumbers, [1, 2, 3]);
    assert.equal(rewrite.chapters.length, 2);
    assert.deepEqual(rewrite.memory.pendingChapterNumbers, [1, 2]);
    assert.equal(deleted.chapters.length, 2);
    assert.equal(deleted.memory.cards.length, 0);
    assert.throws(() => deleteLongDreamFrom(original, 'chapter-1'), /第一章不能单独删除/);
});

test('重写任意后续章节保留已织录前章梦脉和概要，不修改原卷', () => {
    for (const chapter of [4, 6, 9]) {
        let record = createLongDreamRecord({ source: { text: '第一章', html: '<p>第一章</p>' } });
        for (let n = 2; n <= chapter; n++) record = appendLongDreamChapter(record, { text: `第${n}章`, html: '<p>正文</p>' });
        record = applyLongDreamMemoryPatch(record, { currentState: '前章概要原文', operations: [
            { op: 'set_state', subjects: ['甲'], attribute: 'relationship', value: '朋友', chapterNumber: chapter - 1 },
            { op: 'open_thread', threadKey: '约定', content: '一起看海', chapterNumber: 1 },
        ] }, chapter - 1);
        const before = JSON.stringify(record);
        const branch = createLongDreamBranch(record, `chapter-${chapter}`, { includeChapter: false });
        assert.equal(branch.chapters.length, chapter - 1);
        assert.deepEqual(branch.memory.states, record.memory.states);
        assert.deepEqual(branch.memory.threads, record.memory.threads);
        assert.equal(branch.memory.currentState, '前章概要原文');
        assert.equal(branch.memory.processedThroughChapter, chapter - 1);
        assert.deepEqual(branch.memory.pendingChapterNumbers, []);
        assert.equal(JSON.stringify(record), before);
    }
});

test('旧梦脉跨章状态还原历史，未来事件不进入重写前情，不可还原事项等待补织', () => {
    let record = createLongDreamRecord({ source: { text: '一', html: '<p>一</p>' } });
    for (let n = 2; n <= 6; n++) record = appendLongDreamChapter(record, { text: `第${n}章`, html: '<p>正文</p>' });
    record = applyLongDreamMemoryPatch(record, { currentState: '未来结局不可带回', operations: [
        { op: 'set_state', subjects: ['甲'], attribute: 'relationship', value: '朋友', chapterNumber: 1 },
        { op: 'set_state', subjects: ['甲'], attribute: 'relationship', value: '恋人', chapterNumber: 5 },
        { op: 'append_transition', subjects: ['甲'], to: '共同旅行', cause: '相约', chapterNumber: 2 },
        { op: 'append_transition', subjects: ['甲'], to: '未来婚礼', cause: '结婚', chapterNumber: 6 },
        { op: 'open_thread', threadKey: '约定', content: '寻找旧信', chapterNumber: 2 },
        { op: 'resolve_thread', threadKey: '约定', resolution: '未来找到旧信', chapterNumber: 5 },
    ] }, 6);
    const branch = createLongDreamBranch(record, 'chapter-4', { includeChapter: false });
    assert.equal(branch.memory.states[0].value, '朋友');
    assert.equal(branch.memory.states[0].validFromChapter, 1);
    assert.deepEqual(branch.memory.states[0].sourceChapterNumbers, [1]);
    assert.equal(branch.memory.transitions.length, 1);
    assert.equal(branch.memory.transitions[0].to, '共同旅行');
    assert.equal(branch.memory.threads.length, 0);
    assert.deepEqual(branch.memory.pendingChapterNumbers, [2, 3]);
    assert.doesNotMatch(JSON.stringify(branch.memory), /恋人|未来婚礼|未来找到旧信|未来结局/);
    assert.equal(branch.memory.currentState, '');
    assert.equal(branch.memory.summaryNeedsRefresh, true);
    assert.equal(record.memory.states[0].value, '恋人');
});

test('状态回退恢复历史主体和主题，缺少槽位快照的旧历史待补织', () => {
    let record = createLongDreamRecord({ source: { text: '一', html: '<p>一</p>' } });
    for (let n = 2; n <= 5; n++) record = appendLongDreamChapter(record, { text: `第${n}章`, html: '<p>正文</p>' });
    record = applyLongDreamMemoryPatch(record, { operations: [
        { op: 'set_state', subjects: ['甲'], attribute: 'possession', topic: '钥匙', value: '携带旧钥匙', chapterNumber: 1 },
    ] }, 1);
    record = applyLongDreamMemoryPatch(record, { operations: [
        { op: 'set_state', targetId: record.memory.states[0].id, subjects: ['未来人物乙'], attribute: 'knowledge', topic: '未来真相', value: '知道未来密室真相', chapterNumber: 5 },
    ] }, 5);
    const restored = normalizeLongDreamRecord(JSON.parse(JSON.stringify(record)));
    const branch = createLongDreamBranch(restored, 'chapter-4', { includeChapter: false });
    assert.deepEqual(branch.memory.states[0].subjects, ['甲']);
    assert.equal(branch.memory.states[0].attribute, 'possession');
    assert.equal(branch.memory.states[0].topic, '钥匙');
    assert.equal(branch.memory.currentState, '');
    assert.doesNotMatch(JSON.stringify(branch.memory), /未来/);
    for (const entry of restored.memory.states[0].history) {
        delete entry.subjects;
        delete entry.attribute;
        delete entry.topic;
    }
    const legacyBranch = createLongDreamBranch(restored, 'chapter-4', { includeChapter: false });
    assert.equal(legacyBranch.memory.states.length, 0);
    assert.deepEqual(legacyBranch.memory.pendingChapterNumbers, [1, 2, 3]);
    assert.doesNotMatch(JSON.stringify(legacyBranch.memory), /未来/);
    assert.equal(restored.memory.states[0].value, '知道未来密室真相');
});

test('补织较早章不能覆盖已保留的较新状态、事项进展或偏离', () => {
    let record = createLongDreamRecord({ worldLineRelation: LONG_DREAM_WORLD_LINE_RELATION.PARALLEL, source: { text: '一', html: '<p>一</p>' } });
    for (let n = 2; n <= 4; n++) record = appendLongDreamChapter(record, { text: `第${n}章`, html: '<p>正文</p>' });
    record = applyLongDreamMemoryPatch(record, { operations: [
        { op: 'set_state', subjects: ['甲'], attribute: 'location', value: '新地点', chapterNumber: 3 },
        { op: 'open_thread', threadKey: '线索', content: '新进展', chapterNumber: 3 },
        { op: 'upsert_deviation', deviationKey: '身份', dreamChange: '新身份', chapterNumber: 3 },
    ] }, 3);
    record = applyLongDreamMemoryPatch(record, { currentState: '不能采用的过时摘要', operations: [
        { op: 'set_state', subjects: ['甲'], attribute: 'location', value: '旧地点', chapterNumber: 2 },
        { op: 'open_thread', threadKey: '线索', content: '旧进展', chapterNumber: 2 },
        { op: 'advance_thread', threadKey: '线索', progress: '旧推进', chapterNumber: 2 },
        { op: 'upsert_deviation', deviationKey: '身份', dreamChange: '旧身份', chapterNumber: 2 },
    ] }, 3);
    assert.equal(record.memory.states[0].value, '新地点');
    assert.equal(record.memory.threads[0].content, '新进展');
    assert.equal(record.memory.threads[0].progress, '');
    assert.equal(record.memory.deviations[0].dreamChange, '新身份');
    assert.doesNotMatch(record.memory.currentState, /过时|旧地点|旧进展|旧身份/);
});

test('重织冲突不会把梦脉条目拼成概要，接受与保留标记独立摘要待更新', () => {
    let record = createLongDreamRecord({ source: { text: '一', html: '<p>一</p>' } });
    record = prepareLongDreamMemoryRegeneration(record);
    record = applyLongDreamMemoryPatch(record, { currentState: '不能提前采用的新位置', operations: [
        { op: 'set_state', subjects: ['甲'], attribute: 'relationship', value: '朋友', chapterNumber: 1 },
        { op: 'set_state', targetId: 'missing', subjects: ['甲'], attribute: 'location', value: '新位置', chapterNumber: 1 },
    ] }, 1);
    assert.equal(record.memory.pendingConflicts.length, 1);
    assert.equal(record.memory.currentState, '');
    assert.doesNotMatch(record.memory.currentState, /新位置/);
    for (const action of ['accept', 'keep']) {
        const restored = normalizeLongDreamRecord(JSON.parse(JSON.stringify(record)));
        const result = resolveLongDreamMemoryV2RecordConflict(restored, restored.memory.pendingConflicts[0].id, action);
        assert.equal(result.memory.pendingConflicts.length, 0);
        assert.equal(result.memory.currentState, '');
        assert.equal(result.memory.summaryNeedsRefresh, true);
        assert.equal(result.memory.states.some(item => item.value === '新位置'), action === 'accept');
    }
});

test('梦脉只保留一个明确标注的完善版内置预设', () => {
    const builtin = builtinLongDreamMemoryPreset();
    assert.match(builtin.name, /连续性梦脉 v2（完善版）/);
    const presets = normalizeLongDreamMemoryPresetList([{
        id: 'legacy-copy', name: '内置 · 连续性梦脉 v2', focusPrompt: builtin.focusPrompt,
    }]);
    assert.equal(presets.length, 1);
    assert.equal(presets[0].id, builtin.id);
});
