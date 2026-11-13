import { newHistoryKey } from './history-collections.js';
import { stableJson } from './backup-data.js';

const channelName = 'st-theater-archive';
const message = '另一个页面修改了作品存档，请刷新本页后再编辑；本页新生成的内容仍可复制。';
export const archiveRevision = record => Number.isSafeInteger(record?.revision) && record.revision >= 0 ? record.revision : 0;

export function createArchiveSync(runtime, { Channel = globalThis.window?.BroadcastChannel, toast = globalThis.toastr } = {}) {
    let channel, tabId;
    function markStale() {
        if (runtime.archiveStale) return;
        runtime.archiveStale = true;
        toast?.warning?.(message, '小剧场存档已更新', { timeOut: 0, extendedTimeOut: 0, closeButton: true });
    }
    function receive(data) {
        if (typeof data?.tabId === 'string' && data.tabId && data.tabId !== tabId && typeof data.kind === 'string') markStale();
    }
    function open() {
        if (tabId) return;
        tabId = newHistoryKey();
        if (typeof Channel === 'function') {
            try {
                channel = new Channel(channelName);
                channel.onmessage = event => receive(event.data);
                return;
            } catch { /* Try the storage event fallback. */ }
        }
        globalThis.window?.addEventListener('storage', event => {
            if (event.key !== channelName || !event.newValue) return;
            try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated data. */ }
        });
    }
    function publish(kind) {
        if (!tabId) return;
        const data = { tabId, kind };
        try {
            if (channel) channel.postMessage(data);
            else globalThis.localStorage?.setItem(channelName, JSON.stringify({ ...data, nonce: newHistoryKey() }));
        } catch { /* Notifications can be disabled. */ }
    }
    function allowWrite() {
        if (!runtime.archiveStale) return true;
        toast?.warning?.('请刷新本页后再保存；如有新正文，请先复制。');
        return false;
    }
    async function migrateResults(db, legacyCurrent, legacyRecent, request, transactionDone) {
        const tx = db.transaction('kv', 'readwrite');
        const done = transactionDone(tx);
        const kv = tx.objectStore('kv');
        try {
            const [current, recent, recovered] = await Promise.all(
                ['current-result', 'recent', 'backup-recovered-results'].map(key => request(kv.get(key))),
            );
            if (!allowWrite()) throw new Error('本页存档已过期，请刷新后重试迁移');
            const overflow = [];
            const nextCurrent = current === undefined ? legacyCurrent : current;
            const nextRecent = recent === undefined ? legacyRecent.slice(0, 3) : recent;
            if (current === undefined && legacyCurrent) kv.put(legacyCurrent, 'current-result');
            else if (legacyCurrent) overflow.push(legacyCurrent);
            if (recent === undefined && legacyRecent.length) {
                kv.put(nextRecent, 'recent');
                overflow.push(...legacyRecent.slice(3));
            } else overflow.push(...legacyRecent);
            const next = Array.isArray(recovered) ? [...recovered] : [];
            const signatures = new Set([nextCurrent, ...(nextRecent || []), ...next].filter(Boolean).map(stableJson));
            let changed = false;
            for (const result of overflow) {
                if (!result) continue;
                const signature = stableJson(result);
                if (signatures.has(signature)) continue;
                signatures.add(signature);
                next.push(result);
                changed = true;
            }
            if (changed) kv.put(next, 'backup-recovered-results');
        } catch (error) {
            try { tx.abort(); } catch { /* Transaction may already have ended. */ }
            await done.catch(() => {});
            throw error;
        }
        await done;
        publish('legacy-results');
    }
    return { open, publish, markStale, allowWrite, migrateResults, revision: archiveRevision,
        folderSignature: value => stableJson(value ?? null) };
}
