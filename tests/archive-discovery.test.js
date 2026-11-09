import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverOldArchives} from '../archive-discovery.js';
import {archiveSearchHTML} from '../archive-discovery-ui.js';
import {BACKUP_TUTORIAL_URL,backupSettingsHTML} from '../backup-ui.js';
import {normalizeBackupData,planBackupRestore} from '../backup-data.js';

const history=(id=1)=>({id,title:'虚构历史 '+id,html:`<p>合成正文 ${id}</p>`,date:'2026-10-28'});
const dream=()=>({id:'d',title:'虚构长梦',createdAt:'2026-10-28T00:00:00.000Z',chapters:[{id:'c',text:'虚构章节',createdAt:'2026-10-28T00:00:00.000Z'}]});
function fixture(entries,listed=Object.keys(entries)){
    const access=[];
    const makeDB=(name,input)=>({name,objectStoreNames:input.names||['history','dreams','kv'],close(){access.push(['close',name]);},transaction(names,mode){
        access.push(['transaction',name,names,mode]);assert.equal(mode,'readonly');
        let pending=0,aborted=false;
        const tx={abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(key){
            return {keyPath:key==='kv'?null:'id',get(subkey){
                assert.equal(key,'kv');assert.equal(subkey,'history-collections');access.push(['get',name,subkey]);
                const req={};pending++;queueMicrotask(()=>{if(aborted)return;req.result=input.folders;req.onsuccess?.();finish();});return req;
            },openCursor(){
                access.push(['cursor',name,key]);const req={};let i=0;pending++;
                const next=()=>queueMicrotask(()=>{if(aborted)return;if(input.fail===key){req.onerror?.();return;}
                    const rows=input[key]||[];req.result=i<rows.length?{value:rows[i++],continue:next}:null;req.onsuccess?.();if(!req.result)finish();
                });next();return req;
            }};
        }};
        const finish=()=>{pending--;if(!pending)queueMicrotask(()=>{if(!aborted)tx.oncomplete?.();});};
        return tx;
    }});
    return {access,factory:{databases:async()=>listed.map(name=>({name,version:2})),open(...args){
        assert.equal(args.length,1,'discovery must not request a database version');
        const name=args[0],input=entries[name],req={};access.push(['open',name]);
        queueMicrotask(()=>{
            if(!input){req.transaction={abort(){access.push(['abort-create',name]);}};req.onupgradeneeded?.();req.onerror?.();return;}
            if(input.blocked){req.onblocked?.();setTimeout(()=>{req.result=makeDB(name,input);req.onsuccess?.();},15);return;}
            req.result=makeDB(name,input);req.onsuccess?.();
        });return req;
    }}};
}

test('手动查找跳过活动库、无关库只查结构，兼容旧库只读历史长梦和文件夹',async()=>{
    const f=fixture({'st-theater':{history:[history(9)]},unrelated:{names:['cookies']},'st-theater-old':{history:[history()],dreams:[dream()],folders:[{id:'f',title:'虚构文件夹',itemIds:['1']}],token:'NEVER_READ'}});
    const result=await discoverOldArchives({factory:f.factory});
    assert.equal(result.status,'complete');assert.equal(result.candidates.length,1);
    const {packet}=result.candidates[0];assert.equal(packet.counts.history,1);assert.equal(packet.counts.dreams,1);assert.equal(packet.data.folders.length,1);
    assert.ok(!JSON.stringify(packet).includes('NEVER_READ'));assert.ok(!f.access.some(x=>x[0]==='open'&&x[1]==='st-theater'));
    assert.ok(!f.access.some(x=>x[0]==='transaction'&&x[1]==='unrelated'));
    assert.equal(f.access.filter(x=>x[0]==='close').length,2);
    const empty=normalizeBackupData({});const plan=await planBackupRestore(empty,packet,['history','dreams'],'1234567890abcdef');
    assert.equal(plan.additions.history.length,1);assert.equal(plan.additions.dreams.length,1);assert.equal(plan.next.folders[0].itemIds[0],plan.next.history[0].id);
    assert.equal((await planBackupRestore(normalizeBackupData(plan.next),packet,['history','dreams'],'1234567890abcdef')).changed,0);
});

test('不限固定库名，兼容结构的旧存档可识别，旧设置也可只读找回',async()=>{
    const f=fixture({renamed:{history:[history(2)]}}),settings={history:[history()],longDreams:[dream()],apiKey:'PRIVATE_SETTING'};
    const before=JSON.stringify(settings);
    const result=await discoverOldArchives({factory:f.factory,settings});
    assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].label,'旧版设置存档');
    assert.equal(JSON.stringify(settings),before);assert.ok(!JSON.stringify(result).includes('PRIVATE_SETTING'));
});

test('只有与当前作品完全相同的旧副本不列为可找回候选',async()=>{
    const f=fixture({'st-theater-old':{history:[history()],dreams:[dream()]}});
    const result=await discoverOldArchives({factory:f.factory,current:{history:[history()],dreams:[dream()]},settings:{history:[history()]}});
    assert.equal(result.candidates.length,0);assert.equal(result.status,'complete');
});

test('枚举后消失的数据库中止创建，部分失败仍保留其他候选',async()=>{
    const f=fixture({'st-theater-old':{history:[history()]}},['vanished','st-theater-old']);
    const result=await discoverOldArchives({factory:f.factory});
    assert.equal(result.status,'partial');assert.equal(result.failed,1);assert.equal(result.candidates.length,1);
    assert.ok(f.access.some(x=>x[0]==='abort-create'&&x[1]==='vanished'));
});

test('被阻塞的打开请求不挂起查找，迟到连接立即关闭',async()=>{
    const f=fixture({blocked:{blocked:true},'st-theater-old':{history:[history()]}});
    const result=await discoverOldArchives({factory:f.factory});assert.equal(result.status,'partial');assert.equal(result.candidates.length,1);
    await new Promise(resolve=>setTimeout(resolve,25));assert.ok(f.access.some(x=>x[0]==='close'&&x[1]==='blocked'));
});

test('取消慢枚举立即结束，不再打开或创建数据库',async()=>{
    const controller=new AbortController();let opened=0,resolve;
    const promise=discoverOldArchives({factory:{databases:()=>new Promise(r=>resolve=r),open(){opened++;}},signal:controller.signal});
    await new Promise(r=>setTimeout(r,0));controller.abort();
    await assert.rejects(promise,{name:'AbortError'});resolve([{name:'late'}]);await new Promise(r=>setTimeout(r,0));assert.equal(opened,0);
});

test('不支持枚举和枚举失败分别明确报告，旧设置候选不会丢弃',async()=>{
    const unsupported=await discoverOldArchives({factory:{},settings:{history:[history()]}});
    assert.equal(unsupported.status,'unsupported');assert.equal(unsupported.candidates.length,1);
    const failure=await discoverOldArchives({factory:{databases(){throw new Error('PRIVATE_PATH');}}});
    assert.equal(failure.status,'failed');assert.ok(!JSON.stringify(failure).includes('PRIVATE_PATH'));
    assert.match(archiveSearchHTML(failure),/查找未完成/);assert.doesNotMatch(archiveSearchHTML(failure),/>未找到可恢复的旧存档</);
});

test('记录/字节/数据库限制提供未完成反馈，不把受限扫描冒称完整空结果',async()=>{
    for(const constraints of [{records:1},{bytes:1},{databases:0}]){
        const f=fixture({'st-theater-old':{history:[history(),history(2)]}});
        const result=await discoverOldArchives({factory:f.factory,constraints});assert.equal(result.status,'partial');assert.equal(result.truncated,true);
        assert.match(archiveSearchHTML(result),/查找未完成/);
    }
});

test('查找候选预览转义作品标题，教程链接为用户提供地址且独立打开',async()=>{
    const result=await discoverOldArchives({factory:{databases:async()=>[]},settings:{history:[{...history(),title:'<img src=x onerror=alert(1)>'}]}});
    const html=archiveSearchHTML(result);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);
    assert.equal(BACKUP_TUTORIAL_URL,'https://docs.google.com/document/d/1wsqCEkfX0gwvds4ajVY9mCsAknUqBnqOWPDxff0Rvss/edit?usp=sharing');
    const settings=backupSettingsHTML();assert.ok(settings.includes('href="'+BACKUP_TUTORIAL_URL.replaceAll('&','&amp;')+'"'));assert.match(settings,/target="_blank" rel="noopener noreferrer"/);assert.doesNotMatch(settings,/图文教程（待接入）/);
});
