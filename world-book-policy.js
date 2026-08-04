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

function uniqueWorldBookNames(values = []) {
    const names = [];
    for (const value of Array.isArray(values) ? values : []) {
        const name = String(value || '').trim();
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}

export function syncFollowedWorldBooks(selectedBooks = [], previousFollowedBooks = [], nextFollowedBooks = []) {
    const previous = new Set(uniqueWorldBookNames(previousFollowedBooks));
    const manual = uniqueWorldBookNames(selectedBooks).filter(name => !previous.has(name));
    const followedBooks = uniqueWorldBookNames(nextFollowedBooks);
    return {
        selectedBooks: uniqueWorldBookNames([...manual, ...followedBooks]),
        followedBooks,
    };
}
