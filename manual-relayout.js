import { displayedContinuationVersion } from './continuation-session.js';
import { isStagedRenderTarget } from './length-policy.js';
import { normalizeLongDreamRecord } from './long-dream.js';

const jobs = new WeakMap();

export function activeRelayout(runtime) {
    return jobs.get(runtime);
}

export function cancelManualRelayout(runtime) {
    const job = activeRelayout(runtime);
    if (job && !job.saving) job.controller.abort();
}

export function manualLayoutSource(item, dream = false) {
    const source = dream ? item : item?.layoutSource;
    if (!item?.html || !Number.isFinite(source?.targetChars) || !isStagedRenderTarget(source.targetChars)) return null;
    if (typeof source.text !== 'string' || !source.text.trim()) return null;
    return { sourceText: source.text, originalInstruction: (dream ? source.instruction : source.originalInstruction) || '' };
}

export function resultRelayoutTarget(runtime, scope) {
    if (scope === 'read') {
        const item = runtime.readingState?.reading;
        return item?.resultId && !runtime.historyReadingItems && !runtime.resultReader?.isEditing() ? item : null;
    }
    if (runtime.resultEditSnapshot) return null;
    const html = runtime.currentDisplayHtml;
    const version = displayedContinuationVersion(runtime.continuationSession, html);
    if (scope === 'continuation') return version;
    const item = runtime.currentGenerationResult;
    return !version && item?.html === html ? item : null;
}

function syncButton(runtime, scope, visible) {
    const button = document.querySelector(`[data-relayout="${scope}"]`);
    if (!button) return;
    const job = activeRelayout(runtime);
    const active = job?.scope === scope;
    button.hidden = !visible;
    button.disabled = active ? job.saving || job.controller.signal.aborted : !!job;
    button.textContent = active ? (job.saving ? '保存排版中…' : job.controller.signal.aborted ? '正在停止…' : '停止排版') : '重新排版';
    return button;
}

export function syncResultRelayout(runtime, scope, item) {
    const visible = !!manualLayoutSource(item);
    const button = syncButton(runtime, scope, visible);
    if (scope === 'continuation') button?.parentElement.classList.toggle('has-relayout', visible);
}

export function dreamRelayoutButton(item, scope) {
    if (!manualLayoutSource(item, true)) return '';
    const role = scope === 'chapter' ? ' role="menuitem"' : '';
    return `<button type="button" class="ui-btn ui-btn-sm" data-relayout="${scope}"${role}>重新排版</button>`;
}

export function syncDreamRelayout(runtime) {
    for (const scope of ['candidate', 'chapter']) {
        const button = document.querySelector(`[data-relayout="${scope}"]`);
        if (button) syncButton(runtime, scope, true);
    }
}

export function positionRelayoutMenu(toolbox) {
    const menu = toolbox.querySelector('.theater-result-actions');
    if (!menu) return;
    menu.style.removeProperty('translate');
    if (!menu.querySelector(':is([data-relayout], .theater-plain-reading-menu):not([hidden])')) return;
    const rect = menu.getBoundingClientRect();
    const gutter = 8;
    const overflow = window.innerHeight - gutter - rect.bottom;
    const toggle = toolbox.querySelector('.theater-result-actions-toggle')?.getBoundingClientRect();
    const fitsAbove = toggle && toggle.top - gutter - rect.height >= gutter;
    const shift = overflow < 0 && fitsAbove && toolbox.classList.contains('is-inline-menu')
        ? toggle.top - gutter - rect.bottom
        : Math.max(gutter - rect.top, Math.min(0, overflow));
    if (shift) menu.style.translate = `0 ${shift}px`;
}

function refreshButtons(runtime) {
    runtime.updateContinueHint();
    runtime.resultReader?.refresh();
    syncDreamRelayout(runtime);
}

function resultJobTarget(runtime, scope) {
    const item = resultRelayoutTarget(runtime, scope);
    const source = manualLayoutSource(item);
    if (!source) return null;
    const originalHtml = item.html;
    const sourceRecord = item.layoutSource;
    const canCommit = () => resultRelayoutTarget(runtime, scope) === item
        && item.html === originalHtml && item.layoutSource === sourceRecord
        && (scope === 'read' ? runtime.resultWorkspacePage === 'read' : runtime.resultWorkspacePage !== 'read');
    return {
        source,
        async save({ html, mode }, notAborted) {
            const version = scope === 'continuation' ? item
                : runtime.continuationSession?.versions.find(entry => entry.resultId === item.resultId && entry.html === originalHtml);
            const matches = entry => entry?.resultId === item.resultId && entry?.html === originalHtml;
            const storedItem = scope === 'continuation'
                ? [runtime.currentGenerationResult, ...runtime.recentCache].find(matches) : item;
            const current = runtime.currentGenerationResult;
            const displayed = runtime.currentDisplayHtml === originalHtml
                && (version ? displayedContinuationVersion(runtime.continuationSession, originalHtml) === version : current === item);
            const valid = () => canCommit() && notAborted()
                && (!storedItem || (matches(storedItem) && storedItem.layoutSource === sourceRecord));
            if (storedItem) {
                if (!await runtime.updateResultItem(storedItem, html, mode, { layoutOnly: true, canCommit: valid })) return false;
            } else if (!valid()) return false;
            if (version?.html === originalHtml) Object.assign(version, { html, mode });
            if (displayed && runtime.currentDisplayHtml === originalHtml) {
                runtime.lastGeneratedHtml = html;
                runtime.lastGeneratedText = source.sourceText;
                runtime.currentOutputMode = mode;
                runtime.showInIframe(html, mode);
            }
            runtime.resultReader?.refresh();
            return true;
        },
    };
}

function dreamItem(runtime, scope) {
    const dream = runtime.longDreamCache.find(entry => String(entry.id) === String(runtime.activeLongDreamId));
    if (scope === 'candidate') {
        const draft = dream?.draft;
        if (runtime.longDreamWorkspaceSection !== 'continue' || draft?.status !== 'review') return {};
        const index = draft.selectedCandidateIndex;
        return { dream, index, item: draft.candidates[index] };
    }
    if (runtime.longDreamWorkspaceSection !== 'works' || runtime.longDreamWorkLevel !== 'chapter') return {};
    const index = dream?.chapters.findIndex(chapter => String(chapter.id) === String(runtime.activeLongDreamChapterId));
    return { dream, index, item: dream?.chapters[index] };
}

function dreamMemoryBusy(runtime, dreamId) {
    const key = String(dreamId);
    return runtime.queuedLongDreamMemoryIds?.has(key) || runtime.refreshingLongDreamSummaries?.has(key);
}

function dreamJobTarget(runtime, scope) {
    const original = dreamItem(runtime, scope);
    const item = original.item;
    const source = manualLayoutSource(item, true);
    if (!source) return null;
    return {
        source,
        async save({ html, mode }, notAborted) {
            const latest = dreamItem(runtime, scope);
            if (!notAborted() || latest.dream?.id !== original.dream.id || latest.index !== original.index) return false;
            if (dreamMemoryBusy(runtime, original.dream.id)) {
                toastr.info('梦脉正在更新，原版已保留');
                return false;
            }
            const key = String(original.dream.id);
            const saved = await runtime.updateLongDreamLayout(original.dream.id, dream => {
                if (!notAborted() || dreamMemoryBusy(runtime, key)) return null;
                const { dream: displayedDream, index } = dreamItem(runtime, scope);
                if (String(displayedDream?.id) !== key || index !== original.index) return null;
                // Read older drafts with the same defaults used by the displayed record.
                const normalized = normalizeLongDreamRecord({ ...dream, createdAt: dream.createdAt || original.dream.createdAt });
                const draft = normalized?.draft;
                const entries = scope === 'candidate' ? draft?.candidates : normalized?.chapters;
                if (scope === 'candidate' && (draft?.status !== 'review' || draft.selectedCandidateIndex !== index)) return null;
                const current = entries?.[index];
                if (!current || current.id !== item.id || current.versionNumber !== item.versionNumber || current.createdAt !== item.createdAt
                    || current.text !== item.text || current.html !== item.html || current.instruction !== item.instruction
                    || current.targetChars !== item.targetChars) return null;
                if (scope === 'candidate') {
                    const candidates = entries.slice();
                    candidates[index] = { ...dream.draft.candidates?.[index], ...current, html, mode };
                    return { ...dream, draft: { ...dream.draft, ...draft, html, mode, candidates } };
                }
                const chapters = dream.chapters.slice();
                const chapterIndex = chapters.findIndex(entry => entry?.id === current.id);
                const rawIndex = chapterIndex >= 0 ? chapterIndex : index;
                const raw = chapters[rawIndex];
                if (!raw || raw.html !== current.html || raw.text !== current.text) return null;
                chapters[rawIndex] = { ...raw, html, mode };
                return { ...dream, chapters };
            });
            if (!saved) return false;
            const displayed = dreamItem(runtime, scope);
            if (String(displayed.dream?.id) === key && displayed.index === original.index) {
                if (scope === 'candidate') runtime.renderLongDreamPanel();
                else if (displayed.item && displayed.item.title !== item.title) {
                    const title = document.querySelector('#theater-dream-chapter-edit-title');
                    if (title?.value === item.title) title.value = displayed.item.title;
                    const heading = document.querySelector('.theater-dream-chapter-heading > span:first-child');
                    if (heading) heading.textContent = '第 ' + displayed.item.number + ' 章 · ' + displayed.item.title;
                }
            }
            return true;
        },
    };
}

export async function runManualRelayout(runtime, scope) {
    const dream = scope === 'candidate' || scope === 'chapter';
    const active = activeRelayout(runtime);
    if (active?.scope === scope) {
        cancelManualRelayout(runtime);
        refreshButtons(runtime);
        return false;
    }
    if (active || runtime.isGenerating || runtime.isPreparingGeneration || runtime.resultEditSnapshot
        || runtime.resultReader?.isEditing() || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController
        || runtime.longDreamCandidateSavePending || runtime.longDreamCanonSuggestionState?.controller) {
        toastr.info('请先完成当前任务或文字编辑');
        return false;
    }
    const target = dream ? dreamJobTarget(runtime, scope) : resultJobTarget(runtime, scope);
    if (!target) return false;
    if (dream && dreamMemoryBusy(runtime, runtime.activeLongDreamId)) {
        toastr.info('梦脉正在更新，请完成后再重新排版');
        return false;
    }
    const selection = runtime.resolveRenderSelection(false);
    if (selection.isPlainTextRender) {
        toastr.info('请先选一个 HTML 排版模板');
        return false;
    }
    const controller = new AbortController();
    const job = { controller, scope, saving: false };
    jobs.set(runtime, job);
    runtime.isGenerating = true;
    runtime.abortController = controller;
    if (dream) runtime.longDreamChapterEditController = controller;
    if (scope === 'candidate') runtime.longDreamCandidateSavePending = true;
    const notAborted = () => !controller.signal.aborted;
    try {
        refreshButtons(runtime);
        const ctx = SillyTavern.getContext();
        const result = await runtime.requestFinalRenderedHtml({
            ...target.source, rules: selection.rules, renderLabel: selection.label, ctx, signal: controller.signal,
            apiRoute: runtime.captureGenerationApiRoute(ctx), metricScope: 'manual-relayout', requireIndependentApi: true,
        });
        if (!notAborted()) return false;
        job.saving = true;
        refreshButtons(runtime);
        if (!await target.save(result, notAborted)) return false;
        toastr.success('重新排版完成，原正文已保留');
        return true;
    } catch (error) {
        if (error?.name === 'AbortError' || !notAborted()) return false;
        if (error?.code === 'THEATER_LAYOUT_API_MISSING') {
            toastr.info('请先在设置中启用独立 HTML 排版 API，并绑定有效预设');
        } else {
            const issue = runtime.captureRequestIssue(error, { stage: '重新 HTML 排版' });
            runtime.theaterError(runtime.requestFailureMessage('重新排版失败，原版已保留', issue, { retained: true }), '', { requestIssue: issue, retained: true });
        }
        return false;
    } finally {
        jobs.delete(runtime);
        if (runtime.abortController === controller) {
            runtime.isGenerating = false;
            runtime.abortController = null;
        }
        if (runtime.longDreamChapterEditController === controller) runtime.longDreamChapterEditController = null;
        if (scope === 'candidate') runtime.longDreamCandidateSavePending = false;
        refreshButtons(runtime);
        if (!notAborted()) toastr.info('已停止排版，原版已保留');
    }
}

export function bindManualRelayout($d, runtime) {
    $d.off('click.tmanualrelayout').on('click.tmanualrelayout', '[data-relayout]', function () {
        runManualRelayout(runtime, this.dataset.relayout);
    });
}
