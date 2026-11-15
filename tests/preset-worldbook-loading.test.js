// 从 core.test.js 拆出：preset-worldbook-loading
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { rememberWorldBookEntryStates, shouldReadWorldBookEntry, worldBookEntryStrategy } from '../world-book-policy.js';
import { migrateLegacyPresetEntryStates, normalizePresetEntryStatesByPreset, presetEntryStateStorageKey, presetEntryStatesForPreset } from '../preset-entry-states.js';

test('预设、世界书缓存只接受当前选择，启动后立即后台检查更新', () => {
    const source = readTheaterImplementation();
    const presetLoader = source.match(/async function (?:runtime\.)?loadPresetEntries[\s\S]*?async function (?:runtime\.)?ensureSelectedPresetLoaded/)?.[0] || '';
    const worldBookLoader = source.match(/function (?:runtime\.)?reloadWorldBooks[\s\S]*?async function (?:runtime\.)?ensureWorldBooksCurrent/)?.[0] || '';
    const foundation = source.match(/async function assembleGenerationPayload[\s\S]*?async function (?:runtime\.)?refreshTokenEstimate/)?.[0] || '';
    const updateCheck = source.match(/async function checkRemoteVersion[\s\S]*?function (?:runtime\.)?hasRemoteUpdate/)?.[0] || '';

    assert.match(presetLoader, /const requestId = \+\+(?:runtime\.)?presetLoadSequence/);
    assert.match(presetLoader, /requestId !== (?:runtime\.)?presetLoadSequence \|\| String\((?:runtime\.)?settings\.selectedPresetName \|\| ''\) !== sel/);
    assert.match(source, /loadPreset \? await (?:runtime\.)?ensureSelectedPresetLoaded\(\) : (?:runtime\.)?currentPresetSnapshot\(\)/);
    assert.match(source, /async function resolveLongDreamRequestFoundation[\s\S]*?const presetSnapshot = await (?:runtime\.)?ensureSelectedPresetLoaded\(\)/);

    assert.match(worldBookLoader, /const books = \[\.\.\.\((?:runtime\.)?settings\.selectedWorldBooks \|\| \[\]\)\]/);
    assert.match(worldBookLoader, /const requestId = \+\+(?:runtime\.)?wbReloadSequence/);
    assert.match(worldBookLoader, /requestId !== (?:runtime\.)?wbReloadSequence \|\| cacheKey !== (?:runtime\.)?worldBookCacheKey\(\)/);
    assert.match(foundation, /await (?:runtime\.)?ensureWorldBooksCurrent\(\{ silent: true \}\)/);
    assert.match(foundation, /entry\.manual \|\| selectedBookNames\.has\(entry\.book\)/);
    assert.match(source, /即使弹窗关闭也刷新缓存[\s\S]*?await (?:runtime\.)?reloadWorldBooks\(\{ silent: true \}\)/);
    assert.doesNotMatch(source, /if \(names\.length < 2\) \{\s*try \{\s*const r = await fetch\('\/api\/worldinfo\/list'/);

    assert.match(source, /void checkRemoteVersion\(\)/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => \{ checkRemoteVersion\(\); \}, 3000\)/);
    assert.match(updateCheck, /if \((?:runtime\.)?updateCheckPromise\) return (?:runtime\.)?updateCheckPromise/);
    assert.match(updateCheck, /fetchInstalledExtensionStatus\(\{ headers \}\)/);
    assert.match(updateCheck, /(?:runtime\.)?installedBranchCheckPending = true/);
    assert.match(source, /if \((?:runtime\.)?installedBranchCheckPending && !(?:runtime\.)?installedBranchStatusKnown\) return false/);
    assert.match(source, /if \((?:runtime\.)?installedBranchStatusKnown\) return (?:runtime\.)?installedBranchHasUpdate/);
    assert.match(source, /\.theater-update-notice[\s\S]*?\.prop\('hidden', !hasUpdate\)/);
    assert.match(source, /let (?:runtime\.)?isPreparingGeneration = false/);
    assert.match(source, /if \(preparationKey !== generationPreparationKey\(\)\)/);
    assert.match(source, /async function (?:runtime\.)?generateNextLongDreamChapter[\s\S]*?(?:runtime\.)?isPreparingGeneration = true;[\s\S]*?Long dream preparation failed:[\s\S]*?finally \{\s*(?:runtime\.)?isPreparingGeneration = false/);
    assert.match(source, /catch \(error\) \{\s*if \((?:runtime\.)?settings\.autoAnchors\[chatId\] === floors\)[\s\S]*?Auto generation preparation failed:/);
});

test('预设读取保留收起或展开状态，旧请求不能覆盖新选择或填回已清空的选择', async () => {
    const source = readTheaterImplementation();
    const start = source.indexOf('function setPresetEntryControlsEnabled');
    const functions = source.slice(start, source.indexOf('function renderPresetEntries', start));
    const settings = { selectedPresetName: 'A', presetEntryStatesByPreset: {} };
    const pending = new Map();
    const elements = new Map();
    const element = selector => {
        if (!elements.has(selector)) elements.set(selector, {
            visible: false, content: '',
            html(value) { this.content = value; return this; },
            hide() { this.visible = false; return this; },
            show() { this.visible = true; return this; },
            toggleClass() { return this; }, attr() { return this; },
        });
        return elements.get(selector);
    };
    const harness = runInNewContext(`
        let cachedPresetEntries = [], cachedPresetPostProcessing = '', cachedPresetSquashSystemMessages = false;
        let cachedPresetName = '', cachedPresetLoadState = 'default', presetLoadSequence = 0, presetLoadInFlight = null;
        ${functions}
        ({ loadPresetEntries, ensureSelectedPresetLoaded, state: () => ({ name: cachedPresetName, entries: cachedPresetEntries, post: cachedPresetPostProcessing, squash: cachedPresetSquashSystemMessages }) });
    `, {
        settings, $: element, toastr: { warning() {}, info() {} }, console: { log() {} },
        fetchPresetByName: name => new Promise(resolve => pending.set(name, resolve)),
        extractPromptsFromData: data => data.entries,
        noToolsPostProcessingMode: value => value,
        presetEntryStatesForPreset, hasOwn: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
        renderPresetEntries: () => '', scheduleTokenEstimate() {}, esc: value => value,
    });
    const loadA = harness.loadPresetEntries('A');
    assert.equal(element('#theater-preset-entries').visible, false, '默认收起的列表在加载中不能自动展开');
    settings.selectedPresetName = 'B';
    const loadB = harness.loadPresetEntries('B');
    pending.get('B')({ entries: [{ id: 'B', content: 'B', enabledInST: true }], custom_prompt_post_processing: 'B-mode', squash_system_messages: true });
    await loadB;
    pending.get('A')({ entries: [{ id: 'A', content: 'A', enabledInST: true }], custom_prompt_post_processing: 'A-mode' });
    await loadA;
    assert.deepEqual(JSON.parse(JSON.stringify(harness.state())), {
        name: 'B', entries: [{ id: 'B', content: 'B', enabledInST: true }], post: 'B-mode', squash: true,
    });
    settings.selectedPresetName = 'A';
    const lateA = harness.loadPresetEntries('A');
    settings.selectedPresetName = '';
    await harness.loadPresetEntries('');
    pending.get('A')({ entries: [{ id: 'A', content: 'A', enabledInST: true }] });
    await lateA;
    assert.equal(harness.state().name, '');
    assert.equal(harness.state().entries.length, 0);
    assert.equal(element('#theater-preset-entries').visible, false);

    settings.selectedPresetName = 'C';
    element('#theater-preset-entries').show(); // 用户主动展开后刷新。
    const ensureC1 = harness.ensureSelectedPresetLoaded();
    assert.equal(element('#theater-preset-entries').visible, true);
    const ensureC2 = harness.ensureSelectedPresetLoaded();
    pending.get('C')({ entries: [{ id: 'C', content: 'C', enabledInST: true }] });
    const [snapshotC1, snapshotC2] = await Promise.all([ensureC1, ensureC2]);
    assert.equal(snapshotC1.status, 'ready');
    assert.equal(snapshotC2.status, 'ready');
    assert.equal(snapshotC1.prompt, 'C');
    assert.equal(element('#theater-preset-entries').visible, true);

    settings.selectedPresetName = 'D';
    const ensureD = harness.ensureSelectedPresetLoaded();
    element('#theater-preset-entries').hide(); // 慢请求期间用户收起，失败也不应抢回展开状态。
    pending.get('D')(null);
    await assert.rejects(ensureD, /预设「D」读取失败/);
    assert.equal(element('#theater-preset-entries').visible, false);
});

test('世界书旧请求不能覆盖新书单，失败回退不会跨读取模式复用缓存', async () => {
    const source = readTheaterImplementation();
    const keyStart = source.indexOf('function worldBookCacheKey');
    const keyFunctions = source.slice(keyStart, source.indexOf('// 每本书一个节点', keyStart));
    const loadStart = source.indexOf('function reloadWorldBooks');
    const loadFunctions = source.slice(loadStart, source.indexOf('// ---- 跟随角色卡 ----', loadStart));
    const settings = { selectedWorldBooks: ['A'], worldBookReadMode: 'all', worldBookStatesByBook: {}, worldBookKnownEntriesByBook: {} };
    const pending = new Map();
    const harness = runInNewContext(`
        let wbEntries = [], wbStates = [], wbLoadedCacheKey = '', wbLoadedReadMode = '', wbReloadSequence = 0, wbReloadInFlight = null;
        ${keyFunctions}
        ${loadFunctions}
        ({ reloadWorldBooks, ensureWorldBooksCurrent, state: () => ({ books: wbEntries.map(entry => entry.book), states: [...wbStates], loadedKey: wbLoadedCacheKey }) });
    `, {
        settings, SillyTavern: { getContext: () => ({}) },
        fetch: (_url, options) => new Promise(resolve => pending.set(JSON.parse(options.body).name, resolve)),
        shouldReadWorldBookEntry, rememberWorldBookEntryStates, worldBookEntryStrategy,
        normalizePromptRole: role => role || 'system', entryKey: entry => String(entry.uid),
        console: { error() {} }, toastr: { error() {}, success() {} },
        syncManualIntoWB() {}, save() {}, refreshWBUI() {}, scheduleTokenEstimate() {},
    });
    const response = book => ({ ok: true, json: async () => ({ entries: { 1: { uid: 1, content: book } } }) });
    const loadA = harness.reloadWorldBooks();
    settings.selectedWorldBooks = ['B'];
    const loadB = harness.reloadWorldBooks();
    pending.get('B')(response('B'));
    await loadB;
    pending.get('A')(response('A'));
    await loadA;
    assert.deepEqual(Array.from(harness.state().books), ['B']);

    settings.selectedWorldBooks = ['C'];
    const ensureC = harness.ensureWorldBooksCurrent();
    settings.selectedWorldBooks = ['D'];
    const loadD = harness.reloadWorldBooks();
    pending.get('D')(response('D'));
    await loadD;
    pending.get('C')(response('C'));
    await ensureC;
    assert.deepEqual(Array.from(harness.state().books), ['D']);

    const failedSameMode = harness.reloadWorldBooks();
    pending.get('D')({ ok: false, status: 500 });
    assert.equal(await failedSameMode, true);
    const strictRefresh = harness.reloadWorldBooks({ force: true, requireFresh: true });
    pending.get('D')({ ok: false, status: 500 });
    assert.equal(await strictRefresh, false);
    assert.deepEqual(Array.from(harness.state().books), ['D']);
    settings.worldBookReadMode = 'lights';
    const failedNewMode = harness.reloadWorldBooks();
    pending.get('D')({ ok: false, status: 500 });
    await failedNewMode;
    assert.equal(harness.state().books.length, 0);
    assert.equal(harness.state().loadedKey, '');

    settings.selectedWorldBooks = ['E'];
    const malformed = harness.reloadWorldBooks();
    pending.get('E')({ ok: true, status: 200, json: async () => ({}) });
    assert.equal(await malformed, false);
    assert.equal(harness.state().loadedKey, '');
});

test('世界书慢读取提交时保留用户刚修改的条目开关', async () => {
    const source = readTheaterImplementation();
    const keyStart = source.indexOf('function worldBookCacheKey');
    const keyFunctions = source.slice(keyStart, source.indexOf('// 每本书一个节点', keyStart));
    const loadStart = source.indexOf('function reloadWorldBooks');
    const loadFunctions = source.slice(loadStart, source.indexOf('// ---- 跟随角色卡 ----', loadStart));
    const settings = { selectedWorldBooks: ['A', 'B'], worldBookReadMode: 'all', worldBookStatesByBook: {}, worldBookKnownEntriesByBook: {} };
    const pending = new Map();
    const harness = runInNewContext(`
        let wbEntries = [], wbStates = [], wbLoadedCacheKey = '', wbLoadedReadMode = '', wbReloadSequence = 0, wbReloadInFlight = null;
        ${keyFunctions}
        ${loadFunctions}
        ({ reloadWorldBooks, state: () => ({ books: wbEntries.map(entry => entry.book), states: [...wbStates] }) });
    `, {
        settings, SillyTavern: { getContext: () => ({}) },
        fetch: (_url, options) => new Promise(resolve => pending.set(JSON.parse(options.body).name, resolve)),
        shouldReadWorldBookEntry, rememberWorldBookEntryStates, worldBookEntryStrategy,
        normalizePromptRole: role => role || 'system', entryKey: entry => String(entry.uid),
        console: { error() {} }, toastr: { error() {}, success() {} },
        syncManualIntoWB() {}, save() {}, refreshWBUI() {}, scheduleTokenEstimate() {},
    });
    const response = book => ({ ok: true, json: async () => ({ entries: { 1: { uid: 1, content: book } } }) });
    const loading = harness.reloadWorldBooks();
    pending.get('A')(response('A'));
    while (!pending.has('B')) await new Promise(resolve => setImmediate(resolve));
    settings.worldBookStatesByBook.A = { 1: false };
    pending.get('B')(response('B'));
    await loading;
    assert.deepEqual(Array.from(harness.state().books), ['A', 'B']);
    assert.deepEqual(Array.from(harness.state().states), [false, true]);
    assert.equal(settings.worldBookStatesByBook.A['1'], false);
});

test('每个酒馆预设会分别记住自己的条目勾选状态', () => {
    const statesByPreset = {};
    const presetA = presetEntryStatesForPreset(statesByPreset, '剧情预设 A', { create: true });
    presetA.main = true;
    presetA.jailbreak = false;
    const presetB = presetEntryStatesForPreset(statesByPreset, '剧情预设 B', { create: true });
    presetB.main = false;
    presetB.jailbreak = true;

    assert.deepEqual(presetEntryStatesForPreset(statesByPreset, '剧情预设 A'), {
        main: true,
        jailbreak: false,
    });
    assert.deepEqual(presetEntryStatesForPreset(statesByPreset, '剧情预设 B'), {
        main: false,
        jailbreak: true,
    });
    assert.notEqual(presetEntryStateStorageKey('剧情预设 A'), presetEntryStateStorageKey('剧情预设 B'));
});

test('旧版公共勾选记录迁移给当前预设，且不会覆盖已有的分预设记录', () => {
    const migrated = migrateLegacyPresetEntryStates({
        selectedPresetName: '当前预设',
        legacyStates: { main: true, jailbreak: false, invalid: 'no' },
        statesByPreset: {},
    });
    assert.deepEqual(presetEntryStatesForPreset(migrated, '当前预设'), {
        main: true,
        jailbreak: false,
    });

    const existing = normalizePresetEntryStatesByPreset({
        [presetEntryStateStorageKey('当前预设')]: { main: false },
    });
    const preserved = migrateLegacyPresetEntryStates({
        selectedPresetName: '当前预设',
        legacyStates: { main: true },
        statesByPreset: existing,
    });
    assert.deepEqual(presetEntryStatesForPreset(preserved, '当前预设'), { main: false });

    const source = readTheaterImplementation();
    assert.doesNotMatch(source, /(?:runtime\.)?settings\.presetEntryStates\s*=\s*\{\}/);
    assert.match(source, /(?:runtime\.)?currentPresetEntryStates\(\{ create: true \}\)/);
});
