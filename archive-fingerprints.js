import { newHistoryKey } from './history-collections.js';

const DEVICE_KEY = 'st-theater-archive-device';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const countsFor = value => ({ history: count(value.history), dreams: count(value.dreams) });
const total = ({ history, dreams }) => history + dreams;
const persistentToast = { timeOut: 0, extendedTimeOut: 0, closeButton: true };

export function archiveLossMessage({ expected, found }) {
    const decreases = [
        found.history < expected.history && `普通历史从 ${expected.history} 条变成了 ${found.history} 条`,
        found.dreams < expected.dreams && `长梦从 ${expected.dreams} 部变成了 ${found.dreams} 部`,
    ].filter(Boolean);
    return `这个浏览器里的${decreases.join('、')}，疑似被浏览器清理（例如磁盘空间不足）。请检查作品并从备份恢复；不要清理站点数据。`;
}

// 同一个网址可能在电脑和手机上各开一份，作品各存各的。数量基准按“网址 + 这个浏览器”分开记，
// 浏览器编号放在 localStorage：浏览器回收空间时通常只清作品库（IndexedDB），这个编号还在，仍能发现丢失。
// 读不到 localStorage 时退回只按网址记（和以前一样）。
function readDeviceId(storage) {
    try {
        const store = storage === undefined ? globalThis.localStorage : storage;
        if (!store) return '';
        const saved = store.getItem(DEVICE_KEY);
        if (/^[a-zA-Z0-9-]{8,64}$/.test(saved || '')) return saved;
        const created = newHistoryKey();
        store.setItem(DEVICE_KEY, created);
        return store.getItem(DEVICE_KEY) === created ? created : '';
    } catch {
        return '';
    }
}
const addressOf = key => String(key).split('#')[0];

function lossReason(expected, found) {
    if (expected.history > 0 && found.history === 0) return 'history-zero';
    if (expected.dreams > 0 && found.dreams === 0) return 'dreams-zero';
    const dropped = total(expected) - total(found);
    return dropped >= 10 && dropped > total(expected) / 2 ? 'large-drop' : null;
}

export function createArchiveSafety(runtime, { origin = globalThis.location?.origin, toast = globalThis.toastr, deviceStorage } = {}) {
    let lossToast;
    const device = origin ? readDeviceId(deviceStorage) : '';
    const key = device ? `${origin}#${device}` : origin;
    const fingerprints = () => runtime.settings.archiveFingerprints || {};
    const canCount = () => !!origin && !!runtime.idb && !runtime.archiveStale && !runtime.archiveClosed
        && !Object.values(runtime.storageReadErrors || {}).some(Boolean);
    const measure = () => ({
        history: runtime.historyCache.length,
        dreams: runtime.longDreamCache.length,
        chapters: runtime.longDreamCache.reduce((sum, dream) => sum + (dream.chapters?.length || 0), 0),
    });
    function saveFingerprint(value) {
        const forcedClose = fingerprints()[key]?.forcedClose;
        const entries = Object.entries(fingerprints()).filter(([name]) => name !== key);
        entries.sort(([, a], [, b]) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
        runtime.settings.archiveFingerprints = Object.fromEntries([
            [key, { ...(forcedClose ? { forcedClose } : {}), ...value, updatedAt: new Date().toISOString() }],
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
    // 更新前只按网址记的旧告警：只有当时触发告警的那个浏览器（现有数量和告警里记下的完全一致）才接着提醒。
    function legacyAlarm(found) {
        if (key === origin) return undefined;
        const legacy = fingerprints()[origin];
        const seen = legacy?.lossSuspected?.found;
        return seen && count(seen.history) === found.history && count(seen.dreams) === found.dreams ? legacy : undefined;
    }
    function inspect() {
        if (!canCount()) return;
        const current = measure();
        const found = countsFor(current);
        const known = fingerprints()[key] || legacyAlarm(found);
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
                const summary = others.map(([name, value]) => `${addressOf(name)}：普通历史 ${count(value.history)} 条、长梦 ${count(value.dreams)} 部`).join('；');
                toast?.info?.(`其他设备或地址上有作品记录（${summary}），本页是新的浏览器存储。`, '小剧场存档', { escapeHtml: true });
            }
        }
        saveFingerprint(current);
    }
    function record({ restored = false } = {}) {
        if (!canCount()) return;
        const known = fingerprints()[key];
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
        const incident = fingerprints()[key]?.lossSuspected;
        if (!canCount() || !incident || !await confirm() || !canCount()
            || fingerprints()[key]?.lossSuspected !== incident) return false;
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
    function recordForcedClose(forcedClose) {
        if (!origin) return;
        const known = fingerprints()[key];
        saveFingerprint({ ...(known || forcedClose), forcedClose });
    }
    return { inspect, record, confirmCurrent, inspectProtection, protectionDiagnostic, lossMessage: archiveLossMessage,
        recordForcedClose, lastForcedClose: () => fingerprints()[key]?.forcedClose };
}
