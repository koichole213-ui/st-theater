import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 手机上看不到浏览器控制台。存档写入失败时，除了弹窗，还要在插件的运行日志里留一行，
// 用户复制诊断报告时才能看到“哪一步、什么错误”。
test('本地存档每个写入失败分支都会写运行日志，不只写浏览器控制台', () => {
    const source = readFileSync(new URL('../theater-storage.js', import.meta.url), 'utf8');
    const branches = [...source.matchAll(/\} catch \((\w+)\) \{\n((?:.*\n){1,3})/g)]
        .filter(match => /console\.error\('\[Theater\] [^']*失败/.test(match[2]));
    assert.ok(branches.length >= 9, '应找到至少 9 个写入失败分支');
    for (const [, name, body] of branches) {
        assert.match(body, /runtime\.runtimeLog(?:\?\.)?\('error', '[^']+'/, body);
        assert.match(body, new RegExp(`message: ${name}\\?\\.message`), body);
    }
});

test('备份的善后步骤失败时记一行提醒，不再静默', () => {
    const source = readFileSync(new URL('../backup-storage.js', import.meta.url), 'utf8');
    assert.match(source, /catch \(error\) \{ runtime\.runtimeLog\?\.\('warn', '备份：释放操作锁失败/);
    assert.match(source, /removeJournal\(\)\.catch\(error => runtime\.runtimeLog\?\.\('warn', '备份：清理已过期的恢复记录失败/);
    assert.doesNotMatch(source, /catch \{ await finished\.catch/);
});
