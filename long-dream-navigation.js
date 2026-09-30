// long-dream-navigation: receives live state and cross-feature callbacks from index.js.


export function createLongDreamNavigation(runtime) {
// @theater-source-begin normalizeTheaterTab
function normalizeTheaterTab(value) {
    const tab = String(value || '');
    return runtime.THEATER_TAB_NAMES.has(tab) ? tab : 'generate';
}
// @theater-source-end normalizeTheaterTab

// @theater-source-begin longDreamComposerDrafts
function longDreamComposerDrafts() {
    if (!runtime.settings.longDreamComposerDrafts || typeof runtime.settings.longDreamComposerDrafts !== 'object' || Array.isArray(runtime.settings.longDreamComposerDrafts)) {
        runtime.settings.longDreamComposerDrafts = {};
    }
    return runtime.settings.longDreamComposerDrafts;
}
// @theater-source-end longDreamComposerDrafts

// @theater-source-begin getLongDreamComposerDraft
function getLongDreamComposerDraft(dreamId) {
    const draft = longDreamComposerDrafts()[String(dreamId)] || {};
    return {
        instruction: String(draft.instruction || ''),
        title: String(draft.title || ''),
        targetChars: Math.max(500, Math.min(8000, Math.round(Number(draft.targetChars) || 3000))),
    };
}
// @theater-source-end getLongDreamComposerDraft

// @theater-source-begin rememberLongDreamComposerDraft
function rememberLongDreamComposerDraft(dreamId = runtime.activeLongDreamId) {
    if (dreamId === null || dreamId === undefined || !$('#theater-dream-next-instruction').length) return;
    longDreamComposerDrafts()[String(dreamId)] = {
        instruction: String($('#theater-dream-next-instruction').val() || ''),
        title: String($('#theater-dream-next-title').val() || ''),
        targetChars: Math.max(500, Math.min(8000, Math.round(Number($('#theater-dream-next-target').val()) || 3000))),
    };
    runtime.save();
}
// @theater-source-end rememberLongDreamComposerDraft

// @theater-source-begin setLongDreamComposerDraft
function setLongDreamComposerDraft(dreamId, draft = {}) {
    if (dreamId === null || dreamId === undefined) return;
    longDreamComposerDrafts()[String(dreamId)] = {
        instruction: String(draft.instruction || ''),
        title: String(draft.title || ''),
        targetChars: Math.max(500, Math.min(8000, Math.round(Number(draft.targetChars) || 3000))),
    };
    runtime.save();
}
// @theater-source-end setLongDreamComposerDraft

// @theater-source-begin clearLongDreamComposerDraft
function clearLongDreamComposerDraft(dreamId, { forgetTarget = false } = {}) {
    if (dreamId === null || dreamId === undefined) return;
    const targetChars = getLongDreamComposerDraft(dreamId).targetChars;
    if (forgetTarget) delete longDreamComposerDrafts()[String(dreamId)];
    else longDreamComposerDrafts()[String(dreamId)] = { targetChars };
    runtime.save();
}
// @theater-source-end clearLongDreamComposerDraft

// @theater-source-begin rememberLongDreamNavigation
function rememberLongDreamNavigation() {
    runtime.settings.longDreamLastView = runtime.longDreamView === 'detail' ? 'detail' : 'list';
    runtime.settings.longDreamLastId = runtime.longDreamView === 'detail' && runtime.activeLongDreamId !== null
        ? String(runtime.activeLongDreamId)
        : '';
    runtime.settings.longDreamLastSection = ['definition', 'continue', 'works'].includes(runtime.longDreamWorkspaceSection)
        ? runtime.longDreamWorkspaceSection
        : 'works';
    runtime.save();
}
// @theater-source-end rememberLongDreamNavigation

// @theater-source-begin restoreLongDreamNavigation
function restoreLongDreamNavigation() {
    if (runtime.longDreamGenerationController?.active && runtime.activeLongDreamGenerationId !== null) {
        runtime.longDreamView = 'detail';
        runtime.activeLongDreamId = runtime.activeLongDreamGenerationId;
        runtime.longDreamWorkspaceSection = 'continue';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        return;
    }
    const savedId = String(runtime.settings.longDreamLastId || '');
    const savedDream = savedId
        ? runtime.longDreamCache.find(item => String(item.id) === savedId)
        : null;
    if (runtime.settings.longDreamLastView === 'detail' && savedDream) {
        runtime.longDreamView = 'detail';
        runtime.activeLongDreamId = savedDream.id;
        runtime.longDreamWorkspaceSection = ['definition', 'continue', 'works'].includes(runtime.settings.longDreamLastSection)
            ? runtime.settings.longDreamLastSection
            : 'continue';
        runtime.longDreamWorkLevel = runtime.longDreamWorkspaceSection === 'works' ? 'detail' : 'list';
        runtime.activeLongDreamChapterId = null;
        return;
    }
    runtime.longDreamView = 'list';
    runtime.activeLongDreamId = null;
    runtime.longDreamWorkspaceSection = 'works';
    runtime.longDreamWorkLevel = 'list';
    runtime.activeLongDreamChapterId = null;
}
// @theater-source-end restoreLongDreamNavigation

return { normalizeTheaterTab, longDreamComposerDrafts, getLongDreamComposerDraft, rememberLongDreamComposerDraft, setLongDreamComposerDraft, clearLongDreamComposerDraft, rememberLongDreamNavigation, restoreLongDreamNavigation };
}
