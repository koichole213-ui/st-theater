import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateTokenBreakdown, estimateTokenCount } from '../token-estimator.js';
import { buildContinuationInstruction, buildContinuationPayload, buildFinalRenderPayload, buildGenerationPayload, createFinalRenderPlan, hydrateFinalRenderHtml } from '../generation-payload.js';
import { API_PROTOCOLS, DEFAULT_MAX_OUTPUT_TOKENS, buildApiRequest, contentBlockReason, extractApiErrorMessage, extractResponseMeta, extractStreamText, isContentBlockedErrorMessage, isContentBlockedStopReason, isHtmlErrorResponse, isMaxTokenLimitError, isRateLimitErrorMessage, maxTokenFallbackSequence, normalizeMaxTokens, resolveMainApiModel, retryAfterMilliseconds } from '../api-client.js';
import { readNonStreamingResponse, readSSEStream, requestCustomApi, requestMainApi } from '../api-runtime.js';
import { abortGenerationJob, addGenerationSegment, authorizeFinish, createGenerationJob, shouldAuthorizeFinishRound, shouldContinueJob, targetCompletionChars } from '../generation-job.js';
import { MAX_CONTINUATION_CONTEXT_CHARS, continuationContextWindow, normalizeContinuationText, readableCharCount } from '../text-counter.js';
import { RENDER_REPORT_TIMEOUT_MS, injectResizeReporter, installSafeResizeListener, renderSafeIframe, sandboxPermissions } from '../safe-renderer.js';
import { createRequestMetrics, markCompleted, markFailed, markFallback, markFirstToken, summarizeMetrics } from '../request-metrics.js';
import { filterTaggedReasoning, reasoningSafeContent } from '../reasoning-filter.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, classifyRequestFailure, createDiagnosticError, diagnosticSignalInfo } from '../request-diagnostics.js';
import { bookmarkPlacementFromPoint, bookmarkPosition, normalizeBookmarkYRatio } from '../result-bookmark.js';
import { autoSourceLabel, resolveAutoInstruction } from '../auto-mode.js';
import { MAX_RUNTIME_LOGS, clearRuntimeLogs, formatRuntimeLogs, getRuntimeLogEntries, setRuntimeLogSecretProvider, writeRuntimeLog } from '../runtime-log.js';
import { apiPresetSecretValues, createApiPresetFromConfig, normalizeApiPresetList } from '../api-presets.js';
import { splitInstructionTextFile } from '../instruction-import.js';
import { LENGTH_TIERS, LONG_FORM_SPLIT_THRESHOLD, STAGED_RENDER_THRESHOLD, classifyLengthTier, firstRoundGuidance, isLongFormTarget, isStagedRenderTarget, longFormFirstRoundGuidance, longFormFirstRoundTarget, parseTargetWordCount, resolveTargetWordCount, stripTargetWordCountRequirement } from '../length-policy.js';
import { AUTO_CONTINUE_SCHEMA, migrateAutoContinueDefault } from '../settings-migration.js';
import { createInstructionBackup, parseInstructionBackup } from '../instruction-backup.js';
import { WORLD_BOOK_STRATEGIES, rememberWorldBookEntryStates, shouldReadWorldBookEntry, syncFollowedWorldBooks, worldBookEntryStrategy } from '../world-book-policy.js';
import { buildProtagonistAnchor } from '../protagonist-anchor.js';
import { scanWorldBookEntriesWithSillyTavern } from '../world-book-runtime.js';
import { MAX_CONTEXT_MESSAGES, normalizeContextRange, takeRecentMessages } from '../context-policy.js';
import { PLAIN_TEXT_DARK_SELECTION, PLAIN_TEXT_LIGHT_SELECTION, buildPlainTextHtml, isPlainTextSelection, isTextOutputMode, plainTextThemeForSelection, textOutputModeForTheme, textThemeForOutputMode } from '../plain-text-renderer.js';
import { HISTORY_ARCHIVE_MANIFEST, createHistoryArchive, createHistoryJsonBackup, historyItemsFromArchive, normalizeHistoryBackup } from '../history-backup.js';
import { LONG_DREAM_DRAFT_RESUME_STAGE, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_MAX_CANDIDATES, LONG_DREAM_MEMORY_STATUS, LONG_DREAM_SCHEMA_VERSION, LONG_DREAM_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, LONG_DREAM_WORLD_LINE_RELATION, appendLongDreamChapter, applyLongDreamMemoryPatch, clearLongDreamDraft, createLongDreamBranch, createLongDreamRecord, createLongDreamWorldBookSnapshot, deleteLongDreamFrom, discardLongDreamWritingAttempt, latestLongDreamChapter, migrateLongDreamRecord, normalizeLongDreamRecord, prepareLongDreamMemoryRegeneration, promoteLongDreamDraft, recoverInterruptedLongDreamMemory, rejectLongDreamMemoryV2RecordItem, resolveLongDreamMemoryV2RecordConflict, saveLongDreamDraft, selectLongDreamDraftCandidate, setLongDreamMemoryCardStatus, setLongDreamMemoryStatus, setLongDreamStatus, truncateLongDreamAfter, updateLongDreamChapter, updateLongDreamDefinition, updateLongDreamMemoryCard, updateLongDreamMemoryV2RecordItem } from '../long-dream.js';
import { LONG_DREAM_RECENT_CHAPTER_COUNT, buildLongDreamChapterMessages, buildLongDreamChapterPayload, longDreamChapterContext, longDreamWorldBookContext, longDreamWorldBookEntries, selectRelevantLongDreamMemoryCards, selectRelevantLongDreamMemoryItems } from '../long-dream-payload.js';
import { LONG_DREAM_GENERATION_STAGE, createLongDreamGenerationController } from '../long-dream-generation.js';
import { LONG_DREAM_BACKUP_FORMAT, LONG_DREAM_BACKUP_VERSION, createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { LONG_DREAM_ARCHIVE_FORMAT, LONG_DREAM_ARCHIVE_MANIFEST, createLongDreamArchive, parseLongDreamArchive } from '../long-dream-archive.js';
import { LONG_DREAM_CANON_SUGGESTION_CATEGORIES, buildLongDreamCanonSuggestionPayload, composeLongDreamCanon, parseLongDreamCanonSuggestions } from '../long-dream-canon-suggestions.js';
import { buildLongDreamMemoryPayload, parseLongDreamMemoryResponse, pendingLongDreamChapters, shouldWeaveLongDreamMemory } from '../long-dream-memory.js';
import { LONG_DREAM_MEMORY_OUTPUT_CONTRACT, exportLongDreamMemoryPreset, parseLongDreamMemoryPreset } from '../long-dream-memory-presets.js';
import { PROMPT_POST_PROCESSING, WORLD_INFO_POSITION, applyPromptPostProcessing, composePresetMessages, normalizeRequestMessages, normalizeWorldInfoEntry, squashAdjacentSystemMessages } from '../request-layout.js';
import { createRequestTrace, formatRequestTrace } from '../request-trace.js';

test('AI 定梦建议只读取第一章正文，并明确输出待确认草稿', () => {
    const payload = buildLongDreamCanonSuggestionPayload({
        sourceTitle: '雨夜旧站',
        sourceText: '林岚在末班车离开后独自留在旧站。',
    });
    assert.match(payload.userPrompt, /雨夜旧站/);
    assert.match(payload.userPrompt, /林岚在末班车离开后独自留在旧站/);
    assert.match(payload.systemPrompt, /只依据提供的第一章正文/);
    assert.match(payload.systemPrompt, /uncertain/);
    assert.doesNotMatch(payload.userPrompt, /世界书|聊天前文/);
    assert.equal(payload.sourceChars, 16);
});

test('AI 定梦建议解析会保留不确定标记、归一分类并去重', () => {
    const items = parseLongDreamCanonSuggestions(`<thinking>这里不能显示</thinking>\n\n\`\`\`json
{
  "items": [
    { "category": "关系", "content": "林岚与周遥是旧识。", "uncertain": true, "uncertaintyNote": "正文没有说明相识年份。" },
    { "category": "人物关系", "content": "林岚与周遥是旧识。" },
    { "category": "事件", "content": "末班车已经离站。", "confidence": "high" }
  ]
}
\`\`\``);
    assert.equal(items.length, 2);
    assert.equal(items[0].category, '人物关系');
    assert.equal(items[0].uncertain, true);
    assert.equal(items[0].uncertaintyNote, '正文没有说明相识年份。');
    assert.equal(items[0].accepted, false);
    assert.equal(items[1].category, '已发生事件');
    assert.deepEqual(LONG_DREAM_CANON_SUGGESTION_CATEGORIES, ['人物关系', '时间地点', '已发生事件', '不可违反事实']);
});

test('只有用户逐项采纳的 AI 建议会与手写定梦合并，未确认项不进入 canon', () => {
    const manual = '手写定梦：列车不能驶离环线。';
    const canon = composeLongDreamCanon(manual, [
        { category: '人物关系', content: '林岚与周遥是旧识。', accepted: true },
        { category: '时间地点', content: '故事发生在冬季。', accepted: false },
        { category: '不可违反事实', content: '列车不能驶离环线。', accepted: true },
    ]);
    assert.match(canon, /^手写定梦：列车不能驶离环线。/);
    assert.match(canon, /【逐项确认的 AI 定梦建议】/);
    assert.match(canon, /【人物关系】林岚与周遥是旧识。/);
    assert.doesNotMatch(canon, /故事发生在冬季/);
    assert.equal(canon.match(/列车不能驶离环线/g)?.length, 1);
    assert.equal(composeLongDreamCanon(manual, []), manual);
});

test('长梦以完整首章开卷，并默认隔离原世界书', () => {
    const now = new Date('2026-07-31T12:30:00.000Z');
    const record = createLongDreamRecord({
        title: '没有血缘的夏天',
        canon: '两人是一起长大的青梅竹马，不是兄妹。',
        worldBookNames: ['原作人物关系'],
        source: {
            kind: 'history',
            refId: 17,
            title: '夏日祭小剧场',
            instruction: '写一场夏日祭。',
            text: '灯火沿着河岸亮起来。',
            html: '<!doctype html><html><body><article>灯火沿着河岸亮起来。</article></body></html>',
            mode: 'html',
        },
        sourceConfig: {
            presetName: '长篇预设',
            selectedWorldBooks: ['原作人物关系'],
            readChatContext: true,
            contextRange: 20,
        },
        now,
    });

    assert.equal(record.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY);
    assert.deepEqual(record.inheritance.worldBookNames, []);
    assert.equal(record.sourceConfig.selectedWorldBooks[0], '原作人物关系');
    assert.equal(record.chapters.length, 1);
    assert.equal(record.chapters[0].html.includes('<article>'), true);
    assert.equal(record.chapters[0].text, '灯火沿着河岸亮起来。');
    assert.equal(record.createdAt, now.toISOString());
    assert.equal(latestLongDreamChapter(record)?.id, 'chapter-1');
});

test('长梦可明确沿用选中世界书，名称会去空和去重', () => {
    const record = createLongDreamRecord({
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['人物设定', ' 人物设定 ', '', '地点设定'],
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    assert.equal(record.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.SELECTED);
    assert.deepEqual(record.inheritance.worldBookNames, ['人物设定', '地点设定']);
});

test('世界书继承冻结实际内容且不保存无关字段', () => {
    const mutableEntry = {
        book: '人物设定', enabled: true, uid: 7, name: '关系', content: '两人曾是同班同学。',
        raw: { key: ['同学'], constant: true, apiKey: '不应进入快照' },
    };
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['人物设定'],
        entries: [mutableEntry, { book: '人物设定', enabled: false, content: '禁用条目' }],
    }, new Date('2026-07-31T12:45:00.000Z'));
    mutableEntry.content = '后来被修改的当前世界书';

    assert.equal(snapshot.capturedAt, '2026-07-31T12:45:00.000Z');
    assert.equal(snapshot.books[0].entries.length, 1);
    assert.equal(snapshot.books[0].entries[0].content, '两人曾是同班同学。');
    assert.deepEqual(snapshot.books[0].entries[0].keys, ['同学']);
    assert.equal('apiKey' in snapshot.books[0].entries[0], false);
});

test('重新定梦只修改世界线定义，不会改写已保存章节', () => {
    const record = createLongDreamRecord({
        title: '旧梦',
        canon: '原设定',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['旧世界书'],
        source: { text: '不能丢失的第一章', html: '<p>不能丢失的第一章</p>' },
        now: new Date('2026-07-31T12:00:00.000Z'),
    });
    const originalChapter = structuredClone(record.chapters[0]);
    const updated = updateLongDreamDefinition(record, {
        title: '新梦',
        canon: '两人是青梅竹马。',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY,
        worldBookNames: ['不应保留'],
    }, new Date('2026-07-31T13:00:00.000Z'));

    assert.equal(updated.title, '新梦');
    assert.equal(updated.canon, '两人是青梅竹马。');
    assert.deepEqual(updated.inheritance.worldBookNames, []);
    assert.deepEqual(updated.chapters[0], originalChapter);
    assert.equal(updated.updatedAt, '2026-07-31T13:00:00.000Z');
    assert.equal(updated.inheritance.snapshot, null);
});

test('只修改标题时会保留既有继承策略和冻结快照', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['地点'], entries: [{ book: '地点', content: '旧站台终年下雨。' }],
    });
    const record = createLongDreamRecord({
        title: '旧名', worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['地点'], worldBookSnapshot: snapshot, source: { text: '第一章', html: '<main>第一章</main>' },
    });
    const updated = updateLongDreamDefinition(record, { title: '新名' });
    assert.equal(updated.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.SELECTED);
    assert.deepEqual(updated.inheritance.worldBookNames, ['地点']);
    assert.equal(updated.inheritance.snapshot.books[0].entries[0].content, '旧站台终年下雨。');
});

test('损坏的空长梦不会进入存档，已有 HTML 长梦可以恢复', () => {
    assert.equal(normalizeLongDreamRecord({ title: '空卷', chapters: [] }), null);
    const restored = normalizeLongDreamRecord({
        id: 8,
        title: '旧存档',
        inheritance: { worldBookPolicy: 'unknown', worldBookNames: ['不应继承'] },
        chapters: [{ html: '<main>旧章</main>' }],
    });
    assert.equal(restored.id, 8);
    assert.equal(restored.chapters[0].html, '<main>旧章</main>');
    assert.equal(restored.inheritance.worldBookPolicy, LONG_DREAM_WORLD_BOOK_POLICY.BRANCH_ONLY);
    assert.deepEqual(restored.inheritance.worldBookNames, []);
});

test('旧版长梦迁移到当前 schema，并把草稿与正式章节分开', () => {
    const migrated = migrateLongDreamRecord({
        schemaVersion: 1,
        title: '旧梦',
        chapters: [{ html: '<main>第一章</main>' }],
        draft: { status: 'review', text: '第二章草稿', html: '<main>第二章草稿</main>' },
    });
    assert.equal(migrated.schemaVersion, LONG_DREAM_SCHEMA_VERSION);
    assert.equal(migrated.chapters.length, 1);
    assert.equal(migrated.draft.chapterNumber, 2);
    assert.equal(migrated.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(migrated.draft.targetChars, 3000);
});

test('长梦生成控制器先保存可恢复正文和待确认 HTML，再原子晋升正式章节', async () => {
    const record = createLongDreamRecord({
        title: '雨夜列车',
        canon: '列车不能驶离环线。',
        source: { text: '第一章正文。', html: '<main>第一章正文。</main>' },
    });
    const persisted = [];
    const stages = [];
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: async ({ userPrompt, onChunk }) => {
            assert.match(userPrompt, /第一章正文/);
            assert.doesNotMatch(userPrompt, /<main>/);
            onChunk('第二章第一段。');
            onChunk('第二章第一段。\n\n第二章第二段。');
            return { text: '第二章第一段。\n\n第二章第二段。', stopReason: 'stop' };
        },
        renderChapter: async ({ text }) => ({ html: `<article>${text}</article>`, mode: 'html' }),
        persistRecord: async next => {
            persisted.push(structuredClone(next));
            return next;
        },
        onState: ({ stage }) => stages.push(stage),
    });

    const generated = await controller.run({
        record,
        chapterTitle: '第二章',
        instruction: '让列车在旧站台短暂停靠。',
        targetChars: 2200,
    });

    assert.equal(generated.stage, LONG_DREAM_GENERATION_STAGE.REVIEW);
    assert.equal(generated.record.chapters.length, 1);
    assert.equal(generated.record.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(generated.record.draft.targetChars, 2200);
    assert.equal(generated.record.draft.text, '第二章第一段。\n\n第二章第二段。');
    assert.match(generated.record.draft.html, /<article>/);
    assert.ok(persisted.some(item => item.draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING));
    assert.deepEqual(stages, [
        LONG_DREAM_GENERATION_STAGE.WRITING,
        LONG_DREAM_GENERATION_STAGE.RENDERING,
        LONG_DREAM_GENERATION_STAGE.REVIEW,
    ]);

    const confirmed = await controller.confirm(generated.record);
    assert.equal(confirmed.chapters.length, 2);
    assert.equal(confirmed.chapters[1].title, '第二章');
    assert.match(confirmed.chapters[1].html, /第二章第二段/);
    assert.equal(confirmed.draft, null);
});

test('长梦正文、自动补写和最终排版沿用同一份生成线路快照', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    const apiRoute = Object.freeze({ mode: 'custom', protocol: 'openai', model: 'dream-model' });
    const seen = [];
    const controller = createLongDreamGenerationController({
        requestChapter: async ({ round, apiRoute: received }) => {
            seen.push({ stage: `round-${round}`, route: received });
            return { text: round === 1 ? '甲'.repeat(200) : '乙'.repeat(260) };
        },
        renderChapter: async ({ text, apiRoute: received }) => {
            seen.push({ stage: 'render', route: received });
            return `<main>${text}</main>`;
        },
    });

    await controller.run({
        record,
        apiRoute,
        targetChars: 500,
        autoContinue: true,
        maxRounds: 3,
    });

    assert.deepEqual(seen.map(item => item.stage), ['round-1', 'round-2', 'render']);
    assert.equal(seen.every(item => item.route === apiRoute), true);
});

test('长梦高频流片段只合并保存最新草稿，不排队写入每个中间版本', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    const persistedWritingTexts = [];
    const finalText = Array.from({ length: 30 }, (_, index) => `片段${index + 1}`).join('');
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: async ({ onChunk }) => {
            let cumulative = '';
            for (let index = 1; index <= 30; index++) {
                cumulative += `片段${index}`;
                onChunk(cumulative);
            }
            return { text: cumulative };
        },
        renderChapter: async ({ text }) => `<main>${text}</main>`,
        persistRecord: async next => {
            if (next.draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING
                && next.draft?.resumeStage === LONG_DREAM_DRAFT_RESUME_STAGE.WRITING
                && next.draft?.text) {
                persistedWritingTexts.push(next.draft.text);
            }
            await Promise.resolve();
            return next;
        },
    });

    const result = await controller.run({ record, autoContinue: false });
    assert.equal(result.record.draft.text, finalText);
    assert.equal(persistedWritingTexts.at(-1), finalText);
    assert.ok(persistedWritingTexts.length <= 2, `实际写入 ${persistedWritingTexts.length} 个流式中间版本`);
});

test('长梦连续生成并确认五章时只按顺序追加一次，不重复写入章节', async () => {
    let record = createLongDreamRecord({
        title: '五夜航线',
        source: { title: '第一章', text: '起航。', html: '<main>起航。</main>' },
    });
    let requestCount = 0;
    const controller = createLongDreamGenerationController({
        requestChapter: async ({ userPrompt }) => {
            requestCount++;
            if (requestCount > 1) assert.match(userPrompt, new RegExp(`新增第 ${requestCount} 章`));
            return { text: `新增第 ${requestCount + 1} 章。` };
        },
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });

    for (let chapterNumber = 2; chapterNumber <= 6; chapterNumber++) {
        const generated = await controller.run({
            record,
            chapterTitle: `第 ${chapterNumber} 章`,
            instruction: `继续第 ${chapterNumber} 夜。`,
            autoContinue: false,
        });
        record = await controller.confirm(generated.record);
        assert.equal(record.chapters.length, chapterNumber);
        assert.equal(record.draft, null);
    }

    assert.equal(requestCount, 5);
    assert.deepEqual(record.chapters.map(chapter => chapter.number), [1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(record.chapters.map(chapter => chapter.id)).size, 6);
});

test('长梦待确认章节最多保留三版，并只晋升用户选中的候选', async () => {
    const record = createLongDreamRecord({
        title: '三重月影',
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    let requestCount = 0;
    const controller = createLongDreamGenerationController({
        requestChapter: async () => ({ text: `第 ${++requestCount} 版正文。` }),
        renderChapter: async ({ text }) => ({ html: `<main>${text}</main>`, mode: 'html' }),
    });

    const first = await controller.run({ record, instruction: '继续追踪月影。' });
    const second = await controller.run({ record: first.record, appendCandidate: true });
    const third = await controller.run({ record: second.record, appendCandidate: true });

    assert.equal(LONG_DREAM_MAX_CANDIDATES, 3);
    assert.equal(third.record.draft.candidates.length, 3);
    assert.equal(third.record.draft.selectedCandidateIndex, 2);
    assert.equal(third.record.draft.text, '第 3 版正文。');
    assert.deepEqual(third.record.draft.candidates.map(candidate => candidate.text), [
        '第 1 版正文。',
        '第 2 版正文。',
        '第 3 版正文。',
    ]);
    await assert.rejects(
        controller.run({ record: third.record, appendCandidate: true }),
        /最多保留 3 版候选/,
    );
    assert.equal(requestCount, 3);

    const selected = selectLongDreamDraftCandidate(third.record, 0);
    assert.equal(selected.draft.selectedCandidateIndex, 0);
    assert.equal(selected.draft.text, '第 1 版正文。');
    const confirmed = await controller.confirm(selected);
    assert.equal(confirmed.chapters.length, 2);
    assert.equal(confirmed.chapters[1].text, '第 1 版正文。');
    assert.equal(confirmed.chapters[1].html, '<main>第 1 版正文。</main>');
    assert.equal(confirmed.draft, null);
});

test('生成下一版中途停止时保留旧候选，放弃本轮后可回到待确认状态', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    let requestCount = 0;
    let secondStarted;
    const started = new Promise(resolve => { secondStarted = resolve; });
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: ({ signal, onChunk }) => {
            requestCount++;
            if (requestCount === 1) return Promise.resolve({ text: '第一版完整正文。' });
            return new Promise((resolve, reject) => {
                onChunk('第二版只写到一半。');
                secondStarted();
                signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
        },
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });

    const first = await controller.run({ record });
    const running = controller.run({ record: first.record, appendCandidate: true });
    await started;
    controller.abort();
    await assert.rejects(running, error => {
        assert.equal(error.longDreamRecord.draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
        assert.equal(error.longDreamRecord.draft.text, '第二版只写到一半。');
        assert.equal(error.longDreamRecord.draft.candidates.length, 1);
        assert.equal(error.longDreamRecord.draft.candidates[0].text, '第一版完整正文。');
        const restored = discardLongDreamWritingAttempt(error.longDreamRecord);
        assert.equal(restored.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
        assert.equal(restored.draft.text, '第一版完整正文。');
        assert.equal(restored.draft.candidates.length, 1);
        return true;
    });
});

test('长梦正文不足目标时自动追加补写，达到九成后只排版一次', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    const requests = [];
    let renderCount = 0;
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: async ({ userPrompt, round, maxRounds, onChunk }) => {
            requests.push({ userPrompt, round, maxRounds });
            const text = round === 1 ? '甲'.repeat(200) : '乙'.repeat(260);
            onChunk(text);
            return { text, stopReason: 'stop' };
        },
        renderChapter: async ({ text }) => {
            renderCount++;
            return `<main>${text}</main>`;
        },
    });

    const result = await controller.run({
        record,
        targetChars: 500,
        autoContinue: true,
        maxRounds: 3,
    });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(item => [item.round, item.maxRounds]), [[1, 3], [2, 3]]);
    assert.doesNotMatch(requests[0].userPrompt, /本章可恢复草稿/);
    assert.match(requests[0].userPrompt, /不要为了提前结束而仓促总结或收束/);
    assert.match(requests[1].userPrompt, /本章可恢复草稿/);
    assert.match(requests[1].userPrompt, /本章已有约 200 字/);
    assert.equal(renderCount, 1);
    assert.equal(result.rounds, 2);
    assert.equal(result.actualChars, 460);
    assert.equal(result.targetCompletionChars, 450);
    assert.equal(result.completedBelowTarget, false);
    assert.equal(result.record.draft.text, `${'甲'.repeat(200)}\n\n${'乙'.repeat(260)}`);
});

test('长梦自动补写达到最大轮数后停止，并明确记录仍低于目标', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    let requestCount = 0;
    const controller = createLongDreamGenerationController({
        requestChapter: async () => ({ text: String(++requestCount).repeat(100) }),
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });

    const result = await controller.run({
        record,
        targetChars: 500,
        autoContinue: true,
        maxRounds: 2,
    });

    assert.equal(requestCount, 2);
    assert.equal(result.rounds, 2);
    assert.equal(result.actualChars, 200);
    assert.equal(result.completedBelowTarget, true);
});

test('长梦在第二轮补写中停止时保留首轮和当前流式草稿', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    let secondRoundStarted;
    const started = new Promise(resolve => { secondRoundStarted = resolve; });
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: ({ round, signal, onChunk }) => {
            if (round === 1) return Promise.resolve({ text: '甲'.repeat(200) });
            return new Promise((resolve, reject) => {
                onChunk('乙'.repeat(50));
                secondRoundStarted();
                signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
        },
        renderChapter: async () => assert.fail('停止后不应进入最终排版'),
    });

    const running = controller.run({ record, targetChars: 500, autoContinue: true, maxRounds: 3 });
    await started;
    assert.deepEqual(controller.active, {
        stage: LONG_DREAM_GENERATION_STAGE.WRITING,
        aborted: false,
        round: 2,
        maxRounds: 3,
    });
    assert.equal(controller.abort(), true);
    await assert.rejects(running, error => {
        assert.equal(error.name, 'AbortError');
        assert.equal(error.longDreamRecord.draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
        assert.equal(error.longDreamRecord.draft.text, `${'甲'.repeat(200)}\n\n${'乙'.repeat(50)}`);
        return true;
    });
});

test('长梦生成停止时保留 WRITING 草稿，不追加半章', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    let requestStarted;
    const started = new Promise(resolve => { requestStarted = resolve; });
    const stages = [];
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: ({ signal, onChunk }) => new Promise((resolve, reject) => {
            onChunk('只写完了一半。');
            requestStarted();
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
        renderChapter: async () => {
            assert.fail('停止后不应进入最终排版');
        },
        persistRecord: async next => next,
        onState: ({ stage }) => stages.push(stage),
    });

    const running = controller.run({ record, instruction: '继续调查失踪案。' });
    await started;
    assert.equal(controller.abort(), true);
    await assert.rejects(running, error => {
        assert.equal(error.name, 'AbortError');
        assert.equal(error.longDreamRecord.chapters.length, 1);
        assert.equal(error.longDreamRecord.draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
        assert.equal(error.longDreamRecord.draft.text, '只写完了一半。');
        return true;
    });
    assert.equal(stages.at(-1), LONG_DREAM_GENERATION_STAGE.STOPPED);
    assert.equal(controller.active, null);
});

test('长梦生成可以承接刷新前的 WRITING 草稿，并只拼接本次新增正文', async () => {
    const base = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    const writing = saveLongDreamDraft(base, {
        status: LONG_DREAM_DRAFT_STATUS.WRITING,
        title: '第二章',
        instruction: '继续追查。',
        targetChars: 4600,
        text: '已经写好的前半章。',
    });
    const controller = createLongDreamGenerationController({
        requestChapter: async ({ userPrompt }) => {
            assert.match(userPrompt, /本章可恢复草稿/);
            assert.match(userPrompt, /已经写好的前半章/);
            return { text: '这是本次新增的后半章。' };
        },
        renderChapter: async ({ text }) => {
            assert.equal(text, '已经写好的前半章。\n\n这是本次新增的后半章。');
            return `<main>${text}</main>`;
        },
    });

    const result = await controller.run({ record: writing });
    assert.equal(result.record.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(result.record.draft.targetChars, 4600);
    assert.equal(result.record.draft.text, '已经写好的前半章。\n\n这是本次新增的后半章。');
});

test('长梦最终排版失败时保留完整正文草稿，不追加正式章节', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    const stages = [];
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: async ({ onChunk }) => {
            onChunk('已经完成但尚未排版的第二章。');
            return { text: '已经完成但尚未排版的第二章。' };
        },
        renderChapter: async () => {
            throw new Error('模拟排版失败');
        },
        onState: ({ stage }) => stages.push(stage),
    });

    await assert.rejects(controller.run({ record }), error => {
        assert.match(error.message, /模拟排版失败/);
        assert.equal(error.longDreamRecord.chapters.length, 1);
        assert.equal(error.longDreamRecord.draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
        assert.equal(error.longDreamRecord.draft.resumeStage, LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING);
        assert.equal(error.longDreamRecord.draft.text, '已经完成但尚未排版的第二章。');
        return true;
    });
    assert.equal(stages.at(-1), LONG_DREAM_GENERATION_STAGE.ERROR);
});

test('长梦排版失败后的恢复只重试最终排版，不再次请求或重复正文', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    let requestCount = 0;
    let renderCount = 0;
    let renderPendingRecord;
    const controller = createLongDreamGenerationController({
        requestChapter: async () => {
            requestCount++;
            return { text: '正文已经完整写完。' };
        },
        renderChapter: async ({ text }) => {
            renderCount++;
            if (renderCount === 1) throw new Error('第一次排版失败');
            assert.equal(text, '正文已经完整写完。');
            return `<main>${text}</main>`;
        },
    });

    await assert.rejects(controller.run({ record, chapterTitle: '第二章' }), error => {
        renderPendingRecord = error.longDreamRecord;
        return true;
    });
    assert.equal(renderPendingRecord.draft.resumeStage, LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING);

    const retried = await controller.run({ record: renderPendingRecord });
    assert.equal(requestCount, 1);
    assert.equal(renderCount, 2);
    assert.equal(retried.rounds, 0);
    assert.equal(retried.record.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(retried.record.draft.text, '正文已经完整写完。');

    const confirmed = await controller.confirm(retried.record);
    assert.equal(confirmed.chapters.length, 2);
    assert.equal(confirmed.chapters[1].text, '正文已经完整写完。');
});

test('待确认长梦草稿不会被新一轮生成静默覆盖', async () => {
    const base = createLongDreamRecord({
        source: { text: '第一章。', html: '<main>第一章。</main>' },
    });
    const review = saveLongDreamDraft(base, {
        status: LONG_DREAM_DRAFT_STATUS.REVIEW,
        title: '第二章',
        text: '待确认正文。',
        html: '<main>待确认正文。</main>',
    });
    const controller = createLongDreamGenerationController({
        requestChapter: async () => assert.fail('存在待确认稿时不应发请求'),
        renderChapter: async () => assert.fail('存在待确认稿时不应排版'),
    });
    await assert.rejects(controller.run({ record: review }), /等待确认/);
});

test('长梦拥有独立入口、独立面板和 IndexedDB 长卷仓库', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(source, /data-tab="long-dream">长梦<\/div>/);
    assert.match(source, /data-panel="long-dream"/);
    assert.match(source, /indexedDB\.open\('st-theater', 2\)/);
    assert.match(source, /createObjectStore\('dreams', \{ keyPath: 'id', autoIncrement: true \}\)/);
    assert.match(source, /createLongDreamGenerationController/);
    assert.match(source, /#theater-dream-generate-next', generateNextLongDreamChapter/);
    assert.match(source, /id="theater-dream-stop-generation"/);
    assert.match(source, /id="theater-dream-confirm-chapter"/);
    assert.match(source, /id="theater-dream-review-fullscreen"/);
    assert.match(source, /id="theater-dream-regenerate-draft"/);
    assert.match(source, /data-dream-candidate-step="-1"/);
    assert.match(source, /data-dream-candidate-step="1"/);
    assert.match(source, /changeLongDreamDraftCandidate/);
    assert.match(source, /按原要求再生成一版/);
    assert.match(source, /LONG_DREAM_MAX_CANDIDATES/);
    assert.match(source, /longDreamComposerDrafts/);
    assert.match(source, /lastTheaterTab/);
    assert.match(source, /regenerateLongDreamDraft/);
    assert.match(source, /requestFinalRenderedHtml/);
    assert.match(source, /autoContinue: settings\.autoContinue !== false/);
    assert.match(source, /maxRounds: Math\.min\(10, Math\.max\(1, Number\(settings\.maxAutoRounds\) \|\| 3\)\)/);
    assert.match(source, /class="[^"]*theater-dream-next-options/);
    assert.match(source, /id="theater-dream-token-summary-value"/);
    assert.match(source, /id="theater-dream-refresh-world-book"/);
    assert.match(source, /class="[^"]*theater-dream-settings is-workspace/);
    assert.match(source, /旧记录中有一份指令，请核对/);
    assert.match(styles, /梦中页只保留一条主线：续写/);
    assert.match(styles, /\.theater-dream-candidate-switcher/);
    assert.match(styles, /\.theater-dream-review-head \{[^}]*grid-template-columns:/);
    assert.match(styles, /\.theater-dream-memory-current-state-readonly \{[^}]*text-align:\s*justify/);
});

test('定梦页只保留手写 canon，不再显示 AI 整理建议入口', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const creation = source.match(/function longDreamCreateHTML\(\) \{[\s\S]*?function longDreamGenerationStageText/)?.[0] || '';
    assert.match(creation, /id="theater-dream-canon"/);
    assert.doesNotMatch(creation, /longDreamCanonSuggestionHTML|theater-dream-canon-assist|AI 帮我整理/);
    assert.match(source, /composeLongDreamCanon\(/);
});

test('下一章请求读取整部长卷正文和梦脉，但不携带旧 HTML', () => {
    const record = createLongDreamRecord({
        title: '无月列车',
        canon: '列车每次停靠都会忘记一个名字。',
        source: { title: '第一章', text: '第一章正文。', html: '<article>第一章正文。</article>' },
    });
    record.chapters.push({
        id: 'chapter-2', number: 2, title: '第二章', instruction: '',
        text: '第二章正文。', html: '<style>旧样式</style><p>第二章正文。</p>', mode: 'html', createdAt: record.createdAt,
    });
    record.memory.cards = [{ title: '伏笔', content: '旧车票背面写着终点站。' }];
    const context = longDreamChapterContext(record);
    const payload = buildLongDreamChapterPayload({
        record,
        preset: '写作预设',
        instruction: '让守灯人说出真相。',
        chapterTitle: '第三章',
        targetChars: 2400,
    });

    assert.equal(context.chapterCount, 2);
    assert.match(payload.userPrompt, /第一章正文/);
    assert.match(payload.userPrompt, /第二章正文/);
    assert.match(payload.userPrompt, /旧车票背面写着终点站/);
    assert.match(payload.userPrompt, /列车每次停靠都会忘记一个名字/);
    assert.doesNotMatch(payload.userPrompt, /<article>|<style>|旧样式/);
    assert.match(payload.userPrompt, /只输出本章新增的纯正文/);
});

test('默认分支隔离不会让兄妹原作世界书回流进青梅竹马长梦', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['原作关系'], entries: [{ book: '原作关系', name: '关系', content: '两人是亲生兄妹。' }],
    });
    const record = createLongDreamRecord({
        canon: '两人没有血缘关系，是一起长大的青梅竹马。',
        source: { text: '第一章里两人一起参加夏日祭。', html: '<main>第一章里两人一起参加夏日祭。</main>' },
    });
    // 即使损坏或旧数据里残留快照，隔离策略也必须从请求层硬性挡住。
    record.inheritance.snapshot = snapshot;
    const payload = buildLongDreamChapterPayload({ record, instruction: '一起去看烟花。' });
    assert.match(payload.userPrompt, /没有血缘关系/);
    assert.doesNotMatch(payload.userPrompt, /亲生兄妹/);
    assert.equal(longDreamWorldBookContext(record), '');
});

test('只有明确沿用时才读取长卷内冻结的世界书内容', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['地点'], entries: [{ book: '地点', name: '旧站', content: '站台的钟永远停在零点。' }],
    });
    const record = createLongDreamRecord({
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['地点'], worldBookSnapshot: snapshot,
        source: { text: '第一章正文。', html: '<main>第一章正文。</main>' },
    });
    const payload = buildLongDreamChapterPayload({ record, instruction: '寻找坏掉的钟。' });
    assert.match(payload.userPrompt, /用户主动允许的冻结世界书快照/);
    assert.match(payload.userPrompt, /站台的钟永远停在零点/);
});

test('长梦续章按预设保留 system user assistant 顺序，并按冻结位置注入世界书', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['地点'],
        entries: [{
            book: '地点', uid: 7, name: '旧站', content: '站台的钟永远停在零点。',
            position: WORLD_INFO_POSITION.AT_DEPTH, depth: 0, order: 30, role: 'assistant', outletName: 'Lore',
        }],
    });
    const record = createLongDreamRecord({
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['地点'], worldBookSnapshot: snapshot,
        source: { text: '第一章正文。', html: '<main>第一章正文。</main>' },
    });
    const payload = buildLongDreamChapterPayload({
        record,
        instruction: '寻找坏掉的钟。',
        structuredPreset: true,
    });
    const messages = buildLongDreamChapterMessages({
        payload,
        presetEntries: [
            { id: 'sys', role: 'system', content: 'SYSTEM-PRESET' },
            { id: 'usr', role: 'user', content: 'USER-PRESET' },
            { id: 'ast', role: 'assistant', content: 'ASSISTANT-PRESET' },
            { id: 'chatHistory', role: 'system', content: '' },
        ],
    });

    assert.deepEqual(messages.slice(0, 3).map(message => message.role), ['system', 'user', 'assistant']);
    assert.deepEqual(messages.slice(0, 3).map(message => message.content), ['SYSTEM-PRESET', 'USER-PRESET', 'ASSISTANT-PRESET']);
    assert.equal(messages.some(message => message.source === 'long-dream' && message.sourceId === 'chapter-context'), true);
    assert.equal(messages.some(message => message.role === 'assistant' && message.content === '站台的钟永远停在零点。'), true);
    assert.doesNotMatch(payload.userPrompt, /站台的钟永远停在零点/);
    assert.deepEqual(longDreamWorldBookEntries(record).map(entry => [entry.position, entry.depth, entry.role, entry.outletName]), [
        [WORLD_INFO_POSITION.AT_DEPTH, 0, 'assistant', 'Lore'],
    ]);
});

test('长梦与普通生成共用 Char 和 User 身份插槽，定梦冲突时仍以长梦事实为准', () => {
    const record = createLongDreamRecord({
        canon: '在本梦中两人是没有血缘关系的侦探搭档。',
        source: { text: '第一章正文。', html: '<main>第一章正文。</main>' },
    });
    const payload = buildLongDreamChapterPayload({
        record,
        hasIdentityContext: true,
        protagonistAnchor: '故事的中心人物固定为 User「禾禾」与 Char「麓」。',
        structuredPreset: true,
    });
    const messages = buildLongDreamChapterMessages({
        payload,
        presetEntries: [
            { id: 'charDescription', role: 'system', content: '' },
            { id: 'charPersonality', role: 'system', content: '' },
            { id: 'personaDescription', role: 'system', content: '' },
            { id: 'chatHistory', role: 'system', content: '' },
        ],
        slots: {
            charDescription: '角色设定：旧世界线身份资料',
            charPersonality: '角色性格：沉静但护短',
            personaDescription: 'User人设：敏锐而直接',
        },
    });
    const text = messages.map(message => message.content).join('\n');
    assert.match(text, /旧世界线身份资料/);
    assert.match(text, /沉静但护短/);
    assert.match(text, /敏锐而直接/);
    assert.match(text, /人物继承规则/);
    assert.match(text, /以此梦设定和本卷已经发生的内容为准/);
    assert.match(text, /中心人物固定为 User「禾禾」与 Char「麓」/);
});

test('长梦同章第二轮保留首轮完整基础包，并附带当前章草稿续写', async () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['人物'],
        entries: [{ book: '人物', enabled: true, content: '麓不喜欢别人触碰旧怀表。' }],
    });
    const record = createLongDreamRecord({
        canon: '故事发生在冬季海港。',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['人物'],
        worldBookSnapshot: snapshot,
        source: { text: '第一章里两人在码头重逢。', html: '<main>第一章里两人在码头重逢。</main>' },
    });
    const requests = [];
    const controller = createLongDreamGenerationController({
        requestChapter: async request => {
            requests.push(request);
            return { text: requests.length === 1 ? '短开头。' : '后续正文。'.repeat(120) };
        },
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });
    await controller.run({
        record,
        targetChars: 500,
        autoContinue: true,
        maxRounds: 2,
        identitySlots: {
            charPersonality: '角色性格：沉静但护短',
            personaDescription: 'User人设：敏锐而直接',
        },
    });
    assert.equal(requests.length, 2);
    const first = requests[0].messages.map(message => message.content).join('\n');
    const second = requests[1].messages.map(message => message.content).join('\n');
    assert.match(first, /第一章里两人在码头重逢/);
    assert.match(second, /第一章里两人在码头重逢/);
    assert.match(second, /短开头/);
    assert.match(second, /沉静但护短/);
    assert.match(second, /敏锐而直接/);
    assert.match(second, /麓不喜欢别人触碰旧怀表/);
    assert.match(second, /故事发生在冬季海港/);
});

test('长梦生成控制器把预设后处理与结构化消息交给请求层', async () => {
    const record = createLongDreamRecord({
        source: { text: '第一章正文。', html: '<main>第一章正文。</main>' },
    });
    let captured;
    const controller = createLongDreamGenerationController({
        requestChapter: async request => {
            captured = request;
            return { text: '第二章正文。' };
        },
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });
    await controller.run({
        record,
        autoContinue: false,
        presetName: '结构预设',
        postProcessing: PROMPT_POST_PROCESSING.STRICT,
        squashSystemMessages: true,
        presetEntries: [
            { id: 'system-preset', role: 'system', content: '系统预设' },
            { id: 'assistant-preset', role: 'assistant', content: '助手预设' },
        ],
    });

    assert.equal(captured.presetName, '结构预设');
    assert.equal(captured.postProcessing, PROMPT_POST_PROCESSING.STRICT);
    assert.deepEqual(captured.messages.slice(0, 2).map(message => message.role), ['system', 'assistant']);
    assert.equal(captured.messages.some(message => message.source === 'long-dream'), true);
});

test('长梦按世界线关系解释用户勾选的冻结资料，并让定梦覆盖冲突原设', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['人物与地点'],
        entries: [{ book: '人物与地点', name: '成年设定', content: '成年后两人住在临海市。' }],
    });
    const record = createLongDreamRecord({
        canon: '当前是两人的童年时期。',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldLineRelation: LONG_DREAM_WORLD_LINE_RELATION.PREQUEL,
        worldBookNames: ['人物与地点'],
        worldBookSnapshot: snapshot,
        source: { text: '第一章写他们七岁时的暑假。', html: '<main>第一章写他们七岁时的暑假。</main>' },
    });
    const payload = buildLongDreamChapterPayload({ record, instruction: '去旧学校找老师。' });
    assert.equal(record.inheritance.worldLineRelation, LONG_DREAM_WORLD_LINE_RELATION.PREQUEL);
    assert.match(payload.systemPrompt, /前传补完/);
    assert.match(payload.systemPrompt, /本梦已经写出的变化优先/);
    assert.match(payload.userPrompt, /成年后两人住在临海市/);
});

test('梦脉织录按三章批量、只读已确认章节，并以补丁追加而不删除旧记忆', () => {
    let record = createLongDreamRecord({
        canon: '故事发生在旧港。',
        source: { text: '第一章正文。', html: '<main>第一章正文。</main>' },
    });
    record = appendLongDreamChapter(record, { text: '第二章正文。', html: '<main>第二章正文。</main>' });
    assert.equal(shouldWeaveLongDreamMemory(record, { batchSize: 3 }), false);
    record = appendLongDreamChapter(record, { text: '第三章正文。', html: '<main>第三章正文。</main>' });
    assert.deepEqual(pendingLongDreamChapters(record).map(chapter => chapter.number), [1, 2, 3]);
    assert.equal(shouldWeaveLongDreamMemory(record, { batchSize: 3 }), true);

    record.memory.cards = [{ type: '伏笔', content: '旧钥匙尚未使用。', chapterNumber: 1, status: 'active' }];
    const request = buildLongDreamMemoryPayload({ record });
    assert.deepEqual(request.pendingChapterNumbers, [1, 2, 3]);
    assert.match(request.systemPrompt, /梦脉增量织录/);
    assert.match(request.userPrompt, /固定 JSON 输出合同/);
    assert.match(request.userPrompt, /第一章正文/);
    assert.match(request.userPrompt, /第三章正文/);
    assert.match(request.userPrompt, /旧钥匙尚未使用/);

    const patch = parseLongDreamMemoryResponse(JSON.stringify({
        currentState: '两人目前位于旧港钟楼。',
        cards: [{ type: '地点/物品', content: '旧钥匙打开了钟楼侧门。', chapterNumber: 3, tags: ['旧钥匙', '钟楼'] }],
    }), { pendingChapterNumbers: request.pendingChapterNumbers });
    const updated = applyLongDreamMemoryPatch(record, patch, request.throughChapter);
    assert.equal(updated.memory.processedThroughChapter, 3);
    assert.deepEqual(updated.memory.pendingChapterNumbers, []);
    assert.equal(updated.memory.cards.some(card => card.content === '旧钥匙尚未使用。'), true);
    assert.equal(updated.memory.cards.some(card => card.content === '旧钥匙打开了钟楼侧门。'), true);
    assert.equal(updated.memory.currentState, '两人目前位于旧港钟楼。');
});

test('梦脉用 type + key 原位更新有效状态，并保留人工修改的用户主权', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<main>第二章。</main>' });
    record = applyLongDreamMemoryPatch(record, {
        cards: [{ type: '人物状态', key: '林岚/所在地点', content: '林岚在旧港。', chapterNumber: 1, sourceChapterNumbers: [1], tags: ['林岚', '旧港'] }],
    }, 1);
    record = applyLongDreamMemoryPatch(record, {
        cards: [{ type: '人物状态', key: '林岚/所在地点', content: '林岚已进入钟楼。', chapterNumber: 2, sourceChapterNumbers: [2], tags: ['林岚', '钟楼'] }],
    }, 2);
    assert.equal(record.memory.cards.length, 1);
    assert.equal(record.memory.cards[0].content, '林岚已进入钟楼。');
    assert.deepEqual(record.memory.cards[0].sourceChapterNumbers, [1, 2]);

    record = updateLongDreamMemoryCard(record, record.memory.cards[0].id, {
        content: '林岚正在钟楼顶层，而不是入口。', tags: ['林岚', '钟楼顶层'],
    });
    record = applyLongDreamMemoryPatch(record, {
        cards: [{ type: '人物状态', key: '林岚/所在地点', content: '林岚回到旧港。', chapterNumber: 2, sourceChapterNumbers: [2] }],
    }, 2);
    assert.equal(record.memory.cards[0].content, '林岚正在钟楼顶层，而不是入口。');
    assert.equal(record.memory.cards[0].editedByUser, true);

    record = setLongDreamMemoryCardStatus(record, record.memory.cards[0].id, 'dismissed');
    assert.equal(selectRelevantLongDreamMemoryCards(record, { instruction: '寻找林岚' }).length, 0);
    record = setLongDreamMemoryCardStatus(record, record.memory.cards[0].id, 'active');
    assert.equal(selectRelevantLongDreamMemoryCards(record, { instruction: '寻找林岚' }).length, 1);
});

test('梦脉 v2 按章节顺序应用状态增量，旧值进入历史且新值不继承旧来源', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<main>第二章。</main>' });
    record = appendLongDreamChapter(record, { text: '第三章。', html: '<main>第三章。</main>' });
    const patch = parseLongDreamMemoryResponse(JSON.stringify({
        currentState: '林岚已经进入钟楼顶层。',
        operations: [
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 },
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '钟楼顶层', chapterNumber: 3 },
        ],
    }), { pendingChapterNumbers: [1, 2, 3] });
    record = applyLongDreamMemoryPatch(record, patch, 3);
    assert.equal(record.memory.schemaVersion, 2);
    assert.equal(record.memory.states.length, 1);
    assert.equal(record.memory.states[0].value, '钟楼顶层');
    assert.equal(record.memory.states[0].validFromChapter, 3);
    assert.deepEqual(record.memory.states[0].sourceChapterNumbers, [3]);
    assert.deepEqual(record.memory.states[0].history.map(item => item.value), ['旧港入口']);
    assert.deepEqual(record.memory.states[0].history[0].sourceChapterNumbers, [1]);
    assert.equal(record.memory.currentState, '林岚已经进入钟楼顶层。');
});

test('梦脉 v2 未完事项保存推进历史、解决结果，并阻止已关闭事项静默重开', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    for (let number = 2; number <= 4; number++) record = appendLongDreamChapter(record, { text: `第${number}章。`, html: `<main>第${number}章。</main>` });
    record = applyLongDreamMemoryPatch(record, {
        currentState: '两人仍在调查。',
        operations: [
            { op: 'open_thread', threadKey: '失踪列车记录', kind: 'mystery', content: '寻找失踪列车记录', chapterNumber: 1 },
            { op: 'advance_thread', threadKey: '失踪列车记录', progress: '发现列车编号', chapterNumber: 2 },
            { op: 'resolve_thread', threadKey: '失踪列车记录', resolution: '在钟楼暗门后找到完整记录', chapterNumber: 3 },
        ],
    }, 3);
    assert.equal(record.memory.threads.length, 1);
    assert.equal(record.memory.threads[0].status, 'resolved');
    assert.equal(record.memory.threads[0].resolution, '在钟楼暗门后找到完整记录');
    assert.deepEqual(record.memory.threads[0].progressHistory.map(item => item.content), ['发现列车编号']);
    record = applyLongDreamMemoryPatch(record, {
        currentState: '这段摘要不应覆盖。',
        operations: [{ op: 'open_thread', threadKey: '失踪列车记录', kind: 'mystery', content: '重新寻找记录', chapterNumber: 4 }],
    }, 4);
    assert.equal(record.memory.threads.length, 1);
    assert.equal(record.memory.pendingConflicts.length, 1);
    assert.equal(record.memory.currentState, '两人仍在调查。');
});

test('用户锁定状态产生持久冲突，用户可选择采用新变化或保留原记忆', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章。', html: '<main>第二章。</main>' });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 }],
    }, 1);
    record = updateLongDreamMemoryV2RecordItem(record, 'state', record.memory.states[0].id, { value: '旧港钟楼入口' });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', targetId: record.memory.states[0].id, subjects: ['林岚'], attribute: 'location', value: '钟楼顶层', chapterNumber: 2 }],
    }, 2);
    assert.equal(record.memory.states[0].value, '旧港钟楼入口');
    assert.equal(record.memory.pendingConflicts[0].reason, 'locked-by-user');

    const accepted = resolveLongDreamMemoryV2RecordConflict(record, record.memory.pendingConflicts[0].id, 'accept');
    assert.equal(accepted.memory.states[0].value, '钟楼顶层');
    assert.equal(accepted.memory.pendingConflicts.length, 0);

    const conflictAgain = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', targetId: record.memory.states[0].id, subjects: ['林岚'], attribute: 'location', value: '钟楼顶层', chapterNumber: 2 }],
    }, 2);
    const kept = resolveLongDreamMemoryV2RecordConflict(conflictAgain, conflictAgain.memory.pendingConflicts[0].id, 'keep');
    assert.equal(kept.memory.states[0].value, '旧港钟楼入口');
    assert.equal(kept.memory.rejections.length, 1);
});

test('用户否定的错误梦脉不会被同一增量直接复活', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 }],
    }, 1);
    record = rejectLongDreamMemoryV2RecordItem(record, 'state', record.memory.states[0].id, '章节没有写过这件事');
    assert.equal(record.memory.states.length, 0);
    assert.equal(record.memory.rejections.length, 1);
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港入口', chapterNumber: 1 }],
    }, 1);
    assert.equal(record.memory.states.length, 0);
    assert.equal(record.memory.pendingConflicts[0].reason, 'rejected-by-user');
});

test('完全隔离的长梦拒绝世界线偏离操作，但仍应用同批合法状态', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = applyLongDreamMemoryPatch(record, {
        operations: [
            { op: 'upsert_deviation', deviationKey: '人物关系', dreamChange: '两人不是兄妹', chapterNumber: 1 },
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港', chapterNumber: 1 },
        ],
    }, 1);
    assert.equal(record.memory.deviations.length, 0);
    assert.equal(record.memory.states.length, 1);
});

test('梦脉 v2 主 API 检索按层选择，不让所有记忆继续争同一类卡片排名', () => {
    let record = createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } });
    record = applyLongDreamMemoryPatch(record, {
        currentState: '林岚在旧港等待退潮。',
        operations: [
            { op: 'set_state', subjects: ['林岚'], attribute: 'location', value: '旧港钟楼', chapterNumber: 1, tags: ['林岚', '旧港'] },
            { op: 'append_transition', domain: 'relationship', subjects: ['林岚', '周砚'], from: '互相试探', to: '共同承担风险', cause: '周砚坦白身份', chapterNumber: 1 },
            { op: 'open_thread', threadKey: '退潮暗门', kind: 'mystery', content: '等待退潮后开启暗门', chapterNumber: 1, tags: ['暗门'] },
        ],
    }, 1);
    record = updateLongDreamDefinition(record, {
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldLineRelation: LONG_DREAM_WORLD_LINE_RELATION.PARALLEL,
    });
    record = applyLongDreamMemoryPatch(record, {
        operations: [{ op: 'upsert_deviation', deviationKey: '林岚与周砚/关系', subjects: ['林岚', '周砚'], originalCanon: '原线是兄妹', dreamChange: '本梦没有血缘关系', chapterNumber: 1 }],
    }, 1);
    const selected = selectRelevantLongDreamMemoryItems(record, { instruction: '林岚和周砚去打开退潮暗门。' });
    assert.deepEqual(new Set(selected.map(item => item.kind)), new Set(['state', 'thread', 'deviation', 'transition']));
    const context = longDreamChapterContext(record, { instruction: '林岚和周砚去打开退潮暗门。' });
    assert.match(context.memory, /当前脉象：林岚在旧港等待退潮/);
    assert.match(context.memory, /当前状态|关键变化|事项|世界线偏离/);
});

test('旧版梦脉保守迁移稳定状态，原卡片和 v2 备份字段都不会丢失', () => {
    const record = normalizeLongDreamRecord({
        title: '旧卷',
        chapters: [{ text: '第一章。', html: '<main>第一章。</main>' }],
        memory: {
            cards: [{ id: 'old-state', type: '人物状态', key: '林岚/所在地点', content: '林岚位于旧港。', chapterNumber: 1, editedByUser: true }],
            currentState: '旧版人工脉象。',
        },
    });
    assert.equal(record.memory.cards.length, 1);
    assert.equal(record.memory.states.length, 1);
    assert.equal(record.memory.states[0].attribute, 'location');
    assert.equal(record.memory.states[0].lockedByUser, true);
    const imported = parseLongDreamBackup(createLongDreamBackup([record]));
    assert.equal(imported[0].memory.cards[0].content, '林岚位于旧港。');
    assert.equal(imported[0].memory.states[0].value, '林岚位于旧港。');
    assert.equal(imported[0].memory.currentState, '旧版人工脉象。');
});

test('梦脉二创 JSON 只能携带分析侧重点，输出合同固定且未知配置被忽略', () => {
    const preset = parseLongDreamMemoryPreset(JSON.stringify({
        format: 'st-theater-long-dream-memory-preset',
        version: 2,
        name: '人物弧光版',
        author: '小澄',
        focusPrompt: '优先识别人物长期变化。',
        outputContract: LONG_DREAM_MEMORY_OUTPUT_CONTRACT,
        apiKey: '不应保留',
        executable: '<script>bad()</script>',
    }));
    const exported = exportLongDreamMemoryPreset(preset);
    assert.equal(exported.focusPrompt, '优先识别人物长期变化。');
    assert.equal(exported.outputContract, 'long-dream-memory-v2');
    assert.equal('apiKey' in exported, false);
    assert.equal('executable' in exported, false);
});

test('长卷续章只带最近两章全文，并从旧章梦脉中检索本章相关事实', () => {
    let record = createLongDreamRecord({ source: { text: '第1章完整正文。', html: '<main>第1章完整正文。</main>' } });
    for (let number = 2; number <= 10; number++) {
        record = appendLongDreamChapter(record, {
            title: `第${number}章`, instruction: `方向${number}`,
            text: `第${number}章完整正文。${'内容'.repeat(40)}`,
            html: `<main>第${number}章完整正文。</main>`,
        });
    }
    record.memory.cards = Array.from({ length: 40 }, (_, index) => ({
        id: `memory-${index + 1}`,
        type: index === 0 ? '伏笔/约定' : '事实',
        key: index === 0 ? '银钥匙/去向' : '',
        content: index === 0 ? '银钥匙藏在第一章的旧车票里。' : `普通旧事实 ${index + 1}`,
        chapterNumber: (index % 6) + 1,
        sourceChapterNumbers: [(index % 6) + 1],
        status: 'active',
        tags: index === 0 ? ['银钥匙'] : [`标签${index + 1}`],
    }));
    const context = longDreamChapterContext(record, { instruction: '让林岚取出银钥匙。' });
    assert.equal(LONG_DREAM_RECENT_CHAPTER_COUNT, 2);
    assert.equal(context.recentChapterCount, 2);
    assert.equal(context.olderChapterCount, 8);
    assert.match(context.chapters, /第 9 章/);
    assert.match(context.chapters, /第 10 章/);
    assert.doesNotMatch(context.chapters, /第 8 章/);
    assert.match(context.olderOutline, /第 1 章/);
    assert.match(context.memory, /银钥匙藏在第一章的旧车票里/);
    assert.ok(context.selectedMemoryCount <= 30);
    const payload = buildLongDreamChapterPayload({ record, instruction: '让林岚取出银钥匙。' });
    assert.match(payload.userPrompt, /近期已保存章节｜最近 2 章全文/);
    assert.match(payload.userPrompt, /较早章节压缩索引｜8 章/);
});

test('超长连载的旧章索引有固定上限，同时保留第一章和最近旧章', () => {
    let record = createLongDreamRecord({ source: { text: '第一章'.repeat(80), html: '<main>第一章</main>' } });
    for (let number = 2; number <= 80; number++) {
        record = appendLongDreamChapter(record, {
            title: `第 ${number} 章`, instruction: `方向 ${number}`,
            text: `第 ${number} 章正文${'潮声与旧站'.repeat(60)}`,
            html: `<main>第 ${number} 章正文</main>`,
        });
    }
    const context = longDreamChapterContext(record, { maxOlderOutlineChars: 1000 });
    assert.ok(context.olderOutline.length <= 1000);
    assert.match(context.olderOutline, /第 1 章/);
    assert.match(context.olderOutline, /索引已压缩/);
    assert.match(context.olderOutline, /第 76 章/);
    assert.match(context.chapters, /第 79 章/);
    assert.match(context.chapters, /第 80 章/);
});

test('刷新或关页打断梦脉请求后会恢复为待织录，不会永久卡在后台处理中', () => {
    let record = createLongDreamRecord({ source: { text: '第一章正文。', html: '<main>第一章正文。</main>' } });
    record = setLongDreamMemoryStatus(record, LONG_DREAM_MEMORY_STATUS.WEAVING);
    assert.equal(record.memory.status, LONG_DREAM_MEMORY_STATUS.WEAVING);
    const recovered = recoverInterruptedLongDreamMemory(record);
    assert.equal(recovered.memory.status, LONG_DREAM_MEMORY_STATUS.PENDING);
    assert.deepEqual(recovered.memory.pendingChapterNumbers, [1]);
});

test('长梦上下文参考线只提示风险，不会静默裁剪基础资料', () => {
    const canon = '不可删减的定梦：两人没有血缘关系。';
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['原作'], entries: [{ book: '原作', content: '低优先级世界书内容。' }],
    });
    const record = createLongDreamRecord({
        canon,
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['原作'], worldBookSnapshot: snapshot,
        source: { text: '很长的第一章正文。'.repeat(30), html: `<main>${'很长的第一章正文。'.repeat(30)}</main>` },
    });
    const payload = buildLongDreamChapterPayload({
        record,
        instruction: '不可删减的本章方向：在雨里坦白。',
        preset: '低优先级风格规则。',
        maxOptionalContextChars: 50,
    });
    assert.match(payload.userPrompt, new RegExp(canon));
    assert.match(payload.userPrompt, /不可删减的本章方向：在雨里坦白/);
    assert.deepEqual(payload.budget.truncated, []);
    assert.deepEqual(payload.budget.omitted, []);
    assert.equal(payload.budget.level, 'over');
    assert.match(payload.userPrompt, /低优先级世界书内容/);
    assert.match(payload.systemPrompt, /低优先级风格规则/);
});

test('长梦请求只注入已确认梦脉', () => {
    const record = createLongDreamRecord({ source: { text: '第一章正文。', html: '<main>第一章正文。</main>' } });
    record.memory.cards = [
        { status: 'confirmed', type: '伏笔', content: '钥匙藏在花盆下。' },
        { status: 'pending', type: '猜测', content: '管家也许是凶手。' },
        { status: 'deprecated', type: '废止', content: '错误记忆。' },
    ];
    const payload = buildLongDreamChapterPayload({ record });
    assert.match(payload.userPrompt, /钥匙藏在花盆下/);
    assert.doesNotMatch(payload.userPrompt, /管家也许是凶手|错误记忆/);
});

test('下一章请求可以从仅有 HTML 的旧章节恢复可读前情', () => {
    const record = normalizeLongDreamRecord({
        title: '旧卷',
        chapters: [{ title: '旧章', html: '<style>.x{color:red}</style><article>灯火&nbsp;未眠</article>' }],
    });
    const payload = buildLongDreamChapterPayload({ record, instruction: '继续' });
    assert.match(payload.userPrompt, /灯火 未眠/);
    assert.doesNotMatch(payload.userPrompt, /color:red|<article>/);
});

test('long dream prose cleans unexpected HTML from text and retains both ends of a long recovery draft', () => {
    let record = createLongDreamRecord({
        source: { text: '<style>.bad{}</style><p>first <b>prose</b></p><script>bad()</script>', html: '<main>fallback prose</main>' },
    });
    record = appendLongDreamChapter(record, { title: 'chapter two', text: 'second chapter prose', html: '<main>second chapter prose</main>' });
    const draft = `<p>DRAFT-HEAD-${'middle '.repeat(3000)}-DRAFT-TAIL</p><style>.draft{}</style>`;
    const payload = buildLongDreamChapterPayload({ record, currentDraft: draft, continuationRound: true, maxOptionalContextChars: 100 });
    assert.match(payload.userPrompt, /first prose/);
    assert.doesNotMatch(payload.userPrompt, /<style>|<script>|\.bad/);
    assert.match(payload.userPrompt, /DRAFT-HEAD-/);
    assert.match(payload.userPrompt, /-DRAFT-TAIL/);
    assert.doesNotMatch(payload.userPrompt, /<p>|\.draft/);
    assert.match(payload.userPrompt, /second chapter prose/);
    assert.equal(payload.budget.level, 'over');
});

test('continuation payload retains two recent chapters, older index, memory, world book, and identity structure', () => {
    const snapshot = createLongDreamWorldBookSnapshot({ bookNames: ['archive'], entries: [{ book: 'archive', content: 'frozen world fact' }] });
    let record = createLongDreamRecord({
        canon: 'dream canon fact', worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED, worldBookNames: ['archive'], worldBookSnapshot: snapshot,
        source: { text: 'chapter one older fact', html: '<main>chapter one older fact</main>' },
    });
    record = appendLongDreamChapter(record, { title: 'two', text: 'chapter two full text', html: '<main>chapter two full text</main>' });
    record = appendLongDreamChapter(record, { title: 'three', text: 'chapter three full text', html: '<main>chapter three full text</main>' });
    record.memory.cards = [{ status: 'confirmed', type: 'fact', content: 'memory fact', sourceChapterNumbers: [1] }];
    const payload = buildLongDreamChapterPayload({ record, instruction: 'continue safely', currentDraft: 'RECOVERY-DRAFT', continuationRound: true, structuredPreset: true });
    const messages = buildLongDreamChapterMessages({
        payload,
        presetEntries: [{ id: 'charDescription', role: 'system', content: '' }, { id: 'personaDescription', role: 'system', content: '' }],
        slots: { charDescription: 'char description', personaDescription: 'user persona' },
    });
    const text = messages.map(message => message.content).join('\n');
    for (const expected of ['chapter one older fact', 'chapter two full text', 'chapter three full text', 'memory fact', 'frozen world fact', 'RECOVERY-DRAFT', 'dream canon fact', 'char description', 'user persona']) assert.match(text, new RegExp(expected));
    assert.equal(payload.context.recentChapterCount, 2);
    assert.equal(payload.context.olderChapterCount, 1);
});

test('追加下一章保留旧章并生成稳定的章号', () => {
    const record = createLongDreamRecord({ source: { text: '第一章正文', html: '<main>第一章正文</main>' } });
    const updated = appendLongDreamChapter(record, {
        title: '潮汐站台', instruction: '推进列车谜团', text: '第二章正文', html: '<main>第二章正文</main>', mode: 'html',
    }, new Date('2026-07-31T14:00:00.000Z'));

    assert.equal(updated.chapters.length, 2);
    assert.equal(updated.chapters[0].text, '第一章正文');
    assert.equal(updated.chapters[1].id, 'chapter-2');
    assert.equal(updated.chapters[1].number, 2);
    assert.equal(updated.chapters[1].title, '潮汐站台');
    assert.equal(updated.updatedAt, '2026-07-31T14:00:00.000Z');
});

test('正式章节必须同时具备纯正文和最终 HTML，失败不改旧卷', () => {
    assert.throws(() => createLongDreamRecord({ source: { text: '只有正文的第一章' } }), /第一章必须同时包含/);
    assert.throws(() => createLongDreamRecord({ source: { html: '<main>只有 HTML 的第一章</main>' } }), /第一章必须同时包含/);
    const record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    const original = structuredClone(record);
    assert.throws(() => appendLongDreamChapter(record, { text: '只有正文' }), /同时包含纯正文与最终 HTML/);
    assert.throws(() => appendLongDreamChapter(record, { html: '<main>只有 HTML</main>' }), /同时包含纯正文与最终 HTML/);
    assert.deepEqual(record, original);
});

test('章节更新和截断只影响明确范围，并清理失效草稿', () => {
    let record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章', html: '<main>第二章</main>' });
    record = appendLongDreamChapter(record, { text: '第三章', html: '<main>第三章</main>' });
    const updated = updateLongDreamChapter(record, 'chapter-2', {
        title: '改写后的第二章', text: '新第二章', html: '<main>新第二章</main>',
    });
    const withDraft = saveLongDreamDraft(updated, { instruction: '第四章方向', text: '未完成草稿' });
    const truncated = truncateLongDreamAfter(withDraft, 'chapter-2');

    assert.equal(updated.chapters[0].text, '第一章');
    assert.equal(updated.chapters[1].text, '新第二章');
    assert.equal(updated.chapters[2].text, '第三章');
    assert.deepEqual(record.chapters[1].text, '第二章');
    assert.equal(truncated.chapters.length, 2);
    assert.equal(truncated.draft, null);
    assert.equal(truncated.status, LONG_DREAM_STATUS.ACTIVE);
    assert.equal(truncated.memory.cards.length, 0);
    assert.equal(truncated.memory.currentState, '');
    assert.equal(truncated.memory.processedThroughChapter, 0);
    assert.deepEqual(truncated.memory.pendingChapterNumbers, [1, 2]);
});

test('编辑正式章节会保留既有梦脉并从修改章起重新织录，仅改标题不触发重算', () => {
    let record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章', html: '<main>第二章</main>' });
    record = appendLongDreamChapter(record, { text: '第三章', html: '<main>第三章</main>' });
    record.memory = {
        ...record.memory,
        cards: [{ id: 'kept-memory', type: '事实', content: '保留的用户梦脉', status: 'active', sourceChapterNumbers: [1] }],
        processedThroughChapter: 3,
        pendingChapterNumbers: [],
        status: LONG_DREAM_MEMORY_STATUS.READY,
    };

    const renamed = updateLongDreamChapter(record, 'chapter-2', { title: '只改标题' });
    assert.equal(renamed.memory.processedThroughChapter, 3);
    assert.deepEqual(renamed.memory.pendingChapterNumbers, []);

    const rewritten = updateLongDreamChapter(renamed, 'chapter-2', {
        text: '修改后的第二章',
        html: '<main>修改后的第二章</main>',
    });
    assert.equal(rewritten.memory.cards[0].id, 'kept-memory');
    assert.equal(rewritten.memory.processedThroughChapter, 1);
    assert.deepEqual(rewritten.memory.pendingChapterNumbers, [2, 3]);
    assert.equal(rewritten.memory.status, LONG_DREAM_MEMORY_STATUS.PENDING);

    let notYetWoven = createLongDreamRecord({ source: { text: '首章', html: '<main>首章</main>' } });
    notYetWoven = appendLongDreamChapter(notYetWoven, { text: '次章', html: '<main>次章</main>' });
    const editedBeforeFirstWeave = updateLongDreamChapter(notYetWoven, 'chapter-2', {
        text: '编辑后的次章', html: '<main>编辑后的次章</main>',
    });
    assert.deepEqual(editedBeforeFirstWeave.memory.pendingChapterNumbers, [1, 2]);
});

test('重新生成整部梦脉会清理自动结果并保留人工校正、隐藏与否定记录', () => {
    let record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    record = appendLongDreamChapter(record, { text: '第二章', html: '<main>第二章</main>' });
    record.memory = {
        ...record.memory,
        schemaVersion: LONG_DREAM_SCHEMA_VERSION,
        processedThroughChapter: 2,
        pendingChapterNumbers: [],
        status: LONG_DREAM_MEMORY_STATUS.READY,
        currentState: '旧的自动摘要',
        states: [
            { id: 'auto-state', subjects: ['林岚'], attribute: 'location', value: '旧站', validFromChapter: 1 },
            { id: 'locked-state', subjects: ['林岚'], attribute: 'location', value: '港口', validFromChapter: 2, lockedByUser: true, editedByUser: true },
            { id: 'hidden-state', subjects: ['周遥'], attribute: 'goal', value: '离开', validFromChapter: 2, hiddenFromPrompt: true },
        ],
        cards: [
            { id: 'auto-card', type: '事实', content: '自动旧记录', chapterNumber: 1, status: 'active' },
            { id: 'edited-card', type: '事实', content: '手动修正记录', chapterNumber: 2, status: 'active', editedByUser: true },
            { id: 'dismissed-card', type: '事实', content: '已经否定的记录', chapterNumber: 1, status: 'dismissed' },
        ],
        rejections: [{ id: 'rejection-1', kind: 'state', signature: '错误地点', reason: '用户否定' }],
    };

    const regenerated = prepareLongDreamMemoryRegeneration(record, new Date('2026-08-12T08:00:00.000Z'));
    assert.equal(regenerated.memory.currentState, '');
    assert.equal(regenerated.memory.processedThroughChapter, 0);
    assert.deepEqual(regenerated.memory.pendingChapterNumbers, [1, 2]);
    assert.equal(regenerated.memory.status, LONG_DREAM_MEMORY_STATUS.PENDING);
    assert.deepEqual(regenerated.memory.states.map(item => item.id).sort(), ['hidden-state', 'locked-state']);
    assert.deepEqual(regenerated.memory.cards.map(item => item.id).sort(), ['dismissed-card', 'edited-card']);
    assert.equal(regenerated.memory.rejections[0].signature, '错误地点');
});

test('旧章分支、重写与删除都保留原卷，并让新时间线重新织录梦脉', () => {
    let original = createLongDreamRecord({
        title: '原卷',
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    original = appendLongDreamChapter(original, { text: '第二章', html: '<main>第二章</main>' });
    original = appendLongDreamChapter(original, { title: '岔路', instruction: '进入北门', text: '第三章', html: '<main>第三章</main>' });
    original = appendLongDreamChapter(original, { text: '第四章', html: '<main>第四章</main>' });
    original.id = 42;
    original.memory.cards = [{ id: 'old-memory', type: '事实', content: '旧时间线事实', chapterNumber: 3, status: 'active' }];
    original.memory.currentState = '旧时间线现状';

    const branch = createLongDreamBranch(original, 'chapter-3', {
        includeChapter: true,
        title: '北门支线',
    }, new Date('2026-08-08T01:00:00.000Z'));
    const rewrite = createLongDreamBranch(original, 'chapter-3', {
        includeChapter: false,
        title: '重写第三章',
    }, new Date('2026-08-08T02:00:00.000Z'));
    const deleted = deleteLongDreamFrom(original, 'chapter-3');

    assert.equal(original.chapters.length, 4);
    assert.equal(original.memory.cards.length, 1);
    assert.equal(branch.id, undefined);
    assert.equal(branch.title, '北门支线');
    assert.equal(branch.source.kind, 'long-dream-branch');
    assert.equal(branch.source.refId, 42);
    assert.equal(branch.chapters.length, 3);
    assert.equal(branch.memory.cards.length, 0);
    assert.deepEqual(branch.memory.pendingChapterNumbers, [1, 2, 3]);
    assert.equal(rewrite.chapters.length, 2);
    assert.deepEqual(rewrite.memory.pendingChapterNumbers, [1, 2]);
    assert.equal(deleted.chapters.length, 2);
    assert.equal(deleted.memory.cards.length, 0);
    assert.throws(() => deleteLongDreamFrom(original, 'chapter-1'), /第一章不能单独删除/);
});

test('草稿刷新恢复后仍不能冒充正式章节，确认后才原子晋升', () => {
    const record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    const writing = saveLongDreamDraft(record, {
        status: LONG_DREAM_DRAFT_STATUS.WRITING,
        title: '第二章', instruction: '进入森林', text: '生成到一半', html: '',
    }, new Date('2026-07-31T14:10:00.000Z'));
    const restored = normalizeLongDreamRecord(structuredClone(writing));
    assert.equal(restored.chapters.length, 1);
    assert.equal(restored.draft.text, '生成到一半');
    assert.throws(() => promoteLongDreamDraft(restored), /尚未进入确认保存状态/);

    const review = saveLongDreamDraft(restored, {
        status: LONG_DREAM_DRAFT_STATUS.REVIEW,
        title: '第二章', instruction: '进入森林',
        text: '完整第二章', html: '<main>完整第二章</main>', mode: 'html',
    });
    const promoted = promoteLongDreamDraft(review, new Date('2026-07-31T14:20:00.000Z'));
    assert.equal(promoted.chapters.length, 2);
    assert.equal(promoted.chapters[0].text, '第一章');
    assert.equal(promoted.chapters[1].text, '完整第二章');
    assert.equal(promoted.draft, null);
    assert.equal(review.chapters.length, 1);
    assert.equal(clearLongDreamDraft(review).draft, null);
});

test('长梦可以完卷，也可在继续施工时恢复为进行中', () => {
    const record = createLongDreamRecord({ source: { text: '第一章', html: '<main>第一章</main>' } });
    const completed = setLongDreamStatus(record, LONG_DREAM_STATUS.COMPLETE);
    const reopened = setLongDreamStatus(completed, LONG_DREAM_STATUS.ACTIVE);
    assert.equal(completed.status, LONG_DREAM_STATUS.COMPLETE);
    assert.equal(reopened.status, LONG_DREAM_STATUS.ACTIVE);
});

test('长梦备份以白名单导出，导入会保留章节但不携带本地 ID 或未知字段', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['地点'],
        entries: [{ book: '地点', uid: 7, content: '旧站台终年下雨。', raw: { key: ['站台'] } }],
    });
    let record = createLongDreamRecord({
        title: '雨夜列车',
        canon: '列车不能驶离环线。',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['地点'],
        worldBookSnapshot: snapshot,
        source: { kind: 'history', refId: 12, title: '初章', instruction: '从雨夜站台开始。', text: '第一章正文', html: '<main>第一章正文</main>' },
    });
    record = appendLongDreamChapter(record, { title: '旧月台', instruction: '让列车短暂停靠。', text: '第二章正文', html: '<main>第二章正文</main>' });
    record.id = 88;
    record.untrusted = { apiKey: 'never-export-this' };
    record.source.refId = { apiKey: 'not-a-reference' };
    record.sourceConfig.apiKey = 'also-never-export-this';
    record.inheritance.snapshot.books[0].entries[0].uid = { token: 'not-an-id' };
    record.chapters[0].unknown = 'not-exported';

    const backup = createLongDreamBackup([record], { now: new Date('2026-08-04T12:00:00.000Z') });
    const serialized = JSON.stringify(backup);
    const imported = parseLongDreamBackup(JSON.parse(serialized));

    assert.equal(backup.format, LONG_DREAM_BACKUP_FORMAT);
    assert.equal(backup.version, LONG_DREAM_BACKUP_VERSION);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].id, undefined);
    assert.equal(imported[0].chapters.length, 2);
    assert.equal(imported[0].chapters[1].title, '旧月台');
    assert.equal(imported[0].chapters[1].html, '<main>第二章正文</main>');
    assert.equal(imported[0].source.refId, null);
    assert.equal(imported[0].inheritance.snapshot.books[0].entries[0].uid, null);
    assert.equal('untrusted' in imported[0], false);
    assert.equal('unknown' in imported[0].chapters[0], false);
    assert.doesNotMatch(serialized, /never-export-this|not-a-reference|also-never-export-this|not-an-id/);
});

test('长梦 ZIP 清单把大正文拆为独立文件，并完整往返世界书位置与用户梦脉', () => {
    const snapshot = createLongDreamWorldBookSnapshot({
        bookNames: ['旧港'],
        entries: [{
            book: '旧港', uid: 11, name: '钟楼', content: '钟楼在退潮时开启。',
            position: 4, depth: 7, role: 'assistant', outletName: 'dream-lore',
        }],
    });
    let record = createLongDreamRecord({
        title: '潮汐档案',
        worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED,
        worldBookNames: ['旧港'],
        worldBookSnapshot: snapshot,
        source: { text: '第一章长正文', html: '<main>第一章长正文</main>' },
    });
    record = appendLongDreamChapter(record, {
        title: '退潮', text: '第二章长正文', html: '<main><p>第二章长正文</p></main>',
    });
    record.memory.cards = [{
        id: 'memory-key', type: '人物状态', key: '林岚/所在地', content: '林岚在钟楼顶层。',
        chapterNumber: 2, sourceChapterNumbers: [1, 2], status: 'active', editedByUser: true,
    }];

    const archive = createLongDreamArchive([record], { now: new Date('2026-08-08T03:00:00.000Z') });
    assert.equal(archive.manifest.format, LONG_DREAM_ARCHIVE_FORMAT);
    assert.equal(LONG_DREAM_ARCHIVE_MANIFEST, 'long-dream-manifest.json');
    assert.equal(archive.files.length, 4);
    assert.equal('text' in archive.manifest.dreams[0].chapters[0], false);
    assert.equal('html' in archive.manifest.dreams[0].chapters[0], false);

    const imported = parseLongDreamArchive(archive.manifest, archive.files);
    assert.equal(imported[0].chapters[0].text, '第一章长正文');
    assert.equal(imported[0].chapters[1].html, '<main><p>第二章长正文</p></main>');
    const entry = imported[0].inheritance.snapshot.books[0].entries[0];
    assert.equal(entry.position, 4);
    assert.equal(entry.depth, 7);
    assert.equal(entry.role, 'assistant');
    assert.equal(entry.outletName, 'dream-lore');
    assert.equal(imported[0].memory.cards[0].key, '林岚/所在地');
    assert.deepEqual(imported[0].memory.cards[0].sourceChapterNumbers, [1, 2]);
    assert.equal(imported[0].memory.cards[0].editedByUser, true);
    assert.throws(() => parseLongDreamArchive(archive.manifest, archive.files.slice(1)), /ZIP 缺少/);
});

test('长梦 JSON 不导出待确认候选，但仍能导入旧备份中的单版待确认稿', () => {
    const record = createLongDreamRecord({
        title: '候选不出卷',
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    const review = saveLongDreamDraft(record, {
        status: LONG_DREAM_DRAFT_STATUS.REVIEW,
        title: '第二章',
        instruction: '沿河而下。',
        text: '不应出现在新备份里的候选正文',
        html: '<main>不应出现在新备份里的候选正文</main>',
    });
    const backup = createLongDreamBackup([review]);
    const serialized = JSON.stringify(backup);
    assert.equal(backup.dreams[0].draft, null);
    assert.doesNotMatch(serialized, /不应出现在新备份里的候选正文/);

    const imported = parseLongDreamBackup({
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        dreams: [{
            title: '旧备份',
            chapters: [{ text: '第一章', html: '<main>第一章</main>' }],
            draft: {
                status: 'review',
                title: '第二章',
                text: '旧备份待确认正文',
                html: '<main>旧备份待确认正文</main>',
            },
        }],
    });
    const normalizedImported = normalizeLongDreamRecord(imported[0]);
    assert.equal(normalizedImported.draft.status, LONG_DREAM_DRAFT_STATUS.REVIEW);
    assert.equal(normalizedImported.draft.candidates.length, 1);
    assert.equal(normalizedImported.draft.text, '旧备份待确认正文');
});

test('长梦备份拒绝错格式，并能保留仅 HTML 的旧章节以便安全阅读', () => {
    assert.throws(() => parseLongDreamBackup({ format: 'st-theater-history', version: 1, dreams: [] }), /不是千夜浮梦长梦备份/);
    const imported = parseLongDreamBackup({
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        dreams: [{ title: '旧卷', chapters: [{ title: '旧章', html: '<main>仍可阅读</main>' }] }],
    });
    assert.equal(imported[0].chapters[0].html, '<main>仍可阅读</main>');
    assert.equal(imported[0].chapters[0].mode, 'html');
});

test('不完整的待确认长梦草稿会安全回退为可继续的 writing 草稿', () => {
    const imported = parseLongDreamBackup({
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        dreams: [{
            title: '半章旧卷',
            chapters: [{ text: '第一章', html: '<main>第一章</main>' }],
            draft: { status: 'review', title: '第二章', text: '尚未排版的正文', html: '' },
        }],
    });
    assert.equal(imported[0].draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
    assert.equal(imported[0].draft.text, '尚未排版的正文');
});

test('正文已完成的长梦草稿经过备份恢复后仍只需重新排版', () => {
    const record = createLongDreamRecord({
        source: { text: '第一章', html: '<main>第一章</main>' },
    });
    const renderPending = saveLongDreamDraft(record, {
        status: LONG_DREAM_DRAFT_STATUS.WRITING,
        resumeStage: LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING,
        title: '第二章',
        instruction: '走进旧站。',
        text: '已经完整写完、只差排版的第二章。',
    });
    const restored = parseLongDreamBackup(createLongDreamBackup([renderPending]))[0];
    assert.equal(restored.draft.status, LONG_DREAM_DRAFT_STATUS.WRITING);
    assert.equal(restored.draft.resumeStage, LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING);
    assert.equal(restored.draft.text, '已经完整写完、只差排版的第二章。');
});

test('全屏阅读使用原生模态弹窗进入浏览器顶层', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(source, /<dialog id="theater-reader-overlay"/);
    assert.match(source, /readerDialog\.showModal\(\)/);
    assert.doesNotMatch(source, /<div id="theater-reader-overlay"/);
    assert.match(styles, /\.theater-reader-overlay::backdrop/);
});

test('点击续写会切回生成页、滚到顶部并聚焦指令框', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const match = source.match(/function revealContinuationInput\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(source, /\.theater-tab\[data-tab="generate"\][\s\S]*?\.click\(\)/);
    assert.match(match, /\.theater-panels-wrapper/);
    assert.match(match, /panels\.scrollTop = 0/);
    assert.match(match, /input\.focus\(\{ preventScroll: true \}\)/);
    assert.match(source, /scheduleTokenEstimate\(\);\s*revealContinuationInput\(\);/);
});

test('插件更新成功后只提供需确认的酒馆刷新操作', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const confirmFlow = source.match(/async function confirmReloadAfterUpdate\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    const updateFlow = source.match(/async function updateExtension\(\) \{[\s\S]*?\n\}/)?.[0] || '';

    assert.match(source, /id="theater-reload-after-update-btn"[\s\S]*?刷新酒馆并启用/);
    assert.match(source, /#theater-reload-after-update-btn', confirmReloadAfterUpdate/);
    assert.match(updateFlow, /if \(resp\.ok\) \{\s*showReloadAfterUpdateAction\(\)/);
    assert.match(confirmFlow, /Popup\.show\.confirm\('现在刷新酒馆并启用新版本？'/);
    assert.match(confirmFlow, /if \(!confirmed\) return;[\s\S]*?window\.location\.reload\(\)/);
    assert.match(styles, /\.theater-reload-after-update\[hidden\][\s\S]*?display: none/);
    assert.match(source, /theater-update-button-stack[\s\S]*?theater-update-btn[\s\S]*?theater-reload-after-update-btn/);
    assert.match(styles, /\.theater-config-card \.theater-update-actions\s*\{[\s\S]*?display:\s*grid/);
    assert.match(styles, /\.theater-config-card \.theater-update-actions > span\s*\{[\s\S]*?white-space:\s*nowrap/);
    assert.match(styles, /\.theater-update-button-stack\s*\{[\s\S]*?display:\s*grid[\s\S]*?gap:\s*8px/);
});

test('常见问题汇总是诊断报告后的独立可折叠界面', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const signals = readFileSync(new URL('../request-diagnostics.js', import.meta.url), 'utf8');
    const diagnosticsPanel = source.indexOf('data-panel="diagnostics"');
    const reportOutput = source.indexOf('id="theater-diagnostics-output"', diagnosticsPanel);
    const library = source.indexOf('class="theater-diagnostic-catalog theater-diagnostic-library"', diagnosticsPanel);
    assert.ok(reportOutput >= 0 && library > reportOutput);
    assert.match(source, /按弹窗里的错误信号查原因/);
    assert.match(source, /theater-diagnostic-catalog-head/);
    assert.match(source, /theater-diagnostic-catalog-reason/);
    assert.match(source, /theater-diagnostic-catalog-action/);
    assert.doesNotMatch(source, /【常见问题汇总｜按错误信号查询】/);
    assert.doesNotMatch(source.match(/function runDiagnostics\(\)[\s\S]*?\n\}/)?.[0] || '', /diagnostic-catalog/);
    assert.match(signals, /T-API-CONTENT-FILTER/);
    assert.match(styles, /\.theater-diagnostic-catalog\s*\{/);
    assert.match(styles, /\.theater-diagnostic-catalog\[open\]/);
    assert.match(styles, /\.theater-diagnostic-catalog-item\s*\{[\s\S]*?flex-direction:\s*column/);
});

test('长梦提供逐章目录、完卷恢复和独立备份入口', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(source, /id="theater-dream-import-backup"/);
    assert.match(source, /id="theater-dream-export-all"/);
    assert.match(source, /id="theater-dream-export-current"/);
    assert.match(source, /data-dream-export-one/);
    assert.match(source, /data-dream-open-work/);
    assert.match(source, /requestLongDreamExport\(\[dream\], 'single'\)/);
    assert.match(source, /function chooseExportFormat/);
    assert.match(source, /ZIP 可读归档/);
    assert.match(source, /JSON 完整备份/);
    assert.match(source, /requestHistoryExport/);
    assert.doesNotMatch(source, /ZIP 生成失败，已回退为 JSON 备份/);
    assert.match(source, /'theater-dream-complete'/);
    assert.match(source, /'theater-dream-reopen'/);
    assert.match(source, /class="[^"]*theater-dream-chapter-directory is-workspace/);
    assert.match(source, /data-dream-read-chapter/);
    assert.match(source, /createLongDreamBackup/);
    assert.match(source, /parseLongDreamBackup/);
    assert.match(source, /createLongDreamArchive/);
    assert.match(source, /parseLongDreamArchive/);
    assert.match(source, /input\.accept = '\.zip,\.json,application\/zip,application\/json'/);
    assert.match(source, /data-dream-chapter-action="branch"/);
    assert.match(source, /data-dream-chapter-action="rewrite"/);
    assert.match(source, /data-dream-chapter-action="rollback"/);
    assert.match(source, /data-dream-chapter-action="delete-from"/);
    assert.match(source, /data-dream-memory-action="save"/);
    assert.match(source, /data-dream-memory-action="\$\{dismissed \? 'restore' : 'dismiss'\}"/);
    assert.match(source, /theater-dream-memory-current-state-readonly/);
    assert.match(source, /data-dream-memory-v2-action="save"/);
    assert.match(source, /data-dream-memory-conflict-action="accept"/);
    assert.match(source, /id="theater-dream-memory-analysis-preset"/);
    assert.match(source, /id="theater-import-dream-memory-preset"/);
    assert.match(source, /id="theater-dream-memory-selection"/);
    assert.match(source, /refreshLongDreamMemorySelection/);
    assert.match(source, /class="[^"]*theater-dream-memory-selection-chip/);
    assert.match(source, /class="theater-dream-memory-chip-text"/);
    assert.match(source, /class="[^"]*theater-dream-memory-v2-card/);
    assert.match(source, /class="theater-dream-memory-flow"/);
    assert.match(source, /data-dream-memory-filter="all"/);
    assert.match(source, /data-dream-memory-flow-kind="\$\{kind\}"/);
    assert.match(source, /class="theater-dream-memory-row"/);
    assert.match(source, /data-dream-memory-open-editor/);
    assert.match(source, /data-dream-memory-editor-template/);
    assert.match(source, /dialog class="theater-dream-memory-editor"/);
    assert.match(source, /dialog\.showModal\(\)/);
    assert.doesNotMatch(source, /class="theater-dream-memory-card-more"/);
    assert.match(source, /placeholder: '例如：泄密调查、银钥匙'/);
    assert.match(source, /field\('status', '事项状态'/);
    assert.doesNotMatch(source, /kind === 'state' \|\| kind === 'thread' \? 'open' : ''/);
    assert.match(source, /请只导入可信来源/);
    assert.match(source, /已导入 \$\{added\}\/\$\{total\} 卷长梦/);
    assert.match(source, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 1000\)/);
    assert.match(styles, /\.theater-dream-chapter-directory\s*\{/);
    assert.match(styles, /\.theater-dream-chapter-row\s*\{/);
    assert.match(styles, /\.theater-dream-chapter-actions\s*\{/);
    assert.match(styles, /\.theater-dream-memory-state-editor\s*\{/);
    assert.match(styles, /\.theater-dream-memory-selection\s*\{/);
    assert.match(styles, /\.theater-dream-memory-chip-text\s*\{[\s\S]*?min-width:\s*0/);
    assert.match(styles, /\.theater-dream-memory-v2-card > summary\s*\{[\s\S]*?min-height:\s*44px/);
    assert.match(styles, /\.theater-dream-memory-list article \.theater-input::placeholder/);
    assert.match(styles, /\.theater-dream-library-card-header,[\s\S]*?justify-content:space-between/);
    assert.match(styles, /\.theater-dream-library-card-footer[\s\S]*?justify-content:space-between/);
    assert.match(styles, /\.theater-dream-library-export\s*\{/);
    assert.match(styles, /\.theater-dream-memory-flow-filters\s*\{/);
    assert.match(styles, /\.theater-dream-fat-btn\.is-primary\s*\{/);
    assert.match(styles, /dialog\.theater-dream-memory-editor\s*\{[\s\S]*?inset:0 0 0 auto/);
    assert.match(styles, /@media \(max-width:700px\)[\s\S]*?dialog\.theater-dream-memory-editor\s*\{[\s\S]*?inset:auto 0 0/);
    assert.match(styles, /\.theater-dream-memory-workspace\s*\{[\s\S]*?--theater-dream-memory-gutter:clamp\(20px,3\.4vw,32px\);[\s\S]*?width:min\(840px,calc\(100% - \(var\(--theater-dream-memory-gutter\) \* 2\)\)\);[\s\S]*?margin:4px auto 0/);
    assert.match(styles, /@media \(max-width:700px\)[\s\S]*?\.theater-dream-memory-workspace\s*\{[\s\S]*?--theater-dream-memory-gutter:16px;[\s\S]*?width:calc\(100% - \(var\(--theater-dream-memory-gutter\) \* 2\)\);[\s\S]*?margin-inline:auto/);
    assert.match(styles, /\.theater-dream-memory-row\s*\{[\s\S]*?grid-template-columns:44px minmax\(0,1fr\) 8px;[\s\S]*?max-width:100%/);
    assert.match(styles, /dialog\.theater-dream-memory-editor\s*\{[\s\S]*?width:min\(100%,100vw\);[\s\S]*?max-width:100vw/);
    assert.match(styles, /\.theater-dream-memory-editor-record :is\(input,textarea,select\)\s*\{[\s\S]*?font-size:16px/);
    assert.match(source, /id="theater-dream-chapter-tools-toggle"/);
    assert.match(source, /id="theater-dream-chapter-tools-panel"/);
    assert.match(source, /aria-controls="theater-dream-chapter-tools-panel"/);
    assert.match(source, /closeLongDreamChapterTools/);
    assert.doesNotMatch(source, /class="theater-dream-chapter-editor-tools"/);
    assert.match(source, /class="ui-btn ui-btn-sm theater-dream-chapter-open/);
    assert.match(styles, /\.theater-dream-chapter-tools-toggle\s*\{[\s\S]*?width:44px;[\s\S]*?height:44px/);
    assert.match(styles, /\.theater-dream-chapter-editor-actions\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(styles, /@media \(max-width:520px\)[\s\S]*?\.theater-dream-chapter-editor-actions\s*\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(styles, /#theater-dream-read-chapter-fullscreen\s*\{\s*grid-column:1 \/ -1/);
    assert.match(styles, /@media \(min-width:521px\)[\s\S]*?\.theater-dream-chapter-editor-actions\[hidden\]\s*\{\s*display:grid/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\]\s*\{\s*font-size:var\(--t-text-base\)/);
    assert.match(styles, /dialog\.theater-export-format-dialog/);
    assert.match(styles, /--t-bg: var\(--SmartThemeBlurTintColor/);
    assert.doesNotMatch(styles, /\.theater-panel\[data-panel="long-dream"\]\s*\{\s*--t-bg:\s*#FAF7F2/);
    assert.doesNotMatch(source, /注意：本地 \$\{reference\.toLocaleString\(\)\} 字符参考线已超出/);
});

test('v4.0.2 版本号在代码、清单、样式头和设置页保持一致', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.match(source, /const VERSION = '4\.0\.2'/);
    assert.equal(manifest.version, '4.0.2');
    assert.match(styles, /^\/\* 千夜浮梦 · 小剧场生成器 v4\.0\.2/);
    assert.match(source, /当前版本 v\$\{VERSION\}/);
});

test('长梦真实工作区只有定梦续写作品三分类，并把审阅梦脉和章节操作归入正确层级', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const workspace = source.match(/function longDreamWorkspaceHTML\([\s\S]*?\n\}/)?.[0] || '';
    const creation = source.match(/function longDreamCreateHTML\(\) \{[\s\S]*?function longDreamGenerationStageText/)?.[0] || '';
    const definition = source.match(/function longDreamDefinitionHTML\(dream\) \{[\s\S]*?function longDreamDetailHTML/)?.[0] || '';
    const continuation = source.match(/function longDreamDetailHTML\(dream\) \{[\s\S]*?function longDreamChapterDirectoryHTML/)?.[0] || '';
    const shelf = source.match(/function longDreamListHTML\(\) \{[\s\S]*?const LONG_DREAM_RELATION_OPTIONS/)?.[0] || '';
    const workDetail = source.match(/function longDreamWorkDetailHTML\(dream\) \{[\s\S]*?function longDreamChapterDetailHTML/)?.[0] || '';
    const chapterDetail = source.match(/function longDreamChapterDetailHTML\(dream, chapter\) \{[\s\S]*?function longDreamUnavailableHTML/)?.[0] || '';

    assert.match(workspace, /\['definition', '定梦'\]/);
    assert.match(workspace, /\['continue', '续写'\]/);
    assert.match(workspace, /\['works', '作品'\]/);
    assert.doesNotMatch(workspace, /审阅|章节|梦脉|备份/);
    assert.doesNotMatch(creation, /dream-hero-container|data-dream-back|返回作品/);
    assert.doesNotMatch(definition, /dream-hero-container|DREAM CANON/);
    assert.match(continuation, /data-dream-continuation-stage="review"/);
    assert.match(continuation, /放弃重写/);
    assert.match(continuation, /确认保存/);
    assert.match(continuation, /data-dream-continuation-bottom="memory"/);
    assert.ok(continuation.indexOf('data-dream-continuation-bottom="memory"') > continuation.indexOf('data-dream-continuation-stage="review"'));
    assert.match(continuation, /最近两章全文、旧章索引/);
    assert.doesNotMatch(continuation, /theater-dream-flow-label|续写 · 本章输入|同一流程/);
    assert.doesNotMatch(continuation, /longDreamMemorySelectionHTML/);
    assert.doesNotMatch(continuation, /<details class="ui-card ia-memory-dock theater-dream-memory-workspace-details"/);
    assert.doesNotMatch(continuation, /新章节只会进入这部长卷/);
    assert.match(continuation, /fa-sliders/);
    assert.match(continuation, /id="theater-dream-token-summary"[\s\S]*?明细 ▾[\s\S]*?id="theater-dream-token-details"/);
    assert.match(workDetail, /data-dream-work-back/);
    assert.ok(shelf.indexOf('class="theater-dream-list"') < shelf.indexOf('备份与恢复'));
    assert.doesNotMatch(shelf, /ia-book-cover|打开作品/);
    assert.match(source, /data-dream-open-chapter/);
    assert.match(workDetail, /class="[^"]*theater-dream-work-menu/);
    assert.doesNotMatch(workDetail, /<details class="[^"]*theater-dream-work-menu/);
    assert.match(chapterDetail, /data-dream-chapter-back/);
    assert.match(chapterDetail, /id="theater-dream-export-chapter"/);
    assert.match(chapterDetail, /class="[^"]*theater-dream-chapter-operations/);
    assert.doesNotMatch(chapterDetail, /<details class="[^"]*theater-dream-chapter-operations/);
    assert.doesNotMatch(shelf, /<details class="[^"]*theater-dream-library-tools/);
    assert.match(source, /function exportLongDreamChapter\(dream, chapter\)/);
    assert.match(source, /downloadFile\(longDreamChapterFileName\(dream, chapter, 'html'\), chapter\.html/);
    assert.match(source, /renderLongDreamChapter\(\{[\s\S]*?text,[\s\S]*?apiRoute: captureGenerationApiRoute/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.ia-subnav\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\][\s\S]*?--dream-gemini-bg:\s*var\(--t-bg\)/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.ia-subtab \{[^}]*width:100% !important[^}]*min-height:40px !important[^}]*max-height:none !important/);
    assert.match(styles, /\.ia-subtab \+ \.ia-subtab::before/);
    assert.match(styles, /#theater-dream-generate-next,[\s\S]*?flex:0 0 auto !important;[\s\S]*?width:auto !important;[\s\S]*?max-height:42px !important/);
    assert.doesNotMatch(styles, /\.theater-dream-next-actions \.ui-btn-primary \{ flex:1 1 180px; \}/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.compact-detail-head \{[^}]*flex-direction:row/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-definition > \* \{ order:0; \}/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.ia-column \{[^}]*max-width:\s*none/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.ia-category,[\s\S]*?max-width:\s*none/);
    assert.match(source, /<span class="relation-card-copy"><b>/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.relation-card \{[^}]*display:block !important[^}]*height:auto !important/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.relation-card-copy \{[^}]*width:100% !important[^}]*writing-mode:horizontal-tb !important/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.relation-card b \{[^}]*word-break:keep-all !important[^}]*writing-mode:horizontal-tb !important/);
    assert.match(styles, /@media \(max-width:520px\)[\s\S]*?\.theater-panel\[data-panel="long-dream"\] \.relation-cards \{ grid-template-columns:1fr; \}/);
    assert.match(styles, /text-align:justify; text-justify:inter-ideograph/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-latest \{ display:block; margin-top:0; \}/);
    assert.match(styles, /:where\(\.theater-dream-home, \.theater-dream-work-detail, \.theater-dream-chapter-detail\) \.ui-btn:not\(\.ui-btn-danger\)/);
    assert.doesNotMatch(styles, /dialog\.popup:has\(\.theater-panel\[data-panel="long-dream"\]\.active\)/);
});

test('长梦参考稿样式只作用于长梦面板，不改坏其他页面按钮与插件外壳', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const parity = styles.split('Long Dream HTML parity')[1] || '';
    assert.doesNotMatch(source, /theater-popup-header ia-header/);
    assert.doesNotMatch(source, /theater-tabs ia-main-tabs/);
    assert.doesNotMatch(source, /theater-panels-wrapper ia-content/);
    assert.doesNotMatch(parity, /^\.theater-popup\s*\{/m);
    assert.doesNotMatch(parity, /\.popup-button-close/);
    assert.doesNotMatch(parity, /body dialog\.popup:has\(\.theater-popup\) \{/);
    assert.doesNotMatch(parity, /dialog\.popup:has\(\.theater-panel\[data-panel="long-dream"\]\.active\)/);
    assert.match(parity, /\.theater-panel\[data-panel="long-dream"\] \.ui-btn/);
    assert.match(parity, /\.theater-panel\[data-panel="long-dream"\] \.ui-btn-primary \{[\s\S]*?linear-gradient\(135deg, var\(--t-accent\) 0%, var\(--t-accent-deep\) 100%\)/);
    assert.match(parity, /\.theater-panel\[data-panel="long-dream"\] \.ia-subtab\.active \{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/);
});

test('长梦章节阅读走独立沉浸阅读器，不覆写普通生成结果', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const reader = source.match(/function readLongDreamChapter\(chapter\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(reader, /openFullscreenReader\(\{/);
    assert.doesNotMatch(reader, /lastGenerated(Text|Html)|currentOutputMode|showInIframe/);
    assert.match(source, /function openFullscreenReader\(overridePayload = null\)/);
});

test('纯文字亮色与暗色共用纯正文协议，但使用不同的本地阅读主题', () => {
    assert.equal(isPlainTextSelection(PLAIN_TEXT_LIGHT_SELECTION), true);
    assert.equal(isPlainTextSelection(PLAIN_TEXT_DARK_SELECTION), true);
    assert.equal(plainTextThemeForSelection(PLAIN_TEXT_LIGHT_SELECTION), 'light');
    assert.equal(plainTextThemeForSelection(PLAIN_TEXT_DARK_SELECTION), 'dark');
    assert.equal(textOutputModeForTheme('light'), 'text');
    assert.equal(textOutputModeForTheme('dark'), 'text-dark');
    assert.equal(isTextOutputMode('text'), true);
    assert.equal(isTextOutputMode('text-dark'), true);
    assert.equal(textThemeForOutputMode('text-dark'), 'dark');
});

test('暗色纯文字阅读壳转义正文并声明夜间配色', () => {
    const html = buildPlainTextHtml('夜里有一盏 <灯>。\n\n仍然亮着。', 'dark');
    assert.match(html, /name="color-scheme" content="dark"/);
    assert.match(html, /#0d0f12/);
    assert.match(html, /夜里有一盏 &lt;灯&gt;。/);
    assert.doesNotMatch(html, /<灯>/);
    assert.match(html, /white-space:pre-wrap/);
    assert.match(html, /"KaiTi"/);
});

test('生成结果使用可关闭的页边书签，并保留安全退出编辑与移除结果', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const actionsAt = source.indexOf('id="theater-result-actions"');
    const outputAt = source.indexOf('id="theater-output-container"');
    assert.ok(actionsAt >= 0 && actionsAt < outputAt);
    assert.match(source, /id="theater-result-bookmark-enabled"/);
    assert.match(source, /bookmarkPlacementFromPoint/);
    assert.match(source, /is-inline-menu/);
    assert.match(source, /id="theater-cancel-edit-btn"/);
    assert.match(source, /id="theater-delete-result-btn"/);
    assert.match(source, /原正文和排版没有改变/);
    assert.match(source, /已经保存到历史的小剧场不会受影响/);
    assert.match(styles, /\.theater-result-actions\s*\{[\s\S]*?#fffaf0/);
    assert.match(styles, /data-skin="custom"\] \.theater-result-actions[\s\S]*?Canvas/);
});

test('手机弹窗为 Close 按钮和安全区预留滚动空间，切换标签回到顶部', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const tabHandler = source.match(/\/\/ Tabs[\s\S]*?\/\/ ---- Generate ----/)?.[0] || '';
    const tabActivator = source.match(/function activateTheaterTab\([\s\S]*?\n\}/)?.[0] || '';
    assert.match(tabHandler, /activateTheaterTab/);
    assert.match(tabActivator, /panels\.scrollTop = 0/);
    assert.doesNotMatch(source, /target\.scrollIntoView/);
    assert.match(styles, /height:\s*clamp\(240px, calc\(92dvh - 210px\), 620px\)/);
    assert.match(styles, /env\(safe-area-inset-bottom\)/);
    assert.doesNotMatch(styles, /height:\s*calc\(100dvh - 180px\)/);
});

test('默认皮肤的长梦备份按钮保持深色底上的可读对比度', () => {
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(styles, /theater-popup:not\(\[data-skin="theater"\]\):not\(\[data-skin="custom"\]\) \.theater-dream-archive-actions \.theater-btn\s*\{[\s\S]*?color:\s*rgba\(255, 249, 237, \.9\)[\s\S]*?background:\s*rgba\(255, 249, 237, \.075\)/);
});

test('页边书签位置会限制在可见范围并按拖动落点吸附', () => {
    const rect = { left: 100, right: 700, top: 50, bottom: 650, width: 600, height: 600 };
    assert.equal(normalizeBookmarkYRatio(-1), 0.12);
    assert.equal(normalizeBookmarkYRatio(2), 0.88);
    assert.deepEqual(bookmarkPlacementFromPoint({ rect, x: 160, y: 350 }), { side: 'left', yRatio: 0.5 });
    assert.deepEqual(bookmarkPlacementFromPoint({ rect, x: 660, y: 590 }), { side: 'right', yRatio: 0.88 });
    const position = bookmarkPosition({ rect, side: 'right', yRatio: 0.55, width: 48, height: 68 });
    assert.equal(position.left, 646);
    assert.equal(position.top, 346);
});

test('设置页按六个清晰模块展示全部功能且字号跟随全局设置', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    for (const id of [
        'theater-api-mode', 'theater-api-preset-select', 'theater-api-protocol', 'theater-api-url',
        'theater-api-key', 'theater-api-model', 'theater-max-output-tokens', 'theater-stream-enabled',
        'theater-auto-continue', 'theater-max-auto-rounds', 'theater-save-api-preset-btn',
        'theater-update-api-preset-btn', 'theater-rename-api-preset-btn', 'theater-delete-api-preset-btn',
        'theater-dream-memory-api-preset', 'theater-dream-memory-batch-size',
        'theater-dream-memory-prompt', 'theater-reset-dream-memory-prompt',
        'theater-wb-read-mode', 'theater-sound-enabled', 'theater-sound-preset',
        'theater-sound-preview-btn', 'theater-sound-volume', 'theater-random-enabled',
        'theater-random-scope', 'theater-auto-enabled', 'theater-auto-interval', 'theater-auto-source',
        'theater-result-bookmark-enabled', 'theater-floating-ball-toggle', 'theater-floating-ball-tuck-toggle',
        'theater-update-btn', 'theater-reload-after-update-btn', 'theater-update-ready-hint',
    ]) assert.match(source, new RegExp(`id="${id}"`));
    for (const group of ['api', 'generation', 'automation', 'materials', 'access', 'extension']) {
        assert.match(source, new RegExp(`data-config-group="\\$\\{group.id\\}"|id: '${group}'`));
    }
    const decorator = source.match(/function decorateConfigLayout\(\)[\s\S]*?\n\}/)?.[0] || '';
    assert.doesNotMatch(decorator, /theater-config-index/);
    assert.doesNotMatch(source, /data-config-section="logs"/);
    assert.doesNotMatch(source, /theater-api-preset-menu/);
    assert.doesNotMatch(source, /theater-api-current-card/);
    assert.doesNotMatch(source, /生成体验与策略|素材与辅助联动/);
    assert.doesNotMatch(source, /下载完成后仍由你决定何时刷新/);
    assert.match(source, /theater-config-icon-btn/);
    assert.match(source, /data-theater-number-step="-1"/);
    assert.match(source, /data-theater-number-step="1"/);
    assert.match(source, /data-config-extra-body="generation"/);
    assert.doesNotMatch(source, /data-config-extra-body="experience"/);
    assert.match(decorator, /title: '生成控制'/);
    assert.match(decorator, /title: '指令与自动生成'/);
    assert.match(decorator, /title: '素材与提示'/);
    assert.match(decorator, /title: '界面与快捷入口'/);
    assert.match(source, /theater-config-api-actions/);
    assert.match(source, /theater-config-inline-control/);
    assert.match(source, /theater-config-range-control/);
    assert.match(styles, /\.theater-config-card/);
    assert.match(styles, /\.theater-config-switch/);
    assert.match(styles, /\.theater-panel\[data-panel="config"\][\s\S]*?text-align:\s*left/);
    assert.match(styles, /\.theater-config-stepper/);
    assert.match(styles, /--t-config-title-size:\s*calc\(var\(--t-text-base\)/);
    assert.match(styles, /--t-config-desc-size:\s*calc\(var\(--t-text-xs\)/);
    assert.match(styles, /\.theater-config-card \.theater-config-setting-copy b[\s\S]*?font-size:\s*var\(--t-config-title-size\)/);
    assert.match(styles, /\.theater-config-card \.theater-config-setting-copy small[\s\S]*?font-size:\s*var\(--t-config-desc-size\)/);
    assert.match(styles, /\.theater-config-card \.theater-api-preset-actions\s*\{[\s\S]*?position:\s*static/);
    assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.theater-config-card \.theater-api-preset-control\s*\{\s*grid-template-columns:\s*1fr/);
});

test('final HTML renderer hydrates every paragraph without rewriting source text', () => {
    const sourceText = '第一段有 <危险标签>。\n\n第二段继续。';
    const plan = createFinalRenderPlan(sourceText);
    assert.deepEqual(plan.paragraphs.map(item => item.token), [
        '{{THEATER_P0001}}',
        '{{THEATER_P0002}}',
    ]);

    const template = '<!doctype html><html><head><style>p{color:#432}</style></head><body><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>';
    const hydrated = hydrateFinalRenderHtml(template, plan);
    assert.match(hydrated, /第一段有 &lt;危险标签&gt;。/);
    assert.match(hydrated, /第二段继续。/);
    assert.doesNotMatch(hydrated, /\{\{THEATER_P/);
    assert.ok(hydrated.indexOf('第一段') < hydrated.indexOf('第二段'));
});

test('final HTML renderer rejects missing, duplicate, reordered, or hidden placeholders', () => {
    const plan = createFinalRenderPlan('第一段。\n\n第二段。');
    const invalidTemplates = [
        '<html><body><p>{{THEATER_P0001}}</p></body></html>',
        '<html><body><p>{{THEATER_P0001}}</p><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>',
        '<html><body><p>{{THEATER_P0002}}</p><p>{{THEATER_P0001}}</p></body></html>',
        '<html><body><div data-copy="{{THEATER_P0001}}"></div><p>{{THEATER_P0002}}</p></body></html>',
        '<html><head><style>.x::after{content:"{{THEATER_P0001}}"}</style></head><body><p>{{THEATER_P0002}}</p></body></html>',
        '<html><body><script>const x = "{{THEATER_P0001}}"</script><p>{{THEATER_P0002}}</p></body></html>',
    ];
    for (const template of invalidTemplates) {
        assert.throws(() => hydrateFinalRenderHtml(template, plan), error => error?.code === 'THEATER_PLACEHOLDER_INVALID');
    }
});

test('final HTML payload tells the model to return layout tokens exactly once', () => {
    const payload = buildFinalRenderPayload({ sourceText: '第一段。\n\n第二段。', rules: '输出完整 HTML。' });
    assert.equal(payload.placeholderPlan.paragraphs.length, 2);
    assert.match(payload.userPrompt, /\{\{THEATER_P0001\}\}/);
    assert.match(payload.userPrompt, /不要在 HTML 中重新输出 text/);
    assert.match(payload.userPrompt, /每个 token 必须且只能出现一次/);
    assert.match(payload.userPrompt, /输出完整 HTML/);
});

test('iframe 没有回报渲染状态时会触发正文兜底', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = { innerWidth: 390, innerHeight: 800 };
    let fallbackReason = '';
    const frame = {
        contentWindow: {},
        style: {},
        setAttribute() {},
        set srcdoc(value) { this.rendered = value; },
    };
    try {
        renderSafeIframe(frame, '<html><body>已有正文</body></html>', {
            sourceHasText: true,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        await new Promise(resolve => setTimeout(resolve, RENDER_REPORT_TIMEOUT_MS + 50));
        assert.equal(fallbackReason, 'no-report');
        assert.match(frame.rendered, /已有正文/);
    } finally {
        globalThis.window = originalWindow;
    }
});

test('全屏 iframe 没有及时回报时保留丰富 HTML，不误降级为纯文字', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = { innerWidth: 390, innerHeight: 800 };
    let fallbackReason = '';
    const frame = {
        contentWindow: {},
        style: {},
        setAttribute() {},
        set srcdoc(value) { this.rendered = value; },
    };
    try {
        renderSafeIframe(frame, '<html><body><div class="phone">全屏正文</div></body></html>', {
            sourceHasText: true,
            fixedHeight: true,
            fallbackOnNoReport: false,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        await new Promise(resolve => setTimeout(resolve, RENDER_REPORT_TIMEOUT_MS + 50));
        assert.equal(fallbackReason, '');
        assert.match(frame.rendered, /class="phone"/);
        assert.equal(frame.style.height, '100%');
    } finally {
        globalThis.window = originalWindow;
    }
});

test('历史 ZIP 清单保留元数据并为重名小剧场生成唯一 HTML 文件名', () => {
    const source = [
        {
            title: '同名', date: '2026/07/28 10:00', instruction: '第一条指令', html: '<html>甲</html>', mode: 'html',
            sourceConfig: {
                metadataCaptured: true,
                presetName: '长篇预设',
                selectedWorldBooks: ['人物设定'],
                readChatContext: true,
                contextRange: 20,
                renderSelection: '__default__',
                renderLabel: '内置默认',
                textTheme: 'light',
            },
        },
        { title: '同名', date: '2026/07/28 10:01', instruction: '第二条指令', html: '<html>乙</html>', mode: 'text-dark' },
    ];
    const archive = createHistoryArchive(source);
    assert.equal(HISTORY_ARCHIVE_MANIFEST, 'theater-history.json');
    assert.equal(archive.files.length, 2);
    assert.notEqual(archive.files[0].name, archive.files[1].name);
    assert.equal(archive.manifest.items[1].instruction, '第二条指令');
    assert.equal(archive.manifest.items[1].mode, 'text-dark');
    assert.equal(archive.manifest.items[0].sourceConfig.renderLabel, '内置默认');
    const restored = historyItemsFromArchive(archive.manifest, archive.files);
    assert.deepEqual(restored, normalizeHistoryBackup(source));
});

test('历史导入兼容旧 JSON、带清单的新 JSON 和只有 HTML 的旧 ZIP', () => {
    const oldJson = [{ title: '旧 JSON', html: '<html>旧内容</html>' }];
    assert.equal(normalizeHistoryBackup(oldJson)[0].title, '旧 JSON');
    const newJson = createHistoryJsonBackup([{ title: '新 JSON', html: '<html>新内容</html>', mode: 'text' }]);
    assert.equal(normalizeHistoryBackup(newJson)[0].mode, 'text');
    const legacyZipItems = historyItemsFromArchive(null, [
        { name: '2026-07-28_旧版导出.html', html: '<html>ZIP 内容</html>' },
    ]);
    assert.equal(legacyZipItems[0].title, '旧版导出');
    assert.equal(legacyZipItems[0].date, '2026/07/28');
    assert.equal(legacyZipItems[0].html, '<html>ZIP 内容</html>');
});

test('iframe 导航更换窗口引用后仍能接收渲染回报，短暂空正文不会误降级', async () => {
    const originalWindow = globalThis.window;
    let messageHandler = null;
    globalThis.window = {
        innerWidth: 390,
        innerHeight: 800,
        addEventListener(type, handler) {
            if (type === 'message') messageHandler = handler;
        },
    };
    const frame = {
        contentWindow: {},
        style: {},
        setAttribute() {},
        set srcdoc(value) { this.rendered = value; },
    };
    let fallbackReason = '';
    try {
        installSafeResizeListener();
        renderSafeIframe(frame, '<html><body>已有正文</body></html>', {
            sourceHasText: true,
            blankGraceMs: 20,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        const navigatedWindow = {};
        frame.contentWindow = navigatedWindow;
        messageHandler({
            source: navigatedWindow,
            data: { type: 'st-theater:height', height: 240, textLength: 0 },
        });
        messageHandler({
            source: navigatedWindow,
            data: { type: 'st-theater:height', height: 360, textLength: 4 },
        });
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(fallbackReason, '');
        assert.equal(frame.style.height, '360px');

        const blankWindow = {};
        const blankFrame = {
            contentWindow: blankWindow,
            style: {},
            setAttribute() {},
            set srcdoc(value) { this.rendered = value; },
        };
        renderSafeIframe(blankFrame, '<html><body></body></html>', {
            sourceHasText: true,
            blankGraceMs: 10,
            onBlank: ({ reason }) => { fallbackReason = reason; },
        });
        messageHandler({
            source: blankWindow,
            data: { type: 'st-theater:height', height: 240, textLength: 0 },
        });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(fallbackReason, 'empty-body');

        const fullscreenWindow = {};
        const fullscreenFrame = {
            contentWindow: fullscreenWindow,
            style: {},
            setAttribute() {},
            set srcdoc(value) { this.rendered = value; },
        };
        renderSafeIframe(fullscreenFrame, '<html><body>全屏正文</body></html>', {
            sourceHasText: true,
            fixedHeight: true,
        });
        messageHandler({
            source: fullscreenWindow,
            data: { type: 'st-theater:height', height: 480, textLength: 4 },
        });
        assert.equal(fullscreenFrame.style.height, '100%');
    } finally {
        globalThis.window = originalWindow;
    }
});

test('流式解析兼容 OpenAI、Gemini 原生与 Responses API 正文格式', () => {
    assert.equal(extractStreamText({ choices: [{ delta: { content: 'OpenAI 正文' } }] }), 'OpenAI 正文');
    assert.equal(extractStreamText({ candidates: [{ content: { parts: [{ text: 'Gemini 正文' }] } }] }), 'Gemini 正文');
    assert.equal(extractStreamText({ type: 'response.output_text.delta', delta: 'Responses 正文' }), 'Responses 正文');
    assert.equal(extractStreamText({ output: [{ content: [{ type: 'output_text', text: '完整响应正文' }] }] }), '完整响应正文');
});

test('思考标签在流式未闭合时不会闪出，并在闭合后只保留正文', () => {
    assert.deepEqual(filterTaggedReasoning('<thin'), {
        content: '',
        hadReasoning: true,
        incomplete: false,
    });
    assert.deepEqual(filterTaggedReasoning('<thinking>不能显示'), {
        content: '',
        hadReasoning: true,
        incomplete: true,
    });
    assert.equal(reasoningSafeContent('<thinking>不能显示</thinking>真正正文'), '真正正文');
    assert.equal(reasoningSafeContent('<think>旧标签也隐藏</think>第二段正文'), '第二段正文');
    assert.equal(reasoningSafeContent('开头正文<thinking>中间思考</thinking>结尾正文'), '开头正文结尾正文');
});

test('独立 API 会在交付前隐藏 thinking，只有思考内容时给出稳定信号', async () => {
    const visibleChunks = [];
    const config = {
        apiUrl: 'https://api.example.com/v1',
        apiProtocol: API_PROTOCOLS.OPENAI,
        apiKey: 'secret',
        apiModel: 'model-name',
        maxOutputTokens: 1024,
    };
    const result = await requestCustomApi({
        config,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        onChunk: text => visibleChunks.push(text),
        fetchImpl: async () => new Response(JSON.stringify({
            choices: [{ message: { content: '<thinking>私密思考</thinking>可见正文' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(result.text, '可见正文');
    assert.deepEqual(visibleChunks, ['可见正文']);

    await assert.rejects(() => requestCustomApi({
        config,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        fetchImpl: async () => new Response(JSON.stringify({
            choices: [{ message: { content: '<thinking>只有思考，没有正文</thinking>' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }), error => error?.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.REASONING_ONLY
        && error?.code === 'THEATER_REASONING_ONLY');
});

test('流式解析能取出状态为 200 的错误事件，而不是只报告空流', () => {
    assert.equal(extractApiErrorMessage({ error: { message: 'upstream overloaded' } }), 'upstream overloaded');
    assert.equal(extractApiErrorMessage({ type: 'error', message: 'model unavailable' }), 'model unavailable');
    assert.equal(extractApiErrorMessage({ choices: [] }), '');
});

test('内容策略错误文字也会安全归类，不把上游回显带进错误对象', async () => {
    const upstreamMessage = 'Request blocked by content filter: 不应回显的服务端正文';
    assert.equal(isContentBlockedErrorMessage(upstreamMessage), true);
    await assert.rejects(
        readNonStreamingResponse(new Response(JSON.stringify({ error: { message: upstreamMessage } }), {
            headers: { 'content-type': 'application/json' },
        })),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && !error.message.includes('不应回显的服务端正文'),
    );
    await assert.rejects(
        readSSEStream(new Response(`data: ${JSON.stringify({ error: { message: upstreamMessage } })}\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
        })),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && !error.message.includes('不应回显的服务端正文'),
    );
});

test('API 运行层能累积 SSE 正文并保留结束原因', async () => {
    const chunks = [];
    const response = new Response([
        'data: {"choices":[{"delta":{"content":"第一段"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"第二段"},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
    ].join('\n'), { headers: { 'content-type': 'text/event-stream' } });
    const result = await readSSEStream(response, text => chunks.push(text), API_PROTOCOLS.OPENAI);
    assert.deepEqual(chunks, ['第一段', '第一段第二段']);
    assert.equal(result.text, '第一段第二段');
    assert.equal(result.stopReason, 'stop');
    assert.equal(result.rawStopReason, 'stop');
});

test('共用独立 API 流在长时间无新数据时结束等待并保留已收到正文', async () => {
    const chunks = [];
    let cancelled = false;
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"已收到半段"}}]}\n\n'));
        },
        cancel() {
            cancelled = true;
        },
    }), { headers: { 'content-type': 'text/event-stream' } });

    await assert.rejects(
        readSSEStream(response, text => chunks.push(text), API_PROTOCOLS.OPENAI, { idleTimeoutMs: 20 }),
        error => {
            assert.equal(error.code, 'THEATER_STREAM_IDLE_TIMEOUT');
            assert.equal(error.diagnosticSignal, REQUEST_DIAGNOSTIC_SIGNAL.TIMEOUT);
            return true;
        },
    );
    assert.deepEqual(chunks, ['已收到半段']);
    assert.equal(cancelled, true);
});

test('普通生成与长梦正文、排版共用同一个线路请求入口', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const longDreamRequest = source.slice(
        source.indexOf('async function requestLongDreamChapter'),
        source.indexOf('async function generateLongDreamCanonSuggestions'),
    );
    const finalRenderRequest = source.slice(
        source.indexOf('async function requestFinalRenderedHtml'),
        source.indexOf('function normalizeLongDreamResponseText'),
    );
    const ordinaryGeneration = source.slice(
        source.indexOf('async function runGeneration'),
        source.indexOf('function currentAutoInstruction'),
    );
    assert.match(longDreamRequest, /requestConfiguredGenerationApi/);
    assert.doesNotMatch(longDreamRequest, /settings\.apiMode|generateWithMainAPI|callCustomAPIStream/);
    assert.match(finalRenderRequest, /requestConfiguredGenerationApi/);
    assert.doesNotMatch(finalRenderRequest, /settings\.apiMode|generateWithMainAPI|callCustomAPIStream/);
    assert.match(ordinaryGeneration, /requestConfiguredGenerationApi/);
    assert.match(source, /function captureGenerationApiRoute/);
});

test('内容策略结束原因会被统一识别，不把用户指令直接定性为 NSFW', () => {
    assert.equal(contentBlockReason('content_filter'), 'content_filter');
    assert.equal(contentBlockReason('SAFETY'), 'safety');
    assert.equal(isContentBlockedStopReason('PROHIBITED_CONTENT'), true);
    assert.equal(isContentBlockedStopReason('length'), false);

    const openAi = extractResponseMeta({ choices: [{ finish_reason: 'content_filter' }] }, API_PROTOCOLS.OPENAI);
    const gemini = extractResponseMeta({ candidates: [{ finishReason: 'SAFETY' }] }, API_PROTOCOLS.OPENAI);
    const promptBlocked = extractResponseMeta({ promptFeedback: { blockReason: 'BLOCKLIST' } }, API_PROTOCOLS.OPENAI);
    assert.equal(openAi.stopReason, 'blocked');
    assert.equal(openAi.blockReason, 'content_filter');
    assert.equal(gemini.blockReason, 'safety');
    assert.equal(promptBlocked.blockReason, 'blocklist');
});

test('非流式内容过滤只给出固定错误信号，不回显服务端正文', async () => {
    const response = new Response(JSON.stringify({
        choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
        secret_echo: '不应出现在错误里',
    }), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(
        readNonStreamingResponse(response, () => {}, API_PROTOCOLS.OPENAI),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && error.message === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && error.theaterFailure?.rawStopReason === 'content_filter'
            && !error.message.includes('不应出现在错误里'),
    );
});

test('流式内容过滤不会被误当作空流而重发同一请求', async () => {
    let calls = 0;
    await assert.rejects(
        requestCustomApi({
            config: {
                apiUrl: 'https://example.com/v1',
                apiProtocol: API_PROTOCOLS.OPENAI,
                apiModel: 'test-model',
                maxOutputTokens: 1024,
            },
            systemPrompt: '系统',
            userPrompt: '用户',
            fetchImpl: async () => {
                calls += 1;
                return new Response('data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n', {
                    headers: { 'content-type': 'text/event-stream' },
                });
            },
        }),
        error => error.code === 'THEATER_CONTENT_FILTER' && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER,
    );
    assert.equal(calls, 1);
});

test('独立 API 遇到 429 会按 Retry-After 单次重试并读取非流式正文', async () => {
    const logs = [];
    let calls = 0;
    const result = await requestCustomApi({
        config: {
            apiUrl: 'https://example.com/v1',
            apiProtocol: API_PROTOCOLS.OPENAI,
            apiKey: 'test-key',
            apiModel: 'test-model',
            maxOutputTokens: 2048,
        },
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        log: (level, message, details) => logs.push({ level, message, details }),
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) return new Response('busy', { status: 429, headers: { 'retry-after': '0' } });
            return new Response(JSON.stringify({ choices: [{ message: { content: '重试成功' }, finish_reason: 'stop' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(calls, 2);
    assert.equal(result.text, '重试成功');
    assert.equal(logs.some(item => item.details?.auto_retry === true), true);
});

test('独立 API 空流会在同一轮改用非流式请求', async () => {
    const requestBodies = [];
    const chunks = [];
    const fallbacks = [];
    const result = await requestCustomApi({
        config: {
            apiUrl: 'https://example.com/v1',
            apiProtocol: API_PROTOCOLS.OPENAI,
            apiModel: 'test-model',
            maxOutputTokens: 1024,
        },
        systemPrompt: '系统',
        userPrompt: '用户',
        onChunk: text => chunks.push(text),
        onFallback: path => fallbacks.push(path),
        fetchImpl: async (_url, options) => {
            requestBodies.push(JSON.parse(options.body));
            if (requestBodies.length === 1) {
                return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
            }
            return new Response(JSON.stringify({ choices: [{ message: { content: '非流式恢复正文' }, finish_reason: 'stop' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0].stream, true);
    assert.equal(requestBodies[1].stream, false);
    assert.deepEqual(chunks, ['非流式恢复正文']);
    assert.equal(result.text, '非流式恢复正文');
    assert.deepEqual(fallbacks, ['custom:stream→non-stream']);
});

test('酒馆主 API 运行层优先使用 ChatCompletionService', async () => {
    const chunks = [];
    const requests = [];
    const ctx = {
        oai_settings: {
            chat_completion_source: 'openai',
            openai_model: 'main-model',
            openai_max_tokens: 4096,
        },
    };
    const result = await requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        onChunk: text => chunks.push(text),
        chatCompletionService: {
            processRequest: async request => {
                requests.push(request);
                return { choices: [{ message: { content: '主 API 正文' }, finish_reason: 'stop' }] };
            },
        },
        getContext: () => ctx,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'main-model');
    assert.equal(requests[0].max_tokens, 4096);
    assert.equal('tools' in requests[0], false);
    assert.equal('tool_choice' in requests[0], false);
    assert.deepEqual(chunks, ['主 API 正文']);
    assert.equal(result.text, '主 API 正文');
});

test('酒馆主 API 没有 ChatCompletionService 时复用 TavernHelper 路径', async () => {
    const paths = [];
    let helperOptions;
    const result = await requestMainApi({
        ctx: { oai_settings: { openai_model: 'main-model' } },
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: true,
        onPath: path => paths.push(path),
        tavernHelper: {
            generateRaw: async options => {
                helperOptions = options;
                return 'TavernHelper 正文';
            },
        },
        getContext: () => ({}),
    });
    assert.deepEqual(paths, ['main:TavernHelper']);
    assert.equal(helperOptions.should_stream, true);
    assert.equal(helperOptions.ordered_prompts[1].content, '用户');
    assert.deepEqual(helperOptions.injects, []);
    assert.equal('tools' in helperOptions, false);
    assert.equal('tool_choice' in helperOptions, false);
    assert.equal(result.text, 'TavernHelper 正文');
});

test('酒馆主 API 隐藏 thinking，且只有思考内容时不会降级重发', async () => {
    const ctx = { oai_settings: { chat_completion_source: 'openai', openai_model: 'main-model' } };
    const chunks = [];
    const result = await requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        onChunk: text => chunks.push(text),
        chatCompletionService: {
            processRequest: async () => ({ content: '<thinking>主线路思考</thinking>主线路正文' }),
        },
        getContext: () => ctx,
    });
    assert.equal(result.text, '主线路正文');
    assert.deepEqual(chunks, ['主线路正文']);

    let helperCalls = 0;
    await assert.rejects(() => requestMainApi({
        ctx,
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        chatCompletionService: {
            processRequest: async () => ({ content: '<thinking>只有思考</thinking>' }),
        },
        tavernHelper: {
            generateRaw: async () => {
                helperCalls++;
                return '不应重发';
            },
        },
        getContext: () => ctx,
    }), error => error?.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.REASONING_ONLY);
    assert.equal(helperCalls, 0);
});

test('酒馆主 API 无法识别 ChatCompletionService 字段时安全降级到 TavernHelper', async () => {
    const fallbacks = [];
    let serviceCalls = 0;
    let helperCalls = 0;
    const result = await requestMainApi({
        ctx: {},
        systemPrompt: '系统',
        userPrompt: '用户',
        shouldStream: false,
        chatCompletionService: {
            processRequest: async () => {
                serviceCalls++;
                return '不应调用';
            },
        },
        tavernHelper: {
            generateRaw: async () => {
                helperCalls++;
                return '兼容路径正文';
            },
        },
        getContext: () => ({}),
        onFallback: path => fallbacks.push(path),
    });
    assert.equal(serviceCalls, 0);
    assert.equal(helperCalls, 1);
    assert.deepEqual(fallbacks, ['main:ChatCompletionService']);
    assert.equal(result.text, '兼容路径正文');
});

test('酒馆主 API 的内容策略错误不会降级重发到 TavernHelper', async () => {
    let helperCalls = 0;
    await assert.rejects(
        requestMainApi({
            ctx: { oai_settings: { chat_completion_source: 'openai', openai_model: 'test-model' } },
            chatCompletionService: {
                processRequest: async () => { throw new Error('Request blocked by content filter: 不应重发的正文'); },
            },
            tavernHelper: {
                generateRaw: async () => {
                    helperCalls++;
                    return '不应该收到这里的正文';
                },
            },
            getContext: () => ({ oai_settings: { chat_completion_source: 'openai', openai_model: 'test-model' } }),
        }),
        error => error.code === 'THEATER_CONTENT_FILTER'
            && error.diagnosticSignal === REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER
            && !error.message.includes('不应重发的正文'),
    );
    assert.equal(helperCalls, 0);
});

test('连续续写只携带上一轮正文，并限制为最近 8000 字', () => {
    const previousRound = 'B'.repeat(MAX_CONTINUATION_CONTEXT_CHARS + 200);
    const context = continuationContextWindow(previousRound);
    assert.equal(context.endsWith('B'.repeat(MAX_CONTINUATION_CONTEXT_CHARS)), true);
    assert.equal(context.includes('A轮旧剧情'), false);
    assert.match(context, /更早内容已省略/);
    assert.equal(continuationContextWindow('本轮新增正文'), '本轮新增正文');
});

test('续写前情清理 HTML 排版空白，并按可读字符而非源码长度截取', () => {
    const indented = '\n        第一段。\n\n            第二段！        \n';
    assert.equal(normalizeContinuationText(indented), '第一段。\n\n第二段！');
    assert.equal(readableCharCount(normalizeContinuationText(indented)), 6);

    const whitespaceHeavy = `${'甲'.repeat(6)}\n\n${' '.repeat(200)}${'乙'.repeat(6)}`;
    const context = continuationContextWindow(whitespaceHeavy, 6);
    assert.equal(context.endsWith('乙'.repeat(6)), true);
    assert.equal(context.includes('甲'), false);
});

test('用户本轮指令位于前情之后、最终规则之前', () => {
    const payload = buildGenerationPayload({
        preset: '系统预设',
        context: '聊天前情',
        continuation: '续写前情',
        instruction: '用户本轮指令',
        rules: '渲染规则',
        fixed: '最终创作约束',
    });
    assert.equal(payload.systemPrompt, '系统预设');
    assert.ok(payload.userPrompt.indexOf('续写前情') < payload.userPrompt.indexOf('用户本轮指令'));
    assert.ok(payload.userPrompt.indexOf('用户本轮指令') < payload.userPrompt.indexOf('渲染规则'));
    assert.ok(payload.userPrompt.indexOf('渲染规则') < payload.userPrompt.indexOf('最终创作约束'));
});

test('预设 prompt_order 的多角色顺序与动态锚点保持结构，不再压成 system/user 两段', () => {
    const messages = composePresetMessages({
        presetEntries: [
            { id: 'main', role: 'system', content: 'SYS-MAIN' },
            { id: 'personaDescription', role: 'system', content: '' },
            { id: 'custom-user', role: 'user', content: 'USR-CUSTOM' },
            { id: 'chatHistory', role: 'system', content: '' },
            { id: 'post', role: 'assistant', content: 'AST-POST' },
        ],
        slots: { personaDescription: 'PERSONA-SLOT' },
        chatMessages: [
            { role: 'user', content: 'CHAT-USER' },
            { role: 'assistant', content: 'CHAT-AST' },
        ],
        tailMessages: [{ role: 'user', content: 'CURRENT-INSTRUCTION', source: 'theater' }],
    });
    assert.deepEqual(messages.map(message => message.role), [
        'system', 'system', 'user', 'user', 'assistant', 'assistant', 'user',
    ]);
    assert.deepEqual(messages.map(message => message.content), [
        'SYS-MAIN', 'PERSONA-SLOT', 'USR-CUSTOM', 'CHAT-USER', 'CHAT-AST', 'AST-POST', 'CURRENT-INSTRUCTION',
    ]);
});

test('插件直接读取酒馆预设角色与绝对深度，并只压合相邻 system 段', () => {
    const messages = composePresetMessages({
        presetEntries: [
            { id: 'sys-a', role: 'system', content: 'SYSTEM-A', injectionPosition: 0 },
            { id: 'sys-b', role: 'system', content: 'SYSTEM-B', injectionPosition: 0 },
            { id: 'assistant-break', role: 'assistant', content: 'ASSISTANT-BREAK', injectionPosition: 0 },
            { id: 'sys-c', role: 'system', content: 'SYSTEM-C', injectionPosition: 0 },
            { id: 'depth-user', role: 'user', content: 'DEPTH-USER', injectionPosition: 1, injectionDepth: 1, injectionOrder: 80 },
            { id: 'chatHistory', role: 'system', content: '' },
        ],
        chatMessages: [
            { role: 'user', content: 'CHAT-OLD' },
            { role: 'assistant', content: 'CHAT-LATEST' },
        ],
        squashSystemMessages: true,
    });
    assert.deepEqual(messages.map(message => message.role), [
        'system', 'assistant', 'system', 'user', 'user', 'assistant',
    ]);
    assert.equal(messages[0].content, 'SYSTEM-A\n\nSYSTEM-B');
    assert.equal(messages[1].content, 'ASSISTANT-BREAK');
    assert.equal(messages[4].content, 'DEPTH-USER');
    assert.equal(messages.filter(message => message.content === 'DEPTH-USER').length, 1);
    assert.deepEqual(
        squashAdjacentSystemMessages([
            { role: 'system', content: '一' },
            { role: 'system', content: '二' },
            { role: 'assistant', content: '断开' },
            { role: 'system', content: '三' },
        ]).map(message => message.content),
        ['一\n\n二', '断开', '三'],
    );
});

test('世界书深度原样读取，不被插件自行限制为固定档位', () => {
    assert.equal(normalizeWorldInfoEntry({ content: '深层条目', position: 4, depth: 0 }).depth, 0);
    assert.equal(normalizeWorldInfoEntry({ content: '深层条目', position: 4, depth: 100 }).depth, 100);
    assert.equal(normalizeWorldInfoEntry({ content: '深层条目', position: 4, depth: 1000 }).depth, 1000);
});

test('世界书八种位置、同深度顺序和 outlet 宏按酒馆语义进入消息布局', () => {
    const wi = [
        { uid: 1, position: WORLD_INFO_POSITION.BEFORE_CHARACTER, order: 20, content: 'WB-BEFORE' },
        { uid: 2, position: WORLD_INFO_POSITION.AFTER_CHARACTER, order: 20, content: 'WB-AFTER' },
        { uid: 3, position: WORLD_INFO_POSITION.AUTHOR_NOTE_TOP, order: 20, content: 'AN-TOP' },
        { uid: 4, position: WORLD_INFO_POSITION.AUTHOR_NOTE_BOTTOM, order: 20, content: 'AN-BOTTOM' },
        { uid: 5, position: WORLD_INFO_POSITION.EXAMPLES_TOP, order: 20, content: 'EXAMPLE-TOP' },
        { uid: 6, position: WORLD_INFO_POSITION.EXAMPLES_BOTTOM, order: 20, content: 'EXAMPLE-BOTTOM' },
        { uid: 7, position: WORLD_INFO_POSITION.AT_DEPTH, depth: 1, order: 10, role: 1, content: 'DEPTH-FIRST' },
        { uid: 8, position: WORLD_INFO_POSITION.AT_DEPTH, depth: 1, order: 30, role: 2, content: 'DEPTH-SECOND' },
        { uid: 9, position: WORLD_INFO_POSITION.OUTLET, outletName: 'Lore', order: 20, content: 'OUTLET-ONLY-HERE' },
    ];
    const messages = composePresetMessages({
        presetEntries: [
            { id: 'worldInfoBefore', role: 'system', content: '' },
            { id: 'charDescription', role: 'system', content: '' },
            { id: 'worldInfoAfter', role: 'system', content: '' },
            { id: 'dialogueExamples', role: 'system', content: '' },
            { id: 'outlet-holder', role: 'system', content: '宏：{{outlet::Lore}}' },
            { id: 'chatHistory', role: 'system', content: '' },
        ],
        slots: { charDescription: 'CHAR', dialogueExamples: 'EXAMPLES' },
        worldInfoEntries: wi,
        chatMessages: [
            { role: 'user', content: 'CHAT-1' },
            { role: 'assistant', content: 'CHAT-2' },
        ],
    });
    const content = messages.map(message => message.content);
    assert.deepEqual(content, [
        'WB-BEFORE', 'CHAR', 'WB-AFTER', 'EXAMPLE-TOP\n\nEXAMPLES\n\nEXAMPLE-BOTTOM',
        '宏：OUTLET-ONLY-HERE', 'AN-TOP', 'CHAT-1', 'DEPTH-FIRST', 'DEPTH-SECOND', 'CHAT-2', 'AN-BOTTOM',
    ]);
    assert.equal(content.filter(text => text.includes('OUTLET-ONLY-HERE')).length, 1);
    assert.equal(messages[7].role, 'user');
    assert.equal(messages[8].role, 'assistant');
});

test('请求后处理始终转换为 no-tools 变体，并清除 tool/function 消息与工具字段', () => {
    const source = [
        { role: 'system', content: '系统' },
        { role: 'assistant', content: '助手先说', tool_calls: [{ id: '不应保留' }] },
        { role: 'tool', content: '工具结果' },
        { role: 'user', content: '用户', tool_call_id: '不应保留' },
    ];
    const strict = applyPromptPostProcessing(source, PROMPT_POST_PROCESSING.STRICT_TOOLS);
    assert.deepEqual(strict.map(message => message.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(strict.some(message => message.content === '工具结果'), false);
    assert.equal(strict.every(message => !('tool_calls' in message) && !('tool_call_id' in message)), true);
    assert.deepEqual(normalizeRequestMessages(source).map(message => message.role), ['system', 'assistant', 'user']);
});

test('创作请求结构来自传输层输入且不包含正文、Key、Authorization 或接口 URL', async () => {
    let traceInput;
    let wireBody;
    await requestCustomApi({
        config: {
            apiUrl: 'https://secret-host.example/v1', apiProtocol: API_PROTOCOLS.OPENAI,
            apiKey: 'sk-super-secret-value', apiModel: 'trace-model', maxOutputTokens: 1024,
        },
        messages: [
            { role: 'system', content: '系统', source: 'preset', sourceId: 'main' },
            { role: 'user', content: '用户', source: 'theater', sourceId: 'instruction' },
        ],
        shouldStream: false,
        onRequest: input => { traceInput = input; },
        fetchImpl: async (_url, options) => {
            wireBody = JSON.parse(options.body);
            return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    assert.deepEqual(traceInput.messages.map(({ role, content }) => ({ role, content })), wireBody.messages);
    const report = formatRequestTrace(createRequestTrace(traceInput));
    assert.doesNotMatch(report, /sk-super-secret|secret-host\.example|Authorization/i);
    assert.match(report, /工具：已强制禁用/);
    assert.doesNotMatch(report, /系统|用户|request\/system|request\/user/);
    assert.match(report, /system · preset\/main · 2 字符 · 约 3 token/);
    assert.match(report, /user · theater\/instruction · 2 字符 · 约 3 token/);
});

test('诊断界面只展示创作请求结构，不渲染或复制真实消息正文', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /查看创作请求结构/);
    assert.match(source, /tracePurpose: round === 1 \? 'creative' : 'continuation'/);
    assert.match(source, /if \(purpose !== 'creative'\) return/);
    assert.doesNotMatch(source.match(/function runDiagnostics\(\)[\s\S]*?\n\}/)?.[0] || '', /message\.content|<pre>/);
});

test('429 限流识别支持 Retry-After 秒数、日期和常见错误文字', () => {
    assert.equal(retryAfterMilliseconds('2.5', 0), 2500);
    assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:08 GMT', 5000), 3000);
    assert.equal(retryAfterMilliseconds('invalid', 0), null);
    assert.equal(isRateLimitErrorMessage('429 Too Many Requests'), true);
    assert.equal(isRateLimitErrorMessage('RESOURCE_EXHAUSTED: quota exceeded'), true);
    assert.equal(isRateLimitErrorMessage('普通参数错误'), false);
});

test('聊天前文楼层数支持 0、任意正整数并限制异常值', () => {
    assert.equal(MAX_CONTEXT_MESSAGES, 500);
    assert.equal(normalizeContextRange(0), 0);
    assert.equal(normalizeContextRange('5'), 5);
    assert.equal(normalizeContextRange(10.9), 10);
    assert.equal(normalizeContextRange(-4), 0);
    assert.equal(normalizeContextRange(MAX_CONTEXT_MESSAGES + 50), MAX_CONTEXT_MESSAGES);
    assert.equal(normalizeContextRange('not-a-number'), 10);
});

test('酒馆主 API 在请求日志和实际请求前都能解析出模型名', () => {
    assert.equal(resolveMainApiModel({ getChatCompletionModel: () => 'main-model' }, { model: 'fallback' }), 'main-model');
    assert.equal(resolveMainApiModel({}, { openai_model: 'openai-model' }), 'openai-model');
    assert.equal(resolveMainApiModel({}, { model: 'legacy-model' }), 'legacy-model');
    assert.equal(resolveMainApiModel({}, {}), '');
});

test('聊天前文设为 0 时不读取任何消息，而不是误读全部消息', () => {
    const messages = Array.from({ length: 12 }, (_, index) => `第${index + 1}条`);
    assert.deepEqual(takeRecentMessages(messages, 0), []);
    assert.deepEqual(takeRecentMessages(messages, 5), messages.slice(-5));
    assert.deepEqual(takeRecentMessages(messages, 10), messages.slice(-10));
});

test('Token 分类相加等于总数', () => {
    const result = estimateTokenBreakdown({ preset: '预设内容', context: '聊天上下文', instruction: '写一段故事' });
    assert.equal(result.total, result.preset + result.context + result.instruction);
});

test('世界书勾选上限与生成预览复用同一个 Token 估算口径', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const worldBookText = `世界书设定：\n${['第一条设定。', '第二条设定。'].join('\n\n')}`;
    assert.equal(estimateTokenBreakdown({ worldBook: worldBookText }).worldBook, estimateTokenCount(worldBookText));
    const updateSource = source.match(/function updateWBCount\(\)[\s\S]*?\n\}/)?.[0] || '';
    assert.match(updateSource, /estimateTokenCount\(worldBookText\)/);
    assert.match(updateSource, /已勾选上限约/);
    assert.doesNotMatch(updateSource, /chars\s*\/\s*1\.5/);
});

test('关闭上下文后的 payload 不包含聊天内容', () => {
    const payload = buildGenerationPayload({ preset: '系统预设', context: '', instruction: '用户指令' });
    assert.equal(payload.userPrompt.includes('聊天秘密'), false);
    assert.equal(payload.userPrompt.includes('用户指令'), true);
});

test('OpenAI 请求使用 chat completions 与 Bearer', () => {
    const req = buildApiRequest({ url: 'https://example.com/v1', protocol: API_PROTOCOLS.OPENAI, key: 'secret', model: 'm', systemPrompt: 's', userPrompt: 'u' });
    assert.equal(req.endpoint, 'https://example.com/v1/chat/completions');
    assert.equal(req.headers.Authorization, 'Bearer secret');
    assert.equal(req.body.messages[0].role, 'system');
    assert.equal('tools' in req.body, false);
    assert.equal('tool_choice' in req.body, false);
});

test('独立 API 只使用显式配置，不读取或改写酒馆主线路', async () => {
    const originalOaiSettings = globalThis.oai_settings;
    globalThis.oai_settings = { openai_model: 'main-model', api_key: 'main-secret' };
    let captured;
    try {
        const result = await requestCustomApi({
            config: {
                apiUrl: 'https://custom.example/v1',
                apiProtocol: API_PROTOCOLS.OPENAI,
                apiKey: 'custom-secret',
                apiModel: 'custom-model',
                maxOutputTokens: 2048,
            },
            systemPrompt: '系统',
            userPrompt: '用户',
            shouldStream: false,
            fetchImpl: async (url, options) => {
                captured = { url, options, body: JSON.parse(options.body) };
                return new Response(JSON.stringify({
                    choices: [{ message: { content: '独立线路正文' } }],
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            },
        });

        assert.equal(captured.url, 'https://custom.example/v1/chat/completions');
        assert.equal(captured.options.headers.Authorization, 'Bearer custom-secret');
        assert.equal(captured.body.model, 'custom-model');
        assert.equal(JSON.stringify(captured).includes('main-secret'), false);
        assert.equal(result.text, '独立线路正文');
        assert.deepEqual(globalThis.oai_settings, { openai_model: 'main-model', api_key: 'main-secret' });
    } finally {
        globalThis.oai_settings = originalOaiSettings;
    }
});

test('两个独立 API 连接并发请求时各自只携带自己的地址、模型和 Key', async () => {
    const seen = [];
    const run = (label, apiUrl, apiKey, apiModel) => requestCustomApi({
        config: { apiUrl, apiKey, apiModel, apiProtocol: API_PROTOCOLS.OPENAI, maxOutputTokens: 1024 },
        systemPrompt: `系统-${label}`,
        userPrompt: `用户-${label}`,
        shouldStream: false,
        fetchImpl: async (url, options) => {
            seen.push({ label, url, authorization: options.headers.Authorization, body: JSON.parse(options.body) });
            return new Response(JSON.stringify({ choices: [{ message: { content: `完成-${label}` } }] }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        },
    });
    await Promise.all([
        run('A', 'https://a.example/v1', 'key-a', 'model-a'),
        run('B', 'https://b.example/v1', 'key-b', 'model-b'),
    ]);
    const a = seen.find(item => item.label === 'A');
    const b = seen.find(item => item.label === 'B');
    assert.equal(a.url, 'https://a.example/v1/chat/completions');
    assert.equal(a.authorization, 'Bearer key-a');
    assert.equal(a.body.model, 'model-a');
    assert.equal(a.body.messages[1].content, '用户-A');
    assert.equal(b.url, 'https://b.example/v1/chat/completions');
    assert.equal(b.authorization, 'Bearer key-b');
    assert.equal(b.body.model, 'model-b');
    assert.equal(b.body.messages[1].content, '用户-B');
});

test('单轮输出默认 16384，低上限模型按标准档位回落', () => {
    assert.equal(DEFAULT_MAX_OUTPUT_TOKENS, 16384);
    assert.equal(normalizeMaxTokens(undefined), 16384);
    assert.deepEqual(maxTokenFallbackSequence(16384), [16384, 8192, 4096, 2048, 1024, 512, 256]);
    assert.equal(isMaxTokenLimitError(400, 'max_tokens must be less than or equal to 8192'), true);
    assert.equal(isMaxTokenLimitError(400, 'status_code=400,上下文窗口已满。减少对话历史记录、系统提示或工具'), true);
    assert.equal(isMaxTokenLimitError(401, 'invalid api key'), false);
});

test('API 预设保存地址、协议、Key、模型和输出上限', () => {
    const preset = createApiPresetFromConfig('备用线路', {
        apiUrl: 'https://api.example.com/v1///',
        apiKey: 'secret-key',
        apiModel: 'model-name',
        apiProtocol: 'anthropic',
        maxOutputTokens: 8192,
    }, 'preset-1');
    assert.deepEqual(preset, {
        id: 'preset-1', name: '备用线路', apiUrl: 'https://api.example.com/v1', apiKey: 'secret-key',
        apiModel: 'model-name', apiProtocol: 'anthropic', maxOutputTokens: 8192,
    });
});

test('API 预设会过滤空名称和重复名称，并提供全部 Key 给日志脱敏', () => {
    const presets = normalizeApiPresetList([
        { id: 'one', name: '主线路', apiKey: 'key-one' },
        { id: 'two', name: '主线路', apiKey: 'duplicate' },
        { id: 'three', name: '', apiKey: 'empty-name' },
        { id: 'four', name: '备用线路', apiKey: 'key-two' },
    ]);
    assert.deepEqual(presets.map(item => item.name), ['主线路', '备用线路']);
    assert.deepEqual(apiPresetSecretValues(presets), ['key-one', 'key-two']);
});

test('未启用的 API 预设 Key 也不会进入可复制日志', () => {
    clearRuntimeLogs();
    const presets = normalizeApiPresetList([{ id: 'backup', name: '备用', apiKey: 'inactive-secret-key' }]);
    setRuntimeLogSecretProvider(() => ['current-secret-key', ...apiPresetSecretValues(presets)]);
    writeRuntimeLog('error', '请求失败', { current: 'current-secret-key', backup: 'inactive-secret-key' });
    const output = formatRuntimeLogs();
    assert.doesNotMatch(output, /current-secret-key|inactive-secret-key/);
    assert.match(output, /\[REDACTED\]/);
    clearRuntimeLogs();
});

test('TXT 指令导入兼容 Windows、Unix 和旧式换行', () => {
    assert.deepEqual(splitInstructionTextFile('第一条\r\n---\r\n第二条'), ['第一条', '第二条']);
    assert.deepEqual(splitInstructionTextFile('第一条\n --- \n第二条'), ['第一条', '第二条']);
    assert.deepEqual(splitInstructionTextFile('第一条\r---\r第二条'), ['第一条', '第二条']);
});

test('TXT 指令导入只把独立一行的三横线视为分隔符', () => {
    assert.deepEqual(splitInstructionTextFile('正文里的---不是分隔符\r\n下一行'), ['正文里的---不是分隔符\n下一行']);
});

test('指令备份跨设备导入时保留分组与空文件夹', () => {
    const exported = createInstructionBackup(['甜文', '空文件夹'], [
        { name: '雨夜', content: '写雨夜重逢', group: '甜文' },
        { name: '散装', content: '写一顿晚饭' },
    ]);
    const restored = parseInstructionBackup(JSON.parse(JSON.stringify(exported)));
    assert.deepEqual(restored.groups, ['甜文', '空文件夹']);
    assert.equal(restored.templates[0].group, '甜文');
    assert.equal(restored.templates[1].group, undefined);
});

test('世界书读取并区分酒馆蓝灯、绿灯与链式策略', () => {
    assert.equal(worldBookEntryStrategy({ constant: true }), WORLD_BOOK_STRATEGIES.BLUE);
    assert.equal(worldBookEntryStrategy({ constant: false }), WORLD_BOOK_STRATEGIES.GREEN);
    assert.equal(worldBookEntryStrategy({ vectorized: true }), WORLD_BOOK_STRATEGIES.CHAIN);
    assert.equal(shouldReadWorldBookEntry({ constant: true }, 'lights'), true);
    assert.equal(shouldReadWorldBookEntry({ constant: false }, 'lights'), true);
    assert.equal(shouldReadWorldBookEntry({ vectorized: true }, 'lights'), false);
    assert.equal(shouldReadWorldBookEntry({ constant: true, disable: true }, 'lights'), false);
});

test('切换角色卡会撤下上一张卡自动跟随的世界书，并保留用户手选', () => {
    assert.deepEqual(
        syncFollowedWorldBooks(
            ['手选设定', '旧角色绑定', '旧聊天绑定'],
            ['旧角色绑定', '旧聊天绑定'],
            ['新角色绑定', '新角色绑定', ''],
        ),
        {
            selectedBooks: ['手选设定', '新角色绑定'],
            followedBooks: ['新角色绑定'],
        },
    );
});

test('关闭角色卡跟随后会撤下自动组但保留手选世界书', () => {
    assert.deepEqual(
        syncFollowedWorldBooks(['手选设定', '角色绑定'], ['角色绑定'], []),
        { selectedBooks: ['手选设定'], followedBooks: [] },
    );
});

test('世界书新增条目在反复切换角色卡后仍保持未勾选', () => {
    const firstLoad = rememberWorldBookEntryStates(['原条目'], undefined, {});
    assert.deepEqual(firstLoad, { knownKeys: ['原条目'], savedStates: {} });

    const afterScriptAppend = rememberWorldBookEntryStates(
        ['原条目', '新增记忆'],
        firstLoad.knownKeys,
        firstLoad.savedStates,
    );
    assert.equal(afterScriptAppend.savedStates['原条目'], undefined);
    assert.equal(afterScriptAppend.savedStates['新增记忆'], false);

    const afterSwitchingBack = rememberWorldBookEntryStates(
        ['原条目', '新增记忆'],
        afterScriptAppend.knownKeys,
        afterScriptAppend.savedStates,
    );
    assert.equal(afterSwitchingBack.savedStates['新增记忆'], false);
    assert.deepEqual(afterSwitchingBack.knownKeys, ['原条目', '新增记忆']);
});

test('普通小剧场主角锚定当前 User 与 Char，避免示例姓名抢占主角', () => {
    const anchor = buildProtagonistAnchor({ userName: '禾禾', charName: '麓' });
    assert.match(anchor, /当前 User（禾禾）与当前 Char（麓）/);
    assert.match(anchor, /不得把预设、示例对话或世界书中的其他姓名替换为本篇主角/);
    assert.match(anchor, /除非本轮用户指令明确要求更换主角/);
});

test('小剧场把勾选条目交给酒馆扫描，并只接回本轮触发结果', async () => {
    let listener;
    let removed = false;
    const eventSource = {
        on(_event, callback) { listener = callback; },
        removeListener(_event, callback) { removed = callback === listener; listener = null; },
    };
    const entries = [
        { uid: 1, world: '测试书', constant: true, content: '蓝灯内容' },
        { uid: 2, world: '测试书', constant: false, key: ['月亮'], content: '命中绿灯' },
        { uid: 3, world: '测试书', constant: false, key: ['太阳'], content: '未命中绿灯' },
    ];
    const activated = await scanWorldBookEntriesWithSillyTavern({
        entries,
        chat: ['User: 今晚一起看月亮'],
        maxContext: 8192,
        globalScanData: { trigger: 'quiet' },
        eventSource,
        eventType: 'worldinfo_entries_loaded',
        checkWorldInfo: async chat => {
            const payload = { globalLore: [{ uid: 99 }], characterLore: [{ uid: 98 }], chatLore: [], personaLore: [] };
            await listener(payload);
            assert.deepEqual(payload.globalLore.map(entry => entry.uid), [1, 2, 3]);
            assert.deepEqual(payload.characterLore, []);
            const scanText = chat.join('\n');
            const matches = payload.globalLore.filter(entry => entry.constant || entry.key?.some(key => scanText.includes(key)));
            return { allActivatedEntries: new Set(matches) };
        },
    });
    assert.deepEqual(activated.map(entry => entry.content), ['蓝灯内容', '命中绿灯']);
    assert.equal(removed, true);
});

test('Anthropic 请求使用 messages 与 x-api-key', () => {
    const req = buildApiRequest({ url: 'https://example.com', protocol: API_PROTOCOLS.ANTHROPIC, key: 'secret', model: 'm', systemPrompt: 's', userPrompt: 'u' });
    assert.equal(req.endpoint, 'https://example.com/v1/messages');
    assert.equal(req.headers['x-api-key'], 'secret');
    assert.equal(req.body.system, 's');
    assert.equal('tools' in req.body, false);
    assert.equal('tool_choice' in req.body, false);
});

test('两种协议都能解析长度停止原因', () => {
    assert.equal(extractResponseMeta({ choices: [{ finish_reason: 'length' }] }, API_PROTOCOLS.OPENAI).stopReason, 'length');
    assert.equal(extractResponseMeta({ stop_reason: 'max_tokens' }, API_PROTOCOLS.ANTHROPIC).stopReason, 'length');
    assert.equal(extractResponseMeta({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, API_PROTOCOLS.OPENAI).stopReason, 'length');
});

test('HTML 网关错误页不会被当作模型正文', () => {
    assert.equal(isHtmlErrorResponse('text/html; charset=UTF-8', 'Cloudflare error'), true);
    assert.equal(isHtmlErrorResponse('text/plain', '<!DOCTYPE html><html><body>524</body></html>'), true);
    assert.equal(isHtmlErrorResponse('text/plain', '<article>合法的小剧场片段</article>'), false);
});

test('自动续写达到目标的 90% 后停止', () => {
    const job = createGenerationJob({ targetChars: 100, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(50), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    addGenerationSegment(job, '字'.repeat(39), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round++;
    addGenerationSegment(job, '字', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.actualChars, 90);
    assert.equal(targetCompletionChars(100), 90);
});

test('续写提示携带当前、目标和本轮篇幅，但不携带原始指令或 HTML 结构', () => {
    const prompt = buildContinuationInstruction({
        round: 2,
        tail: '上一段结尾原文',
        finishThisRound: false,
        currentChars: 3200,
        targetChars: 5000,
        roundsRemaining: 2,
    });
    const payload = buildContinuationPayload({ instruction: prompt });
    assert.match(payload.userPrompt, /上一段结尾原文/);
    assert.match(payload.userPrompt, /只输出新增正文片段/);
    assert.match(payload.userPrompt, /当前可读正文约 3200 字/);
    assert.match(payload.userPrompt, /目标约 5000 字/);
    assert.match(payload.userPrompt, /仍差约 1800 字/);
    assert.match(payload.userPrompt, /本轮请新增约 1100 字/);
    assert.doesNotMatch(payload.userPrompt, /原始要求/);
    assert.doesNotMatch(payload.userPrompt, /输出完整 HTML/);

    const longFinalRound = buildContinuationInstruction({
        round: 2,
        tail: '长篇上半篇结尾',
        finishThisRound: true,
        currentChars: 3600,
        targetChars: 8000,
        roundsRemaining: 1,
    });
    assert.match(longFinalRound, /仍差约 4400 字/);
    assert.match(longFinalRound, /本轮请新增约 5300 字/);
    assert.match(longFinalRound, /可以.*自然收束结局/);
});

test('四档分诊边界保留，首轮明确告诉模型目标正文字数', () => {
    assert.equal(classifyLengthTier(null), LENGTH_TIERS.UNSPECIFIED);
    assert.equal(classifyLengthTier(3000), LENGTH_TIERS.SHORT);
    assert.equal(classifyLengthTier(3001), LENGTH_TIERS.COMFORT);
    assert.equal(classifyLengthTier(5000), LENGTH_TIERS.COMFORT);
    assert.equal(classifyLengthTier(5001), LENGTH_TIERS.LONG);
    assert.match(firstRoundGuidance(2000), /目标约为 2000 字/);
    assert.match(firstRoundGuidance(8000), /目标约为 8000 字/);
    assert.match(firstRoundGuidance(8000), /不含 HTML、CSS、JavaScript 和排版代码/);
    assert.match(firstRoundGuidance(8000), /不要在正文中报告或标注字数/);
    assert.doesNotMatch(firstRoundGuidance(8000), /写满|统计注释/);
});

test('5000 字起正文与 HTML 分离，8000 字起进入上下篇模式', () => {
    assert.equal(STAGED_RENDER_THRESHOLD, 5000);
    assert.equal(LONG_FORM_SPLIT_THRESHOLD, 8000);
    assert.equal(isStagedRenderTarget(4999), false);
    assert.equal(isStagedRenderTarget(5000), true);
    assert.equal(isStagedRenderTarget(7500), true);
    assert.equal(isLongFormTarget(7999), false);
    assert.equal(isLongFormTarget(8000), true);
    assert.equal(longFormFirstRoundTarget(8000), 4000);
    assert.equal(longFormFirstRoundTarget(6500), 3300);
    const guidance = longFormFirstRoundGuidance(8000);
    assert.match(guidance, /总目标约为 8000 字/);
    assert.match(guidance, /上半篇纯文字正文，目标约 4000 字/);
    assert.match(guidance, /停在剧情中段/);
    assert.match(guidance, /不要总结、收束、写出结局/);
    assert.match(guidance, /不要.*未完待续/);
});

test('明确字数由程序解析、从原指令清理后作为统一篇幅目标发给首轮模型', () => {
    for (const source of ['写一个8000字的小剧场', '正文至少八千字，写雨夜重逢', '篇幅5000字左右；围绕误会展开']) {
        const target = parseTargetWordCount(source);
        assert.ok(target >= 5000);
        const cleaned = stripTargetWordCountRequirement(source);
        assert.doesNotMatch(cleaned, /8000|5000|八千|字左右|至少.*字/);
        assert.match(firstRoundGuidance(target), new RegExp(`目标约为 ${target} 字`));
    }
    assert.equal(stripTargetWordCountRequirement('写一个8000字的小剧场'), '写一个小剧场');
});

test('独立目标字数默认不接管，开启后覆盖指令中的目标', () => {
    assert.equal(resolveTargetWordCount('写5000字'), 5000);
    assert.equal(resolveTargetWordCount('写5000字', { manualEnabled: true, manualTarget: 8000 }), 8000);
    assert.equal(resolveTargetWordCount('没有字数要求', { manualEnabled: true, manualTarget: 2000 }), 2000);
});

test('旧用户升级时默认开启目标字数自动补写，迁移只执行一次', () => {
    const settings = { autoContinue: false };
    assert.equal(migrateAutoContinueDefault(settings), true);
    assert.equal(settings.autoContinue, true);
    assert.equal(settings.autoContinueSchema, AUTO_CONTINUE_SCHEMA);
    settings.autoContinue = false;
    assert.equal(migrateAutoContinueDefault(settings), false);
    assert.equal(settings.autoContinue, false);
});

test('动态收束轮正常完成但不足 90% 时直接结束，不再请求', () => {
    const job = createGenerationJob({ targetChars: 1000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(500), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(shouldAuthorizeFinishRound(job, readableCharCount), true);
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '字'.repeat(300), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.actualChars, 800);
    assert.equal(job.completedBelowTarget, true);
    assert.equal(job.round, 2);
});

test('动态收束轮若被 Token 截断，仍可在轮数范围内继续', () => {
    const job = createGenerationJob({ targetChars: 1000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(500), 'stop');
    job.round++;
    authorizeFinish(job, true);
    addGenerationSegment(job, '字'.repeat(300), 'length');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    assert.equal(job.completedBelowTarget, false);
});

test('长篇上下篇至少执行两轮，即使上篇字数已碰到整篇阈值', () => {
    const job = createGenerationJob({ targetChars: 8000, maxRounds: 2, minimumRounds: 2, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(8000), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), true);
    job.round = 2;
    addGenerationSegment(job, '下篇收束', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('普通目标字数仍可在首轮达标后停止', () => {
    const job = createGenerationJob({ targetChars: 4000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(4000), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('多轮正文的最终 HTML 排版要求完整保留正文', () => {
    const payload = buildFinalRenderPayload({ sourceText: '第一段。\n\n第二段。', rules: '输出完整 HTML。' });
    assert.match(payload.systemPrompt, /不续写、不删减、不改写/);
    assert.deepEqual(payload.placeholderPlan.paragraphs.map(item => item.text), ['第一段。', '第二段。']);
    assert.match(payload.userPrompt, /段落占位|token/);
    assert.match(payload.userPrompt, /输出完整 HTML/);
});

test('达到最大轮数或用户停止后不再续写', () => {
    const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(1000), 'length');
    job.round = 3;
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    job.round = 1;
    abortGenerationJob(job);
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('5000 字首轮 1700 字，无论正常停止或长度停止都继续', () => {
    for (const reason of ['stop', 'length']) {
        const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
        addGenerationSegment(job, '字'.repeat(1700), reason);
        assert.equal(shouldContinueJob(job, readableCharCount), true);
    }
});

test('三轮仍不足时绝不进入第四轮', () => {
    const job = createGenerationJob({ targetChars: 5000, maxRounds: 3, autoContinue: true });
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    job.round = 2;
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    job.round = 3;
    addGenerationSegment(job, '字'.repeat(1100), 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
    assert.equal(job.segments.length, 3);
});

test('没有目标字数时只生成一轮', () => {
    const job = createGenerationJob({ targetChars: null, maxRounds: 10, autoContinue: true });
    addGenerationSegment(job, '普通内容', 'stop');
    assert.equal(shouldContinueJob(job, readableCharCount), false);
});

test('安全 iframe 永远不开放 allow-same-origin', () => {
    assert.equal(sandboxPermissions(false), 'allow-scripts');
    assert.equal(sandboxPermissions(true), 'allow-scripts');
    assert.equal(sandboxPermissions(true).includes('allow-same-origin'), false);
});

test('安全 iframe 在 body 末尾注入尺寸与可见正文上报脚本', () => {
    const html = injectResizeReporter('<html><body><p>正文</p></body></html>');
    assert.match(html, /st-theater:height/);
    assert.match(html, /textLength/);
    assert.match(html, /cloneNode\(true\)/);
    assert.match(html, /script, style, noscript, template, svg/);
    assert.ok(html.indexOf('st-theater:height') < html.indexOf('</body>'));
});

test('请求诊断记录开始、首字、完成和 fallback 时间', () => {
    const metrics = createRequestMetrics('main:first');
    metrics.requestStartedAt = 1000;
    const originalNow = Date.now;
    try {
        Date.now = () => 1120;
        markFirstToken(metrics);
        Date.now = () => 1400;
        markFallback(metrics, 'main:first');
        Date.now = () => 1800;
        markCompleted(metrics);
    } finally {
        Date.now = originalNow;
    }
    const summary = summarizeMetrics(metrics);
    assert.match(summary, /首字 \+120ms/);
    assert.match(summary, /主体完成 \+800ms/);
    assert.match(summary, /fallback \+400ms/);
});

test('请求诊断能把 HTTP 与内容过滤错误映射成稳定信号', () => {
    const contentFilter = classifyRequestFailure(createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER, {
        code: 'THEATER_CONTENT_FILTER', rawStopReason: 'content_filter',
    }), { stage: '正文生成' });
    assert.equal(contentFilter.signal, 'T-API-CONTENT-FILTER');
    assert.equal(contentFilter.rawStopReason, 'content_filter');
    assert.match(contentFilter.detail, /不等于本轮指令一定含 NSFW/);

    const server = classifyRequestFailure({
        code: 'THEATER_HTTP_STATUS',
        theaterFailure: { status: 500 },
    }, { stage: '正文生成' });
    assert.equal(server.signal, 'T-HTTP-500');
    assert.equal(diagnosticSignalInfo(server.signal).title, '上游或中转服务器异常');

    const rateLimit = classifyRequestFailure({
        code: 'THEATER_HTTP_STATUS',
        theaterFailure: { status: 429 },
    });
    assert.equal(rateLimit.signal, 'T-HTTP-429');
});

test('请求计时会记录最终错误信号', () => {
    const metrics = createRequestMetrics('custom:openai');
    metrics.requestStartedAt = 1000;
    const originalNow = Date.now;
    try {
        Date.now = () => 1250;
        markFailed(metrics, 'T-API-EMPTY');
    } finally {
        Date.now = originalNow;
    }
    assert.match(summarizeMetrics(metrics), /失败 \+250ms（T-API-EMPTY）/);
});

test('自动模式只从有正文的模板中抽取，并给空来源稳定信号', () => {
    const missing = resolveAutoInstruction({ source: '__last__', lastInstruction: '' });
    assert.equal(missing.text, '');
    assert.equal(missing.signal, 'T-AUTO-NO-INSTRUCTION');

    const resolved = resolveAutoInstruction({
        source: '__all__',
        templates: [{ content: '' }, { content: '  有效指令  ' }],
        random: () => 0,
    });
    assert.equal(resolved.text, '有效指令');
    assert.equal(resolved.candidateCount, 1);
    assert.equal(resolved.signal, null);

    const missingGroup = resolveAutoInstruction({
        source: '已删除分组',
        groups: [],
        templates: [{ group: '已删除分组', content: '不应被抽到' }],
    });
    assert.equal(missingGroup.signal, 'T-AUTO-NO-INSTRUCTION');
    assert.equal(autoSourceLabel('__none__'), '随机·未分组模板');
});

test('运行日志统一脱敏密钥、Authorization 与 URL 路径', () => {
    clearRuntimeLogs();
    const secret = 'sk-super-secret-value';
    setRuntimeLogSecretProvider(() => [secret]);
    writeRuntimeLog('info', '请求发出', {
        url: 'https://api.example.com/v1/chat/completions?debug=1',
        apiKey: secret,
        key: 'bare-key-secret',
        Authorization: 'Bearer another-secret',
        max_tokens: 16384,
    });
    writeRuntimeLog('error', `Authorization: Bearer ${secret}; x-api-key=raw-secret`);
    const output = formatRuntimeLogs();
    assert.match(output, /\[INFO\] 请求发出/);
    assert.match(output, /https:\/\/api\.example\.com/);
    assert.match(output, /max_tokens/);
    assert.doesNotMatch(output, /v1\/chat|debug=1|sk-super|another-secret|raw-secret|bare-key-secret/);
    assert.match(output, /\[REDACTED\]/);
});

test('运行日志只保留最近 200 条且不写入外部设置', () => {
    clearRuntimeLogs();
    setRuntimeLogSecretProvider(() => []);
    for (let index = 0; index < MAX_RUNTIME_LOGS + 5; index++) writeRuntimeLog('info', `entry-${index}`);
    const entries = getRuntimeLogEntries();
    assert.equal(entries.length, MAX_RUNTIME_LOGS);
    assert.equal(entries[0].message, 'entry-5');
    assert.equal(entries.at(-1).message, `entry-${MAX_RUNTIME_LOGS + 4}`);
    clearRuntimeLogs();
});
