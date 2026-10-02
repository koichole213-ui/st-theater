import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHistoryRoles, normalizeRoleSources, matchesRoleFilter, historyRoleOptions, ROLE_UNASSIGNED } from '../history-roles.js';
import { continuationHistoryMetadata, planHistorySave, remapHistoryImport, historyEntries } from '../history-collections.js';
import { createHistoryJsonBackup, normalizeHistoryBackup, createHistoryArchive, historyItemsFromArchive } from '../history-backup.js';
import { createTheaterHistory } from '../theater-history.js';
import { createLongDreamWorkspace } from '../long-dream-workspace.js';
import { itemTags, matchesTagFilter } from '../tag-system.js';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';

const cards = [{ name:'司洛',avatar:'s.png' }, {name:'司洛',avatar:'s2.png'}, {name:'闻舟',avatar:'w.png'}];
const roles = captureHistoryRoles({characters:cards,characterId:0});
test('来源卡以卡文件识别；同名、群聊、停用成员和无卡不会误并或误指定', () => {
    assert.equal(roles[0].id,'card:s.png');
    assert.notEqual(captureHistoryRoles({characters:cards,characterId:1})[0].id,roles[0].id);
    assert.deepEqual(captureHistoryRoles({characters:cards,groupId:7,groups:[{id:'7',members:['s.png','w.png','s2.png'],disabled_members:['s2.png']}]}).map(role=>role.id),['card:s.png','card:w.png']);
    assert.deepEqual(captureHistoryRoles({characters:cards,groupId:7,characterId:0}),[]);
    assert.deepEqual(captureHistoryRoles({characters:cards}),[]);
    assert.deepEqual(normalizeRoleSources([null,roles[0],roles[0]]),roles);
});
test('切卡后保存与续写继承原来源；新旧 JSON/ZIP 往返不丢角色、标签、正文和收纳', () => {
    let key=0; const make=()=>`key-${++key}`;
    const source={html:'<p>原文</p>',resultId:'result',roleSources:roles,tags:['司洛']};
    const metadata=continuationHistoryMetadata(source,make);
    assert.deepEqual(metadata.roleSources,roles);
    assert.deepEqual(continuationHistoryMetadata({html:'旧稿'},make).roleSources,[]);
    const saved=planHistorySave([],[],{html:'<p>续写</p>',title:'续写',roleSources:metadata.roleSources,tags:['司洛']},metadata,make);
    assert.equal(saved.items.length,2);
    assert.deepEqual(saved.items[0].roleSources,roles);
    assert.deepEqual(saved.saved.roleSources,roles);
    const copy=normalizeHistoryBackup(JSON.parse(JSON.stringify(createHistoryJsonBackup(saved.items,saved.folders))));
    const archive=createHistoryArchive(copy,saved.folders);
    const restored=historyItemsFromArchive(JSON.parse(JSON.stringify(archive.manifest)),archive.files);
    assert.deepEqual(restored.map(item=>item.roleSources),[roles,roles]);
    assert.deepEqual(restored.map(item=>item.tags),[['司洛'],['司洛']]);
    assert.equal(restored[1].html,'<p>续写</p>');
    assert.deepEqual(remapHistoryImport(restored,saved.folders,make).items[0].roleSources,roles);
    assert.deepEqual(normalizeHistoryBackup([{html:'旧稿',tags:['司洛']}])[0].roleSources,[]);
});
test('角色筛选与标签同时匹配，旧稿未指定，改名删除后来源仍可找到', () => {
    const items=[{id:'1',title:'甲',roleSources:roles,tags:['司洛','甜饼']},{id:'2',title:'乙',tags:['司洛']},{id:'3',title:'丙',roleSources:captureHistoryRoles({characters:cards,characterId:2}),tags:['司洛']}];
    const accepts=item=>matchesRoleFilter(item,'card:s.png')&&matchesTagFilter(item,['司洛','甜饼'],['司洛','甜饼']);
    assert.deepEqual(historyEntries(items,[],{accepts}).map(entry=>entry.item.id),['1']);
    assert.equal(matchesRoleFilter(items[1],ROLE_UNASSIGNED),true);
    assert.equal(matchesRoleFilter(items[0],ROLE_UNASSIGNED),false);
    const renamed=historyRoleOptions(items,[{name:'新名字',avatar:'s.png'}]);
    assert.match(renamed.find(role=>role.id==='card:s.png').label,/原名 司洛/);
    assert.match(historyRoleOptions(items,[])[0].label,/已留存来源/);
    assert.match(historyRoleOptions([],cards)[0].label,/s.png/);
});
test('真实生成入口在异步准备前冻结角色来源，自动与普通续写分别继承正确来源', async () => {
    const source=readTheaterImplementation();
    const start=source.indexOf('async function runGeneration('), end=source.indexOf('    const plannedTargetWordCount',start);
    const capture=source.slice(start,end)+'\nreturn generationRoles;\n}';
    for (const isAuto of [false,true]) {
        const ctx={characters:cards,characterId:0};
        const scope={isGenerating:false,isPreparingGeneration:false,resultEditSnapshot:null,continueContext:'前情',continuationSession:{historyMetadata:{roleSources:[{id:'card:w.png',name:'闻舟',avatar:'w.png'}]}},SillyTavern:{getContext:()=>ctx}};
        const run=runInNewContext(`(${capture})`,scope);
        const captured=await run('',isAuto,[]);
        ctx.characterId=1;
        assert.equal(captured[0].id,isAuto?'card:s.png':'card:w.png');
    }
});
test('角色批量写入失败不会提前改缓存；并发改标签后再确认角色保留最新字段', async t => {
    const old=globalThis.SillyTavern;
    globalThis.SillyTavern={getContext:()=>({characters:cards})};
    t.after(()=>{globalThis.SillyTavern=old;});
    const initial={id:'1',title:'旧名',html:'<p>正文</p>',tags:['旧标签']};
    // Execute the actual commit method against a failing synthetic transaction.
    const runtime={historyCache:[initial],historyCollections:[],historyWriteQueue:Promise.resolve(),queueHistoryWrite:fn=>fn(),idb:{transaction(){throw Error('合成存储失败');}},settings:{},save(){},idbTransactionDone(){}};
    const oldToast=globalThis.toastr; globalThis.toastr={error(){}}; t.after(()=>{globalThis.toastr=oldToast;});
    const feature=createTheaterHistory(runtime);
    const ok=await feature.commitHistoryCollection((items,folders)=>({items:items.map(item=>({...item,roleSources:roles})),folders}));
    assert.equal(ok,false); assert.equal(runtime.historyCache[0],initial); assert.equal(initial.roleSources,undefined);
    runtime.idb=null;
    runtime.historyCache=[{...initial,title:'新名',tags:['新标签']}];
    assert.equal(await feature.commitHistoryCollection((items,folders)=>({items:items.map(item=>({...item,roleSources:roles})),folders})),true);
    assert.equal(runtime.historyCache[0].title,'新名'); assert.deepEqual(runtime.historyCache[0].tags,['新标签']);
});
test('真实紧凑卡片仍有阅读、续写、标签、角色、导出、移动和删除入口且转义内容', () => {
    const runtime={histSelected:new Set(),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),knownInstructionTags:()=>['司洛'],historyCache:[]};
    const html=createLongDreamWorkspace(runtime).historyItemHTML({id:'uuid',title:'<危险标题>',date:'日期',tags:['司洛'],roleSources:roles});
    for(const name of ['view','continue','tags-edit','roles-edit','export','move','delete']) assert.ok(html.includes(`theater-history-${name}`));
    assert.ok(html.includes('theater-history-info-trigger')); assert.ok(html.includes('data-history-menu-content hidden'));
    assert.ok(!html.includes('<危险标题>'));
});

test('最后一个来源消失后筛选回全部，界面选择与真实结果保持一致', t => {
    const previous=globalThis.SillyTavern; globalThis.SillyTavern={getContext:()=>({characters:[]})};
    t.after(()=>{globalThis.SillyTavern=previous;});
    const runtime={historyCache:[{id:'1',title:'旧稿',tags:[]}],historyRoleFilter:'card:deleted.png',histPage:3,histSelected:new Set(['1']),esc:v=>String(v),settings:{historyTagFilter:[]},knownInstructionTags:()=>[]};
    const feature=createTheaterHistory(runtime); const html=feature.historyRoleFilterHTML();
    assert.equal(runtime.historyRoleFilter,''); assert.equal(runtime.histPage,0); assert.equal(runtime.histSelected.size,0);
    assert.ok(html.includes('value="" selected')); assert.equal(feature.filterHistoryAll().length,1);
});
