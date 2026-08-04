import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateTokenBreakdown } from '../token-estimator.js';
import { buildContinuationInstruction, buildContinuationPayload, buildFinalRenderPayload, buildGenerationPayload, createFinalRenderPlan, hydrateFinalRenderHtml } from '../generation-payload.js';
import { API_PROTOCOLS, DEFAULT_MAX_OUTPUT_TOKENS, buildApiRequest, contentBlockReason, extractApiErrorMessage, extractResponseMeta, extractStreamText, isContentBlockedErrorMessage, isContentBlockedStopReason, isHtmlErrorResponse, isMaxTokenLimitError, isRateLimitErrorMessage, maxTokenFallbackSequence, normalizeMaxTokens, resolveMainApiModel, retryAfterMilliseconds } from '../api-client.js';
import { readNonStreamingResponse, readSSEStream, requestCustomApi, requestMainApi } from '../api-runtime.js';
import { abortGenerationJob, addGenerationSegment, authorizeFinish, createGenerationJob, shouldAuthorizeFinishRound, shouldContinueJob, targetCompletionChars } from '../generation-job.js';
import { MAX_CONTINUATION_CONTEXT_CHARS, continuationContextWindow, normalizeContinuationText, readableCharCount } from '../text-counter.js';
import { RENDER_REPORT_TIMEOUT_MS, injectResizeReporter, installSafeResizeListener, renderSafeIframe, sandboxPermissions } from '../safe-renderer.js';
import { createRequestMetrics, markCompleted, markFailed, markFallback, markFirstToken, summarizeMetrics } from '../request-metrics.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, classifyRequestFailure, createDiagnosticError, diagnosticSignalInfo } from '../request-diagnostics.js';
import { bookmarkPlacementFromPoint, bookmarkPosition, normalizeBookmarkYRatio } from '../result-bookmark.js';
import { autoSourceLabel, resolveAutoInstruction } from '../auto-mode.js';
import { MAX_RUNTIME_LOGS, clearRuntimeLogs, formatRuntimeLogs, getRuntimeLogEntries, setRuntimeLogSecretProvider, writeRuntimeLog } from '../runtime-log.js';
import { apiPresetSecretValues, createApiPresetFromConfig, normalizeApiPresetList } from '../api-presets.js';
import { splitInstructionTextFile } from '../instruction-import.js';
import { LENGTH_TIERS, LONG_FORM_SPLIT_THRESHOLD, STAGED_RENDER_THRESHOLD, classifyLengthTier, firstRoundGuidance, isLongFormTarget, isStagedRenderTarget, longFormFirstRoundGuidance, longFormFirstRoundTarget, parseTargetWordCount, resolveTargetWordCount, stripTargetWordCountRequirement } from '../length-policy.js';
import { AUTO_CONTINUE_SCHEMA, migrateAutoContinueDefault } from '../settings-migration.js';
import { createInstructionBackup, parseInstructionBackup } from '../instruction-backup.js';
import { WORLD_BOOK_STRATEGIES, mergeFollowedWorldBooks, shouldReadWorldBookEntry, worldBookEntryStrategy } from '../world-book-policy.js';
import { buildProtagonistAnchor } from '../protagonist-anchor.js';
import { scanWorldBookEntriesWithSillyTavern } from '../world-book-runtime.js';
import { MAX_CONTEXT_MESSAGES, normalizeContextRange, takeRecentMessages } from '../context-policy.js';
import { PLAIN_TEXT_DARK_SELECTION, PLAIN_TEXT_LIGHT_SELECTION, buildPlainTextHtml, isPlainTextSelection, isTextOutputMode, plainTextThemeForSelection, textOutputModeForTheme, textThemeForOutputMode } from '../plain-text-renderer.js';
import { HISTORY_ARCHIVE_MANIFEST, createHistoryArchive, createHistoryJsonBackup, historyItemsFromArchive, normalizeHistoryBackup } from '../history-backup.js';
import { LONG_DREAM_DRAFT_STATUS, LONG_DREAM_SCHEMA_VERSION, LONG_DREAM_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, appendLongDreamChapter, clearLongDreamDraft, createLongDreamRecord, createLongDreamWorldBookSnapshot, latestLongDreamChapter, migrateLongDreamRecord, normalizeLongDreamRecord, promoteLongDreamDraft, saveLongDreamDraft, setLongDreamStatus, truncateLongDreamAfter, updateLongDreamChapter, updateLongDreamDefinition } from '../long-dream.js';
import { buildLongDreamChapterPayload, longDreamChapterContext, longDreamWorldBookContext } from '../long-dream-payload.js';
import { LONG_DREAM_GENERATION_STAGE, createLongDreamGenerationController } from '../long-dream-generation.js';
import { LONG_DREAM_BACKUP_FORMAT, LONG_DREAM_BACKUP_VERSION, createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';

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
        assert.equal(error.longDreamRecord.draft.text, '已经完成但尚未排版的第二章。');
        return true;
    });
    assert.equal(stages.at(-1), LONG_DREAM_GENERATION_STAGE.ERROR);
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
    assert.match(source, /requestFinalRenderedHtml/);
    assert.match(source, /class="theater-dream-next-options"/);
    assert.match(source, /<details class="theater-dream-settings">/);
    assert.match(source, /旧记录中有一份指令，请核对/);
    assert.match(styles, /梦中页只保留一条主线：续写/);
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

test('长梦上下文预算先裁剪低优先级信息，定梦和本章方向始终完整', () => {
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
    assert.deepEqual(payload.budget.truncated, ['chapters']);
    assert.equal(payload.budget.omitted.includes('worldBookSnapshot'), true);
    assert.equal(payload.budget.omitted.includes('style'), true);
    assert.doesNotMatch(payload.userPrompt, /低优先级世界书内容/);
    assert.doesNotMatch(payload.systemPrompt, /低优先级风格规则/);
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
    assert.match(source, /'theater-dream-complete'/);
    assert.match(source, /'theater-dream-reopen'/);
    assert.match(source, /class="theater-dream-chapter-directory"/);
    assert.match(source, /data-dream-read-chapter/);
    assert.match(source, /createLongDreamBackup/);
    assert.match(source, /parseLongDreamBackup/);
    assert.match(source, /请只导入可信来源/);
    assert.match(source, /已导入 \$\{added\}\/\$\{total\} 卷长梦/);
    assert.match(source, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 1000\)/);
    assert.match(styles, /\.theater-dream-chapter-directory\s*\{/);
    assert.match(styles, /\.theater-dream-chapter-row\s*\{/);
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
    assert.match(tabHandler, /panels\.scrollTop = 0/);
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

test('设置页重排为四组控制台且保留所有旧功能入口', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    for (const id of [
        'theater-api-mode', 'theater-api-preset-select', 'theater-api-protocol', 'theater-api-url',
        'theater-api-key', 'theater-api-model', 'theater-max-output-tokens', 'theater-auto-continue',
        'theater-wb-read-mode', 'theater-sound-enabled', 'theater-sound-preset', 'theater-sound-volume',
        'theater-random-enabled', 'theater-random-scope', 'theater-auto-enabled', 'theater-auto-interval',
        'theater-auto-source', 'theater-result-bookmark-enabled', 'theater-floating-ball-toggle',
        'theater-floating-ball-tuck-toggle', 'theater-update-btn', 'theater-reload-after-update-btn',
    ]) assert.match(source, new RegExp(`id="${id}"`));
    for (const group of ['api', 'generation', 'experience', 'extension']) {
        assert.match(source, new RegExp(`data-config-group="\\$\\{group.id\\}"|id: '${group}'`));
    }
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

test('iframe 导航更换窗口引用后仍能接收渲染回报', () => {
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
    try {
        installSafeResizeListener();
        renderSafeIframe(frame, '<html><body>已有正文</body></html>', { sourceHasText: true });
        const navigatedWindow = {};
        frame.contentWindow = navigatedWindow;
        messageHandler({
            source: navigatedWindow,
            data: { type: 'st-theater:height', height: 360, textLength: 4 },
        });
        assert.equal(frame.style.height, '360px');

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

test('跟随角色卡只补入绑定世界书，不覆盖用户手选世界书', () => {
    assert.deepEqual(
        mergeFollowedWorldBooks(['手选设定', '角色绑定'], ['角色绑定', '聊天绑定', '']),
        ['手选设定', '角色绑定', '聊天绑定'],
    );
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
