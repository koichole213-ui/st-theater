import { syncFollowedWorldBooks } from './world-book-policy.js';
import { normalizeContextRange } from './context-policy.js';
import { withPreservedPopupViewport } from './popup-lifecycle.js';
import { itemTags } from './tag-system.js';
import { requestedListPage } from './pagination.js';

// Event registration order and handler closures are preserved by the coordinator.
export function bindMaterialEvents(runtime, $d) {
    // ---- Material: Preset ----
    $d.off('input.tpsq').on('input.tpsq', '#theater-preset-search', function () {
        runtime.presetSearch = $(this).val() || '';
        runtime.renderPresetOptions();
    });
    $d.off('change.tpns').on('change.tpns', '#theater-preset-name-select', async function () {
        runtime.settings.selectedPresetName = $(this).val();
        runtime.save();
        if (runtime.settings.selectedPresetName) {
            $('#theater-preset-current').show();
            await runtime.loadPresetEntries(runtime.settings.selectedPresetName);
        } else {
            await runtime.loadPresetEntries('');
        }
    });
    $d.off('click.tlpre').on('click.tlpre', '#theater-load-preset-btn', async function () {
        await runtime.loadPresetNameList();
        if (runtime.settings.selectedPresetName) {
            $('#theater-preset-name-select').val(runtime.settings.selectedPresetName);
            await runtime.loadPresetEntries(runtime.settings.selectedPresetName);
        }
    });
    $d.off('change.tpec').on('change.tpec', '.theater-preset-check', function () {
        if (runtime.cachedPresetLoadState === 'loading') return;
        const id = $(this).data('id');
        const states = runtime.currentPresetEntryStates({ create: true });
        states[id] = $(this).is(':checked');
        $(this).closest('.theater-wb-entry').toggleClass('theater-wb-entry-off', !states[id]);
        runtime.save();
    });
    $d.off('click.tpsa').on('click.tpsa', '#theater-preset-select-all', () => {
        if (runtime.cachedPresetLoadState === 'loading' || $('#theater-preset-select-all').hasClass('disabled')) return;
        const states = runtime.currentPresetEntryStates({ create: true });
        $('.theater-preset-check').each(function () {
            $(this).prop('checked', true);
            states[$(this).data('id')] = true;
        });
        $('.theater-wb-entry', '#theater-preset-entries').removeClass('theater-wb-entry-off');
        runtime.save();
    });
    $d.off('click.tpda').on('click.tpda', '#theater-preset-deselect-all', () => {
        if (runtime.cachedPresetLoadState === 'loading' || $('#theater-preset-deselect-all').hasClass('disabled')) return;
        const states = runtime.currentPresetEntryStates({ create: true });
        $('.theater-preset-check').each(function () {
            $(this).prop('checked', false);
            states[$(this).data('id')] = false;
        });
        $('.theater-wb-entry', '#theater-preset-entries').addClass('theater-wb-entry-off');
        runtime.save();
    });
    $d.off('click.tpet').on('click.tpet', '.theater-preset-entry-toggle', function (e) {
        e.stopPropagation();
        const id = $(this).data('id');
        $(`.theater-preset-entry-body[data-id="${id}"]`).slideToggle(150);
        $(this).find('i').toggleClass('fa-chevron-right fa-chevron-down');
    });
    $d.off('click.tpeh').on('click.tpeh', '.theater-preset-entry-header', function (e) {
        if ($(e.target).is('input[type="checkbox"]') || $(e.target).closest('.theater-preset-entry-toggle').length) return;
        $(this).find('.theater-preset-entry-toggle').trigger('click');
    });

    // ---- Material: Style & NSFW Addons ----
    $d.off('click.tssa').on('click.tssa', '#theater-save-style-btn', function () {
        runtime.settings.customStyleAddon = $('#theater-style-addon').val(); runtime.save(); toastr.success('文风补充已保存');
    });
    $d.off('click.tsna').on('click.tsna', '#theater-save-nsfw-btn', function () {
        runtime.settings.customNsfwAddon = $('#theater-nsfw-addon').val(); runtime.save(); toastr.success('NSFW补充已保存');
    });

    // ---- Material: Persona ----
    $d.off('click.tlp').on('click.tlp', '#theater-load-persona-btn', runtime.loadPersona);
    $d.off('change.tpf').on('change.tpf', '#theater-persona-follow', function () {
        runtime.settings.followUserPersona = $(this).is(':checked');
        runtime.save();
        if (runtime.settings.followUserPersona) runtime.loadPersona({ silent: true });
    });
    $d.off('click.tsper').on('click.tsper', '#theater-save-persona-btn', function () {
        runtime.settings.userPersona = $('#theater-user-persona').val(); runtime.save(); toastr.success('已保存');
    });

    // ---- Material: World Book ----
    $d.off('change.twbk').on('change.twbk', '.theater-wb-book-check', async function () {
        const name = String($(this).data('name'));
        if (!Array.isArray(runtime.settings.selectedWorldBooks)) runtime.settings.selectedWorldBooks = [];
        const sel = runtime.settings.selectedWorldBooks;
        if ($(this).is(':checked')) {
            if (!sel.includes(name)) sel.push(name);
            runtime.wbGroupCollapsed[name] = false;  // 刚勾的书自动展开，方便马上调条目
        } else {
            const i = sel.indexOf(name);
            if (i !== -1) sel.splice(i, 1);
        }
        $(this).closest('.theater-wb-book-row').toggleClass('active', $(this).is(':checked'));
        runtime.save();
        await runtime.reloadWorldBooks();
    });
    $d.off('input.twbq').on('input.twbq', '#theater-wb-search', function () {
        runtime.wbSearch = $(this).val() || '';
        $('#theater-wb-books').html(runtime.renderWBTree());
    });
    $d.off('change.twbf').on('change.twbf', '#theater-wb-follow', async function () {
        runtime.settings.followCharCard = $(this).is(':checked');
        if (runtime.settings.followCharCard) {
            await runtime.applyCharBoundBooks({ announce: true });
            return;
        }
        const synced = syncFollowedWorldBooks(runtime.settings.selectedWorldBooks, runtime.settings.followedWorldBooks, []);
        runtime.settings.selectedWorldBooks = synced.selectedBooks;
        runtime.settings.followedWorldBooks = synced.followedBooks;
        runtime.save();
        $('#theater-wb-books').html(runtime.renderWBTree());
        await runtime.reloadWorldBooks({ silent: true });
        toastr.info('已关闭跟随，并撤下角色卡自动带入的世界书');
    });
    // 点书那一行：没勾的书 = 勾上（自动展开），勾了的书 = 展开/收起条目
    $d.off('click.twbr').on('click.twbr', '.theater-wb-book-row', function (e) {
        if ($(e.target).is('input')) return;
        const $node = $(this).closest('.theater-wb-book-node');
        const key = String($node.attr('data-key'));
        const isManual = key === '__manual__';
        const selected = isManual || (runtime.settings.selectedWorldBooks || []).includes(key);
        if (!selected) {
            $(this).find('.theater-wb-book-check').prop('checked', true).trigger('change');
            return;
        }
        const collapsed = runtime.wbGroupCollapsed[key] !== false;
        runtime.wbGroupCollapsed[key] = collapsed ? false : true;
        $node.find('.theater-wb-group-body').slideToggle(150);
        $(this).find('.theater-wb-group-arrow').toggleClass('fa-chevron-right fa-chevron-down');
    });
    $d.off('change.twb').on('change.twb', '.theater-wb-check', function (e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('index'));
        const checked = $(this).is(':checked');
        runtime.setWBStateByIndex(idx, checked);
        $(this).closest('.theater-wb-entry').toggleClass('theater-wb-entry-off', !checked);
        runtime.save(); runtime.updateWBCount();
    });
    // 书内条目筛选（大书救星）
    $d.off('input.twef').on('input.twef', '.theater-wb-entry-filter', function () {
        const q = ($(this).val() || '').toLowerCase().trim();
        $(this).closest('.theater-wb-group-body').find('.theater-wb-entry').each(function () {
            const name = $(this).find('.theater-wb-entry-name').text().toLowerCase();
            $(this).toggle(!q || name.includes(q));
        });
    });
    // 书内全选/全不选（只作用于当前筛选可见的条目）
    const setBookEntries = ($el, on) => {
        $el.closest('.theater-wb-group-body').find('.theater-wb-entry:visible').each(function () {
            const $check = $(this).find('.theater-wb-check');
            runtime.setWBStateByIndex(parseInt($check.data('index')), on);
            $check.prop('checked', on);
            $(this).toggleClass('theater-wb-entry-off', !on);
        });
        runtime.save(); runtime.updateWBCount();
    };
    $d.off('click.twba').on('click.twba', '.theater-wb-book-all', function () { setBookEntries($(this), true); });
    $d.off('click.twbn').on('click.twbn', '.theater-wb-book-none', function () { setBookEntries($(this), false); });
    $d.off('click.twet').on('click.twet', '.theater-wb-entry-toggle', function (e) {
        e.stopPropagation();
        const idx = $(this).data('index');
        $(`.theater-wb-entry-body[data-index="${idx}"]`).slideToggle(150);
        $(this).find('i').toggleClass('fa-chevron-right fa-chevron-down');
    });
    $d.off('click.tweh').on('click.tweh', '.theater-wb-entry-header', function (e) {
        if ($(e.target).is('input[type="checkbox"]') ||
            $(e.target).closest('.theater-wb-entry-toggle').length ||
            $(e.target).closest('.theater-wb-entry-delete').length) return;
        $(this).find('.theater-wb-entry-toggle').trigger('click');
    });
    // World book - delete a single manually-added entry
    $d.off('click.twed').on('click.twed', '.theater-wb-entry-delete', async function (e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('index'));
        const entry = runtime.wbEntries[idx];
        if (!entry?.manual) return;
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm(`删除「${entry.name || '#' + (idx + 1)}」？`, '此条目是手动添加的，删除后不可恢复。');
        if (!ok) return;
        (runtime.settings.manualWBEntries || []).splice(entry.mIdx, 1);
        runtime.save();
        runtime.syncManualIntoWB();
        runtime.refreshWBUI();
    });
    // World book - clear ALL manually-added entries (世界书来的不动)
    $d.off('click.twcm').on('click.twcm', '#theater-wb-clear-manual', async function () {
        const manualCount = (runtime.settings.manualWBEntries || []).length;
        if (!manualCount) return;
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm(`清空 ${manualCount} 条手动添加的条目？`, '世界书来的条目不受影响。');
        if (!ok) return;
        runtime.settings.manualWBEntries = [];
        runtime.save();
        runtime.syncManualIntoWB();
        runtime.refreshWBUI();
    });
    // World book - manual add
    $d.off('click.twp').on('click.twp', '#theater-wb-parse-btn', function () {
        const text = $('#theater-wb-manual').val().trim(); if (!text) return;
        const parts = text.split(/\n{2,}/).filter(s => s.trim());
        if (!Array.isArray(runtime.settings.manualWBEntries)) runtime.settings.manualWBEntries = [];
        parts.forEach(p => {
            runtime.settings.manualWBEntries.push({ name: p.substring(0, 30).replace(/\n/g, ' '), content: p.trim(), on: true });
        });
        runtime.save();
        runtime.syncManualIntoWB();
        runtime.refreshWBUI();
        $('#theater-wb-manual').val('');
        toastr.success(`添加了 ${parts.length} 个条目`);
    });

    // Context range
    $d.off('change.trng').on('change.trng', '#theater-context-range', function () {
        runtime.settings.contextRange = normalizeContextRange($(this).val());
        $(this).val(runtime.settings.contextRange);
        runtime.save();
        runtime.scheduleTokenEstimate();
    });
    $d.off('change.trcc').on('change.trcc', '#theater-read-chat-context', function () {
        runtime.settings.readChatContext = this.checked;
        $('#theater-context-range-row').toggleClass('is-disabled', !this.checked);
        $('#theater-context-range').prop('disabled', !this.checked);
        runtime.save();
    });

    // ---- Rules: Instruction templates ----
    $d.off('click.tsi').on('click.tsi', '#theater-save-instruction-btn', function () {
        return withPreservedPopupViewport(this, runtime.saveInstructionTpl);
    });
    $d.off('click.tci').on('click.tci', '#theater-clear-instruction-btn', async function () {
        return withPreservedPopupViewport(this, async () => {
            if (!$('#theater-instruction').val().trim()) return;
            const { Popup } = SillyTavern.getContext();
            const ok = await Popup.show.confirm('确定清空指令输入框？');
            if (!ok) return;
            $('#theater-instruction').val('');
            runtime.settings.lastInstruction = '';
            if (runtime.continuationSession) runtime.continuationSession.direction = '';
            runtime.settings.lastInstructionTags = [];
            runtime.setActiveInstructionTags([], '');
            runtime.save();
        });
    });
    $d.off('click.titog').on('click.titog', '#theater-inst-toggle', function () {
        if (document.getElementById('theater-instruction-list')?.hasAttribute('data-pending-list')) runtime.refreshInstUI();
        $(this).next('.theater-drawer-body').slideToggle(150);
        $(this).find('.theater-drawer-arrow').toggleClass('open');
    });
    $d.off('click.tin').on('click.tin', '.theater-inst-name', function () {
        const t = runtime.settings.instructionTemplates[$(this).data('index')];
        if (t) {
            $('#theater-instruction').val(t.content);
            runtime.settings.lastInstruction = t.content;
            runtime.setActiveInstructionTags(itemTags(t, runtime.knownInstructionTags()), t.content);
            runtime.clearContinueMode({ silent: true });
            runtime.save();
            $('.theater-tab[data-tab="generate"]').click();
            toastr.info('已加载指令');
        }
    });
    $d.off('click.timore').on('click.timore', '.theater-inst-more', function (e) {
        e.stopPropagation();
        const item = $(this).closest('.theater-inst-item')[0];
        const willOpen = !item.classList.contains('theater-inst-actions-open');
        runtime.closeInstructionActionMenus(item);
        item.classList.toggle('theater-inst-actions-open', willOpen);
        $(this).attr('aria-expanded', String(willOpen));
        document.getElementById('theater-inst-drawer')?.classList.toggle('theater-inst-menu-open', willOpen);
        if (willOpen) requestAnimationFrame(() => runtime.positionInstructionActionMenu(item));
        else runtime.closeInstructionActionMenus();
    });
    $d.off('click.timoreclose').on('click.timoreclose', function (e) {
        if ($(e.target).closest('.theater-inst-more, .theater-inst-actions').length) return;
        runtime.closeInstructionActionMenus();
    });
    $d.off('click.tiaction').on('click.tiaction', '.theater-inst-actions > span', function () {
        runtime.closeInstructionActionMenus();
    });
    $('.theater-panels-wrapper').off('scroll.timoreclose').on('scroll.timoreclose', runtime.closeInstructionActionMenus);
    $(window).off('resize.timoreclose').on('resize.timoreclose', runtime.closeInstructionActionMenus);
    $d.off('click.tie').on('click.tie', '.theater-inst-edit', async function () {
        const idx = $(this).data('index');
        const tpl = runtime.settings.instructionTemplates[idx];
        if (!tpl) return;
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const html = `<div style="display:flex;flex-direction:column;gap:10px;">
            <label style="font-weight:600;">模板名称</label>
            <input id="theater-edit-tpl-name" class="text_pole" value="${runtime.esc(tpl.name)}" style="width:100%;">
            <label style="font-weight:600;">指令内容</label>
            <textarea id="theater-edit-tpl-content" class="text_pole" rows="6" style="width:100%;resize:vertical;">${runtime.esc(tpl.content)}</textarea>
        </div>`;
        const popup = new Popup(html, POPUP_TYPE.CONFIRM, '', { okButton: '保存', cancelButton: '取消', wide: true });
        const showPromise = popup.show();
        // show() 之后元素才在 DOM 中，先拿引用
        const nameEl = document.getElementById('theater-edit-tpl-name');
        const contentEl = document.getElementById('theater-edit-tpl-content');
        const result = await showPromise;
        if (!result) return;
        const newName = nameEl?.value?.trim() || '';
        const newContent = contentEl?.value?.trim() || '';
        if (!newName || !newContent) { toastr.warning('名称和内容不能为空'); return; }
        tpl.name = newName;
        tpl.content = newContent;
        runtime.save();
        runtime.refreshInstUI();
        toastr.success('已更新');
    });
    $d.off('click.tid').on('click.tid', '.theater-inst-delete', async function () {
        const idx = $(this).data('index');
        const name = runtime.settings.instructionTemplates[idx]?.name || '';
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const ok = await Popup.show.confirm(`确定删除「${name}」？`, '删除后无法恢复');
        if (!ok) return;
        runtime.settings.instructionTemplates.splice(idx, 1);
        runtime.instSelected.clear();  // 单删后索引会移位，清掉多选避免误操作
        runtime.save();
        runtime.refreshInstUI();
    });
    // ---- Tags ----
    $d.off('click.titf').on('click.titf', '#theater-inst-tag-filter', async function () {
        const chosen = await runtime.chooseTags({ title: '筛选指令模板', selected: runtime.settings.instructionTagFilter, allowUncategorized: true });
        if (chosen === null) return;
        runtime.settings.instructionTagFilter = chosen; runtime.instPage = 0; runtime.instSelected.clear(); runtime.save(); runtime.refreshInstUI(); runtime.refreshTagControls();
    });
    $d.off('click.titnew').on('click.titnew', '#theater-inst-new-tag-btn', async function () { await runtime.newInstructionTag(); runtime.refreshTagControls(); });
    $d.off('click.titmanage').on('click.titmanage', '#theater-inst-manage-tag-btn, #theater-history-manage-tags', runtime.manageInstructionTags);
    $d.off('click.tittags').on('click.tittags', '.theater-inst-tags', function () { runtime.editTemplateTags($(this).data('index')); });
    // ---- Search & Bulk ----
    $d.off('input.tis').on('input.tis', '#theater-inst-search', function () {
        runtime.instSearch = $(this).val() || '';
        runtime.instPage = 0;
        runtime.closeInstructionActionMenus();
        $('#theater-instruction-list').html(runtime.renderInstList(runtime.settings.instructionTemplates || []));
    });
    $d.off('click.tipage').on('click.tipage', '.theater-list-page', function () {
        const nav = this.closest('[data-list-kind]');
        const kind = nav.dataset.listKind;
        const next = requestedListPage(this.dataset.pageAction, kind === 'inst' ? runtime.instPage : runtime.histPage,
            Number(nav.dataset.pageCount), nav.querySelector('.theater-page-number').value);
        if (kind === 'inst') { runtime.instPage = next; runtime.refreshInstUI(); }
        else { runtime.resetHistorySelectionGesture(); runtime.histPage = next; runtime.refreshHistList(); }
    });
    $d.off('keydown.tipage').on('keydown.tipage', '.theater-page-number', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.closest('[data-list-kind]').querySelector('[data-page-action="jump"]').click();
    });
    $d.off('change.ticb').on('change.ticb', '.theater-inst-checkbox', function (e) {
        e.stopPropagation();
        const i = parseInt($(this).data('index'));
        runtime.setInstructionItemSelected(i, $(this).is(':checked'), $(this).closest('.theater-inst-item')[0]);
    });
    runtime.bindInstructionSweepSelection();
    $d.off('click.tisa').on('click.tisa', '#theater-inst-select-all-btn', runtime.selectAllVisible);
    $d.off('click.tibm').on('click.tibm', '#theater-inst-bulk-tags-btn', runtime.bulkEditSelectedTemplateTags);
    $d.off('click.tibd').on('click.tibd', '#theater-inst-bulk-delete-btn', runtime.bulkDeleteSelected);
    $d.off('click.tibc').on('click.tibc', '#theater-inst-bulk-clear-btn', runtime.clearInstSelection);

    // ---- Rules: Render templates ----
    $d.off('change.tr').on('change.tr', '#theater-render-select', function () {
        const v = $(this).val();
        $(this).find('[data-render-draft]').remove();
        runtime.settings.selectedRenderIndex = v; runtime.save();
        runtime.refreshRenderSelectionControls();
    });
    $d.off('click.tnewrender').on('click.tnewrender', '#theater-new-render-btn', () => {
        $('#theater-render-select').append('<option value="draft" data-render-draft>新模板 · 未保存</option>').val('draft');
        $('#theater-render-select [data-render-draft]').not(':last').remove();
        $('#theater-render-content').val('').trigger('input').trigger('focus');
        $('#theater-render-selection-hint').text('新模板');
        $('#theater-delete-render-btn').prop('disabled', true).find('span').text('删除模板');
    });
    $d.off('click.tsr').on('click.tsr', '#theater-save-render-btn', runtime.saveRenderTpl);
    $d.off('click.trenderdelete').on('click.trenderdelete', '#theater-delete-render-btn', runtime.deleteRenderTpl);


}
