// 从 core.test.js 拆出：long-dream-model
import test from 'node:test';
import assert from 'node:assert/strict';
import { LONG_DREAM_DRAFT_STATUS, LONG_DREAM_MEMORY_STATUS, LONG_DREAM_SCHEMA_VERSION, LONG_DREAM_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, appendLongDreamChapter, clearLongDreamDraft, createLongDreamRecord, createLongDreamWorldBookSnapshot, latestLongDreamChapter, migrateLongDreamRecord, normalizeLongDreamRecord, promoteLongDreamDraft, saveLongDreamDraft, setLongDreamStatus, truncateLongDreamAfter, updateLongDreamChapter, updateLongDreamDefinition } from '../long-dream.js';

test('长梦以完整首章开卷，并默认隔离原世界书', () => {
    const now = new Date('2026-07-31T12:30:00.000Z');
    const record = createLongDreamRecord({
        title: '没有血缘的夏天',
        canon: '两人是一起长大的青梅竹马，不是兄妹。',
        worldBookNames: ['原作人物关系'],
        source: {
            kind: 'history',
            refId: 17,
            title: '夏日祭小剧场',
            instruction: '写一场夏日祭。',
            text: '灯火沿着河岸亮起来。',
            html: '<!doctype html><html><body><article>灯火沿着河岸亮起来。</article></body></html>',
            mode: 'html',
        },
        sourceConfig: {
            presetName: '长篇预设',
            selectedWorldBooks: ['原作人物关系'],
            readChatContext: true,
            contextRange: 20,
        },
        now,
    });

    assert.equal(record.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY);
    assert.deepEqual(record.inheritance.worldBookNames, []);
    assert.equal(record.sourceConfig.selectedWorldBooks[0], '原作人物关系');
    assert.equal(record.chapters.length, 1);
    assert.equal(record.chapters[0].html.includes('<article>'), true);
    assert.equal(record.chapters[0].text, '灯火沿着河岸亮起来。');
    assert.equal(record.createdAt, now.toISOString());
    assert.equal(latestLongDreamChapter(record)?.id, 'chapter-1');
});

test('长梦可明确沿用选中世界书，名称会去空和去重', () => {
    const record = createLongDreamRecord({
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['人物设定', ' 人物设定 ', '', '地点设定'],
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    assert.equal(record.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.SELECTED);
    assert.deepEqual(record.inheritance.worldBookNames, ['人物设定', '地点设定']);
});

test('世界书继承冻结实际内容且不保存无关字段', () => {
    const mutableEntry = {
        book: '人物设定', enabled: true, uid: 7, name: '关系', content: '两人曾是同班同学。',
        raw: { key: ['同学'], constant: true, apiKey: '不应进入快照' },
    };
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['人物设定'],
        entries: [mutableEntry, { book: '人物设定', enabled: false, content: '禁用条目' }],
    }, new Date('2026-07-31T12:45:00.000Z'));
    mutableEntry.content = '后来被修改的当前世界书';

    assert.equal(snapshot.capturedAt, '2026-07-31T12:45:00.000Z');
    assert.equal(snapshot.books[0].entries.length, 1);
    assert.equal(snapshot.books[0].entries[0].content, '两人曾是同班同学。');
    assert.deepEqual(snapshot.books[0].entries[0].keys, ['同学']);
    assert.equal('apiKey' in snapshot.books[0].entries[0], false);
});

test('重新定梦只修改世界线定义，不会改写已保存章节', () => {
    const record = createLongDreamRecord({
        title: '旧梦',
        canon: '原设定',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['旧世界书'],
        source: { text: '不能丢失的第一章', html: '<p>不能丢失的第一章</p>' },
        now: new Date('2026-07-31T12:00:00.000Z'),
    });
    const originalChapter = structuredClone(record.chapters[0]);
    const updated = updateLongDreamDefinition(record, {
        title: '新梦',
        canon: '两人是青梅竹马。',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY,
        worldBookNames: ['不应保留'],
    }, new Date('2026-07-31T13:00:00.000Z'));

    assert.equal(updated.title, '新梦');
    assert.equal(updated.canon, '两人是青梅竹马。');
    assert.deepEqual(updated.inheritance.worldBookNames, []);
    assert.deepEqual(updated.chapters[0], originalChapter);
    assert.equal(updated.updatedAt, '2026-07-31T13:00:00.000Z');
    assert.equal(updated.inheritance.snapshot, null);
});

test('只修改标题时会保留既有继承策略和冻结快照', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['地点'], entries: [{ book: '地点', content: '旧站台终年下雨。' }],
    });
    const record = createLongDreamRecord({
        title: '旧名', worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['地点'], worldBookSnapshot: snapshot, source: { text: '第一章', html: '<main>第一章</main>' },
    });
    const updated = updateLongDreamDefinition(record, { title: '新名' });
    assert.equal(updated.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.SELECTED);
    assert.deepEqual(updated.inheritance.worldBookNames, ['地点']);
    assert.equal(updated.inheritance.snapshot.books[0].entries[0].content, '旧站台终年下雨。');
});

test('损坏的空长梦不会进入存档，已有 HTML 长梦可以恢复', () => {
    assert.equal(normalizeLongDreamRecord({ title: '空卷', chapters: [] }), null);
    const restored = normalizeLongDreamRecord({
        id: 8,
        title: '旧存档',
        inheritance: { worldBookPolicy: 'unknown', worldBookNames: ['不应继承'] },
        chapters: [{ html: '<main>旧章</main>' }],
    });
    assert.equal(restored.id, 8);
    assert.equal(restored.chapters[0].html, '<main>旧章</main>');
    assert.equal(restored.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY);
    assert.deepEqual(restored.inheritance.worldBookNames, []);
});

test('旧版长梦迁移到当前 schema，并把草稿与正式章节分开', () => {
    const migrated = migrateLongDreamRecord({
        schemaVersion: 1,
        title: '旧梦',
        chapters: [{ html: '<main>第一章</main>' }],
        draft: { status: 'review', text: '第二章草稿', html: '<main>第二章草稿</main>' },
    });
    assert.equal(migrated.schemaVersion, LONG_DREAM_SCHEMA_VERSION);
    assert.equal(migrated.chapters.length, 1);
    assert.equal(migrated.draft.chapterNumber, 2);
    assert.equal(migrated.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(migrated.draft.targetChars, 3000);
});

test('追加下一章保留旧章并生成稳定的章号', () => {
    const record = createLongDreamRecord({ source: { text: '第一章正文', html: '<main>第一章正文</main>' } });
    const updated = appendLongDreamChapter(record, {
        title: '潮汐站台', instruction: '推进列车谜团', text: '第二章正文', html: '<main>第二章正文</main>', mode: 'html',
    }, new Date('2026-07-31T14:00:00.000Z'));

    assert.equal(updated.chapters.length, 2);
    assert.equal(updated.chapters[0].text, '第一章正文');
    assert.equal(updated.chapters[1].id, 'chapter-2');
    assert.equal(updated.chapters[1].number, 2);
    assert.equal(updated.chapters[1].title, '潮汐站台');
    assert.equal(updated.updatedAt, '2026-07-31T14:00:00.000Z');
});

test('正式章节必须同时具备纯正文和最终 HTML，失败不改旧卷', () => {
    assert.throws(() => createLongDreamRecord({ source: { text: '只有正文的第一章' } }), /第一章必须同时包含/);
    assert.throws(() => createLongDreamRecord({ source: { html: '<main>只有 HTML 的第一章</main>' } }), /第一章必须同时包含/);
    const record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    const original = structuredClone(record);
    assert.throws(() => appendLongDreamChapter(record, { text: '只有正文' }), /同时包含纯正文与最终 HTML/);
    assert.throws(() => appendLongDreamChapter(record, { html: '<main>只有 HTML</main>' }), /同时包含纯正文与最终 HTML/);
    assert.deepEqual(record, original);
});

test('章节更新和截断只影响明确范围，并清理失效草稿', () => {
    let record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章', html: '<main>第二章</main>' });
    record = appendLongDreamChapter(record, { text: '第三章', html: '<main>第三章</main>' });
    const updated = updateLongDreamChapter(record, 'chapter-2', {
        title: '改写后的第二章', text: '新第二章', html: '<main>新第二章</main>',
    });
    const withDraft = saveLongDreamDraft(updated, { instruction: '第四章方向', text: '未完成草稿' });
    const truncated = truncateLongDreamAfter(withDraft, 'chapter-2');

    assert.equal(updated.chapters[0].text, '第一章');
    assert.equal(updated.chapters[1].text, '新第二章');
    assert.equal(updated.chapters[2].text, '第三章');
    assert.deepEqual(record.chapters[1].text, '第二章');
    assert.equal(truncated.chapters.length, 2);
    assert.equal(truncated.draft, null);
    assert.equal(truncated.status, LONG_DREAM_STATUS.ACTIVE);
    assert.equal(truncated.memory.cards.length, 0);
    assert.equal(truncated.memory.currentState, '');
    assert.equal(truncated.memory.processedThroughChapter, 0);
    assert.deepEqual(truncated.memory.pendingChapterNumbers, [1, 2]);
});

test('编辑正式章节会保留既有梦脉并从修改章起重新织录，仅改标题不触发重算', () => {
    let record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章', html: '<main>第二章</main>' });
    record = appendLongDreamChapter(record, { text: '第三章', html: '<main>第三章</main>' });
    record.memory = {
        ...record.memory,
        cards: [{ id: 'kept-memory', type: '事实', content: '保留的用户梦脉', status: 'active', sourceChapterNumbers: [1] }],
        processedThroughChapter: 3,
        pendingChapterNumbers: [],
        status: LONG_DREAM_MEMORY_STATUS.READY,
    };

    const renamed = updateLongDreamChapter(record, 'chapter-2', { title: '只改标题' });
    assert.equal(renamed.memory.processedThroughChapter, 3);
    assert.deepEqual(renamed.memory.pendingChapterNumbers, []);

    const rewritten = updateLongDreamChapter(renamed, 'chapter-2', {
        text: '修改后的第二章',
        html: '<main>修改后的第二章</main>',
    });
    assert.equal(rewritten.memory.cards[0].id, 'kept-memory');
    assert.equal(rewritten.memory.processedThroughChapter, 1);
    assert.deepEqual(rewritten.memory.pendingChapterNumbers, [2, 3]);
    assert.equal(rewritten.memory.status, LONG_DREAM_MEMORY_STATUS.PENDING);

    let notYetWoven = createLongDreamRecord({ source: { text: '首章', html: '<main>首章</main>' } });
    notYetWoven = appendLongDreamChapter(notYetWoven, { text: '次章', html: '<main>次章</main>' });
    const editedBeforeFirstWeave = updateLongDreamChapter(notYetWoven, 'chapter-2', {
        text: '编辑后的次章', html: '<main>编辑后的次章</main>',
    });
    assert.deepEqual(editedBeforeFirstWeave.memory.pendingChapterNumbers, [1, 2]);
});

test('草稿刷新恢复后仍不能冒充正式章节，确认后才原子晋升', () => {
    const record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    const writing = saveLongDreamDraft(record, {
        status: LONG_DREAM_DRAFT_STATUS.WRITING,
        title: '第二章', instruction: '进入森林', text: '生成到一半', html: '',
    }, new Date('2026-07-31T14:10:00.000Z'));
    const restored = normalizeLongDreamRecord(structuredClone(writing));
    assert.equal(restored.chapters.length, 1);
    assert.equal(restored.draft.text, '生成到一半');
    assert.throws(() => promoteLongDreamDraft(restored), /尚未进入确认保存状态/);

    const review = saveLongDreamDraft(restored, {
        status: LONG_DREAM_DRAFT_STATUS.REVIEW,
        title: '第二章', instruction: '进入森林',
        text: '完整第二章', html: '<main>完整第二章</main>', mode: 'html',
    });
    const promoted = promoteLongDreamDraft(review, new Date('2026-07-31T14:20:00.000Z'));
    assert.equal(promoted.chapters.length, 2);
    assert.equal(promoted.chapters[0].text, '第一章');
    assert.equal(promoted.chapters[1].text, '完整第二章');
    assert.equal(promoted.draft, null);
    assert.equal(review.chapters.length, 1);
    assert.equal(clearLongDreamDraft(review).draft, null);
});

test('长梦可以完卷，也可在继续施工时恢复为进行中', () => {
    const record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    const completed = setLongDreamStatus(record, LONG_DREAM_STATUS.COMPLETE);
    const reopened = setLongDreamStatus(completed, LONG_DREAM_STATUS.ACTIVE);
    assert.equal(completed.status, LONG_DREAM_STATUS.COMPLETE);
    assert.equal(reopened.status, LONG_DREAM_STATUS.ACTIVE);
});
