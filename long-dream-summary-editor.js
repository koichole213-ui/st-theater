import { saveStorySummary, validStoryEntries, pendingManualStoryEntries, manualFullSummary, hasPendingManualSummary, snapshotStorySummary, chapterSummarySources } from './long-dream-story-summary.js';
import { summaryRevision } from './long-dream-summary.js';
import { summaryUnavailableReason } from './long-dream-summary-ui.js';

const drafts = new WeakMap();
export function editableSummaryDraft(record) {
    let entries = [...validStoryEntries(record), ...pendingManualStoryEntries(record)].sort((a, b) => a.chapterNumber - b.chapterNumber);
    let full = manualFullSummary(record, true);
    if (!full && !entries.length && record.memory.currentState?.trim()) {
        const through = Math.min(record.chapters.length, record.memory.summaryThroughChapter || record.memory.processedThroughChapter || record.chapters.length);
        full = { text: record.memory.currentState, chapterNumber: through, sources: chapterSummarySources(record.chapters).slice(0, through) };
    }
    // Keep the old whole synopsis whole; never pretend it belongs to chapter one.
    if (full) entries = entries.filter(entry => entry.chapterNumber > full.chapterNumber);
    const texts = Object.fromEntries(entries.map(entry => [String(entry.chapterNumber), entry.text]));
    if (full) texts.full = full.text;
    return { full, chapters: entries.map(entry => entry.chapterNumber), chapter: full ? 'full' : String(entries[0]?.chapterNumber || ''), texts };
}

export function saveManualStorySummary(record, entries, revision, now = new Date(), { fullSummary = null } = {}) {
    const reason = summaryUnavailableReason(record);
    if (reason) throw new Error(reason);
    if (!record.chapters.length) throw new Error('还没有可以编辑概要的已保存章节。');
    if (summaryRevision(record) !== revision) throw new Error('正文或梦脉已发生变化，请保留输入内容，取消后重新打开编辑。');
    const fail = (code, text) => { throw Object.assign(new Error(text), { code: `LONG_DREAM_SUMMARY_${code}` }); };
    if (!Array.isArray(entries)) fail('COVERAGE', '概要记录不完整，请重新打开编辑。');
    const sources = chapterSummarySources(record.chapters), seen = new Set();
    const edited = entries.map(entry => {
        const number = entry.chapterNumber;
        if (!Number.isInteger(number) || number < 1 || number > record.chapters.length || seen.has(number)) fail('COVERAGE', '章节编号无效或重复。');
        seen.add(number);
        if (typeof entry.text !== 'string' || !entry.text.trim()) fail('EMPTY_ENTRY', '本章概要不能为空。');
        if (entry.text.trim().length > 1200) fail('ENTRY_TOO_LONG', '单章概要最多1200字符。');
        return { chapterNumber: number, text: entry.text.trim(), source: sources[number - 1], editedByUser: true };
    });
    let target = record;
    if (fullSummary) {
        if (typeof fullSummary.text !== 'string' || !fullSummary.text.trim()) fail('EMPTY_FULL', '整篇概要不能为空。');
        if (fullSummary.text.length > 100000) fail('LONG_FULL', '整篇概要最多100000字符，原文已保留，请缩短后再保存。');
        const through = fullSummary.chapterNumber;
        if (!Number.isInteger(through) || through < 1 || through > record.chapters.length) fail('COVERAGE', '整篇概要的章节范围无效。');
        target = { ...record, memory: { ...record.memory, currentState: '', summaryVersions: snapshotStorySummary(record, now),
            manualFullSummary: { text: fullSummary.text, chapterNumber: through, sources: sources.slice(0, through) } } };
    }
    const full = manualFullSummary(target);
    const available = [...validStoryEntries(record), ...pendingManualStoryEntries(record)].filter(entry => !full || entry.chapterNumber > full.chapterNumber);
    if (available.some(entry => !seen.has(entry.chapterNumber))) fail('COVERAGE', '已有分章概要缺失，原概要已保留，请重新打开编辑。');
    if (!edited.length && !full) fail('EMPTY_ENTRY', '尚无可保存的概要。');
    return saveStorySummary(target, edited, now);
}

export function summaryEditorHTML(runtime, dream) {
    const draft = drafts.get(runtime);
    const pending = hasPendingManualSummary(dream);
    if (!draft || draft.key !== String(dream.id)) return pending ? '<p class="theater-dream-summary-note">梦脉事实有变更，手改概要已保留，暂不用于续写。请点击“编辑概要”核对保存，或“更新概要”重新整理全篇。</p>' : '';
    return `<div class="theater-dream-summary-manual-editor">
        <label>${draft.full ? '编辑范围' : '编辑章节'}<select ${draft.saving ? 'disabled' : ''} class="ui-select" data-dream-summary-chapter aria-label="选择要编辑的概要">${draft.full ? `<option value="full" ${draft.chapter === 'full' ? 'selected' : ''}>整篇概要 · 截至第 ${draft.full.chapterNumber} 章</option>` : ''}${draft.chapters.map(number => `<option value="${number}" ${String(number) === draft.chapter ? 'selected' : ''}>第 ${number} 章 · ${runtime.esc(dream.chapters.find(chapter => chapter.number === number)?.title || '未命名章节')}</option>`).join('')}</select></label>
        <label>${draft.chapter === 'full' ? '整篇概要' : '本章概要'}<textarea ${draft.saving ? 'disabled' : ''} class="ui-textarea" data-dream-summary-text aria-label="${draft.chapter === 'full' ? '整篇概要' : '本章概要'}" rows="6" maxlength="${draft.chapter === 'full' ? 100000 : 1200}">${runtime.esc(draft.texts[draft.chapter] || '')}</textarea></label>
        <p class="theater-dream-summary-note">${draft.full ? '旧整篇概要会原样带入，不强拆成章节；新增章节若有分章概要，也可在上方选择。' : '可在上方自行选择已有概要的章节，原文会带入编辑框；每章最多 1200 字符。'}保存不调用 API，取消不改内容；保存前保留最近版本。</p>
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
            const content = editableSummaryDraft(dream);
            if (!content.chapter) { toastr.info('尚未生成可编辑的概要，请先更新概要。'); return; }
            drafts.set(runtime, { key, revision: summaryRevision(dream), ...content, saving: false });
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
        draft.chapter = String($(this).val());
        mounted(this).find('[data-dream-summary-editor-mount]').html(summaryEditorHTML(runtime, current()));
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
            updated = saveManualStorySummary(dream, draft.chapters.map(number => ({ chapterNumber: number, text: draft.texts[number] || '' })), draft.revision, undefined,
                { fullSummary: draft.full ? { text: draft.texts.full, chapterNumber: draft.full.chapterNumber } : null });
        } catch (error) {
            const text = error?.code === 'LONG_DREAM_SUMMARY_EMPTY_ENTRY' ? '本章概要不能为空，请保留或修改已有内容后再保存。'
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
