// 从 core.test.js 拆出：context-exclusions
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { STORY_RELATION_CONTINUITY_RULE, buildGenerationPayload } from '../generation-payload.js';
import { continuationFirstRoundGuidance, isStagedRenderTarget } from '../length-policy.js';
import { normalizeContextRange, takeRecentMessages } from '../context-policy.js';
import { createChatContextReader, normalizeContextExclusionRules, previewChatContext, validateContextExclusionRule } from '../context-exclusions.js';

const EXCLUSION_TEST_FOOTER = '<p><span style="display:block; text-align:center; color:#999999; font-size:0.9em;">✦ 人间藏万相 · 灯火照众生 ✦</span></p>';

test('固定收尾只精确排除目标 HTML，保留正常 p/span、重复匹配、标点和原消息', () => {
    const story = '<p>故事第一段</p><span>正常正文</span>';
    const original = story + EXCLUSION_TEST_FOOTER + EXCLUSION_TEST_FOOTER;
    const rules = [{ type: 'literal', value: EXCLUSION_TEST_FOOTER }];
    const result = previewChatContext(original, rules);
    assert.equal(result.text, story);
    assert.equal(result.removed, 2);
    assert.equal(original, story + EXCLUSION_TEST_FOOTER + EXCLUSION_TEST_FOOTER);
    assert.equal(createChatContextReader(rules)(original), result.text);
    assert.equal(previewChatContext('甲.*乙', [{ type: 'literal', value: '.*' }]).text, '甲乙');
    assert.equal(previewChatContext('甲.乙', [{ type: 'literal', value: '.*' }]).text, '甲.乙');
    assert.equal(previewChatContext('甲 x 乙 x', [{ type: 'literal', value: ' x ' }]).text, '甲乙 x');
});

test('标签排除支持属性、同名嵌套、重复、自闭合和大小写，保留未闭合与相似名字', () => {
    const rules = [{ type: 'tag', value: '<anti_cut>' }];
    const input = '甲<ANTI_CUT data-note="a > b">外<anti_cut>内</anti_cut>尾</ANTI_CUT>乙<anti_cut />丙<anti_cut-other>留</anti_cut-other><anti_cut>未闭合';
    const result = previewChatContext(input, rules);
    assert.equal(result.text, '甲乙丙<anti_cut-other>留</anti_cut-other><anti_cut>未闭合');
    assert.equal(result.removed, 2);
    assert.equal(result.unclosed, 1);
    const embedded = '<!-- <anti_cut>注释</anti_cut> --><script>const s="<anti_cut>字符串</anti_cut>";</script>';
    assert.equal(previewChatContext(embedded + '<anti_cut>排除</anti_cut>', rules).text, embedded);
});

test('空规则和停用保持旧正文读取；排除先于 content 选取，规则读取使用快照', () => {
    const input = '<content> 正文 </content><p>原有尾部</p>';
    assert.equal(createChatContextReader()(input), '正文');
    assert.equal(createChatContextReader()('普通消息'), '普通消息');
    const rules = [{ type: 'tag', value: 'anti_cut', enabled: false }];
    const body = '甲<anti_cut>噪声</anti_cut>乙';
    assert.equal(createChatContextReader(rules)(body), body);
    rules[0].enabled = true;
    const read = createChatContextReader(rules);
    rules[0].value = 'p';
    assert.equal(read(body), '甲乙');
    assert.equal(read('<anti_cut><content>假正文</content></anti_cut><content>真正文</content>'), '真正文');
    assert.equal(previewChatContext(EXCLUSION_TEST_FOOTER, [{ type: 'literal', value: EXCLUSION_TEST_FOOTER }]).text, '');
    assert.ok(validateContextExclusionRule({ type: 'tag', value: 'p|span' }).error);
    assert.ok(validateContextExclusionRule({ type: 'literal', value: '   ' }).error);
    assert.deepEqual(normalizeContextExclusionRules([null, {}, { type: 'unknown', value: 'x' }]), []);
});

test('前文排除同时进入预估、正式消息和世界书扫描，不改角色、世界书、指令或续写', async () => {
    const source = readTheaterImplementation();
    const assembly = source.match(/async function assembleGenerationPayload\([^]*?^}/m)[0];
    const chat = [{ mes: '<p>正常段落</p>' + EXCLUSION_TEST_FOOTER, is_user: false }, { mes: EXCLUSION_TEST_FOOTER, is_user: true }];
    const before = JSON.stringify(chat);
    let scans = [];
    const snapshot = { prompt: '预设' + EXCLUSION_TEST_FOOTER, selectedEntries: [], name: '合成' };
    const context = {
        settings: { contextRange: 10, selectedWorldBooks: ['合成书'], worldBookReadMode: 'lights', contextExclusionRules: [{ type: 'literal', value: EXCLUSION_TEST_FOOTER }] },
        SillyTavern: { getContext: () => ({ chat, name1: 'User', name2: 'Char' }) },
        generationPreparationKey: () => 'stable',
        resolveGenerationIdentity: () => ({ character: {}, role: '角色' + EXCLUSION_TEST_FOOTER, persona: '人设', name1: 'User', name2: 'Char' }),
        normalizeContextRange, takeRecentMessages, createChatContextReader,
        wbEntries: [{ book: '合成书', uid: 1, content: '世界书' + EXCLUSION_TEST_FOOTER, raw: { world: '合成书', uid: 1 } }], wbStates: {},
        ensureWorldBooksCurrent: async () => {},
        scanWithCurrentSillyTavern: async args => { scans.push(args); return [{ world: '合成书', uid: 1 }]; },
        stripTargetWordCountRequirement: value => value,
        resolveRenderSelection: () => ({ isPlainTextRender: false, textTheme: 'light', rules: '规则' }),
        currentPresetSnapshot: () => snapshot, ensureSelectedPresetLoaded: async () => snapshot,
        DEFAULT_SYSTEM_PROMPT: '默认', prepareContinuationContext: value => value || '', continueContext: '续写' + EXCLUSION_TEST_FOOTER,
        resolveTargetWordCount: () => 0, buildProtagonistAnchor: () => '人物锚点', firstRoundGuidance: () => '节奏',
        continuationFirstRoundGuidance, isStagedRenderTarget,
        STORY_RELATION_CONTINUITY_RULE, buildGenerationPayload, generationIdentitySlots: () => ({}),
        composePresetMessages: options => [...options.chatMessages, ...options.taskMessages],
        freezeGenerationFoundationList: items => Object.freeze(items.map(item => Object.freeze({ ...item }))),
        runtimeLog() {},
    };
    const assemble = runInNewContext(assembly + '\nassembleGenerationPayload;', context);
    const instruction = '指令' + EXCLUSION_TEST_FOOTER;
    const full = await assemble(instruction);
    const estimate = await assemble(instruction, { loadPreset: false, evaluateWorldBook: false, estimateOnly: true });
    assert.deepEqual(estimate.tokenParts, full.tokenParts);
    assert.ok(full.messages.some(message => message.content.includes(STORY_RELATION_CONTINUITY_RULE)));
    assert.ok(full.tokenParts.rules.includes(STORY_RELATION_CONTINUITY_RULE));
    assert.equal(full.generationFoundation.chatMessages.length, 1);
    assert.equal(full.generationFoundation.chatMessages[0].content, '<p>正常段落</p>');
    assert.doesNotMatch(full.tokenParts.context, /人间藏万相/);
    for (const key of ['preset', 'role', 'worldBook', 'instruction', 'continuation']) assert.ok(full.tokenParts[key].includes(EXCLUSION_TEST_FOOTER), key);
    assert.ok(scans[0].chatWithNames[0].includes(EXCLUSION_TEST_FOOTER));
    assert.ok(scans[0].chatWithoutNames[0].includes(EXCLUSION_TEST_FOOTER));
    assert.deepEqual(Array.from(scans[0].chatWithoutNames.slice(1)), ['', '<p>正常段落</p>']);
    assert.ok(scans[0].chatWithNames.slice(1).every(text => !text.includes('人间藏万相')));
    assert.equal(JSON.stringify(chat), before);
});
