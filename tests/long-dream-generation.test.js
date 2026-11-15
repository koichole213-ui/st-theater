// 从 core.test.js 拆出：long-dream-generation
import { retainLongDreamDraftCandidate, appendLongDreamDraftCandidate } from '../long-dream.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { readableCharCount } from '../text-counter.js';
import { LONG_DREAM_DRAFT_RESUME_STAGE, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_MAX_CANDIDATES, clearLongDreamDraft, createLongDreamRecord, discardLongDreamWritingAttempt, normalizeLongDreamRecord, promoteLongDreamDraft, saveLongDreamDraft, selectLongDreamDraftCandidate } from '../long-dream.js';
import { buildLongDreamChapterPayload } from '../long-dream-payload.js';
import { LONG_DREAM_GENERATION_STAGE, createLongDreamGenerationController } from '../long-dream-generation.js';
import { createLongDreamBackup, parseLongDreamBackup } from '../long-dream-backup.js';
import { createLongDreamArchive, parseLongDreamArchive } from '../long-dream-archive.js';
import { buildLongDreamMemoryPayload } from '../long-dream-memory.js';

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
            return { text: round === 1 ? '甲'.repeat(2500) : '乙'.repeat(2100) };
        },
        renderChapter: async ({ text, originalInstruction, apiRoute: received }) => {
            seen.push({ stage: 'render', route: received, originalInstruction });
            return `<main>${text}</main>`;
        },
    });

    await controller.run({
        record,
        apiRoute,
        targetChars: 5000,
        autoContinue: true,
        maxRounds: 3,
        instruction: '按钮使用指定的 HTML、CSS 和 JavaScript。',
    });

    assert.deepEqual(seen.map(item => item.stage), ['round-1', 'round-2', 'render']);
    assert.equal(seen.every(item => item.route === apiRoute), true);
    assert.equal(seen.at(-1).originalInstruction, '按钮使用指定的 HTML、CSS 和 JavaScript。');
    const indexSource = readTheaterImplementation();
    const longDreamRenderer = indexSource.match(/async function (?:runtime\.)?renderLongDreamChapter\([^]*?^}/m)?.[0] || '';
    assert.match(longDreamRenderer, /originalInstruction = ''/);
    assert.match(longDreamRenderer, /(?:runtime\.)?requestFinalRenderedHtml\(\{[^]*?originalInstruction/);
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

test('修改要求入口确认采用并记住新指令，取消或状态变化不保存不生成', async () => {
    const source = readTheaterImplementation();
    const code = source.match(/async function (?:runtime\.)?regenerateLongDreamDraft\([^]*?^}/m)[0];
    for (const mode of ['confirm', 'empty', 'cancel', 'stale', 'full', 'original']) {
        const draft = { status: LONG_DREAM_DRAFT_STATUS.REVIEW, instruction: '原要求', title: '章名', targetChars: 3000, candidates: Array(mode === 'full' ? 3 : 1).fill({ text: '保留正文', html: '<p>保留正文</p>' }) };
        const dream = { id: 7, draft };
        const before = JSON.stringify(draft);
        const calls = [];
        let markup = '';
        const scope = { longDreamCandidateSavePending: false, isPreparingGeneration: false, settings: { skinMode: 'default' }, activeLongDreamId: 7, longDreamCache: [dream], LONG_DREAM_DRAFT_STATUS, LONG_DREAM_MAX_CANDIDATES,
            esc: value => String(value), toastr: { info() {}, warning() {} },
            longDreamPut: async record => { scope.longDreamCache = [record]; return record; },
            setLongDreamComposerDraft: (_id, config) => calls.push(['save', config]),
            generateNextLongDreamChapter: async config => calls.push(['generate', config]),
            $: () => ({ find: () => ({ val: () => mode === 'empty' ? '' : '新的完整要求' }) }),
            SillyTavern: { getContext: () => ({ POPUP_TYPE: { CONFIRM: 1 }, Popup: class {
                constructor(html) { markup = html; this.dlg = {}; }
                async show() { if (mode === 'stale') scope.activeLongDreamId = 8; return mode !== 'cancel'; }
            } }) },
        };
        await runInNewContext(code + `\nregenerateLongDreamDraft({edit:${mode !== 'original'}})`, scope);
        assert.equal(JSON.stringify(draft), before);
        assert.equal(scope.longDreamCache[0].draft.lastRevisionInstruction, ['cancel', 'stale', 'original'].includes(mode) ? undefined : mode === 'empty' ? '' : '新的完整要求');
        if (['cancel', 'stale'].includes(mode)) assert.equal(calls.length, 0);
        else {
            assert.equal(calls.length, 2);
            assert.equal(calls[1][1].appendCandidate, true);
            assert.equal(calls[1][1].candidateConfig.instruction, mode === 'original' ? '原要求' : mode === 'empty' ? '' : '新的完整要求');
        }
        if (mode !== 'original') {
            assert.ok(markup.includes('原要求'));
            assert.match(markup, /theater-compact-popup theater-dream-revise-popup/);
            assert.match(markup, /data-skin="default"/);
            assert.match(markup, mode === 'full' ? /新版成功保存后移出最早一版/ : /本次将新增第 2 版/);
        }
    }
});

test('长梦修改要求生成保留三版各自指令，切换、重载和确认不串版', async () => {
    const record = createLongDreamRecord({ source: { text: '唯一已确认的前文。', html: '<main>唯一已确认的前文。</main>' } });
    const prompts = [];
    const controller = createLongDreamGenerationController({
        requestChapter: async ({ userPrompt }) => { prompts.push(userPrompt); return { text: `候选正文${prompts.length}。` }; },
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });
    const first = await controller.run({ record, instruction: '方向甲', chapterTitle: '原章名', targetChars: 1500 });
    const before = JSON.stringify(first.record.draft.candidates[0]);
    const second = await controller.run({ record: first.record, appendCandidate: true, instruction: '方向乙：请表现得更主动', targetChars: 2000 });
    assert.equal(JSON.stringify(second.record.draft.candidates[0]), before);
    assert.match(prompts[1], /方向乙：请表现得更主动/);
    assert.doesNotMatch(prompts[1], /方向甲|候选正文1/);
    const third = await controller.run({ record: second.record, appendCandidate: true, instruction: '' });
    const reloaded = normalizeLongDreamRecord(JSON.parse(JSON.stringify(third.record)));
    assert.deepEqual(reloaded.draft.candidates.map(item => item.instruction), ['方向甲', '方向乙：请表现得更主动', '']);
    assert.deepEqual(reloaded.draft.candidates.map(item => item.text), ['候选正文1。', '候选正文2。', '候选正文3。']);
    const selected = selectLongDreamDraftCandidate(reloaded, 0);
    assert.equal(selected.draft.instruction, '方向甲');
    assert.equal(selected.draft.targetChars, 1500);
    const confirmed = await controller.confirm(selected);
    assert.equal(confirmed.chapters[1].instruction, '方向甲');
    assert.equal(confirmed.chapters[1].text, '候选正文1。');
    const fourth = await controller.run({ record: reloaded, appendCandidate: true, instruction: '第四版' });
    assert.deepEqual(fourth.record.draft.candidates.map(item => item.instruction), ['方向乙：请表现得更主动', '', '第四版']);
    assert.equal(prompts.length, 4);
});

test('长梦旧候选迁移继承原指令，新版本失败后返回旧版恢复其指令', async () => {
    const record = createLongDreamRecord({ source: { text: '第一章', html: '<p>第一章</p>' } });
    const legacy = saveLongDreamDraft(record, { status: LONG_DREAM_DRAFT_STATUS.REVIEW, instruction: '旧要求', title: '旧标题', targetChars: 1500, text: '旧正文', html: '<p>旧正文</p>' });
    assert.equal(legacy.draft.candidates[0].instruction, '旧要求');
    const controller = createLongDreamGenerationController({ requestChapter: async () => { throw new Error('模拟失败'); }, renderChapter: async () => { throw new Error('不应进入排版'); } });
    await assert.rejects(controller.run({ record: legacy, appendCandidate: true, instruction: '新要求' }), error => {
        const failed = error.longDreamRecord;
        assert.equal(failed.draft.instruction, '新要求');
        assert.equal(failed.draft.candidates[0].instruction, '旧要求');
        const restored = discardLongDreamWritingAttempt(failed);
        assert.equal(restored.draft.instruction, '旧要求');
        assert.equal(restored.draft.text, '旧正文');
        return true;
    });
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
    let latest = third.record;
    for (let number = 4; number <= 7; number++) {
        latest = (await controller.run({ record: latest, appendCandidate: true, instruction: `方向${number}` })).record;
        latest = normalizeLongDreamRecord(JSON.parse(JSON.stringify(latest)));
        assert.deepEqual(latest.draft.candidates.map(candidate => candidate.text), [number - 2, number - 1, number].map(n => `第 ${n} 版正文。`));
        assert.equal(latest.draft.selectedCandidateIndex, 2);
        assert.equal(latest.draft.instruction, `方向${number}`);
    }
    assert.equal(requestCount, 7);

    const selected = selectLongDreamDraftCandidate(latest, 0);
    assert.equal(selected.draft.selectedCandidateIndex, 0);
    assert.equal(selected.draft.text, '第 5 版正文。');
    assert.equal(selected.draft.instruction, '方向5');
    const confirmed = await controller.confirm(selected);
    assert.equal(confirmed.chapters.length, 2);
    assert.equal(confirmed.chapters[1].text, '第 5 版正文。');
    assert.equal(confirmed.chapters[1].html, '<main>第 5 版正文。</main>');
    assert.equal(confirmed.draft, null);
});

test('满三版后请求失败、停止、排版或保存失败均保留旧候选，恢复成功才移出最早版', async () => {
    const seed = createLongDreamGenerationController({
        requestChapter: async ({ userPrompt }) => ({ text: '已有候选正文。' + userPrompt.slice(-10) }),
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });
    let record = createLongDreamRecord({ source: { text: '正式正文', html: '<main>正式正文</main>' } });
    for (let i = 0; i < 3; i++) record = (await seed.run({ record, appendCandidate: i > 0, instruction: `旧要求${i}` })).record;
    record = selectLongDreamDraftCandidate(record, 1);
    const before = JSON.stringify(record.draft.candidates);
    for (const failure of ['request', 'stop', 'render', 'late-render', 'save']) {
        let stored = record;
        const controller = createLongDreamGenerationController({
            checkpointIntervalMs: 0,
            requestChapter: async ({ onChunk }) => {
                onChunk('新的一版正文');
                if (failure === 'request') throw new Error('请求失败');
                if (failure === 'stop') { controller.abort(); throw new DOMException('Aborted', 'AbortError'); }
                return { text: '新的一版正文' };
            },
            renderChapter: async () => {
                if (failure === 'render') throw new Error('排版失败');
                if (failure === 'late-render') controller.abort();
                return '<main>新排版</main>';
            },
            persistRecord: async next => {
                if (failure === 'save' && next.draft.status === LONG_DREAM_DRAFT_STATUS.REVIEW) return false;
                assert.equal(JSON.stringify(next.draft.candidates), before);
                stored = next;
                return next;
            },
        });
        let failed;
        await assert.rejects(controller.run({ record, appendCandidate: true, instruction: '新要求' }), error => {
            if (failure === 'late-render') assert.equal(error.name, 'AbortError');
            failed = error.longDreamRecord;
            return true;
        });
        assert.equal(JSON.stringify(record.draft.candidates), before);
        assert.equal(JSON.stringify(stored.draft.candidates), before);
        assert.equal(JSON.stringify(failed.draft.candidates), before);
        const restored = discardLongDreamWritingAttempt(normalizeLongDreamRecord(JSON.parse(JSON.stringify(failed))));
        assert.equal(restored.draft.selectedCandidateIndex, 1);
        assert.equal(restored.draft.instruction, '旧要求1');
        if (failure === 'render') {
            const recovery = createLongDreamGenerationController({
                requestChapter: async () => assert.fail('排版恢复不应再写正文'),
                renderChapter: async () => '<main>恢复排版</main>',
            });
            const result = await recovery.run({ record: failed });
            assert.deepEqual(result.record.draft.candidates.slice(0, 2), record.draft.candidates.slice(1));
            assert.equal(result.record.draft.candidates.length, 3);
            assert.equal(result.record.draft.text, '新的一版正文');
            assert.equal(result.record.draft.instruction, '新要求');
        }
    }
});

test('修改要求再次打开带回上次补充，取消和保存失败不覆盖，再来一版沿用当前候选要求', async () => {
    const source = readTheaterImplementation();
    const code = source.match(/async function (?:runtime\.)?regenerateLongDreamDraft\([^]*?^}/m)[0];
    const draft = { status: LONG_DREAM_DRAFT_STATUS.REVIEW, instruction: '旧候选要求', lastRevisionInstruction: '原要求\nchar更温柔', title: '章名', targetChars: 3000, candidates: [] };
    let markup, cancel = true, failSave = false, generated = [];
    const scope = { longDreamCandidateSavePending: false, isPreparingGeneration: false, activeLongDreamId: 7, longDreamCache: [{ id: 7, draft }], settings: {}, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_MAX_CANDIDATES,
        esc: String, toastr: { info() {}, warning() {} }, setLongDreamComposerDraft() {},
        longDreamPut: async record => { if (failSave) return false; scope.longDreamCache = [record]; return record; },
        generateNextLongDreamChapter: async options => generated.push(options.candidateConfig.instruction),
        $: () => ({ find: () => ({ val: () => '原要求\nchar更温柔\n不要突然冷脸' }) }),
        SillyTavern: { getContext: () => ({ POPUP_TYPE: {}, Popup: class { constructor(html) { markup = html; this.dlg = {}; } async show() { return !cancel; } } }) },
    };
    runInNewContext(code, scope);
    await scope.regenerateLongDreamDraft({ edit: true });
    assert.match(markup, /char更温柔/); assert.doesNotMatch(markup, /theater-dream-revise-description/);
    assert.equal(generated.length, 0); assert.equal(scope.longDreamCache[0].draft, draft);
    cancel = false; failSave = true;
    await scope.regenerateLongDreamDraft({ edit: true });
    assert.equal(generated.length, 0); assert.equal(scope.longDreamCache[0].draft, draft);
    failSave = false;
    await scope.regenerateLongDreamDraft({ edit: true });
    assert.equal(generated[0], '原要求\nchar更温柔\n不要突然冷脸');
    cancel = true;
    await scope.regenerateLongDreamDraft({ edit: true });
    assert.match(markup, /不要突然冷脸/);
    await scope.regenerateLongDreamDraft();
    assert.equal(generated.at(-1), '旧候选要求');
});

test('本章修改要求跨候选、失败回退、重载和备份保留，确认章节后清除', async () => {
    const { sanitizeLongDreamBackupRecord } = await import('../long-dream-backup.js');
    let record = createLongDreamRecord({ source: { text: '前文', html: '<p>前文</p>' } });
    record = saveLongDreamDraft(record, { status: LONG_DREAM_DRAFT_STATUS.REVIEW, text: '候选一', html: '<p>候选一</p>', instruction: '初始要求', lastRevisionInstruction: '更温柔' });
    const controller = createLongDreamGenerationController({ requestChapter: async () => ({ text: '候选二' }), renderChapter: async () => '<p>候选二</p>' });
    record = (await controller.run({ record, appendCandidate: true, instruction: '更温柔' })).record;
    record = selectLongDreamDraftCandidate(record, 0);
    assert.equal(record.draft.instruction, '初始要求');
    assert.equal(record.draft.lastRevisionInstruction, '更温柔');
    const backup = sanitizeLongDreamBackupRecord(record, { includeReviewDraft: true });
    assert.equal(normalizeLongDreamRecord(JSON.parse(JSON.stringify(backup))).draft.lastRevisionInstruction, '更温柔');
    const failed = createLongDreamGenerationController({ requestChapter: async () => { throw Error('offline'); }, renderChapter: async () => '' });
    await assert.rejects(failed.run({ record, appendCandidate: true, instruction: '更温柔' }), error => {
        assert.equal(discardLongDreamWritingAttempt(error.longDreamRecord).draft.lastRevisionInstruction, '更温柔'); return true;
    });
    assert.equal((await controller.confirm(record)).draft, null);
    assert.equal(clearLongDreamDraft(record).draft, null);
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
    assert.equal(controller.active.candidateNumber, 2);
    assert.equal(controller.active.retainedCandidateCount, 1);
    assert.equal(controller.active.currentChars, readableCharCount('第二版只写到一半。'));
    assert.equal(controller.active.targetChars, 3000);
    assert.ok(Number.isFinite(controller.active.startedAt));
    assert.ok(Number.isFinite(controller.active.firstChunkAt));
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
            const text = round === 1 ? '甲'.repeat(2500) : '乙'.repeat(2100);
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
        targetChars: 5000,
        autoContinue: true,
        maxRounds: 3,
    });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(item => [item.round, item.maxRounds]), [[1, 3], [2, 3]]);
    assert.doesNotMatch(requests[0].userPrompt, /本章可恢复草稿/);
    assert.match(requests[0].userPrompt, /不要为了提前结束而仓促总结或收束/);
    assert.match(requests[1].userPrompt, /本章可恢复草稿/);
    assert.match(requests[1].userPrompt, /本章已有约 2500 字/);
    assert.equal(renderCount, 1);
    assert.equal(result.rounds, 2);
    assert.equal(result.actualChars, 4600);
    assert.equal(result.targetCompletionChars, 4500);
    assert.equal(result.completedBelowTarget, false);
    assert.equal(result.record.draft.text, `${'甲'.repeat(2500)}\n\n${'乙'.repeat(2100)}`);
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
        targetChars: 5000,
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

    const running = controller.run({ record, targetChars: 5000, autoContinue: true, maxRounds: 3 });
    await started;
    assert.deepEqual(controller.active, {
        stage: LONG_DREAM_GENERATION_STAGE.WRITING,
        aborted: false,
        round: 2,
        maxRounds: 3,
        startedAt: controller.active.startedAt,
        firstChunkAt: controller.active.firstChunkAt,
        currentChars: 250,
        targetChars: 5000,
        candidateNumber: 1,
        retainedCandidateCount: 0,
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

test('长梦保留版本跨候选轮换、重载与确认保存，后续正文和梦脉不串版', async () => {
    let record = createLongDreamRecord({ source: { text: '已确认第一章', html: '<p>已确认第一章</p>' } });
    const controller = createLongDreamGenerationController({requestChapter: async () => ({text:'unused'}), renderChapter: async ({text}) => `<p>${text}</p>`});
    record = saveLongDreamDraft(record, { status: LONG_DREAM_DRAFT_STATUS.WRITING, instruction: '续写' });
    for (let n=1; n<=7; n++) {
        record = appendLongDreamDraftCandidate(record, {title:`候选${n}`, text:`独立版本${n}的事件`, html:`<article>独立版本${n}的事件</article>`});
        if (n===1 || n===2) record = retainLongDreamDraftCandidate(record, record.draft.selectedCandidateIndex, true);
        record = normalizeLongDreamRecord(JSON.parse(JSON.stringify(record)));
    }
    assert.deepEqual(record.draft.candidates.map(item=>item.versionNumber), [1,2,5,6,7]);
    assert.equal(record.draft.candidates.filter(item=>item.retained).length,2);
    const draftBackup = parseLongDreamBackup(createLongDreamBackup([record]))[0];
    assert.deepEqual(draftBackup.draft.candidates.map(item=>item.versionNumber), [1,2,5,6,7]);
    const selected = selectLongDreamDraftCandidate(record, 2);
    const promoted = await controller.confirm(selected);
    assert.equal(promoted.draft,null);
    const chapter=promoted.chapters[1];
    assert.equal(chapter.versionNumber,5);
    assert.equal(chapter.text,'独立版本5的事件');
    assert.deepEqual(chapter.retainedVersions.map(item=>item.versionNumber),[1,2]);
    assert.equal(chapter.retainedVersions[0].html,'<article>独立版本1的事件</article>');
    const restored=normalizeLongDreamRecord(JSON.parse(JSON.stringify(promoted)));
    assert.deepEqual(restored.chapters[1],chapter);
    const payload=buildLongDreamChapterPayload({record:restored,instruction:'继续'});
    assert.match(payload.userPrompt,/独立版本5的事件/);
    assert.doesNotMatch(payload.userPrompt,/独立版本[1267]的事件/);
    const memory=buildLongDreamMemoryPayload({record:restored});
    assert.doesNotMatch(JSON.stringify(memory),/独立版本[1267]的事件/);
    const archive=createLongDreamArchive([promoted]);
    const imported=parseLongDreamArchive(archive.manifest,archive.files)[0];
    assert.deepEqual(imported.chapters[1].retainedVersions,chapter.retainedVersions);
    assert.equal(imported.chapters[1].versionNumber,5);
});

test('长梦取消保留不立刻删除当前候选，确认不重复收录选中版，备份保留原HTML', () => {
    let record=createLongDreamRecord({source:{text:'首章',html:'<p>首章</p>'}});
    record=saveLongDreamDraft(record,{status:LONG_DREAM_DRAFT_STATUS.WRITING,instruction:'续写'});
    for(let n=1;n<=4;n++) {
        record=appendLongDreamDraftCandidate(record,{text:`正文${n}`,html:`<main data-version="${n}">正文${n}</main>`});
        record=retainLongDreamDraftCandidate(record,record.draft.selectedCandidateIndex,true);
    }
    record=selectLongDreamDraftCandidate(record,0);
    record=retainLongDreamDraftCandidate(record,0,false);
    assert.equal(record.draft.candidates.length,4);
    assert.equal(record.draft.text,'正文1');
    record=retainLongDreamDraftCandidate(record,0,true);
    const promoted=promoteLongDreamDraft(record);
    assert.equal(promoted.chapters[1].retainedVersions.length,3);
    assert.deepEqual(promoted.chapters[1].retainedVersions.map(v=>v.versionNumber),[2,3,4]);
    const imported=parseLongDreamBackup(createLongDreamBackup([promoted]))[0];
    assert.deepEqual(imported.chapters[1].retainedVersions,promoted.chapters[1].retainedVersions);
});
