const REMOTE_MANIFEST_URLS = [
    'https://cdn.jsdelivr.net/gh/koichole213-ui/st-theater@main/manifest.json',
    'https://ghproxy.net/https://raw.githubusercontent.com/koichole213-ui/st-theater/main/manifest.json',
    'https://raw.githubusercontent.com/koichole213-ui/st-theater/main/manifest.json',
];

export function compareVersion(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n) || 0);
    const pb = String(b).split('.').map(n => parseInt(n) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

async function fetchManifest(url) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    try {
        const resp = await fetch(`${url}?_=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
        if (!resp.ok) throw new Error(`${new URL(url).host}: status ${resp.status}`);
        const data = await resp.json();
        if (!data?.version) throw new Error(`${new URL(url).host}: no version field`);
        return { url, data };
    } catch (e) {
        if (e?.name === 'AbortError') throw new Error(`${new URL(url).host}: timeout 5s`);
        throw e;
    } finally {
        clearTimeout(to);
    }
}

export async function fetchLatestRemoteVersion() {
    const errors = [];
    return await new Promise((resolve, reject) => {
        let pending = REMOTE_MANIFEST_URLS.length;
        REMOTE_MANIFEST_URLS.forEach(url => {
            fetchManifest(url).then(({ url, data }) => {
                const host = (() => { try { return new URL(url).host; } catch { return url; } })();
                resolve({ version: String(data.version), host });
            }).catch(error => {
                errors.push(error);
                pending -= 1;
                if (pending === 0) {
                    const finalError = new Error('All version checks failed');
                    finalError.errors = errors;
                    reject(finalError);
                }
            });
        });
    });
}

export async function fetchInstalledExtensionStatus({
    extensionName = 'st-theater',
    headers = { 'Content-Type': 'application/json' },
    fetchImpl = fetch,
    timeoutMs = 7000,
} = {}) {
    const controller = new AbortController();
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(`installed branch check timeout ${timeoutMs}ms`));
        }, timeoutMs);
    });
    const check = (async () => {
        const request = global => fetchImpl('/api/extensions/version', {
            method: 'POST',
            headers,
            body: JSON.stringify({ extensionName, global }),
            signal: controller.signal,
        });

        let response = await request(false);
        if (!response.ok && (response.status === 400 || response.status === 404)) {
            response = await request(true);
        }
        if (!response.ok) {
            let detail = '';
            try { detail = await response.text(); } catch {}
            throw new Error(`installed branch check failed (${response.status || 0})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
        }
        const data = await response.json();
        if (!data?.currentBranchName || !data?.currentCommitHash || typeof data?.isUpToDate !== 'boolean') {
            throw new Error('installed branch check returned invalid data');
        }
        return {
            branch: String(data.currentBranchName),
            commit: String(data.currentCommitHash),
            isUpToDate: data.isUpToDate,
        };
    })();

    try {
        return await Promise.race([check, timeout]);
    } finally {
        clearTimeout(timeoutId);
    }
}

export function formatVersionCheckError(error) {
    return Array.isArray(error?.errors)
        ? error.errors.map(er => er?.message || String(er)).join(' | ')
        : (error?.message || String(error));
}
