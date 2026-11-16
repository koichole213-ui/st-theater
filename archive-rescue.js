import { classifyRequestFailure, createDiagnosticError } from './request-diagnostics.js';
import { theaterError } from './notify.js';
import { escapeBackup } from './backup-ui.js';
import { readableErrorText } from './error-text.js';

const writeMessage = '浏览器已关闭本地存档，这次没有保存。请先下载抢救备份，再刷新页面。';
const notice = '本地存档已被关闭，点此下载抢救备份';

export function archiveClosedError() {
    const error = createDiagnosticError('T-STORAGE-WRITE', { phase: '本地存档' });
    error.message = writeMessage;
    return error;
}

export function archiveWriteFailureDetail(error) {
    if (error?.name === 'AbortError' || error?.name === 'InvalidStateError' || error?.message === 'IndexedDB transaction aborted') {
        return '本地存档操作中断，请先保留页面里的内容。';
    }
    return readableErrorText(error, '浏览器没有说明原因，请先导出备份，再刷新页面。', { context: '本地存档写入失败' });
}

export function createArchiveRescue(runtime, { toast = globalThis.toastr } = {}) {
    let dialog, previousFocus, evidence, busy = false, downloaded = false;
    let result = '', failed = false;
    function renderActions() {
        if (!dialog) return;
        const download = dialog.querySelector('[data-rescue-download]');
        const github = dialog.querySelector('[data-rescue-github]');
        const server = dialog.querySelector('[data-rescue-server]');
        const status = dialog.querySelector('[data-rescue-status]');
        download.disabled = busy;
        if (github) github.disabled = busy;
        if (server) server.disabled = busy;
        download.textContent = downloaded ? '已发起下载，请核对下载记录' : '下载抢救备份';
        status.textContent = result;
        status.hidden = !result;
        status.classList.toggle('theater-archive-rescue-error', failed);
    }
    function addNotice() {
        const doc = globalThis.document;
        const slot = doc?.querySelector('[data-archive-rescue-slot]');
        if (!runtime.archiveClosed || !slot || slot.firstElementChild) return;
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'theater-btn theater-archive-rescue-notice';
        button.textContent = notice;
        button.addEventListener('click', open);
        slot.append(button);
    }
    function open() {
        const doc = globalThis.document;
        if (!runtime.archiveClosed || !doc?.body || dialog) return;
        previousFocus = doc.activeElement;
        const serverAvailable = runtime.backup?.canRescueToServer?.();
        const accountName = serverAvailable && runtime.backup?.serverAccountName?.();
        dialog = doc.createElement('dialog');
        dialog.className = 'theater-organize-dialog theater-backup-dialog theater-archive-rescue';
        dialog.setAttribute('aria-labelledby', 'theater-archive-rescue-title');
        dialog.innerHTML = `<form method="dialog">
            <h2 id="theater-archive-rescue-title" tabindex="-1">本地存档被浏览器关闭了</h2>
            <p class="theater-dialog-note">通常是浏览器清理了这个网站的数据，例如存储空间不足或手动清除了网站数据。</p>
            <p class="theater-dialog-note theater-archive-rescue-warning">页面上现在还留着普通历史 ${evidence.history} 条、长梦 ${evidence.dreams} 部。<strong>刷新或关闭页面后，它们可能就找不回来了。</strong></p>
            <p class="theater-dialog-note">${serverAvailable ? '请先保存到酒馆服务器或下载一份抢救备份，之后用「恢复备份」导回。' : '请先下载一份抢救备份，之后用「恢复备份」导回。'}</p>
            ${accountName ? `<p class="theater-dialog-note">保存到酒馆服务器时，会写入当前账号 <strong>${escapeBackup(accountName)}</strong>。</p>` : ''}
            <footer>${serverAvailable ? '<button type="button" class="theater-btn primary" data-rescue-server>保存到酒馆服务器</button>' : ''}
            <button type="button" class="theater-btn${serverAvailable ? '' : ' primary'}" data-rescue-download>下载抢救备份</button>
            ${runtime.backup?.canRescueToGithub?.() ? '<button type="button" class="theater-btn" data-rescue-github>上传到 GitHub</button>' : ''}
            <button class="theater-btn" value="later">稍后</button></footer>
            <p class="theater-dialog-note" data-rescue-status role="status" hidden></p>
        </form>`;
        const active = dialog;
        active.addEventListener('close', () => {
            active.remove();
            dialog = null;
            if (previousFocus?.isConnected) previousFocus.focus();
        }, { once: true });
        active.querySelector('[data-rescue-download]').addEventListener('click', () => void run('local'));
        active.querySelector('[data-rescue-github]')?.addEventListener('click', () => void run('github'));
        active.querySelector('[data-rescue-server]')?.addEventListener('click', () => void run('server'));
        renderActions();
        doc.body.append(active);
        active.showModal();
        active.querySelector('h2').focus();
    }
    async function run(destination) {
        if (busy) return;
        busy = true;
        result = '正在打包页面里的作品…';
        failed = false;
        renderActions();
        try {
            await runtime.backup.runRescueBackup(destination);
            if (destination === 'local') {
                downloaded = true;
                result = '';
            } else {
                result = destination === 'server' ? '已保存到酒馆服务器，备份校验通过。' : '已上传到 GitHub，备份校验通过。';
            }
        } catch (error) {
            result = error.message || '抢救备份未完成，请重试。';
            failed = true;
        } finally {
            busy = false;
            renderActions();
        }
    }
    function forcedClose(closed) {
        if (runtime.archiveClosed || runtime.idb !== closed) return;
        runtime.archiveClosed = true;
        evidence = {
            at: new Date().toISOString(),
            history: runtime.historyCache?.length || 0,
            dreams: runtime.longDreamCache?.length || 0,
            chapters: (runtime.longDreamCache || []).reduce((sum, dream) => sum + (dream.chapters?.length || 0), 0),
            version: runtime.VERSION || '',
        };
        runtime.runtimeLog?.('error', '本地存档连接被浏览器关闭', evidence);
        try {
            runtime.archiveSafety?.recordForcedClose(evidence);
        } finally {
            addNotice();
            open();
        }
    }
    function reportWriteFailure() {
        if (!runtime.archiveClosed) return false;
        if (globalThis.document?.body && toast === globalThis.toastr) {
            theaterError(writeMessage, '', {
                requestIssue: { ...classifyRequestFailure(archiveClosedError(), { stage: '本地存档' }), archiveClosed: true },
                openDiagnostics: () => runtime.activateTheaterTab?.('diagnostics'),
                version: runtime.VERSION,
            });
        } else {
            toast?.error?.(writeMessage, 'T-STORAGE-WRITE');
        }
        return true;
    }
    return { forcedClose, addNotice, reportWriteFailure, writeFailureDetail: archiveWriteFailureDetail };
}
