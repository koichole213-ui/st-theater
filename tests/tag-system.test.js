// 从 core.test.js 拆出：tag-system
import { planHistorySave } from '../history-collections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { autoSourceLabel, resolveAutoInstruction } from '../auto-mode.js';
import { TAG_UNCATEGORIZED, itemTags, matchesTagFilter, mergeTagLists, migrateLegacyTagSettings, normalizeTagList, removeTagFromList, renameTagInList } from '../tag-system.js';
import { normalizeContinuationRounds } from '../continuation-session.js';

test('删除或改名旧分类标签后，多次初始化不再把旧分组名补回', () => {
    for (const rename of [false, true]) {
        const settings = {
            instructionGroups: ['旧分类', '未使用旧组'],
            instructionTemplates: [{ name: '合成模板', content: '合成内容', group: '旧分类' }],
        };
        migrateLegacyTagSettings(settings);
        const transform = tags => rename ? renameTagInList(tags, '旧分类', '新分类') : removeTagFromList(tags, '旧分类');
        settings.instructionTags = removeTagFromList(transform(settings.instructionTags), '未使用旧组');
        settings.instructionTemplates.forEach(item => { item.tags = transform(item.tags); });
        for (let i = 0; i < 3; i++) migrateLegacyTagSettings(settings);
        assert.deepEqual(settings.instructionTags, rename ? ['新分类'] : []);
        assert.deepEqual(settings.instructionTemplates[0].tags, rename ? ['新分类'] : []);
        assert.equal(settings.instructionTemplates[0].content, '合成内容');
        assert.deepEqual(settings.instructionGroups, ['旧分类', '未使用旧组']);
    }
});

test('自动模式按多标签交集抽取，并给空来源稳定信号', () => {
    const missing = resolveAutoInstruction({ source: '__last__', lastInstruction: '' });
    assert.equal(missing.text, '');
    assert.equal(missing.signal, 'T-AUTO-NO-INSTRUCTION');

    const resolved = resolveAutoInstruction({
        source: '__all__',
        templates: [{ content: '' }, { content: '  有效指令  ' }],
        random: () => 0,
    });
    assert.equal(resolved.text, '有效指令');
    assert.equal(resolved.candidateCount, 1);
    assert.equal(resolved.signal, null);

    const tagged = resolveAutoInstruction({
        source: '__tags__', tags: ['角色甲', '甜饼', '刀子'], tagFilter: ['角色甲', '甜饼'],
        templates: [
            { tags: ['角色甲', '刀子'], content: '不应抽到' },
            { tags: ['角色甲', '甜饼'], content: '命中模板' },
        ],
        random: () => 0,
    });
    assert.equal(tagged.text, '命中模板');
    assert.deepEqual(tagged.tags, ['角色甲', '甜饼']);

    const missingTags = resolveAutoInstruction({ source: '__tags__', tags: ['角色甲'], tagFilter: [], templates: [{ tags: ['角色甲'], content: '不应回退到全部' }] });
    assert.equal(missingTags.signal, 'T-AUTO-NO-INSTRUCTION');
    assert.equal(autoSourceLabel(TAG_UNCATEGORIZED), '随机·未分类模板');
});

test('旧分组设置升级为同名多标签并保留抽取与自动来源', () => {
    const settings = {
        instructionGroups: ['角色甲', '甜饼'],
        instructionGroupFilter: '角色甲',
        instructionTemplates: [{ name: '模板', content: '内容', group: '角色甲' }],
        randomScope: '甜饼', autoSource: '__none__', tagSchemaVersion: 0,
    };
    assert.equal(migrateLegacyTagSettings(settings), true);
    assert.deepEqual(settings.instructionTags, ['角色甲', '甜饼']);
    assert.deepEqual(settings.instructionTemplates[0].tags, ['角色甲']);
    assert.deepEqual(settings.instructionTagFilter, ['角色甲']);
    assert.equal(settings.randomScope, '__tags__');
    assert.deepEqual(settings.randomTagFilter, ['甜饼']);
    assert.equal(settings.autoSource, TAG_UNCATEGORIZED);
    assert.equal(matchesTagFilter(settings.instructionTemplates[0], ['角色甲'], settings.instructionTags), true);
    assert.equal(matchesTagFilter(settings.instructionTemplates[0], ['角色甲', '甜饼'], settings.instructionTags), false);
});

test('标签迁移会把大小写不同的模板标签归一到标签库名称', () => {
    const settings = {
        instructionTags: ['Sweet'],
        instructionTemplates: [{ name: '模板', content: '内容', tags: ['sweet'] }],
        tagSchemaVersion: 1,
    };
    migrateLegacyTagSettings(settings);
    assert.deepEqual(settings.instructionTags, ['Sweet']);
    assert.deepEqual(settings.instructionTemplates[0].tags, ['Sweet']);
});

test('保存小剧场在同一弹窗编辑标题与标签，成功后才登记新标签', async () => {
    const source = readTheaterImplementation();
    const saveSource = source.match(/async function (?:runtime\.)?saveToHistory\([^)]*\)[^]*?^}/m)?.[0];
    assert.ok(saveSource);

    const execute = async ({ selection, stored = true }) => {
        const calls = { picked: null, saved: null, settingsSaved: 0, refreshed: 0, notices: [] };
        const settings = { instructionTags: ['来源标签'] };
        const html = '<html><body>问卷结果</body></html>';
        const context = {
            currentGenerationResult: null, resultEditSnapshot: null,
            lastGeneratedHtml: html,
            currentDisplayHtml: '',
            currentOutputMode: 'html',
            continuationSession: null,
            retainedResultSource: null,
            recentCache: [{ html, mode: 'html', instruction: '来源指令', sourceConfig: { render: '沉浸互动' }, tags: ['来源标签'] }],
            historyCache: [],
            activeInstructionTags: ['当前输入标签'],
            settings,
            displayedContinuationVersion: () => null,
            knownInstructionTags: () => normalizeTagList(settings.instructionTags),
            itemTags,
            normalizeTagList,
            mergeTagLists,
            chooseTagsWithNew: async options => { calls.picked = options; return selection; },
            planHistorySave, commitHistoryCollection: async change => { calls.saved = change([], []).saved; return stored; },
            save: () => { calls.settingsSaved++; },
            refreshHistList: () => { calls.refreshed++; },
            toastr: { success: message => calls.notices.push(message) },
            $: () => ({ val: () => '当前输入指令' }),
        };
        context.normalizeContinuationRounds = normalizeContinuationRounds;
        runInNewContext(saveSource + '\nglobalThis.runSaveToHistory = saveToHistory;', context);
        await context.runSaveToHistory();
        return { calls, settings };
    };

    const success = await execute({ selection: { name: '问卷存档', tags: ['来源标签', '新标签'], newTags: ['新标签'] } });
    assert.equal(success.calls.picked.title, '保存小剧场');
    assert.equal(success.calls.picked.nameLabel, '标题');
    assert.deepEqual(Array.from(success.calls.picked.selected), ['来源标签']);
    assert.equal(success.calls.saved.title, '问卷存档');
    assert.deepEqual(Array.from(success.calls.saved.tags), ['来源标签', '新标签']);
    assert.equal(success.calls.saved.instruction, '来源指令');
    assert.deepEqual(success.settings.instructionTags, ['来源标签', '新标签']);
    assert.equal(success.calls.settingsSaved, 1);
    assert.equal(success.calls.refreshed, 1);
    assert.deepEqual(success.calls.notices, ['已保存 · 来源标签、新标签']);

    const cancelled = await execute({ selection: null });
    assert.equal(cancelled.calls.saved, null);
    assert.deepEqual(cancelled.settings.instructionTags, ['来源标签']);
    assert.equal(cancelled.calls.settingsSaved, 0);

    const unclassified = await execute({ selection: { name: '无标签存档', tags: [], newTags: [] } });
    assert.deepEqual(Array.from(unclassified.calls.saved.tags), []);
    assert.deepEqual(unclassified.calls.notices, ['已保存为未分类']);

    const failed = await execute({ selection: { name: '失败存档', tags: ['新标签'], newTags: ['新标签'] }, stored: false });
    assert.deepEqual(failed.settings.instructionTags, ['来源标签']);
    assert.equal(failed.calls.settingsSaved, 0);
    assert.equal(failed.calls.refreshed, 0);
});

test('导入目标标签会追加到原标签并按现有标签名称归一', () => {
    assert.deepEqual(
        mergeTagLists(['刀子', 'sweet'], ['角色甲', '甜饼', 'Sweet'], ['刀子', 'Sweet', '角色甲', '甜饼']),
        ['刀子', 'Sweet', '角色甲', '甜饼'],
    );
    assert.deepEqual(mergeTagLists([], ['__UNCATEGORIZED__', '甜饼'], []), ['甜饼']);
});

test('标签界面、历史未分类、数字触发间隔和渲染模板删除入口都接入主面板', () => {
    const source = readTheaterImplementation();
    const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(source, /id="theater-inst-tag-filter"/);
    assert.match(readFileSync(new URL('../history-ui.js', import.meta.url), 'utf8'), /id="theater-history-tag-filter"/);
    assert.match(source, /class="theater-history-tags">\$\{badges\}/);
    assert.match(source, /id="theater-auto-interval" type="number" min="1" max="50"/);
    assert.doesNotMatch(source, /id="theater-auto-interval" type="range"/);
    assert.match(source, /删除这个自定义模板/);
    assert.match(source, /内置模板不可删除/);
    assert.match(source, /async function (?:runtime\.)?chooseTagsWithNew/);
    assert.match(source, /class="theater-popup theater-compact-popup"/);
    assert.match(source, /class="theater-tag-choice-list is-compact"/);
    assert.match(source, /class="theater-tag-create-confirm theater-btn"/);
    assert.match(source, /function \(event\)[\s\S]*?event\.key !== 'Enter'[\s\S]*?addEnteredTag\(\)/);
    assert.match(source, /const newTags = tags\.filter\(tag => !known\.some/);
    assert.match(style, /\.theater-tag-choice-list\.is-compact\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    assert.match(style, /body \.popup:has\(\.theater-compact-popup\)[\s\S]*?width: min\(430px, calc\(100vw - 28px\)\) !important/);
    assert.match(style, /\.theater-compact-popup \.theater-popup-header[\s\S]*?text-align: left/);
    const saveTemplateFlow = source.match(/async function (?:runtime\.)?saveInstructionTpl\(\)[\s\S]*?async function (?:runtime\.)?bulkEditSelectedTemplateTags/)?.[0] || '';
    assert.doesNotMatch(saveTemplateFlow, /Popup\.show\.input/);
    assert.match(saveTemplateFlow, /title: '保存指令模板'[\s\S]*?templateName: defaultName[\s\S]*?name: selection\.name[\s\S]*?(?:runtime\.)?settings\.instructionTemplates\.push\(tpl\)/);
    assert.match(source, /给这 \$\{imported\.length\} 条导入模板统一加标签[\s\S]*?if \(target === null\) return;[\s\S]*?mergeTagLists\(item\.tags, target\.tags/);
    const popupBuilder = source.match(/function (?:runtime\.)?buildPopupHTML[\s\S]*?function (?:runtime\.)?historyItemHTML/)?.[0] || '';
    assert.match(popupBuilder, /const allHistory = (?:runtime\.)?historyCache;\s*const hist = initialTab === 'history' \? (?:runtime\.)?filterHistoryAll\(allHistory\) : \[\]/);
    assert.match(source, /没有符合条件的作品/);
    assert.match(source, /async function addHistoryItems[\s\S]*?commitHistoryCollection[\s\S]*?(?:runtime\.)?settings\.instructionTags = normalizeTagList[\s\S]*?(?:runtime\.)?save\(\);/);
    assert.match(source, /#theater-hist-batch-enter'\)\.toggle\(!(?:runtime\.)?histBatchMode\)/);
});
