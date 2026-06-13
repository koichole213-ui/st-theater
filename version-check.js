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
    const probes = REMOTE_MANIFEST_URLS.map(fetchManifest);
    const { url, data } = await Promise.any(probes);
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    return { version: String(data.version), host };
}

export function formatVersionCheckError(error) {
    return Array.isArray(error?.errors)
        ? error.errors.map(er => er?.message || String(er)).join(' | ')
        : (error?.message || String(error));
}
