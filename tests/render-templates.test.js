// 从 core.test.js 拆出：render-templates
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { estimateTokenCount } from '../token-estimator.js';
import { buildFinalRenderPayload, buildGenerationPayload, hydrateFinalRenderHtml } from '../generation-payload.js';
import { ADAPTIVE_RENDER_SELECTIONS, adaptiveRenderProfile, adaptiveRenderProfiles, isAdaptiveRenderSelection } from '../adaptive-render.js';
import { createGenerationJob } from '../generation-job.js';
import { readableCharCount } from '../text-counter.js';
import { classifyLengthTier, isLongFormTarget, isStagedRenderTarget, resolveTargetWordCount } from '../length-policy.js';
import { normalizeContextRange } from '../context-policy.js';
import { isPlainTextSelection, plainTextThemeForSelection, textOutputModeForTheme } from '../plain-text-renderer.js';
import { itemTags } from '../tag-system.js';

test('三个 HTML 规则保持紧凑预算，不给正文新增长度上限', () => {
    for (const profile of adaptiveRenderProfiles()) {
        assert.ok(estimateTokenCount(profile.rules) <= 1900, profile.name);
        assert.match(profile.rules, /原样保留/);
        assert.match(profile.rules, /主线按原顺序/);
        assert.match(profile.rules, /长文\/短屏均可滚动到底/);
        assert.match(profile.rules, /首次点击时new AudioContext\(\)并resume\(\)/);
        assert.doesNotMatch(profile.rules, /\d+\s*字以内|不超过\s*\d+\s*字/);
    }
});

test('模板以具体代码约定沙盒环境、出错可读、动作音效与绘画范围', () => {
    for (const profile of adaptiveRenderProfiles()) {
        assert.match(profile.rules, /禁止外部资源\/网络请求、赛博朋克元素/);
        assert.match(profile.rules, /【运行环境】页面在只允许脚本的沙盒中显示/);
        assert.match(profile.rules, /localStorage\/sessionStorage\/cookie、alert\/confirm\/prompt、表单提交、全屏、新窗口均不可用/);
        assert.match(profile.rules, /正文默认全部可见/);
        assert.match(profile.rules, /\.js \.wait\{display:none\}/);
        assert.match(profile.rules, /catch\(_\)\{reveal\(\)\}/);
        assert.match(profile.rules, /data-show="#该id"/);
        assert.match(profile.rules, /script不运行也能读全文/);
        assert.match(profile.rules, /不写内联onclick/);
        assert.match(profile.rules, /封面\/遮罩关闭用hidden或remove\(\)/);
        assert.match(profile.rules, /拖动元素加touch-action:none，并提供点击替代/);
        assert.match(profile.rules, /OscillatorNode→GainNode→destination/);
        assert.match(profile.rules, /先更新画面再发声，声音放进try/);
        assert.match(profile.rules, /禁止背景音乐、循环声及独立声音开关/);
        assert.match(profile.rules, /说明text-align:left/);
        assert.match(profile.rules, /装饰层pointer-events:none/);
        assert.match(profile.rules, /重复点击同一完成动作保持当前状态/);
        if (profile.id === ADAPTIVE_RENDER_SELECTIONS.lively) {
            assert.doesNotMatch(profile.rules, /CSS绘画/);
            assert.match(profile.rules, /默认无声/);
            assert.match(profile.rules, /主线正文不用wait隐藏/);
        } else {
            assert.match(profile.rules, /优先用CSS绘画/);
            assert.match(profile.rules, /::before\/::after/);
            assert.match(profile.rules, /data-show指向/);
            assert.match(profile.rules, /可配短音效/);
        }
    }
    assert.match(adaptiveRenderProfile(ADAPTIVE_RENDER_SELECTIONS.experimental).rules, /本阶段未发现的段落一并展开，保证全文完整/);
    assert.match(adaptiveRenderProfile(ADAPTIVE_RENDER_SELECTIONS.experimental).rules, /用点选代替文字输入/);
});

test('规则里的互动骨架：露出、开合、切换都在原地生效，任何出错、缺按钮或缺目标都让全部内容露出', () => {
    const rules = adaptiveRenderProfiles()[0].rules;
    const skeleton = rules.split('2. script照此骨架：\n')[1]?.split('\n任何出错')[0] || '';
    assert.match(skeleton, /addEventListener\('error',reveal\);addEventListener\('unhandledrejection',reveal\)/);
    assert.doesNotMatch(skeleton, /scrollIntoView/, '不自动滚到远处');
    // 极简假 DOM：元素 = { id, wait, data }；只支持骨架用到的选择器
    const run = ({ els, handler = '', after = null, clicks = null }) => {
        const rootClasses = new Set(), windowListeners = {};
        const nodes = els.map(spec => {
            const classes = new Set(spec.wait ? ['wait'] : []), listeners = [], attrs = {};
            return {
                id: spec.id || '', dataset: { ...(spec.data || {}) }, classes, listeners, attrs,
                classList: { add: n => classes.add(n), remove: n => classes.delete(n),
                    toggle: n => (classes.has(n) ? (classes.delete(n), false) : (classes.add(n), true)) },
                setAttribute: (k, v) => { attrs[k] = String(v); },
                addEventListener: (type, fn) => listeners.push(fn),
            };
        });
        const matches = (el, sel) => {
            if (sel === '.wait') return el.classes.has('wait');
            if (sel === 'button') return Object.keys(el.dataset).some(k => k !== 'pane');
            if (sel.startsWith('#')) return '#' + el.id === sel;
            const m = sel.match(/^\[data-(\w+)(?:="(.*)")?\]$/);
            return !!m && (m[2] === undefined ? m[1] in el.dataset : el.dataset[m[1]] === m[2]);
        };
        const context = {
            addEventListener: (type, fn) => { windowListeners[type] = fn; },
            document: {
                documentElement: { classList: { add: n => rootClasses.add(n), remove: n => rootClasses.delete(n) } },
                querySelectorAll: sel => nodes.filter(el => matches(el, sel)),
                querySelector: sel => nodes.find(el => matches(el, sel)) || null,
            },
        };
        runInNewContext(skeleton.replace('/*其余互动用on绑定*/', handler), context);
        const ready = rootClasses.has('js');
        const byId = id => nodes.find(el => el.id === id);
        for (const id of clicks || nodes.filter(el => el.listeners.length).map(el => el.id)) byId(id).listeners.forEach(fn => fn({}));
        if (after) after(windowListeners);
        return { ready, js: rootClasses.has('js'), hidden: id => byId(id).classes.has('wait'), attr: (id, k) => byId(id).attrs[k] };
    };
    const story = [{ id: 's2', wait: true }, { id: 'b2', data: { show: '#s2' } }];
    let r = run({ els: story });
    assert.equal(r.ready && r.js, true);
    assert.equal(r.hidden('s2'), false, '露出：点了就出现');
    r = run({ els: [{ id: 'note', wait: true }, { id: 'bn', data: { open: '#note' } }], clicks: ['bn'] });
    assert.equal(r.hidden('note'), false, '开合：第一次打开');
    assert.equal(r.attr('bn', 'aria-expanded'), 'true');
    r = run({ els: [{ id: 'note', wait: true }, { id: 'bn', data: { open: '#note' } }], clicks: ['bn', 'bn'] });
    assert.equal(r.hidden('note'), true, '开合：再点合上');
    assert.equal(r.attr('bn', 'aria-expanded'), 'false');
    assert.equal(r.js, true);
    const tabs = [{ id: 'chat', data: { pane: 'app' } }, { id: 'wallet', wait: true, data: { pane: 'app' } },
        { id: 'tc', data: { tab: '#chat' } }, { id: 'tw', data: { tab: '#wallet' } }];
    r = run({ els: tabs, clicks: ['tw'] });
    assert.equal(r.ready, true, '默认面板不加 wait，另一块由切换按钮负责');
    assert.deepEqual([r.hidden('chat'), r.hidden('wallet')], [true, false], '切换：只显示选中的一块');
    r = run({ els: tabs, clicks: ['tw', 'tc'] });
    assert.deepEqual([r.hidden('chat'), r.hidden('wallet')], [false, true], '切换：可以切回去');
    const reply = [{ id: 'r1', wait: true }, { id: 'pick', data: { reply: '#r1' } }];
    r = run({ els: reply, handler: "on('[data-reply]',b=>pick(b.dataset.reply).classList.remove('wait'));" });
    assert.equal(r.ready, true, '自定义互动把目标写在按钮 data-* 里，也算有入口');
    assert.equal(r.hidden('r1'), false);
    assert.equal(run({ els: story, handler: "on('#b2',()=>missingSound());" }).js, false, '点击处理函数出错：去掉 js，全部露出');
    assert.equal(run({ els: [...story, { id: 's3', wait: true }] }).ready, false, '有 wait 内容没有任何按钮：启动时就不隐藏');
    assert.equal(run({ els: [{ id: 'b', data: { show: '#nowhere' } }] }).js, false, '露出的目标不存在：全部露出');
    assert.equal(run({ els: [{ id: 'b', data: { open: '#nowhere' } }] }).js, false, '开合的目标不存在：全部露出');
    assert.equal(run({ els: [{ id: 'b', data: { tab: '#nowhere' } }] }).js, false, '切换的目标不存在：全部露出');
    assert.equal(run({ els: story, after: l => l.unhandledrejection?.({}) }).js, false, '异步操作报错：全部露出');
    assert.equal(run({ els: story, after: l => l.error?.({}) }).js, false, '定时器里报错：全部露出');
});

test('三档规则：点哪看哪，后两档给读者身份、几处回响和多样动作，待排版正文仍一字不动', () => {
    for (const profile of adaptiveRenderProfiles()) {
        assert.match(profile.rules, /【点哪看哪】点到的东西原地回应/);
        assert.match(profile.rules, /不自动滚动/);
        assert.match(profile.rules, /不做fixed全屏遮罩/);
        assert.match(profile.rules, /data-open="#该id"开合/);
        assert.match(profile.rules, /data-tab="#该id"切换/);
        assert.match(profile.rules, /自定义互动也把目标写进button的data-\*/);
        assert.match(profile.rules, /如果提供了待排版正文，必须原样保留，只加物件文字与状态提示/);
        assert.doesNotMatch(profile.rules, /不另添台词/);
    }
    const [lively, immersive, experimental] = adaptiveRenderProfiles();
    assert.doesNotMatch(lively.rules, /【让东西回应你】/);
    for (const profile of [immersive, experimental]) {
        assert.match(profile.rules, /【让东西回应你】先定读者在故事里的身份/);
        assert.match(profile.rules, /一个动作几处回响/);
        assert.match(profile.rules, /替主角选回复/);
    }
    assert.match(immersive.rules, /至少用两种动作/);
    assert.match(experimental.rules, /至少用三种动作/);
    assert.match(experimental.rules, /不点也能读完的彩蛋/);
    assert.doesNotMatch(experimental.rules, /已发现 n\/总数/, '不再写死同一个套路');
});

test('三份 HTML 规则按阅读、参与、探索区分，不要求插件标记', () => {
    const profiles = adaptiveRenderProfiles();
    assert.deepEqual(profiles.map(profile => profile.id), Object.values(ADAPTIVE_RENDER_SELECTIONS));
    for (const profile of profiles) {
        assert.equal(isAdaptiveRenderSelection(profile.id), true);
        assert.match(profile.rules, /主线按原顺序推进/);
        assert.match(profile.rules, /不设置跳过整套体验/);
        assert.match(profile.rules, /首次点击时new AudioContext\(\)并resume\(\)/);
        assert.match(profile.rules, /如果提供了待排版正文，必须原样保留/);
        assert.doesNotMatch(profile.rules, /data-theater-|THEATER_P\d|只设计一个|两到三个/);
    }
    assert.match(profiles[0].rules, /阅读为主，细节灵巧/);
    assert.match(profiles[1].rules, /参与情境，动作贯穿体验/);
    assert.match(profiles[2].rules, /主动探索，发现有意义的惊喜/);
});

test('HTML 模板统一覆盖 Markdown 输出并检查配色，保留代码要求且不影响纯文字', () => {
    const source = readTheaterImplementation();
    const resolve = source.match(/function (?:runtime\.)?resolveRenderSelection\([^]*?^}/m)?.[0];
    const guardrails = source.match(/const (?:runtime\.)?HTML_RENDER_FINAL_GUARDRAILS = `([^]*?)`;/)?.[1];
    assert.ok(resolve && guardrails);
    assert.match(guardrails, /Markdown或Markdown代码块时，仅把标题、编号、列表、强调层级转为语义化HTML/);
    assert.match(guardrails, /HTML\/CSS\/JavaScript、视觉、交互、内容要求照常实现/);
    assert.match(guardrails, /各场景\/状态同步设置背景、正文、小字、边框、控件/);
    assert.match(guardrails, /浅底深字、深底浅字/);
    assert.match(guardrails, /禁止文字与背景明度相近/);
    for (const profile of adaptiveRenderProfiles()) {
        assert.ok(estimateTokenCount(`${profile.rules}\n\n${guardrails}`) <= 2175, `${profile.name} 含兜底规则后明显过长`);
        for (const interactiveMode of [false, true]) {
            const settings = {
                selectedRenderIndex: profile.id, interactiveMode,
                renderTemplates: [{ name: profile.name, content: profile.rules }],
            };
            const select = runInNewContext(resolve + '; resolveRenderSelection', {
                settings, adaptiveRenderProfile, isPlainTextSelection, plainTextThemeForSelection,
                normalizeRenderSelection: value => value,
                DEFAULT_RENDER_TEMPLATE: '默认 HTML', DEFAULT_RENDER_TEMPLATE_PC: 'PC HTML',
                DEFAULT_RENDER_TEMPLATE_TEXT: '仅正文',
                HTML_RENDER_FINAL_GUARDRAILS: guardrails,
            });
            const builtin = select();
            settings.selectedRenderIndex = '0';
            const custom = select();
            assert.equal(builtin.rules, custom.rules);
            assert.equal(builtin.isPlainTextRender, false);
            assert.equal(builtin.rules, profile.rules + `\n\n${guardrails}`);
            assert.deepEqual(buildGenerationPayload({ instruction: '写一段雨夜故事', rules: builtin.rules }),
                buildGenerationPayload({ instruction: '写一段雨夜故事', rules: custom.rules }));
            settings.selectedRenderIndex = profile.id;
            assert.equal(select(true).rules, '仅正文');
            assert.equal(select(true).isPlainTextRender, true);
        }
    }
});

test('内置、自定义与默认模板的普通、自动、历史续写和长文计划一致', async () => {
    const source = readTheaterImplementation();
    const runSource = source.slice(source.indexOf('async function runGeneration('));
    const plan = runSource.slice(runSource.indexOf('    const contCtx ='), runSource.indexOf("    runtime.isPreparingGeneration = true;"));
    const assembly = runSource.match(/payload = await assembleGenerationPayload\(instruction, \{[^]*?\n        \}\);/)?.[0];
    assert.ok(assembly);
    for (const selection of ['__default__', '0', ...Object.values(ADAPTIVE_RENDER_SELECTIONS)]) {
        for (const { target, autoContinue, maxAutoRounds } of [1000, 4999, 5000, 12000, 20000].flatMap(target =>
            [false, true].flatMap(autoContinue => [1, 3].map(maxAutoRounds => ({ target, autoContinue, maxAutoRounds }))))) {
            for (const isAuto of [false, true]) {
                for (const continueContext of ['', '已有前情']) {
                    const settings = { manualTargetEnabled: true, manualTargetChars: target, maxAutoRounds, autoContinue };
                    const evaluate = runInNewContext('(async () => {' + plan + '\nlet payload;\n' + assembly
                        + '\nreturn { stagedRenderMode, stagedMultiRoundMode, payload }; })', {
                        settings, isAuto, continueContext, continuationSession: null, instruction: '合成任务',
                        resolveTargetWordCount, isStagedRenderTarget, isLongFormTarget,
                        resolveRenderSelection: () => ({ selectedRender: selection, adaptiveProfile: adaptiveRenderProfile(selection) }),
                        assembleGenerationPayload: async (_instruction, options) => options,
                    });
                    const result = await evaluate();
                    const expectedStaged = target >= 5000;
                    const expectedManuscript = (isAuto || !continueContext) && expectedStaged && autoContinue && maxAutoRounds >= 2;
                    assert.equal(result.stagedRenderMode, expectedStaged);
                    assert.equal(result.payload.forcePlainText, expectedStaged);
                    assert.equal(result.payload.longFormPlan, expectedManuscript);
                    assert.equal(result.stagedMultiRoundMode, expectedManuscript);
                    assert.equal(result.payload.continuationText, isAuto ? '' : continueContext);
                    assert.equal(result.payload.maxContinuationRounds, settings.maxAutoRounds);
                }
            }
        }
    }
});

test('普通、自动和续写连续执行生成启动流程，完成日志和任务初始化', async () => {
    const source = readTheaterImplementation().replace(/\r\n/g, '\n');
    const start = source.indexOf('async function runGeneration(');
    const end = source.indexOf("    try {\n        let firstHtml = '';", start);
    // 保留入口到任务创建之间的全部代码，包括日志、界面状态和流式初始化。
    assert.ok(start >= 0 && end > start);
    const startup = source.slice(start, end);
    const scenarios = [0, 4999, 5000, 8000, 20000].map(target => ({ target, instruction: '合成任务', manual: true }));
    for (const instruction of ['不得少于7000字', '不能少于七千字', '不超过7000字', '约7千字', '7000字左右', '7k字', '7,000字', '字数要求：7000']) {
        scenarios.push({ target: 7000, instruction, manual: false });
    }
    for (const { target, instruction, manual } of scenarios) {
        for (const mode of ['manual', 'auto', 'continue']) {
            for (const autoContinue of [false, true]) {
                const logs = [];
                const assemblies = [];
                const ui = { length: 0, hide() { return this; }, show() { return this; },
                    text() { return this; }, empty() { return this; }, prop() { return this; } };
                const context = {
                    settings: { manualTargetEnabled: manual, manualTargetChars: target, maxAutoRounds: 3, autoContinue },
                    isGenerating: false, isPreparingGeneration: false, resultEditSnapshot: null,
                    continueContext: mode === 'manual' ? '' : '合成前情',
                    continuationSession: { direction: '合成方向', source: { rounds: ['合成前情'] } },
                    resolveTargetWordCount, isStagedRenderTarget, classifyLengthTier,
                    normalizeContextRange, itemTags, createGenerationJob, textOutputModeForTheme,
                    resolveRenderSelection: () => ({ selectedRender: '__default__', label: '合成模板', isPlainTextRender: false }),
                    assembleGenerationPayload: async (_instruction, options) => {
                        assemblies.push(options);
                        return { targetWordCount: resolveTargetWordCount(_instruction, { manualEnabled: manual, manualTarget: target }), ctx: {}, diagnosticContext: {},
                            systemPrompt: '合成系统', userPrompt: '合成任务', isPlainTextRender: options.forcePlainText };
                    },
                    updateContinueHint() {}, clearRequestIssue() {}, knownInstructionTags: () => [],
                    archiveCurrentResult: async () => true,
                    captureGenerationApiRoute: () => ({ protocol: 'test', model: 'synthetic' }),
                    runtimeLog: (...args) => logs.push(args),
                    $: () => ui, AbortController,
                    createCumulativeStreamRenderer: () => ({ update() {}, reset() {} }),
                };
                const run = runInNewContext('(' + startup + '\nreturn currentGenerationJob;\n})', context);
                const job = await run(instruction, mode === 'auto', []);
                assert.equal(context.isPreparingGeneration, false);
                assert.equal(context.isGenerating, true);
                assert.equal(logs.filter(([, message]) => message === '生成开始').length, 1);
                assert.equal(assemblies.length, 1);
                assert.equal(assemblies[0].continuationText, mode === 'continue' ? '合成前情' : '');
                assert.equal(assemblies[0].forcePlainText, target >= 5000);
                assert.equal(assemblies[0].longFormPlan, target >= 5000 && autoContinue && mode !== 'continue');
                assert.equal(job.maxRounds, target >= 5000 && autoContinue ? 3 : 1);
                assert.equal(job.autoContinue, target >= 5000 && autoContinue);
                assert.equal(job.minimumRounds, target >= 5000 && autoContinue && mode !== 'continue' ? 2 : 1);
            }
        }
    }
});

test('无专用标记的 HTML 直接保留；多轮排版仍保护正文并在失败时保留全文', async () => {
    const source = readTheaterImplementation();
    const runSource = source.slice(source.indexOf('async function runGeneration('));
    const dispatch = runSource.slice(runSource.indexOf('        if (selectedPlainTextRender) {'), runSource.indexOf("        runtime.runtimeLog('info', '渲染路径'"));
    const request = source.match(/async function (?:runtime\.)?requestFinalRenderedHtml\([^]*?^}\r?$/m)?.[0];
    const validate = source.match(/function validateFinalRenderedHtml\([^]*?^}/m)?.[0];
    assert.ok(dispatch && request && validate);
    for (const profile of adaptiveRenderProfiles()) {
        for (const scenario of ['single', 'multiple', 'staged', 'failure', 'staged-failure', 'staged-text']) {
            const calls = [];
            const initialHtml = '<html><body><button>翻开</button><p>第一段。</p><p>第二段。</p></body></html>';
            const harness = runInNewContext('(async () => {'
                + "let lastGeneratedHtml = '', currentOutputMode = 'html';"
                + 'let activeRound, firstChunkShown, bgStreamText, retainStreamAsBody, currentRoundStreamText, lastRequestContext, layoutRetry;\n'
                + 'const runtime = Object.create(globalThis.runtime);\n'
                + 'Object.defineProperties(runtime, { lastGeneratedHtml: { get: () => lastGeneratedHtml, set: value => { lastGeneratedHtml = value; } }, currentOutputMode: { get: () => currentOutputMode, set: value => { currentOutputMode = value; } }, bgStreamText: { get: () => bgStreamText, set: value => { bgStreamText = value; } }, lastRequestContext: { get: () => lastRequestContext, set: value => { lastRequestContext = value; } } });\n'
                + validate + '\n' + request + '\n' + dispatch
                + '\nreturn { html: lastGeneratedHtml, mode: currentOutputMode }; })', {
                selectedPlainTextRender: scenario === 'staged-text', selectedTextTheme: 'light', textOutputModeForTheme,
                stagedRenderMode: scenario.startsWith('staged'),
                currentGenerationJob: { segments: Array(scenario === 'single' || scenario.startsWith('staged') ? 1 : 2).fill({}) },
                plannedRenderSelection: { rules: profile.rules }, renderTemplate: profile.name,
                payload: { generationFoundation: { originalInstruction: '按钮必须使用指定的 HTML、CSS 和 JavaScript。' } },
                newText: '第一段。\n\n第二段。', firstHtml: initialHtml, firstHtmlSource: initialHtml,
                generationAbortController: new AbortController(), ownsGeneration: () => true,
                ctx: {}, apiRoute: {}, abortController: null, onChunk() {},
                popupAlive: () => false, runtimeLog() {}, markCompleted() {}, recordRequestMetrics() {},
                lastRequestMetrics: {}, streamRenderer: { reset() {} },
                buildFinalRenderPayload, hydrateFinalRenderHtml, readableCharCount,
                extractHtml: value => value,
                htmlToPlainText: html => html.replace(/<[^>]*>/g, ''),
                textFallbackHtml: text => '<article>' + text + '</article>',
                captureRequestIssue: () => ({ signal: 'TEST-FAILED' }), toastr: { warning() {}, info() {} },
                requestConfiguredGenerationApi: async args => {
                    calls.push(args);
                    if (scenario.endsWith('failure')) return { text: '<html><body>{{THEATER_P0001}}</body></html>' };
                    return { text: '<html><body><button>翻开</button><p>{{THEATER_P0001}}</p><p>{{THEATER_P0002}}</p></body></html>' };
                },
            });
            const result = await harness();
            if (scenario === 'staged-text') {
                assert.equal(calls.length, 0, '大目标纯文字模板不额外请求美化');
                assert.match(result.html, /第一段。/);
                assert.match(result.html, /第二段。/);
            } else if (scenario === 'single') {
                assert.equal(calls.length, 0, '普通单轮直接使用模型 HTML，不新增排版请求');
                assert.equal(result.html, initialHtml);
            } else {
                assert.equal(calls.length, scenario.endsWith('failure') ? 2 : 1);
                assert.ok(calls[0].userPrompt.includes(profile.rules));
                assert.match(calls[0].userPrompt, /原始小剧场指令：仅作为设计意图参考/);
                assert.match(calls[0].userPrompt, /按钮必须使用指定的 HTML、CSS 和 JavaScript/);
                assert.match(calls[0].userPrompt, /不能覆盖正文数据，也不能被重新执行、续写或抄进页面/);
                assert.match(result.html, /第一段。/);
                assert.match(result.html, /第二段。/);
                assert.equal(result.mode, scenario.endsWith('failure') ? 'text' : 'html');
            }
        }
    }
});

test('生成页双模板切换保留，旧交互开关与追加规则已移除', () => {
    const source = readTheaterImplementation();
    assert.match(source, /id="theater-quick-render-toggle"/);
    assert.match(source, /id="theater-quick-render-a"/);
    assert.match(source, /id="theater-quick-render-b"/);
    assert.doesNotMatch(source, /validateAdaptiveRenderHtml|adaptiveSelection|adaptiveRenderMode|adaptiveRenderPlan/);
    assert.doesNotMatch(source, /is-template-managed|额外进行一次独立 HTML|另有自适应排版请求/);
    const toggle = source.match(/<input[^>]*id="theater-interactive-toggle"[^>]*>/)?.[0];
    assert.equal(toggle, undefined);
    assert.doesNotMatch(source, /INTERACTIVE_ADDON|(?:runtime\.)?settings\.interactiveMode/);
});
