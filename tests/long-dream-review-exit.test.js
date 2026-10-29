import test from 'node:test';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { LONG_DREAM_DRAFT_STATUS, LONG_DREAM_WORLD_LINE_RELATION, LONG_DREAM_WORLD_BOOK_POLICY } from '../long-dream.js';
import assert from 'node:assert/strict';
import { createLongDreamRecord, saveLongDreamDraft, pauseLongDreamReview, normalizeLongDreamRecord, updateLongDreamDefinition, discardLongDreamWritingAttempt } from '../long-dream.js';
import { createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';
import { createLongDreamRuntime } from '../long-dream-runtime.js';

function review() {
    const record = createLongDreamRecord({ canon: '旧定梦', source: { text: '已保存第一章', html: '<p>已保存第一章</p>' } });
    return saveLongDreamDraft(record, { status: 'review', instruction: '', title: '第二章', targetChars: 3000,
        candidates: [1, 2].map(n => ({ text: `旧候选${n}`, html: `<p>旧候选${n}</p>`, instruction: '', retained: n === 1 })), selectedCandidateIndex: 1 });
}

test('退出后重载/备份保留空指令全部候选，定梦可改且正式章节不变', () => {
    const before = review(); const snapshot = JSON.stringify(before);
    const paused = pauseLongDreamReview(before);
    assert.equal(JSON.stringify(before), snapshot);
    assert.equal(paused.draft.status, 'writing'); assert.equal(paused.draft.text, ''); assert.equal(paused.draft.html, '');
    assert.deepEqual(paused.chapters, before.chapters);
    assert.deepEqual(paused.draft.candidates.map(c => c.text), ['旧候选1', '旧候选2']);
    assert.ok(paused.draft.candidates.every(c => c.retained));
    const restored = parseLongDreamBackup(JSON.parse(JSON.stringify(createLongDreamBackup([paused]))))[0];
    assert.deepEqual(restored.draft.candidates, paused.draft.candidates);
    assert.equal(normalizeLongDreamRecord(restored).draft.status, 'writing');
    const changed = updateLongDreamDefinition(restored, { canon: '新定梦' });
    assert.equal(changed.canon, '新定梦'); assert.deepEqual(changed.chapters, normalizeLongDreamRecord(restored).chapters); assert.equal(changed.chapters[0].text, before.chapters[0].text); assert.equal(changed.chapters[0].html, before.chapters[0].html);
    const back = discardLongDreamWritingAttempt(changed);
    assert.equal(back.draft.status, 'review'); assert.equal(back.draft.text, '旧候选2'); assert.equal(back.canon, '新定梦');
});

test('改定梦后新生成不把旧候选拼进正文，生成失败仍保留所有候选', async () => {
    const record = updateLongDreamDefinition(pauseLongDreamReview(review()), { canon: '新定梦' });
    const controller = createLongDreamGenerationController({ requestChapter: async request => {
        assert.match(request.userPrompt, /新定梦/); assert.doesNotMatch(request.userPrompt, /旧候选/);
        return { text: '新正文' };
    }, renderChapter: async () => '<p>新正文</p>' });
    const result = await controller.run({ record, targetChars: 3000 });
    assert.equal(result.record.draft.candidates.length, 3);
    assert.deepEqual(result.record.draft.candidates.slice(0,2).map(c => c.text), ['旧候选1','旧候选2']);
    assert.equal(result.record.draft.text, '新正文'); assert.equal(result.record.chapters.length, 1);
    const fail = createLongDreamGenerationController({ requestChapter: async () => { throw new Error('synthetic failure'); }, renderChapter: async () => { throw new Error('must not render'); } });
    await assert.rejects(fail.run({ record }), error => {
        assert.deepEqual(error.longDreamRecord.draft.candidates, record.draft.candidates); return true;
    });
});

for (const mode of ['save', 'cancel', 'fail', 'switch', 'changed', 'busy']) {
    test(`真实退出入口：${mode}，无自动生成或候选丢失`, async () => {
        const record = review(); record.id = 7;
        let writes = 0, renders = 0, requested = 0;
        const runtime = { longDreamCache: [record], activeLongDreamId: 7,
            longDreamWorkspaceSection: 'continue', isPreparingGeneration: false,
            longDreamPut: async value => { writes++; if (mode === 'fail') return false; runtime.longDreamCache = [value]; return value; },
            setLongDreamComposerDraft: () => {}, renderLongDreamPanel: () => { renders++; },
        };
        const priorST = globalThis.SillyTavern, priorToast = globalThis.toastr;
        globalThis.SillyTavern = { getContext: () => ({ Popup: { show: { confirm: async () => {
            requested++;
            if (mode === 'switch') runtime.activeLongDreamId = 8;
            if (mode === 'changed') runtime.longDreamCache = [normalizeLongDreamRecord(record)];
            return mode !== 'cancel';
        } } } }) };
        globalThis.toastr = { info() {}, warning() {} };
        if (mode === 'busy') runtime.isGenerating = true;
        try {
            await createLongDreamRuntime(runtime).regenerateLongDreamDraft({ exitReview: true });
            assert.equal(writes, ['save','fail'].includes(mode) ? 1 : 0);
            assert.equal(renders, mode === 'save' ? 1 : 0);
            assert.equal(requested, mode === 'busy' ? 0 : 1);
            assert.equal(runtime.longDreamWorkspaceSection, mode === 'save' ? 'definition' : 'continue');
            assert.equal(runtime.longDreamCache[0].draft.candidates.length, 2);
            assert.notEqual(runtime.longDreamCandidateSavePending, true);
        } finally { globalThis.SillyTavern = priorST; globalThis.toastr = priorToast; }
    });
}
for (const mode of ['save', 'cancel', 'fail', 'switch', 'changed']) {
    test(`返回候选入口保护刚修改的定梦：${mode}`, async () => {
        const record = updateLongDreamDefinition(pauseLongDreamReview(review()), { canon: '第一次修改' }); record.id = 7;
        let writes = 0;
        const runtime = { longDreamCache: [record], activeLongDreamId: 7, getLongDreamComposerDraft: () => ({}),
            longDreamPut: async value => { writes++; if(mode === 'fail') return false; runtime.longDreamCache = [value]; return value; },
            setLongDreamComposerDraft() {}, renderLongDreamPanel() {},
        };
        const priorST = globalThis.SillyTavern, priorToast = globalThis.toastr, priorDollar = globalThis.$;
        globalThis.$ = () => ({ length: 0 }); globalThis.toastr = {info(){},warning(){}};
        globalThis.SillyTavern = {getContext: () => ({Popup: {show: {confirm: async () => {
            assert.equal(runtime.longDreamCandidateSavePending, true);
            if(mode === 'changed') runtime.longDreamCache = [updateLongDreamDefinition(record, {canon:'刚刚保存的新定梦'})];
            if(mode === 'switch') runtime.activeLongDreamId = 8;
            return mode !== 'cancel';
        }}}})};
        try {
            await createLongDreamRuntime(runtime).discardLongDreamDraft();
            assert.equal(writes, ['save','fail'].includes(mode) ? 1 : 0);
            assert.equal(runtime.longDreamCache[0].canon, mode === 'changed' ? '刚刚保存的新定梦' : '第一次修改');
            assert.equal(runtime.longDreamCache[0].draft.status, mode === 'save' ? 'review' : 'writing');
            assert.notEqual(runtime.longDreamCandidateSavePending, true);
        } finally {globalThis.SillyTavern=priorST;globalThis.toastr=priorToast;globalThis.$=priorDollar;}
    });
}
for (const mode of ['pending', 'save', 'failure']) {
    test(`定梦保存与退出/返回共用保存锁：${mode}`, async () => {
        const source = readTheaterImplementation();
        const start = source.indexOf("$d.off('click.tdsave')");
        const end = source.indexOf("$d.off('click.tddelete')", start);
        let handler, writes = 0, finish;
        const record = pauseLongDreamReview(review()); record.id = 7;
        const scope = { activeLongDreamId: 7, longDreamCache: [record], longDreamCandidateSavePending: mode === 'pending',
            refreshingLongDreamWorldBookId: null, activeLongDreamGenerationId: null,
            LONG_DREAM_DRAFT_STATUS, LONG_DREAM_WORLD_LINE_RELATION, LONG_DREAM_WORLD_BOOK_POLICY, updateLongDreamDefinition,
            settings: {}, renderLongDreamPanel() {},
            longDreamPut: async value => { writes++; await new Promise(resolve => {finish=resolve;}); if(mode === 'failure') return false; scope.longDreamCache=[value]; return value; },
            toastr: {info(){},warning(){},success(){}},
            $: selector => ({val: () => selector.includes('relation') ? LONG_DREAM_WORLD_LINE_RELATION.ISOLATED : '新定梦'}),
            $d: {off(){return this;},on(event,selector,callback){handler=callback;return this;}},
        };
        runInNewContext(source.slice(start,end), scope);
        const saving = handler();
        if (mode === 'pending') { await saving; assert.equal(writes,0); return; }
        assert.equal(writes,1); assert.equal(scope.longDreamCandidateSavePending,true);
        // Both real entry points must return before reading DOM or opening a dialog.
        await createLongDreamRuntime(scope).discardLongDreamDraft();
        await createLongDreamRuntime(scope).regenerateLongDreamDraft({exitReview:true});
        assert.equal(writes,1);
        finish(); await saving;
        assert.equal(scope.longDreamCandidateSavePending,false);
        assert.equal(scope.longDreamCache[0].canon, mode === 'failure' ? '旧定梦' : '新定梦');
    });
}