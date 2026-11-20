// 4.4.9b：宽屏左侧分组导航、深色皮肤、新手引导。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEATER_NAV_GROUPS, THEATER_PAGES, theaterNavHTML, theaterPageHeadHTML, applyTheaterSkinTone, skinChoiceFromSettings, skinSettingsForChoice } from '../theater-nav.js';
import { ONBOARDING_STEPS, shouldAutoStartOnboarding } from '../theater-onboarding.js';
import { readStyles } from './styles.js';
import { readTheaterImplementation, runInNewContext } from './theater-source.js';

const TABS = ['generate', 'long-dream', 'setting', 'dialogue', 'rules', 'history', 'theme', 'diagnostics', 'config'];

test('导航：九个页面按原顺序分四组，每页都有图标、小字和页面说明', () => {
    assert.deepEqual(THEATER_NAV_GROUPS.flatMap(group => group.tabs), TABS);
    assert.deepEqual(THEATER_NAV_GROUPS.map(group => group.label), ['写作', '素材', '作品', '外观与维护']);
    for (const tab of TABS) {
        const page = THEATER_PAGES[tab];
        assert.ok(page.label && page.icon && page.hint && page.desc, tab);
    }
    const html = theaterNavHTML('history', { version: '4.4.9b', badges: { config: '<i class="theater-tab-new-badge"></i>' } });
    assert.deepEqual([...html.matchAll(/class="theater-tab(?: active)?" data-tab="([^"]+)"/g)].map(match => match[1]), TABS);
    assert.match(html, /class="theater-tab active" data-tab="history"/);
    assert.equal((html.match(/class="theater-tab active"/g) || []).length, 1);
    assert.match(html, /data-tab="config"[^>]*>[\s\S]*?<span class="theater-tab-label">设置<i class="theater-tab-new-badge"><\/i><\/span>/);
    assert.match(html, /data-tab="diagnostics" data-page-title="诊断" data-page-desc="[^"]+"/);
    assert.match(html, /id="theater-onboarding-nav-btn"/);
    assert.match(html, /v4\.4\.9b/);
    assert.match(theaterPageHeadHTML('rules'), /<h2 class="theater-page-title">规则<\/h2>/);
    assert.match(theaterPageHeadHTML('rules'), /class="theater-page-close" aria-label="关闭"/);
});

test('导航：手机和窄窗口不变，宽屏才出现的部分默认隐藏', () => {
    const styles = readStyles();
    const wideAt = styles.indexOf('@media (min-width: 1001px)');
    assert.ok(wideAt > 0);
    const before = styles.slice(styles.indexOf('4.4.9b 宽屏'), wideAt);
    assert.match(before, /\.theater-nav-brand,\s*\.theater-tab-group-label,\s*\.theater-nav-footer,\s*\.theater-tab-icon,\s*\.theater-tab-hint,\s*\.theater-page-head \{ display: none; \}/);
    // 宽屏规则都限定在主弹窗里，小弹窗（也带 .theater-popup-header）不受影响。
    const wide = styles.slice(wideAt, styles.indexOf('深色皮肤：就是'));
    assert.match(wide, /\.theater-main-popup > \.theater-main-header \{ display: none; \}/);
    assert.doesNotMatch(wide, /^\s*\.theater-popup-header/m);
    // 默认皮肤：酒馆给 <small> 的浅色和阴影不能盖到左栏小字上。
    assert.match(wide, /\.theater-tab-hint \{[^}]*color: inherit;[^}]*text-shadow: none;/);
});

test('深色皮肤：存成跟随酒馆 + 深色，只在这种组合下给 <html> 打标记', () => {
    assert.deepEqual(skinSettingsForChoice('dark'), { skinMode: 'theater', skinTone: 'dark' });
    assert.deepEqual(skinSettingsForChoice('theater'), { skinMode: 'theater', skinTone: '' });
    assert.deepEqual(skinSettingsForChoice('custom'), { skinMode: 'custom', skinTone: '' });
    assert.deepEqual(skinSettingsForChoice('奇怪的值'), { skinMode: 'default', skinTone: '' });
    assert.equal(skinChoiceFromSettings({ skinMode: 'theater', skinTone: 'dark' }), 'dark');
    assert.equal(skinChoiceFromSettings({ skinMode: 'theater' }), 'theater');
    assert.equal(skinChoiceFromSettings({ skinMode: 'default', skinTone: 'dark' }), 'default');
    assert.equal(skinChoiceFromSettings({}), 'default');
    const attrs = new Map();
    const root = { setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key) };
    applyTheaterSkinTone({ skinMode: 'theater', skinTone: 'dark' }, root);
    assert.equal(attrs.get('data-theater-tone'), 'dark');
    applyTheaterSkinTone({ skinMode: 'default', skinTone: 'dark' }, root);
    assert.equal(attrs.has('data-theater-tone'), false);
    const styles = readStyles();
    const dark = styles.slice(styles.indexOf('深色皮肤：就是'), styles.indexOf('新手引导：遮罩'));
    assert.match(dark, /html\[data-theater-tone="dark"\] \.theater-popup\[data-skin="theater"\]/);
    // 不用焦糖色：深色下强调色就是正文的浅灰。
    assert.match(dark, /--t-accent: rgb\(220, 220, 210\)/);
    assert.doesNotMatch(dark, /#B07A4A|#6B4423|#D9A877/i);
});

test('美化页列出四个选项，选中深色时显示「深色」', () => {
    const source = readFileSync(new URL('../theater-popup-ui.js', import.meta.url), 'utf8');
    for (const value of ['default', 'theater', 'dark', 'custom']) assert.match(source, new RegExp(`name="theater-skin" value="${value}"`));
    assert.match(source, /SKIN_LABELS\[skinChoice\]/);
    const events = readFileSync(new URL('../theater-events-results.js', import.meta.url), 'utf8');
    assert.match(events, /skinSettingsForChoice\(v\)[\s\S]*?runtime\.settings\.skinTone = next\.skinTone;[\s\S]*?runtime\.applySkinTone\(\);[\s\S]*?attr\('data-skin', next\.skinMode\)/);
});

test('新手引导：只给真正的新用户自动弹一次', () => {
    const fresh = () => ({ settings: { onboardingDone: false, archiveFingerprints: {} }, historyCache: [], longDreamCache: [], storageReadErrors: {} });
    assert.equal(shouldAutoStartOnboarding(fresh()), true);
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), settings: { onboardingDone: true } }), false);
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), historyCache: [{ id: 1 }] }), false);
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), longDreamCache: [{ id: 1 }] }), false);
    // 存档读不出来时不能当成“没有作品”。
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), storageReadErrors: { history: new Error('读不到') } }), false);
    // 别的浏览器（或被浏览器清掉之前）存过作品：老用户，不弹。
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), settings: { archiveFingerprints: { 'http://x#1': { history: 3, dreams: 0 } } } }), false);
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), settings: { archiveFingerprints: { 'http://x#1': { history: 0, dreams: 0 } } } }), true);
});

test('新手引导（小砚审查）：有最近生成或当前结果、存档被关、数量异常时都不自动弹', () => {
    const fresh = () => ({ settings: { onboardingDone: false, archiveFingerprints: {} }, historyCache: [], longDreamCache: [], storageReadErrors: {} });
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), recentCache: [{ html: '<p>最近一篇</p>' }] }), false);
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), currentGenerationResult: { html: '<p>当前结果</p>' } }), false);
    // 存档被浏览器关掉：页面上有抢救横条，引导不能盖住它。
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), archiveClosed: true }), false);
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), settings: { archiveFingerprints: { 'http://x#1': { history: 0, dreams: 0, lossSuspected: { found: {} } } } } }), false);
    assert.equal(shouldAutoStartOnboarding({ ...fresh(), recentCache: [] }), true);
});

test('关主弹窗时一并收起引导（Esc 关窗也不留下窗口尺寸监听）', () => {
    const source = readTheaterImplementation();
    const open = source.match(/async function openTheaterPopup\([\s\S]*?\n\}/)?.[0] || '';
    assert.match(open, /const onPopupClosed = \(\) => \{[\s\S]*?runtime\.activeTheaterPopupSession = null;\n\s*runtime\.closeOnboarding\(\);/);
});

test('宽屏阅读书签只在右侧内容区里停靠，窄屏仍按整个弹窗', () => {
    const source = readTheaterImplementation();
    const extract = name => source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))?.[0] || '';
    const contentRect = { top: 120, right: 1240, bottom: 730, left: 330, width: 910, height: 610 };
    const popupRect = { top: 30, right: 1270, bottom: 740, left: 95, width: 1175, height: 710 };
    const run = headVisible => runInNewContext(`${extract('resultBookmarkRect')}\nresultBookmarkRect();`, {
        window: { innerWidth: 1366, innerHeight: 768 },
        document: {
            querySelector: selector => selector.endsWith('.theater-page-head') ? { getClientRects: () => (headVisible ? [{}] : []) }
                : selector.endsWith('.theater-panels-wrapper') ? { getBoundingClientRect: () => contentRect }
                    : selector === '.theater-popup' ? { getBoundingClientRect: () => popupRect } : null,
        },
    });
    assert.equal(run(true).left, 330);
    assert.equal(run(false).left, 95);
});

test('新手引导：八步，每步指向存在的页面，最后一步按宽窄屏说清重看入口', () => {
    assert.equal(ONBOARDING_STEPS.length, 8);
    assert.deepEqual(ONBOARDING_STEPS[0].tabs, []);
    for (const step of ONBOARDING_STEPS) {
        assert.ok(step.title && step.body);
        for (const tab of step.tabs) assert.ok(TABS.includes(tab), tab);
    }
    const last = ONBOARDING_STEPS.at(-1);
    assert.equal(last.wideTarget, '#theater-onboarding-nav-btn');
    assert.match(last.body, /设置 → 界面与快捷入口 → 新手引导/);
    assert.match(last.wideBody, /左下角/);
    const popupSource = readFileSync(new URL('../theater-popup-ui.js', import.meta.url), 'utf8');
    assert.match(popupSource, /id="theater-onboarding-config-btn"/);
    const events = readFileSync(new URL('../theater-events.js', import.meta.url), 'utf8');
    assert.match(events, /#theater-onboarding-nav-btn, #theater-onboarding-config-btn[\s\S]*?runtime\.startOnboarding\(\)/);
});

test('打开弹窗：给酒馆弹窗加宽屏类、× 走酒馆自己的关闭，并检查要不要弹引导', () => {
    const source = readTheaterImplementation();
    const open = source.match(/async function openTheaterPopup\([\s\S]*?\n\}/)?.[0] || '';
    assert.match(open, /popup\.dlg\?\.classList\?\.add\('theater-main-dialog'\)/);
    assert.match(open, /\.theater-page-close'\)\?\.addEventListener\('click', \(\) => popup\.okButton\?\.click\(\)\)/);
    assert.match(open, /runtime\.archiveRescue\?\.addNotice\(\);\n\s*runtime\.maybeStartOnboarding\(\);/);
});

test('切换页面时，宽屏标题行跟着换成该页的名字和说明', () => {
    const source = readTheaterImplementation();
    const extract = name => source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))?.[0] || '';
    const title = { textContent: '生成' };
    const desc = { textContent: '旧说明' };
    const tabEl = { getAttribute: name => ({ 'data-page-title': '历史', 'data-page-desc': '写过的作品都在这里' })[name] };
    const context = {
        settings: {}, normalizeTheaterTab: tab => tab, save() {}, refreshHistList() {}, renderRuntimeLog() {}, renderLongDreamPanel() {},
        $: () => ({ addClass() { return this; }, removeClass() { return this; } }),
        document: {
            getElementById: () => null,
            querySelector: selector => selector.includes('data-tab="history"') ? tabEl
                : selector.endsWith('.theater-page-title') ? title
                    : selector.endsWith('.theater-page-desc') ? desc : null,
        },
    };
    runInNewContext(`${extract('activateTheaterTab')}\nactivateTheaterTab('history');`, context);
    assert.equal(title.textContent, '历史');
    assert.equal(desc.textContent, '写过的作品都在这里');
    assert.equal(context.settings.lastTheaterTab, 'history');
});
