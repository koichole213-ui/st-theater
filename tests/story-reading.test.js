import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { injectStoryErrorReporter, installSafeResizeListener, renderSafeIframe } from '../safe-renderer.js';
import { mountStoryReading } from '../story-reading.js';
import { readerPaneHTML } from '../result-reader.js';

const brokenStory = '<!doctype html><html><head><script>throw new Error("story");</script></head><body><p>开头</p><p hidden>结尾</p></body></html>';

test('错误监听先于作品脚本安装，保留文档开头，只发送有限的错误类型', () => {
    for (const input of [
        brokenStory, '<!doctype html><script>work()</script>',
        '<!doctype html><html><script>work()</script></html>',
        '<!--<head>--><script>work()</script>',
        '<html><head data-a=">"><script>work()</script></head></html>',
    ]) {
        const result = injectStoryErrorReporter(input, 12);
        const reporter = result.match(/<script data-st-theater-story-errors>([\s\S]*?)<\/script>/);
        assert.ok(reporter.index < result.indexOf('<script>'));
        assert.equal(result.replace(reporter[0], ''), input);
        if (input.startsWith('<!doctype')) assert.ok(result.startsWith('<!doctype'));
        const handlers = {};
        const messages = [];
        runInNewContext(reporter[1], {
            addEventListener: (name, handler) => { handlers[name] = handler; },
            parent: { postMessage: data => messages.push(data) },
        });
        handlers.error({ error: { name: 'SecurityError', message: 'private story text' } });
        handlers.unhandledrejection({ reason: 'another private value' });
        handlers.error({ error: { name: 'ReferenceError' } });
        handlers.error({ error: { name: 'TypeError' } });
        assert.deepEqual(messages.map(({ renderId, message }) => [renderId, message]), [[12, 'SecurityError'], [12, 'Error'], [12, 'ReferenceError']]);
    }
});

test('手动纯文字阅读可恢复原排版，跳过过期或外部窗口的消息，并保留静态页面翻页', () => {
    const originalWindow = globalThis.window;
    let receive;
    globalThis.window = {
        innerWidth: 390, innerHeight: 800,
        addEventListener: (_name, handler) => { receive = handler; },
    };
    const frame = { contentWindow: {}, isConnected: true, style: {}, getClientRects: () => [1], setAttribute() {} };
    const fallback = { focus() { this.focused = true; } };
    const button = {};
    const noticeButton = {};
    const notice = { querySelector: () => noticeButton };
    const errors = [], swipes = [];
    const makeReading = html => mountStoryReading({
        frame, fallback, notice, button, html,
        onStoryError: message => errors.push(message),
        renderOptions: { onWorkspaceSwipe: page => swipes.push(page) },
    });
    let reading;
    try {
        installSafeResizeListener();
        reading = makeReading(brokenStory);
        const getRenderId = () => Number(frame.srcdoc.match(/renderId: (\d+)/)?.[1]);
        const firstId = getRenderId();
        const error = id => ({ type: 'st-theater:story-error', renderId: id, message: 'ReferenceError' });
        const swipe = { type: 'st-theater:workspace-swipe', page: 'generate' };
        assert.ok(firstId > 0);
        assert.equal(notice.hidden, true);
        assert.doesNotMatch(frame.srcdoc, /bindResultSwipe/);
        receive({ source: {}, data: error(firstId) });
        assert.equal(notice.hidden, true);
        receive({ source: frame.contentWindow, data: swipe });
        assert.deepEqual(swipes, []);
        receive({ source: frame.contentWindow, data: error(firstId) });
        assert.equal(notice.hidden, false);
        assert.deepEqual(errors, ['ReferenceError']);
        noticeButton.onclick();
        assert.equal(notice.hidden, true);
        assert.equal(frame.hidden, true);
        assert.equal(frame.srcdoc, '');
        assert.equal(fallback.textContent, '开头\n结尾');
        assert.equal(fallback.focused, true);
        assert.equal(button.textContent, '恢复原排版');
        reading.setEditing(true);
        assert.equal(fallback.hidden, true);
        assert.equal(button.hidden, true);
        reading.setEditing(false);
        assert.equal(fallback.hidden, false);
        button.onclick();
        assert.equal(button.textContent, '纯文字阅读');
        assert.equal(frame.hidden, false);
        assert.match(frame.srcdoc, /throw new Error\("story"\)/);
        assert.notEqual(getRenderId(), firstId);
        receive({ source: frame.contentWindow, data: error(firstId) });
        assert.equal(notice.hidden, true);
        reading.clear();
        reading = makeReading('<p>静态正文</p>');
        assert.match(frame.srcdoc, /bindResultSwipe/);
        receive({ source: frame.contentWindow, data: swipe });
        assert.deepEqual(swipes, ['generate']);
        assert.doesNotMatch(brokenStory, /data-st-theater/);
    } finally {
        reading?.clear();
        globalThis.window = originalWindow;
    }
});

test('阅读页的重新排版和纯文字阅读同在已有操作菜单内', () => {
    const html = readerPaneHTML();
    const menu = html.match(/<div id="theater-reading-actions"[\s\S]*?<\/div>/)?.[0];
    assert.match(menu, /data-relayout="read"[^>]*role="menuitem"/);
    assert.match(menu, /data-reader-plain-reading[^>]*role="menuitem"/);
    assert.equal((html.match(/data-relayout="read"/g) || []).length, 1);
});
