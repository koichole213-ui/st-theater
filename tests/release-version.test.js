// 从 core.test.js 拆出：release-version
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readTheaterImplementation } from './theater-source.js';

test('v5.0.0 版本号在代码、清单、样式头和设置页保持一致', () => {
    const source = readTheaterImplementation();
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.match(source, /const (?:runtime\.)?VERSION = '5\.0\.0'/);
    assert.equal(manifest.version, '5.0.0');
    assert.match(styles, /^\/\* 千夜浮梦 · 小剧场生成器 v5\.0\.0\b/);
    assert.match(source, /当前版本 v\$\{(?:runtime\.)?VERSION\}/);
});
