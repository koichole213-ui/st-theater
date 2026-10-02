// theater-popup-controller: receives live state and cross-feature callbacks from index.js.
import { closeHistoryMenus } from './history-menus.js';
import { waitForPopupElements } from './popup-lifecycle.js';

export function createTheaterPopupController(runtime) {
// @theater-source-begin activateTheaterTab
function activateTheaterTab(tabName, { persist = true, resetScroll = true } = {}) {
    closeHistoryMenus();
    const tab = runtime.normalizeTheaterTab(tabName);
    $('.theater-tab').removeClass('active');
    $(`.theater-tab[data-tab="${tab}"]`).addClass('active');
    $('.theater-panel').removeClass('active');
    $(`.theater-panel[data-panel="${tab}"]`).addClass('active');
    if (tab === 'history' && document.getElementById('theater-history-list')?.hasAttribute('data-pending-list')) runtime.refreshHistList();
    if (persist) {
        runtime.settings.lastTheaterTab = tab;
        runtime.save();
    }
    if (resetScroll) {
        const panels = document.querySelector('.theater-panels-wrapper');
        if (panels) panels.scrollTop = 0;
    }
    if (tab === 'diagnostics') runtime.renderRuntimeLog();
    if (tab === 'long-dream') runtime.renderLongDreamPanel();
}
// @theater-source-end activateTheaterTab

// @theater-source-begin openTheaterPopup
async function openTheaterPopup() {
    runtime.restoreLongDreamNavigation();
    const initialTab = runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController
        ? 'long-dream'
        : runtime.normalizeTheaterTab(runtime.settings.lastTheaterTab);
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(runtime.buildPopupHTML(initialTab), POPUP_TYPE.TEXT, '', { wide: true, okButton: '关闭', allowVerticalScrolling: true });
    const session = {};
    runtime.activeTheaterPopupSession = session;
    let closed = false;
    const isCurrentPopup = () => !closed && runtime.activeTheaterPopupSession === session;
    const onPopupClosed = () => {
        closed = true;
        if (runtime.activeTheaterPopupSession !== session) return;
        runtime.activeTheaterPopupSession = null;
        runtime.closeInstructionActionMenus();
        closeHistoryMenus();
        runtime.resultSwipeCleanup?.();
        runtime.resultSwipeCleanup = null;
        runtime.resultReader?.destroy();
        if (runtime.instructionSweepCleanup) {
            runtime.instructionSweepCleanup();
            runtime.instructionSweepCleanup = null;
        }
        runtime.detachHistoryTouchMoveHandler();
        runtime.resetHistorySelectionGesture();
        runtime.resetLongDreamCanonSuggestions();
        runtime.closeFullscreenReader();
    };
    const p = popup.show();
    // 关窗立即清理交互，不等待仍在途的预设/世界书读取；旧窗也不能拆掉新窗的监听。
    Promise.resolve(p).then(onPopupClosed, onPopupClosed);
    const popupMounted = await waitForPopupElements(
        id => document.getElementById(id),
        ['theater-preset-name-select', 'theater-wb-books'],
    );
    if (!isCurrentPopup()) return;
    if (!popupMounted) {
        runtime.runtimeLog('error', '小剧场弹窗挂载超时，预设与世界书暂未加载');
        toastr.error('小剧场界面加载超时，请关闭后重试');
        await p;
        return;
    }
    runtime.setBallDot(false);  // 看过了，红点熄灭
    // 搜索框是重建的空框，过滤词也要跟着清，不然看起来"列表少了一截"
    runtime.wbSearch = '';
    runtime.presetSearch = '';
    try {
        runtime.bindEvents();
    } catch (error) {
        console.error('[Theater] Popup event initialization failed:', error);
        runtime.runtimeLog('error', '小剧场按钮初始化失败', { message: String(error?.message || error) });
        toastr.error('小剧场部分按钮初始化失败；更新入口仍可使用，请更新后刷新酒馆');
    }
    runtime.decorateConfigLayout();
    runtime.updateContinueHint();
    if (runtime.histBatchMode) runtime.enterHistBatchMode();
    runtime.applyResultToolboxMode();
    runtime.renderRuntimeLog();
    runtime.syncLongDreamPanel();
    const [worldBookListResult, presetListResult] = await Promise.allSettled([
        runtime.loadWorldBookList(),
        runtime.loadPresetNameList(),
    ]);
    if (!isCurrentPopup()) return;
    if (worldBookListResult.status === 'rejected') {
        console.error('[Theater] World book list initialization failed:', worldBookListResult.reason);
        runtime.runtimeLog('error', '世界书列表初始化失败', { message: String(worldBookListResult.reason?.message || worldBookListResult.reason) });
        $('#theater-wb-books').html('<p class="theater-empty">世界书列表读取失败，请关闭后重试</p>');
    }
    if (presetListResult.status === 'rejected') {
        console.error('[Theater] Preset list initialization failed:', presetListResult.reason);
        runtime.runtimeLog('error', '预设列表初始化失败', { message: String(presetListResult.reason?.message || presetListResult.reason) });
        $('#theater-preset-name-select').empty().append('<option value="">-- 预设列表读取失败，请关闭后重试 --</option>');
    }
    // 世界书：跟随角色卡的话先按当前卡选书，然后把选中的书的条目现读进来
    if (worldBookListResult.status === 'fulfilled') {
        if (runtime.settings.followCharCard) await runtime.applyCharBoundBooks();
        else await runtime.reloadWorldBooks({ silent: true });
    }
    if (!isCurrentPopup()) return;
    // Restore selected preset
    if (presetListResult.status === 'fulfilled' && runtime.settings.selectedPresetName) {
        $('#theater-preset-name-select').val(runtime.settings.selectedPresetName);
        await runtime.loadPresetEntries();
    }
    if (!isCurrentPopup()) return;
    await runtime.refreshTokenEstimate();
    if (!isCurrentPopup()) return;
    // 首帧已按当前导航构建长梦；资料读取完成只更新状态，不重建页面或切回旧标签。
    runtime.refreshLongDreamCreateWorldBookState();
    runtime.syncLongDreamPanel({ renderDrafts: false });
    runtime.longDreamCache.forEach(dream => runtime.queueLongDreamMemoryWeave(dream.id));

    // === 恢复后台生成状态 ===
    if (runtime.isGenerating) {
        // 正在后台生成中：显示流式输出区域和停止按钮
        $('#theater-stream-section').show();
        $('#theater-stream-text').text(runtime.bgStreamText || '后台生成中…');
        $('#theater-generate-btn').hide();
        $('#theater-stop-btn').show();
    } else if (runtime.lastGeneratedHtml || runtime.currentDisplayHtml) {
        const html = runtime.lastGeneratedHtml || runtime.currentDisplayHtml;
        runtime.showInIframe(html, runtime.currentOutputMode);
        $('#theater-output-section').show();
        runtime.updateRecentNav();
    } else if (runtime.currentGenerationResult && !runtime.continuationSession) {
        runtime.lastGeneratedHtml = runtime.currentGenerationResult.html;
        runtime.lastGeneratedText = runtime.htmlToPlainText(runtime.lastGeneratedHtml);
        runtime.showInIframe(runtime.lastGeneratedHtml, runtime.currentGenerationResult.mode || 'html');
        $('#theater-output-section').show();
    }
    runtime.initializeResultWorkspace();

    runtime.updateContinueHint();
    await p;
}
// @theater-source-end openTheaterPopup

return { activateTheaterTab, openTheaterPopup };
}
