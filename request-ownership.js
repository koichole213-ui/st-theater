// Request-local observers may publish only while they own the diagnostic view.
// Auxiliary checks keep local metrics even when a creative task owns that view.
const owners = new WeakMap();

export function beginRequestDiagnostics(runtime, {
    context = runtime.lastRequestContext,
    metrics = runtime.lastRequestMetrics,
    auxiliary = false,
} = {}) {
    const record = { context, metrics, issue: null, response: null, connection: null };
    let open = true;
    const busy = () => runtime.isGenerating || runtime.isPreparingGeneration
        || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController
        || runtime.longDreamCanonSuggestionState?.controller;
    const selected = !auxiliary || !busy();
    if (selected) {
        owners.set(runtime, record);
        runtime.lastRequestContext = context;
        runtime.lastRequestMetrics = metrics;
        runtime.lastRequestIssue = null;
        runtime.lastApiResponseSummary = null;
        runtime.lastApiConnectionSummary = null;
        if (auxiliary) runtime.lastRequestTrace = null;
    }
    const current = () => open && selected && owners.get(runtime) === record
        && runtime.lastRequestContext === context && runtime.lastRequestMetrics === metrics
        && (!auxiliary || !busy());
    return {
        metrics, record, current,
        publish(changes) {
            if ('lastRequestIssue' in changes) record.issue = changes.lastRequestIssue;
            if ('lastApiResponseSummary' in changes) record.response = changes.lastApiResponseSummary;
            if ('lastApiConnectionSummary' in changes) record.connection = changes.lastApiConnectionSummary;
            if (current()) Object.assign(runtime, changes);
        },
        finish() { open = false; },
    };
}
