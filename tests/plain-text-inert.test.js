import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// 作品 HTML 转纯文字时，必须在“空白文档”里解析：
// 用酒馆页面自己的 document 解析，<img onerror/onload> 里的代码会在酒馆页面上运行（Chromium 已复现）。
function loadHtmlToPlainText(sandbox) {
    const source = readFileSync(new URL('../theater-generation.js', import.meta.url), 'utf8');
    const begin = '// @theater-source-begin htmlToPlainText\n';
    const start = source.indexOf(begin) + begin.length;
    const end = source.indexOf('// @theater-source-end htmlToPlainText', start);
    assert.ok(start > begin.length && end > start, '找不到 htmlToPlainText');
    return runInContext(`${source.slice(start, end)}\nhtmlToPlainText;`, createContext(sandbox));
}

function fakeDiv(log) {
    return {
        set innerHTML(value) { log.push(value); this.text = value.replace(/<[^>]+>/g, ''); },
        querySelectorAll() { return []; },
        get textContent() { return this.text; },
    };
}

test('作品转纯文字时不在酒馆页面的 document 上解析', () => {
    const parsed = [];
    const document = {
        createElement() { throw new Error('不应在酒馆页面的 document 上创建元素'); },
        implementation: { createHTMLDocument: title => ({ title, createElement: tag => (assert.equal(tag, 'div'), fakeDiv(parsed)) }) },
    };
    const htmlToPlainText = loadHtmlToPlainText({ document });
    const story = '<!DOCTYPE html><html><body><img src="x" onerror="parent.alert(1)"><p>正文</p></body></html>';
    assert.equal(htmlToPlainText(story), '正文');
    assert.equal(parsed.length, 1);
    assert.ok(parsed[0].includes('onerror'), '内容原样交给空白文档解析，文字结果不变');
});

test('没有空白文档能力的环境仍能退回原来的写法', () => {
    const parsed = [];
    const htmlToPlainText = loadHtmlToPlainText({ document: { createElement: () => fakeDiv(parsed) } });
    assert.equal(htmlToPlainText('<p>第一段</p><p>第二段</p>'), '第一段第二段');
    assert.equal(parsed.length, 1);
});
