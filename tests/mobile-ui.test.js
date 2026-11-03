import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readTheaterImplementation,runInNewContext} from './theater-source.js';
import {createLongDreamRecord,saveLongDreamDraft,normalizeLongDreamRecord,updateLongDreamDefinition,LONG_DREAM_DRAFT_STATUS,LONG_DREAM_WORLD_LINE_RELATION,LONG_DREAM_WORLD_BOOK_POLICY} from '../long-dream.js';

function review(){const base=createLongDreamRecord({canon:'旧定梦',source:{text:'首章正文',html:'<p>首章正文</p>'}});return {...saveLongDreamDraft(base,{status:'review',instruction:'原续写要求',title:'第二章',targetChars:8000,candidates:[1,2].map(n=>({text:'旧候选'+n,html:'<p>旧候选'+n+'</p>',instruction:'旧要求',retained:n===1,versionNumber:n})),selectedCandidateIndex:1}),id:7}}
function harness({fail=false,busy=false,preparing=false,changed=false}={}){
 const source=readTheaterImplementation(),start=source.indexOf("$d.off('click.tdsave')"),end=source.indexOf("$d.off('click.tddelete')",start);
 let handler,writes=0;const before=review(),notices=[];
 const scope={activeLongDreamId:7,longDreamCache:[before],longDreamCandidateSavePending:busy,isPreparingGeneration:preparing,
  refreshingLongDreamWorldBookId:null,activeLongDreamGenerationId:null,longDreamGenerationController:null,longDreamChapterEditController:null,
  LONG_DREAM_DRAFT_STATUS,LONG_DREAM_WORLD_LINE_RELATION,LONG_DREAM_WORLD_BOOK_POLICY,updateLongDreamDefinition,
  settings:{},renderLongDreamPanel(){},longDreamPut:async value=>{writes++;if(fail)return false;scope.longDreamCache=[normalizeLongDreamRecord(value)];return scope.longDreamCache[0]},
  toastr:Object.fromEntries(['info','warning','success'].map(k=>[k,text=>notices.push({k,text})])),
  $:selector=>({val:()=>{if(changed&&selector.includes('relation'))scope.longDreamCache=[{...before,canon:'并发修改'}];return selector.includes('relation')?'isolated':selector.includes('title')?'新长卷名':'新定梦'}}),
  $d:{off(){return this},on(event,selector,callback){handler=callback;return this}}
 };
 runInNewContext(source.slice(start,end),scope);return {scope,before,notices,run:()=>handler(),writes:()=>writes};
}
test('待确认时直接保存定梦，旧候选正文/HTML/版本/当前选择与正式章节完整保留',async()=>{
 const h=harness(),before=JSON.stringify(h.before),candidates=h.before.draft.candidates;
 await h.run();assert.equal(h.writes(),1);const saved=h.scope.longDreamCache[0];
 assert.equal(saved.canon,'新定梦');assert.equal(saved.title,'新长卷名');assert.equal(saved.draft.status,'review');assert.equal(saved.draft.selectedCandidateIndex,h.before.draft.selectedCandidateIndex);
 assert.deepEqual(saved.chapters,h.before.chapters);assert.equal(saved.draft.candidates.length,candidates.length);
 saved.draft.candidates.forEach((candidate,i)=>{assert.equal(candidate.text,candidates[i].text);assert.equal(candidate.html,candidates[i].html);assert.equal(candidate.versionNumber,candidates[i].versionNumber);assert.equal(candidate.retained,true)});
 assert.equal(JSON.stringify(h.before),before);assert.notEqual(h.scope.longDreamCandidateSavePending,true);
});
test('直接定梦保存失败不改现有候选/设定，锁定和准备生成期间不写入',async()=>{
 for(const options of [{fail:true},{busy:true},{preparing:true},{changed:true}]){const h=harness(options),before=JSON.stringify(h.before);await h.run();assert.equal(h.writes(),options.fail?1:0);assert.equal(JSON.stringify(h.before),before);if(!options.changed)assert.equal(h.scope.longDreamCache[0].canon,'旧定梦')}
});
test('待确认页移除退出按钮，但旧候选暂停/备份辅助函数仍保留兼容',()=>{
 const source=readFileSync(new URL('../long-dream-workspace.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/id="theater-dream-exit-review"/);
 assert.match(readFileSync(new URL('../long-dream.js',import.meta.url),'utf8'),/export function pauseLongDreamReview/);
});
