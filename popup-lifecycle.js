export const POPUP_MOUNT_TIMEOUT_MS = 3000;

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
