import { assertHtmlIntegrity, recoverHtmlText } from '../html-integrity.js';
import { errorHelpHTML, errorCatalogHTML, bindErrorLibrary } from '../error-help-ui.js';
import { statusError } from '../api-response.js';
import { showModelPicker } from '../model-picker.js';
import { syncContextExclusionDraft } from '../context-exclusion-ui.js';
import { beginApiFormRequest, apiChannelSettingsHTML, readApiChannelFields, syncApiChannelForm, bindApiChannelSettings } from '../api-channel-settings.js';
import { captureIndependentConfig, channelConfigError, channelFields, apiChannel, API_CHANNELS } from '../api-channels.js';
import { beginVertexRequest } from '../vertex-credentials.js';
import { createIndependentRequest, checkVertexCredential } from '../independent-request.js';
import { promptInspectorHTML, bindPromptInspector, refreshPromptInspector } from '../prompt-inspector-ui.js';
import { beginRequestDiagnostics } from '../request-ownership.js';
import { beginPromptInspection, recordSentInspection } from '../prompt-inspector.js';
import { longDreamPromptPlacement } from '../long-dream-payload.js';
import { normalizeManualTarget } from '../length-policy.js';
import { longDreamWritingPlan } from '../long-dream-generation.js';
import { resolveTheaterPreset } from '../preset-compat.js';
import { BAIBAI_MEMORY_HINTS, baiBaiChatId, readBaiBaiMemory } from '../baibai-memory.js';
import { chatContextSettingsHTML, refreshBaiBaiMemoryStatus, bindBaiBaiMemoryUpdates } from '../baibai-memory-ui.js';
import { filterStoryOutput, finalStoryOutput, FORMAT_RECOVERY_NOTICE, STORY_OUTPUT_RULE } from '../story-output.js';
import { bindLayoutRetry } from '../layout-retry.js';
import { captureLayoutApiSelection, resolveLayoutApiRoute } from '../layout-api.js';
import { bindLayoutApi } from '../layout-api-settings.js';
import { bindReleaseNotes, releaseNotesHTML, latestReleaseVersion, hasUnreadRelease } from '../release-notes.js';
import { creativeEnhancementPrompt } from '../creative-enhancement.js';
import { pendingManualStoryEntries, hasPendingManualSummary } from '../long-dream-story-summary.js';
import { summaryEditorHTML, bindSummaryEditor } from '../long-dream-summary-editor.js';
import { isHistoryItemExpanded, historyFiltersHTML } from '../history-ui.js';
import { normalizeRoleSources, captureHistoryRoles, matchesRoleFilter, historyRoleOptions, ROLE_UNASSIGNED } from '../history-roles.js';
import { closeHistoryMenus } from '../history-menus.js';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

let implementation;

// Existing behavioral fixtures execute selected production functions in an isolated
// browser sandbox. Follow relocation markers to read those exact function bodies;
// do not change the moved code or replace it with a test implementation.
export function readTheaterImplementation() {
    if (implementation) return implementation;
    const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const sourceGroups = JSON.parse(readFileSync(new URL('./production-source-map.json', import.meta.url), 'utf8'));
    const expanded = entry.replace(/^\/\/ @theater-source-group (\d+)\n/gm, (_, key) => sourceGroups[key]);
    implementation = expanded.replace(/^\/\/ @theater-source (\S+) (\w+)$/gm, (_, file, name) => {
        const module = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        const begin = `// @theater-source-begin ${name}\n`;
        const end = `// @theater-source-end ${name}`;
        const start = module.indexOf(begin);
        const finish = module.indexOf(end, start);
        if (start < 0 || finish < 0) throw new Error(`Missing production function: ${file}:${name}`);
        let code = module.slice(start + begin.length, finish).replace(/^export /gm, '').trimEnd();
        code = code.replace(/^    \/\/ @theater-event-source (\S+) (\w+)\n    \2\(runtime, \$d\);$/gm, (_, partFile, partName) => {
            const part = readFileSync(new URL(`../${partFile}`, import.meta.url), 'utf8');
            const open = `export function ${partName}(runtime, $d) {\n`;
            const at = part.indexOf(open);
            if (at < 0) throw new Error(`Missing event binder: ${partFile}:${partName}`);
            return part.slice(at + open.length, part.lastIndexOf('\n}')).trimEnd();
        });
        return code;
    });
    return implementation;
}

// A factory receives live bindings to the same sandbox state used by the older
// fixtures. This preserves their assertions about writes, identity and failures.
export function runInNewContext(code, sandbox = {}, options) {
    Object.assign(sandbox, { finalStoryOutput, FORMAT_RECOVERY_NOTICE });
    sandbox.lastRequestIssue ??= null; sandbox.lastRequestMetrics ??= null; sandbox.isGenerating ??= false;
    Object.assign(sandbox, { errorHelpHTML, errorCatalogHTML, bindErrorLibrary, statusError, assertHtmlIntegrity, recoverHtmlText });
    // Real imported helpers used by relocated production bodies. Fixtures remain synthetic.
    Object.assign(sandbox, { BAIBAI_MEMORY_HINTS, baiBaiChatId, readBaiBaiMemory, chatContextSettingsHTML, refreshBaiBaiMemoryStatus, bindBaiBaiMemoryUpdates, presentModelPicker: showModelPicker, syncContextExclusionDraft, beginApiFormRequest, beginVertexRequest, captureIndependentConfig, channelConfigError, channelFields, apiChannel, API_CHANNELS, apiChannelSettingsHTML, readApiChannelFields, syncApiChannelForm, bindApiChannelSettings, createIndependentRequest, checkVertexCredential, beginRequestDiagnostics, promptInspectorHTML, bindPromptInspector, refreshPromptInspector, beginPromptInspection, recordSentInspection, longDreamPromptPlacement, normalizeManualTarget, longDreamWritingPlan, resolveTheaterPreset, filterStoryOutput, STORY_OUTPUT_RULE, captureLayoutApiSelection, resolveLayoutApiRoute, bindLayoutApi, bindLayoutRetry, bindReleaseNotes, releaseNotesHTML, latestReleaseVersion, hasUnreadRelease, creativeEnhancementPrompt, hasPendingManualSummary, pendingManualStoryEntries, summaryEditorHTML, bindSummaryEditor, isHistoryItemExpanded, historyFiltersHTML, normalizeRoleSources, captureHistoryRoles, matchesRoleFilter, historyRoleOptions, ROLE_UNASSIGNED, closeHistoryMenus, ...sandbox });
    if (!sandbox.SillyTavern) sandbox.SillyTavern = { getContext: () => ({}) };
    const context = createContext(sandbox);
    const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const bindings = entry.slice(entry.indexOf('const runtime = {'), entry.indexOf('\n};', entry.indexOf('const runtime = {')) + 3);
    // Compile the production accessors in the fixture's lexical environment, so
    // they can also see its top-level let/const declarations, not only properties.
    sandbox.runtime = runInContext(bindings.replace('const runtime = ', '(').replace(/;$/, ')'), context);
    return runInContext(code, context, options);
}
