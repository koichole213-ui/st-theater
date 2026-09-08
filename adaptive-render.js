// 保留已有选择值，旧设置、A/B 快捷切换与历史记录无需迁移。
export const ADAPTIVE_RENDER_SELECTIONS = Object.freeze({
    lively: '__adaptive_lively__',
    immersive: '__adaptive_immersive__',
    experimental: '__adaptive_experimental__',
});

const SHARED_ADAPTIVE_RULES = `【成品与实现】
输出独立完整HTML：<!doctype html>，html内含head/style、body/内容/script；直接交付代码。视觉取自本篇物件、空间与情绪，三模式保持同等精致。
正文：创作遵循原任务；如果提供了待排版正文，必须原样保留。主线按原顺序推进，探索限当前阶段，回看限已读内容；长段连续阅读。交互新增内容限操作/状态提示，剧情由原任务决定，不另添台词、线索或结局。不设置跳过整套体验的直接阅读全文入口。
布局：body{margin:0;background:transparent;height:auto;overflow:auto}；容器width:100%;max-width按场景选择；全局box-sizing:border-box。正文font-size>=16px;line-height>=1.6;overflow-wrap:anywhere；说明text-align:left；操作区min-height/min-width>=44px。用弹性布局让长文/短屏均可滚动到底。
操作：物件用button type="button"绑定click；script置正文后，先检查目标存在、绑定事件，成功后启用入口并隐藏待进入内容。初始化失败保留正常阅读。装饰层pointer-events:none；状态保存在JS对象，用classList/hidden/aria-expanded同步外观与可见正文。单次操作先更新状态和视图，再独立触发反馈；重复点击同一完成动作保持当前状态。拖动提供点击等价操作。
音效（按需）：物件click就是发声入口；一次动作对应一次短声，响完回到安静。首次操作手势内创建AudioContext并调用resume()；恢复成功后播放，catch处理失败，视图推进独立于音频Promise。Web Audio连接：OscillatorNode或短噪声AudioBufferSourceNode → GainNode → destination；按材质设置音色，增益短暂起伏后降至0，source.stop(ctx.currentTime+duration)，onended释放连接。duration按动作选择短时值；用状态检查丢弃已过时的播放。辅助设置可静音并停止现有声源，离场也清理声源。声音入口属于故事物件，禁止背景音乐、循环声及独立播放/开启声音按钮。
检查：逐个验证click→状态变化→对应正文可见；静音/音频异常仍能完成。用prefers-reduced-motion减少动效，反馈及时，关闭清理定时器；返回与连点保持正文完整。资源限本页HTML/CSS/JS、内联SVG与合成音效；禁止外部资源/网络请求、赛博朋克元素。检查过程不输出。`;

const PROFILES = Object.freeze([
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.lively,
        name: '剧情自适应·灵动排版',
        shortName: '灵动排版',
        icon: 'fa-wand-magic-sparkles',
        description: '偏阅读：贴合故事的精致排版与轻巧反馈，顺畅读完。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【灵动排版｜阅读为主，细节灵巧】
默认无声，主线以自然滚动/简单翻页直接可读。用字体层级、留白、渐变和材质细节组织阅读；章节定位用页内锚点，补充细节可用details/summary。交互用于局部查看，长段保持连续展示，结尾随正文自然收束。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.immersive,
        name: '剧情自适应·沉浸互动',
        shortName: '沉浸互动',
        icon: 'fa-compass-drafting',
        description: '偏参与：亲手操作故事中的物件与场景，经历完整过程。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【沉浸互动｜参与情境，动作贯穿体验】
体验：亲手改变故事物件，物件变化带出对应正文。
实现：优先用CSS绘画，::before/::after、linear-gradient、border-radius、box-shadow、clip-path组合形体，文字和操作区独立保留。以适合本篇的状态名组织state；click更新状态→classList切换物件形态/位置→显示对应section→短音效回应动作。各阶段连续展示相关长段；用材质、动作和情绪组织收束。
验收：物件变化与正文有明确关系，读者看得懂动作结果；参与感来自物件的变化，而非逐段点“下一段”。状态名与外观按本篇设计。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.experimental,
        name: '剧情自适应·大胆实验',
        shortName: '大胆实验',
        icon: 'fa-flask',
        description: '偏探索：通过空间、物件与分层揭示主动发现故事。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【大胆实验｜主动探索，发现有意义的惊喜】
体验：通过空间、物件组合或层次揭示，发现已有故事内容。
实现：优先用CSS绘画组合::before/::after、渐变、clip-path与box-shadow构建物件；用Grid/Flex安排可探索位置。以state记录当前选择/已发现内容，事件更新state，再由render(state)同步物件、提示和section；成功发现时短音效回应动作。探索限当前阶段，谜题依据当前内容或中性图形；提供回看、取消、重试和点击替代拖动。
验收：尝试有可见反馈，发现帮助理解正文；布局与操作随本篇设计，发现后留连续阅读空间。`,
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
