export const ADAPTIVE_RENDER_SELECTIONS = Object.freeze({
    lively: '__adaptive_lively__',
    immersive: '__adaptive_immersive__',
    experimental: '__adaptive_experimental__',
});

const SHARED_ADAPTIVE_RULES = `【剧情自适应 HTML 设计总则】
你不是把正文套进固定皮肤，而是本篇小剧场的互动叙事设计师。请先阅读“原始小剧场指令”和全部正文数据，在内部完成设计判断，再只输出最终 HTML；不要输出分析过程、设计说明或 Markdown。

一、先从本篇内容中寻找设计锚点
1. 核心物件：报告、信件、日记、菜单、档案、车票、相册、礼物、契约等。
2. 核心结构：年龄成长、时间推进、地点移动、关系变化、任务阶段、线索揭晓等。
3. 核心媒介或空间：群聊、论坛、节目、游戏、审讯、教室、旅程、舞台等。
4. 核心情绪与材质：温馨、荒诞、秘密、紧张、怀旧、梦幻，以及与之匹配的纸张、屏幕、印章、轨道、灯光等视觉语言。
5. 核心动作：翻开、拆封、选择、拖动、展开、盖章、切换、拼合、前进等。

设计优先级：有明确物件时，优先让物件本身成为界面；没有物件但有明显叙事结构时，把结构变成交互；两者都不明显时，再依据场景、情绪与段落节奏设计阅读方式。只选择一个最贴题的主隐喻，不能把手机、游戏机、弹幕、档案和时间线全部堆在同一页。

二、互动必须来自内容
1. 主要互动必须模拟本篇核心动作，或帮助读者理解本篇结构；不能只在普通卡片旁放一个无意义按钮。
2. 不得默认使用圆角文章卡、左右聊天气泡、通用仪表盘或普通时间线。只有正文的媒介确实是聊天、记录、数据或时间阶段时才使用对应结构。
3. 不得发明正文里不存在的检查数值、人物属性、年龄事件、弹幕评价、线索、选择分支或结局。
4. 允许加入必要且简短的界面微文案，例如“翻开报告”“下一阶段”“展开全文”；不得加入新的剧情性文字。
5. 正文段落 token 必须各出现一次且按编号顺序写在 HTML 源码中。可以把连续段落分配到不同页面或阶段，但不得改写、概括、重复或打乱。

三、可用性与安全兜底
1. 页面首先适配手机窄屏，同时兼顾桌面；正文字号、行高和对比度必须适合长时间阅读。
2. 所有交互都必须支持点击或触摸，不得只依赖 hover；控件要有清楚标签、按下反馈和键盘可达性。
3. 必须提供带 data-theater-direct-read 属性的“展开全文”控件，可以退出分屏、分页或动画状态并直接连续阅读全部正文。
4. 主要交互控件必须带 data-theater-primary-action；根容器必须带 data-theater-adaptive-root，并用 data-theater-concept 简短记录本篇选择的设计概念。
5. 正文默认按源顺序存在并可见。JavaScript 初始化成功后才添加控制分页或隐藏的状态类；如果脚本失败，正文仍应自然展开，不得成为空白页。
6. 不引用外部图片、字体、框架、脚本或网络资源，不发起 fetch/XHR，不使用 iframe。只使用本页 HTML、CSS、JavaScript 和内联 SVG/CSS 图形。
7. 尊重 prefers-reduced-motion；动画不能闪烁、眩晕或阻碍阅读全文。
8. HTML 必须可独立运行，所有按钮与切换必须真正生效。装饰失败时优先保留正文与直接阅读入口。

四、设计映射示例（只学习抽象方法，禁止照抄题材或固定外观）
- 偷偷制作体检报告：锚点是装订报告；用“点击封面翻开—检查分页—最后进入人物反应”的阅读动作。不能退化成普通数据表加对话框，也不能编造检查数值。
- 细数角色不同年龄阶段：锚点是成长历程；用年龄轨道、人生履历或养成式阶段选择呈现已有事件。不能凭空增加智力、体力、好感度等属性。
- 一封迟到多年的信：锚点是信封与折叠信纸；交互是拆封、展开和阅读后续反应。不能无缘无故套聊天软件。
- 沿途旅行与不同地点事件：锚点是路线与站点；沿地图、车票或站牌切换连续场景。路线必须承载正文，不能只做装饰。
- 荒诞综艺游戏：锚点是节目现场；可以切换机位、揭开任务卡或查看现场阶段。不得擅自添加正文里没有的弹幕和观众评价。
- 如果本篇没有明显物件、媒介或阶段：根据情绪与段落节奏选择翻页、场次、景深或章节式交互，不要硬套以上任何示例。`;

const PROFILES = Object.freeze([
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.lively,
        name: '剧情自适应·灵动排版',
        shortName: '灵动排版',
        icon: 'fa-wand-magic-sparkles',
        description: '根据内容选择视觉隐喻，以轻量互动和连续阅读为主。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【本模板强度：灵动排版】\n只设计一个轻量、直观的主要互动；正文无需经过多层操作即可阅读。视觉可以灵活，但避免复杂多页面、长动画和高学习成本。优先使用原生 details、翻开、展开、标签切换或轻量 CSS 状态，保持稳定、清爽和易读。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.immersive,
        name: '剧情自适应·沉浸互动',
        shortName: '沉浸互动',
        icon: 'fa-compass-drafting',
        description: '围绕故事核心物件或结构设计一个主要互动与辅助导航。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【本模板强度：沉浸互动】\n围绕本篇最强设计锚点完成一个有叙事意义的主要互动，并可增加一个帮助返回、切换阶段或阅读全文的辅助导航。界面应让人一眼感到“这是为这篇故事设计的”，但不能牺牲正文完整度与手机阅读。避免无关小游戏、过多弹窗和装饰性假控件。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.experimental,
        name: '剧情自适应·大胆实验',
        shortName: '大胆实验',
        icon: 'fa-flask',
        description: '允许更大胆的分层、转场和探索式操作，同时保留全文兜底。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【本模板强度：大胆实验】\n可以设计两到三个相互配合的交互、分层页面、场景转场、拖动或探索式阅读，让页面具有明显惊喜感。所有效果仍必须围绕同一个主隐喻，不能变成组件展览；首次打开要给出清楚引导，并始终保留一键阅读全文。复杂效果必须有简单回退，移动端性能和正文可读性优先。`,
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

export function validateAdaptiveRenderHtml(html = '', selection = '') {
    if (!isAdaptiveRenderSelection(selection)) return true;
    const source = String(html || '');
    const missing = [];
    if (!/data-theater-adaptive-root(?:\s|=|>)/i.test(source)) missing.push('自适应根标记');
    if (!/data-theater-concept\s*=\s*["'][^"']+["']/i.test(source)) missing.push('设计概念');
    if (!/data-theater-primary-action(?:\s|=|>)/i.test(source)) missing.push('主要互动');
    if (!/data-theater-direct-read(?:\s|=|>)/i.test(source)) missing.push('展开全文入口');
    if (missing.length) {
        const error = new Error(`自适应排版缺少：${missing.join('、')}`);
        error.code = 'THEATER_ADAPTIVE_RENDER_VALIDATION';
        throw error;
    }
    if (/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(source)
        || /@import\s+/i.test(source)
        || /\bfetch\s*\(|XMLHttpRequest/i.test(source)
        || /<iframe\b/i.test(source)) {
        const error = new Error('自适应排版引用了外部资源或网络能力');
        error.code = 'THEATER_ADAPTIVE_RENDER_VALIDATION';
        throw error;
    }
    return true;
}
