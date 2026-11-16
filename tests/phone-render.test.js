// 内置「小手机」渲染规则：选项接线、规则内容、互动骨架
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PHONE_RENDER_PROFILE, PHONE_RENDER_SELECTION, phoneRenderProfile } from '../phone-render.js';
import { adaptiveRenderProfiles } from '../adaptive-render.js';
import { createTheaterRenderSelection } from '../theater-render-selection.js';
import { estimateTokenCount } from '../token-estimator.js';

const esc = value => String(value).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const selectionApi = () => createTheaterRenderSelection({
    esc,
    BUILTIN_RENDER_SELECTIONS: new Set(['__default__', '__default_pc__', ...adaptiveRenderProfiles().map(p => p.id), PHONE_RENDER_SELECTION]),
});

test('小手机是独立的内置选项：出现在「特色」分组，名字、图标、说明、规则都对得上', () => {
    const api = selectionApi();
    const options = api.renderTemplateOptions(PHONE_RENDER_SELECTION, [{ name: '我的', content: 'x' }]);
    assert.match(options, /<optgroup label="特色"><option value="__phone__" selected>小手机（聊天·动态）<\/option><\/optgroup>/);
    assert.ok(options.indexOf('label="剧情自适应"') < options.indexOf('label="特色"'));
    assert.ok(options.indexOf('label="特色"') < options.indexOf('label="我的模板"'));
    assert.equal(api.normalizeRenderSelection(PHONE_RENDER_SELECTION, []), PHONE_RENDER_SELECTION, '刷新后不会被改回默认');
    assert.equal(api.isBuiltinRenderSelection(PHONE_RENDER_SELECTION), true, '内置不可删除');
    assert.equal(api.renderTemplateContentForSelection(PHONE_RENDER_SELECTION, []), PHONE_RENDER_PROFILE.rules);
    assert.deepEqual(api.renderSelectionMeta(PHONE_RENDER_SELECTION, []),
        { value: PHONE_RENDER_SELECTION, name: '小手机（聊天·动态）', shortName: '小手机', icon: 'fa-comments', adaptive: false });
    assert.equal(api.renderSelectionHint(PHONE_RENDER_SELECTION), PHONE_RENDER_PROFILE.description);
    assert.equal(phoneRenderProfile('__adaptive_lively__'), null);
    assert.equal(phoneRenderProfile(''), null);
    assert.match(readFileSync(new URL('../index.js', import.meta.url), 'utf8'), /\.\.\.Object\.values\(ADAPTIVE_RENDER_SELECTIONS\),\n {4}PHONE_RENDER_SELECTION,\n\]\);/,
        'index.js 的内置选项里有小手机');
});

test('小手机规则：机主在右、内容不删不改、待排版正文原样保留、沙盒限制、三种色调，长度和三档相当', () => {
    const rules = PHONE_RENDER_PROFILE.rules;
    assert.match(rules, /机主的消息在右，其他人在左/);
    assert.match(rules, /每条消息、动态、评论都画出来，按原顺序，不删不并不缩写/);
    assert.match(rules, /提供了待排版正文时：原文一字不改/);
    assert.match(rules, /不另写消息、评论或彩蛋/);
    assert.match(rules, /localStorage\/sessionStorage\/cookie、alert\/confirm\/prompt、表单提交、全屏、新窗口都不能用/);
    assert.match(rules, /不做左右滑（会被外层当翻页）/);
    assert.match(rules, /不用100vh、固定高度或内部滚动框/);
    assert.match(rules, /不用fixed/);
    for (const tone of ['奶油手账', '深夜锁屏', '白描原生']) assert.match(rules, new RegExp(tone));
    assert.match(rules, /\/\^\\d\+\$\//, '骨架里的反斜杠没被模板字符串吞掉');
    assert.doesNotMatch(rules, /\{\{(user|char)\}\}/, '渲染规则里的宏不会被替换，不用宏');
    assert.doesNotMatch(rules, /微信|QQ|支付宝|推特|Twitter|WeChat/i, '不写真实 App 名');
    assert.ok(estimateTokenCount(rules) <= 2200, `规则过长：${estimateTokenCount(rules)}`);
});

// 极简假 DOM：元素 = { id, wait, data, count }；只支持骨架用到的选择器
function runSkeleton({ els, handler = '', clicks = [], after = null }) {
    const skeleton = PHONE_RENDER_PROFILE.rules.split('2. script照抄骨架，可加功能，不删检查：\n')[1]?.split('\n任何出错')[0] || '';
    assert.match(skeleton, /root\.classList\.add\('js'\)\}catch\(_\)\{reveal\(\)\}$/);
    const rootClasses = new Set(), windowListeners = {};
    const nodes = els.map(spec => {
        const classes = new Set(spec.wait ? ['wait'] : []), listeners = [], attrs = {};
        const count = spec.count === undefined ? null : { textContent: String(spec.count) };
        return {
            id: spec.id || '', dataset: { ...(spec.data || {}) }, classes, listeners, attrs, count,
            classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n),
                toggle: (n, force) => {
                    const on = force === undefined ? !classes.has(n) : !!force;
                    on ? classes.add(n) : classes.delete(n);
                    return on;
                } },
            setAttribute: (k, v) => { attrs[k] = String(v); },
            addEventListener: (type, fn) => listeners.push(fn),
            querySelector: sel => (sel === 'b' ? count : null),
        };
    });
    const matches = (el, sel) => {
        if (sel.includes(',')) return sel.split(',').some(part => matches(el, part));
        if (sel === '.wait') return el.classes.has('wait');
        if (sel === 'button') return Object.keys(el.dataset).some(k => k !== 'pane');
        if (sel.startsWith(':not(button)')) return !matches(el, 'button') && matches(el, sel.slice(':not(button)'.length));
        if (sel.startsWith('#')) return '#' + el.id === sel;
        const m = sel.match(/^\[data-(\w+)(?:="(.*)")?\]$/);
        return !!m && (m[2] === undefined ? m[1] in el.dataset : el.dataset[m[1]] === m[2]);
    };
    runInNewContext(skeleton.replace('const refs=', `${handler}const refs=`), {
        addEventListener: (type, fn) => { windowListeners[type] = fn; },
        document: {
            documentElement: { classList: { add: n => rootClasses.add(n), remove: n => rootClasses.delete(n) } },
            querySelectorAll: sel => nodes.filter(el => matches(el, sel)),
            querySelector: sel => nodes.find(el => matches(el, sel)) || null,
        },
    });
    const ready = rootClasses.has('js');
    const byId = id => nodes.find(el => el.id === id);
    for (const id of clicks) byId(id).listeners.forEach(fn => fn({}));
    if (after) after(windowListeners);
    return { ready, js: rootClasses.has('js'), hidden: id => byId(id).classes.has('wait'), has: (id, c) => byId(id).classes.has(c),
        attr: (id, k) => byId(id).attrs[k], count: id => String(byId(id).count.textContent) };
}

test('小手机骨架：收款、点赞、开合、切换都在原地生效，任何出错或缺按钮都让全部内容露出', () => {
    const pay = [{ id: 'tip', wait: true }, { id: 'pay', data: { take: '#tip' } }];
    let r = runSkeleton({ els: pay, clicks: ['pay'] });
    assert.equal(r.ready, true);
    assert.deepEqual([r.hidden('tip'), r.has('pay', 'done')], [false, true], '收款：卡片变已收款，系统小字露出');
    r = runSkeleton({ els: pay, clicks: ['pay', 'pay'] });
    assert.deepEqual([r.hidden('tip'), r.has('pay', 'done')], [false, true], '再点保持已收款');

    const like = [{ id: 'lk', data: { like: '' }, count: 28 }];
    r = runSkeleton({ els: like, clicks: ['lk'] });
    assert.deepEqual([r.count('lk'), r.has('lk', 'done')], ['29', true], '点赞 +1');
    r = runSkeleton({ els: like, clicks: ['lk', 'lk'] });
    assert.deepEqual([r.count('lk'), r.has('lk', 'done')], ['28', false], '再点还原');
    r = runSkeleton({ els: [{ id: 'lk', data: { like: '' }, count: '1.2万' }], clicks: ['lk'] });
    assert.deepEqual([r.count('lk'), r.has('lk', 'done'), r.js], ['1.2万', true, true], '数字不是纯数字时只变色，不出错');
    r = runSkeleton({ els: [{ id: 'lk', data: { like: '' } }], clicks: ['lk'] });
    assert.equal(r.js, true, '按钮里没写数字也不出错');

    const voice = [{ id: 'v1', wait: true }, { id: 'bv', data: { open: '#v1' } }];
    r = runSkeleton({ els: voice, clicks: ['bv'] });
    assert.deepEqual([r.hidden('v1'), r.attr('bv', 'aria-expanded')], [false, 'true'], '语音：点开露出转写');
    r = runSkeleton({ els: voice, clicks: ['bv', 'bv'] });
    assert.deepEqual([r.hidden('v1'), r.attr('bv', 'aria-expanded')], [true, 'false'], '再点收起');

    const tabs = [{ id: 'chat', data: { pane: 'app' } }, { id: 'feed', wait: true, data: { pane: 'app' } },
        { id: 'tc', data: { tab: '#chat' } }, { id: 'tf', data: { tab: '#feed' } }];
    r = runSkeleton({ els: tabs, clicks: ['tf'] });
    assert.deepEqual([r.hidden('chat'), r.hidden('feed'), r.has('tf', 'on'), r.has('tc', 'on')], [true, false, true, false], '切到动态');
    r = runSkeleton({ els: tabs, clicks: ['tf', 'tc'] });
    assert.deepEqual([r.hidden('chat'), r.hidden('feed'), r.has('tc', 'on'), r.has('tf', 'on')], [false, true, true, false], '切回消息');

    assert.equal(runSkeleton({ els: [...pay, { id: 'orphan', wait: true }] }).ready, false, '有 wait 内容没按钮：一开始就不隐藏');
    assert.equal(runSkeleton({ els: [{ id: 'feed', wait: true, data: { pane: 'app' } }, { id: 'tf', data: { tab: '#feed' } }, { id: 'chat', data: { pane: 'app' } }] }).ready, false,
        '默认面板没有自己的切换按钮：一开始就不隐藏');
    assert.equal(runSkeleton({ els: [{ id: 'b', data: { take: '#nowhere' } }], clicks: ['b'] }).js, false, '收款目标不存在：点了全部露出');
    assert.equal(runSkeleton({ els: [{ id: 'b', data: { open: '#nowhere' } }], clicks: ['b'] }).js, false, '开合目标不存在：点了全部露出');
    assert.equal(runSkeleton({ els: pay, handler: "on('#pay',()=>missingSound());", clicks: ['pay'] }).js, false, '自定义处理出错：全部露出');
    assert.equal(runSkeleton({ els: pay, after: l => l.unhandledrejection?.({}) }).js, false, '异步报错：全部露出');
    assert.equal(runSkeleton({ els: pay, after: l => l.error?.({}) }).js, false, '定时器里报错：全部露出');
});
