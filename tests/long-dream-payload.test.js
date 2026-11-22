// 从 core.test.js 拆出：long-dream-payload
import test from 'node:test';
import assert from 'node:assert/strict';
import { LONG_DREAM_MEMORY_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, LONG_DREAM_WORLD_LINE_RELATION, appendLongDreamChapter, createLongDreamRecord, createLongDreamWorldBookSnapshot, normalizeLongDreamRecord, recoverInterruptedLongDreamMemory, setLongDreamMemoryStatus } from '../long-dream.js';
import { LONG_DREAM_RECENT_CHAPTER_COUNT, buildLongDreamChapterMessages, buildLongDreamChapterPayload, longDreamChapterContext, longDreamWorldBookContext, longDreamWorldBookEntries } from '../long-dream-payload.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';
import { PROMPT_POST_PROCESSING, WORLD_INFO_POSITION } from '../request-layout.js';

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

    assert.deepEqual(messages.filter(message => message.source === 'preset').slice(0, 3).map(message => message.role), ['system', 'user', 'assistant']);
    assert.deepEqual(messages.filter(message => message.source === 'preset').slice(0, 3).map(message => message.content), ['SYSTEM-PRESET', 'USER-PRESET', 'ASSISTANT-PRESET']);
    assert.equal(messages.some(message => message.sourceId === 'theater-task' && message.content.includes(payload.userPrompt)), true);
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
        targetChars: 5000,
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
    assert.equal(captured.messages.some(message => message.sourceId === 'theater-task'), true);
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

function threeChapterDream() {
    let record = createLongDreamRecord({ source: { text: '第一章原文：雨夜码头。', html: '<p>第一章</p>' } });
    record = appendLongDreamChapter(record, { title: '旧信', text: '第二章原文：她在抽屉里找到那封旧信。', html: '<p>第二章</p>' });
    return appendLongDreamChapter(record, { title: '对峙', text: '第三章原文：两人在仓库门口对峙。', html: '<p>第三章</p>' });
}

test('带入全文选“最近 1 章”时只带上一章全文，上上章进较早章节索引', () => {
    const record = threeChapterDream();
    const two = buildLongDreamChapterPayload({ record, instruction: '写第四章' });
    assert.match(two.userPrompt, /最近 2 章全文/);
    assert.match(two.userPrompt, /第二章原文：她在抽屉里找到那封旧信。/);
    const one = buildLongDreamChapterPayload({ record, instruction: '写第四章', recentChapterCount: 1 });
    assert.match(one.userPrompt, /最近 1 章全文/);
    assert.match(one.userPrompt, /第三章原文：两人在仓库门口对峙。/);
    assert.equal(one.context.recentChapterCount, 1);
    assert.equal(one.context.olderChapterCount, 2);
    assert.match(one.context.olderOutline, /第 2 章《旧信》/);
    assert.doesNotMatch(one.context.chapters, /第二章原文/);
});

test('同一章自动补写的每一轮都沿用同一个“带入全文”设置', async () => {
    const prompts = [];
    const controller = createLongDreamGenerationController({
        checkpointIntervalMs: 0,
        requestChapter: async ({ userPrompt, round, onChunk }) => {
            prompts.push(userPrompt);
            const text = round === 1 ? '甲'.repeat(2500) : '乙'.repeat(2100);
            onChunk(text);
            return { text, stopReason: 'stop' };
        },
        renderChapter: async ({ text }) => `<main>${text}</main>`,
    });
    await controller.run({ record: threeChapterDream(), targetChars: 5000, autoContinue: true, maxRounds: 3, recentChapterCount: 1 });
    assert.equal(prompts.length, 2);
    for (const prompt of prompts) {
        const recent = prompt.split('\n\n---\n\n').find(section => section.startsWith('【近期已保存章节'));
        assert.match(recent, /最近 1 章全文/);
        assert.match(recent, /第三章原文/);
        assert.doesNotMatch(recent, /第二章原文/);
    }
});

test('长梦同章收尾轮剩的字数太少时，请模型写完整章末，不再说“仍需新增约 0 字”', () => {
    const record = createLongDreamRecord({ source: { text: '第一章正文。', html: '<main>第一章正文。</main>' } });
    const draft = '草稿'.repeat(4900);
    const near = buildLongDreamChapterPayload({ record, targetChars: 10000, currentDraft: draft, continuationRound: true, finishThisRound: true, writingPlan: { round: 2, maxRounds: 2, splitFirstRound: true } });
    assert.doesNotMatch(near.userPrompt, /仍需新增约 \d+ 字|约 \d+ 字，可随情节自然浮动/);
    assert.match(near.userPrompt, /本轮不再追字数，请用约 1500 字把本章剩下的情节和章末写完整/);
    // 不是收尾轮、或者剩得够多：照旧
    const mid = buildLongDreamChapterPayload({ record, targetChars: 10000, currentDraft: draft, continuationRound: true, finishThisRound: false, writingPlan: { round: 2, maxRounds: 3, splitFirstRound: true } });
    assert.match(mid.userPrompt, /仍需新增约 200 字/);
    const room = buildLongDreamChapterPayload({ record, targetChars: 10000, currentDraft: '草稿'.repeat(2500), continuationRound: true, finishThisRound: true, writingPlan: { round: 2, maxRounds: 2, splitFirstRound: true } });
    assert.match(room.userPrompt, /仍需新增约 5000 字/);
    assert.doesNotMatch(room.userPrompt, /本轮不再追字数/);
});
