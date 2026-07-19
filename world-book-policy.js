export const WORLD_BOOK_STRATEGIES = Object.freeze({
    BLUE: 'blue',
    GREEN: 'green',
    CHAIN: 'chain',
});

export function worldBookEntryStrategy(entry = {}) {
    if (entry.constant === true) return WORLD_BOOK_STRATEGIES.BLUE;
    if (entry.vectorized === true) return WORLD_BOOK_STRATEGIES.CHAIN;
    return WORLD_BOOK_STRATEGIES.GREEN;
}

export function isWorldBookEntryEnabled(entry = {}) {
    return entry.disable !== true && entry.enabled !== false;
}

export function shouldReadWorldBookEntry(entry = {}, mode = 'all') {
    if (mode === 'all') return true;
    if (!isWorldBookEntryEnabled(entry)) return false;
    if (mode === 'lights') return worldBookEntryStrategy(entry) !== WORLD_BOOK_STRATEGIES.CHAIN;
    return true;
}
