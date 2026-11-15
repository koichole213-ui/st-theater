// 从 core.test.js 拆出：main-ui
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { listPage, listPaginationHTML } from '../pagination.js';
import { bookmarkPlacementFromPoint, bookmarkPosition, normalizeBookmarkYRatio } from '../result-bookmark.js';
import { matchesTagFilter } from '../tag-system.js';

test('全屏阅读使用原生模态弹窗进入浏览器顶层', () => {
    const source = readTheaterImplementation();
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(source, /<dialog id="theater-reader-overlay"/);
    assert.match(source, /readerDialog\.showModal\(\)/);
    assert.doesNotMatch(source, /<div id="theater-reader-overlay"/);
    assert.match(styles, /\.theater-reader-overlay::backdrop/);
});

test('点击续写会切回生成页、滚到顶部并聚焦指令框', () => {
    const source = readTheaterImplementation();
    const match = source.match(/function revealContinuationInput\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(source, /\.theater-tab\[data-tab="generate"\][\s\S]*?\.click\(\)/);
    assert.match(match, /\.theater-panels-wrapper/);
    assert.match(match, /panels\.scrollTop = 0/);
    assert.match(match, /input\.focus\(\{ preventScroll: true \}\)/);
    assert.match(source, /(?:runtime\.)?scheduleTokenEstimate\(\);\s*revealContinuationInput\(\);/);
});

test('悬浮球打开弹窗时会吞掉同一触点补发的点击并在下一轮再显示界面', () => {
    const source = readTheaterImplementation();
    const guard = source.match(/function openTheaterPopupFromFloatingBall\([\s\S]*?\n\}/)?.[0] || '';
    const floatingBall = source.match(/function (?:runtime\.)?createFloatingBall\(\)[\s\S]*?\/\/ Popup HTML/)?.[0] || '';
    assert.match(guard, /document\.addEventListener\('click', guardOpeningClick, true\)/);
    assert.match(guard, /Math\.hypot\(clickX - releaseX, clickY - releaseY\)/);
    assert.match(guard, /event\.preventDefault\(\)/);
    assert.match(guard, /event\.stopImmediatePropagation\(\)/);
    assert.match(guard, /setTimeout\(\(\) => \{[\s\S]*?(?:runtime\.)?openTheaterPopup\(\)[\s\S]*?\}, 0\)/);
    assert.match(floatingBall, /openTheaterPopupFromFloatingBall\(releasePoint\)/);
    assert.doesNotMatch(floatingBall, /else \{\s*try \{ (?:runtime\.)?openTheaterPopup\(\)/);
});

test('悬浮球拖动被系统取消时会清理监听，旧浏览器也使用对应的鼠标事件', () => {
    const source = readTheaterImplementation();
    const floatingBall = source.match(/function (?:runtime\.)?createFloatingBall\(\)[\s\S]*?\/\/ Popup HTML/)?.[0] || '';
    assert.match(floatingBall, /document\.addEventListener\('pointercancel', onPointerCancel\)/);
    assert.match(floatingBall, /document\.addEventListener\('touchcancel', onPointerCancel\)/);
    assert.match(floatingBall, /document\.addEventListener\('mousemove', onPointerMove/);
    assert.match(floatingBall, /document\.addEventListener\('mouseup', onPointerUp\)/);
    assert.match(floatingBall, /touch-action:none !important/);
    assert.match(floatingBall, /ball\.setPointerCapture\(e\.pointerId\)/);
    assert.match(floatingBall, /if \(e\.cancelable\) e\.preventDefault\(\)/);
    assert.match(floatingBall, /let activePointerId = null/);
    assert.match(floatingBall, /let activeTouchId = null/);
    assert.match(floatingBall, /e\.pointerId !== activePointerId/);
    assert.match(floatingBall, /touch\.identifier === activeTouchId/);
    assert.match(floatingBall, /e\.type === 'mousedown' && Date\.now\(\) < suppressMouseUntil/);
    assert.match(floatingBall, /touchstart', onPointerDown, \{ passive: false \}/);
    assert.match(floatingBall, /function removeGestureListeners\(\)[\s\S]*?removeEventListener\('touchcancel', onPointerCancel\)/);
    assert.match(source, /let (?:runtime\.)?floatingBallCleanup = null/);
    assert.match(floatingBall, /if \((?:runtime\.)?floatingBallCleanup\) (?:runtime\.)?floatingBallCleanup\(\)/);
    assert.match(floatingBall, /(?:runtime\.)?floatingBallCleanup = \(\) => \{[\s\S]*?cancelTuck\(\)[\s\S]*?removeGestureListeners\(\)[\s\S]*?removeEventListener\('resize', onViewportResize\)[\s\S]*?ball\.remove\(\)/);
});

test('插件更新成功后只提供需确认的酒馆刷新操作', () => {
    const source = readTheaterImplementation();
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const confirmFlow = source.match(/async function (?:runtime\.)?confirmReloadAfterUpdate\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    const updateFlow = source.match(/async function (?:runtime\.)?updateExtension\(\) \{[\s\S]*?\n\}/)?.[0] || '';

    assert.match(source, /id="theater-reload-after-update-btn"[\s\S]*?刷新酒馆并启用/);
    assert.match(source, /#theater-reload-after-update-btn', (?:runtime\.)?confirmReloadAfterUpdate/);
    assert.match(updateFlow, /if \(resp\.ok\) \{\s*showReloadAfterUpdateAction\(\)/);
    assert.match(confirmFlow, /Popup\.show\.confirm\('现在刷新酒馆并启用新版本？'/);
    assert.match(confirmFlow, /if \(!confirmed\) return;[\s\S]*?window\.location\.reload\(\)/);
    assert.match(styles, /\.theater-reload-after-update\[hidden\][\s\S]*?display: none/);
    assert.match(source, /theater-update-button-stack[\s\S]*?theater-update-btn[\s\S]*?theater-reload-after-update-btn/);
    assert.match(styles, /\.theater-config-card \.theater-update-actions\s*\{[\s\S]*?display:\s*grid/);
    assert.match(styles, /\.theater-config-card \.theater-update-actions > span\s*\{[\s\S]*?white-space:\s*nowrap/);
    assert.match(styles, /\.theater-update-button-stack\s*\{[\s\S]*?display:\s*grid[\s\S]*?gap:\s*8px/);
});

test('常见问题汇总是诊断报告后的独立可折叠界面', () => {
    const source = readTheaterImplementation();
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const signals = readFileSync(new URL('../request-diagnostics.js', import.meta.url), 'utf8');
    const diagnosticsPanel = source.indexOf('data-panel="diagnostics"');
    const reportOutput = source.indexOf('id="theater-diagnostics-output"', diagnosticsPanel);
    const library = source.indexOf('class="theater-diagnostic-catalog theater-diagnostic-library"', diagnosticsPanel);
    assert.ok(reportOutput >= 0 && library > reportOutput);
    assert.match(source, /按弹窗里的错误信号查原因/);
    assert.match(readFileSync(new URL('../error-help-ui.js', import.meta.url), 'utf8'), /teh-catalog-item/);
    assert.match(readFileSync(new URL('../error-help-ui.js', import.meta.url), 'utf8'), /esc\(item.what\)/);
    assert.match(readFileSync(new URL('../error-help-ui.js', import.meta.url), 'utf8'), /stepsHTML\(item.steps\)/);
    assert.doesNotMatch(source, /【常见问题汇总｜按错误信号查询】/);
    assert.doesNotMatch(source.match(/function (?:runtime\.)?runDiagnostics\(\)[\s\S]*?\n\}/)?.[0] || '', /diagnostic-catalog/);
    assert.match(signals, /T-API-CONTENT-FILTER/);
    assert.match(styles, /\.theater-diagnostic-catalog\s*\{/);
    assert.match(styles, /\.theater-diagnostic-catalog\[open\]/);
    assert.match(styles, /\.theater-diagnostic-catalog-item\s*\{[\s\S]*?flex-direction:\s*column/);
});

test('生成结果使用可关闭的页边书签，并保留安全退出编辑与移除结果', () => {
    const source = readTheaterImplementation();
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const actionsAt = source.indexOf('id="theater-result-actions"');
    const outputAt = source.indexOf('id="theater-output-container"');
    assert.ok(actionsAt >= 0 && actionsAt < outputAt);
    assert.match(source, /id="theater-result-bookmark-enabled"/);
    assert.match(source, /bookmarkPlacementFromPoint/);
    assert.match(source, /is-inline-menu/);
    assert.match(source, /id="theater-cancel-edit-btn"/);
    assert.match(source, /id="theater-delete-result-btn"/);
    assert.match(source, /原正文和排版没有改变/);
    assert.match(source, /已经保存到历史的小剧场不会受影响/);
    assert.match(styles, /\.theater-result-actions\s*\{[\s\S]*?#fffaf0/);
    assert.match(styles, /data-skin="custom"\] \.theater-result-actions[\s\S]*?Canvas/);
});

test('手机端主弹窗铺满可用屏幕，保留紧凑圆角关闭键并让内容独立滚动', () => {
    const source = readTheaterImplementation();
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const tabHandler = source.match(/\/\/ Tabs[\s\S]*?\/\/ ---- Generate ----/)?.[0] || '';
    const tabActivator = source.match(/function (?:runtime\.)?activateTheaterTab\([\s\S]*?\n\}/)?.[0] || '';
    const mobileShell = styles.match(/\/\* Mobile fullscreen shell:[\s\S]*?\/\* End mobile fullscreen shell\. \*\//)?.[0] || '';
    assert.match(tabHandler, /(?:runtime\.)?activateTheaterTab/);
    assert.match(tabActivator, /panels\.scrollTop = 0/);
    assert.doesNotMatch(source, /target\.scrollIntoView/);
    assert.match(source, /okButton: '关闭'/);
    assert.match(source, /new Popup\((?:runtime\.)?buildPopupHTML\(initialTab\)/);
    assert.match(source, /const activeTabClass = tab => initialTab === tab \? ' active' : ''/);
    assert.doesNotMatch(source, /class="theater-tab active" data-tab="generate"/);
    assert.doesNotMatch(source, /class="theater-panel active" data-panel="generate"/);
    assert.doesNotMatch(source, /theater-mobile-close/);
    assert.match(mobileShell, /width:\s*100vw !important/);
    assert.match(mobileShell, /height:\s*100dvh !important/);
    assert.match(mobileShell, /border-radius:\s*0 !important/);
    assert.match(mobileShell, /\.theater-popup:not\(\.theater-compact-popup\)/);
    assert.match(mobileShell, /\.theater-panels-wrapper,[\s\S]*?flex:\s*1 1 auto;[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*none;/);
    assert.match(mobileShell, /:is\(\.popup-controls, \.popup-buttons\)[\s\S]*?flex:\s*0 0 auto !important/);
    assert.match(mobileShell, /:is\(\.popup-controls, \.popup-buttons\) \{\s*min-height:\s*0 !important;\s*margin:\s*0 !important;\s*padding:\s*4px 10px !important;/);
    assert.match(mobileShell, /:is\(\.popup-button-close, \.popup-button-ok, \.popup-button-cancel\)[\s\S]*?min-height:\s*38px !important/);
    assert.match(styles, /\.popup-button-close[\s\S]*?min-width:\s*112px !important[\s\S]*?border-radius:\s*var\(--t-radius-md, 12px\) !important/);
    assert.match(mobileShell, /#theater-instruction[\s\S]*?min-height:\s*120px/);
    assert.match(mobileShell, /#theater-dream-next-instruction[\s\S]*?min-height:\s*183px/);
    assert.doesNotMatch(styles, /max-width:\s*96vw !important/);
    assert.doesNotMatch(styles, /max-height:\s*92vh !important/);
});

test('默认皮肤的长梦备份按钮保持深色底上的可读对比度', () => {
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(styles, /theater-popup:not\(\[data-skin="theater"\]\):not\(\[data-skin="custom"\]\) \.theater-dream-archive-actions \.theater-btn\s*\{[\s\S]*?color:\s*rgba\(255, 249, 237, \.9\)[\s\S]*?background:\s*rgba\(255, 249, 237, \.075\)/);
});

test('页边书签位置会限制在可见范围并按拖动落点吸附', () => {
    const rect = { left: 100, right: 700, top: 50, bottom: 650, width: 600, height: 600 };
    assert.equal(normalizeBookmarkYRatio(-1), 0.12);
    assert.equal(normalizeBookmarkYRatio(2), 0.88);
    assert.deepEqual(bookmarkPlacementFromPoint({ rect, x: 160, y: 350 }), { side: 'left', yRatio: 0.5 });
    assert.deepEqual(bookmarkPlacementFromPoint({ rect, x: 660, y: 590 }), { side: 'right', yRatio: 0.88 });
    const position = bookmarkPosition({ rect, side: 'right', yRatio: 0.55, width: 48, height: 68 });
    assert.equal(position.left, 646);
    assert.equal(position.top, 346);
});

test('设置页按七个清晰模块展示全部功能且字号跟随全局设置', () => {
    const source = readTheaterImplementation();
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const popupBuilder = source.match(/function (?:runtime\.)?buildPopupHTML\([\s\S]*?\/\/ Rendering helpers/)?.[0] || '';
    for (const id of [
        'theater-api-mode', 'theater-api-preset-select', 'theater-api-protocol', 'theater-api-url',
        'theater-api-key', 'theater-api-model', 'theater-max-output-tokens', 'theater-stream-enabled',
        'theater-auto-continue', 'theater-max-auto-rounds', 'theater-save-api-preset-btn',
        'theater-update-api-preset-btn', 'theater-rename-api-preset-btn', 'theater-delete-api-preset-btn',
        'theater-dream-memory-api-preset', 'theater-dream-memory-batch-size',
        'theater-dream-memory-prompt', 'theater-reset-dream-memory-prompt',
        'theater-wb-read-mode', 'theater-sound-enabled', 'theater-sound-preset',
        'theater-sound-preview-btn', 'theater-sound-volume', 'theater-random-enabled',
        'theater-random-scope', 'theater-auto-enabled', 'theater-auto-interval', 'theater-auto-source',
        'theater-result-bookmark-enabled', 'theater-floating-ball-toggle', 'theater-floating-ball-tuck-toggle',
        'theater-update-btn', 'theater-reload-after-update-btn', 'theater-update-ready-hint',
    ]) assert.match(source, new RegExp(`id="${id}"`));
    for (const group of ['api', 'layout', 'generation', 'automation', 'materials', 'access', 'extension']) {
        assert.match(source, new RegExp(`data-config-group="\\$\\{group.id\\}"|id: '${group}'`));
    }
    const decorator = source.match(/function (?:runtime\.)?decorateConfigLayout\(\)[\s\S]*?\n\}/)?.[0] || '';
    assert.match(popupBuilder, /<div class="theater-config-layout"><div class="theater-config-groups">/);
    assert.match(popupBuilder, /configGroupOrder = \{ api: 1, layout: 2, generation: 3, automation: 4, materials: 5, access: 6, extension: 8 \}/);
    assert.match(popupBuilder, /runtime\.backup\?\.settingsHTML\(\)/);
    assert.ok(popupBuilder.indexOf('theater-config-layout') < popupBuilder.indexOf('data-config-section="api"'));
    assert.match(decorator, /\$panel\.children\('\.theater-config-layout'\)\.length\) return/);
    assert.doesNotMatch(decorator, /theater-config-index/);
    assert.doesNotMatch(source, /data-config-section="logs"/);
    assert.doesNotMatch(source, /theater-api-preset-menu/);
    assert.doesNotMatch(source, /theater-api-current-card/);
    assert.doesNotMatch(source, /生成体验与策略|素材与辅助联动/);
    assert.doesNotMatch(source, /下载完成后仍由你决定何时刷新/);
    assert.match(source, /theater-config-icon-btn/);
    assert.match(source, /data-theater-number-step="-1"/);
    assert.match(source, /data-theater-number-step="1"/);
    assert.match(source, /data-config-extra-body="generation"/);
    assert.doesNotMatch(source, /data-config-extra-body="experience"/);
    assert.match(decorator, /title: '生成控制'/);
    assert.match(decorator, /title: '指令与自动生成'/);
    assert.match(decorator, /title: '素材与提示'/);
    assert.match(decorator, /title: '界面与快捷入口'/);
    assert.match(source, /theater-config-api-actions/);
    assert.match(source, /theater-config-inline-control/);
    assert.match(source, /theater-config-range-control/);
    assert.match(styles, /\.theater-config-card/);
    assert.match(styles, /\.theater-config-switch/);
    assert.match(styles, /\.theater-panel\[data-panel="config"\][\s\S]*?text-align:\s*left/);
    assert.match(styles, /\.theater-config-stepper/);
    assert.match(styles, /--t-config-title-size:\s*calc\(var\(--t-text-base\)/);
    assert.match(styles, /--t-config-desc-size:\s*calc\(var\(--t-text-xs\)/);
    assert.match(styles, /\.theater-config-card \.theater-config-setting-copy b[\s\S]*?font-size:\s*var\(--t-config-title-size\)/);
    assert.match(styles, /\.theater-config-card \.theater-config-setting-copy small[\s\S]*?font-size:\s*var\(--t-config-desc-size\)/);
    assert.match(styles, /\.theater-config-card \.theater-api-preset-actions\s*\{[\s\S]*?position:\s*static/);
    assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.theater-config-card \.theater-api-preset-control\s*\{\s*grid-template-columns:\s*1fr/);
});

test('悬浮球拖动后跨重建恢复位置，缩屏不覆盖偏好，点击与收纳不改位置', () => {
    const source = readTheaterImplementation();
    const createSource = source.match(/function (?:runtime\.)?createFloatingBall\(\) \{[\s\S]*?\n\}/)[0];
    const settings = { floatingBall: true, floatingBallTuck: true, floatingBallPosition: null };
    let saves = 0;
    function launch(width = 390, height = 844) {
        let ball;
        const gestures = new Map();
        const windowEvents = new Map();
        const timers = new Map();
        let timerId = 0;
        const doc = {
            querySelectorAll: () => [], querySelector: () => null,
            addEventListener: (type, fn) => gestures.set(type, fn),
            removeEventListener: type => gestures.delete(type),
            createElement: () => {
                ball = {
                    style: {}, dataset: {}, events: new Map(), isConnected: false,
                    setAttribute(name, text) {
                        if (name === 'style') for (const part of text.split(';')) {
                            const [key, value] = part.split(':'); this.style[key] = value;
                        }
                    },
                    addEventListener(type, fn) { this.events.set(type, fn); },
                    remove() { this.isConnected = false; },
                };
                return ball;
            },
            documentElement: { appendChild: node => { node.isConnected = true; } },
        };
        const win = {
            innerWidth: width, innerHeight: height, PointerEvent: true,
            addEventListener: (type, fn) => windowEvents.set(type, fn),
            removeEventListener: type => windowEvents.delete(type),
        };
        runInNewContext(`let floatingBallCleanup = null; ${createSource}; createFloatingBall();`, {
            settings, document: doc, window: win, LAMP_SVG_HTML: '',
            save: () => { saves++; }, refreshUpdateBadges() {}, openTheaterPopupFromFloatingBall() {},
            setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
            clearTimeout: id => timers.delete(id), console: { warn: (...args) => { throw new Error(args.join(' ')); } },
        });
        const event = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, cancelable: true, preventDefault() {} });
        return {
            ball, win,
            drag(left, top) {
                const x = parseFloat(ball.style.left), y = parseFloat(ball.style.top);
                ball.events.get('pointerdown')(event(x, y));
                gestures.get('pointermove')(event(left, top));
                gestures.get('pointerup')(event(left, top));
            },
            resize(w, h) { win.innerWidth = w; win.innerHeight = h; windowEvents.get('resize')(); },
            tuck() { for (const fn of [...timers.values()]) fn(); },
            tap() {
                const x = parseFloat(ball.style.left), y = parseFloat(ball.style.top);
                ball.events.get('pointerdown')(event(x, y));
                gestures.get('pointerup')(event(x, y));
            },
        };
    }
    const first = launch();
    assert.equal(parseFloat(first.ball.style.top), 718);
    assert.equal(saves, 0);
    first.drag(0, 398);
    assert.equal(settings.floatingBallPosition.side, 'left');
    assert.equal(settings.floatingBallPosition.yRatio, 0.5);
    assert.equal(saves, 1);
    const reloaded = launch();
    assert.equal(parseFloat(reloaded.ball.style.left), 6);
    assert.equal(parseFloat(reloaded.ball.style.top), 398);
    reloaded.resize(844, 390);
    assert.equal(parseFloat(reloaded.ball.style.top), 171);
    reloaded.resize(390, 30);
    assert.equal(parseFloat(reloaded.ball.style.top), 0);
    reloaded.resize(390, 844);
    assert.equal(parseFloat(reloaded.ball.style.top), 398);
    reloaded.tuck();
    assert.equal(parseFloat(reloaded.ball.style.left), -22);
    reloaded.tap();
    assert.equal(parseFloat(reloaded.ball.style.left), 6);
    assert.equal(saves, 1);
    reloaded.drag(340, 597);
    assert.equal(settings.floatingBallPosition.side, 'right');
    assert.equal(settings.floatingBallPosition.yRatio, 0.75);
    assert.equal(parseFloat(launch().ball.style.top), 597);
    settings.floatingBallPosition = { side: 'right', yRatio: NaN };
    assert.equal(parseFloat(launch().ball.style.top), 718);
    settings.floatingBallPosition = { side: 'left', yRatio: 5 };
    assert.equal(parseFloat(launch().ball.style.top), 796);
});

test('模板分页每页10条，跨页筛选保持原索引和勾选，删除末页可回退', () => {
    const source = readTheaterImplementation();
    const render = source.match(/function (?:runtime\.)?renderInstList\(arr\) \{[\s\S]*?\n\}/)[0];
    const filter = source.match(/function filterInstAll\(arr\) \{[\s\S]*?\n\}/)[0];
    const templates = Array.from({ length: 23 }, (_, i) => ({ name: `模板${i}`, tags: [i % 2 ? '奇数' : '偶数'] }));
    const scope = { settings: { instructionTagFilter: [] }, instSearch: '', instPage: 0, INST_PAGE_SIZE: 10, listPage, listPaginationHTML,
        instSelected: new Set([0, 10]), knownInstructionTags: () => ['奇数', '偶数'], matchesTagFilter, esc: value => String(value), templates };
    const renderPage = (code = '') => runInNewContext(`${filter}\n${render}\n${code}\nrenderInstList(templates);`, scope);
    const count = html => (html.match(/class="theater-inst-item/g) || []).length;
    const first = renderPage(); assert.equal(count(first), 10); assert.match(first, /data-index="0" checked/);
    const second = renderPage('instPage = 1;'); assert.equal(count(second), 10); assert.match(second, /data-index="10" checked/);
    assert.doesNotMatch(second, /data-index="0"/);
    assert.equal(count(renderPage('instPage = 2;')), 3);
    scope.templates = templates.slice(0, 20);
    const clamped = renderPage(); assert.equal(scope.instPage, 1); assert.equal(count(clamped), 10);
    scope.templates = templates; scope.instSearch = '模板22';
    assert.match(renderPage('instPage = 0;'), /data-index="22"/);
    scope.instSearch = ''; scope.settings.instructionTagFilter = ['奇数'];
    const tagged = renderPage('instPage = 1;'); assert.equal(count(tagged), 1); assert.match(tagged, /data-index="21"/);
    assert.deepEqual([...scope.instSelected], [0, 10]);
});

test('小剧场下拉框保留原生选择，避开全局下拉美化脚本', () => {
    const source = readTheaterImplementation();
    const selects = [...source.matchAll(/<select\b[^>]*>/g)].map(match => match[0]);
    assert.ok(selects.length >= 20);
    for (const select of selects) assert.match(select, /\bdata-select2-id="\$\{(?:runtime\.)?theaterNativeSelectCompatId\(\)\}"/);
    assert.match(source, /return `\$\{(?:runtime\.)?theaterNativeSelectCompatPrefix\}-\$\{\+\+(?:runtime\.)?theaterNativeSelectCompatCounter\}`/);
    assert.match(source, /id="theater-preset-search"/);
    assert.match(source, /'change\.tpns'[^\n]*'#theater-preset-name-select'/);
    assert.match(source, /'change\.tsp'[^\n]*'#theater-sound-preset'/);
    const guardSource = source.match(/function guardTheaterNativeSelectEvent\(event\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(guardSource);
    const listeners = new Map();
    const window = { addEventListener(type, handler, capture) { listeners.set(type, { handler, capture }); } };
    runInNewContext(`${guardSource}\nwindow.addEventListener('mousedown', guardTheaterNativeSelectEvent, true);\nwindow.addEventListener('touchend', guardTheaterNativeSelectEvent, true);`, { window });
    for (const type of ['mousedown', 'touchend']) {
        assert.equal(listeners.get(type)?.capture, true);
        for (const isTheaterSelect of [true, false]) {
            let stopped = 0;
            let prevented = 0;
            const event = {
                target: { closest: selector => selector === '.theater-popup select.theater-select' && isTheaterSelect ? {} : null },
                stopPropagation: () => stopped++,
                preventDefault: () => prevented++,
            };
            listeners.get(type).handler(event);
            assert.equal(stopped, isTheaterSelect ? 1 : 0);
            assert.equal(prevented, 0);
        }
    }
});
