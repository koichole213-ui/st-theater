import { clearSafeIframe, renderSafeIframe } from './safe-renderer.js';
import { htmlCandidate, recoverHtmlText } from './html-integrity.js';

function storyReadingText(html, doc = globalThis.document) {
    if (!doc?.createElement) return recoverHtmlText(html);
    const source = doc.createElement('template');
    source.innerHTML = htmlCandidate(html);
    const content = source.content;
    content.querySelectorAll('title,script,style,noscript,template,svg,select,textarea').forEach(node => node.remove());
    content.querySelectorAll('br,p,div,section,article,li,h1,h2,h3,h4,h5,h6,tr,blockquote').forEach(node => {
        node.after(doc.createTextNode('\n'));
    });
    return content.textContent.replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function storyReadingNoticeHTML() {
    return '<p class="theater-story-reading-notice" data-story-reading-notice hidden><span role="status">这一页的互动出错了，点不动的话可以改用纯文字阅读。</span> <button type="button">纯文字阅读</button></p>';
}

export function mountStoryReading({
    frame, fallback, notice, button, modeLabel, html, text = storyReadingText(html),
    canSwitch = true, startPlain = false, fallbackOnBlank = false, render = renderSafeIframe,
    renderOptions, onStoryError, onBlank,
}) {
    let plain = false;
    let editing = false;
    let hasError = false;
    const canRead = !!text?.trim();
    const originalMode = modeLabel?.textContent;

    function updateView() {
        frame.hidden = editing || plain;
        fallback.hidden = editing || !plain;
        if (notice) notice.hidden = editing || plain || !hasError;
        if (modeLabel) modeLabel.textContent = plain ? '纯文字' : originalMode;
        if (button) {
            button.textContent = plain ? '恢复原排版' : '纯文字阅读';
            button.hidden = editing || !canRead || !canSwitch;
        }
    }

    function showText() {
        plain = true;
        fallback.textContent = text;
        fallback.scrollTop = 0;
        updateView();
        clearSafeIframe(frame);
    }

    function showHtml() {
        plain = false;
        hasError = false;
        updateView();
        render(frame, html, {
            sourceHasText: canRead,
            fallbackOnNoReport: false,
            ...renderOptions,
            onBlank: canRead && (fallbackOnBlank || onBlank) ? event => {
                onBlank?.(event);
                showText();
            } : null,
            onStoryError: canRead && canSwitch ? message => {
                onStoryError?.(message);
                if (hasError) return;
                hasError = true;
                updateView();
            } : null,
        });
    }

    if (button) button.onclick = () => {
        if (!canRead || editing) return;
        if (plain) showHtml();
        else showText();
    };
    const noticeButton = notice?.querySelector('button');
    if (noticeButton) noticeButton.onclick = () => {
        if (!canRead || editing || plain) return;
        showText();
        fallback.focus();
    };
    if (startPlain && canRead && canSwitch) showText();
    else showHtml();
    return {
        setEditing(value) {
            editing = value;
            updateView();
        },
        clear() {
            clearSafeIframe(frame);
            if (button) { button.onclick = null; button.hidden = true; }
            if (noticeButton) { noticeButton.onclick = null; notice.hidden = true; }
            fallback.hidden = true;
            fallback.textContent = '';
        },
    };
}
