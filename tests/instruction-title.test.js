// 从 core.test.js 拆出：instruction-title
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { recognizeInstructionTitle } from '../instruction-title.js';

test('手动指令标题只拆明确开头标记，支持同行配对标签及装饰', () => {
    for (const [input, name, content] of [
        ['# NPC的八卦论坛！\n\n$现在暂停当前剧情，生成番外。', 'NPC的八卦论坛！', '$现在暂停当前剧情，生成番外。'],
        ['<你的名字> 与正文剧情无关，分析{{char}}和{{user}}的名字。 \\</你的名字>', '你的名字', '与正文剧情无关，分析{{char}}和{{user}}的名字。'],
        ['【雨夜来信】\n保留作者：甲及完整指令。', '雨夜来信', '保留作者：甲及完整指令。'],
        ['✨ 雨夜来信 ✨\n完整内容', '雨夜来信', '完整内容'],
        ['标题：雨夜来信\r\n完整内容', '雨夜来信', '完整内容'],
    ]) assert.deepEqual(recognizeInstructionTitle(input), { name, content, recognized: true });
});

test('无标题、不明确标题、正文中间标题与占位符保持原文', () => {
    for (const input of [
        '请生成一个番外。\n保留所有要求。',
        '$现在暂停当前剧情。\n不要状态栏。',
        '普通开场\n# 中间的标题\n正文',
        '{{user}}和{{char}}一起出游。\n正文',
        '【写作要求】\n不要OOC。', '# 请严格遵守人设\n正文',
        '<div>正文</div>', '<你的名字>正文</其他名字>',
        '# 只有标题', '# 标题\n\n', '✨未闭合标题\n正文',
    ]) assert.deepEqual(recognizeInstructionTitle(input), { name: '', content: input.trim(), recognized: false });
});

test('存为模板保存识别结果与开关，无标题沿用编号默认名称且不改生成框', async () => {
    const source = readTheaterImplementation();
    const code = source.match(/async function (?:runtime\.)?saveInstructionTpl\(\) \{[^]*?^}/m)[0];
    for (const cancel of [false, true]) {
        const original = '没有标题的完整指令';
        const settings = { instructionTemplates: [{ name: '已有模板', content: '已有内容' }], instructionTags: [], autoRecognizeInstructionTitle: false };
        let saved = 0;
        const scope = { settings, TAG_UNCATEGORIZED: '未分类',
            $: () => ({ val: () => original }), knownInstructionTags: () => [], normalizeTagFilter: () => [],
            normalizeTagList: v => v, mergeTagLists: (_, tags) => tags,
            chooseTagsWithNew: async options => {
                assert.equal(options.templateName, '小剧场模板 2');
                assert.equal(options.instructionContent, original);
                return cancel ? null : { name: options.templateName, content: original, autoRecognizeTitle: true, tags: [], newTags: [] };
            }, save: () => saved++, refreshInstUI() {}, toastr: { success() {}, warning() {} },
        };
        await runInNewContext(code + '\nsaveInstructionTpl()', scope);
        assert.equal(settings.instructionTemplates.length, cancel ? 1 : 2);
        assert.equal(settings.autoRecognizeInstructionTitle, !cancel);
        assert.equal(saved, cancel ? 0 : 1);
        if (!cancel) {
            assert.equal(settings.instructionTemplates[1].name, '小剧场模板 2');
            assert.equal(settings.instructionTemplates[1].content, original);
        }
    }
});

test('标题识别开关预览可还原原文，手填名称不被切换覆盖，取消不保存', async () => {
    const source = readTheaterImplementation();
    const code = source.match(/async function (?:runtime\.)?chooseTagsWithNew\([^]*?^}/m)[0];
    async function run({ enabled = false, cancel = false, original = '# 标题\n完整内容', interact = () => {} } = {}) {
        const fields = new Map();
        const events = {};
        const field = key => {
            if (!fields.has(key)) fields.set(key, {
                value: '', checked: key === '[data-instruction-title-auto]' && enabled,
                val(value) { if (value === undefined) return this.value; this.value = value; return this; },
                text(value) { this.label = value; return this; },
                is() { return this.checked; }, on(event, fn) { this[event] = fn; return this; },
                get() { return []; }, map() { return { get: () => [] }; },
            });
            return fields.get(key);
        };
        let resolve;
        class Popup { constructor() { this.dlg = {}; } show() { return new Promise(r => { resolve = r; }); } }
        const settings = { autoRecognizeInstructionTitle: enabled };
        const scope = { settings, recognizeInstructionTitle, SillyTavern: { getContext: () => ({ Popup, POPUP_TYPE: { CONFIRM: 1 } }) },
            knownInstructionTags: () => [], normalizeTagFilter: () => [], normalizeTagList: v => v.filter(Boolean),
            cleanTagName: v => String(v || '').trim(), TAG_UNCATEGORIZED: '未分类', esc: v => String(v),
            $: () => ({ find: field, on(event, selector, fn) { events[selector] = fn; } }),
            toastr: { warning() { throw new Error('unexpected warning'); } }, original,
        };
        const pending = runInNewContext(code + '\nchooseTagsWithNew({templateName:"默认名称",instructionContent:original})', scope);
        const toggle = value => { field('[data-instruction-title-auto]').checked = value; events['[data-instruction-title-auto]'](); };
        interact({ field, toggle });
        resolve(!cancel);
        const result = await pending;
        assert.equal(settings.autoRecognizeInstructionTitle, enabled);
        return result;
    }
    const selected = await run({ interact({field,toggle}) {
        assert.equal(field('[data-instruction-content-preview]').value, '# 标题\n完整内容');
        toggle(true); assert.equal(field('#theater-tag-template-name').value, '标题');
        assert.equal(field('[data-instruction-content-preview]').value, '完整内容');
        field('#theater-tag-template-name').val('手动名称').input();
        toggle(false); assert.equal(field('[data-instruction-content-preview]').value, '# 标题\n完整内容');
        toggle(true); assert.equal(field('#theater-tag-template-name').value, '手动名称');
    } });
    assert.equal(selected.name, '手动名称'); assert.equal(selected.content, '完整内容'); assert.equal(selected.autoRecognizeTitle, true);
    assert.equal(await run({ cancel: true }), null);
    const noTitle = await run({ enabled: true, original: '直接开始的完整指令' });
    assert.equal(noTitle.name, '默认名称'); assert.equal(noTitle.content, '直接开始的完整指令');
});
