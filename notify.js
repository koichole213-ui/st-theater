import { errorHelpHTML, errorCopyText } from './error-help-ui.js';
import { fallbackCopy } from './clipboard.js';

let dialogToastSequence = 0;

function showManualErrorCopy(text, host) {
    host.querySelector(':scope > .theater-error-copy-dialog')?.close();
    const dialog = document.createElement('dialog');
    dialog.className = 'theater-error-copy-dialog';
    dialog.setAttribute('aria-label', '手动复制问题信息');
    dialog.innerHTML = `
        <div class="theater-error-help">
            <b>手动复制一下</b>
            <p>长按文本框，全选 → 复制。</p>
            <textarea readonly spellcheck="false" aria-label="可复制的问题信息"></textarea>
            <div class="teh-actions">
                <button type="button" data-error-select>全选</button>
                <button type="button" data-error-close>关闭</button>
            </div>
        </div>`;
    const textarea = dialog.querySelector('textarea');
    textarea.value = text;
    const select = () => {
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
    };
    dialog.querySelector('[data-error-select]').addEventListener('click', select);
    dialog.querySelector('[data-error-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    host.appendChild(dialog);
    dialog.showModal();
    select();
}

async function copyIssue(event, issue, version, time, root, host) {
    event.stopPropagation();
    const status = root.querySelector('[data-error-status]');
    const text = errorCopyText(issue, { version, time });
    if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            status.textContent = '已复制问题信息（不含正文或凭证）';
            return;
        } catch { /* Try the selection-based copy available in local HTTP sessions. */ }
    }
    const button = root.querySelector('[data-error-copy]');
    if (fallbackCopy(text, host)) {
        status.textContent = '已复制问题信息（不含正文或凭证）';
        button.focus();
    } else if (root.isConnected) {
        button.focus();
        showManualErrorCopy(text, host);
    }
}

export function theaterError(message, title = '', opts = {}) {
    const text = String(message || '');
    const { requestIssue, retained, openDiagnostics, version, ...toastOptions } = opts;
    const dialog = requestIssue ? [...document.querySelectorAll('dialog[open]:not(.theater-manual-copy-overlay, .theater-error-copy-dialog)')].at(-1) : null;
    const host = dialog || document.body;
    const dialogOptions = requestIssue ? { target: host, containerId: dialog
        ? dialog.dataset.theaterErrorToastId || (dialog.dataset.theaterErrorToastId = 'theater-error-toasts-' + ++dialogToastSequence)
        : 'theater-error-toasts-body', positionClass: 'theater-error-toast-layer' } : {};
    const toast = toastr.error(requestIssue ? errorHelpHTML(requestIssue, { retained, actions: true, version }) : text, requestIssue ? '' : title,
        { timeOut: requestIssue ? 0 : 7000, extendedTimeOut: requestIssue ? 0 : 2000, closeButton: !!requestIssue, tapToDismiss: !requestIssue, escapeHtml: false, ...toastOptions, ...dialogOptions });
    if (requestIssue && toast?.[0]) {
        const root = toast[0];
        const time = new Date();
        root.classList.add('theater-request-error-toast');
        root.parentElement.classList.add('theater-error-toast-layer');
        root.querySelector('.toast-close-button')?.setAttribute('aria-label', '关闭报错提示');
        root.querySelector('[data-error-diagnostics]')?.addEventListener('click', event => {
            event.stopPropagation();
            openDiagnostics?.();
        });
        root.querySelector('[data-error-copy]')?.addEventListener('click', event => copyIssue(event, requestIssue, version, time, root, host));
        root.querySelector('details')?.addEventListener('click', event => event.stopPropagation());
    }
    console.error('[Theater]', title || 'Error', text);
}
