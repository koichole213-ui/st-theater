import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { plainTextFromParsedHtml, stripBreakMarks, collapseBlockBreaks, looksLikeEscapedHtml } from '../html-plain-text.js';

// 作品 HTML 转纯文字时，必须在“空白文档”里解析：
// 用酒馆页面自己的 document 解析，<img onerror/onload> 里的代码会在酒馆页面上运行（Chromium 已复现）。
function loadHtmlToPlainText(sandbox) {
    const source = readFileSync(new URL('../theater-generation.js', import.meta.url), 'utf8');
    const begin = '// @theater-source-begin htmlToPlainText\n';
    const start = source.indexOf(begin) + begin.length;
    const end = source.indexOf('// @theater-source-end htmlToPlainText', start);
    assert.ok(start > begin.length && end > start, '找不到 htmlToPlainText');
    return runInContext(`${source.slice(start, end)}\nhtmlToPlainText;`, createContext({ plainTextFromParsedHtml, stripBreakMarks, looksLikeEscapedHtml, ...sandbox }));
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

// ---- 分段 ----
// 极简的假 DOM：只认标签和文字，够跑 plainTextFromParsedHtml 用到的 querySelectorAll / before / after / replaceWith。
const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input']);
class FakeNode {
    constructor(tag, text = '') { this.tag = tag; this.text = text; this.children = []; this.parent = null; this.ownerDocument = fakeDoc; }
    get textContent() { return this.tag === '#text' ? this.text : this.children.map(child => child.textContent).join(''); }
    append(node) { node.parent = this; this.children.push(node); }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector) { const tags = new Set(selector.split(',').map(tag => tag.trim())); return this.descendants().filter(node => tags.has(node.tag)); }
    insertAt(offset, node) { const siblings = this.parent.children; node.parent = this.parent; siblings.splice(siblings.indexOf(this) + offset, 0, node); }
    before(node) { this.insertAt(0, node); }
    after(node) { this.insertAt(1, node); }
    replaceWith(node) { this.insertAt(0, node); this.remove(); }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}
const fakeDoc = { createTextNode: text => new FakeNode('#text', text) };
const decode = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parse(html) {
    const root = new FakeNode('div');
    let current = root;
    for (const [, close, tag, text] of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*>|([^<]+)/gi)) {
        if (text !== undefined) current.append(new FakeNode('#text', decode(text)));
        else if (close) current = current.parent || root;
        else { const node = new FakeNode(tag.toLowerCase()); current.append(node); if (!VOID.has(node.tag)) current = node; }
    }
    return root;
}
const toText = html => plainTextFromParsedHtml(parse(html));

test('转纯文字：<br>、挤在一行的段落和卡片、列表都保留分段', () => {
    assert.equal(toText('<p>他推开门。</p><p>她抬起头。</p>'), '他推开门。\n她抬起头。');
    assert.equal(toText('<div class="chat">「你来了。」<br>「嗯。」<br>「坐吧。」</div>'), '「你来了。」\n「嗯。」\n「坐吧。」');
    assert.equal(toText('<div><div>林</div><div>今天下雨了。</div></div><div><div>周</div><div>带伞了吗？</div></div>'), '林\n今天下雨了。\n周\n带伞了吗？');
    assert.equal(toText('<ul><li>苹果</li><li>梨</li></ul>'), '苹果\n梨');
    assert.equal(toText('<table><tr><td>姓名</td><td>林</td></tr><tr><td>心情</td><td>好</td></tr></table>'), '姓名 林\n心情 好');
    assert.equal(toText('<p>行内<b>加粗</b>和<span>文字</span>不拆开</p>'), '行内加粗和文字不拆开');
});

test('转纯文字：源码里原有的换行照旧，缩进不再混进正文', () => {
    assert.equal(toText('<p>甲</p>\n<p>乙</p>'), '甲\n乙');
    assert.equal(toText('<p>甲</p>\n\n<p>乙</p>'), '甲\n\n乙');
    assert.equal(toText('<div>\n    <p>甲</p>\n    <p>乙</p>\n</div>'), '甲\n乙');
    assert.equal(toText('<p>甲<br><br>乙</p>'), '甲\n\n乙');
    assert.equal(toText('<p>第一行<br>\n第二行<br>\n    第三行</p>'), '第一行\n第二行\n第三行', '<br> 后面的源码换行不再多算一行');
    assert.equal(toText('<p>甲<br>\n</p>\n<p>乙</p>'), '甲\n乙', '段尾的 <br> 不另起一行');
    assert.equal(toText('<p>甲<br><br></p><p>乙</p>'), '甲\n乙');
    assert.equal(toText('<p>甲<br><br><br></p><p>乙</p>'), '甲\n\n乙');
    assert.equal(toText('<p>　　段首全角缩进保留</p>'), '　　段首全角缩进保留');
});

test('转纯文字：没有 DOM 能力时退回 textContent；分段记号不会混进正文', () => {
    assert.equal(plainTextFromParsedHtml({ textContent: '  甲乙  ' }), '甲乙');
    assert.equal(stripBreakMarks('甲\u0001乙'), '甲乙');
    assert.equal(collapseBlockBreaks('甲 \u0001 \n \u0001乙'), '甲\n乙');
    assert.equal(collapseBlockBreaks('\u0001\u0001甲\u0001'), '甲');
    assert.equal(collapseBlockBreaks('\u0001　\u0001'), '');
});

test('转纯文字：正文里写着的尖括号字样不被当成标签删掉', () => {
    const parsed = [];
    const document = { implementation: { createHTMLDocument: () => ({ createElement: () => ({
        set innerHTML(value) { parsed.push(value); const tree = parse(value); this.tree = tree; },
        querySelectorAll(selector) { return this.tree.querySelectorAll(selector); },
        get ownerDocument() { return fakeDoc; },
        get textContent() { return this.tree.textContent; },
    }) }) } };
    const htmlToPlainText = loadHtmlToPlainText({ document });
    assert.equal(htmlToPlainText('<p>他写下 &lt;b&gt;重点&lt;/b&gt; 这几个字。</p>'), '他写下 <b>重点</b> 这几个字。');
    assert.equal(htmlToPlainText('&lt;p&gt;整篇被转义过一次&lt;/p&gt;'), '整篇被转义过一次');
    assert.equal(htmlToPlainText('&lt;div&gt;&lt;p&gt;段一&lt;/p&gt;&lt;p&gt;段二&lt;/p&gt;&lt;style&gt;.a{color:red}&lt;/style&gt;&lt;/div&gt;'), '段一\n段二', '再解析一遍：分段保留，样式不当正文');
    assert.equal(parsed.length, 5, '每次最多多解析一层（1 + 2 + 2）');
    assert.equal(htmlToPlainText('<p>他写下 &lt;/p&gt; 这几个字，又写 1 &lt; 2 且 3 &gt; 2。</p>'), '他写下 </p> 这几个字，又写 1 < 2 且 3 > 2。', '单独一个结束标签字样不算被转义');
});

test('整篇被转义的判断：要先有开始标签、后有同名结束标签；正文里提到标签字样不算；很长也不慢', () => {
    assert.equal(looksLikeEscapedHtml('<p>x</p>'), true);
    assert.equal(looksLikeEscapedHtml('<div class="a"><p>段</p></div>'), true);
    assert.equal(looksLikeEscapedHtml('<P >x</P>'), true);
    assert.equal(looksLikeEscapedHtml('她在屏幕上敲下 </p> 然后又写了 <div class="box"> 表示盒子。'), false);
    assert.equal(looksLikeEscapedHtml('先出现 </section> 后来 <p> 这样的字样'), false);
    assert.equal(looksLikeEscapedHtml('<pre>x</pre>'), false);
    assert.equal(looksLikeEscapedHtml('<paragraph>x</p>'), false);
    const started = Date.now();
    looksLikeEscapedHtml('<p '.repeat(80_000));
    looksLikeEscapedHtml('<p>'.repeat(20_000) + '正文');
    assert.ok(Date.now() - started < 500);
});
