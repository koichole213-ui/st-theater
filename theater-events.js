// theater-events: receives live state and cross-feature callbacks from index.js.
import { bookmarkPlacementFromPoint } from './result-bookmark.js';
import { LONG_DREAM_DRAFT_STATUS, LONG_DREAM_WORLD_LINE_RELATION, LONG_DREAM_WORLD_BOOK_POLICY, createLongDreamRecord, LONG_DREAM_STATUS, LONG_DREAM_MEMORY_STATUS, prepareLongDreamMemoryRegeneration, updateLongDreamMemoryV2RecordItem, setLongDreamMemoryV2RecordItemHidden, rejectLongDreamMemoryV2RecordItem, resolveLongDreamMemoryV2RecordConflict, updateLongDreamMemoryCard, setLongDreamMemoryCardStatus, updateLongDreamDefinition } from './long-dream.js';
import { LONG_DREAM_CANON_SUGGESTION_CATEGORIES, composeLongDreamCanon } from './long-dream-canon-suggestions.js';
import { normalizeManualTarget } from './length-policy.js';
import { syncFollowedWorldBooks } from './world-book-policy.js';
import { normalizeContextRange } from './context-policy.js';
import { withPreservedPopupViewport } from './popup-lifecycle.js';
import { itemTags, TAG_UNCATEGORIZED } from './tag-system.js';
import { requestedListPage } from './pagination.js';
import { isTextOutputMode, textThemeForOutputMode } from './plain-text-renderer.js';
import { createHtmlTextEdit } from './result-text-edit.js';
import { displayedContinuationVersion } from './continuation-session.js';
import { SKIN_LABELS } from './theater-defaults.js';
import { LONG_DREAM_MEMORY_BUILTIN_PRESET_ID, createLongDreamMemoryPreset, normalizeLongDreamMemoryPresetList, MAX_LONG_DREAM_MEMORY_PRESET_BYTES, parseLongDreamMemoryPreset, exportLongDreamMemoryPreset } from './long-dream-memory-presets.js';
import { normalizeMaxTokens } from './api-client.js';
import { normalizeContextExclusionRules } from './context-exclusions.js';
import { normalizeApiPresetList, MAX_API_PRESETS, createApiPresetFromConfig } from './api-presets.js';
import { getRuntimeLogEntries, formatRuntimeLogs, clearRuntimeLogs } from './runtime-log.js';
import { REQUEST_DIAGNOSTIC_SIGNAL } from './request-diagnostics.js';

export function createTheaterEvents(runtime) {
// @theater-source-begin bindEvents
function bindEvents() {
    const $d = $(document);
    // 恢复入口最先绑定。即使后续某个功能按钮初始化异常，用户仍能拉取修复。
    $d.off('click.tup').on('click.tup', '#theater-update-btn', runtime.updateExtension);
    $d.off('click.treload').on('click.treload', '#theater-reload-after-update-btn', runtime.confirmReloadAfterUpdate);
    const tokenAffectingSelectors = '#theater-context-range,#theater-read-chat-context,#theater-render-select,#theater-preset-name-select,#theater-style-addon,#theater-nsfw-addon,.theater-preset-check,.theater-wb-check';
    $d.off('change.ttoken').on('change.ttoken', tokenAffectingSelectors, runtime.scheduleTokenEstimate);

    // Tabs
    $d.off('click.tt').on('click.tt', '.theater-tab', function () {
        runtime.activateTheaterTab($(this).data('tab'));
    });
    // ---- Generate ----
    $d.off('click.tg').on('click.tg', '#theater-generate-btn', runtime.generateTheater);
    $d.off('click.tstop').on('click.tstop', '#theater-stop-btn', runtime.stopGeneration);
    $d.off('click.tquickrender').on('click.tquickrender', '#theater-quick-render-toggle', runtime.switchQuickRenderSelection);
    let bookmarkDragged = false;
    let bookmarkDrag = null;
    $d.off('pointerdown.trad').on('pointerdown.trad', '.theater-result-toolbox.is-bookmark .theater-result-actions-toggle', function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        const toolbox = this.closest('.theater-result-toolbox');
        const rect = toolbox.getBoundingClientRect();
        bookmarkDragged = false;
        bookmarkDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            toolbox,
        };
        this.setPointerCapture?.(event.pointerId);
    });
    $d.off('pointermove.trad').on('pointermove.trad', function (event) {
        if (!bookmarkDrag || bookmarkDrag.pointerId !== event.pointerId) return;
        const dx = event.clientX - bookmarkDrag.startX;
        const dy = event.clientY - bookmarkDrag.startY;
        if (!bookmarkDragged && Math.hypot(dx, dy) < 5) return;
        bookmarkDragged = true;
        runtime.closeResultActions();
        bookmarkDrag.toolbox.classList.add('is-dragging');
        bookmarkDrag.toolbox.style.left = `${event.clientX - bookmarkDrag.offsetX}px`;
        bookmarkDrag.toolbox.style.top = `${event.clientY - bookmarkDrag.offsetY}px`;
        event.preventDefault();
    });
    $d.off('pointerup.trad pointercancel.trad').on('pointerup.trad pointercancel.trad', function (event) {
        if (!bookmarkDrag || bookmarkDrag.pointerId !== event.pointerId) return;
        const toolbox = bookmarkDrag.toolbox;
        toolbox.classList.remove('is-dragging');
        if (bookmarkDragged) {
            const placement = bookmarkPlacementFromPoint({ rect: runtime.resultBookmarkRect(), x: event.clientX, y: event.clientY });
            runtime.settings.resultBookmarkSide = placement.side;
            runtime.settings.resultBookmarkYRatio = placement.yRatio;
            runtime.save();
            runtime.positionResultToolbox();
        }
        bookmarkDrag = null;
    });
    $d.off('click.tra').on('click.tra', '.theater-result-actions-toggle', function (event) {
        event.stopPropagation();
        if (bookmarkDragged) {
            bookmarkDragged = false;
            return;
        }
        const $toolbox = $(this).closest('.theater-result-toolbox');
        const open = !$toolbox.hasClass('is-open');
        runtime.closeResultActions();
        $toolbox.toggleClass('is-open', open);
        $(this).attr('aria-expanded', String(open));
    });
    $d.off('click.trac').on('click.trac', '.theater-result-actions .theater-btn', function () {
        const $toolbox = $(this).closest('.theater-result-toolbox');
        $toolbox.removeClass('is-open').find('.theater-result-actions-toggle').attr('aria-expanded', 'false');
    });
    $d.off('click.trao').on('click.trao', function (event) {
        if ($(event.target).closest('.theater-result-toolbox').length) return;
        runtime.closeResultActions();
    });
    $(window).off('resize.tra').on('resize.tra', runtime.positionResultToolbox);
    $d.off('input.tii').on('input.tii', '#theater-instruction', function () {
        if (runtime.continuationSession) runtime.continuationSession.direction = String($(this).val() || '');
        runtime.settings.lastInstruction = $(this).val();
        if (!runtime.continueContext && String($(this).val()) !== runtime.activeInstructionContent) {
            runtime.settings.lastInstructionTags = [];
            runtime.setActiveInstructionTags([], '');
        }
        runtime.save(); runtime.scheduleTokenEstimate();
    });

    // ---- Long Dream ----
    $d.off('input.tdcompose change.tdcompose').on('input.tdcompose change.tdcompose', '#theater-dream-next-instruction,#theater-dream-next-title,#theater-dream-next-target', function () {
        runtime.rememberLongDreamComposerDraft();
        if (this.id === 'theater-dream-next-instruction') {
            runtime.refreshLongDreamMemorySelection();
            const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
            const hasWritingDraft = dream?.draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING;
            $('#theater-dream-clear-next-instruction').prop('disabled', hasWritingDraft || !String($(this).val() || '').trim());
        }
        runtime.scheduleLongDreamTokenEstimate();
    });
    $d.off('click.tdsection').on('click.tdsection', '[data-dream-section]', function () {
        if (runtime.longDreamChapterEditController) { toastr.info('章节正在重新排版，请完成后再切换'); return; }
        const section = String($(this).attr('data-dream-section') || 'works');
        if (!['definition', 'continue', 'works'].includes(section)) return;
        if (runtime.longDreamWorkspaceSection === 'continue') runtime.rememberLongDreamComposerDraft();
        if (section === 'continue' && runtime.activeLongDreamId === null) {
            toastr.info('请先在“作品”中选择或创建一部长梦');
        }
        runtime.longDreamWorkspaceSection = section;
        if (section === 'definition') runtime.longDreamView = runtime.activeLongDreamId === null ? 'create' : 'detail';
        if (section === 'works') {
            runtime.longDreamView = 'list';
            runtime.longDreamWorkLevel = 'list';
            runtime.activeLongDreamChapterId = null;
        }
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
    });
    $d.off('click.tdoptions').on('click.tdoptions', '[data-dream-options-toggle]', function () {
        const panel = document.getElementById('theater-dream-continuation-options');
        if (!panel) return;
        const open = panel.classList.toggle('open');
        $(this).attr('aria-expanded', String(open)).toggleClass('is-open', open);
    });
    $d.off('click.tdtokens keydown.tdtokens').on('click.tdtokens keydown.tdtokens', '#theater-dream-token-summary', function (event) {
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        if (event.type === 'keydown') event.preventDefault();
        const details = $('#theater-dream-token-details');
        const open = !details.is(':visible');
        details.toggle(open);
        $(this).attr('aria-expanded', String(open));
    });
    $d.off('click.tdnew').on('click.tdnew', '#theater-dream-new,[data-dream-new]', function () {
        runtime.resetLongDreamCanonSuggestions();
        runtime.longDreamWorkspaceSection = 'definition';
        runtime.longDreamView = 'create';
        runtime.activeLongDreamId = null;
        runtime.longDreamWorkLevel = 'list';
        runtime.activeLongDreamChapterId = null;
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
    });
    $d.off('click.tdimport').on('click.tdimport', '#theater-dream-import-backup', runtime.importLongDreamBackup);
    $d.off('click.tdexportall').on('click.tdexportall', '#theater-dream-export-all', function () {
        runtime.requestLongDreamExport(runtime.longDreamCache, 'all');
    });
    $d.off('click.tdback').on('click.tdback', '[data-dream-back]', function () {
        runtime.resetLongDreamCanonSuggestions();
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamView = 'list';
        runtime.activeLongDreamId = null;
        runtime.longDreamWorkLevel = 'list';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
    });
    $d.off('click.tdgen').on('click.tdgen', '[data-dream-go-generate]', function () {
        $('.theater-tab[data-tab="generate"]').click();
        $('.theater-panels-wrapper').scrollTop(0);
        document.getElementById('theater-instruction')?.focus({ preventScroll: true });
    });
    $d.off('change.tdsource').on('change.tdsource', '#theater-dream-source', function () {
        const source = runtime.resolveLongDreamSource($(this).val());
        if (!source) return;
        runtime.resetLongDreamCanonSuggestions();
        const instructionState = runtime.longDreamSourceInstructionState(source);
        $('#theater-dream-title').attr('placeholder', source.title || '未命名长梦');
        $('#theater-dream-canon').val(instructionState.instruction);
        $('#theater-dream-source-preview').html(runtime.longDreamSourcePreviewHTML(source));
        $('#theater-dream-source-hint')
            .removeClass('is-saved is-legacy is-missing')
            .addClass(instructionState.className)
            .text(instructionState.hint);
        runtime.refreshLongDreamCreateWorldBookState(source);
        runtime.renderLongDreamCanonSuggestions(source.key);
    });
    $d.off('click.tdrestorebooks').on('click.tdrestorebooks', '[data-dream-restore-source-world-books]', async function () {
        const source = runtime.resolveLongDreamSource($('#theater-dream-source').val());
        const sourceBooks = runtime.longDreamSourceWorldBooks(source);
        if (!sourceBooks.length) {
            toastr.info('这条历史记录没有保存当时的世界书信息');
            runtime.refreshLongDreamCreateWorldBookState(source);
            return;
        }
        const currentBooks = (runtime.settings.selectedWorldBooks || []).filter(Boolean);
        const currentText = currentBooks.length ? currentBooks.join('、') : '无';
        const ok = await SillyTavern.getContext().Popup.show.confirm(
            '恢复这条历史记录当时使用的世界书？',
            `素材页当前选择：${currentText}\n将替换为：${sourceBooks.join('、')}。不会修改世界书原文件或已有历史。`,
        );
        if (!ok) return;
        runtime.settings.selectedWorldBooks = [...sourceBooks];
        runtime.settings.followedWorldBooks = [];
        runtime.save();
        await runtime.loadWorldBookList();
        await runtime.reloadWorldBooks({ silent: true });
        runtime.refreshLongDreamCreateWorldBookState(source);
        toastr.success(`已恢复 ${sourceBooks.length} 本世界书，请核对条目后开卷`);
    });
    $d.off('click.tdopenbooks').on('click.tdopenbooks', '[data-dream-open-world-books]', function () {
        runtime.activateTheaterTab('setting');
        requestAnimationFrame(() => document.getElementById('theater-wb-books')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        toastr.info('请在“设定 → 世界书”中选择需要冻结的资料');
    });
    $d.off('click.tdcanonsuggest').on('click.tdcanonsuggest', '#theater-dream-canon-suggest', runtime.generateLongDreamCanonSuggestions);
    $d.off('input.tdcanoncontent').on('input.tdcanoncontent', '[data-dream-canon-suggestion-content]', function () {
        const id = $(this).closest('[data-dream-canon-suggestion-id]').attr('data-dream-canon-suggestion-id');
        const item = runtime.findLongDreamCanonSuggestion(id);
        if (item) item.content = String($(this).val() || '');
    });
    $d.off('change.tdcanoncategory').on('change.tdcanoncategory', '[data-dream-canon-suggestion-category]', function () {
        const id = $(this).closest('[data-dream-canon-suggestion-id]').attr('data-dream-canon-suggestion-id');
        const item = runtime.findLongDreamCanonSuggestion(id);
        if (item && LONG_DREAM_CANON_SUGGESTION_CATEGORIES.includes($(this).val())) item.category = $(this).val();
    });
    $d.off('click.tdcanonaction').on('click.tdcanonaction', '[data-dream-canon-suggestion-action]', function () {
        const card = $(this).closest('[data-dream-canon-suggestion-id]');
        const id = card.attr('data-dream-canon-suggestion-id');
        const item = runtime.findLongDreamCanonSuggestion(id);
        if (!item) return;
        const action = $(this).attr('data-dream-canon-suggestion-action');
        if (action === 'delete') {
            runtime.longDreamCanonSuggestionState.items = runtime.longDreamCanonSuggestionState.items.filter(candidate => candidate !== item);
        } else if (action === 'toggle') {
            item.content = String(card.find('[data-dream-canon-suggestion-content]').val() || '').trim();
            if (!item.content) {
                toastr.warning('这条建议是空的，请先修改内容或直接删除');
                return;
            }
            item.accepted = !item.accepted;
        }
        runtime.renderLongDreamCanonSuggestions();
    });
    $d.off('click.tdcreate').on('click.tdcreate', '#theater-dream-create-confirm', async function () {
        if (runtime.longDreamCanonSuggestionState.controller) {
            toastr.warning('请先等待 AI 建议完成，或点击“停止整理”');
            return;
        }
        const source = runtime.resolveLongDreamSource($('#theater-dream-source').val());
        if (!source) { toastr.warning('请选择一场小剧场作为第一章'); return; }
        const title = ($('#theater-dream-title').val() || '').trim() || source.title || '未命名长梦';
        if (!title) { toastr.warning('请给这部长梦起一个名字'); return; }
        const worldLineRelation = $('input[name="theater-dream-world-line-relation"]:checked').val() || LONG_DREAM_WORLD_LINE_RELATION.ISOLATED;
        const worldBookPolicy = worldLineRelation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED
            ? LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY
            : LONG_DREAM_WORLD_BOOK_POLICY.SELECTED;
        if (worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED && !(runtime.settings.selectedWorldBooks || []).filter(Boolean).length) {
            toastr.warning('当前没有选中的世界书，请先在【素材】中选择，或改用“以第一章和此梦设定为准”');
            return;
        }
        let worldBookSnapshot = null;
        if (worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED) {
            if (!runtime.wbEntries.some(entry => (runtime.settings.selectedWorldBooks || []).includes(entry.book))) {
                await runtime.reloadWorldBooks({ silent: true });
            }
            worldBookSnapshot = runtime.captureCurrentLongDreamWorldBooks(runtime.settings.selectedWorldBooks || []);
            if (!runtime.longDreamSnapshotEntryCount(worldBookSnapshot)) {
                toastr.warning('选中的世界书还没有可冻结的已勾选内容，请先在【素材】中检查条目');
                return;
            }
        }
        const canon = composeLongDreamCanon(
            $('#theater-dream-canon').val() || '',
            runtime.activeLongDreamCanonSuggestions(source.key),
        );
        const record = createLongDreamRecord({
            title,
            canon,
            worldBookPolicy,
            worldLineRelation,
            worldBookNames: runtime.settings.selectedWorldBooks || [],
            worldBookSnapshot,
            source,
            sourceConfig: source.sourceConfig || {},
        });
        const created = await runtime.longDreamAdd(record);
        if (!created) return;
        runtime.activeLongDreamId = created.id;
        runtime.longDreamView = 'detail';
        runtime.longDreamWorkspaceSection = 'continue';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
        toastr.success(`《${created.title}》已开卷`);
        runtime.resetLongDreamCanonSuggestions({ abort: false });
    });
    $d.off('click.tdexportone').on('click.tdexportone', '[data-dream-export-one]', function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const dream = runtime.longDreamCache.find(item => String(item.id) === String($(this).data('id')));
        if (dream) runtime.requestLongDreamExport([dream], 'single');
    });
    $d.off('click.tdopen keydown.tdopen').on('click.tdopen keydown.tdopen', '[data-dream-open-work]', function (event) {
        if ($(event.target).closest('[data-dream-export-one]').length) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        if (event.type === 'keydown') event.preventDefault();
        runtime.activeLongDreamId = $(this).data('id');
        runtime.longDreamView = 'detail';
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
    });
    $d.off('click.tdexport').on('click.tdexport', '#theater-dream-export-current', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        if (dream) runtime.requestLongDreamExport([dream], 'single');
    });
    $d.off('click.tdcomplete').on('click.tdcomplete', '#theater-dream-complete', function () {
        runtime.setCurrentLongDreamStatus(LONG_DREAM_STATUS.COMPLETE);
    });
    $d.off('click.tdreopen').on('click.tdreopen', '#theater-dream-reopen', function () {
        runtime.setCurrentLongDreamStatus(LONG_DREAM_STATUS.ACTIVE);
    });
    $d.off('click.tdreadchapter').on('click.tdreadchapter', '[data-dream-read-chapter]', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const chapter = dream?.chapters?.find(item => String(item.id) === String($(this).data('chapter-id')));
        runtime.readLongDreamChapter(chapter);
    });
    $d.off('click.tdworkback').on('click.tdworkback', '[data-dream-work-back]', function () {
        if (runtime.longDreamChapterEditController) { toastr.info('章节正在重新排版，请完成后再返回'); return; }
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamView = 'list';
        runtime.longDreamWorkLevel = 'list';
        runtime.activeLongDreamId = null;
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
    });
    $d.off('click.tdopenchapter').on('click.tdopenchapter', '[data-dream-open-chapter]', function () {
        if (runtime.longDreamChapterEditController) { toastr.info('章节正在重新排版，请完成后再打开其他章节'); return; }
        runtime.activeLongDreamChapterId = $(this).attr('data-chapter-id');
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamView = 'detail';
        runtime.longDreamWorkLevel = 'chapter';
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
    });
    $d.off('click.tdchapterback').on('click.tdchapterback', '[data-dream-chapter-back]', function () {
        if (runtime.longDreamChapterEditController) { toastr.info('章节正在重新排版，请完成后再返回'); return; }
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamView = 'detail';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
    });
    const closeLongDreamChapterTools = () => {
        $('#theater-dream-chapter-tools-panel').prop('hidden', true);
        $('#theater-dream-chapter-tools-toggle').attr('aria-expanded', 'false');
    };
    $d.off('click.tdchaptertooltoggle').on('click.tdchaptertooltoggle', '#theater-dream-chapter-tools-toggle', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const panel = document.getElementById('theater-dream-chapter-tools-panel');
        if (!panel) return;
        const open = panel.hasAttribute('hidden');
        panel.toggleAttribute('hidden', !open);
        $(this).attr('aria-expanded', String(open));
    });
    $d.off('click.tdchaptertoolaction').on('click.tdchaptertoolaction', '#theater-dream-chapter-tools-panel button', closeLongDreamChapterTools);
    $d.off('click.tdchaptertooloutside').on('click.tdchaptertooloutside', function (event) {
        if ($(event.target).closest('#theater-dream-chapter-tools-toggle,#theater-dream-chapter-tools-panel').length) return;
        closeLongDreamChapterTools();
    });
    $d.off('keydown.tdchaptertoolescape').on('keydown.tdchaptertoolescape', function (event) {
        if (event.key === 'Escape') closeLongDreamChapterTools();
    });
    $d.off('click.tdchapterread').on('click.tdchapterread', '#theater-dream-read-chapter-fullscreen', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const chapter = dream?.chapters?.find(item => String(item.id) === String(runtime.activeLongDreamChapterId));
        runtime.readLongDreamChapter(chapter);
    });
    $d.off('click.tdchapterexport').on('click.tdchapterexport', '#theater-dream-export-chapter', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const chapter = dream?.chapters?.find(item => String(item.id) === String(runtime.activeLongDreamChapterId));
        runtime.exportLongDreamChapter(dream, chapter);
    });
    $d.off('click.tdchaptersave').on('click.tdchaptersave', '#theater-dream-save-chapter', runtime.saveLongDreamChapterEdits);
    $d.off('click.tdchapteraction').on('click.tdchapteraction', '[data-dream-chapter-action]', function (event) {
        event.preventDefault();
        event.stopPropagation();
        runtime.handleLongDreamChapterAction(
            String($(this).attr('data-dream-chapter-action') || ''),
            $(this).attr('data-chapter-id'),
        );
    });
    $d.off('click.tdnext').on('click.tdnext', '#theater-dream-generate-next', runtime.generateNextLongDreamChapter);
    $d.off('click.tdstop').on('click.tdstop', '#theater-dream-stop-generation', function () {
        if (runtime.getLongDreamGenerationController().abort()) {
            $('#theater-dream-generation-label').text('正在停止并保存当前草稿……');
            $(this).prop('disabled', true);
        }
    });
    $d.off('click.tdprogressview').on('click.tdprogressview', '[data-dream-progress-view]', function () {
        const view = String($(this).attr('data-dream-progress-view') || 'live');
        $('[data-dream-progress-view]').removeClass('active').attr('aria-selected', 'false');
        $(this).addClass('active').attr('aria-selected', 'true');
        $('[data-dream-progress-pane]').removeClass('active').prop('hidden', true);
        $(`[data-dream-progress-pane="${view}"]`).addClass('active').prop('hidden', false);
    });
    $d.off('click.tdprogressfullscreen').on('click.tdprogressfullscreen', '#theater-dream-progress-candidate-fullscreen', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const candidates = Array.isArray(dream?.draft?.candidates) ? dream.draft.candidates : [];
        const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(Number(dream?.draft?.selectedCandidateIndex) || 0)));
        const candidate = candidates[index];
        if (!candidate) return;
        runtime.openFullscreenReader({
            title: `${dream.title} · ${dream.draft.title} · 第 ${candidate.versionNumber || index + 1} 版`,
            html: candidate.html,
            mode: candidate.mode || 'html',
            text: candidate.text,
        });
    });
    $d.off('click.tdkeepcandidate').on('click.tdkeepcandidate', '#theater-dream-keep-candidate', runtime.keepLongDreamCandidate);
    $d.off('click.tdkeptpick').on('click.tdkeptpick', '[data-dream-kept-pick]', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        if (dream?.draft) runtime.changeLongDreamDraftCandidate(Number(this.dataset.dreamKeptPick) - dream.draft.selectedCandidateIndex);
    });
    $d.off('click.tdretainedversion').on('click.tdretainedversion', '[data-dream-retained-read], [data-dream-retained-export]', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const chapter = dream?.chapters?.find(item => String(item.id) === String(runtime.activeLongDreamChapterId));
        if (!chapter) return;
        const exporting = this.hasAttribute('data-dream-retained-export');
        const index = Number(exporting ? this.dataset.dreamRetainedExport : this.dataset.dreamRetainedRead);
        const version = [chapter, ...(chapter.retainedVersions || [])][index];
        if (!version) return;
        const reading = { ...version, number: chapter.number, title: `${version.title || chapter.title} · 第 ${version.versionNumber || index + 1} 版` };
        if (exporting) runtime.exportLongDreamChapter(dream, reading);
        else runtime.readLongDreamChapter(reading);
    });
    $d.off('click.tdconfirm').on('click.tdconfirm', '#theater-dream-confirm-chapter', runtime.confirmLongDreamChapter);
    $d.off('click.tddiscard').on('click.tddiscard', '#theater-dream-discard-draft', runtime.discardLongDreamDraft);
    $d.off('click.tdclearinstruction').on('click.tdclearinstruction', '#theater-dream-clear-next-instruction', async function () {
        const input = $('#theater-dream-next-instruction');
        if (!input.length || !String(input.val() || '').trim()) return;
        const ok = await SillyTavern.getContext().Popup.show.confirm(
            '确定清空本章续写指令？',
            '只会清空输入框，不会删除已有章节、草稿或梦脉。',
        );
        if (!ok) return;
        input.val('');
        runtime.rememberLongDreamComposerDraft();
        runtime.refreshLongDreamMemorySelection();
        runtime.scheduleLongDreamTokenEstimate();
        $(this).prop('disabled', true);
        toastr.info('本章续写指令已清空');
    });
    $d.off('click.tdregenerate').on('click.tdregenerate', '#theater-dream-regenerate-draft', runtime.regenerateLongDreamDraft);
    $d.off('click.tdrevise').on('click.tdrevise', '#theater-dream-revise-draft', () => runtime.regenerateLongDreamDraft({ edit: true }));
    $d.off('click.tdcandidate').on('click.tdcandidate', '[data-dream-candidate-step]', function () {
        runtime.changeLongDreamDraftCandidate(Number($(this).attr('data-dream-candidate-step')) || 0);
    });
    $d.off('click.tdweave').on('click.tdweave', '#theater-dream-weave-now', function () {
        runtime.queueLongDreamMemoryWeave(runtime.activeLongDreamId, { force: true, announce: true });
    });
    $d.off('click.tdmemoryregenerate').on('click.tdmemoryregenerate', '[data-dream-memory-regenerate]', async function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        if (!dream?.chapters?.length) return;
        if (dream.memory?.status === LONG_DREAM_MEMORY_STATUS.WEAVING) {
            toastr.warning('梦脉正在织录，请完成后再重新生成');
            return;
        }
        if (!runtime.selectedLongDreamMemoryApiPreset()) {
            toastr.warning('请先在【设置 → API 与输出 → 梦脉织录】绑定一个副 API 预设');
            return;
        }
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            '重新生成整部梦脉？',
            `将重新读取全部 ${dream.chapters.length} 章已确认正文，清理自动织录结果并从第一章重新生成。你手动保存、隐藏或否定过的内容会保留。`,
        );
        if (!confirmed) return;
        const saved = await runtime.longDreamPut(prepareLongDreamMemoryRegeneration(dream));
        if (!saved) return;
        runtime.renderLongDreamPanel();
        toastr.info('已准备重新生成整部梦脉');
        runtime.queueLongDreamMemoryWeave(saved.id, { force: true, announce: true });
    });
    $d.off('click.tdmemoryopen').on('click.tdmemoryopen', '[data-dream-memory-open-editor]', function () {
        const root = $(this).closest('.theater-dream-memory-flow');
        const editorKey = String($(this).attr('data-dream-memory-editor-key') || '');
        const template = root.find('[data-dream-memory-editor-template]').filter(function () {
            return String($(this).attr('data-dream-memory-editor-template')) === editorKey;
        }).get(0);
        const dialog = root.find('[data-dream-memory-editor]').get(0);
        if (!template || !dialog) return;
        $(dialog).find('[data-dream-memory-editor-title]').text($(this).attr('data-dream-memory-editor-title') || '编辑梦脉');
        $(dialog).find('[data-dream-memory-editor-meta]').text($(this).attr('data-dream-memory-editor-meta') || '梦脉');
        $(dialog).find('[data-dream-memory-editor-content]').html(template.innerHTML);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    });
    $d.off('click.tdmemoryclose').on('click.tdmemoryclose', '[data-dream-memory-close-editor]', function () {
        const dialog = $(this).closest('[data-dream-memory-editor]').get(0);
        if (typeof dialog?.close === 'function') dialog.close();
        else dialog?.removeAttribute('open');
    });
    $d.off('click.tdmemorybackdrop').on('click.tdmemorybackdrop', '[data-dream-memory-editor]', function (event) {
        if (event.target !== this) return;
        if (typeof this.close === 'function') this.close();
        else this.removeAttribute('open');
    });
    $d.off('click.tdmemorysummary').on('click.tdmemorysummary', '[data-dream-memory-state-toggle]', function () {
        const summary = $(this).closest('.theater-dream-memory-state-editor').find('.theater-dream-memory-current-state-readonly');
        const clamped = summary.toggleClass('is-clamped').hasClass('is-clamped');
        $(this).text(clamped ? '展开' : '收起').attr('aria-expanded', clamped ? 'false' : 'true');
    });
    $d.off('click.tdmemoryfilter').on('click.tdmemoryfilter', '[data-dream-memory-filter]', function () {
        const filter = String($(this).attr('data-dream-memory-filter') || 'all');
        const root = $(this).closest('.theater-dream-memory-flow');
        root.find('[data-dream-memory-filter]').each(function () {
            const active = String($(this).attr('data-dream-memory-filter')) === filter;
            $(this).toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
        });
        root.find('[data-dream-memory-flow-kind]').each(function () {
            this.hidden = filter !== 'all' && String($(this).attr('data-dream-memory-flow-kind')) !== filter;
        });
    });
    $d.off('click.tdmemoryv2').on('click.tdmemoryv2', '[data-dream-memory-v2-action]', async function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const card = $(this).closest('[data-dream-memory-v2-id]');
        const itemId = card.attr('data-dream-memory-v2-id');
        const kind = card.attr('data-dream-memory-v2-kind');
        const action = String($(this).attr('data-dream-memory-v2-action') || '');
        if (!dream || !itemId || !kind) return;
        if (dream.memory?.status === LONG_DREAM_MEMORY_STATUS.WEAVING) { toastr.warning('梦脉正在织录，请完成后再修改'); return; }
        try {
            let updated;
            if (action === 'save') {
                const changes = runtime.longDreamMemoryV2Fields(card, kind);
                if (kind === 'thread') {
                    if (changes.status === 'resolved' && !String(changes.resolution || '').trim()) {
                        toastr.warning('请填写这件事项的解决结果');
                        return;
                    }
                    if (changes.status === 'abandoned' && !String(changes.abandonedReason || '').trim()) {
                        toastr.warning('请填写放弃或失效的原因');
                        return;
                    }
                    if (['resolved', 'abandoned'].includes(changes.status)) changes.resolvedAt = dream.chapters.length;
                    else {
                        changes.resolvedAt = null;
                        changes.resolution = '';
                        changes.abandonedReason = '';
                    }
                }
                updated = updateLongDreamMemoryV2RecordItem(dream, kind, itemId, changes);
            } else if (action === 'unlock') {
                updated = updateLongDreamMemoryV2RecordItem(dream, kind, itemId, { lockedByUser: false });
            } else if (action === 'resolve') {
                const resolution = prompt('这件事在故事中怎样得到了解决？');
                if (resolution === null || !String(resolution).trim()) return;
                updated = updateLongDreamMemoryV2RecordItem(dream, kind, itemId, { status: 'resolved', resolvedAt: dream.chapters.length, resolution, abandonedReason: '' });
            } else if (action === 'abandon') {
                const abandonedReason = prompt('故事中明确取消、失效或不再继续的原因是什么？');
                if (abandonedReason === null || !String(abandonedReason).trim()) return;
                updated = updateLongDreamMemoryV2RecordItem(dream, kind, itemId, { status: 'abandoned', resolvedAt: dream.chapters.length, abandonedReason, resolution: '' });
            } else if (action === 'reopen') {
                if (!confirm('重新开启这项已结束事项吗？它会重新进入后续梦脉检索。')) return;
                updated = updateLongDreamMemoryV2RecordItem(dream, kind, itemId, { status: 'open', resolvedAt: null, resolution: '', abandonedReason: '' });
            } else if (action === 'hide' || action === 'show') {
                updated = setLongDreamMemoryV2RecordItemHidden(dream, kind, itemId, action === 'hide');
            } else if (action === 'reject') {
                if (!confirm('确认这是一条错误记忆吗？它会从有效梦脉中移除，并阻止同一错误直接复活。')) return;
                updated = rejectLongDreamMemoryV2RecordItem(dream, kind, itemId, '用户在梦脉界面确认提取错误');
            } else return;
            const saved = await runtime.longDreamPut(updated);
            if (!saved) return;
            runtime.renderLongDreamPanel();
            const messages = {
                save: '梦脉已保存', unlock: '这条梦脉已交还自动更新', reject: '错误梦脉已否定并建立抑制记录',
                hide: '这条梦脉不会进入续章请求', show: '这条梦脉已恢复注入', resolve: '事项已标记为解决',
                abandon: '事项已标记为放弃', reopen: '事项已重新开启',
            };
            toastr.success(messages[action] || '梦脉已更新');
        } catch (error) {
            toastr.warning(error?.message || String(error));
        }
    });
    $d.off('click.tdsummary').on('click.tdsummary', '[data-dream-summary-refresh]', () => runtime.confirmLongDreamSummaryAction(runtime.activeLongDreamId));
    $d.off('click.tdsummarypreview').on('click.tdsummarypreview', '[data-dream-summary-preview]', function () { runtime.toggleLongDreamSummaryPreview(this); });
    $d.off('click.tdsummaryrestore').on('click.tdsummaryrestore', '[data-dream-summary-restore]', function () {
        return runtime.confirmLongDreamSummaryAction(runtime.activeLongDreamId, String($(this).attr('data-dream-summary-restore')));
    });
    $d.off('click.tdmemoryconflict').on('click.tdmemoryconflict', '[data-dream-memory-conflict-action]', async function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const card = $(this).closest('[data-dream-memory-conflict]');
        const conflictId = card.attr('data-dream-memory-conflict');
        const action = String($(this).attr('data-dream-memory-conflict-action') || 'keep');
        if (!dream || !conflictId) return;
        try {
            const saved = await runtime.longDreamPut(resolveLongDreamMemoryV2RecordConflict(dream, conflictId, action));
            if (!saved) return;
            runtime.renderLongDreamPanel();
            if (action === 'reweave') {
                toastr.info('已保留有效梦脉，将从正文重新补织缺失记录');
                runtime.queueLongDreamMemoryWeave(saved.id, { force: true, announce: true });
            } else {
                toastr.success(action === 'accept' ? '已采用新章节带来的变化' : '已保留原记忆并否定这次变化');
                if (!saved.memory.pendingConflicts.length && !saved.memory.pendingChapterNumbers.length) await runtime.refreshLongDreamSummaryNow(saved.id, { fillMissing: true });
            }
        } catch (error) {
            toastr.warning(error?.message || String(error));
        }
    });
    $d.off('click.tdmemoryaction').on('click.tdmemoryaction', '[data-dream-memory-action]', async function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const card = $(this).closest('[data-dream-memory-card]');
        const cardId = card.attr('data-dream-memory-card');
        const action = String($(this).attr('data-dream-memory-action') || '');
        if (!dream || !cardId) return;
        if (dream.memory?.status === LONG_DREAM_MEMORY_STATUS.WEAVING) { toastr.warning('梦脉正在织录，请完成后再修改'); return; }
        try {
            const updated = action === 'save'
                ? updateLongDreamMemoryCard(dream, cardId, {
                    type: card.find('[data-dream-memory-type]').val(),
                    key: card.find('[data-dream-memory-key]').val(),
                    content: card.find('[data-dream-memory-content]').val(),
                    tags: runtime.longDreamMemoryTags(card.find('[data-dream-memory-tags]').val()),
                })
                : setLongDreamMemoryCardStatus(dream, cardId, action === 'dismiss' ? 'dismissed' : 'active');
            const saved = await runtime.longDreamPut(updated);
            if (!saved) return;
            runtime.renderLongDreamPanel();
            toastr.success(action === 'save' ? '梦脉修改已保存' : (action === 'dismiss' ? '这条梦脉已废止，可随时恢复' : '这条梦脉已恢复有效'));
        } catch (error) {
            toastr.warning(error?.message || String(error));
        }
    });
    $d.off('click.tdreviewfullscreen').on('click.tdreviewfullscreen', '#theater-dream-review-fullscreen', function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        const draft = dream?.draft;
        if (draft?.status !== LONG_DREAM_DRAFT_STATUS.REVIEW) return;
        runtime.openFullscreenReader({
            title: `${dream.title} · ${draft.title}`,
            html: draft.html,
            mode: draft.mode || 'html',
            text: draft.text,
        });
    });
    $d.off('click.tdreloadwb');
    $d.off('click.tdrefreshwb').on('click.tdrefreshwb', '#theater-dream-refresh-world-book', runtime.refreshLongDreamWorldBookSources);
    $d.off('click.tdsave').on('click.tdsave', '#theater-dream-save-definition', async function () {
        if (String(runtime.refreshingLongDreamWorldBookId) === String(runtime.activeLongDreamId)) {
            toastr.info('请等世界书更新完成后再保存定梦设置');
            return;
        }
        if (String(runtime.activeLongDreamGenerationId) === String(runtime.activeLongDreamId) && runtime.longDreamGenerationController?.active) {
            toastr.warning('请先完成或停止当前章节生成');
            return;
        }
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        if (!dream) return;
        if (dream.draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW) {
            toastr.warning('请先确认或放弃待确认章节，再修改长梦设置');
            return;
        }
        const worldLineRelation = $('input[name="theater-dream-edit-relation"]:checked').val() || LONG_DREAM_WORLD_LINE_RELATION.ISOLATED;
        const worldBookPolicy = worldLineRelation === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED
            ? LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY
            : LONG_DREAM_WORLD_BOOK_POLICY.SELECTED;
        const inheritedBookNames = dream.inheritance?.worldBookNames?.length
            ? dream.inheritance.worldBookNames
            : (runtime.settings.selectedWorldBooks || []);
        if (worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED && !inheritedBookNames.filter(Boolean).length) {
            toastr.warning('当前没有可沿用的世界书，请先在【素材】中选择');
            return;
        }
        let worldBookSnapshot = dream.inheritance?.snapshot || null;
        if (worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED && !worldBookSnapshot) {
            if (!runtime.wbEntries.some(entry => inheritedBookNames.includes(entry.book))) {
                await runtime.reloadWorldBooks({ silent: true });
            }
            worldBookSnapshot = runtime.captureCurrentLongDreamWorldBooks(inheritedBookNames);
            if (!runtime.longDreamSnapshotEntryCount(worldBookSnapshot)) {
                toastr.warning('这些世界书还没有可冻结的已勾选内容，请先在【素材】中检查条目');
                return;
            }
        }
        const updated = updateLongDreamDefinition(dream, {
            title: $('#theater-dream-edit-title').val(),
            canon: $('#theater-dream-edit-canon').val(),
            worldBookPolicy,
            worldLineRelation,
            worldBookNames: inheritedBookNames,
            worldBookSnapshot,
        });
        const saved = await runtime.longDreamPut(updated);
        if (!saved) return;
        runtime.renderLongDreamPanel();
        toastr.success('此梦设定已保存');
    });
    $d.off('click.tddelete').on('click.tddelete', '#theater-dream-delete', async function () {
        if (String(runtime.activeLongDreamGenerationId) === String(runtime.activeLongDreamId) && runtime.longDreamGenerationController?.active) {
            toastr.warning('请先完成或停止当前章节生成');
            return;
        }
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        if (!dream) return;
        if (dream.draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW) {
            toastr.warning('请先确认或放弃待确认章节，再删除长卷');
            return;
        }
        const ok = await SillyTavern.getContext().Popup.show.confirm(`删除《${dream.title}》？`, '整部长卷和其中的章节都会删除，普通历史不会受影响。');
        if (!ok) return;
        if (!(await runtime.longDreamDelete(dream.id))) return;
        runtime.clearLongDreamComposerDraft(dream.id, { forgetTarget: true });
        runtime.longDreamView = 'list';
        runtime.activeLongDreamId = null;
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamWorkLevel = 'list';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        toastr.success('长卷已删除');
    });
    $d.off('change.tmt').on('change.tmt', '#theater-manual-target-enabled', function () {
        runtime.settings.manualTargetEnabled = this.checked;
        $('#theater-manual-target-control').toggleClass('is-enabled', this.checked);
        $('#theater-manual-target-chars').prop('disabled', !this.checked);
        $('#theater-manual-target-state').text(this.checked ? `约 ${normalizeManualTarget($('#theater-manual-target-chars').val())} 字` : '默认关闭');
        runtime.save(); runtime.scheduleTokenEstimate();
    });
    $d.off('change.tmti').on('change.tmti', '#theater-manual-target-chars', function () {
        runtime.settings.manualTargetChars = normalizeManualTarget(this.value);
        this.value = runtime.settings.manualTargetChars;
        if (runtime.settings.manualTargetEnabled) $('#theater-manual-target-state').text(`约 ${runtime.settings.manualTargetChars} 字`);
        runtime.save(); runtime.scheduleTokenEstimate();
    });
    $('#theater-manual-target-control').off('toggle.tmtd').on('toggle.tmtd', function () {
        runtime.settings.manualTargetPanelOpen = this.open;
        runtime.save();
    });
    $d.off('click.ttsum').on('click.ttsum', '#theater-token-summary', function () { $('#theater-token-details').toggle(); });

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
        runtime.settings.selectedRenderIndex = v; runtime.save();
        runtime.refreshRenderSelectionControls();
    });
    $d.off('click.tsr').on('click.tsr', '#theater-save-render-btn', runtime.saveRenderTpl);
    $d.off('click.trenderdelete').on('click.trenderdelete', '#theater-delete-render-btn', runtime.deleteRenderTpl);

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
        const target = runtime.currentGenerationResult?.html === snapshot.html ? runtime.currentGenerationResult : runtime.recentCache.find(item => item.html === snapshot.html);
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
        const version = displayedContinuationVersion(runtime.continuationSession, snapshot.html);
        if (version) Object.assign(version, { html: newHtml, text, mode: newMode, continuationRounds: [text] });
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
    $d.off('input.thsearch').on('input.thsearch', '#theater-history-search', function () { runtime.historyQuery = this.value; runtime.histPage = 0; runtime.histSelected.clear(); runtime.refreshHistList(); });
    $d.off('click.thclearsearch').on('click.thclearsearch', '#theater-history-clear-search', () => { runtime.historyQuery = ''; runtime.histPage = 0; runtime.histSelected.clear(); $('#theater-history-search').val('').trigger('focus'); runtime.refreshHistList(); });
    $d.off('click.thnewfolder').on('click.thnewfolder', '#theater-history-new-folder', () => runtime.organizeHistory('new'));
    $d.off('click.thcollection').on('click.thcollection', '[data-collection-action]', function () { runtime.organizeHistory(this.dataset.collectionAction, this.dataset.collectionId, this); });
    $d.off('change.thcollectionversion').on('change.thcollectionversion', '[data-collection-version]', function () { runtime.historyVersionSelection.set(this.dataset.collectionVersion, this.value); runtime.refreshHistList(); });
    $d.off('click.thv').on('click.thv', '.theater-history-view', function () {
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
    $d.off('click.thfilter').on('click.thfilter', '#theater-history-tag-filter', async function () {
        const chosen = await runtime.chooseTags({ title: '筛选保存的小剧场', selected: runtime.settings.historyTagFilter, allowUncategorized: true });
        if (chosen === null) return;
        runtime.settings.historyTagFilter = chosen;
        runtime.histPage = 0;
        runtime.histSelected.clear();
        runtime.save(); runtime.refreshHistList(); runtime.refreshTagControls();
        if (runtime.histBatchMode) runtime.enterHistBatchMode();
    });
    $d.off('click.teah').on('click.teah', '#theater-export-all-history', runtime.requestHistoryExport);
    $d.off('click.tih').on('click.tih', '#theater-import-history-btn', runtime.importHistoryBackup);
    $d.off('click.thbe').on('click.thbe', '#theater-hist-batch-enter', function () {
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
        if ($(event.target).closest('.theater-history-actions, .theater-hist-checkbox').length) return;
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
        if ($(event.target).closest('.theater-history-actions, .theater-hist-checkbox, button, a, input, textarea, select').length) return;
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
        if ($(event.target).closest('.theater-history-actions, .theater-hist-checkbox, button, a, input, textarea, select').length) return;
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

    // ---- Config ----
    $d.off('click.tamodeswitch').on('click.tamodeswitch', '[data-theater-api-mode]', function () {
        const mode = $(this).data('theater-api-mode') === 'main' ? 'main' : 'custom';
        $('#theater-api-mode').val(mode).trigger('change');
    });
    $d.off('change.tamode').on('change.tamode', '#theater-api-mode', function () {
        runtime.settings.apiMode = $(this).val();
        $('#theater-custom-api-area').toggle(runtime.settings.apiMode !== 'main');
        $('[data-theater-api-mode]').removeClass('active').attr('aria-pressed', 'false')
            .filter(`[data-theater-api-mode="${runtime.settings.apiMode}"]`).addClass('active').attr('aria-pressed', 'true');
        runtime.save();
    });
    $d.off('change.tdmemoryapi').on('change.tdmemoryapi', '#theater-dream-memory-api-preset', function () {
        runtime.settings.longDreamMemoryApiPresetId = $(this).val() || '';
        runtime.save();
        runtime.refreshApiPresetControls();
        if (runtime.settings.longDreamMemoryApiPresetId) {
            runtime.longDreamCache.forEach(dream => runtime.queueLongDreamMemoryWeave(dream.id));
            toastr.success('梦脉织录副 API 已绑定');
        } else {
            toastr.info('自动梦脉织录已暂停；待织录章节不会丢失');
        }
    });
    $d.off('change.tdmemorybatch').on('change.tdmemorybatch', '#theater-dream-memory-batch-size', function () {
        runtime.settings.longDreamMemoryBatchSize = [1, 3, 5].includes(Number(this.value)) ? Number(this.value) : 3;
        this.value = runtime.settings.longDreamMemoryBatchSize;
        runtime.save();
        runtime.refreshApiPresetControls();
        runtime.longDreamCache.forEach(dream => runtime.queueLongDreamMemoryWeave(dream.id));
    });
    $d.off('change.tdmemoryanalysispreset').on('change.tdmemoryanalysispreset', '#theater-dream-memory-analysis-preset', function () {
        runtime.settings.longDreamMemoryPresetId = String($(this).val() || LONG_DREAM_MEMORY_BUILTIN_PRESET_ID);
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
    });
    $d.off('input.tdmemoryprompt').on('input.tdmemoryprompt', '#theater-dream-memory-prompt', function () {
        const preset = runtime.selectedLongDreamMemoryAnalysisPreset();
        if (preset.builtin) return;
        const focusPrompt = String($(this).val() || '').slice(0, 50000);
        runtime.settings.longDreamMemoryPresets = runtime.longDreamMemoryAnalysisPresets().map(item => item.id === preset.id ? { ...item, focusPrompt } : item);
        runtime.settings.longDreamMemoryPrompt = focusPrompt;
        runtime.save();
    });
    $d.off('click.tdmemorypresetcopy').on('click.tdmemorypresetcopy', '#theater-copy-dream-memory-preset', async function () {
        const source = runtime.selectedLongDreamMemoryAnalysisPreset();
        const name = await runtime.askNewItemName('给新的梦脉分析预设起个名字：', source.builtin ? '我的梦脉侧重点' : `${source.name} 副本`);
        if (name === null || !String(name).trim()) return;
        const author = prompt('作者名（可留空）：', source.author || '') ?? '';
        const preset = createLongDreamMemoryPreset({ name, author, description: source.description, focusPrompt: source.focusPrompt });
        runtime.settings.longDreamMemoryPresets = normalizeLongDreamMemoryPresetList([...runtime.longDreamMemoryAnalysisPresets(), preset]);
        runtime.settings.longDreamMemoryPresetId = preset.id;
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
        toastr.success('已创建可编辑的梦脉预设副本');
    });
    $d.off('click.tdmemorypresetimport').on('click.tdmemorypresetimport', '#theater-import-dream-memory-preset', function () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                if (file.size > MAX_LONG_DREAM_MEMORY_PRESET_BYTES) throw new Error('梦脉预设文件过大');
                const preset = parseLongDreamMemoryPreset(await file.text());
                runtime.settings.longDreamMemoryPresets = normalizeLongDreamMemoryPresetList([...runtime.longDreamMemoryAnalysisPresets(), preset]);
                const imported = runtime.settings.longDreamMemoryPresets.find(item => item.id === preset.id)
                    || runtime.settings.longDreamMemoryPresets.slice().reverse().find(item => item.name.startsWith(preset.name));
                runtime.settings.longDreamMemoryPresetId = imported?.id || LONG_DREAM_MEMORY_BUILTIN_PRESET_ID;
                runtime.refreshLongDreamMemoryPresetControls();
                runtime.save();
                toastr.success(`已导入梦脉预设「${imported?.name || preset.name}」`);
            } catch (error) {
                toastr.warning(error?.message || String(error));
            }
        };
        input.click();
    });
    $d.off('click.tdmemorypresetexport').on('click.tdmemorypresetexport', '#theater-export-dream-memory-preset', function () {
        try {
            const preset = runtime.selectedLongDreamMemoryAnalysisPreset();
            const data = exportLongDreamMemoryPreset(preset);
            const filename = `${String(preset.name || '梦脉预设').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.json`;
            runtime.downloadFile(filename, JSON.stringify(data, null, 2), 'application/json');
            toastr.success('梦脉预设已导出；文件不包含 API 或长梦内容');
        } catch (error) {
            toastr.warning(error?.message || String(error));
        }
    });
    $d.off('click.tdmemorypresetdelete').on('click.tdmemorypresetdelete', '#theater-delete-dream-memory-preset', function () {
        const preset = runtime.selectedLongDreamMemoryAnalysisPreset();
        if (preset.builtin || !confirm(`删除梦脉预设「${preset.name}」吗？这不会删除已经生成的梦脉。`)) return;
        runtime.settings.longDreamMemoryPresets = runtime.longDreamMemoryAnalysisPresets().filter(item => item.id !== preset.id);
        runtime.settings.longDreamMemoryPresetId = LONG_DREAM_MEMORY_BUILTIN_PRESET_ID;
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
        toastr.success('梦脉预设已删除');
    });
    $d.off('click.tdmemorypromptreset').on('click.tdmemorypromptreset', '#theater-reset-dream-memory-prompt', function () {
        runtime.settings.longDreamMemoryPresetId = LONG_DREAM_MEMORY_BUILTIN_PRESET_ID;
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
        toastr.success('已切回“连续性梦脉 v2（完善版）”内置预设');
    });
    $d.off('change.tstream').on('change.tstream', '#theater-stream-enabled', function () {
        runtime.settings.streamEnabled = this.checked; runtime.save();
    });
    $d.off('change.tautocont').on('change.tautocont', '#theater-auto-continue', function () {
        runtime.settings.autoContinue = this.checked; runtime.save();
    });
    $d.off('change.tautorounds').on('change.tautorounds', '#theater-max-auto-rounds', function () {
        runtime.settings.maxAutoRounds = Math.min(10, Math.max(1, parseInt(this.value) || 3));
        this.value = runtime.settings.maxAutoRounds;
        runtime.save();
    });
    $d.off('change.tmaxtokens').on('change.tmaxtokens', '#theater-max-output-tokens', function () {
        runtime.settings.maxOutputTokens = normalizeMaxTokens(this.value);
        this.value = runtime.settings.maxOutputTokens;
        runtime.save();
    });

    // 前文排除仅修改读取规则；预览文本不写入设置或聊天。
    $d.off('click.texcladd').on('click.texcladd', '#theater-exclusion-add', runtime.addContextExclusionRule);
    $d.off('click.texclpreview').on('click.texclpreview', '#theater-exclusion-preview-run', runtime.previewContextExclusions);
    $d.off('change.texcltype').on('change.texcltype', '#theater-exclusion-type', function () {
        const tag = this.value === 'tag';
        $('#theater-exclusion-value-label').text(tag ? '要排除的标签名' : '要排除的完整内容');
        $('#theater-exclusion-value').attr('placeholder', tag ? '例如 anti_cut（无需填写正则）' : '粘贴固定收尾文字或完整 HTML…');
        $('#theater-exclusion-help').text(tag
            ? '排除成对标签及其内部内容。p、span 等通用标签可能包含正文，请谨慎选择。未闭合区块会保留。'
            : '精确匹配，包括空格和换行；有 HTML 时请连同标签一起粘贴。');
        $('#theater-exclusion-feedback').prop('hidden', true);
    });
    $d.off('change.texcltoggle').on('change.texcltoggle', '[data-exclusion-toggle]', function () {
        const rules = normalizeContextExclusionRules(runtime.settings.contextExclusionRules);
        const index = Number(this.dataset.exclusionToggle);
        if (!Number.isInteger(index) || !rules[index]) return;
        rules[index].enabled = this.checked;
        runtime.settings.contextExclusionRules = rules;
        runtime.refreshContextExclusionRules();
    });
    $d.off('click.texcldelete').on('click.texcldelete', '[data-exclusion-delete]', function () {
        const rules = normalizeContextExclusionRules(runtime.settings.contextExclusionRules);
        const index = Number(this.dataset.exclusionDelete);
        if (!Number.isInteger(index) || !rules[index]) return;
        rules.splice(index, 1);
        runtime.settings.contextExclusionRules = rules;
        runtime.refreshContextExclusionRules();
        $('#theater-exclusion-feedback').text('已删除规则。').prop('hidden', false);
    });
    $d.off('input.texclpreview').on('input.texclpreview', '#theater-exclusion-preview-input', function () {
        $('#theater-exclusion-preview-output').empty().prop('hidden', true);
        $('#theater-exclusion-preview-status').prop('hidden', true);
    });
    $d.off('change.tquickrendera').on('change.tquickrendera', '#theater-quick-render-a', function () {
        runtime.updateQuickRenderSetting('A', $(this).val());
    });
    $d.off('change.tquickrenderb').on('change.tquickrenderb', '#theater-quick-render-b', function () {
        runtime.updateQuickRenderSetting('B', $(this).val());
    });
    $d.off('click.tnumberstep').on('click.tnumberstep', '[data-theater-number-step]', function () {
        const input = document.getElementById(String($(this).data('theater-number-target') || ''));
        if (!input) return;
        const min = Number.isFinite(Number(input.min)) ? Number(input.min) : Number.NEGATIVE_INFINITY;
        const max = Number.isFinite(Number(input.max)) ? Number(input.max) : Number.POSITIVE_INFINITY;
        const step = Number(input.step) || 1;
        const direction = Number($(this).data('theater-number-step')) < 0 ? -1 : 1;
        const current = Number.isFinite(Number(input.value)) ? Number(input.value) : (Number.isFinite(min) ? min : 0);
        input.value = String(Math.min(max, Math.max(min, current + (step * direction))));
        $(input).trigger('change');
    });
    $d.off('change.twbread').on('change.twbread', '#theater-wb-read-mode', async function () {
        runtime.settings.worldBookReadMode = ['enabled', 'lights'].includes($(this).val()) ? $(this).val() : 'all';
        runtime.save();
        await runtime.reloadWorldBooks();
    });
    $d.off('click.tsa').on('click.tsa', '#theater-save-api-btn', function () {
        runtime.persistCurrentApiConfig();
        toastr.success('API 已保存');
    });
    $d.off('change.tapreset').on('change.tapreset', '#theater-api-preset-select', function () {
        const id = $(this).val() || '';
        if (!id) {
            runtime.settings.selectedApiPresetId = '';
            runtime.refreshApiPresetControls('');
            runtime.save();
            return;
        }
        const preset = runtime.findApiPreset(id);
        if (!preset) { runtime.refreshApiPresetControls(''); return; }
        runtime.writeApiFormConfig(preset);
        runtime.settings.selectedApiPresetId = preset.id;
        runtime.persistCurrentApiConfig(preset);
        runtime.refreshApiPresetControls(preset.id);
        runtime.runtimeLog('info', 'API 预设切换', { preset: preset.name, protocol: preset.apiProtocol, model: preset.apiModel });
        toastr.success(`已切换到「${preset.name}」`);
    });
    $d.off('click.tapreset-save').on('click.tapreset-save', '#theater-save-api-preset-btn', async function () {
        const config = runtime.readApiFormConfig();
        if (!runtime.validateApiPresetConfig(config)) return;
        const { Popup } = SillyTavern.getContext();
        const input = await runtime.askNewItemName('保存 API 预设', runtime.apiPresetDefaultName(config), 40);
        const name = String(input || '').trim().slice(0, 40);
        if (!name) return;
        const duplicate = normalizeApiPresetList(runtime.settings.apiPresets).find(preset => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (duplicate) {
            const overwrite = await Popup.show.confirm(`已经有一个叫「${duplicate.name}」的预设`, '要用当前填写的配置覆盖它吗？');
            if (!overwrite) return;
        } else if (normalizeApiPresetList(runtime.settings.apiPresets).length >= MAX_API_PRESETS) {
            toastr.warning(`最多保存 ${MAX_API_PRESETS} 个 API 预设`);
            return;
        }
        const preset = createApiPresetFromConfig(name, config, duplicate?.id || '');
        runtime.settings.apiPresets = duplicate
            ? normalizeApiPresetList(runtime.settings.apiPresets).map(item => item.id === duplicate.id ? preset : item)
            : [...normalizeApiPresetList(runtime.settings.apiPresets), preset];
        runtime.settings.selectedApiPresetId = preset.id;
        runtime.persistCurrentApiConfig(config);
        runtime.refreshApiPresetControls(preset.id);
        runtime.runtimeLog('info', duplicate ? 'API 预设覆盖' : 'API 预设保存', { preset: preset.name, protocol: preset.apiProtocol, model: preset.apiModel });
        toastr.success(duplicate ? `已更新「${preset.name}」` : `已保存「${preset.name}」`);
    });
    $d.off('click.tapreset-update').on('click.tapreset-update', '#theater-update-api-preset-btn', function () {
        const current = runtime.findApiPreset();
        if (!current) { toastr.warning('请先选择一个 API 预设'); return; }
        const config = runtime.readApiFormConfig();
        if (!runtime.validateApiPresetConfig(config)) return;
        const preset = createApiPresetFromConfig(current.name, config, current.id);
        runtime.settings.apiPresets = normalizeApiPresetList(runtime.settings.apiPresets).map(item => item.id === current.id ? preset : item);
        runtime.persistCurrentApiConfig(config);
        runtime.refreshApiPresetControls(preset.id);
        runtime.runtimeLog('info', 'API 预设更新', { preset: preset.name, protocol: preset.apiProtocol, model: preset.apiModel });
        toastr.success(`已更新「${preset.name}」`);
    });
    $d.off('click.tapreset-rename').on('click.tapreset-rename', '#theater-rename-api-preset-btn', async function () {
        const current = runtime.findApiPreset();
        if (!current) { toastr.warning('请先选择一个 API 预设'); return; }
        const { Popup } = SillyTavern.getContext();
        const input = await Popup.show.input('重命名 API 预设', `把「${current.name}」改成：`, current.name);
        const name = String(input || '').trim().slice(0, 40);
        if (!name || name === current.name) return;
        const duplicate = normalizeApiPresetList(runtime.settings.apiPresets).some(preset => preset.id !== current.id && preset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (duplicate) { toastr.warning('已经有同名的 API 预设'); return; }
        runtime.settings.apiPresets = normalizeApiPresetList(runtime.settings.apiPresets).map(preset => preset.id === current.id ? { ...preset, name } : preset);
        runtime.refreshApiPresetControls(current.id);
        runtime.save();
        runtime.runtimeLog('info', 'API 预设改名', { from: current.name, to: name });
        toastr.success(`已改名为「${name}」`);
    });
    $d.off('click.tapreset-delete').on('click.tapreset-delete', '#theater-delete-api-preset-btn', async function () {
        const current = runtime.findApiPreset();
        if (!current) { toastr.warning('请先选择一个 API 预设'); return; }
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm(`删除 API 预设「${current.name}」？`, '只会删除快捷预设，当前正在使用的 API 配置会保留。');
        if (!ok) return;
        runtime.settings.apiPresets = normalizeApiPresetList(runtime.settings.apiPresets).filter(preset => preset.id !== current.id);
        runtime.settings.selectedApiPresetId = '';
        runtime.refreshApiPresetControls('');
        runtime.save();
        runtime.runtimeLog('info', 'API 预设删除', { preset: current.name });
        toastr.success(`已删除「${current.name}」`);
    });
    $d.off('click.tfm').on('click.tfm', '#theater-fetch-models-btn', runtime.fetchModelList);
    $d.off('click.ttest').on('click.ttest', '#theater-test-api-btn', runtime.testAPIConnection);
    $d.off('click.tdiag').on('click.tdiag', '#theater-run-diagnostics-btn', runtime.runDiagnostics);
    $d.off('click.tdiagexport').on('click.tdiagexport', '#theater-export-diagnostics-btn', runtime.exportDiagnosticsText);
    $d.off('click.tdiagcopy').on('click.tdiagcopy', '#theater-copy-diagnostics-btn', function () {
        const text = $('#theater-diagnostics-output').data('report') || '';
        if (!text) { toastr.warning('请先生成诊断报告'); return; }
        runtime.copyToClipboard(text);
    });
    $d.off('click.tdiagtoggle').on('click.tdiagtoggle', '#theater-toggle-diagnostics-btn', runtime.toggleDiagnosticsReport);
    $d.off('click.telcopy').on('click.telcopy', '.theater-copy-runtime-log-btn', function () {
        if (!getRuntimeLogEntries().length) { toastr.warning('暂无运行日志'); return; }
        runtime.copyToClipboard(formatRuntimeLogs(), {
            requireVerification: true,
            manualTitle: '手动复制运行日志',
            downloadName: `千夜浮梦-运行日志-${new Date().toISOString().slice(0, 10)}.txt`,
        });
    });
    $d.off('click.tmcopyclose').on('click.tmcopyclose', '[data-theater-manual-copy-close]', function (event) {
        if (event.target !== this && $(this).hasClass('theater-manual-copy-backdrop')) return;
        $('#theater-manual-copy-overlay').remove();
    });
    $d.off('click.tmcopydownload').on('click.tmcopydownload', '#theater-manual-copy-download', function () {
        const $overlay = $('#theater-manual-copy-overlay');
        runtime.downloadTextContent($overlay.find('textarea').val() || '', $overlay.data('download-name') || '千夜浮梦-日志.txt');
    });
    $d.off('click.tmcopyselect').on('click.tmcopyselect', '#theater-manual-copy-text', function () {
        this.focus();
        this.select();
        this.setSelectionRange(0, this.value.length);
    });
    $d.off('click.telclear').on('click.telclear', '#theater-clear-runtime-log-btn', function () {
        clearRuntimeLogs();
        runtime.renderRuntimeLog();
        toastr.success('日志已清空');
    });
    $d.off('change.tams').on('change.tams', '#theater-api-model-select', function () {
        const val = $(this).val();
        if (val) {
            $('#theater-api-model').val(val);
            runtime.settings.apiModel = val;
            runtime.save();
        }
    });

    // ---- Result bookmark & Floating Ball ----
    $d.off('change.trbe').on('change.trbe', '#theater-result-bookmark-enabled', function () {
        runtime.settings.resultBookmarkEnabled = $(this).is(':checked');
        runtime.save();
        runtime.applyResultToolboxMode();
    });
    $d.off('change.tfb').on('change.tfb', '#theater-floating-ball-toggle', function () {
        runtime.settings.floatingBall = $(this).is(':checked'); runtime.save(); runtime.createFloatingBall();
    });
    $d.off('change.tfbt').on('change.tfbt', '#theater-floating-ball-tuck-toggle', function () {
        runtime.settings.floatingBallTuck = $(this).is(':checked'); runtime.save(); runtime.createFloatingBall();
    });

    // ---- Sound ----
    $d.off('change.tse').on('change.tse', '#theater-sound-enabled', function () {
        runtime.settings.soundEnabled = $(this).is(':checked'); runtime.save();
    });
    $d.off('change.tsp').on('change.tsp', '#theater-sound-preset', function () {
        runtime.settings.soundPreset = $(this).val(); runtime.save();
        runtime.refreshConfigSummaries();
        runtime.playNotificationSound({ force: true });
    });
    $d.off('input.tsv').on('input.tsv', '#theater-sound-volume', function () {
        const v = Math.max(0, Math.min(100, parseInt($(this).val()) || 0));
        runtime.settings.soundVolume = v;
        $('#theater-sound-volume-num').text(v);
        runtime.refreshConfigSummaries();
        runtime.save();
    });
    $d.off('click.tspv').on('click.tspv', '#theater-sound-preview-btn', function () {
        runtime.playNotificationSound({ force: true });
    });

    // ---- Random pick ----
    $d.off('change.tre').on('change.tre', '#theater-random-enabled', function () {
        runtime.settings.randomEnabled = $(this).is(':checked');
        $('#theater-random-btn').toggle(runtime.settings.randomEnabled);
        runtime.save();
    });
    $d.off('change.trs').on('change.trs', '#theater-random-scope', function () {
        runtime.settings.randomScope = $(this).val();
        runtime.refreshTagControls();
        runtime.save();
    });
    $d.off('click.trtagpicker').on('click.trtagpicker', '#theater-random-tag-picker', async function () {
        const chosen = await runtime.chooseTags({ title: '指定“抽一个”的标签', selected: runtime.settings.randomTagFilter, allowUncategorized: true });
        if (chosen === null) return;
        runtime.settings.randomTagFilter = chosen;
        runtime.settings.randomScope = chosen[0] === TAG_UNCATEGORIZED ? TAG_UNCATEGORIZED : '__tags__';
        $('#theater-random-scope').val(runtime.settings.randomScope);
        runtime.save(); runtime.refreshTagControls();
    });
    $d.off('click.trb').on('click.trb', '#theater-random-btn', runtime.rollRandomInstruction);

    // ---- Auto mode ----
    $d.off('change.tae').on('change.tae', '#theater-auto-enabled', function () {
        runtime.settings.autoMode = $(this).is(':checked');
        runtime.save();
        if (runtime.settings.autoMode) {
            const readiness = runtime.currentAutoInstruction();
            if (!readiness.text) {
                runtime.lastAutoIssue = {
                    signal: readiness.signal || REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
                    source: readiness.source,
                    candidateCount: readiness.candidateCount,
                };
                toastr.warning(`自动模式已开启，但当前不会发请求：${runtime.lastAutoIssue.signal}。请打开【诊断】查看说明。`, '', { timeOut: 6500 });
            } else {
                runtime.lastAutoIssue = null;
                toastr.info(`自动模式已开启：每攒 ${runtime.settings.autoInterval || 10} 层 AI 楼生成一次`, '', { timeOut: 4000 });
            }
        } else {
            runtime.lastAutoIssue = null;
            runtime.lastAutoIssueFingerprint = '';
        }
    });
    $d.off('change.tai').on('change.tai', '#theater-auto-interval', function () {
        const v = Math.max(1, Math.min(50, parseInt($(this).val()) || 10));
        runtime.settings.autoInterval = v;
        $(this).val(v);
        runtime.refreshConfigSummaries();
        runtime.save();
    });
    $d.off('change.tas').on('change.tas', '#theater-auto-source', function () {
        runtime.settings.autoSource = $(this).val();
        runtime.lastAutoIssue = null;
        runtime.lastAutoIssueFingerprint = '';
        runtime.refreshTagControls();
        runtime.save();
    });
    $d.off('click.tautagpicker').on('click.tautagpicker', '#theater-auto-tag-picker', async function () {
        const chosen = await runtime.chooseTags({ title: '指定自动生成的模板标签', selected: runtime.settings.autoTagFilter, allowUncategorized: true });
        if (chosen === null) return;
        runtime.settings.autoTagFilter = chosen;
        runtime.settings.autoSource = chosen[0] === TAG_UNCATEGORIZED ? TAG_UNCATEGORIZED : '__tags__';
        $('#theater-auto-source').val(runtime.settings.autoSource);
        runtime.lastAutoIssue = null; runtime.lastAutoIssueFingerprint = '';
        runtime.save(); runtime.refreshTagControls();
    });

    // ---- Instruction Import/Export ----
    $d.off('click.timp').on('click.timp', '#theater-import-inst-btn', runtime.importInstructionTemplates);
    $d.off('click.texp').on('click.texp', '#theater-export-inst-btn', runtime.exportInstructionTemplates);

    // ---- Preset Collapse ----
    $d.off('click.tpcol').on('click.tpcol', '#theater-preset-collapse-btn', function () {
        const $list = $('#theater-preset-entries');
        const hidden = !$list.is(':visible');
        $list.slideToggle(150);
        $(this).html(hidden ? '<i class="fa-solid fa-chevron-up"></i> 收起' : '<i class="fa-solid fa-chevron-down"></i> 展开');
    });
}
// @theater-source-end bindEvents

return { bindEvents };
}
