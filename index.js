import { SOUND_PRESETS, LAMP_SVG_HTML, DEFAULT_SYSTEM_PROMPT, DEFAULT_RENDER_TEMPLATE, DEFAULT_RENDER_TEMPLATE_PC, DEFAULT_RENDER_TEMPLATE_TEXT, SKIN_LABELS } from './theater-defaults.js';
import { createTheaterRequestState } from './theater-request-state.js';
import { createTheaterRenderSelection } from './theater-render-selection.js';
import { createLongDreamNavigation } from './long-dream-navigation.js';
import { createTheaterStorage } from './theater-storage.js';
import { createTheaterUpdate } from './theater-update.js';
import { createTheaterAppearance } from './theater-appearance.js';
import { createTheaterPopupUi } from './theater-popup-ui.js';
import { createLongDreamWorkspace } from './long-dream-workspace.js';
import { createTheaterMaterials } from './theater-materials.js';
import { createTheaterInstructions } from './theater-instructions.js';
import { createTheaterPopupController } from './theater-popup-controller.js';
import { createTheaterApiSettings } from './theater-api-settings.js';
import { createTheaterResultWorkspace } from './theater-result-workspace.js';
import { createTheaterHistory } from './theater-history.js';
import { createTheaterEvents } from './theater-events.js';
import { createTheaterGeneration } from './theater-generation.js';
import { createLongDreamRuntime } from './long-dream-runtime.js';
import { createTheaterAutoMode } from './theater-auto-mode.js';
import { createTheaterApi } from './theater-api.js';
import { createTheaterDiagnostics } from './theater-diagnostics.js';
import { remapHistorySource, historyKey, historyOrder, orderedHistory, normalizeCollections, historyEntries, collectionPage, collectionChapters, moveCollectionItems, remapHistoryImport, continuationHistoryMetadata, planHistorySave, newHistoryKey } from './history-collections.js';
import { collectionCardHTML, collectionDialog, collectionChapterIds } from './history-collections-ui.js';
import { bindResultSwipe, animateResultPage } from './result-swipe.js';
import { createHtmlTextEdit, previousResults } from './result-text-edit.js';
import { readerPaneHTML, mountResultReader } from './result-reader.js';
import { restoreStorySummary } from './long-dream-story-summary.js';
import { summaryUnavailableReason } from './long-dream-summary-ui.js';
import { refreshLongDreamSummary } from './long-dream-summary.js';
// 千夜浮梦 · 小剧场生成器 — by 禾禾 & 麓克
// Icon: "magic-lamp" by Lorc, game-icons.net, CC BY 3.0 — https://game-icons.net/1x1/lorc/magic-lamp.html

import { theaterError as notifyTheaterError } from './notify.js';
import { listPage, listPaginationHTML, requestedListPage } from './pagination.js';
import { playSoundFile } from './notification-sound.js';
import { bindPersonaFollowRefresh, syncPersonaToSettings } from './persona-follow.js';
import { compareVersion, fetchInstalledExtensionStatus, fetchLatestRemoteVersion, formatVersionCheckError } from './version-check.js';
import { installSafeResizeListener, renderSafeIframe } from './safe-renderer.js';
import { API_PROTOCOLS, DEFAULT_MAX_OUTPUT_TOKENS, buildApiEndpoint, buildApiRequest, normalizeMaxTokens, resolveMainApiModel, resolveProtocol } from './api-client.js';
import { requestCustomApi, requestMainApi } from './api-runtime.js';
import { recognizeInstructionTitle } from './instruction-title.js';
import { STORY_RELATION_CONTINUITY_RULE, buildContinuationInstruction, buildContinuationPayload, buildFinalRenderPayload, buildGenerationPayload, hydrateFinalRenderHtml, recentGenerationRoundsContext } from './generation-payload.js';
import { ADAPTIVE_RENDER_SELECTIONS, adaptiveRenderProfile, adaptiveRenderProfiles, isAdaptiveRenderSelection } from './adaptive-render.js';
import { normalizeContinuationRounds, continuationRoundHistory, createContinuationSession, appendContinuationVersion, selectContinuationVersion, displayedContinuationVersion } from './continuation-session.js';
import { createTokenBreakdownEstimator, debounce, estimateTokenBreakdown, estimateTokenCount, formatTokenCount } from './token-estimator.js';
import { createRequestMetrics, markCompleted, markFailed, markFallback, markFirstToken, summarizeMetrics } from './request-metrics.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, classifyRequestFailure, diagnosticSignalCatalog, diagnosticSignalInfo, formatConnectionDiagnostics, signalForStopReason } from './request-diagnostics.js';
import { autoSourceLabel, resolveAutoInstruction } from './auto-mode.js';
import { abortGenerationJob, addGenerationSegment, authorizeFinish, createGenerationJob, generationTextWithLiveSegment, shouldAuthorizeFinishRound, shouldContinueJob, targetCompletionChars } from './generation-job.js';
import { readableCharCount } from './text-counter.js';
import { classifyLengthTier, continuationFirstRoundGuidance, firstRoundGuidance, isStagedRenderTarget, longFormFirstRoundGuidance, normalizeManualTarget, resolveTargetWordCount, stripTargetWordCountRequirement } from './length-policy.js';
import { MAX_RUNTIME_LOGS, clearRuntimeLogs, formatRuntimeLogs, getRuntimeLogEntries, sanitizeLogText, setRuntimeLogSecretProvider, writeRuntimeLog } from './runtime-log.js';
import { MAX_API_PRESETS, apiPresetSecretValues, createApiPresetFromConfig, normalizeApiPresetList } from './api-presets.js';
import { splitInstructionTextFile } from './instruction-import.js';
import { AUTO_CONTINUE_SCHEMA, migrateAutoContinueDefault } from './settings-migration.js';
import { createInstructionBackup, parseInstructionBackup } from './instruction-backup.js';
import { rememberWorldBookEntryStates, shouldReadWorldBookEntry, syncFollowedWorldBooks, worldBookEntryStrategy } from './world-book-policy.js';
import { buildProtagonistAnchor } from './protagonist-anchor.js';
import { scanWithCurrentSillyTavern } from './world-book-runtime.js';
import { MAX_CONTEXT_MESSAGES, normalizeContextRange, takeRecentMessages } from './context-policy.js';
import { MAX_CONTEXT_EXCLUSION_LENGTH, MAX_CONTEXT_EXCLUSION_RULES, createChatContextReader, normalizeContextExclusionRules, previewChatContext, validateContextExclusionRule } from './context-exclusions.js';
import { PLAIN_TEXT_DARK_SELECTION, PLAIN_TEXT_LIGHT_SELECTION, buildPlainTextHtml, isPlainTextSelection, isTextOutputMode, plainTextThemeForSelection, textOutputModeForTheme, textThemeForOutputMode } from './plain-text-renderer.js';
import { HISTORY_ARCHIVE_MANIFEST, createHistoryArchive, createHistoryJsonBackup, historyItemsFromArchive, normalizeHistoryBackup } from './history-backup.js';
import { LONG_DREAM_DRAFT_RESUME_STAGE, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_MAX_CANDIDATES, LONG_DREAM_MEMORY_STATUS, LONG_DREAM_MEMORY_TYPES, LONG_DREAM_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, LONG_DREAM_WORLD_LINE_RELATION, applyLongDreamMemoryPatch, clearLongDreamDraft, createLongDreamBranch, createLongDreamRecord, createLongDreamWorldBookSnapshot, deleteLongDreamFrom, discardLongDreamWritingAttempt, latestLongDreamChapter, normalizeLongDreamRecord, prepareLongDreamMemoryRegeneration, recoverInterruptedLongDreamMemory, rejectLongDreamMemoryV2RecordItem, resolveLongDreamMemoryV2RecordConflict, selectLongDreamDraftCandidate, retainLongDreamDraftCandidate, setLongDreamMemoryCardStatus, setLongDreamMemoryStatus, setLongDreamMemoryV2RecordItemHidden, setLongDreamStatus, truncateLongDreamAfter, updateLongDreamChapter, updateLongDreamDefinition, updateLongDreamMemoryCard, updateLongDreamMemoryV2RecordItem } from './long-dream.js';
import { LONG_DREAM_GENERATION_STAGE, createLongDreamGenerationController } from './long-dream-generation.js';
import { MAX_LONG_DREAM_BACKUP_BYTES, createLongDreamBackup, parseLongDreamBackup } from './long-dream-backup.js';
import { LONG_DREAM_ARCHIVE_MANIFEST, MAX_LONG_DREAM_ARCHIVE_BYTES, MAX_LONG_DREAM_ARCHIVE_FILES, createLongDreamArchive, parseLongDreamArchive } from './long-dream-archive.js';
import { LONG_DREAM_RECENT_CHAPTER_COUNT, buildLongDreamChapterMessages, buildLongDreamChapterPayload, longDreamWorldBookEntries, selectRelevantLongDreamMemoryCards, selectRelevantLongDreamMemoryItems } from './long-dream-payload.js';
import { DEFAULT_LONG_DREAM_MEMORY_PRESET, LEGACY_DEFAULT_LONG_DREAM_MEMORY_PRESET, buildLongDreamMemoryPayload, parseLongDreamMemoryResponse, shouldWeaveLongDreamMemory } from './long-dream-memory.js';
import { LONG_DREAM_MEMORY_BUILTIN_PRESET_ID, MAX_LONG_DREAM_MEMORY_PRESET_BYTES, createLongDreamMemoryPreset, exportLongDreamMemoryPreset, normalizeLongDreamMemoryPresetList, parseLongDreamMemoryPreset } from './long-dream-memory-presets.js';
import { LONG_DREAM_CANON_SUGGESTION_CATEGORIES, buildLongDreamCanonSuggestionPayload, composeLongDreamCanon, parseLongDreamCanonSuggestions } from './long-dream-canon-suggestions.js';
import { bookmarkPlacementFromPoint, bookmarkPosition, normalizeBookmarkSide, normalizeBookmarkYRatio } from './result-bookmark.js';
import { applyPromptPostProcessing, composeGenerationContinuationMessages, composePresetMessages, noToolsPostProcessingMode, normalizePromptRole } from './request-layout.js';
import { createRequestTrace, formatRequestTrace, requestTraceCompatibilityLabel, requestTraceMessageLabel } from './request-trace.js';
import { migrateLegacyPresetEntryStates, presetEntryStatesForPreset } from './preset-entry-states.js';
import { TAG_UNCATEGORIZED, cleanTagName, itemTags, matchesTagFilter, mergeTagLists, migrateLegacyTagSettings, normalizeTagFilter, normalizeTagList, removeTagFromList, renameTagInList } from './tag-system.js';
import { waitForPopupElements, withPreservedPopupViewport } from './popup-lifecycle.js';

const MODULE_NAME = 'theater_generator';
const VERSION = '4.4.2';
const LONG_DREAM_OPTIONAL_CONTEXT_CHAR_BUDGET = 32000;
let latestRemoteVersion = null;
let installedBranchHasUpdate = false;
let installedBranchName = '';
let installedBranchStatusKnown = false;
let installedBranchCheckPending = false;
let updateCheckPromise = null;
let lastUpdateCheckAt = 0;
let updateReadyToReload = false;
let lastRequestMetrics = null;
const requestMetricsLog = [];
let lastRequestIssue = null;
let lastRequestContext = null;
let lastRequestTrace = null;
let lastApiResponseSummary = null;
let lastApiConnectionSummary = null;
let lastAutoIssue = null;
let lastAutoIssueFingerprint = '';
let currentGenerationJob = null;
let longDreamGenerationController = null;
let activeLongDreamGenerationId = null;
let longDreamProgressTicker = null;
let longDreamLiveDraftText = '';
let longDreamRenderReceivedChars = 0;
let longDreamRenderRepairing = false;
installSafeResizeListener();

// @theater-source theater-request-state.js recordRequestMetrics

// @theater-source theater-request-state.js captureRequestIssue

// @theater-source theater-request-state.js clearRequestIssue

// @theater-source theater-request-state.js requestFailureMessage

// @theater-source theater-request-state.js countSnapshotEntries

// @theater-source theater-request-state.js formatRequestContextSummary
const cloneDefaultSettings = () => {
    if (typeof structuredClone === 'function') return structuredClone(defaultSettings);
    return JSON.parse(JSON.stringify(defaultSettings));
};
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
// @theater-source theater-defaults.js SOUND_PRESETS

// @theater-source theater-defaults.js LAMP_SVG_HTML

// ============================================================
// Default system prompt — 月见轻量 by 染染, adapted for theater
// ============================================================
// @theater-source theater-defaults.js DEFAULT_SYSTEM_PROMPT

// @theater-source theater-defaults.js DEFAULT_RENDER_TEMPLATE

// @theater-source theater-defaults.js DEFAULT_RENDER_TEMPLATE_PC

// @theater-source theater-defaults.js DEFAULT_RENDER_TEMPLATE_TEXT

const HTML_RENDER_FINAL_GUARDRAILS = `【HTML格式】用户要求Markdown或Markdown代码块时，仅把标题、编号、列表、强调层级转为语义化HTML，直接输出完整HTML；其HTML/CSS/JavaScript、视觉、交互、内容要求照常实现。
【配色】各场景/状态同步设置背景、正文、小字、边框、控件；浅底深字、深底浅字，逐状态检查，禁止文字与背景明度相近。`;

const BUILTIN_RENDER_SELECTIONS = new Set([
    '__default__',
    '__default_pc__',
    PLAIN_TEXT_LIGHT_SELECTION,
    PLAIN_TEXT_DARK_SELECTION,
    ...Object.values(ADAPTIVE_RENDER_SELECTIONS),
]);

// @theater-source theater-render-selection.js isBuiltinRenderSelection

// @theater-source theater-render-selection.js renderTemplateContentForSelection

// @theater-source theater-render-selection.js normalizeRenderSelection

// @theater-source theater-render-selection.js renderSelectionMeta

// @theater-source theater-render-selection.js renderTemplateOptions

// @theater-source theater-render-selection.js renderSelectionHint

// @theater-source theater-render-selection.js quickRenderState

// @theater-source theater-render-selection.js quickRenderButtonContent

// ============================================================
let settings = {};
const defaultSettings = Object.freeze({
    contextRange: 10,
    readChatContext: true,
    contextExclusionRules: [],
    instructionTemplates: [],
    instructionGroups: [],            // 用户创建的分组名列表
    instructionGroupFilter: '__all__', // 当前筛选：'__all__' | '__none__'(未分组) | 组名
    instructionTags: [],              // 模板与历史共用的标签名称
    instructionTagFilter: [],         // 空数组=全部；多个标签按“同时包含”筛选
    randomTagFilter: [],
    autoTagFilter: [],
    historyTagFilter: [],
    tagSchemaVersion: 0,
    historyTagSchemaVersion: 0,
    renderTemplates: [],
    selectedRenderIndex: '__default__',
    quickRenderA: '__default__',
    quickRenderB: ADAPTIVE_RENDER_SELECTIONS.immersive,
    selectedPresetName: '',  // name of selected ST preset (empty = none)
    presetEntryStatesByPreset: {},  // { [presetKey]: { identifier: true/false } }
    customStyleAddon: '',
    customNsfwAddon: '',
    lastInstruction: '',
    lastInstructionTags: [],
    manualTargetEnabled: false,
    manualTargetChars: 3000,
    manualTargetPanelOpen: false,
    history: [],
    longDreams: [],
    customCSS: '',
    skinMode: 'default',  // 'default' (内置粉彩) | 'theater' (跟随酒馆) | 'custom' (用户CSS接管)
    uiFontSize: 13.5,
    apiMode: 'custom',  // 'custom' 独立 API | 'main' 酒馆主 API（实验）
    apiUrl: '', apiKey: '', apiModel: '', apiProtocol: 'auto', streamEnabled: true,
    apiPresets: [], selectedApiPresetId: '',
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    maxOutputTokensSchema: 2,
    autoContinue: true,
    autoContinueSchema: AUTO_CONTINUE_SCHEMA,
    maxAutoRounds: 3,
    userPersona: '',
    worldBookEntries: [], worldBookStates: [],  // 旧版字段，v2.8.0 起仅用于迁移
    worldBookStatesByBook: {},  // { [bookName]: { [entryKey]: false } }，缺省 true
    worldBookKnownEntriesByBook: {},  // { [bookName]: [entryKey, ...] }，记录"曾见过"的 key，用来识别新条目
    currentWorldBook: '',       // 旧版字段，v2.8.0 起仅用于迁移
    selectedWorldBooks: [],     // 勾选的世界书名列表（v2.8.0 起支持多本）
    followedWorldBooks: [],     // 当前角色卡自动带入的书；切卡时只替换这一组
    worldBookReadMode: 'all',   // 'all' 全部 | 'enabled' 酒馆开启 | 'lights' 仅蓝灯与绿灯
    manualWBEntries: [],        // 手动添加的条目 [{ name, content, on }]
    followCharCard: false,      // 切角色时替换角色卡自动带入的世界书，保留手动勾选
    followUserPersona: false,   // 生成时自动读取当前 user 人设
    floatingBall: false,
    floatingBallTuck: true,
    floatingBallPosition: null,
    resultBookmarkEnabled: true,
    resultBookmarkSide: 'right',
    resultBookmarkYRatio: 0.55,
    soundEnabled: true,
    soundPreset: 'chime',
    soundVolume: 70,
    randomEnabled: false,
    randomScope: '__current__',  // '__current__' | '__all__' | '__uncategorized__' | '__tags__'
    autoMode: false,             // 自动生成开关
    autoInterval: 10,            // 每攒够 N 层 AI 楼自动生成一次
    autoSource: '__last__',      // '__last__' | '__all__' | '__uncategorized__' | '__tags__'
    autoAnchors: {},             // { [chatId]: 上次触发时的 AI 楼数 }
    recentGenerations: [],  // 最近 3 条自动保留的生成结果 [{ html, mode, time, instruction }]
    recentIndex: 0,         // 当前查看的 recentGenerations 索引
    lastTheaterTab: 'generate',
    autoRecognizeInstructionTitle: false,
    longDreamLastView: 'list',
    longDreamLastId: '',
    longDreamComposerDrafts: {},
    longDreamMemoryEnabled: true,
    longDreamMemoryApiPresetId: '',
    longDreamMemoryBatchSize: 3,
    longDreamMemoryPrompt: DEFAULT_LONG_DREAM_MEMORY_PRESET,
    longDreamMemoryPresetId: LONG_DREAM_MEMORY_BUILTIN_PRESET_ID,
    longDreamMemoryPresets: [],
});

// @theater-source theater-defaults.js SKIN_LABELS

// ============================================================
// 本地仓库（IndexedDB）
// settings.json 是整体重写式保存，把大量 HTML 存进去会让保存请求越来越大，
// 大到失败时整晚的改动都写不进盘（删掉的回来、新存的消失）。
// 所以历史和最近生成从 v2.7.1 起放进 IndexedDB，按条独立读写。
// ============================================================
let idb = null;            // 打不开时为 null，回退到 settings 存储
let historyCollections = [];
let historyQuery = '';
const historyExpanded = new Set();
const historyVersionSelection = new Map();
let historyReadingItems = null;
let historyReadingFolderId = null;
let historyWriteQueue = Promise.resolve();
let historyCache = [];     // [{ id, title, html, mode, instruction, date }]
let currentGenerationResult = null;
let resultStorageQueue = Promise.resolve();
const readingState = { reading: null };
let resultReader = null;
let resultWorkspacePage = 'generate';
const resultPageScroll = { generate: 0, read: 0 };
let recentCache = [];      // 最近 3 条生成 [{ html, mode, time, instruction }]
let longDreamCache = [];   // 独立长卷；正文较大，和历史一样放在 IndexedDB
let recentIndex = 0;       // 当前查看的最近生成索引（仅内存）
let longDreamView = 'list';
let activeLongDreamId = null;
let longDreamWorkspaceSection = 'works';
let longDreamWorkLevel = 'list';
let activeLongDreamChapterId = null;
let longDreamChapterEditController = null;
let longDreamMemoryQueue = Promise.resolve();
const queuedLongDreamMemoryIds = new Set();
const longDreamCanonSuggestionState = {
    sourceKey: '',
    items: [],
    status: 'idle',
    errorSignal: '',
    controller: null,
    requestId: 0,
};

const THEATER_TAB_NAMES = new Set(['generate', 'long-dream', 'setting', 'dialogue', 'rules', 'history', 'theme', 'diagnostics', 'config']);

// @theater-source long-dream-navigation.js normalizeTheaterTab

// @theater-source long-dream-navigation.js longDreamComposerDrafts

// @theater-source long-dream-navigation.js getLongDreamComposerDraft

// @theater-source long-dream-navigation.js rememberLongDreamComposerDraft

// @theater-source long-dream-navigation.js setLongDreamComposerDraft

// @theater-source long-dream-navigation.js clearLongDreamComposerDraft

// @theater-source long-dream-navigation.js rememberLongDreamNavigation

// @theater-source long-dream-navigation.js restoreLongDreamNavigation

// @theater-source theater-storage.js idbReq

// @theater-source theater-storage.js idbTransactionDone

// @theater-source theater-storage.js storageInit

// @theater-source theater-storage.js histAdd
// @theater-source theater-storage.js histAddStorage

// @theater-source theater-storage.js histDelete
// @theater-source theater-storage.js histDeleteStorage

// @theater-source theater-storage.js recentPersist

// @theater-source theater-storage.js queueResultStorage

// @theater-source theater-storage.js archiveCurrentResult

// @theater-source theater-storage.js storeCurrentResult

// @theater-source theater-storage.js updateResultItem

// @theater-source theater-storage.js longDreamAdd

// @theater-source theater-storage.js longDreamPut

// @theater-source theater-storage.js longDreamDelete

// ============================================================
// Init
// ============================================================
async function init() {
    const ctx = SillyTavern.getContext();
    const { extensionSettings, renderExtensionTemplateAsync, eventSource, event_types } = ctx;

    const existingSettings = extensionSettings[MODULE_NAME];
    const upgradeNeedsProtocolCompatibility = !!existingSettings && !hasOwn(existingSettings, 'apiProtocol');
    const upgradeNeedsMaxOutputDefault = !!existingSettings && !hasOwn(existingSettings, 'maxOutputTokensSchema');
    const upgradeNeedsFollowedWorldBookTracking = !!existingSettings && !hasOwn(existingSettings, 'followedWorldBooks');
    const upgradeNeedsMemoryPresetLibrary = !!existingSettings && !hasOwn(existingSettings, 'longDreamMemoryPresets');
    const upgradeNeedsQuickRenderPair = !!existingSettings && !hasOwn(existingSettings, 'quickRenderA');
    const autoContinueDefaultMigrated = !!existingSettings && migrateAutoContinueDefault(existingSettings);
    if (!existingSettings) extensionSettings[MODULE_NAME] = cloneDefaultSettings();
    for (const k of Object.keys(defaultSettings)) {
        if (!hasOwn(extensionSettings[MODULE_NAME], k)) extensionSettings[MODULE_NAME][k] = defaultSettings[k];
    }
    settings = extensionSettings[MODULE_NAME];
    const tagSettingsMigrated = migrateLegacyTagSettings(settings);
    settings.contextExclusionRules = normalizeContextExclusionRules(settings.contextExclusionRules);
    settings.historyTagFilter = normalizeTagFilter(settings.historyTagFilter, settings.instructionTags);
    settings.lastInstructionTags = itemTags({ tags: settings.lastInstructionTags }, settings.instructionTags);
    activeInstructionTags = [...settings.lastInstructionTags];
    activeInstructionContent = activeInstructionTags.length ? String(settings.lastInstruction || '') : '';
    if (tagSettingsMigrated) {
        runtimeLog('info', '指令模板分组已升级为多标签', { tags: settings.instructionTags.length });
        save();
    }
    settings.contextRange = normalizeContextRange(settings.contextRange);
    setRuntimeLogSecretProvider(() => [settings?.apiKey, ...apiPresetSecretValues(settings?.apiPresets)]);
    if (upgradeNeedsProtocolCompatibility) settings.apiProtocol = 'auto';
    settings.apiPresets = normalizeApiPresetList(settings.apiPresets);
    const previousMemoryPrompt = String(settings.longDreamMemoryPrompt || '').trim();
    settings.longDreamMemoryPresets = normalizeLongDreamMemoryPresetList(settings.longDreamMemoryPresets);
    if (upgradeNeedsMemoryPresetLibrary && previousMemoryPrompt && previousMemoryPrompt !== LEGACY_DEFAULT_LONG_DREAM_MEMORY_PRESET && previousMemoryPrompt !== DEFAULT_LONG_DREAM_MEMORY_PRESET) {
        const migratedPreset = createLongDreamMemoryPreset({ name: '原有自定义梦脉侧重点', focusPrompt: previousMemoryPrompt });
        settings.longDreamMemoryPresets = normalizeLongDreamMemoryPresetList([...settings.longDreamMemoryPresets, migratedPreset]);
        settings.longDreamMemoryPresetId = migratedPreset.id;
    }
    if (!settings.longDreamMemoryPresets.some(preset => preset.id === settings.longDreamMemoryPresetId)) {
        settings.longDreamMemoryPresetId = LONG_DREAM_MEMORY_BUILTIN_PRESET_ID;
    }
    const activeMemoryPromptPreset = settings.longDreamMemoryPresets.find(preset => preset.id === settings.longDreamMemoryPresetId);
    settings.longDreamMemoryPrompt = activeMemoryPromptPreset?.focusPrompt || DEFAULT_LONG_DREAM_MEMORY_PRESET;
    if (!settings.apiPresets.some(preset => preset.id === settings.selectedApiPresetId)) settings.selectedApiPresetId = '';
    if (upgradeNeedsMaxOutputDefault) {
        if (Number(settings.maxOutputTokens) === 8192) {
            settings.maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
            runtimeLog('info', '单轮输出上限默认值升级', { from: 8192, to: DEFAULT_MAX_OUTPUT_TOKENS });
        }
        settings.maxOutputTokensSchema = 2;
        save();
    }
    if (autoContinueDefaultMigrated) {
        runtimeLog('info', '明确字数目标的自动补写已默认开启');
        save();
    }
    // Migrate: clean up legacy fields
    if (settings.selectedPresetName === '__builtin__' || settings.selectedPresetName === '__custom__' || settings.selectedPresetName === '__follow__') {
        settings.selectedPresetName = '';
    }
    const hadLegacyPresetEntryStates = hasOwn(settings, 'presetEntryStates');
    settings.presetEntryStatesByPreset = migrateLegacyPresetEntryStates({
        selectedPresetName: settings.selectedPresetName,
        legacyStates: settings.presetEntryStates,
        statesByPreset: settings.presetEntryStatesByPreset,
    });
    if (hadLegacyPresetEntryStates) {
        delete settings.presetEntryStates;
        runtimeLog('info', '预设条目勾选记录已升级为按预设分别保存');
        save();
    }
    settings.uiFontSize = normalizeUIFontSize(settings.uiFontSize);
    settings.manualTargetChars = normalizeManualTarget(settings.manualTargetChars);
    settings.resultBookmarkSide = normalizeBookmarkSide(settings.resultBookmarkSide);
    settings.resultBookmarkYRatio = normalizeBookmarkYRatio(settings.resultBookmarkYRatio);
    if (!Array.isArray(settings.renderTemplates)) settings.renderTemplates = [];
    settings.selectedRenderIndex = normalizeRenderSelection(settings.selectedRenderIndex, settings.renderTemplates);
    if (upgradeNeedsQuickRenderPair) settings.quickRenderA = settings.selectedRenderIndex;
    settings.quickRenderA = normalizeRenderSelection(settings.quickRenderA, settings.renderTemplates);
    settings.quickRenderB = normalizeRenderSelection(settings.quickRenderB, settings.renderTemplates);
    if (settings.quickRenderA === settings.quickRenderB) {
        settings.quickRenderB = settings.quickRenderA === ADAPTIVE_RENDER_SELECTIONS.immersive
            ? '__default__'
            : ADAPTIVE_RENDER_SELECTIONS.immersive;
    }
    if (upgradeNeedsQuickRenderPair) {
        runtimeLog('info', '生成页双模板切换已初始化', {
            template_a: renderSelectionMeta(settings.quickRenderA, settings.renderTemplates).name,
            template_b: renderSelectionMeta(settings.quickRenderB, settings.renderTemplates).name,
        });
        save();
    }
    if (!['all', 'enabled', 'lights'].includes(settings.worldBookReadMode)) settings.worldBookReadMode = 'all';
    delete settings.customSystemPrompt;
    delete settings.presetMode;
    delete settings.savedPresets;
    delete settings.systemPrompt;

    // v2.8.0 迁移：单选世界书 → 多选；手动条目从混合数组里拆出来；
    // 世界书条目内容不再持久化（弹窗打开时现从酒馆读），settings 跟着瘦身
    if (!Array.isArray(settings.selectedWorldBooks)) settings.selectedWorldBooks = [];
    if (!Array.isArray(settings.followedWorldBooks)) settings.followedWorldBooks = [];
    if (upgradeNeedsFollowedWorldBookTracking) {
        // 旧版无法区分“手选”与“跟随自动加入”。跟随开启时先把旧勾选标记为旧自动组，
        // 下一次同步会整体撤掉它们并只带入当前角色卡，优先阻止跨角色串设定。
        settings.followedWorldBooks = settings.followCharCard ? [...settings.selectedWorldBooks] : [];
        runtimeLog('info', '世界书跟随状态已升级，将在下次同步时清理旧角色残留');
    }
    if (!Array.isArray(settings.manualWBEntries)) settings.manualWBEntries = [];
    if (settings.currentWorldBook) {
        if (!settings.selectedWorldBooks.includes(settings.currentWorldBook)) settings.selectedWorldBooks.push(settings.currentWorldBook);
        settings.currentWorldBook = '';
    }
    if (Array.isArray(settings.worldBookEntries) && settings.worldBookEntries.length) {
        settings.worldBookEntries.forEach((e, i) => {
            if (e.uid === undefined || e.uid === null) {
                settings.manualWBEntries.push({ name: e.name, content: e.content, on: (settings.worldBookStates || [])[i] !== false });
            }
        });
        settings.worldBookEntries = [];
        settings.worldBookStates = [];
    }

    await storageInit();
    await migrateHistoryTags();
    applyUIFontSize();

    const html = await renderExtensionTemplateAsync('third-party/st-theater', 'settings');
    $('#extensions_settings2').append(html);
    $('#theater-settings-version').text(`v${VERSION}`);
    $('#theater-open-btn').on('click', openTheaterPopup);

    const addWand = () => {
        if ($('#theater-wand-btn').length) return;
        const $btn = $(`<div id="theater-wand-btn" class="list-group-item flex-container flexGap5"><div class="extensionsMenuExtensionButton">${LAMP_SVG_HTML}</div>千夜浮梦</div>`);
        // 始终放在魔法棒菜单顶部，避免受其他扩展完成初始化的先后顺序影响。
        $('#extensionsMenu').prepend($btn);
        $btn.on('click', e => { e.stopPropagation(); $(document).trigger('click'); setTimeout(openTheaterPopup, 150); });
        refreshUpdateBadges();
    };
    addWand();
    if (event_types?.APP_READY) eventSource.on(event_types.APP_READY, addWand);

    // 跟随角色卡：切聊天/角色时自动换成这张卡绑定的世界书
    if (event_types?.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, async () => {
            scheduleTokenEstimate();
            if (!settings.followCharCard) return;
            try { await applyCharBoundBooks(); } catch (e) { console.warn('[Theater] 跟随角色卡失败:', e); }
        });
    }

    bindPersonaFollowRefresh({ eventSource, event_types, settings, save, theaterError });

    // 自动模式：AI 每回完一条就看看攒没攒够
    if (event_types?.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, () => {
            autoTick().catch(e => console.warn('[Theater] auto tick error:', e));
        });
    }

    applyCustomCSS();
    // 悬浮球延迟创建，避免干扰其他插件初始化
    setTimeout(() => { try { createFloatingBall(); } catch (e) { console.warn('[Theater] Floating ball error:', e); } }, 2000);
    // 初始化完成就后台检查；不 await，不让慢网络拖住酒馆。
    void checkRemoteVersion();
    console.log(`[Theater] v${VERSION} loaded`);
    console.log(`[Theater] 🐾 禾禾的千夜浮梦，麓克永远在山脚下等你。`);
    runtimeLog('info', '插件加载完成', { version: VERSION });
}

// @theater-source theater-update.js checkRemoteVersion

// @theater-source theater-update.js hasRemoteUpdate

// @theater-source theater-update.js remoteUpdateLabel

// @theater-source theater-update.js updateBadgeHTML

// @theater-source theater-update.js refreshUpdateBadges

// 把用户 CSS 限定在 .theater-popup 容器内，避免污染酒馆主界面。
// 用浏览器原生 CSSOM 解析，遍历每条规则改写选择器；解析失败则不注入。
const THEATER_SCOPE = '.theater-popup';

// @theater-source theater-appearance.js scopeSelector

// @theater-source theater-appearance.js scopeRules

// @theater-source theater-appearance.js scopeCSS

// @theater-source theater-appearance.js applyCustomCSS

// @theater-source theater-appearance.js normalizeUIFontSize

// @theater-source theater-appearance.js fontSizeVars

// @theater-source theater-appearance.js applyUIFontSize

// @theater-source theater-appearance.js getSoundPreset

// @theater-source theater-appearance.js playNotificationSound

// @theater-source theater-appearance.js runtimeLog

// @theater-source theater-appearance.js theaterError

// @theater-source theater-appearance.js renderRuntimeLog

const FLOATING_BALL_OPEN_GUARD_MS = 700;
const FLOATING_BALL_OPEN_GUARD_RADIUS = 36;
let floatingBallCleanup = null;

// @theater-source theater-appearance.js openTheaterPopupFromFloatingBall

// @theater-source theater-appearance.js createFloatingBall

// ============================================================
// Popup HTML
// ============================================================
// 小剧场的原生 select 使用 data-select2-id 作为“下拉选项框美化”脚本现有的排除标记；
// 每个值保持唯一，以免后续 Select2 初始化时共享缓存。小剧场的搜索和 change 事件保持原样。
const theaterNativeSelectCompatPrefix = `theater-native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let theaterNativeSelectCompatCounter = 0;
// @theater-source theater-popup-ui.js theaterNativeSelectCompatId
// 全局下拉美化脚本在 document 捕获阶段接管 mousedown/touchend。
// 在更早的 window 捕获阶段只隔离小剧场的原生选择框，不取消浏览器默认选择行为。
// @theater-source theater-popup-ui.js guardTheaterNativeSelectEvent
// @theater-source theater-popup-ui.js buildPopupHTML

// ============================================================
// Rendering helpers
// ============================================================
// @theater-source long-dream-workspace.js historyItemHTML

// @theater-source long-dream-workspace.js historyTagBadgesHTML

// @theater-source long-dream-workspace.js longDreamSources

// @theater-source long-dream-workspace.js resolveLongDreamSource

// @theater-source long-dream-workspace.js longDreamDate

// @theater-source long-dream-workspace.js longDreamExcerpt

// @theater-source long-dream-workspace.js longDreamSourceInstructionState

// @theater-source long-dream-workspace.js longDreamSourcePreviewHTML

// @theater-source long-dream-workspace.js resetLongDreamCanonSuggestions

// @theater-source long-dream-workspace.js activeLongDreamCanonSuggestions

// @theater-source long-dream-workspace.js longDreamCanonSuggestionCardsHTML

// @theater-source long-dream-workspace.js longDreamCanonSuggestionHTML

// @theater-source long-dream-workspace.js renderLongDreamCanonSuggestions

// @theater-source long-dream-workspace.js findLongDreamCanonSuggestion

// @theater-source long-dream-workspace.js captureCurrentLongDreamWorldBooks

// @theater-source long-dream-workspace.js longDreamSnapshotEntryCount

// @theater-source long-dream-workspace.js longDreamBackupFileName

// @theater-source long-dream-workspace.js exportLongDreamZip

// @theater-source long-dream-workspace.js chooseExportFormat

// @theater-source long-dream-workspace.js exportLongDreamBackup

// @theater-source long-dream-workspace.js requestLongDreamExport

// @theater-source long-dream-workspace.js readLongDreamZip

// @theater-source long-dream-workspace.js importedLongDreamTitle

// @theater-source long-dream-workspace.js importLongDreamBackup

// @theater-source long-dream-workspace.js readLongDreamChapter

// @theater-source long-dream-workspace.js longDreamChapterFileName

// @theater-source long-dream-workspace.js exportLongDreamChapter

// @theater-source long-dream-workspace.js saveLongDreamChapterEdits

// @theater-source long-dream-workspace.js setCurrentLongDreamStatus

// @theater-source long-dream-workspace.js longDreamListHTML

const LONG_DREAM_RELATION_OPTIONS = [
    { value: LONG_DREAM_WORLD_LINE_RELATION.ISOLATED, label: '完全隔离', description: '不读取原世界书或原作场景；仍以当前 Char 与 User 人设保持人物性格。' },
    { value: LONG_DREAM_WORLD_LINE_RELATION.PARALLEL, label: '平行支线 / AU', description: '沿用世界背景与人物素材；原剧情、关系和现状只作参考。' },
    { value: LONG_DREAM_WORLD_LINE_RELATION.PREQUEL, label: '前传补完', description: '当前发生在原线以前；原设定是可能的未来，本梦变化优先。' },
    { value: LONG_DREAM_WORLD_LINE_RELATION.CANON_CONCURRENT, label: '原线同期补完', description: '在原时间线中补写支线，原重大事件与关系默认成立。' },
    { value: LONG_DREAM_WORLD_LINE_RELATION.SEQUEL, label: '正史后续', description: '原世界书视为已经发生的历史，从它之后继续。' },
];

// @theater-source long-dream-workspace.js longDreamRelationLabel

// @theater-source long-dream-workspace.js longDreamRelationChoicesHTML

// @theater-source long-dream-workspace.js longDreamSourceWorldBooks

// @theater-source long-dream-workspace.js sameWorldBookSelection

// @theater-source long-dream-workspace.js longDreamCreateWorldBookStateHTML

// @theater-source long-dream-workspace.js refreshLongDreamCreateWorldBookState

// @theater-source long-dream-workspace.js longDreamCreateHTML

// @theater-source long-dream-workspace.js longDreamGenerationStageText

// @theater-source long-dream-workspace.js formatLongDreamElapsed

// @theater-source long-dream-workspace.js longDreamProgressStageText

// @theater-source long-dream-workspace.js longDreamProgressLabelText

// @theater-source long-dream-workspace.js longDreamProgressKickerText

// @theater-source long-dream-workspace.js longDreamProgressMetaHTML

// @theater-source long-dream-workspace.js selectedLongDreamMemoryApiPreset

// @theater-source long-dream-workspace.js longDreamMemoryAnalysisPresets

// @theater-source long-dream-workspace.js selectedLongDreamMemoryAnalysisPreset

// @theater-source long-dream-workspace.js refreshLongDreamMemoryPresetControls

// @theater-source long-dream-workspace.js longDreamMemoryStatusText

// @theater-source long-dream-workspace.js longDreamActiveMemoryCount

// @theater-source long-dream-workspace.js longDreamSummaryHistoryHTML

// @theater-source long-dream-workspace.js toggleLongDreamSummaryPreview

// @theater-source long-dream-workspace.js longDreamMemoryConflictTarget

// @theater-source long-dream-workspace.js longDreamMemoryConflictSubjects

// @theater-source long-dream-workspace.js longDreamMemoryConflictItemText

// @theater-source long-dream-workspace.js longDreamMemoryConflictOperationText

// @theater-source long-dream-workspace.js longDreamMemoryConflictDetails

// @theater-source long-dream-workspace.js longDreamMemoryCardsHTML

// @theater-source long-dream-workspace.js longDreamMemorySelectionHTML

// @theater-source long-dream-workspace.js refreshLongDreamMemorySelection

// @theater-source long-dream-workspace.js longDreamMemoryTags

// @theater-source long-dream-workspace.js longDreamMemoryV2Fields

// @theater-source long-dream-workspace.js uniqueLongDreamBranchTitle

// @theater-source long-dream-workspace.js handleLongDreamChapterAction

// @theater-source long-dream-workspace.js longDreamWorkspaceHTML

// @theater-source long-dream-workspace.js longDreamDetailState

// @theater-source long-dream-workspace.js longDreamDetailHeaderHTML

let refreshingLongDreamWorldBooks = false;
let refreshingLongDreamWorldBookId = null;
// @theater-source long-dream-workspace.js refreshLongDreamWorldBookSources

// @theater-source long-dream-workspace.js longDreamDefinitionHTML

// @theater-source long-dream-workspace.js longDreamDetailHTML

// @theater-source long-dream-workspace.js longDreamKeptVersionsHTML

// @theater-source long-dream-workspace.js longDreamChapterDirectoryHTML

// @theater-source long-dream-workspace.js longDreamWorkDetailHTML

// @theater-source long-dream-workspace.js longDreamChapterDetailHTML

// @theater-source long-dream-workspace.js longDreamUnavailableHTML

// @theater-source long-dream-workspace.js longDreamPanelHTML

// @theater-source long-dream-workspace.js syncLongDreamPanel

// @theater-source long-dream-workspace.js renderLongDreamPanel

// @theater-source long-dream-workspace.js renderLongDreamProgressCandidate

// @theater-source long-dream-workspace.js stopLongDreamProgressTicker

// @theater-source long-dream-workspace.js syncLongDreamProgressDisplay

// @theater-source long-dream-workspace.js renderLongDreamReviewDraft


// @theater-source theater-materials.js knownInstructionTags

// @theater-source theater-materials.js tagFilterSummary

// @theater-source theater-materials.js historyTagFilterLabel

// @theater-source theater-materials.js contextExclusionSettingsHTML

// @theater-source theater-materials.js contextExclusionRulesHTML

// @theater-source theater-materials.js refreshContextExclusionRules

// @theater-source theater-materials.js addContextExclusionRule

// @theater-source theater-materials.js previewContextExclusions

// @theater-source theater-instructions.js itemTagBadgesHTML

// @theater-source theater-instructions.js tagUsageCounts

// @theater-source theater-instructions.js rollRandomInstruction

// 临时状态：当前选中索引 + 搜索关键词，仅本次会话有效
let instSelected = new Set();
let histSelected = new Set();
let histBatchMode = false;
let histSelectionGesture = null;
let histTouchMoveHandler = null;
let suppressHistoryCardClickUntil = 0;
let instSearch = '';
let instPage = 0;
let histPage = 0;
const INST_PAGE_SIZE = 10;
let activeInstructionTags = [];
let activeInstructionContent = '';
let continuationSourceTags = [];
let instructionSweepCleanup = null;
let activeTheaterPopupSession = null;

const INSTRUCTION_SWEEP_HOLD_MS = 420;
const INSTRUCTION_SWEEP_MOVE_TOLERANCE = 10;
const INSTRUCTION_SWEEP_SCROLL_EDGE = 56;
const INSTRUCTION_SWEEP_SCROLL_MAX_SPEED = 14;

// @theater-source theater-instructions.js setActiveInstructionTags

// @theater-source theater-instructions.js filterInstAll

// @theater-source theater-instructions.js renderInstList

// @theater-source theater-instructions.js updateBulkBar

// @theater-source theater-instructions.js setInstructionItemSelected

// @theater-source theater-instructions.js closeInstructionActionMenus

// @theater-source theater-instructions.js positionInstructionActionMenu

// @theater-source theater-instructions.js bindInstructionSweepSelection

// ---- World Book 运行时状态 ----
// 条目内容不再持久化到 settings（避免撑大 settings.json），弹窗打开时现从酒馆读。
// 持久化的只有：选了哪些书（selectedWorldBooks）、每本书条目的开关（worldBookStatesByBook）、手动条目（manualWBEntries）。
let wbEntries = [];    // [{ book, uid, name, content } | { manual: true, mIdx, name, content }]
let wbStates = [];     // 与 wbEntries 平行的开关数组
let wbBookNames = [];  // 可选世界书名列表
let wbSearch = '';
let wbLoadedCacheKey = '';
let wbLoadedReadMode = '';
let wbReloadSequence = 0;
let wbReloadInFlight = null;

// @theater-source theater-materials.js worldBookCacheKey

// @theater-source theater-materials.js isWorldBookCacheCurrent

// 每本书一个节点：勾选框选书，点行展开条目，条目直接挂在书底下（树形）
let wbGroupCollapsed = {};  // { 书名或 __manual__: false 表示展开 }，缺省收起

// @theater-source theater-materials.js wbEntryHTML

// @theater-source theater-materials.js wbBookBodyHTML

// @theater-source theater-materials.js renderWBTree

// @theater-source theater-materials.js updateWBGroupCounts

// @theater-source theater-materials.js hasManualEntries

// @theater-source theater-materials.js updateWBCount

// @theater-source theater-materials.js refreshWBUI

// 改某个条目的开关，并把状态写回对应的持久化位置
// @theater-source theater-materials.js setWBStateByIndex

// 把 settings.manualWBEntries 重新同步到 wbEntries 尾部
// @theater-source theater-materials.js syncManualIntoWB

// ============================================================
// Open popup
// ============================================================
// @theater-source theater-popup-controller.js activateTheaterTab

// @theater-source theater-popup-controller.js openTheaterPopup

// ============================================================
// Events
// ============================================================
// @theater-source theater-api-settings.js readApiFormConfig

// @theater-source theater-api-settings.js writeApiFormConfig

// @theater-source theater-api-settings.js apiPresetDefaultName

// @theater-source theater-api-settings.js apiPresetDisplayLabel

// @theater-source theater-api-settings.js validateApiPresetConfig

// @theater-source theater-api-settings.js persistCurrentApiConfig

// @theater-source theater-api-settings.js refreshApiPresetControls

// @theater-source theater-api-settings.js refreshConfigSummaries

// @theater-source theater-api-settings.js findApiPreset

// @theater-source theater-result-workspace.js closeResultActions

// @theater-source theater-result-workspace.js resultBookmarkRect

// @theater-source theater-result-workspace.js positionResultToolbox

// @theater-source theater-result-workspace.js applyResultToolboxMode

// @theater-source theater-storage.js histPut
// @theater-source theater-storage.js histPutStorage

// @theater-source theater-history.js inferHistoryTags

// @theater-source theater-history.js migrateHistoryTags

// @theater-source theater-render-selection.js refreshRenderSelectionControls

// @theater-source theater-render-selection.js switchQuickRenderSelection

// @theater-source theater-render-selection.js updateQuickRenderSetting

// @theater-source theater-render-selection.js renderSelectionAfterCustomDelete

// @theater-source theater-popup-ui.js decorateConfigLayout

// @theater-source theater-events.js bindEvents

// @theater-source theater-history.js refreshInstUI

// @theater-source theater-history.js filterHistoryAll

// @theater-source theater-history.js setHistoryItemSelected

// @theater-source theater-history.js detachHistoryTouchMoveHandler

// @theater-source theater-history.js attachHistoryTouchMoveHandler

// @theater-source theater-history.js resetHistorySelectionGesture

// @theater-source theater-history.js activateHistorySelectionGesture

// @theater-source theater-history.js applyHistorySelectionGestureAt

// @theater-source theater-history.js runHistorySelectionAutoScroll

// @theater-source theater-history.js updateHistorySelectionAutoScroll

// @theater-source theater-history.js refreshHistList

// @theater-source theater-history.js currentHistoryPage
// @theater-source theater-history.js visibleHistoryItems
// @theater-source theater-history.js renderHistoryList

// @theater-source theater-history.js refreshTagControls

// @theater-source theater-history.js renameHistoryItem

// @theater-source theater-history.js editHistoryTags

// @theater-source theater-history.js bulkEditSelectedHistoryTags

// @theater-source theater-history.js updateHistBulkBar

// @theater-source theater-history.js enterHistBatchMode

// @theater-source theater-history.js exitHistBatchMode

// ============================================================
// Persona
// ============================================================
// @theater-source theater-materials.js loadPersona

// ============================================================
// Preset Entries
// ============================================================
let cachedPresetEntries = [];
let cachedPresetPostProcessing = '';
let cachedPresetSquashSystemMessages = false;
let cachedPresetName = '';
let cachedPresetLoadState = 'default';
let presetLoadSequence = 0;
let presetLoadInFlight = null;
let presetNamesCache = [];
let presetSearch = '';

// @theater-source theater-materials.js currentPresetEntryStates

// @theater-source theater-materials.js renderPresetOptions

// @theater-source theater-materials.js loadPresetNameList

// @theater-source theater-materials.js parsePromptToEntries

// @theater-source theater-materials.js fetchPresetByName

// @theater-source theater-materials.js extractPromptsFromData

// @theater-source theater-materials.js setPresetEntryControlsEnabled

// @theater-source theater-materials.js currentPresetSnapshot

// @theater-source theater-materials.js loadPresetEntries

// @theater-source theater-materials.js ensureSelectedPresetLoaded

// @theater-source theater-materials.js renderPresetEntries

// @theater-source theater-materials.js getSelectedPresetPrompt

// @theater-source theater-materials.js getSelectedPresetEntries

// ============================================================
// World Book
// ============================================================
// @theater-source theater-materials.js loadWorldBookList

// @theater-source theater-materials.js entryKey

// 重新加载所有勾选的世界书条目（多本合并，手动条目排最后）
// @theater-source theater-materials.js reloadWorldBooks

// @theater-source theater-materials.js ensureWorldBooksCurrent

// ---- 跟随角色卡 ----
// @theater-source theater-materials.js getCharBoundBooks

// 跟随角色卡只替换上一次自动带入的书，不覆盖用户另外手选的书。
// @theater-source theater-materials.js applyCharBoundBooks

// ============================================================
// Templates
// ============================================================
// @theater-source theater-instructions.js chooseTags

// @theater-source theater-instructions.js askNewItemName

// @theater-source theater-instructions.js chooseTagsWithNew

// @theater-source theater-instructions.js newInstructionTag

// @theater-source theater-instructions.js updateAllHistoryTags

// @theater-source theater-instructions.js manageInstructionTags

// @theater-source theater-instructions.js editTemplateTags

// @theater-source theater-instructions.js chooseBulkTagOperation

// @theater-source theater-instructions.js applyBulkTagOperation

// @theater-source theater-instructions.js saveInstructionTpl


// @theater-source theater-instructions.js bulkEditSelectedTemplateTags

// @theater-source theater-instructions.js bulkDeleteSelected

// @theater-source theater-instructions.js selectAllVisible

// @theater-source theater-instructions.js clearInstSelection

// @theater-source theater-instructions.js saveRenderTpl

// @theater-source theater-instructions.js deleteRenderTpl

// ============================================================
// Instruction Template Import / Export
// ============================================================
// @theater-source theater-instructions.js splitImportedTemplate

// @theater-source theater-instructions.js importInstructionTemplates

// @theater-source theater-instructions.js exportInstructionTemplates

// ============================================================
// History
// ============================================================
// @theater-source theater-storage.js queueHistoryWrite

// @theater-source theater-history.js commitHistoryCollection

// @theater-source theater-history.js organizeHistory

// @theater-source theater-history.js openHistoryReading
// @theater-source theater-history.js historyReadingVersions
// @theater-source theater-history.js chooseHistoryReadingVersion

// @theater-source theater-history.js saveToHistory

// @theater-source theater-history.js copyHtml

// @theater-source theater-history.js readClipboardMatch

// @theater-source theater-history.js copyToClipboard

// @theater-source theater-history.js fallbackCopy

// @theater-source theater-history.js showManualCopyPanel

// @theater-source theater-history.js downloadTextContent

// @theater-source theater-history.js exportAllHistory

// @theater-source theater-history.js requestHistoryExport

// @theater-source theater-history.js addHistoryItems

// @theater-source theater-history.js loadJSZip

// @theater-source theater-history.js readHistoryZip

// @theater-source theater-history.js normalizedZipEntryName

// @theater-source theater-history.js importHistoryBackup

// @theater-source theater-history.js downloadFile

// ============================================================
// Generation
// ============================================================
let lastGeneratedHtml = '';
let lastGeneratedText = '';
let retainedResultSource = null; // 中断结果的轮次元数据，不改变最近生成列表。
let currentOutputMode = 'html';
let abortController = null;
let isGenerating = false;      // 是否正在生成
let isPreparingGeneration = false;
let bgStreamText = '';         // 后台生成时保存的流式文本
let bgError = '';              // 后台生成时的错误信息
let continueContext = '';      // 续写时的前情内容
let continuationSession = null;
let resultEditSnapshot = null; // 退出编辑时用于无损恢复原结果与排版

// 从HTML中提取纯文本（去掉标签，只留故事内容）
// @theater-source theater-generation.js htmlToPlainText

// @theater-source theater-generation.js prepareContinuationContext

// @theater-source theater-generation.js generationPreparationKey

// @theater-source theater-generation.js resolveRenderSelection

// @theater-source theater-generation.js resolveGenerationIdentity

// @theater-source theater-generation.js generationIdentitySlots

// @theater-source theater-generation.js freezeGenerationFoundationList

// @theater-source theater-generation.js buildGenerationContinuationRoundPayload

// @theater-source theater-generation.js assembleGenerationPayload

const estimateInputTokens = createTokenBreakdownEstimator();

// @theater-source theater-generation.js refreshTokenEstimate


// @theater-source theater-generation.js updateLengthHint

// @theater-source theater-generation.js continuationSessionHTML

// @theater-source theater-generation.js updateContinueHint

// @theater-source theater-generation.js showContinuationVersion

// @theater-source theater-generation.js clearContinueMode

// @theater-source theater-generation.js revealContinuationInput

// @theater-source theater-generation.js validateFinalRenderedHtml

// @theater-source theater-generation.js requestFinalRenderedHtml

// @theater-source theater-generation.js normalizeLongDreamResponseText

// @theater-source long-dream-runtime.js requestLongDreamChapter

// @theater-source long-dream-runtime.js generateLongDreamCanonSuggestions

// @theater-source long-dream-runtime.js renderLongDreamChapter

// @theater-source long-dream-runtime.js createCumulativeStreamRenderer

let longDreamStreamRenderer = null;
let longDreamStreamFirstChunk = true;

// @theater-source long-dream-runtime.js getLongDreamStreamRenderer

// @theater-source long-dream-runtime.js resetLongDreamStreamRenderer

// @theater-source long-dream-runtime.js updateLongDreamStream

// @theater-source long-dream-runtime.js resetLongDreamRenderProgress

// @theater-source long-dream-runtime.js updateLongDreamRenderProgress

// @theater-source long-dream-runtime.js handleLongDreamGenerationState

// @theater-source long-dream-runtime.js getLongDreamGenerationController

// @theater-source long-dream-runtime.js resolveLongDreamRequestFoundation

let longDreamTokenEstimateRequestId = 0;

// @theater-source long-dream-runtime.js refreshLongDreamTokenEstimate


// @theater-source long-dream-runtime.js generateNextLongDreamChapter

let longDreamCandidateSavePending = false;
// @theater-source long-dream-runtime.js keepLongDreamCandidate

// @theater-source long-dream-runtime.js confirmLongDreamChapter

// @theater-source long-dream-runtime.js queueLongDreamMemoryWeave

const refreshingLongDreamSummaries = new Set();
const confirmingLongDreamSummaries = new Set();
// @theater-source long-dream-runtime.js confirmLongDreamSummaryAction
// @theater-source long-dream-runtime.js syncLongDreamSummaryButton
// @theater-source long-dream-runtime.js refreshLongDreamSummaryNow

// @theater-source long-dream-runtime.js weaveLongDreamMemory

// @theater-source long-dream-runtime.js discardLongDreamDraft

// @theater-source long-dream-runtime.js regenerateLongDreamDraft

// @theater-source long-dream-runtime.js changeLongDreamDraftCandidate

// 设置续写上下文并跳转到生成面板
// @theater-source theater-generation.js startContinue

// @theater-source theater-generation.js stopGeneration

// @theater-source theater-generation.js generateTheater

// 生成核心。isAuto = 自动模式触发（弹窗可能根本没开，所有 UI 操作都已有 popupAlive 保护）
// @theater-source theater-generation.js runGeneration

// ============================================================
// Auto mode
// ============================================================
// @theater-source theater-auto-mode.js currentAutoInstruction

// @theater-source theater-auto-mode.js autoSourceKind

// @theater-source theater-auto-mode.js pickAutoInstruction

// 计数逻辑：只看"当前 AI 楼数"和锚点的差值，不数事件。
// 删楼把楼数删到锚点以下时，锚点自动下移到当前楼数——
// 既不会"永远凑不够"，也不会"一删楼就连环触发"。swipe 不加楼数，天然不计。
// @theater-source theater-auto-mode.js autoTick

// 悬浮球小红点：自动生成完成后亮起，打开面板就熄灭
// @theater-source theater-auto-mode.js setBallDot

// ============================================================
// API runtime adapters
// ============================================================
// @theater-source theater-api.js captureActualRequestTrace

// @theater-source theater-api.js captureGenerationApiRoute

// @theater-source theater-api.js requestConfiguredGenerationApi

// @theater-source theater-api.js generateWithMainAPI

// @theater-source theater-api.js callCustomAPIStream
// ============================================================
// Diagnostics
// ============================================================
// @theater-source theater-diagnostics.js diagnosticLine

// @theater-source theater-diagnostics.js formatApiResponseSummary

// @theater-source theater-diagnostics.js buildAutoModeDiagnostic

// @theater-source theater-diagnostics.js diagnosticCatalogHTML

// @theater-source theater-diagnostics.js buildDiagnostics

// @theater-source theater-diagnostics.js exportDiagnosticsText

// @theater-source theater-diagnostics.js runDiagnostics

// @theater-source theater-diagnostics.js toggleDiagnosticsReport

// ============================================================
// HTML extraction & iframe
// ============================================================
// @theater-source theater-result-workspace.js extractHtml

// @theater-source theater-result-workspace.js textFallbackHtml

let currentDisplayHtml = '';   // 当前iframe中显示的内容

// @theater-source theater-result-workspace.js showInIframe

// @theater-source theater-result-workspace.js closeFullscreenReader

// @theater-source theater-result-workspace.js currentReaderPayload

// @theater-source theater-result-workspace.js openFullscreenReader

let resultSwipeCleanup = null;

// @theater-source theater-result-workspace.js switchResultWorkspace

// @theater-source theater-result-workspace.js initializeResultWorkspace

// @theater-source theater-result-workspace.js updateRecentNav

// @theater-source theater-result-workspace.js displayedRecentIndex

// @theater-source theater-result-workspace.js showRecentResult

// @theater-source theater-result-workspace.js setResultEditControls

// @theater-source theater-result-workspace.js cancelResultEdit

// @theater-source theater-result-workspace.js clearDisplayedResult

// ============================================================
// Fetch model list from API
// ============================================================
// @theater-source theater-api.js fetchModelList

// ============================================================
// Test API connection
// ============================================================
// @theater-source theater-api.js testAPIConnection

// ============================================================
// Update
// ============================================================
// @theater-source theater-update.js showReloadAfterUpdateAction

// @theater-source theater-update.js confirmReloadAfterUpdate

// @theater-source theater-update.js updateExtension

// ============================================================
// Helpers
// ============================================================
function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function save() { SillyTavern.getContext().saveSettingsDebounced(); }

// Live bindings preserve the existing state ownership and asynchronous snapshots.
// Factories register functions without reading these getters during construction.
const runtime = {
    get BUILTIN_RENDER_SELECTIONS() { return BUILTIN_RENDER_SELECTIONS; },
    get FLOATING_BALL_OPEN_GUARD_MS() { return FLOATING_BALL_OPEN_GUARD_MS; },
    get FLOATING_BALL_OPEN_GUARD_RADIUS() { return FLOATING_BALL_OPEN_GUARD_RADIUS; },
    get HTML_RENDER_FINAL_GUARDRAILS() { return HTML_RENDER_FINAL_GUARDRAILS; },
    get INSTRUCTION_SWEEP_HOLD_MS() { return INSTRUCTION_SWEEP_HOLD_MS; },
    get INSTRUCTION_SWEEP_MOVE_TOLERANCE() { return INSTRUCTION_SWEEP_MOVE_TOLERANCE; },
    get INSTRUCTION_SWEEP_SCROLL_EDGE() { return INSTRUCTION_SWEEP_SCROLL_EDGE; },
    get INSTRUCTION_SWEEP_SCROLL_MAX_SPEED() { return INSTRUCTION_SWEEP_SCROLL_MAX_SPEED; },
    get INST_PAGE_SIZE() { return INST_PAGE_SIZE; },
    get LONG_DREAM_OPTIONAL_CONTEXT_CHAR_BUDGET() { return LONG_DREAM_OPTIONAL_CONTEXT_CHAR_BUDGET; },
    get LONG_DREAM_RELATION_OPTIONS() { return LONG_DREAM_RELATION_OPTIONS; },
    get THEATER_SCOPE() { return THEATER_SCOPE; },
    get THEATER_TAB_NAMES() { return THEATER_TAB_NAMES; },
    get VERSION() { return VERSION; },
    get abortController() { return abortController; },
    set abortController(value) { abortController = value; },
    get activateHistorySelectionGesture() { return activateHistorySelectionGesture; },
    get activateTheaterTab() { return activateTheaterTab; },
    get activeInstructionContent() { return activeInstructionContent; },
    set activeInstructionContent(value) { activeInstructionContent = value; },
    get activeInstructionTags() { return activeInstructionTags; },
    set activeInstructionTags(value) { activeInstructionTags = value; },
    get activeLongDreamCanonSuggestions() { return activeLongDreamCanonSuggestions; },
    get activeLongDreamChapterId() { return activeLongDreamChapterId; },
    set activeLongDreamChapterId(value) { activeLongDreamChapterId = value; },
    get activeLongDreamGenerationId() { return activeLongDreamGenerationId; },
    set activeLongDreamGenerationId(value) { activeLongDreamGenerationId = value; },
    get activeLongDreamId() { return activeLongDreamId; },
    set activeLongDreamId(value) { activeLongDreamId = value; },
    get activeTheaterPopupSession() { return activeTheaterPopupSession; },
    set activeTheaterPopupSession(value) { activeTheaterPopupSession = value; },
    get addContextExclusionRule() { return addContextExclusionRule; },
    get apiPresetDefaultName() { return apiPresetDefaultName; },
    get apiPresetDisplayLabel() { return apiPresetDisplayLabel; },
    get applyBulkTagOperation() { return applyBulkTagOperation; },
    get applyCharBoundBooks() { return applyCharBoundBooks; },
    get applyCustomCSS() { return applyCustomCSS; },
    get applyHistorySelectionGestureAt() { return applyHistorySelectionGestureAt; },
    get applyResultToolboxMode() { return applyResultToolboxMode; },
    get applyUIFontSize() { return applyUIFontSize; },
    get archiveCurrentResult() { return archiveCurrentResult; },
    get askNewItemName() { return askNewItemName; },
    get attachHistoryTouchMoveHandler() { return attachHistoryTouchMoveHandler; },
    get bgError() { return bgError; },
    set bgError(value) { bgError = value; },
    get bgStreamText() { return bgStreamText; },
    set bgStreamText(value) { bgStreamText = value; },
    get bindEvents() { return bindEvents; },
    get bindInstructionSweepSelection() { return bindInstructionSweepSelection; },
    get buildPopupHTML() { return buildPopupHTML; },
    get bulkDeleteSelected() { return bulkDeleteSelected; },
    get bulkEditSelectedHistoryTags() { return bulkEditSelectedHistoryTags; },
    get bulkEditSelectedTemplateTags() { return bulkEditSelectedTemplateTags; },
    get cachedPresetEntries() { return cachedPresetEntries; },
    set cachedPresetEntries(value) { cachedPresetEntries = value; },
    get cachedPresetLoadState() { return cachedPresetLoadState; },
    set cachedPresetLoadState(value) { cachedPresetLoadState = value; },
    get cachedPresetName() { return cachedPresetName; },
    set cachedPresetName(value) { cachedPresetName = value; },
    get cachedPresetPostProcessing() { return cachedPresetPostProcessing; },
    set cachedPresetPostProcessing(value) { cachedPresetPostProcessing = value; },
    get cachedPresetSquashSystemMessages() { return cachedPresetSquashSystemMessages; },
    set cachedPresetSquashSystemMessages(value) { cachedPresetSquashSystemMessages = value; },
    get callCustomAPIStream() { return callCustomAPIStream; },
    get cancelResultEdit() { return cancelResultEdit; },
    get captureCurrentLongDreamWorldBooks() { return captureCurrentLongDreamWorldBooks; },
    get captureGenerationApiRoute() { return captureGenerationApiRoute; },
    get captureRequestIssue() { return captureRequestIssue; },
    get changeLongDreamDraftCandidate() { return changeLongDreamDraftCandidate; },
    get chooseBulkTagOperation() { return chooseBulkTagOperation; },
    get chooseExportFormat() { return chooseExportFormat; },
    get chooseHistoryReadingVersion() { return chooseHistoryReadingVersion; },
    get chooseTags() { return chooseTags; },
    get chooseTagsWithNew() { return chooseTagsWithNew; },
    get clearContinueMode() { return clearContinueMode; },
    get clearDisplayedResult() { return clearDisplayedResult; },
    get clearInstSelection() { return clearInstSelection; },
    get clearLongDreamComposerDraft() { return clearLongDreamComposerDraft; },
    get clearRequestIssue() { return clearRequestIssue; },
    get closeFullscreenReader() { return closeFullscreenReader; },
    get closeInstructionActionMenus() { return closeInstructionActionMenus; },
    get closeResultActions() { return closeResultActions; },
    get confirmLongDreamChapter() { return confirmLongDreamChapter; },
    get confirmLongDreamSummaryAction() { return confirmLongDreamSummaryAction; },
    get confirmReloadAfterUpdate() { return confirmReloadAfterUpdate; },
    get confirmingLongDreamSummaries() { return confirmingLongDreamSummaries; },
    get contextExclusionSettingsHTML() { return contextExclusionSettingsHTML; },
    get continuationSession() { return continuationSession; },
    set continuationSession(value) { continuationSession = value; },
    get continuationSessionHTML() { return continuationSessionHTML; },
    get continuationSourceTags() { return continuationSourceTags; },
    set continuationSourceTags(value) { continuationSourceTags = value; },
    get continueContext() { return continueContext; },
    set continueContext(value) { continueContext = value; },
    get copyHtml() { return copyHtml; },
    get copyToClipboard() { return copyToClipboard; },
    get countSnapshotEntries() { return countSnapshotEntries; },
    get createCumulativeStreamRenderer() { return createCumulativeStreamRenderer; },
    get createFloatingBall() { return createFloatingBall; },
    get currentAutoInstruction() { return currentAutoInstruction; },
    get currentDisplayHtml() { return currentDisplayHtml; },
    set currentDisplayHtml(value) { currentDisplayHtml = value; },
    get currentGenerationJob() { return currentGenerationJob; },
    set currentGenerationJob(value) { currentGenerationJob = value; },
    get currentGenerationResult() { return currentGenerationResult; },
    set currentGenerationResult(value) { currentGenerationResult = value; },
    get currentOutputMode() { return currentOutputMode; },
    set currentOutputMode(value) { currentOutputMode = value; },
    get currentPresetEntryStates() { return currentPresetEntryStates; },
    get currentPresetSnapshot() { return currentPresetSnapshot; },
    get decorateConfigLayout() { return decorateConfigLayout; },
    get defaultSettings() { return defaultSettings; },
    get deleteRenderTpl() { return deleteRenderTpl; },
    get detachHistoryTouchMoveHandler() { return detachHistoryTouchMoveHandler; },
    get diagnosticCatalogHTML() { return diagnosticCatalogHTML; },
    get discardLongDreamDraft() { return discardLongDreamDraft; },
    get displayedRecentIndex() { return displayedRecentIndex; },
    get downloadFile() { return downloadFile; },
    get downloadTextContent() { return downloadTextContent; },
    get editHistoryTags() { return editHistoryTags; },
    get editTemplateTags() { return editTemplateTags; },
    get ensureSelectedPresetLoaded() { return ensureSelectedPresetLoaded; },
    get ensureWorldBooksCurrent() { return ensureWorldBooksCurrent; },
    get enterHistBatchMode() { return enterHistBatchMode; },
    get esc() { return esc; },
    get estimateInputTokens() { return estimateInputTokens; },
    get exitHistBatchMode() { return exitHistBatchMode; },
    get exportDiagnosticsText() { return exportDiagnosticsText; },
    get exportInstructionTemplates() { return exportInstructionTemplates; },
    get exportLongDreamChapter() { return exportLongDreamChapter; },
    get extractHtml() { return extractHtml; },
    get fetchModelList() { return fetchModelList; },
    get filterHistoryAll() { return filterHistoryAll; },
    get findApiPreset() { return findApiPreset; },
    get findLongDreamCanonSuggestion() { return findLongDreamCanonSuggestion; },
    get floatingBallCleanup() { return floatingBallCleanup; },
    set floatingBallCleanup(value) { floatingBallCleanup = value; },
    get formatRequestContextSummary() { return formatRequestContextSummary; },
    get generateLongDreamCanonSuggestions() { return generateLongDreamCanonSuggestions; },
    get generateNextLongDreamChapter() { return generateNextLongDreamChapter; },
    get generateTheater() { return generateTheater; },
    get generateWithMainAPI() { return generateWithMainAPI; },
    get generationIdentitySlots() { return generationIdentitySlots; },
    get getLongDreamComposerDraft() { return getLongDreamComposerDraft; },
    get getLongDreamGenerationController() { return getLongDreamGenerationController; },
    get handleLongDreamChapterAction() { return handleLongDreamChapterAction; },
    get hasOwn() { return hasOwn; },
    get hasRemoteUpdate() { return hasRemoteUpdate; },
    get histBatchMode() { return histBatchMode; },
    set histBatchMode(value) { histBatchMode = value; },
    get histDelete() { return histDelete; },
    get histPage() { return histPage; },
    set histPage(value) { histPage = value; },
    get histPut() { return histPut; },
    get histSelected() { return histSelected; },
    set histSelected(value) { histSelected = value; },
    get histSelectionGesture() { return histSelectionGesture; },
    set histSelectionGesture(value) { histSelectionGesture = value; },
    get histTouchMoveHandler() { return histTouchMoveHandler; },
    set histTouchMoveHandler(value) { histTouchMoveHandler = value; },
    get historyCache() { return historyCache; },
    set historyCache(value) { historyCache = value; },
    get historyCollections() { return historyCollections; },
    set historyCollections(value) { historyCollections = value; },
    get historyExpanded() { return historyExpanded; },
    get historyItemHTML() { return historyItemHTML; },
    get historyQuery() { return historyQuery; },
    set historyQuery(value) { historyQuery = value; },
    get historyReadingFolderId() { return historyReadingFolderId; },
    set historyReadingFolderId(value) { historyReadingFolderId = value; },
    get historyReadingItems() { return historyReadingItems; },
    set historyReadingItems(value) { historyReadingItems = value; },
    get historyReadingVersions() { return historyReadingVersions; },
    get historyTagFilterLabel() { return historyTagFilterLabel; },
    get historyVersionSelection() { return historyVersionSelection; },
    get historyWriteQueue() { return historyWriteQueue; },
    set historyWriteQueue(value) { historyWriteQueue = value; },
    get htmlToPlainText() { return htmlToPlainText; },
    get idb() { return idb; },
    set idb(value) { idb = value; },
    get idbTransactionDone() { return idbTransactionDone; },
    get importHistoryBackup() { return importHistoryBackup; },
    get importInstructionTemplates() { return importInstructionTemplates; },
    get importLongDreamBackup() { return importLongDreamBackup; },
    get initializeResultWorkspace() { return initializeResultWorkspace; },
    get instPage() { return instPage; },
    set instPage(value) { instPage = value; },
    get instSearch() { return instSearch; },
    set instSearch(value) { instSearch = value; },
    get instSelected() { return instSelected; },
    set instSelected(value) { instSelected = value; },
    get installedBranchCheckPending() { return installedBranchCheckPending; },
    set installedBranchCheckPending(value) { installedBranchCheckPending = value; },
    get installedBranchHasUpdate() { return installedBranchHasUpdate; },
    set installedBranchHasUpdate(value) { installedBranchHasUpdate = value; },
    get installedBranchName() { return installedBranchName; },
    set installedBranchName(value) { installedBranchName = value; },
    get installedBranchStatusKnown() { return installedBranchStatusKnown; },
    set installedBranchStatusKnown(value) { installedBranchStatusKnown = value; },
    get instructionSweepCleanup() { return instructionSweepCleanup; },
    set instructionSweepCleanup(value) { instructionSweepCleanup = value; },
    get isBuiltinRenderSelection() { return isBuiltinRenderSelection; },
    get isGenerating() { return isGenerating; },
    set isGenerating(value) { isGenerating = value; },
    get isPreparingGeneration() { return isPreparingGeneration; },
    set isPreparingGeneration(value) { isPreparingGeneration = value; },
    get keepLongDreamCandidate() { return keepLongDreamCandidate; },
    get knownInstructionTags() { return knownInstructionTags; },
    get lastApiConnectionSummary() { return lastApiConnectionSummary; },
    set lastApiConnectionSummary(value) { lastApiConnectionSummary = value; },
    get lastApiResponseSummary() { return lastApiResponseSummary; },
    set lastApiResponseSummary(value) { lastApiResponseSummary = value; },
    get lastAutoIssue() { return lastAutoIssue; },
    set lastAutoIssue(value) { lastAutoIssue = value; },
    get lastAutoIssueFingerprint() { return lastAutoIssueFingerprint; },
    set lastAutoIssueFingerprint(value) { lastAutoIssueFingerprint = value; },
    get lastGeneratedHtml() { return lastGeneratedHtml; },
    set lastGeneratedHtml(value) { lastGeneratedHtml = value; },
    get lastGeneratedText() { return lastGeneratedText; },
    set lastGeneratedText(value) { lastGeneratedText = value; },
    get lastRequestContext() { return lastRequestContext; },
    set lastRequestContext(value) { lastRequestContext = value; },
    get lastRequestIssue() { return lastRequestIssue; },
    set lastRequestIssue(value) { lastRequestIssue = value; },
    get lastRequestMetrics() { return lastRequestMetrics; },
    set lastRequestMetrics(value) { lastRequestMetrics = value; },
    get lastRequestTrace() { return lastRequestTrace; },
    set lastRequestTrace(value) { lastRequestTrace = value; },
    get lastUpdateCheckAt() { return lastUpdateCheckAt; },
    set lastUpdateCheckAt(value) { lastUpdateCheckAt = value; },
    get latestRemoteVersion() { return latestRemoteVersion; },
    set latestRemoteVersion(value) { latestRemoteVersion = value; },
    get loadJSZip() { return loadJSZip; },
    get loadPersona() { return loadPersona; },
    get loadPresetEntries() { return loadPresetEntries; },
    get loadPresetNameList() { return loadPresetNameList; },
    get loadWorldBookList() { return loadWorldBookList; },
    get longDreamActiveMemoryCount() { return longDreamActiveMemoryCount; },
    get longDreamAdd() { return longDreamAdd; },
    get longDreamCache() { return longDreamCache; },
    set longDreamCache(value) { longDreamCache = value; },
    get longDreamCandidateSavePending() { return longDreamCandidateSavePending; },
    set longDreamCandidateSavePending(value) { longDreamCandidateSavePending = value; },
    get longDreamCanonSuggestionState() { return longDreamCanonSuggestionState; },
    get longDreamChapterEditController() { return longDreamChapterEditController; },
    set longDreamChapterEditController(value) { longDreamChapterEditController = value; },
    get longDreamDelete() { return longDreamDelete; },
    get longDreamGenerationController() { return longDreamGenerationController; },
    set longDreamGenerationController(value) { longDreamGenerationController = value; },
    get longDreamGenerationStageText() { return longDreamGenerationStageText; },
    get longDreamLiveDraftText() { return longDreamLiveDraftText; },
    set longDreamLiveDraftText(value) { longDreamLiveDraftText = value; },
    get longDreamMemoryAnalysisPresets() { return longDreamMemoryAnalysisPresets; },
    get longDreamMemoryQueue() { return longDreamMemoryQueue; },
    set longDreamMemoryQueue(value) { longDreamMemoryQueue = value; },
    get longDreamMemoryTags() { return longDreamMemoryTags; },
    get longDreamMemoryV2Fields() { return longDreamMemoryV2Fields; },
    get longDreamPanelHTML() { return longDreamPanelHTML; },
    get longDreamProgressTicker() { return longDreamProgressTicker; },
    set longDreamProgressTicker(value) { longDreamProgressTicker = value; },
    get longDreamPut() { return longDreamPut; },
    get longDreamRenderReceivedChars() { return longDreamRenderReceivedChars; },
    set longDreamRenderReceivedChars(value) { longDreamRenderReceivedChars = value; },
    get longDreamRenderRepairing() { return longDreamRenderRepairing; },
    set longDreamRenderRepairing(value) { longDreamRenderRepairing = value; },
    get longDreamSnapshotEntryCount() { return longDreamSnapshotEntryCount; },
    get longDreamSourceInstructionState() { return longDreamSourceInstructionState; },
    get longDreamSourcePreviewHTML() { return longDreamSourcePreviewHTML; },
    get longDreamSourceWorldBooks() { return longDreamSourceWorldBooks; },
    get longDreamStreamFirstChunk() { return longDreamStreamFirstChunk; },
    set longDreamStreamFirstChunk(value) { longDreamStreamFirstChunk = value; },
    get longDreamStreamRenderer() { return longDreamStreamRenderer; },
    set longDreamStreamRenderer(value) { longDreamStreamRenderer = value; },
    get longDreamTokenEstimateRequestId() { return longDreamTokenEstimateRequestId; },
    set longDreamTokenEstimateRequestId(value) { longDreamTokenEstimateRequestId = value; },
    get longDreamView() { return longDreamView; },
    set longDreamView(value) { longDreamView = value; },
    get longDreamWorkLevel() { return longDreamWorkLevel; },
    set longDreamWorkLevel(value) { longDreamWorkLevel = value; },
    get longDreamWorkspaceSection() { return longDreamWorkspaceSection; },
    set longDreamWorkspaceSection(value) { longDreamWorkspaceSection = value; },
    get manageInstructionTags() { return manageInstructionTags; },
    get newInstructionTag() { return newInstructionTag; },
    get normalizeLongDreamResponseText() { return normalizeLongDreamResponseText; },
    get normalizeRenderSelection() { return normalizeRenderSelection; },
    get normalizeTheaterTab() { return normalizeTheaterTab; },
    get normalizeUIFontSize() { return normalizeUIFontSize; },
    get normalizedZipEntryName() { return normalizedZipEntryName; },
    get openFullscreenReader() { return openFullscreenReader; },
    get openHistoryReading() { return openHistoryReading; },
    get openTheaterPopup() { return openTheaterPopup; },
    get organizeHistory() { return organizeHistory; },
    get persistCurrentApiConfig() { return persistCurrentApiConfig; },
    get playNotificationSound() { return playNotificationSound; },
    get positionInstructionActionMenu() { return positionInstructionActionMenu; },
    get positionResultToolbox() { return positionResultToolbox; },
    get presetLoadInFlight() { return presetLoadInFlight; },
    set presetLoadInFlight(value) { presetLoadInFlight = value; },
    get presetLoadSequence() { return presetLoadSequence; },
    set presetLoadSequence(value) { presetLoadSequence = value; },
    get presetNamesCache() { return presetNamesCache; },
    set presetNamesCache(value) { presetNamesCache = value; },
    get presetSearch() { return presetSearch; },
    set presetSearch(value) { presetSearch = value; },
    get previewContextExclusions() { return previewContextExclusions; },
    get queueHistoryWrite() { return queueHistoryWrite; },
    get queueLongDreamMemoryWeave() { return queueLongDreamMemoryWeave; },
    get queueResultStorage() { return queueResultStorage; },
    get queuedLongDreamMemoryIds() { return queuedLongDreamMemoryIds; },
    get quickRenderButtonContent() { return quickRenderButtonContent; },
    get readApiFormConfig() { return readApiFormConfig; },
    get readLongDreamChapter() { return readLongDreamChapter; },
    get readingState() { return readingState; },
    get recentCache() { return recentCache; },
    set recentCache(value) { recentCache = value; },
    get recentIndex() { return recentIndex; },
    set recentIndex(value) { recentIndex = value; },
    get recentPersist() { return recentPersist; },
    get recordRequestMetrics() { return recordRequestMetrics; },
    get refreshApiPresetControls() { return refreshApiPresetControls; },
    get refreshConfigSummaries() { return refreshConfigSummaries; },
    get refreshContextExclusionRules() { return refreshContextExclusionRules; },
    get refreshHistList() { return refreshHistList; },
    get refreshInstUI() { return refreshInstUI; },
    get refreshLongDreamCreateWorldBookState() { return refreshLongDreamCreateWorldBookState; },
    get refreshLongDreamMemoryPresetControls() { return refreshLongDreamMemoryPresetControls; },
    get refreshLongDreamMemorySelection() { return refreshLongDreamMemorySelection; },
    get refreshLongDreamSummaryNow() { return refreshLongDreamSummaryNow; },
    get refreshLongDreamWorldBookSources() { return refreshLongDreamWorldBookSources; },
    get refreshRenderSelectionControls() { return refreshRenderSelectionControls; },
    get refreshTagControls() { return refreshTagControls; },
    get refreshTokenEstimate() { return refreshTokenEstimate; },
    get refreshUpdateBadges() { return refreshUpdateBadges; },
    get refreshWBUI() { return refreshWBUI; },
    get refreshingLongDreamSummaries() { return refreshingLongDreamSummaries; },
    get refreshingLongDreamWorldBookId() { return refreshingLongDreamWorldBookId; },
    set refreshingLongDreamWorldBookId(value) { refreshingLongDreamWorldBookId = value; },
    get refreshingLongDreamWorldBooks() { return refreshingLongDreamWorldBooks; },
    set refreshingLongDreamWorldBooks(value) { refreshingLongDreamWorldBooks = value; },
    get regenerateLongDreamDraft() { return regenerateLongDreamDraft; },
    get reloadWorldBooks() { return reloadWorldBooks; },
    get rememberLongDreamComposerDraft() { return rememberLongDreamComposerDraft; },
    get rememberLongDreamNavigation() { return rememberLongDreamNavigation; },
    get remoteUpdateLabel() { return remoteUpdateLabel; },
    get renameHistoryItem() { return renameHistoryItem; },
    get renderHistoryList() { return renderHistoryList; },
    get renderInstList() { return renderInstList; },
    get renderLongDreamCanonSuggestions() { return renderLongDreamCanonSuggestions; },
    get renderLongDreamChapter() { return renderLongDreamChapter; },
    get renderLongDreamPanel() { return renderLongDreamPanel; },
    get renderPresetOptions() { return renderPresetOptions; },
    get renderRuntimeLog() { return renderRuntimeLog; },
    get renderSelectionAfterCustomDelete() { return renderSelectionAfterCustomDelete; },
    get renderSelectionHint() { return renderSelectionHint; },
    get renderSelectionMeta() { return renderSelectionMeta; },
    get renderTemplateContentForSelection() { return renderTemplateContentForSelection; },
    get renderTemplateOptions() { return renderTemplateOptions; },
    get renderWBTree() { return renderWBTree; },
    get requestConfiguredGenerationApi() { return requestConfiguredGenerationApi; },
    get requestFailureMessage() { return requestFailureMessage; },
    get requestFinalRenderedHtml() { return requestFinalRenderedHtml; },
    get requestHistoryExport() { return requestHistoryExport; },
    get requestLongDreamExport() { return requestLongDreamExport; },
    get requestMetricsLog() { return requestMetricsLog; },
    get resetHistorySelectionGesture() { return resetHistorySelectionGesture; },
    get resetLongDreamCanonSuggestions() { return resetLongDreamCanonSuggestions; },
    get resolveGenerationIdentity() { return resolveGenerationIdentity; },
    get resolveLongDreamSource() { return resolveLongDreamSource; },
    get resolveRenderSelection() { return resolveRenderSelection; },
    get restoreLongDreamNavigation() { return restoreLongDreamNavigation; },
    get resultBookmarkRect() { return resultBookmarkRect; },
    get resultEditSnapshot() { return resultEditSnapshot; },
    set resultEditSnapshot(value) { resultEditSnapshot = value; },
    get resultPageScroll() { return resultPageScroll; },
    get resultReader() { return resultReader; },
    set resultReader(value) { resultReader = value; },
    get resultStorageQueue() { return resultStorageQueue; },
    set resultStorageQueue(value) { resultStorageQueue = value; },
    get resultSwipeCleanup() { return resultSwipeCleanup; },
    set resultSwipeCleanup(value) { resultSwipeCleanup = value; },
    get resultWorkspacePage() { return resultWorkspacePage; },
    set resultWorkspacePage(value) { resultWorkspacePage = value; },
    get retainedResultSource() { return retainedResultSource; },
    set retainedResultSource(value) { retainedResultSource = value; },
    get rollRandomInstruction() { return rollRandomInstruction; },
    get runDiagnostics() { return runDiagnostics; },
    get runGeneration() { return runGeneration; },
    get runtimeLog() { return runtimeLog; },
    get save() { return save; },
    get saveInstructionTpl() { return saveInstructionTpl; },
    get saveLongDreamChapterEdits() { return saveLongDreamChapterEdits; },
    get saveRenderTpl() { return saveRenderTpl; },
    get saveToHistory() { return saveToHistory; },
    get scheduleLongDreamTokenEstimate() { return scheduleLongDreamTokenEstimate; },
    get scheduleTokenEstimate() { return scheduleTokenEstimate; },
    get selectAllVisible() { return selectAllVisible; },
    get selectedLongDreamMemoryAnalysisPreset() { return selectedLongDreamMemoryAnalysisPreset; },
    get selectedLongDreamMemoryApiPreset() { return selectedLongDreamMemoryApiPreset; },
    get setActiveInstructionTags() { return setActiveInstructionTags; },
    get setBallDot() { return setBallDot; },
    get setCurrentLongDreamStatus() { return setCurrentLongDreamStatus; },
    get setHistoryItemSelected() { return setHistoryItemSelected; },
    get setInstructionItemSelected() { return setInstructionItemSelected; },
    get setLongDreamComposerDraft() { return setLongDreamComposerDraft; },
    get setResultEditControls() { return setResultEditControls; },
    get setWBStateByIndex() { return setWBStateByIndex; },
    get settings() { return settings; },
    set settings(value) { settings = value; },
    get showContinuationVersion() { return showContinuationVersion; },
    get showInIframe() { return showInIframe; },
    get showRecentResult() { return showRecentResult; },
    get startContinue() { return startContinue; },
    get stopGeneration() { return stopGeneration; },
    get stopLongDreamProgressTicker() { return stopLongDreamProgressTicker; },
    get storeCurrentResult() { return storeCurrentResult; },
    get suppressHistoryCardClickUntil() { return suppressHistoryCardClickUntil; },
    set suppressHistoryCardClickUntil(value) { suppressHistoryCardClickUntil = value; },
    get switchQuickRenderSelection() { return switchQuickRenderSelection; },
    get switchResultWorkspace() { return switchResultWorkspace; },
    get syncLongDreamPanel() { return syncLongDreamPanel; },
    get syncLongDreamProgressDisplay() { return syncLongDreamProgressDisplay; },
    get syncManualIntoWB() { return syncManualIntoWB; },
    get tagFilterSummary() { return tagFilterSummary; },
    get testAPIConnection() { return testAPIConnection; },
    get textFallbackHtml() { return textFallbackHtml; },
    get theaterError() { return theaterError; },
    get theaterNativeSelectCompatCounter() { return theaterNativeSelectCompatCounter; },
    set theaterNativeSelectCompatCounter(value) { theaterNativeSelectCompatCounter = value; },
    get theaterNativeSelectCompatId() { return theaterNativeSelectCompatId; },
    get theaterNativeSelectCompatPrefix() { return theaterNativeSelectCompatPrefix; },
    get toggleDiagnosticsReport() { return toggleDiagnosticsReport; },
    get toggleLongDreamSummaryPreview() { return toggleLongDreamSummaryPreview; },
    get updateBadgeHTML() { return updateBadgeHTML; },
    get updateBulkBar() { return updateBulkBar; },
    get updateCheckPromise() { return updateCheckPromise; },
    set updateCheckPromise(value) { updateCheckPromise = value; },
    get updateContinueHint() { return updateContinueHint; },
    get updateExtension() { return updateExtension; },
    get updateHistorySelectionAutoScroll() { return updateHistorySelectionAutoScroll; },
    get updateQuickRenderSetting() { return updateQuickRenderSetting; },
    get updateReadyToReload() { return updateReadyToReload; },
    set updateReadyToReload(value) { updateReadyToReload = value; },
    get updateRecentNav() { return updateRecentNav; },
    get updateResultItem() { return updateResultItem; },
    get updateWBCount() { return updateWBCount; },
    get validateApiPresetConfig() { return validateApiPresetConfig; },
    get visibleHistoryItems() { return visibleHistoryItems; },
    get wbBookNames() { return wbBookNames; },
    set wbBookNames(value) { wbBookNames = value; },
    get wbEntries() { return wbEntries; },
    set wbEntries(value) { wbEntries = value; },
    get wbGroupCollapsed() { return wbGroupCollapsed; },
    set wbGroupCollapsed(value) { wbGroupCollapsed = value; },
    get wbLoadedCacheKey() { return wbLoadedCacheKey; },
    set wbLoadedCacheKey(value) { wbLoadedCacheKey = value; },
    get wbLoadedReadMode() { return wbLoadedReadMode; },
    set wbLoadedReadMode(value) { wbLoadedReadMode = value; },
    get wbReloadInFlight() { return wbReloadInFlight; },
    set wbReloadInFlight(value) { wbReloadInFlight = value; },
    get wbReloadSequence() { return wbReloadSequence; },
    set wbReloadSequence(value) { wbReloadSequence = value; },
    get wbSearch() { return wbSearch; },
    set wbSearch(value) { wbSearch = value; },
    get wbStates() { return wbStates; },
    set wbStates(value) { wbStates = value; },
    get worldBookCacheKey() { return worldBookCacheKey; },
    get writeApiFormConfig() { return writeApiFormConfig; }
};

const { recordRequestMetrics, captureRequestIssue, clearRequestIssue, requestFailureMessage, countSnapshotEntries, formatRequestContextSummary } = createTheaterRequestState(runtime);

const { isBuiltinRenderSelection, renderTemplateContentForSelection, normalizeRenderSelection, renderSelectionMeta, renderTemplateOptions, renderSelectionHint, quickRenderState, quickRenderButtonContent, refreshRenderSelectionControls, switchQuickRenderSelection, updateQuickRenderSetting, renderSelectionAfterCustomDelete } = createTheaterRenderSelection(runtime);

const { normalizeTheaterTab, longDreamComposerDrafts, getLongDreamComposerDraft, rememberLongDreamComposerDraft, setLongDreamComposerDraft, clearLongDreamComposerDraft, rememberLongDreamNavigation, restoreLongDreamNavigation } = createLongDreamNavigation(runtime);

const { idbReq, idbTransactionDone, storageInit, histAdd, histAddStorage, histDelete, histDeleteStorage, recentPersist, queueResultStorage, archiveCurrentResult, storeCurrentResult, updateResultItem, longDreamAdd, longDreamPut, longDreamDelete, histPut, histPutStorage, queueHistoryWrite } = createTheaterStorage(runtime);

const { checkRemoteVersion, hasRemoteUpdate, remoteUpdateLabel, updateBadgeHTML, refreshUpdateBadges, showReloadAfterUpdateAction, confirmReloadAfterUpdate, updateExtension } = createTheaterUpdate(runtime);

const { scopeSelector, scopeRules, scopeCSS, applyCustomCSS, normalizeUIFontSize, fontSizeVars, applyUIFontSize, getSoundPreset, playNotificationSound, runtimeLog, theaterError, renderRuntimeLog, openTheaterPopupFromFloatingBall, createFloatingBall } = createTheaterAppearance(runtime);

const { theaterNativeSelectCompatId, guardTheaterNativeSelectEvent, buildPopupHTML, decorateConfigLayout } = createTheaterPopupUi(runtime);

const { historyItemHTML, historyTagBadgesHTML, longDreamSources, resolveLongDreamSource, longDreamDate, longDreamExcerpt, longDreamSourceInstructionState, longDreamSourcePreviewHTML, resetLongDreamCanonSuggestions, activeLongDreamCanonSuggestions, longDreamCanonSuggestionCardsHTML, longDreamCanonSuggestionHTML, renderLongDreamCanonSuggestions, findLongDreamCanonSuggestion, captureCurrentLongDreamWorldBooks, longDreamSnapshotEntryCount, longDreamBackupFileName, exportLongDreamZip, chooseExportFormat, exportLongDreamBackup, requestLongDreamExport, readLongDreamZip, importedLongDreamTitle, importLongDreamBackup, readLongDreamChapter, longDreamChapterFileName, exportLongDreamChapter, saveLongDreamChapterEdits, setCurrentLongDreamStatus, longDreamListHTML, longDreamRelationLabel, longDreamRelationChoicesHTML, longDreamSourceWorldBooks, sameWorldBookSelection, longDreamCreateWorldBookStateHTML, refreshLongDreamCreateWorldBookState, longDreamCreateHTML, longDreamGenerationStageText, formatLongDreamElapsed, longDreamProgressStageText, longDreamProgressLabelText, longDreamProgressKickerText, longDreamProgressMetaHTML, selectedLongDreamMemoryApiPreset, longDreamMemoryAnalysisPresets, selectedLongDreamMemoryAnalysisPreset, refreshLongDreamMemoryPresetControls, longDreamMemoryStatusText, longDreamActiveMemoryCount, longDreamSummaryHistoryHTML, toggleLongDreamSummaryPreview, longDreamMemoryConflictTarget, longDreamMemoryConflictSubjects, longDreamMemoryConflictItemText, longDreamMemoryConflictOperationText, longDreamMemoryConflictDetails, longDreamMemoryCardsHTML, longDreamMemorySelectionHTML, refreshLongDreamMemorySelection, longDreamMemoryTags, longDreamMemoryV2Fields, uniqueLongDreamBranchTitle, handleLongDreamChapterAction, longDreamWorkspaceHTML, longDreamDetailState, longDreamDetailHeaderHTML, refreshLongDreamWorldBookSources, longDreamDefinitionHTML, longDreamDetailHTML, longDreamKeptVersionsHTML, longDreamChapterDirectoryHTML, longDreamWorkDetailHTML, longDreamChapterDetailHTML, longDreamUnavailableHTML, longDreamPanelHTML, syncLongDreamPanel, renderLongDreamPanel, renderLongDreamProgressCandidate, stopLongDreamProgressTicker, syncLongDreamProgressDisplay, renderLongDreamReviewDraft } = createLongDreamWorkspace(runtime);

const { knownInstructionTags, tagFilterSummary, historyTagFilterLabel, contextExclusionSettingsHTML, contextExclusionRulesHTML, refreshContextExclusionRules, addContextExclusionRule, previewContextExclusions, worldBookCacheKey, isWorldBookCacheCurrent, wbEntryHTML, wbBookBodyHTML, renderWBTree, updateWBGroupCounts, hasManualEntries, updateWBCount, refreshWBUI, setWBStateByIndex, syncManualIntoWB, loadPersona, currentPresetEntryStates, renderPresetOptions, loadPresetNameList, parsePromptToEntries, fetchPresetByName, extractPromptsFromData, setPresetEntryControlsEnabled, currentPresetSnapshot, loadPresetEntries, ensureSelectedPresetLoaded, renderPresetEntries, getSelectedPresetPrompt, getSelectedPresetEntries, loadWorldBookList, entryKey, reloadWorldBooks, ensureWorldBooksCurrent, getCharBoundBooks, applyCharBoundBooks } = createTheaterMaterials(runtime);

const { itemTagBadgesHTML, tagUsageCounts, rollRandomInstruction, setActiveInstructionTags, filterInstAll, renderInstList, updateBulkBar, setInstructionItemSelected, closeInstructionActionMenus, positionInstructionActionMenu, bindInstructionSweepSelection, chooseTags, askNewItemName, chooseTagsWithNew, newInstructionTag, updateAllHistoryTags, manageInstructionTags, editTemplateTags, chooseBulkTagOperation, applyBulkTagOperation, saveInstructionTpl, bulkEditSelectedTemplateTags, bulkDeleteSelected, selectAllVisible, clearInstSelection, saveRenderTpl, deleteRenderTpl, splitImportedTemplate, importInstructionTemplates, exportInstructionTemplates } = createTheaterInstructions(runtime);

const { activateTheaterTab, openTheaterPopup } = createTheaterPopupController(runtime);

const { readApiFormConfig, writeApiFormConfig, apiPresetDefaultName, apiPresetDisplayLabel, validateApiPresetConfig, persistCurrentApiConfig, refreshApiPresetControls, refreshConfigSummaries, findApiPreset } = createTheaterApiSettings(runtime);

const { closeResultActions, resultBookmarkRect, positionResultToolbox, applyResultToolboxMode, extractHtml, textFallbackHtml, showInIframe, closeFullscreenReader, currentReaderPayload, openFullscreenReader, switchResultWorkspace, initializeResultWorkspace, updateRecentNav, displayedRecentIndex, showRecentResult, setResultEditControls, cancelResultEdit, clearDisplayedResult } = createTheaterResultWorkspace(runtime);

const { inferHistoryTags, migrateHistoryTags, refreshInstUI, filterHistoryAll, setHistoryItemSelected, detachHistoryTouchMoveHandler, attachHistoryTouchMoveHandler, resetHistorySelectionGesture, activateHistorySelectionGesture, applyHistorySelectionGestureAt, runHistorySelectionAutoScroll, updateHistorySelectionAutoScroll, refreshHistList, currentHistoryPage, visibleHistoryItems, renderHistoryList, refreshTagControls, renameHistoryItem, editHistoryTags, bulkEditSelectedHistoryTags, updateHistBulkBar, enterHistBatchMode, exitHistBatchMode, commitHistoryCollection, organizeHistory, openHistoryReading, historyReadingVersions, chooseHistoryReadingVersion, saveToHistory, copyHtml, readClipboardMatch, copyToClipboard, fallbackCopy, showManualCopyPanel, downloadTextContent, exportAllHistory, requestHistoryExport, addHistoryItems, loadJSZip, readHistoryZip, normalizedZipEntryName, importHistoryBackup, downloadFile } = createTheaterHistory(runtime);

const { bindEvents } = createTheaterEvents(runtime);

const { htmlToPlainText, prepareContinuationContext, generationPreparationKey, resolveRenderSelection, resolveGenerationIdentity, generationIdentitySlots, freezeGenerationFoundationList, buildGenerationContinuationRoundPayload, assembleGenerationPayload, refreshTokenEstimate, updateLengthHint, continuationSessionHTML, updateContinueHint, showContinuationVersion, clearContinueMode, revealContinuationInput, validateFinalRenderedHtml, requestFinalRenderedHtml, normalizeLongDreamResponseText, startContinue, stopGeneration, generateTheater, runGeneration } = createTheaterGeneration(runtime);

const { requestLongDreamChapter, generateLongDreamCanonSuggestions, renderLongDreamChapter, createCumulativeStreamRenderer, getLongDreamStreamRenderer, resetLongDreamStreamRenderer, updateLongDreamStream, resetLongDreamRenderProgress, updateLongDreamRenderProgress, handleLongDreamGenerationState, getLongDreamGenerationController, resolveLongDreamRequestFoundation, refreshLongDreamTokenEstimate, generateNextLongDreamChapter, keepLongDreamCandidate, confirmLongDreamChapter, queueLongDreamMemoryWeave, confirmLongDreamSummaryAction, syncLongDreamSummaryButton, refreshLongDreamSummaryNow, weaveLongDreamMemory, discardLongDreamDraft, regenerateLongDreamDraft, changeLongDreamDraftCandidate } = createLongDreamRuntime(runtime);

const { currentAutoInstruction, autoSourceKind, pickAutoInstruction, autoTick, setBallDot } = createTheaterAutoMode(runtime);

const { captureActualRequestTrace, captureGenerationApiRoute, requestConfiguredGenerationApi, generateWithMainAPI, callCustomAPIStream, fetchModelList, testAPIConnection } = createTheaterApi(runtime);

const { diagnosticLine, formatApiResponseSummary, buildAutoModeDiagnostic, diagnosticCatalogHTML, buildDiagnostics, exportDiagnosticsText, runDiagnostics, toggleDiagnosticsReport } = createTheaterDiagnostics(runtime);

// Install schedulers after their feature callbacks have been registered.
window.addEventListener('mousedown', guardTheaterNativeSelectEvent, true);
window.addEventListener('touchend', guardTheaterNativeSelectEvent, true);
const scheduleTokenEstimate = debounce(refreshTokenEstimate, 220);
const scheduleLongDreamTokenEstimate = debounce(refreshLongDreamTokenEstimate, 220);

jQuery(async () => { await init(); });
