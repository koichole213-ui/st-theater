// 从 core.test.js 拆出：long-dream-ui
import { readStyles } from './styles.js';
import { retainLongDreamDraftCandidate, appendLongDreamDraftCandidate } from '../long-dream.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';
import { theaterNavHTML } from '../theater-nav.js';
import { LONG_DREAM_DRAFT_STATUS, LONG_DREAM_WORLD_BOOK_POLICY, createLongDreamRecord, createLongDreamWorldBookSnapshot, promoteLongDreamDraft, saveLongDreamDraft, updateLongDreamDefinition } from '../long-dream.js';

test('长梦输入清空保留每部目标字数，删除长梦才移除，重新读取设置仍有效', () => {
    const source=readTheaterImplementation();
    const functions=['longDreamComposerDrafts','getLongDreamComposerDraft','setLongDreamComposerDraft','clearLongDreamComposerDraft']
        .map(name=>source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');
    const scope={settings:{},save(){}};
    runInNewContext(functions + '\nsetLongDreamComposerDraft(1,{title:"旧章",instruction:"旧指令",targetChars:5000});setLongDreamComposerDraft(2,{targetChars:7000});clearLongDreamComposerDraft(1);',scope);
    scope.settings=JSON.parse(JSON.stringify(scope.settings));
    assert.equal(runInNewContext('getLongDreamComposerDraft(1).targetChars',scope),5000);
    assert.equal(runInNewContext('getLongDreamComposerDraft(1).instruction',scope),'');
    assert.equal(runInNewContext('getLongDreamComposerDraft(1).title',scope),'');
    assert.equal(runInNewContext('getLongDreamComposerDraft(2).targetChars',scope),7000);
    assert.equal(runInNewContext('getLongDreamComposerDraft(3).targetChars',scope),3000);
    runInNewContext('clearLongDreamComposerDraft(1,{forgetTarget:true})',scope);
    assert.equal(scope.settings.longDreamComposerDrafts['1'],undefined);
});

test('新建长梦来源切换只更新默认提示，空名保存采用来源标题', () => {
    const source=readTheaterImplementation();
    const change=source.match(/'#theater-dream-source', function \(\) \{([^]*?)\n    \}\);/)[1];
    const create=source.match(/'#theater-dream-create-confirm', async function \(\) \{([^]*?)const worldLineRelation/)[1];
    for(const input of ['', '  ', '自己的长梦']) {
        let value=input, placeholder='旧来源';
        const nameField={val(next){if(arguments.length){value=next;return this;}return value;},attr(_key,next){placeholder=next;return this;}};
        const noop={val:()=>'', html(){return this;},removeClass(){return this;},addClass(){return this;},text(){return this;}};
        const context={longDreamCanonSuggestionState:{}, resolveLongDreamSource:()=>({title:'新来源',key:'source'}),
            resetLongDreamCanonSuggestions(){},longDreamSourceInstructionState:()=>({}),longDreamSourcePreviewHTML:()=>'',
            refreshLongDreamCreateWorldBookState(){},renderLongDreamCanonSuggestions(){},
            $:selector=>selector==='#theater-dream-title'?nameField:noop,
            toastr:{warning(){throw Error('unexpected warning');}}};
        runInNewContext('(function(){'+change+'})()',context);
        assert.equal(value,input); assert.equal(placeholder,'新来源');
        assert.equal(runInNewContext('(function(){'+create.slice(create.indexOf('if (runtime.longDreamCanonSuggestionState.controller)'))+'return title;})()',context),input.trim()||'新来源');
    }
});

test('新建名称是空输入和默认提示，留空或空格采用默认，取消不保存', async () => {
    const source=readTheaterImplementation();
    for(const fn of ['askNewItemName','chooseTagsWithNew']) {
        const code=source.match(new RegExp(`async function ${fn}\\([^]*?^}`, 'm'))[0];
        for(const [input,confirmed,expected] of [['',true,'默认名称'],['  ',true,'默认名称'],[' 我的名字 ',true,'我的名字'],['',false,null]]) {
            let html='';
            const scope={settings:{},esc:s=>String(s),knownInstructionTags:()=>[], normalizeTagFilter:()=>[],
                cleanTagName:s=>String(s||'').trim(), normalizeTagList:a=>a.filter(Boolean), TAG_UNCATEGORIZED:'__uncategorized__',
                SillyTavern:{getContext:()=>({POPUP_TYPE:{CONFIRM:1},Popup:class {constructor(markup){html=markup;this.dlg={};} async show(){return confirmed;}}})},
                $:()=>({on(){},find:selector=>({val:()=>selector.includes('name')?input:'',map:()=>({get:()=>[]})})}),
                toastr:{warning(){throw Error('unexpected validation');}}};
            const result=await runInNewContext(code+ (fn==='askNewItemName' ? '\naskNewItemName("保存","默认名称")' : '\nchooseTagsWithNew({templateName:"默认名称"})'),scope);
            assert.equal(fn==='askNewItemName'?result:result?.name??null,expected);
            assert.match(html,/value="" placeholder="默认名称"/);
        }
    }
});

test('长梦首帧使用当前页面，慢资料完成后不重建输入或抢回已切换的标签', async () => {
    const source = readTheaterImplementation();
    const extract = name => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'))?.[0] || '';
    let finishMaterials;
    const materials = new Promise(resolve => { finishMaterials = resolve; });
    let closePopup;
    const closed = new Promise(resolve => { closePopup = resolve; });
    let finishEstimate;
    const estimated = new Promise(resolve => { finishEstimate = resolve; });
    const screen = { html: '', tab: 'long-dream', input: '', writes: 0 };
    const ui = { length: 1, val() { return ''; }, text() { return this; }, html(value) { screen.html = value; screen.writes++; return this; } };
    // 使用真实主弹窗的长梦插槽，而不是预先假定它应调用哪一个构建函数。
    const rootMarkup = source.match(/<div id="theater-long-dream-root">[^\n]+/)?.[0]?.trim();
    assert.ok(rootMarkup);
    const harness = runInNewContext(`
        let longDreamWorkspaceSection = 'definition', longDreamView = 'detail', activeLongDreamId = 'dream';
        let longDreamWorkLevel = 'list', activeLongDreamChapterId = null;
        let activeTheaterPopupSession = null, instructionSweepCleanup = null, wbSearch = '', presetSearch = '';
        let resultSwipeCleanup = null, resultReader = null;
        const longDreamCache = [{ id: 'dream', chapters: [] }];
        const longDreamGenerationController = null, longDreamChapterEditController = null;
        const isGenerating = false, lastGeneratedHtml = '', currentDisplayHtml = '', recentCache = [];
        ${extract('longDreamWorkspaceHTML')}
        ${extract('longDreamPanelHTML')}
        ${extract('syncLongDreamPanel')}
        ${extract('renderLongDreamPanel')}
        function buildPopupHTML() { return \`${rootMarkup}\`; }
        ${extract('openTheaterPopup')}
        ({ openTheaterPopup, navigate() {
            longDreamWorkspaceSection = 'definition';
            longDreamView = 'create'; activeLongDreamId = null;
            renderLongDreamPanel();
        } });
    `, {
        settings: { lastTheaterTab: 'long-dream' }, $: () => ui, esc: value => value,
        maybeStartOnboarding() {}, closeOnboarding() {},
        document: { getElementById: () => ({}) },
        SillyTavern: { getContext: () => ({ POPUP_TYPE: { TEXT: 1 }, Popup: class {
            constructor(html) { screen.html = html; screen.writes++; }
            show() { return closed; }
        } }) },
        normalizeTheaterTab: value => value, restoreLongDreamNavigation() {}, waitForPopupElements: async () => true,
        setBallDot() {}, bindEvents() {}, decorateConfigLayout() {}, applyResultToolboxMode() {}, renderRuntimeLog() {},
        updateContinueHint() {}, initializeResultWorkspace() {}, currentGenerationResult: null, histBatchMode: false, continuationSession: null,
        loadWorldBookList: async () => {}, loadPresetNameList: () => materials,
        reloadWorldBooks: async () => {}, refreshTokenEstimate: async () => { finishEstimate(); },
        refreshLongDreamCreateWorldBookState() {}, queueLongDreamMemoryWeave() {}, syncDreamRelayout() {}, activeRelayout() {}, cancelManualRelayout() {},
        longDreamDetailState: () => ({ currentCheckedEntries: 0 }),
        longDreamDefinitionHTML: () => '<input id="definition" value="saved">',
        longDreamCreateHTML: () => '<input id="create" value="">', longDreamListHTML: () => '<div>作品列表</div>',
        activateTheaterTab(tab) { screen.tab = tab; screen.input = ''; screen.writes++; },
        closeInstructionActionMenus() {}, detachHistoryTouchMoveHandler() {}, resetHistorySelectionGesture() {},
        resetLongDreamCanonSuggestions() {}, closeFullscreenReader() {},
    });
    const opening = harness.openTheaterPopup();
    assert.match(screen.html, /id="definition"/);
    assert.match(screen.html, /theater-dream-workspace/);
    assert.doesNotMatch(screen.html, /作品列表/);
    await Promise.resolve();
    harness.navigate();
    screen.input = '加载期间刚填写的定梦内容';
    screen.tab = 'setting';
    const writesBeforeCompletion = screen.writes;
    finishMaterials();
    await estimated;
    await Promise.resolve();
    assert.equal(screen.writes, writesBeforeCompletion, '资料完成不能重新构建长梦页面');
    assert.equal(screen.input, '加载期间刚填写的定梦内容');
    assert.equal(screen.tab, 'setting');
    closePopup();
    await opening;
});

test('资料完成只更新长梦计数和进度，已展示的候选正文不重复载入', () => {
    const source = readTheaterImplementation();
    const sync = source.match(/function (?:runtime\.)?syncLongDreamPanel\([^]*?^}/m)?.[0];
    const calls = { review: 0, candidate: 0, progress: 0, estimate: 0, label: '' };
    const harness = runInNewContext(`
        let longDreamWorkspaceSection = 'continue';
        const longDreamCache = [{id: 'dream'}], activeLongDreamId = 'dream';
        const refreshingLongDreamWorldBooks = false, refreshingLongDreamWorldBookId = null;
        ${sync}
        ({ syncLongDreamPanel, definition() { longDreamWorkspaceSection = 'definition'; } });
    `, {
        $: key => ({ prop() { return this; }, attr() { return this; }, find() { return this; }, text(value) { if (key === '#theater-dream-frozen-count') calls.label = value; return this; } }),
        longDreamDetailState: () => ({ snapshotEntries: 7 }),
        renderLongDreamReviewDraft() { calls.review++; }, renderLongDreamProgressCandidate() { calls.candidate++; },
        syncLongDreamProgressDisplay() { calls.progress++; }, scheduleLongDreamTokenEstimate() { calls.estimate++; },
    });
    harness.syncLongDreamPanel();
    harness.syncLongDreamPanel({ renderDrafts: false });
    assert.deepEqual(calls, { review: 1, candidate: 1, progress: 2, estimate: 2, label: '' });
    harness.definition();
    harness.syncLongDreamPanel({ renderDrafts: false });
    assert.equal(calls.label, '· 7 条');
});

test('定梦单次更新读取新资料后保存，失败或切换不覆盖，保留未保存编辑', async () => {
    const source = readTheaterImplementation();
    const code = source.match(/let (?:runtime\.)?refreshingLongDreamWorldBooks = false;[^]*?(?=\nfunction longDreamDefinitionHTML)/)[0];
    const syncCode = source.match(/function (?:runtime\.)?syncLongDreamPanel\([^]*?^}/m)[0];
    for (const mode of ['success', 'read-failed', 'read-threw', 'save-failed', 'save-threw', 'books-changed', 'dream-switched', 'deleted', 'record-changed', 'generation-started', 'review-started', 'no-entries', 'initial-review', 'initial-generating', 'initial-preparing', 'initial-isolated', 'no-books']) {
        const original = { ...createLongDreamRecord({ title: '已保存标题', canon: '已保存正典',
            worldBookPolicy: LONG_DREAM_WORLD_BOOK_POLICY.SELECTED, worldBookNames: ['A'],
            worldBookSnapshot: createLongDreamWorldBookSnapshot({ bookNames: ['A'], entries: [{ book: 'A', uid: 1, content: '旧资料', enabled: true }] }),
            source: { text: '原章节', html: '<main>原章节</main>' },
        }), id: 1 };
        const originalJSON = JSON.stringify(original);
        const fields = new Map([
            ['#theater-dream-edit-title', { value: '未保存标题' }],
            ['#theater-dream-edit-canon', { value: '未保存正典' }],
        ]);
        const notices = [];
        let resolve, reject, calls = 0, writes = 0, generating = mode === 'initial-generating', review = mode === 'initial-review';
        const settings = { selectedWorldBooks: mode === 'no-books' ? [] : ['A'] };
        const scope = { settings, activeLongDreamId: 1, longDreamCache: [original], longDreamWorkspaceSection: 'definition',
            isPreparingGeneration: mode === 'initial-preparing', longDreamChapterEditController: null,
            worldBookCacheKey: () => settings.selectedWorldBooks.join(','),
            longDreamDetailState: record => ({ isGeneratingThisDream: generating, hasReviewDraft: review, selectedPolicy: mode !== 'initial-isolated',
                snapshotEntries: record.inheritance.snapshot.books.reduce((n,b) => n + b.entries.length, 0), bookText: record.inheritance.worldBookNames.join('、') }),
            updateLongDreamDefinition,
            captureCurrentLongDreamWorldBooks: names => createLongDreamWorldBookSnapshot({ bookNames: names, entries: mode === 'no-entries' ? [] : [
                { book: 'A', uid: 1, content: '刚读回的新资料', enabled: true }, { book: 'A', uid: 2, content: '勾选的新条目', enabled: true },
                { book: 'A', uid: 3, content: '未勾选不冻结', enabled: false },
            ] }),
            longDreamSnapshotEntryCount: snapshot => snapshot.books.reduce((n,b) => n + b.entries.length, 0),
            longDreamPut: async record => { writes++; if (mode === 'save-failed') return false; if (mode === 'save-threw') throw Error('private'); scope.longDreamCache[0] = record; return record; },
            toastr: Object.fromEntries(['info', 'success', 'warning'].map(type => [type, text => notices.push([type,text])])),
            $: key => { if (!fields.has(key)) fields.set(key, {}); const field = fields.get(key);
                return { prop(k,v) { field[k]=v; return this; }, attr(k,v) { field[k]=v; return this; }, find() { return this; }, text(v) { field.label=v; return this; } }; },
            reloadWorldBooks: options => { calls++; assert.equal(options.force, true); assert.equal(options.requireFresh, true); return new Promise((done, fail) => { resolve=done; reject=fail; }); },
        };
        runInNewContext(code + '\n' + syncCode, scope);
        const loading = scope.refreshLongDreamWorldBookSources();
        if (mode.startsWith('initial-') || mode === 'no-books') { await loading; assert.equal(calls, 0, mode); assert.equal(writes, 0, mode); continue; }
        await scope.refreshLongDreamWorldBookSources();
        assert.equal(calls, 1, mode);
        assert.equal(fields.get('#theater-dream-refresh-world-book').disabled, true);
        assert.equal(fields.get('#theater-dream-refresh-world-book').label, '更新中…');
        assert.equal(fields.get('#theater-dream-save-definition').disabled, true);
        assert.equal(writes, 0, '读取完成前不保存');
        if (mode === 'books-changed') settings.selectedWorldBooks = ['B'];
        if (mode === 'dream-switched') scope.activeLongDreamId = 2;
        if (mode === 'deleted') scope.longDreamCache = [];
        if (mode === 'record-changed') scope.longDreamCache = [{ ...original, canon: '其他已保存修改' }];
        if (mode === 'generation-started') generating = true;
        if (mode === 'review-started') review = true;
        if (mode === 'read-threw') reject(Error('private')); else resolve(mode !== 'read-failed');
        await loading;
        const shouldWrite = ['success', 'save-failed', 'save-threw'].includes(mode);
        assert.equal(writes, shouldWrite ? 1 : 0, mode);
        if (mode === 'success') {
            const saved = scope.longDreamCache[0];
            assert.equal(saved.inheritance.snapshot.books[0].entries[0].content, '刚读回的新资料');
            assert.equal(saved.inheritance.snapshot.books[0].entries.length, 2);
            assert.deepEqual(saved.chapters, original.chapters);
            assert.equal(saved.canon, original.canon);
            assert.equal(saved.title, original.title);
            assert.equal(fields.get('#theater-dream-frozen-count').label, '· 2 条');
            assert.equal(notices.at(-1)[0], 'success');
        } else assert.equal(notices.some(([type]) => type === 'success'), false, mode);
        assert.equal(JSON.stringify(original), originalJSON, mode);
        assert.equal(fields.get('#theater-dream-edit-title').value, '未保存标题');
        assert.equal(fields.get('#theater-dream-edit-canon').value, '未保存正典');
        assert.doesNotMatch(JSON.stringify(notices), /private/);
        scope.activeLongDreamId = 1; scope.longDreamCache = [original]; generating = false; review = false;
        scope.syncLongDreamPanel({ renderDrafts: false });
        assert.equal(fields.get('#theater-dream-refresh-world-book').disabled, false, mode);
        assert.equal(fields.get('#theater-dream-refresh-world-book')['aria-busy'], 'false', mode);
        assert.equal(fields.get('#theater-dream-save-definition').disabled, false, mode);
    }
});

test('世界书更新期间同一长梦不能保存旧定梦或启动续写，结束后可进入原流程', async () => {
    const source = readTheaterImplementation();
    const generation = source.match(/async function (?:runtime\.)?generateNextLongDreamChapter\([^]*?^}/m)[0];
    const saveStart = source.indexOf("$d.off('click.tdsave')");
    const saveEnd = source.indexOf("\n    });", saveStart) + '\n    });'.length;
    const saveCode = source.slice(saveStart, saveEnd);
    let saveHandler, notices = [];
    const scope = { longDreamCandidateSavePending: false, refreshingLongDreamWorldBookId: 1, activeLongDreamId: 1, isGenerating: true,
        activeLongDreamGenerationId: 1, longDreamGenerationController: { active: true },
        toastr: { info: text => notices.push(text), warning: text => notices.push(text) },
        $d: { off() { return this; }, on(_event, _selector, fn) { saveHandler=fn; return this; } },
    };
    runInNewContext(generation + '\n' + saveCode, scope);
    await scope.generateNextLongDreamChapter(); await saveHandler();
    assert.equal(notices.length, 2); assert.ok(notices.every(text => text.includes('世界书更新完成')));
    notices = []; scope.refreshingLongDreamWorldBookId = null;
    await scope.generateNextLongDreamChapter(); await saveHandler();
    assert.equal(notices.length, 2); assert.ok(notices.every(text => !text.includes('世界书更新完成')));
});

test('长梦拥有独立入口、独立面板和 IndexedDB 长卷仓库', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    assert.match(source, /theaterNavHTML\(initialTab/);
    assert.match(theaterNavHTML('generate'), /data-tab="long-dream"[^>]*>[\s\S]*?长梦/);
    assert.match(source, /data-panel="long-dream"/);
    assert.match(source, /indexedDB\.open\('st-theater', 2\)/);
    assert.match(source, /createObjectStore\('dreams', \{ keyPath: 'id', autoIncrement: true \}\)/);
    assert.match(source, /createLongDreamGenerationController/);
    assert.match(source, /#theater-dream-generate-next', (?:runtime\.)?generateNextLongDreamChapter/);
    assert.match(source, /id="theater-dream-stop-generation"/);
    assert.match(source, /id="theater-dream-confirm-chapter"/);
    assert.match(source, /id="theater-dream-review-fullscreen"/);
    assert.match(source, /id="theater-dream-regenerate-draft"/);
    assert.match(source, /data-dream-candidate-step="-1"/);
    assert.match(source, /data-dream-candidate-step="1"/);
    assert.match(source, /(?:runtime\.)?changeLongDreamDraftCandidate/);
    assert.match(source, /按原要求再生成一版/);
    assert.match(source, /LONG_DREAM_MAX_CANDIDATES/);
    assert.match(source, /longDreamComposerDrafts/);
    assert.match(source, /lastTheaterTab/);
    assert.match(source, /(?:runtime\.)?regenerateLongDreamDraft/);
    assert.match(source, /(?:runtime\.)?requestFinalRenderedHtml/);
    assert.match(source, /autoContinue: (?:runtime\.)?settings\.autoContinue !== false/);
    assert.match(source, /maxRounds: Math\.min\(10, Math\.max\(1, Number\((?:runtime\.)?settings\.maxAutoRounds\) \|\| 3\)\)/);
    assert.match(source, /class="[^"]*theater-dream-next-options/);
    assert.match(source, /id="theater-dream-token-summary-value"/);
    assert.match(source, /id="theater-dream-refresh-world-book"/);
    assert.match(source, /class="[^"]*theater-dream-(?:runtime\.)?settings is-workspace/);
    assert.match(source, /旧记录中有一份指令，请核对/);
    assert.match(styles, /梦中页只保留一条主线：续写/);
    assert.match(styles, /\.theater-dream-candidate-switcher/);
    assert.match(styles, /\.theater-dream-review-head \{[^}]*grid-template-columns:/);
    assert.match(styles, /\.theater-dream-memory-current-state-readonly \{[^}]*text-align:\s*justify/);
});

test('定梦页只保留手写 canon，不再显示 AI 整理建议入口', () => {
    const source = readTheaterImplementation();
    const creation = source.match(/function longDreamCreateHTML\(\) \{[\s\S]*?function (?:runtime\.)?longDreamGenerationStageText/)?.[0] || '';
    assert.match(creation, /id="theater-dream-canon"/);
    assert.doesNotMatch(creation, /longDreamCanonSuggestionHTML|theater-dream-canon-assist|AI 帮我整理/);
    assert.match(source, /composeLongDreamCanon\(/);
});

test('长梦再生成会显示真实版本、等待时间、字数、轮次与旧候选切换', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    const progress = source.match(/<section id="theater-dream-generation-status"[\s\S]*?<section class="ui-card theater-dream-latest">/)?.[0] || '';
    assert.match(source, /第 \$\{state\.activeProgress\?\.candidateNumber/);
    assert.match(source, /正在等待接口返回首字/);
    assert.match(source, /id="theater-dream-progress-elapsed"/);
    assert.match(source, /id="theater-dream-progress-chars"/);
    assert.match(source, /id="theater-dream-progress-round"/);
    assert.match(source, /data-dream-progress-view="candidate"/);
    assert.match(source, /data-dream-progress-view="live"/);
    assert.match(source, /id="theater-dream-progress-candidate-fullscreen"/);
    assert.match(source, /renderLongDreamProgressCandidate/);
    assert.match(progress, /theater-dream-progress-pulse/);
    assert.match(progress, /theater-dream-progress-footer/);
    assert.match(progress, /id="theater-dream-stop-generation"/);
    assert.ok(progress.indexOf('ia-status-track') < progress.indexOf('data-dream-progress-pane="live"'));
    assert.match(styles, /\.theater-dream-progress-meta/);
    assert.match(styles, /\.theater-dream-progress-switch/);
    assert.match(styles, /\.theater-dream-progress-meta \{ display:flex; flex-wrap:wrap/);
    assert.doesNotMatch(styles, /\.theater-dream-progress-meta > span \{[^}]*border:/);
});

test('长梦候选切换居中且无方框，三个审阅操作的内容保持居中', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    const reviewFlow = source.match(/const reviewFlow = state\.hasReviewDraft[\s\S]*?return `<div class="theater-dream-detail/)?.[0] || '';
    assert.ok(reviewFlow.indexOf('theater-dream-candidate-switcher') >= 0);
    assert.ok(reviewFlow.indexOf('theater-dream-candidate-switcher') < reviewFlow.indexOf('theater-dream-review-fullscreen'));
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-review-tools \{[^}]*flex-direction:row;[^}]*align-items:center;[^}]*gap:12px/);
    const controls = styles.split('v4.1.0 review controls')[1] || '';
    assert.match(controls, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-review-tools \{[^}]*width:100%;[^}]*justify-content:center;/);
    assert.match(controls, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-candidate-switcher,[\s\S]*?border:0;[\s\S]*?background:transparent;[\s\S]*?box-shadow:none;/);
    assert.match(controls, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-candidate-switcher strong,[\s\S]*?font-size:max\(10px,calc\(var\(--t-text-sm\) - 2px\)\) !important;/);
    assert.match(controls, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-review-actions \.ui-btn \{[^}]*width:100%;[^}]*justify-content:center;[^}]*text-align:center;/);
    assert.match(controls, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-regenerate \{[^}]*justify-content:center;[^}]*margin-inline:auto;[^}]*text-align:center;/);
});

test('长梦待确认页的字数统计按整个标题区居中', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    assert.match(source, /<p class="theater-dream-review-count">[^\n]*正文约 \$\{readableCharCount/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-review-count \{[^}]*grid-column:1 \/ -1;[^}]*width:100%;[^}]*text-align:center;/);
});

test('长梦最终排版进度只通过统一状态刷新，避免完成提示与字符数交替闪烁', () => {
    const source = readTheaterImplementation();
    const renderer = source.match(/async function (?:runtime\.)?renderLongDreamChapter[\s\S]*?function (?:runtime\.)?createCumulativeStreamRenderer/)?.[0] || '';
    const synchronizer = source.match(/function (?:runtime\.)?syncLongDreamProgressDisplay[\s\S]*?function renderLongDreamReviewDraft/)?.[0] || '';
    assert.match(renderer, /updateLongDreamRenderProgress\(\{/);
    assert.doesNotMatch(renderer, /\$\('#theater-dream-generation-label'\)\.text/);
    assert.match(synchronizer, /longDreamProgressLabelText\(progress\)/);
    assert.match(source, /(?:runtime\.)?longDreamRenderReceivedChars\.toLocaleString\(\)/);
});

test('长梦提供逐章目录、完卷恢复和独立备份入口', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    assert.match(source, /id="theater-dream-import-backup"/);
    assert.match(source, /id="theater-dream-export-all"/);
    assert.match(source, /id="theater-dream-export-current"/);
    assert.match(source, /data-dream-export-one/);
    assert.match(source, /data-dream-open-work/);
    assert.match(source, /(?:runtime\.)?requestLongDreamExport\(\[dream\], 'single'\)/);
    assert.match(source, /function (?:runtime\.)?chooseExportFormat/);
    assert.match(source, /ZIP 可读归档/);
    assert.match(source, /JSON 完整备份/);
    assert.match(source, /(?:runtime\.)?requestHistoryExport/);
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
    assert.match(source, /data-dream-memory-action="(?:runtime\.)?save"/);
    assert.match(source, /data-dream-memory-action="\$\{dismissed \? 'restore' : 'dismiss'\}"/);
    assert.match(source, /theater-dream-memory-current-state-readonly/);
    assert.match(source, /data-dream-memory-v2-action="(?:runtime\.)?save"/);
    assert.match(source, /class="theater-dream-memory-conflict-details"/);
    assert.match(source, /<b>原梦脉<\/b>/);
    assert.match(source, /<b>本章新变化<\/b>/);
    assert.match(source, /data-dream-memory-conflict-action="\$\{conflict.reason === 'missing-target' \? 'reweave' : 'accept'\}"/);
    assert.match(source, /id="theater-dream-memory-analysis-preset"/);
    assert.match(source, /id="theater-import-dream-memory-preset"/);
    assert.match(source, /id="theater-dream-memory-selection"/);
    assert.match(source, /(?:runtime\.)?refreshLongDreamMemorySelection/);
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
    // 手机上点过的按钮会一直保持 :hover；通用的 options-trigger:hover 会把 44px 外框涂成直角色块，手机端要在其后压回透明。
    assert.match(styles, /@media \(max-width:520px\)[\s\S]*?\.theater-dream-chapter-tools-toggle\[aria-expanded="true"\] > i\s*\{[^}]*\}\s*\.theater-panel\[data-panel="long-dream"\] \.theater-dream-chapter-tools-toggle:hover\s*\{[^}]*background:transparent/);
    assert.match(styles, /\.theater-dream-chapter-editor-actions\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(styles, /@media \(max-width:520px\)[\s\S]*?\.theater-dream-chapter-editor-actions\s*\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.doesNotMatch(styles, /#theater-dream-read-chapter-fullscreen\s*\{\s*grid-column:1 \/ -1/);
    assert.match(styles, /@media \(min-width:521px\)[\s\S]*?\.theater-dream-chapter-editor-actions\[hidden\]\s*\{\s*display:grid/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\]\s*\{\s*font-size:var\(--t-text-base\)/);
    assert.match(styles, /dialog\.theater-export-format-dialog/);
    assert.match(styles, /--t-bg: var\(--SmartThemeBlurTintColor/);
    assert.doesNotMatch(styles, /\.theater-panel\[data-panel="long-dream"\]\s*\{\s*--t-bg:\s*#FAF7F2/);
    assert.doesNotMatch(source, /注意：本地 \$\{reference\.toLocaleString\(\)\} 字符参考线已超出/);
});

test('长梦真实工作区只有定梦续写作品三分类，并把审阅梦脉和章节操作归入正确层级', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
    const workspace = source.match(/function longDreamWorkspaceHTML\([\s\S]*?\n\}/)?.[0] || '';
    const creation = source.match(/function longDreamCreateHTML\(\) \{[\s\S]*?function (?:runtime\.)?longDreamGenerationStageText/)?.[0] || '';
    const definition = source.match(/function longDreamDefinitionHTML\(dream\) \{[\s\S]*?function longDreamDetailHTML/)?.[0] || '';
    const continuation = source.match(/function longDreamDetailHTML\(dream\) \{[\s\S]*?function longDreamChapterDirectoryHTML/)?.[0] || '';
    const shelf = source.match(/function longDreamListHTML\(\) \{[\s\S]*?const (?:runtime\.)?LONG_DREAM_RELATION_OPTIONS/)?.[0] || '';
    const workDetail = source.match(/function longDreamWorkDetailHTML\(dream\) \{[\s\S]*?function longDreamChapterDetailHTML/)?.[0] || '';
    const chapterDetail = source.match(/function longDreamChapterDetailHTML\(dream, chapter\) \{[\s\S]*?function longDreamUnavailableHTML/)?.[0] || '';

    assert.match(workspace, /\['definition', '定梦'\]/);
    assert.match(workspace, /\['continue', '续写'\]/);
    assert.match(workspace, /\['works', '作品'\]/);
    assert.doesNotMatch(workspace, /审阅|章节|梦脉|备份/);
    assert.doesNotMatch(creation, /dream-hero-container|data-dream-back|返回作品/);
    assert.doesNotMatch(definition, /dream-hero-container|DREAM CANON/);
    assert.match(continuation, /data-dream-continuation-stage="review"/);
    assert.doesNotMatch(continuation, /放弃重写/);
    assert.match(continuation, /用第 \$\{reviewVersion\} 版继续/);
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
    assert.ok(shelf.indexOf('theater-dream-backup-menu') < shelf.indexOf('class="theater-dream-list"'));
    assert.match(shelf, /<header class="theater-dream-library-header">[\s\S]*?aria-label="备份与恢复"[\s\S]*?id="theater-dream-new"[\s\S]*?<\/header>/);
    assert.doesNotMatch(shelf, /ia-book-cover|打开作品/);
    assert.match(source, /data-dream-open-chapter/);
    assert.match(workDetail, /class="[^"]*theater-dream-work-menu/);
    assert.doesNotMatch(workDetail, /<details class="[^"]*theater-dream-work-menu/);
    assert.match(chapterDetail, /data-dream-chapter-back/);
    assert.match(chapterDetail, /id="theater-dream-export-chapter"/);
    assert.match(chapterDetail, /class="[^"]*theater-dream-chapter-operations/);
    assert.doesNotMatch(chapterDetail, /<details class="[^"]*theater-dream-chapter-operations/);
    assert.doesNotMatch(shelf, /<details class="[^"]*theater-dream-library-tools/);
    assert.match(source, /function (?:runtime\.)?exportLongDreamChapter\(dream, chapter\)/);
    assert.match(source, /(?:runtime\.)?downloadFile\(longDreamChapterFileName\(dream, chapter, 'html'\), chapter\.html/);
    assert.match(source, /(?:runtime\.)?renderLongDreamChapter\(\{[\s\S]*?text,[\s\S]*?originalInstruction: chapter\.instruction \|\| ''[\s\S]*?apiRoute: (?:runtime\.)?captureGenerationApiRoute/);
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
    assert.doesNotMatch(styles, /\.theater-panel\[data-panel="long-dream"\] \.relation-card\.selected/);
    assert.match(styles, /\.relation-card small,[\s\S]*?\.theater-dream-memory-conflicts p \{ text-align:left; text-justify:auto; \}/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.relation-card-copy \{[^}]*width:100% !important[^}]*writing-mode:horizontal-tb !important/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.relation-card b \{[^}]*word-break:keep-all !important[^}]*writing-mode:horizontal-tb !important/);
    assert.match(styles, /@media \(max-width:520px\)[\s\S]*?\.theater-panel\[data-panel="long-dream"\] \.relation-cards \{ grid-template-columns:1fr; \}/);
    assert.match(styles, /text-align:justify; text-justify:inter-ideograph/);
    assert.match(styles, /\.theater-panel\[data-panel="long-dream"\] \.theater-dream-latest \{ display:block; margin-top:0; \}/);
    assert.match(styles, /:where\(\.theater-dream-home, \.theater-dream-work-detail, \.theater-dream-chapter-detail\) \.ui-btn:not\(\.ui-btn-danger\)/);
    assert.doesNotMatch(styles, /dialog\.popup:has\(\.theater-panel\[data-panel="long-dream"\]\.active\)/);
});

test('旧历史开卷不会因世界书尚未同步而锁死世界线选项', () => {
    const source = readTheaterImplementation();
    const relationChoices = source.match(/function longDreamRelationChoicesHTML\([\s\S]*?function (?:runtime\.)?longDreamSourceWorldBooks/)?.[0] || '';
    const restoreHandler = source.match(/click\.tdrestorebooks[\s\S]*?click\.tdopenbooks/)?.[0] || '';
    assert.match(relationChoices, /const isDisabled = disabled/);
    assert.doesNotMatch(relationChoices, /isDisabled = disabled \|\| \(needsBooks && !hasBooks\)/);
    assert.doesNotMatch(relationChoices, /class="[^"]*\$\{selected === option\.value \? 'selected'/);
    assert.match(relationChoices, /\$\{selected === option\.value \? 'checked' : ''\}/);
    assert.match(source, /data-dream-restore-source-world-books/);
    assert.match(source, /data-dream-open-world-books/);
    assert.match(restoreHandler, /Popup\.show\.confirm/);
    assert.match(restoreHandler, /(?:runtime\.)?settings\.selectedWorldBooks = \[\.\.\.sourceBooks\]/);
    assert.match(restoreHandler, /await (?:runtime\.)?reloadWorldBooks\(\{ silent: true \}\)/);
});

test('放弃长梦草稿保留续写指令，只有独立清空按钮会确认后清除', () => {
    const source = readTheaterImplementation();
    const discard = source.match(/async function (?:runtime\.)?discardLongDreamDraft\(\) \{[\s\S]*?async function (?:runtime\.)?regenerateLongDreamDraft/)?.[0] || '';
    const clearHandler = source.match(/click\.tdclearinstruction[\s\S]*?click\.tdmemoryregenerate/)?.[0] || '';
    assert.match(source, /id="theater-dream-clear-next-instruction"/);
    assert.match(discard, /const retainedComposer =/);
    assert.match(discard, /(?:runtime\.)?setLongDreamComposerDraft\(dream\.id, retainedComposer\)/);
    assert.doesNotMatch(discard, /(?:runtime\.)?clearLongDreamComposerDraft/);
    assert.match(discard, /本章指令会保留/);
    assert.match(clearHandler, /确定清空本章续写指令/);
    assert.match(clearHandler, /(?:runtime\.)?rememberLongDreamComposerDraft\(\)/);
    assert.match(clearHandler, /(?:runtime\.)?refreshLongDreamMemorySelection\(\)/);
});

test('长梦参考稿样式只作用于长梦面板，不改坏其他页面按钮与插件外壳', () => {
    const source = readTheaterImplementation();
    const styles = readStyles();
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
    const source = readTheaterImplementation();
    const reader = source.match(/function (?:runtime\.)?readLongDreamChapter\(chapter, \{ startPlain = false \} = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(reader, /(?:runtime\.)?openFullscreenReader\(\{/);
    assert.match(reader, /\bstartPlain,/);
    assert.doesNotMatch(reader, /lastGenerated(Text|Html)|(?:runtime\.)?currentOutputMode|(?:runtime\.)?showInIframe/);
    assert.match(source, /function (?:runtime\.)?openFullscreenReader\(overridePayload = null\)/);
});

test('长梦慢资料准备期间锁定保留操作，状态变化后不拿旧草稿启动生成', async () => {
    const source=readTheaterImplementation();
    const generation=source.match(/async function (?:runtime\.)?generateNextLongDreamChapter\([^]*?^}/m)[0];
    const keep=source.match(/async function (?:runtime\.)?keepLongDreamCandidate\([^]*?^}/m)[0];
    const confirm=source.match(/async function (?:runtime\.)?confirmLongDreamChapter\([^]*?^}/m)[0];
    const dream={id:1,status:'active',chapters:[{id:'first'}],draft:{status:LONG_DREAM_DRAFT_STATUS.REVIEW,candidates:[{text:'旧版',html:'<p>旧版</p>'}],selectedCandidateIndex:0}};
    let release, saves=0, runs=0;
    const scope={settings:{},longDreamCandidateSavePending:false,isPreparingGeneration:false,isGenerating:false,refreshingLongDreamWorldBookId:null,
        activeLongDreamId:1,longDreamCache:[dream],longDreamCanonSuggestionState:{},longDreamChapterEditController:null,LONG_DREAM_DRAFT_STATUS,
        longDreamGenerationController:{active:false},getLongDreamGenerationController:()=>({active:false,run(){runs++;throw new Error('不应执行')}}),
        getLongDreamComposerDraft:()=>({}),setLongDreamComposerDraft(){},$:()=>({length:0}),
        resolveLongDreamRequestFoundation:()=>new Promise(resolve=>{release=resolve}),
        toastr:{info(){},warning(){},error(){}},longDreamPut(){saves++;},console,
    };
    runInNewContext(generation+'\n'+keep+'\n'+confirm,scope);
    const pending=scope.generateNextLongDreamChapter({appendCandidate:true});
    assert.equal(scope.isPreparingGeneration,true);
    await scope.keepLongDreamCandidate();await scope.confirmLongDreamChapter();
    assert.equal(saves,0);
    scope.longDreamCache=[{...dream,draft:{...dream.draft,candidates:[{...dream.draft.candidates[0],retained:true}]}}];
    release({});await pending;
    assert.equal(runs,0);assert.equal(scope.isPreparingGeneration,false);
    assert.equal(scope.longDreamCache[0].draft.candidates[0].retained,true);
});

test('长梦确认采用版后回续写，取消或保存失败保持原页且不自动生成', async () => {
    const source=readTheaterImplementation();
    const code=source.match(/async function (?:runtime\.)?confirmLongDreamChapter\([^]*?^}/m)[0];
    for(const mode of ['success','cancel','failure']) {
        let dream=createLongDreamRecord({source:{text:'首章',html:'<p>首章</p>'}});
        dream=saveLongDreamDraft(dream,{status:LONG_DREAM_DRAFT_STATUS.WRITING,instruction:'续写'});
        dream=appendLongDreamDraftCandidate(dream,{text:'保留版',html:'<p>保留版</p>'});
        dream=retainLongDreamDraftCandidate(dream,0,true);
        dream=appendLongDreamDraftCandidate(dream,{text:'采用版',html:'<p>采用版</p>'});
        let saved,queued=0,renders=0;
        const scope={activeLongDreamId:dream.id,longDreamCache:[dream],LONG_DREAM_DRAFT_STATUS,
            longDreamCandidateSavePending:false,isPreparingGeneration:false,longDreamGenerationController:{active:false},
            longDreamWorkspaceSection:'works',longDreamView:'detail',longDreamWorkLevel:'chapter',activeLongDreamChapterId:'chapter-1',
            SillyTavern:{getContext:()=>({Popup:{show:{confirm:async()=>mode!=='cancel'}}})},
            getLongDreamGenerationController:()=>({confirm:async record=>{if(mode==='failure')throw new Error('synthetic');saved=promoteLongDreamDraft(record);return saved;}}),
            clearLongDreamComposerDraft(){},rememberLongDreamNavigation(){},renderLongDreamPanel(){renders++;},queueLongDreamMemoryWeave(){queued++;},
            toastr:{info(){},success(){}},theaterError(){},
        };
        runInNewContext(code,scope);await scope.confirmLongDreamChapter();
        assert.equal(scope.longDreamCandidateSavePending,false);
        if(mode==='success'){
            assert.equal(scope.longDreamWorkspaceSection,'continue');assert.equal(scope.activeLongDreamChapterId,null);
            assert.equal(saved.chapters[1].text,'采用版');assert.equal(saved.chapters[1].retainedVersions[0].text,'保留版');
            assert.equal(queued,1);assert.equal(renders,1);
        }else{assert.equal(scope.longDreamWorkspaceSection,'works');assert.equal(queued,0);assert.equal(renders,0);}
    }
});

test('选择长梦来源：历史的纯文字用到时才转，转过就记住', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../long-dream-workspace-library.js', import.meta.url), 'utf8');
    const helper = source.slice(source.indexOf('function withLazyText'), source.indexOf('// @theater-source-end withLazyText'));
    const withLazyText = new Function(`${helper}; return withLazyText;`)();
    let calls = 0;
    const item = withLazyText({ key: 'history:1', html: '<p>甲</p>' }, () => { calls++; return '甲'; });
    assert.equal(calls, 0, '建列表时不转');
    assert.equal(item.text, '甲');
    assert.equal(item.text, '甲');
    assert.equal(calls, 1, '转过就记住');
    assert.equal({ ...item }.text, '甲', '展开复制时带上文字');
    const body = source.slice(source.indexOf('function longDreamSources'), source.indexOf('// @theater-source-end longDreamSources'));
    assert.match(body, /source\.html\.trim\(\) \|\| source\.text\.trim\(\)/, '过滤时先看 HTML');
});
