import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterBackup } from '../theater-backup.js';
import { createServerBackupClient, readServerBackupAccount, serverBackupName, serverBackupPath, SERVER_BACKUP_INDEX, SERVER_BACKUP_GIB } from '../server-backup.js';

const origin = 'http://tavern.test:8000';
const desktop = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const phone = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const backupName = 'st-theater-backup-a-desktop-20261115-120000-h400-d0.zip';
const entry = { path: serverBackupPath(backupName), origin, sourceId: desktop, device: '电脑', time: Date.now() - 2 * 86400000,
    checksum: '1'.repeat(64), bytes: 14, counts: { history: 400, dreams: 0, chapters: 0 } };
const indexBody = entries => JSON.stringify({ format: 'st-theater-backup-index', version: 1, entries });
const filesPrefix = '/user/files/';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

function mockHost({ entries, fail = '', malformed = false, reportUnsupported = false, concurrent = false, activeAccount = '',
    beforeVerify = () => {} } = {}) {
    const files = new Map();
    const calls = [];
    const startReads = Promise.withResolvers(), firstWrites = Promise.withResolvers();
    let reads = 0, writes = 0;
    if (entries || malformed) files.set(SERVER_BACKUP_INDEX, Buffer.from(malformed ? 'broken' : indexBody(entries)));
    const request = async (path, options) => {
        assert.equal(options.cache, 'no-store');
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ path, name: body?.name });
        assert.notEqual(path, '/api/files/delete');
        if (path === '/api/users/me') return activeAccount ? json({ handle: activeAccount }) : json({}, 404);
        if (path === '/api/files/upload') {
            assert.match(body.name, /^[a-zA-Z0-9_.-]+$/);
            if (body.name === SERVER_BACKUP_INDEX && fail === 'index') return json({}, 500);
            files.set(body.name, Buffer.from(body.data, 'base64'));
            if (body.name === SERVER_BACKUP_INDEX && ++writes === 2) firstWrites.resolve();
            return json({ path: filesPrefix.slice(1) + body.name });
        }
        if (path === '/api/files/verify') {
            beforeVerify();
            return json({ [body.urls[0]]: fail !== 'verify' });
        }
        if (path === '/api/data-maid/report') {
            if (reportUnsupported) return json({}, 404);
            return json({ token: 'synthetic-scan-id', report: { files: [
                { name: backupName, size: 32, mtime: 800.5 },
                { name: SERVER_BACKUP_INDEX }, { name: 'other.zip' }, { name: '../wrong.zip' },
            ] } });
        }
        if (path === '/api/data-maid/finalize') {
            assert.deepEqual(body, { token: 'synthetic-scan-id' });
            return new Response(null, { status: 204 });
        }
        const name = path.slice(filesPrefix.length);
        const data = files.get(name);
        if (name === SERVER_BACKUP_INDEX && concurrent && reads < 2) {
            if (++reads === 2) startReads.resolve();
            await startReads.promise;
        }
        if (!data) return json({}, 404);
        if (name !== SERVER_BACKUP_INDEX && fail === 'size') return new Response(new Uint8Array([1]));
        if (name !== SERVER_BACKUP_INDEX && fail === 'hash') return new Response(new Uint8Array([3, 2, 1]));
        return new Response(data);
    };
    const client = () => createServerBackupClient({ request, wait: concurrent ? () => firstWrites.promise : async () => {} });
    return {
        client, calls, setAccount: handle => { activeAccount = handle; },
        replaceDirectory: entries => files.set(SERVER_BACKUP_INDEX, Buffer.from(indexBody(entries))),
        zipWrites: () => calls.filter(call => call.name?.endsWith('.zip')),
        indexWrites: () => calls.filter(call => call.name === SERVER_BACKUP_INDEX),
    };
}

function fixture(t, host, { sourceId, initialOff = false, disableOnServer = false, settingsEntries, baseline, count = 3, loss,
    failStateWrite = false, state = new Map(), account = null, confirmAccount } = {}) {
    if (sourceId || initialOff) state.set('backup-config', { ...(sourceId ? { sourceId } : {}), ...(initialOff ? { server: false } : {}), deviceName: '合成手机' });
    if (baseline) state.set('backup-state', { baseline });
    const settings = { ...(disableOnServer ? { serverBackupOff: { [origin]: true } } : {}), serverBackups: settingsEntries };
    const notices = [];
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const oldToast = Object.getOwnPropertyDescriptor(globalThis, 'toastr');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null, querySelectorAll: () => [] } });
    Object.defineProperty(globalThis, 'toastr', { configurable: true, value: { info: text => notices.push(text) } });
    t.after(() => {
        if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
        else delete globalThis.document;
        if (oldToast) Object.defineProperty(globalThis, 'toastr', oldToast);
        else delete globalThis.toastr;
    });
    const snapshot = () => ({ history: Array.from({ length: count }, (_, i) => ({ id: i + 1, title: `篇章${i}`, html: '<p>合成正文</p>' })) });
    const runtime = { idb: {}, settings, archiveLossSuspected: loss, save() {}, runtimeLog() {},
        loadJSZip: async () => class {
            file() {}
            async generateAsync() { return new Uint8Array([1, 2, 3]); }
        },
    };
    const storage = {
        get: async key => state.get(key),
        saveConfiguration: async update => {
            const next = update(state.get('backup-config'));
            state.set('backup-config', structuredClone(next));
            return { config: next, state: null };
        },
        put: async (key, value) => {
            if (failStateWrite && key === 'backup-state') throw new Error('synthetic IndexedDB save failure');
            state.set(key, structuredClone(value));
        },
        withLease: operation => operation(),
        recoverJournal: async () => {},
        snapshot: async () => ({ data: snapshot() }),
        rescueSnapshot: snapshot,
    };
    const backup = createTheaterBackup(runtime, { storage, serverClient: host.client(), origin, readAccount: async () => account, confirmAccount,
        githubClient: () => ({ upload: () => assert.fail('服务器备份不能调用 GitHub') }) });
    return { backup, runtime, notices, state, setCount: next => { count = next; } };
}

test('无本地设置时默认上传，原定期备份总开关关闭也生效，内容不变跳过', async t => {
    const host = mockHost();
    const { backup, state } = fixture(t, host);
    await backup.onOpen();
    assert.equal(state.get('backup-config').enabled, false);
    assert.equal(host.zipWrites().length, 1);
    assert.equal(host.indexWrites().length, 1);
    await backup.runBackup(['server']);
    assert.equal(host.zipWrites().length, 1);
});

for (const setting of ['initialOff', 'disableOnServer']) {
    test(`服务器关闭优先（${setting}），包括清空后的浏览器`, async t => {
        const host = mockHost();
        const { backup } = fixture(t, host, { [setting]: true });
        await backup.onOpen();
        await backup.runBackup(['server']);
        assert.equal(host.calls.length, 0);
    });
}

test('新浏览器的空作品不上传，开始有作品时只提示一次同网址的旧备份', async t => {
    const host = mockHost({ entries: [entry] });
    const { backup, setCount, notices, state } = fixture(t, host, { count: 0, loss: { since: 'fixture' } });
    await backup.onOpen();
    assert.equal(host.zipWrites().length, 0);
    assert.equal(host.indexWrites().length, 0);
    assert.notEqual(state.get('backup-config').sourceId, desktop);
    setCount(3);
    await backup.runBackup(['server']);
    assert.equal(host.zipWrites().length, 1);
    assert.equal(notices.filter(text => text.includes('同一网址下还有')).length, 1);
    setCount(4);
    await backup.runBackup(['server']);
    assert.equal(host.zipWrites().length, 2);
    assert.equal(notices.filter(text => text.includes('同一网址下还有')).length, 1);
});

test('同网址不同设备独立保存；本设备数量下降继续存，旧的两份都保留', async t => {
    const host = mockHost({ entries: [entry] });
    const { backup, setCount, notices } = fixture(t, host, { sourceId: phone, count: 20, baseline: entry.counts });
    await backup.runBackup(['server', 'github']);
    assert.equal(host.zipWrites().length, 1);
    const phoneFirst = (await host.client().readIndex()).find(file => file.sourceId === phone);
    assert.equal(phoneFirst.reduced, undefined);
    assert.equal(notices.filter(text => text.includes('同一网址下还有')).length, 1);
    setCount(3);
    await backup.runBackup(['server']);
    const files = await host.client().readIndex();
    assert.equal(files.length, 3);
    assert.equal(files.find(file => file.sourceId === phone && file.counts.history === 3).reduced, true);
    assert.ok(files.some(file => file.path === entry.path));
    assert.ok(files.some(file => file.path === phoneFirst.path));
    assert.ok(notices.some(text => text.includes('从 20 变为 3')));
});

test('同设备从 400 降至 30，仍验证上传并标出减少', async t => {
    const host = mockHost({ entries: [entry] });
    const { backup } = fixture(t, host, { sourceId: desktop, count: 30 });
    await backup.runBackup(['server']);
    const [current, previous] = await host.client().readIndex();
    assert.equal(current.reduced, true);
    assert.equal(previous.path, entry.path);
    assert.equal(previous.counts.history, 400);
});

for (const fail of ['verify', 'size', 'hash']) {
    test(`校验失败（${fail}）时不登记条目或写目录`, async t => {
        const host = mockHost({ fail });
        const { backup, runtime } = fixture(t, host);
        await backup.runBackup(['server']);
        assert.equal(host.zipWrites().length, 1);
        assert.equal(host.indexWrites().length, 0);
        assert.equal(runtime.settings.serverBackups, undefined);
        assert.match(backup.diagnosticText(), /最近失败/);
    });
}

for (const mode of ['malformed', 'index']) {
    test(`目录异常（${mode}）时保存成功，清单仍会登记`, async t => {
        const host = mockHost(mode === 'malformed' ? { malformed: true } : { fail: 'index' });
        const { backup, runtime, state } = fixture(t, host);
        await backup.runBackup(['server']);
        assert.equal(host.zipWrites().length, 1);
        if (mode === 'malformed') assert.equal(host.indexWrites().length, 0);
        assert.equal(runtime.settings.serverBackups.length, 1);
        assert.equal(state.get('backup-state').server.pending.length, 1);
        assert.match(backup.diagnosticText(), /最近保存/);
    });
}

test('目录并发读到同一旧内容仍能合并，设置侧条目也会补回', { timeout: 5000 }, async () => {
    const host = mockHost({ concurrent: true });
    const other = { ...entry, sourceId: phone, path: serverBackupPath('st-theater-backup-phone.zip') };
    const mirrored = { ...entry, path: serverBackupPath('st-theater-backup-unindexed.zip') };
    await Promise.all([host.client().publish([entry, mirrored]), host.client().publish([other])]);
    const paths = (await host.client().readIndex()).map(file => file.path);
    assert.deepEqual(new Set(paths), new Set([entry.path, other.path, mirrored.path]));
});

test('目录和设置同时漏掉上一次备份，原设备下次即使内容相同也能补回', async t => {
    const host = mockHost();
    const original = fixture(t, host, { sourceId: desktop });
    await original.backup.runBackup(['server']);
    const [remembered] = await host.client().readIndex();
    host.replaceDirectory([]);
    const restart = fixture(t, host, { state: original.state });
    const requests = host.calls.length;
    await restart.backup.onOpen();
    assert.equal(host.calls.length, requests, '还没到期时打开面板不读存档、不请求服务器');
    const saved = original.state.get('backup-state');
    saved.server = { ...saved.server, time: saved.server.time - 2 * 86400000, lastAttempt: saved.server.lastAttempt - 2 * 86400000 };
    const nextDay = fixture(t, host, { state: original.state });
    await nextDay.backup.onOpen();
    assert.ok((await host.client().readIndex()).some(file => file.path === remembered.path), '到期后把漏掉的那份补回目录');
    assert.ok(nextDay.runtime.settings.serverBackups.some(file => file.path === remembered.path));
});

test('服务器已校验的 ZIP 不依赖本机状态写入，写入失败仍登记两份清单', async t => {
    const host = mockHost();
    const { backup, runtime } = fixture(t, host, { failStateWrite: true });
    await backup.runBackup(['server']);
    assert.equal(host.zipWrites().length, 1);
    assert.equal(host.indexWrites().length, 1);
    assert.equal(runtime.settings.serverBackups.length, 1);
    assert.match(backup.diagnosticText(), /最近保存/);
});

test('手动查找筛选 ZIP 并清理会话，404 提供手动入口', async () => {
    const host = mockHost();
    assert.deepEqual(await host.client().find(), [{ path: entry.path, time: 800, bytes: 32 }]);
    assert.deepEqual(host.calls.map(call => call.path), ['/api/data-maid/report', '/api/data-maid/finalize']);
    assert.equal(await mockHost({ reportUnsupported: true }).client().find(), null);
});

test('HTTP 成功但目录内容为 JSON null 时保留原目录', async () => {
    let writes = 0;
    const client = createServerBackupClient({ request: async (_, options) => {
        if (options.method === 'POST') writes++;
        return json(null);
    } });
    await assert.rejects(client.publish([entry]), /原目录已保留/);
    assert.equal(writes, 0);
});

test('文件名安全、同秒不覆盖；非法文件名不发网络请求', async () => {
    const host = mockHost();
    const info = { sourceId: desktop, deviceName: '中文/手机', counts: { history: 1, dreams: 0 } };
    const first = serverBackupName(info, entry.time);
    assert.match(first, /^st-theater-backup-aaaaaaaa-xxxxx-/);
    assert.notEqual(serverBackupName(info, entry.time), first);
    await assert.rejects(host.client().upload(new Uint8Array([1]), '../wrong.zip'), /无效/);
    assert.equal(host.calls.length, 0);
});

test('占用越过一 GB 提醒一次，目录无任何删除；抢救可保存内存', async t => {
    const old = { ...entry, bytes: SERVER_BACKUP_GIB + 1024 ** 2 };
    const host = mockHost({ entries: [old] });
    const { backup, runtime, setCount, notices } = fixture(t, host, { sourceId: desktop, loss: { since: 'fixture' } });
    await backup.runBackup(['server']);
    setCount(4);
    await backup.runBackup(['server']);
    assert.equal(notices.filter(text => text.includes('服务器备份已占')).length, 1);
    runtime.archiveClosed = true;
    await backup.runRescueBackup('server');
    assert.match(host.zipWrites().at(-1).name, /-rescue-/);
    assert.ok((await host.client().readIndex()).some(file => file.path === old.path));
});

test('宿主多账号识别使用实际账号模块，关闭或无法读取时按单账号', async () => {
    assert.equal(await readServerBackupAccount(async () => ({ accountsEnabled: false })), null);
    assert.equal(await readServerBackupAccount(async () => { throw new Error('fixture unavailable'); }), null);
    assert.deepEqual(await readServerBackupAccount(async () => ({
        accountsEnabled: true, getCurrentUserHandle: () => 'account-a', currentUser: { name: '测试账户 A' },
    })), { handle: 'account-a', name: '测试账户 A' });
});

test('多账号第一次手动确认才保存，换账号后暂停自动上传', async t => {
    const host = mockHost({ activeAccount: 'account-a' });
    const account = { handle: 'account-a', name: '甲' };
    let allow = false;
    let confirmationCount = 0;
    const first = fixture(t, host, { account, confirmAccount: user => {
        assert.equal(user, account);
        confirmationCount++;
        return allow;
    } });
    await first.backup.onOpen();
    assert.equal(host.calls.length, 0);
    assert.equal(confirmationCount, 0);
    assert.match(first.backup.diagnosticText(), /自动保存待确认/);
    await first.backup.runBackup(['server'], { action: 'save-server' });
    assert.equal(host.zipWrites().length, 0);
    allow = true;
    await first.backup.runBackup(['server'], { action: 'save-server' });
    assert.equal(confirmationCount, 2);
    assert.equal(first.state.get('backup-config').ownerHandle, 'account-a');
    assert.equal(host.zipWrites().length, 1);
    host.setAccount('account-b');
    first.setCount(4);
    const initialIndexReads = host.calls.filter(call => call.path.endsWith(SERVER_BACKUP_INDEX)).length;
    await first.backup.runBackup(['server']);
    assert.equal(host.zipWrites().length, 1);
    assert.match(first.backup.diagnosticText(), /账号已经变化/);
    assert.equal(host.calls.filter(call => call.path.endsWith(SERVER_BACKUP_INDEX)).length, initialIndexReads);
    host.setAccount('');
    await first.backup.runBackup(['server']);
    assert.equal(host.zipWrites().length, 1);
    assert.match(first.backup.diagnosticText(), /未能核对酒馆当前账号/);
    host.setAccount('account-b');
    const other = fixture(t, host, { state: first.state, account: { handle: 'account-b', name: '乙' }, count: 4 });
    await other.backup.onOpen();
    assert.equal(host.zipWrites().length, 1);
    assert.match(other.backup.diagnosticText(), /自动保存待确认/);
    assert.doesNotMatch(other.backup.diagnosticText(), /最近保存/);
    host.setAccount('account-a');
    await first.backup.runBackup(['server']);
    assert.equal(host.zipWrites().length, 1);
    assert.match(first.backup.diagnosticText(), /自动保存待确认/);
    host.setAccount('account-b');
    other.runtime.archiveClosed = true;
    await other.backup.runRescueBackup('server');
    assert.equal(host.zipWrites().length, 2);
    assert.match(host.zipWrites().at(-1).name, /-rescue-/);
});

test('更新目录期间登录账号变化时，不会把旧账号清单写到另一账号', async () => {
    let current = 'account-a';
    let uploads = 0;
    const client = createServerBackupClient({ request: async (_, options) => {
        if (options.method === 'POST') uploads++;
        current = 'account-b';
        return json({}, 404);
    } });
    await assert.rejects(client.publish([entry], { checkSession() {
        if (current !== 'account-a') throw new Error('fixture session changed');
    } }), /session changed/);
    assert.equal(uploads, 0);
});

test('复制服务器清单时保留同浏览器另一标签页刚保存的关闭选择', async t => {
    const state = new Map([['backup-config', { sourceId: desktop, server: true }]]);
    const host = mockHost({ beforeVerify() {
        state.set('backup-config', { ...state.get('backup-config'), server: false });
    } });
    const { backup, runtime } = fixture(t, host, { state });
    await backup.runBackup(['server']);
    assert.equal(runtime.settings.serverBackupOff[origin], true);
    assert.equal(runtime.settings.serverBackups.length, 1);
});

test('大备份上传和读回按大小放宽等待时间，小请求仍按原来的时限', async () => {
    const timers = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => { timers.push(ms); return realSetTimeout(() => {}, 0); };
    try {
        const bytes = new Uint8Array(6_000_000);
        const stored = new Map();
        const client = createServerBackupClient({
            timeout: 45000,
            getHeaders: () => ({}),
            request: async (path, options) => {
                const body = options.body ? JSON.parse(options.body) : null;
                if (path === '/api/files/upload') { stored.set(body.name, Buffer.from(body.data, 'base64')); return json({ path: 'user/files/' + body.name }); }
                if (path === '/api/files/verify') return json({ [body.urls[0]]: true });
                return new Response(stored.get(path.slice(filesPrefix.length)));
            },
        });
        await client.upload(bytes, backupName);
        const [upload, verify, read] = timers;
        assert.ok(upload >= 160000, `上传 8 MB base64 至少给 160 秒，实际 ${upload}`);
        assert.equal(verify, 45000);
        assert.ok(read >= 120000, `读回 6 MB 至少给 120 秒，实际 ${read}`);
    } finally {
        globalThis.setTimeout = realSetTimeout;
    }
});

test('同样内容上次没校验通过时，重试沿用同一个文件名，不在服务器上越堆越多', async t => {
    const host = mockHost({ fail: 'verify' });
    const { backup, state } = fixture(t, host);
    await backup.runBackup(['server']);
    await backup.runBackup(['server']);
    const names = host.zipWrites().map(call => call.name);
    assert.equal(names.length, 2);
    assert.equal(new Set(names).size, 1);
    assert.equal(state.get('backup-state').server.failedUpload.name, names[0]);
    assert.equal(host.indexWrites().length, 0, '没校验通过的文件不进目录');
});

test('关闭服务器备份的选择在账号暂时核对不了时，下次打开面板补记到酒馆设置', async t => {
    const host = mockHost();
    const { backup, runtime, state } = fixture(t, host, { initialOff: true, account: { handle: 'account-a', name: '甲' } });
    state.get('backup-config').serverOffPending = 'account-a';
    await backup.onOpen();
    assert.equal(runtime.settings.serverBackupOff?.[origin], undefined);
    assert.equal(state.get('backup-config').serverOffPending, 'account-a');
    host.setAccount('account-a');
    await backup.onOpen();
    assert.equal(runtime.settings.serverBackupOff[origin], true);
    assert.equal(state.get('backup-config').serverOffPending, undefined);
    assert.equal(host.zipWrites().length, 0);
});

test('本机关着服务器备份但已同步过时，打开面板不会把别的设备重新打开的开关关回去', async t => {
    const host = mockHost();
    const { backup, runtime } = fixture(t, host, { initialOff: true });
    await backup.onOpen();
    assert.equal(runtime.settings.serverBackupOff?.[origin], undefined);
    assert.equal(host.calls.length, 0);
});

test('有“数量减少、自动备份已暂停”提示时，打开面板照常核对，不走“还没到期”的捷径', async t => {
    const host = mockHost();
    const first = fixture(t, host);
    await first.backup.runBackup(['server']);
    first.state.get('backup-state').protection = '普通历史从 400 变为 3。自动备份已暂停，旧备份保留；请先核对数据。';
    const reopened = fixture(t, host, { state: first.state });
    const before = host.calls.length;
    await reopened.backup.onOpen();
    assert.ok(host.calls.length > before);
    first.state.get('backup-state').protection = '另一窗口正在备份或恢复，请稍后再试';
    const other = fixture(t, host, { state: first.state });
    const again = host.calls.length;
    await other.backup.onOpen();
    assert.equal(host.calls.length, again, '其他提示不触发每次打开都整份核对');
});

test('酒馆设置里的服务器备份清单最多留 100 条，完整清单留在目录文件', async t => {
    const old = Array.from({ length: 150 }, (_, i) => ({ ...entry, path: serverBackupPath(`st-theater-backup-old-${i}.zip`), time: 1000 + i }));
    const host = mockHost({ entries: old });
    const { backup, runtime } = fixture(t, host, { settingsEntries: old });
    await backup.runBackup(['server']);
    assert.equal(runtime.settings.serverBackups.length, 100);
    assert.ok((await host.client().readIndex()).length >= 151);
});
