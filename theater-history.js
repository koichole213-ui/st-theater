// theater-history: receives live state and cross-feature callbacks from index.js.
import { normalizeRoleSources, matchesRoleFilter, historyRoleOptions, ROLE_UNASSIGNED } from './history-roles.js';
import { historyRoleDialog } from './history-role-dialog.js';
import { closeHistoryMenus } from './history-menus.js';
import { itemTags, matchesTagFilter, mergeTagLists, normalizeTagList } from './tag-system.js';
import { collectionPage, historyEntries, normalizeCollections, historyOrder, historyKey, newHistoryKey, moveCollectionItems, collectionChapters, planHistorySave, remapHistoryImport } from './history-collections.js';
import { collectionCardHTML, collectionDialog, collectionChapterIds } from './history-collections-ui.js';
import { listPaginationHTML } from './pagination.js';
import { withPreservedPopupViewport } from './popup-lifecycle.js';
import { displayedContinuationVersion, normalizeContinuationRounds } from './continuation-session.js';
import { isTextOutputMode } from './plain-text-renderer.js';
import { createHistoryJsonBackup, createHistoryArchive, HISTORY_ARCHIVE_MANIFEST, historyItemsFromArchive, normalizeHistoryBackup } from './history-backup.js';

export function createTheaterHistory(runtime) {
// @theater-source-begin inferHistoryTags
function inferHistoryTags(instruction) {
    const text = String(instruction || '').trim();
    if (!text) return [];
    const matches = (runtime.settings.instructionTemplates || []).filter(template => String(template?.content || '').trim() === text);
    if (matches.length !== 1) return [];
    return itemTags(matches[0], runtime.settings.instructionTags);
}
// @theater-source-end inferHistoryTags

// @theater-source-begin migrateHistoryTags
async function migrateHistoryTags() {
    if (Number(runtime.settings.historyTagSchemaVersion) >= 1) {
        runtime.historyCache.forEach(item => { item.tags = itemTags(item, runtime.settings.instructionTags); });
        runtime.recentCache.forEach(item => { item.tags = itemTags(item, runtime.settings.instructionTags); });
        return;
    }
    for (const history of runtime.historyCache) {
        history.tags = Array.isArray(history.tags) ? itemTags(history, runtime.settings.instructionTags) : inferHistoryTags(history.instruction);
        await runtime.histPut(history);
    }
    runtime.recentCache.forEach(item => {
        item.tags = Array.isArray(item.tags) ? itemTags(item, runtime.settings.instructionTags) : inferHistoryTags(item.instruction);
    });
    if (runtime.recentCache.length) await runtime.recentPersist();
    runtime.settings.historyTagSchemaVersion = 1;
    runtime.save();
    runtime.runtimeLog('info', '旧历史标签升级完成', { history: runtime.historyCache.length });
}
// @theater-source-end migrateHistoryTags

// @theater-source-begin refreshInstUI
function refreshInstUI() {
    const inst = runtime.settings.instructionTemplates || [];
    runtime.closeInstructionActionMenus();
    $('#theater-instruction-list').html(runtime.renderInstList(inst)).removeAttr('data-pending-list');
    $('#theater-inst-count').text(inst.length);
    $('#theater-inst-drawer').toggleClass('empty', !inst.length);
    runtime.updateBulkBar();
    refreshTagControls();
}
// @theater-source-end refreshInstUI

// @theater-source-begin filterHistoryAll
function filterHistoryAll(items = runtime.historyCache) {
    return (Array.isArray(items) ? items : []).filter(item => matchesTagFilter(item, runtime.settings.historyTagFilter, runtime.knownInstructionTags()) && matchesRoleFilter(item, runtime.historyRoleFilter));
}
// @theater-source-end filterHistoryAll

// @theater-source-begin setHistoryItemSelected
function setHistoryItemSelected(id, selected, itemElement = null) {
    if (selected) runtime.histSelected.add(id);
    else runtime.histSelected.delete(id);
    const $item = itemElement ? $(itemElement) : $(`.theater-history-item[data-id="${id}"]`);
    $item.toggleClass('theater-history-item-selected', selected)
        .find('.theater-hist-checkbox').prop('checked', selected);
    updateHistBulkBar();
}
// @theater-source-end setHistoryItemSelected

// @theater-source-begin detachHistoryTouchMoveHandler
function detachHistoryTouchMoveHandler() {
    if (!runtime.histTouchMoveHandler) return;
    document.removeEventListener('touchmove', runtime.histTouchMoveHandler);
    runtime.histTouchMoveHandler = null;
}
// @theater-source-end detachHistoryTouchMoveHandler

// @theater-source-begin attachHistoryTouchMoveHandler
function attachHistoryTouchMoveHandler() {
    detachHistoryTouchMoveHandler();
    runtime.histTouchMoveHandler = function (event) {
        const gesture = runtime.histSelectionGesture;
        if (!gesture || typeof gesture.pointerId !== 'string' || !gesture.pointerId.startsWith('touch:')) return;
        const identifier = Number(gesture.pointerId.slice(6));
        const touch = Array.from(event.touches || []).find(item => item.identifier === identifier);
        if (!touch) return;
        if (!gesture.active) {
            if (Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY) > 10) resetHistorySelectionGesture();
            return;
        }
        event.preventDefault();
        applyHistorySelectionGestureAt(touch.clientX, touch.clientY);
        updateHistorySelectionAutoScroll(touch.clientX, touch.clientY);
    };
    document.addEventListener('touchmove', runtime.histTouchMoveHandler, { passive: false });
}
// @theater-source-end attachHistoryTouchMoveHandler

// @theater-source-begin resetHistorySelectionGesture
function resetHistorySelectionGesture() {
    if (runtime.histSelectionGesture?.timer) clearTimeout(runtime.histSelectionGesture.timer);
    if (runtime.histSelectionGesture?.autoScrollFrame) cancelAnimationFrame(runtime.histSelectionGesture.autoScrollFrame);
    $('.theater-history-item.is-selection-dragging').removeClass('is-selection-dragging');
    runtime.histSelectionGesture = null;
    detachHistoryTouchMoveHandler();
}
// @theater-source-end resetHistorySelectionGesture

// @theater-source-begin activateHistorySelectionGesture
function activateHistorySelectionGesture() {
    const gesture = runtime.histSelectionGesture;
    if (!gesture || gesture.active) return;
    if (!runtime.histBatchMode) {
        runtime.histBatchMode = true;
        runtime.histSelected.clear();
        refreshHistList();
        gesture.item = document.querySelector(`.theater-history-item[data-id="${gesture.id}"]`) || gesture.item;
        enterHistBatchMode();
    }
    gesture.active = true;
    gesture.selecting = !runtime.histSelected.has(gesture.id);
    gesture.scrollContainer = gesture.item.closest('.theater-panels-wrapper');
    gesture.item.classList.add('is-selection-dragging');
    setHistoryItemSelected(gesture.id, gesture.selecting, gesture.item);
}
// @theater-source-end activateHistorySelectionGesture

// @theater-source-begin applyHistorySelectionGestureAt
function applyHistorySelectionGestureAt(clientX, clientY) {
    const gesture = runtime.histSelectionGesture;
    if (!gesture?.active) return;
    const item = document.elementFromPoint(clientX, clientY)?.closest?.('.theater-history-item');
    if (!item || !item.closest('#theater-history-list')) return;
    const id = $(item).data('id');
    if (gesture.visited.has(id)) return;
    gesture.visited.add(id);
    setHistoryItemSelected(id, gesture.selecting, item);
}
// @theater-source-end applyHistorySelectionGestureAt

// @theater-source-begin runHistorySelectionAutoScroll
function runHistorySelectionAutoScroll() {
    const gesture = runtime.histSelectionGesture;
    if (!gesture?.active || !gesture.scrollContainer || !gesture.autoScrollSpeed) return;
    const before = gesture.scrollContainer.scrollTop;
    gesture.scrollContainer.scrollTop += gesture.autoScrollSpeed;
    if (gesture.scrollContainer.scrollTop === before) {
        gesture.autoScrollSpeed = 0;
        gesture.autoScrollFrame = null;
        return;
    }
    applyHistorySelectionGestureAt(gesture.lastX, gesture.lastY);
    gesture.autoScrollFrame = requestAnimationFrame(runHistorySelectionAutoScroll);
}
// @theater-source-end runHistorySelectionAutoScroll

// @theater-source-begin updateHistorySelectionAutoScroll
function updateHistorySelectionAutoScroll(clientX, clientY) {
    const gesture = runtime.histSelectionGesture;
    if (!gesture?.active || !gesture.scrollContainer) return;
    gesture.lastX = clientX;
    gesture.lastY = clientY;
    const rect = gesture.scrollContainer.getBoundingClientRect();
    const edge = Math.min(84, Math.max(54, rect.height * 0.14));
    let speed = 0;
    if (clientY < rect.top + edge) {
        speed = -Math.max(3, Math.ceil((rect.top + edge - clientY) / edge * 18));
    } else if (clientY > rect.bottom - edge) {
        speed = Math.max(3, Math.ceil((clientY - (rect.bottom - edge)) / edge * 18));
    }
    gesture.autoScrollSpeed = speed;
    if (speed && !gesture.autoScrollFrame) {
        gesture.autoScrollFrame = requestAnimationFrame(runHistorySelectionAutoScroll);
    } else if (!speed && gesture.autoScrollFrame) {
        cancelAnimationFrame(gesture.autoScrollFrame);
        gesture.autoScrollFrame = null;
    }
}
// @theater-source-end updateHistorySelectionAutoScroll

// @theater-source-begin refreshHistList
function refreshHistList() {
    closeHistoryMenus();
    const roleOptions = historyRoleFilterHTML();
    const h = filterHistoryAll(runtime.historyCache);
    $('#theater-history-list').html(renderHistoryList()).removeAttr('data-pending-list');
    $('#theater-export-all-history').toggle(!runtime.histBatchMode);
    $('#theater-hist-select-all').toggle(h.length > 0);
    $('#theater-hist-batch-enter').toggle(!runtime.histBatchMode);
    updateHistBulkBar();
    $('#theater-hist-batch-bar').toggle(runtime.histBatchMode);
    refreshTagControls();
    const state = currentHistoryPage();
    $('#theater-history-stats').text(`${state.total} 个条目 · ${h.length} 条保存记录`);
    $('#theater-history-role-filter').html(roleOptions);
}
// @theater-source-end refreshHistList

// @theater-source-begin currentHistoryPage
function currentHistoryPage() {
    return collectionPage(historyEntries(runtime.historyCache, runtime.historyCollections, { query: runtime.historyQuery,
        accepts: item => matchesTagFilter(item, runtime.settings.historyTagFilter, runtime.knownInstructionTags()) && matchesRoleFilter(item, runtime.historyRoleFilter) }), runtime.histPage);
}
// @theater-source-end currentHistoryPage

// @theater-source-begin visibleHistoryItems
function visibleHistoryItems() {
    return currentHistoryPage().items.flatMap(entry => entry.item ? [entry.item] : (runtime.histBatchMode || runtime.historyQuery.trim() || runtime.historyExpanded.has(entry.folder.id) ? entry.chapters.flat() : []));
}
// @theater-source-end visibleHistoryItems

// @theater-source-begin renderHistoryList
function renderHistoryList() {
    const state = currentHistoryPage();
    runtime.histPage = state.page;
    if (!state.total) return '<p class="theater-empty">没有找到符合条件的剧场或文件夹</p>';
    return state.items.map(entry => entry.item ? runtime.historyItemHTML(entry.item) : collectionCardHTML(entry, {
        expanded: runtime.histBatchMode || !!runtime.historyQuery.trim() || runtime.historyExpanded.has(entry.folder.id),
        selected: runtime.historyVersionSelection, itemHTML: runtime.historyItemHTML, batch: runtime.histBatchMode, searching: !!runtime.historyQuery.trim(),
    })).join('') + listPaginationHTML('hist', state);
}
// @theater-source-end renderHistoryList

// @theater-source-begin refreshTagControls
function refreshTagControls() {
    $('#theater-inst-tag-filter span').text(runtime.tagFilterSummary(runtime.settings.instructionTagFilter));
    $('#theater-history-tag-filter span:first-child').text(runtime.historyTagFilterLabel());
    const randomTags = runtime.tagFilterSummary(runtime.settings.randomTagFilter, '选择');
    $('#theater-random-tag-picker').prop('hidden', runtime.settings.randomScope !== '__tags__').attr('title', runtime.tagFilterSummary(runtime.settings.randomTagFilter)).find('span').text(randomTags);
    const autoTags = runtime.tagFilterSummary(runtime.settings.autoTagFilter, '选择');
    $('#theater-auto-tag-picker').prop('hidden', runtime.settings.autoSource !== '__tags__').attr('title', runtime.tagFilterSummary(runtime.settings.autoTagFilter)).find('span').text(autoTags);
}
// @theater-source-end refreshTagControls

// @theater-source-begin renameHistoryItem
async function renameHistoryItem(id, anchor = null) {
    const item = runtime.historyCache.find(history => history.id === id);
    if (!item) return;
    const { Popup } = SillyTavern.getContext();
    const input = await withPreservedPopupViewport(anchor, () => Popup.show.input('小剧场改名', '输入新的作品名称', item.title || ''));
    if (input === null || input === undefined || input === false) return;
    const title = String(input).trim();
    if (!title) { toastr.warning('名称不能为空'); return; }
    const current = runtime.historyCache.find(history => history.id === id);
    if (!current || title === current.title) return;
    if (await runtime.histPut({ ...current, title })) {
        refreshHistList();
        toastr.success('小剧场已改名');
    }
}
// @theater-source-end renameHistoryItem

// @theater-source-begin editHistoryTags
async function editHistoryTags(id) {
    const item = runtime.historyCache.find(history => history.id === id);
    if (!item) return;
    const chosen = await runtime.chooseTags({ title: `编辑「${item.title || '未命名小剧场'}」的标签`, selected: item.tags, subtitle: '不选择任何标签时显示为“未分类”' });
    if (chosen === null) return;
    const latest = runtime.historyCache.find(history => history.id === id);
    if (!latest) return;
    if (await runtime.histPut({ ...latest, tags: chosen })) {
        refreshHistList();
        toastr.success(chosen.length ? '历史标签已更新' : '历史已设为未分类');
    }
}
// @theater-source-end editHistoryTags

// @theater-source-begin bulkEditSelectedHistoryTags
async function bulkEditSelectedHistoryTags() {
    if (!runtime.histSelected.size) return;
    const operation = await runtime.chooseBulkTagOperation(runtime.histSelected.size);
    if (!operation) return;
    if (!operation.tags.length && operation.mode !== 'replace') { toastr.warning('请至少选择一个标签'); return; }
    let updated = 0;
    for (const item of [...runtime.historyCache]) {
        if (!runtime.histSelected.has(item.id)) continue;
        const tags = runtime.applyBulkTagOperation(itemTags(item, runtime.knownInstructionTags()), operation);
        if (await runtime.histPut({ ...item, tags })) updated++;
    }
    runtime.histSelected.clear(); runtime.histBatchMode = false; refreshHistList(); exitHistBatchMode();
    toastr.success(`已更新 ${updated} 条历史的标签`);
}
// @theater-source-end bulkEditSelectedHistoryTags

// @theater-source-begin updateHistBulkBar
function updateHistBulkBar() {
    const n = runtime.histSelected.size;
    $('#theater-hist-delete-selected').toggle(n > 0);
    $('#theater-hist-tag-selected').toggle(n > 0);
    $('#theater-hist-role-selected, #theater-hist-move-selected').toggle(n > 0);
    $('#theater-hist-sel-count').text(n);
}
// @theater-source-end updateHistBulkBar

// @theater-source-begin enterHistBatchMode
function enterHistBatchMode() {
    $('#theater-hist-batch-enter').hide();
    $('#theater-export-all-history').hide();
    $('#theater-hist-batch-bar').show();
    document.querySelector('.theater-panel[data-panel="history"]')?.classList.add('is-batch-managing');
    updateHistBulkBar();
}
// @theater-source-end enterHistBatchMode

// @theater-source-begin exitHistBatchMode
function exitHistBatchMode() {
    $('#theater-hist-batch-bar').hide();
    const panel = document.querySelector('.theater-panel[data-panel="history"]');
    panel?.classList.remove('is-batch-managing');
    panel?.querySelectorAll('.theater-hist-checkbox:checked').forEach(input => { input.checked = false; });
    panel?.querySelectorAll('.theater-history-item-selected').forEach(item => item.classList.remove('theater-history-item-selected'));
    const h = filterHistoryAll(runtime.historyCache);
    $('#theater-hist-batch-enter').show();
    $('#theater-export-all-history').show();
    updateHistBulkBar();
}
// @theater-source-end exitHistBatchMode

// @theater-source-begin commitHistoryCollection
function commitHistoryCollection(change) {
    return runtime.queueHistoryWrite(async () => {
        try {
            const next = change(runtime.historyCache, normalizeCollections(runtime.historyCollections, runtime.historyCache));
            const existingIds = new Set(runtime.historyCache.map(item => String(item.id)));
            let order = Math.max(0, ...runtime.historyCache.map(historyOrder));
            next.items = next.items.map(item => existingIds.has(String(item.id)) ? item : { ...item, historyOrder: ++order });
            const folders = normalizeCollections(next.folders, next.items);
            if (runtime.idb) {
                const tx = runtime.idb.transaction(['history', 'kv'], 'readwrite');
                const done = runtime.idbTransactionDone(tx);
                const store = tx.objectStore('history');
                try {
                    for (const item of next.items) if (!runtime.historyCache.includes(item)) store.put(item);
                    tx.objectStore('kv').put(folders, 'history-collections');
                } catch (error) {
                    try { tx.abort(); } catch { /* already aborted */ }
                    await done.catch(() => {});
                    throw error;
                }
                await done;
            }
            runtime.historyCache = next.items;
            runtime.historyCollections = folders;
            if (!runtime.idb) { runtime.settings.history = runtime.historyCache; runtime.settings.historyCollections = folders; runtime.save(); }
            return true;
        } catch (error) {
            toastr.error('收纳保存失败，原作品保留：' + (error?.message || error));
            return false;
        }
    });
}
// @theater-source-end commitHistoryCollection

// @theater-source-begin organizeHistory
async function organizeHistory(action, folderId, trigger) {
    const folder = runtime.historyCollections.find(folder => folder.id === folderId);
    if (action === 'toggle') {
        if (runtime.historyQuery.trim() || runtime.histBatchMode) return;
        runtime.historyExpanded.has(folderId) ? runtime.historyExpanded.delete(folderId) : runtime.historyExpanded.add(folderId);
        refreshHistList(); return;
    }
    if (action === 'menu') {
        const menu = trigger.closest('.theater-chapter-wrap').querySelector('.theater-chapter-menu');
        menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); return;
    }
    const root = document.querySelector('.theater-popup');
    let choice;
    if (action === 'new' || action === 'add') {
        const owned = new Set(runtime.historyCollections.flatMap(folder => folder.itemIds));
        choice = await collectionDialog({ root, title: action === 'new' ? '新建文件夹' : `加入「${folder?.title || ''}」`,
            name: action === 'new' ? '' : undefined, items: runtime.historyCache.filter(item => !owned.has(String(item.id))),
            note: '选择已有剧场，也可以先建空文件夹。翻页或搜索不会清除已选。' });
        if (!choice) return;
        let id = folderId;
        if (await commitHistoryCollection((items, folders) => {
            if (action === 'new') id = newHistoryKey();
            if (action === 'new') folders.push({ id, title: choice.title, itemIds: [] });
            // Recheck ownership after the dialog closes; do not steal a concurrently moved work.
            const ownedNow = new Set(folders.flatMap(folder => folder.itemIds));
            return { items, folders: moveCollectionItems(folders, choice.ids.filter(id => !ownedNow.has(id)), id) };
        })) runtime.historyExpanded.add(id);
    } else if (action === 'rename') {
        if (!folder) return;
        choice = await collectionDialog({ root, title: '文件夹改名', name: folder.title });
        if (!choice) return;
        await commitHistoryCollection((items, folders) => ({ items, folders: folders.map(folder => folder.id === folderId ? { ...folder, title: choice.title } : folder) }));
    } else if (action === 'dissolve') {
        const { Popup } = SillyTavern.getContext();
        if (!folder || !await Popup.show.confirm('解散这个文件夹？', '里面所有剧场和版本都会保留，回到历史列表。')) return;
        await commitHistoryCollection((items, folders) => ({ items, folders: folders.filter(folder => folder.id !== folderId) }));
    } else if (folder && ['remove', 'move', 'up', 'down'].includes(action)) {
        const itemId = trigger.closest('[data-chapter-id]')?.dataset.chapterId;
        if (action === 'move') {
            const targets = runtime.historyCollections.filter(folder => folder.id !== folderId);
            if (!targets.length) { toastr.info('请先新建一个目标文件夹'); return; }
            choice = await collectionDialog({ root, title: '移动这一篇', folders: targets, note: '这一篇的所有已存版本一起移动。' });
            if (!choice) return;
        }
        await commitHistoryCollection((items, folders) => {
            const current = folders.find(folder => folder.id === folderId);
            if (!current) throw new Error('文件夹已不存在');
            const ids = collectionChapterIds(current, items, itemId);
            if (action === 'remove' || action === 'move') return { items, folders: moveCollectionItems(folders, ids, choice?.folderId || null) };
            const chapters = collectionChapters(current, items).map(versions => versions.map(item => String(item.id)));
            const at = chapters.findIndex(group => group.includes(String(itemId)));
            const to = at + (action === 'up' ? -1 : 1);
            if (at >= 0 && to >= 0 && to < chapters.length) [chapters[at], chapters[to]] = [chapters[to], chapters[at]];
            return { items, folders: folders.map(folder => folder.id === folderId ? { ...folder, itemIds: chapters.flat() } : folder) };
        });
    }
    runtime.historyVersionSelection.clear();
    refreshHistList();
}
// @theater-source-end organizeHistory

// @theater-source-begin openHistoryReading
function openHistoryReading(item) {
    const folder = runtime.historyCollections.find(folder => folder.itemIds.includes(String(item.id)));
    runtime.historyReadingFolderId = folder?.id || null;
    runtime.historyReadingItems = folder ? collectionChapters(folder, runtime.historyCache).map(versions => ({ ...(versions.find(version => version.id === item.id) || versions.at(-1)) })) : null;
    runtime.readingState.reading = runtime.historyReadingItems?.find(entry => entry.id === item.id) || { ...item };
}
// @theater-source-end openHistoryReading

// @theater-source-begin historyReadingVersions
function historyReadingVersions() {
    const folder = runtime.historyCollections.find(folder => folder.id === runtime.historyReadingFolderId);
    if (!folder) return [];
    return collectionChapters(folder, runtime.historyCache).find(versions => versions.some(item => item.id === runtime.readingState.reading?.id)) || [];
}
// @theater-source-end historyReadingVersions

// @theater-source-begin chooseHistoryReadingVersion
function chooseHistoryReadingVersion(id) {
    const source = historyReadingVersions().find(item => String(item.id) === String(id));
    if (!source || !runtime.historyReadingItems) return;
    const index = runtime.historyReadingItems.indexOf(runtime.readingState.reading);
    const copy = { ...source };
    if (index >= 0) runtime.historyReadingItems[index] = copy;
    runtime.readingState.reading = copy;
}
// @theater-source-end chooseHistoryReadingVersion

// @theater-source-begin saveToHistory
async function saveToHistory(sourceOverride = null) {
    const supplied = sourceOverride?.html ? { ...sourceOverride } : null;
    if (!supplied && runtime.resultEditSnapshot) { toastr.warning('请先应用修改或退出编辑，再保存'); return; }
    const html = supplied?.html || runtime.lastGeneratedHtml || runtime.currentDisplayHtml;
    if (!html) return;
    const count = runtime.historyCache.length + 1;
    const sourceMeta = supplied || (runtime.currentGenerationResult?.html === html ? runtime.currentGenerationResult : null) || displayedContinuationVersion(runtime.continuationSession, html) || runtime.recentCache.find(item => item.html === html)
        || runtime.historyCache.slice().reverse().find(item => item.html === html)
        || (runtime.retainedResultSource?.html === html ? runtime.retainedResultSource : null);
    const sourceTags = sourceMeta
        ? itemTags(sourceMeta, runtime.knownInstructionTags())
        : itemTags({ tags: runtime.activeInstructionTags }, runtime.knownInstructionTags());
    const selection = await runtime.chooseTagsWithNew({
        title: '保存小剧场',
        subtitle: sourceMeta?.parentChapterId ? '保存后与前篇归入同一系列；尚未保存的前篇也会一并保留。重写归入同篇版本。' : '默认沿用这篇结果的来源标签；可以增减或全部取消',
        selected: sourceTags,
        okButton: '保存',
        templateName: `小剧场 ${count}`,
        nameLabel: '标题',
        namePlaceholder: '给这个小剧场起个标题',
    });
    if (selection === null) return;
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    const tags = mergeTagLists([], selection.tags, [...runtime.knownInstructionTags(), ...selection.newTags]);
    const item = {
        title: selection.name,
        html,
        mode: sourceMeta?.mode || runtime.currentOutputMode,
        // 优先跟随这篇结果生成时的元数据，避免把保存当下输入框里的另一条指令错配给它。
        instruction: sourceMeta ? (sourceMeta.instruction || '') : ($('#theater-instruction').val() || ''),
        sourceConfig: sourceMeta?.sourceConfig || null,
        roleSources: normalizeRoleSources(sourceMeta?.roleSources),
        continuationRounds: normalizeContinuationRounds(sourceMeta?.continuationRounds),
        tags,
        date: `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    };
    if (await commitHistoryCollection((items, folders) => planHistorySave(items, folders, item, sourceMeta || {}))) {
        runtime.settings.instructionTags = normalizeTagList([...runtime.knownInstructionTags(), ...selection.newTags]);
        runtime.save();
        refreshHistList();
        toastr.success(tags.length ? `已保存 · ${tags.join('、')}` : '已保存为未分类');
    }
}
// @theater-source-end saveToHistory

// @theater-source-begin copyHtml
function copyHtml() {
    if (runtime.resultEditSnapshot) { toastr.warning('请先应用修改或退出编辑，再复制'); return; }
    // 只从已知干净的变量取 HTML，不读 iframe.srcdoc（酒馆环境里可能被改写/清空）
    const html = runtime.lastGeneratedHtml || runtime.currentDisplayHtml;
    if (!html) { toastr.warning('没有可复制的内容'); return; }
    if (isTextOutputMode(runtime.currentOutputMode)) {
        copyToClipboard(runtime.lastGeneratedText || runtime.htmlToPlainText(html));
        return;
    }
    copyToClipboard(html);
}
// @theater-source-end copyHtml

// @theater-source-begin readClipboardMatch
async function readClipboardMatch(text) {
    if (!navigator.clipboard?.readText || !window.isSecureContext) return null;
    try {
        return (await navigator.clipboard.readText()) === text;
    } catch {
        return null;
    }
}
// @theater-source-end readClipboardMatch

// @theater-source-begin copyToClipboard
async function copyToClipboard(text, { requireVerification = false, manualTitle = '手动复制', downloadName = '千夜浮梦-内容.txt' } = {}) {
    const content = String(text || '');
    if (!content) { toastr.warning('没有可复制的内容'); return false; }

    if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(content);
            const verified = requireVerification ? await readClipboardMatch(content) : true;
            if (verified === true) { toastr.success('已复制'); return true; }
        } catch { }
    }

    const legacyOk = fallbackCopy(content);
    if (legacyOk) {
        const verified = requireVerification ? await readClipboardMatch(content) : true;
        if (verified === true) { toastr.success('已复制'); return true; }
    }

    if (requireVerification) {
        showManualCopyPanel(content, { title: manualTitle, downloadName });
        toastr.warning('浏览器未确认复制，已打开手动复制');
    } else {
        toastr.error('复制失败，请重试');
    }
    return false;
}
// @theater-source-end copyToClipboard

// @theater-source-begin fallbackCopy
function fallbackCopy(text) {
    let ta = null;
    try {
        // 关键：先把当前焦点和选区清掉，避免 execCommand('copy') 复制到之前选中的输入框内容
        // 这是 v2.1.1 修的 bug——之前 #theater-instruction 处于焦点/有选区时，临时 textarea 抢不到 selection
        const prevActive = document.activeElement;
        if (prevActive && typeof prevActive.blur === 'function') {
            try { prevActive.blur(); } catch {}
        }
        const sel = window.getSelection();
        if (sel) { try { sel.removeAllRanges(); } catch {} }

        // 创建临时textarea，挂到body最外层
        ta = document.createElement('textarea');
        ta.value = text;
        // 保持元素位于可渲染区域但完全透明，部分移动端 WebView 不会复制屏幕外元素。
        ta.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:.01;z-index:2147483647';
        document.body.appendChild(ta);

        // iOS 需要特殊处理
        const isIOS = navigator.userAgent.match(/ipad|iphone/i);
        if (isIOS) {
            const range = document.createRange();
            range.selectNodeContents(ta);
            const s2 = window.getSelection();
            s2.removeAllRanges();
            s2.addRange(range);
            ta.setSelectionRange(0, text.length);
        } else {
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
        }

        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ta = null;
        return !!ok;
    } catch (e) {
        console.warn('[Theater] Copy fallback error:', e);
        return false;
    } finally {
        if (ta?.parentNode) ta.parentNode.removeChild(ta);
    }
}
// @theater-source-end fallbackCopy

// @theater-source-begin showManualCopyPanel
function showManualCopyPanel(text, { title = '手动复制', downloadName = '千夜浮梦-内容.txt' } = {}) {
    $('#theater-manual-copy-overlay').remove();
    const $overlay = $(`
        <div id="theater-manual-copy-overlay" class="theater-manual-copy-overlay" role="dialog" aria-modal="true" aria-labelledby="theater-manual-copy-title">
            <div class="theater-manual-copy-backdrop" data-theater-manual-copy-close></div>
            <section class="theater-manual-copy-sheet">
                <header class="theater-manual-copy-head">
                    <div>
                        <span class="theater-manual-copy-kicker"><i class="fa-solid fa-clipboard"></i> 剪贴板兜底</span>
                        <h3 id="theater-manual-copy-title"></h3>
                    </div>
                    <button type="button" class="theater-manual-copy-close" data-theater-manual-copy-close aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>
                </header>
                <p class="theater-manual-copy-hint">浏览器没有确认剪贴板已经更新。请点一下文本框后长按复制，或直接下载 TXT。</p>
                <textarea id="theater-manual-copy-text" class="theater-manual-copy-text" readonly spellcheck="false"></textarea>
                <footer class="theater-manual-copy-actions">
                    <button type="button" id="theater-manual-copy-download" class="theater-btn"><i class="fa-solid fa-download"></i><span>下载 TXT</span></button>
                    <button type="button" class="theater-btn primary" data-theater-manual-copy-close><span>完成</span></button>
                </footer>
            </section>
        </div>`);
    $overlay.find('#theater-manual-copy-title').text(title);
    $overlay.find('textarea').val(text);
    $overlay.data('download-name', downloadName);
    $('body').append($overlay);
    requestAnimationFrame(() => {
        const textarea = document.getElementById('theater-manual-copy-text');
        textarea?.focus();
        textarea?.select();
        textarea?.setSelectionRange(0, textarea.value.length);
    });
}
// @theater-source-end showManualCopyPanel

// @theater-source-begin downloadTextContent
function downloadTextContent(text, fileName, feedback = 'TXT 已下载') {
    const blob = new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = String(fileName || '千夜浮梦-内容.txt').replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastr.success(feedback);
}
// @theater-source-end downloadTextContent

// @theater-source-begin exportAllHistory
async function exportAllHistory(format = 'zip') {
    const hist = runtime.historyCache;
    if (!hist.length && !runtime.historyCollections.length) return;
    if (format === 'json') {
        const data = createHistoryJsonBackup(hist, runtime.historyCollections);
        downloadFile(`theater-history-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
        toastr.success(`已导出 ${hist.length} 个小剧场 JSON 备份`);
        return;
    }
    try {
        const JSZipCtor = await loadJSZip();
        const zip = new JSZipCtor();
        const archive = createHistoryArchive(hist, runtime.historyCollections);
        zip.file(HISTORY_ARCHIVE_MANIFEST, JSON.stringify(archive.manifest, null, 2));
        archive.files.forEach(file => zip.file(file.name, file.html));
        const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `theater-history-${Date.now()}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toastr.success(`已导出 ${hist.length} 个小剧场 ZIP 可读归档`);
    } catch (e) {
        console.error('[Theater] Export zip error:', e);
        toastr.error('ZIP 生成失败，请检查酒馆 ZIP 组件后重试');
    }
}
// @theater-source-end exportAllHistory

// @theater-source-begin requestHistoryExport
async function requestHistoryExport() {
    if (!runtime.historyCache.length && !runtime.historyCollections.length) {
        toastr.warning('没有可导出的历史记录');
        return;
    }
    const data = createHistoryJsonBackup(runtime.historyCache, runtime.historyCollections);
    const format = await runtime.chooseExportFormat({
        title: '导出全部历史记录',
        count: runtime.historyCache.length,
        jsonBytes: new Blob([JSON.stringify(data, null, 2)]).size,
    });
    if (format) await exportAllHistory(format);
}
// @theater-source-end requestHistoryExport

// @theater-source-begin addHistoryItems
async function addHistoryItems(items, folders = []) {
    const imported = remapHistoryImport(items, folders);
    const ids = new Map();
    const records = imported.items.map((item, index) => {
        const id = newHistoryKey();
        if (items[index].id != null) ids.set(String(items[index].id), id);
        return { ...item, id, date: item.date || new Date().toLocaleString('zh-CN', { hour12: false }) };
    });
    const importedFolders = imported.folders.map(folder => ({ ...folder, itemIds: folder.itemIds.map(id => ids.get(String(id))).filter(Boolean) }));
    const ok = await commitHistoryCollection((existing, collections) => ({ items: [...existing, ...records], folders: [...collections, ...importedFolders] }));
    if (!ok) return false;
    runtime.settings.instructionTags = normalizeTagList([...runtime.knownInstructionTags(), ...records.flatMap(item => item.tags || [])]);
    runtime.save(); refreshHistList();
    return true;
}
// @theater-source-end addHistoryItems

// @theater-source-begin loadJSZip
async function loadJSZip() {
    if (!window.JSZip) await import('/lib/jszip.min.js');
    const JSZipCtor = window.JSZip || globalThis.JSZip;
    if (!JSZipCtor) throw new Error('当前酒馆没有加载 ZIP 组件');
    return JSZipCtor;
}
// @theater-source-end loadJSZip

// @theater-source-begin readHistoryZip
async function readHistoryZip(file) {
    const JSZipCtor = await loadJSZip();
    const zip = await JSZipCtor.loadAsync(file);
    const archiveEntries = Object.values(zip.files).filter(entry => !entry.dir);
    const manifestEntry = archiveEntries.find(entry => normalizedZipEntryName(entry.name) === HISTORY_ARCHIVE_MANIFEST.toLocaleLowerCase());
    let manifest = null;
    if (manifestEntry) {
        try {
            manifest = JSON.parse(await manifestEntry.async('string'));
        } catch (error) {
            throw new Error(`ZIP 内的历史清单无法读取：${error?.message || error}`);
        }
    }
    const htmlFiles = archiveEntries.filter(entry => /\.html?$/i.test(entry.name));
    const htmlEntries = await Promise.all(htmlFiles.map(async entry => ({
        name: entry.name,
        html: await entry.async('string'),
    })));
    return { items: historyItemsFromArchive(manifest, htmlEntries), folders: normalizeCollections(manifest?.folders) };
}
// @theater-source-end readHistoryZip

// @theater-source-begin normalizedZipEntryName
function normalizedZipEntryName(value) {
    return String(value || '').replace(/\\/g, '/').split('/').pop().toLocaleLowerCase();
}
// @theater-source-end normalizedZipEntryName

// @theater-source-begin importHistoryBackup
function importHistoryBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.json,application/zip,application/json';
    input.onchange = async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const isZip = /\.zip$/i.test(file.name) || /(?:application|multipart)\/zip/i.test(file.type);
            const data = isZip ? await readHistoryZip(file) : JSON.parse(await file.text());
            const items = normalizeHistoryBackup(data);
            const folders = normalizeCollections(data?.folders);
            if (!items.length && !folders.length) { toastr.warning('这个文件里没有找到可导入的小剧场历史'); return; }
            const added = await addHistoryItems(items, folders);
            if (added) toastr.success(`已导入 ${items.length} 条历史、${folders.length} 个文件夹`);
            else toastr.warning('没有导入任何内容');
        } catch (err) {
            runtime.theaterError('导入历史备份失败：' + (err?.message || err));
        }
    };
    input.click();
}
// @theater-source-end importHistoryBackup

// @theater-source-begin downloadFile
function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// @theater-source-end downloadFile

// @theater-source-begin historyRoleFilterHTML
function historyRoleFilterHTML() {
    const e = runtime.esc;
    const options = [{ id: '', label: '角色：全部' }, { id: ROLE_UNASSIGNED, label: '未指定角色' }, ...historyRoleOptions(runtime.historyCache, SillyTavern.getContext().characters || [])];
    if (runtime.historyRoleFilter && !options.some(role => role.id === runtime.historyRoleFilter)) {
        runtime.historyRoleFilter = ''; runtime.histPage = 0; runtime.histSelected.clear();
    }
    return options.map(role => `<option value="${e(role.id)}" ${role.id === runtime.historyRoleFilter ? 'selected' : ''}>${e(role.label)}</option>`).join('');
}
// @theater-source-end historyRoleFilterHTML

// @theater-source-begin editHistoryRoles
async function editHistoryRoles(id = null) {
    const targets = id === null ? new Set(runtime.histSelected) : new Set([id]);
    const items = runtime.historyCache.filter(item => targets.has(item.id));
    if (!items.length) return;
    const roles = historyRoleOptions(runtime.historyCache, SillyTavern.getContext().characters || []);
    const selected = items.length === 1 ? normalizeRoleSources(items[0].roleSources) : [];
    const choice = await historyRoleDialog({ root: document.querySelector('.theater-popup'), title: items.length === 1 ? '指定作品的来源角色' : `指定 ${items.length} 条记录的来源角色`, roles, selected });
    if (choice === null) return;
    if (await commitHistoryCollection((current, folders) => ({ items: current.map(item => targets.has(item.id) ? { ...item, roleSources: choice } : item), folders }))) {
        refreshHistList(); toastr.success('角色归属已更新');
    }
}
// @theater-source-end editHistoryRoles

// @theater-source-begin moveHistoryToCollection
async function moveHistoryToCollection(id = null) {
    const targets = id === null ? new Set(runtime.histSelected) : new Set([id]);
    const source = runtime.historyCache.filter(item => targets.has(item.id));
    if (!source.length) return;
    if (!runtime.historyCollections.length) { toastr.info('请先新建一个文件夹'); return; }
    const keys = new Set(source.map(historyKey));
    const choice = await collectionDialog({ root: document.querySelector('.theater-popup'), title: '移到文件夹', folders: runtime.historyCollections, note: '选中篇目的所有已存版本一起移动，正文与标签保留。' });
    if (!choice) return;
    await commitHistoryCollection((items, folders) => ({ items, folders: moveCollectionItems(folders, items.filter(item => keys.has(historyKey(item))).map(item => String(item.id)), choice.folderId) }));
    refreshHistList();
}
// @theater-source-end moveHistoryToCollection

// @theater-source-begin showHistoryMetadata
async function showHistoryMetadata(id, folderId = null) {
    const folder = folderId ? runtime.historyCollections.find(folder => folder.id === folderId) : null;
    const items = folder ? runtime.historyCache.filter(item => folder.itemIds.includes(String(item.id))) : runtime.historyCache.filter(item => item.id === id);
    if (!items.length && !folder) return;
    const roles = normalizeRoleSources(items.flatMap(item => normalizeRoleSources(item.roleSources)));
    const tags = normalizeTagList(items.flatMap(item => itemTags(item, runtime.knownInstructionTags())));
    const e = runtime.esc;
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const html = `<div class="theater-history-info"><h3>${e(folder?.title || items[0]?.title || '未命名小剧场')}</h3><p>角色：${e(roles.map(role => `${role.name}${role.avatar ? `（${role.avatar}）` : ''}`).join('、') || '未指定角色')}</p><p>标签：${e(tags.join('、') || '未分类')}</p>${folder ? '<p>这里汇总系列中各篇的归属，不代表整夹统一角色。</p>' : `<p>${e(items[0]?.date || '')}</p>`}</div>`;
    await new Popup(html, POPUP_TYPE.TEXT, '', { okButton: '关闭' }).show();
}
// @theater-source-end showHistoryMetadata

return { historyRoleFilterHTML, editHistoryRoles, moveHistoryToCollection, showHistoryMetadata, inferHistoryTags, migrateHistoryTags, refreshInstUI, filterHistoryAll, setHistoryItemSelected, detachHistoryTouchMoveHandler, attachHistoryTouchMoveHandler, resetHistorySelectionGesture, activateHistorySelectionGesture, applyHistorySelectionGestureAt, runHistorySelectionAutoScroll, updateHistorySelectionAutoScroll, refreshHistList, currentHistoryPage, visibleHistoryItems, renderHistoryList, refreshTagControls, renameHistoryItem, editHistoryTags, bulkEditSelectedHistoryTags, updateHistBulkBar, enterHistBatchMode, exitHistBatchMode, commitHistoryCollection, organizeHistory, openHistoryReading, historyReadingVersions, chooseHistoryReadingVersion, saveToHistory, copyHtml, readClipboardMatch, copyToClipboard, fallbackCopy, showManualCopyPanel, downloadTextContent, exportAllHistory, requestHistoryExport, addHistoryItems, loadJSZip, readHistoryZip, normalizedZipEntryName, importHistoryBackup, downloadFile };
}
