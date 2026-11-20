// theater-nav: 主弹窗的页面导航。
// 手机和窄窗口仍是一行标签；宽屏（>1000px，与酒馆自己的手机样式分界一致）时
// 同一套标签由样式排成左侧分组栏，分组名、图标、小字、页面标题只在宽屏显示。

export const THEATER_WIDE_QUERY = '(min-width: 1001px)';

export const THEATER_NAV_GROUPS = [
    { label: '写作', tabs: ['generate', 'long-dream'] },
    { label: '素材', tabs: ['setting', 'dialogue', 'rules'] },
    { label: '作品', tabs: ['history'] },
    { label: '外观与维护', tabs: ['theme', 'diagnostics', 'config'] },
];

export const THEATER_PAGES = {
    generate: { label: '生成', icon: 'fa-wand-magic-sparkles', hint: '写一篇小剧场', desc: '根据当前聊天另写一篇小剧场，不会改动聊天正文' },
    'long-dream': { label: '长梦', icon: 'fa-moon', hint: '多章长篇', desc: '一章一章写下去，梦脉帮你记住人物状态和前情' },
    setting: { label: '设定', icon: 'fa-book-open', hint: '预设 · 世界书', desc: '生成预设、文风补充和世界书' },
    dialogue: { label: '对话', icon: 'fa-comments', hint: '人设 · 聊天前文', desc: 'User 人设，以及要带进去多少聊天前文' },
    rules: { label: '规则', icon: 'fa-list-check', hint: '指令与排版模板', desc: '常用指令模板，和把正文排成网页的排版规则' },
    history: { label: '历史', icon: 'fa-clock-rotate-left', hint: '写过的作品', desc: '写过的作品都在这里，可以按文件夹、角色、标签找' },
    theme: { label: '美化', icon: 'fa-palette', hint: '外观 · 字号', desc: '插件外观：风格、自定义 CSS、字号' },
    diagnostics: { label: '诊断', icon: 'fa-stethoscope', hint: '报错时来这里', desc: '运行日志、诊断报告、常见问题，报错时来这里' },
    config: { label: '设置', icon: 'fa-sliders', hint: '模型 · 备份', desc: '连接模型、生成控制、备份和扩展管理' },
};

function escapeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// 标签栏里的全部内容。badges：{ config: '<小红点 HTML>' } 这类附在标签名后的标记。
export function theaterNavHTML(activeTab, { version = '', badges = {} } = {}) {
    const tabHTML = tab => {
        const page = THEATER_PAGES[tab];
        const active = tab === activeTab ? ' active' : '';
        return `<div class="theater-tab${active}" data-tab="${tab}" data-page-title="${page.label}" data-page-desc="${page.desc}"><i class="fa-solid ${page.icon} theater-tab-icon" aria-hidden="true"></i><span class="theater-tab-text"><span class="theater-tab-label">${page.label}${badges[tab] || ''}</span><small class="theater-tab-hint">${page.hint}</small></span></div>`;
    };
    const groups = THEATER_NAV_GROUPS.map(group => `<div class="theater-tab-group-label">${group.label}</div>${group.tabs.map(tabHTML).join('')}`).join('');
    return `<div class="theater-nav-brand"><b>千夜浮梦</b><small>小剧场生成插件</small></div>${groups}<div class="theater-nav-footer"><button type="button" class="theater-nav-guide-btn" id="theater-onboarding-nav-btn"><i class="fa-solid fa-circle-question" aria-hidden="true"></i><span>新手引导</span></button><span class="theater-nav-version">${version ? `v${escapeText(version)}` : ''}</span></div>`;
}

// 宽屏才显示的页面标题行（含关闭按钮：宽屏时隐藏酒馆底部的“关闭”按钮）。
export function theaterPageHeadHTML(activeTab) {
    const page = THEATER_PAGES[activeTab] || THEATER_PAGES.generate;
    return `<div class="theater-page-head"><div class="theater-page-head-text"><h2 class="theater-page-title">${page.label}</h2><p class="theater-page-desc">${page.desc}</p></div><button type="button" class="theater-page-close" aria-label="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`;
}

// 深色皮肤：skinMode 仍是 'theater'，另记 skinTone: 'dark'。标记挂在 <html> 上，
// 主弹窗和各个小弹窗（它们也写 data-skin="theater"）就会一起变深。
export function applyTheaterSkinTone(settings, root = globalThis.document?.documentElement) {
    if (!root) return;
    if (settings?.skinMode === 'theater' && settings?.skinTone === 'dark') root.setAttribute('data-theater-tone', 'dark');
    else root.removeAttribute('data-theater-tone');
}

// 美化里四个选项 → 存法。'dark' 不是独立的 skinMode。
export function skinChoiceFromSettings(settings) {
    const mode = settings?.skinMode || 'default';
    return mode === 'theater' && settings?.skinTone === 'dark' ? 'dark' : mode;
}

export function skinSettingsForChoice(choice) {
    if (choice === 'dark') return { skinMode: 'theater', skinTone: 'dark' };
    return { skinMode: ['default', 'theater', 'custom'].includes(choice) ? choice : 'default', skinTone: '' };
}
