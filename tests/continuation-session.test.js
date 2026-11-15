// 从 core.test.js 拆出：continuation-session
import { continuationHistoryMetadata, planHistorySave } from '../history-collections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { createHistoryArchive, createHistoryJsonBackup, historyItemsFromArchive, normalizeHistoryBackup } from '../history-backup.js';
import { itemTags, mergeTagLists, normalizeTagList } from '../tag-system.js';
import { normalizeContinuationRounds, continuationRoundHistory, createContinuationSession, appendContinuationVersion, selectContinuationVersion, displayedContinuationVersion } from '../continuation-session.js';

test('普通续写重写保留前情和所有候选，选回旧版恢复其方向，接写须显式创建下一段', () => {
    const session = createContinuationSession({ sourceText: '原始前情', sourceLabel: '原篇', direction: '去车站' });
    const first = appendContinuationVersion(session, { html: '<p>第一版</p>', text: '第一版', mode: 'html' });
    session.direction = '留在原地';
    const second = appendContinuationVersion(session, { html: '<p>第二版</p>', text: '第二版', complete: false });
    assert.equal(session.source.text, '原始前情');
    assert.throws(() => { session.source.text = '第二版'; }, TypeError);
    assert.equal(session.versions.length, 2);
    assert.equal(second.complete, false);
    assert.equal(selectContinuationVersion(session, 0), first);
    assert.equal(session.direction, '去车站');
    assert.equal(displayedContinuationVersion(session, '<p>第二版</p>'), second);
    assert.equal(displayedContinuationVersion(session, '<p>别的历史</p>'), null);
    assert.equal(selectContinuationVersion(session, 9), null);
    assert.equal(session.selected, 0);
    assert.equal(appendContinuationVersion(session, { html: '' }), null);
    const next = createContinuationSession({ sourceText: first.text, segment: session.segment + 1 });
    assert.equal(next.source.text, '第一版');
    assert.equal(next.segment, 2);
    assert.equal(next.direction, '');
    assert.equal(next.versions.length, 0);
    assert.equal(session.versions.length, 2);
});

test('普通续写入口不依赖弹窗标记，重写重复使用原始前情并允许空方向', async () => {
    const source = readTheaterImplementation();
    const generate = source.match(/async function (?:runtime\.)?generateTheater\([^]*?^}/m)[0];
    const session = createContinuationSession({ sourceText: '固定前情' });
    let input = '第一次方向';
    const calls = [];
    const context = {
        isGenerating: false, isPreparingGeneration: false,
        longDreamGenerationController: null, longDreamChapterEditController: null,
        longDreamCanonSuggestionState: {}, resultEditSnapshot: null,
        continuationSession: session, continueContext: '', continuationSourceTags: ['原标签'],
        settings: {}, activeInstructionContent: '', activeInstructionTags: [],
        $: selector => ({ length: 0, val: () => input }),
        save() {}, toastr: { warning: assert.fail, error: assert.fail }, console,
        runGeneration: async (instruction, auto, tags) => calls.push({ instruction, auto, tags, source: context.continueContext }),
    };
    runInNewContext(generate + '\nglobalThis.generate = generateTheater;', context);
    await context.generate();
    appendContinuationVersion(session, { html: '<p>新结果</p>', text: '新结果' });
    input = '';
    context.continueContext = '模拟已丢失的旧状态';
    await context.generate();
    assert.deepEqual(calls.map(call => call.source), ['固定前情', '固定前情']);
    assert.equal(calls[0].instruction, '第一次方向');
    assert.match(calls[1].instruction, /自然续写/);
    assert.equal(session.direction, '');
    assert.deepEqual(calls[1].tags, ['原标签']);
});

test('手动续写与内部补写沿同一两轮窗口滚动，重写候选不串入前情', () => {
    const a = '第一轮信件原文' + '甲'.repeat(9000);
    const b = '第二轮对白' + '乙'.repeat(12000);
    const c = '第三轮正文';
    const initial = createContinuationSession({ sourceText: a });
    assert.equal(initial.source.text, a);
    assert.equal(initial.source.rounds.length, 1);
    const first = appendContinuationVersion(initial, { html: '<main>B</main>', text: b,
        continuationRounds: continuationRoundHistory(initial.source.rounds, [b]) });
    appendContinuationVersion(initial, { html: '<main>另一版</main>', text: '不应带入的另一版',
        continuationRounds: continuationRoundHistory(initial.source.rounds, ['不应带入的另一版']) });
    const next = createContinuationSession({ sourceText: first.text, sourceRounds: first.continuationRounds });
    assert.deepEqual(next.source.rounds, [a, b]);
    assert.equal(next.source.text, a + '\n\n' + b);
    assert.ok(next.source.text.length > 20000);
    assert.deepEqual(continuationRoundHistory(next.source.rounds, [c]), [b, c]);
    assert.deepEqual(continuationRoundHistory(next.source.rounds, [c, '第四轮']), [c, '第四轮']);
    assert.deepEqual(initial.source.rounds, [a]);
    assert.ok(Object.isFrozen(next.source.rounds));
    assert.deepEqual(normalizeContinuationRounds([null, 123, {}, '', a, b, c]), [b, c]);
});

test('普通续写入口直接携带两轮完整纯正文，不再截断8000字', () => {
    const source = readTheaterImplementation();
    const prepare = source.match(/function prepareContinuationContext\(value\) \{[\s\S]*?\n\}/)[0];
    const start = source.match(/function (?:runtime\.)?startContinue\(html,[\s\S]*?\n\}/)[0];
    const a = '甲'.repeat(9500), b = '乙'.repeat(11000);
    const jq = { click() { return this; }, val() { return this; }, attr() { return this; }, text() { return this; }, show() { return this; }, hide() { return this; } };
    const context = { isGenerating: false, isPreparingGeneration: false, resultEditSnapshot: null,
        htmlToPlainText: html => html.replace(/<[^>]*>/g, ''), normalizeContinuationRounds, createContinuationSession, continuationHistoryMetadata, currentOutputMode: 'html',
        itemTags: ({tags}) => tags, knownInstructionTags: () => [], clearDisplayedResult() {}, updateContinueHint() {},
        switchResultWorkspace() {}, revealContinuationInput() {}, scheduleTokenEstimate() {}, $: () => jq, toastr: { warning() {}, info() {} },
        inputHtml: `<main>${b}</main>`, prior: [a, b],
    };
    const result = runInNewContext(`${prepare}\n${start}\nstartContinue(inputHtml, [], {sourceRounds: prior}); continuationSession`, context);
    assert.equal(result.source.text, a + '\n\n' + b);
    assert.equal(result.source.rounds.length, 2);
    assert.doesNotMatch(result.source.text, /更早内容已省略/);
});

test('两轮完整正文通过JSON及ZIP历史备份恢复，旧作品不虚构前轮', () => {
    const rounds = ['前轮' + '甲'.repeat(9000), '当前轮' + '乙'.repeat(11000)];
    const record = { title: '续写作品', html: '<main>当前作品</main>', continuationRounds: rounds, tags: ['标签'] };
    const json = normalizeHistoryBackup(JSON.parse(JSON.stringify(createHistoryJsonBackup([record]))));
    assert.deepEqual(json[0].continuationRounds, rounds);
    const archive = createHistoryArchive([record]);
    const restored = historyItemsFromArchive(JSON.parse(JSON.stringify(archive.manifest)), archive.files);
    assert.deepEqual(restored[0].continuationRounds, rounds);
    const old = normalizeHistoryBackup([{html:'<main>旧作品</main>'}])[0];
    assert.deepEqual(old.continuationRounds, []);
    assert.deepEqual(createContinuationSession({sourceText:'旧作品',sourceRounds:old.continuationRounds}).source.rounds, ['旧作品']);
});

test('普通新稿第三轮中断后保存再续写只带第二轮和未完成第三轮', async () => {
    const source = readTheaterImplementation();
    const retain = source.match(/(?:runtime\.)?retainedResultSource = \{\s*html: (?:runtime\.)?lastGeneratedHtml, mode: (?:runtime\.)?currentOutputMode, instruction,[\s\S]*?\n            \};/)[0];
    const saveSource = source.match(/async function (?:runtime\.)?saveToHistory\([^)]*\)[^]*?^}/m)[0];
    const rounds = ['第一轮' + '甲'.repeat(9000), '第二轮' + '乙'.repeat(9000)];
    const live = '第三轮未完成' + '丙'.repeat(4000);
    let saved;
    const context = { currentGenerationResult: null, resultEditSnapshot: null, lastGeneratedHtml: '<main>中断保留正文</main>', currentDisplayHtml: '', currentOutputMode:'text',
        retainedResultSource:null, singleHtmlLayoutRetry:null, layoutSource:null, generationRoles:[], instruction:'创作指令', sourceTags:['标签'], generationSourceConfig:{},
        continuationRun:null, currentGenerationJob:{segments:rounds}, liveBodyText:live, recoveredText:'',
        continuationRoundHistory, prepareContinuationContext:value=>value.trim(), normalizeContinuationRounds,
        continuationSession:null, displayedContinuationVersion:()=>null, recentCache:[], historyCache:[],
        activeInstructionTags:[], knownInstructionTags:()=>['标签'], itemTags, mergeTagLists, normalizeTagList,
        chooseTagsWithNew:async()=>({name:'中断作品',tags:['标签'],newTags:[]}),
        planHistorySave, commitHistoryCollection:async change=>{saved=change([], []).saved;return true;},settings:{instructionTags:['标签']},
        save(){},refreshHistList(){},toastr:{success(){}},$:()=>({val:()=>''}),
    };
    await runInNewContext(`${retain}\n${saveSource}\nsaveToHistory();`,context);
    assert.deepEqual(Array.from(saved.continuationRounds),[rounds[1],live]);
    const restored=normalizeHistoryBackup(createHistoryJsonBackup([saved]))[0];
    const session=createContinuationSession({sourceText:'整篇旧正文',sourceRounds:restored.continuationRounds});
    assert.equal(session.source.text,rounds[1]+'\n\n'+live);
    assert.doesNotMatch(session.source.text,/第一轮/);
});
