// 从 core.test.js 拆出：instruction-import
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitInstructionTextFile } from '../instruction-import.js';
import { createInstructionBackup, parseInstructionBackup } from '../instruction-backup.js';

test('TXT 指令导入兼容 Windows、Unix 和旧式换行', () => {
    assert.deepEqual(splitInstructionTextFile('第一条\r\n---\r\n第二条'), ['第一条', '第二条']);
    assert.deepEqual(splitInstructionTextFile('第一条\n --- \n第二条'), ['第一条', '第二条']);
    assert.deepEqual(splitInstructionTextFile('第一条\r---\r第二条'), ['第一条', '第二条']);
});

test('TXT 指令导入只把独立一行的三横线视为分隔符', () => {
    assert.deepEqual(splitInstructionTextFile('正文里的---不是分隔符\r\n下一行'), ['正文里的---不是分隔符\n下一行']);
});

test('指令备份跨设备导入时保留多标签与暂未使用的标签', () => {
    const exported = createInstructionBackup(['甜饼', '角色甲', '暂未使用'], [
        { name: '雨夜', content: '写雨夜重逢', tags: ['甜饼', '角色甲'] },
        { name: '散装', content: '写一顿晚饭' },
    ]);
    const restored = parseInstructionBackup(JSON.parse(JSON.stringify(exported)));
    assert.deepEqual(restored.tags, ['甜饼', '角色甲', '暂未使用']);
    assert.deepEqual(restored.templates[0].tags, ['甜饼', '角色甲']);
    assert.deepEqual(restored.templates[1].tags, []);
});

test('旧分组备份导入时一对一转换为同名标签', () => {
    const restored = parseInstructionBackup({
        format: 'st-theater-instructions', version: 2, groups: ['甜文'],
        templates: [{ name: '旧模板', content: '内容', group: '甜文' }],
    });
    assert.deepEqual(restored.tags, ['甜文']);
    assert.deepEqual(restored.templates[0].tags, ['甜文']);
});
