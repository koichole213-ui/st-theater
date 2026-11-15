// 从 core.test.js 拆出：extension-update
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchInstalledExtensionStatus } from '../version-check.js';
import { extensionFolderFromUrl, extensionScopeFromTypes, extensionScopeAttempts, resolveExtensionScope } from '../extension-location.js';

test('插件按当前安装分支检查更新，并兼容全局安装位置', async () => {
    const calls = [];
    const status = await fetchInstalledExtensionStatus({
        headers: { 'X-Test': 'yes' },
        fetchImpl: async (_url, options) => {
            calls.push(JSON.parse(options.body));
            if (calls.length === 1) return { ok: false, status: 404, text: async () => 'missing' };
            return {
                ok: true,
                status: 200,
                json: async () => ({ currentBranchName: 'codex/long-dream-preview', currentCommitHash: 'abc', isUpToDate: false }),
            };
        },
    });
    assert.deepEqual(calls, [
        { extensionName: 'st-theater', global: false },
        { extensionName: 'st-theater', global: true },
    ]);
    assert.deepEqual(status, { branch: 'codex/long-dream-preview', commit: 'abc', isUpToDate: false });
});

test('先问酒馆插件的安装范围，只发一次对的请求（TT 酒馆不再弹后端错误）', async () => {
    const ok = { ok: true, status: 200, json: async () => ({ currentBranchName: 'main', currentCommitHash: 'abc', isUpToDate: true }) };
    for (const [scope, expected] of [['global', [true]], ['local', [false]]]) {
        const calls = [];
        await fetchInstalledExtensionStatus({
            resolveScope: async () => scope,
            fetchImpl: async (_url, options) => { calls.push(JSON.parse(options.body).global); return ok; },
        });
        assert.deepEqual(calls, expected, scope);
    }
    assert.deepEqual(extensionScopeAttempts(null), [false, true]);
    assert.equal(extensionScopeFromTypes({ 'third-party/st-theater': 'global', 'tts': 'system' }, 'st-theater'), 'global');
    assert.equal(extensionScopeFromTypes({ 'third-party/st-theater-main': 'local' }, 'st-theater-main'), 'local');
    assert.equal(extensionScopeFromTypes({ 'third-party/other': 'global' }, 'st-theater'), null);
    assert.equal(extensionScopeFromTypes(undefined), null);
    assert.equal(await resolveExtensionScope({ folder: 'st-theater', importer: async () => ({ extensionTypes: { 'third-party/st-theater': 'global' } }) }), 'global');
    assert.equal(await resolveExtensionScope({ folder: 'st-theater', importer: async () => { throw new Error('no module'); } }), null);
    assert.equal(extensionFolderFromUrl('http://192.168.1.5:8000/scripts/extensions/third-party/st-theater-main/extension-location.js'), 'st-theater-main');
    assert.equal(extensionFolderFromUrl('http://x/scripts/extensions/third-party/st-theater/index.js?v=1'), 'st-theater');
    assert.equal(extensionFolderFromUrl('file:///home/repo/extension-location.js'), 'st-theater');
    assert.equal(extensionFolderFromUrl('http://x/scripts/extensions/third-party/%3Cbad%3E/a.js'), 'st-theater');
});

test('当前分支检查会拒绝坏响应，并在酒馆接口卡住时及时回退', async () => {
    await assert.rejects(() => fetchInstalledExtensionStatus({
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ currentBranchName: 'preview', currentCommitHash: 'abc' }),
        }),
    }), /invalid data/);
    await assert.rejects(() => fetchInstalledExtensionStatus({
        timeoutMs: 15,
        fetchImpl: async () => await new Promise(() => {}),
    }), /timeout 15ms/);
});
