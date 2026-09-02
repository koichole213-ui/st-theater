import { REQUEST_DIAGNOSTIC_SIGNAL } from './request-diagnostics.js';
import { TAG_UNCATEGORIZED, itemTags, matchesTagFilter, normalizeTagFilter } from './tag-system.js';

function cleanText(value) {
    return String(value || '').trim();
}

export function resolveAutoInstruction({
    source = '__last__',
    lastInstruction = '',
    lastTags = [],
    templates = [],
    tags = [],
    tagFilter = [],
    random = Math.random,
} = {}) {
    const selectedSource = String(source || '__last__');
    if (selectedSource === '__last__') {
        const text = cleanText(lastInstruction);
        return {
            text,
            tags: text ? itemTags({ tags: lastTags }, tags) : [],
            source: selectedSource,
            candidateCount: text ? 1 : 0,
            signal: text ? null : REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
        };
    }

    const usable = (Array.isArray(templates) ? templates : []).filter(template => cleanText(template?.content));
    if (![TAG_UNCATEGORIZED, '__all__', '__tags__'].includes(selectedSource)) {
        return { text: '', tags: [], source: selectedSource, candidateCount: 0, signal: REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION };
    }
    const selectedTags = selectedSource === TAG_UNCATEGORIZED
        ? [TAG_UNCATEGORIZED]
        : (selectedSource === '__tags__' ? normalizeTagFilter(tagFilter, tags) : []);
    const pool = selectedSource === '__all__'
        ? usable
        : usable.filter(template => matchesTagFilter(template, selectedTags, tags));
    if (!pool.length || (selectedSource === '__tags__' && !selectedTags.length)) {
        return {
            text: '',
            tags: [],
            source: selectedSource,
            candidateCount: 0,
            signal: REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
        };
    }
    const rawIndex = Math.floor(Number(random?.()) * pool.length);
    const index = Math.max(0, Math.min(pool.length - 1, Number.isFinite(rawIndex) ? rawIndex : 0));
    return {
        text: cleanText(pool[index]?.content),
        tags: itemTags(pool[index], tags),
        source: selectedSource,
        candidateCount: pool.length,
        signal: null,
    };
}

export function autoSourceLabel(source, tags = [], tagFilter = []) {
    const selectedSource = String(source || '__last__');
    if (selectedSource === '__last__') return '上次使用的指令';
    if (selectedSource === '__all__') return '随机·全部模板';
    if (selectedSource === TAG_UNCATEGORIZED) return '随机·未分类模板';
    if (selectedSource === '__tags__') {
        const selected = normalizeTagFilter(tagFilter, tags);
        return selected.length ? `随机·${selected.join('＋')}` : '随机·尚未选择标签';
    }
    return '随机·已失效来源';
}
