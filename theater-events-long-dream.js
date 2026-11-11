import { resetLongDreamSourcePicker, pickerSelectedSource } from './long-dream-source-picker.js';
import { importLongDreamSeries } from './long-dream-series.js';
import { LONG_DREAM_DRAFT_STATUS, LONG_DREAM_WORLD_LINE_RELATION, LONG_DREAM_WORLD_BOOK_POLICY, createLongDreamRecord, LONG_DREAM_STATUS, LONG_DREAM_MEMORY_STATUS, prepareLongDreamMemoryRegeneration, updateLongDreamMemoryV2RecordItem, setLongDreamMemoryV2RecordItemHidden, rejectLongDreamMemoryV2RecordItem, resolveLongDreamMemoryV2RecordConflict, updateLongDreamMemoryCard, setLongDreamMemoryCardStatus, updateLongDreamDefinition } from './long-dream.js';
import { LONG_DREAM_CANON_SUGGESTION_CATEGORIES, composeLongDreamCanon } from './long-dream-canon-suggestions.js';
import { normalizeManualTarget } from './length-policy.js';

// Event registration order and handler closures are preserved by the coordinator.
export function bindLongDreamEvents(runtime, $d) {
    $d.off('click.tdreambackup').on('click.tdreambackup', event => {
        document.querySelectorAll('.theater-dream-backup-menu[open]').forEach(menu => {
            if (!menu.contains(event.target) || event.target.closest('button')) menu.open = false;
        });
    });
    const backupMenuHandlerKey = Symbol.for('st-theater.backup-menu-keydown');
    const previousKeyHandler = document[backupMenuHandlerKey];
    if (previousKeyHandler) document.removeEventListener?.('keydown', previousKeyHandler, true);
    const closeBackupMenu = event => {
        if (event.key !== 'Escape') return;
        const menu = document.querySelector('.theater-dream-backup-menu[open]');
        if (!menu) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        menu.open = false;
        menu.querySelector('summary')?.focus();
    };
    document.addEventListener?.('keydown', closeBackupMenu, true);
    document[backupMenuHandlerKey] = closeBackupMenu;

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
        resetLongDreamSourcePicker(runtime);
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
        if ($(this).prop('disabled')) return;
        $(this).prop('disabled', true);
        try {
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
        const autoWeave = source.kind === 'history-folder' && $('#theater-source-auto-weave').prop('checked') === true;
        if (autoWeave && !runtime.selectedLongDreamMemoryApiPreset()) { toastr.warning('请先绑定梦脉副 API，或取消勾选生成梦脉与概要'); return; }
        const liveSource = runtime.resolveLongDreamSource(source.key);
        if (!liveSource || $('#theater-dream-source').val() !== source.key || JSON.stringify(liveSource.chapters) !== JSON.stringify(source.chapters)) { toastr.warning('来源已改变，请重新核对后开卷'); return; }
        const chosenSnapshot = pickerSelectedSource(runtime);
        if (chosenSnapshot?.key === source.key && JSON.stringify(chosenSnapshot.chapters) !== JSON.stringify(source.chapters)) { toastr.warning('来源内容已改变，请重新打开新建作品核对'); return; }
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
        const created = await runtime.longDreamAdd(importLongDreamSeries(record, source, autoWeave));
        if (!created) return;
        if (source.kind === 'history-folder') { runtime.settings.longDreamSeriesAutoWeave = autoWeave; runtime.save(); }
        runtime.activeLongDreamId = created.id;
        runtime.longDreamView = 'detail';
        runtime.longDreamWorkspaceSection = 'continue';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
        toastr.success(`《${created.title}》已开卷`);
        if (autoWeave) runtime.queueLongDreamMemoryWeave(created.id, { force: true, announce: true });
        runtime.resetLongDreamCanonSuggestions({ abort: false });
        } catch (error) { toastr.error('开卷失败，原历史仍保留，请重新加载后核对'); runtime.runtimeLog('error', '系列开卷失败'); }
        finally { $(this).prop('disabled', false); }
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
    $d.off('click.tdchaptertoolaction').on('click.tdchaptertoolaction', '#theater-dream-chapter-tools-panel button:not([data-relayout])', closeLongDreamChapterTools);
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
    $d.off('click.tdexitreview');
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
    $d.off('click.tdseriesstop').on('click.tdseriesstop', '#theater-dream-stop-series', async function () {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        if (dream?.source?.kind !== 'history-folder') return;
        runtime.settings.longDreamSeriesPausedIds = [...new Set([...(runtime.settings.longDreamSeriesPausedIds || []), String(dream.id)])];
        runtime.save(); runtime.rememberLongDreamComposerDraft(); runtime.renderLongDreamPanel(); toastr.info('当前批次完成后停止，已完成进度会保留');
    });
    $d.off('click.tdweave').on('click.tdweave', '#theater-dream-weave-now', function () {
        runtime.queueLongDreamMemoryWeave(runtime.activeLongDreamId, { force: true, announce: true, resumeSeries: true });
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
            `将重新读取全部 ${dream.chapters.length} 章已确认正文，清理自动织录结果并从第一章重新生成。你手动保存、隐藏或否定过的内容会保留。此操作会消耗梦脉副 API。`,
        );
        if (!confirmed) return;
        const saved = await runtime.longDreamPut(prepareLongDreamMemoryRegeneration(dream));
        if (!saved) return;
        runtime.renderLongDreamPanel();
        toastr.info('已准备重新生成整部梦脉');
        runtime.queueLongDreamMemoryWeave(saved.id, { force: true, announce: true, resumeSeries: true });
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
        if (runtime.longDreamCandidateSavePending) { toastr.info('请等待当前候选或设置保存完成'); return; }
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
        runtime.longDreamCandidateSavePending = true;
        try {
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
            const latest = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
            if (String(runtime.activeLongDreamId) !== String(dream.id) || latest !== dream
                || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) {
                toastr.info('长梦状态已变化，本次未保存定梦'); return;
            }
            const updated = updateLongDreamDefinition(latest, {
                title: $('#theater-dream-edit-title').val(),
                canon: $('#theater-dream-edit-canon').val(),
                worldBookPolicy,
                worldLineRelation,
                worldBookNames: inheritedBookNames,
                worldBookSnapshot,
            });
            if (updated.draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW) {
                updated.draft = { ...updated.draft, candidates: updated.draft.candidates.map(candidate => ({ ...candidate, retained: true })) };
            }
            const saved = await runtime.longDreamPut(updated);
            if (!saved) return;
            runtime.renderLongDreamPanel();
            toastr.success('此梦设定已保存');
        } catch { toastr.warning('定梦设置保存失败，请重试'); }
        finally { runtime.longDreamCandidateSavePending = false; }
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


}
