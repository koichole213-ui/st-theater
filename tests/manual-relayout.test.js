import test from 'node:test';
import assert from 'node:assert/strict';
import { activeRelayout, cancelManualRelayout, manualLayoutSource, runManualRelayout } from '../manual-relayout.js';
import { createTheaterStorage } from '../theater-storage.js';
import { appendLongDreamChapter, createLongDreamRecord, normalizeLongDreamRecord } from '../long-dream.js';
import { normalizeBackupData } from '../backup-data.js';
import { createFinalRenderPlan, hydrateFinalRenderHtml } from '../generation-payload.js';

const original = '<p>原版</p>';
const formatted = '<main><p>原版</p></main>';
const newLayout = { html: formatted, mode: 'html' };
const layoutSource = { targetChars: 5000, text: '独立正文\n\n第二段', originalInstruction: '原任务' };
const entry = (resultId = 'a', source = layoutSource) => ({
    resultId, html: original, mode: 'html', continuationRounds: ['前情', '本段'], layoutSource: source,
});

function fixture(t, props = {}) {
    const notices = [];
    t.mock.method(console, 'error', () => {});
    const globals = {
        document: { querySelector: () => null },
        SillyTavern: { getContext: () => ({}) },
        toastr: { info: text => notices.push(text), success: text => notices.push(text), error: text => notices.push(text) },
    };
    for (const [key, value] of Object.entries(globals)) {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { value, configurable: true });
        t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
    }
    const requests = [];
    const item = entry();
    const runtime = {
        settings: {}, resultStorageQueue: Promise.resolve(), recentCache: [], longDreamCache: [],
        currentGenerationResult: item, currentDisplayHtml: item.html, resultWorkspacePage: 'generate',
        htmlToPlainText: () => '编辑后的正文',
        updateContinueHint() {}, save() {},
        showInIframe(html) { this.currentDisplayHtml = html; },
        resolveRenderSelection: () => ({ rules: '现在的模板', label: '当前模板' }),
        captureGenerationApiRoute: () => ({ layoutSelection: { enabled: true } }),
        async requestFinalRenderedHtml(args) { requests.push(args); return newLayout; },
        captureRequestIssue: () => ({}),
        requestFailureMessage: message => message,
        theaterError: message => notices.push(message),
        ...props,
    };
    Object.assign(runtime, createTheaterStorage(runtime));
    return { runtime, item, notices, requests };
}

test('手动排版按原始目标和独立正文判断，5000 含在内', () => {
    assert.equal(manualLayoutSource(entry('a', { ...layoutSource, targetChars: 4999 })), null);
    assert.equal(manualLayoutSource(entry('a', null)), null);
    assert.equal(manualLayoutSource(entry('a', { ...layoutSource, text: '  ' })), null);
    assert.deepEqual(manualLayoutSource(entry()), { sourceText: layoutSource.text, originalInstruction: '原任务' });
    assert.equal(manualLayoutSource({ html: original, text: '正文' }, true), null);
});

test('生成结果独立排版只替换 HTML，沿用当前模板和原正文，保留续写记录和备份来源', async t => {
    const { runtime, item, requests } = fixture(t);
    item.layoutRetry = { sourceText: layoutSource.text };
    assert.equal(await runManualRelayout(runtime, 'generate'), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].requireIndependentApi, true);
    assert.equal(requests[0].rules, '现在的模板');
    assert.equal(requests[0].sourceText, layoutSource.text);
    assert.equal(item.html, formatted);
    assert.equal(item.layoutSource, layoutSource);
    assert.equal(item.layoutRetry, null);
    assert.deepEqual(item.continuationRounds, ['前情', '本段']);
    assert.deepEqual(normalizeBackupData({ current: item }).current.layoutSource, layoutSource);
    assert.equal(runtime.settings.currentGenerationResult.html, formatted);
    assert.equal(runtime.currentDisplayHtml, formatted);
});

test('两版 HTML 相同，普通续写仍只修改所选版本和对应的最近生成', async t => {
    const { runtime, item } = fixture(t);
    const earlier = entry('b', { ...layoutSource, text: '上一版的正文' });
    runtime.recentCache = [earlier];
    const versions = [{ ...earlier }, { ...item }];
    runtime.continuationSession = { versions, selected: 0 };
    assert.equal(await runManualRelayout(runtime, 'continuation'), true);
    assert.equal(versions[0].html, formatted);
    assert.equal(versions[1].html, original);
    assert.equal(earlier.html, formatted);
    assert.equal(item.html, original);
    assert.equal(runtime.lastGeneratedText, '上一版的正文');
});

test('阅读页只刷新选中的篇目，编辑后的旧正文不会再用于排版', async t => {
    const { runtime, item } = fixture(t);
    const reading = entry('recent');
    runtime.recentCache = [reading];
    runtime.readingState = { reading };
    runtime.resultWorkspacePage = 'read';
    assert.equal(await runManualRelayout(runtime, 'read'), true);
    assert.equal(reading.html, formatted);
    assert.equal(item.html, original);
    assert.equal(runtime.currentDisplayHtml, original);
    assert.equal(await runtime.updateResultItem(reading, '<p>编辑后</p>', 'html'), true);
    assert.equal(await runManualRelayout(runtime, 'read'), false);
    assert.equal(reading.html, '<p>编辑后</p>');
});

test('排版失败、关闭或落盘失败时保留原版', async t => {
    const { runtime, item, notices } = fixture(t);
    runtime.requestFinalRenderedHtml = async () => { throw Object.assign(new Error('unavailable'), { code: 'THEATER_LAYOUT_API_MISSING' }); };
    assert.equal(await runManualRelayout(runtime, 'generate'), false);
    assert.match(notices.at(-1), /启用独立 HTML 排版 API/);
    let finish;
    runtime.requestFinalRenderedHtml = () => new Promise(resolve => { finish = resolve; });
    const pending = runManualRelayout(runtime, 'generate');
    assert.ok(activeRelayout(runtime));
    cancelManualRelayout(runtime);
    finish(newLayout);
    assert.equal(await pending, false);
    assert.equal(runtime.isGenerating, false);
    assert.equal(item.html, original);

    runtime.requestFinalRenderedHtml = async () => newLayout;
    runtime.idb = { transaction() { throw new Error('transaction failure'); } };
    assert.equal(await runManualRelayout(runtime, 'generate'), false);
    assert.equal(item.html, original);
});

test('排版等待保存队列期间切换阅读篇目，不写入旧篇或新篇', async t => {
    const { runtime, item } = fixture(t);
    const reading = entry('next');
    runtime.readingState = { reading: item };
    runtime.resultWorkspacePage = 'read';
    let release;
    runtime.resultStorageQueue = new Promise(resolve => { release = resolve; });
    const pending = runManualRelayout(runtime, 'read');
    await Promise.resolve();
    runtime.readingState.reading = reading;
    release();
    assert.equal(await pending, false);
    assert.equal(item.html, original);
    assert.equal(reading.html, original);
});

const dreamChapter = { text: '长梦独立正文', html: original, mode: 'html', targetChars: 5000, instruction: '长梦指令' };

function dreamFixture(t, scope) {
    const { runtime, requests } = fixture(t);
    const seed = createLongDreamRecord({ source: { text: '开篇', html: '<p>开篇</p>' } });
    let dream = { ...appendLongDreamChapter(seed, dreamChapter), id: 1 };
    if (scope === 'candidate') {
        const candidates = [{ ...dreamChapter, versionNumber: 1 }, { ...dreamChapter, versionNumber: 2, retained: true }];
        dream = normalizeLongDreamRecord({ ...dream, draft: { ...dreamChapter, status: 'review', candidates, selectedCandidateIndex: 1 } });
    }
    Object.assign(runtime, {
        longDreamCache: [dream], activeLongDreamId: 1, activeLongDreamChapterId: dream.chapters[1].id,
        longDreamWorkspaceSection: scope === 'candidate' ? 'continue' : 'works', longDreamWorkLevel: 'chapter',
        renderLongDreamPanel() {},
    });
    return { runtime, dream, requests };
}

test('长梦候选只更新选中版本和它的预览，其他候选与梦脉不变', async t => {
    const { runtime, dream, requests } = dreamFixture(t, 'candidate');
    assert.equal(await runManualRelayout(runtime, 'candidate'), true);
    const updated = runtime.longDreamCache[0];
    assert.equal(updated.draft.html, formatted);
    assert.equal(updated.draft.candidates[0].html, original);
    assert.equal(updated.draft.candidates[1].html, formatted);
    assert.equal(updated.draft.candidates[1].retained, true);
    assert.equal(updated.memory, dream.memory);
    assert.equal(requests[0].sourceText, dreamChapter.text);
});

test('正式章保留原目标，更新排版只改该章 HTML', async t => {
    const { runtime, dream } = dreamFixture(t, 'chapter');
    assert.equal(normalizeLongDreamRecord(dream).chapters[1].targetChars, 5000);
    assert.equal(await runManualRelayout(runtime, 'chapter'), true);
    const updated = runtime.longDreamCache[0];
    assert.equal(updated.chapters[0], dream.chapters[0]);
    assert.deepEqual(updated.chapters[1], { ...dream.chapters[1], html: formatted });
    assert.equal(updated.memory, dream.memory);
});

test('长梦在单一事务读最新版本，事务完成前不发布写入结果', async t => {
    const { runtime, dream } = dreamFixture(t, 'chapter');
    const persisted = { ...dream, title: '另一处刚更新的标题' };
    const read = { result: persisted };
    let written;
    const tx = { objectStore: () => ({ get: () => read, put: value => { written = value; } }) };
    runtime.idb = { transaction: () => tx };
    const pending = runManualRelayout(runtime, 'chapter');
    await new Promise(resolve => setImmediate(resolve));
    read.onsuccess();
    assert.equal(runtime.longDreamCache[0], dream);
    assert.equal(written.title, persisted.title);
    assert.equal(written.chapters[1].html, formatted);
    tx.onabort();
    assert.equal(await pending, false);
    assert.equal(runtime.longDreamCache[0], dream);
});

test('排版还原时正文中的美元符号与字面段落编号保持原样', () => {
    const text = 'A$$B 和 {{THEATER_P0002}}\n\nC$&D';
    const plan = createFinalRenderPlan(text);
    const template = '<p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p>';
    assert.equal(hydrateFinalRenderHtml(template, plan), '<p>A$$B 和 {{THEATER_P0002}}</p><p>C$&amp;D</p>');
});

test('另一页面已生成新篇，事务只更新移入最近生成的原篇', async t => {
    const { runtime, item } = fixture(t);
    const fresh = { ...entry('fresh'), html: '<p>新篇</p>' };
    const latest = { ...item, title: '新标题' };
    const current = { result: fresh }, recent = { result: [latest] };
    const written = new Map();
    const tx = { objectStore: () => ({
        get: key => key === 'current-result' ? current : recent,
        put: (value, key) => written.set(key, value),
    }) };
    runtime.idb = { transaction: () => tx };
    const pending = runManualRelayout(runtime, 'generate');
    await Promise.resolve();
    await Promise.resolve();
    recent.onsuccess();
    tx.oncomplete();
    assert.equal(await pending, true);
    assert.equal(written.has('current-result'), false);
    assert.deepEqual(written.get('recent'), [{ ...latest, html: formatted }]);
});

test('另一页面编辑或移除了原篇，排版不会覆盖或重建它', async t => {
    const { runtime, item } = fixture(t);
    for (const latest of [null, { ...item, html: '<p>另一页的正文</p>' }]) {
        const recent = { result: [] };
        const tx = { objectStore: () => ({
            get: key => key === 'current-result' ? { result: latest } : recent,
            put: () => assert.fail('不能覆盖已更改的记录'),
        }) };
        runtime.idb = { transaction: () => tx };
        const pending = runManualRelayout(runtime, 'generate');
        await Promise.resolve();
        await Promise.resolve();
        recent.onsuccess();
        tx.oncomplete();
        assert.equal(await pending, false);
        assert.equal(item.html, original);
    }
});

test('旧长梦缺少候选元数据但明确保存过目标时，仍可更新该候选', async t => {
    const { runtime, dream } = dreamFixture(t, 'candidate');
    const persisted = { ...dream, draft: {
        ...dreamChapter, title: '旧候选', status: 'review', updatedAt: dream.updatedAt,
        candidates: [{ ...dreamChapter }],
    } };
    runtime.longDreamCache[0] = normalizeLongDreamRecord(persisted);
    const read = { result: persisted };
    let written;
    const tx = { objectStore: () => ({ get: () => read, put: value => { written = value; } }) };
    runtime.idb = { transaction: () => tx };
    const pending = runManualRelayout(runtime, 'candidate');
    await new Promise(resolve => setImmediate(resolve));
    read.onsuccess();
    tx.oncomplete();
    assert.equal(await pending, true);
    assert.equal(written.draft.html, formatted);
    assert.equal(written.draft.candidates[0].targetChars, 5000);
});

test('旧多候选的草稿目标不能替缺失的候选目标', () => {
    const seed = createLongDreamRecord({ source: { text: '开篇', html: original } });
    const candidates = [
        { ...dreamChapter, targetChars: undefined, versionNumber: 1 },
        { ...dreamChapter, versionNumber: 2 },
    ];
    const normalized = normalizeLongDreamRecord({ ...seed, draft: { ...dreamChapter, status: 'review', candidates, selectedCandidateIndex: 1 } });
    assert.equal(manualLayoutSource(normalized.draft.candidates[0], true), null);
    assert.equal(manualLayoutSource(normalized.draft.candidates[1], true).sourceText, dreamChapter.text);
});

test('设置回退写入失败时，普通结果和长梦原版仍保留在内存中', async t => {
    const { runtime } = dreamFixture(t, 'chapter');
    const item = runtime.currentGenerationResult;
    const dream = runtime.longDreamCache[0];
    runtime.settings.longDreams = [dream];
    runtime.settings.currentGenerationResult = item;
    runtime.save = () => { throw new Error('Synthetic settings failure'); };
    assert.equal(await runManualRelayout(runtime, 'chapter'), false);
    assert.equal(runtime.longDreamCache[0], dream);
    assert.equal(runtime.settings.longDreams[0], dream);
    assert.equal(await runManualRelayout(runtime, 'generate'), false);
    assert.equal(runtime.settings.currentGenerationResult, item);
    assert.equal(item.html, original);
});
