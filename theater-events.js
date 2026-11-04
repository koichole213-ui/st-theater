import { bindErrorLibrary } from './error-help-ui.js';
import { bindPromptInspector } from './prompt-inspector-ui.js';
import { bindLayoutRetry } from './layout-retry.js';
import { bindLayoutApi } from './layout-api-settings.js';
import { bindReleaseNotes } from './release-notes.js';
import { bindSummaryEditor } from './long-dream-summary-editor.js';
import { bindSourcePicker } from './long-dream-source-picker.js';
import { bookmarkPlacementFromPoint } from './result-bookmark.js';
import { bindLongDreamEvents } from './theater-events-long-dream.js';
import { bindMaterialEvents } from './theater-events-materials.js';
import { bindResultEvents } from './theater-events-results.js';
import { bindSettingsEvents } from './theater-events-settings.js';

export function createTheaterEvents(runtime) {
// @theater-source-begin bindEvents
function bindEvents() {
    const $d = $(document);
    bindErrorLibrary(document);
    bindSourcePicker($d, runtime);
    bindSummaryEditor($d, runtime);
    bindLayoutApi($d, runtime);
    bindLayoutRetry($d, runtime);
    bindReleaseNotes($d, runtime);
    bindPromptInspector({ document, copyToClipboard: runtime.copyToClipboard, downloadTextContent: runtime.downloadTextContent });
    // 恢复入口最先绑定。即使后续某个功能按钮初始化异常，用户仍能拉取修复。
    $d.off('click.tup').on('click.tup', '#theater-update-btn', runtime.updateExtension);
    $d.off('click.treload').on('click.treload', '#theater-reload-after-update-btn', runtime.confirmReloadAfterUpdate);
    const tokenAffectingSelectors = '#theater-context-range,#theater-read-chat-context,#theater-render-select,#theater-preset-name-select,#theater-style-addon,#theater-nsfw-addon,.theater-preset-check,.theater-wb-check';
    $d.off('change.ttoken').on('change.ttoken', tokenAffectingSelectors, runtime.scheduleTokenEstimate);

    // Tabs
    $d.off('click.tt').on('click.tt', '.theater-tab', function () {
        runtime.activateTheaterTab($(this).data('tab'));
    });
    // ---- Generate ----
    $d.off('click.tg').on('click.tg', '#theater-generate-btn', runtime.generateTheater);
    $d.off('click.tstop').on('click.tstop', '#theater-stop-btn', runtime.stopGeneration);
    $d.off('click.tquickrender').on('click.tquickrender', '#theater-quick-render-toggle', runtime.switchQuickRenderSelection);
    let bookmarkDragged = false;
    let bookmarkDrag = null;
    $d.off('pointerdown.trad').on('pointerdown.trad', '.theater-result-toolbox.is-bookmark .theater-result-actions-toggle', function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        const toolbox = this.closest('.theater-result-toolbox');
        const rect = toolbox.getBoundingClientRect();
        bookmarkDragged = false;
        bookmarkDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            toolbox,
        };
        this.setPointerCapture?.(event.pointerId);
    });
    $d.off('pointermove.trad').on('pointermove.trad', function (event) {
        if (!bookmarkDrag || bookmarkDrag.pointerId !== event.pointerId) return;
        const dx = event.clientX - bookmarkDrag.startX;
        const dy = event.clientY - bookmarkDrag.startY;
        if (!bookmarkDragged && Math.hypot(dx, dy) < 5) return;
        bookmarkDragged = true;
        runtime.closeResultActions();
        bookmarkDrag.toolbox.classList.add('is-dragging');
        bookmarkDrag.toolbox.style.left = `${event.clientX - bookmarkDrag.offsetX}px`;
        bookmarkDrag.toolbox.style.top = `${event.clientY - bookmarkDrag.offsetY}px`;
        event.preventDefault();
    });
    $d.off('pointerup.trad pointercancel.trad').on('pointerup.trad pointercancel.trad', function (event) {
        if (!bookmarkDrag || bookmarkDrag.pointerId !== event.pointerId) return;
        const toolbox = bookmarkDrag.toolbox;
        toolbox.classList.remove('is-dragging');
        if (bookmarkDragged) {
            const placement = bookmarkPlacementFromPoint({ rect: runtime.resultBookmarkRect(), x: event.clientX, y: event.clientY });
            runtime.settings.resultBookmarkSide = placement.side;
            runtime.settings.resultBookmarkYRatio = placement.yRatio;
            runtime.save();
            runtime.positionResultToolbox();
        }
        bookmarkDrag = null;
    });
    $d.off('click.tra').on('click.tra', '.theater-result-actions-toggle', function (event) {
        event.stopPropagation();
        if (bookmarkDragged) {
            bookmarkDragged = false;
            return;
        }
        const $toolbox = $(this).closest('.theater-result-toolbox');
        const open = !$toolbox.hasClass('is-open');
        runtime.closeResultActions();
        $toolbox.toggleClass('is-open', open);
        $(this).attr('aria-expanded', String(open));
    });
    $d.off('click.trac').on('click.trac', '.theater-result-actions .theater-btn', function () {
        const $toolbox = $(this).closest('.theater-result-toolbox');
        $toolbox.removeClass('is-open').find('.theater-result-actions-toggle').attr('aria-expanded', 'false');
    });
    $d.off('click.trao').on('click.trao', function (event) {
        if ($(event.target).closest('.theater-result-toolbox').length) return;
        runtime.closeResultActions();
    });
    $(window).off('resize.tra').on('resize.tra', runtime.positionResultToolbox);
    $d.off('input.tii').on('input.tii', '#theater-instruction', function () {
        if (runtime.continuationSession) runtime.continuationSession.direction = String($(this).val() || '');
        runtime.settings.lastInstruction = $(this).val();
        if (!runtime.continueContext && String($(this).val()) !== runtime.activeInstructionContent) {
            runtime.settings.lastInstructionTags = [];
            runtime.setActiveInstructionTags([], '');
        }
        runtime.save(); runtime.scheduleTokenEstimate();
    });

    // @theater-event-source theater-events-long-dream.js bindLongDreamEvents
    bindLongDreamEvents(runtime, $d);
    // @theater-event-source theater-events-materials.js bindMaterialEvents
    bindMaterialEvents(runtime, $d);
    // @theater-event-source theater-events-results.js bindResultEvents
    bindResultEvents(runtime, $d);
    // @theater-event-source theater-events-settings.js bindSettingsEvents
    bindSettingsEvents(runtime, $d);

}
// @theater-source-end bindEvents

return { bindEvents };
}
