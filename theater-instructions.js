// theater-instructions: receives live state and cross-feature callbacks from index.js.
import { itemTags, TAG_UNCATEGORIZED, normalizeTagFilter, matchesTagFilter, cleanTagName, normalizeTagList, renameTagInList, removeTagFromList, mergeTagLists } from './tag-system.js';
import { listPage, listPaginationHTML } from './pagination.js';
import { recognizeInstructionTitle } from './instruction-title.js';
import { ADAPTIVE_RENDER_SELECTIONS } from './adaptive-render.js';
import { parseInstructionBackup, createInstructionBackup } from './instruction-backup.js';
import { splitInstructionTextFile } from './instruction-import.js';

export function createTheaterInstructions(runtime) {
// @theater-source-begin itemTagBadgesHTML
function itemTagBadgesHTML(item, { showUncategorized = false, limit = Infinity } = {}) {
    const tags = itemTags(item, runtime.knownInstructionTags());
    if (!tags.length) {
        return showUncategorized
            ? '<span class="theater-tag-badge is-uncategorized"><i class="fa-solid fa-tag"></i><span>未分类</span></span>'
            : '';
    }
    const visibleLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : tags.length;
    const visibleTags = tags.slice(0, visibleLimit);
    const hiddenCount = Math.max(0, tags.length - visibleTags.length);
    return `<span class="theater-tag-badges" title="${runtime.esc(tags.join('、'))}">${visibleTags.map(tag => `<span class="theater-tag-badge" title="${runtime.esc(tag)}"><i class="fa-solid fa-tag"></i><span>${runtime.esc(tag)}</span></span>`).join('')}${hiddenCount ? `<span class="theater-tag-badge is-count" title="另有 ${hiddenCount} 个标签"><span>+${hiddenCount}</span></span>` : ''}</span>`;
}
// @theater-source-end itemTagBadgesHTML

// @theater-source-begin tagUsageCounts
function tagUsageCounts() {
    const counts = new Map(runtime.knownInstructionTags().map(tag => [tag, { templates: 0, history: 0 }]));
    (runtime.settings.instructionTemplates || []).forEach(item => itemTags(item, runtime.knownInstructionTags()).forEach(tag => counts.get(tag).templates++));
    runtime.historyCache.forEach(item => itemTags(item, runtime.knownInstructionTags()).forEach(tag => counts.get(tag).history++));
    return counts;
}
// @theater-source-end tagUsageCounts

// @theater-source-begin rollRandomInstruction
function rollRandomInstruction() {
    const templates = runtime.settings.instructionTemplates || [];
    if (!templates.length) { toastr.warning('模板库是空的'); return; }

    const scope = runtime.settings.randomScope || '__current__';
    let filter = [];
    if (scope === '__current__') filter = runtime.settings.instructionTagFilter;
    else if (scope === TAG_UNCATEGORIZED) filter = [TAG_UNCATEGORIZED];
    else if (scope === '__tags__') filter = runtime.settings.randomTagFilter;
    if (scope === '__tags__' && !normalizeTagFilter(filter, runtime.knownInstructionTags()).length) {
        toastr.warning('请先给“抽一个”选择至少一个标签');
        return;
    }
    const pool = scope === '__all__' ? templates : templates.filter(template => matchesTagFilter(template, filter, runtime.knownInstructionTags()));

    if (!pool.length) { toastr.warning('当前抽取范围内没有模板'); return; }
    const t = pool[Math.floor(Math.random() * pool.length)];
    $('#theater-instruction').val(t.content);
    runtime.settings.lastInstruction = t.content;
    if (runtime.continuationSession) runtime.continuationSession.direction = t.content;
    setActiveInstructionTags(itemTags(t, runtime.knownInstructionTags()), t.content);
    runtime.save();
    runtime.scheduleTokenEstimate();
    toastr.info(`已填入：${t.name || '未命名'}`, '', { timeOut: 3000 });
}
// @theater-source-end rollRandomInstruction

// @theater-source-begin setActiveInstructionTags
function setActiveInstructionTags(tags, content = '') {
    runtime.activeInstructionTags = itemTags({ tags }, runtime.knownInstructionTags());
    runtime.activeInstructionContent = String(content || '');
    if (runtime.activeInstructionContent && runtime.activeInstructionContent === String(runtime.settings.lastInstruction || '')) {
        runtime.settings.lastInstructionTags = [...runtime.activeInstructionTags];
    }
}
// @theater-source-end setActiveInstructionTags

// @theater-source-begin filterInstAll
function filterInstAll(arr) {
    const filter = runtime.settings.instructionTagFilter || [];
    const q = (runtime.instSearch || '').toLowerCase().trim();
    return arr.map((t, i) => ({ t, i })).filter(x => {
        if (!matchesTagFilter(x.t, filter, runtime.knownInstructionTags())) return false;
        if (q && !(x.t.name || '').toLowerCase().includes(q)) return false;
        return true;
    });
}
// @theater-source-end filterInstAll

// @theater-source-begin renderInstList
function renderInstList(arr) {
    if (!arr || !arr.length) { runtime.instPage = 0; return '<p class="theater-empty">暂无</p>'; }
    const filtered = filterInstAll(arr);
    if (!filtered.length) {
        runtime.instPage = 0;
        const q = (runtime.instSearch || '').trim();
        return `<p class="theater-empty">${q ? `没找到包含「${runtime.esc(q)}」的模板` : '当前标签组合下还没有模板'}</p>`;
    }
    const pageState = listPage(filtered, runtime.instPage);
    runtime.instPage = pageState.page;
    const pager = listPaginationHTML('inst', pageState);
    return filtered.slice(runtime.instPage * runtime.INST_PAGE_SIZE, (runtime.instPage + 1) * runtime.INST_PAGE_SIZE).map(({ t: item, i }) => {
        const checked = runtime.instSelected.has(i) ? 'checked' : '';
        const selClass = runtime.instSelected.has(i) ? ' theater-inst-item-selected' : '';
        return `
        <div class="theater-inst-item${selClass}" data-index="${i}">
            <input type="checkbox" class="theater-inst-checkbox" data-index="${i}" ${checked}>
            <div class="theater-inst-info">
                <span class="theater-inst-name" data-index="${i}" title="${runtime.esc(item.name || '未命名模板')}"><i class="fa-solid fa-file-lines"></i> ${runtime.esc(item.name)}</span>
            </div>
            <button type="button" class="theater-inst-more" data-index="${i}" title="更多操作" aria-label="打开模板操作菜单" aria-expanded="false"><i class="fa-solid fa-ellipsis"></i></button>
            <div class="theater-inst-actions">
                <span class="theater-inst-edit" data-index="${i}" title="编辑" aria-label="编辑模板"><i class="fa-solid fa-pen"></i></span>
                <span class="theater-inst-tags" data-index="${i}" title="编辑标签" aria-label="编辑模板标签"><i class="fa-solid fa-tags"></i></span>
                <span class="theater-inst-delete" data-index="${i}" title="删除" aria-label="删除模板"><i class="fa-solid fa-xmark"></i></span>
            </div>
        </div>
    `;
    }).join('') + pager;
}
// @theater-source-end renderInstList

// @theater-source-begin updateBulkBar
function updateBulkBar() {
    const n = runtime.instSelected.size;
    if (n === 0) {
        $('#theater-inst-bulk-bar').hide();
    } else {
        $('#theater-inst-bulk-bar').show();
        $('#theater-inst-bulk-count').text(n);
    }
}
// @theater-source-end updateBulkBar

// @theater-source-begin setInstructionItemSelected
function setInstructionItemSelected(index, selected, itemElement = null) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= (runtime.settings.instructionTemplates || []).length) return;
    if (selected) runtime.instSelected.add(i);
    else runtime.instSelected.delete(i);
    const item = itemElement || document.querySelector(`.theater-inst-item[data-index="${i}"]`);
    if (item) {
        item.classList.toggle('theater-inst-item-selected', selected);
        const checkbox = item.querySelector('.theater-inst-checkbox');
        if (checkbox) checkbox.checked = selected;
    }
    updateBulkBar();
}
// @theater-source-end setInstructionItemSelected

// @theater-source-begin closeInstructionActionMenus
function closeInstructionActionMenus(exceptItem = null) {
    document.querySelectorAll('.theater-inst-item.theater-inst-actions-open').forEach(item => {
        if (item === exceptItem) return;
        item.classList.remove('theater-inst-actions-open');
        item.querySelector('.theater-inst-more')?.setAttribute('aria-expanded', 'false');
        const actions = item.querySelector('.theater-inst-actions');
        if (actions) {
            actions.classList.remove('is-viewport-positioned');
            actions.removeAttribute('style');
            actions.removeAttribute('data-placement');
        }
    });
    const hasOpenMenu = !!document.querySelector('.theater-inst-item.theater-inst-actions-open');
    document.getElementById('theater-inst-drawer')?.classList.toggle('theater-inst-menu-open', hasOpenMenu);
}
// @theater-source-end closeInstructionActionMenus

// @theater-source-begin positionInstructionActionMenu
function positionInstructionActionMenu(item) {
    if (!item?.classList.contains('theater-inst-actions-open')) return;
    const actions = item.querySelector('.theater-inst-actions');
    const trigger = item.querySelector('.theater-inst-more');
    if (!actions || !trigger || !window.matchMedia('(max-width: 768px)').matches) return;

    actions.classList.add('is-viewport-positioned');
    actions.style.left = '0px';
    actions.style.top = '0px';
    actions.style.visibility = 'hidden';
    const triggerRect = trigger.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const scrollRect = document.querySelector('.theater-panels-wrapper')?.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    const minLeft = Math.max(edge, (scrollRect?.left ?? 0) + edge);
    const maxRight = Math.min(window.innerWidth - edge, (scrollRect?.right ?? window.innerWidth) - edge);
    const minTop = Math.max(edge, (scrollRect?.top ?? 0) + edge);
    const maxBottom = Math.min(window.innerHeight - edge, (scrollRect?.bottom ?? window.innerHeight) - edge);
    const left = Math.max(minLeft, Math.min(maxRight - actionsRect.width, triggerRect.right - actionsRect.width));
    const belowTop = triggerRect.bottom + gap;
    const aboveTop = triggerRect.top - actionsRect.height - gap;
    const opensUp = belowTop + actionsRect.height > maxBottom && aboveTop >= minTop;
    const top = Math.max(minTop, Math.min(maxBottom - actionsRect.height, opensUp ? aboveTop : belowTop));
    actions.style.left = `${Math.round(left)}px`;
    actions.style.top = `${Math.round(top)}px`;
    actions.style.visibility = '';
    actions.dataset.placement = opensUp ? 'up' : 'down';
}
// @theater-source-end positionInstructionActionMenu

// @theater-source-begin bindInstructionSweepSelection
function bindInstructionSweepSelection() {
    if (runtime.instructionSweepCleanup) runtime.instructionSweepCleanup();
    const list = document.getElementById('theater-instruction-list');
    if (!list) {
        runtime.instructionSweepCleanup = null;
        return;
    }

    let gesture = null;
    let suppressClickUntil = 0;
    const excluded = '.theater-inst-checkbox, .theater-inst-more, .theater-inst-actions, button, a, input, textarea, select';
    const scrollHost = (() => {
        let node = list.parentElement;
        while (node) {
            const overflowY = window.getComputedStyle(node).overflowY;
            if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
            node = node.parentElement;
        }
        return document.querySelector('.theater-panels-wrapper');
    })();

    const reset = ({ suppressClick = false } = {}) => {
        if (gesture?.timer) clearTimeout(gesture.timer);
        if (gesture?.autoScrollFrame) cancelAnimationFrame(gesture.autoScrollFrame);
        if (gesture?.active) {
            list.classList.remove('is-sweep-selecting');
            list.querySelectorAll('.is-sweep-touched').forEach(item => item.classList.remove('is-sweep-touched'));
            if (suppressClick) suppressClickUntil = Date.now() + 600;
        }
        gesture = null;
    };

    const applyAt = (clientX, clientY) => {
        if (!gesture?.active) return;
        const item = document.elementFromPoint(clientX, clientY)?.closest?.('.theater-inst-item');
        if (!item || !list.contains(item)) return;
        const index = Number(item.dataset.index);
        if (!Number.isInteger(index) || gesture.visited.has(index)) return;
        gesture.visited.add(index);
        item.classList.add('is-sweep-touched');
        setInstructionItemSelected(index, gesture.selecting, item);
    };

    const autoScrollStep = () => {
        if (!gesture?.active) return;
        gesture.autoScrollFrame = null;
        if (!scrollHost || !Number.isFinite(gesture.lastY)) return;

        const rect = scrollHost.getBoundingClientRect();
        const edge = Math.min(runtime.INSTRUCTION_SWEEP_SCROLL_EDGE, rect.height / 3);
        let direction = 0;
        let pressure = 0;
        if (gesture.lastY < rect.top + edge) {
            direction = -1;
            pressure = (rect.top + edge - gesture.lastY) / edge;
        } else if (gesture.lastY > rect.bottom - edge) {
            direction = 1;
            pressure = (gesture.lastY - (rect.bottom - edge)) / edge;
        }

        if (!direction) return;
        const before = scrollHost.scrollTop;
        const speed = Math.max(3, Math.round(Math.min(1, pressure) * runtime.INSTRUCTION_SWEEP_SCROLL_MAX_SPEED));
        scrollHost.scrollTop += direction * speed;
        if (scrollHost.scrollTop !== before) {
            applyAt(gesture.lastX, gesture.lastY);
            gesture.autoScrollFrame = requestAnimationFrame(autoScrollStep);
        }
    };

    const trackAt = (clientX, clientY) => {
        if (!gesture?.active) return;
        gesture.lastX = clientX;
        gesture.lastY = clientY;
        applyAt(clientX, clientY);
        if (!gesture.autoScrollFrame) gesture.autoScrollFrame = requestAnimationFrame(autoScrollStep);
    };

    const activate = () => {
        if (!gesture || gesture.active || !gesture.item.isConnected) return;
        gesture.active = true;
        gesture.selecting = !runtime.instSelected.has(gesture.index);
        gesture.visited = new Set();
        closeInstructionActionMenus();
        list.classList.add('is-sweep-selecting');
        trackAt(gesture.startX, gesture.startY);
    };

    const arm = ({ item, clientX, clientY, pointerId = null, kind }) => {
        reset();
        const index = Number(item.dataset.index);
        if (!Number.isInteger(index)) return;
        gesture = {
            item, index, kind, pointerId,
            startX: clientX, startY: clientY,
            lastX: clientX, lastY: clientY,
            active: false, selecting: true, visited: new Set(), timer: null,
            autoScrollFrame: null,
        };
        gesture.timer = setTimeout(activate, runtime.INSTRUCTION_SWEEP_HOLD_MS);
    };

    const startItem = target => {
        if (!(target instanceof Element) || target.closest(excluded)) return null;
        const item = target.closest('.theater-inst-item');
        return item && list.contains(item) ? item : null;
    };

    const onTouchStart = event => {
        if (event.touches.length !== 1) { reset(); return; }
        const item = startItem(event.target);
        if (!item) return;
        const touch = event.touches[0];
        arm({ item, clientX: touch.clientX, clientY: touch.clientY, kind: 'touch' });
    };
    const onTouchMove = event => {
        if (!gesture || gesture.kind !== 'touch') return;
        const touch = event.touches[0];
        if (!touch) { reset(); return; }
        if (!gesture.active) {
            if (Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY) > runtime.INSTRUCTION_SWEEP_MOVE_TOLERANCE) reset();
            return;
        }
        if (event.cancelable) event.preventDefault();
        trackAt(touch.clientX, touch.clientY);
    };
    const onTouchEnd = event => {
        if (!gesture || gesture.kind !== 'touch') return;
        if (gesture.active && event.cancelable) event.preventDefault();
        reset({ suppressClick: gesture.active });
    };
    const onPointerDown = event => {
        if (event.pointerType === 'touch' || event.button !== 0) return;
        const item = startItem(event.target);
        if (!item) return;
        arm({ item, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, kind: 'pointer' });
    };
    const onPointerMove = event => {
        if (!gesture || gesture.kind !== 'pointer' || gesture.pointerId !== event.pointerId) return;
        if (!gesture.active) {
            if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > runtime.INSTRUCTION_SWEEP_MOVE_TOLERANCE) reset();
            return;
        }
        event.preventDefault();
        trackAt(event.clientX, event.clientY);
    };
    const onPointerEnd = event => {
        if (!gesture || gesture.kind !== 'pointer' || gesture.pointerId !== event.pointerId) return;
        reset({ suppressClick: gesture.active });
    };
    const onClickCapture = event => {
        if (Date.now() >= suppressClickUntil || !event.target.closest?.('.theater-inst-item')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const onContextMenu = event => {
        if (gesture?.active && event.target.closest?.('.theater-inst-item')) event.preventDefault();
    };

    list.addEventListener('touchstart', onTouchStart, { passive: true });
    list.addEventListener('touchmove', onTouchMove, { passive: false });
    list.addEventListener('touchend', onTouchEnd, { passive: false });
    list.addEventListener('touchcancel', onTouchEnd, { passive: false });
    list.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
    list.addEventListener('click', onClickCapture, true);
    list.addEventListener('contextmenu', onContextMenu);

    runtime.instructionSweepCleanup = () => {
        reset();
        list.removeEventListener('touchstart', onTouchStart);
        list.removeEventListener('touchmove', onTouchMove);
        list.removeEventListener('touchend', onTouchEnd);
        list.removeEventListener('touchcancel', onTouchEnd);
        list.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerEnd);
        document.removeEventListener('pointercancel', onPointerEnd);
        list.removeEventListener('click', onClickCapture, true);
        list.removeEventListener('contextmenu', onContextMenu);
    };
}
// @theater-source-end bindInstructionSweepSelection

// @theater-source-begin chooseTags
async function chooseTags({ title = '选择标签', subtitle = '可多选；多个筛选标签表示同时包含', selected = [], allowUncategorized = false } = {}) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const current = normalizeTagFilter(selected, runtime.knownInstructionTags());
    const uncategorized = current[0] === TAG_UNCATEGORIZED;
    const rows = [];
    if (allowUncategorized) {
        rows.push(`<label class="theater-tag-choice is-special"><input type="checkbox" value="${TAG_UNCATEGORIZED}" ${uncategorized ? 'checked' : ''}><span><i class="fa-solid fa-inbox"></i><b>未分类</b><small>没有任何标签的内容</small></span></label>`);
    }
    runtime.knownInstructionTags().forEach(tag => {
        rows.push(`<label class="theater-tag-choice"><input type="checkbox" value="${runtime.esc(tag)}" ${current.includes(tag) ? 'checked' : ''}><span><i class="fa-solid fa-tag"></i><b>${runtime.esc(tag)}</b></span></label>`);
    });
    const emptyHint = runtime.knownInstructionTags().length ? '' : '<p class="theater-empty">还没有标签，可以先用“新建标签”添加。</p>';
    const html = `<div class="theater-popup" data-skin="${runtime.settings.skinMode || 'default'}">
        <div class="theater-popup-header"><p class="theater-title">${runtime.esc(title)}</p><p class="theater-subtitle">${runtime.esc(subtitle)}</p></div>
        <div class="theater-section"><button type="button" class="theater-tag-clear theater-btn"><i class="fa-solid fa-rotate-left"></i><span>清空选择${allowUncategorized ? '（显示全部）' : ''}</span></button><div class="theater-tag-choice-list">${rows.join('')}${emptyHint}</div></div>
    </div>`;
    const popup = new Popup(html, POPUP_TYPE.CONFIRM, '', { wide: false, okButton: '应用', cancelButton: '取消', allowVerticalScrolling: true });
    const showPromise = popup.show();
    const $body = $(popup.dlg);
    $body.on('change', '.theater-tag-choice input', function () {
        if (this.value === TAG_UNCATEGORIZED && this.checked) {
            $body.find('.theater-tag-choice input').not(this).prop('checked', false);
        } else if (this.checked) {
            $body.find(`.theater-tag-choice input[value="${TAG_UNCATEGORIZED}"]`).prop('checked', false);
        }
    });
    $body.on('click', '.theater-tag-clear', () => $body.find('.theater-tag-choice input').prop('checked', false));
    const result = await showPromise;
    if (!result) return null;
    return normalizeTagFilter($body.find('.theater-tag-choice input:checked').map((_, input) => input.value).get(), runtime.knownInstructionTags());
}
// @theater-source-end chooseTags

// @theater-source-begin askNewItemName
async function askNewItemName(title, defaultName, maxLength = 80) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(`<div class="theater-popup"><label>${runtime.esc(title)}<input class="theater-input theater-default-name" data-new-item-name maxlength="${maxLength}" value="" placeholder="${runtime.esc(defaultName)}" autocomplete="off"></label></div>`, POPUP_TYPE.CONFIRM, '', { okButton: '保存', cancelButton: '取消' });
    if (!(await popup.show())) return null;
    return (String($(popup.dlg).find('[data-new-item-name]').val() || '').trim() || String(defaultName).trim()).slice(0, maxLength);
}
// @theater-source-end askNewItemName

// @theater-source-begin chooseTagsWithNew
async function chooseTagsWithNew({ title = '选择标签', subtitle = '勾选已有标签，也可以同时新建一个标签', selected = [], okButton = '确认', templateName = null, nameLabel = '模板名称', namePlaceholder = '给这个模板起个名字', instructionContent = null } = {}) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const known = runtime.knownInstructionTags();
    const current = normalizeTagFilter(selected, known);
    const rows = known.map(tag => `<label class="theater-tag-choice"><input type="checkbox" value="${runtime.esc(tag)}" ${current.includes(tag) ? 'checked' : ''}><span><i class="fa-solid fa-tag"></i><b>${runtime.esc(tag)}</b></span></label>`).join('');
    const emptyHint = known.length ? '' : '<p class="theater-empty theater-tag-choice-empty">还没有标签，可以在下方直接添加。</p>';
    const html = `<div class="theater-popup theater-compact-popup" data-skin="${runtime.settings.skinMode || 'default'}">
        <div class="theater-popup-header"><p class="theater-title">${runtime.esc(title)}</p></div>
        <div class="theater-section theater-compact-tag-body">
            ${templateName === null ? '' : `<div class="theater-tag-template-name-field">
                <label for="theater-tag-template-name"><i class="fa-solid fa-file-signature"></i> ${runtime.esc(nameLabel)}</label>
                <input id="theater-tag-template-name" class="theater-input theater-default-name" maxlength="60" autocomplete="off" value="" placeholder="${runtime.esc(templateName || namePlaceholder)}">
            </div>`}
            ${instructionContent === null ? '' : `<div class="theater-instruction-title-options">
                <label><input type="checkbox" data-instruction-title-auto ${runtime.settings.autoRecognizeInstructionTitle === true ? 'checked' : ''}> 自动识别标题</label>
                <small data-instruction-title-status aria-live="polite"></small>
                <details><summary>查看将保存的指令内容</summary><textarea class="theater-textarea" data-instruction-content-preview readonly rows="6" aria-label="将保存的指令内容"></textarea></details>
            </div>`}
            <div class="theater-compact-tag-heading"><b>选择标签</b><small>可多选 · 也可以不选</small></div>
            <div class="theater-tag-choice-list is-compact">${rows}${emptyHint}</div>
            <div class="theater-tag-create-box">
                <div class="theater-tag-create-row">
                    <input id="theater-tag-create-input" class="theater-input" maxlength="30" autocomplete="off" placeholder="新标签名称">
                    <button type="button" class="theater-tag-create-confirm theater-btn"><i class="fa-solid fa-plus"></i><span>添加</span></button>
                </div>
                <small>${runtime.esc(subtitle)}；添加后会自动选中。</small>
            </div>
        </div>
    </div>`;
    const popup = new Popup(html, POPUP_TYPE.CONFIRM, '', { wide: false, okButton, cancelButton: '取消', allowVerticalScrolling: true });
    const showPromise = popup.show();
    const $body = $(popup.dlg);
    let instructionSelection = null;
    if (instructionContent !== null) {
        const parsed = recognizeInstructionTitle(instructionContent);
        const $name = $body.find('#theater-tag-template-name');
        let manuallyNamed = false;
        $name.on('input', () => { manuallyNamed = true; });
        const updateInstructionPreview = () => {
            const enabled = $body.find('[data-instruction-title-auto]').is(':checked');
            const recognized = enabled && parsed.recognized;
            instructionSelection = { content: recognized ? parsed.content : instructionContent, autoRecognizeTitle: enabled };
            if (!manuallyNamed) $name.val(recognized ? parsed.name : '');
            $body.find('[data-instruction-content-preview]').val(instructionSelection.content);
            $body.find('[data-instruction-title-status]').text(!enabled
                ? '关闭时保留完整原文；保存后记住开关选择。'
                : recognized ? '已识别开头标题，请核对名称和内容；关闭开关可保留完整原文。'
                    : '未识别到明确的开头标题，已保留完整原文；名称留空将使用浅色提示中的默认名称。');
        };
        $body.on('change', '[data-instruction-title-auto]', updateInstructionPreview);
        updateInstructionPreview();
    }
    const selectOrAppendTag = raw => {
        const tag = cleanTagName(raw);
        if (!tag) return null;
        if (tag.toLocaleLowerCase() === TAG_UNCATEGORIZED.toLocaleLowerCase()) {
            toastr.warning('这个名称是系统保留值，请换一个标签名');
            return null;
        }
        const inputs = $body.find('.theater-tag-choice input').get();
        const existingInput = inputs.find(input => String(input.value).toLocaleLowerCase() === tag.toLocaleLowerCase());
        if (existingInput) {
            existingInput.checked = true;
            return existingInput.value;
        }
        $body.find('.theater-tag-choice-empty').remove();
        $body.find('.theater-tag-choice-list').append(`<label class="theater-tag-choice is-new"><input type="checkbox" value="${runtime.esc(tag)}" checked><span><i class="fa-solid fa-tag"></i><b>${runtime.esc(tag)}</b></span></label>`);
        return tag;
    };
    const addEnteredTag = () => {
        const $input = $body.find('#theater-tag-create-input');
        if (!selectOrAppendTag($input.val())) return false;
        $input.val('').trigger('focus');
        return true;
    };
    $body.on('click', '.theater-tag-create-confirm', addEnteredTag);
    $body.on('keydown', '#theater-tag-create-input', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addEnteredTag();
    });
    const result = await showPromise;
    if (!result) return null;

    const name = templateName === null ? null : String($body.find('#theater-tag-template-name').val() || '').trim() || String(templateName).trim();
    if (templateName !== null && !name) {
        toastr.warning(`${nameLabel}不能为空`);
        return null;
    }
    const checked = $body.find('.theater-tag-choice input:checked').map((_, input) => input.value).get();
    const entered = cleanTagName($body.find('#theater-tag-create-input').val());
    if (entered.toLocaleLowerCase() === TAG_UNCATEGORIZED.toLocaleLowerCase()) {
        toastr.warning('这个名称是系统保留值，请换一个标签名');
        return null;
    }
    const existing = known.find(tag => tag.toLocaleLowerCase() === entered.toLocaleLowerCase());
    const tags = normalizeTagList([...checked, existing || entered]);
    const newTags = tags.filter(tag => !known.some(item => item.toLocaleLowerCase() === tag.toLocaleLowerCase()));
    return {
        name,
        tags,
        newTags,
        ...(instructionSelection || {}),
    };
}
// @theater-source-end chooseTagsWithNew

// @theater-source-begin newInstructionTag
async function newInstructionTag() {
    const name = await SillyTavern.getContext().Popup.show.input('新建标签', '标签名称：', '');
    const tag = cleanTagName(name);
    if (!tag) return null;
    if (tag.toLocaleLowerCase() === TAG_UNCATEGORIZED.toLocaleLowerCase()) {
        toastr.warning('这个名称是系统保留值，请换一个标签名');
        return null;
    }
    const duplicate = runtime.knownInstructionTags().find(item => item.toLocaleLowerCase() === tag.toLocaleLowerCase());
    if (duplicate) { toastr.warning(`标签「${duplicate}」已存在`); return duplicate; }
    runtime.settings.instructionTags = [...runtime.knownInstructionTags(), tag];
    runtime.save();
    runtime.refreshInstUI();
    runtime.refreshHistList();
    toastr.success(`已新建标签「${tag}」`);
    return tag;
}
// @theater-source-end newInstructionTag

// @theater-source-begin updateAllHistoryTags
async function updateAllHistoryTags(transform) {
    let updated = 0;
    for (const item of [...runtime.historyCache]) {
        const before = normalizeTagList(item.tags);
        const tags = transform(before);
        if (JSON.stringify(tags) === JSON.stringify(before)) continue;
        if (await runtime.histPut({ ...item, tags })) updated++;
    }
    runtime.recentCache.forEach(item => { item.tags = transform(normalizeTagList(item.tags)); });
    runtime.continuationSession?.versions.forEach(item => { item.tags = transform(normalizeTagList(item.tags)); });
    if (runtime.recentCache.length) await runtime.recentPersist();
    return updated;
}
// @theater-source-end updateAllHistoryTags

// @theater-source-begin manageInstructionTags
async function manageInstructionTags() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const tags = runtime.knownInstructionTags();
    if (!tags.length) { await newInstructionTag(); return; }
    const counts = tagUsageCounts();
    const rows = tags.map(tag => {
        const count = counts.get(tag) || { templates: 0, history: 0 };
        return `<div class="theater-group-mgmt-row" data-tag="${runtime.esc(tag)}">
            <span class="theater-group-mgmt-name"><i class="fa-solid fa-tag"></i> ${runtime.esc(tag)} <small>模板 ${count.templates} · 历史 ${count.history}</small></span>
            <button type="button" class="theater-tag-mgmt-rename theater-btn" data-tag="${runtime.esc(tag)}"><i class="fa-solid fa-pen"></i><span>改名</span></button>
            <button type="button" class="theater-tag-mgmt-delete theater-btn danger" data-tag="${runtime.esc(tag)}"><i class="fa-solid fa-trash"></i><span>删除</span></button>
        </div>`;
    }).join('');
    const html = `<div class="theater-popup" data-skin="${runtime.settings.skinMode || 'default'}"><div class="theater-popup-header"><p class="theater-title">管理标签</p><p class="theater-subtitle">模板和历史共用名称；删除标签不会删除内容</p></div><div class="theater-section">${rows}</div></div>`;
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', { wide: false, okButton: '关闭', allowVerticalScrolling: true });
    const $body = $(popup.dlg);
    const close = () => typeof popup.completeAffirmative === 'function' ? popup.completeAffirmative() : popup.dlg?.close?.();
    $body.on('click', '.theater-tag-mgmt-rename', async function (event) {
        event.preventDefault();
        const oldName = String($(this).data('tag'));
        const newName = cleanTagName(await Popup.show.input('重命名标签', `把「${oldName}」改成：`, oldName));
        if (!newName || newName === oldName) return;
        if (runtime.knownInstructionTags().some(tag => tag !== oldName && tag.toLocaleLowerCase() === newName.toLocaleLowerCase())) { toastr.warning('已经有同名标签'); return; }
        runtime.settings.instructionTags = renameTagInList(runtime.settings.instructionTags, oldName, newName);
        (runtime.settings.instructionTemplates || []).forEach(item => { item.tags = renameTagInList(item.tags, oldName, newName); });
        runtime.settings.instructionTagFilter = renameTagInList(runtime.settings.instructionTagFilter, oldName, newName);
        runtime.settings.randomTagFilter = renameTagInList(runtime.settings.randomTagFilter, oldName, newName);
        runtime.settings.autoTagFilter = renameTagInList(runtime.settings.autoTagFilter, oldName, newName);
        runtime.settings.historyTagFilter = renameTagInList(runtime.settings.historyTagFilter, oldName, newName);
        runtime.settings.lastInstructionTags = renameTagInList(runtime.settings.lastInstructionTags, oldName, newName);
        runtime.activeInstructionTags = renameTagInList(runtime.activeInstructionTags, oldName, newName);
        runtime.continuationSourceTags = renameTagInList(runtime.continuationSourceTags, oldName, newName);
        await updateAllHistoryTags(tags => renameTagInList(tags, oldName, newName));
        runtime.save(); close(); runtime.refreshInstUI(); runtime.refreshHistList();
        toastr.success(`已改名为「${newName}」`);
    });
    $body.on('click', '.theater-tag-mgmt-delete', async function (event) {
        event.preventDefault();
        const name = String($(this).data('tag'));
        const count = counts.get(name) || { templates: 0, history: 0 };
        const ok = await Popup.show.confirm(`删除标签「${name}」？`, `会从 ${count.templates} 个模板和 ${count.history} 条历史中移除这个标签，内容本身不会删除。`);
        if (!ok) return;
        runtime.settings.instructionTags = removeTagFromList(runtime.settings.instructionTags, name);
        (runtime.settings.instructionTemplates || []).forEach(item => { item.tags = removeTagFromList(item.tags, name); });
        runtime.settings.instructionTagFilter = removeTagFromList(runtime.settings.instructionTagFilter, name);
        runtime.settings.randomTagFilter = removeTagFromList(runtime.settings.randomTagFilter, name);
        runtime.settings.autoTagFilter = removeTagFromList(runtime.settings.autoTagFilter, name);
        runtime.settings.historyTagFilter = removeTagFromList(runtime.settings.historyTagFilter, name);
        runtime.settings.lastInstructionTags = removeTagFromList(runtime.settings.lastInstructionTags, name);
        runtime.activeInstructionTags = removeTagFromList(runtime.activeInstructionTags, name);
        runtime.continuationSourceTags = removeTagFromList(runtime.continuationSourceTags, name);
        await updateAllHistoryTags(tags => removeTagFromList(tags, name));
        runtime.save(); close(); runtime.refreshInstUI(); runtime.refreshHistList();
        toastr.success(`标签「${name}」已删除，模板和历史都保留`);
    });
    popup.show();
}
// @theater-source-end manageInstructionTags

// @theater-source-begin editTemplateTags
async function editTemplateTags(index) {
    const template = (runtime.settings.instructionTemplates || [])[index];
    if (!template) return;
    const chosen = await chooseTags({ title: `编辑「${template.name || '未命名'}」的标签`, selected: template.tags, subtitle: '可以同时选择角色、口味、场景等多个标签' });
    if (chosen === null) return;
    template.tags = chosen;
    if (runtime.activeInstructionContent === String(template.content || '')) setActiveInstructionTags(chosen, runtime.activeInstructionContent);
    runtime.save(); runtime.refreshInstUI();
    toastr.success(chosen.length ? '模板标签已更新' : '模板已设为未分类');
}
// @theater-source-end editTemplateTags

// @theater-source-begin chooseBulkTagOperation
async function chooseBulkTagOperation(count) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const html = `<div class="theater-popup" data-skin="${runtime.settings.skinMode || 'default'}"><div class="theater-popup-header"><p class="theater-title">批量修改标签</p><p class="theater-subtitle">已选 ${count} 项</p></div><div class="theater-section"><select class="theater-select theater-bulk-tag-mode" data-select2-id="${runtime.theaterNativeSelectCompatId()}"><option value="add">添加所选标签</option><option value="remove">移除所选标签</option><option value="replace">替换为所选标签</option></select>${runtime.knownInstructionTags().map(tag => `<label class="theater-tag-choice"><input type="checkbox" value="${runtime.esc(tag)}"><span><i class="fa-solid fa-tag"></i><b>${runtime.esc(tag)}</b></span></label>`).join('')}</div></div>`;
    const popup = new Popup(html, POPUP_TYPE.CONFIRM, '', { wide: false, okButton: '应用', cancelButton: '取消', allowVerticalScrolling: true });
    const showPromise = popup.show();
    const $body = $(popup.dlg);
    const result = await showPromise;
    if (!result) return null;
    return { mode: $body.find('.theater-bulk-tag-mode').val(), tags: normalizeTagList($body.find('.theater-tag-choice input:checked').map((_, input) => input.value).get()) };
}
// @theater-source-end chooseBulkTagOperation

// @theater-source-begin applyBulkTagOperation
function applyBulkTagOperation(tags, operation) {
    if (operation.mode === 'replace') return operation.tags;
    if (operation.mode === 'remove') return normalizeTagList(tags).filter(tag => !operation.tags.includes(tag));
    return normalizeTagList([...normalizeTagList(tags), ...operation.tags]);
}
// @theater-source-end applyBulkTagOperation

// @theater-source-begin saveInstructionTpl
async function saveInstructionTpl() {
    const c = $('#theater-instruction').val().trim();
    if (!c) { toastr.warning('请先在「生成」页输入指令'); return; }
    const count = (runtime.settings.instructionTemplates || []).length + 1;
    const defaultName = `小剧场模板 ${count}`;
    const currentFilter = normalizeTagFilter(runtime.settings.instructionTagFilter, runtime.knownInstructionTags());
    const suggested = currentFilter[0] === TAG_UNCATEGORIZED ? [] : currentFilter;
    const selection = await chooseTagsWithNew({
        title: '保存指令模板',
        subtitle: '不选标签则归为“未分类”',
        selected: suggested,
        okButton: '保存模板',
        templateName: defaultName,
        instructionContent: c,
    });
    if (selection === null) return;
    runtime.settings.instructionTags = normalizeTagList([...runtime.knownInstructionTags(), ...selection.newTags]);
    const tags = mergeTagLists([], selection.tags, runtime.settings.instructionTags);
    runtime.settings.autoRecognizeInstructionTitle = selection.autoRecognizeTitle === true;
    const tpl = { name: selection.name, content: selection.content ?? c, tags };
    runtime.settings.instructionTemplates.push(tpl);
    runtime.save(); runtime.refreshInstUI();
    toastr.success(tags.length ? `已保存 · ${tags.join('、')}` : '已保存为未分类');
}
// @theater-source-end saveInstructionTpl

// @theater-source-begin bulkEditSelectedTemplateTags
async function bulkEditSelectedTemplateTags() {
    if (!runtime.instSelected.size) return;
    const operation = await chooseBulkTagOperation(runtime.instSelected.size);
    if (!operation) return;
    if (!operation.tags.length && operation.mode !== 'replace') { toastr.warning('请至少选择一个标签'); return; }
    const templates = runtime.settings.instructionTemplates || [];
    let updated = 0;
    runtime.instSelected.forEach(index => {
        const template = templates[index];
        if (!template) return;
        template.tags = applyBulkTagOperation(itemTags(template, runtime.knownInstructionTags()), operation);
        updated++;
    });
    runtime.instSelected.clear(); runtime.save(); runtime.refreshInstUI();
    toastr.success(`已更新 ${updated} 个模板的标签`);
}
// @theater-source-end bulkEditSelectedTemplateTags

// @theater-source-begin bulkDeleteSelected
async function bulkDeleteSelected() {
    if (!runtime.instSelected.size) return;
    const { Popup } = SillyTavern.getContext();
    const count = runtime.instSelected.size;
    const ok = await Popup.show.confirm(`确定删除选中的 ${count} 个模板？`, '删除后无法恢复');
    if (!ok) return;
    const templates = runtime.settings.instructionTemplates || [];
    [...runtime.instSelected].sort((a, b) => b - a).forEach(index => templates.splice(index, 1));
    runtime.instSelected.clear();
    runtime.save();
    runtime.refreshInstUI();
    toastr.success(`已删除 ${count} 个模板`);
}
// @theater-source-end bulkDeleteSelected

// @theater-source-begin selectAllVisible
function selectAllVisible() {
    const templates = runtime.settings.instructionTemplates || [];
    const visible = filterInstAll(templates).slice(runtime.instPage * runtime.INST_PAGE_SIZE, (runtime.instPage + 1) * runtime.INST_PAGE_SIZE);
    if (!visible.length) {
        toastr.info('当前没有可选的模板');
        return;
    }
    visible.forEach(({ i }) => runtime.instSelected.add(i));
    $('#theater-instruction-list').html(renderInstList(templates));
    updateBulkBar();
}
// @theater-source-end selectAllVisible

// @theater-source-begin clearInstSelection
function clearInstSelection() {
    runtime.instSelected.clear();
    $('.theater-inst-checkbox').prop('checked', false);
    $('.theater-inst-item').removeClass('theater-inst-item-selected');
    updateBulkBar();
}
// @theater-source-end clearInstSelection

// @theater-source-begin saveRenderTpl
async function saveRenderTpl() {
    const content = $('#theater-render-content').val().trim();
    if (!content) return;
    const name = await askNewItemName('保存渲染模板', `渲染模板 ${runtime.settings.renderTemplates.length + 1}`);
    if (!name) return;
    runtime.settings.renderTemplates.push({ name, content });
    runtime.settings.selectedRenderIndex = String(runtime.settings.renderTemplates.length - 1);
    runtime.save();
    runtime.refreshRenderSelectionControls({ refreshOptions: true });
    toastr.success('已保存');
}
// @theater-source-end saveRenderTpl

// @theater-source-begin deleteRenderTpl
async function deleteRenderTpl() {
    const v = $('#theater-render-select').val(); if (runtime.isBuiltinRenderSelection(v)) return;
    const deletedIndex = Number.parseInt(v, 10);
    const name = runtime.settings.renderTemplates?.[deletedIndex]?.name || '未命名模板';
    const ok = await SillyTavern.getContext().Popup.show.confirm(`删除渲染模板「${name}」？`, '只删除这个自定义模板；已经生成和保存的小剧场不会受影响。');
    if (!ok) return;
    runtime.settings.renderTemplates.splice(deletedIndex, 1);
    runtime.settings.selectedRenderIndex = runtime.renderSelectionAfterCustomDelete(runtime.settings.selectedRenderIndex, deletedIndex);
    runtime.settings.quickRenderA = runtime.renderSelectionAfterCustomDelete(runtime.settings.quickRenderA, deletedIndex);
    runtime.settings.quickRenderB = runtime.renderSelectionAfterCustomDelete(runtime.settings.quickRenderB, deletedIndex);
    if (runtime.settings.quickRenderA === runtime.settings.quickRenderB) runtime.settings.quickRenderB = ADAPTIVE_RENDER_SELECTIONS.immersive;
    runtime.save();
    runtime.refreshRenderSelectionControls({ refreshOptions: true });
    toastr.success(`已删除渲染模板「${name}」`);
}
// @theater-source-end deleteRenderTpl

// @theater-source-begin splitImportedTemplate
function splitImportedTemplate(content, suggestedName = '') {
    const original = String(content || '').replace(/^\uFEFF/, '').trim();
    const lines = original.replace(/\r\n?/g, '\n').split('\n');
    const firstIndex = lines.findIndex(line => line.trim());
    if (firstIndex < 0) return { name: suggestedName || '导入指令', content: '', stripped: false };

    const firstLine = lines[firstIndex].trim();
    const normalize = value => String(value || '').replace(/[【】#:\s：]/g, '').toLowerCase();
    const titleMatch = firstLine.match(/^(?:#+\s*)?(?:标题|模板(?:名称)?|名称)\s*[:：]\s*(.+)$/i)
        || firstLine.match(/^【(.+)】$/)
        || firstLine.match(/^#{1,6}\s+(.+)$/);
    const creditLine = line => /^(?:by\b|作者|author\b|创作(?:者)?|制作(?:者)?|模板作者|来源)\s*[:：]?/i.test(String(line || '').trim());
    const nextIndex = lines.findIndex((line, index) => index > firstIndex && line.trim());
    const duplicateSuggestedName = suggestedName && normalize(firstLine) === normalize(suggestedName);
    const titleFollowedByCredit = nextIndex >= 0 && creditLine(lines[nextIndex]);
    const isExplicitTitle = !!titleMatch;
    const shouldStripFirst = isExplicitTitle || duplicateSuggestedName || titleFollowedByCredit;

    if (shouldStripFirst) lines[firstIndex] = '';
    let creditIndex = lines.findIndex(line => line.trim());
    while (creditIndex >= 0 && creditLine(lines[creditIndex])) {
        lines[creditIndex] = '';
        creditIndex = lines.findIndex(line => line.trim());
    }

    const cleaned = lines.join('\n').trim();
    const name = String(suggestedName || titleMatch?.[1] || firstLine).trim().substring(0, 60) || '导入指令';
    // 识别失误时宁可保留原文，也不要导入一条空指令。
    if (!cleaned) return { name, content: original, stripped: false };
    return { name, content: cleaned, stripped: shouldStripFirst || cleaned !== original };
}
// @theater-source-end splitImportedTemplate

// @theater-source-begin importInstructionTemplates
function importInstructionTemplates() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json';
    input.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
            const text = await file.text();
            let imported = [];
            let importedTags = [];
            let strippedCount = 0;
            const addImported = (content, suggestedName = '', tags = []) => {
                const parsed = splitImportedTemplate(content, suggestedName);
                if (!parsed.content.trim()) return;
                if (parsed.stripped) strippedCount++;
                const item = { name: parsed.name, content: parsed.content, tags: normalizeTagList(Array.isArray(tags) ? tags : [tags]) };
                imported.push(item);
            };

            if (file.name.endsWith('.json')) {
                const data = JSON.parse(text);
                const theaterBackup = parseInstructionBackup(data);

                // 酒馆世界书格式: { entries: { "0": { comment, content, key, ... }, ... } }
                if (theaterBackup) {
                    imported = theaterBackup.templates;
                    importedTags = theaterBackup.tags;
                }
                else if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
                    Object.values(data.entries).forEach(entry => {
                        const content = entry.content || '';
                        if (!content.trim()) return;
                        const name = entry.comment || (Array.isArray(entry.key) ? entry.key.join(', ') : String(entry.key || ''));
                        addImported(content, name);
                    });
                }
                // 数组格式: [{ name, content }, ...]
                else {
                    const arr = Array.isArray(data) ? data : (data.templates || data.instructions || []);
                    arr.forEach(item => {
                        const content = item.content || item.instruction || '';
                        if (!content.trim()) return;
                        const name = item.name || item.title || '';
                        addImported(content, name, item.tags || item.group || item.folder || '');
                    });
                }
            } else {
                // TXT格式：--- 分隔
                const parts = splitInstructionTextFile(text);
                parts.forEach(p => {
                    addImported(p);
                });
            }

            imported.forEach(item => {
                item.tags = normalizeTagList(item.tags);
                item.tags.forEach(tag => { if (!importedTags.includes(tag)) importedTags.push(tag); });
            });
            if (!imported.length && !importedTags.length) { toastr.warning('文件中没有找到指令或标签'); return; }
            let target = { tags: [], newTags: [] };
            if (imported.length) {
                const currentFilter = normalizeTagFilter(runtime.settings.instructionTagFilter, runtime.knownInstructionTags());
                const suggested = currentFilter[0] === TAG_UNCATEGORIZED ? [] : currentFilter;
                target = await chooseTagsWithNew({
                    title: `给这 ${imported.length} 条导入模板统一加标签`,
                    subtitle: '文件原有标签会保留；这里勾选或新建的标签会追加到每一条模板',
                    selected: suggested,
                    okButton: '确认导入',
                });
                if (target === null) return;
            }
            const previousTags = runtime.knownInstructionTags();
            runtime.settings.instructionTags = normalizeTagList([...previousTags, ...importedTags, ...target.newTags]);
            imported.forEach(item => {
                item.tags = mergeTagLists(item.tags, target.tags, runtime.settings.instructionTags);
            });
            const previousKeys = new Set(previousTags.map(tag => tag.toLocaleLowerCase()));
            const addedTags = runtime.settings.instructionTags.filter(tag => !previousKeys.has(tag.toLocaleLowerCase())).length;
            runtime.settings.instructionTemplates.push(...imported);
            runtime.save(); runtime.refreshInstUI();
            toastr.success(`导入了 ${imported.length} 条指令${addedTags ? `、${addedTags} 个标签` : ''}${strippedCount ? `，已排除 ${strippedCount} 条标题或署名` : ''}`);
        } catch (err) { toastr.error('导入失败: ' + err.message); }
    };
    input.click();
}
// @theater-source-end importInstructionTemplates

// @theater-source-begin exportInstructionTemplates
function exportInstructionTemplates() {
    const inst = runtime.settings.instructionTemplates || [];
    const tags = runtime.knownInstructionTags();
    if (!inst.length && !tags.length) { toastr.warning('没有可导出的指令模板或标签'); return; }
    const backup = createInstructionBackup(tags, inst);
    runtime.downloadFile('theater-instructions.json', JSON.stringify(backup, null, 2), 'application/json');
    toastr.success(`导出了 ${inst.length} 条指令和 ${backup.tags.length} 个标签`);
}
// @theater-source-end exportInstructionTemplates

return { itemTagBadgesHTML, tagUsageCounts, rollRandomInstruction, setActiveInstructionTags, filterInstAll, renderInstList, updateBulkBar, setInstructionItemSelected, closeInstructionActionMenus, positionInstructionActionMenu, bindInstructionSweepSelection, chooseTags, askNewItemName, chooseTagsWithNew, newInstructionTag, updateAllHistoryTags, manageInstructionTags, editTemplateTags, chooseBulkTagOperation, applyBulkTagOperation, saveInstructionTpl, bulkEditSelectedTemplateTags, bulkDeleteSelected, selectAllVisible, clearInstSelection, saveRenderTpl, deleteRenderTpl, splitImportedTemplate, importInstructionTemplates, exportInstructionTemplates };
}
