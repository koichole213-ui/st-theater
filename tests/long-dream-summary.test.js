import { condenseSummaryPlan } from '../long-dream-story-summary.js';
// 从 core.test.js 拆出：long-dream-summary
import { summaryUnavailableReason } from '../long-dream-summary-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { classifyRequestFailure, diagnosticSignalInfo } from '../request-diagnostics.js';
import { LONG_DREAM_MEMORY_STATUS, appendLongDreamChapter, applyLongDreamMemoryPatch, createLongDreamBranch, createLongDreamRecord, normalizeLongDreamRecord, resolveLongDreamMemoryV2RecordConflict, setLongDreamMemoryStatus, truncateLongDreamAfter, updateLongDreamChapter, updateLongDreamMemoryV2RecordItem } from '../long-dream.js';
import { createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { buildLongDreamMemoryPayload, parseLongDreamMemoryResponse, shouldWeaveLongDreamMemory } from '../long-dream-memory.js';

function synopsisFixture(count = 5) {
    let record = createLongDreamRecord({ source: { text: '初遇：两人在旧港相识。', html: '<p>初遇</p>' } });
    for (let n = 2; n <= count; n++) record = appendLongDreamChapter(record, { text: `经历${n}：本章关键转折。`, html: `<p>经历${n}</p>` });
    return applyLongDreamMemoryPatch(record, { operations: [] }, count);
}

test('独立剧情概要使用正文和确认事实，保存快照且不执行模型返回的操作', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    const { buildLongDreamSummaryPayload } = await import('../long-dream-memory.js');
    let record = createLongDreamRecord({ source: { text: '两人在雨夜进入车站，等候末班车。', html: '<p>正文</p>' } });
    record = applyLongDreamMemoryPatch(record, { currentState: '原先连贯概要', operations: [] }, 1);
    const payload = buildLongDreamSummaryPayload(record);
    assert.match(payload.userPrompt, /两人在雨夜进入车站/);
    assert.doesNotMatch(payload.userPrompt, /原先连贯概要/);
    const result = await refreshLongDreamSummary({ record,
        request: async () => JSON.stringify({ storyEntries: [{chapterNumber: 1, text: '雨夜里，两人抵达车站，正在等候末班车。'}], operations: [{ op: 'set_state', subjects: ['甲'], attribute: 'location', value: '恶意地点', chapterNumber: 1 }] }),
        readLatest: () => record, save: value => value,
    });
    assert.equal(result.memory.currentState, '第 1 章：雨夜里，两人抵达车站，正在等候末班车。');
    assert.deepEqual(result.memory.states, record.memory.states);
    assert.equal(result.memory.summaryNeedsRefresh, false);
    assert.equal(normalizeLongDreamRecord(JSON.parse(JSON.stringify(result))).memory.summaryVersions.at(-1).text, result.memory.currentState);
});

test('概要失败、空返回、期间修改或删除作品都不覆盖原概要', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    let record = createLongDreamRecord({ source: { text: '正文', html: '<p>正文</p>' } });
    record = applyLongDreamMemoryPatch(record, { currentState: '原概要', operations: [] }, 1);
    let saves = 0;
    const options = { record, readLatest: () => record, save: () => { saves++; } };
    await assert.rejects(refreshLongDreamSummary({ ...options, request: async () => { throw new Error('断网'); } }));
    await assert.rejects(refreshLongDreamSummary({ ...options, request: async () => '{}' }), { code: 'LONG_DREAM_SUMMARY_MISSING_ENTRIES' });
    await assert.rejects(refreshLongDreamSummary({ ...options, request: async () => '{"storyEntries":[{"chapterNumber":1,"text":"新概要"}]}', save: async () => false }), { code: 'LONG_DREAM_SUMMARY_SAVE_FAILED' });
    for (const latest of [null, { ...record, memory: { ...record.memory, currentState: '用户已修改' } }]) {
        assert.equal(await refreshLongDreamSummary({ ...options, request: async () => '{"storyEntries":[{"chapterNumber":1,"text":"过时结果"}]}', readLatest: () => latest }), null);
    }
    assert.equal(saves, 0);
    assert.equal(record.memory.currentState, '原概要');
});

test('概要超时中止请求，迟到响应不能保存，并可再次更新', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    let record = createLongDreamRecord({ source: { text: '合成正文', html: '<p>合成正文</p>' } });
    record = applyLongDreamMemoryPatch(record, { currentState: '原概要', operations: [] }, 1);
    let resolveLate, signal, saves = 0;
    const options = { record, readLatest: () => record, save: value => { saves++; return value; } };
    await assert.rejects(refreshLongDreamSummary({ ...options, timeoutMs: 10,
        request: (_, context) => { signal = context.signal; return new Promise(resolve => { resolveLate = resolve; }); },
    }), { code: 'LONG_DREAM_SUMMARY_TIMEOUT' });
    assert.equal(signal.aborted, true);
    resolveLate('{"storyEntries":[{"chapterNumber":1,"text":"迟到概要"}]}');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saves, 0);
    assert.equal(record.memory.currentState, '原概要');
    const saved = await refreshLongDreamSummary({ ...options, request: async () => '{"storyEntries":[{"chapterNumber":1,"text":"重试概要"}]}' });
    assert.equal(saved.memory.currentState, '第 1 章：重试概要');
    assert.equal(saves, 1);
});

test('概要点击立即反馈、去重、超时解锁和配置异常提示', async () => {
    const source = readTheaterImplementation();
    const functions = source.match(/function syncLongDreamSummaryButton\(key\) \{[^]*?(?=\nasync function weaveLongDreamMemory)/)[0];
    const binding = source.split('\n').find(line => line.includes("$d.off('click.tdsummary')"));
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    let record = createLongDreamRecord({ source: { text: '合成正文', html: '<p>合成正文</p>' } });
    record = applyLongDreamMemoryPatch(record, { currentState: '原概要', operations: [] }, 1);
    const button = { each() { return this; }, prop(k,v) { this[k]=v; return this; }, attr(k,v) { this[k]=v; return this; }, text(v) { this.label=v; return this; } };
    const condenseButton = { prop(k,v) { this[k]=v; return this; }, attr(k,v) { this[k]=v; return this; } };
    const notices = [];
    let handler, calls = 0, saves = 0;
    const scope = { settings: {}, activeLongDreamId: record.id, longDreamCache: [record], refreshingLongDreamSummaries: new Set(),
        LONG_DREAM_MEMORY_STATUS, summaryUnavailableReason, condenseSummaryPlan, $: selector => selector === '[data-dream-summary-condense]' ? condenseButton : button, normalizeMaxTokens: v => v, runtimeLog() {},
        selectedLongDreamMemoryApiPreset: () => ({ maxOutputTokens: 4096 }),
        refreshLongDreamSummary: options => refreshLongDreamSummary({ ...options, timeoutMs: 10 }),
        requestCustomApi: ({ signal }) => { calls++; assert.equal(signal instanceof AbortSignal, true); return new Promise(() => {}); },
        longDreamPut: r => { saves++; return r; }, rememberLongDreamComposerDraft() {}, renderLongDreamPanel() {},
        toastr: Object.fromEntries(['info','warning','success'].map(type => [type, text => notices.push([type,text])])),
        classifyRequestFailure,
        diagnosticSignalInfo: () => ({ title: '网络连接没有完成' }),
        $d: { off() { return this; }, on(type, selector, callback) { assert.equal(selector, '[data-dream-summary-refresh]'); handler=callback; return this; } },
    };
    scope.theaterError = text => notices.push(['warning', text]);
    scope.confirmLongDreamSummaryAction = id => scope.refreshLongDreamSummaryNow(id);
    runInNewContext(functions + '\n' + binding, scope);
    const pending = handler();
    assert.equal(button.label, '正在更新…');
    assert.equal(button.disabled, true);
    await handler();
    assert.equal(calls, 1);
    await pending;
    assert.equal(button.label, '更新概要');
    assert.equal(button.disabled, false);
    assert.equal(condenseButton['aria-disabled'], 'true', '只有 1 章时精简按钮保持灰色');
    assert.equal(condenseButton.disabled, false, '灰色的精简按钮仍能点，点了弹出原因（手机上看不到悬停提示）');
    assert.match(condenseButton.title, /满 5 章/);
    assert.equal(scope.refreshingLongDreamSummaries.size, 0);
    assert.equal(saves, 0);
    assert.match(notices.at(-1)[1], /等待超过 3 分钟/);
    scope.selectedLongDreamMemoryApiPreset = () => { throw new Error('DO_NOT_DISPLAY'); };
    await handler();
    assert.match(notices.at(-1)[1], /配置读取失败/);
    assert.doesNotMatch(JSON.stringify(notices), /DO_NOT_DISPLAY/);
    scope.selectedLongDreamMemoryApiPreset = () => ({ maxOutputTokens: 4096 });
    scope.requestCustomApi = async () => '{"currentState":"PRIVATE_RESPONSE"}';
    await handler();
    assert.match(notices.at(-1)[1], /没有返回分章概要/);
    assert.equal(saves, 0);
    assert.equal(button.disabled, false);
    assert.doesNotMatch(JSON.stringify(notices), /PRIVATE_RESPONSE/);
    scope.requestCustomApi = async () => '{"storyEntries":[{"chapterNumber":1,"text":"成功概要"}]}';
    await handler();
    assert.equal(saves, 1);
    assert.equal(notices.at(-1)[0], 'success');
    assert.equal(button.disabled, false);
});

test('缺失事项冲突可安排补织，不清空有效梦脉或保存伪造事项', () => {
    let record = createLongDreamRecord({ source: { text: '正文', html: '<p>正文</p>' } });
    record = applyLongDreamMemoryPatch(record, { currentState: '原剧情概要', operations: [
        { op: 'set_state', subjects: ['甲'], attribute: 'location', value: '车站', chapterNumber: 1 },
    ] }, 1);
    record = applyLongDreamMemoryPatch(record, { operations: [
        { op: 'resolve_thread', targetId: 'missing', resolution: '结束', chapterNumber: 1 },
    ] }, 1);
    assert.equal(record.memory.pendingConflicts.length, 1);
    const result = resolveLongDreamMemoryV2RecordConflict(record, record.memory.pendingConflicts[0].id, 'reweave');
    assert.equal(result.memory.pendingConflicts.length, 0);
    assert.equal(result.memory.states[0].value, '车站');
    assert.equal(result.memory.threads.length, 0);
    assert.equal(result.memory.currentState, '原剧情概要');
    assert.deepEqual(result.memory.pendingChapterNumbers, [1]);
    assert.equal(result.memory.processedThroughChapter, 0);
});

test('重写回退取对应阶段的独立剧情概要，不拼条目或携带未来摘要', () => {
    let record = createLongDreamRecord({ source: { text: '初遇', html: '<p>初遇</p>' } });
    record = applyLongDreamMemoryPatch(record, { currentState: '两人初遇，正在寻找住处。', operations: [] }, 1);
    record = appendLongDreamChapter(record, { text: '后来', html: '<p>后来</p>' });
    record = applyLongDreamMemoryPatch(record, { currentState: '未来两人已结婚。', operations: [] }, 2);
    const branch = createLongDreamBranch(record, 'chapter-2', { includeChapter: false });
    assert.equal(branch.memory.currentState, '两人初遇，正在寻找住处。');
    assert.doesNotMatch(JSON.stringify(branch.memory), /未来两人/);
});

test('全篇概要增量保存开端，关系现状仍能替换，遗漏章节不覆盖旧版', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    let record = synopsisFixture(3);
    const entries = [1,2,3].map(chapterNumber => ({chapterNumber, text:`历史经历${chapterNumber}`}));
    record = await refreshLongDreamSummary({record, request: async()=>JSON.stringify({storyEntries:entries}), readLatest:()=>record, save:value=>value});
    record = appendLongDreamChapter(record, {text:'第四章关系和解',html:'<p>和解</p>'});
    record = appendLongDreamChapter(record, {text:'第五章共同出发',html:'<p>出发</p>'});
    const payload = buildLongDreamMemoryPayload({record});
    assert.match(payload.userPrompt, /只为以下编号逐章返回 storyEntries：4、5/);
    let patch = parseLongDreamMemoryResponse(JSON.stringify({storyEntries:[{chapterNumber:4,text:'两人和解'},{chapterNumber:5,text:'共同出发'}],operations:[{op:'set_state',subjects:['甲','乙'],attribute:'relationship',value:'已和解',chapterNumber:4}]}),{pendingChapterNumbers:[4,5]});
    record = applyLongDreamMemoryPatch(record,patch,5);
    assert.match(record.memory.currentState,/历史经历1[\s\S]*历史经历3[\s\S]*两人和解[\s\S]*共同出发/);
    assert.equal(record.memory.states[0].value,'已和解');
    const old = JSON.stringify(record.memory);
    await assert.rejects(refreshLongDreamSummary({record, request:async()=>JSON.stringify({storyEntries:[{chapterNumber:3,text:'仅最近三章'},{chapterNumber:4,text:'近况'},{chapterNumber:5,text:'近况'}]}),readLatest:()=>record,save:()=>assert.fail('must not save')}),{code:'LONG_DREAM_SUMMARY_COVERAGE'});
    assert.equal(JSON.stringify(record.memory),old);
});

test('概要兼容数字字符串，后批提示使用真实章号且全篇一次保存', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    const record = synopsisFixture(7);
    let calls = 0, saves = 0;
    const saved = await refreshLongDreamSummary({ record, readLatest: () => record,
        save: value => { saves++; return value; }, request: async payload => {
            calls++;
            const numbers = calls === 1 ? [1,2,3,4,5] : [6,7];
            assert.ok(payload.userPrompt.includes(`只整理章号：${numbers.join('、')}`));
            for (const number of numbers) assert.ok(payload.userPrompt.includes(`"chapterNumber":${number},`));
            if (calls === 2) assert.doesNotMatch(payload.systemPrompt + payload.userPrompt, /"chapterNumber":1,/);
            return JSON.stringify({ storyEntries: numbers.map(n => ({ chapterNumber: ` ${n} `, text: `经历${n}` })) });
        } });
    assert.equal(calls, 2); assert.equal(saves, 1);
    assert.deepEqual(saved.memory.storyEntries.map(entry => entry.chapterNumber), [1,2,3,4,5,6,7]);
    assert.match(saved.memory.currentState, /经历1/); assert.match(saved.memory.currentState, /经历7/);
});

test('概要错误分阶段且失败不保存、不泄露响应或异常原文', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    const record = synopsisFixture(1), before = JSON.stringify(record);
    const cases = [
        ['PRIVATE_RESPONSE', 'PARSE_FAILED', 'parse'],
        [JSON.stringify({ currentState: 'PRIVATE_RESPONSE' }), 'MISSING_ENTRIES', 'coverage'],
        [JSON.stringify({ storyEntries: [{ chapterNumber: '第1章', text: '叙事' }] }), 'COVERAGE', 'coverage'],
        [JSON.stringify({ storyEntries: [{ chapterNumber: true, text: '叙事' }] }), 'COVERAGE', 'coverage'],
        [JSON.stringify({ storyEntries: [{ chapterNumber: 1, text: '叙事' }, { chapterNumber: '1', text: '重复' }] }), 'COVERAGE', 'coverage'],
        [JSON.stringify({ storyEntries: [{ chapterNumber: 1, text: ' ' }] }), 'EMPTY_ENTRY', 'coverage'],
        [JSON.stringify({ storyEntries: [{ chapterNumber: 1, text: '叙'.repeat(1201) }] }), 'ENTRY_TOO_LONG', 'coverage'],
    ];
    for (const [response, code, stage] of cases) {
        await assert.rejects(refreshLongDreamSummary({ record, readLatest: () => record,
            request: async () => response, save: () => assert.fail('invalid response saved') }), error => {
            assert.equal(error.code, `LONG_DREAM_SUMMARY_${code}`);
            assert.equal(error.summaryDiagnostic.stage, stage);
            assert.equal(error.summaryDiagnostic.batch, 1);
            assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_RESPONSE/);
            return true;
        });
        assert.equal(JSON.stringify(record), before);
    }
    for (const save of [() => null, () => { throw new Error('PRIVATE_SAVE_ERROR'); }]) {
        await assert.rejects(refreshLongDreamSummary({ record, readLatest: () => record, save,
            request: async () => '{"storyEntries":[{"chapterNumber":1,"text":"合成概要"}]}' }), error => {
            assert.equal(error.code, 'LONG_DREAM_SUMMARY_SAVE_FAILED');
            assert.equal(error.summaryDiagnostic.stage, 'save');
            assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_SAVE_ERROR/);
            return true;
        });
    }
    await assert.rejects(refreshLongDreamSummary({ record, readLatest: () => record,
        save: () => assert.fail('network failure saved'), request: async () => {
            throw Object.assign(new Error('PRIVATE_NETWORK_ERROR'), { diagnosticSignal: 'network_error' });
        } }), error => {
        assert.equal(error.code, 'LONG_DREAM_SUMMARY_REQUEST_FAILED');
        assert.equal(error.summaryDiagnostic.stage, 'request');
        assert.equal(error.diagnosticSignal, 'network_error');
        assert.doesNotMatch(error.message + JSON.stringify(error), /PRIVATE_NETWORK_ERROR/);
        return true;
    });
    const longRecord = synopsisFixture(7), original = JSON.stringify(longRecord);
    let batch = 0;
    await assert.rejects(refreshLongDreamSummary({ record: longRecord, readLatest: () => longRecord,
        save: () => assert.fail('partial batch saved'), request: async () => {
            batch++;
            return JSON.stringify({ storyEntries: (batch === 1 ? [1,2,3,4,5] : [1,2]).map(chapterNumber => ({ chapterNumber, text: '概要' })) });
        } }), error => {
        assert.equal(error.code, 'LONG_DREAM_SUMMARY_COVERAGE');
        assert.deepEqual(error.summaryDiagnostic, { stage: 'coverage', batch: 2, expectedCount: 2, receivedCount: 2 });
        return true;
    });
    assert.equal(JSON.stringify(longRecord), original);
});

test('概要版本列表转义内容、缺失日期不伪造时间、受限版本不可恢复', () => {
    const source = readTheaterImplementation();
    const render = source.match(/function longDreamSummaryHistoryHTML\([^]*?(?=\nfunction (?:runtime\.)?toggleLongDreamSummaryPreview)/)[0];
    const date = source.match(/function longDreamDate\([^]*?(?=\nfunction longDreamExcerpt)/)[0];
    const scope = { esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') };
    runInNewContext(date + '\n' + render, scope);
    assert.equal(scope.longDreamSummaryHistoryHTML({}), '');
    const memory = { summaryVersions: [
        { id: 'old"bad', text: '<script>bad()</script>', chapterNumber: 1, createdAt: '', canRestore: false },
        { id: 'new', text: '第二版', chapterNumber: 2, createdAt: '2026-09-19T12:26:00Z' },
    ] };
    const html = scope.longDreamSummaryHistoryHTML(memory);
    assert.ok(html.indexOf('第二版') < html.indexOf('&lt;script>'));
    assert.doesNotMatch(html, /<script>|Invalid Date/);
    assert.match(html, /data-dream-summary-restore="old&quot;bad" disabled/);
    assert.match(html, /data-dream-summary-restore="new" >/);
    assert.equal((html.match(/aria-expanded="false"/g) || []).length, 2);
    assert.equal((scope.longDreamSummaryHistoryHTML(memory, true).match(/data-dream-summary-restore="[^"]*" disabled/g) || []).length, 2);
});

test('概要最近五版包含同章重试，恢复不改变正文梦脉，备份完整保留', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    const { restoreStorySummary } = await import('../long-dream-story-summary.js');
    const { createLongDreamBackup, parseLongDreamBackup } = await import('../long-dream-backup.js');
    let record = synopsisFixture(2);
    for (let i=0;i<7;i++) {
        record = await refreshLongDreamSummary({record,request:async()=>JSON.stringify({storyEntries:[1,2].map(chapterNumber=>({chapterNumber,text:`版本${i}经历${chapterNumber}`}))}),readLatest:()=>record,save:value=>value});
    }
    assert.equal(record.memory.summaryVersions.length,5);
    assert.match(record.memory.summaryVersions[0].text,/版本2/);
    const before = JSON.stringify([record.chapters,record.memory.states,record.memory.transitions]);
    const restored = restoreStorySummary(record,record.memory.summaryVersions[0].id);
    assert.match(restored.memory.currentState,/版本2/);
    assert.equal(JSON.stringify([restored.chapters,restored.memory.states,restored.memory.transitions]),before);
    assert.equal(restored.memory.summaryVersions.length,5);
    const imported = parseLongDreamBackup(createLongDreamBackup([restored]))[0];
    assert.deepEqual(imported.memory.storyEntries,restored.memory.storyEntries);
    assert.deepEqual(imported.memory.summaryVersions,restored.memory.summaryVersions);
    assert.equal(imported.memory.currentState,restored.memory.currentState);
});

test('概要章节回退、改写与分支不携带未来经历，恢复早期版注明进度', async () => {
    const { mergeStoryResponse, saveStorySummary, restoreStorySummary } = await import('../long-dream-story-summary.js');
    const { updateLongDreamChapter, truncateLongDreamAfter } = await import('../long-dream.js');
    let record = synopsisFixture(3);
    record = saveStorySummary(record,mergeStoryResponse(record,[1,2,3].map(chapterNumber=>({chapterNumber,text:`原经历${chapterNumber}`}))));
    const earlyId = record.memory.summaryVersions[0].id;
    record = appendLongDreamChapter(record,{text:'未来四章',html:'<p>未来</p>'});
    record = applyLongDreamMemoryPatch(record,{operations:[]},4);
    record = saveStorySummary(record,mergeStoryResponse(record,[{chapterNumber:4,text:'未来结婚'}]));
    const restored = restoreStorySummary(record,earlyId);
    assert.equal(restored.memory.summaryThroughChapter,3);
    assert.equal(restored.memory.summaryNeedsRefresh,true);
    assert.equal(restored.chapters.length,4);
    const branch = createLongDreamBranch(record,'chapter-3');
    assert.doesNotMatch(JSON.stringify(branch.memory),/未来结婚/);
    assert.match(branch.memory.currentState,/原经历1/);
    const edited = updateLongDreamChapter(record,'chapter-2',{text:'第二章已改',html:'<p>已改</p>'});
    assert.doesNotMatch(JSON.stringify(edited.memory.summaryVersions),/未来结婚/);
    assert.equal(edited.memory.storyEntries.length,1);
    assert.throws(()=>restoreStorySummary(edited,earlyId));
    assert.equal(truncateLongDreamAfter(record,'chapter-2').memory.storyEntries.length,2);
});

test('长篇概要分批完整成功才保存，超过5000字不被截断，后批失败保留旧版', async () => {
    const { refreshLongDreamSummary } = await import('../long-dream-summary.js');
    const { sanitizeLongDreamBackupRecord } = await import('../long-dream-backup.js');
    let record = synopsisFixture(7), calls=0, saves=0;
    const request = async payload => {
        calls++;
        const numbers = [...payload.userPrompt.matchAll(/第(\d+)章：/g)].map(match=>Number(match[1]));
        return JSON.stringify({storyEntries:numbers.map(chapterNumber=>({chapterNumber,text:`经历${chapterNumber}`+'叙'.repeat(800)}))});
    };
    record=await refreshLongDreamSummary({record,request,readLatest:()=>record,save:value=>{saves++;return value;}});
    assert.equal(calls,2);assert.equal(saves,1);
    assert.ok(record.memory.currentState.length>5000);
    assert.match(normalizeLongDreamRecord(record).memory.currentState,/经历7/);
    assert.equal(sanitizeLongDreamBackupRecord(record).memory.currentState,record.memory.currentState);
    const before=JSON.stringify(record.memory);calls=0;
    await assert.rejects(refreshLongDreamSummary({record,request:payload=>{if(calls===1)throw Error('later failure');return request(payload);},readLatest:()=>record,save:()=>assert.fail('partial save')}));
    assert.equal(JSON.stringify(record.memory),before);
});

test('用户纠正事实后旧版仅供查看，补织重新取章节概要，空回复不替换历史', async () => {
    const { mergeStoryResponse, saveStorySummary, restoreStorySummary } = await import('../long-dream-story-summary.js');
    let record=synopsisFixture(1);
    record=applyLongDreamMemoryPatch(record,{operations:[{op:'set_state',subjects:['甲'],attribute:'location',value:'旧港',chapterNumber:1}]},1);
    record=saveStorySummary(record,mergeStoryResponse(record,[{chapterNumber:1,text:'原概要'}]));
    const id=record.memory.summaryVersions[0].id;
    record=updateLongDreamMemoryV2RecordItem(record,'state',record.memory.states[0].id,{value:'新港'});
    assert.equal(record.memory.storyEntries.length,0);
    assert.equal(record.memory.summaryVersions[0].canRestore,false);
    assert.throws(()=>restoreStorySummary(record,id));
    const result=applyLongDreamMemoryPatch(record,parseLongDreamMemoryResponse('{"currentState":"只看最近","operations":[]}',{pendingChapterNumbers:[1]}),1);
    assert.equal(result.memory.currentState,record.memory.currentState);
    assert.equal(result.memory.summaryNeedsRefresh,true);
});

test('织录迟到成功或失败都不能复活已删除作品，也不覆盖请求期间的改写', async () => {
    const source=readTheaterImplementation();
    const fn=source.match(/async function weaveLongDreamMemory\([^]*?(?=\nasync function (?:runtime\.)?discardLongDreamDraft)/)[0];
    const { setLongDreamMemoryStatus }=await import('../long-dream.js');
    const { DEFAULT_LONG_DREAM_MEMORY_PRESET }=await import('../long-dream-memory.js');
    for (const outcome of ['deleted-success','deleted-failure','changed-success','changed-failure']) {
        const record=createLongDreamRecord({source:{text:'合成第一章',html:'<p>正文</p>'}});record.id=123;
        const puts=[];
        const scope={longDreamCache:[record],settings:{},selectedLongDreamMemoryApiPreset:()=>({}),shouldWeaveLongDreamMemory,buildLongDreamMemoryPayload,DEFAULT_LONG_DREAM_MEMORY_PRESET,
            setLongDreamMemoryStatus,LONG_DREAM_MEMORY_STATUS,activeLongDreamId:null,longDreamView:'list',renderLongDreamPanel(){},runtimeLog(){},normalizeMaxTokens:()=>4096,
            parseLongDreamMemoryResponse,applyLongDreamMemoryPatch,REQUEST_DIAGNOSTIC_SIGNAL:{INVALID_RESPONSE:'bad'},refreshLongDreamSummaryNow:()=>assert.fail('stale summary'),
            longDreamPut:async value=>{puts.push(value);scope.longDreamCache=[value];return value;},
            requestCustomApi:async()=>{
                scope.longDreamCache=outcome.startsWith('deleted')?[]:[{...scope.longDreamCache[0],canon:'新决定'}];
                if(outcome.endsWith('failure'))throw Error('synthetic');
                return '{"storyEntries":[{"chapterNumber":1,"text":"旧结果"}],"operations":[]}';
            },
        };
        await runInNewContext(fn+'\nweaveLongDreamMemory(123,{force:true});',scope);
        assert.equal(puts.filter(value=>value.memory.status==='failed').length,0);
        if(outcome.startsWith('deleted'))assert.equal(puts.length,1);
        else {assert.equal(scope.longDreamCache[0].canon,'新决定');assert.equal(scope.longDreamCache[0].memory.status,LONG_DREAM_MEMORY_STATUS.PENDING);assert.doesNotMatch(scope.longDreamCache[0].memory.currentState,/旧结果/);}
    }
});

test('正文来源校验区分 emoji 改写，旧概要不能被错误恢复', async () => {
    const { chapterSummarySources, mergeStoryResponse, saveStorySummary, restoreStorySummary }=await import('../long-dream-story-summary.js');
    assert.notDeepEqual(chapterSummarySources([{number:1,text:'😀'}]),chapterSummarySources([{number:1,text:'😁'}]));
    let record=synopsisFixture(1);
    record=saveStorySummary(record,mergeStoryResponse(record,[{chapterNumber:1,text:'原经历'}]));
    const id=record.memory.summaryVersions[0].id;
    const changed={...record,chapters:record.chapters.map(chapter=>({...chapter,text:'另一条故事'}))};
    assert.throws(()=>restoreStorySummary(changed,id),/正文已改变/);
    const normalized=normalizeLongDreamRecord(changed);
    assert.equal(normalized.memory.currentState,'');
    assert.equal(normalized.memory.summaryVersions.length,0);
});

test('旧作品大量缺失概要时不挤占织录操作输出，完成织录后可分批补全', async () => {
    let record=synopsisFixture(7);
    record=appendLongDreamChapter(record,{text:'最新章',html:'<p>最新章</p>'});
    const payload=buildLongDreamMemoryPayload({record});
    assert.match(payload.userPrompt,/本次 storyEntries 返回空数组/);
    assert.doesNotMatch(payload.userPrompt,/仅补齐第 1 章概要/);
    record=applyLongDreamMemoryPatch(record,parseLongDreamMemoryResponse('{"storyEntries":[],"operations":[]}',{pendingChapterNumbers:[8]}),8);
    assert.equal(record.memory.pendingChapterNumbers.length,0);
    assert.equal(record.memory.summaryNeedsRefresh,true);
    const {buildLongDreamSummaryPayload}=await import('../long-dream-memory.js');
    assert.doesNotThrow(()=>buildLongDreamSummaryPayload(record));
});

test('自动分批补概要保留已保存早期段落，只有手动更新重整全篇', async () => {
    const { refreshLongDreamSummary }=await import('../long-dream-summary.js');
    let record=synopsisFixture(2);
    record=await refreshLongDreamSummary({record,request:async()=>JSON.stringify({storyEntries:[{chapterNumber:1,text:'喜欢的开端'},{chapterNumber:2,text:'喜欢的转折'}]}),readLatest:()=>record,save:value=>value});
    for(let n=3;n<=8;n++)record=appendLongDreamChapter(record,{text:`补充${n}`,html:`<p>${n}</p>`});
    record=applyLongDreamMemoryPatch(record,{operations:[]},8);
    const requested=[];
    const result=await refreshLongDreamSummary({record,replace:false,request:async payload=>{
        const numbers=[...payload.userPrompt.matchAll(/第(\d+)章：/g)].map(match=>Number(match[1]));requested.push(...numbers);
        return JSON.stringify({storyEntries:numbers.map(chapterNumber=>({chapterNumber,text:`新段落${chapterNumber}`}))});
    },readLatest:()=>record,save:value=>value});
    assert.deepEqual(requested,[3,4,5,6,7,8]);
    assert.match(result.memory.currentState,/喜欢的开端[\s\S]*喜欢的转折[\s\S]*新段落8/);
});

test('旧版概要在用户纠错后迁移仍不可恢复，直接截短导入也不残留未来', async () => {
    const { refreshLongDreamSummary }=await import('../long-dream-summary.js');
    const { restoreStorySummary }=await import('../long-dream-story-summary.js');
    let record=synopsisFixture(2);
    record=applyLongDreamMemoryPatch(record,{currentState:'旧错误概要',operations:[{op:'set_state',subjects:['甲'],attribute:'location',value:'错误地点',chapterNumber:1}]},2);
    record=updateLongDreamMemoryV2RecordItem(record,'state',record.memory.states[0].id,{value:'正确地点'});
    record=await refreshLongDreamSummary({record,request:async()=>JSON.stringify({storyEntries:[{chapterNumber:1,text:'正确开端'},{chapterNumber:2,text:'未来章节'}]}),readLatest:()=>record,save:value=>value});
    assert.equal(record.memory.summaryVersions[0].canRestore,false);
    assert.throws(()=>restoreStorySummary(record,record.memory.summaryVersions[0].id));
    const shortened=normalizeLongDreamRecord({...record,chapters:record.chapters.slice(0,1)});
    assert.doesNotMatch(shortened.memory.currentState,/未来章节/);
    assert.equal(shortened.memory.storyEntries.length,1);
});

test('概要刷新成功及失败均同步恢复按钮，保留失效正文和梦脉限制，切换作品不误解锁', async () => {
    const {restoreStorySummary,chapterSummarySources}=await import('../long-dream-story-summary.js');
    const source=readTheaterImplementation();
    const functions=source.match(/function syncLongDreamSummaryButton\(key\) \{[^]*?(?=\nasync function weaveLongDreamMemory)/)[0];
    let dream=createLongDreamRecord({source:{text:'正式正文',html:'<p>正式正文</p>'}});
    dream.memory={...dream.memory,status:'ready',pendingChapterNumbers:[],pendingConflicts:[],summaryVersions:[
        {id:'valid',text:'可恢复',chapterNumber:1,sources:chapterSummarySources(dream.chapters),storyEntries:[]},
        {id:'invalid',text:'用户决定已变',chapterNumber:1,canRestore:false,sources:[],storyEntries:[]},
        {id:'changed',text:'正文已变',chapterNumber:1,sources:['wrong'],storyEntries:[]},
    ]};
    const buttons=['valid','invalid','changed'].map(id=>({disabled:true,getAttribute:()=>id}));
    const refresh={prop(){return this},attr(){return this},text(){return this},each(){return this}};
    const scope={activeLongDreamId:dream.id,longDreamCache:[dream],refreshingLongDreamSummaries:new Set(),LONG_DREAM_MEMORY_STATUS,restoreStorySummary,summaryUnavailableReason,condenseSummaryPlan,
        $:selector=>selector==='[data-dream-summary-restore]'?{each(fn){buttons.forEach(b=>fn.call(b));}}:refresh,
        selectedLongDreamMemoryApiPreset:()=>({}),refreshLongDreamSummary:async()=>dream,rememberLongDreamComposerDraft(){},
        renderLongDreamPanel(){buttons.forEach(b=>b.disabled=scope.refreshingLongDreamSummaries.has(String(dream.id)));},
        toastr:{info(){},warning(){},success(){}},
    };
    scope.theaterError = () => {}; scope.diagnosticSignalInfo = diagnosticSignalInfo; scope.classifyRequestFailure = classifyRequestFailure;
    runInNewContext(functions,scope);await scope.refreshLongDreamSummaryNow(dream.id);
    assert.deepEqual(buttons.map(b=>b.disabled),[false,true,true]);
    scope.refreshLongDreamSummary=async()=>{throw new Error('synthetic failure')};await scope.refreshLongDreamSummaryNow(dream.id);
    assert.deepEqual(buttons.map(b=>b.disabled),[false,true,true]);
    for(const patch of [{status:'weaving'},{pendingChapterNumbers:[1]},{pendingConflicts:[{}]}]){
        const original=dream.memory;dream.memory={...original,...patch};scope.syncLongDreamSummaryButton(String(dream.id));
        assert.ok(buttons.every(b=>b.disabled));dream.memory=original;
    }
    scope.activeLongDreamId='other';scope.syncLongDreamSummaryButton(String(dream.id));assert.ok(buttons.every(b=>b.disabled));
});

test('手动概要确认取消不执行，确认后重新检查作品和版本，避免旧弹窗覆盖', async () => {
    const { saveStorySummary, restoreStorySummary, chapterSummarySources } = await import('../long-dream-story-summary.js');
    const source = readTheaterImplementation();
    const handler = source.match(/async function (?:runtime\.)?confirmLongDreamSummaryAction\([^]*?(?=\nfunction syncLongDreamSummaryButton)/)[0];
    for (const mode of ['cancel', 'update', 'restore', 'changed', 'switched', 'busy', 'blocked', 'failed-save']) {
        let dream = createLongDreamRecord({ source: { text: '虚构第一章', html: '<p>虚构第一章</p>' } });
        dream = applyLongDreamMemoryPatch(dream, { operations: [] }, 1);
        dream = saveStorySummary(dream, [{ chapterNumber: 1, text: '旧概要', source: chapterSummarySources(dream.chapters)[0] }]);
        const id = dream.memory.summaryVersions.at(-1).id;
        dream = { ...dream, memory: { ...dream.memory, currentState: '当前概要' } };
        const before = JSON.stringify(dream);
        let prompts = 0, requests = 0, saves = 0, renders = 0, saved;
        const scope = { activeLongDreamId: dream.id, longDreamCache: [dream], settings: {},
            confirmingLongDreamSummaries: new Set(), refreshingLongDreamSummaries: new Set(),
            summaryUnavailableReason, restoreStorySummary, condenseSummaryPlan, esc: String,
            refreshLongDreamSummaryNow: async () => { requests++; },
            longDreamPut: async value => { saves++; saved = value; return mode === 'failed-save' ? null : value; },
            rememberLongDreamComposerDraft() {}, renderLongDreamPanel() { renders++; },
            toastr: { info() {}, warning() {}, success() {} },
            SillyTavern: { getContext: () => ({ POPUP_TYPE: { CONFIRM: 1 }, Popup: class {
                constructor(html, type, value, options) { assert.match(html, /取消|重新整理|恢复到/); assert.equal(options.cancelButton, '取消'); }
                async show() {
                    prompts++;
                    if (mode === 'changed') scope.longDreamCache = [{ ...dream, updatedAt: 'new' }];
                    if (mode === 'switched') scope.activeLongDreamId = 'other';
                    if (mode === 'busy') scope.refreshingLongDreamSummaries.add(String(dream.id));
                    return mode !== 'cancel';
                }
            } }) },
        };
        if (mode === 'blocked') dream.memory.pendingChapterNumbers = [1];
        runInNewContext(handler, scope);
        await scope.confirmLongDreamSummaryAction(dream.id, mode === 'update' ? null : id);
        assert.equal(requests, mode === 'update' ? 1 : 0, mode);
        assert.equal(saves, ['restore', 'failed-save'].includes(mode) ? 1 : 0, mode);
        assert.equal(renders, mode === 'restore' ? 1 : 0, mode);
        assert.equal(prompts, mode === 'blocked' ? 0 : 1, mode);
        assert.equal(scope.confirmingLongDreamSummaries.size, 0);
        if (mode === 'restore') { assert.equal(saved.memory.currentState, dream.memory.summaryVersions.at(-1).text); assert.deepEqual(saved.chapters, dream.chapters); }
        if (mode !== 'blocked') assert.equal(JSON.stringify(dream), before);
    }
});

test('概要禁用说明与原恢复保护一致，不把正文生成本身当禁用条件', () => {
    const dream = synopsisFixture(1);
    assert.equal(summaryUnavailableReason(dream), '');
    assert.match(summaryUnavailableReason(dream, true), /概要正在更新/);
    for (const [patch, expected] of [[{ status: 'weaving' }, /正在织录/], [{ pendingChapterNumbers: [2] }, /待织录/], [{ pendingConflicts: [{}] }, /冲突/]]) {
        assert.match(summaryUnavailableReason({ ...dream, memory: { ...dream.memory, ...patch } }), expected);
    }
    assert.match(summaryUnavailableReason(dream, false, 'missing'), /不能恢复/);
    assert.match(summaryUnavailableReason({ ...dream, memory: { ...dream.memory, summaryVersions: [{ id: 'old', canRestore: false }] } }, false, 'old'), /仅供查看/);
});
