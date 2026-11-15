import { backupProtection, digest, MAX_BACKUP_BYTES } from './backup-data.js';
import { bytesToBase64 } from './backup-github.js';
import { newHistoryKey } from './history-collections.js';

export const SERVER_BACKUP_INDEX = 'st-theater-backup-index.json';
export const SERVER_BACKUP_GIB = 1024 ** 3;
const PREFIX = 'user/files/';
const notFound = Symbol('server backup file not found');
const fileNamePattern = /^st-theater-backup-[a-zA-Z0-9_.-]+\.zip$/;

export function serverBackupPath(name) {
    const file = String(name || '').trim();
    if (!fileNamePattern.test(file) || file.length > 220) throw new Error('请输入有效的小剧场服务器备份文件名');
    return PREFIX + file;
}

function validPath(path) {
    return typeof path === 'string' && path.startsWith(PREFIX) && path.length <= PREFIX.length + 220
        && path.trim() === path && fileNamePattern.test(path.slice(PREFIX.length));
}

export function serverBackupName({ sourceId, deviceName, counts }, time, rescue = false) {
    const device = (String(deviceName || '').replace(/[^a-zA-Z0-9_.-]/g, 'x').slice(0, 16) || 'device') + (rescue ? '-rescue' : '');
    const stamp = new Date(time).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const name = `st-theater-backup-${sourceId.slice(0, 8)}-${device}-${stamp}-h${counts.history}-d${counts.dreams}-${newHistoryKey()}.zip`;
    serverBackupPath(name);
    return name;
}

export function mergeServerBackups(...lists) {
    const files = new Map();
    const quantity = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
    for (const entries of lists) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            if (!validPath(entry?.path)) continue;
            const file = {
                path: entry.path,
                time: Math.min(quantity(entry.time), 8640000000000000),
                bytes: quantity(entry.bytes),
                ...(/^[a-f0-9]{64}$/i.test(entry.checksum || '') ? { checksum: entry.checksum } : {}),
                ...(/^[a-f0-9-]{16,80}$/i.test(entry.sourceId || '') ? { sourceId: entry.sourceId } : {}),
                ...(/^[a-z][a-z0-9+.-]*:\/\/[^/@?#\s]+$/i.test(entry.origin || '') ? { origin: entry.origin } : {}),
                ...(typeof entry.device === 'string' ? { device: entry.device.slice(0, 40) } : {}),
                ...(entry.reduced === true ? { reduced: true } : {}),
            };
            if (entry.counts && typeof entry.counts === 'object') {
                file.counts = Object.fromEntries(['history', 'dreams', 'chapters', 'instructions', 'retained', 'candidates', 'drafts']
                    .filter(key => Object.hasOwn(entry.counts, key)).map(key => [key, quantity(entry.counts[key])]));
            }
            const previous = files.get(entry.path);
            // Entries found by scanning only have file metadata. Keep the manifest metadata if available.
            if (!previous || file.checksum || !previous.checksum) files.set(entry.path, { ...previous, ...file });
        }
    }
    return [...files.values()].sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
}

export function compareServerBackup(entries, packet, origin, archiveLoss) {
    const last = entries.find(entry => entry.sourceId === packet.sourceId && entry.counts);
    const reductions = backupProtection(last?.counts, packet.counts);
    const other = !last ? entries.find(entry => entry.origin === origin && entry.sourceId && entry.sourceId !== packet.sourceId
        && ['history', 'dreams', 'chapters'].some(key => Number(entry.counts?.[key]) > packet.counts[key])) : null;
    return { last, other, reductions, reduced: reductions.length > 0 || !!archiveLoss };
}

export const isEmptyServerBackup = counts => counts.history === 0 && counts.dreams === 0 && counts.chapters === 0;

export function serverBackupEnabled(config, settings, origin) {
    return config.server !== false && settings?.serverBackupOff?.[origin] !== true;
}

export async function readServerBackupAccount(loadUser = () => import('/scripts/user.js')) {
    try {
        const user = await loadUser();
        if (user.accountsEnabled !== true) return null;
        const handle = user.getCurrentUserHandle?.();
        if (typeof handle !== 'string' || !handle) return null;
        return { handle, name: user.currentUser?.name || handle };
    } catch {
        return null;
    }
}

export function createServerBackupClient({
    request = globalThis.fetch,
    getHeaders = () => globalThis.SillyTavern?.getContext()?.getRequestHeaders?.() || {},
    wait = () => new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000)),
    timeout = 45000,
} = {}) {
    // 大文件按“每秒至少 50 KB”放宽等待时间：14 MB 的备份 base64 后约 19 MB，远程或手机网络 45 秒传不完。
    const timeoutFor = bytes => Math.max(timeout, Math.ceil((Number(bytes) || 0) / 50000) * 1000);
    async function call(path, { body, endpoint = '', missing = false, decode = response => response.json(), bytes = 0 } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutFor(bytes));
        try {
            const response = await request(path, {
                credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
                ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...getHeaders() }, body: JSON.stringify(body) } : {}),
                ...(path === '/api/users/me' ? { headers: getHeaders() } : {}),
            });
            if (missing && response.status === 404) return notFound;
            if (!response.ok) throw new Error(`酒馆服务器${endpoint || '文件读取'}未完成（HTTP ${response.status}）`);
            return await decode(response);
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('读取或保存到酒馆服务器超时，请稍后重试');
            if (error instanceof TypeError) throw new Error('无法连接酒馆服务器，请检查网络');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
    async function uploadFile(name, bytes) {
        const data = bytesToBase64(bytes);
        const payload = await call('/api/files/upload', {
            endpoint: '写入', body: { name, data }, bytes: data.length,
        });
        const expected = PREFIX + name;
        if (String(payload?.path || '').replace(/^\//, '') !== expected) throw new Error('酒馆返回的备份文件地址无效');
        return expected;
    }
    async function readZip(path, expectedBytes = 0) {
        if (!validPath(path)) throw new Error('服务器备份文件名无效');
        return call('/' + path, { bytes: expectedBytes, decode: async response => {
            if (Number(response.headers?.get('content-length')) > MAX_BACKUP_BYTES) throw new Error('服务器备份超过 128 MB');
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length > MAX_BACKUP_BYTES) throw new Error('服务器备份超过 128 MB');
            return bytes;
        } });
    }
    async function readIndex() {
        const index = await call('/' + PREFIX + SERVER_BACKUP_INDEX, { missing: true });
        if (index === notFound) return [];
        if (index?.format !== 'st-theater-backup-index' || index.version !== 1 || !Array.isArray(index.entries)
            || index.entries.some(entry => !validPath(entry?.path))) {
            throw new Error('酒馆服务器备份目录暂时无法读取，原目录已保留');
        }
        return mergeServerBackups(index.entries);
    }
    return {
        async sessionAccount() {
            const account = await call('/api/users/me', { endpoint: '账号核对', missing: true });
            if (account === notFound) return null;
            if (typeof account?.handle !== 'string' || !account.handle) throw new Error('酒馆当前账号未能核对，请刷新后重试');
            return account.handle;
        },
        readIndex,
        async upload(bytes, name, { onVerifying, checkSession } = {}) {
            if (!validPath(PREFIX + name)) throw new Error('服务器备份文件名无效');
            const expected = await digest(bytes);
            await checkSession?.();
            const path = await uploadFile(name, bytes);
            onVerifying?.();
            const verification = await call('/api/files/verify', { endpoint: '校验', body: { urls: [path] } });
            if (verification?.[path] !== true) throw new Error('酒馆服务器未确认备份文件存在');
            const downloaded = await readZip(path, bytes.length);
            if (downloaded.length !== bytes.length || await digest(downloaded) !== expected) {
                throw new Error('酒馆服务器备份读回校验失败');
            }
            return path;
        },
        async publish(entries, { checkSession } = {}) {
            await checkSession?.();
            let merged = mergeServerBackups(await readIndex(), entries);
            for (let attempt = 0; attempt <= 3; attempt++) {
                const index = { format: 'st-theater-backup-index', version: 1, entries: merged };
                await checkSession?.();
                await uploadFile(SERVER_BACKUP_INDEX, new TextEncoder().encode(JSON.stringify(index)));
                await wait();
                await checkSession?.();
                const current = await readIndex();
                await checkSession?.();
                const paths = new Set(current.map(entry => entry.path));
                if (merged.every(entry => paths.has(entry.path))) return current;
                merged = mergeServerBackups(current, merged);
            }
            throw new Error('备份文件已保存，酒馆服务器目录稍后将再次补写');
        },
        readZip,
        async find() {
            const payload = await call('/api/data-maid/report', { endpoint: '查找', missing: true, body: {} });
            if (payload === notFound) return null;
            try {
                if (!Array.isArray(payload?.report?.files)) throw new Error('酒馆未返回可用的文件列表');
                return mergeServerBackups(payload.report.files
                    .filter(item => validPath(PREFIX + item?.name))
                    .map(item => ({ path: PREFIX + item.name, time: Math.trunc(Number(item.mtime) || 0), bytes: Math.trunc(Number(item.size) || 0) })));
            } finally {
                if (typeof payload?.token === 'string' && payload.token) {
                    await call('/api/data-maid/finalize', {
                        endpoint: '结束查找', body: { token: payload.token }, decode: () => null,
                    }).catch(() => {});
                }
            }
        },
    };
}
