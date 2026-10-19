import test from 'node:test';
import assert from 'node:assert/strict';
import { createLongDreamRecord, appendLongDreamChapter, applyLongDreamMemoryPatch, normalizeLongDreamRecord, updateLongDreamChapter } from '../long-dream.js';
import { editableSummaryDraft, saveManualStorySummary } from '../long-dream-summary-editor.js';
import { summaryRevision, refreshLongDreamSummary } from '../long-dream-summary.js';
import { saveStorySummary, mergeStoryResponse, restoreStorySummary, manualFullSummary, hasPendingManualSummary, coveredStoryChapters, invalidateStoryDecisions } from '../long-dream-story-summary.js';
import { applySeriesStoryBatch } from '../long-dream-series.js';
import { longDreamChapterContext } from '../long-dream-payload.js';
import { createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { createLongDreamArchive, parseLongDreamArchive } from '../long-dream-archive.js';

function fixture() {
    let record=createLongDreamRecord({source:{text:'合成第一章正文',html:'<p>合成第一章正文</p>'}});
    record=appendLongDreamChapter(record,{text:'合成第二章正文',html:'<p>合成第二章正文</p>'});
    record=applyLongDreamMemoryPatch(record,{operations:[]},2);
    return {...record,memory:{...record.memory,currentState:'旧版整篇概要：两人在雨夜相遇，后来一起找到了旧信。',summaryThroughChapter:2}};
}
function editFull(record,text) {
    const draft=editableSummaryDraft(record);
    return saveManualStorySummary(record,[],summaryRevision(record),undefined,{fullSummary:{text,chapterNumber:draft.full.chapterNumber}});
}
test('旧整篇原样回填且不冒充第一章，分章只列实际已有章节让用户自己选',()=>{
    const legacy=fixture(),whole=editableSummaryDraft(legacy);
    assert.equal(whole.chapter,'full');assert.equal(whole.texts.full,legacy.memory.currentState);assert.deepEqual(whole.chapters,[]);
    const structured=saveStorySummary(legacy,mergeStoryResponse(legacy,[{chapterNumber:1,text:'第一章原概要'},{chapterNumber:2,text:'第二章原概要'}],{replace:true}));
    const chapters=editableSummaryDraft(structured);assert.equal(chapters.full,null);assert.deepEqual(chapters.chapters,[1,2]);assert.equal(chapters.texts['2'],'第二章原概要');
    const partial={...structured,memory:{...structured.memory,storyEntries:structured.memory.storyEntries.slice(1)}};
    assert.equal(editableSummaryDraft(partial).chapter,'2');assert.deepEqual(editableSummaryDraft(partial).chapters,[2]);
});
test('整篇超过单章1200字符仍可完整编辑，保存保留旧版且不改正文/梦脉',()=>{
    const legacy=fixture(),before=JSON.stringify(legacy),text='保留原整篇并改正因果。'.repeat(180);
    const edited=editFull(legacy,text),normalized=normalizeLongDreamRecord(JSON.parse(JSON.stringify(edited)));
    assert.equal(normalized.memory.currentState,text);assert.equal(manualFullSummary(normalized).text,text);assert.deepEqual(normalized.memory.storyEntries,[]);
    assert.deepEqual(normalized.chapters,legacy.chapters);assert.deepEqual(normalized.memory.states,legacy.memory.states);assert.equal(JSON.stringify(legacy),before);
    const old=normalized.memory.summaryVersions.find(v=>v.text===legacy.memory.currentState);assert.ok(old);
    const restored=restoreStorySummary(normalized,old.id);assert.equal(editableSummaryDraft(restored).texts.full,legacy.memory.currentState);
});
test('新章补概要只请求新章，旧整篇及新增分章共同参与续写且都可编辑',async()=>{
    const edited=editFull(fixture(),'人工修正的前两章经历');
    let next=appendLongDreamChapter(edited,{text:'合成第三章正文',html:'<p>合成第三章正文</p>'});
    next=applyLongDreamMemoryPatch(next,{operations:[],currentState:'模型旧接口试图覆盖整篇'},3);
    assert.equal(next.memory.currentState,'人工修正的前两章经历');
    const requested=[];
    const completed=await refreshLongDreamSummary({record:next,replace:false,request:async payload=>{
        requested.push(payload.userPrompt);return {text:JSON.stringify({storyEntries:[{chapterNumber:3,text:'第三章新增概要'}]})};
    },readLatest:()=>next,save:r=>normalizeLongDreamRecord(r)});
    assert.equal(requested.length,1);assert.doesNotMatch(requested[0],/合成第一章正文|合成第二章正文/);
    assert.match(completed.memory.currentState,/人工修正的前两章经历[\s\S]*第三章新增概要/);
    assert.deepEqual([...coveredStoryChapters(completed)],[3,1,2]);
    const draft=editableSummaryDraft(completed);assert.equal(draft.texts.full,'人工修正的前两章经历');assert.equal(draft.texts['3'],'第三章新增概要');
    assert.match(longDreamChapterContext(completed).memory,/人工修正的前两章经历/);
});
test('系列重织不覆盖手改整篇，新增批次合并新章',()=>{
    const edited=editFull(fixture(),'手改整篇');
    const reweave=applySeriesStoryBatch(edited,[],edited.chapters);assert.equal(reweave.memory.currentState,'手改整篇');
    const next=appendLongDreamChapter(edited,{text:'第三章',html:'<p>第三章</p>'});
    const completed=applySeriesStoryBatch(next,[{chapterNumber:3,text:'第三章概要'}],[next.chapters[2]]);
    assert.match(completed.memory.currentState,/手改整篇[\s\S]*第三章概要/);assert.equal(completed.memory.summaryThroughChapter,3);
});
test('手动重整全篇才清除旧整篇保护，旧版恢复能恢复全文及保护标记',async()=>{
    const edited=editFull(fixture(),'人工整篇');
    const replaced=await refreshLongDreamSummary({record:edited,replace:true,request:async()=>({text:JSON.stringify({storyEntries:[{chapterNumber:1,text:'重整第一章'},{chapterNumber:2,text:'重整第二章'}]})}),readLatest:()=>edited,save:r=>r});
    assert.equal(manualFullSummary(replaced),null);assert.doesNotMatch(replaced.memory.currentState,/人工整篇/);
    const old=replaced.memory.summaryVersions.find(v=>v.text==='人工整篇');
    const restored=restoreStorySummary(replaced,old.id);assert.equal(manualFullSummary(restored).text,'人工整篇');
});
test('事实纠错后整篇转待核对不注入、不发概要请求；编辑仍带回原文',async()=>{
    const edited=editFull(fixture(),'待核对的手改整篇');
    const pending={...edited,memory:{...edited.memory,...invalidateStoryDecisions(edited.memory)}};
    assert.equal(hasPendingManualSummary(pending),true);assert.equal(pending.memory.currentState,'');
    assert.equal(editableSummaryDraft(pending).texts.full,'待核对的手改整篇');assert.doesNotMatch(longDreamChapterContext(pending).memory,/待核对的手改整篇/);
    let calls=0;await assert.rejects(refreshLongDreamSummary({record:pending,replace:false,request:async()=>{calls++;},readLatest:()=>pending,save:r=>r}));assert.equal(calls,0);
    const checked=editFull(pending,'已核对的手稿');assert.equal(hasPendingManualSummary(checked),false);assert.equal(checked.memory.currentState,'已核对的手稿');
});
test('JSON/ZIP备份往返保留整篇手稿及待核对状态和版本',()=>{
    const edited=editFull(fixture(),'归档整篇手稿');
    for(const record of [edited,{...edited,memory:{...edited.memory,...invalidateStoryDecisions(edited.memory)}}]){
        const zip=createLongDreamArchive([record]);
        for(const restored of [parseLongDreamBackup(createLongDreamBackup([record]))[0],parseLongDreamArchive(zip.manifest,zip.files)[0]]){
            assert.deepEqual(restored.memory.manualFullSummary,record.memory.manualFullSummary);assert.equal(editableSummaryDraft(restored).texts.full,'归档整篇手稿');
            assert.equal(hasPendingManualSummary(restored),hasPendingManualSummary(record));
        }
    }
});
test('正文改动在整篇覆盖范围内使其失效，范围外重写保留有效旧整篇',()=>{
    const edited=editFull(fixture(),'前两章整篇');
    const early=updateLongDreamChapter(edited,edited.chapters[0].id,{text:'改写首章',html:'<p>改写首章</p>'});
    assert.equal(manualFullSummary(normalizeLongDreamRecord(early)),null);assert.doesNotMatch(normalizeLongDreamRecord(early).memory.currentState,/前两章整篇/);
    const next=appendLongDreamChapter(edited,{text:'第三章',html:'<p>第三章</p>'});
    const later=updateLongDreamChapter(next,next.chapters[2].id,{text:'改写第三章',html:'<p>改写第三章</p>'});
    assert.equal(later.memory.currentState,'前两章整篇');
});
test('没有概要时不制造可选空白章；旧整篇空白/过期保存不覆盖原数据',()=>{
    const legacy=fixture();assert.throws(()=>editFull(legacy,''));
    const empty={...legacy,memory:{...legacy.memory,currentState:''}};assert.equal(editableSummaryDraft(empty).chapter,'');
    assert.throws(()=>saveManualStorySummary({...legacy,updatedAt:'changed',memory:{...legacy.memory,currentState:'新记录'}},[],summaryRevision(legacy),undefined,{fullSummary:{text:'旧编辑',chapterNumber:2}}),/发生变化/);
});
