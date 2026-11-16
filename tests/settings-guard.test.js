import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareSettingsStamps, createSettingsGuard, nextStamp, normalizeStamp, stampIncludes, SETTINGS_STAMP_KEY } from '../settings-guard.js';

// 酒馆保存设置是整份覆盖：哪个页面保存，服务器上就变成哪个页面内存里的那一份。
function createWorld() {
    const server = { settings: { instructionTemplates: [{ name: '旧指令' }], renderTemplates: [] } };
    // 每台设备（浏览器）有自己的 localStorage。
    const devices = new Map();
    const storageFor = device => {
        if (!devices.has(device)) {
            const map = new Map();
            devices.set(device, { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
        }
        return devices.get(device);
    };
    let clock = 1_000_000;
    return { server, storageFor, now: () => clock, tick: ms => { clock += ms; } };
}

// 假的 toastr：提醒挂在页面上直到被关掉。
function createToast() {
    const shown = [];
    return {
        shown,
        warning(message, title, options) {
            const handlers = {};
            const button = message.includes('data-settings-guard-restore') ? { disabled: false, addEventListener: (type, fn) => { handlers[type] = fn; } } : null;
            const element = { isConnected: true, querySelector: () => button };
            shown.push({ level: 'warning', message, title, options, element, click: () => handlers.click?.() });
            return [element];
        },
        success(message) { shown.push({ level: 'success', message }); },
        info(message) { shown.push({ level: 'info', message }); },
        clear($toast, options) { assert.equal(options?.force, true, '焦点在按钮上时不加 force 关不掉'); $toast[0].isConnected = false; },
    };
}

function openPage(world, { handle = 'default', doc = null, device = 'pc' } = {}) {
    const page = { settings: structuredClone(world.server.settings), toast: createToast(), logs: [] };
    const runtime = {
        get settings() { return page.settings; },
        runtimeLog: (...args) => page.logs.push(args),
        save() { page.guard.noteSave(); world.tick(1_500); page.flush(); },
    };
    page.fetchFails = false;
    page.guard = createSettingsGuard(runtime, {
        fetchServerSettings: async () => { if (page.fetchFails) throw new Error('Failed to fetch'); return structuredClone(world.server.settings); },
        loadAccountHandle: async () => handle,
        storage: world.storageFor(device),
        toast: page.toast,
        now: world.now,
        wait: async () => {},
        doc,
    });
    // 这个页面上的酒馆保存一次设置（插件改了设置，或者只是切了个角色）。
    page.flush = () => { world.server.settings = structuredClone(page.settings); page.guard.noteSaved(); };
    page.addInstruction = name => { page.settings.instructionTemplates.push({ name }); runtime.save(); };
    // 插件里很多日常操作也会保存一次设置，例如切换小剧场的标签页。
    page.trivialSaves = count => { for (let i = 0; i < count; i++) { page.settings.lastTheaterTab = `tab${i}`; runtime.save(); } };
    page.start = () => page.guard.initialize({ loadedStamp: page.settings[SETTINGS_STAMP_KEY] });
    page.active = () => page.toast.shown.filter(item => item.level === 'warning' && item.element.isConnected);
    page.check = reason => page.guard.check(reason, { force: true });
    return page;
}

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const names = world => world.server.settings.instructionTemplates.map(item => item.name);

test('版本号：比的是谁包含谁，不是保存了几次', () => {
    const a1 = nextStamp(null, 'A', 1, 1), a2 = nextStamp(a1, 'A', 2, 2);
    assert.deepEqual(a2.chain, [{ by: 'A', from: 1, to: 2 }], '同一页面连续保存合成一段');
    const b1 = nextStamp(a2, 'B', 1, 3), b2 = nextStamp(b1, 'B', 2, 4), b3 = nextStamp(b2, 'B', 3, 5);
    assert.ok(stampIncludes(b3, a2) && stampIncludes(b3, a1) && !stampIncludes(a2, b1));
    assert.ok(stampIncludes(null, null) && stampIncludes(a1, null) && !stampIncludes(null, a1));
    const c1 = nextStamp(a1, 'C', 1, 6);
    const cmp = (local, server, extra = {}) => compareSettingsStamps({ local, server, me: 'A', confirmed: true, ...extra });
    assert.equal(cmp(a2, a2), 'same');
    assert.equal(cmp(null, null), 'same');
    assert.equal(cmp(a2, b3), 'stale', '别处在本页的基础上改过');
    assert.equal(cmp(null, a1), 'stale');
    assert.equal(cmp(b3, a2, { me: 'B' }), 'overwritten');
    assert.equal(cmp(a2, null), 'overwritten', '旧版插件或更早的设置盖回来了');
    assert.equal(cmp(a2, c1), 'diverged', '两边各从 a1 改了一次');
    assert.equal(cmp(b3, a2, { confirmed: false }), 'unknown');
    assert.equal(cmp(a2, a1), 'unknown', '服务器上是本页自己更早的一笔：最新那笔还在路上或没存上');
    const superseding = nextStamp(a2, 'A', 3, 7, c1);
    assert.ok(stampIncludes(superseding, c1) && stampIncludes(superseding, a2), '补回时把被取代的那份并进来历');
    assert.equal(normalizeStamp({ by: 'A', n: 0 }), null);
    assert.equal(normalizeStamp('坏数据'), null);
    assert.deepEqual(normalizeStamp({ by: 'A', n: 3 }).chain, [{ by: 'A', from: 3, to: 3 }]);
});

for (const [phoneSaves, pcSaves] of [[0, 1], [1, 3], [1, 1], [3, 1]]) {
    test(`旧页面盖回：手机旧页面插件保存 ${phoneSaves} 次、电脑 ${pcSaves} 次，电脑都收到能补回的提醒，不会叫它刷新`, async () => {
        const world = createWorld();
        const phone = openPage(world, { device: 'phone' }), pc = openPage(world);
        await phone.start(); await pc.start();
        pc.addInstruction('电脑上新加的指令');
        pc.trivialSaves(pcSaves - 1);
        await settle();
        // 手机那个很早打开的页面没刷新，点了几个标签（或只切了个角色），把设置整份盖回去。
        if (phoneSaves) phone.trivialSaves(phoneSaves); else phone.flush();
        assert.deepEqual(names(world), ['旧指令']);

        assert.notEqual(await pc.check('打开小剧场'), 'stale');
        const [warning] = pc.active();
        assert.ok(warning?.message.includes('用本页补回'));
        assert.match(warning.message, /指令 2 条 → 现在 1 条/);
        assert.equal(warning.options.escapeHtml, false, '酒馆默认转义弹窗里的 HTML，按钮要显示出来就得关掉');

        // 电脑页面如果就这么关掉了，下次在这台浏览器打开时也会提醒。
        const pcAgain = openPage(world);
        await pcAgain.start();
        assert.equal(pcAgain.active().length, 1);
        assert.match(pcAgain.active()[0].message, /恢复备份/);
    });
}

test('电脑保存后刷新过的第三个页面再改：电脑收到“本页旧了”，没有补回按钮', async () => {
    const world = createWorld();
    const pc = openPage(world);
    await pc.start();
    pc.addInstruction('电脑新加');
    await settle();
    const third = openPage(world);
    await third.start();
    third.addInstruction('第三个页面新加');
    assert.equal(await pc.check('打开小剧场'), 'stale');
    assert.equal(pc.active().length, 1);
    assert.match(pc.active()[0].message, /请先刷新本页/);
    assert.equal(pc.active()[0].message.includes('用本页补回'), false);
});

test('两边都改过：提醒说清会盖掉那边、建议先导出；同一时间只挂一条；补回后别的页面看到的是“请刷新”', async () => {
    const world = createWorld();
    const phone = openPage(world, { device: 'phone' }), pc = openPage(world);
    await phone.start(); await pc.start();
    pc.addInstruction('电脑新加');
    await settle();
    phone.flush();
    assert.equal(await pc.check('打开小剧场'), 'overwritten');
    const first = pc.active()[0];

    // 用户没马上点。手机刷新后又加了一条。
    const phoneAgain = openPage(world, { device: 'phone' });
    await phoneAgain.start();
    phoneAgain.addInstruction('手机刷新后新加');
    assert.equal(await pc.check('再打开一次'), 'diverged');
    assert.equal(pc.active().length, 1, '旧的“被盖回”提醒已收掉');
    assert.equal(first.element.isConnected, false);
    const current = pc.active()[0];
    assert.match(current.message, /那边的改动会被盖掉/);
    assert.match(current.message, /导出/);

    current.click();
    await settle();
    assert.deepEqual(names(world), ['旧指令', '电脑新加'], '用户看过说明后选了以本页为准');
    assert.ok(pc.toast.shown.some(item => item.level === 'success'));

    // 补回后，手机页面看到的是“本页旧了”，不会再给它补回按钮来回互相盖。
    assert.equal(await phoneAgain.check('打开小剧场'), 'stale');
    assert.equal(phoneAgain.active().some(item => item.message.includes('用本页补回')), false);
    assert.equal(await pc.check('再看一次'), 'same');
});

test('补回：点之前情况变了（服务器已经在本页这份的基础上改过）就不补，改成提醒刷新', async () => {
    const world = createWorld();
    const phone = openPage(world, { device: 'phone' }), pc = openPage(world);
    await phone.start(); await pc.start();
    pc.addInstruction('电脑新加');
    await settle();
    phone.flush();
    assert.equal(await pc.check('打开小剧场'), 'overwritten');
    const restore = pc.active()[0];
    // 用户没马上点。别处用备份把电脑这份恢复回去，又在它的基础上加了一条。
    world.server.settings = structuredClone(pc.settings);
    const later = openPage(world);
    await later.start();
    later.addInstruction('在电脑这份基础上新加');
    restore.click();
    await settle();
    assert.deepEqual(names(world), ['旧指令', '电脑新加', '在电脑这份基础上新加'], '没有被补回盖掉');
    assert.equal(restore.element.isConnected, false);
    assert.equal(pc.active().length, 1);
    assert.match(pc.active()[0].message, /请先刷新本页/);
});

test('情况恢复一致后收掉旧提醒', async () => {
    const world = createWorld();
    const phone = openPage(world, { device: 'phone' }), pc = openPage(world);
    await phone.start(); await pc.start();
    pc.addInstruction('电脑新加');
    await settle();
    assert.equal(await phone.check('打开小剧场'), 'stale');
    assert.equal(phone.active().length, 1);
    phone.flush(); // 旧页面没刷新又保存了：服务器上就是它这份
    assert.equal(await phone.check('再看一次'), 'same');
    assert.equal(phone.active().length, 0);
});

test('本页刚保存、还没存到酒馆时不误报；太早到的“保存成功”不算数', async () => {
    const world = createWorld();
    const pc = openPage(world);
    await pc.start();
    pc.settings.instructionTemplates.push({ name: '还在路上' });
    pc.guard.noteSave(); // 酒馆的保存有一秒的延迟，这时服务器上还是旧的
    assert.equal(await pc.check('打开小剧场'), 'unknown');
    // 别的原因触发的酒馆保存，在打版本号之前就打好了包，刚好这时完成
    world.tick(200);
    pc.guard.noteSaved();
    assert.equal(await pc.check('打开小剧场'), 'unknown');
    assert.equal(pc.active().length, 0);
    await settle();
    // 页面就这么关了：这一笔没存上，下次启动不该说“被另一个页面盖掉”
    const again = openPage(world);
    await again.start();
    assert.equal(again.active().length, 0);
});

test('读不到酒馆设置时安静跳过，只记日志；频率有限制', async () => {
    const world = createWorld();
    const pc = openPage(world);
    await pc.start();
    pc.fetchFails = true;
    assert.equal(await pc.check('打开小剧场'), 'error');
    assert.equal(pc.active().length, 0);
    assert.ok(pc.logs.some(([, message]) => /跳过这次检查/.test(message)));
    pc.fetchFails = false;
    world.tick(60_000);
    assert.equal(await pc.guard.check('打开小剧场'), 'same');
    assert.equal(await pc.guard.check('马上又打开'), 'skipped');
    world.tick(21_000);
    assert.equal(await pc.guard.check('过一会儿'), 'same');
});

test('启动提醒：只提醒一次；换个账号不提醒；没被盖掉不提醒', async () => {
    const world = createWorld();
    const phone = openPage(world, { device: 'phone' }), pc = openPage(world);
    await phone.start(); await pc.start();
    pc.addInstruction('新指令一'); pc.addInstruction('新指令二');
    await settle();

    const fine = openPage(world);
    await fine.start();
    assert.equal(fine.active().length, 0, '服务器上就是电脑存的那份');

    phone.flush(); // 电脑页面关掉以后，旧页面把设置盖了回去
    const otherAccount = openPage(world, { handle: 'someone-else' });
    await otherAccount.start();
    assert.equal(otherAccount.active().length, 0);

    const pcAgain = openPage(world);
    await pcAgain.start();
    assert.equal(pcAgain.active().length, 1);
    assert.match(pcAgain.active()[0].message, /指令 3 条 → 现在 1 条/);

    const third = openPage(world);
    await third.start();
    assert.equal(third.active().length, 0, '只提醒一次');
});

test('启动时插件自己的升级迁移保存，不会掩盖“被盖回”', async () => {
    const world = createWorld();
    const phone = openPage(world, { device: 'phone' }), pc = openPage(world);
    await phone.start(); await pc.start();
    pc.addInstruction('新指令');
    await settle();
    phone.flush();
    const pcAgain = openPage(world);
    const loaded = pcAgain.settings[SETTINGS_STAMP_KEY];
    pcAgain.guard.noteSave(); // init() 里的迁移会先保存一次
    await pcAgain.guard.initialize({ loadedStamp: loaded });
    assert.equal(pcAgain.active().length, 1);
});

test('页面在后台放了很久再回来才比对，短暂切走不比对', async () => {
    const world = createWorld();
    const listeners = {};
    const doc = { visibilityState: 'visible', addEventListener: (type, fn) => { listeners[type] = fn; } };
    const page = openPage(world, { doc });
    await page.start();
    const other = openPage(world); await other.start(); other.addInstruction('别处的新指令');
    world.tick(60_000);
    doc.visibilityState = 'hidden'; listeners.visibilitychange();
    world.tick(60_000);
    doc.visibilityState = 'visible'; listeners.visibilitychange();
    await settle();
    assert.equal(page.active().length, 0, '手机切个 App 回来不去读整份酒馆设置');
    doc.visibilityState = 'hidden'; listeners.visibilitychange();
    world.tick(5 * 60_000);
    doc.visibilityState = 'visible'; listeners.visibilitychange();
    await settle();
    assert.equal(page.active().length, 1);
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
