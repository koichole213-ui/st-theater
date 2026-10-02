// One click/touch menu at a time. Popover top layer avoids clipping by the list.
let activeMenu = null;
export function closeHistoryMenus({ returnFocus = false } = {}) {
    if (!activeMenu) return;
    const { menu, trigger, controller } = activeMenu;
    activeMenu = null;
    controller.abort();
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && trigger.isConnected) trigger.focus();
}
export function toggleHistoryMenu(trigger) {
    if (activeMenu?.trigger === trigger) { closeHistoryMenus({ returnFocus: true }); return; }
    closeHistoryMenus();
    const template = trigger.nextElementSibling;
    if (!template?.matches('[data-history-menu-content]')) return;
    const menu = document.createElement('div');
    menu.innerHTML = template.innerHTML;
    if (trigger.closest('.is-batch-managing')) menu.querySelector('#theater-export-all-history')?.remove();
    const controller = new AbortController();
    menu.hidden = false;
    menu.removeAttribute('data-history-menu-content');
    menu.classList.add('theater-history-action-menu');
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', trigger.getAttribute('aria-label') || '历史操作');
    const chapter = trigger.closest('[data-chapter-id]');
    if (chapter) menu.dataset.chapterId = chapter.dataset.chapterId;
    const root = trigger.closest('.theater-popup') || document.body;
    root.append(menu);
    activeMenu = { menu, trigger, controller };
    trigger.setAttribute('aria-expanded', 'true');
    if (typeof menu.showPopover === 'function') { menu.setAttribute('popover', 'manual'); menu.showPopover(); }
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    menu.style.maxHeight = `${Math.max(60, height - 24)}px`;
    menu.style.maxWidth = `${Math.max(120, width - 24)}px`;
    const rect = trigger.getBoundingClientRect(), box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(left + 12, Math.min(rect.right - box.width, left + width - box.width - 12))}px`;
    menu.style.top = `${Math.max(top + 12, Math.min(rect.bottom + 4, top + height - box.height - 12))}px`;
    const buttons = () => [...menu.querySelectorAll('button:not(:disabled)')];
    buttons()[0]?.focus();
    const options = { signal: controller.signal };
    document.addEventListener('pointerdown', event => {
        if (!menu.contains(event.target) && !trigger.contains(event.target)) closeHistoryMenus();
    }, options);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeHistoryMenus({ returnFocus: true }); }
        else if (menu.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const entries = buttons(), at = entries.indexOf(document.activeElement);
            entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus();
        } else if (event.key === 'Tab') closeHistoryMenus();
    }, { ...options, capture: true });
    menu.addEventListener('click', event => { if (event.target.closest('button:not(:disabled)')) { trigger.focus(); queueMicrotask(() => closeHistoryMenus()); } }, options);
    window.addEventListener('resize', () => closeHistoryMenus(), options);
    root.querySelector('.theater-panels-wrapper')?.addEventListener('scroll', () => closeHistoryMenus(), options);
}
