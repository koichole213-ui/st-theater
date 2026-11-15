// 从 core.test.js 拆出：runtime-log
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { MAX_RUNTIME_LOGS, clearRuntimeLogs, formatRuntimeLogs, getRuntimeLogEntries, sanitizeLogText, setRuntimeLogSecretProvider, writeRuntimeLog } from '../runtime-log.js';

test('运行日志统一脱敏密钥、Authorization 与 URL 路径', () => {
    clearRuntimeLogs();
    const secret = 'sk-super-secret-value';
    setRuntimeLogSecretProvider(() => [secret]);
    writeRuntimeLog('info', '请求发出', {
        url: 'https://api.example.com/v1/chat/completions?debug=1',
        apiKey: secret,
        key: 'bare-key-secret',
        Authorization: 'Bearer another-secret',
        max_tokens: 16384,
    });
    writeRuntimeLog('error', `Authorization: Bearer ${secret}; x-api-key=raw-secret`);
    const output = formatRuntimeLogs();
    assert.match(output, /\[INFO\] 请求发出/);
    assert.match(output, /https:\/\/api\.example\.com/);
    assert.match(output, /max_tokens/);
    assert.doesNotMatch(output, /v1\/chat|debug=1|sk-super|another-secret|raw-secret|bare-key-secret/);
    assert.match(output, /\[REDACTED\]/);
});

test('运行日志只保留最近 500 条且不写入外部设置', () => {
    assert.equal(MAX_RUNTIME_LOGS, 500);
    clearRuntimeLogs();
    setRuntimeLogSecretProvider(() => []);
    for (let index = 0; index < MAX_RUNTIME_LOGS + 5; index++) writeRuntimeLog('info', `entry-${index}`);
    const entries = getRuntimeLogEntries();
    assert.equal(entries.length, MAX_RUNTIME_LOGS);
    assert.equal(entries[0].message, 'entry-5');
    assert.equal(entries.at(-1).message, `entry-${MAX_RUNTIME_LOGS + 4}`);
    clearRuntimeLogs();
});

test('排查 TXT 点击时汇总最新报告和日志，并再次脱敏', () => {
    const source = readTheaterImplementation();
    assert.match(source, /id="theater-export-diagnostics-btn"/);
    assert.match(source, /#theater-export-diagnostics-btn', (?:runtime\.)?exportDiagnosticsText/);
    const exportSource = source.match(/function (?:runtime\.)?exportDiagnosticsText\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(exportSource);
    let downloads = [];
    let reportVersion = 0;
    const context = {
        buildDiagnostics: () => ({ text: `报告 ${++reportVersion}\n模型：https://example.com/private?key=secret` }),
        getRuntimeLogEntries: () => [{ level: 'error' }],
        formatRuntimeLogs: () => '2026/9/23 [ERROR] T-NET-FAILED',
        sanitizeLogText,
        MAX_RUNTIME_LOGS,
        downloadTextContent: (content, name, feedback) => downloads.push({ content, name, feedback }),
    };
    runInNewContext(`${exportSource}\nexportDiagnosticsText(); exportDiagnosticsText();`, context);
    assert.equal(downloads.length, 2);
    assert.match(downloads[0].content, /报告 1\r\n/);
    assert.match(downloads[1].content, /报告 2\r\n/);
    assert.match(downloads[1].content, /脱敏运行日志（最近 1\/500 条）/);
    assert.match(downloads[1].content, /T-NET-FAILED/);
    assert.doesNotMatch(downloads[1].content, /private|key=secret/);
    assert.match(downloads[1].name, /^千夜浮梦-排查报告-\d{4}-\d{2}-\d{2}\.txt$/);
    assert.equal(downloads[1].feedback, '已发起下载，请查看浏览器下载列表');
});
