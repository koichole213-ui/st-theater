// Self-contained so the same recognizer can run inside the sandboxed result frame.
export function bindResultSwipe(root, onSwipe) {
    const doc = root.ownerDocument || root;
    const view = doc.defaultView;
    let gesture = null, suppressClickUntil = 0;
    const listeners = [];
    const listen = (type, handler, options) => {
        root.addEventListener(type, handler, options);
        listeners.push(() => root.removeEventListener(type, handler, options));
    };
    function blocked(target) {
        if (!target?.closest) return true;
        const control = target.closest('button, a, input, textarea, select, summary, [role="button"], [role="slider"], [contenteditable]:not([contenteditable="false"]), [draggable="true"], [onclick], [onpointerdown], [ontouchstart], canvas, svg, audio, video, [data-no-workspace-swipe]');
        if (control && !control.matches('[data-result-tab]')) return true;
        for (let node = target; node && node !== root && node.nodeType === 1; node = node.parentElement) {
            const style = view?.getComputedStyle(node);
            if (['none', 'pan-x'].includes(style?.touchAction) || style?.cursor === 'pointer' && !control?.matches('[data-result-tab]') || /^(auto|scroll)$/.test(style?.overflowX || '') && node.scrollWidth > node.clientWidth + 2) return true;
        }
        return false;
    }
    function begin(event, point, kind) {
        // A fresh press is intentional; only suppress the click synthesized from the previous swipe.
        suppressClickUntil = 0;
        gesture = null;
        if (event.defaultPrevented || blocked(event.target)) return;
        gesture = { x: point.clientX, y: point.clientY, kind, started: Date.now(), horizontal: false };
    }
    function move(event, point) {
        if (!gesture) return;
        const dx = point.clientX - gesture.x, dy = point.clientY - gesture.y;
        if (!gesture.horizontal && Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { gesture = null; return; }
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) gesture.horizontal = true;
        if (gesture.horizontal && event.cancelable) event.preventDefault();
    }
    function end(event, point) {
        const start = gesture; gesture = null;
        if (!start || Date.now() - start.started > 900 || String(view?.getSelection() || '').trim()) return;
        const dx = point.clientX - start.x, dy = point.clientY - start.y;
        if (Math.abs(dx) < 55 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        if (onSwipe(dx < 0 ? 'read' : 'generate') === false) return;
        suppressClickUntil = Date.now() + 400;
        if (event.cancelable) event.preventDefault();
    }
    listen('touchstart', event => {
        if (event.touches.length !== 1) { gesture = null; return; }
        begin(event, event.touches[0], 'touch');
    }, { passive: true });
    listen('touchmove', event => {
        if (event.touches.length !== 1) { gesture = null; return; }
        if (gesture?.kind === 'touch') move(event, event.touches[0]);
    }, { passive: false });
    listen('touchend', event => { if (gesture?.kind === 'touch' && event.changedTouches.length) end(event, event.changedTouches[0]); }, { passive: false });
    listen('touchcancel', () => { gesture = null; });
    // Mouse/pen drag is a convenience; touch uses its own cancelable move listener.
    listen('pointerdown', event => { if (event.pointerType !== 'touch' && event.button === 0) begin(event, event, 'pointer'); });
    listen('pointermove', event => { if (gesture?.kind === 'pointer') move(event, event); });
    listen('pointerup', event => { if (gesture?.kind === 'pointer') end(event, event); });
    listen('pointercancel', () => { if (gesture?.kind === 'pointer') gesture = null; });
    listen('pointerleave', () => { if (gesture?.kind === 'pointer') gesture = null; });
    listen('click', event => {
        if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    return () => { gesture = null; listeners.forEach(remove => remove()); };
}

export function animateResultPage(node, page) {
    if (!node?.animate) return;
    node.getAnimations().forEach(animation => animation.cancel());
    if (node.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.animate([
        { transform: `translateX(${page === 'read' ? 22 : -22}px)`, opacity: 0.65 },
        { transform: 'translateX(0)', opacity: 1 },
    ], { duration: 190, easing: 'ease-out' });
}
