// 从 core.test.js 拆出：generation-rounds
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { STORY_RELATION_CONTINUITY_RULE, buildContinuationInstruction, buildContinuationPayload, buildFinalRenderPayload, buildGenerationPayload, recentGenerationRoundsContext } from '../generation-payload.js';
import { abortGenerationJob, addGenerationSegment, authorizeFinish, createGenerationJob, generationTextWithLiveSegment, shouldAuthorizeFinishRound, shouldContinueJob, targetCompletionChars } from '../generation-job.js';
import { readableCharCount } from '../text-counter.js';
import { continuationFirstRoundGuidance, firstRoundGuidance, isStagedRenderTarget, longFormFirstRoundGuidance, resolveTargetWordCount, stripTargetWordCountRequirement } from '../length-policy.js';
import { normalizeContextRange, takeRecentMessages } from '../context-policy.js';
import { createChatContextReader } from '../context-exclusions.js';
import { LONG_DREAM_WORLD_LINE_RELATION, createLongDreamRecord } from '../long-dream.js';
import { buildLongDreamChapterMessages, buildLongDreamChapterPayload } from '../long-dream-payload.js';
import { PROMPT_POST_PROCESSING, WORLD_INFO_POSITION, applyPromptPostProcessing, composeGenerationContinuationMessages, composePresetMessages } from '../request-layout.js';
import { continuationRoundHistory } from '../continuation-session.js';

test('普通与长文自动补写、长梦新章和草稿恢复均传递本篇关系优先规则', () => {
    const previous = '雨夜捡回的天使与他刚刚相识。';
    const direction = '两人通过本篇相处逐渐成为恋人。';
    for (const manuscriptMode of [false, true]) {
        const instruction = buildContinuationInstruction({ round: 2, draft: previous, manuscriptMode, originalInstruction: direction });
        const payload = buildContinuationPayload({ instruction, manuscriptMode });
        const messages = composeGenerationContinuationMessages({
            presetEntries: [], slots: {}, worldInfoEntries: [], chatMessages: [], foundationTailMessages: [],
            continuationSystemPrompt: payload.systemPrompt, continuationUserPrompt: payload.userPrompt,
        });
        assert.ok(messages.some(message => message.role === 'user' && message.content.includes(STORY_RELATION_CONTINUITY_RULE)));
        assert.ok(messages.some(message => message.content.includes(previous)));
        assert.match(payload.systemPrompt, /除非用户明确要求改变相应设定/);
        assert.match(payload.systemPrompt, /允许有情节依据的自然发展/);
        assert.match(payload.systemPrompt, /符合本篇指令与既有世界线继承规则、且不冲突的人物关系/);
    }
    const record = createLongDreamRecord({ canon: '此梦中两人没有亲属关系。', source: { text: previous, html: `<main>${previous}</main>` } });
    for (const currentDraft of ['', '天使在本章第一次告诉他自己的名字。']) {
        const payload = buildLongDreamChapterPayload({ record, instruction: direction, currentDraft, continuationRound: !!currentDraft });
        const messages = buildLongDreamChapterMessages({ payload, presetEntries: [], slots: {} });
        assert.ok(messages.some(message => message.content.includes(STORY_RELATION_CONTINUITY_RULE)));
        assert.match(payload.systemPrompt, /本章方向若与定梦冲突，仍须停止并指出冲突/);
        assert.ok(payload.userPrompt.includes(previous));
        assert.ok(payload.userPrompt.includes(direction));
        if (currentDraft) assert.ok(payload.userPrompt.includes(currentDraft));
    }
    for (const [worldLineRelation, expected] of [
        [LONG_DREAM_WORLD_LINE_RELATION.PARALLEL, '原剧情、关系、年龄和人物现状不是本梦事实'],
        [LONG_DREAM_WORLD_LINE_RELATION.CANON_CONCURRENT, '重大事件和人物关系默认成立'],
        [LONG_DREAM_WORLD_LINE_RELATION.SEQUEL, '冻结世界书属于已经发生的历史'],
    ]) {
        const inherited = createLongDreamRecord({ worldLineRelation, source: { text: previous, html: `<main>${previous}</main>` } });
        const payload = buildLongDreamChapterPayload({ record: inherited });
        assert.ok(payload.systemPrompt.includes(expected));
        assert.ok(payload.systemPrompt.includes(STORY_RELATION_CONTINUITY_RULE));
        assert.match(payload.systemPrompt, /且不冲突的人物关系、共同经历/);
    }
});

test('自动续写达到目标的 90% 后停止', () => {
    const job = createGenerationJob({ targetChars: 100, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(50), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    addGenerationSegment(job, '字'.repeat(39), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    addGenerationSegment(job, '字', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.actualChars, 90);
    assert.equal(targetCompletionChars(100), 90);
});

test('续写提示携带当前、目标和本轮篇幅，但不携带原始指令或 HTML 结构', () => {
    const prompt = buildContinuationInstruction({
        round: 2,
        tail: '上一段结尾原文',
        finishThisRound: false,
        currentChars: 3200,
        targetChars: 5000,
        roundsRemaining: 2,
    });
    const payload = buildContinuationPayload({ instruction: prompt });
    assert.match(payload.userPrompt, /上一段结尾原文/);
    assert.match(payload.userPrompt, /只输出新增正文片段/);
    assert.match(payload.userPrompt, /当前可读正文约 3200 字/);
    assert.match(payload.userPrompt, /目标约 5000 字/);
    assert.match(payload.userPrompt, /仍差约 1800 字/);
    assert.match(payload.userPrompt, /本轮请新增约 1100 字/);
    assert.match(payload.userPrompt, /不得.*重新开启一条剧情/);
    assert.doesNotMatch(payload.userPrompt, /原始要求/);
    assert.doesNotMatch(payload.userPrompt, /输出完整 HTML/);

    const longFinalRound = buildContinuationInstruction({
        round: 2,
        tail: '长篇上半篇结尾',
        finishThisRound: true,
        currentChars: 3600,
        targetChars: 8000,
        roundsRemaining: 1,
    });
    assert.match(longFinalRound, /仍差约 4400 字/);
    assert.match(longFinalRound, /本轮请新增约 5300 字/);
    assert.match(longFinalRound, /按上方剩余篇幅.*再自然收束结局/);
});

test('5000 字起后续正文轮补完同一份稿件，而不是把前稿当成独立成品续写', () => {
    const prompt = buildContinuationInstruction({
        round: 2,
        tail: '只用于普通回退的末尾',
        draft: '第一轮完整正文：游戏失败后，林秋正在执行大冒险。',
        originalInstruction: '描写林秋游戏失败后接受大冒险以及众人的反应',
        manuscriptMode: true,
        finishThisRound: true,
        currentChars: 2900,
        targetChars: 5000,
        roundsRemaining: 1,
    });
    const payload = buildContinuationPayload({ instruction: prompt, manuscriptMode: true });
    assert.match(payload.systemPrompt, /补完同一份尚未完成/);
    assert.match(payload.systemPrompt, /不是续集或后日谈/);
    assert.match(payload.userPrompt, /同一份小剧场稿件/);
    assert.match(payload.userPrompt, /第一轮完整正文/);
    assert.match(payload.userPrompt, /整篇作品任务/);
    assert.match(payload.userPrompt, /游戏失败后接受大冒险/);
    assert.match(payload.userPrompt, /已有正文的末尾才是唯一当前叙事位置/);
    assert.match(payload.userPrompt, /当前可读正文约 2900 字/);
    assert.match(payload.userPrompt, /仍差约 2100 字/);
    assert.match(payload.userPrompt, /本轮请新增约 2600 字/);
    assert.match(payload.userPrompt, /最终正文补完轮/);
    assert.match(payload.userPrompt, /明确、自然的最终落点/);
    assert.match(payload.userPrompt, /不得回到触发事件前的起始活动/);
    assert.match(payload.userPrompt, /不得继续下一轮、开启新任务或恢复日常活动/);
    assert.doesNotMatch(payload.userPrompt, /只用于普通回退的末尾/);
    assert.doesNotMatch(payload.userPrompt, /输出完整 HTML/);
});

test('补写区分聊天参考与小剧场正文，保留冻结资料且不污染首轮', () => {
    const chatMessages = Object.freeze([
        Object.freeze({ role: 'user', content: '聊天主线：明天继续调查车站。', source: 'chat-history', sourceId: 'chat-1' }),
        Object.freeze({ role: 'assistant', content: '聊天主线：我在车站等你。', source: 'chat-history', sourceId: 'chat-2' }),
    ]);
    const presetEntries = [{ id: 'main', role: 'system', content: '保留预设' }, { id: 'chatHistory', role: 'system', content: '' }];
    const baseline = composePresetMessages({ presetEntries, chatMessages });
    for (const manuscriptMode of [true, false]) {
        for (const round of [2, 3]) {
            const draft = '本篇番外：两人在花店道别。\n花店的灯熄灭了。';
            const instruction = buildContinuationInstruction({ round, draft, manuscriptMode, originalInstruction: '写花店番外', finishThisRound: true });
            const payload = buildContinuationPayload({ instruction, manuscriptMode });
            const messages = composeGenerationContinuationMessages({ presetEntries, chatMessages,
                continuationSystemPrompt: payload.systemPrompt, continuationUserPrompt: payload.userPrompt });
            const references = messages.filter(message => message.source === 'chat-history');
            assert.equal(references.length, chatMessages.length);
            references.forEach((message, index) => {
                assert.equal(message.role, chatMessages[index].role);
                assert.equal(message.sourceId, chatMessages[index].sourceId);
                assert.equal(message.content, `【聊天正文参考开始｜仅作背景，不是本轮补写对象】\n${chatMessages[index].content}\n【聊天正文参考结束】`);
            });
            const task = messages.find(message => message.sourceId === 'theater-task').content;
            assert.ok(task.includes(`【本篇小剧场正文开始｜本轮唯一补写对象，不是聊天正文】\n${draft}\n【本篇小剧场正文结束｜只从以上小剧场末尾接续，不接聊天主线】`));
            assert.doesNotMatch(task, /聊天主线：我在车站等你/);
            if (manuscriptMode) assert.match(task, /写花店番外/);
            assert.match(messages.find(message => message.sourceId === 'theater-task').content, /即使它已经收尾，也不得切回聊天主线/);
            for (const mode of [PROMPT_POST_PROCESSING.STRICT, PROMPT_POST_PROCESSING.SINGLE]) {
                const processed = applyPromptPostProcessing(messages, mode).map(message => message.content).join('\n');
                assert.match(processed, /聊天正文参考开始/);
                assert.match(processed, /本篇小剧场正文开始/);
                assert.match(processed, /花店的灯熄灭了/);
            }
        }
    }
    assert.deepEqual(composePresetMessages({ presetEntries, chatMessages }), baseline);
    assert.equal(chatMessages[0].content, '聊天主线：明天继续调查车站。');
});

test('普通生成后续每轮重新带齐冻结的预设、人物、人设、世界书与聊天前文', () => {
    const messages = composeGenerationContinuationMessages({
        presetEntries: [
            { id: 'main', role: 'system', content: '冻结预设' },
            { id: 'charDescription', role: 'system', content: '' },
            { id: 'personaDescription', role: 'system', content: '' },
            { id: 'worldInfoBefore', role: 'system', content: '' },
            { id: 'chatHistory', role: 'system', content: '' },
        ],
        slots: {
            charDescription: '冻结角色：NPC 是女性',
            personaDescription: '冻结 User 人设',
        },
        worldInfoEntries: [{ content: '冻结世界书：NPC 名叫林秋', position: WORLD_INFO_POSITION.BEFORE_CHARACTER }],
        chatMessages: [{ role: 'assistant', content: '冻结聊天前文', source: 'chat-history', sourceId: 'chat-1' }],
        foundationTailMessages: [{ role: 'system', content: '冻结文风补充', source: 'theater-addon', sourceId: 'addons' }],
        originalInstruction: '让林秋陪主角调查旧站',
        continuationSystemPrompt: '只续写新增正文',
        continuationUserPrompt: '从当前结尾继续第二轮',
    });
    const text = messages.map(message => message.content).join('\n');
    for (const expected of [
        '冻结预设', 'NPC 是女性', '冻结 User 人设', 'NPC 名叫林秋',
        '冻结聊天前文', '冻结文风补充', '从当前结尾继续第二轮', '只续写新增正文',
    ]) assert.match(text, new RegExp(expected));
    assert.doesNotMatch(text, /让林秋陪主角调查旧站/);
    assert.equal(messages.filter(message => message.sourceId === 'original-instruction').length, 0);
    assert.equal(messages.filter(message => message.sourceId === 'theater-task').length, 1);
    assert.equal(messages.filter(message => message.sourceId === 'theater-task').length, 1);
});

test('普通生成中途失败会合并已完成轮次和当前流式正文，不再把一万字记成零', () => {
    const job = createGenerationJob({ targetChars: 12000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '第一轮正文', 'length');
    assert.equal(generationTextWithLiveSegment(job, '第二轮已流出正文'), '第一轮正文\n\n第二轮已流出正文');
    assert.equal(generationTextWithLiveSegment(createGenerationJob(), '首轮已流出正文'), '首轮已流出正文');

    const source = readTheaterImplementation();
    const ordinaryGeneration = source.slice(
        source.indexOf('async function runGeneration'),
        source.indexOf('function currentAutoInstruction'),
    );
    assert.match(ordinaryGeneration, /retainStreamAsBody = false;[\s\S]*?(?:runtime\.)?requestFinalRenderedHtml/);
    assert.match(ordinaryGeneration, /generationTextWithLiveSegment\((?:runtime\.)?currentGenerationJob, liveBodyText\)/);
});

test('普通生成多轮复用首轮资料包而不是退回简化续写请求', () => {
    const source = readTheaterImplementation();
    const ordinaryGeneration = source.slice(
        source.indexOf('async function runGeneration'),
        source.indexOf('function currentAutoInstruction'),
    );
    assert.match(source, /generationFoundation: Object\.freeze/);
    assert.match(source, /originalInstruction: cleanInstruction/);
    assert.match(ordinaryGeneration, /buildGenerationContinuationRoundPayload/);
    assert.match(ordinaryGeneration, /stagedMultiRoundMode = !contCtx && stagedRenderMode && (?:runtime\.)?settings\.autoContinue && configuredMaxRounds >= 2/);
    assert.match(ordinaryGeneration, /minimumRounds: stagedMultiRoundMode \? 2 : 1/);
    assert.match(ordinaryGeneration, /requireTargetCompletion: stagedMultiRoundMode/);
    assert.match(ordinaryGeneration, /draft: recentGenerationRoundsContext\(continuationRoundHistory\(continuationRun\?\.source.rounds, (?:runtime\.)?currentGenerationJob.segments.map\(prepareContinuationContext\)\)\)/);
    assert.doesNotMatch(ordinaryGeneration, /continuationContextWindow\(|tailText\(/);
    assert.doesNotMatch(ordinaryGeneration, /\.\.\.buildContinuationPayload/);
});

test('普通续写真实首轮装配匹配实际轮数，保留完整前情及新生成规则', async () => {
    const source = readTheaterImplementation();
    const assembly = source.match(/async function assembleGenerationPayload\([^]*?^}/m)[0];
    const autoLine = source.match(/const autoTargetContinue = .*;/)[0];
    const config = source.match(/(?:runtime\.)?currentGenerationJob = createGenerationJob\(\{[\s\S]*?\}\);/)[0];
    const snapshot = { prompt: '合成预设', selectedEntries: [], name: '合成预设' };
    const context = {
        settings: { manualTargetEnabled: true, manualTargetChars: 4000, contextRange: 0, selectedWorldBooks: [] },
        SillyTavern: { getContext: () => ({ chat: [] }) }, generationPreparationKey: () => 'stable',
        resolveGenerationIdentity: () => ({ character: {}, role: '虚构角色', persona: '虚构人设', name1: '甲', name2: '乙' }),
        normalizeContextRange, takeRecentMessages, createChatContextReader, wbEntries: [], wbStates: {},
        ensureWorldBooksCurrent: async () => {}, stripTargetWordCountRequirement, resolveTargetWordCount,
        resolveRenderSelection: forcePlainText => ({ isPlainTextRender: !!forcePlainText, textTheme: 'light', rules: forcePlainText ? '只输出纯正文，不输出 HTML' : '保留完整美化 HTML 规则' }),
        currentPresetSnapshot: () => snapshot, ensureSelectedPresetLoaded: async () => snapshot,
        DEFAULT_SYSTEM_PROMPT: '默认', prepareContinuationContext: value => value || '', continueContext: '',
        buildProtagonistAnchor: () => '人物锚点', firstRoundGuidance, continuationFirstRoundGuidance, longFormFirstRoundGuidance, isStagedRenderTarget,
        STORY_RELATION_CONTINUITY_RULE, buildGenerationPayload, generationIdentitySlots: () => ({}),
        composePresetMessages, freezeGenerationFoundationList: items => Object.freeze(items.map(item => Object.freeze({ ...item }))),
    };
    const assemble = runInNewContext(assembly + '\nassembleGenerationPayload;', context);
    const previous = '旧正文开始\n' + '雨停以后，两人继续交谈。'.repeat(1000) + '\n旧正文结尾';
    for (const creativeEnhancementEnabled of [false,true]) for (const target of [50, 4000, 20000, 150000]) for (const autoContinue of [false, true]) for (const max of [1, 3]) {
        Object.assign(context.settings, { manualTargetChars: target, autoContinue, maxAutoRounds: max, creativeEnhancementEnabled });
        const payload = await assemble('继续展开雨夜重逢，写8000字', { continuationText: previous, forcePlainText: isStagedRenderTarget(target) });
        const job = runInNewContext(`${autoLine}\nlet currentGenerationJob; ${config}; currentGenerationJob`, {
            targetWordCount: target, settings: context.settings, isStagedRenderTarget,
            configuredMaxRounds: max, stagedMultiRoundMode: false, createGenerationJob,
        });
        const expected = continuationFirstRoundGuidance(target, { maxRounds: job.maxRounds });
        const actualTask = payload.messages.find(message => message.sourceId === 'theater-task');
        assert.equal(actualTask.role, 'user');
        assert.equal(actualTask.content.includes('【虚构叙事执行约定】'), creativeEnhancementEnabled);
        assert.equal(payload.generationFoundation.creativeEnhancement.includes('【虚构叙事执行约定】'), creativeEnhancementEnabled);
        if (creativeEnhancementEnabled) {
            const enhancement = payload.generationFoundation.creativeEnhancement;
            assert.ok(actualTask.content.indexOf(enhancement) > actualTask.content.indexOf(previous));
            assert.ok(actualTask.content.indexOf(enhancement) < actualTask.content.indexOf('用户指令：'));
            assert.ok(payload.tokenParts.rules.includes(enhancement));
        }
        assert.equal(payload.targetWordCount, target);
        assert.ok(payload.messages.find(message => message.sourceId === 'theater-task').content.includes(expected));
        assert.equal(payload.messages.some(message => message.content.includes('【单轮停笔要求】')), job.maxRounds === 1);
        if (job.maxRounds === 1) {
            assert.match(payload.userPrompt, /最后一句须表达完整/);
            assert.match(payload.userPrompt, /允许符合用户要求的开放结局/);
        }
        const task = payload.messages.find(message => message.sourceId === 'theater-task').content;
        assert.match(task, new RegExp(`新增约 ${target} 字`));
        assert.doesNotMatch(task, /8000/);
        assert.ok(payload.messages.find(message => message.sourceId === 'theater-task').content.includes(previous));
        assert.match(payload.tokenParts.continuation, /不计入本次新增字数/);
        assert.match(payload.tokenParts.rules, target >= 5000 ? /只输出纯正文，不输出 HTML/ : /保留完整美化 HTML 规则/);
        assert.equal(payload.isPlainTextRender, target >= 5000);
        assert.doesNotMatch(payload.tokenParts.rules, /从开篇开始|本篇小剧场的可读中文正文目标/);
        const fresh = await assemble('继续展开雨夜重逢，写8000字', { continuationText: '' });
        assert.ok(fresh.tokenParts.rules.includes(firstRoundGuidance(target)));
        assert.match(fresh.messages.find(message => message.sourceId === 'theater-task').content, /【单轮停笔要求】/);
        const split = await assemble('同一篇分轮写完，写8000字', { continuationText: '', longFormPlan: true, forcePlainText: true });
        assert.match(split.userPrompt, /本轮只创作前半部分/);
        assert.doesNotMatch(split.userPrompt, /【单轮停笔要求】/);
        assert.doesNotMatch(fresh.tokenParts.instruction, /本次续写任务/);
        assert.equal(fresh.isPlainTextRender, false);
    }
    for (const [planned, changed] of [[3, 1], [1, 3]]) {
        Object.assign(context.settings, { manualTargetChars: 20000, autoContinue: true, maxAutoRounds: planned });
        context.ensureSelectedPresetLoaded = async () => {
            await Promise.resolve();
            context.settings.maxAutoRounds = changed;
            return snapshot;
        };
        const payload = await assemble('继续写20000字', { continuationText: previous, maxContinuationRounds: planned });
        const job = runInNewContext(`${autoLine}\nlet currentGenerationJob; ${config}; currentGenerationJob`, {
            targetWordCount: payload.targetWordCount, settings: context.settings, isStagedRenderTarget,
            configuredMaxRounds: planned, stagedMultiRoundMode: false, createGenerationJob,
        });
        assert.equal(context.settings.maxAutoRounds, changed);
        assert.equal(job.maxRounds, planned);
        assert.ok(payload.tokenParts.rules.includes(continuationFirstRoundGuidance(20000, { maxRounds: job.maxRounds })));
    }
});

test('普通续写后续轮以本次新增计数，不把引用的旧正文当作完成目标', () => {
    for (const target of [4000, 20000]) {
        const draft = '旧前情'.repeat(3000) + '\n本次首轮新增正文';
        const prompt = buildContinuationInstruction({
            round: 2, targetChars: target, currentChars: 1200, roundsRemaining: 2,
            continuationTask: true, draft, finishThisRound: false,
        });
        assert.match(prompt, /本次续写任务的第 2 轮/);
        assert.match(prompt, /程序已统计本次各轮新增约 1200 字/);
        assert.match(prompt, new RegExp(`仍需新增约 ${target - 1200} 字`));
        assert.match(prompt, /不要依据引用长度判断本次已经写够/);
        assert.ok(prompt.includes(draft));
        assert.doesNotMatch(prompt, /只输出新增正文片段/);
        const final = buildContinuationInstruction({ round: 3, targetChars: target, currentChars: 1200,
            continuationTask: true, draft, finishThisRound: true });
        assert.match(final, /允许收尾不代表可以忽略篇幅要求/);
        const normal = buildContinuationInstruction({ round: 2, targetChars: target, currentChars: 1200, draft });
        assert.match(normal, /程序已统计当前可读正文约 1200 字/);
        assert.doesNotMatch(normal, /本次续写篇幅/);
    }
});

test('动态收束轮正常完成但不足 90% 时继续补写，不把允许收尾当作达标', () => {
    const job = createGenerationJob({ targetChars: 1000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(500), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(shouldAuthorizeFinishRound(job, readableCharCount), true);
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '字'.repeat(300), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(job.actualChars, 800);
    assert.equal(job.completedBelowTarget, false);
    assert.equal(job.round, 2);
    job.round++;
    addGenerationSegment(job, '字'.repeat(100), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.actualChars, 900);
});

test('真实生成循环的普通续写不在两万目标的一万一千字处提前停止', async () => {
    const source = readTheaterImplementation();
    const start = source.indexOf("        let firstHtml = '';", source.indexOf('async function runGeneration('));
    const end = source.indexOf('        let newText =', start);
    assert.ok(start > 0 && end > start);
    const loop = source.slice(start, end);
    for (const scenario of [
        { enabled: true, max: 5, chunks: [10000, 1000, 3000, 4000], expected: 18000 },
        { enabled: true, max: 3, chunks: [10000, 1000, 1000], expected: 12000 },
        { enabled: false, max: 5, chunks: [10000], expected: 10000 },
    ]) {
        const requests = [], prompts = [];
        const job = createGenerationJob({ targetChars: 20000, maxRounds: scenario.enabled ? scenario.max : 1,
            autoContinue: scenario.enabled, requireTargetCompletion: false });
        const run = runInNewContext('(async () => {' + loop + '\n})', {
            generationJob: job, generationAbortController: new AbortController(), ownsGeneration: () => true,
            currentGenerationJob: job, payload: { systemPrompt: '系统', userPrompt: '续写要求', ctx: {}, generationFoundation: {} },
            isPlainTextRender: true, stagedMultiRoundMode: false,
            targetWordCount: 20000, popupAlive: () => false,
            apiRoute: {}, settings: {}, lastRequestMetrics: {}, abortController: null,
            onChunk() {}, markCompleted() {}, recordRequestMetrics() {}, runtimeLog() {},
            requestConfiguredGenerationApi: async options => {
                const size = scenario.chunks[requests.length];
                assert.ok(size, '不得超出达标或总轮数边界继续请求');
                requests.push(options);
                return { text: '字'.repeat(size), stopReason: 'stop' };
            },
            htmlToPlainText: html => html.replace(/<[^>]*>/g, ''),
            readableCharCount, addGenerationSegment, shouldContinueJob,
            shouldAuthorizeFinishRound, authorizeFinish, buildContinuationInstruction,
            continuationRoundHistory, recentGenerationRoundsContext,
            prepareContinuationContext: text => text,
            continuationRun: { source: { rounds: ['已有前情'.repeat(10000)] } },
            contCtx: '已有前情'.repeat(10000),
            buildGenerationContinuationRoundPayload: ({ instruction }) => {
                prompts.push(instruction);
                return { systemPrompt: '系统', userPrompt: instruction, ctx: {} };
            },
            streamRenderer: { reset() {} }, DOMException,
        });
        await run();
        assert.equal(requests.length, scenario.chunks.length);
        assert.equal(readableCharCount(job.segments.join('\n\n')), scenario.expected);
        assert.equal(job.completedBelowTarget, false);
        for (const prompt of prompts) {
            assert.match(prompt, /允许收尾不代表可以忽略篇幅要求/);
            assert.doesNotMatch(prompt, /如果故事已经完成，就直接结束|本轮继续推进有效情节/);
            assert.match(prompt, /不得撤销已经发生的结局/);
        }
        if (prompts.length > 1) {
            assert.match(prompts[1], /本次各轮新增约 11000 字/);
            assert.doesNotMatch(prompts[1], /已有前情/);
            assert.ok(prompts[1].includes('字'.repeat(10000) + '\n\n' + '字'.repeat(1000)));
        }
    }
});

test('达到自动补写总轮数但字数不足时，结果提示明确原因且保留续写入口', () => {
    const source = readTheaterImplementation();
    const start = source.indexOf('function updateLengthHint(');
    const end = source.indexOf('function continuationSessionHTML(', start);
    const hint = { length: 1, value: '', hide() { return this; }, empty() { return this; },
        text(value) { this.value = value; return this; }, toggleClass() { return this; }, show() { return this; } };
    const update = runInNewContext(source.slice(start, end) + '\nupdateLengthHint', {
        $: () => hint, targetCompletionChars,
    });
    update(20000, 12000, { maxRoundsReached: true });
    assert.match(hint.value, /已达到自动补写总轮数上限，仍未达到目标/);
    assert.match(hint.value, /已保留正文.*续写/);
    update(20000, 18000, { maxRoundsReached: true });
    assert.doesNotMatch(hint.value, /仍未达到目标/);
    update(20000, 12000);
    assert.doesNotMatch(hint.value, /总轮数上限/);
});

test('动态收束轮若被 Token 截断，仍可在轮数范围内继续', () => {
    const job = createGenerationJob({ targetChars: 1000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(500), 'stop');
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '字'.repeat(300), 'length');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(job.completedBelowTarget, false);
});

test('第二至第五轮只携带最近两轮完整正文，长轮开头原话不被截断且时序不颠倒', () => {
    const first = '第一轮开头：录音原话「明天见」。' + '第一轮正文'.repeat(1800) + '第一轮结尾。';
    const second = '第二轮开头。' + '第二轮正文'.repeat(1800) + '第二轮结尾。';
    const third = '第三轮开头。第三轮结尾。';
    const fourth = '第四轮开头。第四轮结尾。';
    const cases = [
        { completed: [first], expected: first, excluded: [] },
        { completed: [first, second], expected: first + '\n\n' + second, excluded: [] },
        { completed: [first, second, third], expected: second + '\n\n' + third, excluded: ['第一轮开头', '第一轮结尾'] },
        { completed: [first, second, third, fourth], expected: third + '\n\n' + fourth, excluded: ['第一轮开头', '第二轮开头'] },
    ];
    for (const { completed, expected, excluded } of cases) {
        const before = [...completed];
        const draft = recentGenerationRoundsContext(completed);
        assert.equal(draft, expected);
        assert.deepEqual(completed, before);
        for (const manuscriptMode of [false, true]) {
            const instruction = buildContinuationInstruction({
                round: completed.length + 1, draft, manuscriptMode,
                originalInstruction: 'INITIAL_TASK_MARKER', finishThisRound: true,
            });
            const payload = buildContinuationPayload({ instruction, manuscriptMode });
            assert.ok(payload.userPrompt.includes(expected));
            excluded.forEach(marker => assert.ok(!payload.userPrompt.includes(marker)));
            assert.ok(payload.userPrompt.indexOf(expected) < payload.userPrompt.indexOf('请从已有正文') || !manuscriptMode);
            // Preserve the pre-existing distinction; do not re-add the initial task to ordinary continuation.
            assert.equal(payload.userPrompt.includes('INITIAL_TASK_MARKER'), manuscriptMode);
            assert.match(payload.userPrompt, /原话时须保留原文/);
            assert.doesNotMatch(payload.userPrompt, /更早内容已省略/);
        }
    }
    assert.equal(recentGenerationRoundsContext([]), '');
});

test('5000 字起同一稿件补完轮未达到 90% 时不能提前交卷', () => {
    const job = createGenerationJob({
        targetChars: 5000,
        maxRounds: 3,
        minimumRounds: 2,
        autoContinue: true,
        requireTargetCompletion: true,
    });
    addGenerationSegment(job, '字'.repeat(2900), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '字'.repeat(1000), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(job.actualChars, 3900);
    assert.equal(job.completedBelowTarget, false);
    job.round++;
    addGenerationSegment(job, '字'.repeat(600), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.actualChars, 4500);
});

test('同一稿件的非收束轮意外跨过 90% 时仍保留最终补完轮', () => {
    const job = createGenerationJob({
        targetChars: 5000,
        maxRounds: 3,
        minimumRounds: 2,
        autoContinue: true,
        requireTargetCompletion: true,
    });
    addGenerationSegment(job, '字'.repeat(1700), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(shouldAuthorizeFinishRound(job, readableCharCount), false);
    job.round++;
    authorizeFinish(job, false);
    addGenerationSegment(job, '字'.repeat(2800), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(job.actualChars, 4500);
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '最终落点', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('最大轮数较多时一旦进入最终补完，后续轮也不能退回作品中段', () => {
    const job = createGenerationJob({
        targetChars: 5000,
        maxRounds: 4,
        minimumRounds: 2,
        autoContinue: true,
        requireTargetCompletion: true,
    });
    addGenerationSegment(job, '字'.repeat(2500), 'stop');
    assert.equal(shouldAuthorizeFinishRound(job, readableCharCount), true);
    authorizeFinish(job, true);
    job.round++;
    addGenerationSegment(job, '字'.repeat(100), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(shouldAuthorizeFinishRound(job, readableCharCount), false);
    authorizeFinish(job, false);
    assert.equal(job.finishAuthorized, true);
    const prompt = buildContinuationInstruction({
        round: 3,
        draft: '同一稿件已有正文',
        manuscriptMode: true,
        finishThisRound: job.finishAuthorized,
        currentChars: job.actualChars,
        targetChars: job.targetChars,
        roundsRemaining: 2,
    });
    assert.match(prompt, /最终正文补完轮/);
    assert.doesNotMatch(prompt, /继续完成作品中段/);
});

test('普通续写和同一稿件补完进入收尾后均不退回中段', () => {
    const ordinaryJob = createGenerationJob({ targetChars: 4000, maxRounds: 3, autoContinue: true });
    authorizeFinish(ordinaryJob, true);
    authorizeFinish(ordinaryJob, false);
    assert.equal(ordinaryJob.finishAuthorized, true);

    const manuscriptJob = createGenerationJob({
        targetChars: 5000,
        maxRounds: 3,
        minimumRounds: 2,
        autoContinue: true,
        requireTargetCompletion: true,
    });
    authorizeFinish(manuscriptJob, true);
    authorizeFinish(manuscriptJob, false);
    assert.equal(manuscriptJob.finishAuthorized, true);
});

test('长篇上下篇至少执行两轮，即使上篇字数已碰到整篇阈值', () => {
    const job = createGenerationJob({ targetChars: 8000, maxRounds: 2, minimumRounds: 2, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(8000), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round = 2;
    addGenerationSegment(job, '下篇收束', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('普通目标字数仍可在首轮达标后停止', () => {
    const job = createGenerationJob({ targetChars: 4000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(4000), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('多轮正文的最终 HTML 排版要求完整保留正文', () => {
    const payload = buildFinalRenderPayload({ sourceText: '第一段。\n\n第二段。', rules: '输出完整 HTML。' });
    assert.match(payload.systemPrompt, /不续写、不删减、不改写/);
    assert.deepEqual(payload.placeholderPlan.paragraphs.map(item => item.text), ['第一段。', '第二段。']);
    assert.match(payload.userPrompt, /段落占位|token/);
    assert.match(payload.userPrompt, /输出完整 HTML/);
});

test('达到最大轮数或用户停止后不再续写', () => {
    const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(1000), 'length');
    job.round = 3;
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    job.round = 1;
    abortGenerationJob(job);
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('5000 字首轮 1700 字，无论正常停止或长度停止都继续', () => {
    for (const reason of ['stop', 'length']) {
        const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
        addGenerationSegment(job, '字'.repeat(1700), reason);
        assert.equal(shouldContinueJob(job, readableCharCount), true);
    }
});

test('三轮仍不足时绝不进入第四轮', () => {
    const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    job.round = 2;
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    job.round = 3;
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.segments.length, 3);
});

test('没有目标字数时只生成一轮', () => {
    const job = createGenerationJob({ targetChars: null, maxRounds: 10, autoContinue: true });
    addGenerationSegment(job, '普通内容', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('短稿只写一轮，5000起不再按8000阈值降低用户轮数上限', () => {
    const source = readTheaterImplementation();
    const autoLine = source.match(/const autoTargetContinue = .*;/)[0];
    const config = source.match(/(?:runtime\.)?currentGenerationJob = createGenerationJob\(\{[\s\S]*?\}\);/)[0];
    for (const target of [0, 4999, 5000, 7000, 8000, 9000, 20000]) {
        for (const enabled of [false, true]) for (const max of [1, 3, 5]) {
            const job = runInNewContext(`${autoLine}\nlet currentGenerationJob; ${config}; currentGenerationJob`, {
                targetWordCount: target, settings: { autoContinue: enabled }, isStagedRenderTarget,
                configuredMaxRounds: max, stagedMultiRoundMode: target >= 5000 && enabled && max >= 2,
                createGenerationJob,
            });
            assert.equal(job.maxRounds, target >= 5000 && enabled ? max : 1);
            assert.equal(job.minimumRounds, target >= 5000 && enabled && max >= 2 ? 2 : 1);
            addGenerationSegment(job, '短稿', 'stop');
            assert.equal(shouldContinueJob(job, readableCharCount), target >= 5000 && enabled && max > 1);
        }
    }
    for (const target of [5000, 7000, 8000, 9000]) {
        const job = createGenerationJob({ targetChars: target, maxRounds: 5, minimumRounds: 2, autoContinue: true, requireTargetCompletion: true });
        addGenerationSegment(job, '字'.repeat(1000), 'stop'); job.round = 2;
        assert.equal(shouldContinueJob(job, readableCharCount), true);
        authorizeFinish(job); addGenerationSegment(job, '字'.repeat(target), 'stop');
        assert.equal(shouldContinueJob(job, readableCharCount), false);
    }
});

test('收尾轮剩的字数太少时不再说“新增约 0 字”，改为留出写完结尾的篇幅；其他轮原样', async () => {
    const { finishRoundFloorChars } = await import('../length-policy.js');
    assert.equal(finishRoundFloorChars(6000), 900);
    assert.equal(finishRoundFloorChars(3000), 800);
    assert.equal(finishRoundFloorChars(10000), 1500);
    assert.equal(finishRoundFloorChars(20000), 2000);
    assert.equal(finishRoundFloorChars(0), 0);
    const base = { round: 2, finishThisRound: true, targetChars: 6000, roundsRemaining: 1, manuscriptMode: true, draft: '……' };
    for (const currentChars of [5600, 6300]) {
        const text = buildContinuationInstruction({ ...base, currentChars });
        assert.doesNotMatch(text, /新增约 0 字|新增约 500 字|仍差约/);
        assert.match(text, /本轮不再追字数，请用约 900 字把剩下的情节和结尾写完整，不要为了控制篇幅压缩结尾/);
        assert.match(text, currentChars >= 6000 ? /已达到目标/ : /已接近目标/);
    }
    const cont = buildContinuationInstruction({ ...base, manuscriptMode: false, continuationTask: true, currentChars: 5800 });
    assert.match(cont, /【本次续写篇幅】.*已接近目标.*旧正文、聊天前文和参考资料均不计入目标.*请用约 900 字/);
    // 剩得够多的收尾轮、非收尾轮：一字不变
    assert.match(buildContinuationInstruction({ ...base, currentChars: 3000 }), /仍差约 3000 字。本轮请新增约 3600 字的有效正文/);
    assert.match(buildContinuationInstruction({ ...base, finishThisRound: false, roundsRemaining: 2, currentChars: 5600 }), /仍差约 400 字。本轮请新增约 300 字的有效正文/);
});
