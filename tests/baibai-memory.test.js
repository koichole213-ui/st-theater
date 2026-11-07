import test from 'node:test';
import assert from 'node:assert/strict';
import { readBaiBaiMemory } from '../baibai-memory.js';
import { chatContextSettingsHTML, refreshBaiBaiMemoryStatus, bindBaiBaiMemoryUpdates } from '../baibai-memory-ui.js';
import { createTheaterGeneration } from '../theater-generation.js';
import { requestMainApi, requestCustomApi } from '../api-runtime.js';
import { createPromptInspectorStore } from '../prompt-inspector.js';

function fixture(length = 6) {
    const ctx = { chatId: 'fixture-chat', getCurrentChatId() { return this.chatId; }, name1: 'U', name2: 'C',
        chat: Array.from({ length }, (_, i) => ({ is_user: i % 2 === 0, mes: `RAW-${i}` })), characters: [], groupId: null };
    const info = () => ({ apiVersion: 1, revision: 3, chat: { id: ctx.chatId, length: ctx.chat.length, groupId: ctx.groupId }, coverage: { complete: true, missingAiFloors: [] } });
    const calls = [];
    const api = { apiVersion: 1,
        getHistory({ before }) { calls.push(['history', before]); return { ...info(), before, text: before ? 'ABSOLUTE-OLD-MEMORY' : '', relativeText: 'DO-NOT-USE-SHIFTED-YESTERDAY' }; },
        getSnapshot() { calls.push(['snapshot']); return { ...info(), point: { upToExclusive: ctx.chat.length }, state: { time: '2026-01-08' },
            protagonist: { identity: '调查员' }, npcs: [{ name: '人物甲', condition: '失踪' }], items: [{ name: '银钥匙', owner: 'U' }], plans: [{ title: '找回旧信' }],
            vars: { excluded: 'DO-NOT-SEND-VARS' }, itemLog: ['DO-NOT-SEND-LOGS'] }; },
    };
    return { ctx, api, calls, settings: { readBaiBaiMemory: true, readChatContext: true, contextRange: 2 } };
}

test('关闭时不访问柏宝书对象、不读取记忆，也不改原对象', () => {
    const f = fixture();const before = JSON.stringify(f.ctx);
    const api = new Proxy({}, { get() { throw new Error('API must not be read'); } });
    assert.equal(readBaiBaiMemory({ ...f, api, settings: {} }).status, 'disabled');
    assert.equal(JSON.stringify(f.ctx), before);assert.deepEqual(f.calls, []);
});

test('以实际近期原文边界读取历史，状态为当前快照，只发送约定剧情资源', () => {
    const f = fixture();const before = JSON.stringify(f.ctx);const result = readBaiBaiMemory(f);
    assert.deepEqual(f.calls, [['history', 4], ['snapshot']]);assert.equal(result.status, 'ready');
    for (const text of ['ABSOLUTE-OLD-MEMORY', '人物甲', '银钥匙', '找回旧信', '调查员']) assert.ok(result.content.includes(text));
    assert.doesNotMatch(result.content, /DO-NOT-SEND|SHIFTED-YESTERDAY/);assert.equal(JSON.stringify(f.ctx), before);
});

test('近期消息关闭/0条/全选与柏宝书记忆开关互不绑定', () => {
    for (const [readChatContext, contextRange, before] of [[false, 2, 6], [true, 0, 6], [true, 500, 0]]) {
        const f = fixture();f.settings = { ...f.settings, readChatContext, contextRange };
        const result = readBaiBaiMemory(f);assert.equal(result.before, before);assert.equal(result.status, 'ready');
        assert.equal(result.content.includes('ABSOLUTE-OLD-MEMORY'), before > 0);
    }
});

test('未安装/旧版/无聊天/空记忆/缺口均有明确状态，异常不泄漏原错误', () => {
    const f = fixture();
    assert.equal(readBaiBaiMemory({ ...f, api: {} }).status, 'outdated');
    assert.equal(readBaiBaiMemory({ ...f, api: { apiVersion: 2 } }).status, 'outdated');
    assert.equal(readBaiBaiMemory({ ...f, ctx: {} }).status, 'no-chat');
    const previous = globalThis.STBaiBaiBook;delete globalThis.STBaiBaiBook;
    try { assert.equal(readBaiBaiMemory({ ...f, api: undefined }).status, 'missing'); } finally { if (previous) globalThis.STBaiBaiBook = previous; }
    const getSnapshot = f.api.getSnapshot;
    f.api.getSnapshot = () => { const s=getSnapshot();s.coverage={complete:false,missingAiFloors:[1,3]};return s; };
    const partial=readBaiBaiMemory(f);assert.equal(partial.status,'partial');assert.equal(partial.missingFloors,2);assert.match(partial.content,/并非完整历史/);
    f.api.getSnapshot = () => { throw new Error('PRIVATE-ERROR-TEXT'); };
    const failure=readBaiBaiMemory(f);assert.equal(failure.status,'error');assert.doesNotMatch(JSON.stringify(failure),/PRIVATE/);
    f.api.getSnapshot=()=>{const s=getSnapshot();return {...s,state:{time:''},protagonist:{},npcs:[],items:[],plans:[]};};
    f.api.getHistory=({before})=>({apiVersion:1,revision:3,chat:{id:f.ctx.chatId,length:6,groupId:null},coverage:{complete:true,missingAiFloors:[]},before,text:''});
    assert.equal(readBaiBaiMemory(f).status,'empty');
});

test('聊天、群聊、长度、截止位置或版本修订不一致时不发送别的快照', () => {
    for (const mutate of [s=>s.chat.id='other-chat', s=>s.chat.groupId='other-group', s=>s.chat.length=99, s=>s.point.upToExclusive=1, s=>s.revision=4]) {
        const f=fixture(),original=f.api.getSnapshot;f.api.getSnapshot=()=>{const s=original();mutate(s);return s;};
        const result=readBaiBaiMemory(f);assert.equal(result.status,'chat-changed');assert.equal(result.content,'');
    }
});

test('界面默认关闭；状态刷新与ready/changed监听只在启用时重估且可以解除', () => {
    const f=fixture(),hint={dataset:{}},root={querySelector:()=>hint};
    assert.doesNotMatch(chatContextSettingsHTML({}, f.ctx),/id="theater-read-baibai-memory"[^>]*checked/);
    refreshBaiBaiMemoryStatus({},f.ctx,root);assert.equal(hint.hidden,true);assert.equal(hint.textContent,'');
    const listeners=new Map();let estimates=0;const eventTarget={addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)};
    const stop=bindBaiBaiMemoryUpdates({getSettings:()=>f.settings,getContext:()=>f.ctx,scheduleTokenEstimate:()=>estimates++,eventTarget});
    listeners.get('st-baibai-book:ready')();assert.equal(estimates,1);f.settings.readBaiBaiMemory=false;
    listeners.get('st-baibai-book:changed')();assert.equal(estimates,1);stop();assert.equal(listeners.size,0);
});

async function assembled(t, options={}) {
    const f=fixture();Object.assign(f.settings,options);
    const previousHost=globalThis.SillyTavern,previousApi=globalThis.STBaiBaiBook;
    globalThis.SillyTavern={getContext:()=>f.ctx};globalThis.STBaiBaiBook=f.api;
    t.after(()=>{globalThis.SillyTavern=previousHost;globalThis.STBaiBaiBook=previousApi;});
    const settings={...f.settings,selectedWorldBooks:[],renderTemplates:[],selectedPresetName:'fixture'};
    const runtime={settings,wbEntries:[],wbStates:[],continueContext:'',normalizeRenderSelection:()=>'__default__',HTML_RENDER_FINAL_GUARDRAILS:'',
        readPromptPlacement:()=>({}),ensureWorldBooksCurrent:async()=>{},
        ensureSelectedPresetLoaded:async()=>({name:'fixture',selectedEntries:[{id:'main',role:'system',content:'PRESET'},{id:'chatHistory',content:''},{id:'tail',role:'system',content:'TAIL'}]})};
    const feature=createTheaterGeneration(runtime);
    const payload=await feature.assembleGenerationPayload('WRITE-CURRENT',{forcePlainText:true});
    return {...f,settings,runtime,feature,payload};
}

test('真实组装、预估和冻结补写资料均携带记忆，后续记忆变化不污染本轮', async t => {
    const {payload,feature,ctx,api,settings}=await assembled(t);
    const text=payload.messages.map(m=>m.content).join('\n');assert.match(text,/ABSOLUTE-OLD-MEMORY/);assert.match(text,/RAW-4/);assert.match(text,/RAW-5/);assert.doesNotMatch(text,/RAW-[0-3]/);
    assert.equal(payload.messages.at(-1).content,'TAIL');assert.ok(payload.tokenParts.memory);assert.equal(payload.memorySummary.before,4);
    const estimate=await feature.assembleGenerationPayload('WRITE-CURRENT',{estimateOnly:true,forcePlainText:true});assert.equal(estimate.tokenParts.memory,payload.tokenParts.memory);
    api.getHistory=()=>{throw new Error('must use frozen material');};settings.readBaiBaiMemory=false;
    const continuation=feature.buildGenerationContinuationRoundPayload({foundation:payload.generationFoundation,instruction:'CONTINUE-DRAFT',ctx});
    const next=continuation.messages.map(m=>m.content).join('\n');assert.equal(next.split('ABSOLUTE-OLD-MEMORY').length,2);assert.match(next,/CONTINUE-DRAFT/);assert.equal(continuation.messages.at(-1).content,'TAIL');
});

test('只开记忆时发送全部已摘要历史，关闭时原请求无新增记忆与预估项', async t => {
    const {payload,feature,settings}=await assembled(t,{readChatContext:false});
    assert.equal(payload.memorySummary.before,6);assert.match(payload.userPrompt,/柏宝书记忆/);assert.doesNotMatch(payload.messages.map(m=>m.content).join('\n'),/RAW-\d/);
    settings.readBaiBaiMemory=false;const off=await feature.assembleGenerationPayload('CURRENT',{forcePlainText:true});
    assert.equal(off.memorySummary.status,'disabled');assert.equal('memory' in off.tokenParts,false);assert.doesNotMatch(off.messages.map(m=>m.content).join('\n'),/柏宝书|ABSOLUTE-OLD-MEMORY/);
});

test('准备资料期间切聊天或切记忆选项，会停止旧请求',async t=>{
    const {feature,runtime,ctx}=await assembled(t);
    const original=runtime.ensureSelectedPresetLoaded;
    runtime.ensureSelectedPresetLoaded=async()=>{ctx.chatId='new-chat';return original();};
    await assert.rejects(feature.assembleGenerationPayload('CURRENT'),/发生了变化/);
    runtime.ensureSelectedPresetLoaded=async()=>{runtime.settings.readBaiBaiMemory=false;return original();};
    await assert.rejects(feature.assembleGenerationPayload('CURRENT'),/发生了变化/);
});

test('预设显式关闭或触发类型不匹配时，记忆覆盖末尾且不恢复近期原文', async t => {
    const { feature, runtime, api, ctx } = await assembled(t);
    api.getHistory = ({before}) => ({apiVersion:1,revision:3,chat:{id:ctx.chatId,length:ctx.chat.length,groupId:null},
        coverage:{complete:true,missingAiFloors:[]},before,text:Array.from({length:before},(_,i)=>`MEMORY-${i}`).join('\n')});
    for (const triggerDisabled of [false,true]) {
        runtime.ensureSelectedPresetLoaded = async () => ({name:'fixture',
            selectedEntries:[{id:'main',role:'system',content:'PRESET'},...(triggerDisabled ? [{id:'chatHistory',content:'',injectionTrigger:['quiet']}] : []),{id:'tail',role:'system',content:'TAIL'}],
            disabledSlotIds:triggerDisabled ? [] : ['chatHistory']});
        const payload=await feature.assembleGenerationPayload('CURRENT',{forcePlainText:true});
        const text=payload.messages.map(m=>m.content).join('\n');
        assert.equal(payload.memorySummary.before,6);assert.equal(payload.memorySummary.status,'ready');
        assert.match(text,/MEMORY-4/);assert.match(text,/MEMORY-5/);assert.doesNotMatch(text,/RAW-\d/);
    }
});

test('记忆关闭时，异步准备仍沿用原先提前捕获的近期正文',async t=>{
    const {feature,runtime,settings,ctx}=await assembled(t,{readBaiBaiMemory:false});
    const original=runtime.ensureSelectedPresetLoaded;
    runtime.ensureSelectedPresetLoaded=async()=>{ctx.chat[5].mes='EDITED-DURING-PREPARATION';return original();};
    const payload=await feature.assembleGenerationPayload('CURRENT',{forcePlainText:true});
    const text=payload.messages.map(m=>m.content).join('\n');assert.match(text,/RAW-5/);assert.doesNotMatch(text,/EDITED-DURING/);assert.equal(settings.readBaiBaiMemory,false);
});

test('实际主API与独立API发送适配后保留记忆，查看器可检索；不发出网络请求',async t=>{
    const {payload,ctx}=await assembled(t);
    const store=createPromptInspectorStore();
    const id=store.begin({purpose:'creative',messages:payload.messages});
    let mainCapture;
    await requestMainApi({ctx:{...ctx,oai_settings:{chat_completion_source:'openai',openai_model:'fixture'}},messages:payload.messages,postProcessing:'strict',shouldStream:false,
        chatCompletionService:{async processRequest(settings,messages){mainCapture=settings.messages;return {content:'SYNTHETIC-STORY'};}},onRequest:d=>store.sent(id,d)});
    assert.ok(mainCapture);assert.match(JSON.stringify(mainCapture),/ABSOLUTE-OLD-MEMORY/);
    for(const protocol of ['openai','anthropic']){
        let body;await requestCustomApi({config:{apiChannel:'custom',apiUrl:'https://example.invalid/v1',apiModel:'fixture',apiProtocol:protocol,apiKey:'fixture-only',maxOutputTokens:1000},
            messages:payload.messages,postProcessing:'strict',shouldStream:false,getHeaders:()=>({}),onRequest:d=>store.sent(id,d),
            fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify(protocol==='anthropic'?{content:[{type:'text',text:'SYNTHETIC-STORY'}],stop_reason:'end_turn'}:{choices:[{message:{content:'SYNTHETIC-STORY'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}});
        assert.match(JSON.stringify(body),/ABSOLUTE-OLD-MEMORY/);assert.doesNotMatch(JSON.stringify(body),/DO-NOT-SEND|SHIFTED-YESTERDAY/);
        assert.match(JSON.stringify(store.list().at(-1).sent),/ABSOLUTE-OLD-MEMORY/);
    }
});
