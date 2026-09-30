// theater-result-workspace: receives live state and cross-feature callbacks from index.js.
import { bookmarkPosition, normalizeBookmarkYRatio } from './result-bookmark.js';
import { buildPlainTextHtml, isTextOutputMode, textThemeForOutputMode, textOutputModeForTheme } from './plain-text-renderer.js';
import { readableCharCount } from './text-counter.js';
import { renderSafeIframe } from './safe-renderer.js';
import { animateResultPage, bindResultSwipe } from './result-swipe.js';
import { mountResultReader } from './result-reader.js';

export function createTheaterResultWorkspace(runtime) {
// @theater-source-begin closeResultActions
function closeResultActions() {
    $('.theater-result-toolbox').removeClass('is-open')
        .find('.theater-result-actions-toggle').attr('aria-expanded', 'false');
}
// @theater-source-end closeResultActions

// @theater-source-begin resultBookmarkRect
function resultBookmarkRect() {
    const popup = document.querySelector('.theater-popup');
    return popup?.getBoundingClientRect() || {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
        width: window.innerWidth,
        height: window.innerHeight,
    };
}
// @theater-source-end resultBookmarkRect

// @theater-source-begin positionResultToolbox
function positionResultToolbox() {
    const toolbox = [...document.querySelectorAll('.theater-result-toolbox.is-bookmark')].find(node => node.getClientRects().length && !node.closest('[hidden]'));
    const toggle = toolbox?.querySelector('.theater-result-actions-toggle');
    if (!toolbox || !toggle) return;
    const toggleRect = toggle.getBoundingClientRect();
    const position = bookmarkPosition({
        rect: resultBookmarkRect(),
        side: runtime.settings.resultBookmarkSide,
        yRatio: runtime.settings.resultBookmarkYRatio,
        width: toggleRect.width || 48,
        height: toggleRect.height || 68,
    });
    toolbox.classList.toggle('is-left', position.side === 'left');
    toolbox.classList.toggle('is-right', position.side === 'right');
    toolbox.classList.toggle('is-lower', normalizeBookmarkYRatio(runtime.settings.resultBookmarkYRatio) > 0.68);
    toolbox.style.left = `${Math.round(position.left)}px`;
    toolbox.style.right = 'auto';
    toolbox.style.top = `${Math.round(position.top)}px`;
}
// @theater-source-end positionResultToolbox

// @theater-source-begin applyResultToolboxMode
function applyResultToolboxMode() {
    const $toolbox = $('.theater-result-toolbox');
    const enabled = runtime.settings.resultBookmarkEnabled !== false;
    closeResultActions();
    $toolbox.toggleClass('is-bookmark', enabled)
        .toggleClass('is-inline-menu', !enabled)
        .toggleClass('is-left', enabled && runtime.settings.resultBookmarkSide === 'left')
        .toggleClass('is-right', enabled && runtime.settings.resultBookmarkSide !== 'left')
        .toggleClass('is-lower', enabled && normalizeBookmarkYRatio(runtime.settings.resultBookmarkYRatio) > 0.68)
        .removeClass('is-dragging');
    if (enabled) {
        requestAnimationFrame(positionResultToolbox);
    } else {
        $toolbox.css({ left: '', right: '', top: '' });
    }
}
// @theater-source-end applyResultToolboxMode

// @theater-source-begin extractHtml
function extractHtml(t) {
    if (!t || !t.trim()) return '';
    let m;
    // 代码块里的 HTML
    if ((m = t.match(/```(?:html)?\s*\n?([\s\S]*?)```/))) return m[1].trim();
    // 完整 HTML 文档
    if ((m = t.match(/(<!DOCTYPE[\s\S]*?<\/html>)/i))) return m[1].trim();
    if ((m = t.match(/(<html[\s\S]*?<\/html>)/i))) return m[1].trim();
    // 不完整的 HTML 文档（有开头没结尾，被截断的情况）
    if ((m = t.match(/(<!DOCTYPE[\s\S]*)/i)) && m[1].includes('<body')) return m[1].trim() + '</body></html>';
    if ((m = t.match(/(<html[\s\S]*)/i)) && m[1].includes('<body')) return m[1].trim() + '</body></html>';
    // snow 标签
    if ((m = t.match(/<snow>([\s\S]*?)<\/snow>/i))) { const inner = m[1].match(/```(?:html)?\s*\n?([\s\S]*?)```/); return inner ? inner[1].trim() : m[1].trim(); }
    // 包含 HTML 标签的片段
    if (t.includes('<div') || t.includes('<style') || t.includes('<p') || t.includes('<span')) return t.trim();
    // 纯文字兜底
    const fallback = `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:20px;max-width:480px;margin:0 auto;background:transparent}.card{background:#fafafa;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.1);line-height:1.7;font-size:15px}</style></head><body><div class="card">${t}</div></body></html>`;
    return fallback;
}
// @theater-source-end extractHtml

// @theater-source-begin textFallbackHtml
function textFallbackHtml(text, theme = 'light') {
    return buildPlainTextHtml(text, theme);
}
// @theater-source-end textFallbackHtml

// @theater-source-begin showInIframe
function showInIframe(html, mode = 'html', allowTextFallback = true) {
    const f = document.getElementById('theater-output-frame'); if (!f) return;
    const $textFallback = $('#theater-output-text-fallback');
    const textMode = isTextOutputMode(mode);
    const textTheme = textThemeForOutputMode(mode);
    $textFallback.hide().empty().toggleClass('is-dark', textTheme === 'dark');
    $(f).show();
    runtime.currentDisplayHtml = html;
    runtime.currentOutputMode = mode;
    runtime.updateContinueHint();
    updateRecentNav();
    const sourceText = runtime.htmlToPlainText(html);
    $('#theater-result-characters').text(`约 ${readableCharCount(sourceText).toLocaleString('zh-CN')} 字`);
    if (textMode) runtime.lastGeneratedText = sourceText;
    $('#theater-copy-html-btn span').text(textMode ? '复制文字' : '复制HTML');
    renderSafeIframe(f, html, {
        onWorkspaceSwipe: switchResultWorkspace,
        sourceHasText: !!sourceText,
        // 没有尺寸回报不等于 HTML 没有渲染；复杂模板启动较慢时继续保留丰富预览。
        // 只有 iframe 明确、持续回报正文为空，才切换到父页面纯文字兜底。
        fallbackOnNoReport: false,
        onBlank: allowTextFallback && sourceText ? ({ reason } = {}) => {
            const fallbackReason = reason === 'no-report' ? 'iframe 未回报渲染状态' : 'HTML 正文不可见';
            runtime.runtimeLog('warn', '渲染路径', { path: '父页面纯文字兜底', reason: fallbackReason });
            toastr.warning('生成内容无法正常显示，已切换为纯文字兜底展示');
            runtime.currentOutputMode = textMode ? mode : 'text';
            runtime.lastGeneratedText = sourceText;
            $('#theater-copy-html-btn span').text('复制文字');
            $(f).hide();
            $textFallback
                .toggleClass('is-dark', textThemeForOutputMode(runtime.currentOutputMode) === 'dark')
                .text(sourceText)
                .show();
        } : null,
    });
}
// @theater-source-end showInIframe

// @theater-source-begin closeFullscreenReader
function closeFullscreenReader() {
    const dialog = document.getElementById('theater-reader-overlay');
    if (dialog?.open && typeof dialog.close === 'function') {
        try { dialog.close(); } catch {}
    }
    dialog?.remove();
    $('body').removeClass('theater-reader-open');
    $(document).off('keydown.treader');
}
// @theater-source-end closeFullscreenReader

// @theater-source-begin currentReaderPayload
function currentReaderPayload() {
    const editing = $('#theater-result-text-editor').is(':visible');
    if (editing) {
        const text = $('#theater-result-text-editor').val().trim();
        if (!text) return null;
        const theme = textThemeForOutputMode(runtime.currentOutputMode);
        return {
            html: textFallbackHtml(text, theme),
            mode: textOutputModeForTheme(theme),
            text,
        };
    }
    const html = runtime.lastGeneratedHtml || runtime.currentDisplayHtml;
    if (!html) return null;
    return {
        html,
        mode: runtime.currentOutputMode || 'html',
        text: runtime.htmlToPlainText(html),
    };
}
// @theater-source-end currentReaderPayload

// @theater-source-begin openFullscreenReader
function openFullscreenReader(overridePayload = null) {
    const supplied = overridePayload?.html ? {
        title: String(overridePayload.title || '').trim(),
        html: String(overridePayload.html || ''),
        mode: overridePayload.mode || 'html',
        text: String(overridePayload.text || runtime.htmlToPlainText(overridePayload.html || '')),
    } : null;
    const payload = supplied || currentReaderPayload();
    if (!payload?.html) {
        toastr.warning('还没有可全屏阅读的内容');
        return;
    }
    closeFullscreenReader();
    const textMode = isTextOutputMode(payload.mode);
    const textTheme = textThemeForOutputMode(payload.mode);
    const isNight = textMode && textTheme === 'dark';
    const modeLabel = textMode ? (isNight ? '纯文字 · 暗色夜读' : '纯文字 · 亮色') : 'HTML 小剧场';
    const $overlay = $(`
        <dialog id="theater-reader-overlay" class="theater-reader-overlay${isNight ? ' is-night' : ''}" aria-modal="true" aria-labelledby="theater-reader-title">
            <section class="theater-reader-shell">
                <header class="theater-reader-head">
                    <div class="theater-reader-heading">
                        <span class="theater-reader-kicker"><i class="fa-solid fa-book-open"></i> 沉浸阅读</span>
                        <h2 id="theater-reader-title">千夜浮梦</h2>
                        <span class="theater-reader-mode"></span>
                    </div>
                    <button type="button" class="theater-reader-close" data-theater-reader-close aria-label="退出全屏阅读">
                        <i class="fa-solid fa-compress"></i><span>退出</span>
                    </button>
                </header>
                <div class="theater-reader-canvas">
                    <iframe id="theater-reader-frame" sandbox="" class="theater-reader-frame" title="小剧场全屏阅读内容"></iframe>
                    <div id="theater-reader-text-fallback" class="theater-reader-text-fallback${isNight ? ' is-dark' : ''}" role="document" style="display:none;"></div>
                </div>
                <div class="theater-reader-shortcut">按 Esc 退出阅读</div>
            </section>
        </dialog>`);
    $overlay.find('#theater-reader-title').text(payload.title || '千夜浮梦');
    $overlay.find('.theater-reader-mode').text(modeLabel);
    $('body').append($overlay);
    const readerDialog = $overlay[0];
    let openedInTopLayer = false;
    if (typeof readerDialog?.showModal === 'function') {
        try {
            readerDialog.showModal();
            openedInTopLayer = true;
        } catch (error) {
            runtime.runtimeLog('warn', '全屏阅读顶层弹窗不可用', { message: error?.message || String(error) });
        }
    }
    if (!openedInTopLayer) {
        const fallbackHost = $('.theater-popup').last().closest('dialog')[0];
        if (fallbackHost) fallbackHost.appendChild(readerDialog);
        readerDialog?.setAttribute('open', '');
    }
    $('body').addClass('theater-reader-open');
    $overlay.on('click', '[data-theater-reader-close]', closeFullscreenReader);
    $overlay.on('cancel', event => {
        event.preventDefault();
        closeFullscreenReader();
    });
    $(document).off('keydown.treader').on('keydown.treader', event => {
        if (event.key === 'Escape') closeFullscreenReader();
    });

    const frame = document.getElementById('theater-reader-frame');
    const $fallback = $('#theater-reader-text-fallback');
    renderSafeIframe(frame, payload.html, {
        sourceHasText: !!payload.text,
        fixedHeight: true,
        // 正常阅读区已经验证过同一份 HTML。全屏重载时复杂模板可能来不及在 1 秒内
        // 回报尺寸；不能因此隐藏丰富 HTML。若 iframe 明确回报正文为空，仍会触发兜底。
        fallbackOnNoReport: false,
        onBlank: payload.text ? ({ reason } = {}) => {
            const fallbackReason = reason === 'no-report' ? 'iframe 未回报渲染状态' : 'HTML 正文不可见';
            runtime.runtimeLog('warn', '全屏阅读兜底', { reason: fallbackReason });
            $(frame).hide();
            $fallback.text(payload.text).show();
        } : null,
    });
    setTimeout(() => $overlay.addClass('is-open'), 0);
    $overlay.find('.theater-reader-close').trigger('focus');
}
// @theater-source-end openFullscreenReader

// @theater-source-begin switchResultWorkspace
function switchResultWorkspace(page) {
    const next = page === 'read' ? 'read' : 'generate';
    const changed = runtime.resultWorkspacePage !== next;
    const wrapper = document.querySelector('.theater-panels-wrapper');
    if (wrapper && runtime.resultWorkspacePage !== next) runtime.resultPageScroll[runtime.resultWorkspacePage] = wrapper.scrollTop;
    runtime.resultWorkspacePage = next;
    closeResultActions();
    document.querySelectorAll('[data-result-page]').forEach(node => { node.hidden = node.dataset.resultPage !== next; });
    document.querySelectorAll('[data-result-tab]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.resultTab === next)));
    if (wrapper && changed) wrapper.scrollTop = runtime.resultPageScroll[next];
    if (next === 'read') runtime.resultReader?.refresh();
    if (changed) animateResultPage(document.querySelector(`[data-result-page="${next}"]`), next);
    requestAnimationFrame(positionResultToolbox);
    return changed;
}
// @theater-source-end switchResultWorkspace

// @theater-source-begin initializeResultWorkspace
function initializeResultWorkspace() {
    const root = document.querySelector('[data-result-page="read"]');
    if (!root) return;
    runtime.resultReader?.destroy();
    runtime.resultReader = mountResultReader(root, runtime.readingState, {
        recent: () => runtime.historyReadingItems || runtime.recentCache,
        collection: () => runtime.historyReadingFolderId ? { title: runtime.historyCollections.find(folder => folder.id === runtime.historyReadingFolderId)?.title || '系列阅读', versions: runtime.historyReadingVersions() } : null,
        chooseVersion: id => runtime.chooseHistoryReadingVersion(id),
        exitCollection: () => { runtime.historyReadingItems = null; runtime.historyReadingFolderId = null; runtime.readingState.reading = runtime.recentCache[0] || null; },
        render: renderSafeIframe,
        swipe: switchResultWorkspace,
        text: runtime.htmlToPlainText,
        isText: isTextOutputMode,
        plainHtml: (text, mode) => textFallbackHtml(text, textThemeForOutputMode(mode)),
        warn: message => toastr.warning(message), success: message => toastr.success(message),
        copy: runtime.copyToClipboard, save: runtime.saveToHistory, fullscreen: openFullscreenReader,
        position: positionResultToolbox,
        update: runtime.updateResultItem,
        continue: item => {
            if (runtime.isGenerating || runtime.isPreparingGeneration || runtime.resultEditSnapshot) { toastr.warning('请先完成当前生成或文字编辑'); return; }
            runtime.startContinue(item.html, item.tags, { sourceLabel: item.title || '阅读中的小剧场', sourceRounds: item.continuationRounds, sourceItem: item });
        },
        remove: async item => {
            const { Popup } = SillyTavern.getContext();
            if (!await Popup.show.confirm('移除当前阅读结果？', '只移除最近生成副本，已保存的历史作品不受影响。')) return false;
            return runtime.queueResultStorage(async () => {
                const next = runtime.recentCache.filter(entry => entry !== item);
                if (!await runtime.recentPersist(next, runtime.currentGenerationResult)) return false;
                runtime.recentCache = next;
                return true;
            });
        },
    });
    const nav = document.querySelector('.theater-result-subnav');
    // Replace handlers on popup rebuild rather than accumulate document listeners.
    nav.onclick = event => {
        const button = event.target.closest('[data-result-tab]');
        if (button) switchResultWorkspace(button.dataset.resultTab);
    };
    nav.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        switchResultWorkspace(event.key === 'ArrowRight' ? 'read' : 'generate');
        nav.querySelector(`[data-result-tab="${runtime.resultWorkspacePage}"]`)?.focus();
    };
    runtime.resultSwipeCleanup?.();
    runtime.resultSwipeCleanup = bindResultSwipe(root.closest('[data-panel="generate"]'), switchResultWorkspace);
    applyResultToolboxMode();
    switchResultWorkspace(runtime.resultWorkspacePage);
}
// @theater-source-end initializeResultWorkspace

// @theater-source-begin updateRecentNav
function updateRecentNav() {
    $('#theater-recent-nav').hide();
    runtime.resultReader?.refresh();
    requestAnimationFrame(positionResultToolbox);
}
// @theater-source-end updateRecentNav

// @theater-source-begin displayedRecentIndex
function displayedRecentIndex(html = runtime.currentDisplayHtml || runtime.lastGeneratedHtml) {
    if (!html) return -1;
    if (runtime.recentCache[runtime.recentIndex]?.html === html) return runtime.recentIndex;
    return runtime.recentCache.findIndex(item => item?.html === html);
}
// @theater-source-end displayedRecentIndex

// @theater-source-begin showRecentResult
function showRecentResult(index) {
    if (!runtime.recentCache.length || runtime.resultReader?.isEditing()) return false;
    runtime.recentIndex = Math.min(runtime.recentCache.length - 1, Math.max(0, Number(index) || 0));
    runtime.readingState.reading = runtime.recentCache[runtime.recentIndex];
    runtime.resultReader?.refresh();
    switchResultWorkspace('read');
    return true;
}
// @theater-source-end showRecentResult

// @theater-source-begin setResultEditControls
function setResultEditControls(editing) {
    $('#theater-edit-result-btn, #theater-delete-result-btn, #theater-continue-btn').toggle(!editing);
    $('#theater-save-edit-btn, #theater-cancel-edit-btn').toggle(editing);
    runtime.updateContinueHint();
}
// @theater-source-end setResultEditControls

// @theater-source-begin cancelResultEdit
function cancelResultEdit() {
    const snapshot = runtime.resultEditSnapshot;
    if (snapshot?.saving) { toastr.warning('正在保存文字修改，请稍等'); return; }
    $('#theater-result-text-editor').hide().val('');
    runtime.resultEditSnapshot = null;
    setResultEditControls(false);
    if (!snapshot) return;
    runtime.lastGeneratedHtml = snapshot.html;
    runtime.lastGeneratedText = snapshot.text;
    runtime.currentOutputMode = snapshot.mode;
    showInIframe(snapshot.html, snapshot.mode);
    toastr.info('已退出编辑，原正文和排版没有改变');
}
// @theater-source-end cancelResultEdit

// @theater-source-begin clearDisplayedResult
function clearDisplayedResult() {
    runtime.lastGeneratedHtml = '';
    runtime.lastGeneratedText = '';
    runtime.currentDisplayHtml = '';
    runtime.currentOutputMode = 'html';
    runtime.recentIndex = 0;
    const frame = document.getElementById('theater-output-frame');
    if (frame) frame.srcdoc = '';
    $('#theater-output-text-fallback').hide().empty();
    $('#theater-result-text-editor').hide().val('');
    $('#theater-output-section').hide();
    runtime.resultEditSnapshot = null;
    setResultEditControls(false);
    updateRecentNav();
    runtime.updateContinueHint();
}
// @theater-source-end clearDisplayedResult

return { closeResultActions, resultBookmarkRect, positionResultToolbox, applyResultToolboxMode, extractHtml, textFallbackHtml, showInIframe, closeFullscreenReader, currentReaderPayload, openFullscreenReader, switchResultWorkspace, initializeResultWorkspace, updateRecentNav, displayedRecentIndex, showRecentResult, setResultEditControls, cancelResultEdit, clearDisplayedResult };
}
