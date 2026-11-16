import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readableErrorText } from '../error-text.js';
import { archiveWriteFailureDetail } from '../archive-rescue.js';
import { clearRuntimeLogs, getRuntimeLogEntries } from '../runtime-log.js';

const domError = (name, message) => Object.assign(new Error(message), { name });

test('插件自己写的中文提示原样保留，不写日志', () => {
    clearRuntimeLogs();
    assert.equal(readableErrorText(new Error('请先选择一个世界书'), '兜底'), '请先选择一个世界书');
    assert.equal(readableErrorText('文件「坏.json」不是有效的备份', '兜底'), '文件「坏.json」不是有效的备份');
    assert.equal(getRuntimeLogEntries().length, 0);
});

test('浏览器和网络的英文原话换成中文说明，原话写进运行日志', () => {
    clearRuntimeLogs();
    assert.match(readableErrorText(domError('QuotaExceededError', 'The quota has been exceeded.'), '兜底'), /存储空间不足/);
    assert.match(readableErrorText(new TypeError('Failed to fetch'), '兜底'), /连不上酒馆服务器/);
    assert.match(readableErrorText(new SyntaxError('Unexpected token < in JSON at position 0'), '兜底'), /不是插件能读的格式/);
    assert.match(readableErrorText(domError('TimeoutError', 'signal timed out'), '兜底'), /等了太久/);
    assert.match(readableErrorText(domError('AbortError', 'The operation was aborted.'), '兜底'), /中断/);
    const logs = getRuntimeLogEntries();
    assert.equal(logs.length, 5);
    assert.ok(logs.some(entry => entry.message.includes('The quota has been exceeded.')));
});

test('认不出的英文用调用处的中文兜底句；空错误也不显示 undefined', () => {
    assert.equal(readableErrorText(new Error('Cannot read properties of undefined'), '请刷新页面后再试。'), '请刷新页面后再试。');
    assert.equal(readableErrorText(undefined, '请刷新页面后再试。'), '请刷新页面后再试。');
    assert.equal(readableErrorText(new Error(''), '兜底'), '兜底');
    assert.doesNotMatch(readableErrorText(null), /undefined|null/);
});

test('本地存档写入失败：空间不足说人话，中断仍用原来的提示', () => {
    assert.match(archiveWriteFailureDetail(domError('QuotaExceededError', 'The quota has been exceeded.')), /存储空间不足/);
    assert.equal(archiveWriteFailureDetail(domError('AbortError', 'x')), '本地存档操作中断，请先保留页面里的内容。');
    assert.equal(archiveWriteFailureDetail(new Error('IndexedDB transaction aborted')), '本地存档操作中断，请先保留页面里的内容。');
    assert.doesNotMatch(archiveWriteFailureDetail(new Error('Some unknown browser failure')), /[A-Za-z]{4,}/);
});

test('弹窗里不再直接拼接 error.message', () => {
    const files = ['theater-instructions.js', 'theater-materials.js', 'long-dream-runtime.js', 'theater-generation.js', 'theater-auto-mode.js',
        'theater-history.js', 'theater-update.js', 'theater-storage.js', 'long-dream-workspace-library.js', 'theater-events-long-dream.js',
        'theater-events-settings.js', 'theater-events-results.js', 'layout-api-settings.js'];
    for (const file of files) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        const leaks = source.split('\n').filter(line => /(toastr\.(error|warning)|theaterError)\(/.test(line) && /\b(e|err|error)\??\.message\b/.test(line));
        assert.deepEqual(leaks, [], file);
    }
});
