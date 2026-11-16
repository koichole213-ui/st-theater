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
    assert.match(readableErrorText(new SyntaxError('Unexpected token < in JSON at position 0'), '兜底', { file: true }), /不是插件能读的格式，请确认选对了文件/);
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

test('JSON 读不懂：导入文件时说“选对文件”，其他地方说酒馆返回的内容读不懂', () => {
    const error = new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");
    assert.match(readableErrorText(error, '兜底', { file: true }), /请确认选对了文件/);
    const other = readableErrorText(error, '兜底');
    assert.doesNotMatch(other, /文件/);
    assert.match(other, /登录过期|刷新页面/);
});

test('HTTP 状态码保留下来，并配一句人话', () => {
    assert.match(readableErrorText(new Error('HTTP 404'), '请稍后重试。'), /找不到.*改名或删除.*HTTP 404/);
    assert.match(readableErrorText(new Error('HTTP 401'), '兜底'), /登录过期.*HTTP 401/);
    assert.match(readableErrorText(new Error('HTTP 403'), '兜底'), /HTTP 403/);
    assert.match(readableErrorText(new Error('HTTP 502 Bad Gateway'), '兜底'), /服务器出错.*HTTP 502/);
    assert.match(readableErrorText(new Error('HTTP 418'), '兜底'), /HTTP 418/);
});

test('世界书读取失败时能看到 404，而不是一句“请稍后重试”', () => {
    const source = readFileSync(new URL('../theater-materials.js', import.meta.url), 'utf8');
    assert.match(source, /throw new Error\(`HTTP \$\{/);
    assert.match(source, /世界书「\$\{name\}」读取失败：` \+ readableErrorText\(error/);
});

test('浏览器的英文报错里夹着中文字段名，也换成中文说明并记日志', () => {
    clearRuntimeLogs();
    const error = new SyntaxError('Unexpected token \'o\', "{"标题":oops}" is not valid JSON');
    assert.match(readableErrorText(error, '兜底', { file: true }), /请确认选对了文件/);
    assert.equal(getRuntimeLogEntries().length, 1);
    assert.equal(readableErrorText(new Error('世界书「旧梦」读取失败'), '兜底'), '世界书「旧梦」读取失败', '插件自己的中文提示不受影响');
});

test('插件更新失败：弹窗不直接贴酒馆后台的英文原话，原话写进运行日志', () => {
    const source = readFileSync(new URL('../theater-update.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\$\{detail\}\\n/);
    assert.match(source, /writeRuntimeLog\('warn', '更新插件：酒馆返回的原话'/);
});

test('插件自己的中文提示里引用了“Failed to fetch”之类的名字，原样保留', () => {
    assert.equal(readableErrorText(new Error('预设「Failed to fetch」不存在'), '兜底'), '预设「Failed to fetch」不存在');
});

test('运行日志脱敏：JSON 里的 Authorization（含 Basic）、Cookie / Set-Cookie、token 都抹掉', async () => {
    const { writeRuntimeLog } = await import('../runtime-log.js');
    clearRuntimeLogs();
    writeRuntimeLog('warn', '更新插件：酒馆返回的原话', { message: '{"Authorization":"Basic dXNlcjpwYXNz","token":"t-123"}\nCookie: session=abc123; theme=dark\nSet-Cookie: sid=zzz; Path=/' });
    const [entry] = getRuntimeLogEntries();
    for (const secret of ['dXNlcjpwYXNz', 't-123', 'abc123', 'zzz']) assert.doesNotMatch(entry.message, new RegExp(secret));
    assert.match(entry.message, /更新插件/);
});
