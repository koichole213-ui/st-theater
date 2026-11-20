// theater-onboarding: 新手引导。
// 第一次打开、还没有任何作品时自动出现一次；走完或点“跳过”记到酒馆设置 onboardingDone，
// 换设备也不会再自动弹。电脑左栏底部、手机「设置 → 界面与快捷入口」可以再看。
// 遮罩挂在酒馆弹窗（dialog）上，不改动任何页面内容；关弹窗时随弹窗一起消失。
import { THEATER_WIDE_QUERY } from './theater-nav.js';
import { PAGE_GUIDES } from './theater-page-guides.js';

export const ONBOARDING_STEPS = [
    {
        tabs: [],
        title: '第一次用千夜浮梦',
        body: '这个插件会照着你和角色现在的聊天，另外写一篇小剧场。写出来的东西单独存，不会动你的聊天记录。\n下面几步告诉你东西都在哪。',
    },
    {
        tabs: ['config'],
        title: '先接上模型',
        body: '插件默认用独立 API：在 设置 → 正文生成线路 里填接口地址、密钥和模型。\n也可以改成酒馆主 API（实验），直接用酒馆正在连的模型。',
    },
    {
        tabs: ['generate'],
        title: '然后就能写了',
        body: '在小剧场指令里写你想看的，比如“大家一起吃火锅”，点生成。\n写完点上面的阅读就能看。',
    },
    {
        tabs: ['long-dream'],
        title: '长梦：写长篇用',
        body: '一章接一章往下写。梦脉会记住人物现在的状态和前面发生的事，续写时一起带上。',
    },
    {
        tabs: ['setting', 'dialogue', 'rules'],
        title: '设定、对话、规则',
        body: '设定：预设和世界书。\n对话：人设，带多少条聊天记录。\n规则：存好的指令和排版样式。\n不改也能直接生成。',
    },
    {
        tabs: ['history'],
        title: '保存了才在历史里',
        body: '生成的作品点「保存」才会存进历史，没保存的只留最近 3 篇。\n作品存在这个浏览器里，插件默认还会在酒馆服务器上备份一份（有变化才备份），在设置里也能再备份到 GitHub。',
    },
    {
        tabs: ['diagnostics'],
        title: '报错了怎么办',
        body: '报错弹窗会写原因和处理办法。还是不行的话，去诊断点「导出排查 TXT」，把下载的文件发给作者；只发截图作者没法查。',
    },
    {
        tabs: ['config'],
        wideTarget: '#theater-onboarding-nav-btn',
        title: '就这些',
        body: '每一页右上角的 ? 会细说这一页怎么用。\n想再看一遍这个引导：设置 → 界面与快捷入口 → 新手引导。',
        wideBody: '每一页标题右边的「这页怎么用」会细说这一页。\n想再看一遍这个引导，点左下角的新手引导。',
    },
];

// 只给真正的新用户自动弹：没走过引导、没有作品（含最近生成和当前结果）、存档读取正常、
// 存档没被浏览器关掉、以前也没在任何浏览器存过作品或被提醒过数量异常。
export function shouldAutoStartOnboarding(runtime) {
    const settings = runtime.settings || {};
    if (settings.onboardingDone) return false;
    if ((runtime.historyCache?.length || 0) > 0 || (runtime.longDreamCache?.length || 0) > 0) return false;
    if ((runtime.recentCache?.length || 0) > 0 || runtime.currentGenerationResult) return false;
    if (runtime.archiveClosed) return false;
    if (Object.values(runtime.storageReadErrors || {}).some(Boolean)) return false;
    const prints = Object.values(settings.archiveFingerprints || {});
    if (prints.some(print => print?.lossSuspected || (Number(print?.history) || 0) + (Number(print?.dreams) || 0) > 0)) return false;
    return true;
}

// 主弹窗上的颜色变量复制给遮罩，引导卡片就跟着当前皮肤走。
const COPIED_TOKENS = ['--t-fg', '--t-fg-soft', '--t-bg', '--t-surface-1', '--t-surface-2', '--t-border', '--t-border-strong',
    '--t-accent', '--t-accent-soft', '--t-accent-deep', '--t-on-accent', '--t-font-serif', '--t-font-sans',
    '--t-text-xs', '--t-text-sm', '--t-text-base', '--t-text-lg', '--t-dur-base'];

const isVisible = el => Boolean(el?.isConnected && el.getClientRects().length && !el.closest('[hidden]'));

function safeQuery(root, selector) {
    try { return root.querySelector(selector); } catch { return null; } // 老浏览器不认 :has() 时当作找不到
}

// 最近的可滚动祖先（到弹窗为止）。
function scrollParent(el, stop) {
    for (let node = el?.parentElement; node && node !== stop; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    }
    return null;
}

// 让目标露出来：横向标签行居中；纵向滚动区里，看不全就把它的顶边挪到上方。
function bringIntoView(el, stop, { sheet = false } = {}) {
    const row = el.closest('.theater-tabs');
    if (row && row.scrollWidth > row.clientWidth + 1) {
        const box = row.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        if (rect.left < box.left || rect.right > box.right) row.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2;
    }
    const scroller = scrollParent(el, stop);
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const visibleBottom = sheet ? box.top + box.height * 0.5 : box.bottom;
    if (rect.top < box.top || rect.bottom > visibleBottom) scroller.scrollTop += rect.top - box.top - 12;
}

export function createTheaterOnboarding(runtime) {
    let active = null;

    const isWide = () => typeof window.matchMedia === 'function' && window.matchMedia(THEATER_WIDE_QUERY).matches;

    function closeOnboarding() {
        if (!active) return;
        window.removeEventListener('resize', active.onResize);
        active.overlay.remove();
        active = null;
    }

    // 新手引导：step.tabs 全部点亮（宽屏可换成 wideTarget）；页面引导：step.pick 取第一个看得见的。
    function targetsFor(step, popup) {
        const wide = isWide();
        if (wide && step.wideTarget) return [safeQuery(popup, step.wideTarget)].filter(isVisible);
        if (step.tabs) return step.tabs.map(tab => safeQuery(popup, `.theater-tab[data-tab="${tab}"]`)).filter(isVisible);
        for (const selector of step.pick || []) {
            const el = safeQuery(popup, selector);
            if (isVisible(el)) return [el];
        }
        return [];
    }

    function placeCard(card, overlay, spot) {
        const W = overlay.clientWidth, H = overlay.clientHeight, w = card.offsetWidth, h = card.offsetHeight, gap = 18, m = 12;
        const clampTop = top => Math.min(Math.max(m, top), H - h - m);
        const clampLeft = left => Math.min(Math.max(m, left), W - w - m);
        const middleY = (spot.top + spot.bottom) / 2;
        let left, top;
        if (spot.right + gap + w <= W - m) { left = spot.right + gap; top = clampTop(middleY - h / 2); }
        else if (spot.left - gap - w >= m) { left = spot.left - gap - w; top = clampTop(middleY - h / 2); }
        else if (spot.bottom + gap + h <= H - m) { left = clampLeft(spot.left); top = spot.bottom + gap; }
        else if (spot.top - gap - h >= m) { left = clampLeft(spot.left); top = spot.top - gap - h; }
        else { left = W - w - m; top = H - h - m; }
        card.style.left = `${Math.max(m, left)}px`;
        card.style.top = `${Math.max(m, top)}px`;
    }

    function place() {
        if (!active) return;
        const { overlay, host, popup, spot, card, steps } = active;
        if (!overlay.isConnected || !popup.isConnected) { closeOnboarding(); return; }
        const step = steps[active.index];
        const wide = isWide();
        const targets = targetsFor(step, popup);
        card.classList.toggle('is-sheet', !wide);
        if (!targets.length) {
            overlay.classList.add('is-centered');
            spot.hidden = true;
            if (wide) {
                card.style.left = `${Math.max(12, (overlay.clientWidth - card.offsetWidth) / 2)}px`;
                card.style.top = `${Math.max(12, (overlay.clientHeight - card.offsetHeight) / 2)}px`;
            }
            return;
        }
        overlay.classList.remove('is-centered');
        bringIntoView(targets[0], popup.parentElement, { sheet: !wide });
        const hostRect = host.getBoundingClientRect();
        const offsetX = hostRect.left + (host.clientLeft || 0);
        const offsetY = hostRect.top + (host.clientTop || 0);
        const rects = targets.map(target => target.getBoundingClientRect());
        const pad = 4, W = overlay.clientWidth, H = overlay.clientHeight;
        const box = {
            left: Math.max(4, Math.min(...rects.map(r => r.left)) - offsetX - pad),
            top: Math.max(4, Math.min(...rects.map(r => r.top)) - offsetY - pad),
            right: Math.min(W - 4, Math.max(...rects.map(r => r.right)) - offsetX + pad),
            bottom: Math.min(H - 4, Math.max(...rects.map(r => r.bottom)) - offsetY + pad),
        };
        spot.hidden = false;
        Object.assign(spot.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${Math.max(0, box.right - box.left)}px`, height: `${Math.max(0, box.bottom - box.top)}px` });
        if (wide) placeCard(card, overlay, box);
    }

    function render() {
        if (!active) return;
        const { card, index, steps, label } = active;
        const step = steps[index];
        const last = index === steps.length - 1;
        card.querySelector('.theater-onboarding-count').textContent = active.countText(index, steps.length);
        card.querySelector('.theater-onboarding-title').textContent = step.title;
        card.querySelector('.theater-onboarding-body').textContent = isWide() && step.wideBody ? step.wideBody : step.body;
        card.querySelector('.theater-onboarding-skip').hidden = last && !active.alwaysClosable;
        card.querySelector('.theater-onboarding-skip').textContent = active.skipLabel;
        card.querySelector('.theater-onboarding-prev').hidden = index === 0;
        card.querySelector('.theater-onboarding-next').textContent = active.nextLabel(index, last);
        card.querySelectorAll('.theater-onboarding-dots span').forEach((dot, i) => dot.classList.toggle('on', i === index));
        active.overlay.setAttribute('aria-label', label);
        place();
        card.querySelector('.theater-onboarding-next').focus({ preventScroll: true });
    }

    function go(index) {
        if (!active) return;
        active.index = Math.max(0, Math.min(active.steps.length - 1, index));
        render();
    }

    // 通用的分步引导：遮罩挂在酒馆弹窗（dialog）上，关弹窗时一起消失。
    function startTour({ steps, label, countText, nextLabel, skipLabel = '跳过', alwaysClosable = false, onEnd = () => {} }) {
        const popup = document.querySelector('.theater-main-popup');
        if (!popup || !steps?.length) return false;
        closeOnboarding();
        const host = popup.closest('dialog, .popup') || popup.parentElement;
        const overlay = document.createElement('div');
        overlay.className = 'theater-onboarding';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `<div class="theater-onboarding-spot" hidden></div>
<div class="theater-onboarding-card">
    <div class="theater-onboarding-top"><span class="theater-onboarding-count"></span><button type="button" class="theater-onboarding-skip"></button></div>
    <h3 class="theater-onboarding-title"></h3>
    <p class="theater-onboarding-body"></p>
    <div class="theater-onboarding-foot">
        <div class="theater-onboarding-dots" aria-hidden="true">${steps.map(() => '<span></span>').join('')}</div>
        <div class="theater-onboarding-actions"><button type="button" class="theater-onboarding-prev">上一步</button><button type="button" class="theater-onboarding-next"></button></div>
    </div>
</div>`;
        const computed = getComputedStyle(popup);
        COPIED_TOKENS.forEach(name => {
            const value = computed.getPropertyValue(name);
            if (value) overlay.style.setProperty(name, value.trim());
        });
        host.appendChild(overlay);
        const card = overlay.querySelector('.theater-onboarding-card');
        active = { overlay, host, popup, card, spot: overlay.querySelector('.theater-onboarding-spot'), index: 0, steps, label, countText, nextLabel, skipLabel, alwaysClosable, onResize: () => place() };
        window.addEventListener('resize', active.onResize);
        // 引导期间点遮罩不穿透到下面的页面。
        overlay.addEventListener('click', event => {
            const button = event.target.closest('button');
            event.stopPropagation();
            if (!button || !active) return;
            if (button.classList.contains('theater-onboarding-skip')) { closeOnboarding(); onEnd('skip'); return; }
            if (button.classList.contains('theater-onboarding-prev')) { go(active.index - 1); return; }
            if (button.classList.contains('theater-onboarding-next')) {
                if (active.index === active.steps.length - 1) { closeOnboarding(); onEnd('finish'); return; }
                go(active.index + 1);
            }
        });
        render();
        return true;
    }

    function markDone() {
        if (!runtime.settings.onboardingDone) {
            runtime.settings.onboardingDone = true;
            runtime.save();
        }
    }

    function startOnboarding() {
        return startTour({
            steps: ONBOARDING_STEPS,
            label: '新手引导',
            countText: (index, total) => index === 0 ? '新手引导' : `${index} / ${total - 1}`,
            nextLabel: (index, last) => index === 0 ? '开始看看' : (last ? '完成' : '下一步'),
            onEnd: markDone,
        });
    }

    function maybeStartOnboarding() {
        if (!shouldAutoStartOnboarding(runtime)) return false;
        return startOnboarding();
    }

    function currentTab() {
        return document.querySelector('.theater-main-popup .theater-tab.active')?.getAttribute('data-tab') || runtime.settings.lastTheaterTab || 'generate';
    }

    // 「这页怎么用」：打开就算看过，小点熄灭。
    function startPageGuide(tab = currentTab()) {
        const steps = PAGE_GUIDES[tab];
        const name = document.querySelector(`.theater-main-popup .theater-tab[data-tab="${tab}"]`)?.getAttribute('data-page-title') || '';
        if (!steps) return false;
        const seen = runtime.settings.pageGuidesSeen && typeof runtime.settings.pageGuidesSeen === 'object' ? runtime.settings.pageGuidesSeen : {};
        if (!seen[tab]) {
            runtime.settings.pageGuidesSeen = { ...seen, [tab]: true };
            runtime.save();
        }
        document.querySelectorAll('.theater-main-popup .theater-page-guide-dot').forEach(dot => { dot.hidden = true; });
        return startTour({
            steps,
            label: `${name}这页怎么用`,
            countText: (index, total) => `${name} · ${index + 1} / ${total}`,
            nextLabel: (index, last) => last ? '完成' : '下一步',
            skipLabel: '关掉',
            alwaysClosable: true,
        });
    }

    return { startOnboarding, maybeStartOnboarding, closeOnboarding, startPageGuide };
}
