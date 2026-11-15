// 从 core.test.js 拆出：long-dream-backup
import test from 'node:test';
import assert from 'node:assert/strict';
import { LONG_DREAM_DRAFT_RESUME_STAGE, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, appendLongDreamChapter, createLongDreamRecord, createLongDreamWorldBookSnapshot, normalizeLongDreamRecord, saveLongDreamDraft } from '../long-dream.js';
import { LONG_DREAM_BACKUP_FORMAT, LONG_DREAM_BACKUP_VERSION, createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { LONG_DREAM_ARCHIVE_FORMAT, LONG_DREAM_ARCHIVE_MANIFEST, createLongDreamArchive, parseLongDreamArchive } from '../long-dream-archive.js';

test('长梦备份以白名单导出，导入会保留章节但不携带本地 ID 或未知字段', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['地点'],
        entries: [{ book: '地点', uid: 7, content: '旧站台终年下雨。', raw: { key: ['站台'] } }],
    });
    let record = createLongDreamRecord({
        title: '雨夜列车',
        canon: '列车不能驶离环线。',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['地点'],
        worldBookSnapshot: snapshot,
        source: { kind: 'history', refId: 12, title: '初章', instruction: '从雨夜站台开始。', text: '第一章正文', html: '<main>第一章正文</main>' },
    });
    record = appendLongDreamChapter(record, { title: '旧月台', instruction: '让列车短暂停靠。', text: '第二章正文', html: '<main>第二章正文</main>' });
    record.id = 88;
    record.untrusted = { apiKey: 'never-export-this' };
    record.source.refId = { apiKey: 'not-a-reference' };
    record.sourceConfig.apiKey = 'also-never-export-this';
    record.inheritance.snapshot.books[0].entries[0].uid = { token: 'not-an-id' };
    record.chapters[0].unknown = 'not-exported';

    const backup = createLongDreamBackup([record], { now: new Date('2026-08-04T12:00:00.000Z') });
    const serialized = JSON.stringify(backup);
    const imported = parseLongDreamBackup(JSON.parse(serialized));

    assert.equal(backup.format, LONG_DREAM_BACKUP_FORMAT);
    assert.equal(backup.version, LONG_DREAM_BACKUP_VERSION);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].id, undefined);
    assert.equal(imported[0].chapters.length, 2);
    assert.equal(imported[0].chapters[1].title, '旧月台');
    assert.equal(imported[0].chapters[1].html, '<main>第二章正文</main>');
    assert.equal(imported[0].source.refId, null);
    assert.equal(imported[0].inheritance.snapshot.books[0].entries[0].uid, null);
    assert.equal('untrusted' in imported[0], false);
    assert.equal('unknown' in imported[0].chapters[0], false);
    assert.doesNotMatch(serialized, /never-export-this|not-a-reference|also-never-export-this|not-an-id/);
});

test('长梦 ZIP 清单把大正文拆为独立文件，并完整往返世界书位置与用户梦脉', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['旧港'],
        entries: [{
            book: '旧港', uid: 11, name: '钟楼', content: '钟楼在退潮时开启。',
            position: 4, depth: 7, role: 'assistant', outletName: 'dream-lore',
        }],
    });
    let record = createLongDreamRecord({
        title: '潮汐档案',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['旧港'],
        worldBookSnapshot: snapshot,
        source: { text: '第一章长正文', html: '<main>第一章长正文</main>' },
    });
    record = appendLongDreamChapter(record, {
        title: '退潮', text: '第二章长正文', html: '<main><p>第二章长正文</p></main>',
    });
    record.memory.cards = [{
        id: 'memory-key', type: '人物状态', key: '林岚/所在地', content: '林岚在钟楼顶层。',
        chapterNumber: 2, sourceChapterNumbers: [1, 2], status: 'active', editedByUser: true,
    }];

    const archive = createLongDreamArchive([record], { now: new Date('2026-08-08T03:00:00.000Z') });
    assert.equal(archive.manifest.format, LONG_DREAM_ARCHIVE_FORMAT);
    assert.equal(LONG_DREAM_ARCHIVE_MANIFEST, 'long-dream-manifest.json');
    assert.equal(archive.files.length, 4);
    assert.equal('text' in archive.manifest.dreams[0].chapters[0], false);
    assert.equal('html' in archive.manifest.dreams[0].chapters[0], false);

    const imported = parseLongDreamArchive(archive.manifest, archive.files);
    assert.equal(imported[0].chapters[0].text, '第一章长正文');
    assert.equal(imported[0].chapters[1].html, '<main><p>第二章长正文</p></main>');
    const entry = imported[0].inheritance.snapshot.books[0].entries[0];
    assert.equal(entry.position, 4);
    assert.equal(entry.depth, 7);
    assert.equal(entry.role, 'assistant');
    assert.equal(entry.outletName, 'dream-lore');
    assert.equal(imported[0].memory.cards[0].key, '林岚/所在地');
    assert.deepEqual(imported[0].memory.cards[0].sourceChapterNumbers, [1, 2]);
    assert.equal(imported[0].memory.cards[0].editedByUser, true);
    assert.throws(() => parseLongDreamArchive(archive.manifest, archive.files.slice(1)), /ZIP 缺少/);
});

test('长梦 JSON 不导出待确认候选，但仍能导入旧备份中的单版待确认稿', () => {
    const record = createLongDreamRecord({
        title: '候选不出卷',
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    const review = saveLongDreamDraft(record, {
        status: LONG_DREAM_DRAFT_STATUS.REVIEW,
        title: '第二章',
        instruction: '沿河而下。',
        text: '不应出现在新备份里的候选正文',
        html: '<main>不应出现在新备份里的候选正文</main>',
    });
    const backup = createLongDreamBackup([review]);
    const serialized = JSON.stringify(backup);
    assert.equal(backup.dreams[0].draft, null);
    assert.doesNotMatch(serialized, /不应出现在新备份里的候选正文/);

    const imported = parseLongDreamBackup({
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        dreams: [{
            title: '旧备份',
            chapters: [{ text: '第一章', html: '<main>第一章</main>' }],
            draft: {
                status: 'review',
                title: '第二章',
                text: '旧备份待确认正文',
                html: '<main>旧备份待确认正文</main>',
            },
        }],
    });
    const normalizedImported = normalizeLongDreamRecord(imported[0]);
    assert.equal(normalizedImported.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(normalizedImported.draft.candidates.length, 1);
    assert.equal(normalizedImported.draft.text, '旧备份待确认正文');
});

test('长梦备份拒绝错格式，并能保留仅 HTML 的旧章节以便安全阅读', () => {
    assert.throws(() => parseLongDreamBackup({ format: 'st-theater-history', version: 1, dreams: [] }), /不是千夜浮梦长梦备份/);
    const imported = parseLongDreamBackup({
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        dreams: [{ title: '旧卷', chapters: [{ title: '旧章', html: '<main>仍可阅读</main>' }] }],
    });
    assert.equal(imported[0].chapters[0].html, '<main>仍可阅读</main>');
    assert.equal(imported[0].chapters[0].mode, 'html');
});

test('不完整的待确认长梦草稿会安全回退为可继续的 writing 草稿', () => {
    const imported = parseLongDreamBackup({
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        dreams: [{
            title: '半章旧卷',
            chapters: [{ text: '第一章', html: '<main>第一章</main>' }],
            draft: { status: 'review', title: '第二章', text: '尚未排版的正文', html: '' },
        }],
    });
    assert.equal(imported[0].draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
    assert.equal(imported[0].draft.text, '尚未排版的正文');
});

test('正文已完成的长梦草稿经过备份恢复后仍只需重新排版', () => {
    const record = createLongDreamRecord({
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    const renderPending = saveLongDreamDraft(record, {
        status: LONG_DREAM_DRAFT_STATUS.WRITING,
        resumeStage: LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING,
        title: '第二章',
        instruction: '走进旧站。',
        text: '已经完整写完、只差排版的第二章。',
    });
    const restored = parseLongDreamBackup(createLongDreamBackup([renderPending]))[0];
    assert.equal(restored.draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
    assert.equal(restored.draft.resumeStage, LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING);
    assert.equal(restored.draft.text, '已经完整写完、只差排版的第二章。');
});
