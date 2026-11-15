// 从 core.test.js 拆出：popup-ui
import { readStyles } from './styles.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation } from './theater-source.js';

test('主弹窗不再固定等待，并独立读取预设和世界书列表', () => {
    const source = readTheaterImplementation();
    assert.match(source, /waitForPopupElements\([\s\S]*?'theater-preset-name-select'[\s\S]*?'theater-wb-books'/);
    assert.match(source, /Promise\.allSettled\(\[[\s\S]*?(?:runtime\.)?loadWorldBookList\(\)[\s\S]*?(?:runtime\.)?loadPresetNameList\(\)/);
    assert.doesNotMatch(source, /setTimeout\(r, 50\)/);
});

test('主弹窗直接绑定的命名处理器都有真实实现', () => {
    const source = readTheaterImplementation();
    const bindStart = source.indexOf('function bindEvents() {');
    const bindEnd = source.indexOf('function refreshInstUI', bindStart);
    assert.ok(bindStart >= 0 && bindEnd > bindStart);
    const bindSource = source.slice(bindStart, bindEnd);
    const handlerNames = bindSource.split(/\r?\n/).flatMap(line => {
        const threeArgs = line.match(/\.on\(\s*'[^']*'\s*,\s*(?:'[^']*'|[A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\);\s*$/);
        if (threeArgs) return [threeArgs[1]];
        const twoArgs = line.match(/\.on\(\s*'[^']*'\s*,\s*([A-Za-z_$][\w$]*)\s*\);\s*$/);
        return twoArgs ? [twoArgs[1]] : [];
    });
    const missing = [...new Set(handlerNames)].filter(name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !new RegExp(`(?:async\\s+)?function\\s+${escaped}\\b|(?:const|let|var)\\s+${escaped}\\s*=`).test(source);
    });
    assert.deepEqual(missing, []);
    const updateBinding = bindSource.indexOf("$d.off('click.tup')");
    const ordinaryBindings = bindSource.indexOf('const tokenAffectingSelectors');
    assert.ok(updateBinding >= 0 && updateBinding < ordinaryBindings);
    assert.match(source, /try \{\s*(?:runtime\.)?bindEvents\(\);\s*\} catch \(error\) \{[\s\S]*?按钮初始化失败/);
});

test('主弹窗事件命名空间不互相覆盖，历史操作保持完整绑定', () => {
    const source = readTheaterImplementation();
    const bindStart = source.indexOf('function bindEvents() {');
    const bindEnd = source.indexOf('function refreshInstUI', bindStart);
    assert.ok(bindStart >= 0 && bindEnd > bindStart);
    const bindSource = source.slice(bindStart, bindEnd);
    const namespaces = [...bindSource.matchAll(/\.off\(\s*'([^']+)'\s*\)/g)].map(match => match[1]);
    const duplicates = [...new Set(namespaces.filter((name, index) => namespaces.indexOf(name) !== index))];
    assert.deepEqual(duplicates, []);

    const requiredHistorySelectors = [
        '.theater-history-view',
        '.theater-history-continue',
        '.theater-history-export',
        '.theater-history-tags-edit',
        '.theater-history-delete',
        '#theater-export-all-history',
        '#theater-import-history-btn',
        '#theater-hist-batch-enter',
        '#theater-hist-select-all',
        '#theater-hist-delete-selected',
    ];
    requiredHistorySelectors.forEach(selector => assert.ok(bindSource.includes(`'${selector}'`), `${selector} 没有绑定`));
});

test('历史卡片紧凑呈现标题标签与时间操作，保留即时触控与连续多选', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    const renderer = source.match(/function (?:runtime\.)?historyItemHTML[\s\S]*?function longDreamSources/)?.[0] || '';
    const bindStart = source.indexOf('function bindEvents() {');
    const bindEnd = source.indexOf('function refreshInstUI', bindStart);
    const bindings = source.slice(bindStart, bindEnd);
    const touchAttachment = source.match(/function (?:runtime\.)?attachHistoryTouchMoveHandler[\s\S]*?function (?:runtime\.)?resetHistorySelectionGesture/)?.[0] || '';
    const titleRow = renderer.indexOf('theater-history-expand');
    const tags = renderer.indexOf('theater-history-tags');
    const meta = renderer.indexOf('theater-history-body');
    const actions = renderer.indexOf('theater-history-actions');

    assert.ok(titleRow >= 0 && tags > titleRow && meta > tags && actions > meta);
    assert.match(renderer, /function historyTagBadgesHTML[\s\S]*?tags\.slice\(0, 2\)[\s\S]*?hidden\.join\('、'\)/);
    ['view', 'continue', 'export', 'tags-edit', 'delete'].forEach(action => {
        assert.ok(renderer.includes(`theater-history-${action}`));
    });
    ['theater-export-all-history', 'theater-import-history-btn', 'theater-history-manage-tags', 'theater-hist-batch-enter'].forEach(id => {
        assert.match(source, new RegExp(`<button type="button" id="${id}"`));
    });
    assert.match(bindings, /pointerdown\.thhistgesture/);
    assert.match(bindings, /pointermove\.thhistgesture/);
    assert.match(bindings, /touchstart\.thhistgesture/);
    assert.match(bindings, /touchstart\.thhistgesture[\s\S]*?(?:runtime\.)?attachHistoryTouchMoveHandler\(\)/);
    assert.doesNotMatch(bindings, /document\.addEventListener\('touchmove', (?:runtime\.)?histTouchMoveHandler/);
    assert.match(touchAttachment, /(?:runtime\.)?histTouchMoveHandler = function[\s\S]*?event\.preventDefault\(\)[\s\S]*?(?:runtime\.)?updateHistorySelectionAutoScroll/);
    assert.match(touchAttachment, /document\.addEventListener\('touchmove', (?:runtime\.)?histTouchMoveHandler, \{ passive: false \}\)/);
    assert.match(source, /function (?:runtime\.)?detachHistoryTouchMoveHandler[\s\S]*?document\.removeEventListener\('touchmove', (?:runtime\.)?histTouchMoveHandler\)/);
    assert.match(source, /const onPopupClosed = \(\) => \{[\s\S]*?(?:runtime\.)?activeTheaterPopupSession !== session[\s\S]*?(?:runtime\.)?detachHistoryTouchMoveHandler\(\);[\s\S]*?(?:runtime\.)?resetHistorySelectionGesture\(\)/);
    assert.match(source, /Promise\.resolve\(p\)\.then\(onPopupClosed, onPopupClosed\)/);
    assert.match(source, /if \(!isCurrentPopup\(\)\) return;/);
    assert.match(bindings, /(?:runtime\.)?histSelectionGesture\.timer = setTimeout\((?:runtime\.)?activateHistorySelectionGesture, 420\)/);
    assert.doesNotMatch(bindings, /if \((?:runtime\.)?histBatchMode\) (?:runtime\.)?activateHistorySelectionGesture\(\)/);
    assert.match(source, /function runHistorySelectionAutoScroll[\s\S]*?scrollTop \+= gesture\.autoScrollSpeed[\s\S]*?(?:runtime\.)?applyHistorySelectionGestureAt/);
    assert.match(source, /function (?:runtime\.)?updateHistorySelectionAutoScroll[\s\S]*?rect\.top \+ edge[\s\S]*?rect\.bottom - edge/);
    assert.match(styles, /\.theater-history-top-bar > \.theater-btn[\s\S]*?touch-action: manipulation/);
    assert.match(styles, /\.theater-history-actions > button[\s\S]*?touch-action: manipulation/);
    assert.match(styles, /\.theater-history-top-bar \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(styles, /\.theater-history-top-bar \.theater-label \{[\s\S]*?text-align: left !important/);
    assert.match(styles, /\.theater-history-actions \{[\s\S]*?grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
    assert.match(styles, /\.theater-history-top-bar > \.theater-btn \{[\s\S]*?border-radius: var\(--t-radius-md\)/);
    assert.match(styles, /\.theater-history-actions > button \{[\s\S]*?border-radius: var\(--t-radius-md\)/);
    assert.match(renderer, /action\('theater-history-export', '导出', 'download', 'title="导出 HTML"'\)/);
    assert.match(styles, /\.theater-history-title-row \{[\s\S]*?flex-wrap: nowrap/);
    assert.match(styles, /\.theater-history-title \{[\s\S]*?text-overflow: ellipsis[\s\S]*?white-space: nowrap/);
    assert.doesNotMatch(bindings, /\$\('\.theater-inst-item'\)\.removeClass\('theater-inst-actions-open'\)/);
    assert.match(source, /function (?:runtime\.)?closeInstructionActionMenus[\s\S]*?querySelectorAll\('\.theater-inst-item\.theater-inst-actions-open'\)/);
});

test('模板列表保持单行紧凑布局，手机菜单不被裁切并支持长按扫选', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    const renderer = source.match(/function (?:runtime\.)?renderInstList[\s\S]*?function (?:runtime\.)?updateBulkBar/)?.[0] || '';
    const menu = source.match(/function (?:runtime\.)?positionInstructionActionMenu[\s\S]*?function (?:runtime\.)?bindInstructionSweepSelection/)?.[0] || '';
    const gesture = source.match(/function (?:runtime\.)?bindInstructionSweepSelection[\s\S]*?\/\/ ---- World Book/)?.[0] || '';

    assert.doesNotMatch(renderer, /itemTagBadgesHTML|tagBadges/);
    assert.match(renderer, /class="theater-inst-tags"/);
    assert.match(source, /function itemTagBadgesHTML[\s\S]*?visibleTags[\s\S]*?hiddenCount[\s\S]*?is-count/);
    assert.match(styles, /\.theater-inst-info \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(styles, /\.theater-inst-name \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap/);

    assert.match(menu, /is-viewport-positioned/);
    assert.match(menu, /getBoundingClientRect\(\)[\s\S]*?opensUp/);
    assert.match(styles, /\.theater-inst-actions\.is-viewport-positioned \{[\s\S]*?position: fixed;[\s\S]*?z-index: 10020/);
    assert.match(styles, /\.theater-drawer\.theater-inst-menu-open \{ overflow: visible; \}/);

    assert.match(gesture, /(?:runtime\.)?INSTRUCTION_SWEEP_HOLD_MS/);
    assert.match(gesture, /(?:runtime\.)?INSTRUCTION_SWEEP_MOVE_TOLERANCE/);
    assert.match(gesture, /touchmove[\s\S]*?passive: false/);
    assert.match(gesture, /document\.elementFromPoint/);
    assert.match(gesture, /const autoScrollStep[\s\S]*?scrollTop \+= direction \* speed[\s\S]*?applyAt\(gesture\.lastX, gesture\.lastY\)/);
    assert.match(gesture, /rect\.top \+ edge[\s\S]*?rect\.bottom - edge/);
    assert.match(gesture, /\.theater-inst-more, \.theater-inst-actions, button, a, input, textarea, select/);
});
