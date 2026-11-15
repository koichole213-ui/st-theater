// 从 core.test.js 拆出：history-collections
import { remapHistorySource, historyOrder, orderedHistory, collectionPage, historyEntries, normalizeCollections, collectionChapters, moveCollectionItems, continuationHistoryMetadata, planHistorySave, remapHistoryImport } from '../history-collections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { createHistoryArchive, createHistoryJsonBackup, historyItemsFromArchive, normalizeHistoryBackup } from '../history-backup.js';

test('历史搜索只匹配保存名和文件夹名，保留归属与标签交集', () => {
    const items = [{id:1,title:'初遇',html:'隐藏内容'}, {id:2,title:'雨停',tags:['甲']}, {id:3,title:'独立雨停'}];
    const folders = [{id:'f',title:'雨夜系列',itemIds:['1','2']}, {id:'empty',title:'空文件夹',itemIds:[]}];
    const folderMatch = historyEntries(items, folders, {query:'雨夜'});
    assert.equal(folderMatch[0].chapters.length,2);
    const childMatch = historyEntries(items, folders, {query:'雨停'});
    assert.equal(childMatch[0].folder.id,'f'); assert.equal(childMatch[0].chapters.length,1);
    assert.equal(childMatch[1].item.id,3);
    assert.equal(historyEntries(items,folders,{query:'隐藏内容'}).length,0);
    assert.equal(historyEntries(items,folders,{query:'初遇', accepts:i=>i.tags?.includes('甲')}).length,0);
    assert.equal(historyEntries(items,folders,{query:'空文件夹'})[0].count,0);
    assert.equal(collectionPage(Array.from({length:19},(_,i)=>i),1).items.length,8);
    assert.equal(collectionPage(Array.from({length:25},(_,i)=>i),2,10).items.length,5);
});

test('文件夹唯一归属，移动或解散保留所有原稿及同篇版本', () => {
    const items=[{id:'a',chapterId:'A',html:'A'},{id:'b',chapterId:'B',html:'B1'},{id:'c',chapterId:'B',html:'B2'}];
    const folders=normalizeCollections([{id:'f',title:'一',itemIds:['a','b','c','missing']},{id:'g',title:'二',itemIds:['a']}],items);
    assert.deepEqual(folders[1].itemIds,[]);
    assert.equal(collectionChapters(folders[0],items).length,2);
    const moved=moveCollectionItems(folders,['b','c'],'g');
    assert.deepEqual(moved[0].itemIds,['a']); assert.equal(collectionChapters(moved[1],items)[0].length,2);
    assert.equal(historyEntries(items, moved.filter(f=>f.id!=='g')).filter(e=>e.item).length,2);
    assert.deepEqual(items.map(i=>i.html),['A','B1','B2']);
});

test('首次保存续篇保留未存前篇，后续重写同篇，下一篇另分组', () => {
    let n=0; const key=()=>`k${++n}`;
    const original={resultId:'origin',html:'<p>原文</p>',title:'前篇'};
    const metadata=continuationHistoryMetadata(original,key);
    const first=planHistorySave([],[],{html:'<p>续篇一版</p>',title:'续篇'},metadata,key);
    assert.equal(first.items.length,2); assert.equal(first.folders.length,1);
    const second=planHistorySave(first.items,first.folders,{html:'<p>续篇二版</p>',title:'续篇改写'},metadata,key);
    const chapters=collectionChapters(second.folders[0],second.items);
    assert.equal(chapters.length,2); assert.equal(chapters[1].length,2);
    const nextMeta=continuationHistoryMetadata({...second.saved,html:'<p>续篇二版</p>'},key);
    const third=planHistorySave(second.items,second.folders,{html:'下一篇',title:'第三篇'},nextMeta,key);
    assert.equal(collectionChapters(third.folders[0],third.items).length,3);
});

test('移夹后的重写跟随本篇，删除的前篇不会从快照复活', () => {
    let n=0; const key=()=>`k${++n}`;
    const items=[{id:'a',chapterId:'A',title:'A',html:'A'},{id:'b',chapterId:'B',title:'B',html:'B'}];
    const folders=[{id:'f',title:'旧夹',itemIds:['a']},{id:'g',title:'新夹',itemIds:['b']}];
    const saved=planHistorySave(items,folders,{title:'B新版',html:'B2'},{chapterId:'B',parentChapterId:'A'},key);
    assert.equal(saved.folders[0].itemIds.length,1); assert.equal(saved.folders[1].itemIds.length,2);
    const removed=planHistorySave([],[],{title:'续篇',html:'后'},{chapterId:'B',parentChapterId:'A',seriesSources:[items[0]]},key);
    assert.equal(removed.items.length,1); assert.equal(removed.items[0].html,'后');
});

test('系列ZIP和JSON往返保留空夹、篇顺序与版本，导入身份互不混合', () => {
    const items=[{id:'a',chapterId:'A',title:'甲',html:'甲'},{id:'b',chapterId:'B',parentChapterId:'A',title:'乙',html:'乙'},{id:'c',chapterId:'B',title:'乙二版',html:'乙2'}];
    const folders=[{id:'f',title:'同名',itemIds:['b','c','a']},{id:'empty',title:'同名',itemIds:[]}];
    const backup=JSON.parse(JSON.stringify(createHistoryJsonBackup(items,folders)));
    const zip=createHistoryArchive(items,folders);
    assert.deepEqual(zip.manifest.folders,backup.folders);
    assert.deepEqual(historyItemsFromArchive(zip.manifest,zip.files),normalizeHistoryBackup(backup));
    const imported=remapHistoryImport(normalizeHistoryBackup(backup),backup.folders);
    const again=remapHistoryImport(normalizeHistoryBackup(backup),backup.folders);
    assert.equal(imported.items[1].chapterId,imported.items[2].chapterId);
    assert.equal(imported.items[1].parentChapterId,imported.items[0].chapterId);
    assert.notEqual(imported.items[0].chapterId,again.items[0].chapterId);
    assert.notEqual(imported.folders[0].id,again.folders[0].id);
    assert.deepEqual(imported.folders[0].itemIds,['b','c','a']);
    const legacy=remapHistoryImport([{html:'旧一'},{html:'旧二'}],[]);
    assert.notEqual(legacy.items[0].chapterId,legacy.items[1].chapterId);
});

test('回退存档迁移同步普通结果resultId来源，保留版本与前篇关系', () => {
    let n=0; const key=()=>`m${++n}`;
    const old=[{id:1,chapterId:'R',html:'原稿'},{id:2,chapterId:'S',parentChapterId:'R',html:'续篇'}];
    const migrated=remapHistoryImport(old,[],key);
    const mapping=new Map([['1','new1'],['2','new2']]);
    const current=remapHistorySource({resultId:'R',html:'原稿'},migrated.chapterMapping,mapping);
    assert.equal(current.chapterId,migrated.items[0].chapterId);
    const continuation=remapHistorySource({chapterId:'S',parentChapterId:'R',seriesSources:[old[0]]},migrated.chapterMapping,mapping);
    assert.equal(continuation.parentChapterId,current.chapterId);
    assert.equal(continuation.seriesSources[0].id,'new1');
    const items=migrated.items.map((item,index)=>({...item,id:`new${index+1}`}));
    const saved=planHistorySave(items,[],{title:'接着写',html:'正文'},continuationHistoryMetadata(current,key),key);
    assert.equal(saved.items.length,3);
});

test('随机存储主键不改变历史保存顺序', () => {
    const items=[{id:'zzz',historyOrder:3},{id:1},{id:'aaa',historyOrder:2}];
    assert.deepEqual(orderedHistory(items).map(i=>i.id),[1,'aaa','zzz']);
});

test('系列保存事务失败不改缓存，排队写入基于上一笔完成后的状态', async () => {
    const source=readTheaterImplementation();
    const code=['queueHistoryWrite','commitHistoryCollection'].map(name=>source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');
    let fail=true;
    const scope={historyWriteQueue:Promise.resolve(),historyCache:[{id:1,html:'原文'}],historyCollections:[],normalizeCollections,historyOrder,
        idb:{transaction(){ const tx={objectStore:()=>({put(){}})}; return tx; }},
        idbTransactionDone:()=>fail?Promise.reject(Error('模拟额度不足')):Promise.resolve(),
        toastr:{error(){}},settings:{},save(){}};
    runInNewContext(code,scope);
    const add=(items,folders)=>({items:[...items,{id:`new${items.length}`,html:'新'}],folders});
    assert.equal(await scope.commitHistoryCollection(add),false);
    assert.equal(scope.historyCache.length,1);
    fail=false;
    await Promise.all([scope.commitHistoryCollection(add),scope.commitHistoryCollection(add)]);
    assert.equal(scope.historyCache.length,3);
    assert.equal(scope.historyCache[2].historyOrder,3);
});
