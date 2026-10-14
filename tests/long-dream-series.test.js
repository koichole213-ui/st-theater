import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { longDreamFolderSources, importLongDreamSeries, nextSeriesMemoryBatch, runSeriesMemoryBatches, applySeriesStoryBatch, refreshSeriesStorySummary } from '../long-dream-series.js';
import { sourcePickerHTML, sourcePickerResults, pickerSelectedSource, bindSourcePicker } from '../long-dream-source-picker.js';
import { createLongDreamRecord, normalizeLongDreamRecord, setLongDreamMemoryStatus, applyLongDreamMemoryPatch, LONG_DREAM_MEMORY_STATUS } from '../long-dream.js';
import { buildLongDreamMemoryPayload, parseLongDreamMemoryResponse, shouldWeaveLongDreamMemory, DEFAULT_LONG_DREAM_MEMORY_PRESET } from '../long-dream-memory.js';
import { normalizeMaxTokens } from '../api-client.js';
import { createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { createLongDreamArchive, parseLongDreamArchive } from '../long-dream-archive.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function fixture(n = 7) {
    const historyCache = Array.from({ length: n }, (_, i) => ({ id:i+1, chapterId:`saved-${i+1}`, title:`篇目${i+1}`, html:`<article>完整正文${i+1} · 旧信</article>`, date:`2026-10-${String(i+1).padStart(2,'0')}` }));
    const historyCollections = [{ id:'folder', title:'系列', itemIds:historyCache.map(x=>String(x.id)) }];
    const runtime = { historyCache, historyCollections, htmlToPlainText:html=>html.replace(/<[^>]+>/g,''), settings:{}, esc };
    const source = longDreamFolderSources(runtime)[0];
    const record = { ...importLongDreamSeries(createLongDreamRecord({ source }), source, true), id:9 };
    return { runtime, source, record };
}
test('系列复制保留文件夹顺序与原HTML，原历史不变，不混入同篇其他版本',()=>{
    const {runtime}=fixture();runtime.historyCache.push({...runtime.historyCache[0],id:8,html:'<p>重写后的已存正文</p>'});runtime.historyCollections[0].itemIds.push('8');
    const before=JSON.stringify([runtime.historyCache,runtime.historyCollections]);const source=longDreamFolderSources(runtime)[0];
    const record=importLongDreamSeries(createLongDreamRecord({source}),source,false);
    assert.equal(record.chapters.length,7);assert.equal(record.chapters[0].html,'<p>重写后的已存正文</p>');
    assert.deepEqual(record.chapters.map(c=>c.number),[1,2,3,4,5,6,7]);assert.equal(record.chapters[6].html,runtime.historyCache[6].html);
    assert.equal(record.seriesMemoryAutoWeave,false);assert.equal(JSON.stringify([runtime.historyCache,runtime.historyCollections]),before);
    assert.deepEqual(record.memory.pendingChapterNumbers,[1,2,3,4,5,6,7]);
});
test('缺正文或读取失败时不提供不完整文件夹来源',()=>{
    const {runtime}=fixture();runtime.historyCache[3].html='';assert.equal(longDreamFolderSources(runtime).length,0);
    runtime.storageReadErrors={history:true};assert.equal(longDreamFolderSources(runtime).length,0);
});
test('分批兼顾章数与字数，超过单批长度的单章不截断',()=>{
    const {record}=fixture();record.chapters[0].text='长'.repeat(30000);const batch=nextSeriesMemoryBatch(record);
    assert.equal(batch.length,1);assert.equal(batch[0].text.length,30000);
    record.memory.processedThroughChapter=1;assert.deepEqual(nextSeriesMemoryBatch(record).map(x=>x.number),[2,3,4]);
});
function weaveFixture({ failAt=0, stopAt=0, response='normal' }={}) {
    const {record}=fixture();let current=record,calls=[],summaryCalls=0;
    const runtime={settings:{longDreamMemoryEnabled:true,longDreamMemoryBatchSize:3},longDreamCache:[current],
        selectedLongDreamMemoryApiPreset:()=>({name:'synthetic',maxOutputTokens:4096}),activeLongDreamId:null,
        async longDreamPut(record){current=normalizeLongDreamRecord(record);runtime.longDreamCache=[current];return current;},runtimeLog(){},renderLongDreamPanel(){},theaterError(){},save(){}};
    const module=readFileSync(new URL('../long-dream-runtime.js',import.meta.url),'utf8');
    const start=module.indexOf('// @theater-source-begin weaveLongDreamMemory');
    const end=module.indexOf('// @theater-source-end weaveLongDreamMemory',start);
    const weave=runInNewContext(module.slice(start,end)+'\nweaveLongDreamMemory',{
        runtime,runSeriesMemoryBatches,applySeriesStoryBatch,setLongDreamMemoryStatus,applyLongDreamMemoryPatch,LONG_DREAM_MEMORY_STATUS,
        buildLongDreamMemoryPayload,parseLongDreamMemoryResponse,shouldWeaveLongDreamMemory,DEFAULT_LONG_DREAM_MEMORY_PRESET,normalizeMaxTokens,
        REQUEST_DIAGNOSTIC_SIGNAL:{INVALID_RESPONSE:'invalid'},toastr:{warning(){},success(){},info(){}},
        refreshLongDreamSummaryNow:async()=>{summaryCalls++;},
        requestCustomApi:async({userPrompt})=>{
            const numbers=[...userPrompt.matchAll(/【第 (\d+) 章 ·/g)].map(m=>Number(m[1]));calls.push(numbers);
            if(calls.length===stopAt)runtime.settings.longDreamSeriesPausedIds=[String(record.id)];
            if(calls.length===failAt)throw Error('synthetic failure');
            if(response==='invalid')return {text:'{}'};
            return {text:JSON.stringify({operations:[],storyEntries:numbers.map(chapterNumber=>({chapterNumber,text:`本章经历${chapterNumber}`}))})};
        },
    });
    return {runtime,weave,read:()=>current,calls,summaryCalls:()=>summaryCalls};
}
test('真实梦脉入口顺序请求3/3/1，每批使用上一批已存记忆，保存至第七章',async()=>{
    const f=weaveFixture();await f.weave(9,{force:true,resumeSeries:true});
    assert.deepEqual(f.calls,[[1,2,3],[4,5,6],[7]]);assert.equal(f.read().memory.processedThroughChapter,7);
    assert.equal(f.read().chapters.length,7);assert.deepEqual(f.read().memory.storyEntries.map(e=>e.chapterNumber),[1,2,3,4,5,6,7]);
});
test('未勾选及持久停止意图阻止自动请求，包括重载入口',async()=>{
    const f=weaveFixture();f.read().seriesMemoryAutoWeave=false;await f.weave(9);assert.equal(f.calls.length,0);
    f.read().seriesMemoryAutoWeave=true;f.runtime.settings.longDreamSeriesPausedIds=['9'];await f.weave(9);assert.equal(f.calls.length,0);
});
test('第二批失败保留第一批，手动继续从第四章恢复',async()=>{
    const f=weaveFixture({failAt:2});await f.weave(9,{force:true,resumeSeries:true});assert.equal(f.read().memory.processedThroughChapter,3);
    assert.equal(f.read().memory.status,LONG_DREAM_MEMORY_STATUS.FAILED);assert.deepEqual(f.read().memory.storyEntries.map(e=>e.chapterNumber),[1,2,3]);await f.weave(9,{force:true,resumeSeries:true});
    assert.deepEqual(f.calls,[[1,2,3],[4,5,6],[4,5,6],[7]]);assert.equal(f.read().memory.processedThroughChapter,7);
});
test('停止后续批次保存当前成功批次，不自动补概要；手动可续接',async()=>{
    const f=weaveFixture({stopAt:1});await f.weave(9,{force:true,resumeSeries:true});assert.equal(f.calls.length,1);
    assert.equal(f.read().memory.processedThroughChapter,3);assert.equal(f.read().seriesMemoryAutoWeave,false);assert.equal(f.summaryCalls(),0);
    await f.weave(9,{force:true,resumeSeries:true});assert.deepEqual(f.calls,[[1,2,3],[4,5,6],[7]]);
});
test('空结构响应不伪装处理完成，原章节和织录进度保留',async()=>{
    const f=weaveFixture({response:'invalid'});await f.weave(9,{force:true,resumeSeries:true});assert.equal(f.read().memory.processedThroughChapter,0);
    assert.equal(f.read().memory.status,LONG_DREAM_MEMORY_STATUS.FAILED);assert.equal(f.calls.length,1);
});
test('系列授权选择与全部正文可JSON/ZIP备份往返',()=>{
    const {record}=fixture();for(const flag of [true,false]){
        record.seriesMemoryAutoWeave=flag;const json=parseLongDreamBackup(createLongDreamBackup([record]));
        const zip=createLongDreamArchive([record]);const restored=parseLongDreamArchive(zip.manifest,zip.files);
        for(const parsed of [json,restored]){assert.equal(parsed[0].seriesMemoryAutoWeave,flag);assert.equal(parsed[0].chapters.length,7);assert.equal(parsed[0].chapters[6].html,record.chapters[6].html);}
    }
});
test('286篇选择器按类分页，本地正文搜索与切页不清选中来源，输出转义',()=>{
    const f=fixture();const sources=[f.source,...Array.from({length:286},(_,i)=>({key:`history:${i}`,kind:'history',title:`剧场${i}<script>`,text:i===280?'遗忘标题里的车站':'普通正文',order:i}))];
    const html=sourcePickerHTML(f.runtime,sources);assert.match(html,/文件夹 · 1/);assert.match(html,/单篇 · 286/);
    const handlers={};const $d={off(){return this},on(_event,selector,handler){handlers[selector]=handler;return this}};
    const dom={};const make=(key)=>({html(value){dom[key]=value;return this},val(){return key.value},attr(name){return key[name]},each(){return this},trigger(){return this}});
    const old=globalThis.$;globalThis.$=make;
    try {
        bindSourcePicker($d,f.runtime);handlers['[data-source-tab]'].call({'data-source-tab':'single'});
        assert.equal((dom['#theater-source-results'].match(/class="theater-source-item"/g)||[]).length,5);
        handlers['#theater-source-search'].call({value:'车站'});assert.match(dom['#theater-source-results'],/剧场280&lt;script&gt;/);
        assert.equal(pickerSelectedSource(f.runtime).key,f.source.key);assert.doesNotMatch(dom['#theater-source-results'],/<script>/);
    } finally {globalThis.$=old;}
});

test('内部force刷新不恢复未勾选或已停止系列的收费授权',async()=>{
    const f=weaveFixture();f.read().seriesMemoryAutoWeave=false;await f.weave(9,{force:true});assert.equal(f.calls.length,0);
    f.read().seriesMemoryAutoWeave=true;f.runtime.settings.longDreamSeriesPausedIds=['9'];await f.weave(9,{force:true});assert.equal(f.calls.length,0);
});
test('仅补概要后批失败保留已存前批，继续不重复请求前批',async()=>{
    const {record}=fixture();record.memory.processedThroughChapter=7;record.memory.pendingChapterNumbers=[];record.memory.status='ready';let current=record;const calls=[];
    const options={record:current,readLatest:()=>current,save:async value=>(current=normalizeLongDreamRecord(value)),request:async({userPrompt})=>{
        const numbers=[...userPrompt.matchAll(/第(\d+)章：/g)].map(x=>Number(x[1]));calls.push(numbers);
        if(calls.length===2)throw Error('synthetic summary failure');
        return {text:JSON.stringify({storyEntries:numbers.map(chapterNumber=>({chapterNumber,text:'本章概要'+chapterNumber}))})};
    }};
    await assert.rejects(refreshSeriesStorySummary(options));assert.deepEqual(current.memory.storyEntries.map(e=>e.chapterNumber),[1,2,3]);
    await refreshSeriesStorySummary({...options,record:current});assert.deepEqual(calls,[[1,2,3],[4,5,6],[4,5,6],[7]]);assert.equal(current.memory.summaryNeedsRefresh,false);
});
test('仅补概要停止保留当前批；等待期间改写不覆盖新内容',async()=>{
    const {record}=fixture();record.memory.processedThroughChapter=7;record.memory.pendingChapterNumbers=[];record.memory.status='ready';let current=record,stopped=false,calls=0;
    const request=async({userPrompt})=>{calls++;stopped=true;const numbers=[...userPrompt.matchAll(/第(\d+)章：/g)].map(x=>Number(x[1]));return {text:JSON.stringify({storyEntries:numbers.map(chapterNumber=>({chapterNumber,text:'概要'+chapterNumber}))})}};
    await refreshSeriesStorySummary({record:current,request,readLatest:()=>current,save:async x=>(current=normalizeLongDreamRecord(x)),shouldStop:()=>stopped});
    assert.equal(calls,1);assert.equal(current.memory.storyEntries.length,3);
    stopped=false;let saves=0;const old=current;
    await refreshSeriesStorySummary({record:old,request:async payload=>{const result=await request(payload);current={...old,chapters:old.chapters.map((c,i)=>i===3?{...c,text:'用户新正文'}:c)};return result;},readLatest:()=>current,save:async x=>{saves++;return x;}});
    assert.equal(saves,0);assert.equal(current.chapters[3].text,'用户新正文');
});
test('仅补概要超时中止本批，失败不清空已完成概要',async()=>{
    const {record}=fixture();record.memory.processedThroughChapter=7;record.memory.pendingChapterNumbers=[];record.memory.status='ready';let signal,saves=0;
    await assert.rejects(refreshSeriesStorySummary({record,timeoutMs:5,request:async(_,{signal:s})=>{signal=s;return new Promise(()=>{})},readLatest:()=>record,save:async r=>{saves++;return r;}}));
    assert.equal(signal.aborted,true);assert.equal(saves,0);
});

test('系列补概要开始和结束同步状态按钮，渲染前保留续写输入',async()=>{
    const {record}=fixture();record.memory.processedThroughChapter=7;record.memory.pendingChapterNumbers=[];record.memory.status='ready';let current=record,remembered=0;const rendered=[];
    const runtime={settings:{},longDreamCache:[current],activeLongDreamId:9,refreshingLongDreamSummaries:new Set(),
        selectedLongDreamMemoryApiPreset:()=>({maxOutputTokens:4096}),rememberLongDreamComposerDraft:()=>{remembered++;},renderLongDreamPanel:()=>{rendered.push(runtime.refreshingLongDreamSummaries.has('9'));},runtimeLog(){},
        longDreamPut:async x=>{current=normalizeLongDreamRecord(x);runtime.longDreamCache=[current];return current;}};
    const module=readFileSync(new URL('../long-dream-runtime.js',import.meta.url),'utf8'),start=module.indexOf('// @theater-source-begin refreshLongDreamSummaryNow'),end=module.indexOf('// @theater-source-end refreshLongDreamSummaryNow',start);
    const refresh=runInNewContext(module.slice(start,end)+'\nrefreshLongDreamSummaryNow',{runtime,LONG_DREAM_MEMORY_STATUS,refreshSeriesStorySummary,refreshLongDreamSummary(){throw Error('不得走全篇原子概要路径')},syncLongDreamSummaryButton(){},normalizeMaxTokens,AbortController,setTimeout,clearTimeout,toastr:{info(){},success(){},warning(){}},diagnosticSignalInfo(){return{}},requestCustomApi:async({userPrompt})=>{runtime.settings.longDreamSeriesPausedIds=['9'];const numbers=[...userPrompt.matchAll(/第(\d+)章：/g)].map(x=>Number(x[1]));return{text:JSON.stringify({storyEntries:numbers.map(chapterNumber=>({chapterNumber,text:'概要'+chapterNumber}))})}}});
    await refresh(9,{fillMissing:true});assert.deepEqual(rendered,[true,false]);assert.equal(remembered,2);assert.equal(current.memory.storyEntries.length,3);assert.equal(runtime.refreshingLongDreamSummaries.size,0);
});
