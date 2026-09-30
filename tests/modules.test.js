import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

test('拆分后的真实入口完整链接，先注册功能再安装全局监听与调度器', async t => {
    const entryUrl = new URL('../index.js', import.meta.url).href;
    const entrySource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const featureNames = [...entrySource.matchAll(/^const \{ ([^\n]+) \} = create\w+\(runtime\);$/gm)].flatMap(match => match[1].split(', '));
    const ready = [], listeners = [], saved = [];
    const originals = Object.fromEntries(['window', 'jQuery', 'SillyTavern', 'document', 'toastr'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const ctx = { characters: [], chat: [], name1: '测试用户', name2: '测试角色', characterId: undefined,
        saveSettingsDebounced() { saved.push(true); } };
    globalThis.window = { addEventListener: (...args) => listeners.push(args), matchMedia: () => ({ matches: false }) };
    globalThis.jQuery = fn => { ready.push(fn); };
    globalThis.SillyTavern = { getContext: () => ctx };
    const errors = [];
    globalThis.toastr = { error: message => errors.push(message) };
    globalThis.document = {
        createElement() {
            return { innerHTML: '', querySelectorAll: () => [],
                get textContent() { return this.innerHTML.replace(/<[^>]*>/g, ''); } };
        },
    };
    // Only the two existing imports from the SillyTavern host are simulated.
    // All plugin files, factory initializers and accessor definitions are real.
    const hooks = registerHooks({
        resolve(specifier, context, next) {
            if (context.parentURL?.endsWith('/persona-follow.js')) {
                if (specifier === '../../../power-user.js') return { url: 'data:text/javascript,export const power_user = {};', shortCircuit: true };
                if (specifier === '../../../personas.js') return { url: 'data:text/javascript,export const user_avatar = "";', shortCircuit: true };
            }
            const result = next(specifier, context);
            if (specifier === './safe-renderer.js' && !context.parentURL?.includes('/tests/')) {
                return { ...result, url: result.url + '?entry-link-test' };
            }
            return result;
        },
        load(url, context, next) {
            const result = next(url, context);
            // Observe the actual entry wiring without adding a production test API.
            return url === entryUrl ? { ...result, source: `${result.source}\nexport { runtime as testRuntime, defaultSettings as testDefaults };\nexport const testFeatures = { ${featureNames.join(',')} };` } : result;
        },
    });
    t.after(() => {
        hooks.deregister();
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const { testRuntime: runtime, testDefaults: defaults, testFeatures: features } = await import('../index.js');
    assert.equal(ready.length, 1);
    assert.equal(typeof ready[0], 'function');
    assert.equal(listeners.filter(([type]) => type === 'message').length, 1);
    for (const type of ['mousedown', 'touchend']) {
        const registration = listeners.find(([event]) => event === type);
        assert.equal(registration[1], features.guardTheaterNativeSelectEvent);
        assert.equal(registration[2], true);
    }
    assert.equal(typeof runtime.scheduleTokenEstimate, 'function');
    assert.equal(typeof runtime.scheduleLongDreamTokenEstimate, 'function');
    // Resolve every live accessor: catches a missing or uninitialized callback.
    for (const key of Object.keys(runtime)) assert.doesNotThrow(() => runtime[key], key);

    await t.test('所有功能factory只注册函数，构造期间不读取未初始化的状态', async () => {
        const registrations = [...entrySource.matchAll(/^import \{ (create\w+) \} from '\.\/(theater-[^']+|long-dream-(?:navigation|workspace|runtime)\.js)';$/gm)];
        assert.equal(registrations.length, 20);
        for (const [, name, file] of registrations) {
            const module = await import(new URL(`../${file}`, import.meta.url));
            const functions = module[name](new Proxy({}, { get(_, key) { throw new Error(`Early read: ${file}:${String(key)}`); } }));
            assert.ok(Object.keys(functions).length);
            for (const fn of Object.values(functions)) assert.equal(typeof fn, 'function');
        }
    });

    await t.test('实际连接的各页模板可生成，版本号与按钮入口齐全', () => {
        runtime.settings = structuredClone(defaults);
        for (const tab of ['generate', 'long-dream', 'history', 'rules', 'config']) {
            const html = features.buildPopupHTML(tab);
            assert.match(html, /千夜浮梦/);
            assert.ok(html.includes(runtime.VERSION));
            assert.match(html, /id="theater-generate-btn"/);
            assert.match(html, /id="theater-export-all-history"/);
            assert.match(html, /id="theater-dream-export-all"/);
        }
        const settings = structuredClone(defaults);
        settings.skinMode = 'theater';
        runtime.settings = settings;
        assert.match(features.buildPopupHTML('generate'), /data-skin="theater"/);
    });

    await t.test('实际存储模块串行归档与保存，编辑旧篇不会覆盖当前作品', async () => {
        const a = { resultId: 'a', html: '<p>甲</p>', mode: 'html' };
        const b = { resultId: 'b', html: '<p>乙</p>', mode: 'html' };
        const c = { resultId: 'c', html: '<p>丙</p>', mode: 'html' };
        runtime.idb = null;
        runtime.currentGenerationResult = a;
        runtime.recentCache = [b];
        runtime.resultStorageQueue = Promise.resolve();
        const [archived, stored] = await Promise.all([features.archiveCurrentResult(), features.storeCurrentResult(c)]);
        assert.equal(archived, true);
        assert.equal(stored, true);
        assert.equal(runtime.currentGenerationResult, c);
        assert.deepEqual(runtime.recentCache, [a, b]);
        assert.equal(runtime.settings.currentGenerationResult, c);
        assert.equal(runtime.settings.recentGenerations[0], a);
        assert.equal(await features.updateResultItem(a, '<p>甲改</p>', 'html'), true);
        assert.equal(runtime.recentCache[0], a);
        assert.equal(a.html, '<p>甲改</p>');
        assert.equal(runtime.currentGenerationResult, c);
        assert.ok(saved.length >= 3);
    });

    await t.test('实际生成装配使用同一套资料模块，续写字数不扣减完整前情', async () => {
        runtime.settings = structuredClone(defaults);
        runtime.settings.readChatContext = false;
        runtime.settings.selectedWorldBooks = [];
        runtime.settings.selectedPresetName = '';
        runtime.settings.manualTargetEnabled = true;
        runtime.settings.manualTargetChars = 4000;
        runtime.wbEntries = [];
        runtime.wbStates = [];
        runtime.wbLoadedCacheKey = features.worldBookCacheKey();
        runtime.wbLoadedReadMode = runtime.settings.worldBookReadMode;
        const background = '旧前情'.repeat(3000);
        const payload = await features.assembleGenerationPayload('接着往下写', { continuationText: background });
        assert.equal(payload.targetWordCount, 4000);
        assert.ok(payload.userPrompt.includes(background));
        assert.match(payload.userPrompt + payload.systemPrompt, /本轮一次性充分展开约 4000 字/);
        assert.match(payload.userPrompt + payload.systemPrompt, /旧正文不计入此目标/);
        assert.equal(payload.generationFoundation.originalInstruction, '接着往下写');
    });

    await t.test('实际存储事务失败保留当前与最近作品，后续写入仍可继续', async () => {
        const current = { resultId: 'keep', html: '<p>要保留的正文</p>', mode: 'html' };
        const previous = [{ resultId: 'previous', html: '<p>前一篇</p>', mode: 'html' }];
        runtime.currentGenerationResult = current;
        runtime.recentCache = previous;
        runtime.resultStorageQueue = Promise.resolve();
        runtime.idb = { transaction() {
            const transaction = { error: new Error('Synthetic storage failure'), objectStore: () => ({ put() {} }) };
            queueMicrotask(() => transaction.onabort());
            return transaction;
        } };
        assert.equal(await features.archiveCurrentResult(), false);
        assert.equal(runtime.currentGenerationResult, current);
        assert.equal(runtime.recentCache, previous);
        assert.equal(errors.length, 1);
        runtime.idb = null;
        const next = { resultId: 'next', html: '<p>后来的一篇</p>', mode: 'html' };
        assert.equal(await features.storeCurrentResult(next), true);
        assert.equal(runtime.currentGenerationResult, next);
        assert.equal(runtime.recentCache, previous);
    });
});
