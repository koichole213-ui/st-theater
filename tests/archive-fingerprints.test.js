import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterStorage } from '../theater-storage.js';
import { bindSettingsEvents } from '../theater-events-settings.js';

const origin = 'http://192.0.2.10:8000';
const rows = count => Array.from({ length: count }, (_, id) => ({ id }));
function setup(settings = { archiveFingerprints: { [origin]: { history: 10, dreams: 3, chapters: 9 } } }) {
    const warnings = [], info = [];
    const runtime = { settings, idb: {}, historyCache: [], longDreamCache: [], saves: 0,
        save() { this.saves++; }, runtimeLog() {} };
    createTheaterStorage(runtime, { origin, toast: { warning: (...args) => warnings.push(args), info: message => info.push(message) } });
    return { runtime, safety: runtime.archiveSafety, warnings, info };
}

test('诊断确认按钮使用酒馆的 Popup，取消保留告警，确认后才清除', async t => {
    const { runtime, safety } = setup();
    safety.inspect();
    let handler, approved = false, opened = 0, refreshes = 0;
    const chain = new Proxy({}, { get: (_target, key) => key === 'length' ? 0 : key === 'val' ? () => '' : () => chain });
    const globals = ['$', 'Popup', 'SillyTavern'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    t.after(() => { for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    } });
    globalThis.$ = () => chain;
    delete globalThis.Popup;
    globalThis.SillyTavern = { getContext: () => ({ Popup: { show: { confirm(title) {
        assert.match(title, /以当前存档为准/);
        opened++;
        return approved;
    } } } }) };
    runtime.runDiagnostics = runtime.refreshHistList = () => { refreshes++; };
    bindSettingsEvents(runtime, { off() { return this; }, on(_event, selector, fn) {
        if (selector === '[data-archive-accept]') handler = fn;
        return this;
    } });
    await handler();
    assert.ok(runtime.archiveLossSuspected);
    assert.equal(refreshes, 0);
    approved = true;
    await handler();
    assert.equal(opened, 2);
    assert.equal(runtime.archiveLossSuspected, null);
    assert.equal(refreshes, 2);
});

test('已告警的存档基准跨刷新保留，补齐普通历史和长梦才解除', () => {
    const { runtime, safety, warnings } = setup();
    safety.inspect();
    assert.equal(warnings[0][2].timeOut, 0);
    assert.equal(runtime.settings.archiveFingerprints[origin].history, 10);
    runtime.historyCache = rows(1);
    runtime.longDreamCache = rows(1);
    safety.record();
    runtime.historyCache = [];
    safety.record();
    runtime.historyCache = rows(1);
    const reloaded = setup(JSON.parse(JSON.stringify(runtime.settings)));
    reloaded.runtime.historyCache = rows(1);
    reloaded.runtime.longDreamCache = rows(1);
    reloaded.safety.inspect();
    assert.equal(reloaded.warnings.length, 1);
    assert.deepEqual(reloaded.runtime.archiveLossSuspected.expected, { history: 10, dreams: 3 });
    assert.deepEqual(reloaded.runtime.archiveLossSuspected.found, { history: 1, dreams: 1 });
    reloaded.runtime.historyCache = rows(12);
    reloaded.safety.record({ restored: true });
    assert.equal(reloaded.runtime.archiveLossSuspected.found.history, 12);
    reloaded.runtime.longDreamCache = rows(3);
    reloaded.safety.record({ restored: true });
    assert.equal(reloaded.runtime.archiveLossSuspected, null);
    assert.equal(reloaded.runtime.settings.archiveFingerprints[origin].history, 12);
});

test('正常删减更新基准，读取失败时跳过判断和更新，确认可接受新基准', async () => {
    const { runtime, safety, warnings } = setup();
    runtime.historyCache = rows(7);
    runtime.longDreamCache = rows(3).map(item => ({ ...item, chapters: rows(3) }));
    safety.record();
    safety.inspect();
    assert.equal(warnings.length, 0);
    assert.equal(runtime.settings.archiveFingerprints[origin].history, 7);
    runtime.historyCache = [];
    runtime.storageReadErrors = { recent: true };
    const saves = runtime.saves;
    safety.inspect();
    safety.record();
    assert.equal(warnings.length, 0);
    assert.equal(runtime.saves, saves);
    runtime.storageReadErrors = {};
    safety.inspect();
    const confirm = async () => false;
    assert.equal(await safety.confirmCurrent(confirm), false);
    assert.ok(runtime.archiveLossSuspected);
    assert.equal(await safety.confirmCurrent(async () => true), true);
    assert.equal(runtime.archiveLossSuspected, null);
    assert.equal(runtime.settings.archiveFingerprints[origin].history, 0);
});

test('新地址只提示其他地址有作品，指纹最多保存二十个地址', () => {
    const entries = rows(20).map(({ id }) => ['https://example.test:' + (8000 + id), { history: id + 1, dreams: 0, chapters: 0, updatedAt: new Date(id).toISOString() }]);
    const { runtime, safety, warnings, info } = setup({ archiveFingerprints: Object.fromEntries(entries) });
    safety.inspect();
    assert.equal(warnings.length, 0);
    assert.match(info[0], /example\.test:8019/);
    assert.equal(Object.keys(runtime.settings.archiveFingerprints).length, 20);
    assert.ok(runtime.settings.archiveFingerprints[origin]);
    assert.equal(runtime.settings.archiveFingerprints[entries[0][0]], undefined);
});

test('站点保护只相信 persisted，HTTP 环境不读取 StorageManager', async () => {
    const { safety } = setup();
    const unavailable = { get storage() { assert.fail('不应读取 storage'); } };
    assert.equal(await safety.inspectProtection(false, unavailable), 'unavailable');
    assert.equal(safety.protectionDiagnostic().status, 'warn');
    assert.match(safety.protectionDiagnostic().detail, /HTTP 局域网/);
    for (const returned of [true, false, undefined]) {
        let reads = 0, requests = 0;
        assert.equal(await safety.inspectProtection(true, { storage: {
            persisted: async () => { reads++; return false; },
            persist: async () => { requests++; return returned; },
        } }), 'denied');
        assert.equal(reads, 2);
        assert.equal(requests, 1);
        assert.doesNotMatch(safety.protectionDiagnostic().detail, /已生效/);
    }
    let granted = false;
    assert.equal(await safety.inspectProtection(true, { storage: {
        persisted: async () => granted, persist: async () => { granted = true; return false; },
    } }), 'granted');
    assert.equal(safety.protectionDiagnostic().status, 'ok');
    assert.equal(await safety.inspectProtection(true, { storage: {
        persisted: async () => { throw Error('test'); }, persist: async () => true,
    } }), 'unknown');
    assert.equal(safety.protectionDiagnostic().status, 'warn');
});
