// theater-page-guides: 九个页面各自的「这页怎么用」。
// 只在点按钮时出现（电脑：标题行；手机：顶上标题右边的 ?）。没看过的页面按钮上亮小点，
// 看过一次记到酒馆设置 pageGuidesSeen[页面]，换设备也不再亮。
// 每步的 pick 是候选位置，取第一个在页面上看得见的点亮；都不在（比如「抽一个」没打开）就只显示卡片。
// 文字按 2026-11-20 禾禾在设计稿上定的版本，改之前先核对代码。

export const PAGE_GUIDES = {
    generate: [
        { pick: ['#theater-instruction'], title: '小剧场指令', body: '写你想看的情节，一两句也行。常用的点「存为模板」，以后在规则页点一下就能用。' },
        { pick: ['#theater-manual-target-control'], title: '独立设置目标字数', body: '想单独定这一篇的字数就打开它，会盖过指令里写的字数。不开的时候，指令里写了“写 3000 字”也认。' },
        { pick: ['#theater-random-btn'], title: '抽一个', body: '从指令模板库里随机抽一条填进来。这个按钮默认不显示：先在 设置 → 指令与自动生成 里打开「抽一个」，再按标签选抽取范围。' },
        { pick: ['#theater-quick-render-toggle'], title: '排版模板切换', body: '小剧场指令左边这个小按钮，一点就在两个排版模板之间来回切，比如默认模板和纯文字。两个模板在 设置 → 生成控制 → 生成页双模板切换 里选。' },
        { pick: ['.theater-panel[data-panel="generate"] .theater-result-subnav'], title: '生成 / 阅读', body: '写好的作品在「阅读」里看，左右滑也能切。最近 3 篇可以用 ‹ › 翻回去。' },
        { pick: ['#theater-result-actions-toggle', '#theater-output-section'], title: '结果操作', body: '点「保存」才会存进历史，不点只留最近 3 篇。这里还有全屏阅读、续写、编辑文字、重新排版、纯文字阅读。「操作」按钮可以拖到左右页边。' },
    ],
    'long-dream': [
        { pick: ['.theater-dream-create', '.theater-dream-empty [data-dream-new]', '#theater-dream-new', '.theater-dream-list'], title: '开卷', body: '长梦从一篇小剧场开始：正在看的、最近生成的、历史里存过的都可以；也可以选一个历史文件夹，按顺序整个导入成多章。' },
        { pick: ['#theater-dream-create-confirm', '.theater-dream-form-grid'], title: '定梦', body: '写长卷名字和必须遵守的硬设定，点「确认定梦并开卷」。这时的角色卡、人设、世界书会存一份快照，后面照着写。' },
        { pick: [], title: '梦脉副 API', body: '梦脉和概要要用副 API 来整理。先在 设置 → 正文生成线路 → 梦脉织录 里选一个 API 预设，用便宜快的模型就行。不绑副 API，梦脉和概要就没法整理。' },
        { pick: ['#theater-dream-next-instruction'], title: '续写下一章', body: '写这一章想看什么。「本章选项与上下文」里可以写章名、定目标字数；每章写得很长时，「带入全文」选最近 1 章，发给模型的内容会少很多。' },
        { pick: ['.theater-dream-review-choice', '.theater-dream-candidate-actions'], title: '待确认', body: '写好的章先放在待确认，满意再确认收进正文；不满意就重写，想留的版本点保留。' },
        { pick: ['.theater-dream-memory-flow', '.theater-dream-summary-history'], title: '梦脉与概要', body: '确认后，梦脉会记下人物状态、关系和没收的伏笔，默认每 3 章整理一次。记错的条目点开就能改或删除。章节多了，全篇概要可以「精简概要」压短。作品菜单里能导出备份。' },
    ],
    setting: [
        { pick: ['#theater-preset-name-select'], title: '生成预设', body: '选一个酒馆预设，它的条目会带进小剧场。在酒馆里改过预设，点「刷新」重读。' },
        { pick: ['#theater-preset-entries', '#theater-preset-current'], title: '预设条目', body: '选好预设后点「展开」，每条前面的勾决定带不带。很多预设自带字数限制、状态栏、小剧场、概要这类条目，和小剧场冲突的建议关掉。\nSYS / USR / AST 是条目的身份，@数字 是插进聊天记录的深度。' },
        { pick: ['details:has(#theater-style-addon)', '#theater-style-addon'], title: '自定义补充', body: '文风补充、NSFW 补充写在这里，会附在提示词里。改完记得点「保存」。' },
        { pick: ['.theater-section:has(#theater-wb-follow)', '#theater-wb-books'], title: '世界书', body: '选要用的世界书，可以多选。打开「跟随角色卡」，换角色时会自动换成这张卡绑定的书，你手动勾的会留着。' },
        { pick: ['#theater-wb-books'], title: '世界书条目', body: '展开一本书可以逐条勾选：● 蓝 是常驻，● 绿 是关键词触发，● 链 是允许向量相似度触发。\n怎么读在 设置 → 素材与提示 → 世界书读取范围：全部条目 / 酒馆开启条目（含链式）/ 按酒馆蓝灯与绿灯触发。\n临时补几条设定用「手动添加条目」，不用改酒馆的世界书。' },
    ],
    dialogue: [
        { pick: ['#theater-user-persona', '#theater-persona-follow'], title: 'User 人设', body: '默认跟着酒馆当前的人设走。关掉「跟随当前 User 人设」就能自己改写，改完点「保存」；「从酒馆读取」重新拉一份。' },
        { pick: ['#theater-context-range'], title: '近期消息', body: '带最近多少条聊天进去（0～500 条，填 0 不带）。条数越多越贴近剧情，也越费 token。' },
        { pick: ['.theater-context-exclusions'], title: '内容排除', body: '按标签去掉前文里的思考过程、状态栏这类内容，生成出来的正文里也会尽量去掉。聊天原文不会被改。' },
        { pick: ['#theater-read-baibai-memory'], title: '柏宝书记忆', body: '装了柏宝书的话，可以把它的摘要和状态一起带上。只读，不会写回柏宝书。' },
    ],
    rules: [
        { pick: ['#theater-inst-drawer', '#theater-instruction-list'], title: '指令模板库', body: '常用指令存在这里，点名字就填进生成页。可以打标签、按标签筛，「抽一个」和自动模式也从这里按标签取。' },
        { pick: ['#theater-import-inst-btn'], title: '导入 / 导出、批量', body: '导入导出可以和朋友互换指令；「全选本页」后可以一起改标签或删除。' },
        { pick: ['#theater-render-select'], title: '渲染规则模板', body: '决定作品排成什么样。内置有：默认（移动端 / PC 端）、纯文字（亮色 / 暗色夜读）、剧情自适应三档（灵动排版 / 沉浸互动 / 大胆实验）、小手机（聊天·动态）。也能新建自己的模板。' },
        { pick: [], title: '生成页双模板', body: '最常用的两个，可以在 设置 → 生成控制 里设成生成页的 A / B，一键切换。' },
    ],
    history: [
        { pick: ['#theater-history-search'], title: '搜索与筛选', body: '这里只有点过「保存」的作品。可以搜标题和文件夹，按角色、标签筛选。' },
        { pick: ['#theater-history-list .theater-history-item', '#theater-history-list'], title: '作品卡片', body: '点一篇打开阅读。卡片菜单里能改名、改标签、指定角色、移到文件夹、导出 HTML、删除。' },
        { pick: ['.theater-panel[data-panel="history"] .theater-history-menu-trigger'], title: '整理与备份', body: '新建文件夹、管理全局标签、导出全部历史、导入备份，都在这个菜单里。' },
        { pick: ['#theater-hist-batch-bar', '.theater-panel[data-panel="history"] .theater-history-menu-trigger'], title: '批量管理', body: '打开批量管理后可以多选，按住拖动能连着选，一起改标签、指定角色、移到文件夹或删除。' },
    ],
    theme: [
        { pick: ['#theater-skin-toggle'], title: '风格', body: '内置默认、跟随酒馆（用酒馆的主题色）、深色（黑白灰）、自定义（交给下面的 CSS）。' },
        { pick: ['details:has(#theater-custom-css)', '#theater-custom-css'], title: '自定义 CSS', body: '只作用在插件弹窗里，不影响酒馆界面。写 body 就等于写整个弹窗。' },
        { pick: ['#theater-ui-font-size'], title: '字体大小', body: '插件界面的字号，改完点「保存字号」。' },
    ],
    diagnostics: [
        { pick: ['#theater-export-diagnostics-btn'], title: '找作者帮忙前', body: '请点「导出排查 TXT」，把下载的文件发给作者。只发报错截图，作者看不到发生了什么，没法帮你查。' },
        { pick: ['#theater-export-diagnostics-btn'], title: '导出排查 TXT', body: '文件里有诊断报告、服务商的原话和最近的运行日志；密钥会自动抹掉，网址只留域名。\n运行日志只存在内存里，刷新酒馆就没了，所以出错后先导出，再刷新。' },
        { pick: ['#theater-runtime-log-list'], title: '运行日志', body: '最近 500 条操作记录，「复制日志」可以直接贴给别人看。' },
        { pick: ['.theater-diagnostic-catalog'], title: '常见问题汇总', body: '报错弹窗里有错误代号，在这里按代号查原因和处理办法。' },
        { pick: ['.theater-prompt-inspector'], title: '完整提示词查看器', body: '看这次到底发了什么给模型，可以搜索、复制、导出。怀疑预设或世界书没生效时来这里看。' },
    ],
    config: [
        { pick: ['[data-config-section="api"] .theater-api-mode-switch', '[data-config-group="api"]'], title: '正文生成线路', body: '默认用独立 API：填接口地址、API Key、模型（点「获取」读模型列表），点「测试连接」，再点「保存设置」。不想另配就切到「酒馆主 API」（实验）。' },
        { pick: ['#theater-api-preset-select'], title: 'API 预设', body: '把一套连接存成预设（最多 30 个），换模型时一选就行。梦脉副 API 和独立排版也从这里选。' },
        { pick: ['#theater-dream-memory-api-preset', '#theater-dream-memory-summary'], title: '梦脉织录', body: '长梦用的副 API，和多少章整理一次梦脉（推荐每 3 章）。' },
        { pick: ['[data-config-group="generation"]'], title: '生成控制', body: '生成页双模板 A / B、创作增强、字数不够时自动补写和最多补几轮。' },
        { pick: ['[data-config-group="automation"]'], title: '指令与自动生成', body: '打开「抽一个」按钮并选范围；自动模式会每隔几层 AI 回复自动生成一篇。' },
        { pick: ['[data-config-group="backup"]'], title: '备份与恢复', body: '默认每天在酒馆服务器上存一份（有变化才存），也可以下载备份、定期备份到 GitHub。浏览器数据被清掉时，从这里恢复。' },
        { pick: ['[data-config-group="layout"]'], title: '独立 HTML 排版 API', body: '想让排版用另一个模型时打开，默认关。' },
    ],
};

export function pageGuideSeen(settings, tab) {
    return Boolean(settings?.pageGuidesSeen && settings.pageGuidesSeen[tab]);
}

// 标题行 / 手机顶部按钮上的小点：没看过这一页就亮。
export function pageGuideDotHTML(settings, tab) {
    return `<span class="theater-page-guide-dot" aria-label="还没看过"${pageGuideSeen(settings, tab) ? ' hidden' : ''}></span>`;
}
