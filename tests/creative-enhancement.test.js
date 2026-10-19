import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATIVE_ENHANCEMENT_PROMPT as prompt, creativeEnhancementPrompt } from '../creative-enhancement.js';
import { buildGenerationPayload, buildContinuationPayload, buildFinalRenderPayload } from '../generation-payload.js';
import { buildLongDreamChapterPayload, buildLongDreamChapterMessages } from '../long-dream-payload.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';
import { createLongDreamRecord } from '../long-dream.js';
import { buildLongDreamMemoryPayload, buildLongDreamSummaryPayload } from '../long-dream-memory.js';
import { buildLongDreamCanonSuggestionPayload } from '../long-dream-canon-suggestions.js';
import { composeGenerationContinuationMessages } from '../request-layout.js';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';

const occurrences = text => String(text).split(prompt).length - 1;
test('创作增强只有明确布尔开启才加入，设置往返关闭不误启用',()=>{
    for(const flag of [undefined,null,false,0,1,'true','false',{}])assert.equal(creativeEnhancementPrompt(flag),'');
    assert.equal(creativeEnhancementPrompt(true),prompt);
    for(const flag of [false,true])assert.equal(creativeEnhancementPrompt(JSON.parse(JSON.stringify({enabled:flag})).enabled),flag?prompt:'');
});
test('普通正文关闭不改变载荷，开启在前情后任务前加入一次并计入预估',()=>{
    const parts={preset:'预设',role:'角色',persona:'人设',worldBook:'世界书',context:'聊天',continuation:'本篇前情',instruction:'本轮任务',rules:'HTML要求',fixed:'硬约束'};
    const off=buildGenerationPayload(parts);
    assert.deepEqual(off,buildGenerationPayload({...parts,creativeEnhancement:''}));
    const on=buildGenerationPayload({...parts,creativeEnhancement:prompt});
    assert.equal(on.systemPrompt,off.systemPrompt);assert.equal(occurrences(on.userPrompt),1);
    assert.ok(on.userPrompt.indexOf('本篇前情')<on.userPrompt.indexOf(prompt));assert.ok(on.userPrompt.indexOf(prompt)<on.userPrompt.indexOf('本轮任务'));
    assert.equal(on.tokenParts.rules,off.tokenParts.rules+prompt);
});
test('普通补写从冻结任务基础取增强，开关后续切换不重复或丢失',()=>{
    const source=readTheaterImplementation();
    const code=source.match(/function buildGenerationContinuationRoundPayload\([^]*?^}/m)[0];
    const build=runInNewContext(code+'\nbuildGenerationContinuationRoundPayload;',{buildContinuationPayload,composeGenerationContinuationMessages});
    for(const enabled of [false,true])for(const manuscriptMode of [false,true]){
        const foundation=Object.freeze({creativeEnhancement:creativeEnhancementPrompt(enabled),presetEntries:[{id:'main',role:'system',content:'预设'}],identitySlots:{charDescription:'角色'},worldInfoEntries:[],chatMessages:[{role:'user',content:'聊天参考'}],tailMessages:[],squashSystemMessages:false});
        const payload=build({foundation,instruction:'承接本篇前情写本轮新增',ctx:{},manuscriptMode});
        assert.equal(occurrences(payload.userPrompt),Number(enabled));assert.equal(occurrences(payload.messages.map(m=>m.content).join('\n')),Number(enabled));
        assert.match(payload.messages.map(m=>m.content).join('\n'),/聊天参考/);assert.match(payload.systemPrompt,/关系承接/);
    }
});
test('长梦关闭保持原顺序，开启后位于背景后本章任务前，结构化消息仅一次',()=>{
    const record=createLongDreamRecord({source:{text:'合成首章',html:'<p>首章</p>'}}),parts={record,instruction:'本轮向车站出发',chapterTitle:'合成续章',targetChars:500};
    const off=buildLongDreamChapterPayload(parts);assert.deepEqual(off,buildLongDreamChapterPayload({...parts,creativeEnhancement:''}));
    for(const structuredPreset of [true,false]){
        const on=buildLongDreamChapterPayload({...parts,structuredPreset,creativeEnhancement:prompt});
        assert.equal(occurrences(on.userPrompt),1);assert.ok(on.userPrompt.indexOf('合成首章')<on.userPrompt.indexOf(prompt));assert.ok(on.userPrompt.indexOf(prompt)<on.userPrompt.indexOf('【本章方向'));
        assert.match(on.systemPrompt,/定梦冲突/);assert.ok(on.userPrompt.indexOf('【输出协议】')>on.userPrompt.indexOf(prompt));
        const messages=buildLongDreamChapterMessages({payload:on,presetEntries:[{id:'main',role:'system',content:'已选预设'}]});
        assert.equal(occurrences(messages.map(m=>m.content).join('\n')),1);
    }
});
test('长梦真实控制器两轮正文都携带冻结增强，只有一次排版且排版不带增强',async()=>{
    for(const enabled of [false,true]){
        const record=createLongDreamRecord({source:{text:'首章',html:'<p>首章</p>'}}),requests=[],renders=[];
        const controller=createLongDreamGenerationController({requestChapter:async payload=>{requests.push(payload);return {text:requests.length===1?'甲'.repeat(200):'乙'.repeat(260)}},renderChapter:async payload=>{renders.push(payload);return `<p>${payload.text}</p>`}});
        await controller.run({record,targetChars:500,autoContinue:true,maxRounds:3,creativeEnhancement:creativeEnhancementPrompt(enabled)});
        assert.equal(requests.length,2);assert.equal(renders.length,1);
        for(const request of requests){assert.equal(occurrences(request.userPrompt),Number(enabled));assert.equal(occurrences(request.messages.map(m=>m.content).join('\n')),Number(enabled));}
        assert.equal(occurrences(JSON.stringify(renders)),0);
    }
});
test('排版、概要、梦脉和定梦辅助载荷均不注入新提示',()=>{
    const record=createLongDreamRecord({source:{text:'首章',html:'<p>首章</p>'}});
    const payloads=[buildFinalRenderPayload({sourceText:'待排版正文',rules:'HTML',originalInstruction:'任务'}),buildLongDreamMemoryPayload({record}),buildLongDreamSummaryPayload({...record,memory:{...record.memory,status:'ready',pendingChapterNumbers:[],pendingConflicts:[]}}),buildLongDreamCanonSuggestionPayload({sourceTitle:'标题',sourceText:'正文'})];
    for(const payload of payloads)assert.equal(occurrences(JSON.stringify(payload)),0);
});
