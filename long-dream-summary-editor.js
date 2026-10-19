import { mergeStoryResponse, saveStorySummary, validStoryEntries, pendingManualStoryEntries } from './long-dream-story-summary.js';
import { summaryRevision } from './long-dream-summary.js';
import { summaryUnavailableReason } from './long-dream-summary-ui.js';

const drafts = new WeakMap();
export function saveManualStorySummary(record, entries, revision, now = new Date()) {
    const reason = summaryUnavailableReason(record);
    if (reason) throw new Error(reason);
    if (!record.chapters.length) throw new Error('还没有可以编辑概要的已保存章节。');
    if (summaryRevision(record) !== revision) throw new Error('正文或梦脉已发生变化，请保留输入内容，取消后重新打开编辑。');
    // Full validation first: no partial save, truncation, or API request.
    return saveStorySummary(record, mergeStoryResponse(record, entries, { replace: true }).map(entry => ({ ...entry, editedByUser: true })), now);
}

export function summaryEditorHTML(runtime, dream) {
    const draft = drafts.get(runtime);
    const pending = pendingManualStoryEntries(dream);
    if (!draft || draft.key !== String(dream.id)) return pending.length ? '<p class="theater-dream-summary-note">梦脉事实有变更，手改概要已保留，暂不用于续写。请点击“编辑概要”核对保存，或“更新概要”重新整理全篇。</p>' : '';
    return `<div class="theater-dream-summary-manual-editor">
        <label>编辑章节<select ${draft.saving ? 'disabled' : ''} class="ui-select" data-dream-summary-chapter aria-label="选择要编辑概要的章节">${dream.chapters.map(chapter => `<option value="${chapter.number}" ${chapter.number === draft.chapter ? 'selected' : ''}>第 ${chapter.number} 章 · ${runtime.esc(chapter.title || '未命名章节')}</option>`).join('')}</select></label>
        <label>本章概要<textarea ${draft.saving ? 'disabled' : ''} class="ui-textarea" data-dream-summary-text aria-label="本章概要" rows="6" maxlength="1200">${runtime.esc(draft.texts[draft.chapter] || '')}</textarea></label>
        <p class="theater-dream-summary-note">可切换章节逐章修改，每章最多 1200 字符。保存不调用 API，后续新增章节会保留这些概要；主动重新整理全篇时会替换它们，并保留最近版本。</p>
        <p class="theater-dream-summary-editor-message" role="status" aria-live="polite"></p>
        <div class="theater-dream-summary-actions"><button type="button" ${draft.saving ? 'disabled' : ''} data-dream-summary-cancel>取消</button><button type="button" ${draft.saving ? 'disabled' : ''} data-dream-summary-save>保存修改</button></div>
    </div>`;
}

export function bindSummaryEditor($d, runtime) {
    const current = () => runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    const mounted = element => $(element).closest('.theater-dream-memory-state-editor');
    $d.off('click.tdsummaryedit').on('click.tdsummaryedit', '[data-dream-summary-edit]', function () {
        const dream = current(), key = String(dream?.id);
        const reason = summaryUnavailableReason(dream, runtime.refreshingLongDreamSummaries.has(key));
        if (reason || !dream?.chapters.length) { toastr.info(reason || '还没有已保存章节'); return; }
        const existing = drafts.get(runtime);
        if (!existing || existing.key !== key) {
            const entries = [...validStoryEntries(dream), ...pendingManualStoryEntries(dream)];
            drafts.set(runtime, { key, revision: summaryRevision(dream), chapter: 1,
                texts: Object.fromEntries(entries.map(entry => [entry.chapterNumber, entry.text])), saving: false });
        }
        mounted(this).find('[data-dream-summary-editor-mount]').html(summaryEditorHTML(runtime, dream));
        mounted(this).find('[data-dream-summary-text]').trigger('focus');
    });
    $d.off('input.tdsummarytext').on('input.tdsummarytext', '[data-dream-summary-text]', function () {
        const draft = drafts.get(runtime);
        if (draft && draft.key === String(runtime.activeLongDreamId) && !draft.saving) draft.texts[draft.chapter] = String($(this).val() || '');
    });
    $d.off('change.tdsummarychapter').on('change.tdsummarychapter', '[data-dream-summary-chapter]', function () {
        const draft = drafts.get(runtime);
        if (!draft || draft.key !== String(runtime.activeLongDreamId) || draft.saving) return;
        draft.chapter = Number($(this).val());
        mounted(this).find('[data-dream-summary-text]').val(draft.texts[draft.chapter] || '');
    });
    $d.off('click.tdsummarycancel').on('click.tdsummarycancel', '[data-dream-summary-cancel]', function () {
        const draft = drafts.get(runtime);
        if (!draft || draft.key !== String(runtime.activeLongDreamId) || draft.saving) return;
        drafts.delete(runtime); mounted(this).find('[data-dream-summary-editor-mount]').empty();
        mounted(this).find('[data-dream-summary-edit]').trigger('focus');
    });
    $d.off('click.tdsummarysave').on('click.tdsummarysave', '[data-dream-summary-save]', async function () {
        const draft = drafts.get(runtime), dream = current(), root = mounted(this);
        if (!draft || !dream || draft.key !== String(dream.id) || draft.saving) return;
        const message = root.find('.theater-dream-summary-editor-message');
        const reason = summaryUnavailableReason(dream, runtime.refreshingLongDreamSummaries.has(draft.key));
        if (reason) { message.text(reason); return; }
        let updated;
        try {
            updated = saveManualStorySummary(dream, dream.chapters.map(chapter => ({ chapterNumber: chapter.number, text: draft.texts[chapter.number] || '' })), draft.revision);
        } catch (error) {
            const text = error?.code === 'LONG_DREAM_SUMMARY_EMPTY_ENTRY' ? '每个已保存章节都需要概要，请补全空白章节后再保存。'
                : error?.code === 'LONG_DREAM_SUMMARY_ENTRY_TOO_LONG' ? '单章概要最多 1200 字符，请缩短后再保存。' : error.message;
            message.text(text); return;
        }
        draft.saving = true;
        root.find('.theater-dream-summary-manual-editor :is(button,textarea,select)').prop('disabled', true);
        try {
            const saved = await runtime.longDreamPut(updated);
            if (!saved) throw new Error('not saved');
            if (drafts.get(runtime) === draft) drafts.delete(runtime);
            if (String(runtime.activeLongDreamId) === draft.key) {
                runtime.rememberLongDreamComposerDraft();
                const positions = [...document.querySelectorAll('.theater-panels-wrapper'), document.scrollingElement].filter(Boolean).map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
                runtime.renderLongDreamPanel();
                positions.forEach(({ node, top, left }) => { if (node.isConnected) { node.scrollTop = top; node.scrollLeft = left; } });
                document.querySelector('[data-dream-summary-edit]')?.focus({ preventScroll: true });
            }
            toastr.success('概要修改已保存，正文和人物关系保持不变');
        } catch {
            message.text('概要保存失败，输入内容已保留，请重试。');
        } finally {
            draft.saving = false;
            if (drafts.get(runtime) === draft && String(runtime.activeLongDreamId) === draft.key) $('.theater-dream-summary-manual-editor :is(button,textarea,select)').prop('disabled', false);
        }
    });
}
