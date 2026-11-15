// 从 core.test.js 拆出：world-book-policy
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_BOOK_STRATEGIES, rememberWorldBookEntryStates, shouldReadWorldBookEntry, syncFollowedWorldBooks, worldBookEntryStrategy } from '../world-book-policy.js';
import { buildProtagonistAnchor } from '../protagonist-anchor.js';
import { scanWorldBookEntriesWithSillyTavern } from '../world-book-runtime.js';

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
