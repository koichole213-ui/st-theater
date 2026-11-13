import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterStorage } from '../theater-storage.js';
import { backupStatusText } from '../backup-ui.js';

test('旧设置的当前和最近正文迁入找回区，保留已存在的数据库正文', async t => {
    const current = { html: '<p>数据库当前正文</p>' };
    const recent = [{ html: '<p>数据库最近正文</p>' }];
    const legacy = { html: '<p>旧设置正文</p>' };
    const values = new Map([['current-result', current], ['recent', recent]]);
    const db = { transaction(_name, mode) {
        const tx = {};
        const result = value => {
            const request = { result: value };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        };
        tx.objectStore = () => ({
            get: key => result(values.get(key)),
            getAll: () => result([]),
            put(value, key) { values.set(key, value); return result(); },
        });
        if (mode === 'readwrite') setImmediate(() => tx.oncomplete?.());
        return tx;
    } };
    globalThis.indexedDB = { open() {
        const req = { result: db };
        queueMicrotask(() => req.onsuccess());
        return req;
    } };
    t.after(() => { delete globalThis.indexedDB; });
    globalThis.toastr = { warning() {}, error() {} };
    const runtime = { settings: { currentGenerationResult: legacy, recentGenerations: [legacy] }, runtimeLog() {}, save() {} };
    await createTheaterStorage(runtime).storageInit();
    assert.deepEqual(values.get('current-result'), current);
    assert.deepEqual(values.get('recent'), recent);
    assert.deepEqual(values.get('backup-recovered-results').map(row => row.html), [legacy.html]);
    assert.equal(runtime.settings.currentGenerationResult, null);
    assert.deepEqual(runtime.settings.recentGenerations, []);
});

test('本机下载状态明确说明无法确认是否落盘，GitHub 状态仍确认上传', () => {
    const state = { local: { time: 1000 }, github: { time: 1000 } };
    assert.match(backupStatusText(state, 'local'), /最近发起下载（浏览器无法确认是否保存成功）/);
    assert.match(backupStatusText(state, 'github'), /最近上传成功/);
});
