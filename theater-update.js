// theater-update: receives live state and cross-feature callbacks from index.js.
import { fetchInstalledExtensionStatus, formatVersionCheckError, fetchLatestRemoteVersion, compareVersion } from './version-check.js';

export function createTheaterUpdate(runtime) {
// @theater-source-begin checkRemoteVersion
async function checkRemoteVersion({ force = false } = {}) {
    const now = Date.now();
    if (runtime.updateCheckPromise) return runtime.updateCheckPromise;
    if (!force && now - runtime.lastUpdateCheckAt < 60000) return;
    runtime.lastUpdateCheckAt = now;
    runtime.updateCheckPromise = (async () => {
        const ctx = SillyTavern.getContext();
        const headers = ctx.getRequestHeaders ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        runtime.installedBranchCheckPending = true;
        const installedCheck = fetchInstalledExtensionStatus({ headers }).then(value => {
            runtime.installedBranchCheckPending = false;
            runtime.installedBranchStatusKnown = true;
            runtime.installedBranchHasUpdate = !value.isUpToDate;
            runtime.installedBranchName = value.branch;
            console.log(`[Theater] installed branch ${runtime.installedBranchName} is ${runtime.installedBranchHasUpdate ? 'behind remote' : 'up to date'}`);
            refreshUpdateBadges();
        }).catch(error => {
            runtime.installedBranchCheckPending = false;
            runtime.installedBranchStatusKnown = false;
            runtime.installedBranchHasUpdate = false;
            runtime.installedBranchName = '';
            console.log('[Theater] installed branch check failed:', formatVersionCheckError(error));
            refreshUpdateBadges();
        });
        const manifestCheck = fetchLatestRemoteVersion().then(value => {
            runtime.latestRemoteVersion = value.version;
            console.log(`[Theater] remote v${runtime.latestRemoteVersion}, local v${runtime.VERSION} (via ${value.host})`);
            refreshUpdateBadges();
        }).catch(error => {
            console.log('[Theater] release version check failed:', formatVersionCheckError(error));
        });
        await Promise.allSettled([installedCheck, manifestCheck]);
    })();
    try {
        await runtime.updateCheckPromise;
    } catch (error) {
        console.log('[Theater] update check failed:', formatVersionCheckError(error));
    } finally {
        runtime.updateCheckPromise = null;
    }
}
// @theater-source-end checkRemoteVersion

// @theater-source-begin hasRemoteUpdate
function hasRemoteUpdate() {
    if (runtime.installedBranchCheckPending && !runtime.installedBranchStatusKnown) return false;
    if (runtime.installedBranchStatusKnown) return runtime.installedBranchHasUpdate;
    return runtime.latestRemoteVersion && compareVersion(runtime.latestRemoteVersion, runtime.VERSION) > 0;
}
// @theater-source-end hasRemoteUpdate

// @theater-source-begin remoteUpdateLabel
function remoteUpdateLabel() {
    return !runtime.installedBranchStatusKnown && runtime.latestRemoteVersion && compareVersion(runtime.latestRemoteVersion, runtime.VERSION) > 0
        ? `发现新版本 v${runtime.latestRemoteVersion}`
        : `当前分支${runtime.installedBranchName ? ` ${runtime.installedBranchName}` : ''} 有新更新`;
}
// @theater-source-end remoteUpdateLabel

// @theater-source-begin updateBadgeHTML
function updateBadgeHTML(className = 'theater-tab-new-badge') {
    return `<span class="${className}" title="${runtime.esc(remoteUpdateLabel())}"></span>`;
}
// @theater-source-end updateBadgeHTML

// @theater-source-begin refreshUpdateBadges
function refreshUpdateBadges() {
    const hasUpdate = hasRemoteUpdate();
    $('.theater-update-badge').remove();
    $('.theater-tab-new-badge').remove();

    $('.theater-update-notice')
        .prop('hidden', !hasUpdate)
        .find('span')
        .text(hasUpdate ? remoteUpdateLabel() : '');

    if (!hasUpdate) return;

    $('#theater-open-btn').append(updateBadgeHTML('theater-update-badge'));
    $('#theater-wand-btn').append(updateBadgeHTML('theater-update-badge'));
    $('#theater-floating-ball').append(updateBadgeHTML('theater-update-badge theater-update-badge-floating'));
    $('.theater-tab[data-tab="config"]').append(updateBadgeHTML('theater-tab-new-badge'));
}
// @theater-source-end refreshUpdateBadges

// @theater-source-begin showReloadAfterUpdateAction
function showReloadAfterUpdateAction() {
    runtime.updateReadyToReload = true;
    $('#theater-reload-after-update-btn, #theater-update-ready-hint').prop('hidden', false);
}
// @theater-source-end showReloadAfterUpdateAction

// @theater-source-begin confirmReloadAfterUpdate
async function confirmReloadAfterUpdate() {
    if (!runtime.updateReadyToReload) return;
    const hasActiveGeneration = runtime.isGenerating || !!runtime.longDreamGenerationController?.active || !!runtime.longDreamChapterEditController || !!runtime.longDreamCanonSuggestionState.controller;
    const detail = hasActiveGeneration
        ? '刷新会立即中断当前仍在进行的生成。已经保存的设置和长梦草稿不会丢失；尚未保存的普通生成内容请先处理。'
        : '页面会立即重新载入以启用刚下载的插件版本。已经保存的设置、历史和长梦不会丢失。';
    const confirmed = await SillyTavern.getContext().Popup.show.confirm('现在刷新酒馆并启用新版本？', detail);
    if (!confirmed) return;
    runtime.runtimeLog('info', '用户确认更新后刷新酒馆', { active_generation: hasActiveGeneration });
    window.location.reload();
}
// @theater-source-end confirmReloadAfterUpdate

// @theater-source-begin updateExtension
async function updateExtension() {
    const btn = $('#theater-update-btn');
    btn.addClass('disabled');
    toastr.info('正在更新…');
    try {
        // 直接走 ST 原生 git pull endpoint（不走 TavernHelper：它的实现可能是先卸载再重装，
        // 卸载失败时会撞 install 的"Directory already exists"409 → 用户卡死。）
        const ctx = SillyTavern.getContext();
        const headers = ctx.getRequestHeaders
            ? ctx.getRequestHeaders()
            : { 'Content-Type': 'application/json' };
        // 先试 user 范围（默认），失败再试 global —— 用户可能装在 system-wide
        const tryUpdate = async (global) => fetch('/api/extensions/update', {
            method: 'POST',
            headers,
            body: JSON.stringify({ extensionName: 'st-theater', global }),
        }).catch(err => ({ ok: false, status: 0, _err: err }));

        let resp = await tryUpdate(false);
        if (!resp.ok && (resp.status === 404 || resp.status === 400)) {
            resp = await tryUpdate(true);
        }

        if (resp.ok) {
            showReloadAfterUpdateAction();
            toastr.success('更新成功！可点击“刷新酒馆并启用”，确认后再刷新。', '', { timeOut: 7000 });
            return;
        }

        // 失败：把后端真实错误显示出来
        let detail = '';
        try { detail = await resp.text?.() || ''; } catch (_) {}
        detail = (detail || resp._err?.message || '').slice(0, 220);
        const tip = (resp.status === 409 || /already exists/i.test(detail))
            ? '插件目录被旧版残留卡住了。请在【扩展管理】卸载本插件，再用 Install from URL 输入 https://github.com/koichole213-ui/st-theater 重新安装（设置不会丢）。'
            : '如遇 Git 冲突或网络问题，可在【扩展管理】卸载后重新安装。';
        runtime.theaterError(`更新失败 (HTTP ${resp.status || 0})\n${detail}\n\n${tip}`, '更新失败');
    } catch (e) {
        runtime.theaterError('更新失败: ' + e.message);
    } finally {
        btn.removeClass('disabled');
    }
}
// @theater-source-end updateExtension

return { checkRemoteVersion, hasRemoteUpdate, remoteUpdateLabel, updateBadgeHTML, refreshUpdateBadges, showReloadAfterUpdateAction, confirmReloadAfterUpdate, updateExtension };
}
