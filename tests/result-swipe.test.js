// 从 core.test.js 拆出：result-swipe
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { bindResultSwipe } from '../result-swipe.js';

test('结果横滑识别方向并避开纵向滚动、多指、输入控件和选中文字，销毁后不再触发', () => {
    const handlers = new Map(), pages = [];
    let selection = '';
    const root = {
        ownerDocument: { defaultView: { getSelection: () => selection, getComputedStyle: () => ({}) } },
        addEventListener(name, handler) { handlers.set(name, handler); },
        removeEventListener(name) { handlers.delete(name); },
    };
    const target = { closest: () => null, nodeType: 1, parentElement: root };
    const dispose = bindResultSwipe(root, page => { pages.push(page); return true; });
    const point = (x, y) => ({ clientX: x, clientY: y });
    function event(name, points, extra = {}) {
        const e = { target, touches: points, changedTouches: points, cancelable: true,
            preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
        handlers.get(name)?.(e); return e;
    }
    event('touchstart', [point(250, 30)]);
    assert.equal(event('touchmove', [point(200, 32)]).prevented, true);
    event('touchend', [point(90, 32)]);
    assert.equal(event('click', []).prevented, true, '抑制横滑合成的点击');
    event('touchstart', [point(80, 30)], { target: { closest: () => ({ matches: () => false }) } });
    assert.equal(event('click', []).prevented, undefined, '新的主动点击不能被上一回横滑吞掉');
    event('touchstart', [point(50, 30)]);
    event('touchend', [point(180, 32)]);
    assert.deepEqual(pages, ['read', 'generate']);
    event('touchstart', [point(250, 30)]);
    assert.equal(event('touchmove', [point(245, 75)]).prevented, undefined);
    event('touchend', [point(90, 80)]);
    event('touchstart', [point(250, 30), point(230, 30)]);
    event('touchend', [point(90, 30)]);
    event('touchstart', [point(250, 30)], { target: { closest: () => ({ matches: () => false }) } });
    event('touchend', [point(90, 30)]);
    selection = '正在选中的正文';
    event('touchstart', [point(250, 30)]);
    event('touchend', [point(90, 30)]);
    assert.deepEqual(pages, ['read', 'generate']);
    dispose(); assert.equal(handlers.size, 0);
});

test('结果页重复选择或无效方向横滑保留滚动位置，换页仍各自恢复', () => {
    const source = readTheaterImplementation();
    const body = source.match(/function (?:runtime\.)?switchResultWorkspace\([^]*?^}/m)[0];
    const wrapper = { scrollTop: 230 };
    const state = { generate: 0, read: 75 };
    const scope = { resultWorkspacePage: 'generate', resultPageScroll: state,
        document: { querySelector: s => s === '.theater-panels-wrapper' ? wrapper : null, querySelectorAll: () => [] },
        closeResultActions() {}, animateResultPage() {}, requestAnimationFrame() {}, positionResultToolbox() {}, resultReader: { refresh() {} } };
    runInNewContext(body, scope);
    assert.equal(scope.switchResultWorkspace('generate'), false);
    assert.equal(wrapper.scrollTop, 230);
    assert.equal(scope.switchResultWorkspace('read'), true);
    assert.equal(wrapper.scrollTop, 75);
    wrapper.scrollTop = 160;
    assert.equal(scope.switchResultWorkspace('read'), false);
    assert.equal(wrapper.scrollTop, 160);
    assert.equal(scope.switchResultWorkspace('generate'), true);
    assert.equal(wrapper.scrollTop, 230);
    assert.equal(state.read, 160);
});
