import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManualTarget, resolveTargetWordCount, parseTargetWordCount } from '../length-policy.js';
import { createLongDreamNavigation } from '../long-dream-navigation.js';
import { createLongDreamRecord, saveLongDreamDraft, normalizeLongDreamRecord, retainLongDreamDraftCandidate, selectLongDreamDraftCandidate, pauseLongDreamReview } from '../long-dream.js';
import { createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { createLongDreamArchive, parseLongDreamArchive } from '../long-dream-archive.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';

for (const target of [1, 50, 499, 8001, 15000, 100001, 250000]) {
    test(`正文目标${target}从普通解析、长梦记忆到候选/JSON/ZIP保持原值`, () => {
        assert.equal(normalizeManualTarget(target), target);
        assert.equal(resolveTargetWordCount('写8000字', { manualEnabled:true, manualTarget:target }),target);
        assert.equal(parseTargetWordCount(`写${target}字`),target);
        const runtime={settings:{},save(){}};
        const nav=createLongDreamNavigation(runtime);
        nav.setLongDreamComposerDraft(7,{targetChars:target});
        assert.equal(nav.getLongDreamComposerDraft(7).targetChars,target);
        nav.clearLongDreamComposerDraft(7);
        assert.equal(nav.getLongDreamComposerDraft(7).targetChars,target);
        const base=createLongDreamRecord({source:{text:'已保存正文',html:'<p>已保存正文</p>'}});
        const review=retainLongDreamDraftCandidate(saveLongDreamDraft(base,{status:'review',targetChars:target,text:'候选正文',html:'<p>候选正文</p>'}),0,true);
        const reloaded=normalizeLongDreamRecord(JSON.parse(JSON.stringify(review)));
        assert.equal(reloaded.draft.targetChars,target);
        assert.equal(selectLongDreamDraftCandidate(reloaded,0).draft.targetChars,target);
        const paused=pauseLongDreamReview(reloaded);
        assert.equal(paused.draft.targetChars,target);
        const json=parseLongDreamBackup(JSON.parse(JSON.stringify(createLongDreamBackup([paused]))))[0];
        assert.equal(json.draft.targetChars,target);assert.equal(json.draft.candidates[0].targetChars,target);
        const zip=createLongDreamArchive([paused]);
        const unzipped=parseLongDreamArchive(zip.manifest,zip.files)[0];
        assert.equal(unzipped.draft.targetChars,target);assert.equal(unzipped.draft.candidates[0].targetChars,target);
    });
}

test('无效目标仍安全回默认，不以业务字数上限替换有效大目标',()=>{
    for(const value of [undefined,null,'',0,-1,Infinity,NaN,'abc',Number.MAX_SAFE_INTEGER+1]) assert.equal(normalizeManualTarget(value),3000);
    assert.equal(normalizeManualTarget(1.6),2);
    assert.equal(normalizeManualTarget(undefined,15000),15000);
    assert.equal(parseTargetWordCount('没有指定篇幅'),null);
});

for(const target of [50,15000,150000]) {
    test(`长梦实际单轮请求和结果保留${target}字目标，不额外请求`,async()=>{
        const record=createLongDreamRecord({source:{text:'前章',html:'<p>前章</p>'}});
        let calls=0;
        const controller=createLongDreamGenerationController({requestChapter:async request=>{
            calls++;assert.equal(request.targetChars,target);assert.match(request.userPrompt,new RegExp(`目标正文约 ${target} 字`));
            return {text:'本章新正文。'};
        },renderChapter:async()=>'<p>本章新正文。</p>'});
        const result=await controller.run({record,targetChars:target,autoContinue:false,maxRounds:3});
        assert.equal(calls,1);assert.equal(result.record.draft.targetChars,target);assert.equal(result.record.draft.candidates[0].targetChars,target);
    });
}

test('15000字多轮保留完整目标与7500首轮计划，最大轮数和排版次数不变',async()=>{
    const record=createLongDreamRecord({source:{text:'前章',html:'<p>前章</p>'}});
    let calls=0,renders=0;
    const controller=createLongDreamGenerationController({requestChapter:async request=>{
        calls++;assert.equal(request.targetChars,15000);
        if(calls===1)assert.match(request.userPrompt,/前半部分，目标约 7500 字/);
        return {text:(calls===1?'甲':'乙').repeat(7500)};
    },renderChapter:async()=>{renders++;return '<p>整章</p>';}});
    const result=await controller.run({record,targetChars:15000,autoContinue:true,maxRounds:2});
    assert.equal(calls,2);assert.equal(renders,1);assert.equal(result.record.draft.targetChars,15000);
    assert.equal(result.actualChars,15000);
});