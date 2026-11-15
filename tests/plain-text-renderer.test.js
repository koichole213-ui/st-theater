// 从 core.test.js 拆出：plain-text-renderer
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAIN_TEXT_DARK_SELECTION, PLAIN_TEXT_LIGHT_SELECTION, buildPlainTextHtml, isPlainTextSelection, isTextOutputMode, plainTextThemeForSelection, textOutputModeForTheme, textThemeForOutputMode } from '../plain-text-renderer.js';

test('纯文字亮色与暗色共用纯正文协议，但使用不同的本地阅读主题', () => {
    assert.equal(isPlainTextSelection(PLAIN_TEXT_LIGHT_SELECTION), true);
    assert.equal(isPlainTextSelection(PLAIN_TEXT_DARK_SELECTION), true);
    assert.equal(plainTextThemeForSelection(PLAIN_TEXT_LIGHT_SELECTION), 'light');
    assert.equal(plainTextThemeForSelection(PLAIN_TEXT_DARK_SELECTION), 'dark');
    assert.equal(textOutputModeForTheme('light'), 'text');
    assert.equal(textOutputModeForTheme('dark'), 'text-dark');
    assert.equal(isTextOutputMode('text'), true);
    assert.equal(isTextOutputMode('text-dark'), true);
    assert.equal(textThemeForOutputMode('text-dark'), 'dark');
});

test('暗色纯文字阅读壳转义正文并声明夜间配色', () => {
    const html = buildPlainTextHtml('夜里有一盏 <灯>。\n\n仍然亮着。', 'dark');
    assert.match(html, /name="color-scheme" content="dark"/);
    assert.match(html, /#0d0f12/);
    assert.match(html, /夜里有一盏 &lt;灯&gt;。/);
    assert.doesNotMatch(html, /<灯>/);
    assert.match(html, /white-space:pre-wrap/);
    assert.match(html, /"KaiTi"/);
});
