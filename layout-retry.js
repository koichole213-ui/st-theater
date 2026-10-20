const activeRetries = new WeakMap();

// Retry only a retained layout task. Never regenerate the story or store API snapshots.
export async function retryCurrentLayout(runtime) {
    const item = runtime.currentGenerationResult;
    if (!item?.layoutRetry || activeRetries.has(runtime) || runtime.isGenerating || runtime.isPreparingGeneration || runtime.resultEditSnapshot) return false;
    if (runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController || runtime.longDreamCanonSuggestionState?.controller) {
        toastr.info('请先完成或停止长梦当前任务，再重试普通排版');
        return false;
    }
    if (runtime.currentDisplayHtml !== item.html) return false;
    const originalHtml = item.html;
    const retry = item.layoutRetry;
    const controller = new AbortController();
    activeRetries.set(runtime, controller);
    runtime.isGenerating = true;
    runtime.abortController = controller;
    $('#theater-retry-layout-btn').prop('disabled', true).text('排版中…');
    $('#theater-stop-layout-btn').prop('hidden', false);
    $('#theater-quick-render-toggle').prop('disabled', true);
    runtime.updateContinueHint();
    try {
        const result = await runtime.requestFinalRenderedHtml({ ...retry,
            ctx: SillyTavern.getContext(), signal: controller.signal,
            apiRoute: runtime.captureGenerationApiRoute(SillyTavern.getContext()),
            metricScope: 'final-render-retry' });
        if (controller.signal.aborted || runtime.currentGenerationResult !== item || item.html !== originalHtml) return false;
        const updated = { ...item, html: result.html, mode: result.mode };
        delete updated.layoutRetry;
        if (!await runtime.storeCurrentResult(updated)) return false;
        const version = runtime.continuationSession?.versions?.find(v => v.html === originalHtml && v.text === retry.sourceText);
        if (version) { version.html = result.html; version.mode = result.mode; }
        runtime.lastGeneratedHtml = result.html;
        runtime.lastGeneratedText = retry.sourceText;
        runtime.currentOutputMode = result.mode;
        runtime.showInIframe(result.html, result.mode);
        toastr.success('排版完成，正文未重新生成');
        return true;
    } catch (error) {
        if (error?.name === 'AbortError') toastr.info('已停止排版，正文仍保留');
        else {
            const issue = runtime.captureRequestIssue(error, { stage: '重新 HTML 排版' });
            runtime.theaterError(runtime.requestFailureMessage('排版失败，正文仍保留', issue));
        }
        return false;
    } finally {
        activeRetries.delete(runtime);
        const ownsUi = !runtime.abortController || runtime.abortController === controller;
        if (ownsUi) {
            runtime.isGenerating = false;
            runtime.abortController = null;
            $('#theater-quick-render-toggle').prop('disabled', false);
        }
        $('#theater-stop-layout-btn').prop('hidden', true);
        $('#theater-retry-layout-btn').prop('disabled', false).text('重试 HTML 排版')
            .prop('hidden', !runtime.currentGenerationResult?.layoutRetry || runtime.currentDisplayHtml !== runtime.currentGenerationResult?.html);
        runtime.updateContinueHint();
    }
}

export function bindLayoutRetry($d, runtime) {
    $d.off('click.tlayoutstop').on('click.tlayoutstop', '#theater-stop-layout-btn', () => activeRetries.get(runtime)?.abort());
    $d.off('click.tlayoutretry').on('click.tlayoutretry', '#theater-retry-layout-btn', () => retryCurrentLayout(runtime));
}
