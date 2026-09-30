// long-dream-runtime: receives live state and cross-feature callbacks from index.js.
import { markFirstToken, markCompleted, createRequestMetrics } from './request-metrics.js';
import { readableCharCount } from './text-counter.js';
import { buildLongDreamCanonSuggestionPayload, parseLongDreamCanonSuggestions } from './long-dream-canon-suggestions.js';
import { resolveProtocol, normalizeMaxTokens } from './api-client.js';
import { textOutputModeForTheme } from './plain-text-renderer.js';
import { LONG_DREAM_GENERATION_STAGE, createLongDreamGenerationController } from './long-dream-generation.js';
import { LONG_DREAM_WORLD_LINE_RELATION, LONG_DREAM_DRAFT_STATUS, retainLongDreamDraftCandidate, LONG_DREAM_MEMORY_STATUS, setLongDreamMemoryStatus, applyLongDreamMemoryPatch, discardLongDreamWritingAttempt, clearLongDreamDraft, LONG_DREAM_MAX_CANDIDATES, selectLongDreamDraftCandidate } from './long-dream.js';
import { buildProtagonistAnchor } from './protagonist-anchor.js';
import { DEFAULT_SYSTEM_PROMPT } from './theater-defaults.js';
import { buildLongDreamChapterPayload, buildLongDreamChapterMessages, selectRelevantLongDreamMemoryItems } from './long-dream-payload.js';
import { applyPromptPostProcessing } from './request-layout.js';
import { estimateTokenCount, formatTokenCount } from './token-estimator.js';
import { summaryUnavailableReason } from './long-dream-summary-ui.js';
import { restoreStorySummary } from './long-dream-story-summary.js';
import { refreshLongDreamSummary } from './long-dream-summary.js';
import { requestCustomApi } from './api-runtime.js';
import { diagnosticSignalInfo, REQUEST_DIAGNOSTIC_SIGNAL } from './request-diagnostics.js';
import { shouldWeaveLongDreamMemory, buildLongDreamMemoryPayload, DEFAULT_LONG_DREAM_MEMORY_PRESET, parseLongDreamMemoryResponse } from './long-dream-memory.js';

export function createLongDreamRuntime(runtime) {
// @theater-source-begin requestLongDreamChapter
async function requestLongDreamChapter({
    systemPrompt,
    userPrompt,
    messages,
    postProcessing = '',
    presetName = '',
    signal,
    onChunk,
    apiRoute,
}) {
    const ctx = SillyTavern.getContext();
    try {
        let firstChunkSeen = false;
        const onSafeChunk = cumulativeText => {
            const normalized = runtime.normalizeLongDreamResponseText(cumulativeText);
            if (!firstChunkSeen && normalized.trim()) {
                firstChunkSeen = true;
                markFirstToken(runtime.lastRequestMetrics);
            }
            onChunk(normalized);
        };
        const requestOptions = {
            messages,
            postProcessing,
            presetName: presetName || runtime.settings.selectedPresetName || '内置默认预设',
            tracePurpose: 'creative',
        };
        const result = await runtime.requestConfiguredGenerationApi({
            apiRoute,
            ctx,
            systemPrompt,
            userPrompt,
            onChunk: onSafeChunk,
            signal,
            requestOptions,
            metricScope: 'long-dream',
        });
        const rawText = typeof result === 'string' ? result : result?.text;
        const text = runtime.normalizeLongDreamResponseText(rawText);
        if (!String(text || '').trim()) throw new Error('长梦正文请求没有返回内容');
        markCompleted(runtime.lastRequestMetrics);
        runtime.recordRequestMetrics(runtime.lastRequestMetrics);
        runtime.runtimeLog('info', '长梦正文生成完成', {
            stop_reason: result?.stopReason || 'unknown',
            chars: readableCharCount(text),
        });
        return typeof result === 'string' ? { text } : { ...result, text };
    } catch (error) {
        runtime.recordRequestMetrics(runtime.lastRequestMetrics);
        throw error;
    }
}
// @theater-source-end requestLongDreamChapter

// @theater-source-begin generateLongDreamCanonSuggestions
async function generateLongDreamCanonSuggestions() {
    if (runtime.longDreamCanonSuggestionState.controller) {
        runtime.longDreamCanonSuggestionState.controller.abort();
        return;
    }
    if (runtime.isGenerating || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) {
        toastr.warning('请先完成或停止当前生成，再整理定梦建议');
        return;
    }
    const source = runtime.resolveLongDreamSource($('#theater-dream-source').val());
    if (!source?.text?.trim()) {
        toastr.warning('所选第一章没有可分析的正文');
        return;
    }
    if (runtime.settings.apiMode !== 'main' && (!runtime.settings.apiUrl || !runtime.settings.apiModel)) {
        toastr.warning('请先在【设置】里填好 API URL 和模型；也可以不使用 AI，直接手写定梦');
        return;
    }
    const existingItems = runtime.activeLongDreamCanonSuggestions(source.key);
    if (existingItems.length) {
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            '重新整理定梦建议？',
            '当前建议中的修改和采纳状态会被新结果替换；手写的“此梦设定”不会改变。',
        );
        if (!confirmed) return;
    }

    const payload = buildLongDreamCanonSuggestionPayload({
        sourceTitle: source.title,
        sourceText: source.text,
    });
    runtime.resetLongDreamCanonSuggestions({ abort: false });
    const controller = new AbortController();
    const requestId = ++runtime.longDreamCanonSuggestionState.requestId;
    runtime.longDreamCanonSuggestionState.sourceKey = String(source.key);
    runtime.longDreamCanonSuggestionState.status = 'loading';
    runtime.longDreamCanonSuggestionState.controller = controller;
    runtime.renderLongDreamCanonSuggestions(source.key);
    runtime.clearRequestIssue();
    runtime.lastRequestContext = {
        kind: 'AI 定梦建议',
        sourceChars: payload.sourceChars,
    };
    runtime.lastRequestMetrics = createRequestMetrics(runtime.settings.apiMode === 'main'
        ? 'main:long-dream-canon-suggestions'
        : `custom:${resolveProtocol(runtime.settings.apiProtocol, runtime.settings.apiUrl)}:long-dream-canon-suggestions`);
    runtime.runtimeLog('info', 'AI 定梦建议开始', {
        source: source.kind,
        source_chars: payload.sourceChars,
        api_mode: runtime.settings.apiMode || 'custom',
    });
    try {
        const response = runtime.settings.apiMode === 'main'
            ? await runtime.generateWithMainAPI(
                SillyTavern.getContext(),
                payload.systemPrompt,
                payload.userPrompt,
                () => {},
                false,
                controller.signal,
            )
            : await runtime.callCustomAPIStream(
                payload.systemPrompt,
                payload.userPrompt,
                () => {},
                false,
                controller.signal,
            );
        if (runtime.longDreamCanonSuggestionState.requestId !== requestId) return;
        const items = parseLongDreamCanonSuggestions(response?.text || response);
        runtime.longDreamCanonSuggestionState.items = items;
        runtime.longDreamCanonSuggestionState.status = items.length ? 'ready' : 'empty';
        markCompleted(runtime.lastRequestMetrics);
        runtime.recordRequestMetrics(runtime.lastRequestMetrics);
        runtime.runtimeLog('info', 'AI 定梦建议完成', { suggestions: items.length });
        runtime.renderLongDreamCanonSuggestions(source.key);
        if (items.length) toastr.success(`已整理 ${items.length} 条建议，请逐项核对后决定是否采纳`);
        else toastr.info('AI 没有找到足够可靠的硬事实；你仍可直接手写定梦');
    } catch (error) {
        if (runtime.longDreamCanonSuggestionState.requestId !== requestId) return;
        if (error?.name === 'AbortError') {
            runtime.longDreamCanonSuggestionState.status = 'idle';
            runtime.longDreamCanonSuggestionState.items = [];
            runtime.renderLongDreamCanonSuggestions(source.key);
            toastr.info('已停止整理，手写定梦没有改变');
            return;
        }
        const issue = runtime.captureRequestIssue(error, { stage: 'AI 定梦建议' });
        runtime.longDreamCanonSuggestionState.status = 'error';
        runtime.longDreamCanonSuggestionState.errorSignal = issue.signal;
        runtime.runtimeLog('error', 'AI 定梦建议失败', { signal: issue.signal });
        runtime.renderLongDreamCanonSuggestions(source.key);
        runtime.theaterError(`AI 定梦建议失败：${issue.signal}。你仍可直接手写定梦。`);
    } finally {
        if (runtime.longDreamCanonSuggestionState.requestId === requestId) {
            runtime.longDreamCanonSuggestionState.controller = null;
            runtime.renderLongDreamCanonSuggestions(source.key);
        }
    }
}
// @theater-source-end generateLongDreamCanonSuggestions

// @theater-source-begin renderLongDreamChapter
async function renderLongDreamChapter({ text, originalInstruction = '', signal, apiRoute }) {
    const selection = runtime.resolveRenderSelection(false);
    if (selection.isPlainTextRender) {
        return {
            html: runtime.textFallbackHtml(text, selection.textTheme),
            mode: textOutputModeForTheme(selection.textTheme),
        };
    }
    return runtime.requestFinalRenderedHtml({
        sourceText: text,
        rules: selection.rules,
        originalInstruction,
        ctx: SillyTavern.getContext(),
        signal,
        apiRoute,
        renderLabel: selection.label,
        metricScope: 'long-dream-final-render',
        onChunk: rendered => {
            updateLongDreamRenderProgress({
                receivedChars: String(rendered || '').length,
                repairing: false,
            });
        },
        onRetry: () => updateLongDreamRenderProgress({ receivedChars: 0, repairing: true }),
    });
}
// @theater-source-end renderLongDreamChapter

// @theater-source-begin createCumulativeStreamRenderer
function createCumulativeStreamRenderer(resolveElement, intervalMs = 100) {
    let pendingText = '';
    let timer = null;

    const flush = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const el = typeof resolveElement === 'function' ? resolveElement() : resolveElement;
        if (!el) return;
        const currentText = String(el.textContent || '');
        const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
        if (pendingText.startsWith(currentText)) {
            const delta = pendingText.slice(currentText.length);
            if (delta) el.appendChild(document.createTextNode(delta));
        } else if (currentText !== pendingText) {
            el.textContent = pendingText;
        }
        if (wasNearBottom) el.scrollTop = el.scrollHeight;
    };

    return {
        update(value, { immediate = false } = {}) {
            pendingText = String(value || '');
            if (immediate) {
                flush();
            } else if (!timer) {
                timer = setTimeout(flush, Math.max(0, Number(intervalMs) || 0));
            }
        },
        flush,
        reset({ flushPending = false } = {}) {
            if (flushPending) flush();
            else if (timer) clearTimeout(timer);
            timer = null;
            pendingText = '';
        },
    };
}
// @theater-source-end createCumulativeStreamRenderer

// @theater-source-begin getLongDreamStreamRenderer
function getLongDreamStreamRenderer() {
    if (!runtime.longDreamStreamRenderer) {
        runtime.longDreamStreamRenderer = createCumulativeStreamRenderer(
            () => document.getElementById('theater-dream-generation-text'),
        );
    }
    return runtime.longDreamStreamRenderer;
}
// @theater-source-end getLongDreamStreamRenderer

// @theater-source-begin resetLongDreamStreamRenderer
function resetLongDreamStreamRenderer({ flushPending = false } = {}) {
    getLongDreamStreamRenderer().reset({ flushPending });
    runtime.longDreamStreamFirstChunk = true;
    if (!flushPending) runtime.longDreamLiveDraftText = '';
}
// @theater-source-end resetLongDreamStreamRenderer

// @theater-source-begin updateLongDreamStream
function updateLongDreamStream({ draftText }) {
    runtime.longDreamLiveDraftText = String(draftText || '');
    const immediate = runtime.longDreamStreamFirstChunk && !!String(draftText || '').trim();
    if (immediate) runtime.longDreamStreamFirstChunk = false;
    getLongDreamStreamRenderer().update(draftText, { immediate });
    runtime.syncLongDreamProgressDisplay();
}
// @theater-source-end updateLongDreamStream

// @theater-source-begin resetLongDreamRenderProgress
function resetLongDreamRenderProgress() {
    runtime.longDreamRenderReceivedChars = 0;
    runtime.longDreamRenderRepairing = false;
}
// @theater-source-end resetLongDreamRenderProgress

// @theater-source-begin updateLongDreamRenderProgress
function updateLongDreamRenderProgress({ receivedChars, repairing }) {
    const progress = runtime.longDreamGenerationController?.active;
    if (progress?.stage !== LONG_DREAM_GENERATION_STAGE.RENDERING
        || String(runtime.activeLongDreamGenerationId) !== String(runtime.activeLongDreamId)) return;
    runtime.longDreamRenderReceivedChars = Math.max(0, Number(receivedChars) || 0);
    runtime.longDreamRenderRepairing = repairing === true;
    runtime.syncLongDreamProgressDisplay();
}
// @theater-source-end updateLongDreamRenderProgress

// @theater-source-begin handleLongDreamGenerationState
function handleLongDreamGenerationState({ stage, record }) {
    if (stage === LONG_DREAM_GENERATION_STAGE.RENDERING || stage === LONG_DREAM_GENERATION_STAGE.WRITING) {
        resetLongDreamRenderProgress();
    }
    if (record?.id !== undefined && String(record.id) === String(runtime.activeLongDreamId) && runtime.longDreamView === 'detail') {
        if ([LONG_DREAM_GENERATION_STAGE.WRITING, LONG_DREAM_GENERATION_STAGE.RENDERING, LONG_DREAM_GENERATION_STAGE.REVIEW].includes(stage)) {
            runtime.renderLongDreamPanel();
        } else {
            $('#theater-dream-generation-status').prop('hidden', false);
            $('#theater-dream-generation-label').text(runtime.longDreamGenerationStageText(stage));
        }
        runtime.syncLongDreamProgressDisplay();
    }
}
// @theater-source-end handleLongDreamGenerationState

// @theater-source-begin getLongDreamGenerationController
function getLongDreamGenerationController() {
    if (!runtime.longDreamGenerationController) {
        runtime.longDreamGenerationController = createLongDreamGenerationController({
            requestChapter: requestLongDreamChapter,
            renderChapter: renderLongDreamChapter,
            persistRecord: runtime.longDreamPut,
            onState: handleLongDreamGenerationState,
            onStream: updateLongDreamStream,
        });
    }
    return runtime.longDreamGenerationController;
}
// @theater-source-end getLongDreamGenerationController

// @theater-source-begin resolveLongDreamRequestFoundation
async function resolveLongDreamRequestFoundation(dream) {
    const presetSnapshot = await runtime.ensureSelectedPresetLoaded();
    const ctx = SillyTavern.getContext();
    const identity = runtime.resolveGenerationIdentity(ctx);
    const relation = dream?.inheritance?.worldLineRelation || LONG_DREAM_WORLD_LINE_RELATION.ISOLATED;
    const identitySlots = runtime.generationIdentitySlots(identity, {
        // 完全隔离的 AU 不沿用原作场景，但仍保留 Char 与 User 的人物身份和性格。
        includeScenario: relation !== LONG_DREAM_WORLD_LINE_RELATION.ISOLATED,
    });
    const selectedPresetPrompt = presetSnapshot.prompt;
    const selectedPresetEntries = presetSnapshot.selectedEntries;
    return {
        ctx,
        identitySlots,
        protagonistAnchor: buildProtagonistAnchor({
            userName: identity.name1,
            charName: identity.name2 || identity.character?.name || identity.character?.data?.name,
        }),
        addons: [
            runtime.settings.customStyleAddon?.trim() ? `【文风补充】\n${runtime.settings.customStyleAddon.trim()}` : '',
            runtime.settings.customNsfwAddon?.trim() ? `【NSFW补充】\n${runtime.settings.customNsfwAddon.trim()}` : '',
        ].filter(Boolean).join('\n\n'),
        selectedPresetPrompt,
        presetEntries: selectedPresetEntries.length
            ? selectedPresetEntries
            : [{ id: 'main', role: 'system', content: DEFAULT_SYSTEM_PROMPT }],
        presetName: presetSnapshot.name || '内置默认预设',
        postProcessing: presetSnapshot.postProcessing,
        squashSystemMessages: presetSnapshot.squashSystemMessages,
    };
}
// @theater-source-end resolveLongDreamRequestFoundation

// @theater-source-begin refreshLongDreamTokenEstimate
async function refreshLongDreamTokenEstimate() {
    const valueEl = document.getElementById('theater-dream-token-summary-value');
    const detailsEl = document.getElementById('theater-dream-token-details');
    if (!valueEl || !detailsEl) return;
    const requestId = ++runtime.longDreamTokenEstimateRequestId;
    try {
        const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
        if (!dream) return;
        const instruction = String($('#theater-dream-next-instruction').val() || '');
        const chapterTitle = String($('#theater-dream-next-title').val() || `第 ${dream.chapters.length + 1} 章`);
        const targetChars = Math.max(500, Math.min(8000, Math.round(Number($('#theater-dream-next-target').val()) || 3000)));
        const foundation = await resolveLongDreamRequestFoundation(dream);
        const currentDraft = dream.draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING ? String(dream.draft.text || '') : '';
        const payload = buildLongDreamChapterPayload({
            record: dream,
            preset: foundation.selectedPresetPrompt || DEFAULT_SYSTEM_PROMPT,
            addons: foundation.addons,
            instruction,
            chapterTitle,
            targetChars,
            currentDraft,
            finishThisRound: false,
            maxOptionalContextChars: runtime.LONG_DREAM_OPTIONAL_CONTEXT_CHAR_BUDGET,
            structuredPreset: true,
            continuationRound: !!currentDraft.trim(),
            hasIdentityContext: Object.values(foundation.identitySlots).some(value => String(value || '').trim()),
            protagonistAnchor: foundation.protagonistAnchor,
        });
        const messages = applyPromptPostProcessing(buildLongDreamChapterMessages({
            payload,
            presetEntries: foundation.presetEntries,
            slots: foundation.identitySlots,
            squashSystemMessages: foundation.squashSystemMessages,
        }), foundation.postProcessing);
        const total = messages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);
        const presetTokens = foundation.presetEntries.reduce((sum, entry) => sum + estimateTokenCount(entry.content), 0);
        const identityTokens = Object.values(foundation.identitySlots).reduce((sum, text) => sum + estimateTokenCount(text), 0);
        const worldBookTokens = payload.worldInfoEntries.reduce((sum, entry) => sum + estimateTokenCount(entry.content), 0);
        const continuityTokens = Math.max(0, total - presetTokens - identityTokens - worldBookTokens);
        if (requestId !== runtime.longDreamTokenEstimateRequestId || !document.getElementById('theater-dream-token-summary-value')) return;
        const reference = runtime.LONG_DREAM_OPTIONAL_CONTEXT_CHAR_BUDGET;
        valueEl.textContent = `预计${payload.continuationRound ? '恢复续写轮' : '首轮'}输入约 ${formatTokenCount(total)} Token`;
        detailsEl.textContent = `预设 ${formatTokenCount(presetTokens)} · Char/User ${formatTokenCount(identityTokens)} · 冻结世界书 ${payload.worldInfoEntries.length} 条 / ${formatTokenCount(worldBookTokens)} · 长梦前情与规则 ${formatTokenCount(continuityTokens)}${reference ? ` · 本地参考 ${reference.toLocaleString()} 字符（非模型真实上限）` : ''}`;
    } catch (error) {
        if (requestId !== runtime.longDreamTokenEstimateRequestId) return;
        valueEl.textContent = '预计输入 Token 暂不可用';
        detailsEl.textContent = String(error?.message || error);
    }
}
// @theater-source-end refreshLongDreamTokenEstimate

// @theater-source-begin generateNextLongDreamChapter
async function generateNextLongDreamChapter({ appendCandidate = false, candidateConfig = null } = {}) {
    if (runtime.longDreamCandidateSavePending) return;
    if (String(runtime.refreshingLongDreamWorldBookId) === String(runtime.activeLongDreamId)) {
        toastr.info('请等世界书更新完成后再续写');
        return;
    }
    if (runtime.isGenerating || runtime.isPreparingGeneration) {
        toastr.warning('普通小剧场正在生成，请完成或停止后再续写长梦');
        return;
    }
    if (runtime.longDreamCanonSuggestionState.controller) {
        toastr.warning('AI 定梦建议正在整理，请等待完成或先停止');
        return;
    }
    if (runtime.longDreamChapterEditController) {
        toastr.warning('正式章节正在重新排版，请等待完成');
        return;
    }
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (!dream) return;
    if (dream.status === 'complete') {
        toastr.warning('这部长梦已经完卷');
        return;
    }
    const controller = getLongDreamGenerationController();
    if (controller.active) {
        toastr.warning('已经有一章正在生成');
        return;
    }
    if (dream.draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW && !appendCandidate) {
        toastr.warning('请先确认或放弃当前待确认章节');
        return;
    }
    const composerDraft = runtime.getLongDreamComposerDraft(dream.id);
    const $titleInput = $('#theater-dream-next-title');
    const $instructionInput = $('#theater-dream-next-instruction');
    const $targetInput = $('#theater-dream-next-target');
    const chapterTitle = String((candidateConfig?.title ?? ($titleInput.length ? $titleInput.val() : composerDraft.title))
        || `第 ${dream.chapters.length + 1} 章`).trim();
    const instruction = String(candidateConfig?.instruction ?? ($instructionInput.length ? ($instructionInput.val() || '') : (composerDraft.instruction || '')));
    const targetChars = Math.max(500, Math.min(8000, Math.round(Number(candidateConfig?.targetChars ?? ($targetInput.length ? $targetInput.val() : composerDraft.targetChars)) || 3000)));
    runtime.setLongDreamComposerDraft(dream.id, { chapterTitle, title: chapterTitle, instruction, targetChars });
    let foundation;
    runtime.isPreparingGeneration = true;
    try {
        foundation = await resolveLongDreamRequestFoundation(dream);
    } catch (error) {
        console.error('[Theater] Long dream preparation failed:', error);
        toastr.error(error?.message || '长梦生成资料读取失败，请稍后重试');
        return;
    } finally {
        runtime.isPreparingGeneration = false;
    }
    if (String(runtime.activeLongDreamId) !== String(dream.id) || runtime.longDreamCache.find(item => String(item.id) === String(dream.id)) !== dream || runtime.longDreamCandidateSavePending || controller.active) {
        toastr.info('准备资料期间长梦状态已变化，本次没有开始生成，请重试');
        return;
    }
    const selectedMemoryCount = selectRelevantLongDreamMemoryItems(dream, { instruction, maxItems: 30 }).length;
    const activeMemoryCount = runtime.longDreamActiveMemoryCount(dream);
    runtime.lastRequestContext = {
        kind: '长梦正文',
        presetSource: foundation.selectedPresetPrompt ? '已选酒馆预设' : '内置默认预设',
        character: !!(foundation.identitySlots.charDescription || foundation.identitySlots.charPersonality),
        persona: !!foundation.identitySlots.personaDescription,
        chapterCount: dream.chapters.length,
        memoryCount: selectedMemoryCount,
        activeMemoryCount,
        worldBookBooks: Array.isArray(dream.inheritance?.snapshot?.books) ? dream.inheritance.snapshot.books.length : 0,
        worldBookEntries: runtime.countSnapshotEntries(dream.inheritance?.snapshot),
        styleAddon: !!runtime.settings.customStyleAddon?.trim(),
        nsfwAddon: !!runtime.settings.customNsfwAddon?.trim(),
    };
    runtime.clearRequestIssue();
    runtime.activeLongDreamGenerationId = dream.id;
    resetLongDreamStreamRenderer();
    resetLongDreamRenderProgress();
    const apiRoute = runtime.captureGenerationApiRoute(SillyTavern.getContext());
    runtime.runtimeLog('info', '长梦续章开始', {
        dream_id: String(dream.id),
        chapter_number: dream.chapters.length + 1,
        target_chars: targetChars,
        api_mode: apiRoute.mode,
        api_model: apiRoute.model,
    });
    try {
        const result = await controller.run({
            record: dream,
            preset: foundation.selectedPresetPrompt || DEFAULT_SYSTEM_PROMPT,
            presetEntries: foundation.presetEntries,
            presetName: foundation.presetName,
            postProcessing: foundation.postProcessing,
            squashSystemMessages: foundation.squashSystemMessages,
            addons: foundation.addons,
            identitySlots: foundation.identitySlots,
            protagonistAnchor: foundation.protagonistAnchor,
            instruction,
            chapterTitle,
            targetChars,
            autoContinue: runtime.settings.autoContinue !== false,
            maxRounds: Math.min(10, Math.max(1, Number(runtime.settings.maxAutoRounds) || 3)),
            maxOptionalContextChars: runtime.LONG_DREAM_OPTIONAL_CONTEXT_CHAR_BUDGET,
            appendCandidate,
            apiRoute,
        });
        runtime.runtimeLog('info', '长梦续章等待确认', {
            dream_id: String(dream.id),
            chapter_number: dream.chapters.length + 1,
            chars: readableCharCount(result.record.draft?.text || ''),
            candidate: (result.record.draft?.selectedCandidateIndex || 0) + 1,
            candidate_count: result.record.draft?.candidates?.length || 1,
            rounds: result.rounds,
            completed_below_target: result.completedBelowTarget,
        });
        const candidateCount = result.record.draft?.candidates?.length || 1;
        toastr.success(candidateCount > 1
            ? `新版本已经写好，当前保留 ${candidateCount} 版，可切换比较后确认保存`
            : '新章节已经写好，请检查排版后确认保存', '', { timeOut: 7000 });
        runtime.playNotificationSound();
    } catch (error) {
        const retainedChars = readableCharCount(error?.longDreamRecord?.draft?.text || '');
        if (error?.name === 'AbortError') {
            runtime.runtimeLog('warn', '长梦续章停止', {
                dream_id: String(dream.id),
                retained_chars: retainedChars,
            });
            toastr.info(retainedChars
                ? '已停止，当前内容已保存为可恢复草稿'
                : '已停止，没有追加新章节');
        } else {
            const issue = runtime.captureRequestIssue(error, { stage: '长梦续章' });
            console.error('[Theater] 长梦续章失败:', issue.signal);
            runtime.runtimeLog('error', '长梦续章失败', {
                dream_id: String(dream.id),
                signal: issue.signal,
                stage: issue.stage,
                raw_stop_reason: issue.rawStopReason,
                retained_chars: retainedChars,
            });
            runtime.theaterError(runtime.requestFailureMessage('长梦续章失败', issue, { retained: !!retainedChars }));
        }
    } finally {
        resetLongDreamStreamRenderer({ flushPending: true });
        resetLongDreamRenderProgress();
        runtime.stopLongDreamProgressTicker();
        runtime.longDreamLiveDraftText = '';
        runtime.activeLongDreamGenerationId = null;
        runtime.renderLongDreamPanel();
    }
}
// @theater-source-end generateNextLongDreamChapter

// @theater-source-begin keepLongDreamCandidate
async function keepLongDreamCandidate() {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (runtime.longDreamCandidateSavePending || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active || dream?.draft?.status !== LONG_DREAM_DRAFT_STATUS.REVIEW) return;
    const index = dream.draft.selectedCandidateIndex;
    const retained = !dream.draft.candidates[index]?.retained;
    runtime.longDreamCandidateSavePending = true;
    try {
        const saved = await runtime.longDreamPut(retainLongDreamDraftCandidate(dream, index, retained));
        if (!saved) return;
        runtime.renderLongDreamPanel();
        toastr.info(retained ? '已保留这版，继续生成或确认其他版本也会留下' : '已取消保留，这版仍在当前候选中');
    } catch (error) { runtime.theaterError(`保留版本失败：${error?.message || error}`); }
    finally { runtime.longDreamCandidateSavePending = false; }
}
// @theater-source-end keepLongDreamCandidate

// @theater-source-begin confirmLongDreamChapter
async function confirmLongDreamChapter() {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (!dream?.draft || dream.draft.status !== LONG_DREAM_DRAFT_STATUS.REVIEW || runtime.longDreamCandidateSavePending || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active) return;
    const draft = dream.draft;
    const selected = draft.candidates[draft.selectedCandidateIndex];
    const count = draft.candidates.filter((item, index) => item.retained || index === draft.selectedCandidateIndex).length;
    const unkept = draft.candidates.length - count;
    const ok = await SillyTavern.getContext().Popup.show.confirm('用这一版接着写？',
        `将第 ${selected.versionNumber || draft.selectedCandidateIndex + 1} 版收入本章，共留下 ${count} 个版本。后续剧情和梦脉只沿用这一版。${unkept ? `还有 ${unkept} 版未保留；如果也喜欢，请先取消并保留。` : ''}`);
    if (!ok) return;
    const current = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
    if (String(runtime.activeLongDreamId) !== String(dream.id) || current?.draft !== draft || runtime.longDreamCandidateSavePending || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active) { toastr.info('章节状态已变化，请重新确认'); return; }
    try {
        runtime.longDreamCandidateSavePending = true;
        const saved = await getLongDreamGenerationController().confirm(current);
        runtime.activeLongDreamId = saved.id;
        runtime.clearLongDreamComposerDraft(saved.id);
        runtime.longDreamWorkspaceSection = 'continue';
        runtime.longDreamView = 'detail';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        runtime.renderLongDreamPanel();
        toastr.success(`第 ${saved.chapters.length} 章已收入长卷，共保留 ${count} 版`);
        queueLongDreamMemoryWeave(saved.id);
    } catch (error) {
        runtime.theaterError(`保存长梦章节失败：${error?.message || error}`);
    } finally { runtime.longDreamCandidateSavePending = false; }
}
// @theater-source-end confirmLongDreamChapter

// @theater-source-begin queueLongDreamMemoryWeave
function queueLongDreamMemoryWeave(dreamId, { force = false, announce = false } = {}) {
    const key = String(dreamId ?? '');
    if (!key || runtime.queuedLongDreamMemoryIds.has(key)) return;
    runtime.queuedLongDreamMemoryIds.add(key);
    runtime.longDreamMemoryQueue = runtime.longDreamMemoryQueue
        .catch(() => {})
        .then(() => weaveLongDreamMemory(key, { force, announce }))
        .finally(() => runtime.queuedLongDreamMemoryIds.delete(key));
}
// @theater-source-end queueLongDreamMemoryWeave

// @theater-source-begin confirmLongDreamSummaryAction
async function confirmLongDreamSummaryAction(dreamId, versionId = null) {
    const key = String(dreamId);
    if (runtime.confirmingLongDreamSummaries.has(key)) return;
    const dream = runtime.longDreamCache.find(item => String(item.id) === key);
    const reason = summaryUnavailableReason(dream, runtime.refreshingLongDreamSummaries.has(key), versionId);
    if (reason) { toastr.info(reason); return; }
    const version = versionId === null ? null : dream.memory.summaryVersions.find(item => item.id === versionId);
    const restoring = versionId !== null;
    const title = restoring ? '恢复到这版概要？' : '重新整理全篇概要？';
    const paragraphs = restoring
        ? [`将当前概要切换为这份截至第 ${version.chapterNumber} 章的版本，不调用 API。`,
            `正文和人物关系不回退。${version.chapterNumber < dream.chapters.length ? `第 ${version.chapterNumber + 1}～${dream.chapters.length} 章仍在，但不包含在这版概要里，会标记概要待更新。` : '这版概要已覆盖当前全部已保存章节。'}`]
        : ['将使用梦脉副 API，根据已保存章节和确认后的梦脉重新整理概要，会产生更新用量。',
            '成功后替换当前概要并保留最近版本；失败时保留原概要。正文和梦脉条目不变。'];
    runtime.confirmingLongDreamSummaries.add(key);
    try {
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const popup = new Popup(`<div class="theater-popup theater-compact-popup theater-dream-summary-confirmation" data-skin="${runtime.settings.skinMode || 'default'}"><h3>${title}</h3>${paragraphs.map(text => `<p>${runtime.esc(text)}</p>`).join('')}</div>`,
            POPUP_TYPE.CONFIRM, '', { wide: false, okButton: restoring ? '确认恢复' : '确认更新', cancelButton: '取消', allowVerticalScrolling: true });
        if (!await popup.show()) return;
        const current = runtime.longDreamCache.find(item => String(item.id) === key);
        if (String(runtime.activeLongDreamId) !== key || current !== dream) {
            toastr.info('作品或梦脉刚刚发生变化，请重新查看后再确认'); return;
        }
        const currentReason = summaryUnavailableReason(current, runtime.refreshingLongDreamSummaries.has(key), versionId);
        if (currentReason) { toastr.info(currentReason); return; }
        if (!restoring) { await refreshLongDreamSummaryNow(key); return; }
        const saved = await runtime.longDreamPut(restoreStorySummary(current, versionId));
        if (!saved) { toastr.warning('概要恢复未保存，请重试'); return; }
        if (String(runtime.activeLongDreamId) === key) {
            runtime.rememberLongDreamComposerDraft(dream.id);
            runtime.renderLongDreamPanel();
        }
        toastr.success('已恢复这版概要，正文和人物关系保持不变');
    } catch (error) {
        toastr.warning('概要操作未完成，原概要已保留，请重新查看后再试');
    } finally { runtime.confirmingLongDreamSummaries.delete(key); }
}
// @theater-source-end confirmLongDreamSummaryAction

// @theater-source-begin syncLongDreamSummaryButton
function syncLongDreamSummaryButton(key) {
    if (String(runtime.activeLongDreamId) !== key) return;
    const dream = runtime.longDreamCache.find(item => String(item.id) === key);
    const memory = dream?.memory;
    const busy = runtime.refreshingLongDreamSummaries.has(key);
    const reason = summaryUnavailableReason(dream, busy);
    const blocked = !!reason;
    $('[data-dream-summary-blocked-reason]').prop('hidden', !reason).text(reason);
    $('[data-dream-summary-refresh]')
        .prop('disabled', blocked)
        .attr('aria-busy', String(busy)).text(busy ? '正在更新…' : '更新概要');
    $('[data-dream-summary-restore]').each(function () {
        this.disabled = !!summaryUnavailableReason(dream, busy, this.getAttribute('data-dream-summary-restore'));
    });
    $('[data-dream-summary-version-reason]').each(function () {
        const versionReason = summaryUnavailableReason(dream, busy, this.getAttribute('data-dream-summary-version-reason'));
        this.hidden = !versionReason;
        this.textContent = versionReason;
    });
}
// @theater-source-end syncLongDreamSummaryButton

// @theater-source-begin refreshLongDreamSummaryNow
async function refreshLongDreamSummaryNow(dreamId, { fillMissing = false } = {}) {
    const key = String(dreamId);
    if (runtime.refreshingLongDreamSummaries.has(key)) { toastr.info('概要正在更新，请稍候'); return; }
    const dream = runtime.longDreamCache.find(item => String(item.id) === key);
    if (!dream) { toastr.warning('未找到当前作品，请重新打开作品后再试'); return; }
    if (dream.memory?.status === LONG_DREAM_MEMORY_STATUS.WEAVING || dream.memory?.pendingConflicts?.length || dream.memory?.pendingChapterNumbers?.length) {
        toastr.warning('请先完成梦脉织录和冲突确认，再更新概要'); return;
    }
    let stage = 'preset';
    try {
        const preset = runtime.selectedLongDreamMemoryApiPreset();
        if (!preset) { toastr.warning('请先绑定梦脉副 API，再更新概要'); return; }
        stage = 'request';
        runtime.refreshingLongDreamSummaries.add(key);
        syncLongDreamSummaryButton(key);
        toastr.info('正在更新概要，最多等待 3 分钟');
        const saved = await refreshLongDreamSummary({
            replace: !fillMissing,
            record: dream,
            request: (payload, { signal }) => requestCustomApi({ config: { ...preset, maxOutputTokens: Math.min(8192, normalizeMaxTokens(preset.maxOutputTokens, 4096)) }, ...payload, signal, shouldStream: false, onChunk: () => {}, log: runtime.runtimeLog }),
            readLatest: () => runtime.longDreamCache.find(item => String(item.id) === key),
            save: record => runtime.longDreamPut(record),
        });
        if (saved) {
            toastr.success('剧情概要已更新');
            if (String(runtime.activeLongDreamId) === key) {
                runtime.rememberLongDreamComposerDraft();
                runtime.renderLongDreamPanel();
            }
        }
        else toastr.info('作品或梦脉刚刚发生变化，本次概要未覆盖，请重新更新');
    } catch (error) {
        const summaryReasons = {
            LONG_DREAM_SUMMARY_PARSE_FAILED: '接口返回的概要格式无法解析',
            LONG_DREAM_SUMMARY_MISSING_ENTRIES: '接口没有返回分章概要',
            LONG_DREAM_SUMMARY_COVERAGE: '接口返回的概要有漏章、章号不符或重复',
            LONG_DREAM_SUMMARY_EMPTY_ENTRY: '接口返回了空的分章概要',
            LONG_DREAM_SUMMARY_ENTRY_TOO_LONG: '接口返回的单章概要过长',
            LONG_DREAM_SUMMARY_REQUEST_FAILED: '概要请求未完成',
        };
        const reason = stage === 'preset' ? '副 API 配置读取失败'
            : error?.code === 'LONG_DREAM_SUMMARY_TIMEOUT' ? '等待超过 3 分钟'
            : error?.code === 'LONG_DREAM_SUMMARY_SAVE_FAILED' ? '概要保存失败'
            : error?.diagnosticSignal ? diagnosticSignalInfo(error.diagnosticSignal).title
            : summaryReasons[error?.code] || '接口未返回可用概要或保存失败';
        if (error?.summaryDiagnostic) runtime.runtimeLog('warn', '概要更新失败', { code: error.code, ...error.summaryDiagnostic });
        toastr.warning(`${reason}，原概要已保留；可点击“更新概要”重试`);
    } finally {
        runtime.refreshingLongDreamSummaries.delete(key);
        syncLongDreamSummaryButton(key);
    }
}
// @theater-source-end refreshLongDreamSummaryNow

// @theater-source-begin weaveLongDreamMemory
async function weaveLongDreamMemory(dreamId, { force = false, announce = false } = {}) {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(dreamId));
    if (!dream || runtime.settings.longDreamMemoryEnabled === false) return;
    const preset = runtime.selectedLongDreamMemoryApiPreset();
    if (!preset) {
        if (announce) toastr.warning('请先在【设置 → API 与输出 → 梦脉织录】绑定一个副 API 预设');
        return;
    }
    if (!shouldWeaveLongDreamMemory(dream, { batchSize: runtime.settings.longDreamMemoryBatchSize, force })) {
        if (announce) toastr.info('当前没有需要织录的已确认章节');
        return;
    }
    const payload = buildLongDreamMemoryPayload({
        record: dream,
        promptPreset: runtime.settings.longDreamMemoryPrompt || DEFAULT_LONG_DREAM_MEMORY_PRESET,
    });
    let weaving = await runtime.longDreamPut(setLongDreamMemoryStatus(dream, LONG_DREAM_MEMORY_STATUS.WEAVING));
    if (!weaving) return;
    if (String(runtime.activeLongDreamId) === String(dream.id) && runtime.longDreamView === 'detail') runtime.renderLongDreamPanel();
    runtime.runtimeLog('info', '梦脉织录开始', {
        dream_id: String(dream.id),
        chapters: payload.pendingChapterNumbers,
        preset: preset.name,
        model: preset.apiModel,
    });
    try {
        const response = await requestCustomApi({
            config: {
                ...preset,
                maxOutputTokens: Math.min(8192, normalizeMaxTokens(preset.maxOutputTokens, 4096)),
            },
            systemPrompt: payload.systemPrompt,
            userPrompt: payload.userPrompt,
            shouldStream: false,
            onChunk: () => {},
            log: runtime.runtimeLog,
        });
        const patch = parseLongDreamMemoryResponse(response?.text || response, {
            pendingChapterNumbers: payload.pendingChapterNumbers,
        });
        const latest = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        if (!latest) return;
        if (JSON.stringify([latest.chapters, latest.memory, latest.canon, latest.inheritance]) !== JSON.stringify([weaving.chapters, weaving.memory, weaving.canon, weaving.inheritance])) {
            if (latest.memory.status === LONG_DREAM_MEMORY_STATUS.WEAVING) await runtime.longDreamPut(setLongDreamMemoryStatus(latest, LONG_DREAM_MEMORY_STATUS.PENDING));
            if (String(runtime.activeLongDreamId) === String(dream.id) && runtime.longDreamView === 'detail') runtime.renderLongDreamPanel();
            return;
        }
        const saved = await runtime.longDreamPut(applyLongDreamMemoryPatch(latest, patch, payload.throughChapter));
        if (!saved) return;
        runtime.runtimeLog('info', '梦脉织录完成', {
            dream_id: String(dream.id),
            through_chapter: payload.throughChapter,
            operations_applied: Array.isArray(patch.operations) ? patch.operations.length : 0,
            legacy_cards_added: Array.isArray(patch.cards) ? patch.cards.length : 0,
            invalid_operations: Number(patch.invalidOperationCount) || 0,
            corrected_chapter_numbers: Number(patch.correctedChapterCount) || 0,
        });
        if (String(runtime.activeLongDreamId) === String(dream.id) && runtime.longDreamView === 'detail') runtime.renderLongDreamPanel();
        if (announce) toastr.success(`梦脉已织录至第 ${payload.throughChapter} 章`);
        if (saved.memory.summaryNeedsRefresh && !saved.memory.pendingConflicts.length && !saved.memory.pendingChapterNumbers.length) await refreshLongDreamSummaryNow(saved.id, { fillMissing: true });
    } catch (error) {
        const latest = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        if (!latest) return;
        if (JSON.stringify([latest.chapters, latest.memory, latest.canon, latest.inheritance]) !== JSON.stringify([weaving.chapters, weaving.memory, weaving.canon, weaving.inheritance])) {
            if (latest.memory.status === LONG_DREAM_MEMORY_STATUS.WEAVING) await runtime.longDreamPut(setLongDreamMemoryStatus(latest, LONG_DREAM_MEMORY_STATUS.PENDING));
            if (String(runtime.activeLongDreamId) === String(dream.id) && runtime.longDreamView === 'detail') runtime.renderLongDreamPanel();
            return;
        }
        const signal = error?.diagnosticSignal || REQUEST_DIAGNOSTIC_SIGNAL.INVALID_RESPONSE;
        await runtime.longDreamPut(setLongDreamMemoryStatus(latest, LONG_DREAM_MEMORY_STATUS.FAILED, { errorSignal: signal }));
        runtime.runtimeLog('error', '梦脉织录失败', { dream_id: String(dream.id), signal });
        if (String(runtime.activeLongDreamId) === String(dream.id) && runtime.longDreamView === 'detail') runtime.renderLongDreamPanel();
        if (announce) runtime.theaterError(`梦脉织录失败：${signal}`);
    }
}
// @theater-source-end weaveLongDreamMemory

// @theater-source-begin discardLongDreamDraft
async function discardLongDreamDraft() {
    if (runtime.longDreamCandidateSavePending || runtime.isPreparingGeneration) return;
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (dream?.draft?.status !== LONG_DREAM_DRAFT_STATUS.WRITING) return;
    const composerDraft = runtime.getLongDreamComposerDraft(dream.id);
    const retainedComposer = {
        instruction: $('#theater-dream-next-instruction').length
            ? String($('#theater-dream-next-instruction').val() || '')
            : String(dream.draft.instruction ?? composerDraft.instruction ?? ''),
        title: $('#theater-dream-next-title').length
            ? String($('#theater-dream-next-title').val() || '')
            : String(dream.draft.title ?? composerDraft.title ?? ''),
        targetChars: $('#theater-dream-next-target').length
            ? Number($('#theater-dream-next-target').val())
            : Number(dream.draft.targetChars ?? composerDraft.targetChars ?? 3000),
    };
    const candidateCount = Array.isArray(dream.draft.candidates) ? dream.draft.candidates.length : 0;
    const isWritingCandidate = candidateCount > 0;
    const label = isWritingCandidate ? '本轮生成' : '未完成草稿';
    const detail = isWritingCandidate
        ? `本轮尚未完成的内容会被清除，已经完成的 ${candidateCount} 版候选仍会保留。本章指令也会保留。`
        : '未完成草稿会被清除，已有章节不会受影响。本章指令会保留。';
    const ok = await SillyTavern.getContext().Popup.show.confirm(`放弃${label}？`, detail);
    if (!ok) return;
    const saved = await runtime.longDreamPut(isWritingCandidate
        ? discardLongDreamWritingAttempt(dream)
        : clearLongDreamDraft(dream));
    if (!saved) return;
    runtime.setLongDreamComposerDraft(dream.id, retainedComposer);
    runtime.renderLongDreamPanel();
    toastr.info(isWritingCandidate ? `本轮生成已清除，已回到 ${candidateCount} 版候选；指令已保留` : `${label}已清除，指令已保留`);
}
// @theater-source-end discardLongDreamDraft

// @theater-source-begin regenerateLongDreamDraft
async function regenerateLongDreamDraft({ edit = false } = {}) {
    if (runtime.longDreamCandidateSavePending || runtime.isPreparingGeneration) return;
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    const draft = dream?.draft;
    if (draft?.status !== LONG_DREAM_DRAFT_STATUS.REVIEW) return;
    const candidateCount = Array.isArray(draft.candidates) ? draft.candidates.length : 0;
    let instruction = edit ? (draft.lastRevisionInstruction ?? draft.instruction) : draft.instruction;
    if (edit) {
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const popup = new Popup(`<div class="theater-popup theater-compact-popup theater-dream-revise-popup" data-skin="${runtime.settings.skinMode || 'default'}">
            <div class="theater-dream-revise-eyebrow"><i class="fa-regular fa-moon" aria-hidden="true"></i><span>长梦 · 续章</span></div>
            <h3>修改续写要求</h3>
            <div class="theater-dream-revise-field-heading"><label for="theater-dream-revised-instruction">本次续写要求</label><small>${draft.lastRevisionInstruction !== undefined ? '已带入上次修改' : '已带入原要求'}</small></div>
            <textarea id="theater-dream-revised-instruction" class="theater-textarea" data-dream-revised-instruction rows="6">${runtime.esc(instruction)}</textarea>
            <p class="theater-dream-revise-retention"><i class="fa-solid fa-layer-group" aria-hidden="true"></i><span>已有 <b>${candidateCount}</b> 版 · 已保留 ${draft.candidates.filter(item => item.retained).length} 版 · ${draft.candidates.filter(item => !item.retained).length >= LONG_DREAM_MAX_CANDIDATES ? '新版成功保存后移出最早一版未保留候选' : `本次将新增第 ${Math.max(0, ...draft.candidates.map(item => item.versionNumber || 1)) + 1} 版`}</span></p>
        </div>`, POPUP_TYPE.CONFIRM, '', { wide: false, okButton: '生成新版本', cancelButton: '取消', allowVerticalScrolling: true });
        const shown = popup.show();
        const input = $(popup.dlg).find('[data-dream-revised-instruction]');
        if (!await shown) return;
        instruction = String(input.val() || '');
        const current = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        if (String(runtime.activeLongDreamId) !== String(dream.id) || current?.draft !== draft) {
            toastr.info('章节状态已变化，请重新打开修改要求');
            return;
        }
        try {
            const saved = await runtime.longDreamPut({ ...current, draft: { ...draft, lastRevisionInstruction: instruction } });
            if (!saved) { toastr.warning('续写要求未能记住，请重试'); return; }
            if (String(runtime.activeLongDreamId) !== String(dream.id) || runtime.longDreamCache.find(item => String(item.id) === String(dream.id))?.draft !== saved.draft) return;
        } catch { toastr.warning('续写要求未能记住，请重试'); return; }
    }
    const candidateConfig = {
        instruction,
        title: draft.title,
        targetChars: draft.targetChars,
    };
    runtime.setLongDreamComposerDraft(dream.id, candidateConfig);
    toastr.info(`正在按${edit ? '修改后的' : '原'}要求生成新版本；未保留候选最多三版，已保留版本不被替换，失败或停止保留已有候选`);
    runtime.longDreamWorkspaceSection = 'continue';
    runtime.longDreamView = 'detail';
    await generateNextLongDreamChapter({ appendCandidate: true, candidateConfig });
}
// @theater-source-end regenerateLongDreamDraft

// @theater-source-begin changeLongDreamDraftCandidate
async function changeLongDreamDraftCandidate(step) {
    if (runtime.longDreamCandidateSavePending || runtime.isPreparingGeneration) return;
    if (!step || runtime.longDreamGenerationController?.active) return;
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    const draft = dream?.draft;
    if (draft?.status !== LONG_DREAM_DRAFT_STATUS.REVIEW || !draft.candidates?.length) return;
    const current = Math.min(
        draft.candidates.length - 1,
        Math.max(0, Math.floor(Number(draft.selectedCandidateIndex) || 0)),
    );
    const next = Math.min(draft.candidates.length - 1, Math.max(0, current + step));
    if (next === current) return;
    runtime.longDreamCandidateSavePending = true;
    try {
        const saved = await runtime.longDreamPut(selectLongDreamDraftCandidate(dream, next));
        if (!saved) return;
        runtime.renderLongDreamPanel();
    } catch (error) { runtime.theaterError(`切换版本失败：${error?.message || error}`); }
    finally { runtime.longDreamCandidateSavePending = false; }
}
// @theater-source-end changeLongDreamDraftCandidate

return { requestLongDreamChapter, generateLongDreamCanonSuggestions, renderLongDreamChapter, createCumulativeStreamRenderer, getLongDreamStreamRenderer, resetLongDreamStreamRenderer, updateLongDreamStream, resetLongDreamRenderProgress, updateLongDreamRenderProgress, handleLongDreamGenerationState, getLongDreamGenerationController, resolveLongDreamRequestFoundation, refreshLongDreamTokenEstimate, generateNextLongDreamChapter, keepLongDreamCandidate, confirmLongDreamChapter, queueLongDreamMemoryWeave, confirmLongDreamSummaryAction, syncLongDreamSummaryButton, refreshLongDreamSummaryNow, weaveLongDreamMemory, discardLongDreamDraft, regenerateLongDreamDraft, changeLongDreamDraftCandidate };
}
