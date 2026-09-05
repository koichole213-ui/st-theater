// 保留已有选择值，旧设置、A/B 快捷切换与历史记录无需迁移。
export const ADAPTIVE_RENDER_SELECTIONS = Object.freeze({
    lively: '__adaptive_lively__',
    immersive: '__adaptive_immersive__',
    experimental: '__adaptive_experimental__',
});

const SHARED_ADAPTIVE_RULES = `【HTML规则】
0 输出：按创作任务生成完整HTML（HTML+CSS+JS）；仅交付成品，无分析/Markdown。三模式同等精致，只区分参与方式。
1 设计：从核心物件/结构/空间/情绪选统一概念；布局、材质、配色、字体、动效共同服务正文。不套固定卡片/手机/信封，不照搬参考。长文有舒适阅读空间，不挤成小框。
2 正文：创作遵循原任务；如果提供了待排版正文，必须原样保留，不删改/概括/重复；有占位符才使用。主线按原顺序推进，探索限当前阶段，可回看已读内容。
3 边界：允许翻开、光影等表现动作和简短操作/状态提示；不另添台词、心声、评论、数值、线索、分支、结局。附加交互要求也不得新增剧情。
4 过程：按内容衔接进入→阅读/操作→推进→收束，不强制封面/三幕/结尾页。动作有提示、反馈、完成状态；不堆假按钮。不设置跳过整套体验的直接阅读全文入口；局部展开、正常导航可用。
5 音画：灵动默认无声；其余按题材选本页Web Audio合成声。首次发声必须由读者明确点击开启声音，随时可关，关闭停止声源；无声也可完成。动画不拖延阅读，遵循prefers-reduced-motion，离场停止循环，避免闪烁与密集粒子。
6 技术：仅本页HTML/CSS/JS、内联SVG、合成声；无外部图片/字体/音频/依赖/网络请求/iframe。状态可返回、重试，连点不重复正文或叠加音源；脚本初始化成功后再隐藏，失败不空白、不困住读者。
7 手机：弹性窄屏、无横向溢出，长文/短屏均可滚动到底；正文≥16px，行高≥1.6，触控≥44px。支持触摸/键盘；拖动有点击等价操作，无需精确手势。
8 自检：完整顺序、入口/返回/连点、无声/减少动画、窄屏操作。检查只在内部完成，无专用标记。`;

const PROFILES = Object.freeze([
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.lively,
        name: '剧情自适应·灵动排版',
        shortName: '灵动排版',
        icon: 'fa-wand-magic-sparkles',
        description: '偏阅读：贴合故事的精致排版与轻巧反馈，顺畅读完。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【灵动排版｜阅读为主，细节灵巧】
自然滚动/简单翻页；主线直接可读，不逐段点开、不解谜。物件翻开/局部展开/章节定位融入阅读，有细腻反馈。重构图、材质、文字节奏；不因轻量降成普通文章卡，不强加结尾仪式。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.immersive,
        name: '剧情自适应·沉浸互动',
        shortName: '沉浸互动',
        icon: 'fa-compass-drafting',
        description: '偏参与：亲手操作故事中的物件与场景，经历完整过程。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【沉浸互动｜参与情境，动作贯穿体验】
让读者亲手操作本篇物件/场景。动作前→中→后形成完整状态，布局/光影/动效/可选声共同回应。阶段随正文转折，长段安静阅读，不频繁找按钮。可轻探索/轻解谜；收尾以场景状态承接情绪，不补写感言。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.experimental,
        name: '剧情自适应·大胆实验',
        shortName: '大胆实验',
        icon: 'fa-flask',
        description: '偏探索：通过空间、物件与分层揭示主动发现故事。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【大胆实验｜主动探索，发现有意义的惊喜】
空间阅读/物件组合/分层揭示/转场/拖动/轻解谜，自选配合，不凑数量。提示→尝试→反馈→发现→推进；未完成/进行中/完成可辨，失败可重试。谜题仅用当前内容或中性图形规律，无外部知识/虚构线索。回看、取消拖动、连点状态稳定；发现后留阅读空间，惊喜来自形式与已有内容呼应。`,
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
