import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterStorage } from '../theater-storage.js';
import { createLongDreamRecord, applyLongDreamMemoryPatch, saveLongDreamDraft } from '../long-dream.js';
import { createLongDreamRuntime } from '../long-dream-runtime.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';
import { itemFingerprint, normalizeBackupData } from '../backup-data.js';
import { createTheaterHistory } from '../theater-history.js';

const dream = () => ({ ...createLongDreamRecord({ title: '测试', source: { html: '<p>第一章</p>', text: '第一章' } }), id: 1 });

function localDreamPage({ beforeCommit = async () => {} } = {}) {
    let stored = dream();
    const notices = [];
    const toast = { error: message => notices.push(message), warning: message => notices.push(message) };
    const runtime = { longDreamCache: [stored], idb: { transaction() {
        const tx = { abort: () => setImmediate(() => tx.onabort?.()) };
        tx.objectStore = () => ({
            get() {
                const req = {};
                queueMicrotask(() => { req.result = structuredClone(stored); req.onsuccess(); });
                return req;
            },
            put(record) {
                setImmediate(async () => {
                    await beforeCommit(record);
                    stored = structuredClone(record);
                    tx.oncomplete();
                });
            },
        });
        return tx;
    } } };
    globalThis.toastr = toast;
    Object.assign(runtime, createTheaterStorage(runtime, { toast }));
    return { runtime, notices, read: () => stored };
}

test('同页梦脉写入尚未提交时续写入队，数据库保留梦脉和草稿，采用候选仍追加正式章节', async t => {
    const { runtime, notices, read } = localDreamPage();
    globalThis.SillyTavern = { getContext: () => ({}) };
    t.after(() => { delete globalThis.SillyTavern; });
    let weave;
    Object.assign(runtime, {
        settings: {}, runtimeLog() {}, recordRequestMetrics() {},
        resolveRenderSelection: () => ({ isPlainTextRender: true }),
        textFallbackHtml: text => '<p>' + text + '</p>',
        normalizeLongDreamResponseText: text => text,
        requestConfiguredGenerationApi: async () => {
            const latest = runtime.longDreamCache[0];
            weave = runtime.longDreamPut(applyLongDreamMemoryPatch(latest, { operations: [] }, 1));
            return { text: '候选新章节' };
        },
    });
    const controller = createLongDreamRuntime(runtime).getLongDreamGenerationController();
    const result = await controller.run({ record: runtime.longDreamCache[0], instruction: '合成指令', targetChars: 500 });
    assert.ok(await weave);
    assert.equal(read().draft.text, '候选新章节');
    assert.equal(read().memory.status, 'ready');
    assert.equal(read().memory.processedThroughChapter, 1);
    assert.ok(!runtime.archiveStale);
    assert.deepEqual(notices, []);
    await controller.confirm(result.record);
    assert.equal(read().chapters[1].text, '候选新章节');
    assert.equal(read().draft, null);
});

test('同页旧对象返回失败与本页冲突原因，不锁页面，最新记录仍可写', async () => {
    const { runtime, notices, read } = localDreamPage();
    const old = runtime.longDreamCache[0];
    const current = await runtime.longDreamPut({ ...old, title: '更新的标题' });
    const reasons = [];
    assert.equal(await runtime.longDreamPut({ ...old, title: '过期标题' }, { onConflict: reason => reasons.push(reason) }), false);
    assert.deepEqual(reasons, ['local']);
    assert.equal(read().title, '更新的标题');
    assert.ok(!runtime.archiveStale);
    assert.ok(notices.every(message => !message.includes('另一个页面')));
    assert.ok(await runtime.longDreamPut({ ...current, title: '继续修改' }));
});

test('织录响应失败时如果草稿事务尚未提交，收尾仍写入失败状态并保留草稿', async t => {
    const response = Promise.withResolvers();
    const requested = Promise.withResolvers();
    const draftWriting = Promise.withResolvers();
    const releaseDraft = Promise.withResolvers();
    const { runtime, read, notices } = localDreamPage({ beforeCommit: async record => {
        if (record.draft && !read().draft) {
            draftWriting.resolve();
            await releaseDraft.promise;
        }
    } });
    Object.assign(runtime, {
        settings: { longDreamMemoryBatchSize: 1, streamEnabled: false },
        runtimeLog() {},
        selectedLongDreamMemoryApiPreset: () => ({ apiUrl: 'https://example.invalid/v1', apiModel: 'synthetic', name: 'synthetic' }),
    });
    t.mock.method(globalThis, 'fetch', () => { requested.resolve(); return response.promise; });
    const weaving = createLongDreamRuntime(runtime).weaveLongDreamMemory(1, { force: true });
    await requested.promise;
    assert.equal(read().memory.status, 'weaving');
    const drafting = runtime.longDreamPut(saveLongDreamDraft(runtime.longDreamCache[0], { status: 'writing', text: '本页的草稿' }));
    await draftWriting.promise;
    response.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '不是可解析的梦脉' }, finish_reason: 'stop' }] }), {
        headers: { 'content-type': 'application/json' },
    }));
    await new Promise(resolve => setImmediate(resolve));
    releaseDraft.resolve();
    assert.ok(await drafting);
    await weaving;
    assert.equal(read().memory.status, 'failed');
    assert.equal(read().draft.text, '本页的草稿');
    assert.ok(!runtime.archiveStale);
    assert.ok(notices.every(message => !message.includes('另一个页面')));
});
test('长梦新增、更新、删除请求成功后事务中止，均返回失败且原缓存不变', async () => {
    const notices = [];
    globalThis.toastr = { error: message => notices.push(message) };
    for (const method of ['longDreamAdd', 'longDreamPut', 'longDreamDelete']) {
        const record = dream();
        const calls = [];
        const runtime = { longDreamCache: [record], idb: { transaction() {
            const tx = { error: new DOMException('synthetic', 'QuotaExceededError') };
            const request = () => {
                const req = { result: 2 };
                queueMicrotask(() => {
                    calls.push('request success');
                    req.onsuccess?.();
                    setImmediate(() => { calls.push('transaction abort'); tx.onabort?.(); });
                });
                return req;
            };
            tx.objectStore = () => ({ add: request, put: request, delete: request, get() {
                const read = { result: record };
                queueMicrotask(() => read.onsuccess());
                return read;
            } });
            return tx;
        } } };
        assert.equal(await createTheaterStorage(runtime)[method](method === 'longDreamDelete' ? 1 : { ...record, title: '新标题' }), false);
        assert.deepEqual(calls, ['request success', 'transaction abort']);
        assert.deepEqual(runtime.longDreamCache, [record]);
        assert.equal(runtime.longDreamCache[0], record);
    }
    assert.equal(notices.length, 3);
});

test('正文已返回而写入失败时，把完整新正文交给上层保留', async () => {
    const text = '这段新写的正文不应随写入失败而消失。'.repeat(20);
    const controller = createLongDreamGenerationController({
        requestChapter: async ({ onChunk }) => {
            onChunk(text.slice(0, 30));
            await new Promise(resolve => setImmediate(resolve));
            return { text };
        },
        renderChapter: async () => assert.fail('不进入排版'),
        persistRecord: async record => record.draft?.text ? false : record,
    });
    await assert.rejects(controller.run({ record: dream(), instruction: '测试', targetChars: 500 }), error => {
        assert.equal(error.unsavedLongDreamDraft.text, text);
        return true;
    });
});

test('长梦写入原子比较版本，拒绝旧页并保留新章；无 revision 的旧记录仍可写', async () => {
    globalThis.toastr = { error() {}, warning() {} };
    const original = dream();
    let stored = original;
    function page() {
        const runtime = { longDreamCache: [original], idb: { transaction() {
            let next;
            const tx = { abort: () => setImmediate(() => tx.onabort?.()) };
            const read = { get result() { return stored; } };
            tx.objectStore = () => ({
                get() { queueMicrotask(() => read.onsuccess()); return read; },
                put(record) {
                    next = record;
                    const request = {};
                    queueMicrotask(() => request.onsuccess?.());
                    setImmediate(() => { stored = next; tx.oncomplete(); });
                    return request;
                },
            });
            return tx;
        } } };
        return createTheaterStorage(runtime);
    }
    const [a, b] = [page(), page()];
    const chapter = { ...original.chapters[0], id: 'new', text: '第二章' };
    assert.equal((await a.longDreamPut({ ...original, chapters: [...original.chapters, chapter] })).revision, 1);
    assert.equal(await b.longDreamPut({ ...original, title: '旧页修改' }), false);
    assert.equal(stored.chapters[1].text, '第二章');
    assert.equal(normalizeBackupData({ dreams: [stored] }).dreams[0].revision, 1);
    assert.equal(await itemFingerprint('dreams', stored), await itemFingerprint('dreams', { ...stored, revision: 9 }));
});

test('页面收到其他页写入后，拒绝普通历史和长梦写入', async () => {
    globalThis.toastr = { error() {}, warning() {} };
    const channels = [];
    class Channel {
        constructor() { channels.push(this); }
        postMessage(data) { for (const peer of channels) if (peer !== this) peer.onmessage({ data }); }
    }
    const open = () => {
        const runtime = { idb: { transaction() { assert.fail('过期页面不应写数据库'); } }, historyWriteQueue: Promise.resolve() };
        const storage = createTheaterStorage(runtime, { Channel, toast: globalThis.toastr });
        runtime.archiveSync.open();
        return { runtime, storage };
    };
    const a = open(), b = open();
    a.runtime.archiveSync.publish('dream');
    assert.equal(b.runtime.archiveStale, true);
    assert.equal(await b.storage.histAdd({ html: '<p>test</p>' }), false);
    assert.equal(await b.storage.longDreamPut(dream()), false);
});

test('通知失效时旧页文件夹写入原子拒绝，刷新后仍可修改', async () => {
    globalThis.toastr = { error() {}, warning() {} };
    let stored;
    function page() {
        const runtime = { historyCache: [], historyCollections: stored || [], historyWriteQueue: Promise.resolve(),
            idb: { transaction() {
                const tx = { abort: () => queueMicrotask(() => tx.onabort()) };
                const kv = { get() {
                    const read = { result: stored };
                    queueMicrotask(() => read.onsuccess());
                    return read;
                }, put(value) { stored = value; queueMicrotask(() => tx.oncomplete()); } };
                tx.objectStore = () => kv;
                return tx;
            } } };
        Object.assign(runtime, createTheaterStorage(runtime));
        runtime.historyCollectionsStoredJson = runtime.archiveSync.folderSignature(stored);
        return createTheaterHistory(runtime);
    }
    const [a, b] = [page(), page()];
    const add = title => (items, folders) => ({ items, folders: [...folders, { id: title, title, itemIds: [] }] });
    assert.equal(await a.commitHistoryCollection(add('新文件夹')), true);
    assert.equal(await b.commitHistoryCollection(add('旧页文件夹')), false);
    assert.equal(await page().commitHistoryCollection(add('刷新后文件夹')), true);
    assert.deepEqual(stored.map(folder => folder.title), ['新文件夹', '刷新后文件夹']);
});
