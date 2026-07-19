let sillyTavernWorldInfoModule;

async function loadSillyTavernWorldInfoModule() {
    if (!sillyTavernWorldInfoModule) sillyTavernWorldInfoModule = import('/scripts/world-info.js');
    return sillyTavernWorldInfoModule;
}

function replaceEntries(target, entries) {
    if (!Array.isArray(target)) return;
    target.splice(0, target.length, ...entries);
}

export async function scanWorldBookEntriesWithSillyTavern({
    entries,
    chat,
    maxContext,
    globalScanData,
    eventSource,
    eventType,
    checkWorldInfo,
}) {
    const sourceEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!sourceEntries.length) return [];
    if (!eventSource?.on || !eventSource?.removeListener || !eventType || typeof checkWorldInfo !== 'function') return null;

    const injectSelectedEntries = payload => {
        replaceEntries(payload?.globalLore, sourceEntries);
        replaceEntries(payload?.characterLore, []);
        replaceEntries(payload?.chatLore, []);
        replaceEntries(payload?.personaLore, []);
    };

    eventSource.on(eventType, injectSelectedEntries);
    try {
        const result = await checkWorldInfo(
            Array.isArray(chat) ? chat : [],
            Math.max(1024, Number(maxContext) || 65536),
            true,
            globalScanData || {},
        );
        return Array.from(result?.allActivatedEntries || []);
    } finally {
        eventSource.removeListener(eventType, injectSelectedEntries);
    }
}

export async function scanWithCurrentSillyTavern({ chatWithNames, chatWithoutNames, ...options }) {
    const module = await loadSillyTavernWorldInfoModule();
    const includeNames = module?.getWorldInfoSettings?.().world_info_include_names !== false;
    return scanWorldBookEntriesWithSillyTavern({
        ...options,
        chat: includeNames ? chatWithNames : chatWithoutNames,
        checkWorldInfo: module?.checkWorldInfo,
    });
}
