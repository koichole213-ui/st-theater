// 从 core.test.js 拆出：history-ui
import { collectionPage } from '../history-collections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { listPage, listPaginationHTML, requestedListPage } from '../pagination.js';
import { withPreservedPopupViewport } from '../popup-lifecycle.js';

test('历史分页跳转、跨页全选和删除末页回退不丢其他页的选择', () => {
    const source = readTheaterImplementation();
    const render = source.match(/function (?:runtime\.)?renderHistoryList\([^]*?^}/m)[0];
    const select = source.match(/'#theater-hist-select-all', function \(\) \{([^]*?)\n    \}\);/)[1];
    const scope = { historyQuery:'',historyRoleFilter:'',settings:{historyTagFilter:[]}, historyCache: Array.from({length:23}, (_,id) => ({id})), histPage:0,
        histSelected:new Set(), histBatchMode:true, listPage, listPaginationHTML,
        filterHistoryAll:items=>items, historyItemHTML:item=>`<article data-id="${item.id}"></article>`,
        refreshHistList(){}, enterHistBatchMode(){} };
    scope.currentHistoryPage = () => collectionPage(scope.historyCache.map(item => ({ item })), scope.histPage);
    scope.visibleHistoryItems = () => scope.currentHistoryPage().items.map(entry => entry.item);
    const page = () => runInNewContext(render + '\nrenderHistoryList()', scope);
    assert.equal((page().match(/<article/g)||[]).length, 8);
    runInNewContext('{'+select+'}',scope);
    scope.histPage = requestedListPage('jump', 0, 3, '2'); page(); runInNewContext('{'+select+'}',scope);
    assert.equal(scope.histSelected.size,16);
    runInNewContext('{'+select+'}',scope);
    assert.deepEqual([...scope.histSelected],Array.from({length:8},(_,i)=>i));
    scope.histPage = requestedListPage('last', 1, 3); assert.match(page(), /data-id="22"/);
    scope.historyCache = scope.historyCache.slice(0,16); page(); assert.equal(scope.histPage,1);
    scope.histPage = requestedListPage('jump', 1, 2, '999'); page(); assert.equal(scope.histPage,1);
    for(const value of ['', 'abc', '-1', '1.5']) assert.equal(requestedListPage('jump',1,2,value),1);
    scope.histPage = requestedListPage('first',1,2); assert.match(page(), /data-id="0"/);
    scope.historyCache=[]; assert.match(page(),/暂时没有可显示/); assert.equal(scope.histPage,0);
    for(const kind of ['hist','inst']) {
        const html=listPaginationHTML(kind,listPage(Array(23),1));
        for(const title of ['首页','上一页','下一页','末页','跳转']) assert.ok(html.includes(title));
    }
});

test('历史批量管理只切换父面板，退出清掉选中展示且不逐条测量样式', () => {
    const source = readTheaterImplementation();
    const extract = name => source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))[0];
    const classes = new Set();
    const checked = { checked: true };
    const selected = new Set(['theater-history-item-selected']);
    const selectors = [];
    const panel = { classList: { add: v => classes.add(v), remove: v => classes.delete(v) }, querySelectorAll: s => {
        selectors.push(s);
        return s.endsWith(':checked') ? [checked] : [{ classList: { remove: v => selected.delete(v) } }];
    } };
    const toolbar = { hide() {}, show() {}, toggle() {} };
    runInNewContext(extract('enterHistBatchMode') + extract('exitHistBatchMode') + '\nenterHistBatchMode();', {
        $: s => { assert.ok(!s.startsWith('.') || s === '.theater-history-section-head'); return toolbar; },
        document: { querySelector: s => { assert.equal(s, '.theater-panel[data-panel="history"]'); return panel; } },
        updateHistBulkBar() {}, filterHistoryAll: x => x, historyCache: [],
    });
    assert.ok(classes.has('is-batch-managing'));
    runInNewContext(extract('exitHistBatchMode') + '\nexitHistBatchMode();', {
        $: () => toolbar, document: { querySelector: () => panel },
        updateHistBulkBar() {}, filterHistoryAll: x => x, historyCache: [],
    });
    assert.equal(classes.size, 0);
    assert.equal(checked.checked, false);
    assert.equal(selected.size, 0);
    assert.deepEqual(selectors, ['.theater-hist-checkbox:checked', '.theater-history-item-selected']);
});

test('延迟进入历史会加载一次，批量恢复与刷新不显示全部导出，退出后恢复', () => {
    const source = readTheaterImplementation();
    const extract = name => source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))[0];
    const pending = new Set(['data-pending-list']);
    const visible = new Map();
    let renders = 0;
    const list = { hasAttribute: name => pending.has(name) };
    const context = {
        settings: {}, historyCache: [{ id: '合成历史' }], historyRoleFilter: '', historyQuery: '', histBatchMode: true, histPage: 0, listPage, listPaginationHTML,
        knownInstructionTags:()=>[],historyTagFilterLabel:()=> '全部标签', normalizeTheaterTab: tab => tab, filterHistoryAll: items => items,
        historyItemHTML: () => { renders++; return '<p>合成历史</p>'; },
        updateHistBulkBar() {}, refreshTagControls() {}, historyRoleFilterHTML: () => '<option>全部</option>', save() {},
        document: {
            getElementById: id => id === 'theater-history-list' ? list : null,
            querySelector: () => ({ classList: { add() {}, remove() {} }, querySelectorAll: () => [], getAttribute: () => '' }),
        },
        $: selector => {
            const api = {
                addClass: () => api, removeClass: () => api,
                html: () => api, text: () => api, removeAttr: name => { pending.delete(name); return api; },
                hide: () => visible.set(selector, false), show: () => visible.set(selector, true),
                toggle: value => visible.set(selector, value), attr: () => api, prop: () => api,
            };
            return api;
        },
    };
    context.currentHistoryPage = () => collectionPage(context.historyCache.map(item => ({ item })), context.histPage);
    runInNewContext(['activateTheaterTab', 'renderHistoryList', 'refreshHistList', 'enterHistBatchMode', 'exitHistBatchMode'].map(extract).join('\n')
        + '\nenterHistBatchMode(); activateTheaterTab("history"); activateTheaterTab("history");', context);
    assert.equal(renders, 1);
    assert.equal(pending.size, 0);
    assert.equal(visible.get('#theater-export-all-history'), false);
    runInNewContext('refreshHistList();', context);
    assert.equal(renders, 2);
    assert.equal(visible.get('#theater-export-all-history'), false);
    runInNewContext('histBatchMode = false; exitHistBatchMode();', context);
    assert.equal(visible.get('#theater-export-all-history'), true);
    assert.equal(visible.get('#theater-hist-batch-enter'), true);
});

test('历史改名只更新最新记录标题，取消、空名、写入失败与期间删除不报成功', async () => {
    const source = readTheaterImplementation();
    const rename = source.match(/async function (?:runtime\.)?renameHistoryItem\(id, anchor = null\) \{[\s\S]*?\n\}/)[0];
    for (const scenario of ['ok', 'cancel', 'blank', 'fail', 'deleted']) {
        const record = { id: 1, title: '旧名称', html: '<main>原正文</main>', tags: ['旧标签'], date: '原日期' };
        const cache = [record]; let writes = 0, refreshes = 0, success = 0;
        await runInNewContext(`${rename}\nrenameHistoryItem(1);`, {
            historyCache: cache, withPreservedPopupViewport,
            SillyTavern: { getContext: () => ({ Popup: { show: { input: async () => {
                if (scenario === 'deleted') cache.splice(0);
                else cache[0] = { ...record, tags: ['新标签'] };
                return scenario === 'cancel' ? null : scenario === 'blank' ? '  ' : ' 新名称 ';
            } } } }) },
            histPut: async item => {
                writes++; assert.equal(item.title, '新名称'); assert.equal(item.html, record.html);
                assert.equal(item.date, record.date); assert.equal(item.tags[0], '新标签'); return scenario !== 'fail';
            },
            refreshHistList: () => refreshes++, toastr: { warning() {}, success: () => success++ },
        });
        assert.equal(writes, ['ok', 'fail'].includes(scenario) ? 1 : 0);
        assert.equal(refreshes, scenario === 'ok' ? 1 : 0); assert.equal(success, scenario === 'ok' ? 1 : 0);
        assert.equal(record.title, '旧名称');
    }
});
