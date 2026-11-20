// 九个页面的「这页怎么用」（4.4.9c，文字按 2026-11-20 禾禾在设计稿上定的版本）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGE_GUIDES, pageGuideSeen, pageGuideDotHTML } from '../theater-page-guides.js';
import { THEATER_NAV_GROUPS, THEATER_PAGES, theaterPageHeadHTML, theaterMobileGuideButtonHTML } from '../theater-nav.js';
import { ONBOARDING_STEPS } from '../theater-onboarding.js';
import { readStyles } from './styles.js';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('九个页面都有引导，步数和定稿一致，每步都有标题和说明', () => {
    const tabs = THEATER_NAV_GROUPS.flatMap(group => group.tabs);
    assert.deepEqual(Object.keys(PAGE_GUIDES).sort(), [...tabs].sort());
    const counts = Object.fromEntries(tabs.map(tab => [tab, PAGE_GUIDES[tab].length]));
    assert.deepEqual(counts, { generate: 6, 'long-dream': 6, setting: 5, dialogue: 4, rules: 4, history: 4, theme: 3, diagnostics: 5, config: 7 });
    for (const tab of tabs) {
        for (const step of PAGE_GUIDES[tab]) {
            assert.ok(step.title && step.body, `${tab}: ${step.title}`);
            assert.ok(Array.isArray(step.pick), `${tab}: ${step.title}`);
        }
    }
});

test('诊断页先讲清楚：找作者要发「导出排查 TXT」的文件，并提醒刷新前先导出', () => {
    const [first, second] = PAGE_GUIDES.diagnostics;
    assert.match(first.body, /导出排查 TXT/);
    assert.match(first.body, /只发报错截图/);
    assert.deepEqual(first.pick, ['#theater-export-diagnostics-btn']);
    assert.match(second.body, /刷新酒馆就没了[\s\S]*先导出，再刷新/);
    // 说法对得上代码：导出内容含报告、服务商原话和脱敏日志。
    const diagnostics = read('theater-diagnostics.js');
    assert.match(diagnostics, /服务商原文[\s\S]*脱敏运行日志/);
});

test('文字按定稿：预设条目不提思维链格式，历史只收点过保存的作品', () => {
    const setting = PAGE_GUIDES.setting.find(step => step.title === '预设条目');
    assert.match(setting.body, /字数限制、状态栏、小剧场、概要这类条目/);
    assert.doesNotMatch(setting.body, /思维链/);
    assert.match(PAGE_GUIDES.history[0].body, /点过「保存」/);
    assert.match(PAGE_GUIDES.generate.at(-1).body, /点「保存」才会存进历史，不点只留最近 3 篇/);
});

test('引导指到的 id 在界面代码里都存在（改名时这里会提醒）', () => {
    const sources = ['theater-popup-ui.js', 'baibai-memory-ui.js', 'long-dream-workspace.js', 'long-dream-workspace-create.js', 'theater-materials.js', 'backup-ui.js'].map(read).join('\n');
    const ids = new Set(Object.values(PAGE_GUIDES).flat().flatMap(step => step.pick)
        .flatMap(selector => [...selector.matchAll(/#(theater-[a-z0-9-]+)/g)].map(match => match[1])));
    assert.ok(ids.size > 20);
    for (const id of ids) assert.match(sources, new RegExp(`id="${id}"`), id);
});

test('没看过的页面亮小点，看过就不亮；按钮在电脑标题行和手机顶部各一个', () => {
    assert.equal(pageGuideSeen({}, 'generate'), false);
    assert.equal(pageGuideSeen({ pageGuidesSeen: { generate: true } }, 'generate'), true);
    assert.doesNotMatch(pageGuideDotHTML({}, 'setting'), /hidden/);
    assert.match(pageGuideDotHTML({ pageGuidesSeen: { setting: true } }, 'setting'), / hidden/);
    const head = theaterPageHeadHTML('rules', { guideDot: pageGuideDotHTML({}, 'rules') });
    assert.match(head, /id="theater-page-guide-btn"[^>]*>[\s\S]*?这页怎么用[\s\S]*?theater-page-guide-dot/);
    assert.match(theaterMobileGuideButtonHTML({ guideDot: '' }), /id="theater-page-guide-mobile-btn" aria-label="这页怎么用"/);
    const popup = read('theater-popup-ui.js');
    assert.match(popup, /theaterMobileGuideButtonHTML\(\{ guideDot: pageGuideDotHTML\(runtime\.settings, initialTab\) \}\)/);
    assert.match(popup, /theaterPageHeadHTML\(initialTab, \{ guideDot: pageGuideDotHTML\(runtime\.settings, initialTab\) \}\)/);
    assert.match(read('theater-events.js'), /#theater-page-guide-btn, #theater-page-guide-mobile-btn[\s\S]*?runtime\.startPageGuide\(\)/);
    // 手机的 ? 只在主弹窗标题里，宽屏时标题整个隐藏；小弹窗不受影响。
    const styles = readStyles();
    assert.match(styles, /\.theater-main-header \{ position: relative; \}/);
    assert.match(styles, /\.theater-page-guide-dot\[hidden\] \{ display: none; \}/);
});

test('切换页面时，小点按这一页有没有看过来亮或灭', () => {
    const source = readTheaterImplementation();
    const extract = name => source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))?.[0] || '';
    const dots = [{ hidden: false }, { hidden: false }];
    const context = {
        settings: { pageGuidesSeen: { history: true } }, normalizeTheaterTab: tab => tab, save() {}, refreshHistList() {}, renderRuntimeLog() {}, renderLongDreamPanel() {},
        $: () => ({ addClass() { return this; }, removeClass() { return this; } }),
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: selector => selector.endsWith('.theater-page-guide-dot') ? dots : [] },
    };
    runInNewContext(`${extract('activateTheaterTab')}\nactivateTheaterTab('history');`, context);
    assert.deepEqual(dots.map(dot => dot.hidden), [true, true]);
    runInNewContext(`activateTheaterTab('rules');`, context);
    assert.deepEqual(dots.map(dot => dot.hidden), [false, false]);
});

test('新手引导和左栏：改成“保存了才在历史里”，最后一步提到每页的「这页怎么用」', () => {
    const history = ONBOARDING_STEPS.find(step => step.tabs.includes('history'));
    assert.equal(history.title, '保存了才在历史里');
    assert.match(history.body, /点「保存」才会存进历史，没保存的只留最近 3 篇/);
    assert.doesNotMatch(ONBOARDING_STEPS.map(step => step.body).join(''), /写过的都在历史里/);
    const last = ONBOARDING_STEPS.at(-1);
    assert.match(last.wideBody, /这页怎么用/);
    assert.match(last.body, /右上角的 \?/);
    assert.match(ONBOARDING_STEPS.find(step => step.tabs.includes('diagnostics')).body, /导出排查 TXT/);
    assert.equal(THEATER_PAGES.history.hint, '存下的作品');
    assert.match(THEATER_PAGES.history.desc, /点过「保存」的作品/);
});

test('小砚审查：长梦空页点亮「创建第一部长梦」，待确认点亮保留和确认那一排', () => {
    const [open, , , , review] = PAGE_GUIDES['long-dream'];
    assert.ok(open.pick.includes('.theater-dream-empty [data-dream-new]'));
    assert.equal(review.pick[0], '.theater-dream-review-choice');
    const create = read('long-dream-workspace-create.js');
    assert.match(create, /class="ui-card theater-dream-empty"[\s\S]*?data-dream-new[^>]*>创建第一部长梦/);
    const workspace = read('long-dream-workspace.js');
    assert.match(workspace, /<div class="theater-dream-review-choice">[\s\S]*?id="theater-dream-keep-candidate"/);
});

test('小砚审查：手机上目标要露在底部卡片上面——从里到外逐层滚，不碰酒馆页面', async () => {
    const { bringIntoView } = await import('../theater-onboarding.js');
    const dialog = { tag: 'dialog' };
    const outer = { parentElement: dialog, scrollTop: 0, scrollHeight: 3000, clientHeight: 800, top: 0, height: 800 };
    const inner = { parentElement: outer, scrollTop: 0, scrollHeight: 2000, clientHeight: 600, top: 100, height: 600 };
    const rectOf = node => ({ top: node.top - outer.scrollTop, bottom: node.top - outer.scrollTop + node.height });
    let targetTop = 1500;
    const target = {
        parentElement: inner,
        closest: () => null,
        getBoundingClientRect: () => { const top = targetTop - inner.scrollTop - outer.scrollTop; return { top, bottom: top + 40 }; },
    };
    inner.getBoundingClientRect = () => rectOf(inner);
    outer.getBoundingClientRect = () => ({ top: 0, bottom: 800 });
    globalThis.getComputedStyle = () => ({ overflowY: 'auto' });
    try {
        bringIntoView(target, dialog, { limitBottom: 520 });
        const rect = target.getBoundingClientRect();
        assert.ok(rect.top >= 0 && rect.bottom <= 520 - 12, JSON.stringify(rect));
        // 已经露在卡片上面的不动。
        const before = [inner.scrollTop, outer.scrollTop];
        bringIntoView(target, dialog, { limitBottom: 520 });
        assert.deepEqual([inner.scrollTop, outer.scrollTop], before);
    } finally {
        delete globalThis.getComputedStyle;
    }
    // 滚到底也露不出来时，卡片改到顶上。
    assert.match(read('theater-onboarding.js'), /card\.classList\.add\('is-top'\)/);
    assert.match(readStyles(), /\.theater-onboarding-card\.is-sheet\.is-top \{\s*top: 0 !important;/);
});
