import { digest } from './backup-data.js';
import { newHistoryKey } from './history-collections.js';

const API = 'https://api.github.com';
export const MAX_GITHUB_BACKUP_BYTES = 48 * 1024 * 1024;
export function validateBackupRepository(repository) {
    const value = String(repository || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(value) || value.split('/').some(p => p === '.' || p === '..')) throw new Error('请填写“用户名/仓库名”，不要填写密钥或网址');
    return value;
}
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const backupPath = /^backups\/[^/]{1,100}\/\d{13}--h\d+-d\d+-i\d+--[a-f0-9-]+\.zip$/;
export function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
}
export function createGithubBackupClient(config, { request = globalThis.fetch, timeoutMs = 45000 } = {}) {
    const repository = validateBackupRepository(config.repository);
    const token = String(config.token || '').trim();
    if (!token) throw new Error('请先填写 GitHub 访问密钥');
    const prefix = `/repos/${encodePath(repository)}`;
    async function call(path, { method = 'GET', body, raw = false } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await request(API + prefix + path, {
                method, signal: controller.signal, credentials: 'omit', redirect: 'error',
                headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            if (!response.ok) {
                const reason = { 401: '访问密钥无效或已过期', 403: '访问被拒绝，请检查仓库权限、密钥范围或访问频率', 404: '未找到仓库或备份，请检查仓库与密钥权限', 409: '仓库发生并发修改，请稍后重试', 422: '仓库拒绝写入，请检查分支和文件大小', 429: '请求过于频繁，请稍后重试' }[response.status] || 'GitHub 请求未完成';
                throw new Error(`${reason}（HTTP ${response.status}）`);
            }
            if (raw) {
                if (Number(response.headers.get('content-length')) > MAX_GITHUB_BACKUP_BYTES) throw new Error('远端备份超过安全大小，请从GitHub手动下载');
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.length > MAX_GITHUB_BACKUP_BYTES) throw new Error('远端备份超过安全大小');
                return bytes;
            }
            return await response.json();
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('连接 GitHub 超时，请稍后重试');
            if (error instanceof TypeError) throw new Error('无法连接 GitHub，请检查网络');
            throw error;
        } finally { clearTimeout(timer); }
    }
    async function repositoryInfo() {
        const info = await call('');
        if (info.private !== true) throw new Error('请使用专用私有仓库，避免作品公开');
        return info;
    }
    return {
        test: repositoryInfo,
        async upload(bytes, { sourceId, deviceName, counts, timestamp = Date.now() }) {
            if (bytes.length > MAX_GITHUB_BACKUP_BYTES) throw new Error('备份压缩后仍超过 48 MB，请先下载到本机保留');
            const info = await repositoryInfo();
            const folder = `${String(deviceName || '本机').replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_').slice(0, 30)}-${sourceId}`;
            const path = `backups/${folder}/${timestamp}--h${counts.history}-d${counts.dreams}-i${counts.instructions}--${newHistoryKey()}.zip`;
            const result = await call(`/contents/${encodePath(path)}`, { method: 'PUT', body: { message: 'Save st-theater backup', branch: info.default_branch || 'main', content: bytesToBase64(bytes) } });
            const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
            const blob = new Uint8Array(header.length + bytes.length); blob.set(header); blob.set(bytes, header.length);
            if (!result.commit?.sha || result.content?.sha !== await digest(blob, 'SHA-1')) throw new Error('上传结果校验未通过，请核对远端文件');
            return { path, sha: result.content.sha, bytes: bytes.length };
        },
        async list() {
            const info = await repositoryInfo();
            let tree;
            try { tree = await call(`/git/trees/${encodeURIComponent(info.default_branch || 'main')}?recursive=1`); }
            catch (error) { if (info.size === 0) return []; throw error; }
            if (tree.truncated) throw new Error('仓库文件太多，备份列表不完整，请从GitHub手动下载');
            return (tree.tree || []).filter(item => item.type === 'blob' && backupPath.test(item.path)).map(item => {
                const match = item.path.match(/\/(\d{13})--h(\d+)-d(\d+)-i(\d+)--/);
                return { path: item.path, sha: item.sha, size: item.size, device: item.path.split('/')[1], time: Number(match[1]), history: Number(match[2]), dreams: Number(match[3]), instructions: Number(match[4]) };
            }).sort((a, b) => b.time - a.time);
        },
        async download(entry) {
            if (!backupPath.test(entry?.path) || !/^[a-f0-9]{40}$/.test(entry?.sha)) throw new Error('备份路径或标识无效');
            // Read immutable git blobs, so concurrent uploads cannot change the chosen file.
            const bytes = await call(`/git/blobs/${entry.sha}`, { raw: true });
            const header = new TextEncoder().encode(`blob ${bytes.length}\0`), blob = new Uint8Array(header.length + bytes.length);
            blob.set(header); blob.set(bytes, header.length);
            if (await digest(blob, 'SHA-1') !== entry.sha) throw new Error('下载的备份校验失败');
            return bytes;
        },
    };
}
