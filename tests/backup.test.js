import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashBytes } from '../backup-hash.js';
import { createCompleteBackup, parseCompleteBackup, normalizeBackupData, planBackupRestore, backupCounts, backupProtection, digest } from '../backup-data.js';
import { createGithubBackupClient, bytesToBase64, validateBackupRepository } from '../backup-github.js';
import { planHistorySave, continuationHistoryMetadata } from '../history-collections.js';
const sourceId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const localId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const date='2026-11-06T01:00:00.000Z';
const work=n=>({id:String(n),chapterId:`chapter-${n}`,title:`作品${n}`,date,html:`<p>合成作品 ${n}</p>`,mode:'html'});
const candidate=(n,extra={})=>({text:`候选 ${n}`,html:`<p>候选 ${n}</p>`,createdAt:date,...extra});
const dream=()=>({id:1,title:'合成长梦',createdAt:date,updatedAt:date,chapters:[{id:'ch1',text:'第一章',html:'<p>第一章</p>',createdAt:date,retainedVersions:[candidate(8,{retained:true}),candidate(9)]}],draft:{status:'review',selectedCandidateIndex:1,candidates:[candidate(1),candidate(2),candidate(3,{retained:true}),candidate(4,{deleted:true}),candidate(5,{error:'synthetic'}),{text:'',html:''}],updatedAt:date}});
const packet=data=>createCompleteBackup(data,{sourceId,deviceName:'测试手机',now:new Date(date)});

test('普通HTTP酒馆可用的SHA散列与原生结果一致，包括边界长度和Unicode',()=>{
 for(const algorithm of ['SHA-256','SHA-1'])for(const input of ['', 'abc', '合成候选🌙', 'x'.repeat(55),'x'.repeat(56),'x'.repeat(64),'x'.repeat(10000)]){
  const bytes=new TextEncoder().encode(input);assert.equal(hashBytes(bytes,algorithm),createHash(algorithm.replace('-','').toLowerCase()).update(bytes).digest('hex'));
 }
});
test('完整备份保留当前有效候选、明确保留版本与待选择状态，排除空/丢弃/报错候选',async()=>{
 const original=dream(),p=await packet({dreams:[original],instructions:[{name:'指令',content:'合成指令'}],apiKey:'NEVER_EXPORT',token:'NEVER_EXPORT'});
 assert.equal(p.counts.candidates,3);assert.equal(p.counts.retained,1);assert.equal(p.counts.chapters,1);
 const parsed=await parseCompleteBackup(JSON.parse(JSON.stringify(p)));
 assert.equal(parsed.data.dreams[0].draft.status,'review');assert.equal(parsed.data.dreams[0].draft.candidates.length,3);assert.equal(parsed.data.dreams[0].draft.selectedCandidateIndex,1);
 assert.equal(parsed.data.dreams[0].chapters[0].retainedVersions.length,1);assert.equal(original.draft.candidates.length,6);
 assert(!JSON.stringify(p).includes('NEVER_EXPORT'));
 const changed=structuredClone(p);changed.data.dreams[0].title='modified';await assert.rejects(parseCompleteBackup(changed),/校验失败/);
});
test('1–5与备份1–7只补6、7，重复导入不再多一套且文件夹关联不重复',async()=>{
 const current=normalizeBackupData({history:[1,2,3,4,5].map(work),folders:[{id:'f',title:'系列',itemIds:['1','2','3','4','5']}]});
 const p=await packet({history:[1,2,3,4,5,6,7].map(work),folders:[{id:'f',title:'系列',itemIds:['1','2','3','4','5','6','7']}]});
 const plan=await planBackupRestore(current,p,['history'],sourceId);
 assert.deepEqual(plan.stats.history,{added:2,same:5,different:0});assert.equal(plan.next.history.length,7);assert.equal(plan.next.folders.length,1);assert.equal(plan.next.folders[0].itemIds.length,7);
 const again=await planBackupRestore(plan.next,p,['history'],sourceId);assert.deepEqual(again.stats.history,{added:0,same:7,different:0});assert.equal(again.changed,0);assert.equal(again.next.folders.length,1);
 assert.equal(current.history.length,5);
});
test('同一来源的不同正文另存，同名不同来源不会错合并，重复恢复仍跳过',async()=>{
 const current=normalizeBackupData({history:[work(1)]}), changed={...work(1),html:'<p>另一个版本</p>'};
 const p=await packet({history:[changed]});const plan=await planBackupRestore(current,p,['history'],sourceId);
 assert.deepEqual(plan.stats.history,{added:0,same:0,different:1});assert.equal(plan.next.history[0].html,work(1).html);assert.equal(plan.next.history[1].chapterId,plan.next.history[0].chapterId);
 const again=await planBackupRestore(normalizeBackupData(plan.next),p,['history'],sourceId);assert.equal(again.changed,0);
 const foreign=await planBackupRestore(current,p,['history'],localId);assert.equal(foreign.stats.history.added,1);assert.notEqual(foreign.next.history[1].chapterId,current.history[0].chapterId);
});
test('四类恢复按选择隔离，当前结果只恢复副本，重复恢复不挤掉新作品',async()=>{
 const current=normalizeBackupData({current:{title:'当前',html:'<p>新的内容</p>'},dreams:[dream()]}), p=await packet({history:[work(1)],instructions:[{name:'A',content:'合成指令'}],current:{title:'旧的结果',html:'<p>备份内容</p>'},dreams:[dream()]});
 const instructions=await planBackupRestore(current,p,['instructions'],localId);assert.equal(instructions.next.instructions.length,1);assert.equal(instructions.next.history.length,0);assert.equal(instructions.next.recovered.length,0);
 const recent=await planBackupRestore(current,p,['recent'],localId);assert.equal(recent.next.current.html,current.current.html);assert.equal(recent.next.recovered.length,1);assert.equal(recent.next.recent.length,0);assert.equal((await planBackupRestore(recent.next,p,['recent'],localId)).changed,0);
 const dreams=await planBackupRestore(normalizeBackupData({}),p,['dreams'],localId);assert.equal(dreams.next.dreams[0].draft.status,'review');assert.equal((await planBackupRestore(normalizeBackupData(dreams.next),p,['dreams'],localId)).changed,0);
});
test('读取错误由存储层阻止，数量归零或骤减保护已有备份，小量正常删除不过度拦截',()=>{
 assert.deepEqual(backupProtection({history:7},{history:0}),['history']);assert.deepEqual(backupProtection({history:128},{history:7}),['history']);assert.deepEqual(backupProtection({history:7},{history:5}),[]);
 assert.deepEqual(backupProtection({dreams:1,chapters:100,retained:20},{dreams:1,chapters:1,retained:0}),['chapters','retained']);
 assert.deepEqual(backupProtection({chapters:2,candidates:3,drafts:1},{chapters:2,candidates:0,drafts:0}),['candidates','drafts']);
 assert.deepEqual(backupProtection({chapters:2,candidates:3,drafts:1},{chapters:3,candidates:0,drafts:0}),[]);
});
test('仅恢复长梦也能关联已存在的同源历史与文件夹，不额外导入历史',async()=>{
 const source=dream();source.source={kind:'history',refId:'1'};
 const p=await packet({history:[work(1)],dreams:[source]});const current=normalizeBackupData({history:[work(1)]});
 const plan=await planBackupRestore(current,p,['dreams'],sourceId);assert.equal(plan.additions.history.length,0);assert.equal(plan.next.dreams[0].source.refId,'1');
 source.source={kind:'history-folder',refId:'f'};const withFolder=await packet({history:[work(1)],folders:[{id:'f',title:'系列',itemIds:['1']}],dreams:[source]});
 current.folders=[{id:'f',title:'系列',itemIds:['1']}];assert.equal((await planBackupRestore(current,withFolder,['dreams'],sourceId)).next.dreams[0].source.refId,'f');
});
test('跨设备重新备份后恢复缺失篇目沿原文件夹补回，不再创建同名文件夹',async()=>{
 const original=await packet({history:[1,2].map(work),folders:[{id:'f',title:'系列',itemIds:['1','2']}]});
 const deviceB=await planBackupRestore(normalizeBackupData({}),original,['history'],localId);
 const fromB=await createCompleteBackup(deviceB.next,{sourceId:localId});
 const currentA=normalizeBackupData({history:[work(1)],folders:[{id:'f',title:'系列',itemIds:['1']}]});
 const restored=await planBackupRestore(currentA,fromB,['history'],sourceId);
 assert.equal(restored.next.history.length,2);assert.equal(restored.next.folders.length,1);assert.equal(restored.next.folders[0].itemIds.length,2);
});
test('仅保存目标字数的长梦输入草稿也完整往返，历史顺序保留',async()=>{
 const source=dream();source.composerDraft={targetChars:15000};
 const p=await packet({dreams:[source],history:[{...work(1),historyOrder:40},{...work(2),historyOrder:50}]});
 const parsed=await parseCompleteBackup(p);assert.equal(parsed.data.dreams[0].composerDraft.targetChars,15000);assert.equal(parsed.data.history[0].historyOrder,40);
 const plan=await planBackupRestore(parsed.data,await packet({history:[{...work(3),historyOrder:60}]}),['history'],sourceId);assert.equal(plan.additions.history[0].historyOrder,51);
});
test('全部候选已删除或报错时，review镜像正文不会被当作旧候选复活',async()=>{
 for(const flag of [{deleted:true},{error:'synthetic'}]){
  const d=dream(),invalid=candidate(99,flag);d.draft={status:'review',text:invalid.text,html:invalid.html,candidates:[invalid],updatedAt:date};
  const p=await packet({dreams:[d]});assert.equal(p.counts.candidates,0);assert(!JSON.stringify(p).includes('候选 99'));
 }
});
test('当前结果保留六篇未存历史的完整续写链和time，恢复副本后仍能一次存齐系列',async()=>{
 let result={title:'第一篇',resultId:'result-1',html:'<p>仅第一篇存在的独特正文</p>',time:date,mode:'html'};
 for(let n=2;n<=6;n++)result={...continuationHistoryMetadata(result,()=>`chapter-${n}`),title:`第${n}篇`,resultId:`result-${n}`,html:`<p>第${n}篇的合成正文</p>`,time:date,mode:'html'};
 assert.equal(result.seriesSources.length,5);
 const p=await packet({current:result});assert(JSON.stringify(p).includes('仅第一篇存在的独特正文'));assert.equal(p.data.current.time,date);
 const restored=await planBackupRestore(normalizeBackupData({}),await parseCompleteBackup(p),['recent'],localId);
 const recovered=restored.next.recovered[0];let id=0;const saved=planHistorySave([],[],{html:recovered.html,title:recovered.title,date},recovered,()=>String(++id));
 assert.equal(saved.items.length,6);assert.equal(saved.folders[0].itemIds.length,6);assert.equal(saved.items[0].html,'<p>仅第一篇存在的独特正文</p>');
 assert.equal((await planBackupRestore(normalizeBackupData(restored.next),p,['recent'],localId)).changed,0);
});
test('跨多文件恢复隔离身份又能按完整内容跳过相同记录',async()=>{
 const p=await packet({history:[work(1),work(2)]});const other=await createCompleteBackup({history:[work(2),work(3)]},{sourceId:localId});
 const plan=await planBackupRestore(normalizeBackupData({}),{packets:[p,other],counts:{}},['history'],sourceId);
 assert.equal(plan.next.history.length,3);assert.equal(plan.stats.history.added,3);assert.equal(plan.stats.history.same,1);
});
test('GitHub权限/仓库验证与错误脱敏，不把响应错误正文带进诊断',async()=>{
 assert.throws(()=>validateBackupRepository('../repo'));assert.throws(()=>validateBackupRepository('user/repo?token=SECRET'));
 let calls=[];const client=createGithubBackupClient({repository:'user/backup',token:'synthetic-secret'},{request:async(url,options)=>{calls.push({url,options});return new Response('private response NEVER_LOG',{status:401});}});
 await assert.rejects(client.test(),e=>e.message.includes('401')&&!e.message.includes('NEVER_LOG'));
 assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert(!calls[0].url.includes('synthetic-secret'));
});
test('GitHub上传校验git blob标识，下载按不可变SHA并拒绝错误内容',async()=>{
 const bytes=new TextEncoder().encode('synthetic zip bytes'), header=new TextEncoder().encode(`blob ${bytes.length}\0`),blob=new Uint8Array(header.length+bytes.length);blob.set(header);blob.set(bytes,header.length);const sha=await digest(blob,'SHA-1');
 let writes=0;
 const client=createGithubBackupClient({repository:'user/backup',token:'synthetic-only'}, {request:async(url,options)=>{
  if(options.method==='PUT'){writes++;const body=JSON.parse(options.body);assert.equal(body.content,bytesToBase64(bytes));return Response.json({commit:{sha:'f'.repeat(40)},content:{sha}});}
  if(url.includes('/git/blobs/'))return new Response(bytes);
  return Response.json({private:true,default_branch:'main'});
 }});
 const saved=await client.upload(bytes,{sourceId,deviceName:'手机',counts:{history:7,dreams:1,instructions:2},timestamp:1793926800000});assert.equal(writes,1);assert.equal(saved.sha,sha);
 const downloaded=await client.download({path:saved.path,sha});assert.deepEqual(downloaded,bytes);
 await assert.rejects(client.download({path:'../other',sha}),/路径/);
 const publicRepo=createGithubBackupClient({repository:'user/backup',token:'synthetic-only'},{request:async()=>Response.json({private:false})});await assert.rejects(publicRepo.test(),/私有/);
});
test('GitHub失败或树截断不冒充空备份列表',async()=>{
 const client=createGithubBackupClient({repository:'user/backup',token:'test'}, {request:async url=>Response.json(url.includes('/git/trees/')?{truncated:true,tree:[]}:{private:true,default_branch:'main',size:10})});await assert.rejects(client.list(),/不完整/);
});
