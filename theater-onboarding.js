// theater-onboarding: 新手引导。
// 第一次打开、还没有任何作品时自动出现一次；走完或点“跳过”记到酒馆设置 onboardingDone，
// 换设备也不会再自动弹。电脑左栏底部、手机「设置 → 界面与快捷入口」可以再看。
// 遮罩挂在酒馆弹窗（dialog）上，不改动任何页面内容；关弹窗时随弹窗一起消失。
import { THEATER_WIDE_QUERY } from './theater-nav.js';

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
        title: '写过的都在历史里',
        body: '作品存在这个浏览器里。插件默认还会在酒馆服务器上备份一份（有变化才备份），在设置里也能再备份到 GitHub。',
    },
    {
        tabs: ['diagnostics'],
        title: '报错了怎么办',
        body: '报错弹窗会写原因和处理办法。还是不行的话，去诊断导出排查文件，发给作者。',
    },
    {
        tabs: ['config'],
        wideTarget: '#theater-onboarding-nav-btn',
        title: '就这些',
        body: '想再看一遍：设置 → 界面与快捷入口 → 新手引导。',
        wideBody: '想再看一遍，点左下角的新手引导。',
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

// 让 el 在可滚动的 container 里露出来（横向标签行 / 纵向左栏）。
function bringIntoView(container, el) {
    if (!container || !el) return;
    const box = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (container.scrollWidth > container.clientWidth + 1 && (rect.left < box.left || rect.right > box.right)) {
        container.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2;
    }
    if (container.scrollHeight > container.clientHeight + 1 && (rect.top < box.top || rect.bottom > box.bottom)) {
        container.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
    }
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

    function markDone() {
        if (!runtime.settings.onboardingDone) {
            runtime.settings.onboardingDone = true;
            runtime.save();
        }
    }

    function targetsFor(step, popup) {
        const wide = isWide();
        if (wide && step.wideTarget) return [popup.querySelector(step.wideTarget)].filter(Boolean);
        return step.tabs.map(tab => popup.querySelector(`.theater-tab[data-tab="${tab}"]`)).filter(Boolean);
    }

    function place() {
        if (!active) return;
        const { overlay, host, popup, spot, card } = active;
        if (!overlay.isConnected || !popup.isConnected) { closeOnboarding(); return; }
        const step = ONBOARDING_STEPS[active.index];
        const wide = isWide();
        const targets = targetsFor(step, popup);
        const hostRect = host.getBoundingClientRect();
        const offsetX = hostRect.left + (host.clientLeft || 0);
        const offsetY = hostRect.top + (host.clientTop || 0);
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
        const scroller = targets[0].closest('.theater-tabs');
        bringIntoView(scroller, targets[0]);
        const rects = targets.map(target => target.getBoundingClientRect());
        const pad = 4;
        const left = Math.min(...rects.map(r => r.left)) - offsetX - pad;
        const top = Math.min(...rects.map(r => r.top)) - offsetY - pad;
        const right = Math.max(...rects.map(r => r.right)) - offsetX + pad;
        const bottom = Math.max(...rects.map(r => r.bottom)) - offsetY + pad;
        spot.hidden = false;
        Object.assign(spot.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        if (wide) {
            const cardLeft = Math.min(right + 18, overlay.clientWidth - card.offsetWidth - 12);
            const middle = (top + bottom) / 2;
            const cardTop = Math.min(Math.max(12, middle - card.offsetHeight / 2), overlay.clientHeight - card.offsetHeight - 12);
            card.style.left = `${Math.max(12, cardLeft)}px`;
            card.style.top = `${Math.max(12, cardTop)}px`;
        }
    }

    function render() {
        if (!active) return;
        const { card, index } = active;
        const step = ONBOARDING_STEPS[index];
        const last = index === ONBOARDING_STEPS.length - 1;
        card.querySelector('.theater-onboarding-count').textContent = index === 0 ? '新手引导' : `${index} / ${ONBOARDING_STEPS.length - 1}`;
        card.querySelector('.theater-onboarding-title').textContent = step.title;
        card.querySelector('.theater-onboarding-body').textContent = isWide() && step.wideBody ? step.wideBody : step.body;
        card.querySelector('.theater-onboarding-skip').hidden = last;
        card.querySelector('.theater-onboarding-prev').hidden = index === 0;
        card.querySelector('.theater-onboarding-next').textContent = index === 0 ? '开始看看' : (last ? '完成' : '下一步');
        card.querySelectorAll('.theater-onboarding-dots span').forEach((dot, i) => dot.classList.toggle('on', i === index));
        place();
        card.querySelector('.theater-onboarding-next').focus({ preventScroll: true });
    }

    function go(index) {
        if (!active) return;
        active.index = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, index));
        render();
    }

    function startOnboarding() {
        const popup = document.querySelector('.theater-main-popup');
        if (!popup) return false;
        closeOnboarding();
        const host = popup.closest('dialog, .popup') || popup.parentElement;
        const overlay = document.createElement('div');
        overlay.className = 'theater-onboarding';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', '新手引导');
        overlay.innerHTML = `<div class="theater-onboarding-spot" hidden></div>
<div class="theater-onboarding-card">
    <div class="theater-onboarding-top"><span class="theater-onboarding-count"></span><button type="button" class="theater-onboarding-skip">跳过</button></div>
    <h3 class="theater-onboarding-title"></h3>
    <p class="theater-onboarding-body"></p>
    <div class="theater-onboarding-foot">
        <div class="theater-onboarding-dots" aria-hidden="true">${ONBOARDING_STEPS.map(() => '<span></span>').join('')}</div>
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
        active = { overlay, host, popup, card, spot: overlay.querySelector('.theater-onboarding-spot'), index: 0, onResize: () => place() };
        window.addEventListener('resize', active.onResize);
        // 引导期间点遮罩不穿透到下面的页面。
        overlay.addEventListener('click', event => {
            const button = event.target.closest('button');
            event.stopPropagation();
            if (!button || !active) return;
            if (button.classList.contains('theater-onboarding-skip')) { markDone(); closeOnboarding(); return; }
            if (button.classList.contains('theater-onboarding-prev')) { go(active.index - 1); return; }
            if (button.classList.contains('theater-onboarding-next')) {
                if (active.index === ONBOARDING_STEPS.length - 1) { markDone(); closeOnboarding(); return; }
                go(active.index + 1);
            }
        });
        render();
        return true;
    }

    function maybeStartOnboarding() {
        if (!shouldAutoStartOnboarding(runtime)) return false;
        return startOnboarding();
    }

    return { startOnboarding, maybeStartOnboarding, closeOnboarding };
}
