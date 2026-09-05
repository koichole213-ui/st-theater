// 普通续写的临时会话：关弹窗不销毁，退出续写或刷新酒馆后结束。
// 前情在创建会话时固定；重写只追加候选，只有显式“接着这一版”才建下一段。
export function createContinuationSession({ sourceText, sourceLabel = '当前小剧场', segment = 1, direction = '' } = {}) {
    const text = String(sourceText || '').trim();
    if (!text) return null;
    return {
        source: Object.freeze({ text, label: String(sourceLabel || '当前小剧场') }),
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
