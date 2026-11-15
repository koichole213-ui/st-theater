// 保留已有选择值，旧设置、A/B 快捷切换与历史记录无需迁移。
export const ADAPTIVE_RENDER_SELECTIONS = Object.freeze({
    lively: '__adaptive_lively__',
    immersive: '__adaptive_immersive__',
    experimental: '__adaptive_experimental__',
});

const SHARED_ADAPTIVE_RULES = `【成品】输出完整HTML：<!doctype html>→head内style→body正文→正文后唯一的script。图形用CSS或内联SVG，禁止外部资源/网络请求、赛博朋克元素。视觉取自本篇物件、空间与情绪。
【正文】创作遵循原任务；如果提供了待排版正文，必须原样保留（即排版请求里的正文数据），只加物件文字与状态提示，不写新台词、回应或彩蛋，选择只决定先读哪段、其余随后也露出。否则主线外的小角落（物件背面、展开卡片、另一界面、回复的回应）可写与本篇一致的短内容。主线按原顺序推进，长段连续排列。
【版式】body{margin:0;background:transparent}；*{box-sizing:border-box}；容器width:100%，max-width按场景选。正文font-size>=16px;line-height>=1.6;overflow-wrap:anywhere；说明text-align:left；可点区域>=44px。长文/短屏均可滚动到底，不用100vh或固定高度滚动框锁高，不锁body滚动。
【运行环境】页面在只允许脚本的沙盒中显示：localStorage/sessionStorage/cookie、alert/confirm/prompt、表单提交、全屏、新窗口均不可用。确认、提交、答题都用页内button。左右滑会被外层当翻页，别做滑动手势。
【点哪看哪】点到的东西原地回应：带出的内容紧跟被点物件，或物件自己展开、翻面；这段末尾就是下一个可点处。按钮不集中到别处，不自动滚动。弹层就地展开成卡片，不做fixed全屏遮罩。
【互动写法：出错也能读完】
1. 正文默认全部可见。操作后才出现的内容加class="wait"和唯一id，隐藏只写在 .js .wait{display:none}，另加[hidden]{display:none!important}。四种button：data-show="#该id"露出（不收回，主线用它）；data-open="#该id"开合（补充内容，再点合上）；data-tab="#该id"切换（同组每块面板写id和相同data-pane、各有一个data-tab按钮，默认那块不加wait）；data-reply="#该id"替主角回一句，稍停露出回应（data-typing="#提示id"可指向带hidden的“正在输入…”）。自定义互动也把目标写进button的data-*，用pick()取。不要在html标签上预写js类。
2. script照此骨架：
const root=document.documentElement,reveal=()=>root.classList.remove('js');
addEventListener('error',reveal);addEventListener('unhandledrejection',reveal);
const $=s=>document.querySelector(s),pick=s=>{const el=$(s);if(!el)throw s;return el};
const on=(sel,fn)=>document.querySelectorAll(sel).forEach(el=>el.addEventListener('click',e=>{try{fn(el,e)}catch(_){reveal()}}));
try{on('[data-show]',b=>pick(b.dataset.show).classList.remove('wait'));
on('[data-open]',b=>b.setAttribute('aria-expanded',!pick(b.dataset.open).classList.toggle('wait')));
on('[data-tab]',b=>{const el=pick(b.dataset.tab);document.querySelectorAll('[data-pane="'+el.dataset.pane+'"]').forEach(p=>p.classList.add('wait'));el.classList.remove('wait')});
on('[data-reply]',b=>{const r=pick(b.dataset.reply),t=b.dataset.typing&&pick(b.dataset.typing);if(!r.classList.contains('wait'))return;if(t)t.hidden=false;setTimeout(()=>{if(t)t.hidden=true;r.classList.remove('wait')},900)});
/*其余互动用on绑定*/
const refs=[...document.querySelectorAll('button')].flatMap(b=>Object.values(b.dataset));
for(const w of document.querySelectorAll('.wait,:not(button)[data-pane]'))if(!refs.includes('#'+w.id))throw w;
root.classList.add('js')}catch(_){reveal()}
任何出错都会去掉js，内容全部露出。
3. button type="button"，用上面的data或on()绑定，不写内联onclick；重复点击同一完成动作保持当前状态。装饰层pointer-events:none；封面/遮罩关闭用hidden或remove()，不只调透明度；拖动元素加touch-action:none，并提供点击替代。
4. 不设置跳过整套体验的直接阅读全文入口；走完互动后全文连贯可读。
【音效（按需）】点物件时发一声短音：首次点击时new AudioContext()并resume()；OscillatorNode→GainNode→destination，增益淡出到0后stop()。先更新画面再发声，声音放进try。禁止背景音乐、循环声及独立声音开关。
【自检，不输出】逐个点：每次就在点的地方有变化；点完后主线正文全部可见；script不运行也能读全文。prefers-reduced-motion时减少动效。`;

const PLAYFUL_RULES = `【让东西回应你】先定读者在故事里的身份（翻他手机的人、收信人、门外的人），可点的就是此人会碰的物件。一个动作几处回响：物件自己变，别处也跟着变（计数、余额、顶栏、另一界面、角色反应）。动作多样：露出、开合、切换、选择、收下、集齐。没有待排版正文时，可让读者用data-reply替主角选回复；回应属于角落，主线不放进选项分支。`;

const PROFILES = Object.freeze([
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.lively,
        name: '剧情自适应·灵动排版',
        shortName: '灵动排版',
        icon: 'fa-wand-magic-sparkles',
        description: '偏阅读：贴合故事的精致排版与轻巧反馈，顺畅读完。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n【灵动排版｜阅读为主，细节灵巧】
默认无声。整篇一页往下读：用字体层级、留白、分隔纹样、渐变和材质细节表现场景转换，对白与叙述清楚区分。主线正文不用wait隐藏。互动只做点缀：信件、便笺等补充细节用details/summary或data-open就地翻开；可有一两个点了会变的小物件（灯亮、花开）；章节多时可加页内锚点目录；结尾随正文自然收束。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.immersive,
        name: '剧情自适应·沉浸互动',
        shortName: '沉浸互动',
        icon: 'fa-compass-drafting',
        description: '偏参与：亲手操作故事中的物件与场景，经历完整过程。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n${PLAYFUL_RULES}\n\n【沉浸互动｜参与情境，动作贯穿体验】
读者亲手操作故事里的物件（推门、点灯、拆信……），物件变化带出下一段正文。
做法：按情节节点分section，第一段可见，其余加wait。每段末尾就是一个剧情物件button（data-show指向下一段），点后物件换形态、别处至少一处跟着变，可配短音效。整篇至少用两种动作。物件优先用CSS绘画：::before/::after、渐变、border-radius、box-shadow、clip-path；文字与按钮独立于装饰层。
参与感来自物件变化，而非逐段点“下一段”。`,
    }),
    Object.freeze({
        id: ADAPTIVE_RENDER_SELECTIONS.experimental,
        name: '剧情自适应·大胆实验',
        shortName: '大胆实验',
        icon: 'fa-flask',
        description: '偏探索：通过空间、物件与分层揭示主动发现故事。',
        rules: `${SHARED_ADAPTIVE_RULES}\n\n${PLAYFUL_RULES}\n\n【大胆实验｜主动探索，发现有意义的惊喜】
搭一个能玩的小场景或小App（手机、书桌、旧箱子……），在里面发现故事。
做法：Grid/Flex摆出场景，可分几个界面用data-tab切换；主线留在一条线上，其他界面放角落。探索点就是场景里的物件，data-show指向紧跟其后的内容。至少用三种动作；没有待排版正文时，主线外放两三个不点也能读完的彩蛋。state记录发现进度并显示在场景里，可配短音效。主线分阶段时，每阶段末尾放一个收束物件（data-show指向下一阶段）；点它时本阶段未发现的段落一并展开，保证全文完整。
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
