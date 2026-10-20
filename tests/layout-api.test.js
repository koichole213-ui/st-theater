import { createTheaterStorage } from '../theater-storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLayoutApiSelection, resolveLayoutApiRoute } from '../layout-api.js';
import { createTheaterApi } from '../theater-api.js';
import { createTheaterGeneration } from '../theater-generation.js';
import { createLongDreamRuntime } from '../long-dream-runtime.js';
import { retryCurrentLayout, bindLayoutRetry } from '../layout-retry.js';
import { RELEASE_NOTES, hasUnreadRelease, latestReleaseVersion, releaseNotesHTML } from '../release-notes.js';

const preset = () => ({ id: 'layout', name: '排版预设', apiUrl: 'https://layout.example/v1', apiKey: 'synthetic-secret', apiModel: 'layout-model', apiProtocol: 'openai', maxOutputTokens: 4096 });
const settings = () => ({ layoutApiEnabled: true, layoutApiPresetId: 'layout', layoutMaxOutputTokens: 131072, apiMode: 'custom', apiUrl: 'https://body.example/v1', apiModel: 'body-model', maxOutputTokens: 8192, streamEnabled: true, apiPresets: [preset()] });

test('排版默认关闭时返回原线路，非布尔真值不会误启用', () => {
    const body = { mode: 'main' };
    for (const flag of [undefined, false, 'true', 1]) assert.equal(resolveLayoutApiRoute(body, { layoutApiEnabled: flag }), body);
});
test('正文任务捕获排版预设，不改正文线路、原预设上限或后续冻结值', () => {
    for (const apiMode of ['main', 'custom']) {
        const config = { ...settings(), apiMode };
        const route = createTheaterApi({ settings: config }).captureGenerationApiRoute({ oai_settings: {} });
        const selected = resolveLayoutApiRoute(route);
        assert.equal(route.mode, apiMode); assert.equal(selected.mode, 'custom');
        assert.equal(selected.custom.apiKey, 'synthetic-secret'); assert.equal(selected.maxTokens, 131072);
        assert.equal(config.maxOutputTokens, 8192); assert.equal(config.apiPresets[0].maxOutputTokens, 4096);
        config.apiPresets[0].apiModel = 'later'; config.layoutMaxOutputTokens = 256; config.layoutApiEnabled = false;
        assert.equal(resolveLayoutApiRoute(route).model, 'layout-model'); assert.equal(resolveLayoutApiRoute(route).maxTokens, 131072);
    }
});
test('任务开始时关闭的排版设置不会在途中被开启影响', () => {
    const config = { ...settings(), layoutApiEnabled: false };
    const route = createTheaterApi({ settings: config }).captureGenerationApiRoute({});
    config.layoutApiEnabled = true;
    assert.equal(resolveLayoutApiRoute(route), route);
});
test('未绑定、预设被删除或字段不全，排版报错且不返回正文线路', () => {
    for (const patch of [{ layoutApiPresetId: '' }, { apiPresets: [] }, { apiPresets: [{ ...preset(), apiModel: '' }] }]) {
        const route = { mode: 'main', layoutSelection: captureLayoutApiSelection({ ...settings(), ...patch }) };
        assert.throws(() => resolveLayoutApiRoute(route), { code: 'THEATER_LAYOUT_API_MISSING' });
    }
});
test('排版上限独立默认值、范围约束与API协议继承', () => {
    for (const [value, expected] of [[undefined,131072],[0,256],[999999,131072],[1,256],[8192,8192]]) {
        const selected = resolveLayoutApiRoute(undefined, { ...settings(), layoutMaxOutputTokens:value });
        assert.equal(selected.maxTokens, expected);
    }
    assert.equal(resolveLayoutApiRoute(undefined, { ...settings(), apiPresets:[{...preset(),apiProtocol:'anthropic'}] }).protocol,'anthropic');
});
test('真实最终排版器保留正文/原样式/设计意图，校验修复仍只使用同一排版线路', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ set innerHTML(v) { this.textContent = v.replace(/<[^>]*>/g,''); }, querySelectorAll: () => [] }) };
    try {
        const config = settings(), calls = [];
        const bodyRoute = createTheaterApi({settings:config}).captureGenerationApiRoute({});
        const runtime = { settings:config, extractHtml:v=>v, runtimeLog(){}, recordRequestMetrics(){}, requestConfiguredGenerationApi:async args=>{
            calls.push(args);
            return {text: calls.length===1 ? '<html><body>{{THEATER_P0001}}</body></html>' : '<html><body><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>'};
        } };
        const result = await createTheaterGeneration(runtime).requestFinalRenderedHtml({sourceText:'第一段。\n\n第二段。',rules:'保留丰富交互样式',originalInstruction:'火车车厢',apiRoute:bodyRoute,ctx:{}});
        assert.equal(calls.length,2); assert.equal(calls[0].apiRoute.model,'layout-model'); assert.equal(calls[1].apiRoute.model,'layout-model');
        assert.match(calls[0].userPrompt,/保留丰富交互样式/);assert.match(calls[0].userPrompt,/火车车厢/);
        assert.match(result.html,/第一段。/);assert.match(result.html,/第二段。/);
        assert.equal(bodyRoute.model,'body-model');
        calls.length=0;
        runtime.requestConfiguredGenerationApi=async args=>{calls.push(args);throw Error('synthetic network failure')};
        await assert.rejects(createTheaterGeneration(runtime).requestFinalRenderedHtml({sourceText:'保留正文',apiRoute:bodyRoute,ctx:{}}));
        assert.equal(calls.length,1);assert.equal(calls[0].apiRoute.model,'layout-model');
    } finally { globalThis.document=previousDocument; }
});
test('长梦排版调用共享排版器，纯文字模板零请求', async () => {
    const calls=[];
    const runtime={resolveRenderSelection:()=>({isPlainTextRender:false,rules:'样式',label:'模板'}),requestFinalRenderedHtml:async args=>{calls.push(args);return{html:'HTML',mode:'html'}},textFallbackHtml:t=>t};
    globalThis.SillyTavern={getContext:()=>({})};
    const feature=createLongDreamRuntime(runtime),apiRoute={layoutSelection:captureLayoutApiSelection(settings())};
    await feature.renderLongDreamChapter({text:'正文',apiRoute});assert.equal(calls.length,1);assert.equal(calls[0].apiRoute,apiRoute);
    runtime.resolveRenderSelection=()=>({isPlainTextRender:true,textTheme:'light'});
    await feature.renderLongDreamChapter({text:'正文',apiRoute});assert.equal(calls.length,1);
});
test('普通排版重试失败/停止/保存失败保留原文，成功只替换排版并清除重试标记',async()=>{
    globalThis.$=()=>({prop(){return this},text(){return this}});
    globalThis.toastr={success(){},info(){}};
    globalThis.SillyTavern={getContext:()=>({})};
    for(const outcome of ['success','failure','abort','store-failure']){
        const item={html:'原正文',mode:'text',layoutRetry:{sourceText:'原正文',rules:'样式'}};let calls=0;
        const runtime={currentGenerationResult:item,currentDisplayHtml:item.html,captureGenerationApiRoute:()=>({}),updateContinueHint(){},captureRequestIssue:()=>({}),requestFailureMessage:()=>'',theaterError(){},
            requestFinalRenderedHtml:async args=>{calls++;assert.equal(args.sourceText,'原正文');if(outcome==='failure')throw Error('failed');if(outcome==='abort')throw new DOMException('stopped','AbortError');return{html:'排版正文',mode:'html'}},
            storeCurrentResult:async updated=>{if(outcome==='store-failure')return false;runtime.currentGenerationResult=updated;return true},showInIframe(html){runtime.currentDisplayHtml=html},
        };
        assert.equal(await retryCurrentLayout(runtime),outcome==='success');assert.equal(calls,1);
        if(outcome==='success'){assert.equal(runtime.currentGenerationResult.html,'排版正文');assert.equal(runtime.currentGenerationResult.layoutRetry,undefined)}
        else {assert.equal(runtime.currentGenerationResult,item);assert.equal(item.html,'原正文');assert.ok(item.layoutRetry)}
        assert.equal(runtime.isGenerating,false);
    }
});
test('更新日志最多五个可靠正式版本，未发布功能不混入，已读版本保存后不重复提示',()=>{
    assert.ok(RELEASE_NOTES.length<=5);assert.equal(RELEASE_NOTES[0].version,'4.4.2');
    const html=releaseNotesHTML(v=>String(v));assert.match(html,/长梦概要/);assert.match(html,/<details/);assert.doesNotMatch(html,/独立.*排版 API/);
    assert.equal(hasUnreadRelease({}),true);assert.equal(hasUnreadRelease({releaseNotesReadVersion:latestReleaseVersion()}),false);
});


test('真实存储编辑后清除旧排版任务，失败写入保留正文和任务', async()=>{
    globalThis.$=()=>({prop(){return this},text(){return this}});
    globalThis.SillyTavern={getContext:()=>({})};
    for(const stored of [false,true]){
        const item={html:'旧正文',mode:'text',layoutRetry:{sourceText:'旧正文',rules:'样式'}};
        const runtime={currentGenerationResult:item,recentCache:[],resultStorageQueue:Promise.resolve(),htmlToPlainText:v=>v,
            idb:stored?null:{transaction(){throw Error('synthetic store failure')}},settings:{},save(){},
            currentDisplayHtml:'手改正文',updateContinueHint(){},storeCurrentResult(){throw Error('must not retry')},requestFinalRenderedHtml(){throw Error('must not retry')},
        };
        globalThis.toastr={error(){}};
        const result=await createTheaterStorage(runtime).updateResultItem(item,'手改正文','text');
        assert.equal(result,stored);
        if(stored){assert.equal(item.html,'手改正文');assert.equal(item.layoutRetry,null);assert.equal(await retryCurrentLayout(runtime),false)}
        else{assert.equal(item.html,'旧正文');assert.equal(item.layoutRetry.sourceText,'旧正文')}
    }
});


test('重试排版有停止入口，停止保留正文；长梦相关任务与普通重试互斥',async()=>{
    const props=new Map(),handlers=new Map();
    globalThis.$=selector=>({prop(key,value){props.set(selector+':'+key,value);return this},text(){return this}});
    globalThis.toastr={info(){}};globalThis.SillyTavern={getContext:()=>({})};
    const item={html:'正文',layoutRetry:{sourceText:'正文'}};
    for(const busy of [{longDreamGenerationController:{active:{}}},{longDreamChapterEditController:{}},{longDreamCanonSuggestionState:{controller:{}}}]){
        const runtime={...busy,currentGenerationResult:item,currentDisplayHtml:'正文',requestFinalRenderedHtml(){throw Error('busy must not request')}};
        assert.equal(await retryCurrentLayout(runtime),false);
    }
    const runtime={currentGenerationResult:item,currentDisplayHtml:'正文',captureGenerationApiRoute:()=>({}),updateContinueHint(){},
        requestFinalRenderedHtml:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')))),
    };
    const $d={off(){return this},on(_event,selector,handler){handlers.set(selector,handler);return this}};
    bindLayoutRetry($d,runtime);const running=retryCurrentLayout(runtime);
    assert.equal(props.get('#theater-stop-layout-btn:hidden'),false);
    handlers.get('#theater-stop-layout-btn')();assert.equal(await running,false);
    assert.equal(runtime.currentGenerationResult,item);assert.equal(props.get('#theater-stop-layout-btn:hidden'),true);assert.equal(runtime.isGenerating,false);
});
