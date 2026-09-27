import { createHtmlTextEdit, readingPosition } from './result-text-edit.js';
import { readableCharCount } from './text-counter.js';

export function readerPaneHTML(lamp = '') {
    const actions = [['save', 'bookmark', '保存'], ['copy', 'copy', '复制HTML'], ['fullscreen', 'expand', '全屏阅读'],
        ['continue', 'forward', '续写'], ['edit', 'pen-to-square', '编辑文字'], ['remove', 'trash-can', '移除结果']];
    return `<section class="theater-workspace-page" data-result-page="read" hidden>
        <div class="theater-reader-recent-nav" aria-label="最近生成翻篇">
            <button type="button" class="theater-recent-arrow" data-reader-prev aria-label="上一篇">‹</button>
            <span data-reader-count>0 / 0</span>
            <button type="button" class="theater-recent-arrow" data-reader-next aria-label="下一篇">›</button>
        </div>
        <p class="theater-hint-inline theater-reader-retained" data-reader-retained hidden>这篇已移出最近三篇，仍为你保留在当前页面；可以继续读或保存，切换后不再留在列表中。</p>
        <p class="theater-empty" data-reader-empty>暂无已完成的小剧场</p>
        <div class="theater-section" data-reader-result hidden>
            <div class="theater-result-head"><label class="theater-label">阅读</label></div>
            <div class="theater-result-meta-row"><div class="theater-result-toolbox is-inline-menu">
                <div id="theater-reading-actions" class="theater-btn-row theater-result-actions" role="menu" aria-label="阅读结果操作">
                    ${actions.map(([action, icon, label]) => `<button type="button" data-reader-action="${action}" class="theater-btn${action === 'remove' ? ' danger-soft' : ''}" role="menuitem"><i class="fa-solid fa-${icon}"></i><span>${label}</span></button>`).join('')}
                </div>
                <button type="button" class="theater-result-actions-toggle" aria-expanded="false" aria-controls="theater-reading-actions" aria-label="阅读结果操作" title="阅读结果操作；可上下拖动并吸附左右页边">
                    <span class="theater-result-bookmark-lamp">${lamp}</span><span class="theater-result-bookmark-label">操作</span>
                    <span class="theater-result-bookmark-grip" aria-hidden="true"><i></i><i></i><i></i></span><span class="theater-result-inline-more" aria-hidden="true">•••</span>
                </button>
            </div></div>
            <div class="theater-result-character-count" data-reader-characters></div>
            <iframe class="theater-iframe" data-reader-frame sandbox="" title="已完成的小剧场"></iframe>
            <div class="theater-reader-editor" hidden>
                <p class="theater-hint-inline" data-reader-edit-hint></p>
                <textarea class="theater-textarea" data-reader-text rows="12" aria-label="编辑阅读页正文"></textarea>
                <div class="theater-btn-row"><button type="button" class="theater-btn primary" data-reader-apply>应用修改</button><button type="button" class="theater-btn" data-reader-cancel>退出编辑</button></div>
            </div>
        </div>
    </section>`;
}

// This controller never reads or writes the generation page's output variables.
export function mountResultReader(root, state, options) {
    const controller = new AbortController();
    const find = selector => root.querySelector(selector);
    let renderedItem = null, renderedHtml = null, edit = null, saving = false;
    const warn = message => options.warn(message);
    function refresh() {
        const recent = options.recent();
        if (!state.reading) state.reading = recent[0] || null;
        const pos = readingPosition(state.reading, recent);
        find('[data-reader-count]').textContent = pos.retained ? '当前保留篇' : `${pos.index < 0 ? 0 : pos.index + 1} / ${pos.count}`;
        find('[data-reader-retained]').hidden = !pos.retained;
        find('[data-reader-prev]').disabled = !!edit || saving || pos.index <= 0;
        find('[data-reader-next]').disabled = !!edit || saving || !recent.length || pos.index === recent.length - 1;
        find('[data-reader-empty]').hidden = !!state.reading;
        find('[data-reader-result]').hidden = !state.reading;
        if (!state.reading || edit) return;
        const item = state.reading;
        find('[data-reader-action="copy"] span').textContent = options.isText(item.mode) ? '复制文字' : '复制HTML';
        if (renderedItem === item && renderedHtml === item.html) return;
        renderedItem = item; renderedHtml = item.html;
        const sourceText = options.text(item.html);
        find('[data-reader-characters]').textContent = `约 ${readableCharCount(sourceText).toLocaleString('zh-CN')} 字`;
        options.render(find('[data-reader-frame]'), item.html, { sourceHasText: !!sourceText, fallbackOnNoReport: false, onWorkspaceSwipe: options.swipe });
    }
    function leaveEdit() {
        edit = null;
        find('.theater-reader-editor').hidden = true;
        find('[data-reader-frame]').hidden = false;
        find('[data-reader-text]').value = '';
        refresh();
    }
    root.addEventListener('click', async event => {
        const button = event.target.closest('button');
        if (!button || !root.contains(button) || button.disabled) return;
        if (saving) return;
        const recent = options.recent();
        if (button.matches('[data-reader-prev],[data-reader-next]')) {
            if (edit) return;
            const index = recent.indexOf(state.reading);
            const next = Math.max(0, Math.min(recent.length - 1, index + (button.matches('[data-reader-next]') ? 1 : -1)));
            state.reading = recent[next] || null;
            refresh(); options.position(); return;
        }
        if (button.matches('[data-reader-cancel]')) { leaveEdit(); return; }
        if (button.matches('[data-reader-apply]')) {
            if (!edit) return;
            try {
                const value = find('[data-reader-text]').value;
                if (!value.trim()) throw new Error('正文不能为空，修改仍留在编辑框中。');
                const html = edit.htmlEdit ? edit.htmlEdit.apply(value) : options.plainHtml(value, edit.item.mode);
                saving = true;
                if (await options.update(edit.item, html, edit.item.mode) === false) return;
                leaveEdit(); options.success('文字修改已应用，原有排版已保留');
            } catch (error) { warn(error.message); }
            finally { saving = false; refresh(); }
            return;
        }
        const action = button.dataset.readerAction;
        if (!action || !state.reading) return;
        const toolbox = button.closest('.theater-result-toolbox');
        toolbox?.classList.remove('is-open');
        toolbox?.querySelector('.theater-result-actions-toggle')?.setAttribute('aria-expanded', 'false');
        if (edit) { warn('请先应用修改或退出编辑'); return; }
        const item = state.reading;
        try {
            if (action === 'edit') {
                const htmlEdit = options.isText(item.mode) ? null : createHtmlTextEdit(item.html);
                edit = { item, htmlEdit };
                find('[data-reader-text]').value = htmlEdit?.text ?? options.text(item.html);
                find('[data-reader-edit-hint]').textContent = htmlEdit ? '保留原 HTML 排版；请保持行数，只修改行内文字。' : '修改当前这篇的正文。';
                find('[data-reader-frame]').hidden = true;
                find('.theater-reader-editor').hidden = false;
                refresh();
            } else if (action === 'save') await options.save(item);
            else if (action === 'copy') options.copy(options.isText(item.mode) ? options.text(item.html) : item.html);
            else if (action === 'fullscreen') options.fullscreen(item);
            else if (action === 'continue') options.continue(item);
            else if (action === 'remove') {
                saving = true;
                if (await options.remove(item)) { state.reading = options.recent()[0] || null; refresh(); }
                saving = false; refresh();
            }
        } catch (error) { saving = false; warn(error.message); }
    }, { signal: controller.signal });
    refresh();
    return { refresh, isEditing: () => !!edit || saving, destroy: () => controller.abort() };
}
