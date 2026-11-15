// 从 core.test.js 拆出：safe-renderer
import test from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_REPORT_TIMEOUT_MS, injectResizeReporter, installSafeResizeListener, renderSafeIframe, sandboxPermissions } from '../safe-renderer.js';

test('iframe 没有回报渲染状态时会触发正文兜底', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = { innerWidth: 390, innerHeight: 800 };
    let fallbackReason = '';
    const frame = {
        contentWindow: {},
        style: {},
        setAttribute() {},
        set srcdoc(value) { this.rendered = value; },
    };
    try {
        renderSafeIframe(frame, '<html><body>已有正文</body></html>', {
            sourceHasText: true,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        await new Promise(resolve => setTimeout(resolve, RENDER_REPORT_TIMEOUT_MS + 50));
        assert.equal(fallbackReason, 'no-report');
        assert.match(frame.rendered, /已有正文/);
    } finally {
        globalThis.window = originalWindow;
    }
});

test('全屏 iframe 没有及时回报时保留丰富 HTML，不误降级为纯文字', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = { innerWidth: 390, innerHeight: 800 };
    let fallbackReason = '';
    const frame = {
        contentWindow: {},
        style: {},
        setAttribute() {},
        set srcdoc(value) { this.rendered = value; },
    };
    try {
        renderSafeIframe(frame, '<html><body><div class="phone">全屏正文</div></body></html>', {
            sourceHasText: true,
            fixedHeight: true,
            fallbackOnNoReport: false,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        await new Promise(resolve => setTimeout(resolve, RENDER_REPORT_TIMEOUT_MS + 50));
        assert.equal(fallbackReason, '');
        assert.match(frame.rendered, /class="phone"/);
        assert.equal(frame.style.height, '100%');
    } finally {
        globalThis.window = originalWindow;
    }
});

test('iframe 导航更换窗口引用后仍能接收渲染回报，短暂空正文不会误降级', async () => {
    const originalWindow = globalThis.window;
    let messageHandler = null;
    globalThis.window = {
        innerWidth: 390,
        innerHeight: 800,
        addEventListener(type, handler) {
            if (type === 'message') messageHandler = handler;
        },
    };
    const frame = {
        contentWindow: {},
        style: {},
        setAttribute() {},
        set srcdoc(value) { this.rendered = value; },
    };
    let fallbackReason = '';
    try {
        installSafeResizeListener();
        renderSafeIframe(frame, '<html><body>已有正文</body></html>', {
            sourceHasText: true,
            blankGraceMs: 20,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        const navigatedWindow = {};
        frame.contentWindow = navigatedWindow;
        messageHandler({
            source: navigatedWindow,
            data: { type: 'st-theater:height', height: 240, textLength: 0 },
        });
        messageHandler({
            source: navigatedWindow,
            data: { type: 'st-theater:height', height: 360, textLength: 4 },
        });
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(fallbackReason, '');
        assert.equal(frame.style.height, '360px');

        const blankWindow = {};
        const blankFrame = {
            contentWindow: blankWindow,
            style: {},
            setAttribute() {},
            set srcdoc(value) { this.rendered = value; },
        };
        renderSafeIframe(blankFrame, '<html><body></body></html>', {
            sourceHasText: true,
            blankGraceMs: 10,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        messageHandler({
            source: blankWindow,
            data: { type: 'st-theater:height', height: 240, textLength: 0 },
        });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(fallbackReason, 'empty-body');

        const fullscreenWindow = {};
        const fullscreenFrame = {
            contentWindow: fullscreenWindow,
            style: {},
            setAttribute() {},
            set srcdoc(value) { this.rendered = value; },
        };
        renderSafeIframe(fullscreenFrame, '<html><body>全屏正文</body></html>', {
            sourceHasText: true,
            fixedHeight: true,
        });
        messageHandler({
            source: fullscreenWindow,
            data: { type: 'st-theater:height', height: 480, textLength: 4 },
        });
        assert.equal(fullscreenFrame.style.height, '100%');
    } finally {
        globalThis.window = originalWindow;
    }
});

test('安全 iframe 永远不开放 allow-same-origin', () => {
    assert.equal(sandboxPermissions(false), 'allow-scripts');
    assert.equal(sandboxPermissions(true), 'allow-scripts');
    assert.equal(sandboxPermissions(true).includes('allow-same-origin'), false);
});

test('安全 iframe 在 body 末尾注入尺寸与可见正文上报脚本', () => {
    const html = injectResizeReporter('<html><body><p>正文</p></body></html>');
    assert.match(html, /st-theater:height/);
    assert.match(html, /textLength/);
    assert.match(html, /cloneNode\(true\)/);
    assert.match(html, /script, style, noscript, template, svg/);
    assert.ok(html.indexOf('st-theater:height') < html.indexOf('</body>'));
});
