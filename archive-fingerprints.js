const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const countsFor = value => ({ history: count(value.history), dreams: count(value.dreams) });
const total = ({ history, dreams }) => history + dreams;
const persistentToast = { timeOut: 0, extendedTimeOut: 0, closeButton: true };

export function archiveLossMessage({ expected, found }) {
    const decreases = [
        found.history < expected.history && `普通历史从 ${expected.history} 条变成了 ${found.history} 条`,
        found.dreams < expected.dreams && `长梦从 ${expected.dreams} 部变成了 ${found.dreams} 部`,
    ].filter(Boolean);
    return `本地址的${decreases.join('、')}，疑似被浏览器清理（例如磁盘空间不足）。请检查作品并从备份恢复；不要清理站点数据。`;
}

function lossReason(expected, found) {
    if (expected.history > 0 && found.history === 0) return 'history-zero';
    if (expected.dreams > 0 && found.dreams === 0) return 'dreams-zero';
    const dropped = total(expected) - total(found);
    return dropped >= 10 && dropped > total(expected) / 2 ? 'large-drop' : null;
}

export function createArchiveSafety(runtime, { origin = globalThis.location?.origin, toast = globalThis.toastr } = {}) {
    let lossToast;
    const fingerprints = () => runtime.settings.archiveFingerprints || {};
    const canCount = () => !!origin && !!runtime.idb && !runtime.archiveStale
        && !Object.values(runtime.storageReadErrors || {}).some(Boolean);
    const measure = () => ({
        history: runtime.historyCache.length,
        dreams: runtime.longDreamCache.length,
        chapters: runtime.longDreamCache.reduce((sum, dream) => sum + (dream.chapters?.length || 0), 0),
    });
    function saveFingerprint(value) {
        const entries = Object.entries(fingerprints()).filter(([key]) => key !== origin);
        entries.sort(([, a], [, b]) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
        runtime.settings.archiveFingerprints = Object.fromEntries([
            [origin, { ...value, updatedAt: new Date().toISOString() }],
            ...entries.slice(0, 19),
        ]);
        runtime.save();
    }
    function clearLoss(current) {
        saveFingerprint(current);
        runtime.archiveLossSuspected = null;
        if (lossToast) toast?.clear?.(lossToast);
        lossToast = undefined;
    }
    function clearRecovered(incident, current, found) {
        const { expected } = incident;
        if (found.history < expected.history || found.dreams < expected.dreams) return false;
        clearLoss(current);
        runtime.runtimeLog?.('info', '存档数量已恢复，解除疑似丢失告警', { expected, found });
        return true;
    }
    function showLoss(known, incident) {
        runtime.archiveLossSuspected = incident;
        saveFingerprint({ ...known, lossSuspected: incident });
        if (lossToast) toast?.clear?.(lossToast);
        lossToast = toast?.warning?.(archiveLossMessage(incident), '小剧场存档疑似丢失', persistentToast);
    }
    function inspect() {
        if (!canCount()) return;
        const known = fingerprints()[origin];
        const current = measure();
        const found = countsFor(current);
        if (known) {
            if (known.lossSuspected) {
                if (!clearRecovered(known.lossSuspected, current, found)) showLoss(known, { ...known.lossSuspected, found });
                return;
            }
            const expected = countsFor(known);
            const reason = lossReason(expected, found);
            if (reason) {
                const version = runtime.VERSION || '';
                const incident = { expected, found, since: new Date().toISOString(), reason, version };
                showLoss(known, incident);
                runtime.runtimeLog?.('warn', '存档疑似丢失：触发', { expected, found, version, reason });
                return;
            }
        } else if (total(found) === 0) {
            const others = Object.entries(fingerprints()).filter(([, value]) => value && total(countsFor(value)) > 0);
            if (others.length) {
                const summary = others.map(([address, value]) => `${address}：普通历史 ${count(value.history)} 条、长梦 ${count(value.dreams)} 部`).join('；');
                toast?.info?.(`其他设备或地址上有作品记录（${summary}），本页是新的浏览器存储。`, '小剧场存档', { escapeHtml: true });
            }
        }
        saveFingerprint(current);
    }
    function record({ restored = false } = {}) {
        if (!canCount()) return;
        const known = fingerprints()[origin];
        const incident = known?.lossSuspected;
        const current = measure();
        if (!incident) {
            saveFingerprint(current);
            return;
        }
        const found = countsFor(current);
        if (clearRecovered(incident, current, found)) return;
        if (restored || !runtime.archiveLossSuspected
            || found.history !== incident.found?.history || found.dreams !== incident.found?.dreams) {
            showLoss(known, { ...incident, found });
        }
    }
    async function confirmCurrent(confirm) {
        const incident = fingerprints()[origin]?.lossSuspected;
        if (!canCount() || !incident || !await confirm() || !canCount()
            || fingerprints()[origin]?.lossSuspected !== incident) return false;
        clearLoss(measure());
        return true;
    }
    async function inspectProtection(secure = globalThis.isSecureContext, browser = globalThis.navigator) {
        let state = 'unknown';
        try {
            const storage = secure ? browser?.storage : undefined;
            if (typeof storage?.persist !== 'function') state = 'unavailable';
            else if (await storage.persisted()) state = 'granted';
            else {
                await storage.persist();
                state = await storage.persisted() ? 'granted' : 'denied';
            }
        } catch { /* Browser settings can prevent even reading the permission. */ }
        runtime.storageProtection = state;
        runtime.runtimeLog?.(state === 'granted' ? 'info' : 'warn', '站点数据保护', { state });
        return state;
    }
    function protectionDiagnostic() {
        if (runtime.storageProtection === 'granted') return { status: 'ok', detail: '已生效' };
        const unavailable = runtime.storageProtection === 'unavailable' && globalThis.isSecureContext !== true;
        const detail = '未生效：浏览器在磁盘空间不足时可能清理作品。'
            + (unavailable ? '当前是 HTTP 局域网地址，浏览器不提供这项保护。' : '')
            + '请开启 GitHub 定期备份。'
            + (runtime.backup?.hasAutomaticGithub?.() ? '' : '当前作品没有任何自动的异地备份。');
        return { status: 'warn', detail };
    }
    return { inspect, record, confirmCurrent, inspectProtection, protectionDiagnostic, lossMessage: archiveLossMessage };
}
