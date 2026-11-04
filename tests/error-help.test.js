import {createTheaterApi} from '../theater-api.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {statusError} from '../api-response.js';
import {classifyRequestFailure,diagnosticSignalInfo} from '../request-diagnostics.js';
import {errorHelpHTML,errorCatalogHTML} from '../error-help-ui.js';
import {estimateTavernTexts,tokenizerForModel} from '../tavern-token-counter.js';
const json=message=>JSON.stringify({error:{message}});
test('HTTP明确原因细分，保留实际HTTP，不泄漏错误原文',()=>{
 for(const [message,signal] of [
  ['Requests ending with a model turn are not supported.','T-API-MESSAGE-END'],
  ['Service account authentication failed: synthetic invalid_grant','T-API-CREDENTIAL-AUTH'],
  ['Unknown name "safety": Cannot find field.','T-API-PARAMETER-UNSUPPORTED'],
  ['Model synthetic not found','T-API-MODEL-UNAVAILABLE'],
  ['Insufficient credits','T-API-CREDIT-EXHAUSTED'],
 ]){
  const error=statusError(400,json(message));assert.equal(error.diagnosticSignal,signal);assert.equal(error.theaterFailure.status,400);
  assert.ok(!JSON.stringify(error).includes(message));
 }
 assert.equal(statusError(200,json('Unknown parameter: fixture')).theaterFailure.status,200);
 assert.equal(statusError(502,'<html>Safety gateway outage</html>').diagnosticSignal,'T-HTTP-502');
 assert.equal(statusError(400,JSON.stringify({echo:{message:'Model synthetic not found'}})).diagnosticSignal,'T-HTTP-400');
 assert.equal(statusError(400,JSON.stringify({error:{code:'content_policy_violation',message:'Your request was rejected as a result of our safety system.'}})).diagnosticSignal,'T-API-CONTENT-FILTER');
});
test('429优先于通用4xx；未知400不推断凭证或末尾问题',()=>{
 assert.match(diagnosticSignalInfo('T-HTTP-429').title,/限流|配额/);
 assert.equal(diagnosticSignalInfo('T-HTTP-429').status,'warn');
 const issue=classifyRequestFailure(statusError(400,json('Bad request')));assert.equal(issue.signal,'T-HTTP-400');
 const html=errorHelpHTML({...issue,stage:'<img src=x onerror=alert(1)>'});assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
 assert.match(errorCatalogHTML(),/data-error-search/);assert.match(html,/查看处理建议/);
});
test('Gemini独立模型显式选酒馆Gemma分词器，不借用当前主模型',async()=>{
 const calls=[];const result=await estimateTavernTexts(['虚构统计一','虚构统计二'],{apiMode:'custom',apiModel:'pg-gemini-4-argon'},{getHeaders:()=>({'Content-Type':'application/json'}),fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({token_count:11}),{headers:{'content-type':'application/json'}})}});
 assert.deepEqual(result.counts,[10,10]);assert.equal(result.source,'酒馆分词估算');assert.equal(result.tokenizer,'gemma');
 assert.ok(calls.every(c=>c.url==='/api/tokenizers/openai/count?model=gemma'&&c.body[0].role==='system'));
 let repeats=0;await estimateTavernTexts(['虚构统计一'],{apiModel:'gemini-4-argon'},{getHeaders:()=>({}),fetchImpl:()=>{repeats++;throw Error('cached')}});assert.equal(repeats,0);
 for(const [model,tokenizer] of [['gpt-4.1','gpt-4o'],['gpt-4.5-preview','gpt-4o'],['claude-fixture','claude'],['qwen-fixture','qwen2'],['deepseek-fixture','deepseek']])assert.equal(tokenizerForModel(model),tokenizer);
});
test('统计不可用明确回退，未知模型不发送外部或本地探测请求',async()=>{
 let calls=0;const options={getHeaders:()=>({}),fetchImpl:async()=>{calls++;return new Response('{}',{status:503})}};
 const unknown=await estimateTavernTexts(['中文'],{apiModel:'unknown-fixture'},options);assert.match(unknown.source,/字符粗估/);assert.equal(calls,0);
 const failed=await estimateTavernTexts(['中文失败统计'],{apiModel:'gemini-4-argon'},options);assert.match(failed.source,/字符粗估/);assert.equal(calls,1);
 assert.deepEqual(await estimateTavernTexts([],{apiModel:'gemini-4-argon'},options),{counts:[],source:'酒馆分词估算',tokenizer:'gemma'});
});

test('主API只读取酒馆分词器名称，绝不调用可能远程计数的host方法',async()=>{
 let remote=0,calls=0;
 const result=await estimateTavernTexts(['主API虚构统计'],{apiMode:'main'},{loadHost:async()=>({getTokenizerModel:()=> 'gemma',getTokenCountAsync:()=>{remote++;throw Error('never call')}}),getHeaders:()=>({}),fetchImpl:async url=>{calls++;assert.equal(url,'/api/tokenizers/openai/count?model=gemma');return new Response(JSON.stringify({token_count:9}))}});
 assert.equal(result.counts[0],8);assert.equal(calls,1);assert.equal(remote,0);
 const unknown=await estimateTavernTexts(['未知主API分词器'],{apiMode:'main'},{loadHost:async()=>({getTokenizerModel:()=> 'api_current'}),fetchImpl:()=>{throw Error('never call')}});
 assert.match(unknown.source,/字符粗估/);
});

test('模型列表自动保存新模型后刷新三处Token显示',async t=>{
 const previous$=globalThis.$,previousToast=globalThis.toastr;
 t.after(()=>{globalThis.$=previous$;globalThis.toastr=previousToast});
 const config={apiChannel:'deepseek',apiUrl:'https://fixture.invalid/v1',apiKey:'synthetic',apiProtocol:'openai',apiModel:'old-fixture'};
 const ui=()=>new Proxy({},{get:()=>()=>ui()});globalThis.$=ui;globalThis.toastr={success(){},warning(){},info(){}};
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({data:[{id:'qwen-fixture'}]})));
 let selected,normal=0,dream=0,world=0;
 const runtime={settings:{...config},readApiFormConfig:()=>config,runtimeLog(){},recordRequestMetrics(){},save(){},theaterError(){},requestFailureMessage(){},scheduleTokenEstimate(){normal++},scheduleLongDreamTokenEstimate(){dream++},updateWBCount(){world++}};
 const api=createTheaterApi(runtime,{presentModelPicker:(_models,options)=>{selected=options.onSelect}});
 await api.fetchModelList();assert.equal(typeof selected,'function');selected('qwen-fixture');assert.equal(runtime.settings.apiModel,'qwen-fixture');assert.deepEqual([normal,dream,world],[1,1,1]);
});
