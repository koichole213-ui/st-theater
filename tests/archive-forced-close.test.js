import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterStorage } from '../theater-storage.js';
import { createTheaterHistory } from '../theater-history.js';
import { createBackupStorage } from '../backup-storage.js';
import { createCompleteBackup, itemFingerprint, normalizeBackupData, parseCompleteBackup, planBackupRestore } from '../backup-data.js';
import { createLongDreamRecord } from '../long-dream.js';

const origin = 'http://tavern.example:8000';
const sourceId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const title = '合成作品';
const history = [{ id: 1, title, html: '<p>原有作品</p>', text: '原有作品', mode: 'html' }];
const dreams = [{ ...createLongDreamRecord({ title, source: { html: '<p>长梦第一章</p>', text: '长梦第一章' } }), id: 2 }];
const folders = [{ id: 'f', title: '合成收纳', itemIds: ['1'] }];
const recent = [{ id: 'recent', title, html: '<p>最近结果</p>' }];
const current = { id: 'current', title, html: '<p>当前结果</p>' };

function fixture(t) {
    const events = [], warnings = [];
    const settings = { archiveFingerprints: { [origin]: { history: 1, dreams: 1, chapters: 1 } } };
    const answer = result => {
        const request = {};
        queueMicrotask(() => { request.result = structuredClone(result); request.onsuccess(); });
        return request;
    };
    let accesses = 0, saves = 0, voluntaryCloses = 0;
    const db = {
        transaction(store, mode) {
            accesses++;
            assert.notEqual(mode, 'readwrite');
            return { objectStore: () => ({
                getAll: () => answer(store === 'history' ? history : dreams),
                get: key => answer({ 'history-collections': folders, recent, 'current-result': current }[key]),
            }) };
        },
        close() { voluntaryCloses++; },
    };
    const oldIdb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
        const request = { result: db };
        queueMicrotask(() => request.onsuccess());
        return request;
    } } });
    t.after(() => oldIdb ? Object.defineProperty(globalThis, 'indexedDB', oldIdb) : delete globalThis.indexedDB);
    const runtime = {
        VERSION: '4.4.8d', settings, historyCache: [], historyCollections: [], longDreamCache: [], recentCache: [],
        historyWriteQueue: Promise.resolve(), resultStorageQueue: Promise.resolve(),
        save() { saves++; },
        runtimeLog(level, message, evidence) { events.push({ level, message, evidence }); },
    };
    const toast = { error: (message, signal) => warnings.push({ message, signal }), warning: () => {} };
    Object.assign(runtime, createTheaterStorage(runtime, { origin, toast, Channel: null }));
    return { runtime, db, events, warnings, accesses: () => accesses, saves: () => saves, voluntaryCloses: () => voluntaryCloses };
}

test('异常关闭只记录一次，后续写入不访问数据库也不等待已有写入', { timeout: 1000 }, async t => {
    const { runtime, db, events, warnings, accesses, saves } = fixture(t);
    await runtime.storageInit();
    const beforeSaves = saves();
    db.onclose();
    db.onclose();
    assert.equal(runtime.archiveClosed, true);
    const signal = runtime.settings.archiveFingerprints[origin].forcedClose;
    assert.ok(Number.isFinite(Date.parse(signal.at)));
    assert.deepEqual([signal.history, signal.dreams, signal.chapters, signal.version], [1, 1, dreams[0].chapters.length, '4.4.8d']);
    assert.equal(saves(), beforeSaves + 1);
    assert.equal(events.filter(event => event.message === '本地存档连接被浏览器关闭').length, 1);
    const beforeAccess = accesses();
    runtime.historyWriteQueue = runtime.resultStorageQueue = new Promise(() => {});
    const theaterHistory = createTheaterHistory(runtime);
    assert.equal(await runtime.histAddStorage(history[0]), false);
    assert.equal(await runtime.histAdd(history[0]), false);
    assert.equal(await theaterHistory.commitHistoryCollection(() => assert.fail('不得修改收纳')), false);
    assert.equal(await runtime.longDreamPut(runtime.longDreamCache[0]), false);
    assert.equal(await runtime.recentPersist(), false);
    assert.equal(await runtime.storeCurrentResult(current), false);
    await assert.rejects(createBackupStorage(runtime).put('backup-state', {}), {
        code: 'T-STORAGE-WRITE', message: /先下载抢救备份/,
    });
    assert.equal(warnings.length, 6);
    assert.ok(warnings.every(({ message, signal: code }) => code === 'T-STORAGE-WRITE' && /下载抢救备份/.test(message) && !/IDBDatabase|transaction/.test(message)));
    assert.equal(accesses(), beforeAccess);
    assert.equal(runtime.historyCache.length, 1);
});

test('数据库升级主动关闭只走跨页过期处理', async t => {
    const { runtime, db, events, voluntaryCloses } = fixture(t);
    await runtime.storageInit();
    db.onversionchange();
    assert.equal(voluntaryCloses(), 1);
    assert.equal(runtime.archiveStale, true);
    assert.equal(runtime.archiveClosed, undefined);
    assert.equal(runtime.settings.archiveFingerprints[origin].forcedClose, undefined);
    assert.ok(!events.some(event => event.message === '本地存档连接被浏览器关闭'));
});

test('已经开始的事务先被浏览器中止时，关闭事件到达前也不显示英文报错', async t => {
    const { runtime, db } = fixture(t);
    await runtime.storageInit();
    const notices = [];
    const oldToast = Object.getOwnPropertyDescriptor(globalThis, 'toastr');
    Object.defineProperty(globalThis, 'toastr', { configurable: true, value: { error: text => notices.push(text) } });
    t.after(() => oldToast ? Object.defineProperty(globalThis, 'toastr', oldToast) : delete globalThis.toastr);
    t.mock.method(console, 'error', () => {});
    db.transaction = () => {
        const request = {};
        const transaction = { objectStore: () => ({ add: () => request }) };
        queueMicrotask(() => {
            transaction.error = request.error = new DOMException('The transaction was aborted.', 'AbortError');
            request.onerror();
            transaction.onabort();
        });
        return transaction;
    };
    const saved = await runtime.histAddStorage({ ...history[0], id: 8 });
    assert.equal(saved, false);
    assert.match(notices[0], /本地存档操作中断/);
    assert.doesNotMatch(notices[0], /transaction|IDBDatabase/);
    assert.equal(runtime.archiveClosed, undefined);
    db.onclose();
    assert.equal(runtime.archiveClosed, true);
});

test('抢救快照跳过关闭的数据库和写入队列，原格式可导回同样的作品', async () => {
    const pending = new Promise(() => {});
    const runtime = {
        archiveClosed: true,
        idb: { transaction: () => assert.fail('抢救不应访问数据库') },
        historyWriteQueue: pending, resultStorageQueue: pending,
        historyCache: history, longDreamCache: dreams, historyCollections: folders,
        recentCache: recent, currentGenerationResult: current,
        settings: { instructionTemplates: [], instructionTags: [] },
    };
    const snapshot = createBackupStorage(runtime).rescueSnapshot();
    const packet = await parseCompleteBackup(await createCompleteBackup(snapshot, { sourceId, deviceName: '手机-抢救' }));
    const restored = await planBackupRestore(normalizeBackupData({}), packet, ['history', 'dreams', 'recent'], 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb');
    assert.deepEqual([packet.counts.history, packet.counts.dreams, packet.data.folders.length], [1, 1, 1]);
    assert.equal(await itemFingerprint('history', restored.next.history[0]), await itemFingerprint('history', packet.data.history[0]));
    assert.equal(await itemFingerprint('dreams', restored.next.dreams[0]), await itemFingerprint('dreams', packet.data.dreams[0]));
    assert.equal(restored.next.recovered.length, 2);
});
