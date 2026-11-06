import test from 'node:test';
import assert from 'node:assert/strict';
import { backupFileMetadata, createBackupImportTrace } from '../backup-import-diagnostics.js';

test('导入诊断只记录固定阶段及数量，不携带文件名、正文或额外字段',()=>{
    const logs=[],progress=[];
    const trace=createBackupImportTrace({runtimeLog:(...args)=>logs.push(args)},{scope:'dreams',source:'local',onProgress:text=>progress.push(text)});
    trace.step('selected',{...backupFileMetadata([{name:'PRIVATE_STORY.zip',size:512}]),token:'NEVER_LOG_SECRET',content:'NEVER_LOG_STORY'});
    trace.step('zipRead');trace.fail();trace.step('preview');
    const output=JSON.stringify(logs);
    assert(!/PRIVATE_STORY|NEVER_LOG/.test(output));
    assert.equal(logs[0][2].format,'zip');assert.equal(logs[0][2].bytes,512);
    assert.equal(logs.at(-1)[2].status,'失败');assert.equal(logs.at(-1)[2].stage,'zipRead');
    assert.equal(progress.at(-1),'');
});
test('等待提醒不终止读取，随后完成后不再产生告警',async()=>{
    const logs=[];const trace=createBackupImportTrace({runtimeLog:(...args)=>logs.push(args)},{waitMs:5});
    trace.step('preview');await new Promise(resolve=>setTimeout(resolve,20));
    assert(logs.some(entry=>entry[2].status==='仍在等待'));
    trace.finish();const count=logs.length;await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(logs.length,count);assert.equal(logs.at(-1)[2].status,'完成');
});
test('关窗或改选后取消旧诊断，不让旧进度与告警继续出现',async()=>{
    const logs=[],progress=[];const trace=createBackupImportTrace({runtimeLog:(...args)=>logs.push(args)},{onProgress:text=>progress.push(text),waitMs:5});
    trace.step('zipRead');trace.cancel();const count=logs.length;
    trace.step('preview');trace.finish();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(logs.length,count);assert.equal(logs.at(-1)[2].status,'已取消');assert.equal(progress.length,1);
});
