// 保留已有选择值，旧设置、A/B 快捷切换与历史记录无需迁移。
export const ADAPTIVE_RENDER_SELECTIONS = Object.freeze({
    lively: '__adaptive_lively__',
    immersive: '__adaptive_immersive__',
    experimental: '__adaptive_experimental__',
});

const SHARED_ADAPTIVE_RULES = `【HTML规则】
0 输出：按创作任务生成完整HTML（HTML+CSS+JS）；仅交付成品，无分析/Markdown。三模式同等精致，只区分参与方式。
1 设计：从物件/空间/情绪选统一概念，布局、材质、配色、字体、动效服务正文；不套固定卡片/手机/信封，不照搬参考，禁止赛博朋克元素。长文不挤成小框。
2 正文：创作遵循原任务；如果提供了待排版正文，必须原样保留，不删改/概括/重复；有占位符才使用。主线按原顺序推进，探索限当前阶段，可回看已读内容。
3 边界：允许翻开、光影等表现动作和简短操作/状态提示；不另添台词、心声、评论、数值、线索、分支、结局。附加交互要求也不得新增剧情。
4 过程：进入/操作/阅读/收束按内容组织，反馈与完成状态可辨；长段留连续阅读空间，不反复解锁段落凑交互。不设置跳过整套体验的直接阅读全文入口；局部展开、正常导航可用。
5 音效：按需将可听辨的短交互音效直接绑定有意义的模块操作，Web Audio按物件/动作合成，不同动作不用统一提示音。首次操作手势内创建/恢复AudioContext并触发声音，不设独立开启/试听步骤或固定声音图标。有音效时可从辅助操作静音，关闭停声；无适合音效则不放声音控件。不生成BGM/循环背景声，无声也可完成。
6 技术：仅本页HTML/CSS/JS、内联SVG；无外部资源/依赖/网络请求/iframe。入口原生button/click，DOM就绪绑定后才启用、隐藏后文；目标须存在，装饰层pointer-events:none。推进不等待音频/动画，异常不得阻断进入；初始化失败保留正常阅读，操作失败可重试；连点不重复推进/正文/音源。
7 手机：弹性窄屏、无横向溢出，长文/短屏均可滚动到底；正文≥16px，行高≥1.6，触控≥44px，说明小字左对齐。支持触摸/键盘，拖动有点击等价操作。
8 自检：完整顺序、入口实际可达后文、返回/连点、首次模块音效、静音/音频异常、窄屏。动画不拖延阅读，遵循prefers-reduced-motion，离场停循环，避免闪烁与密集粒子。检查不输出，无专用标记。`;

const PROFILES = Object.freeze([
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.lively,
        name: '剧情自适应·灵动排版',
        shortName: '灵动排版',
        icon: 'fa-wand-magic-sparkles',
        description: '偏阅读：贴合故事的精致排版与轻巧反馈，顺畅读完。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【灵动排版｜阅读为主，细节灵巧】
默认无声，自然滚动/简单翻页；主线直接可读，不逐段点开、不解谜。物件翻开/局部展开/章节定位融入阅读。重构图、材质、文字节奏；不因轻量降成普通文章卡，不强加结尾仪式。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.immersive,
        name: '剧情自适应·沉浸互动',
        shortName: '沉浸互动',
        icon: 'fa-compass-drafting',
        description: '偏参与：亲手操作故事中的物件与场景，经历完整过程。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【沉浸互动｜参与情境，动作贯穿体验】
围绕本篇有意义的动作组织场景。优先用CSS绘画把故事物件做成操作对象，不拿emoji当插画、不挡正文。读者操作改变物件状态/位置/组合，带出对应正文；动作前后有可见变化，音效回应这次动作。若去掉操作体验几乎不变，应重设计；不做文章加按钮，不靠“下一段”堆参与感。长段安静阅读，收尾承接情绪、不补感言。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.experimental,
        name: '剧情自适应·大胆实验',
        shortName: '大胆实验',
        icon: 'fa-flask',
        description: '偏探索：通过空间、物件与分层揭示主动发现故事。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【大胆实验｜主动探索，发现有意义的惊喜】
让空间关系、物件组合或层次揭示帮助理解已有故事。优先用CSS绘画构建可探索物件/空间，不拿emoji当插画、不挡正文。尝试后改变可见状态、发现对应内容，音效回应动作；若去掉探索体验几乎不变，应重设计。谜题仅用当前内容/中性图形，无外部知识/虚构线索；不强塞小游戏或增加点击次数凑趣味。提示清楚，回看/取消/重试可用，发现后留阅读空间。`,
    }),
]);

export function adaptiveRenderProfiles() {
    return PROFILES.map(profile => ({ ...profile }));
}

export function adaptiveRenderProfile(selection) {
    return PROFILES.find(profile => profile.id === String(selection || '')) || null;
}

export function isAdaptiveRenderSelection(selection) {
    return !!adaptiveRenderProfile(selection);
}
