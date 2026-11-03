import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {API_CHANNELS,captureIndependentConfig,channelConfigError,channelBaseUrl} from '../api-channels.js';
import {buildApiEndpoint} from '../api-client.js';
import {normalizeApiPreset,createApiPresetFromConfig} from '../api-presets.js';
import {captureLayoutApiSelection} from '../layout-api.js';
import {requestCustomApi} from '../api-runtime.js';
import {createIndependentRequest} from '../independent-request.js';
import {activeVertexCredential,validateVertexJson,importVertexCredential,beginVertexRequest,VERTEX_SECRET_KEY} from '../vertex-credentials.js';
import {createTheaterApi} from '../theater-api.js';

const headers=()=>({'Content-Type':'application/json','X-CSRF-Token':'synthetic-csrf'});
const vertex={apiChannel:'vertex',apiModel:'gemini-2.5-pro',vertexLocation:'global',vertexCredentialId:'fixture-credential',vertexProjectId:'fixture-project',maxOutputTokens:8192};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const state=(id=vertex.vertexCredentialId)=>json({[VERTEX_SECRET_KEY]:[{id,active:true,value:'masked-not-returned'}]});
const payload={choices:[{message:{content:'合成正文'},finish_reason:'stop'}]};
let syntheticJson;
function credential(){
 if(!syntheticJson){const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});syntheticJson=JSON.stringify({type:'service_account',project_id:'fixture-project',client_email:'fixture@fixture-project.iam.gserviceaccount.com',private_key:privateKey.export({format:'pem',type:'pkcs8'}),untrusted:'never-forward',token_uri:'https://example.invalid/untrusted'});}
 return syntheticJson;
}
test('v3/v4/base/full endpoint拼接兼容，旧根地址仍补v1',()=>{
 for(const base of ['https://open.bigmodel.cn/api/paas/v4','https://ark.cn-beijing.volces.com/api/v3','https://api.example/v1beta1']) assert.equal(buildApiEndpoint(base,'openai'),base+'/chat/completions');
 assert.equal(buildApiEndpoint('https://api.example','openai'),'https://api.example/v1/chat/completions');
 assert.equal(buildApiEndpoint('https://api.example/v4/chat/completions','openai'),'https://api.example/v4/chat/completions');
 assert.equal(buildApiEndpoint('https://api.example/v1/messages','anthropic'),'https://api.example/v1/messages');
});
test('旧预设不猜渠道、不丢字段，新渠道字段仅白名单保存',()=>{
 const legacy={id:'old',name:'旧线路',apiUrl:'https://custom.invalid/v1',apiKey:'fixture',apiModel:'fixture',apiProtocol:'anthropic',maxOutputTokens:8192};
 assert.deepEqual(normalizeApiPreset(legacy),legacy);
 const saved=createApiPresetFromConfig('Vertex',{...vertex,apiUrl:API_CHANNELS.vertex.url,apiKey:'never-copy',private_key:'never-store',credentials:{private_key:'never-store'}},'v');
 assert.equal(saved.apiChannel,'vertex');assert.equal(saved.apiKey,'');assert.equal(saved.vertexCredentialId,vertex.vertexCredentialId);
 assert.doesNotMatch(JSON.stringify(saved),/never-copy|never-store/);
 assert.equal(normalizeApiPreset({...legacy,apiChannel:'unknown'}).apiChannel,undefined);
});
test('普通渠道共享真实请求构造、原样输出上限且不继承采样',async()=>{
 for(const channel of ['glm','volc','deepseek','qwen','kimi','silicon','router']){
  const request=await createIndependentRequest({apiChannel:channel,apiUrl:API_CHANNELS[channel].url||'https://example.invalid/compatible-mode/v1',apiKey:'fixture-key',apiModel:'fixture-model'},
   {messages:[{role:'system',content:'设定'},{role:'user',content:'故事'}],maxTokens:32768,stream:true});
  assert.match(request.endpoint,/\/chat\/completions$/);assert.doesNotMatch(request.endpoint,/v[34]\/v1/);assert.equal(request.body.max_tokens,32768);
  assert.equal(request.headers.Authorization,'Bearer fixture-key');assert.equal('temperature' in request.body,false);assert.equal('thinking' in request.body,false);
 }
});
test('GLM/火山套餐预设贯穿正文、排版和副API，使用所选地址而非切按量',async()=>{
 for(const apiChannel of ['glm','volc']){
  const apiUrl=channelBaseUrl(apiChannel,'coding');
  const config={apiChannel,apiPlan:'coding',apiUrl,apiKey:'fixture-key',apiModel:'fixture-model',maxOutputTokens:8192};
  const preset=createApiPresetFromConfig('套餐',config,'plan');
  assert.equal(normalizeApiPreset(preset).apiPlan,'coding');assert.equal(preset.apiUrl,apiUrl);
  const settings={...config,apiMode:'custom',layoutApiEnabled:true,layoutApiPresetId:'plan',apiPresets:[preset]};
  const {captureGenerationApiRoute}=createTheaterApi({settings});
  const routes=[captureGenerationApiRoute({}).custom,captureLayoutApiSelection(settings).custom,preset];
  for(const [index,route] of routes.entries())for(const shouldStream of [false,true]){
   const calls=[],userPrompt=['合成正文','合成排版','合成梦脉概要'][index];
   const result=await requestCustomApi({config:route,userPrompt,shouldStream,fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return json(payload)}});
   assert.equal(result.text,'合成正文');assert.equal(calls.length,1);
   assert.equal(calls[0].url,apiUrl+'/chat/completions');assert.equal(calls[0].body.model,'fixture-model');
   assert.equal(calls[0].body.stream,shouldStream);assert.ok(calls[0].body.messages.some(m=>m.content===userPrompt));
   assert.equal(route.apiPlan,'coding');assert.equal(route.apiUrl,apiUrl);
  }
 }
});

test('套餐请求失败不自动切按量，地址和模型校验沿用普通渠道',async()=>{
 for(const apiChannel of ['glm','volc']){
  const config={apiChannel,apiPlan:'coding',apiUrl:channelBaseUrl(apiChannel,'coding'),apiModel:'fixture'};
  assert.ok(channelConfigError({...config,apiUrl:'invalid'}));assert.ok(channelConfigError({...config,apiModel:''}));
  const calls=[];await assert.rejects(requestCustomApi({config,shouldStream:false,userPrompt:'合成概要',fetchImpl:async url=>{calls.push(url);return json({error:{message:'fixture failure'}},503)}}));
  assert.deepEqual(calls,[config.apiUrl+'/chat/completions']);
 }
});

test('Vertex项目随后端凭证读取，非法地区/非Gemini不能发送',()=>{
 assert.equal(channelConfigError(vertex),'');assert.equal(channelConfigError({...vertex,vertexProjectId:''}),'');
 for(const config of [{...vertex,vertexLocation:'evil/other'},{...vertex,apiModel:'claude-fixture'},{...vertex,vertexCredentialId:''}]) assert.ok(channelConfigError(config));
});
test('Vertex快照贯穿正文与独立排版，隔离Key且不读变化后的全局值',()=>{
 const config=captureIndependentConfig({...vertex,apiKey:'never-copy'});assert.equal(config.apiUrl,API_CHANNELS.vertex.url);assert.equal(config.apiKey,'');
 const settings={...vertex,apiMode:'custom',layoutApiEnabled:true,layoutApiPresetId:'v',apiPresets:[createApiPresetFromConfig('排版',config,'v')]};
 const {captureGenerationApiRoute}=createTheaterApi({settings});const route=captureGenerationApiRoute({});
 const layout=captureLayoutApiSelection(settings);settings.vertexCredentialId='changed';settings.vertexLocation='us-central1';
 assert.equal(route.custom.vertexCredentialId,vertex.vertexCredentialId);assert.equal(layout.custom.vertexCredentialId,vertex.vertexCredentialId);assert.equal(route.custom.vertexLocation,'global');
});
test('Vertex请求只走本机后端，复用消息/输出/流式，不携带私钥或其他线路Key',async()=>{
 const request=await createIndependentRequest({...vertex,apiKey:'foreign-key',apiUrl:'https://wrong.invalid'},
  {messages:[{role:'system',content:'设定'},{role:'user',content:'故事'}],maxTokens:64000,stream:true},{getHeaders:headers});
 assert.equal(request.endpoint,'/api/backends/chat-completions/generate');assert.equal(request.body.vertexai_auth_mode,'full');assert.equal(request.body.chat_completion_source,'vertexai');
 assert.equal(request.body.max_tokens,64000);assert.equal(request.body.vertexai_region,'global');assert.equal(request.body.stream,true);assert.equal(request.body.use_sysprompt,true);
 assert.doesNotMatch(JSON.stringify(request),/foreign-key|wrong.invalid|private_key|reverse_proxy|temperature|top_p|reasoning_effort/);
});
test('Vertex非流式读取酒馆包装响应；凭证状态不进入结果/日志/查看器',async()=>{
 const calls=[],logs=[],traces=[];
 const result=await requestCustomApi({config:vertex,userPrompt:'故事',shouldStream:false,getHeaders:headers,
  fetchImpl:async(url,options)=>{calls.push({url,options});return url==='/api/secrets/read'?state():json(payload)},log:(...args)=>logs.push(args),onRequest:v=>traces.push(v)});
 assert.equal(result.text,'合成正文');assert.deepEqual(calls.map(c=>c.url),['/api/secrets/read','/api/backends/chat-completions/generate']);
 assert.doesNotMatch(JSON.stringify([result,logs,traces]),/masked-not-returned|fixture-credential|synthetic-csrf/);
});
test('Vertex原生Gemini SSE分片、思考过滤和stop/usage继续复用解析器',async()=>{
 const data=[{candidates:[{content:{parts:[{text:'不显示思考',thought:true}]}}]},{candidates:[{content:{parts:[{text:'合成正文'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:11,candidatesTokenCount:12,totalTokenCount:23}}];
 const bytes=new TextEncoder().encode(data.map(v=>'data: '+JSON.stringify(v)+'\n\n').join(''));let cancelled=false;
 const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close()},cancel(){cancelled=true}}),{headers:{'content-type':'text/event-stream'}});
 const chunks=[];const result=await requestCustomApi({config:vertex,userPrompt:'故事',getHeaders:headers,onChunk:v=>chunks.push(v),fetchImpl:async url=>url==='/api/secrets/read'?state():response});
 assert.equal(result.text,'合成正文');assert.doesNotMatch(chunks.join(''),/不显示思考/);assert.equal(result.rawStopReason,'STOP');assert.equal(result.usage.promptTokenCount,11);
});
test('当前凭证已改变时阻止发送，不换账号或借用主API',async()=>{
 let creative=0;await assert.rejects(requestCustomApi({config:vertex,userPrompt:'故事',getHeaders:headers,fetchImpl:async url=>{if(url==='/api/secrets/read')return state('other');creative++;return json(payload)}}),e=>e.code==='THEATER_CONFIG');assert.equal(creative,0);
});
test('Vertex预检期间停止，不继续发出生成请求',async()=>{
 const controller=new AbortController();let sent=0;
 await assert.rejects(requestCustomApi({config:vertex,userPrompt:'故事',getHeaders:headers,signal:controller.signal,fetchImpl:async url=>{if(url==='/api/secrets/read'){controller.abort();return state()}sent++;return json(payload)}}),{name:'AbortError'});assert.equal(sent,0);
});
test('原生流中停止时保留已回调正文，后续不换线路',async()=>{
 const controller=new AbortController();let sent=0,partial='';
 await assert.rejects(requestCustomApi({config:vertex,userPrompt:'故事',getHeaders:headers,signal:controller.signal,onChunk:v=>partial=v,
  fetchImpl:async url=>{if(url==='/api/secrets/read')return state();sent++;return new Response(new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"停止前正文"}]}}]}\n\n'));controller.signal.addEventListener('abort',()=>stream.error(new DOMException('Aborted','AbortError')));setTimeout(()=>controller.abort(),10)}}),{headers:{'content-type':'text/event-stream'}})}}),{name:'AbortError'});
 assert.equal(partial,'停止前正文');assert.equal(sent,1);
});
test('凭证状态只读取metadata，不调用暴露密钥的find/view',async()=>{
 const paths=[];const active=await activeVertexCredential({getHeaders:headers,fetchImpl:async url=>{paths.push(url);return state()}});assert.deepEqual(active,{id:vertex.vertexCredentialId});assert.deepEqual(paths,['/api/secrets/read']);
});
test('JSON本地校验与导入仅白名单送酒馆，不兑换Token或回传私钥',async()=>{
 const calls=[];const ref=await importVertexCredential(credential(),{getHeaders:headers,fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return json({id:'new-id'})}});
 assert.deepEqual(ref,{vertexCredentialId:'new-id',vertexProjectId:'fixture-project'});assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/secrets/write');
 const saved=JSON.parse(calls[0].body.value);assert.equal(saved.token_uri,'https://oauth2.googleapis.com/token');assert.equal(saved.untrusted,undefined);assert.doesNotMatch(JSON.stringify(ref),/private_key|BEGIN/);
});
test('无效JSON/类型/私钥不写后端且错误不回显输入',async()=>{
 for(const raw of ['not-json-sensitive',JSON.stringify({type:'authorized_user',private_key:'secret-private'}),JSON.stringify({type:'service_account',private_key:'secret-private',client_email:'x@fixture.iam.gserviceaccount.com',project_id:'fixture-project'})]){
  let sent=0;await assert.rejects(importVertexCredential(raw,{getHeaders:headers,fetchImpl:async()=>{sent++;return json({id:'bad'})}}),error=>!/secret-private|not-json-sensitive/.test(error.message));assert.equal(sent,0);
 }
});
test('请求期间不可换凭证；校验失败和请求结束后互斥锁释放',async()=>{
 const release=beginVertexRequest();await assert.rejects(importVertexCredential(credential()),/请求正在进行/);release();release();
 await assert.rejects(importVertexCredential('bad'),/JSON/);
 const ref=await importVertexCredential(credential(),{getHeaders:headers,fetchImpl:async()=>json({id:'released'})});assert.equal(ref.vertexCredentialId,'released');
});
test('两个独立渠道并发不串Key/URL/模型',async()=>{
 const calls=[];await Promise.all(['glm','deepseek'].map(apiChannel=>requestCustomApi({config:{apiChannel,apiUrl:API_CHANNELS[apiChannel].url,apiKey:apiChannel+'-key',apiModel:apiChannel+'-model',maxOutputTokens:1024},shouldStream:false,userPrompt:'故事',fetchImpl:async(url,options)=>{calls.push({url,headers:options.headers,body:JSON.parse(options.body)});return json(payload)}})));
 for(const call of calls){const id=call.body.model.split('-')[0];assert.equal(call.headers.Authorization,'Bearer '+id+'-key');assert.ok(call.url.startsWith(API_CHANNELS[id].url))}
});

test('真实获取模型入口不让迟到响应回填切换后的渠道，或盖过新一次获取',async t=>{
 const original$=globalThis.$,originalToast=globalThis.toastr;
 t.after(()=>{globalThis.$=original$;globalThis.toastr=originalToast});
 let config={apiChannel:'deepseek',apiUrl:API_CHANNELS.deepseek.url,apiKey:'fixture',apiProtocol:'openai',apiModel:'fixture'};
 const rendered=[],pending=[];
 const ui=selector=>new Proxy({}, {get(_o,key){
  if(key==='append')return value=>{if(selector==='#theater-api-model-select')rendered.push(value);return ui(selector)};
  return ()=>ui(selector);
 }});
 globalThis.$=ui;globalThis.toastr={success(){},warning(){},info(){}};
 t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>pending.push(resolve)));
 const runtime={settings:{},readApiFormConfig:()=>config,runtimeLog(){},recordRequestMetrics(){},requestFailureMessage(){},theaterError(){},esc:v=>v};
 const api=createTheaterApi(runtime,{presentModelPicker:models=>rendered.push(...models)});
 const first=api.fetchModelList();
 config={...vertex};pending.shift()(json({data:[{id:'old-provider-model'}]}));await first;
 assert.equal(rendered.length,0);
 config={apiChannel:'deepseek',apiUrl:API_CHANNELS.deepseek.url,apiKey:'fixture',apiProtocol:'openai',apiModel:'fixture'};
 const older=api.fetchModelList(),newer=api.fetchModelList();
 pending[1](json({data:[{id:'newest-model'}]}));await newer;
 const count=rendered.length;pending[0](json({data:[{id:'older-model'}]}));await older;
 assert.equal(rendered.length,count);assert.match(rendered.join(''),/newest-model/);assert.doesNotMatch(rendered.join(''),/older-model/);
});

test('真实测试连接入口不将模型A的迟到成功提示归给新填写的模型B',async t=>{
 const original$=globalThis.$,originalToast=globalThis.toastr;
 t.after(()=>{globalThis.$=original$;globalThis.toastr=originalToast});
 let config={apiChannel:'deepseek',apiUrl:API_CHANNELS.deepseek.url,apiKey:'fixture',apiProtocol:'openai',apiModel:'model-a'};
 const successes=[];let resolve;
 const ui=()=>new Proxy({}, {get(){return ()=>ui()}});
 globalThis.$=ui;globalThis.toastr={success:m=>successes.push(m),warning(){},info(){}};
 t.mock.method(globalThis,'fetch',()=>new Promise(done=>resolve=done));
 const runtime={settings:{},readApiFormConfig:()=>config,runtimeLog(){},recordRequestMetrics(){},requestFailureMessage(){},theaterError(){}};
 const api=createTheaterApi(runtime),request=api.testAPIConnection();
 config={...config,apiModel:'model-b'};resolve(json(payload));await request;
 assert.equal(successes.length,0);
});
