import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTheaterStorage } from '../theater-storage.js';
import { normalizeCollections, historyOrder } from '../history-collections.js';

function historyFunction(name, runtime, extras = {}) {
    const source = readFileSync(new URL('../theater-history.js', import.meta.url), 'utf8');
    const start = source.indexOf(`// @theater-source-begin ${name}\n`);
    const end = source.indexOf(`// @theater-source-end ${name}`, start);
    assert.ok(start >= 0 && end > start);
    return runInNewContext(`${source.slice(start, end)}\n${name}`, { runtime, toastr: globalThis.toastr, ...extras });
}

function fixture(t, failure = '', sync = false) {
    let activeFailure = failure;
    const notices = [], accesses = [];
    const rows = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
    const folders = [{ id: 'folder', title: 'Folder', itemIds: ['1', '2'] }];
    const recent = [{ html: '<p>recent</p>' }], current = { html: '<p>current</p>' };
    const dreams = [{ id: 1, title: 'Dream', chapters: [{ text: 'synthetic story' }] }];
    const request = (key, value) => {
        accesses.push(key);
        if (sync && key === activeFailure) throw new Error('synthetic transaction failure');
        const req = {};
        queueMicrotask(() => {
            if (key === activeFailure) { req.error = new Error('synthetic read failure'); req.onerror(); }
            else { req.result = structuredClone(value); req.onsuccess(); }
        });
        return req;
    };
    const db = { transaction(store, mode) {
        assert.notEqual(mode, 'readwrite', 'initial loading must not write synthetic data');
        return { objectStore: () => ({
            getAll: () => request(store, store === 'history' ? rows : dreams),
            get: key => request({ 'history-collections': 'collections', recent: 'recent', 'current-result': 'current' }[key], { 'history-collections': folders, recent, 'current-result': current }[key]),
        }) };
    } };
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    const oldIDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const oldToastr = Object.getOwnPropertyDescriptor(globalThis, 'toastr');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
        const req = {};
        queueMicrotask(() => {
            if (activeFailure === 'database') { req.error = new Error('synthetic open failure'); req.onerror(); }
            else { req.result = db; req.onsuccess(); }
        });
        return req;
    } } });
    Object.defineProperty(globalThis, 'toastr', { configurable: true, value: {
        error: (...args) => notices.push(args), warning: (...args) => notices.push(args),
    } });
    t.after(() => {
        if (oldIDB) Object.defineProperty(globalThis, 'indexedDB', oldIDB); else delete globalThis.indexedDB;
        if (oldToastr) Object.defineProperty(globalThis, 'toastr', oldToastr); else delete globalThis.toastr;
    });
    let saves = 0;
    const runtime = { settings: { history: [], recentGenerations: [], longDreams: [], historyCollections: [] }, historyCache: [], historyCollections: [], recentCache: [], longDreamCache: [], currentGenerationResult: null, runtimeLog() {}, save() { saves++; } };
    return { runtime, notices, accesses, rows, folders, recent, current, storage: createTheaterStorage(runtime), saves: () => saves, setFailure: value => { activeFailure = value; } };
}

test('正常加载所有存档，不写入数据库或设置', async t => {
    const f = fixture(t);
    await f.storage.storageInit();
    assert.deepEqual(f.runtime.historyCache, f.rows);
    assert.deepEqual(f.runtime.historyCollections, f.folders);
    assert.deepEqual(f.runtime.recentCache, f.recent);
    assert.deepEqual(f.runtime.currentGenerationResult, f.current);
    assert.equal(f.runtime.longDreamCache.length, 1);
    assert.deepEqual(f.runtime.storageReadErrors, {});
    assert.equal(f.saves(), 0);
    assert.equal(f.notices.length, 0);
});

for (const failure of ['history', 'collections', 'recent', 'current', 'dreams']) {
    test(`${failure}读取失败只影响自身，其他存档继续读取`, async t => {
        const f = fixture(t, failure);
        await f.storage.storageInit();
        assert.equal(f.runtime.historyCache.length, failure === 'history' ? 0 : 2);
        assert.equal(f.runtime.recentCache.length, failure === 'recent' ? 0 : 1);
        assert.equal(f.runtime.longDreamCache.length, failure === 'dreams' ? 0 : 1);
        assert.equal(f.runtime.currentGenerationResult?.html, failure === 'current' ? undefined : f.current.html);
        if (failure === 'history') assert.deepEqual(f.runtime.historyCollections[0].itemIds, ['1', '2']);
        assert.deepEqual(f.runtime.storageReadErrors, { [failure]: true });
        assert.deepEqual(f.accesses, ['history', 'collections', 'recent', 'current', 'dreams']);
        assert.equal(f.saves(), 0);
        assert.equal(f.rows.length, 2);
        assert.equal(f.notices.length, 1);
        assert.match(f.notices[0][0], /读取失败/);
        if (failure === 'recent' || failure === 'current') assert.equal(await f.storage.recentPersist([], null), false);
    });
}

test('同步transaction异常不会中止后续读取，已有缓存不清空', async t => {
    const f = fixture(t, 'history', true);
    const cached = [{ id: 99, title: 'cached' }];
    f.runtime.historyCache = cached;
    await f.storage.storageInit();
    assert.equal(f.runtime.historyCache, cached);
    assert.equal(f.runtime.longDreamCache.length, 1);
    assert.equal(f.saves(), 0);
});

test('数据库打不开时提示失败，保留settings回退及旧存档', async t => {
    const f = fixture(t, 'database');
    f.runtime.settings.history = [{ id: 7, title: 'legacy' }];
    await f.storage.storageInit();
    assert.equal(f.runtime.historyCache, f.runtime.settings.history);
    assert.equal(f.runtime.historyCache[0].title, 'legacy');
    assert.deepEqual(f.runtime.storageReadErrors, { database: true });
    assert.match(f.notices[0][0], /不代表.*已被删除/);
    assert.equal(f.saves(), 0);
});

test('空历史在读取失败时不显示正常空态或导入入口', t => {
    fixture(t);
    for (const key of ['database', 'history']) {
        const runtime = { storageReadErrors: { [key]: true } };
        const render = historyFunction('renderHistoryList', runtime, { currentHistoryPage: () => ({ total: 0, page: 0 }) });
        const html = render();
        assert.match(html, /历史存档读取失败/);
        assert.doesNotMatch(html, /暂时没有|data-history-import/);
    }
});

test('部分读取失败阻止文件夹覆盖及启动标签迁移，不调用修改回调', async t => {
    const f = fixture(t);
    for (const key of ['history', 'collections']) {
        f.runtime.storageReadErrors = { [key]: true };
        f.runtime.queueHistoryWrite = operation => operation();
        const commit = historyFunction('commitHistoryCollection', f.runtime);
        assert.equal(await commit(() => { assert.fail('must not edit incomplete collection state'); }), false);
    }
    for (const key of ['database', 'history', 'recent', 'current']) {
        f.runtime.storageReadErrors = { [key]: true };
        await historyFunction('migrateHistoryTags', f.runtime)();
        assert.equal(f.runtime.settings.historyTagSchemaVersion, undefined);
    }
    assert.equal(f.saves(), 0);
});


test('重新初始化读取成功后解除错误状态和保存保护', async t => {
    const f = fixture(t, 'collections');
    await f.storage.storageInit();
    assert.equal(f.runtime.storageReadErrors.collections, true);
    f.setFailure('');
    await f.storage.storageInit();
    assert.deepEqual(f.runtime.storageReadErrors, {});
    assert.deepEqual(f.runtime.historyCollections, f.folders);
    assert.deepEqual(f.runtime.historyCache, f.rows);
    assert.equal(f.saves(), 0);
});


test('数据库不可用但settings回退成功时仍允许保存历史与文件夹', async t => {
    const f = fixture(t, 'database');
    await f.storage.storageInit();
    f.runtime.queueHistoryWrite = operation => operation();
    const commit = historyFunction('commitHistoryCollection', f.runtime, { normalizeCollections, historyOrder });
    assert.equal(await commit(() => ({ items: [{ id: 'new', title: 'New legacy work' }], folders: [{ id: 'folder', itemIds: ['new'] }] })), true);
    assert.equal(f.runtime.settings.history[0].title, 'New legacy work');
    assert.deepEqual(f.runtime.settings.historyCollections[0].itemIds, ['new']);
    assert.equal(f.saves(), 1);
});
