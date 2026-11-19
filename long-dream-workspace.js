// long-dream-workspace: receives live state and cross-feature callbacks from index.js.
// 长梦工作区·面板与详情页；其余部分在 long-dream-workspace-library / -create / -memory.js，这里组装成一个整体。
import { dreamRelayoutButton, manualLayoutSource, syncDreamRelayout } from './manual-relayout.js';
import { normalizeManualTarget } from './length-policy.js';
import { latestLongDreamChapter, LONG_DREAM_WORLD_LINE_RELATION, LONG_DREAM_MEMORY_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_DRAFT_RESUME_STAGE, updateLongDreamDefinition, LONG_DREAM_MAX_CANDIDATES } from './long-dream.js';
import { isTextOutputMode } from './plain-text-renderer.js';
import { LONG_DREAM_GENERATION_STAGE } from './long-dream-generation.js';
import { readableCharCount } from './text-counter.js';
import { mountStoryReading, storyReadingNoticeHTML } from './story-reading.js';
import { createLongDreamLibrary } from './long-dream-workspace-library.js';
import { createLongDreamCreatePage } from './long-dream-workspace-create.js';
import { createLongDreamMemoryView } from './long-dream-workspace-memory.js';

export function createLongDreamWorkspace(runtime) {
const ws = {};
Object.assign(ws, createLongDreamLibrary(runtime, ws));
Object.assign(ws, createLongDreamCreatePage(runtime, ws));
Object.assign(ws, createLongDreamMemoryView(runtime, ws));
const { historyItemHTML, historyTagBadgesHTML, longDreamSources, resolveLongDreamSource, longDreamDate, longDreamExcerpt, longDreamSourceInstructionState, longDreamSourcePreviewHTML, resetLongDreamCanonSuggestions, activeLongDreamCanonSuggestions, longDreamCanonSuggestionCardsHTML, longDreamCanonSuggestionHTML, renderLongDreamCanonSuggestions, findLongDreamCanonSuggestion, captureCurrentLongDreamWorldBooks, longDreamSnapshotEntryCount, longDreamBackupFileName, exportLongDreamZip, chooseExportFormat, exportLongDreamBackup, requestLongDreamExport, readLongDreamZip, importedLongDreamTitle, importLongDreamBackup, readLongDreamChapter, longDreamChapterFileName, exportLongDreamChapter, saveLongDreamChapterEdits, setCurrentLongDreamStatus, longDreamListHTML, longDreamRelationLabel, longDreamRelationChoicesHTML, longDreamSourceWorldBooks, sameWorldBookSelection, longDreamCreateWorldBookStateHTML, refreshLongDreamCreateWorldBookState, longDreamCreateHTML, longDreamGenerationStageText, formatLongDreamElapsed, longDreamProgressStageText, longDreamProgressLabelText, longDreamProgressKickerText, longDreamProgressMetaHTML, selectedLongDreamMemoryApiPreset, longDreamMemoryAnalysisPresets, selectedLongDreamMemoryAnalysisPreset, refreshLongDreamMemoryPresetControls, longDreamMemoryStatusText, longDreamActiveMemoryCount, longDreamSummaryHistoryHTML, toggleLongDreamSummaryPreview, longDreamMemoryConflictTarget, longDreamMemoryConflictSubjects, longDreamMemoryConflictItemText, longDreamMemoryConflictOperationText, longDreamMemoryConflictDetails, longDreamMemoryCardsHTML, longDreamMemorySelectionHTML, refreshLongDreamMemorySelection, longDreamMemoryTags, longDreamMemoryV2Fields, uniqueLongDreamBranchTitle, handleLongDreamChapterAction } = ws;
// @theater-source-begin longDreamWorkspaceHTML
function longDreamWorkspaceHTML(content, activeSection = runtime.longDreamWorkspaceSection) {
    const sections = [
        ['definition', '定梦'],
        ['continue', '续写'],
        ['works', '作品'],
    ];
    return `<div class="theater-dream-workspace ia-long-dream-shell" data-dream-workspace-section="${runtime.esc(activeSection)}">
        <nav class="theater-dream-workspace-tabs ia-subnav" aria-label="长梦分类">
            ${sections.map(([section, label]) => `<button type="button" class="theater-dream-workspace-tab ia-subtab ${activeSection === section ? 'active' : ''}" data-dream-section="${section}" aria-current="${activeSection === section ? 'page' : 'false'}">${label}</button>`).join('')}
        </nav>
        <section class="theater-dream-workspace-body ia-category active" data-category-panel="${runtime.esc(activeSection)}"><div class="ia-column">${content}</div></section>
    </div>`;
}
// @theater-source-end longDreamWorkspaceHTML

// @theater-source-begin longDreamDetailState
function longDreamDetailState(dream) {
    const latest = latestLongDreamChapter(dream);
    const chapterText = latest?.text || runtime.htmlToPlainText(latest?.html || '');
    const selectedPolicy = dream.inheritance?.worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED;
    const worldLineRelation = dream.inheritance?.worldLineRelation || (selectedPolicy ? LONG_DREAM_WORLD_LINE_RELATION.PARALLEL : LONG_DREAM_WORLD_LINE_RELATION.ISOLATED);
    const selectedBooks = dream.inheritance?.worldBookNames || [];
    const snapshotEntries = longDreamSnapshotEntryCount(dream.inheritance?.snapshot);
    const availableBooks = (runtime.settings.selectedWorldBooks || []).filter(Boolean);
    const currentCheckedEntries = runtime.wbEntries.filter((entry, index) => !entry.manual
        && availableBooks.includes(entry.book)
        && runtime.wbStates[index] !== false).length;
    const bookText = selectedBooks.length ? selectedBooks.join('、') : (availableBooks.length ? availableBooks.join('、') : '当前没有选中的世界书');
    const nextNumber = dream.chapters.length + 1;
    const activeMemoryCount = longDreamActiveMemoryCount(dream);
    const inheritanceSummary = selectedPolicy && selectedBooks.length
        ? `${longDreamRelationLabel(worldLineRelation)} · ${selectedBooks.length} 本资料库`
        : '完全隔离';
    const draft = dream.draft || null;
    const draftCandidates = Array.isArray(draft?.candidates) ? draft.candidates : [];
    const selectedCandidateIndex = draftCandidates.length
        ? Math.min(draftCandidates.length - 1, Math.max(0, Math.floor(Number(draft?.selectedCandidateIndex) || 0)))
        : 0;
    const isGeneratingThisDream = String(runtime.activeLongDreamGenerationId) === String(dream.id)
        && !!runtime.longDreamGenerationController?.active;
    const activeProgress = isGeneratingThisDream ? runtime.longDreamGenerationController.active : null;
    const activeStage = activeProgress?.stage || null;
    const draftText = isGeneratingThisDream ? runtime.longDreamLiveDraftText : (draft?.text || '');
    const hasWritingDraft = draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING;
    const hasReviewDraft = draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW && !isGeneratingThisDream;
    const hasRenderPendingDraft = hasWritingDraft
        && draft?.resumeStage === LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING
        && !!draftText.trim();
    const controlsDisabled = isGeneratingThisDream || !!runtime.longDreamChapterEditController || hasReviewDraft || dream.status === 'complete';
    const statusControlDisabled = isGeneratingThisDream || !!runtime.longDreamChapterEditController || !!draft;
    const composerDraft = runtime.getLongDreamComposerDraft(dream.id);
    const nextTitle = draft?.title || composerDraft.title || '';
    const nextInstruction = draft ? draft.instruction : composerDraft.instruction;
    const nextTarget = normalizeManualTarget(draft?.targetChars || composerDraft.targetChars);
    const nextRecent = Number(composerDraft.recentChapters) === 1 ? 1 : 2;
    const generationHint = hasReviewDraft
        ? `当前有 ${draftCandidates.length} 版候选，可继续生成；未保留候选仅留最新三版，已保留版本不被替换。`
        : (hasWritingDraft
            ? (hasRenderPendingDraft
                ? '正文已经完整保存；继续时只会重新生成最终排版，不会再次请求或重复正文。'
                : (draftCandidates.length
                    ? `正在准备新版本；此前 ${draftCandidates.length} 版候选仍安全保留。`
                    : '检测到可恢复草稿；继续时重新注入完整基础包和当前全文，只从草稿结尾承接。'))
            : '');
    return {
        latest, chapterText, selectedPolicy, worldLineRelation, selectedBooks, snapshotEntries,
        availableBooks, currentCheckedEntries, bookText, nextNumber, activeMemoryCount,
        inheritanceSummary, draft, draftCandidates, selectedCandidateIndex,
        isGeneratingThisDream, activeProgress, activeStage, draftText, hasWritingDraft, hasReviewDraft,
        hasRenderPendingDraft, controlsDisabled, statusControlDisabled, nextTitle,
        nextInstruction, nextTarget, nextRecent, generationHint,
    };
}
// @theater-source-end longDreamDetailState

// @theater-source-begin longDreamDetailHeaderHTML
function longDreamDetailHeaderHTML(dream, { showTools = false, statusControlDisabled = false } = {}) {
    return `<header class="compact-detail-head theater-dream-detail-head">
        <div class="compact-detail-head-main">
            <span class="step theater-dream-step">${dream.status === 'complete' ? '已完结' : '仍在梦中'} · 共 ${dream.chapters.length} 章</span>
            <h2>《${runtime.esc(dream.title)}》</h2>
        </div>
        ${showTools ? `<div class="compact-tools">
            <button type="button" id="theater-dream-export-current" title="导出本卷" aria-label="导出本卷"><i class="fa-solid fa-file-export"></i></button>
            <button type="button" id="${dream.status === 'complete' ? 'theater-dream-reopen' : 'theater-dream-complete'}" title="${dream.status === 'complete' ? '重新打开作品' : '完卷'}" aria-label="${dream.status === 'complete' ? '重新打开作品' : '完卷'}" ${statusControlDisabled ? 'disabled' : ''}><i class="fa-solid ${dream.status === 'complete' ? 'fa-feather-pointed' : 'fa-book-bookmark'}"></i></button>
        </div>` : ''}
        <div class="compact-seal" aria-hidden="true">梦</div>
    </header>`;
}
// @theater-source-end longDreamDetailHeaderHTML

// @theater-source-begin refreshLongDreamWorldBookSources
async function refreshLongDreamWorldBookSources() {
    if (runtime.refreshingLongDreamWorldBooks) return;
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (!dream) return;
    const state = longDreamDetailState(dream);
    if (state.isGeneratingThisDream || state.hasReviewDraft || runtime.isPreparingGeneration || runtime.longDreamChapterEditController) {
        toastr.warning('请先完成当前生成、待确认章节或章节编辑，再更新世界书');
        return;
    }
    if (!state.selectedPolicy) return;
    const bookNames = (runtime.settings.selectedWorldBooks || []).filter(Boolean);
    if (!bookNames.length) { toastr.warning('素材页当前没有选中的世界书'); return; }
    const key = runtime.worldBookCacheKey();
    runtime.refreshingLongDreamWorldBooks = true;
    runtime.refreshingLongDreamWorldBookId = dream.id;
    syncLongDreamPanel({ renderDrafts: false });
    try {
        const complete = await runtime.reloadWorldBooks({ silent: true, force: true, requireFresh: true });
        if (key !== runtime.worldBookCacheKey()) { toastr.info('世界书选择已变化，冻结资料未改动，请重新更新'); return; }
        if (!complete) { toastr.warning('世界书未全部读取成功，冻结资料未改动，请重试'); return; }
        const current = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        if (String(runtime.activeLongDreamId) !== String(dream.id) || current !== dream) {
            toastr.info('长梦已切换或内容已变化，本次未更新冻结资料');
            return;
        }
        const currentState = longDreamDetailState(current);
        if (currentState.isGeneratingThisDream || currentState.hasReviewDraft || runtime.isPreparingGeneration || runtime.longDreamChapterEditController) {
            toastr.info('长梦正在生成或编辑，本次未更新冻结资料');
            return;
        }
        const snapshot = captureCurrentLongDreamWorldBooks(bookNames);
        const entryCount = longDreamSnapshotEntryCount(snapshot);
        if (!entryCount) { toastr.warning('素材页当前没有已勾选的世界书条目，冻结资料未改动'); return; }
        const saved = await runtime.longDreamPut(updateLongDreamDefinition(current, {
            worldBookNames: bookNames,
            worldBookSnapshot: snapshot,
        }));
        if (!saved) { toastr.warning('冻结资料未能保存，请重试'); return; }
        toastr.success(`冻结资料已更新为当前勾选的 ${entryCount} 条`);
    } catch { toastr.warning('世界书更新失败，请重试'); }
    finally {
        runtime.refreshingLongDreamWorldBooks = false;
        runtime.refreshingLongDreamWorldBookId = null;
        syncLongDreamPanel({ renderDrafts: false });
    }
}
// @theater-source-end refreshLongDreamWorldBookSources

// @theater-source-begin longDreamDefinitionHTML
function longDreamDefinitionHTML(dream) {
    const state = longDreamDetailState(dream);
    return `<div class="theater-dream-detail theater-dream-definition" data-id="${runtime.esc(dream.id)}">
        <section class="ui-card theater-dream-settings is-workspace">
            <div class="ui-title"><span><i class="fa-solid fa-pen-nib"></i> 此梦设定 (Canon)</span></div>
            <div class="theater-dream-settings-body">
                <label class="ia-field" for="theater-dream-edit-title"><span>长卷名字</span><input id="theater-dream-edit-title" class="ui-input theater-input" maxlength="80" value="${runtime.esc(dream.title)}" ${state.isGeneratingThisDream ? 'disabled' : ''}></label>
                <label class="ia-field" for="theater-dream-edit-canon"><span>此梦正典与初始设定</span><textarea id="theater-dream-edit-canon" class="ui-textarea theater-textarea" rows="7" placeholder="写下这条世界线必须遵守的事实。" ${state.isGeneratingThisDream ? 'disabled' : ''}>${runtime.esc(dream.canon)}</textarea></label>
            </div>
        </section>
        <section class="ui-card theater-dream-inheritance">
            <div class="ui-title"><span><i class="fa-solid fa-code-branch"></i> 世界线继承关系</span></div>
            <div class="relation-cards theater-dream-relation-list">${longDreamRelationChoicesHTML({ name: 'theater-dream-edit-relation', selected: state.worldLineRelation, hasBooks: !!(state.selectedBooks.length || state.availableBooks.length), disabled: state.isGeneratingThisDream || state.hasReviewDraft })}</div>
        </section>
        <section class="ui-card theater-dream-world-book-freeze">
            <div class="ui-title"><span><i class="fa-solid fa-book"></i> 初始设定与冻结资料</span></div>
            <div class="source-preview-card"><div class="source-preview-title">初始设定快照</div><div class="source-preview-text">角色卡、用户人设、固定事实与选定正典已在定梦时保存。</div></div>
            <div class="theater-dream-world-book-summary">
                <div class="theater-dream-world-book-row"><div class="theater-dream-world-book-title">冻结世界书 <span id="theater-dream-frozen-count">· ${state.snapshotEntries} 条</span></div>${state.selectedPolicy ? `<button type="button" id="theater-dream-refresh-world-book" class="ui-btn ui-btn-sm" aria-busy="${runtime.refreshingLongDreamWorldBooks}" ${runtime.refreshingLongDreamWorldBooks || state.isGeneratingThisDream || state.hasReviewDraft ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8"/></svg><span>${runtime.refreshingLongDreamWorldBooks ? '更新中…' : '更新世界书'}</span></button>` : ''}</div>
                <p id="theater-dream-frozen-books" class="theater-dream-world-book-library">${state.selectedPolicy ? `当前冻结资料库：${runtime.esc(state.bookText)}` : '当前完全隔离，不读取原世界书'}</p>
                <p class="theater-dream-world-book-hint">${state.selectedPolicy ? '按素材页勾选，重新读取并更新冻结资料。' : '不会读取或猜测原世界书。'}</p>
            </div>
        </section>
        <p class="theater-dream-definition-hint">保存新定梦时会保留现有候选。新设定用于后续生成，旧候选正文不会自动改写。</p>
        <button type="button" id="theater-dream-save-definition" class="ui-btn ui-btn-primary theater-btn primary theater-dream-definition-save" ${state.isGeneratingThisDream ? 'disabled' : ''}><i class="fa-solid fa-floppy-disk"></i><span>保存定梦设置</span></button>
    </div>`;
}
// @theater-source-end longDreamDefinitionHTML

// @theater-source-begin longDreamDetailHTML
function longDreamDetailHTML(dream) {
    const state = longDreamDetailState(dream);
    const writeFlow = state.hasReviewDraft ? '' : `<div class="ia-flow-state active theater-dream-write-state">
        ${longDreamDetailHeaderHTML(dream, { showTools: true, statusControlDisabled: state.statusControlDisabled })}
        <section class="ui-card theater-dream-next">
            <div class="ui-title"><span><i class="fa-solid fa-feather-pointed"></i> 续写第 ${state.nextNumber} 章</span><button type="button" class="theater-dream-options-trigger" data-dream-options-toggle aria-expanded="false" aria-controls="theater-dream-continuation-options" aria-label="打开本章选项与上下文" title="本章选项与上下文"><i class="fa-solid fa-sliders" aria-hidden="true"></i></button></div>
            <textarea id="theater-dream-next-instruction" class="ui-textarea theater-textarea" rows="5" placeholder="这一章想发生什么？（可留空自然续写）" ${state.controlsDisabled ? 'disabled' : ''}>${runtime.esc(state.nextInstruction)}</textarea>
            <div id="theater-dream-token-summary" class="theater-dream-token-summary" role="button" tabindex="0" aria-expanded="false" aria-controls="theater-dream-token-details"><span id="theater-dream-token-summary-value" aria-live="polite">正在估算…</span><span>明细 ▾</span></div>
            <div id="theater-dream-token-details" class="theater-hint-inline theater-dream-token-details" style="display:none;"></div>
            ${state.isGeneratingThisDream ? '' : `<div class="theater-dream-next-actions ia-action-row">
                <button type="button" id="theater-dream-clear-next-instruction" class="ui-btn ui-btn-sm" ${state.controlsDisabled || state.hasWritingDraft || !state.nextInstruction.trim() ? 'disabled' : ''} title="只清空本章续写指令，不影响已有章节"><i class="fa-solid fa-eraser"></i><span>清空指令</span></button>
                ${state.hasWritingDraft ? `<button type="button" id="theater-dream-discard-draft" class="ui-btn ui-btn-sm"><i class="fa-solid fa-xmark"></i><span>${state.draftCandidates.length ? (state.draft.text.trim() ? '放弃本轮生成' : '返回已保留候选') : '放弃草稿'}</span></button>` : ''}
                <button type="button" id="theater-dream-generate-next" class="ui-btn ui-btn-primary theater-dream-primary" ${state.controlsDisabled ? 'disabled' : ''}><i class="fa-solid fa-feather-pointed"></i><span>${state.hasRenderPendingDraft ? '重新生成最终排版' : (state.hasWritingDraft ? (state.draftCandidates.length && !state.draft.text.trim() ? '按当前设定生成新版本' : '继续完整草稿') : '续写下一章')}</span></button>
            </div>`}
            ${state.generationHint ? `<p class="theater-dream-generation-hint">${runtime.esc(state.generationHint)}</p>` : ''}
        </section>
        <section id="theater-dream-continuation-options" class="ui-card ia-options-card theater-dream-next-options">
            <div class="ui-title"><span><i class="fa-solid fa-pen"></i> 本章选项与上下文</span></div>
            <div class="ia-grid-2 theater-dream-next-grid">
                <label class="ia-field"><span>可选章名</span><input id="theater-dream-next-title" class="ui-input theater-input theater-default-name" maxlength="80" value="${runtime.esc(state.nextTitle)}" placeholder="第 ${state.nextNumber} 章" ${state.controlsDisabled ? 'disabled' : ''}></label>
                <label class="ia-field"><span>目标字数</span><input id="theater-dream-next-target" class="ui-input theater-input" type="number" min="1" step="1" value="${state.nextTarget}" ${state.controlsDisabled ? 'disabled' : ''}></label>
                <label class="ia-field"><span>带入全文</span><select id="theater-dream-next-recent" class="ui-select theater-select" data-select2-id="${runtime.theaterNativeSelectCompatId()}" ${state.controlsDisabled || state.hasWritingDraft ? 'disabled' : ''} title="${state.hasWritingDraft ? '本章草稿写完前保持不变，保证同一章前后用的前文一致' : '每章很长时可以只带最近 1 章，更早的章节靠概要和梦脉承接'}"><option value="2" ${state.nextRecent === 2 ? 'selected' : ''}>最近 2 章</option><option value="1" ${state.nextRecent === 1 ? 'selected' : ''}>最近 1 章</option></select></label>
            </div>
            <div class="theater-dream-context-window">${dream.chapters.slice(-state.nextRecent).reverse().map(chapter => `<div class="ia-context-row"><div class="ia-context-copy"><div class="ia-line-title">第 ${chapter.number} 章 · ${runtime.esc(chapter.title)}</div><div class="ia-line-sub">最近完整章节 · ${readableCharCount(chapter.text || runtime.htmlToPlainText(chapter.html || ''))} 字 · 已注入全文</div></div><span class="memory-v2-tag">近期</span></div>`).join('')}${dream.chapters.length > state.nextRecent ? `<div class="ia-context-row"><div class="ia-context-copy"><div class="ia-line-title">更早章节索引</div><div class="ia-line-sub">第 1–${dream.chapters.length - state.nextRecent} 章旧章索引继续参与检索</div></div><span class="memory-v2-tag">索引</span></div>` : ''}</div>
        </section>
        <section id="theater-dream-generation-status" class="ui-card ia-generation-status theater-dream-generation-status ${state.isGeneratingThisDream || state.hasWritingDraft ? 'open' : ''}" ${state.isGeneratingThisDream || state.hasWritingDraft ? '' : 'hidden'}>
            <header class="theater-dream-progress-head">
                <div class="theater-dream-progress-copy"><span class="theater-dream-progress-kicker"><i class="theater-dream-progress-pulse" aria-hidden="true"></i><small id="theater-dream-generation-kicker">${runtime.esc(state.isGeneratingThisDream ? longDreamProgressKickerText(state.activeProgress) : '草稿仍在这里')}</small></span><b id="theater-dream-generation-label">${runtime.esc(state.isGeneratingThisDream ? longDreamProgressLabelText(state.activeProgress) : (state.hasRenderPendingDraft ? '正文已完成，等待重新排版' : '发现一份未完成草稿'))}</b></div>
                <span id="theater-dream-generation-version" class="theater-dream-progress-version">${state.isGeneratingThisDream ? ((state.activeProgress?.candidateNumber || state.draftCandidates.length + 1) > LONG_DREAM_MAX_CANDIDATES ? '新版本' : `第 ${state.activeProgress?.candidateNumber || state.draftCandidates.length + 1} 版`) : '可恢复'}</span>
            </header>
            ${state.isGeneratingThisDream ? longDreamProgressMetaHTML(state.activeProgress, state.draftText, state.nextTarget) : ''}
            ${state.isGeneratingThisDream ? '<div class="ia-status-track" aria-hidden="true"><span></span></div>' : ''}
            ${state.isGeneratingThisDream && state.draftCandidates.length ? `<div class="theater-dream-progress-pane" data-dream-progress-pane="candidate" hidden>${storyReadingNoticeHTML()}<div class="theater-dream-progress-candidate"><iframe id="theater-dream-progress-candidate-frame" sandbox="" title="已保留的第 ${state.draftCandidates[state.selectedCandidateIndex]?.versionNumber || state.selectedCandidateIndex + 1} 版"></iframe><div id="theater-dream-progress-candidate-fallback" tabindex="-1" hidden></div></div><div class="theater-dream-progress-candidate-note"><p>生成期间旧版安全保留；未保留候选仅留最新三版，已保留版本不被替换。</p><button type="button" id="theater-dream-progress-candidate-fullscreen" class="theater-dream-icon-button"><i class="fa-solid fa-expand" aria-hidden="true"></i><span>全屏阅读</span></button></div></div>` : ''}
            <div class="theater-dream-progress-pane active" data-dream-progress-pane="live">
                <p class="theater-dream-generation-context" title="${state.isGeneratingThisDream ? '这里显示当前版本的实时正文；目标字数只是参考，不代表模型的精确完成百分比。' : '已注入定梦基础包、最近两章全文、旧章索引与当前完整草稿。'}">${state.isGeneratingThisDream ? '实时正文' : '可恢复草稿'}</p>
                <pre id="theater-dream-generation-text">${runtime.esc(state.draftText || (state.isGeneratingThisDream ? '请求正在准备中，首字返回后会在这里出现……' : '已保存本章方向，尚未生成正文。'))}</pre>
            </div>
            ${state.isGeneratingThisDream ? `<footer class="theater-dream-progress-footer">
                ${state.draftCandidates.length ? `<div class="theater-dream-progress-switch" role="tablist" aria-label="切换已有版本与实时草稿"><button type="button" data-dream-progress-view="candidate" role="tab" aria-selected="false">第 ${state.draftCandidates[state.selectedCandidateIndex]?.versionNumber || state.selectedCandidateIndex + 1} 版</button><button type="button" data-dream-progress-view="live" role="tab" aria-selected="true" class="active">实时草稿</button></div>` : '<span></span>'}
                <button type="button" id="theater-dream-stop-generation" class="theater-dream-progress-stop"><i class="fa-solid fa-stop" aria-hidden="true"></i><span>停止生成</span></button>
            </footer>` : ''}
        </section>
        <section class="ui-card theater-dream-latest">
            <div class="ui-title"><span><i class="fa-solid fa-clock-rotate-left"></i> 上次写到 · ${runtime.esc(state.latest?.title || '第一章')}</span><button type="button" id="theater-dream-read-latest" class="theater-dream-icon-button" data-dream-read-chapter data-chapter-id="${runtime.esc(state.latest?.id || '')}" aria-label="阅读本章"><i class="fa-solid fa-book-open"></i></button></div>
            <p>${runtime.esc(longDreamExcerpt(state.chapterText, 230))}</p>
        </section>
    </div>`;
    const relayoutCandidate = state.draftCandidates[state.selectedCandidateIndex];
    const reviewVersion = relayoutCandidate?.versionNumber || state.selectedCandidateIndex + 1;
    const reviewFlow = state.hasReviewDraft ? `<div class="ia-flow-state active theater-dream-review-state"><section class="review-wrapper theater-dream-review" data-dream-continuation-stage="review">
        <div class="review-head theater-dream-review-head">
            <div class="review-title-area theater-dream-review-copy"><span>待确认新章</span><h3>${runtime.esc(state.draft.title || `第 ${state.nextNumber} 章`)}</h3></div>
            <div class="theater-dream-review-tools"><div class="candidate-switcher theater-dream-candidate-switcher" aria-label="切换待确认候选版本"><button type="button" data-dream-candidate-step="-1" aria-label="上一版" ${state.selectedCandidateIndex <= 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><strong aria-live="polite">${state.selectedCandidateIndex + 1}/${state.draftCandidates.length}</strong><button type="button" data-dream-candidate-step="1" aria-label="下一版" ${state.selectedCandidateIndex >= state.draftCandidates.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div><button type="button" id="theater-dream-review-fullscreen" class="theater-dream-review-fullscreen" title="全屏阅读当前候选" aria-label="全屏阅读当前候选"><i class="fa-solid fa-expand"></i></button></div>
            <p class="theater-dream-review-count">第 ${state.draftCandidates[state.selectedCandidateIndex]?.versionNumber || state.selectedCandidateIndex + 1} 版 · 正文约 ${readableCharCount(state.draft.text || '')} 字</p>
        </div>
        ${storyReadingNoticeHTML()}
        <div class="review-canvas theater-dream-review-canvas"><iframe id="theater-dream-review-frame" sandbox="" title="待确认长梦章节"></iframe><div id="theater-dream-review-fallback" class="theater-dream-review-fallback" tabindex="-1" hidden></div></div>
        <div class="theater-dream-review-choice">
            <div class="theater-dream-review-actions">
                <button type="button" id="theater-dream-keep-candidate" class="ui-btn ui-btn-sm" aria-pressed="${relayoutCandidate?.retained === true}"><i class="fa-${relayoutCandidate?.retained ? 'solid' : 'regular'} fa-heart" aria-hidden="true"></i><span>${relayoutCandidate?.retained ? '已保留' : '保留这版'}</span></button>
                <button type="button" id="theater-dream-confirm-chapter" class="ui-btn ui-btn-sm ui-btn-primary"><i class="fa-solid fa-check" aria-hidden="true"></i><span>用第 ${reviewVersion} 版继续</span></button>
            </div>
            <div class="theater-dream-review-more">
                <span class="theater-dream-review-more-label">都不满意？</span>
                <div class="theater-dream-candidate-actions${manualLayoutSource(relayoutCandidate, true) ? ' has-relayout' : ''}">
                    <button type="button" id="theater-dream-regenerate-draft" class="ui-btn ui-btn-sm theater-dream-regenerate" title="按原要求再生成一版；成功后未保留候选仅留最新三版，已保留版本不被替换"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>再来一版</span></button>
                    <button type="button" id="theater-dream-revise-draft" class="ui-btn ui-btn-sm theater-dream-regenerate" title="修改要求再生成；成功后未保留候选仅留最新三版，已保留版本不被替换"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>改要求重写</span></button>
                    ${dreamRelayoutButton(relayoutCandidate, 'candidate')}
                </div>
            </div>
            <p class="theater-dream-retention-note">采用后，点过「保留这版」的其他版本也会收进本章，随时可以回看。</p>
            ${state.draftCandidates.some(candidate => candidate.retained) ? longDreamKeptVersionsHTML(dream) : ''}
        </div>
    </section></div>` : '';
    return `<div class="theater-dream-detail theater-dream-continuation" data-id="${runtime.esc(dream.id)}">
        ${writeFlow}${reviewFlow}
        <section class="theater-dream-memory-workspace" data-dream-continuation-bottom="memory"><div class="theater-dream-memory-workspace-body"><section class="theater-dream-memory-status ${dream.memory?.status === LONG_DREAM_MEMORY_STATUS.FAILED ? 'is-failed' : ''}"><div class="theater-dream-memory-status-copy"><span><i class="fa-solid fa-route"></i> 梦脉织录</span><b>${runtime.esc(longDreamMemoryStatusText(dream))}</b><small>只处理已确认章节；使用独立副 API，不影响正文线路。</small></div><button type="button" id="theater-dream-weave-now" class="ui-btn ui-btn-sm" ${dream.memory?.status === LONG_DREAM_MEMORY_STATUS.WEAVING || (!(dream.memory?.pendingChapterNumbers?.length) && !(dream.source?.kind === 'history-folder' && dream.memory?.summaryNeedsRefresh)) || runtime.refreshingLongDreamSummaries.has(String(dream.id)) ? 'disabled' : ''}><i class="fa-solid fa-wand-magic-sparkles"></i><span>立即织录</span></button>${dream.source?.kind === 'history-folder' && dream.seriesMemoryAutoWeave === true && (dream.memory?.status === LONG_DREAM_MEMORY_STATUS.WEAVING || runtime.refreshingLongDreamSummaries.has(String(dream.id))) ? '<button type="button" class="ui-btn ui-btn-sm" id="theater-dream-stop-series">停止后续批次</button>' : ''}</section>${longDreamMemoryCardsHTML(dream)}</div></section>
    </div>`;
}
// @theater-source-end longDreamDetailHTML

// @theater-source-begin longDreamKeptVersionsHTML
function longDreamKeptVersionsHTML(dream, chapter = null) {
    const candidates = chapter ? [chapter, ...(chapter.retainedVersions || [])] : (dream.draft?.candidates || []);
    const rows = candidates.map((item, index) => ({ item, index })).filter(({ item }) => chapter || item.retained);
    if (chapter && candidates.length < 2) return '';
    return `<section class="theater-dream-kept-versions"><h4>${chapter ? '本章版本' : '已保留的版本'}${chapter ? '' : `<small>${rows.length} 版</small>`}</h4>
        ${rows.length ? rows.map(({ item, index }) => `<div class="theater-dream-kept-row"><span>第 ${item.versionNumber || index + 1} 版${chapter && index === 0 ? ' · 续写采用' : ''}${!chapter && index === dream.draft.selectedCandidateIndex ? '<small class="theater-dream-kept-current">当前查看</small>' : ''}</span>
            <button type="button" class="ui-btn ui-btn-sm" ${chapter ? `data-dream-retained-read="${index}"` : `data-dream-kept-pick="${index}"`}>阅读</button>
            ${chapter ? `<button type="button" class="ui-btn ui-btn-sm" data-dream-retained-export="${index}">导出</button>` : ''}</div>`).join('') : '<p class="theater-dream-retention-note">读到喜欢的版本时，点一下「保留这版」。</p>'}
        ${chapter ? '<p class="theater-dream-retention-note">阅读其他版本不会改变后续剧情和梦脉。</p>' : ''}</section>`;
}
// @theater-source-end longDreamKeptVersionsHTML

// @theater-source-begin longDreamChapterDirectoryHTML
function longDreamChapterDirectoryHTML(dream) {
    return dream.chapters.map(chapter => {
        const text = chapter.text || runtime.htmlToPlainText(chapter.html || '');
        return `<div class="ia-chapter-row theater-dream-chapter-row"><div class="ia-chapter-copy"><div class="ia-line-title">第 ${chapter.number} 章 · ${runtime.esc(chapter.title || `第 ${chapter.number} 章`)}</div><div class="ia-line-sub">${readableCharCount(text)} 字 · ${runtime.esc(longDreamDate(chapter.createdAt))}</div></div><button type="button" class="ui-btn ui-btn-sm theater-dream-chapter-open ${chapter.number === dream.chapters.length ? 'ui-btn-primary' : ''}" data-dream-open-chapter data-chapter-id="${runtime.esc(chapter.id)}" aria-label="查看第 ${chapter.number} 章"><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>查看</span></button></div>`;
    }).join('');
}
// @theater-source-end longDreamChapterDirectoryHTML

// @theater-source-begin longDreamWorkDetailHTML
function longDreamWorkDetailHTML(dream) {
    const state = longDreamDetailState(dream);
    return `<div class="ia-works-level active theater-dream-detail theater-dream-work-detail" data-id="${runtime.esc(dream.id)}" data-works-level="work">
        <button type="button" class="ia-back theater-dream-back" data-dream-work-back><i class="fa-solid fa-arrow-left"></i><span>返回作品</span></button>
        ${longDreamDetailHeaderHTML(dream)}
        <section class="ui-card theater-dream-chapter-directory is-workspace">
            <div class="ui-title"><span>章节目录 · ${dream.chapters.length} 章</span><button type="button" id="theater-dream-export-current" class="ui-btn ui-btn-sm"><i class="fa-solid fa-file-export"></i> 整本导出</button></div>
            <div class="theater-dream-chapter-list">${longDreamChapterDirectoryHTML(dream)}</div>
        </section>
        <section class="ui-card theater-dream-action-card theater-dream-work-menu">
            <div class="theater-dream-action-heading"><span class="theater-dream-action-icon"><i class="fa-solid fa-sliders"></i></span><span><b>作品菜单</b><small>管理整部作品；相同内容跳过，缺失内容补回，差异版本另存</small></span></div>
            <div class="theater-dream-work-menu-actions">
                <button type="button" id="theater-dream-import-backup" class="theater-dream-fat-btn is-secondary"><i class="fa-solid fa-upload"></i><span>导入 / 恢复</span></button>
                <button type="button" id="${dream.status === 'complete' ? 'theater-dream-reopen' : 'theater-dream-complete'}" class="theater-dream-fat-btn is-primary" ${state.statusControlDisabled ? 'disabled' : ''}><i class="fa-solid ${dream.status === 'complete' ? 'fa-feather-pointed' : 'fa-book-bookmark'}"></i><span>${dream.status === 'complete' ? '重新打开作品' : '标记完结'}</span></button>
                <button type="button" id="theater-dream-delete" class="theater-dream-fat-btn is-danger is-wide" ${state.isGeneratingThisDream || state.hasReviewDraft ? 'disabled' : ''}><i class="fa-solid fa-trash"></i><span>删除作品</span></button>
            </div>
        </section>
    </div>`;
}
// @theater-source-end longDreamWorkDetailHTML

// @theater-source-begin longDreamChapterDetailHTML
function longDreamChapterDetailHTML(dream, chapter) {
    const text = chapter?.text || runtime.htmlToPlainText(chapter?.html || '');
    const locked = !!runtime.longDreamGenerationController?.active || !!runtime.longDreamChapterEditController || !!dream.draft;
    const laterCount = Math.max(0, dream.chapters.length - chapter.number);
    const toolsHidden = window.matchMedia?.('(max-width: 520px)').matches ? ' hidden' : '';
    return `<div class="ia-works-level active theater-dream-detail theater-dream-chapter-detail" data-id="${runtime.esc(dream.id)}" data-chapter-id="${runtime.esc(chapter.id)}" data-works-level="chapter">
        <button type="button" class="ia-back theater-dream-back" data-dream-chapter-back><i class="fa-solid fa-arrow-left"></i><span>返回章节目录</span></button>
        <section class="ui-card theater-dream-chapter-editor">
            <div class="ui-title theater-dream-chapter-heading"><span>第 ${chapter.number} 章 · ${runtime.esc(chapter.title)}</span><span class="theater-dream-chapter-heading-tools"><span class="memory-v2-tag">已保存</span><button type="button" id="theater-dream-chapter-tools-toggle" class="theater-dream-options-trigger theater-dream-chapter-tools-toggle" aria-expanded="${toolsHidden ? 'false' : 'true'}" aria-controls="theater-dream-chapter-tools-panel" aria-label="展开章节工具" title="章节工具"><i class="fa-solid fa-sliders"></i></button></span></div>
            <div id="theater-dream-chapter-tools-panel" class="ia-action-row theater-dream-chapter-editor-actions" role="menu" aria-label="章节工具"${toolsHidden}>
                <button type="button" id="theater-dream-save-chapter" class="ui-btn ui-btn-sm ui-btn-primary" role="menuitem" ${locked ? 'disabled' : ''}><i class="fa-solid fa-check"></i><span>保存编辑</span></button>
                <button type="button" id="theater-dream-export-chapter" class="ui-btn ui-btn-sm" role="menuitem"><i class="fa-solid fa-file-export"></i><span>单章导出</span></button>
                <button type="button" id="theater-dream-read-chapter-fullscreen" class="ui-btn ui-btn-sm" role="menuitem"><i class="fa-solid fa-book-open"></i><span>阅读原排版</span></button>
                ${chapter.html && !isTextOutputMode(chapter.mode) ? '<button type="button" id="theater-dream-read-chapter-plain" class="ui-btn ui-btn-sm" role="menuitem"><i class="fa-solid fa-align-left" aria-hidden="true"></i><span>纯文字阅读</span></button>' : ''}
                ${dreamRelayoutButton(chapter, 'chapter')}
            </div>
            <label class="ia-field"><span>章节标题</span><input id="theater-dream-chapter-edit-title" class="ui-input theater-input" maxlength="80" value="${runtime.esc(chapter.title)}" ${locked ? 'disabled' : ''}></label>
            <label class="ia-field"><span>章节正文</span><textarea id="theater-dream-chapter-edit-text" class="ui-textarea ia-reader theater-textarea" rows="16" ${locked ? 'disabled' : ''}>${runtime.esc(text)}</textarea></label>
            <div id="theater-dream-chapter-edit-status" class="theater-hint">${locked ? '请先处理当前生成或草稿，再编辑正式章节。' : '仅改标题会保留原始 HTML；修改正文时会重新生成阅读排版。'}</div>
        </section>
        ${longDreamKeptVersionsHTML(dream, chapter)}
        <section class="ui-card theater-dream-action-card theater-dream-chapter-operations">
            <div class="theater-dream-action-heading"><span class="theater-dream-action-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span><span><b>章节操作</b><small>从当前章节创建支线，或管理这一章之后的内容</small></span></div>
            <div class="theater-dream-chapter-actions" aria-label="第 ${chapter.number} 章管理">
                ${chapter.number > 1 ? `<button type="button" class="theater-dream-fat-btn is-outline" data-dream-chapter-action="rewrite" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-pen-to-square"></i><span>重写本章</span></button>` : ''}
                <button type="button" class="theater-dream-fat-btn is-primary" data-dream-chapter-action="branch" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-code-branch"></i><span>从此处分支</span></button>
                ${laterCount ? `<button type="button" class="theater-dream-fat-btn is-outline" data-dream-chapter-action="rollback" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-clock-rotate-left"></i><span>回滚上一版</span></button>` : ''}
                ${chapter.number > 1 ? `<button type="button" class="theater-dream-fat-btn is-outline-danger" data-dream-chapter-action="delete-from" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-trash-can"></i><span>删除本章</span></button>` : ''}
            </div>
        </section>
    </div>`;
}
// @theater-source-end longDreamChapterDetailHTML

// @theater-source-begin longDreamUnavailableHTML
function longDreamUnavailableHTML(section) {
    const labels = { definition: '定梦', continue: '续写' };
    return `<div class="theater-dream-empty theater-dream-workspace-empty">
        <i class="fa-regular fa-moon"></i>
        <b>还没有可进入“${labels[section] || '长梦'}”的作品</b>
        <span>先在“作品”中开启一场长梦，再回来继续。</span>
        <button type="button" class="theater-btn primary" data-dream-section="works">前往作品</button>
    </div>`;
}
// @theater-source-end longDreamUnavailableHTML

// @theater-source-begin longDreamPanelHTML
function longDreamPanelHTML() {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    let content = '';

    if (runtime.longDreamWorkspaceSection === 'definition') {
        if (runtime.longDreamView === 'create' || !dream) {
            runtime.longDreamView = 'create';
            content = longDreamCreateHTML();
        } else {
            runtime.longDreamView = 'detail';
            content = longDreamDefinitionHTML(dream);
        }
    } else if (runtime.longDreamWorkspaceSection === 'continue') {
        if (dream) {
            runtime.longDreamView = 'detail';
            content = longDreamDetailHTML(dream);
        } else {
            runtime.longDreamView = 'list';
            content = longDreamUnavailableHTML('continue');
        }
    } else {
        runtime.longDreamWorkspaceSection = 'works';
        if (runtime.longDreamWorkLevel === 'chapter' && dream) {
            const chapter = dream.chapters?.find(item => String(item.id) === String(runtime.activeLongDreamChapterId));
            if (chapter) content = longDreamChapterDetailHTML(dream, chapter);
            else {
                runtime.longDreamWorkLevel = 'detail';
                runtime.activeLongDreamChapterId = null;
                content = longDreamWorkDetailHTML(dream);
            }
        } else if (runtime.longDreamWorkLevel === 'detail' && dream) {
            content = longDreamWorkDetailHTML(dream);
        } else {
            runtime.longDreamView = 'list';
            runtime.longDreamWorkLevel = 'list';
            runtime.activeLongDreamChapterId = null;
            content = longDreamListHTML();
        }
    }

    return longDreamWorkspaceHTML(content, runtime.longDreamWorkspaceSection);
}
// @theater-source-end longDreamPanelHTML

// @theater-source-begin syncLongDreamPanel
function syncLongDreamPanel({ renderDrafts = true } = {}) {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (runtime.longDreamWorkspaceSection === 'definition' && dream) {
        const state = longDreamDetailState(dream);
        $('#theater-dream-refresh-world-book').prop('disabled', runtime.refreshingLongDreamWorldBooks || state.isGeneratingThisDream || state.hasReviewDraft)
            .attr('aria-busy', String(runtime.refreshingLongDreamWorldBooks)).find('span').text(runtime.refreshingLongDreamWorldBooks ? '更新中…' : '更新世界书');
        $('#theater-dream-frozen-count').text(`· ${state.snapshotEntries} 条`);
        $('#theater-dream-frozen-books').text(state.selectedPolicy ? `当前冻结资料库：${state.bookText}` : '当前完全隔离，不读取原世界书');
        $('#theater-dream-save-definition').prop('disabled', state.isGeneratingThisDream || String(runtime.refreshingLongDreamWorldBookId) === String(dream.id));
    }
    if (runtime.longDreamWorkspaceSection === 'continue' && dream) {
        if (renderDrafts) {
            renderLongDreamReviewDraft(dream);
            renderLongDreamProgressCandidate(dream);
        }
        syncLongDreamProgressDisplay();
        runtime.scheduleLongDreamTokenEstimate();
    }
}
// @theater-source-end syncLongDreamPanel

// @theater-source-begin renderLongDreamPanel
function renderLongDreamPanel() {
    const $root = $('#theater-long-dream-root');
    if (!$root.length) return;
    $root.html(longDreamPanelHTML());
    syncLongDreamPanel();
    syncDreamRelayout(runtime);
}
// @theater-source-end renderLongDreamPanel

// @theater-source-begin renderLongDreamProgressCandidate
function renderLongDreamProgressCandidate(dream) {
    const frame = document.getElementById('theater-dream-progress-candidate-frame');
    if (!frame) return;
    const candidates = Array.isArray(dream?.draft?.candidates) ? dream.draft.candidates : [];
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(Number(dream?.draft?.selectedCandidateIndex) || 0)));
    const candidate = candidates[index];
    if (!candidate) return;
    const fallback = document.getElementById('theater-dream-progress-candidate-fallback');
    mountStoryReading({
        frame, fallback,
        notice: frame.closest('[data-dream-progress-pane]').querySelector('[data-story-reading-notice]'),
        html: candidate.html,
        text: candidate.text || undefined,
        canSwitch: !isTextOutputMode(candidate.mode),
        onStoryError: message => runtime.runtimeLog('warn', '小剧场页面脚本出错', { message }),
        fallbackOnBlank: true,
    });
}
// @theater-source-end renderLongDreamProgressCandidate

// @theater-source-begin stopLongDreamProgressTicker
function stopLongDreamProgressTicker() {
    if (runtime.longDreamProgressTicker) clearInterval(runtime.longDreamProgressTicker);
    runtime.longDreamProgressTicker = null;
}
// @theater-source-end stopLongDreamProgressTicker

// @theater-source-begin syncLongDreamProgressDisplay
function syncLongDreamProgressDisplay() {
    const progress = runtime.longDreamGenerationController?.active;
    const status = document.getElementById('theater-dream-generation-status');
    if (!progress || !status || String(runtime.activeLongDreamGenerationId) !== String(runtime.activeLongDreamId)) {
        stopLongDreamProgressTicker();
        return;
    }
    $('#theater-dream-generation-version').text(progress.candidateNumber > LONG_DREAM_MAX_CANDIDATES ? '新版本' : `第 ${progress.candidateNumber || 1} 版`);
    $('#theater-dream-generation-kicker').text(longDreamProgressKickerText(progress));
    $('#theater-dream-generation-label').text(longDreamProgressLabelText(progress));
    $('#theater-dream-progress-elapsed').text(`已等待 ${formatLongDreamElapsed(progress.startedAt)}`);
    $('#theater-dream-progress-chars').text(`约 ${Math.max(0, Number(progress.currentChars) || readableCharCount(runtime.longDreamLiveDraftText)).toLocaleString()} / ${normalizeManualTarget(progress.targetChars).toLocaleString()} 字`);
    $('#theater-dream-progress-round').text(progress.stage === LONG_DREAM_GENERATION_STAGE.RENDERING
        ? '最终排版'
        : (Number(progress.maxRounds) > 1 ? `第 ${Math.max(1, Number(progress.round) || 1)} / ${progress.maxRounds} 轮` : '正文生成'));
    if (!runtime.longDreamProgressTicker) {
        runtime.longDreamProgressTicker = setInterval(() => {
            if (!document.getElementById('theater-dream-generation-status')) {
                stopLongDreamProgressTicker();
                return;
            }
            syncLongDreamProgressDisplay();
        }, 1000);
    }
}
// @theater-source-end syncLongDreamProgressDisplay

// @theater-source-begin renderLongDreamReviewDraft
function renderLongDreamReviewDraft(dream) {
    const draft = dream?.draft;
    if (draft?.status !== LONG_DREAM_DRAFT_STATUS.REVIEW || !draft.html) return;
    const frame = document.getElementById('theater-dream-review-frame');
    if (!frame) return;
    mountStoryReading({
        frame,
        fallback: document.getElementById('theater-dream-review-fallback'),
        notice: frame.closest('.theater-dream-review').querySelector('[data-story-reading-notice]'),
        html: draft.html,
        text: draft.text || undefined,
        canSwitch: !isTextOutputMode(draft.mode),
        onStoryError: message => runtime.runtimeLog('warn', '小剧场页面脚本出错', { message }),
        fallbackOnBlank: true,
    });
}
// @theater-source-end renderLongDreamReviewDraft

Object.assign(ws, { longDreamWorkspaceHTML, longDreamDetailState, longDreamDetailHeaderHTML, refreshLongDreamWorldBookSources, longDreamDefinitionHTML, longDreamDetailHTML, longDreamKeptVersionsHTML, longDreamChapterDirectoryHTML, longDreamWorkDetailHTML, longDreamChapterDetailHTML, longDreamUnavailableHTML, longDreamPanelHTML, syncLongDreamPanel, renderLongDreamPanel, renderLongDreamProgressCandidate, stopLongDreamProgressTicker, syncLongDreamProgressDisplay, renderLongDreamReviewDraft });
return { historyItemHTML, historyTagBadgesHTML, longDreamSources, resolveLongDreamSource, longDreamDate, longDreamExcerpt, longDreamSourceInstructionState, longDreamSourcePreviewHTML, resetLongDreamCanonSuggestions, activeLongDreamCanonSuggestions, longDreamCanonSuggestionCardsHTML, longDreamCanonSuggestionHTML, renderLongDreamCanonSuggestions, findLongDreamCanonSuggestion, captureCurrentLongDreamWorldBooks, longDreamSnapshotEntryCount, longDreamBackupFileName, exportLongDreamZip, chooseExportFormat, exportLongDreamBackup, requestLongDreamExport, readLongDreamZip, importedLongDreamTitle, importLongDreamBackup, readLongDreamChapter, longDreamChapterFileName, exportLongDreamChapter, saveLongDreamChapterEdits, setCurrentLongDreamStatus, longDreamListHTML, longDreamRelationLabel, longDreamRelationChoicesHTML, longDreamSourceWorldBooks, sameWorldBookSelection, longDreamCreateWorldBookStateHTML, refreshLongDreamCreateWorldBookState, longDreamCreateHTML, longDreamGenerationStageText, formatLongDreamElapsed, longDreamProgressStageText, longDreamProgressLabelText, longDreamProgressKickerText, longDreamProgressMetaHTML, selectedLongDreamMemoryApiPreset, longDreamMemoryAnalysisPresets, selectedLongDreamMemoryAnalysisPreset, refreshLongDreamMemoryPresetControls, longDreamMemoryStatusText, longDreamActiveMemoryCount, longDreamSummaryHistoryHTML, toggleLongDreamSummaryPreview, longDreamMemoryConflictTarget, longDreamMemoryConflictSubjects, longDreamMemoryConflictItemText, longDreamMemoryConflictOperationText, longDreamMemoryConflictDetails, longDreamMemoryCardsHTML, longDreamMemorySelectionHTML, refreshLongDreamMemorySelection, longDreamMemoryTags, longDreamMemoryV2Fields, uniqueLongDreamBranchTitle, handleLongDreamChapterAction, longDreamWorkspaceHTML, longDreamDetailState, longDreamDetailHeaderHTML, refreshLongDreamWorldBookSources, longDreamDefinitionHTML, longDreamDetailHTML, longDreamKeptVersionsHTML, longDreamChapterDirectoryHTML, longDreamWorkDetailHTML, longDreamChapterDetailHTML, longDreamUnavailableHTML, longDreamPanelHTML, syncLongDreamPanel, renderLongDreamPanel, renderLongDreamProgressCandidate, stopLongDreamProgressTicker, syncLongDreamProgressDisplay, renderLongDreamReviewDraft };
}
