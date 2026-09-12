// 两轮按时间排列；没有可恢复的轮次记录时，由调用方提供当前完整正文。
export function normalizeContinuationRounds(values) {
    return (Array.isArray(values) ? values : []).filter(value => typeof value === 'string')
        .map(value => value.trim()).filter(Boolean).slice(-2);
}

export function continuationRoundHistory(sourceRounds = [], newRounds = []) {
    return normalizeContinuationRounds([...normalizeContinuationRounds(sourceRounds), ...normalizeContinuationRounds(newRounds)]);
}

// 普通续写的临时会话：关弹窗不销毁，退出续写或刷新酒馆后结束。
// 前情在创建会话时固定；重写只追加候选，只有显式“接着这一版”才建下一段。
export function createContinuationSession({ sourceText, sourceRounds = [], sourceLabel = '当前小剧场', segment = 1, direction = '' } = {}) {
    const rounds = normalizeContinuationRounds(sourceRounds);
    if (!rounds.length && String(sourceText || '').trim()) rounds.push(String(sourceText).trim());
    const text = rounds.join('\n\n');
    if (!text) return null;
    return {
        source: Object.freeze({ text, rounds: Object.freeze(rounds), label: String(sourceLabel || '当前小剧场') }),
        segment: Math.max(1, Number(segment) || 1),
        direction: String(direction || ''),
        versions: [],
        selected: -1,
    };
}

export function appendContinuationVersion(session, version) {
    if (!session || !String(version?.html || '').trim()) return null;
    const saved = { ...version, direction: String(version.direction ?? session.direction), complete: version.complete !== false };
    session.versions.push(saved);
    session.selected = session.versions.length - 1;
    return saved;
}

export function selectContinuationVersion(session, index) {
    if (!session || !Number.isInteger(index) || index < 0 || index >= session.versions.length) return null;
    session.selected = index;
    const version = session.versions[index];
    session.direction = version.direction;
    return version;
}

export function displayedContinuationVersion(session, html) {
    if (!session || !html) return null;
    const selected = session.versions[session.selected];
    if (selected?.html === html) return selected;
    return session.versions.find(version => version.html === html) || null;
}
