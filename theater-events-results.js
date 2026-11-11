import { toggleHistoryItem, setExpandedHistoryItem, historyFiltersHTML, toggleHistoryFilterPanel, setHistoryFilterPanel } from './history-ui.js';
import { toggleHistoryMenu, closeHistoryMenus } from './history-menus.js';
import { TAG_UNCATEGORIZED } from './tag-system.js';
import { isTextOutputMode, textThemeForOutputMode } from './plain-text-renderer.js';
import { createHtmlTextEdit } from './result-text-edit.js';
import { displayedContinuationVersion } from './continuation-session.js';
import { SKIN_LABELS } from './theater-defaults.js';

// Event registration order and handler closures are preserved by the coordinator.
export function bindResultEvents(runtime, $d) {
    // ---- History ----
    runtime.resetHistorySelectionGesture();
    $d.off('click.tsh').on('click.tsh', '#theater-save-history-btn', runtime.saveToHistory);
    $d.off('click.tch').on('click.tch', '#theater-copy-html-btn', runtime.copyHtml);
    $d.off('click.tfs').on('click.tfs', '#theater-fullscreen-btn', runtime.openFullscreenReader);
    // ---- Recent generations nav ----
    $d.off('click.trp').on('click.trp', '#theater-recent-prev', function () {
        if (runtime.recentIndex <= 0) return;
        runtime.showRecentResult(runtime.recentIndex - 1);
    });
    $d.off('click.trn').on('click.trn', '#theater-recent-next', function () {
        if (runtime.recentIndex >= runtime.recentCache.length - 1) return;
        runtime.showRecentResult(runtime.recentIndex + 1);
    });
    // ---- Edit result text ----
    $d.off('click.ter').on('click.ter', '#theater-edit-result-btn', function () {
        if (runtime.isGenerating || runtime.isPreparingGeneration) { toastr.warning('请等当前生成完成后再编辑生成页'); return; }
        const html = runtime.lastGeneratedHtml || runtime.currentDisplayHtml;
        let htmlEdit = null;
        try { if (!isTextOutputMode(runtime.currentOutputMode)) htmlEdit = createHtmlTextEdit(html); }
        catch (error) { toastr.warning(error.message); return; }
        const text = htmlEdit?.text ?? runtime.htmlToPlainText(html);
        if (!text) { toastr.warning('没有可编辑的正文'); return; }
        runtime.resultEditSnapshot = {
            htmlEdit,
            html,
            text,
            mode: runtime.currentOutputMode || 'html',
            recentIndex: runtime.displayedRecentIndex(html),
        };
        $('#theater-result-text-editor').val(text).show().trigger('focus');
        $('#theater-output-frame').hide();
        $('#theater-output-text-fallback').hide();
        runtime.setResultEditControls(true);
        toastr.info(isTextOutputMode(runtime.currentOutputMode)
            ? '正在编辑纯文字正文；可应用修改或直接退出编辑'
            : '保留原 HTML 排版；请保持行数，只修改行内文字');
    });
    $d.off('click.tce').on('click.tce', '#theater-cancel-edit-btn', function () {
        runtime.cancelResultEdit();
    });
    $d.off('click.tse').on('click.tse', '#theater-save-edit-btn', async function () {
        const text = $('#theater-result-text-editor').val().trim();
        if (!text) { toastr.warning('正文不能为空'); return; }
        const snapshot = runtime.resultEditSnapshot;
        if (!snapshot) { runtime.cancelResultEdit(); return; }
        if (snapshot.saving) return;
        let newHtml;
        const newMode = snapshot.mode;
        try {
            newHtml = snapshot.htmlEdit ? snapshot.htmlEdit.apply(text) : runtime.textFallbackHtml(text, textThemeForOutputMode(snapshot.mode));
        } catch (error) { toastr.warning(error.message); return; }
        const version = displayedContinuationVersion(runtime.continuationSession, snapshot.html);
        const candidates = [runtime.currentGenerationResult, ...runtime.recentCache];
        const target = candidates.find(item => item?.html === snapshot.html && (!version?.resultId || item.resultId === version.resultId));
        snapshot.saving = true;
        let stored = true;
        try { if (target) stored = await runtime.updateResultItem(target, newHtml, newMode); }
        finally { snapshot.saving = false; }
        if (!stored) return;
        if (runtime.resultEditSnapshot !== snapshot) return;
        runtime.lastGeneratedHtml = newHtml;
        runtime.lastGeneratedText = text;
        runtime.currentDisplayHtml = newHtml;
        runtime.currentOutputMode = newMode;
        if (version) Object.assign(version, { html: newHtml, text, mode: newMode, continuationRounds: [text], layoutSource: null });
        if (runtime.retainedResultSource?.html === snapshot.html) runtime.retainedResultSource = { ...runtime.retainedResultSource, html: newHtml, mode: newMode, continuationRounds: [text] };
        $('#theater-result-text-editor').hide();
        runtime.showInIframe(newHtml, newMode);
        runtime.resultEditSnapshot = null;
        runtime.setResultEditControls(false);
        toastr.success('文字修改已应用');
    });
    $d.off('click.tdr').on('click.tdr', '#theater-delete-result-btn', async function () {
        if (runtime.isGenerating || runtime.isPreparingGeneration) { toastr.warning('请等当前生成结束'); return; }
        const html = runtime.currentDisplayHtml || runtime.lastGeneratedHtml;
        if (!html) { toastr.warning('没有可移除的结果'); return; }
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('从“最近生成”移除当前结果？', '只清除生成页副本；已经保存到历史的小剧场不会受影响。');
        if (!ok || runtime.isGenerating || runtime.isPreparingGeneration || (runtime.currentDisplayHtml || runtime.lastGeneratedHtml) !== html) return;
        if (runtime.currentGenerationResult?.html === html) {
            if (!await runtime.queueResultStorage(async () => {
                if (!await runtime.recentPersist(runtime.recentCache, null)) return false;
                runtime.currentGenerationResult = null; return true;
            })) return;
        }
        if (runtime.resultEditSnapshot) runtime.cancelResultEdit();
        const targetIndex = runtime.displayedRecentIndex(html);
        if (targetIndex >= 0) {
            runtime.recentCache.splice(targetIndex, 1);
            runtime.recentPersist();
        }
        const version = displayedContinuationVersion(runtime.continuationSession, html);
        if (version) runtime.continuationSession.versions.splice(runtime.continuationSession.versions.indexOf(version), 1);
        if (version && runtime.continuationSession.versions.length) {
            runtime.showContinuationVersion(Math.min(runtime.continuationSession.selected, runtime.continuationSession.versions.length - 1));
        } else if (targetIndex >= 0 && runtime.recentCache.length && !runtime.continuationSession) {
            runtime.showRecentResult(Math.min(targetIndex, runtime.recentCache.length - 1));
        } else {
            runtime.clearDisplayedResult();
        }
        toastr.success(targetIndex >= 0 ? '已从最近生成移除，历史记录未受影响' : '已从生成页移除，历史记录未受影响');
    });
    // 续写：从当前生成结果
    $d.off('click.tcont').on('click.tcont', '#theater-continue-btn', function () {
        const html = runtime.lastGeneratedHtml || runtime.currentDisplayHtml;
        if (!html) { toastr.warning('没有可续写的内容'); return; }
        const source = (runtime.currentGenerationResult?.html === html ? runtime.currentGenerationResult : null) || displayedContinuationVersion(runtime.continuationSession, html) || runtime.recentCache.find(item => item.html === html) || runtime.historyCache.find(item => item.html === html) || (runtime.retainedResultSource?.html === html ? runtime.retainedResultSource : null);
        runtime.startContinue(html, source?.tags || runtime.activeInstructionTags, { sourceLabel: source?.title || '当前结果', sourceRounds: source?.continuationRounds, sourceItem: source });
    });
    // 取消续写
    $d.off('click.tcc').on('click.tcc', '#theater-cancel-continue', function () {
        if (runtime.isGenerating || runtime.isPreparingGeneration) return;
        $('#theater-cont-exit-confirm').prop('hidden', false);
    });
    $d.off('click.tcce').on('click.tcce', '#theater-cont-confirm-exit', function () {
        if (runtime.isGenerating || runtime.isPreparingGeneration) return;
        runtime.clearContinueMode();
    });
    $d.off('click.tccs').on('click.tccs', '#theater-cont-stay', () => $('#theater-cont-exit-confirm').prop('hidden', true));
    $d.off('click.tcrtn').on('click.tcrtn', '#theater-cont-return', () => runtime.showContinuationVersion(runtime.continuationSession?.selected));
    $d.off('click.tcrw').on('click.tcrw', '#theater-cont-rewrite', runtime.generateTheater);
    $d.off('click.tcnx').on('click.tcnx', '#theater-cont-next', function () {
        if (runtime.isGenerating || runtime.isPreparingGeneration || runtime.resultEditSnapshot) return;
        const version = displayedContinuationVersion(runtime.continuationSession, runtime.currentDisplayHtml || runtime.lastGeneratedHtml);
        if (!version) return;
        runtime.startContinue(version.html, version.tags || runtime.continuationSourceTags, {
            segment: runtime.continuationSession.segment + 1,
            sourceRounds: version.continuationRounds, sourceItem: version,
            sourceLabel: `第 ${runtime.continuationSession.segment} 段 · 第 ${runtime.continuationSession.versions.indexOf(version) + 1} 版`,
        });
    });
    $d.off('click.tcvp').on('click.tcvp', '#theater-cont-version-prev', () => runtime.showContinuationVersion(runtime.continuationSession?.selected - 1));
    $d.off('click.tcvn').on('click.tcvn', '#theater-cont-version-next', () => runtime.showContinuationVersion(runtime.continuationSession?.selected + 1));
    $d.off('click.thmenu').on('click.thmenu', '.theater-history-menu-trigger', function (event) { event.preventDefault(); setHistoryFilterPanel(null); $('.theater-history-filter-area').html(historyFiltersHTML(runtime, SillyTavern.getContext())); toggleHistoryMenu(this); });
    $d.off('click.throles').on('click.throles', '.theater-history-roles-edit', function () { runtime.editHistoryRoles($(this).data('id')); });
    $d.off('click.thbulkroles').on('click.thbulkroles', '#theater-hist-role-selected', () => runtime.editHistoryRoles());
    $d.off('click.thmove').on('click.thmove', '.theater-history-move', function () { runtime.moveHistoryToCollection($(this).data('id')); });
    $d.off('click.thbulkmove').on('click.thbulkmove', '#theater-hist-move-selected', () => runtime.moveHistoryToCollection());
    $d.off('click.thinfo').on('click.thinfo', '.theater-history-info-trigger', function () { runtime.showHistoryMetadata($(this).data('id'), this.dataset.infoFolder || null); });
    $d.off('click.throlepanel').on('click.throlepanel', '#theater-history-role-filter', function () { closeHistoryMenus(); toggleHistoryFilterPanel('role'); $('.theater-history-filter-area').html(historyFiltersHTML(runtime, SillyTavern.getContext())); $('#theater-history-role-filter').trigger('focus'); });
    $d.off('click.throlefilter').on('click.throlefilter', '[data-history-role]', function () { runtime.historyRoleFilter = this.dataset.historyRole; setHistoryFilterPanel(null); runtime.histPage = 0; runtime.histSelected.clear(); runtime.refreshHistList(); $('#theater-history-role-filter').trigger('focus'); });
    $d.off('click.thtagsinline').on('click.thtagsinline', '[data-history-tag]', function () {
        const tag = this.dataset.historyTag, selected = runtime.settings.historyTagFilter || [];
        runtime.settings.historyTagFilter = tag === TAG_UNCATEGORIZED ? (selected.includes(tag) ? [] : [tag]) : (selected.includes(tag) ? selected.filter(value => value !== tag) : [...selected.filter(value => value !== TAG_UNCATEGORIZED), tag]);
        runtime.histPage = 0; runtime.histSelected.clear(); runtime.save(); runtime.refreshHistList();
        [...document.querySelectorAll('[data-history-tag]')].find(button => button.dataset.historyTag === tag)?.focus();
    });
    $d.off('click.thtagsclear').on('click.thtagsclear', '[data-history-tags-clear]', () => { runtime.settings.historyTagFilter = []; runtime.histPage = 0; runtime.histSelected.clear(); runtime.save(); runtime.refreshHistList(); $('[data-history-tags-clear]').trigger('focus'); });
    $d.off('click.thfilterdone').on('click.thfilterdone', '[data-history-filter-done]', () => { setHistoryFilterPanel(null); $('.theater-history-filter-area').html(historyFiltersHTML(runtime, SillyTavern.getContext())); $('#theater-history-tag-filter').trigger('focus'); });
    $d.off('keydown.thfilterclose').on('keydown.thfilterclose', '.theater-history-filter-area', function (event) { if (event.key === 'Escape') { event.preventDefault(); const role = !!document.querySelector('#theater-history-role-panel'); setHistoryFilterPanel(null); $(this).html(historyFiltersHTML(runtime, SillyTavern.getContext())); $(role ? '#theater-history-role-filter' : '#theater-history-tag-filter').trigger('focus'); } });
    $d.off('click.thexpand').on('click.thexpand', '.theater-history-expand', function (event) {
        if (runtime.histBatchMode || Date.now() < runtime.suppressHistoryCardClickUntil) return;
        event.stopPropagation(); const id = $(this).data('id'); toggleHistoryItem(id); runtime.refreshHistList();
        [...document.querySelectorAll('.theater-history-expand')].find(button => String($(button).data('id')) === String(id))?.focus({ preventScroll: true });
    });
    $d.off('click.thversion').on('click.thversion', '[data-history-version]', function () { runtime.historyVersionSelection.set(this.dataset.historyVersion, this.dataset.versionId); setExpandedHistoryItem(this.dataset.versionId); runtime.refreshHistList(); document.querySelector('[data-history-version][aria-pressed="true"]')?.focus({ preventScroll: true }); });
    $d.off('click.thcurrentrole').on('click.thcurrentrole', '#theater-history-current-role', () => { runtime.historyRoleFilter = runtime.historyRoleFilter === '__current__' ? '' : '__current__'; runtime.histPage = 0; runtime.histSelected.clear(); runtime.refreshHistList(); });
    $d.off('click.thresetfilters').on('click.thresetfilters', '#theater-history-reset-filters, [data-history-reset]', () => { setHistoryFilterPanel(null); runtime.historyRoleFilter = ''; runtime.historyQuery = ''; runtime.settings.historyTagFilter = []; runtime.histPage = 0; runtime.histSelected.clear(); $('#theater-history-search').val(''); runtime.save(); runtime.refreshHistList(); });
    $d.off('input.thsearch').on('input.thsearch', '#theater-history-search', function () { runtime.historyQuery = this.value; runtime.histPage = 0; runtime.histSelected.clear(); runtime.refreshHistList(); });
    $d.off('click.thclearsearch').on('click.thclearsearch', '#theater-history-clear-search', () => { runtime.historyQuery = ''; runtime.histPage = 0; runtime.histSelected.clear(); $('#theater-history-search').val('').trigger('focus'); runtime.refreshHistList(); });
    $d.off('click.thnewfolder').on('click.thnewfolder', '#theater-history-new-folder', () => runtime.organizeHistory('new'));
    $d.off('click.thcollection').on('click.thcollection', '[data-collection-action]', function () { runtime.organizeHistory(this.dataset.collectionAction, this.dataset.collectionId, this); });
    $d.off('change.thcollectionversion').on('change.thcollectionversion', '[data-collection-version]', function () { runtime.historyVersionSelection.set(this.dataset.collectionVersion, this.value); runtime.refreshHistList(); });
    $d.off('click.thv').on('click.thv', '.theater-history-view', function () {
        if (runtime.histBatchMode && this.closest('#theater-history-list')) return;
        const item = runtime.historyCache.find(h => h.id === $(this).data('id')); if (!item) return;
        if (runtime.resultReader?.isEditing()) { toastr.warning('请先完成阅读页的文字编辑'); return; }
        runtime.openHistoryReading(item); // reading copies never overwrites a saved work
        $('.theater-tab[data-tab="generate"]').click();
        runtime.resultReader?.refresh();
        runtime.switchResultWorkspace('read');
    });
    // 续写：从历史记录
    $d.off('click.thc').on('click.thc', '.theater-history-continue', function () {
        const item = runtime.historyCache.find(h => h.id === $(this).data('id')); if (!item) return;
        runtime.startContinue(item.html, item.tags, { sourceLabel: item.title || '保存的小剧场', sourceRounds: item.continuationRounds, sourceItem: item });
    });
    $d.off('click.the').on('click.the', '.theater-history-export', function () {
        const item = runtime.historyCache.find(h => h.id === $(this).data('id')); if (!item) return;
        runtime.downloadFile(`${item.title || 'theater'}.html`, item.html, 'text/html');
    });
    $d.off('click.thd').on('click.thd', '.theater-history-delete', async function () {
        const id = $(this).data('id');
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('确定删除这条历史？');
        if (!ok) return;
        if (await runtime.histDelete([id])) runtime.refreshHistList();
    });
    $d.off('click.threname').on('click.threname', '.theater-history-rename', function () { runtime.renameHistoryItem($(this).data('id'), this); });
    $d.off('click.thetags').on('click.thetags', '.theater-history-tags-edit', function () { runtime.editHistoryTags($(this).data('id')); });
    $d.off('click.thfilter').on('click.thfilter', '#theater-history-tag-filter', function () { closeHistoryMenus(); toggleHistoryFilterPanel('tag'); $('.theater-history-filter-area').html(historyFiltersHTML(runtime, SillyTavern.getContext())); $('#theater-history-tag-filter').trigger('focus'); });
    $d.off('click.teah').on('click.teah', '#theater-export-all-history', runtime.requestHistoryExport);
    $d.off('click.tih').on('click.tih', '#theater-import-history-btn', runtime.importHistoryBackup);
    $d.off('click.thimportempty').on('click.thimportempty', '[data-history-import]', runtime.importHistoryBackup);
    $d.off('click.thbe').on('click.thbe', '#theater-hist-batch-enter', function () {
        if (runtime.histBatchMode) return;
        runtime.histBatchMode = true;
        runtime.histSelected.clear();
        runtime.refreshHistList();
        runtime.enterHistBatchMode();
    });
    $d.off('click.thbc').on('click.thbc', '#theater-hist-batch-cancel', function () {
        runtime.histBatchMode = false;
        runtime.histSelected.clear();
        runtime.refreshHistList();
        runtime.exitHistBatchMode();
    });
    $d.off('change.thcb').on('change.thcb', '.theater-hist-checkbox', function () {
        const id = $(this).data('id');
        runtime.setHistoryItemSelected(id, $(this).is(':checked'), $(this).closest('.theater-history-item')[0]);
    });
    $d.off('click.thcardselect').on('click.thcardselect', '.theater-history-item', function (event) {
        if ($(event.target).closest('.theater-history-actions, .theater-history-info-trigger, .theater-hist-checkbox').length) return;
        if (Date.now() < runtime.suppressHistoryCardClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!runtime.histBatchMode) return;
        const id = $(this).data('id');
        runtime.setHistoryItemSelected(id, !runtime.histSelected.has(id), this);
    });
    $d.off('pointerdown.thhistgesture').on('pointerdown.thhistgesture', '.theater-history-item', function (event) {
        if ($(event.target).closest('.theater-history-actions, .theater-hist-checkbox, button:not(.theater-history-expand), a, input, textarea, select').length) return;
        const pointer = event.originalEvent || event;
        // 触屏改走可 preventDefault 的 touchmove，避免浏览器在长按后把纵向拖选抢成页面滚动。
        if (pointer.pointerType === 'touch') return;
        if (pointer.button !== undefined && pointer.button !== 0) return;
        runtime.resetHistorySelectionGesture();
        const id = $(this).data('id');
        runtime.histSelectionGesture = {
            pointerId: pointer.pointerId,
            startX: pointer.clientX,
            startY: pointer.clientY,
            id,
            item: this,
            active: false,
            selecting: true,
            visited: new Set([id]),
            timer: null,
            scrollContainer: null,
            lastX: pointer.clientX,
            lastY: pointer.clientY,
            autoScrollSpeed: 0,
            autoScrollFrame: null,
        };
        // 批量模式也保留短滑滚动；只有停留成长按后才接管为连续选择。
        runtime.histSelectionGesture.timer = setTimeout(runtime.activateHistorySelectionGesture, 420);
    });
    $d.off('pointermove.thhistgesture').on('pointermove.thhistgesture', function (event) {
        const gesture = runtime.histSelectionGesture;
        const pointer = event.originalEvent || event;
        if (!gesture || gesture.pointerId !== pointer.pointerId) return;
        if (!gesture.active) {
            if (Math.hypot(pointer.clientX - gesture.startX, pointer.clientY - gesture.startY) > 10) runtime.resetHistorySelectionGesture();
            return;
        }
        event.preventDefault();
        runtime.applyHistorySelectionGestureAt(pointer.clientX, pointer.clientY);
        runtime.updateHistorySelectionAutoScroll(pointer.clientX, pointer.clientY);
    });
    $d.off('pointerup.thhistgesture pointercancel.thhistgesture').on('pointerup.thhistgesture pointercancel.thhistgesture', function (event) {
        const gesture = runtime.histSelectionGesture;
        const pointer = event.originalEvent || event;
        if (!gesture || gesture.pointerId !== pointer.pointerId) return;
        if (gesture.active) runtime.suppressHistoryCardClickUntil = Date.now() + 400;
        runtime.resetHistorySelectionGesture();
    });
    $d.off('contextmenu.thhistgesture').on('contextmenu.thhistgesture', '.theater-history-item', function (event) {
        if (runtime.histSelectionGesture?.active || Date.now() < runtime.suppressHistoryCardClickUntil) event.preventDefault();
    });
    $d.off('touchstart.thhistgesture').on('touchstart.thhistgesture', '.theater-history-item', function (event) {
        if ($(event.target).closest('.theater-history-actions, .theater-hist-checkbox, button:not(.theater-history-expand), a, input, textarea, select').length) return;
        const touch = event.originalEvent?.changedTouches?.[0];
        if (!touch) return;
        runtime.resetHistorySelectionGesture();
        const id = $(this).data('id');
        runtime.histSelectionGesture = {
            pointerId: `touch:${touch.identifier}`,
            startX: touch.clientX,
            startY: touch.clientY,
            id,
            item: this,
            active: false,
            selecting: true,
            visited: new Set([id]),
            timer: null,
            scrollContainer: null,
            lastX: touch.clientX,
            lastY: touch.clientY,
            autoScrollSpeed: 0,
            autoScrollFrame: null,
        };
        runtime.histSelectionGesture.timer = setTimeout(runtime.activateHistorySelectionGesture, 420);
        // 只在卡片空白处开始一次长按候选时接入触摸移动；按钮点击不再经过整页阻塞监听。
        runtime.attachHistoryTouchMoveHandler();
    });
    $d.off('touchend.thhistgesture touchcancel.thhistgesture').on('touchend.thhistgesture touchcancel.thhistgesture', function (event) {
        const gesture = runtime.histSelectionGesture;
        if (!gesture || typeof gesture.pointerId !== 'string' || !gesture.pointerId.startsWith('touch:')) return;
        const identifier = Number(gesture.pointerId.slice(6));
        const ended = Array.from(event.originalEvent?.changedTouches || []).some(item => item.identifier === identifier);
        if (!ended) return;
        if (gesture.active) runtime.suppressHistoryCardClickUntil = Date.now() + 400;
        runtime.resetHistorySelectionGesture();
    });
    $d.off('click.thsa').on('click.thsa', '#theater-hist-select-all', function () {
        const visible = runtime.visibleHistoryItems();
        if (visible.length && visible.every(item => runtime.histSelected.has(item.id))) {
            visible.forEach(item => runtime.histSelected.delete(item.id));
        } else {
            visible.forEach(h => runtime.histSelected.add(h.id));
        }
        runtime.refreshHistList();
        if (runtime.histBatchMode) runtime.enterHistBatchMode();
    });
    $d.off('click.thds').on('click.thds', '#theater-hist-delete-selected', async function () {
        const n = runtime.histSelected.size;
        if (!n) return;
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm(`确定删除选中的 ${n} 条历史记录？`, '删除后无法恢复');
        if (!ok) return;
        if (!(await runtime.histDelete([...runtime.histSelected]))) return;
        runtime.histSelected.clear();
        runtime.histBatchMode = false;
        runtime.refreshHistList();
        runtime.exitHistBatchMode();
        toastr.success(`已删除 ${n} 条`);
    });
    $d.off('click.thtagsselected').on('click.thtagsselected', '#theater-hist-tag-selected', runtime.bulkEditSelectedHistoryTags);

    // ---- Theme ----
    $d.off('click.tcss').on('click.tcss', '#theater-save-css-btn', function () { runtime.settings.customCSS = $('#theater-custom-css').val(); runtime.save(); runtime.applyCustomCSS(); toastr.success('样式已应用'); });
    $d.off('click.trcss').on('click.trcss', '#theater-reset-css-btn', function () { runtime.settings.customCSS = ''; $('#theater-custom-css').val(''); runtime.save(); runtime.applyCustomCSS(); toastr.success('已重置'); });
    $d.off('click.tfsave').on('click.tfsave', '#theater-save-font-size-btn', function () {
        runtime.settings.uiFontSize = runtime.normalizeUIFontSize($('#theater-ui-font-size').val());
        $('#theater-ui-font-size').val(runtime.settings.uiFontSize);
        runtime.save();
        runtime.applyUIFontSize();
        toastr.success(`字号已调整为 ${runtime.settings.uiFontSize}px`);
    });
    $d.off('click.tfreset').on('click.tfreset', '#theater-reset-font-size-btn', function () {
        runtime.settings.uiFontSize = runtime.defaultSettings.uiFontSize;
        $('#theater-ui-font-size').val(runtime.settings.uiFontSize);
        runtime.save();
        runtime.applyUIFontSize();
        toastr.success('已恢复默认字号');
    });
    // ---- Skin switcher ----
    $d.off('click.tskt').on('click.tskt', '#theater-skin-toggle', function () {
        $(this).next('.theater-drawer-body').slideToggle(150);
        $(this).find('.theater-drawer-arrow').toggleClass('open');
    });
    $d.off('change.tskin').on('change.tskin', 'input[name="theater-skin"]', function () {
        const v = $(this).val();
        runtime.settings.skinMode = v;
        runtime.save();
        $('.theater-popup').attr('data-skin', v);
        $('.theater-skin-row').removeClass('active');
        $(this).closest('.theater-skin-row').addClass('active');
        $('#theater-skin-current-label').text(SKIN_LABELS[v] || v);
        toastr.success(`已切换到「${SKIN_LABELS[v] || v}」`, '', { timeOut: 2000 });
    });


}
