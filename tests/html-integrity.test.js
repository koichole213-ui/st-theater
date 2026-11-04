import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHtmlIntegrity, assertHtmlIntegrity, recoverHtmlText } from '../html-integrity.js';
import { renderSafeIframe } from '../safe-renderer.js';
import { createTheaterGeneration } from '../theater-generation.js';

const complete = body => `<!doctype html><html><head></head><body>${body}</body></html>`;
const broken = complete('<button onclick="switchEp(2)">下一幕</button><p>第一段原文。</p><p hidden>第二段原文。</p>');

test('recognizes a scriptless function-driven page without guessing or exposing its content', () => {
    assert.deepEqual(inspectHtmlIntegrity(broken), { valid: false, issues: ['missing-script'], executableScripts: 0, handlers: 1 });
    assert.throws(() => assertHtmlIntegrity(broken), error => error.code === 'THEATER_RENDER_VALIDATION'
        && error.htmlIntegrityReason === 'missing-script' && !error.message.includes('switchEp') && !error.message.includes('原文'));
    assert.equal(inspectHtmlIntegrity(complete('<button onclick="return window.nextChapter()">NEXT</button>')).valid, false);
});

test('static layouts, CSS-only controls, native details and self-contained handlers need no script', () => {
    for (const html of [
        '<p>静态片段</p>', complete('<p>静态正文</p>'),
        complete('<details><summary>打开</summary><p>更多正文</p></details>'),
        complete('<label for="more">翻开</label><input type="checkbox" id="more"><p>正文</p>'),
        complete('<button onclick="this.nextElementSibling.hidden=false">NEXT</button><p hidden>正文</p>'),
        complete('<button onclick="alert(\'提示\')">提示</button>'),
        complete('<button onclick="window.print()">打印</button>'),
    ]) assert.equal(inspectHtmlIntegrity(html).valid, true, html);
});

test('executable scripts, modules and existing external-script pages are not classified as scriptless', () => {
    for (const script of ['<script>function next(){}</script>', '<script type="module">document.body.dataset.ready="yes";</script>', '<script src="already-selected.js"></script>']) {
        assert.equal(inspectHtmlIntegrity(complete(`<button onclick="next()">NEXT</button>${script}`)).valid, true);
    }
    assert.equal(inspectHtmlIntegrity(complete('<button onclick="next()">NEXT</button><script type="application/json">{"data":1}</script>')).valid, false);
});

test('browser and ECMAScript globals in self-contained handlers are not mistaken for missing custom functions', t => {
    const before = globalThis.window;
    globalThis.window = { innerWidth: 390, innerHeight: 844 };
    t.after(() => { if (before === undefined) delete globalThis.window; else globalThis.window = before; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const handler of [
        'requestIdleCallback(()=>this.previousElementSibling.textContent=123)',
        'cancelIdleCallback(1)', 'queueMicrotask(()=>this.textContent=123)',
        'addEventListener(\'resize\',()=>this.textContent=123)',
        'removeEventListener(\'resize\',null)', 'dispatchEvent(new Event(\'example\'))',
        'fetch(\'/example\').then(()=>this.textContent=123)',
        'getComputedStyle(this)', 'window.matchMedia(\'(max-width:600px)\')',
        'structuredClone({value:1})', 'String(123)', 'parseInt(\'123\',10)',
        'decodeURIComponent(\'%E4%B8%AD\')',
    ]) {
        const html = complete(`<p>原有正文</p><button onclick="${handler}">操作</button>`);
        assert.equal(inspectHtmlIntegrity(html).valid, true, handler);
        const iframe = { style: {}, setAttribute() {}, contentWindow: {} };
        renderSafeIframe(iframe, html, { fallbackOnNoReport: false });
        assert.ok(iframe.srcdoc.includes(handler));
        assert.doesNotMatch(iframe.srcdoc, /页面交互未完成/);
    }
    assert.equal(inspectHtmlIntegrity(complete('<button onclick="nextChapter()">下一幕</button>')).valid, false);
});

test('onclick text inside raw text, comments or quoted non-handler attributes does not create a false defect', () => {
    for (const body of [
        '<!-- <button onclick="missing()">FAKE</button> --><p>正文</p>',
        '<p data-description=" onclick=\'missing()\' ">正文</p>',
        '<style>p::after{content:"onclick=missing()"}</style><p>正文</p>',
        '<textarea><button onclick="missing()">文本示例</button></textarea>',
        '<template><button onclick="missing()">未使用模板</button></template>',
    ]) assert.equal(inspectHtmlIntegrity(complete(body)).valid, true);
});

test('missing script/style closures and truncated interactive documents are reported before shell repair', () => {
    assert.ok(inspectHtmlIntegrity('<html><body><p>正文</p><script>function next(){}').issues.includes('unclosed-script'));
    assert.ok(inspectHtmlIntegrity('<html><head><style>p{color:red}').issues.includes('unclosed-style'));
    assert.ok(inspectHtmlIntegrity('<html><body><button onclick="next()">NEXT</button><script>function next(){}</script>').issues.includes('incomplete-document'));
    assert.equal(inspectHtmlIntegrity('<html><body><p>允许旧静态片段</p>').valid, true);
});

test('external snow/details/code-fence wrappers are inspected using the same selected HTML candidate', () => {
    const wrapper = `<snow><details><summary>说明</summary>\n\`\`\`html\n${broken}\n\`\`\`\n</details></snow>`;
    assert.deepEqual(inspectHtmlIntegrity(wrapper), inspectHtmlIntegrity(broken));
});

test('readonly recovery keeps existing hidden text in order and removes script/style code', () => {
    const html = complete('<style>BODY_STYLE_SENTINEL</style><p>第一段 &amp; 原文。</p><section hidden><p>第二段 &#x4e2d;文。</p></section><script>CODE_SENTINEL</script>');
    const text = recoverHtmlText(html);
    assert.match(text, /第一段 & 原文。[\s\S]*第二段 中文。/);
    assert.doesNotMatch(text, /BODY_STYLE_SENTINEL|CODE_SENTINEL/);
});

test('shared renderer recovers only confirmed broken previews; source and complete interactions remain unchanged', t => {
    const before = globalThis.window;
    globalThis.window = { innerWidth: 390, innerHeight: 844 };
    t.after(() => { if (before === undefined) delete globalThis.window; else globalThis.window = before; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const frame = () => ({ style: {}, setAttribute() {}, contentWindow: {} });
    const failed = frame(); renderSafeIframe(failed, broken, { fallbackOnNoReport: false });
    assert.match(failed.srcdoc, /页面交互未完成/); assert.match(failed.srcdoc, /第一段原文/); assert.match(failed.srcdoc, /第二段原文/);
    assert.doesNotMatch(failed.srcdoc, /onclick="switchEp/);
    assert.match(broken, /onclick="switchEp/);
    const healthy = complete('<button onclick="next()">NEXT</button><p id="p">正文</p><script>function next(){document.querySelector("#p").textContent="原有互动"}</script>');
    const good = frame(); renderSafeIframe(good, healthy, { fallbackOnNoReport: false });
    assert.ok(good.srcdoc.includes(healthy.slice(0, healthy.indexOf('</body>'))));
    assert.doesNotMatch(good.srcdoc, /页面交互未完成/);
});

function textDocument() {
    return { createElement: () => ({
        set innerHTML(value) { this.textContent = recoverHtmlText(value); },
        querySelectorAll: () => [],
    }) };
}

test('production final rendering rejects missing interactions, uses the existing repair once and preserves all paragraphs', async t => {
    const before = globalThis.document; globalThis.document = textDocument();
    t.after(() => { if (before === undefined) delete globalThis.document; else globalThis.document = before; });
    let calls = 0, retries = 0;
    const runtime = { extractHtml: text => text, runtimeLog() {}, recordRequestMetrics() {},
        requestConfiguredGenerationApi: async () => {
            calls++;
            const body = '<button onclick="next()">NEXT</button><p>{{THEATER_P0001}}</p><p hidden>{{THEATER_P0002}}</p>';
            return { text: complete(body + (calls === 1 ? '' : '<script>function next(){document.querySelectorAll("p").forEach(p=>p.hidden=false)}</script>')) };
        },
    };
    const result = await createTheaterGeneration(runtime).requestFinalRenderedHtml({ sourceText: '第一段原文。\n\n第二段原文。', rules: 'VIRTUAL_CUSTOM_RULE', apiRoute: {}, onRetry: () => retries++ });
    assert.equal(calls, 2); assert.equal(retries, 1);
    assert.match(result.html, /第一段原文/); assert.match(result.html, /第二段原文/); assert.match(result.html, /<script>/);
});

test('two rejected layouts stop at the existing limit; validation never invents a script or makes a third request', async t => {
    const before = globalThis.document; globalThis.document = textDocument();
    t.after(() => { if (before === undefined) delete globalThis.document; else globalThis.document = before; });
    let calls = 0;
    const runtime = { extractHtml: text => text, runtimeLog() {}, recordRequestMetrics() {}, requestConfiguredGenerationApi: async () => {
        calls++; return { text: complete('<button onclick="missing()">NEXT</button><p>{{THEATER_P0001}}</p><p hidden>{{THEATER_P0002}}</p>') };
    } };
    await assert.rejects(createTheaterGeneration(runtime).requestFinalRenderedHtml({ sourceText: '第一段原文。\n\n第二段原文。', rules: 'VIRTUAL_CUSTOM_RULE', apiRoute: {} }), error => error.code === 'THEATER_RENDER_VALIDATION');
    assert.equal(calls, 2);
});
