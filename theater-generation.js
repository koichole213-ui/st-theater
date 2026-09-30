// theater-generation: receives live state and cross-feature callbacks from index.js.
import { adaptiveRenderProfile } from './adaptive-render.js';
import { isPlainTextSelection, plainTextThemeForSelection, textOutputModeForTheme } from './plain-text-renderer.js';
import { DEFAULT_RENDER_TEMPLATE_TEXT, DEFAULT_RENDER_TEMPLATE, DEFAULT_RENDER_TEMPLATE_PC, DEFAULT_SYSTEM_PROMPT } from './theater-defaults.js';
import { buildContinuationPayload, STORY_RELATION_CONTINUITY_RULE, buildGenerationPayload, hydrateFinalRenderHtml, buildFinalRenderPayload, buildContinuationInstruction, recentGenerationRoundsContext } from './generation-payload.js';
import { composeGenerationContinuationMessages, composePresetMessages } from './request-layout.js';
import { normalizeContextRange, takeRecentMessages } from './context-policy.js';
import { createChatContextReader } from './context-exclusions.js';
import { stripTargetWordCountRequirement, resolveTargetWordCount, isStagedRenderTarget, continuationFirstRoundGuidance, longFormFirstRoundGuidance, firstRoundGuidance, normalizeManualTarget, classifyLengthTier } from './length-policy.js';
import { scanWithCurrentSillyTavern } from './world-book-runtime.js';
import { buildProtagonistAnchor } from './protagonist-anchor.js';
import { formatTokenCount } from './token-estimator.js';
import { targetCompletionChars, abortGenerationJob, createGenerationJob, addGenerationSegment, shouldContinueJob, shouldAuthorizeFinishRound, authorizeFinish, generationTextWithLiveSegment } from './generation-job.js';
import { readableCharCount } from './text-counter.js';
import { displayedContinuationVersion, selectContinuationVersion, normalizeContinuationRounds, createContinuationSession, continuationRoundHistory, appendContinuationVersion } from './continuation-session.js';
import { markCompleted, markFirstToken } from './request-metrics.js';
import { continuationHistoryMetadata, newHistoryKey } from './history-collections.js';
import { itemTags } from './tag-system.js';

export function createTheaterGeneration(runtime) {
// @theater-source-begin htmlToPlainText
function htmlToPlainText(html) {
    const div = document.createElement('div');
    // 先用正则预清理完整 HTML 文档结构，避免某些浏览器 innerHTML 解析不彻底
    let cleaned = html
        .replace(/<!(DOCTYPE|doctype)[^>]*>/gi, '')
        .replace(/<\/?(html|head|body|meta|link)[^>]*>/gi, '');
    div.innerHTML = cleaned;
    div.querySelectorAll('script, style, svg, noscript').forEach(el => el.remove());
    let text = (div.textContent || div.innerText || '').trim();
    // 兜底：如果还残留 HTML 标签，用正则剥掉
    if (/<[a-z][\s\S]*>/i.test(text)) {
        text = text.replace(/<[^>]+>/g, '').trim();
    }
    return text;
}
// @theater-source-end htmlToPlainText

// @theater-source-begin prepareContinuationContext
function prepareContinuationContext(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const containsHtml = /<(?:!doctype|\/?[a-z][^>]*)>/i.test(raw);
    const plainText = containsHtml ? htmlToPlainText(raw) : raw;
    return plainText.trim();
}
// @theater-source-end prepareContinuationContext

// @theater-source-begin generationPreparationKey
function generationPreparationKey(ctx = SillyTavern.getContext()) {
    return JSON.stringify({
        chatId: String(ctx?.chatId ?? ''),
        characterId: String(ctx?.characterId ?? ''),
        worldBooks: [...(runtime.settings.selectedWorldBooks || [])],
        worldBookReadMode: String(runtime.settings.worldBookReadMode || 'all'),
        presetName: String(runtime.settings.selectedPresetName || ''),
    });
}
// @theater-source-end generationPreparationKey

// @theater-source-begin resolveRenderSelection
function resolveRenderSelection(forcePlainText = false) {
    const selectedRender = runtime.normalizeRenderSelection(runtime.settings.selectedRenderIndex, runtime.settings.renderTemplates || []);
    const adaptiveProfile = adaptiveRenderProfile(selectedRender);
    const isPlainTextRender = forcePlainText || isPlainTextSelection(selectedRender);
    const textTheme = plainTextThemeForSelection(selectedRender);
    const customRender = (runtime.settings.renderTemplates || [])[parseInt(selectedRender)];
    let rules = isPlainTextRender ? DEFAULT_RENDER_TEMPLATE_TEXT : DEFAULT_RENDER_TEMPLATE;
    if (!isPlainTextRender && selectedRender === '__default_pc__') rules = DEFAULT_RENDER_TEMPLATE_PC;
    else if (!isPlainTextRender && adaptiveProfile) rules = adaptiveProfile.rules;
    else if (!isPlainTextRender && selectedRender !== '__default__' && customRender) rules = customRender.content;
    if (!isPlainTextRender) rules += `\n\n${runtime.HTML_RENDER_FINAL_GUARDRAILS}`;
    const label = isPlainTextRender
        ? (textTheme === 'dark' ? '纯文字·暗色夜读' : '纯文字·亮色')
        : (adaptiveProfile?.name || (selectedRender === '__default_pc__' ? '内置 PC' : (selectedRender === '__default__' ? '内置默认' : (customRender?.name || `自定义 ${selectedRender}`))));
    return { selectedRender, isPlainTextRender, textTheme, rules, label, adaptiveProfile };
}
// @theater-source-end resolveRenderSelection

// @theater-source-begin resolveGenerationIdentity
function resolveGenerationIdentity(ctx = SillyTavern.getContext()) {
    const { characters = [], characterId, name1, name2 } = ctx || {};
    const character = characterId !== undefined ? characters[characterId] : null;
    const description = character?.data?.description || character?.description || '';
    const personality = character?.data?.personality || character?.personality || '';
    const scenario = character?.data?.scenario || character?.scenario || '';
    const creatorNotes = character?.data?.creator_notes || character?.creator_notes || '';
    const currentPersona = runtime.settings.followUserPersona ? runtime.loadPersona({ silent: true }) : (runtime.settings.userPersona || '');
    let role = '';
    if (character) {
        if (description) role += `角色设定：\n${description}\n\n`;
        if (personality) role += `角色性格：\n${personality}`;
    }
    return {
        character,
        description,
        personality,
        scenario,
        creatorNotes,
        currentPersona,
        role,
        persona: currentPersona?.trim() ? `User人设：\n${currentPersona.trim()}` : '',
        name1,
        name2,
    };
}
// @theater-source-end resolveGenerationIdentity

// @theater-source-begin generationIdentitySlots
function generationIdentitySlots(identity = {}, { includeScenario = true } = {}) {
    return {
        charDescription: identity.description ? `角色设定：\n${identity.description}` : '',
        charPersonality: identity.personality ? `角色性格：\n${identity.personality}` : '',
        scenario: includeScenario && identity.scenario ? `场景设定：\n${identity.scenario}` : '',
        personaDescription: identity.persona || '',
        dialogueExamples: '',
    };
}
// @theater-source-end generationIdentitySlots

// @theater-source-begin freezeGenerationFoundationList
function freezeGenerationFoundationList(items = []) {
    return Object.freeze((Array.isArray(items) ? items : []).map(item => Object.freeze({ ...item })));
}
// @theater-source-end freezeGenerationFoundationList

// @theater-source-begin buildGenerationContinuationRoundPayload
function buildGenerationContinuationRoundPayload({ foundation, instruction, ctx, manuscriptMode = false }) {
    const continuationPayload = buildContinuationPayload({ instruction, manuscriptMode });
    return {
        ...continuationPayload,
        messages: composeGenerationContinuationMessages({
            presetEntries: foundation.presetEntries,
            slots: foundation.identitySlots,
            worldInfoEntries: foundation.worldInfoEntries,
            chatMessages: foundation.chatMessages,
            foundationTailMessages: foundation.tailMessages,
            continuationSystemPrompt: continuationPayload.systemPrompt,
            continuationUserPrompt: continuationPayload.userPrompt,
            squashSystemMessages: foundation.squashSystemMessages,
        }),
        postProcessing: foundation.postProcessing,
        presetName: foundation.presetName,
        ctx,
        isPlainTextRender: true,
    };
}
// @theater-source-end buildGenerationContinuationRoundPayload

// @theater-source-begin assembleGenerationPayload
async function assembleGenerationPayload(instruction, { continuationText = null, forcePlainText = false, longFormPlan = false, loadPreset = true, evaluateWorldBook = true, estimateOnly = false, maxContinuationRounds = null } = {}) {
    const ctx = SillyTavern.getContext();
    const preparationKey = generationPreparationKey(ctx);
    const { chat = [] } = ctx;
    const identity = resolveGenerationIdentity(ctx);
    const { character, description, personality, scenario, creatorNotes, currentPersona, role, persona, name1, name2 } = identity;
    const contextCount = normalizeContextRange(runtime.settings.contextRange);
    const readChatContext = runtime.settings.readChatContext !== false;
    const readContextMessage = createChatContextReader(runtime.settings.contextExclusionRules);
    const recentChatMessages = readChatContext ? takeRecentMessages(chat, contextCount) : [];
    const structuredChatMessages = recentChatMessages.map((message, index) => ({
        role: message.is_user ? 'user' : 'assistant',
        content: readContextMessage(message.mes),
        name: message.is_user ? (name1 || 'User') : (message.name || name2 || 'Char'),
        source: 'chat-history',
        sourceId: `chat-${index + 1}`,
    })).filter(message => message.content.trim());
    const chatCtx = structuredChatMessages.map(message =>
        `${message.name}: ${message.content}`
    ).join('\n\n');
    const context = readChatContext && contextCount > 0
        ? `以下是最近的正文剧情（仅供参考背景，不要续写正文）：\n${chatCtx}`
        : readChatContext
            ? '本次聊天前文读取条数设为 0，请只根据角色设定、世界书和用户指令生成小剧场。'
        : '本次不读取聊天前文，请只根据角色设定、世界书和用户指令生成小剧场。';

    if (evaluateWorldBook) await runtime.ensureWorldBooksCurrent({ silent: true });
    const selectedBookNames = new Set(runtime.settings.selectedWorldBooks || []);
    const selectedWBEntries = runtime.wbEntries.filter((entry, index) =>
        runtime.wbStates[index] !== false && (entry.manual || selectedBookNames.has(entry.book))
    );
    let activeWorldInfoEntries = [...selectedWBEntries];
    let wbParts = selectedWBEntries.map(entry => entry.content);
    if (evaluateWorldBook && runtime.settings.worldBookReadMode === 'lights') {
        const rawEntries = selectedWBEntries.filter(entry => !entry.manual && entry.raw).map(entry => entry.raw);
        const manualParts = selectedWBEntries.filter(entry => entry.manual).map(entry => entry.content);
        try {
            const instructionForScan = stripTargetWordCountRequirement(instruction) || String(instruction || '');
            const reverseChat = [...chat].reverse();
            const scanContents = reverseChat.map(message => readContextMessage(message.mes));
            const chatWithNames = [
                `${name1 || 'User'}: ${instructionForScan}`,
                ...reverseChat.map((message, index) => scanContents[index].trim()
                    ? `${message.is_user ? (name1 || 'User') : (message.name || name2 || 'Char')}: ${scanContents[index]}` : ''),
            ];
            const chatWithoutNames = [instructionForScan, ...scanContents];
            const maxContext = ctx?.getMaxContextSize?.() || (ctx?.oai_settings || globalThis.oai_settings)?.openai_max_context || 65536;
            const activated = await scanWithCurrentSillyTavern({
                entries: rawEntries,
                chatWithNames,
                chatWithoutNames,
                maxContext,
                globalScanData: {
                    personaDescription: currentPersona || '',
                    characterDescription: description,
                    characterPersonality: personality,
                    characterDepthPrompt: '',
                    scenario,
                    creatorNotes,
                    trigger: 'quiet',
                },
                eventSource: ctx?.eventSource,
                eventType: ctx?.event_types?.WORLDINFO_ENTRIES_LOADED,
            });
            if (Array.isArray(activated)) {
                const activatedKeys = new Set(activated.map(entry => `${entry.world}.${entry.uid}`));
                activeWorldInfoEntries = [
                    ...selectedWBEntries
                        .filter(entry => !entry.manual && activatedKeys.has(`${entry.book}.${entry.uid}`))
                        .map(entry => entry),
                    ...selectedWBEntries.filter(entry => entry.manual),
                ];
                wbParts = activeWorldInfoEntries.map(entry => entry.content);
                runtime.runtimeLog('info', '世界书按酒馆规则触发', { candidates: rawEntries.length, activated: activatedKeys.size, manual: manualParts.length });
            }
        } catch (error) {
            runtime.runtimeLog('warn', '酒馆世界书扫描不可用，回退为读取已勾选蓝绿灯', { message: String(error?.message || error) });
        }
    }
    const worldBook = wbParts.length ? `世界书设定：\n${wbParts.join('\n\n')}` : '';

    const renderSelection = resolveRenderSelection(forcePlainText);
    const { isPlainTextRender, textTheme } = renderSelection;
    let { rules } = renderSelection;
    if (longFormPlan) {
        rules += '\n\n【同一稿件分段规则】本轮是同一篇小剧场正文的前半部分，不是独立成品。只输出正文并停在剧情发展途中；不要输出 HTML、标题、总结、结局或“未完待续”。';
    }

    const presetSnapshot = loadPreset ? await runtime.ensureSelectedPresetLoaded() : runtime.currentPresetSnapshot();
    const selectedPresetPrompt = presetSnapshot.prompt;
    const preset = selectedPresetPrompt || DEFAULT_SYSTEM_PROMPT;
    const addons = [
        runtime.settings.customStyleAddon?.trim() ? `【文风补充】\n${runtime.settings.customStyleAddon.trim()}` : '',
        runtime.settings.customNsfwAddon?.trim() ? `【NSFW补充】\n${runtime.settings.customNsfwAddon.trim()}` : '',
    ].filter(Boolean).join('\n\n');
    // 双重保险：续写前情只允许纯正文进入请求，绝不携带上一页的 HTML/CSS/脚本。
    const contCtx = prepareContinuationContext(continuationText === null ? runtime.continueContext : continuationText);
    const targetWordCount = resolveTargetWordCount(instruction, {
        manualEnabled: runtime.settings.manualTargetEnabled,
        manualTarget: runtime.settings.manualTargetChars,
    });
    const cleanInstruction = stripTargetWordCountRequirement(instruction) || '请根据现有角色设定与剧情创作小剧场。';
    const continuation = contCtx ? `【续写前情｜仅供承接，不计入本次新增字数】\n${contCtx}\n【前情结束｜从上述结尾继续，不重复输出】` : '';
    const continuationMaxRounds = isStagedRenderTarget(targetWordCount) && runtime.settings.autoContinue
        ? Math.min(10, Math.max(1, Number(maxContinuationRounds ?? runtime.settings.maxAutoRounds) || 3))
        : 1;
    const lengthGuidance = contCtx
        ? continuationFirstRoundGuidance(targetWordCount, { maxRounds: continuationMaxRounds })
        : (longFormPlan ? longFormFirstRoundGuidance(targetWordCount) : firstRoundGuidance(targetWordCount));
    const taskInstruction = `用户指令：${cleanInstruction}` + (contCtx && targetWordCount
        ? `\n本次续写任务：从前情结尾继续，新增约 ${targetWordCount} 字的正文，旧正文不计入此目标。`
        : '');
    const protagonistAnchor = buildProtagonistAnchor({
        userName: name1,
        charName: name2 || character?.name || character?.data?.name,
    });
    let fixed = contCtx
        ? `只输出新增内容，保持人物语气、视角和时态，不要复述前文。\n${STORY_RELATION_CONTINUITY_RULE}`
        : '请根据以上所有信息生成小剧场，严格遵守渲染规则。';
    fixed += `\n${protagonistAnchor}`;
    fixed += `\n【创作节奏】${lengthGuidance}`;
    const payload = buildGenerationPayload({
        preset, role, persona, worldBook, context, continuation, rules, addons,
        fixed,
        instruction: taskInstruction,
    });
    // 预估仅使用同一份 tokenParts，不需要编排请求或复制冻结续写资料。
    if (estimateOnly) return { tokenParts: payload.tokenParts };
    const selectedPresetEntries = presetSnapshot.selectedEntries;
    const presetEntriesForLayout = selectedPresetEntries.length
        ? selectedPresetEntries
        : [{ id: 'main', role: 'system', content: DEFAULT_SYSTEM_PROMPT }];
    const foundationTailMessages = [
        addons ? { role: 'system', content: addons, source: 'theater-addon', sourceId: 'addons' } : null,
        (!structuredChatMessages.length && context)
            ? { role: 'system', content: context, source: 'theater-context', sourceId: 'context-policy' }
            : null,
    ].filter(Boolean);
    const tailMessages = [
        ...foundationTailMessages,
        continuation
            ? { role: 'user', content: continuation, source: 'theater-continuation', sourceId: 'continuation' }
            : null,
        { role: 'user', content: taskInstruction, source: 'theater-instruction', sourceId: 'instruction' },
        { role: 'system', content: [rules, fixed].filter(Boolean).join('\n\n'), source: 'theater-rules', sourceId: 'final-rules' },
    ].filter(Boolean);
    const identitySlots = generationIdentitySlots(identity);
    const presetName = presetSnapshot.name || '内置默认预设';
    const messages = composePresetMessages({
        presetEntries: presetEntriesForLayout,
        slots: identitySlots,
        worldInfoEntries: activeWorldInfoEntries,
        chatMessages: structuredChatMessages,
        tailMessages,
        squashSystemMessages: presetSnapshot.squashSystemMessages,
    });
    if (preparationKey !== generationPreparationKey()) {
        throw new Error('准备资料时角色、聊天或资料选择发生了变化，请重新点击生成');
    }
    return {
        ...payload,
        messages,
        postProcessing: presetSnapshot.postProcessing,
        presetName,
        isPlainTextRender,
        textTheme,
        targetWordCount,
        ctx,
        generationFoundation: Object.freeze({
            presetEntries: freezeGenerationFoundationList(presetEntriesForLayout),
            identitySlots: Object.freeze({ ...identitySlots }),
            worldInfoEntries: freezeGenerationFoundationList(activeWorldInfoEntries),
            chatMessages: freezeGenerationFoundationList(structuredChatMessages),
            tailMessages: freezeGenerationFoundationList(foundationTailMessages),
            squashSystemMessages: presetSnapshot.squashSystemMessages,
            postProcessing: presetSnapshot.postProcessing,
            presetName,
            originalInstruction: cleanInstruction,
        }),
        diagnosticContext: {
            kind: '普通小剧场',
            presetSource: selectedPresetPrompt ? '已选酒馆预设' : '内置默认预设',
            readChatContext,
            contextRange: contextCount,
            chatMessages: recentChatMessages.length,
            character: !!role.trim(),
            persona: !!persona.trim(),
            worldBookBooks: (runtime.settings.selectedWorldBooks || []).length,
            worldBookEntries: activeWorldInfoEntries.length,
            styleAddon: !!runtime.settings.customStyleAddon?.trim(),
            nsfwAddon: !!runtime.settings.customNsfwAddon?.trim(),
            continuation: !!contCtx,
        },
    };
}
// @theater-source-end assembleGenerationPayload

// @theater-source-begin refreshTokenEstimate
async function refreshTokenEstimate() {
    if (!$('#theater-token-summary-value').length) return;
    try {
        const instruction = $('#theater-instruction').val() || '';
        const targetWordCount = resolveTargetWordCount(instruction, {
            manualEnabled: runtime.settings.manualTargetEnabled,
            manualTarget: runtime.settings.manualTargetChars,
        });
        const configuredRounds = Math.min(10, Math.max(1, Number(runtime.settings.maxAutoRounds) || 3));
        const stagedRenderPlan = !runtime.continueContext && isStagedRenderTarget(targetWordCount);
        const stagedMultiRoundPlan = stagedRenderPlan && runtime.settings.autoContinue && configuredRounds >= 2;
        const payload = await assembleGenerationPayload(instruction, {
            continuationText: runtime.continueContext,
            forcePlainText: stagedRenderPlan,
            longFormPlan: stagedMultiRoundPlan,
            loadPreset: false,
            evaluateWorldBook: false,
            estimateOnly: true,
        });
        const estimate = runtime.estimateInputTokens(payload.tokenParts);
        $('#theater-token-summary-value').text(`预计正文输入约 ${formatTokenCount(estimate.total)} Token`);
        $('#theater-token-details').text(`预设 ${formatTokenCount(estimate.preset)} · 角色/人设 ${formatTokenCount(estimate.role)} · 世界书 ${formatTokenCount(estimate.worldBook)} · 上下文 ${formatTokenCount(estimate.context)} · 续写 ${formatTokenCount(estimate.continuation)} · 规则 ${formatTokenCount(estimate.rules)} · 当前指令 ${formatTokenCount(estimate.instruction)}`);
    } catch (error) {
        console.warn('[Theater] Token estimate failed:', error);
        $('#theater-token-summary-value').text('Token 预估暂不可用');
    }
}
// @theater-source-end refreshTokenEstimate

// @theater-source-begin updateLengthHint
function updateLengthHint(target, actual, { completedBelowTarget = false, maxRoundsReached = false } = {}) {
    const $hint = $('#theater-length-hint');
    if (!$hint.length) return;
    if (!target || !actual) {
        $hint.hide().empty();
        return;
    }
    const enough = actual >= targetCompletionChars(target);
    const text = maxRoundsReached && !enough
        ? `本次约 ${actual} 字（指令目标约 ${target} 字）。已达到自动补写总轮数上限，仍未达到目标；已保留正文，可点击下方“续写”。`
        : completedBelowTarget
        ? `已完成，约 ${actual} 字，低于目标 ${target} 字`
        : enough
        ? `本次约 ${actual} 字（指令目标约 ${target} 字）`
        : `本次约 ${actual} 字（指令目标约 ${target} 字）。如想延长内容，可点击下方“续写”。`;
    $hint.text(text).toggleClass('theater-length-hint-short', !enough).show();
}
// @theater-source-end updateLengthHint

// @theater-source-begin continuationSessionHTML
function continuationSessionHTML() {
    const session = runtime.continuationSession;
    if (!session) return '';
    return `<section id="theater-continue-hint" class="theater-continuation-session">
        <div class="theater-continuation-session-heading"><b>普通续写 · 第 ${session.segment} 段</b><button type="button" id="theater-cancel-continue" ${runtime.isGenerating || runtime.isPreparingGeneration ? 'disabled' : ''}>退出续写</button></div>
        <details class="theater-continuation-source"><summary>前情：${runtime.esc(session.source.label)} · 最近 ${session.source.rounds.length} 轮完整正文（约 ${readableCharCount(session.source.text)} 字）</summary><p>${runtime.esc(session.source.text)}</p></details>
        ${session.versions.length && !displayedContinuationVersion(session, runtime.currentDisplayHtml || runtime.lastGeneratedHtml) ? '<button type="button" class="theater-btn theater-continuation-return" id="theater-cont-return">回到本段结果</button>' : ''}
        <div id="theater-cont-exit-confirm" hidden><p>退出后结束本次续写，重要版本请先保存到历史。</p><div class="theater-continuation-actions"><button type="button" class="theater-btn" id="theater-cont-stay">留在续写</button><button type="button" class="theater-btn" id="theater-cont-confirm-exit">退出</button></div></div>
    </section>`;
}
// @theater-source-end continuationSessionHTML

// @theater-source-begin updateContinueHint
function updateContinueHint() {
    const sourceOpen = document.querySelector('.theater-continuation-source')?.open;
    $('#theater-continuation-session').html(continuationSessionHTML());
    const details = document.querySelector('.theater-continuation-source');
    if (details && sourceOpen) details.open = true;
    $('#theater-instruction-label').text(runtime.continuationSession ? '本段续写方向' : '小剧场指令');
    const busy = runtime.isGenerating || runtime.isPreparingGeneration;
    $('#theater-instruction').prop('disabled', busy && !!runtime.continuationSession);
    const html = runtime.currentDisplayHtml || runtime.lastGeneratedHtml;
    const version = displayedContinuationVersion(runtime.continuationSession, html);
    const hasVersion = !!version && !runtime.resultEditSnapshot;
    const index = version ? runtime.continuationSession.versions.indexOf(version) : -1;
    if (version) runtime.continuationSession.selected = index;
    $('#theater-continuation-result, #theater-continuation-retention').prop('hidden', !hasVersion || busy);
    $('#theater-cont-version-label').text(version ? `第 ${index + 1} 版 / 共 ${runtime.continuationSession.versions.length} 版${version.complete ? '' : ' · 未完成'}` : '');
    $('#theater-cont-version-prev').prop('disabled', busy || index <= 0);
    $('#theater-cont-version-next').prop('disabled', busy || !version || index >= runtime.continuationSession.versions.length - 1);
    $('#theater-cont-rewrite, #theater-cont-next').prop('disabled', busy || !hasVersion);
    $('#theater-cont-return').prop('disabled', busy);
    $('#theater-continue-btn').toggle(!runtime.resultEditSnapshot && !hasVersion);
    $('#theater-generate-btn').toggle(!busy && !hasVersion);
    $('#theater-generate-btn span').last().text(runtime.continuationSession ? (runtime.continuationSession.versions.length ? '重写本段' : '开始续写') : '生成');
}
// @theater-source-end updateContinueHint

// @theater-source-begin showContinuationVersion
function showContinuationVersion(index) {
    if (runtime.isGenerating || runtime.isPreparingGeneration || runtime.resultEditSnapshot) return false;
    const version = selectContinuationVersion(runtime.continuationSession, index);
    if (!version) return false;
    runtime.lastGeneratedHtml = version.html;
    runtime.lastGeneratedText = version.text;
    runtime.currentOutputMode = version.mode;
    $('#theater-instruction').val(runtime.continuationSession.direction);
    runtime.setActiveInstructionTags(version.tags || runtime.continuationSourceTags, version.instruction || '');
    runtime.showInIframe(version.html, version.mode);
    $('#theater-output-section').show();
    runtime.updateRecentNav();
    updateContinueHint();
    runtime.scheduleTokenEstimate();
    return true;
}
// @theater-source-end showContinuationVersion

// @theater-source-begin clearContinueMode
function clearContinueMode({ silent = false } = {}) {
    runtime.continueContext = '';
    runtime.continuationSession = null;
    runtime.continuationSourceTags = [];
    $('#theater-instruction').attr('placeholder', '输入指令…');
    updateContinueHint();
    runtime.updateRecentNav();
    runtime.scheduleTokenEstimate();
    if (!silent) toastr.info('已取消续写');
}
// @theater-source-end clearContinueMode

// @theater-source-begin revealContinuationInput
function revealContinuationInput() {
    const reveal = () => {
        const panels = document.querySelector('.theater-panels-wrapper');
        if (panels) panels.scrollTop = 0;

        const input = document.getElementById('theater-instruction');
        if (!input) return;
        try {
            input.focus({ preventScroll: true });
        } catch {
            input.focus();
        }
        const cursor = String(input.value || '').length;
        input.setSelectionRange?.(cursor, cursor);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal);
    else reveal();
}
// @theater-source-end revealContinuationInput

// @theater-source-begin validateFinalRenderedHtml
function validateFinalRenderedHtml(renderText, finalRenderPayload, sourceText) {
    if (!/<(?:!doctype|html|head|body|style|main|section|article|div)\b/i.test(String(renderText || ''))) {
        const invalidHtml = new Error('最终渲染未返回完整 HTML 页面');
        invalidHtml.code = 'THEATER_RENDER_VALIDATION';
        throw invalidHtml;
    }
    const templateHtml = runtime.extractHtml(renderText);
    const finalHtml = hydrateFinalRenderHtml(templateHtml, finalRenderPayload.placeholderPlan);
    const sourceChars = readableCharCount(sourceText);
    const renderedChars = readableCharCount(htmlToPlainText(finalHtml));
    const minimumPreservedChars = Math.floor(sourceChars * 0.95);
    const maximumLayoutChars = Math.ceil(sourceChars * 1.25 + 600);
    if (renderedChars < minimumPreservedChars) {
        const incomplete = new Error(`最终渲染未完整保留正文（${renderedChars}/${sourceChars} 字）`);
        incomplete.code = 'THEATER_RENDER_VALIDATION';
        throw incomplete;
    }
    if (renderedChars > maximumLayoutChars) {
        const duplicated = new Error(`最终排版疑似重复正文或加入过多额外文字（${renderedChars}/${sourceChars} 字）`);
        duplicated.code = 'THEATER_RENDER_VALIDATION';
        throw duplicated;
    }
    return { finalHtml, renderedChars, sourceChars };
}
// @theater-source-end validateFinalRenderedHtml

// @theater-source-begin requestFinalRenderedHtml
async function requestFinalRenderedHtml({
    sourceText,
    rules,
    originalInstruction = '',
    ctx,
    signal,
    apiRoute,
    onChunk = () => {},
    onRetry = () => {},
    renderLabel = '所选模板',
    metricScope = 'final-render',
} = {}) {
    const finalRenderPayload = buildFinalRenderPayload({ sourceText, rules, originalInstruction });
    runtime.lastRequestContext = {
        kind: '最终 HTML 排版',
        sourceChars: readableCharCount(sourceText),
        renderLabel,
    };
    runtime.runtimeLog('info', '最终 HTML 渲染开始', {
        scope: metricScope,
        render: renderLabel,
        source_chars: readableCharCount(sourceText),
    });
    let lastValidationError = null;
    for (let renderAttempt = 1; renderAttempt <= 2; renderAttempt++) {
        const retryNote = renderAttempt === 1 ? '' : `\n\n---\n\n【排版修复】上一次输出未通过检查：${lastValidationError?.message || '段落编号不完整'}。请重新生成整份 HTML，修复错误提示涉及的模板约束，并确认所有 token 各出现一次、顺序正确且都位于可见文本节点中。`;
        if (renderAttempt > 1) {
            runtime.runtimeLog('warn', '最终 HTML 排版校验失败，自动重试', {
                scope: metricScope,
                message: lastValidationError?.message || 'unknown',
            });
            onRetry(lastValidationError);
        }
        try {
            const result = await runtime.requestConfiguredGenerationApi({
                apiRoute,
                ctx,
                systemPrompt: finalRenderPayload.systemPrompt,
                userPrompt: finalRenderPayload.userPrompt + retryNote,
                onChunk,
                signal,
                metricScope,
            });
            const renderText = typeof result === 'string' ? result : result?.text;
            if (!renderText) throw new Error('最终渲染未返回内容');
            markCompleted(runtime.lastRequestMetrics);
            runtime.recordRequestMetrics(runtime.lastRequestMetrics);
            const validated = validateFinalRenderedHtml(renderText, finalRenderPayload, sourceText);
            runtime.runtimeLog(result?.stopReason === 'length' ? 'warn' : 'info', '最终 HTML 渲染完成', {
                scope: metricScope,
                attempt: renderAttempt,
                stop_reason: result?.stopReason || 'stop',
                rendered_chars: validated.renderedChars,
                paragraphs: finalRenderPayload.placeholderPlan.paragraphs.length,
            });
            return { html: validated.finalHtml, mode: 'html', result };
        } catch (error) {
            runtime.recordRequestMetrics(runtime.lastRequestMetrics);
            if (error?.name === 'AbortError') throw error;
            const validationFailure = ['THEATER_PLACEHOLDER_INVALID', 'THEATER_RENDER_VALIDATION'].includes(error?.code);
            if (!validationFailure || renderAttempt >= 2) throw error;
            lastValidationError = error;
        }
    }
    throw lastValidationError || new Error('最终 HTML 排版未完成');
}
// @theater-source-end requestFinalRenderedHtml

// @theater-source-begin normalizeLongDreamResponseText
function normalizeLongDreamResponseText(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /<(?:!doctype|\/?html|\/?body|\/?main|\/?article|\/?section|\/?div|\/?p|\/?span|\/?content|\/?snow)\b/i.test(raw)
        ? (htmlToPlainText(raw) || raw)
        : raw.replace(/^```(?:text|markdown)?\s*/i, '').replace(/```\s*$/i, '').trim();
}
// @theater-source-end normalizeLongDreamResponseText

// @theater-source-begin startContinue
function startContinue(html, tags = [], { sourceLabel = '当前小剧场', segment = 1, sourceRounds = [], sourceItem = null } = {}) {
    if (runtime.isGenerating || runtime.isPreparingGeneration || runtime.resultEditSnapshot) { toastr.warning('请先完成当前生成或文字编辑'); return; }
    const plainText = htmlToPlainText(html);
    if (!plainText) { toastr.warning('没有可续写的内容'); return; }

    const rounds = normalizeContinuationRounds(sourceRounds).map(prepareContinuationContext).filter(Boolean);
    runtime.continuationSession = createContinuationSession({ sourceText: plainText, sourceRounds: rounds, sourceLabel, segment });
    runtime.continuationSession.historyMetadata = continuationHistoryMetadata(sourceItem || { html, title: sourceLabel, tags, continuationRounds: sourceRounds, mode: runtime.currentOutputMode });
    runtime.continueContext = runtime.continuationSession.source.text;
    runtime.continuationSourceTags = itemTags({ tags }, runtime.knownInstructionTags());
    runtime.activeInstructionTags = [...runtime.continuationSourceTags];
    runtime.activeInstructionContent = '';

    // 跳转到生成面板
    $('.theater-tab[data-tab="generate"]').click();
    runtime.switchResultWorkspace('generate');
    runtime.clearDisplayedResult();
    $('#theater-instruction').val('').attr('placeholder', '可留空直接自然续写，也可填写本次方向…');
    updateContinueHint();
    runtime.scheduleTokenEstimate();
    revealContinuationInput();
    toastr.info('前情已载入；指令可留空，点击“生成”即可自然续写');
}
// @theater-source-end startContinue

// @theater-source-begin stopGeneration
function stopGeneration() {
    runtime.runtimeLog('warn', '用户请求停止生成');
    if (runtime.currentGenerationJob) abortGenerationJob(runtime.currentGenerationJob);
    if (runtime.abortController) { runtime.abortController.abort(); runtime.abortController = null; }
    runtime.isGenerating = false;
    runtime.bgStreamText = '';
}
// @theater-source-end stopGeneration

// @theater-source-begin generateTheater
async function generateTheater() {
    if (runtime.isGenerating || runtime.isPreparingGeneration) { toastr.warning('正在准备或生成中，请稍等'); return; }
    if (runtime.longDreamGenerationController?.active) { toastr.warning('长梦章节正在生成，请完成或停止后再生成普通小剧场'); return; }
    if (runtime.longDreamChapterEditController) { toastr.warning('长梦正式章节正在重新排版，请等待完成'); return; }
    if (runtime.longDreamCanonSuggestionState.controller) { toastr.warning('AI 定梦建议正在整理，请等待完成或先停止'); return; }
    if (runtime.resultEditSnapshot) { toastr.warning('请先应用修改或退出文字编辑'); return; }
    if (runtime.continuationSession) runtime.continueContext = runtime.continuationSession.source.text;
    const typedInstruction = $('#theater-instruction').val().trim();
    if (runtime.continuationSession) runtime.continuationSession.direction = typedInstruction;
    const instruction = typedInstruction || (runtime.continueContext
        ? '请承接已有正文自然续写，保持人物、视角与语气一致，推进新的情节，不要重复前文。'
        : '');
    if (!instruction) { toastr.warning('请输入指令'); return; }
    if ($('#theater-manual-target-enabled').length) {
        runtime.settings.manualTargetEnabled = $('#theater-manual-target-enabled').is(':checked');
        runtime.settings.manualTargetChars = normalizeManualTarget($('#theater-manual-target-chars').val());
    }
    if (typedInstruction) runtime.settings.lastInstruction = typedInstruction;
    runtime.save();
    const sourceTags = runtime.continueContext
        ? runtime.continuationSourceTags
        : (typedInstruction && typedInstruction === runtime.activeInstructionContent ? runtime.activeInstructionTags : []);
    try {
        await runGeneration(instruction, false, sourceTags);
    } catch (error) {
        console.error('[Theater] Generation preparation failed:', error);
        toastr.error(error?.message || '生成资料读取失败，请稍后重试');
    }
}
// @theater-source-end generateTheater

// @theater-source-begin runGeneration
async function runGeneration(instruction, isAuto, sourceTags = []) {
    if (runtime.isGenerating || runtime.isPreparingGeneration || runtime.resultEditSnapshot) return false;
    const contCtx = isAuto ? '' : runtime.continueContext;  // 自动生成永远是全新的，不掺手动的续写上下文
    const continuationRun = !isAuto && contCtx ? runtime.continuationSession : null;
    const continuationDirection = continuationRun?.direction || '';
    const plannedTargetWordCount = resolveTargetWordCount(instruction, {
        manualEnabled: runtime.settings.manualTargetEnabled,
        manualTarget: runtime.settings.manualTargetChars,
    });
    const configuredMaxRounds = Math.min(10, Math.max(1, Number(runtime.settings.maxAutoRounds) || 3));
    const stagedRenderMode = !contCtx && isStagedRenderTarget(plannedTargetWordCount);
    const plannedRenderSelection = resolveRenderSelection(false);
    const stagedMultiRoundMode = stagedRenderMode && runtime.settings.autoContinue && configuredMaxRounds >= 2;
    runtime.isPreparingGeneration = true;
    updateContinueHint();
    let payload;
    try {
        payload = await assembleGenerationPayload(instruction, {
            continuationText: contCtx,
            forcePlainText: stagedRenderMode,
            longFormPlan: stagedMultiRoundMode,
            maxContinuationRounds: configuredMaxRounds,
        });
    } finally {
        runtime.isPreparingGeneration = false;
        updateContinueHint();
    }
    runtime.lastRequestContext = {
        ...payload.diagnosticContext,
        kind: isAuto ? '自动小剧场' : (contCtx ? '普通续写' : '普通小剧场'),
    };
    runtime.clearRequestIssue();
    if (isAuto) runtime.lastAutoIssue = null;
    const targetWordCount = payload.targetWordCount;
    const autoTargetContinue = isStagedRenderTarget(targetWordCount) && runtime.settings.autoContinue;
    let { ctx, systemPrompt, userPrompt: prompt, isPlainTextRender } = payload;
    const { selectedRender: selectedRenderProfile, label: renderTemplate, isPlainTextRender: selectedPlainTextRender, textTheme: selectedTextTheme } = plannedRenderSelection;
    const apiRoute = runtime.captureGenerationApiRoute(ctx);
    const generationSourceConfig = {
        metadataCaptured: true,
        presetName: runtime.settings.selectedPresetName || '',
        selectedWorldBooks: [...(runtime.settings.selectedWorldBooks || [])],
        readChatContext: runtime.settings.readChatContext !== false,
        contextRange: normalizeContextRange(runtime.settings.contextRange),
        renderSelection: selectedRenderProfile,
        renderLabel: renderTemplate,
        textTheme: selectedTextTheme,
        tags: itemTags({ tags: sourceTags }, runtime.knownInstructionTags()),
    };
    runtime.runtimeLog('info', '生成开始', {
        trigger: isAuto ? 'auto' : (contCtx ? 'continue' : 'manual'),
        render: renderTemplate,
        protocol: apiRoute.protocol,
        model: apiRoute.model,
        max_tokens: apiRoute.maxTokens,
        target_chars: targetWordCount || null,
        length_tier: classifyLengthTier(targetWordCount),
        staged_render_mode: stagedRenderMode,
        staged_multi_round_mode: stagedMultiRoundMode,
    });

    // Move the previous completed result only when the next generation is ready.
    runtime.isPreparingGeneration = true;
    let archived;
    try { archived = await runtime.archiveCurrentResult(); }
    finally { runtime.isPreparingGeneration = false; }
    if (!archived) { updateContinueHint(); return false; }
    // 标记开始生成
    runtime.isGenerating = true;
    runtime.bgStreamText = '';
    runtime.bgError = '';
    runtime.lastGeneratedHtml = '';
    runtime.lastGeneratedText = '';
    runtime.currentOutputMode = isPlainTextRender ? textOutputModeForTheme(payload.textTheme) : 'html';

    // UI（面板可能在生成过程中被关掉，所以用函数判断面板是否还在）
    const popupAlive = () => $('#theater-generate-btn').length > 0;

    $('#theater-output-section').hide();
    $('#theater-stream-section').show();
    $('#theater-stream-text').text('');
    $('#theater-length-hint').hide().empty();
    $('#theater-generate-btn').hide();
    $('#theater-stop-btn').show();
    $('#theater-quick-render-toggle').prop('disabled', true);
    updateContinueHint();
    runtime.abortController = new AbortController();
    let firstChunkShown = false;
    const streamRenderer = runtime.createCumulativeStreamRenderer(
        () => document.getElementById('theater-stream-text'),
    );
    let activeRound = 1;
    let progressLogged = false;
    let nextProgressAt = 1000;
    let retainStreamAsBody = true;
    let currentRoundStreamText = '';
    const onChunk = (text) => {
        runtime.bgStreamText = text;
        if (retainStreamAsBody) currentRoundStreamText = String(text || '');
        const cumulativeChars = String(text || '').length;
        if (cumulativeChars > 0 && (!progressLogged || cumulativeChars >= nextProgressAt)) {
            runtime.runtimeLog('info', '流式进度', { round: activeRound, cumulative_chars: cumulativeChars });
            progressLogged = true;
            nextProgressAt = Math.max(1000, (Math.floor(cumulativeChars / 1000) + 1) * 1000);
        }
        if (!firstChunkShown && String(text || '').trim()) {
            firstChunkShown = true;
            markFirstToken(runtime.lastRequestMetrics);
            streamRenderer.update(runtime.bgStreamText, { immediate: true });
            return;
        }
        streamRenderer.update(runtime.bgStreamText);
    };
    let generationSucceeded = false;
    runtime.currentGenerationJob = createGenerationJob({
        targetChars: targetWordCount,
        maxRounds: autoTargetContinue ? configuredMaxRounds : 1,
        minimumRounds: stagedMultiRoundMode ? 2 : 1,
        autoContinue: autoTargetContinue,
        requireTargetCompletion: stagedMultiRoundMode,
    });

    try {
        let firstHtml = '';
        let roundPayload = payload;
        while (true) {
            if (runtime.currentGenerationJob.aborted) throw new DOMException('Aborted', 'AbortError');
            const round = runtime.currentGenerationJob.round;
            activeRound = round;
            progressLogged = false;
            nextProgressAt = 1000;
            retainStreamAsBody = true;
            currentRoundStreamText = '';
            if (popupAlive()) {
                const current = readableCharCount(runtime.currentGenerationJob.segments.join('\n\n'));
                const shownMaxRounds = runtime.currentGenerationJob.autoContinue ? runtime.currentGenerationJob.maxRounds : 1;
                $('#theater-stream-text').text(round === 1
                    ? (stagedMultiRoundMode
                        ? `正在创作同一篇正文的前半部分 · 第 1/${shownMaxRounds} 轮……`
                        : `正在生成第 1/${shownMaxRounds} 轮……`)
                    : `正在补写第 ${round}/${shownMaxRounds} 轮 · 当前约 ${current}/${targetWordCount} 字`);
            }
            systemPrompt = roundPayload.systemPrompt;
            prompt = roundPayload.userPrompt;
            ctx = roundPayload.ctx;
            const requestOptions = {
                messages: roundPayload.messages,
                postProcessing: roundPayload.postProcessing || '',
                presetName: roundPayload.presetName || runtime.settings.selectedPresetName || '内置默认预设',
                tracePurpose: round === 1 ? 'creative' : 'continuation',
            };
            const result = await runtime.requestConfiguredGenerationApi({
                apiRoute,
                ctx,
                systemPrompt,
                userPrompt: prompt,
                onChunk,
                signal: runtime.abortController?.signal,
                requestOptions,
            });
            const responseText = typeof result === 'string' ? result : result?.text;
            if (!responseText) throw new Error('API未返回内容');
            markCompleted(runtime.lastRequestMetrics);
            runtime.recordRequestMetrics(runtime.lastRequestMetrics);

            let segmentText;
            if (round === 1 && !isPlainTextRender) {
                firstHtml = runtime.extractHtml(responseText);
                segmentText = htmlToPlainText(firstHtml) || htmlToPlainText(responseText) || String(responseText).trim();
            } else {
                segmentText = htmlToPlainText(responseText) || String(responseText).trim();
            }
            if (!segmentText) throw new Error('生成完成但没有可显示内容');
            const resolvedStopReason = result?.stopReason && result.stopReason !== 'unknown' ? result.stopReason : 'stop';
            addGenerationSegment(runtime.currentGenerationJob, segmentText, resolvedStopReason, result?.rawStopReason || null);
            currentRoundStreamText = '';
            runtime.runtimeLog(resolvedStopReason === 'length' ? 'warn' : 'info', '请求结束', {
                round,
                stop_reason: resolvedStopReason,
                raw_stop_reason: result?.rawStopReason || null,
                inferred: !result?.stopReason || result.stopReason === 'unknown',
                segment_chars: readableCharCount(segmentText),
            });

            if (!shouldContinueJob(runtime.currentGenerationJob, readableCharCount)) break;
            const shouldFinishThisRound = shouldAuthorizeFinishRound(runtime.currentGenerationJob, readableCharCount);
            runtime.currentGenerationJob.round++;
            authorizeFinish(runtime.currentGenerationJob, shouldFinishThisRound);
            const finishThisRound = runtime.currentGenerationJob.finishAuthorized;
            const continuationInstruction = buildContinuationInstruction({
                round: runtime.currentGenerationJob.round,
                finishThisRound,
                currentChars: runtime.currentGenerationJob.actualChars,
                targetChars: runtime.currentGenerationJob.targetChars,
                roundsRemaining: runtime.currentGenerationJob.maxRounds - runtime.currentGenerationJob.round + 1,
                manuscriptMode: stagedMultiRoundMode,
                continuationTask: !!contCtx,
                originalInstruction: payload.generationFoundation?.originalInstruction || '',
                draft: recentGenerationRoundsContext(continuationRoundHistory(continuationRun?.source.rounds, runtime.currentGenerationJob.segments.map(prepareContinuationContext))),
            });
            roundPayload = buildGenerationContinuationRoundPayload({
                foundation: payload.generationFoundation,
                instruction: continuationInstruction,
                ctx,
                manuscriptMode: stagedMultiRoundMode,
            });
            firstChunkShown = false;
            runtime.bgStreamText = '';
            streamRenderer.reset();
        }

        let newText = runtime.currentGenerationJob.segments.join('\n\n').trim();
        runtime.currentGenerationJob.actualChars = readableCharCount(newText);
        if (selectedPlainTextRender) {
            runtime.lastGeneratedHtml = runtime.textFallbackHtml(newText, selectedTextTheme);
            runtime.currentOutputMode = textOutputModeForTheme(selectedTextTheme);
        } else if (!stagedRenderMode && runtime.currentGenerationJob.segments.length === 1) {
            runtime.lastGeneratedHtml = firstHtml || runtime.textFallbackHtml(newText);
        } else {
            const { rules } = plannedRenderSelection;
            if (popupAlive()) $('#theater-stream-text').text('正文创作已结束，正在套用所选 HTML 模板……');
            activeRound = 'render';
            firstChunkShown = false;
            runtime.bgStreamText = '';
            retainStreamAsBody = false;
            currentRoundStreamText = '';
            try {
                const rendered = await requestFinalRenderedHtml({
                    sourceText: newText,
                    rules,
                    originalInstruction: payload.generationFoundation?.originalInstruction || '',
                    ctx,
                    signal: runtime.abortController?.signal,
                    apiRoute,
                    onChunk,
                    renderLabel: renderTemplate,
                    metricScope: 'final-render',
                    onRetry: () => {
                        if (popupAlive()) $('#theater-stream-text').text('排版完整性校验未通过，正在修复 HTML……');
                        firstChunkShown = false;
                        runtime.bgStreamText = '';
                        streamRenderer.reset();
                    },
                });
                runtime.lastGeneratedHtml = rendered.html;
                runtime.currentOutputMode = rendered.mode;
            } catch (renderError) {
                if (renderError?.name === 'AbortError') throw renderError;
                const renderIssue = runtime.captureRequestIssue(renderError, { stage: '最终 HTML 排版' });
                runtime.lastGeneratedHtml = runtime.textFallbackHtml(newText);
                runtime.currentOutputMode = 'text';
                runtime.runtimeLog('warn', '最终 HTML 渲染失败', { signal: renderIssue.signal, fallback: '纯文字' });
                toastr.warning(`最终 HTML 排版失败：${renderIssue.signal}；已保留完整正文。可在【诊断】查看说明。`);
            }
        }
        runtime.runtimeLog('info', '渲染路径', { path: runtime.currentOutputMode === 'html' ? '正常 HTML' : '纯文字' });
        runtime.lastGeneratedText = newText;
        if (!contCtx) {
            const finalVisibleChars = readableCharCount(htmlToPlainText(runtime.lastGeneratedHtml));
            if (finalVisibleChars) runtime.currentGenerationJob.actualChars = finalVisibleChars;
        }
        updateLengthHint(targetWordCount, runtime.currentGenerationJob.actualChars, {
            completedBelowTarget: runtime.currentGenerationJob.completedBelowTarget,
            maxRoundsReached: runtime.currentGenerationJob.autoContinue && runtime.currentGenerationJob.round >= runtime.currentGenerationJob.maxRounds,
        });
        const continuationRounds = continuationRoundHistory(continuationRun?.source.rounds, runtime.currentGenerationJob.segments.map(prepareContinuationContext));
        runtime.retainedResultSource = null;
        generationSucceeded = true;
        if (continuationRun && runtime.continuationSession === continuationRun) {
            appendContinuationVersion(continuationRun, {
                ...continuationRun.historyMetadata,
                html: runtime.lastGeneratedHtml, text: newText, mode: runtime.currentOutputMode, continuationRounds,
                direction: continuationDirection, instruction, tags: [...sourceTags], sourceConfig: generationSourceConfig,
            });
        }

        // The current result is independent of the three older results on the reading page.
        if (runtime.lastGeneratedHtml) {
            const item = {
                ...continuationRun?.historyMetadata,
                resultId: newHistoryKey(), html: runtime.lastGeneratedHtml,
                mode: runtime.currentOutputMode, continuationRounds,
                time: new Date().toLocaleString('zh-CN', { hour12: false }),
                instruction: instruction || '', sourceConfig: generationSourceConfig,
                tags: itemTags({ tags: sourceTags }, runtime.knownInstructionTags()),
            };
            if (!await runtime.storeCurrentResult(item)) {
                // Still keep the completed result in this session even if the browser's store is full.
                runtime.currentGenerationResult = item;
            }
            runtime.setActiveInstructionTags(sourceTags, instruction);
        }

        if (popupAlive()) {
            runtime.showInIframe(runtime.lastGeneratedHtml, runtime.currentOutputMode);
            $('#theater-stream-section').hide();
            $('#theater-output-section').show();
            runtime.updateRecentNav();
        }
        const reached = !targetWordCount || runtime.currentGenerationJob.actualChars >= targetCompletionChars(targetWordCount);
        runtime.runtimeLog(runtime.currentGenerationJob.stopReason === 'length' && !reached ? 'warn' : 'info', '生成停止', {
            reason: runtime.currentGenerationJob.completedBelowTarget ? 'finished_below_target' : (runtime.currentGenerationJob.stopReason || 'unknown'),
            rounds: runtime.currentGenerationJob.round,
            actual_chars: runtime.currentGenerationJob.actualChars,
            target_chars: targetWordCount || null,
            reached_target: reached,
        });
        const stopText = runtime.currentGenerationJob.stopReason === 'length' ? '（达到输出 Token 上限）' : '';
        const summary = targetWordCount
            ? `目标约 ${targetWordCount} 字 · 实际约 ${runtime.currentGenerationJob.actualChars} 字 · 共 ${runtime.currentGenerationJob.round} 轮${stopText}`
            : `生成完成 · 共 ${runtime.currentGenerationJob.round} 轮${stopText}`;
        if (runtime.currentGenerationJob.completedBelowTarget) {
            toastr.warning(`已完成，约 ${runtime.currentGenerationJob.actualChars} 字，低于目标 ${targetWordCount} 字`, '', { timeOut: 9000 });
        } else if (reached) {
            toastr.success(summary, '', { timeOut: 7000 });
        } else {
            toastr.warning(`${summary}${runtime.currentGenerationJob.round >= runtime.currentGenerationJob.maxRounds && runtime.currentGenerationJob.autoContinue ? ' · 已达到自动补写上限' : ' · 未达到目标'}`, '', { timeOut: 9000 });
        }
        runtime.playNotificationSound();
        if (isAuto) runtime.setBallDot(true);
    } catch (err) {
        runtime.recordRequestMetrics(runtime.lastRequestMetrics);
        const liveBodyText = retainStreamAsBody
            ? (htmlToPlainText(currentRoundStreamText) || String(currentRoundStreamText || '').trim())
            : '';
        const partialText = generationTextWithLiveSegment(runtime.currentGenerationJob, liveBodyText);
        if (partialText) {
            runtime.runtimeLog('warn', '渲染路径', { path: '错误兜底', retained_chars: readableCharCount(partialText) });
            runtime.lastGeneratedText = partialText;
            runtime.lastGeneratedHtml = runtime.textFallbackHtml(partialText);
            runtime.currentOutputMode = 'text';
            runtime.retainedResultSource = {
                html: runtime.lastGeneratedHtml, mode: runtime.currentOutputMode, instruction,
                ...continuationRun?.historyMetadata,
                tags: [...sourceTags], sourceConfig: generationSourceConfig,
                continuationRounds: continuationRoundHistory(continuationRun?.source.rounds, [...runtime.currentGenerationJob.segments, liveBodyText].map(prepareContinuationContext)),
            };
            if (continuationRun && runtime.continuationSession === continuationRun) {
                appendContinuationVersion(continuationRun, {
                    ...continuationRun.historyMetadata,
                    html: runtime.lastGeneratedHtml, text: partialText, mode: runtime.currentOutputMode,
                    continuationRounds: continuationRoundHistory(continuationRun.source.rounds, [...runtime.currentGenerationJob.segments, liveBodyText].map(prepareContinuationContext)),
                    direction: continuationDirection, instruction, tags: [...sourceTags], sourceConfig: generationSourceConfig, complete: false,
                });
            }
            const partialItem = { ...runtime.retainedResultSource, html: runtime.lastGeneratedHtml, mode: runtime.currentOutputMode,
                resultId: newHistoryKey(), complete: false, time: new Date().toLocaleString('zh-CN', { hour12: false }) };
            if (!await runtime.storeCurrentResult(partialItem)) runtime.currentGenerationResult = partialItem;
            if (popupAlive()) {
                runtime.showInIframe(runtime.lastGeneratedHtml, 'text');
                $('#theater-stream-section').hide();
                $('#theater-output-section').show();
            }
        }
        if (err.name === 'AbortError') {
            runtime.runtimeLog('warn', '生成停止', { reason: 'abort', retained_chars: readableCharCount(partialText) });
            toastr.info(partialText ? '已停止，已保留当前生成内容，不会继续请求' : '已停止，不会继续发起下一轮请求');
            return;
        }
        const issue = runtime.captureRequestIssue(err, { stage: '正文生成' });
        console.error('[Theater] 正文生成失败:', issue.signal);
        runtime.bgError = issue.signal;
        runtime.runtimeLog('error', '生成停止', {
            reason: 'error',
            signal: issue.signal,
            stage: issue.stage,
            raw_stop_reason: issue.rawStopReason,
            retained_chars: readableCharCount(partialText),
        });
        runtime.theaterError(runtime.requestFailureMessage('生成失败', issue, { retained: !!partialText }));
    } finally {
        runtime.isGenerating = false;
        streamRenderer.reset({ flushPending: true });
        if (!generationSucceeded && !runtime.lastGeneratedHtml && continuationRun && runtime.continuationSession === continuationRun) {
            const previous = continuationRun.versions[continuationRun.selected];
            if (previous) {
                runtime.lastGeneratedHtml = previous.html;
                runtime.lastGeneratedText = previous.text;
                runtime.currentOutputMode = previous.mode;
                if (popupAlive()) {
                    runtime.showInIframe(previous.html, previous.mode);
                    $('#theater-output-section').show();
                }
            }
        }
        if (!isAuto && !contCtx && !runtime.continuationSession) {
            runtime.continueContext = '';
            $('#theater-continue-hint').remove();
            $('#theater-instruction').attr('placeholder', '输入指令…');
        } else if (!isAuto && contCtx && generationSucceeded) {
            $('#theater-instruction').attr('placeholder', '可留空直接自然续写，也可填写本次方向…');
            updateContinueHint();
        }
        if (popupAlive()) {
            $('#theater-generate-btn').show();
            $('#theater-stop-btn').hide();
            $('#theater-quick-render-toggle').prop('disabled', false);
        }
        updateContinueHint();
        runtime.abortController = null;
        runtime.currentGenerationJob = null;
    }
    return true;
}
// @theater-source-end runGeneration

return { htmlToPlainText, prepareContinuationContext, generationPreparationKey, resolveRenderSelection, resolveGenerationIdentity, generationIdentitySlots, freezeGenerationFoundationList, buildGenerationContinuationRoundPayload, assembleGenerationPayload, refreshTokenEstimate, updateLengthHint, continuationSessionHTML, updateContinueHint, showContinuationVersion, clearContinueMode, revealContinuationInput, validateFinalRenderedHtml, requestFinalRenderedHtml, normalizeLongDreamResponseText, startContinue, stopGeneration, generateTheater, runGeneration };
}
