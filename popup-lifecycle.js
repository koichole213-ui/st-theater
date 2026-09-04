export const POPUP_MOUNT_TIMEOUT_MS = 3000;

// SillyTavern restores a parent popup's last focus after a child closes.
// Remember the clicked control and all scroll ancestors across that hand-off.
export async function withPreservedPopupViewport(anchor, action, {
    nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve)),
} = {}) {
    if (!anchor?.isConnected) return action();
    const popup = anchor.closest('dialog');
    const positions = new Map();
    for (let node = anchor.parentElement; node; node = node.parentElement) {
        positions.set(node, { top: node.scrollTop, left: node.scrollLeft });
    }
    const page = anchor.ownerDocument?.scrollingElement;
    if (page && !positions.has(page)) positions.set(page, { top: page.scrollTop, left: page.scrollLeft });
    const canRestore = () => anchor.isConnected && (!popup || popup.open);
    const restoreScroll = () => {
        if (!canRestore()) return;
        positions.forEach(({ top, left }, node) => {
            if (!node.isConnected) return;
            node.scrollTop = top;
            node.scrollLeft = left;
        });
    };
    anchor.focus({ preventScroll: true });
    try {
        return await action();
    } finally {
        if (canRestore()) {
            anchor.focus({ preventScroll: true });
            restoreScroll();
            await nextFrame();
            restoreScroll();
        }
    }
}

function defaultSleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function waitForPopupElements(
    getElementById,
    elementIds,
    {
        timeoutMs = POPUP_MOUNT_TIMEOUT_MS,
        intervalMs = 16,
        now = () => Date.now(),
        sleep = defaultSleep,
    } = {},
) {
    const ids = [...new Set((Array.isArray(elementIds) ? elementIds : [])
        .map(id => String(id || '').trim())
        .filter(Boolean))];
    if (typeof getElementById !== 'function' || !ids.length) return false;

    const startedAt = now();
    while (true) {
        if (ids.every(id => !!getElementById(id))) return true;
        if (now() - startedAt >= Math.max(0, Number(timeoutMs) || 0)) return false;
        await sleep(Math.max(1, Number(intervalMs) || 16));
    }
}
