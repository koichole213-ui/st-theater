import { REQUEST_DIAGNOSTIC_SIGNAL } from './request-diagnostics.js';

function cleanText(value) {
    return String(value || '').trim();
}

function templateGroup(template, groups) {
    const group = cleanText(template?.group);
    return (Array.isArray(groups) && groups.includes(group)) ? group : '';
}

export function resolveAutoInstruction({
    source = '__last__',
    lastInstruction = '',
    templates = [],
    groups = [],
    random = Math.random,
} = {}) {
    const selectedSource = String(source || '__last__');
    if (selectedSource === '__last__') {
        const text = cleanText(lastInstruction);
        return {
            text,
            source: selectedSource,
            candidateCount: text ? 1 : 0,
            signal: text ? null : REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
        };
    }

    const usable = (Array.isArray(templates) ? templates : []).filter(template => cleanText(template?.content));
    let pool = usable;
    if (selectedSource === '__none__') pool = usable.filter(template => !templateGroup(template, groups));
    else if (selectedSource !== '__all__') pool = usable.filter(template => templateGroup(template, groups) === selectedSource);
    if (!pool.length) {
        return {
            text: '',
            source: selectedSource,
            candidateCount: 0,
            signal: REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
        };
    }
    const rawIndex = Math.floor(Number(random?.()) * pool.length);
    const index = Math.max(0, Math.min(pool.length - 1, Number.isFinite(rawIndex) ? rawIndex : 0));
    return {
        text: cleanText(pool[index]?.content),
        source: selectedSource,
        candidateCount: pool.length,
        signal: null,
    };
}

export function autoSourceLabel(source, groups = []) {
    const selectedSource = String(source || '__last__');
    if (selectedSource === '__last__') return '上次使用的指令';
    if (selectedSource === '__all__') return '随机·全部模板';
    if (selectedSource === '__none__') return '随机·未分组模板';
    return (Array.isArray(groups) && groups.includes(selectedSource)) ? `随机·${selectedSource}` : '随机·已失效分组';
}
