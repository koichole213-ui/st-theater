// 从 core.test.js 拆出：popup-lifecycle
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPopupElements, withPreservedPopupViewport } from '../popup-lifecycle.js';

test('子弹窗确认、取消或失败后恢复原滚动位置，并等待焦点布局完成', async () => {
    for (const outcome of ['confirm', 'cancel', 'error']) {
        const popup = { open: true };
        const page = { isConnected: true, scrollTop: 15, scrollLeft: 3, parentElement: null };
        const panels = { isConnected: true, scrollTop: 120, scrollLeft: 8, parentElement: page };
        const focusCalls = [];
        const anchor = {
            isConnected: true, parentElement: panels, ownerDocument: { scrollingElement: page },
            closest: () => popup,
            focus: options => focusCalls.push(options),
        };
        const run = withPreservedPopupViewport(anchor, async () => {
            panels.scrollTop = 900;
            page.scrollTop = 200;
            panels.scrollLeft = 40;
            if (outcome === 'error') throw new Error('test failure');
            return outcome === 'confirm';
        }, { nextFrame: async () => {
            assert.equal(panels.scrollTop, 120);
            // Simulate layout moving again in the frame after the dialog closes.
            panels.scrollTop = 650;
        } });
        if (outcome === 'error') await assert.rejects(run, /test failure/);
        else assert.equal(await run, outcome === 'confirm');
        assert.equal(panels.scrollTop, 120);
        assert.equal(panels.scrollLeft, 8);
        assert.equal(page.scrollTop, 15);
        assert.deepEqual(focusCalls, [{ preventScroll: true }, { preventScroll: true }]);
    }
});

test('主弹窗已关闭或控件已移除时，不抢回焦点或恢复旧页面滚动', async () => {
    for (const detached of [false, true]) {
        const popup = { open: true };
        const panels = { isConnected: true, scrollTop: 10, scrollLeft: 0, parentElement: null };
        let focused = 0;
        const anchor = {
            isConnected: true, parentElement: panels, closest: () => popup,
            focus: () => focused++,
        };
        await withPreservedPopupViewport(anchor, async () => {
            panels.scrollTop = 300;
            if (detached) anchor.isConnected = false;
            else popup.open = false;
        }, { nextFrame: async () => assert.fail('closed popup must not schedule restoration') });
        assert.equal(focused, 1);
        assert.equal(panels.scrollTop, 300);
    }
});

test('弹窗会等待预设和世界书容器真正挂载后再继续初始化', async () => {
    let elapsed = 0;
    const mounted = new Set();
    const result = await waitForPopupElements(
        id => mounted.has(id) ? { id } : null,
        ['theater-preset-name-select', 'theater-wb-books'],
        {
            timeoutMs: 100,
            intervalMs: 10,
            now: () => elapsed,
            sleep: async milliseconds => {
                elapsed += milliseconds;
                if (elapsed >= 30) {
                    mounted.add('theater-preset-name-select');
                    mounted.add('theater-wb-books');
                }
            },
        },
    );
    assert.equal(result, true);
    assert.equal(elapsed, 30);
});

test('弹窗缺少必要容器时会在期限内停止等待', async () => {
    let elapsed = 0;
    const result = await waitForPopupElements(
        () => null,
        ['theater-preset-name-select', 'theater-wb-books'],
        {
            timeoutMs: 25,
            intervalMs: 10,
            now: () => elapsed,
            sleep: async milliseconds => { elapsed += milliseconds; },
        },
    );
    assert.equal(result, false);
    assert.equal(elapsed, 30);
});
