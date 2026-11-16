// 小剧场设置（指令模板、排版模板、标签等）存在酒馆设置里。酒馆保存设置是整份覆盖、不比对新旧：
// 一个很早就打开着的旧页面随手保存一次（切个角色就会），服务器上的设置就退回了那个页面打开时的样子。
// 这里只做“发现并提醒”（禾禾 2026-11-15 选的方案 A），不自动替换任何设置：
// - 每次插件保存设置时记一个版本号 settingsStamp = { rev, by, at }，by 是这个页面的编号；
// - 打开小剧场、或页面在后台放了一阵再回到前台时，读一次服务器上的设置比对：
//   - 服务器的更新 → 本页旧了，提醒刷新；
//   - 服务器的比本页的旧（被旧页面盖回去了）→ 提醒，并给一个“用本页补回”的按钮；
// - 启动时，如果这台浏览器上次确认保存过的版本比服务器现在的新，提醒一次（本页已经关掉过，只能从备份找回）。
import { newHistoryKey } from './history-collections.js';

export const SETTINGS_STAMP_KEY = 'settingsStamp';
const LOCAL_KEY_PREFIX = 'st-theater-settings-saved:';
const MIN_CHECK_GAP_MS = 20_000;
const HIDDEN_BEFORE_CHECK_MS = 30_000;
const RECHECK_DELAY_MS = 3_000;

export function normalizeStamp(value) {
    if (!value || typeof value !== 'object') return null;
    const rev = Number(value.rev);
    if (!Number.isSafeInteger(rev) || rev < 0) return null;
    return { rev, by: typeof value.by === 'string' ? value.by : '', at: Number(value.at) || 0 };
}

export function nextStamp(current, tabId, now = Date.now()) {
    return { rev: (normalizeStamp(current)?.rev || 0) + 1, by: tabId, at: now };
}

const sameStamp = (a, b) => !!a && !!b && a.rev === b.rev && a.by === b.by;

// local：本页内存里的版本；server：服务器上现在的版本；me：本页编号；
// confirmed：本页内存里的这个版本是否确认已经写到过服务器（从服务器读来的、或保存成功过）。
// 返回 'same' | 'stale'（本页旧了）| 'overwritten'（服务器被旧版本盖回去了）| 'unknown'（本页刚改、还没存上，先不下结论）。
export function compareSettingsStamps({ local, server, me, confirmed }) {
    const l = normalizeStamp(local), s = normalizeStamp(server);
    if (!l && !s) return 'same';
    if (sameStamp(l, s)) return 'same';
    if (s && (!l || s.rev > l.rev || (s.rev === l.rev && s.by !== l.by))) return 'stale';
    // 走到这里：服务器上的比本页的旧，或者服务器上没有版本号。
    if (!confirmed) return 'unknown';
    if (l.by === me && s?.by === me) return 'unknown';
    return 'overwritten';
}

export function settingsCounts(settings) {
    return {
        instructions: Array.isArray(settings?.instructionTemplates) ? settings.instructionTemplates.length : 0,
        renderTemplates: Array.isArray(settings?.renderTemplates) ? settings.renderTemplates.length : 0,
    };
}

function countsText(before, after) {
    const parts = [];
    if (before && after && before.instructions !== after.instructions) parts.push(`指令 ${before.instructions} 条 → 现在 ${after.instructions} 条`);
    if (before && after && before.renderTemplates !== after.renderTemplates) parts.push(`排版模板 ${before.renderTemplates} 个 → 现在 ${after.renderTemplates} 个`);
    return parts.length ? `（${parts.join('，')}）` : '';
}

export function createSettingsGuard(runtime, {
    getSettings = () => runtime.settings,
    moduleName = 'theater_generator',
    fetchServerSettings = defaultFetchServerSettings,
    loadAccountHandle = defaultAccountHandle,
    storage = safeLocalStorage(),
    toast = globalThis.toastr,
    log = (...args) => runtime.runtimeLog?.(...args),
    doc = globalThis.document,
    now = () => Date.now(),
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    const me = newHistoryKey();
    let confirmed = true; // 启动时内存里的就是服务器上的
    let accountKey = '', accountReady = null;
    let lastCheckAt = 0, hiddenAt = 0, checking = null;
    let staleToast = null, overwrittenToast = null, warnedServer = '';

    const stampOf = settings => normalizeStamp(settings?.[SETTINGS_STAMP_KEY]);

    function readLocalRecord() {
        try { return JSON.parse(storage?.getItem(LOCAL_KEY_PREFIX + accountKey) || 'null'); } catch { return null; }
    }
    function writeLocalRecord(stamp) {
        if (!stamp || stamp.by !== me || !accountKey) return;
        try { storage?.setItem(LOCAL_KEY_PREFIX + accountKey, JSON.stringify({ ...stamp, ...settingsCounts(getSettings()) })); } catch { /* 读写不了 localStorage 时只少一层提醒 */ }
    }

    // 插件每次保存设置前调用。
    function noteSave() {
        const settings = getSettings();
        if (!settings) return;
        settings[SETTINGS_STAMP_KEY] = nextStamp(settings[SETTINGS_STAMP_KEY], me, now());
        confirmed = false;
    }

    // 酒馆保存设置成功后（SETTINGS_UPDATED）调用：本页内存里的版本已经写到服务器。
    function noteSaved() {
        confirmed = true;
        const stamp = stampOf(getSettings());
        void accountReady?.then(() => writeLocalRecord(stamp));
    }

    // 启动时：这台浏览器上次确认保存过的版本，比服务器现在的新 → 被盖回去过。
    // loadedStamp：启动时从酒馆读到的版本号（在插件自己的升级迁移保存之前记下）。
    async function initialize({ loadedStamp } = {}) {
        accountReady = Promise.resolve().then(loadAccountHandle).then(handle => String(handle || 'default'), () => 'default')
            .then(handle => { accountKey = handle; });
        await accountReady;
        const record = readLocalRecord();
        const server = normalizeStamp(loadedStamp);
        const saved = normalizeStamp(record);
        if (saved && saved.rev > (server?.rev || 0)) {
            const detail = countsText(record, settingsCounts(getSettings()));
            log('warn', '小剧场设置比这台浏览器上次保存的旧', { saved: saved.rev, server: server?.rev || 0, ...settingsCounts(getSettings()) });
            toast?.warning?.(`这台浏览器上次保存的小剧场设置，比现在酒馆里的新${detail}。可能是另一个早先打开的页面保存时，把设置盖回了旧的。新加的指令或模板可以从备份里找回：「备份」→「恢复备份」→ 选指令。`,
                '小剧场设置变旧了', { timeOut: 0, extendedTimeOut: 0, closeButton: true });
            // 只提醒一次：之后以现在的为准。
            try { storage?.setItem(LOCAL_KEY_PREFIX + accountKey, JSON.stringify({ ...(server || { rev: 0, by: '', at: 0 }), ...settingsCounts(getSettings()) })); } catch { /* 同上 */ }
        }
        doc?.addEventListener?.('visibilitychange', () => {
            if (doc.visibilityState === 'hidden') { hiddenAt = now(); return; }
            if (hiddenAt && now() - hiddenAt >= HIDDEN_BEFORE_CHECK_MS) void check('回到前台');
            hiddenAt = 0;
        });
    }

    // 这条提醒还在页面上吗。不用 onHidden：酒馆在全局设置里挂了自己的 onHidden（弹窗开着时保住提醒容器），单条传会把它顶掉。
    const showing = $toast => !!$toast?.[0]?.isConnected;

    function showStale(server) {
        const key = `${server?.rev}:${server?.by}`;
        if (warnedServer === key && showing(staleToast)) return;
        warnedServer = key;
        log('warn', '另一个页面改过小剧场设置，本页是旧的', { local: stampOf(getSettings())?.rev || 0, server: server?.rev || 0 });
        staleToast = toast?.warning?.('另一个页面改过小剧场设置（指令、模板、标签等），本页显示的还是旧的。请先刷新本页再修改；不刷新的话，本页保存时可能把那边的新内容盖回去。',
            '小剧场设置已在别处更新', { timeOut: 0, extendedTimeOut: 0, closeButton: true });
    }

    function showOverwritten(serverSettings) {
        if (showing(overwrittenToast)) return;
        const local = getSettings();
        const detail = countsText(settingsCounts(local), settingsCounts(serverSettings));
        log('warn', '酒馆里的小剧场设置被旧版本盖回去了', { local: stampOf(local)?.rev || 0, server: stampOf(serverSettings)?.rev || 0 });
        const $toast = toast?.warning?.(`酒馆里的小剧场设置被另一个页面的旧版本盖回去了${detail}。本页还留着较新的一份，可以用它补回。<div class="teh-actions"><button type="button" data-settings-guard-restore>用本页补回</button></div>`,
            '小剧场设置被盖回了旧的', { timeOut: 0, extendedTimeOut: 0, closeButton: true, tapToDismiss: false, escapeHtml: false });
        overwrittenToast = $toast;
        const button = $toast?.[0]?.querySelector?.('[data-settings-guard-restore]') || $toast?.find?.('[data-settings-guard-restore]')?.[0];
        button?.addEventListener('click', () => {
            runtime.save();
            log('info', '已用本页的小剧场设置补回');
            toast?.clear?.($toast, { force: true });
            toast?.success?.('已用本页的设置补回；其他开着的页面请刷新一下。');
        }, { once: true });
    }

    async function readVerdict(reason) {
        let serverSettings;
        try {
            serverSettings = await fetchServerSettings(moduleName);
        } catch (error) {
            log('info', '读取酒馆设置比对失败，跳过这次检查', { reason, message: String(error?.message || error).slice(0, 120) });
            return { verdict: 'error' };
        }
        if (serverSettings === undefined) return { verdict: 'error' };
        return { serverSettings, verdict: compareSettingsStamps({ local: stampOf(getSettings()), server: stampOf(serverSettings), me, confirmed }) };
    }

    async function runCheck(reason) {
        let { serverSettings, verdict } = await readVerdict(reason);
        // “被盖回”要隔几秒再看一次：本页刚保存的那一笔可能正好还在路上。
        if (verdict === 'overwritten') {
            await wait(RECHECK_DELAY_MS);
            ({ serverSettings, verdict } = await readVerdict(reason));
        }
        if (verdict === 'stale') showStale(stampOf(serverSettings));
        else if (verdict === 'overwritten') showOverwritten(serverSettings || {});
        return verdict;
    }

    // reason：触发原因，只写进日志。force：测试用，跳过频率限制。
    function check(reason = '', { force = false } = {}) {
        if (checking) return checking;
        if (!force && now() - lastCheckAt < MIN_CHECK_GAP_MS) return Promise.resolve('skipped');
        lastCheckAt = now();
        checking = runCheck(reason).finally(() => { checking = null; });
        return checking;
    }

    return { me, noteSave, noteSaved, initialize, check };
}

// 读服务器上现在的设置里插件那一份。读不到返回 undefined（跳过），插件没有设置返回 null。
async function defaultFetchServerSettings(moduleName) {
    const context = globalThis.SillyTavern?.getContext?.();
    const headers = context?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
    const response = await fetch('/api/settings/get', { method: 'POST', headers, body: '{}', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const settings = typeof data?.settings === 'string' ? JSON.parse(data.settings) : data?.settings;
    if (!settings || typeof settings !== 'object') return undefined;
    return settings.extension_settings?.[moduleName] ?? null;
}

async function defaultAccountHandle() {
    try {
        const user = await import('/scripts/user.js');
        return user.accountsEnabled === true ? user.getCurrentUserHandle?.() || 'default' : 'default';
    } catch { return 'default'; }
}

function safeLocalStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}
