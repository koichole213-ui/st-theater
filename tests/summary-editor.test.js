import test from 'node:test';
import assert from 'node:assert/strict';
import { saveManualStorySummary } from '../long-dream-summary-editor.js';
import { summaryRevision, refreshLongDreamSummary } from '../long-dream-summary.js';
import { saveStorySummary, mergeStoryResponse, restoreStorySummary, validStoryEntries, pendingManualStoryEntries, invalidateStoryDecisions, composeStorySummary, validateStorySources } from '../long-dream-story-summary.js';
import { applySeriesStoryBatch } from '../long-dream-series.js';
import { createLongDreamRecord, normalizeLongDreamRecord, applyLongDreamMemoryPatch, prepareLongDreamMemoryRegeneration, updateLongDreamMemoryV2RecordItem, resolveLongDreamMemoryV2RecordConflict } from '../long-dream.js';
import { longDreamChapterContext } from '../long-dream-payload.js';

function fixture() {
    let record = createLongDreamRecord({ source: { text:'合成首章正文',html:'<p>合成首章正文</p>' } });
    record = applyLongDreamMemoryPatch(record, { operations:[] }, 1);
    return saveStorySummary(record, mergeStoryResponse(record,[{chapterNumber:1,text:'模型旧概要'}],{replace:true}));
}
test('手动保存持久化、进入续写上下文，不改正文/人物关系，并可恢复保存前版本',()=>{
    const record=fixture(),before=JSON.stringify(record),revision=summaryRevision(record);
    const edited=saveManualStorySummary(record,[{chapterNumber:1,text:'用户确认的开端与因果'}],revision);
    assert.equal(JSON.stringify(record),before);
    assert.deepEqual(edited.chapters,record.chapters);assert.deepEqual(edited.memory.states,record.memory.states);
    const restored=normalizeLongDreamRecord(JSON.parse(JSON.stringify(edited)));
    assert.equal(restored.memory.currentState,'第 1 章：用户确认的开端与因果');
    assert.match(longDreamChapterContext(restored).memory,/用户确认的开端与因果/);
    assert.equal(restoreStorySummary(restored,record.memory.summaryVersions.at(-1).id).memory.currentState,record.memory.currentState);
});
test('验证空白和超长时不部分保存或截断，旧记录不变',()=>{
    const record=fixture(),revision=summaryRevision(record),before=JSON.stringify(record);
    for(const text of ['', ' '.repeat(5),'字'.repeat(1201)]) assert.throws(()=>saveManualStorySummary(record,[{chapterNumber:1,text}],revision));
    assert.equal(JSON.stringify(record),before);
    assert.equal(validStoryEntries(saveManualStorySummary(record,[{chapterNumber:1,text:'字'.repeat(1200)}],revision))[0].text.length,1200);
});
test('编辑期间正文/概要/关系/世界线变更不被旧草稿覆盖',()=>{
    const record=fixture(),revision=summaryRevision(record);
    for(const changed of [ {...record,chapters:record.chapters.map(c=>({...c,text:'新正文'}))}, {...record,memory:{...record.memory,currentState:'另一次手改'}}, {...record,canon:{...record.canon,text:'新设定'}}, {...record,inheritance:{...record.inheritance,worldBookPolicy:'changed'}} ]) {
        assert.throws(()=>saveManualStorySummary(changed,[{chapterNumber:1,text:'旧编辑'}],revision),/发生变化/);
    }
});
test('织录中或冲突/待织录时不保存，零章节不制造概要',()=>{
    const record=fixture();
    for(const memory of [{...record.memory,status:'weaving'}, {...record.memory,pendingConflicts:[{}]}, {...record.memory,pendingChapterNumbers:[1]}]) {
        const locked={...record,memory};assert.throws(()=>saveManualStorySummary(locked,[{chapterNumber:1,text:'修改'}],summaryRevision(locked)));
    }
    const empty={...record,chapters:[]};assert.throws(()=>saveManualStorySummary(empty,[],summaryRevision(empty)));
});
test('普通新章自动补概要及系列分批补概要都保留手改的旧章',async()=>{
    let record=fixture();record=saveManualStorySummary(record,[{chapterNumber:1,text:'手动开端'}],summaryRevision(record));
    const next={...record,chapters:[...record.chapters,{...record.chapters[0],id:'second',number:2,text:'合成第二章正文'}]};
    const completed=await refreshLongDreamSummary({record:next,replace:false,request:async payload=>{
        assert.doesNotMatch(payload.userPrompt,/合成首章正文/);return {text:JSON.stringify({storyEntries:[{chapterNumber:2,text:'新章概要'}]})};
    },readLatest:()=>next,save:r=>r});
    assert.equal(validStoryEntries(completed)[0].text,'手动开端');
    const series=applySeriesStoryBatch(next,[{chapterNumber:2,text:'分批新章'}],[next.chapters[1]]);
    assert.equal(validStoryEntries(series)[0].text,'手动开端');
});
test('已存在最近版本时，也保存当前尚未入版本的部分概要再允许编辑',()=>{
    const record=fixture();const current={...record,memory:{...record.memory,currentState:'尚未入版本的合成概要'}};
    const saved=saveManualStorySummary(current,[{chapterNumber:1,text:'手改新概要'}],summaryRevision(current));
    const previous=saved.memory.summaryVersions.find(v=>v.text==='尚未入版本的合成概要');
    assert.ok(previous);assert.equal(restoreStorySummary(saved,previous.id).memory.currentState,'尚未入版本的合成概要');
    assert.ok(saved.memory.summaryVersions.length<=5);
});

test('整部梦脉重织及JSON恢复保留人工概要，明确全篇重整才替换',()=>{
    let record=fixture();record=saveManualStorySummary(record,[{chapterNumber:1,text:'手改开端'}],summaryRevision(record));
    const persisted=normalizeLongDreamRecord(JSON.parse(JSON.stringify(record)));
    assert.equal(persisted.memory.storyEntries[0].editedByUser,true);
    const queued=prepareLongDreamMemoryRegeneration(persisted);
    queued.memory.pendingConflicts=[];
    const woven=applySeriesStoryBatch(queued,[{chapterNumber:1,text:'模型试图替换旧章'}],queued.chapters);
    assert.equal(woven.memory.storyEntries[0].text,'手改开端');
    const rebuilt=saveStorySummary(persisted,mergeStoryResponse(persisted,[{chapterNumber:1,text:'主动重整的新概要'}],{replace:true}));
    assert.equal(rebuilt.memory.storyEntries[0].editedByUser,undefined);
    const old=rebuilt.memory.summaryVersions.find(v=>v.text==='第 1 章：手改开端');
    assert.equal(restoreStorySummary(rebuilt,old.id).memory.storyEntries[0].editedByUser,true);
});

test('用户纠正梦脉后保留人工稿待核对，不自动重写或注入旧事实，核对保存可重新启用',async()=>{
    let record=fixture();
    record=applyLongDreamMemoryPatch(record,{operations:[{op:'set_state',subjects:['甲'],attribute:'location',value:'车站',chapterNumber:1}]},1);
    record=saveManualStorySummary(record,[{chapterNumber:1,text:'手改的车站往事'}],summaryRevision(record));
    const corrected=updateLongDreamMemoryV2RecordItem(record,'state',record.memory.states[0].id,{value:'庭院'});
    assert.equal(pendingManualStoryEntries(corrected)[0].text,'手改的车站往事');
    assert.equal(validStoryEntries(corrected).length,0);assert.equal(corrected.memory.currentState,'');
    assert.doesNotMatch(longDreamChapterContext(corrected).memory,/手改的车站往事/);
    let calls=0;await assert.rejects(refreshLongDreamSummary({record:corrected,replace:false,request:async()=>{calls++;},readLatest:()=>corrected,save:r=>r}),{code:'LONG_DREAM_SUMMARY_MANUAL_REVIEW'});assert.equal(calls,0);
    const checked=saveManualStorySummary(corrected,[{chapterNumber:1,text:'核对后的合成往事'}],summaryRevision(corrected));
    assert.equal(pendingManualStoryEntries(checked).length,0);assert.equal(validStoryEntries(checked)[0].text,'核对后的合成往事');
});

test('停用手稿在正文/版本失效重组和冲突确认后均不会重新注入',()=>{
    let record=fixture();
    record=applyLongDreamMemoryPatch(record,{operations:[{op:'set_state',subjects:['甲'],attribute:'location',value:'车站',chapterNumber:1}]},1);
    record=updateLongDreamMemoryV2RecordItem(record,'state',record.memory.states[0].id,{value:'庭院'});
    record=saveManualStorySummary(record,[{chapterNumber:1,text:'人工确认的往事'}],summaryRevision(record));
    const conflict=applyLongDreamMemoryPatch(record,{operations:[{op:'set_state',targetId:record.memory.states[0].id,subjects:['甲'],attribute:'location',value:'新位置',chapterNumber:1}]},1);
    assert.ok(conflict.memory.pendingConflicts.length);
    const accepted=resolveLongDreamMemoryV2RecordConflict(conflict,conflict.memory.pendingConflicts[0].id,'accept');
    assert.equal(accepted.memory.currentState,'');assert.equal(pendingManualStoryEntries(accepted).length,1);
    const invalidated={...record.memory,...invalidateStoryDecisions(record.memory)};
    const changed=validateStorySources({...invalidated,summaryVersions:[...invalidated.summaryVersions,{...invalidated.summaryVersions[0],id:'stale',sources:['changed']} ]},record.chapters);
    assert.equal(composeStorySummary(changed.storyEntries),'');assert.equal(changed.currentState,'');
    const legacy={...record,memory:{...invalidated,currentState:'人工确认的往事'}};
    assert.doesNotMatch(longDreamChapterContext(legacy).memory,/人工确认的往事/);
});
