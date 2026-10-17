import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeHistoryBackup } from '../history-backup.js';
import { normalizeCollections, remapHistoryImport, newHistoryKey } from '../history-collections.js';

const source = readFileSync(new URL('../theater-history.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function importHistoryBackup()'), source.indexOf('// @theater-source-end importHistoryBackup'));
const file = (name, html, type = '') => ({ name, type, text: async () => html });
async function importFiles(files, zipData) {
    const input = { click() {} }, writes = [], errors = [], notices = [];
    runInNewContext(`${code}\nimportHistoryBackup();`, {
        document: { createElement: () => input }, normalizeHistoryBackup, normalizeCollections, remapHistoryImport, newHistoryKey,
        readHistoryZip: async () => zipData,
        addHistoryItems: async (items, folders) => { writes.push({ items, folders }); return true; },
        toastr: { success: text => notices.push(text), warning: text => notices.push(text) },
        runtime: { theaterError: text => errors.push(text) },
    });
    await input.onchange({ target: { files } });
    return { input, writes, errors, notices };
}

test('多选HTML/HTM保留原文、样式和文件名标题，缺失元数据不猜测', async () => {
    const html = '<!doctype html><html><head><style>p{color:gold}</style></head><body><p>合成故事</p></body></html>';
    const { input, writes, errors } = await importFiles([file('第一篇.HTML', html), file('第二篇.htm', '<p>第二篇</p>')]);
    assert.equal(input.multiple, true);
    assert.match(input.accept, /\.html/);
    assert.equal(errors.length, 0);
    assert.equal(writes.length, 1);
    assert.deepEqual(Array.from(writes[0].items, item => item.title), ['第一篇', '第二篇']);
    assert.equal(writes[0].items[0].html, html);
    assert.equal(writes[0].items[0].mode, 'html');
    assert.equal(writes[0].items[0].sourceConfig, null);
    assert.equal(writes[0].items[0].roleSources.length, 0);
    assert.equal(writes[0].items[0].continuationRounds.length, 0);
});

test('取消选择不保存、不报错', async () => {
    const result = await importFiles([]);
    assert.equal(result.writes.length, 0);
    assert.equal(result.errors.length, 0);
});

test('任一HTML为空或读取失败时整组选中文件不写入', async () => {
    for (const bad of [file('空白.html', ' \n'), { name: '失败.htm', text: async () => { throw new Error('读取失败'); } }]) {
        const result = await importFiles([file('正常.html', '<p>正常</p>'), bad]);
        assert.equal(result.writes.length, 0);
        assert.equal(result.errors.length, 1);
        assert.ok(result.errors[0].includes(bad.name));
    }
});

test('HTML与JSON/ZIP混选保留备份信息，不同备份重复ID不混合章节或文件夹', async () => {
    const backup = { items: [{ id: 'same', chapterId: 'chapter', title: '旧备份', html: '<p>备份</p>', tags: ['保留'] }], folders: [{ id: 'folder', name: '系列', itemIds: ['same'] }] };
    const result = await importFiles([file('单篇.html', '<p>单篇</p>'), file('备份.json', JSON.stringify(backup)), file('归档.zip', '', 'application/zip')], backup);
    assert.equal(result.errors.length, 0);
    const { items, folders } = result.writes[0];
    assert.equal(items.length, 3);
    assert.equal(folders.length, 2);
    assert.notEqual(items[1].chapterId, items[2].chapterId);
    assert.notEqual(items[1].id, items[2].id);
    assert.equal(folders[0].itemIds[0], String(items[1].id));
    assert.equal(folders[1].itemIds[0], String(items[2].id));
    assert.equal(items[1].tags[0], '保留');
});

test('坏JSON不会导致前面的HTML被提前保存', async () => {
    const result = await importFiles([file('正常.html', '<p>正常</p>'), file('坏.json', '{')]);
    assert.equal(result.writes.length, 0);
    assert.match(result.errors[0], /坏.json/);
});

test('真实新增路径保留已有作品和文件夹，重复导入成为独立副本', async () => {
    const code = source.slice(source.indexOf('async function addHistoryItems('), source.indexOf('// @theater-source-end addHistoryItems'));
    const original = { id: 'old', title: '已有作品', html: '<p>旧正文</p>' };
    const originalFolder = { id: 'old-folder', title: '原文件夹', itemIds: ['old'] };
    let state = { items: [original], folders: [originalFolder] };
    const add = runInNewContext(`${code}\naddHistoryItems`, {
        remapHistoryImport, newHistoryKey,
        commitHistoryCollection: async update => { state = update(state.items, state.folders); return true; },
        normalizeTagList: tags => tags, refreshHistList() {},
        runtime: { settings: {}, knownInstructionTags: () => [], save() {} },
    });
    const imported = normalizeHistoryBackup({ items: [{ title: '找回的作品', html: '<p>导回正文</p>', mode: 'html' }] });
    await add(imported, []);
    await add(imported, []);
    assert.equal(state.items.length, 3);
    assert.equal(state.items[0], original);
    assert.equal(state.folders[0], originalFolder);
    assert.notEqual(state.items[1].id, state.items[2].id);
    assert.notEqual(state.items[1].chapterId, state.items[2].chapterId);
    assert.equal(state.items[1].html, '<p>导回正文</p>');
});
