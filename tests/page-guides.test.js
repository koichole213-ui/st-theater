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
