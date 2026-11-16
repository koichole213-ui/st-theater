import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareSettingsStamps, createSettingsGuard, nextStamp, normalizeStamp, SETTINGS_STAMP_KEY } from '../settings-guard.js';

// 酒馆保存设置是整份覆盖：哪个页面保存，服务器上就变成哪个页面内存里的那一份。
function createWorld() {
    const server = { settings: { instructionTemplates: [{ name: '旧指令' }], renderTemplates: [] } };
    const storage = new Map();
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
    let clock = 1_000_000;
    return { server, localStorage, now: () => clock, tick: ms => { clock += ms; } };
}

function createToast() {
    const shown = [];
    return {
        shown,
        warning(message, title, options) {
            const handlers = {};
            const button = message.includes('data-settings-guard-restore') ? { addEventListener: (type, fn) => { handlers[type] = fn; } } : null;
            const $toast = [{ querySelector: () => button }];
            shown.push({ level: 'warning', message, title, options, click: () => handlers.click?.() });
            return $toast;
        },
        success(message) { shown.push({ level: 'success', message }); },
        clear() {},
    };
}

function openPage(world, { handle = 'default', doc = null } = {}) {
    const page = { settings: structuredClone(world.server.settings), toast: createToast(), logs: [] };
    const runtime = {
        get settings() { return page.settings; },
        runtimeLog: (...args) => page.logs.push(args),
        save() { page.guard.noteSave(); page.flush(); },
    };
    page.fetchFails = false;
    page.guard = createSettingsGuard(runtime, {
        fetchServerSettings: async () => { if (page.fetchFails) throw new Error('Failed to fetch'); return structuredClone(world.server.settings); },
        loadAccountHandle: async () => handle,
        storage: world.localStorage,
        toast: page.toast,
        now: world.now,
        wait: async () => {},
        doc,
    });
    // 这个页面上的酒馆保存一次设置（插件改了设置，或者只是切了个角色）。
    page.flush = () => { world.server.settings = structuredClone(page.settings); page.guard.noteSaved(); };
    page.addInstruction = name => { page.settings.instructionTemplates.push({ name }); runtime.save(); };
    page.start = () => page.guard.initialize({ loadedStamp: page.settings[SETTINGS_STAMP_KEY] });
    page.warnings = () => page.toast.shown.filter(item => item.level === 'warning');
    return page;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('版本号比对：一样 / 本页旧了 / 被盖回 / 本页刚改还没存上', () => {
    const a = { rev: 3, by: 'A', at: 1 };
    assert.equal(compareSettingsStamps({ local: a, server: a, me: 'A', confirmed: true }), 'same');
    assert.equal(compareSettingsStamps({ local: null, server: null, me: 'A', confirmed: true }), 'same');
    assert.equal(compareSettingsStamps({ local: a, server: { rev: 4, by: 'B' }, me: 'A', confirmed: true }), 'stale');
    assert.equal(compareSettingsStamps({ local: null, server: { rev: 1, by: 'B' }, me: 'A', confirmed: true }), 'stale');
    assert.equal(compareSettingsStamps({ local: a, server: { rev: 3, by: 'B' }, me: 'A', confirmed: true }), 'stale', '两边同时从同一版改过');
    assert.equal(compareSettingsStamps({ local: a, server: { rev: 2, by: 'B' }, me: 'A', confirmed: true }), 'overwritten');
    assert.equal(compareSettingsStamps({ local: a, server: null, me: 'A', confirmed: true }), 'overwritten', '旧版插件或更早的设置盖回来了');
    assert.equal(compareSettingsStamps({ local: { rev: 8, by: 'A' }, server: { rev: 5, by: 'B' }, me: 'C', confirmed: true }), 'overwritten', '本页只是读到了较新的那份，也能补回');
    assert.equal(compareSettingsStamps({ local: a, server: { rev: 2, by: 'B' }, me: 'A', confirmed: false }), 'unknown');
    assert.equal(compareSettingsStamps({ local: a, server: { rev: 2, by: 'A' }, me: 'A', confirmed: true }), 'unknown');
    assert.deepEqual(nextStamp({ rev: 4, by: 'X' }, 'A', 9), { rev: 5, by: 'A', at: 9 });
    assert.deepEqual(nextStamp(undefined, 'A', 9), { rev: 1, by: 'A', at: 9 });
    assert.equal(normalizeStamp({ rev: -1 }), null);
    assert.equal(normalizeStamp('坏数据'), null);
});

test('两个页面：旧页面收到“本页旧了”；它盖回去后，新页面收到提醒并能一键补回', async () => {
    const world = createWorld();
    const phone = openPage(world), pc = openPage(world);
    await phone.start(); await pc.start();

    pc.addInstruction('电脑上新加的指令');
    assert.equal(world.server.settings.instructionTemplates.length, 2);

    assert.equal(await phone.guard.check('回到前台', { force: true }), 'stale');
    assert.equal(phone.warnings().length, 1);
    assert.match(phone.warnings()[0].message, /请先刷新本页/);

    // 手机那个旧页面没刷新，随手切了个角色：酒馆把它内存里的旧设置整份存回去。
    phone.flush();
    assert.equal(world.server.settings.instructionTemplates.length, 1);

    assert.equal(await pc.guard.check('打开小剧场', { force: true }), 'overwritten');
    const warning = pc.warnings().at(-1);
    assert.match(warning.message, /盖回去了（指令 2 条 → 现在 1 条）/);
    assert.equal(warning.options.escapeHtml, false, '酒馆默认转义弹窗里的 HTML，按钮要显示出来就得关掉');
    warning.click();
    assert.equal(world.server.settings.instructionTemplates.length, 2, '用本页补回');
    assert.ok(pc.toast.shown.some(item => item.level === 'success'));

    assert.equal(await pc.guard.check('再看一次', { force: true }), 'same');
    assert.equal(await phone.guard.check('再看一次', { force: true }), 'stale');
});

test('本页刚保存、还没存到酒馆时不误报', async () => {
    const world = createWorld();
    const pc = openPage(world);
    await pc.start();
    pc.settings.instructionTemplates.push({ name: '还在路上' });
    pc.guard.noteSave(); // 酒馆的保存有一秒左右的延迟，这时服务器上还是旧的
    assert.equal(await pc.guard.check('打开小剧场', { force: true }), 'unknown');
    assert.equal(pc.warnings().length, 0);
});

test('读不到酒馆设置时安静跳过，只记日志；频率有限制', async () => {
    const world = createWorld();
    const pc = openPage(world);
    await pc.start();
    pc.fetchFails = true;
    assert.equal(await pc.guard.check('打开小剧场', { force: true }), 'error');
    assert.equal(pc.warnings().length, 0);
    assert.ok(pc.logs.some(([, message]) => /跳过这次检查/.test(message)));
    pc.fetchFails = false;
    world.tick(60_000);
    assert.equal(await pc.guard.check('打开小剧场'), 'same');
    assert.equal(await pc.guard.check('马上又打开'), 'skipped');
    world.tick(21_000);
    assert.equal(await pc.guard.check('过一会儿'), 'same');
});

test('电脑页面已经关掉：下次在这台浏览器打开时提醒一次，指向备份；换个账号不提醒', async () => {
    const world = createWorld();
    const phone = openPage(world), pc = openPage(world);
    await phone.start(); await pc.start();
    pc.addInstruction('新指令一'); pc.addInstruction('新指令二');
    await settle();
    phone.flush(); // 电脑页面关掉以后，旧页面把设置盖了回去

    const otherAccount = openPage(world, { handle: 'someone-else' });
    await otherAccount.start();
    assert.equal(otherAccount.warnings().length, 0);

    const pcAgain = openPage(world);
    await pcAgain.start();
    assert.equal(pcAgain.warnings().length, 1);
    assert.match(pcAgain.warnings()[0].message, /指令 3 条 → 现在 1 条/);
    assert.match(pcAgain.warnings()[0].message, /恢复备份/);

    const third = openPage(world);
    await third.start();
    assert.equal(third.warnings().length, 0, '只提醒一次');
});

test('启动时插件自己的升级迁移保存，不会掩盖“被盖回”', async () => {
    const world = createWorld();
    const phone = openPage(world), pc = openPage(world);
    await phone.start(); await pc.start();
    pc.addInstruction('新指令');
    await settle();
    phone.flush();
    const pcAgain = openPage(world);
    const loaded = pcAgain.settings[SETTINGS_STAMP_KEY];
    pcAgain.guard.noteSave(); // init() 里的迁移会先保存一次
    await pcAgain.guard.initialize({ loadedStamp: loaded });
    assert.equal(pcAgain.warnings().length, 1);
});

test('页面在后台放了一阵再回来才比对', async () => {
    const world = createWorld();
    const listeners = {};
    const doc = { visibilityState: 'visible', addEventListener: (type, fn) => { listeners[type] = fn; } };
    const page = openPage(world, { doc });
    await page.start();
    doc.visibilityState = 'hidden'; listeners.visibilitychange();
    world.tick(5_000);
    doc.visibilityState = 'visible'; listeners.visibilitychange();
    await settle();
    assert.equal(page.logs.filter(([, message]) => /跳过/.test(message)).length, 0);
    // 短暂切走不比对；放了 30 秒以上才比对（这里看有没有去读服务器）
    const other = openPage(world); await other.start(); other.addInstruction('别处的新指令');
    doc.visibilityState = 'hidden'; listeners.visibilitychange();
    world.tick(31_000);
    doc.visibilityState = 'visible'; listeners.visibilitychange();
    await settle(); await settle();
    assert.equal(page.warnings().length, 1);
});

test('接线：插件保存设置都打版本号；酒馆保存成功时确认；打开小剧场时比对', () => {
    const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /function save\(\) \{ runtime\.settingsGuard\?\.noteSave\(\);/);
    assert.match(index, /event_types\.SETTINGS_UPDATED, \(\) => runtime\.settingsGuard\?\.noteSaved\(\)/);
    assert.match(index, /runtime\.settingsGuard\?\.initialize\(\{ loadedStamp: settings\[SETTINGS_STAMP_KEY\] \}\)/);
    const initAt = index.indexOf('async function init()');
    assert.ok(index.indexOf('runtime.settingsGuard?.initialize', initAt) < index.indexOf('save();', initAt), '在迁移保存之前记下启动时的版本号');
    const controller = readFileSync(new URL('../theater-popup-controller.js', import.meta.url), 'utf8');
    assert.match(controller, /runtime\.settingsGuard\?\.check\('打开小剧场'\)/);
    const direct = ['theater-instructions.js', 'theater-materials.js', 'theater-events-settings.js', 'backup-storage.js']
        .filter(file => /saveSettingsDebounced\(/.test(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')));
    assert.deepEqual(direct, [], '设置都要经过 save()，才会打上版本号');
});
