// 内置「小手机」渲染规则：把聊天记录、社交动态画成手机界面。
// 只提供排版规则，内容仍由所选指令决定；与剧情自适应三档相互独立。
export const PHONE_RENDER_SELECTION = '__phone__';

const PHONE_RENDER_RULES = `小手机剧场渲染规范：
把本次内容画成手机界面（聊天记录、社交动态等）。写什么按任务指令，这里只管呈现。

【成品】直接输出完整HTML：<!doctype html>→head内style→body→body末尾唯一的script，不用markdown代码块。禁止外部资源与网络请求；头像、图片、图标用CSS、emoji或内联SVG画。App名用「消息」「动态」「钱包」等通用词，不写真实App名、不画其标志。

【内容】
- 机主看指令，没说就是用户扮演的人（user）。机主的消息在右，其他人在左。
- 每条消息、动态、评论都画出来，按原顺序，不删不并不缩写。
- 提供了待排版正文时：原文一字不改放进对应气泡、动态或评论；不成聊天或动态的段落放进"长消息"或"备忘录"卡片原样保留；不另写消息、评论或彩蛋。没有时，时间、电量、"已读"、网友昵称等小细节可按剧情补全。

【外观】
1. .phone{width:100%;max-width:400px;margin:0 auto;overflow:hidden}；@media(min-width:520px)时加约10px深色机身边框、圆角约40px；窄屏只留屏幕。高度随内容，不用100vh、固定高度或内部滚动框。
2. 顶部：状态栏（剧情时间、信号、电量）+标题栏（聊天写对方名字，可带"对方正在输入…"）。标题栏可sticky;top:0，不用fixed。
3. 色调按本篇情绪三选一，可微调，每种状态都浅底深字或深底浅字：
- 奶油手账（甜、日常）：底#FAF3E6，字#4A3B2A，次要#7A5C40，机主气泡#F6D9C4字#5A2E14，对方气泡#FFFFFF加虚线边#E3CFA8，点缀#A8581F；圆角大，可加便签、贴纸。
- 深夜锁屏（虐、暧昧、悬疑）：底#1E1D33，字#E9E6F7，次要#A9A4C9，机主气泡#5B4FC4字#FFFFFF，对方气泡#2E2C4A，点缀#F0A6C8；开头可放锁屏（大号时间、日期、两三条通知预览），只作封面不挡内容。
- 白描原生（写实、冷静）：底#F7F7F5，字#1F1F1E，次要#6B6A66，机主气泡#2F6FEB字#FFFFFF，对方气泡#FFFFFF加边#E4E3DE，点缀#2F6FEB；线条细、留白多。
4. 系统无衬线字体；气泡与动态正文>=16px，line-height>=1.55，overflow-wrap:anywhere；小字>=12px。气泡max-width:78%；头像是圆形色块写名字首字。可点区域>=44px。

【聊天】时间分隔居中小字；群聊对方气泡上方写昵称；机主最后一条下可写"已读"；单条emoji放大、不套气泡；撤回写居中灰字"××撤回了一条消息"。
- 图片：色块小图（渐变或简单图形+一行小字），做成button，点开下方露出画面描述。
- 语音：button，长度随秒数，写"12″"，点开下方露出转写。
- 转账（底#F5A65B字#3D2208）/红包（底#C0392B字#FFF1D6）：卡片写金额和留言。别人发给机主的做成button：点后变"已收款/已领取"，紧跟着露出一行系统小字；机主发出的按剧情写状态，不可点。

【动态】每条有头像、名字、时间（可加位置）、正文、配图格（1～9张色块，一行三张）、点赞/评论/转发数；点赞是button，点了变色+1，再点还原。评论"昵称：内容"，回复写"A 回复 B："，昵称与语气各不相同；超过4条先露3条，其余放进可展开区，按钮写"展开其余n条评论"。
同时有聊天和动态时，底部放图标栏（可sticky;bottom:0）在「消息」「动态」间切换，默认先出现的那块。不做左右滑（会被外层当翻页）。

【互动写法：出错也能读完】
沙盒里localStorage/sessionStorage/cookie、alert/confirm/prompt、表单提交、全屏、新窗口都不能用，状态只存JS变量。
1. 内容默认全部可见。点了才出现的加class="wait"和唯一id，隐藏只写在 .js .wait{display:none}，另加[hidden]{display:none!important}。四种button：data-open="#id"开合（图片描述、语音转写、其余评论）；data-tab="#id"切换（每块面板写id和相同data-pane，各有一个data-tab按钮，默认那块不加wait）；data-take="#id"收款（id是紧随的系统小字）；data-like=""点赞（数字写在按钮内<b>里，只用阿拉伯数字）。不要在html标签上预写js类。
2. script照抄骨架，可加功能，不删检查：
const root=document.documentElement,reveal=()=>root.classList.remove('js');
addEventListener('error',reveal);addEventListener('unhandledrejection',reveal);
const $=s=>document.querySelector(s),pick=s=>{const el=$(s);if(!el)throw s;return el};
const on=(sel,fn)=>document.querySelectorAll(sel).forEach(el=>el.addEventListener('click',e=>{try{fn(el,e)}catch(_){reveal()}}));
try{on('[data-open]',b=>b.setAttribute('aria-expanded',!pick(b.dataset.open).classList.toggle('wait')));
on('[data-tab]',b=>{const el=pick(b.dataset.tab);document.querySelectorAll(':not(button)[data-pane="'+el.dataset.pane+'"]').forEach(p=>p.classList.add('wait'));el.classList.remove('wait');document.querySelectorAll('[data-tab]').forEach(t=>t.classList.toggle('on',t===b))});
on('[data-take]',b=>{b.classList.add('done');pick(b.dataset.take).classList.remove('wait')});
on('[data-like]',b=>{const d=b.classList.toggle('done'),n=b.querySelector('b');if(n&&/^\\d+$/.test(n.textContent))n.textContent=+n.textContent+(d?1:-1)});
const refs=[...document.querySelectorAll('button')].flatMap(b=>Object.values(b.dataset));
for(const w of document.querySelectorAll('.wait,:not(button)[data-pane]'))if(!refs.includes('#'+w.id))throw w;
root.classList.add('js')}catch(_){reveal()}
任何出错都会去掉js，内容全部露出。
3. button都写type="button"，不写内联onclick。收款前后两种文字都写在按钮里，用.done切换。装饰层pointer-events:none。不做全屏遮罩和弹窗。露出的内容紧跟被点的东西，不自动滚动。

【自检，不输出】消息、动态、评论齐全且顺序没变；每个按钮点一遍；script不运行也能从头读到尾；各色调文字都看得清。prefers-reduced-motion时减少动效。`;

export const PHONE_RENDER_PROFILE = Object.freeze({
    id: PHONE_RENDER_SELECTION,
    name: '小手机（聊天·动态）',
    shortName: '小手机',
    icon: 'fa-comments',
    description: '把聊天记录、社交动态画成手机界面，适合配合「手机聊天」「手机动态」这类指令；色调由模型按情绪在奶油、深夜、白描三种里选。',
    rules: PHONE_RENDER_RULES,
});

export function phoneRenderProfile(selection) {
    return String(selection || '') === PHONE_RENDER_SELECTION ? PHONE_RENDER_PROFILE : null;
}
