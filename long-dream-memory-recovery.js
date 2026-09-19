import { normalizeStoryFields, composeStorySummary } from './long-dream-story-summary.js';
// Old records have state history, but do not have full snapshots for every kind
// of mutable memory. Preserve provable facts and schedule missing history only.
export function retainMemoryThroughChapter(memory, cutoff) {
    const source = JSON.parse(JSON.stringify(memory));
    let replayFrom = Math.min(Number(source.processedThroughChapter) || 0, cutoff) + 1;
    let changed = (Number(source.processedThroughChapter) || 0) > cutoff;
    const numbers = item => (item.sourceChapterNumbers || []).filter(n => n <= cutoff);
    const needsReplay = item => {
        const earlier = numbers(item);
        if (earlier.length) replayFrom = Math.min(replayFrom, ...earlier);
        changed = true;
    };
    const boundEvidence = item => {
        const future = (item.sourceChapterNumbers || []).some(n => n > cutoff);
        if (future) changed = true;
        return { ...item, sourceChapterNumbers: numbers(item), ...(future ? { quote: '', tags: [] } : {}) };
    };
    const states = source.states.flatMap(item => {
        const history = item.history.filter(entry => entry.fromChapter <= cutoff);
        if (item.validFromChapter <= cutoff) return [{ ...boundEvidence(item), history: history.map(entry => ({ ...boundEvidence(entry), toChapter: Math.min(entry.toChapter, cutoff) })) }];
        changed = true;
        const previous = history.slice().sort((a, b) => a.fromChapter - b.fromChapter).at(-1);
        if (!previous) { needsReplay(item); return []; }
        // Older histories stored only a value: the latest subject/topic could
        // belong to a later chapter, so do not attach that value to them.
        if (!previous.subjects?.length || !previous.attribute) {
            replayFrom = Math.min(replayFrom, previous.fromChapter);
            needsReplay(previous);
            return [];
        }
        return [{ ...item, value: previous.value, validFromChapter: previous.fromChapter,
            subjects: [...previous.subjects], attribute: previous.attribute, topic: previous.topic,
            sourceChapterNumbers: numbers(previous), quote: '', tags: [],
            editedByUser: previous.editedByUser, lockedByUser: previous.editedByUser,
            history: history.filter(entry => entry !== previous).map(entry => ({ ...boundEvidence(entry), toChapter: Math.min(entry.toChapter, cutoff) })),
        }];
    });
    const byChapter = items => items.flatMap(item => {
        if (item.chapterNumber > cutoff) { needsReplay(item); return []; }
        return [boundEvidence(item)];
    });
    const threads = source.threads.flatMap(item => {
        if (item.introducedAt > cutoff) { changed = true; return []; }
        if (item.lastTouchedAt > cutoff || item.resolvedAt > cutoff || item.sourceChapterNumbers.some(n => n > cutoff)) {
            // The original thread content may itself have been replaced. Do not
            // pretend a later resolution or description existed at the cutoff.
            replayFrom = Math.min(replayFrom, item.introducedAt);
            changed = true;
            return [];
        }
        return [item];
    });
    const deviations = source.deviations.filter(item => {
        if (item.sourceChapterNumbers.some(n => n > cutoff)) { needsReplay(item); return false; }
        return true;
    });
    const result = { ...source, states, threads, deviations,
        transitions: byChapter(source.transitions), cards: byChapter(source.cards), legacyCards: byChapter(source.legacyCards),
        pendingConflicts: source.pendingConflicts.filter(item => item.chapterNumber <= cutoff),
        lastBatchChanges: source.lastBatchChanges.filter(item => item.chapterNumber <= cutoff),
    };
    // Rejections have no chapter provenance in the legacy schema. Retain user
    // decisions rather than silently resurrecting explicitly rejected memories.
    const processed = Math.max(0, Math.min(cutoff, replayFrom - 1));
    result.processedThroughChapter = processed;
    result.pendingChapterNumbers = Array.from({ length: cutoff - processed }, (_, i) => processed + i + 1);
    result.status = result.pendingChapterNumbers.length ? 'pending' : processed ? 'ready' : 'not-started';
    result.lastErrorSignal = '';
    result.summaryHistory = (source.summaryHistory || []).filter(item => item.chapterNumber <= cutoff);
    result.currentState = changed ? (result.summaryHistory.slice().sort((a, b) => a.chapterNumber - b.chapterNumber).at(-1)?.text || '') : source.currentState;
    Object.assign(result, normalizeStoryFields(source, cutoff));
    if (source.storyEntries?.length) {
        result.currentState = composeStorySummary(result.storyEntries);
        result.summaryThroughChapter = result.storyEntries.at(-1)?.chapterNumber || 0;
    }
    result.summaryNeedsRefresh = changed || source.summaryNeedsRefresh === true;
    return result;
}
