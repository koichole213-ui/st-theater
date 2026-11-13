import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterStorage } from '../theater-storage.js';
import { createLongDreamRecord } from '../long-dream.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';
import { itemFingerprint, normalizeBackupData } from '../backup-data.js';
import { createTheaterHistory } from '../theater-history.js';

const dream = () => ({ ...createLongDreamRecord({ title: '测试', source: { html: '<p>第一章</p>', text: '第一章' } }), id: 1 });
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
