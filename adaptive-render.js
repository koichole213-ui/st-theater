// 保留已有选择值，旧设置、A/B 快捷切换与历史记录无需迁移。
export const ADAPTIVE_RENDER_SELECTIONS = Object.freeze({
    lively: '__adaptive_lively__',
    immersive: '__adaptive_immersive__',
    experimental: '__adaptive_experimental__',
});

const SHARED_ADAPTIVE_RULES = `【成品】输出完整HTML：<!doctype html>→head内style→body正文→正文后唯一的script。图形用CSS或内联SVG，禁止外部资源/网络请求、赛博朋克元素。视觉取自本篇物件、空间与情绪。
【正文】创作遵循原任务；如果提供了待排版正文，必须原样保留。主线按原顺序推进，长段连续排列；互动只添加操作提示与状态文字，不另添台词、线索或结局。
【版式】body{margin:0;background:transparent}；*{box-sizing:border-box}；容器width:100%，max-width按场景选。正文font-size>=16px;line-height>=1.6;overflow-wrap:anywhere；说明text-align:left；可点区域>=44px。长文/短屏均可滚动到底，不用100vh锁高或锁body滚动。
【运行环境】页面在只允许脚本的沙盒中显示：localStorage/sessionStorage/cookie、alert/confirm/prompt、表单提交、全屏、新窗口均不可用。确认、提交、答题都用页内button。
【互动写法：出错也能读完】
1. 正文默认全部可见。操作后才出现的段落加class="wait"和唯一id，隐藏只写在 .js .wait{display:none}；揭示它的button写data-show="#该id"。
2. script照此骨架：
const root=document.documentElement,reveal=()=>root.classList.remove('js');
addEventListener('error',reveal);addEventListener('unhandledrejection',reveal);
const on=(sel,fn)=>document.querySelectorAll(sel).forEach(el=>el.addEventListener('click',e=>{try{fn(el,e)}catch(_){reveal()}}));
const show=el=>{if(!el)return reveal();el.classList.remove('wait');el.scrollIntoView({behavior:'smooth',block:'nearest'})};
try{on('[data-show]',el=>show(document.querySelector(el.dataset.show)));
/*其余互动用on绑定*/
for(const w of document.querySelectorAll('.wait'))if(!document.querySelector('[data-show="#'+w.id+'"]'))throw w;
root.classList.add('js')}catch(_){reveal()}
任何出错都会去掉js，正文全部露出。
3. button type="button"，用data-show或on()绑定，不写内联onclick；读过的内容不收回；重复点击同一完成动作保持当前状态。
4. 装饰层pointer-events:none；封面/遮罩关闭用hidden或remove()，不只调透明度。
5. 拖动元素加touch-action:none，并提供点击替代。
6. 不设置跳过整套体验的直接阅读全文入口；走完互动后全文连贯可读。
【音效（按需）】点物件时发一声短音：首次点击时new AudioContext()并resume()；OscillatorNode→GainNode→destination，增益淡出到0后stop()。先更新画面再发声，声音放进try。禁止背景音乐、循环声及独立声音开关。
【自检，不输出】逐个点：每次有可见变化；点完后全部正文可见；script不运行也能读全文。prefers-reduced-motion时减少动效。`;

const PROFILES = Object.freeze([
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.lively,
        name: '剧情自适应·灵动排版',
        shortName: '灵动排版',
        icon: 'fa-wand-magic-sparkles',
        description: '偏阅读：贴合故事的精致排版与轻巧反馈，顺畅读完。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【灵动排版｜阅读为主，细节灵巧】
默认无声。整篇一页往下读：用字体层级、留白、分隔纹样、渐变和材质细节表现场景转换，对白与叙述清楚区分。主线正文不用wait隐藏。互动只做点缀：信件、便笺、回忆等补充细节可用details/summary；章节多时可加页内锚点目录；结尾随正文自然收束。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.immersive,
        name: '剧情自适应·沉浸互动',
        shortName: '沉浸互动',
        icon: 'fa-compass-drafting',
        description: '偏参与：亲手操作故事中的物件与场景，经历完整过程。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【沉浸互动｜参与情境，动作贯穿体验】
读者亲手操作故事里的物件（推门、点灯、拆信……），物件变化带出下一段正文。
做法：按情节节点把正文分成若干section，第一段可见，其余加wait。每个节点末尾放一个与剧情相关的物件button（data-show指向下一段），点击后物件用classList切换形态，可配短音效。物件优先用CSS绘画：::before/::after、渐变、border-radius、box-shadow、clip-path；文字与按钮独立于装饰层。
每个节点点一次就能继续；参与感来自物件变化，而非逐段点“下一段”。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.experimental,
        name: '剧情自适应·大胆实验',
        shortName: '大胆实验',
        icon: 'fa-flask',
        description: '偏探索：通过空间、物件与分层揭示主动发现故事。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【大胆实验｜主动探索，发现有意义的惊喜】
在空间、物件与层层揭开中主动发现故事。
做法：正文按主线分阶段，每阶段用Grid/Flex摆出可探索场景（抽屉、星空……）；探索点是button，data-show指向本阶段一段wait正文。state记录并显示“已发现 n/总数”，可配短音效。每阶段末尾放一个收束物件（data-show指向下一阶段或结尾）；点它时本阶段未发现的段落一并展开，保证全文完整。
谜题依据已读内容，用点选代替文字输入，可重试。物件优先用CSS绘画：::before/::after、渐变、clip-path、box-shadow。`,
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
