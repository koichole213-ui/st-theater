// 从 core.test.js 拆出：history-save
import { planHistorySave } from '../history-collections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { previousResults, readingPosition } from '../result-text-edit.js';

test('历史编号兼容缺少 randomUUID 的浏览器，保持 UUID 格式和唯一性', () => {
    const source = readFileSync(new URL('../history-collections.js', import.meta.url), 'utf8').replace(/^import .+;\r?\n/gm, '').replaceAll('export ', '');
    const native = { randomUUID() { assert.equal(this, native); return 'native-id'; } };
    assert.equal(runInNewContext(`${source}\nnewHistoryKey()`, { crypto: native }), 'native-id');
    const keys = runInNewContext(`${source}\nArray.from({length: 1000}, () => newHistoryKey())`, {
        crypto: { getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) },
    });
    assert.equal(new Set(keys).size, 1000);
    keys.forEach(key => assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
});

test('生成完成与中断保留结果在缺少 randomUUID 时仍可保存，存储失败也留在会话', async () => {
    const source = readTheaterImplementation();
    const keys = readFileSync(new URL('../history-collections.js', import.meta.url), 'utf8').replace(/^import .+;\r?\n/gm, '').replaceAll('export ', '');
    const completeStart = source.indexOf('            const item = {', source.indexOf('// The current result is independent'));
    const completeCode = source.slice(source.indexOf('        const resultId = newHistoryKey();'), source.indexOf('        if (popupAlive())', completeStart));
    const partialStart = source.indexOf('            const partialItem = {');
    const partialCode = source.slice(partialStart, source.indexOf('            if (popupAlive())', partialStart));
    assert.ok(completeStart > 0 && partialStart > 0);
    for (const partial of [false, true]) for (const supported of [false, true]) for (const stored of [false, true]) {
        const saved = [];
        const html = '<style>p{color:gold}</style><p>需要保留的正文</p>';
        const context = {
            crypto: supported ? globalThis.crypto : { getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) },
            lastGeneratedHtml: html, currentOutputMode: 'html', continuationRun: null, layoutRetry: null,
            formatRecovered: undefined,
            stagedRenderMode: true, plannedTargetWordCount: 5000, newText: '本次正文', payload: {}, setActiveInstructionTags() {},
            continuationRounds: ['旧前情', '本次正文'], instruction: '本轮方向', generationSourceConfig: { presetName: '合成' },
            ownsGeneration: () => true,
            generationRoles: [], sourceTags: ['标签'], itemTags: ({ tags }) => tags, knownInstructionTags: () => [],
            retainedResultSource: { instruction: '本轮方向', continuationRounds: ['旧前情', '本次正文'] },
            currentGenerationResult: null, storeCurrentResult: async item => { saved.push(item); return stored; },
        };
        const run = runInNewContext(`${keys}\n(async () => {${partial ? partialCode : completeCode}\n})`, context);
        await run();
        assert.equal(saved.length, 1);
        assert.match(saved[0].resultId, /^[0-9a-f-]{36}$/);
        assert.equal(saved[0].html, html);
        assert.equal(saved[0].mode, 'html');
        assert.deepEqual(Array.from(saved[0].continuationRounds), ['旧前情', '本次正文']);
        if (partial) assert.equal(saved[0].complete, false);
        else assert.equal(saved[0].layoutSource.text, '本次正文');
        assert.equal(context.currentGenerationResult, stored ? null : saved[0]);
    }
});

test('文件夹保存兼容编号缺失，失败时提示且不改作品标签', async () => {
    const source = readTheaterImplementation();
    const functions = source.slice(source.indexOf('function queueHistoryWrite('), source.indexOf('function openHistoryReading('));
    const keys = readFileSync(new URL('../history-collections.js', import.meta.url), 'utf8').replace(/^import .+;\r?\n/gm, '').replaceAll('export ', '');
    for (const supported of [true, false]) {
        const items = [{id:'1',title:'甲',tags:['原标签'],html:'<p>原文</p>'}, {id:'2',title:'乙',tags:[]}];
        const before = JSON.stringify(items), errors = [];
        const scope = {
            crypto: supported ? {getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes)} : {},
            historyCache: items, historyCollections: [], historyWriteQueue: Promise.resolve(),
            historyExpanded: new Set(), historyVersionSelection: new Map(), idb: null,
            settings: {historyTagFilter:['原标签']}, save() {}, refreshHistList() {},
            document: {querySelector: () => ({})}, toastr: {error: message => errors.push(message)},
            collectionDialog: async () => ({title:'测试',ids:['1','2']}),
        };
        await runInNewContext(`${keys}\n${functions}\norganizeHistory('new')`, scope);
        assert.equal(JSON.stringify(items), before);
        assert.deepEqual(scope.settings.historyTagFilter, ['原标签']);
        assert.equal(scope.historyCollections.length, supported ? 1 : 0);
        assert.equal(errors.length, supported ? 0 : 1);
        if (supported) {
            assert.equal(scope.historyCollections[0].title, '测试');
            assert.equal(JSON.stringify(scope.historyCollections[0].itemIds), '["1","2"]');
        } else assert.match(errors[0], /收纳保存失败，原作品保留/);
    }
});

test('生成结果独立保存，下一次开始才移入三篇历史，并保留被挤出的阅读对象', async () => {
    const source = readTheaterImplementation();
    const functions = ['queueResultStorage', 'archiveCurrentResult', 'storeCurrentResult', 'updateResultItem']
        .map(name => source.match(new RegExp('function ' + name + '\\([^]*?^}', 'm'))[0]).join('\n');
    const old = [3, 2, 1].map(n => ({ html: `<p>${n}</p>`, resultId: String(n) }));
    const pinned = old[2];
    const disk = [];
    let fail = false;
    const scope = { recentCache: old, currentGenerationResult: null, resultStorageQueue: Promise.resolve(),
        previousResults, resultReader: { refresh() {} }, htmlToPlainText: html => html.replace(/<[^>]*>/g, ''),
        recentPersist: async (recent, current) => { if (fail) return false; disk.push(JSON.parse(JSON.stringify({ recent, current }))); return true; } };
    runInNewContext(functions, scope);
    const four = { html: '<p>4</p>', resultId: '4', mode: 'html' };
    await scope.storeCurrentResult(four);
    assert.deepEqual(scope.recentCache.map(x => x.resultId), ['3', '2', '1']);
    assert.equal(scope.currentGenerationResult, four);
    fail = true;
    assert.equal(await scope.archiveCurrentResult(), false);
    assert.equal(scope.currentGenerationResult, four);
    assert.equal(scope.recentCache, old);
    fail = false;
    await scope.archiveCurrentResult();
    assert.deepEqual(scope.recentCache.map(x => x.resultId), ['4', '3', '2']);
    assert.equal(scope.currentGenerationResult, null);
    assert.equal(readingPosition(pinned, scope.recentCache).retained, true);
    assert.equal(pinned.html, '<p>1</p>');
    const five = { html: '<p>5</p>', resultId: '5', mode: 'html' };
    await scope.storeCurrentResult(five);
    assert.deepEqual(scope.recentCache.map(x => x.resultId), ['4', '3', '2']);
    assert.equal(disk.at(-1).current.resultId, '5');
    // Editing the right page and completing a new generation are serialized.
    await Promise.all([scope.updateResultItem(four, '<p>四</p>', 'html'), scope.storeCurrentResult(five)]);
    assert.equal(four.html, '<p>四</p>');
    assert.equal(scope.currentGenerationResult.html, '<p>5</p>');
    assert.equal(disk.at(-1).recent[0].html, '<p>四</p>');
    fail = true;
    assert.equal(await scope.updateResultItem(four, '<p>不应保存</p>', 'html'), false);
    assert.equal(four.html, '<p>四</p>');
});

test('阅读页保存显式作品，不串入左边的新结果与元数据', async () => {
    const source = readTheaterImplementation();
    const fn = source.match(/async function (?:runtime\.)?saveToHistory\([^]*?^}/m)[0];
    let saved;
    const item = { html: '<p>右页</p>', mode: 'html', instruction: '右页指令', tags: ['右页标签'], continuationRounds: ['右页前情'] };
    const scope = { lastGeneratedHtml: '<p>左页</p>', currentDisplayHtml: '', resultEditSnapshot: null, currentGenerationResult: { html: '<p>左页</p>' },
        historyCache: [], currentOutputMode: 'text', activeInstructionTags: ['左页标签'], settings: { instructionTags: [] },
        knownInstructionTags: () => [], itemTags: entry => entry.tags, mergeTagLists: (_a, b) => b,
        normalizeTagList: x => x, normalizeContinuationRounds: x => x,
        chooseTagsWithNew: async () => ({ name: '右页作品', tags: item.tags, newTags: [] }),
        planHistorySave, commitHistoryCollection: async change => { saved = change([], []).saved; return true; }, save() {}, refreshHistList() {}, toastr: { success() {} } };
    runInNewContext(fn, scope);
    await scope.saveToHistory(item);
    assert.equal(saved.html, item.html);
    assert.equal(saved.mode, 'html');
    assert.equal(saved.instruction, '右页指令');
    assert.deepEqual(saved.continuationRounds, ['右页前情']);
});
