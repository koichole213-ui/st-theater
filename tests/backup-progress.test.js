import test from 'node:test';
import assert from 'node:assert/strict';
import { createTheaterBackup } from '../theater-backup.js';

function fixture(t, { fail = '', withLease = operation => operation() } = {}) {
    const config = { enabled: true, local: false, github: true, sourceId: 'fixture', repository: 'fixture/private' };
    const data = new Map([['backup-config', config]]);
    const makeButton = () => {
        const label = {}, icon = {};
        return {
            attributes: new Map(), label, icon,
            querySelector: tag => tag === 'i' ? icon : label,
            toggleAttribute(name, active) { if (!active) this.attributes.delete(name); },
            setAttribute(name, value) { this.attributes.set(name, value); },
        };
    };
    const download = makeButton(), upload = makeButton(), restore = makeButton();
    const github = { dataset: { backupStatus: 'github' } };
    const panel = {
        querySelector(selector) {
            if (selector.includes('"download"')) return download;
            if (selector.includes('"upload"')) return upload;
            return null;
        },
        querySelectorAll(selector) { return selector.includes('data-theater-restore') ? [download, upload, restore] : []; },
    };
    const toasts = [];
    const downloads = [];
    for (const [key, value] of Object.entries({
        document: {
            querySelector: () => panel,
            querySelectorAll: selector => selector.includes('data-backup-status') ? [github] : [],
            body: { append() {} },
            createElement: () => ({ click() { downloads.push(this.download); URL.revokeObjectURL(this.href); }, remove() {} }),
        },
        toastr: { info: text => toasts.push(text) },
    })) {
        const prior = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        t.after(() => {
            if (prior) Object.defineProperty(globalThis, key, prior);
            else delete globalThis[key];
        });
    }
    const storage = {
        get: async key => data.get(key),
        put: async (key, value) => data.set(key, value),
        withLease,
        recoverJournal: async () => {},
        async snapshot() {
            if (fail === 'reading') throw new Error('fixture reading');
            return { data: {} };
        },
    };
    const runtime = {
        idb: {}, runtimeLog() {},
        loadJSZip: async () => class {
            file() {}
            async generateAsync() {
                if (fail === 'packing') throw new Error('fixture packing');
                return new Uint8Array([1,2,3]);
            }
        },
    };
    const backup = createTheaterBackup(runtime, { storage, githubClient: () => ({
        async upload(bytes, { onVerifying }) {
            assert.equal(bytes.length, 3);
            onVerifying();
            if (fail === 'verifying') throw new Error('fixture verification');
        },
    }) });
    return { backup, download, upload, restore, github, toasts, downloads };
}

test('手动上传显示阶段，限制重复点击，结束后恢复原控件', async t => {
    const { backup, download, upload, restore, github } = fixture(t);
    const stages = [];
    await backup.runBackup(['github'], { action:'upload', onStage(name, kind) {
        assert.equal(kind, 'github');
        stages.push(name);
        assert.equal(upload.attributes.get('aria-busy'), 'true');
        assert.equal(upload.icon.className, 'fa-solid fa-spinner fa-spin');
        assert.ok([download, upload, restore].every(button => button.disabled));
        assert.equal(upload.label.textContent, github.textContent);
        assert.ok(backup.diagnosticHTML().includes(github.textContent));
        assert.ok(backup.settingsHTML().includes(github.textContent));
    } });
    assert.deepEqual(stages, ['reading', 'packing', 'uploading', 'verifying']);
    assert.equal(upload.label.textContent, '立即上传');
    assert.equal(upload.icon.className, 'fa-solid fa-cloud-arrow-up');
    assert.equal(upload.attributes.has('aria-busy'), false);
    assert.ok([download, upload, restore].every(button => !button.disabled));
    assert.match(github.textContent, /最近上传成功/);
    assert.doesNotMatch(backup.settingsHTML(), /查找旧存档/);
    assert.match(backup.settingsHTML(), /恢复备份[\s\S]*远端备份/);
});

for (const fail of ['reading', 'packing', 'verifying']) {
    test('备份阶段失败仍恢复按钮 ' + fail, async t => {
        const { backup, download, upload, restore, github } = fixture(t, { fail });
        const task = backup.runBackup(['github'], { action: 'upload' });
        if (fail === 'verifying') {
            await task;
            assert.match(github.textContent, /最近失败/);
        } else await assert.rejects(task, /fixture/);
        assert.ok([download, upload, restore].every(button => !button.disabled));
        assert.equal(upload.attributes.has('aria-busy'), false);
        assert.equal(upload.label.textContent, '立即上传');
    });
}

test('自动备份更新状态且不弹提示', async t => {
    const { backup, toasts, github, upload } = fixture(t);
    const shown = [];
    await backup.runBackup(['github'], { automatic: true, onStage() {
        shown.push(github.textContent);
        assert.equal(upload.label.textContent, '立即上传');
    } });
    assert.deepEqual(shown, ['正在读取存档…','正在打包…','正在上传到 GitHub…','正在校验…']);
    assert.deepEqual(toasts, []);
});

test('取得与释放备份锁期间保持禁用，竞争调用不覆盖进度', async t => {
    const leases = Promise.withResolvers();
    const released = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const finished = Promise.withResolvers();
    const { backup, upload, restore, github } = fixture(t, {
        async withLease(operation) {
            entered.resolve();
            await leases.promise;
            await operation();
            finished.resolve();
            await released.promise;
        },
    });
    const job = backup.runBackup(['github'], { action:'upload' });
    await entered.promise;
    assert.equal(github.textContent, '正在读取存档…');
    assert.ok(upload.disabled && restore.disabled);
    await assert.rejects(backup.runBackup(['local'], { action:'download' }), /备份操作正在进行/);
    await assert.rejects(backup.openRestore(), /备份操作正在进行/);
    assert.equal(github.textContent, '正在读取存档…');
    leases.resolve();
    await finished.promise;
    assert.ok(upload.disabled && restore.disabled);
    released.resolve();
    await job;
    assert.ok(!upload.disabled && !restore.disabled);
});


test('本机备份交给浏览器后只报告已发起下载', async t => {
    const { backup, downloads, toasts } = fixture(t);
    const stages = [];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await backup.runBackup(['local'], { action:'download', onStage: name => stages.push(name) });
    assert.deepEqual(stages, ['reading', 'packing', 'downloading']);
    assert.match(downloads[0], /^theater-backup-.*\.zip$/);
    assert.deepEqual(toasts, ['已发起本机下载，请核对浏览器下载记录']);
});
