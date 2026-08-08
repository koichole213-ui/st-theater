export const LONG_DREAM_MEMORY_SCHEMA_VERSION = 2;

export const LONG_DREAM_MEMORY_STATE_ATTRIBUTES = Object.freeze([
    'location', 'physical_condition', 'relationship', 'knowledge', 'identity',
    'possession', 'condition', 'ongoing_action', 'goal', 'other',
]);

export const LONG_DREAM_MEMORY_TRANSITION_DOMAINS = Object.freeze([
    'character', 'relationship', 'identity', 'experience', 'world',
]);

export const LONG_DREAM_MEMORY_THREAD_KINDS = Object.freeze([
    'foreshadow', 'promise', 'mystery', 'secret', 'task', 'threat',
]);

export const LONG_DREAM_MEMORY_THREAD_STATUSES = Object.freeze([
    'open', 'progressed', 'resolved', 'abandoned',
]);

export const LONG_DREAM_MEMORY_OPERATION_TYPES = Object.freeze([
    'set_state', 'append_transition', 'open_thread', 'advance_thread',
    'resolve_thread', 'abandon_thread', 'upsert_deviation',
]);

const CONFLICT_REASONS = new Set([
    'locked-by-user', 'rejected-by-user', 'closed-thread', 'missing-target', 'target-type-mismatch',
]);

function cleanText(value, limit = 0) {
    const text = String(value || '').trim();
    return limit > 0 ? text.slice(0, limit) : text;
}

function cleanList(values, limit = 20, itemLimit = 120) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
        const text = cleanText(value, itemLimit);
        const key = canonicalText(text);
        if (!text || seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

function canonicalText(value) {
    return cleanText(value).normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizedDate(value, fallback = new Date().toISOString()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function chapterNumber(value, fallback = 1) {
    return Math.max(1, Math.floor(Number(value) || fallback));
}

function chapterNumbers(values, fallback = []) {
    return [...new Set([...(Array.isArray(values) ? values : []), ...fallback]
        .map(value => Math.floor(Number(value)))
        .filter(value => value >= 1))].sort((a, b) => a - b);
}

function itemId(value, prefix, index) {
    return cleanText(value, 120) || `${prefix}-${index + 1}`;
}

function stateSlotKey(subjects = [], attribute = 'other', topic = '') {
    return `${cleanList(subjects, 8).map(canonicalText).sort().join('|')}\u0000${canonicalText(attribute)}\u0000${canonicalText(topic)}`;
}

function memoryTags(values) {
    return cleanList(values, 20, 80);
}

function sourceNumbers(value, fallbackChapter = 1) {
    return chapterNumbers(value, [fallbackChapter]);
}

function normalizeStateHistory(entry, index = 0) {
    if (!entry || typeof entry !== 'object') return null;
    const value = cleanText(entry.value, 1200);
    if (!value) return null;
    const fromChapter = chapterNumber(entry.fromChapter || entry.validFromChapter);
    const toChapter = Math.max(fromChapter, chapterNumber(entry.toChapter, fromChapter));
    return {
        id: itemId(entry.id, 'state-history', index),
        value,
        fromChapter,
        toChapter,
        sourceChapterNumbers: sourceNumbers(entry.sourceChapterNumbers, fromChapter),
        quote: cleanText(entry.quote, 240),
        editedByUser: entry.editedByUser === true,
    };
}

export function normalizeLongDreamMemoryState(state, index = 0, fallbackDate = '') {
    if (!state || typeof state !== 'object') return null;
    const value = cleanText(state.value, 1200);
    const subjects = cleanList(state.subjects || [state.subject], 8);
    if (!value || !subjects.length) return null;
    const requestedAttribute = cleanText(state.attribute, 60);
    const attribute = LONG_DREAM_MEMORY_STATE_ATTRIBUTES.includes(requestedAttribute) ? requestedAttribute : 'other';
    const validFromChapter = chapterNumber(state.validFromChapter || state.chapterNumber);
    return {
        id: itemId(state.id, 'state', index),
        subjects,
        attribute,
        topic: cleanText(state.topic, 160),
        value,
        validFromChapter,
        sourceChapterNumbers: sourceNumbers(state.sourceChapterNumbers, validFromChapter),
        quote: cleanText(state.quote, 240),
        history: (Array.isArray(state.history) ? state.history : []).map(normalizeStateHistory).filter(Boolean).slice(-100),
        tags: memoryTags(state.tags),
        editedByUser: state.editedByUser === true,
        lockedByUser: state.lockedByUser === true,
        hiddenFromPrompt: state.hiddenFromPrompt === true,
        updatedAt: normalizedDate(state.updatedAt, fallbackDate || new Date().toISOString()),
    };
}

export function normalizeLongDreamMemoryTransition(transition, index = 0, fallbackDate = '') {
    if (!transition || typeof transition !== 'object') return null;
    const subjects = cleanList(transition.subjects || [transition.subject], 8);
    const to = cleanText(transition.to, 1200);
    const cause = cleanText(transition.cause, 1200);
    if (!subjects.length || (!to && !cause)) return null;
    const requestedDomain = cleanText(transition.domain, 60);
    const domain = LONG_DREAM_MEMORY_TRANSITION_DOMAINS.includes(requestedDomain) ? requestedDomain : 'experience';
    const number = chapterNumber(transition.chapterNumber);
    return {
        id: itemId(transition.id, 'transition', index),
        domain,
        subjects,
        from: cleanText(transition.from, 1200),
        to,
        cause,
        impact: cleanText(transition.impact, 1200),
        chapterNumber: number,
        sourceChapterNumbers: sourceNumbers(transition.sourceChapterNumbers, number),
        quote: cleanText(transition.quote, 240),
        tags: memoryTags(transition.tags),
        editedByUser: transition.editedByUser === true,
        lockedByUser: transition.lockedByUser === true,
        hiddenFromPrompt: transition.hiddenFromPrompt === true,
        updatedAt: normalizedDate(transition.updatedAt, fallbackDate || new Date().toISOString()),
    };
}

function normalizeThreadProgress(entry, index = 0) {
    if (!entry || typeof entry !== 'object') return null;
    const content = cleanText(entry.content || entry.progress, 1200);
    if (!content) return null;
    return {
        id: itemId(entry.id, 'thread-progress', index),
        chapterNumber: chapterNumber(entry.chapterNumber),
        content,
        quote: cleanText(entry.quote, 240),
    };
}

export function normalizeLongDreamMemoryThread(thread, index = 0, fallbackDate = '') {
    if (!thread || typeof thread !== 'object') return null;
    const threadKey = cleanText(thread.threadKey || thread.key || thread.content, 180);
    const content = cleanText(thread.content, 1200) || threadKey;
    if (!threadKey || !content) return null;
    const requestedKind = cleanText(thread.kind, 60);
    const requestedStatus = cleanText(thread.status, 40);
    const kind = LONG_DREAM_MEMORY_THREAD_KINDS.includes(requestedKind) ? requestedKind : 'foreshadow';
    const status = LONG_DREAM_MEMORY_THREAD_STATUSES.includes(requestedStatus) ? requestedStatus : 'open';
    const introducedAt = chapterNumber(thread.introducedAt || thread.chapterNumber);
    const lastTouchedAt = Math.max(introducedAt, chapterNumber(thread.lastTouchedAt, introducedAt));
    const resolvedAt = ['resolved', 'abandoned'].includes(status)
        ? Math.max(lastTouchedAt, chapterNumber(thread.resolvedAt, lastTouchedAt))
        : null;
    return {
        id: itemId(thread.id, 'thread', index),
        threadKey,
        kind,
        subjects: cleanList(thread.subjects || [thread.subject], 8),
        content,
        progress: cleanText(thread.progress, 1200),
        progressHistory: (Array.isArray(thread.progressHistory) ? thread.progressHistory : [])
            .map(normalizeThreadProgress).filter(Boolean).slice(-100),
        status,
        introducedAt,
        lastTouchedAt,
        resolvedAt,
        resolution: cleanText(thread.resolution, 1200),
        abandonedReason: cleanText(thread.abandonedReason || thread.reason, 1200),
        sourceChapterNumbers: sourceNumbers(thread.sourceChapterNumbers, introducedAt),
        quote: cleanText(thread.quote, 240),
        tags: memoryTags(thread.tags),
        editedByUser: thread.editedByUser === true,
        lockedByUser: thread.lockedByUser === true,
        hiddenFromPrompt: thread.hiddenFromPrompt === true,
        updatedAt: normalizedDate(thread.updatedAt, fallbackDate || new Date().toISOString()),
    };
}

export function normalizeLongDreamMemoryDeviation(deviation, index = 0, fallbackDate = '') {
    if (!deviation || typeof deviation !== 'object') return null;
    const deviationKey = cleanText(deviation.deviationKey || deviation.key, 180);
    const dreamChange = cleanText(deviation.dreamChange || deviation.content, 1600);
    if (!deviationKey || !dreamChange) return null;
    const sources = sourceNumbers(deviation.sourceChapterNumbers, deviation.chapterNumber || 1);
    return {
        id: itemId(deviation.id, 'deviation', index),
        deviationKey,
        subjects: cleanList(deviation.subjects || [deviation.subject], 8),
        originalCanon: cleanText(deviation.originalCanon, 1600),
        dreamChange,
        directConsequences: cleanList(deviation.directConsequences, 20, 500),
        invalidatedAssumptions: cleanList(deviation.invalidatedAssumptions, 20, 500),
        sourceChapterNumbers: sources,
        quote: cleanText(deviation.quote, 240),
        tags: memoryTags(deviation.tags),
        editedByUser: deviation.editedByUser === true,
        lockedByUser: deviation.lockedByUser === true,
        hiddenFromPrompt: deviation.hiddenFromPrompt === true,
        updatedAt: normalizedDate(deviation.updatedAt, fallbackDate || new Date().toISOString()),
    };
}

function normalizeRejection(rejection, index = 0, fallbackDate = '') {
    if (!rejection || typeof rejection !== 'object') return null;
    const kind = ['state', 'transition', 'thread', 'deviation', 'legacy'].includes(rejection.kind)
        ? rejection.kind
        : 'legacy';
    const signature = cleanText(rejection.signature, 1000);
    if (!signature) return null;
    return {
        id: itemId(rejection.id, 'rejection', index),
        kind,
        signature,
        targetId: cleanText(rejection.targetId, 120),
        reason: cleanText(rejection.reason, 500),
        createdAt: normalizedDate(rejection.createdAt, fallbackDate || new Date().toISOString()),
    };
}

function safeOperationCopy(operation = {}) {
    const copy = {};
    for (const key of [
        'op', 'targetId', 'subjects', 'attribute', 'topic', 'value', 'domain', 'from', 'to', 'cause', 'impact',
        'threadKey', 'kind', 'content', 'progress', 'resolution', 'reason', 'deviationKey', 'originalCanon',
        'dreamChange', 'directConsequences', 'invalidatedAssumptions', 'chapterNumber', 'quote', 'tags',
    ]) {
        if (operation[key] !== undefined) copy[key] = operation[key];
    }
    return copy;
}

function normalizeConflict(conflict, index = 0, fallbackDate = '') {
    if (!conflict || typeof conflict !== 'object') return null;
    const reason = CONFLICT_REASONS.has(conflict.reason) ? conflict.reason : 'missing-target';
    const operation = safeOperationCopy(conflict.operation);
    if (!operation.op) return null;
    return {
        id: itemId(conflict.id, 'memory-conflict', index),
        reason,
        targetId: cleanText(conflict.targetId || operation.targetId, 120),
        operation,
        chapterNumber: chapterNumber(conflict.chapterNumber || operation.chapterNumber),
        createdAt: normalizedDate(conflict.createdAt, fallbackDate || new Date().toISOString()),
    };
}

function normalizeBatchChange(change, index = 0) {
    if (!change || typeof change !== 'object') return null;
    const op = LONG_DREAM_MEMORY_OPERATION_TYPES.includes(change.op) ? change.op : '';
    if (!op) return null;
    return {
        id: itemId(change.id, 'memory-change', index),
        op,
        targetId: cleanText(change.targetId, 120),
        chapterNumber: chapterNumber(change.chapterNumber),
    };
}

export function normalizeLongDreamMemoryV2(memory = {}, fallbackDate = '') {
    return {
        schemaVersion: LONG_DREAM_MEMORY_SCHEMA_VERSION,
        states: (Array.isArray(memory.states) ? memory.states : []).map((item, index) => normalizeLongDreamMemoryState(item, index, fallbackDate)).filter(Boolean),
        transitions: (Array.isArray(memory.transitions) ? memory.transitions : []).map((item, index) => normalizeLongDreamMemoryTransition(item, index, fallbackDate)).filter(Boolean),
        threads: (Array.isArray(memory.threads) ? memory.threads : []).map((item, index) => normalizeLongDreamMemoryThread(item, index, fallbackDate)).filter(Boolean),
        deviations: (Array.isArray(memory.deviations) ? memory.deviations : []).map((item, index) => normalizeLongDreamMemoryDeviation(item, index, fallbackDate)).filter(Boolean),
        rejections: (Array.isArray(memory.rejections) ? memory.rejections : []).map((item, index) => normalizeRejection(item, index, fallbackDate)).filter(Boolean),
        pendingConflicts: (Array.isArray(memory.pendingConflicts) ? memory.pendingConflicts : []).map((item, index) => normalizeConflict(item, index, fallbackDate)).filter(Boolean),
        lastBatchChanges: (Array.isArray(memory.lastBatchChanges) ? memory.lastBatchChanges : []).map(normalizeBatchChange).filter(Boolean).slice(-100),
    };
}

function allowedChapter(raw, allowed, fallback) {
    const requested = Math.floor(Number(raw) || fallback);
    return allowed.has(requested) ? requested : fallback;
}

export function normalizeLongDreamMemoryOperation(raw, { pendingChapterNumbers = [] } = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const op = cleanText(raw.op, 60);
    if (!LONG_DREAM_MEMORY_OPERATION_TYPES.includes(op)) return null;
    const allowed = new Set((Array.isArray(pendingChapterNumbers) ? pendingChapterNumbers : []).map(Number));
    const fallback = [...allowed].at(-1) || chapterNumber(raw.chapterNumber);
    const base = {
        op,
        targetId: cleanText(raw.targetId, 120),
        chapterNumber: allowedChapter(raw.chapterNumber, allowed, fallback),
        quote: cleanText(raw.quote, 240),
        tags: memoryTags(raw.tags),
    };
    if (op === 'set_state') {
        const subjects = cleanList(raw.subjects || [raw.subject], 8);
        const value = cleanText(raw.value, 1200);
        const requested = cleanText(raw.attribute, 60);
        if (!subjects.length || !value) return null;
        return { ...base, subjects, attribute: LONG_DREAM_MEMORY_STATE_ATTRIBUTES.includes(requested) ? requested : 'other', topic: cleanText(raw.topic, 160), value };
    }
    if (op === 'append_transition') {
        const subjects = cleanList(raw.subjects || [raw.subject], 8);
        const to = cleanText(raw.to, 1200);
        const cause = cleanText(raw.cause, 1200);
        const requested = cleanText(raw.domain, 60);
        if (!subjects.length || (!to && !cause)) return null;
        return { ...base, domain: LONG_DREAM_MEMORY_TRANSITION_DOMAINS.includes(requested) ? requested : 'experience', subjects, from: cleanText(raw.from, 1200), to, cause, impact: cleanText(raw.impact, 1200) };
    }
    if (op === 'open_thread') {
        const threadKey = cleanText(raw.threadKey, 180);
        const content = cleanText(raw.content, 1200);
        const requested = cleanText(raw.kind, 60);
        if (!threadKey || !content) return null;
        return { ...base, threadKey, kind: LONG_DREAM_MEMORY_THREAD_KINDS.includes(requested) ? requested : 'foreshadow', subjects: cleanList(raw.subjects || [raw.subject], 8), content, progress: cleanText(raw.progress, 1200) };
    }
    if (op === 'advance_thread') {
        const threadKey = cleanText(raw.threadKey, 180);
        const progress = cleanText(raw.progress, 1200);
        if ((!base.targetId && !threadKey) || !progress) return null;
        return { ...base, threadKey, progress };
    }
    if (op === 'resolve_thread') {
        const threadKey = cleanText(raw.threadKey, 180);
        const resolution = cleanText(raw.resolution, 1200);
        if ((!base.targetId && !threadKey) || !resolution) return null;
        return { ...base, threadKey, resolution };
    }
    if (op === 'abandon_thread') {
        const threadKey = cleanText(raw.threadKey, 180);
        const reason = cleanText(raw.reason, 1200);
        if ((!base.targetId && !threadKey) || !reason) return null;
        return { ...base, threadKey, reason };
    }
    const deviationKey = cleanText(raw.deviationKey, 180);
    const dreamChange = cleanText(raw.dreamChange, 1600);
    if (!deviationKey || !dreamChange) return null;
    return {
        ...base,
        deviationKey,
        subjects: cleanList(raw.subjects || [raw.subject], 8),
        originalCanon: cleanText(raw.originalCanon, 1600),
        dreamChange,
        directConsequences: cleanList(raw.directConsequences, 20, 500),
        invalidatedAssumptions: cleanList(raw.invalidatedAssumptions, 20, 500),
    };
}

function operationSignature(operation) {
    if (operation.op === 'set_state') return `state\u0000${stateSlotKey(operation.subjects, operation.attribute, operation.topic)}\u0000${canonicalText(operation.value)}`;
    if (operation.op === 'append_transition') return `transition\u0000${operation.subjects.map(canonicalText).sort().join('|')}\u0000${canonicalText(operation.domain)}\u0000${canonicalText(operation.from)}\u0000${canonicalText(operation.to)}\u0000${canonicalText(operation.cause)}`;
    if (operation.op.includes('thread')) return `thread\u0000${canonicalText(operation.threadKey)}`;
    return `deviation\u0000${canonicalText(operation.deviationKey)}`;
}

function rejected(memory, operation) {
    const signature = operationSignature(operation);
    return (memory.rejections || []).some(item => (operation.targetId && item.targetId === operation.targetId)
        || item.signature === signature
        || (operation.op.includes('thread') && item.kind === 'thread' && signature.startsWith(item.signature))
        || (operation.op === 'upsert_deviation' && item.kind === 'deviation' && signature.startsWith(item.signature)));
}

function generatedId(prefix, operation, index) {
    return `${prefix}-${operation.chapterNumber}-${Date.now().toString(36)}-${index + 1}`;
}

function conflictFor(operation, reason, targetId, now, index) {
    return normalizeConflict({
        id: `memory-conflict-${Date.now().toString(36)}-${index + 1}`,
        reason,
        targetId,
        operation,
        chapterNumber: operation.chapterNumber,
        createdAt: now,
    }, index, now);
}

function appendUniqueProgress(thread, operation, index) {
    const progress = normalizeThreadProgress({
        id: `thread-progress-${operation.chapterNumber}-${index + 1}`,
        chapterNumber: operation.chapterNumber,
        content: operation.progress,
        quote: operation.quote,
    }, index);
    const duplicate = thread.progressHistory.some(item => item.chapterNumber === progress.chapterNumber
        && canonicalText(item.content) === canonicalText(progress.content));
    return duplicate ? thread.progressHistory : [...thread.progressHistory, progress].slice(-100);
}

export function applyLongDreamMemoryOperations(memoryInput = {}, operationsInput = [], {
    worldLineRelation = 'isolated',
    now = new Date(),
} = {}) {
    const updatedAt = normalizedDate(now);
    const memory = normalizeLongDreamMemoryV2(memoryInput, updatedAt);
    const states = memory.states.slice();
    const transitions = memory.transitions.slice();
    const threads = memory.threads.slice();
    const deviations = memory.deviations.slice();
    const conflicts = memory.pendingConflicts.slice();
    const appliedChanges = [];
    const ignoredOperations = [];
    const rawOperations = Array.isArray(operationsInput) ? operationsInput : [];
    const pendingChapterNumbers = rawOperations.map(operation => Math.floor(Number(operation?.chapterNumber))).filter(number => number >= 1);
    const operations = rawOperations
        .map((operation, index) => ({ operation: normalizeLongDreamMemoryOperation(operation, { pendingChapterNumbers }), index }))
        .sort((a, b) => Number(a.operation?.chapterNumber) - Number(b.operation?.chapterNumber) || a.index - b.index);

    const addConflict = (operation, reason, targetId, index) => {
        conflicts.push(conflictFor(operation, reason, targetId, updatedAt, conflicts.length + index));
    };
    const changed = (operation, targetId, index) => appliedChanges.push({
        id: `memory-change-${Date.now().toString(36)}-${index + 1}`,
        op: operation.op,
        targetId,
        chapterNumber: operation.chapterNumber,
    });

    for (const { operation, index } of operations) {
        if (!operation || !LONG_DREAM_MEMORY_OPERATION_TYPES.includes(operation.op)) {
            ignoredOperations.push({ index, reason: 'invalid-operation' });
            continue;
        }
        if (rejected(memory, operation)) {
            addConflict(operation, 'rejected-by-user', operation.targetId, index);
            continue;
        }
        if (operation.op === 'set_state') {
            const slot = stateSlotKey(operation.subjects, operation.attribute, operation.topic);
            const targetIndex = operation.targetId
                ? states.findIndex(item => item.id === operation.targetId)
                : states.findIndex(item => stateSlotKey(item.subjects, item.attribute, item.topic) === slot);
            if (operation.targetId && targetIndex < 0) {
                addConflict(operation, 'missing-target', operation.targetId, index);
                continue;
            }
            if (targetIndex < 0) {
                const state = normalizeLongDreamMemoryState({
                    id: generatedId('state', operation, index),
                    ...operation,
                    validFromChapter: operation.chapterNumber,
                    sourceChapterNumbers: [operation.chapterNumber],
                    updatedAt,
                }, states.length, updatedAt);
                states.push(state);
                changed(operation, state.id, index);
                continue;
            }
            const previous = states[targetIndex];
            if (previous.lockedByUser && canonicalText(previous.value) !== canonicalText(operation.value)) {
                addConflict(operation, 'locked-by-user', previous.id, index);
                continue;
            }
            if (canonicalText(previous.value) === canonicalText(operation.value)) {
                states[targetIndex] = normalizeLongDreamMemoryState({
                    ...previous,
                    sourceChapterNumbers: [...previous.sourceChapterNumbers, operation.chapterNumber],
                    tags: [...previous.tags, ...operation.tags],
                    quote: operation.quote || previous.quote,
                    updatedAt,
                }, targetIndex, updatedAt);
            } else {
                const history = [...previous.history, {
                    id: `state-history-${previous.id}-${previous.validFromChapter}`,
                    value: previous.value,
                    fromChapter: previous.validFromChapter,
                    toChapter: Math.max(previous.validFromChapter, operation.chapterNumber),
                    sourceChapterNumbers: previous.sourceChapterNumbers,
                    quote: previous.quote,
                    editedByUser: previous.editedByUser,
                }];
                states[targetIndex] = normalizeLongDreamMemoryState({
                    ...previous,
                    subjects: operation.subjects,
                    attribute: operation.attribute,
                    topic: operation.topic,
                    value: operation.value,
                    validFromChapter: operation.chapterNumber,
                    sourceChapterNumbers: [operation.chapterNumber],
                    quote: operation.quote,
                    history,
                    tags: [...previous.tags, ...operation.tags],
                    editedByUser: false,
                    lockedByUser: false,
                    updatedAt,
                }, targetIndex, updatedAt);
            }
            changed(operation, previous.id, index);
            continue;
        }
        if (operation.op === 'append_transition') {
            const signature = operationSignature(operation);
            const duplicateIndex = transitions.findIndex(item => operationSignature({ op: 'append_transition', ...item }) === signature);
            if (duplicateIndex >= 0) {
                const previous = transitions[duplicateIndex];
                transitions[duplicateIndex] = normalizeLongDreamMemoryTransition({
                    ...previous,
                    sourceChapterNumbers: [...previous.sourceChapterNumbers, operation.chapterNumber],
                    tags: [...previous.tags, ...operation.tags],
                    quote: operation.quote || previous.quote,
                    updatedAt,
                }, duplicateIndex, updatedAt);
                changed(operation, previous.id, index);
            } else {
                const transition = normalizeLongDreamMemoryTransition({
                    id: generatedId('transition', operation, index),
                    ...operation,
                    sourceChapterNumbers: [operation.chapterNumber],
                    updatedAt,
                }, transitions.length, updatedAt);
                transitions.push(transition);
                changed(operation, transition.id, index);
            }
            continue;
        }
        if (operation.op === 'open_thread') {
            const targetIndex = operation.targetId
                ? threads.findIndex(item => item.id === operation.targetId)
                : threads.findIndex(item => canonicalText(item.threadKey) === canonicalText(operation.threadKey));
            if (operation.targetId && targetIndex < 0) {
                addConflict(operation, 'missing-target', operation.targetId, index);
                continue;
            }
            if (targetIndex >= 0) {
                const previous = threads[targetIndex];
                if (['resolved', 'abandoned'].includes(previous.status)) {
                    addConflict(operation, 'closed-thread', previous.id, index);
                    continue;
                }
                if (previous.lockedByUser) {
                    addConflict(operation, 'locked-by-user', previous.id, index);
                    continue;
                }
                const progressHistory = operation.progress ? appendUniqueProgress(previous, operation, index) : previous.progressHistory;
                threads[targetIndex] = normalizeLongDreamMemoryThread({
                    ...previous,
                    content: operation.content || previous.content,
                    progress: operation.progress || previous.progress,
                    progressHistory,
                    status: operation.progress ? 'progressed' : previous.status,
                    lastTouchedAt: operation.chapterNumber,
                    sourceChapterNumbers: [...previous.sourceChapterNumbers, operation.chapterNumber],
                    tags: [...previous.tags, ...operation.tags],
                    quote: operation.quote || previous.quote,
                    updatedAt,
                }, targetIndex, updatedAt);
                changed(operation, previous.id, index);
            } else {
                const progressHistory = operation.progress ? [{ chapterNumber: operation.chapterNumber, content: operation.progress, quote: operation.quote }] : [];
                const thread = normalizeLongDreamMemoryThread({
                    id: generatedId('thread', operation, index),
                    ...operation,
                    status: operation.progress ? 'progressed' : 'open',
                    introducedAt: operation.chapterNumber,
                    lastTouchedAt: operation.chapterNumber,
                    progressHistory,
                    sourceChapterNumbers: [operation.chapterNumber],
                    updatedAt,
                }, threads.length, updatedAt);
                threads.push(thread);
                changed(operation, thread.id, index);
            }
            continue;
        }
        if (['advance_thread', 'resolve_thread', 'abandon_thread'].includes(operation.op)) {
            const targetIndex = operation.targetId
                ? threads.findIndex(item => item.id === operation.targetId)
                : threads.findIndex(item => canonicalText(item.threadKey) === canonicalText(operation.threadKey));
            if (targetIndex < 0) {
                addConflict(operation, 'missing-target', operation.targetId, index);
                continue;
            }
            const previous = threads[targetIndex];
            if (!operation.threadKey) operation.threadKey = previous.threadKey;
            if (previous.lockedByUser) {
                addConflict(operation, 'locked-by-user', previous.id, index);
                continue;
            }
            if (['resolved', 'abandoned'].includes(previous.status)) {
                addConflict(operation, 'closed-thread', previous.id, index);
                continue;
            }
            const changes = {
                ...previous,
                lastTouchedAt: operation.chapterNumber,
                sourceChapterNumbers: [...previous.sourceChapterNumbers, operation.chapterNumber],
                tags: [...previous.tags, ...operation.tags],
                quote: operation.quote || previous.quote,
                updatedAt,
            };
            if (operation.op === 'advance_thread') {
                changes.status = 'progressed';
                changes.progress = operation.progress;
                changes.progressHistory = appendUniqueProgress(previous, operation, index);
            } else if (operation.op === 'resolve_thread') {
                changes.status = 'resolved';
                changes.resolvedAt = operation.chapterNumber;
                changes.resolution = operation.resolution;
            } else {
                changes.status = 'abandoned';
                changes.resolvedAt = operation.chapterNumber;
                changes.abandonedReason = operation.reason;
            }
            threads[targetIndex] = normalizeLongDreamMemoryThread(changes, targetIndex, updatedAt);
            changed(operation, previous.id, index);
            continue;
        }
        if (worldLineRelation === 'isolated') {
            ignoredOperations.push({ index, reason: 'isolated-worldline', op: operation.op });
            continue;
        }
        const targetIndex = operation.targetId
            ? deviations.findIndex(item => item.id === operation.targetId)
            : deviations.findIndex(item => canonicalText(item.deviationKey) === canonicalText(operation.deviationKey));
        if (operation.targetId && targetIndex < 0) {
            addConflict(operation, 'missing-target', operation.targetId, index);
            continue;
        }
        if (targetIndex >= 0) {
            const previous = deviations[targetIndex];
            if (previous.lockedByUser) {
                addConflict(operation, 'locked-by-user', previous.id, index);
                continue;
            }
            deviations[targetIndex] = normalizeLongDreamMemoryDeviation({
                ...previous,
                ...operation,
                id: previous.id,
                sourceChapterNumbers: [...previous.sourceChapterNumbers, operation.chapterNumber],
                directConsequences: [...previous.directConsequences, ...operation.directConsequences],
                invalidatedAssumptions: [...previous.invalidatedAssumptions, ...operation.invalidatedAssumptions],
                tags: [...previous.tags, ...operation.tags],
                quote: operation.quote || previous.quote,
                updatedAt,
            }, targetIndex, updatedAt);
            changed(operation, previous.id, index);
        } else {
            const deviation = normalizeLongDreamMemoryDeviation({
                id: generatedId('deviation', operation, index),
                ...operation,
                sourceChapterNumbers: [operation.chapterNumber],
                updatedAt,
            }, deviations.length, updatedAt);
            deviations.push(deviation);
            changed(operation, deviation.id, index);
        }
    }

    return {
        memory: {
            ...memory,
            states,
            transitions,
            threads,
            deviations,
            pendingConflicts: conflicts,
            lastBatchChanges: appliedChanges,
        },
        conflicts: conflicts.slice(memory.pendingConflicts.length),
        ignoredOperations,
        appliedChanges,
    };
}

export function memoryItemRejectionSignature(kind, item = {}) {
    if (kind === 'state') return `state\u0000${stateSlotKey(item.subjects, item.attribute, item.topic)}\u0000${canonicalText(item.value)}`;
    if (kind === 'transition') return operationSignature({ op: 'append_transition', ...item });
    if (kind === 'thread') return `thread\u0000${canonicalText(item.threadKey)}`;
    if (kind === 'deviation') return `deviation\u0000${canonicalText(item.deviationKey)}`;
    return `legacy\u0000${canonicalText(item.content)}`;
}

export function updateLongDreamMemoryV2Item(memoryInput, kind, itemIdValue, changes = {}, now = new Date()) {
    const memory = normalizeLongDreamMemoryV2(memoryInput);
    const map = { state: 'states', transition: 'transitions', thread: 'threads', deviation: 'deviations' };
    const key = map[kind];
    if (!key) throw new Error('未知梦脉类型');
    const list = memory[key].slice();
    const index = list.findIndex(item => String(item.id) === String(itemIdValue));
    if (index < 0) throw new Error('没有找到要修改的梦脉');
    const updatedAt = normalizedDate(now);
    const merged = {
        ...list[index],
        ...changes,
        id: list[index].id,
        editedByUser: true,
        lockedByUser: changes.lockedByUser === false ? false : true,
        updatedAt,
    };
    const normalizers = {
        state: normalizeLongDreamMemoryState,
        transition: normalizeLongDreamMemoryTransition,
        thread: normalizeLongDreamMemoryThread,
        deviation: normalizeLongDreamMemoryDeviation,
    };
    const next = normalizers[kind](merged, index, updatedAt);
    if (!next) throw new Error('梦脉内容不能为空');
    list[index] = next;
    return { ...memory, [key]: list };
}

export function setLongDreamMemoryV2ItemHidden(memoryInput, kind, itemIdValue, hidden = true, now = new Date()) {
    const memory = normalizeLongDreamMemoryV2(memoryInput);
    const map = { state: 'states', transition: 'transitions', thread: 'threads', deviation: 'deviations' };
    const key = map[kind];
    if (!key) throw new Error('未知梦脉类型');
    const list = memory[key].slice();
    const index = list.findIndex(item => String(item.id) === String(itemIdValue));
    if (index < 0) throw new Error('没有找到要处理的梦脉');
    list[index] = { ...list[index], hiddenFromPrompt: hidden === true, updatedAt: normalizedDate(now) };
    return { ...memory, [key]: list };
}

export function rejectLongDreamMemoryV2Item(memoryInput, kind, itemIdValue, reason = '', now = new Date()) {
    const memory = normalizeLongDreamMemoryV2(memoryInput);
    const map = { state: 'states', transition: 'transitions', thread: 'threads', deviation: 'deviations' };
    const key = map[kind];
    if (!key) throw new Error('未知梦脉类型');
    const item = memory[key].find(entry => String(entry.id) === String(itemIdValue));
    if (!item) throw new Error('没有找到要否定的梦脉');
    const createdAt = normalizedDate(now);
    const signature = memoryItemRejectionSignature(kind, item);
    const rejections = memory.rejections.some(entry => entry.kind === kind && entry.signature === signature)
        ? memory.rejections
        : [...memory.rejections, normalizeRejection({
            id: `rejection-${Date.now().toString(36)}-${memory.rejections.length + 1}`,
            kind,
            signature,
            targetId: item.id,
            reason,
            createdAt,
        }, memory.rejections.length, createdAt)];
    return {
        ...memory,
        [key]: memory[key].filter(entry => entry.id !== item.id),
        rejections,
    };
}

export function resolveLongDreamMemoryConflict(memoryInput, conflictId, action = 'keep', {
    worldLineRelation = 'isolated',
    now = new Date(),
} = {}) {
    let memory = normalizeLongDreamMemoryV2(memoryInput);
    const conflict = memory.pendingConflicts.find(item => String(item.id) === String(conflictId));
    if (!conflict) throw new Error('没有找到要处理的梦脉冲突');
    const remaining = memory.pendingConflicts.filter(item => item.id !== conflict.id);
    const operation = conflict.operation;
    const signature = operationSignature(operation);
    if (action === 'keep') {
        const kind = operation.op === 'set_state'
            ? 'state'
            : (operation.op === 'append_transition' ? 'transition' : (operation.op.includes('thread') ? 'thread' : 'deviation'));
        const createdAt = normalizedDate(now);
        const rejections = memory.rejections.some(item => item.kind === kind && item.signature === signature)
            ? memory.rejections
            : [...memory.rejections, normalizeRejection({
                id: `rejection-${Date.now().toString(36)}-${memory.rejections.length + 1}`,
                kind,
                signature,
                targetId: conflict.targetId,
                reason: '用户在冲突处理中保留原记忆',
                createdAt,
            }, memory.rejections.length, createdAt)];
        return { ...memory, pendingConflicts: remaining, rejections };
    }
    if (action !== 'accept') return { ...memory, pendingConflicts: remaining };

    const targetId = conflict.targetId || operation.targetId;
    const collection = operation.op === 'set_state'
        ? 'states'
        : (operation.op.includes('thread') ? 'threads' : (operation.op === 'upsert_deviation' ? 'deviations' : 'transitions'));
    const list = memory[collection].map(item => item.id === targetId ? { ...item, lockedByUser: false } : item);
    if (collection === 'threads') {
        const index = list.findIndex(item => item.id === targetId);
        if (index >= 0 && ['resolved', 'abandoned'].includes(list[index].status)) {
            list[index] = {
                ...list[index],
                status: 'open',
                resolvedAt: null,
                resolution: '',
                abandonedReason: '',
            };
        }
    }
    memory = {
        ...memory,
        [collection]: list,
        pendingConflicts: remaining,
        rejections: memory.rejections.filter(item => item.signature !== signature),
    };
    if (conflict.reason === 'missing-target' && !list.some(item => item.id === targetId)) {
        if (!['set_state', 'open_thread', 'upsert_deviation'].includes(operation.op)) {
            throw new Error('这项变更引用的旧记忆已经不存在，无法自动采用');
        }
        operation.targetId = '';
    }
    return applyLongDreamMemoryOperations(memory, [operation], { worldLineRelation, now }).memory;
}
