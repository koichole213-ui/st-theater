import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareSettingsStamps, createSettingsGuard, nextStamp, normalizeStamp, protectedContentHash, sameProtectedContent, stampIncludes, SETTINGS_STAMP_KEY } from '../settings-guard.js';

// ---- 按酒馆真实时序模拟 ----
// 酒馆保存设置：saveSettingsDebounced 等 1 秒（期间再调用会重新计时），到点那一刻把整份设置打包，
// 经过一次网络往返写进服务器（整份覆盖），然后发 SETTINGS_UPDATED。
function createWorld({ rtt = 20 } = {}) {
    let clock = 1_000_000;
    const events = [];
    const world = {
        rtt,
        server: { settings: { instructionTemplates: [{ name: '旧指令' }], renderTemplates: [] } },
        now: () => clock,
        schedule(delay, fn) { const event = { at: clock + delay, fn }; events.push(event); return event; },
        cancel(event) { const index = events.indexOf(event); if (index >= 0) events.splice(index, 1); },
        async advance(ms) {
            const end = clock + ms;
            for (;;) {
                events.sort((a, b) => a.at - b.at);
                const next = events[0];
                if (!next || next.at > end) break;
                events.shift();
                clock = next.at;
                next.fn();
                await Promise.resolve();
            }
            clock = end;
            for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
        },
        // 每台设备（浏览器）有自己的 localStorage。
        storageFor(device) {
            world.devices ??= new Map();
            if (!world.devices.has(device)) {
                const map = new Map();
                world.devices.set(device, { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
            }
            return world.devices.get(device);
        },
    };
    return world;
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

function openPage(world, { handle = 'default', doc = null, device = 'pc', startedAt } = {}) {
    const page = { settings: structuredClone(world.server.settings), toast: createToast(), logs: [], saveFails: false };
    let timer = null;
    // 酒馆的 saveSettingsDebounced
    page.stSave = () => {
        if (timer) world.cancel(timer);
        timer = world.schedule(1_000, () => {
            timer = null;
            const payload = structuredClone(page.settings); // 发起那一刻打包
            world.schedule(world.rtt, () => {
                if (page.saveFails) return;
                world.server.settings = payload;
                page.guard.noteSaved();
            });
        });
    };
    const runtime = {
        get settings() { return page.settings; },
        runtimeLog: (...args) => page.logs.push(args),
        save() { page.guard.noteSave(); page.stSave(); },
    };
    page.fetchFails = false;
    page.guard = createSettingsGuard(runtime, {
        fetchServerSettings: async () => { if (page.fetchFails) throw new Error('Failed to fetch'); return structuredClone(world.server.settings); },
        loadAccountHandle: async () => handle,
        storage: world.storageFor(device),
        toast: page.toast,
        now: world.now,
        wait: ms => world.advance(ms),
        doc,
        pageStartedAt: startedAt ?? world.now(),
    });
    page.addInstruction = name => { page.settings.instructionTemplates.push({ name }); runtime.save(); };
    // 插件里很多日常操作也会保存一次设置，例如切换小剧场的标签页。
    page.switchTab = (i = 0) => { page.settings.lastTheaterTab = `tab${i}`; runtime.save(); };
    // 酒馆自己因为别的事保存一次（例如切了个角色）：把本页内存里的整份设置存回去。
    page.switchCharacter = () => page.stSave();
    page.start = () => page.guard.initialize({ loadedStamp: page.settings[SETTINGS_STAMP_KEY] });
    page.active = () => page.toast.shown.filter(item => item.level === 'warning' && item.element.isConnected);
    page.check = reason => page.guard.check(reason, { force: true });
    return page;
}

async function open(world, options) {
    const page = openPage(world, options);
    await page.start();
    return page;
}

const names = world => world.server.settings.instructionTemplates.map(item => item.name);
const hasRestore = page => page.active().some(item => item.message.includes('用本页补回'));

test('版本号：比的是谁包含谁，不是保存了几次', () => {
    const a1 = nextStamp(null, 'A', 1, 1), a2 = nextStamp(a1, 'A', 2, 2);
    assert.deepEqual(a2.chain, [{ by: 'A', from: 1, to: 2, t: 2 }], '同一页面连续保存合成一段，记最后一次保存的时间');
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
    assert.equal(cmp(a2, a1), 'overwritten', '服务器退回了本页自己更早的一笔');
    assert.equal(cmp(a2, a1, { confirmed: false }), 'unknown', '本页最新一笔还在路上');
    assert.equal(cmp(a2, c1), 'diverged', '两边各从 a1 改了一次');
    const superseding = nextStamp(a2, 'A', 3, 7, c1);
    assert.ok(stampIncludes(superseding, c1) && stampIncludes(superseding, a2), '补回时把被取代的那份并进来历');
    assert.equal(normalizeStamp({ by: 'A', n: 0 }), null);
    assert.equal(normalizeStamp('坏数据'), null);
    assert.deepEqual(normalizeStamp({ by: 'A', n: 3, at: 9 }).chain, [{ by: 'A', from: 3, to: 3, t: 9 }]);
});

test('来历段数超过上限：记下丢掉的段最晚到什么时候；比它还旧的找不到才只叫刷新', () => {
    let stamp = null;
    for (let i = 0; i < 205; i++) stamp = nextStamp(stamp, `page-${i}`, 1, 1_000 + i);
    assert.equal(stamp.chain.length, 200);
    assert.equal(stamp.trimmedUntil, 1_004, '丢掉了 page-0 到 page-4');
    const early = nextStamp(null, 'page-0', 1, 1_000);
    assert.equal(compareSettingsStamps({ local: early, server: stamp, me: 'page-0', confirmed: true }), 'stale');
    const recentSibling = nextStamp(nextStamp(null, 'page-150', 1, 1_150), 'side', 1, 2_000);
    assert.equal(compareSettingsStamps({ local: recentSibling, server: stamp, me: 'side', confirmed: true }), 'diverged', '比丢掉的段新：仍是两边都改过');
    assert.equal(nextStamp(stamp, 'next', 1, 3_000).trimmedUntil, 1_005, '往下传；再多一段就再丢最早的一段（page-5）');
});

for (const rtt of [20, 300]) {
    for (const [phoneSaves, pcSaves] of [[0, 1], [1, 3], [1, 1], [3, 1]]) {
        test(`旧页面盖回（往返 ${rtt}ms）：手机旧页面插件保存 ${phoneSaves} 次、电脑 ${pcSaves} 次 → 电脑收到能补回的提醒；电脑关掉重开也提醒`, async () => {
            const world = createWorld({ rtt });
            const phone = await open(world, { device: 'phone' }), pc = await open(world);
            pc.addInstruction('电脑上新加的指令');
            for (let i = 1; i < pcSaves; i++) { await world.advance(300); pc.switchTab(i); }
            await world.advance(3_000);
            assert.deepEqual(names(world), ['旧指令', '电脑上新加的指令']);
            // 手机那个很早打开的页面没刷新，点了几个标签（或只切了个角色），把设置整份盖回去。
            if (phoneSaves) for (let i = 0; i < phoneSaves; i++) { phone.switchTab(i); await world.advance(300); }
            else phone.switchCharacter();
            await world.advance(3_000);
            assert.deepEqual(names(world), ['旧指令']);

            assert.notEqual(await pc.check('打开小剧场'), 'stale');
            const [warning] = pc.active();
            assert.ok(warning?.message.includes('用本页补回'));
            assert.match(warning.message, /指令 2 条 → 现在 1 条/);
            assert.equal(warning.options.escapeHtml, false, '酒馆默认转义弹窗里的 HTML，按钮要显示出来就得关掉');

            const pcAgain = await open(world);
            assert.equal(pcAgain.active().length, 1, '电脑页面关掉了，下次在这台浏览器打开时提醒');
            assert.match(pcAgain.active()[0].message, /恢复备份/);
        });
    }
}

test('手机在电脑第一次保存之后才打开，电脑又改了一笔，手机切角色盖回：电脑收到提醒', async () => {
    for (const rtt of [20, 300]) {
        const world = createWorld({ rtt });
        const pc = await open(world);
        pc.addInstruction('第一笔');
        await world.advance(3_000);
        const phone = await open(world, { device: 'phone' });
        pc.addInstruction('第二笔');
        await world.advance(3_000);
        phone.switchCharacter();
        await world.advance(3_000);
        assert.deepEqual(names(world), ['旧指令', '第一笔']);
        assert.equal(await pc.check('打开小剧场'), 'overwritten', `往返 ${rtt}ms`);
        assert.ok(hasRestore(pc));
    }
});

test('电脑保存后刷新过的第三个页面再改：电脑收到“本页旧了”，没有补回按钮', async () => {
    const world = createWorld();
    const pc = await open(world);
    pc.addInstruction('电脑新加');
    await world.advance(3_000);
    const third = await open(world, { device: 'laptop' });
    third.addInstruction('第三个页面新加');
    await world.advance(3_000);
    assert.equal(await pc.check('打开小剧场'), 'stale');
    assert.equal(pc.active().length, 1);
    assert.match(pc.active()[0].message, /请先刷新本页/);
    assert.equal(hasRestore(pc), false);
});

test('很多页面之后：没保存过的旧页面只收到“请刷新”，不会拿到能清掉新内容的补回按钮', async () => {
    const world = createWorld();
    const phone = await open(world, { device: 'phone' });
    for (let i = 0; i < 205; i++) {
        const page = openPage(world);
        await page.start();
        page.addInstruction(`第 ${i} 次刷新后新加`);
        await world.advance(2_000);
    }
    assert.equal(await phone.check('打开小剧场'), 'stale');
    assert.equal(hasRestore(phone), false);
    // 手机刷新后，启动也不该说“被盖掉了”
    const phoneAgain = await open(world, { device: 'phone' });
    assert.equal(phoneAgain.active().length, 0);
});

test('两边都改过：说清会盖掉那边、建议先导出；同一时间只挂一条；补回后别的页面看到的是“请刷新”', async () => {
    const world = createWorld();
    const phone = await open(world, { device: 'phone' }), pc = await open(world);
    pc.addInstruction('电脑新加');
    await world.advance(3_000);
    phone.switchCharacter();
    await world.advance(3_000);
    assert.equal(await pc.check('打开小剧场'), 'overwritten');
    const first = pc.active()[0];

    // 用户没马上点。手机刷新后又加了一条。
    const phoneAgain = await open(world, { device: 'phone' });
    phoneAgain.addInstruction('手机刷新后新加');
    await world.advance(3_000);
    assert.equal(await pc.check('再打开一次'), 'diverged');
    assert.equal(pc.active().length, 1, '旧的“被盖回”提醒已收掉');
    assert.equal(first.element.isConnected, false);
    const current = pc.active()[0];
    assert.match(current.message, /那边的改动会被盖掉/);
    assert.match(current.message, /导出/);

    current.click();
    await world.advance(10_000);
    assert.deepEqual(names(world), ['旧指令', '电脑新加'], '用户看过说明后选了以本页为准');
    assert.ok(pc.toast.shown.some(item => item.level === 'success'));

    assert.equal(await phoneAgain.check('打开小剧场'), 'stale', '补回后，手机看到的是请刷新，不会再拿到补回按钮来回互相盖');
    assert.equal(hasRestore(phoneAgain), false);
    assert.equal(await pc.check('再看一次'), 'same');
});

test('补回：等酒馆真正存完才说成功；没存上就说没存上', async () => {
    const world = createWorld();
    const phone = await open(world, { device: 'phone' }), pc = await open(world);
    pc.addInstruction('电脑新加');
    await world.advance(3_000);
    phone.switchCharacter();
    await world.advance(3_000);
    assert.equal(await pc.check('打开小剧场'), 'overwritten');

    pc.saveFails = true;
    pc.active()[0].click();
    await world.advance(500);
    assert.equal(pc.toast.shown.some(item => item.level === 'success'), false, '还没存完不能说已补回');
    await world.advance(10_000);
    assert.equal(pc.toast.shown.some(item => item.level === 'success'), false);
    assert.ok(pc.active().some(item => /补回还没存进酒馆.*下次保存时会一起补上/.test(item.message)));
    assert.deepEqual(names(world), ['旧指令']);
});

test('补回：点之前情况变了（服务器已经在本页这份的基础上改过）就不补，改成提醒刷新', async () => {
    const world = createWorld();
    const phone = await open(world, { device: 'phone' }), pc = await open(world);
    pc.addInstruction('电脑新加');
    await world.advance(3_000);
    phone.switchCharacter();
    await world.advance(3_000);
    assert.equal(await pc.check('打开小剧场'), 'overwritten');
    const restore = pc.active()[0];
    // 用户没马上点。别处用备份把电脑这份恢复回去，又在它的基础上加了一条。
    world.server.settings = structuredClone(pc.settings);
    const later = await open(world, { device: 'laptop' });
    later.addInstruction('在电脑这份基础上新加');
    await world.advance(3_000);
    restore.click();
    await world.advance(10_000);
    assert.deepEqual(names(world), ['旧指令', '电脑新加', '在电脑这份基础上新加'], '没有被补回盖掉');
    assert.equal(restore.element.isConnected, false);
    assert.equal(pc.active().length, 1);
    assert.match(pc.active()[0].message, /请先刷新本页/);
});

test('两个页面同时开着正常用（只切标签、不改内容）：不弹提醒', async () => {
    const world = createWorld();
    const a = await open(world), b = await open(world, { device: 'phone' });
    for (let round = 0; round < 4; round++) {
        a.switchTab(round); await world.advance(2_000);
        await a.check('打开小剧场'); await b.check('打开小剧场');
        b.switchTab(round); await world.advance(2_000);
        await a.check('打开小剧场'); await b.check('打开小剧场');
    }
    assert.equal(a.active().length + b.active().length, 0);
    assert.ok(a.logs.some(([, message]) => /内容一样，不提醒/.test(message)));
});

test('情况恢复一致后收掉旧提醒', async () => {
    const world = createWorld();
    const phone = await open(world, { device: 'phone' }), pc = await open(world);
    pc.addInstruction('电脑新加');
    await world.advance(3_000);
    assert.equal(await phone.check('打开小剧场'), 'stale');
    assert.equal(phone.active().length, 1);
    phone.switchCharacter(); // 旧页面没刷新又保存了：服务器上就是它这份
    await world.advance(3_000);
    assert.equal(await phone.check('再看一次'), 'same');
    assert.equal(phone.active().length, 0);
});

test('本页刚保存、还没存到酒馆时不误报；在那一秒里完成的别的保存不算数；最后一笔没存上就关页也不误报', async () => {
    const world = createWorld();
    const pc = await open(world);
    pc.settings.instructionTemplates.push({ name: '还在路上' });
    pc.guard.noteSave();
    assert.equal(await pc.check('打开小剧场'), 'unknown');
    // 别的原因触发的保存，在打版本号之前就打好了包，刚好这时完成
    await world.advance(200);
    pc.guard.noteSaved();
    assert.equal(await pc.check('打开小剧场'), 'unknown');
    assert.equal(pc.active().length, 0);
    // 页面就这么关了：这一笔没存上，下次启动不该说“被另一个页面盖掉”
    const again = await open(world);
    assert.equal(again.active().length, 0);
});

test('同一浏览器两个标签页：旧标签页保存不会抹掉新标签页的记录，下次打开仍会提醒', async () => {
    const world = createWorld();
    const tabB = await open(world); // 很早打开的旧标签页
    const tabA = await open(world);
    tabA.addInstruction('A 新加');
    await world.advance(3_000);
    // A 关掉了。B 切了个小剧场标签（插件保存），把设置整份盖回去。
    tabB.switchTab(1);
    await world.advance(3_000);
    assert.deepEqual(names(world), ['旧指令']);
    const tabC = await open(world);
    assert.equal(tabC.active().length, 1);
    assert.match(tabC.active()[0].message, /指令 2 条 → 现在 1 条/);
});

test('新标签页加载的那几秒里，另一个标签页刚好存了一次：不误报，也不删记录', async () => {
    for (const gap of [0, 100, 500]) {
        const world = createWorld();
        const tabA = await open(world);
        tabA.addInstruction('A 新加'); // 打了版本号，酒馆 1 秒后才存
        await world.advance(gap);
        const tabC = openPage(world, { startedAt: world.now() }); // 读到的是还没存上的旧设置，插件初始化还没跑
        await world.advance(3_000);
        await tabC.start();
        assert.equal(tabC.active().length, 0, `间隔 ${gap}ms`);
        const tabD = await open(world);
        assert.equal(tabD.active().length, 0, '记录还在，而且服务器上就是它');
    }
});

test('启动时因为“内容一样”不提醒的，同时清掉旧记录，不会卡住造成以后误报或漏报', async () => {
    // 情况甲：之后什么都没被盖，不该提醒
    const world = createWorld();
    const phone = await open(world, { device: 'phone' }), pc = await open(world);
    pc.switchTab(1); await world.advance(3_000);
    phone.switchTab(2); await world.advance(3_000);
    const pc2 = await open(world);
    assert.equal(pc2.active().length, 0);
    pc2.addInstruction('电脑新写'); await world.advance(3_000);
    const pc3 = await open(world);
    assert.equal(pc3.active().length, 0, '没有被盖，不误报');

    // 情况乙：之后真的被旧页面盖掉了，要提醒
    phone.switchCharacter(); await world.advance(3_000);
    assert.deepEqual(names(world), ['旧指令']);
    const pc4 = await open(world);
    assert.equal(pc4.active().length, 1, '真被盖掉了，要提醒');
});

test('很多页面之后，两个页面各改各的：仍给“两边都改过”和补回按钮，电脑刷新后也提醒', async () => {
    const world = createWorld();
    for (let i = 0; i < 205; i++) {
        const page = openPage(world);
        await page.start();
        page.switchTab(i);
        await world.advance(1_500);
    }
    const pc = await open(world), phone = await open(world, { device: 'phone' });
    pc.addInstruction('电脑新加'); await world.advance(3_000);
    phone.addInstruction('手机新加'); await world.advance(3_000);
    assert.equal(await pc.check('打开小剧场'), 'diverged');
    assert.ok(hasRestore(pc));
    const pcAgain = await open(world);
    assert.equal(pcAgain.active().length, 1);
});

test('读不到酒馆设置时安静跳过，只记日志；频率有限制', async () => {
    const world = createWorld();
    const pc = await open(world);
    pc.fetchFails = true;
    assert.equal(await pc.check('打开小剧场'), 'error');
    assert.equal(pc.active().length, 0);
    assert.ok(pc.logs.some(([, message]) => /跳过这次检查/.test(message)));
    pc.fetchFails = false;
    await world.advance(60_000);
    assert.equal(await pc.guard.check('打开小剧场'), 'same');
    assert.equal(await pc.guard.check('马上又打开'), 'skipped');
    await world.advance(21_000);
    assert.equal(await pc.guard.check('过一会儿'), 'same');
});

test('启动提醒：只提醒一次；换个账号不提醒；没被盖掉不提醒；内容其实一样不提醒', async () => {
    const world = createWorld();
    const phone = await open(world, { device: 'phone' }), pc = await open(world);
    pc.addInstruction('新指令一'); await world.advance(300); pc.addInstruction('新指令二');
    await world.advance(3_000);

    const fine = await open(world);
    assert.equal(fine.active().length, 0, '服务器上就是电脑存的那份');

    phone.switchCharacter(); // 电脑页面关掉以后，旧页面把设置盖了回去
    await world.advance(3_000);
    const otherAccount = await open(world, { handle: 'someone-else' });
    assert.equal(otherAccount.active().length, 0);

    const pcAgain = await open(world);
    assert.equal(pcAgain.active().length, 1);
    assert.match(pcAgain.active()[0].message, /指令 3 条 → 现在 1 条/);
    const third = await open(world);
    assert.equal(third.active().length, 0, '只提醒一次');

    // 只差界面状态：不提醒
    const world2 = createWorld();
    const old = await open(world2, { device: 'phone' }), fresh = await open(world2);
    fresh.switchTab(3);
    await world2.advance(3_000);
    old.switchCharacter();
    await world2.advance(3_000);
    const freshAgain = await open(world2);
    assert.equal(freshAgain.active().length, 0);
});

test('启动时插件自己的升级迁移保存，不会掩盖“被盖回”', async () => {
    const world = createWorld();
    const phone = await open(world, { device: 'phone' }), pc = await open(world);
    pc.addInstruction('新指令');
    await world.advance(3_000);
    phone.switchCharacter();
    await world.advance(3_000);
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
    const page = await open(world, { doc });
    const other = await open(world, { device: 'phone' });
    other.addInstruction('别处的新指令');
    await world.advance(60_000);
    doc.visibilityState = 'hidden'; listeners.visibilitychange();
    await world.advance(60_000);
    doc.visibilityState = 'visible'; listeners.visibilitychange();
    await world.advance(10);
    assert.equal(page.active().length, 0, '手机切个 App 回来不去读整份酒馆设置');
    doc.visibilityState = 'hidden'; listeners.visibilitychange();
    await world.advance(5 * 60_000);
    doc.visibilityState = 'visible'; listeners.visibilitychange();
    await world.advance(10);
    assert.equal(page.active().length, 1);
});

test('要保护的内容：指令、模板等；界面状态不算', () => {
    const base = { instructionTemplates: [{ name: 'a' }], renderTemplates: [], lastTheaterTab: 'generate' };
    assert.ok(sameProtectedContent(base, { ...base, lastTheaterTab: 'history', settingsStamp: { by: 'x', n: 1 } }));
    assert.ok(!sameProtectedContent(base, { ...base, instructionTemplates: [] }));
    assert.equal(protectedContentHash(base), protectedContentHash({ ...base, lastTheaterTab: 'x' }));
    assert.notEqual(protectedContentHash(base), protectedContentHash({ ...base, renderTemplates: [{ name: 't' }] }));
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
