import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

// 酒馆自带样式下实测（无头 Chromium）：右上角的“×”曾被“生成时出错”那行小字盖住，点在按钮正中关不掉。
test('报错弹窗的关闭按钮叠在内容上方', () => {
    const rule = css.match(/:is\(#toast-container,\.theater-error-toast-layer\) > \.theater-request-error-toast \.toast-close-button\{([^}]*)\}/);
    assert.ok(rule, '找不到报错弹窗关闭按钮的样式');
    assert.match(rule[1], /position:relative/);
    assert.match(rule[1], /z-index:\s*[1-9]/);
});

// 酒馆给 html 加了 translateZ(0)，固定定位以 html 为准；手机上 html 高度为 0 时，只写 inset:0 会把整层压成一条。
test('报错弹窗层按视口高度铺满，不依赖 html 的高度', () => {
    const rule = css.match(/\.theater-error-toast-layer\{position:fixed;([^}]*)\}/);
    assert.ok(rule);
    assert.match(rule[1], /height:100dvh/);
    assert.match(rule[1], /width:100vw/);
});
