const MIN_BOOKMARK_Y_RATIO = 0.12;
const MAX_BOOKMARK_Y_RATIO = 0.88;

export function normalizeBookmarkSide(value) {
    return value === 'left' ? 'left' : 'right';
}

export function normalizeBookmarkYRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return 0.55;
    return Math.min(MAX_BOOKMARK_Y_RATIO, Math.max(MIN_BOOKMARK_Y_RATIO, ratio));
}

export function bookmarkPosition({ rect, side, yRatio, width, height, inset = 6 }) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const normalizedSide = normalizeBookmarkSide(side);
    const centerY = rect.top + rect.height * normalizeBookmarkYRatio(yRatio);
    const minTop = rect.top + inset;
    const maxTop = Math.max(minTop, rect.bottom - safeHeight - inset);

    return {
        side: normalizedSide,
        left: normalizedSide === 'left'
            ? rect.left + inset
            : rect.right - safeWidth - inset,
        top: Math.min(maxTop, Math.max(minTop, centerY - safeHeight / 2)),
    };
}

export function bookmarkPlacementFromPoint({ rect, x, y }) {
    return {
        side: x < rect.left + rect.width / 2 ? 'left' : 'right',
        yRatio: normalizeBookmarkYRatio((y - rect.top) / Math.max(1, rect.height)),
    };
}
