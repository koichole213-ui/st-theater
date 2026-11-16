// 小剧场设置（指令模板、排版模板、标签等）存在酒馆设置里。酒馆保存设置是整份覆盖、不比对新旧：
// 一个很早就打开着的旧页面随手保存一次（切个角色就会），服务器上的设置就退回了那个页面打开时的样子。
// 这里只做“发现并提醒”（禾禾 2026-11-15 选的方案 A），除非用户点「用本页补回」，不改写任何设置。
//
// 版本号 settingsStamp = { by, n, at, chain }：by 是保存它的页面编号，n 是那个页面第几次保存，
// chain 记着“这一份是从哪些版本接着改出来的”（同一页面连续保存合成一段：{ by, from, to }）。
// 比对时看谁包含谁，而不是比保存了几次（插件切个标签页也会保存，次数说明不了谁的内容新）：
// - 服务器那份包含本页这份 → 别处在本页的基础上改过，本页旧了 → 提醒刷新；
// - 本页这份包含服务器那份 → 服务器被旧版本盖回去了 → 提醒，给「用本页补回」；
// - 互不包含 → 两个页面各改各的 → 提醒两边都改过，给「用本页补回」并建议先导出。
// 启动时：这台浏览器上次确认存上的那份，不在现在服务器那份的来历里 → 提醒一次，指向备份。
import { newHistoryKey } from './history-collections.js';
import { stableJson } from './backup-data.js';

export const SETTINGS_STAMP_KEY = 'settingsStamp';
const LOCAL_KEY_PREFIX = 'st-theater-settings-saved:';
// 每个保存过设置的页面占一段（约 70 字节），段里记着这段最后一次保存的时间 t。
// 超过上限丢掉最早的段，并记下丢掉的段里最晚的时间 trimmedUntil：比它还旧的版本找不到是正常的。
const MAX_CHAIN_SEGMENTS = 200;
const MIN_CHECK_GAP_MS = 20_000;
// /api/settings/get 会连同全部预设一起返回，比较重：回到前台只在后台放了很久之后才查。
const HIDDEN_BEFORE_CHECK_MS = 5 * 60_000;
const RECHECK_DELAY_MS = 3_000;
// 酒馆的 saveSettingsDebounced 延迟 1 秒，而且插件每保存一次都会重新计时：带着最新版本号的那次保存，
// 最早也要在最后一次打版本号之后 1 秒才发出。比这更早收到的“保存成功”，存的是之前那一份。
const SAVE_SETTLE_MS = 950;
const RESTORE_CONFIRM_MS = 6_000;
// 用户自己写的内容。这些都一样时，两边只差界面状态（例如上次停在哪个标签页），不提醒。
const PROTECTED_KEYS = ['instructionTemplates', 'instructionTags', 'renderTemplates', 'contextExclusionRules', 'customCSS', 'customStyleAddon',
    'customNsfwAddon', 'apiPresets', 'longDreamMemoryPresets', 'userPersona', 'manualWBEntries', 'history', 'longDreams'];

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 80;
const validCount = value => Number.isSafeInteger(value) && value >= 1;

export function normalizeStamp(value) {
    if (!value || typeof value !== 'object' || !validId(value.by) || !validCount(value.n)) return null;
    const chain = (Array.isArray(value.chain) ? value.chain : [])
        .filter(seg => seg && validId(seg.by) && validCount(seg.from) && validCount(seg.to) && seg.from <= seg.to)
        .map(seg => ({ by: seg.by, from: seg.from, to: seg.to, t: Number(seg.t) || 0 }))
        .slice(-MAX_CHAIN_SEGMENTS);
    if (!stampIncludes({ chain }, value)) chain.push({ by: value.by, from: value.n, to: value.n, t: Number(value.at) || 0 });
    const trimmedUntil = Number(value.trimmedUntil) || 0;
    return { by: value.by, n: value.n, at: Number(value.at) || 0, chain, ...(trimmedUntil > 0 ? { trimmedUntil } : {}) };
}

// stamp 的来历里有没有 ref 这一版。没有版本号（null）算作一切的起点。
export function stampIncludes(stamp, ref) {
    if (!ref) return true;
    if (!stamp) return false;
    return stamp.chain.some(seg => seg.by === ref.by && seg.from <= ref.n && ref.n <= seg.to);
}

// supersede：明确取代的另一份（点「用本页补回」时服务器上那份），把它的来历并进来，
// 这样另一个页面会看到“别处在你的基础上改过”（请刷新），而不是“两边都改过”再来一次补回。
export function nextStamp(current, tabId, n, now = Date.now(), supersede = null) {
    const own = (normalizeStamp(current)?.chain || []).map(seg => ({ ...seg }));
    const extra = (normalizeStamp(supersede)?.chain || []).filter(seg => !own.some(o => o.by === seg.by && o.from <= seg.from && seg.to <= o.to));
    const chain = [...extra, ...own];
    const last = chain.at(-1);
    if (last && last.by === tabId && last.to === n - 1) { last.to = n; last.t = now; }
    else chain.push({ by: tabId, from: n, to: n, t: now });
    const dropped = chain.slice(0, Math.max(0, chain.length - MAX_CHAIN_SEGMENTS));
    const trimmedUntil = Math.max(0, normalizeStamp(current)?.trimmedUntil || 0, normalizeStamp(supersede)?.trimmedUntil || 0, ...dropped.map(seg => seg.t || 0));
    return { by: tabId, n, at: now, chain: chain.slice(-MAX_CHAIN_SEGMENTS), ...(trimmedUntil > 0 ? { trimmedUntil } : {}) };
}

// local：本页内存里的版本；server：服务器上现在的版本；me：本页编号；
// confirmed：本页内存里的这一份是否确认写到过服务器（从服务器读来的，或保存成功过）。
// 返回 'same' | 'stale'（本页旧了）| 'overwritten'（服务器被旧版本盖回去了）
//    | 'diverged'（两个页面各改各的）| 'unknown'（本页刚改、还没存上，先不下结论）。
export function compareSettingsStamps({ local, server, me, confirmed }) {
    const l = normalizeStamp(local), s = normalizeStamp(server);
    if (!l && !s) return 'same';
    if (l && s && l.by === s.by && l.n === s.n) return 'same';
    if (stampIncludes(s, l)) return 'stale';
    if (stampIncludes(l, s)) return confirmed ? 'overwritten' : 'unknown';
    // 服务器那份的来历被截断过，而本页这份比被丢掉的段还旧：找不到是正常的，只提醒刷新，不给补回按钮。
    if (s?.trimmedUntil && l && l.at <= s.trimmedUntil) return 'stale';
    return 'diverged';
}

function pickProtected(settings) {
    const picked = {};
    for (const key of PROTECTED_KEYS) if (settings?.[key] !== undefined) picked[key] = settings[key];
    return picked;
}

export function sameProtectedContent(a, b) {
    return stableJson(pickProtected(a)) === stableJson(pickProtected(b));
}

// 记在本机的只是“内容指纹”，不存内容本身。
export function protectedContentHash(settings) {
    const text = stableJson(pickProtected(settings));
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return `${text.length.toString(36)}-${hash.toString(36)}`;
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

const shortStamp = stamp => (stamp ? `${stamp.by.slice(0, 8)}#${stamp.n}` : '无');
const PERSISTENT = { timeOut: 0, extendedTimeOut: 0, closeButton: true };

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
    pageStartedAt = Number(globalThis.performance?.timeOrigin) || 0,
} = {}) {
    const me = newHistoryKey();
    let counter = 0;
    let confirmed = true; // 启动时内存里的就是服务器上的
    let lastNoteSaveAt = -Infinity;
    let accountKey = '', accountReady = null;
    let lastCheckAt = -Infinity, hiddenAt = 0, checking = null;
    let staleToast = null, staleKey = '', restoreToast = null, restoreKind = '';
    let supersedeNext = null;
    let confirmWaiters = [];

    const stampOf = settings => normalizeStamp(settings?.[SETTINGS_STAMP_KEY]);
    const recordKey = () => LOCAL_KEY_PREFIX + accountKey;

    function readLocalRecord() {
        try { return JSON.parse(storage?.getItem(recordKey()) || 'null'); } catch { return null; }
    }
    function writeLocalRecord(stamp, details) {
        if (!stamp || stamp.by !== me || !accountKey) return;
        // 同一浏览器里另一个标签页存过、而本页这份不是在它的基础上改的（本页是旧标签页）：保留那条记录，
        // 下次启动才能发现它被盖掉了。
        const previous = normalizeStamp(readLocalRecord());
        if (previous && !stampIncludes(stamp, previous)) {
            log('info', '本机记录是另一个标签页存的较新版本，保留它', { record: shortStamp(previous), page: shortStamp(stamp) });
            return;
        }
        // savedAt：确认存上的时间（启动时用来判断记录是不是在本页开始加载之后才写的）。
        try { storage?.setItem(recordKey(), JSON.stringify({ ...stamp, ...details, savedAt: now() })); } catch { /* 读写不了 localStorage 时只少一层提醒 */ }
    }

    // 插件每次保存设置前调用。
    function noteSave() {
        const settings = getSettings();
        if (!settings) return;
        settings[SETTINGS_STAMP_KEY] = nextStamp(settings[SETTINGS_STAMP_KEY], me, ++counter, now(), supersedeNext);
        supersedeNext = null;
        confirmed = false;
        lastNoteSaveAt = now();
    }

    // 酒馆保存设置成功后（SETTINGS_UPDATED）调用。
    function noteSaved() {
        // 酒馆在发起保存的那一刻就打好了包；刚打过版本号就收到的“成功”，存的是之前那一份。
        // 带着最新版本号的那次延迟保存完成时，还会再来一次。
        if (now() - lastNoteSaveAt < SAVE_SETTLE_MS) return;
        confirmed = true;
        const settings = getSettings();
        const stamp = stampOf(settings), details = { ...settingsCounts(settings), content: protectedContentHash(settings) };
        void accountReady?.then(() => writeLocalRecord(stamp, details));
        const waiters = confirmWaiters;
        confirmWaiters = [];
        waiters.forEach(resolve => resolve());
    }

    // loadedStamp：启动时从酒馆读到的版本号（在插件自己的升级迁移保存之前记下）。
    async function initialize({ loadedStamp } = {}) {
        accountReady = Promise.resolve().then(loadAccountHandle).then(handle => String(handle || 'default'), () => 'default')
            .then(handle => { accountKey = handle; });
        await accountReady;
        const record = readLocalRecord();
        const saved = normalizeStamp(record);
        const server = normalizeStamp(loadedStamp);
        const missing = saved && !stampIncludes(server, saved);
        // 不提醒的情况：内容其实一样；服务器那份的来历被截断过（找不到不代表被盖掉）；
        // 记录是本页开始加载之后才写的（另一个标签页刚存，本页读到的是那之前的设置）。
        const savedAt = Number(record?.savedAt) || saved?.at || 0;
        const writtenWhileLoading = missing && pageStartedAt && savedAt >= pageStartedAt;
        const quiet = missing && (writtenWhileLoading || record.content === protectedContentHash(getSettings())
            || (server?.trimmedUntil && saved.at <= server.trimmedUntil));
        if (missing && quiet) {
            log('info', '这台浏览器上次保存的版本不在现在的设置里，但不需要提醒', { saved: shortStamp(saved), server: shortStamp(server) });
            // 内容一样或太旧找不到：这条记录已经没用了，清掉，否则它会卡住、以后再也更新不了。
            // 加载那几秒另一个标签页刚写的记录要留着。
            if (!writtenWhileLoading) { try { storage?.removeItem(recordKey()); } catch { /* 同上 */ } }
        }
        if (missing && !quiet) {
            const counts = settingsCounts(getSettings());
            const detail = countsText({ instructions: Number(record.instructions) || 0, renderTemplates: Number(record.renderTemplates) || 0 }, counts);
            log('warn', '这台浏览器上次保存的小剧场设置不在现在的酒馆设置里', { saved: shortStamp(saved), server: shortStamp(server), ...counts });
            toast?.warning?.(`这台浏览器上次保存的小剧场设置，没有留在现在的酒馆设置里${detail}。可能是另一个早先打开的页面保存时把它盖掉了。新加的指令或模板可以从备份里找回：「备份」→「恢复备份」→ 选指令。`,
                '小剧场设置可能被盖掉了', PERSISTENT);
            // 只提醒一次。
            try { storage?.removeItem(recordKey()); } catch { /* 同上 */ }
        }
        doc?.addEventListener?.('visibilitychange', () => {
            if (doc.visibilityState === 'hidden') { hiddenAt = now(); return; }
            if (hiddenAt && now() - hiddenAt >= HIDDEN_BEFORE_CHECK_MS) void check('回到前台');
            hiddenAt = 0;
        });
    }

    // 这条提醒还在页面上吗。不用 onHidden：酒馆在全局设置里挂了自己的 onHidden（弹窗开着时保住提醒容器），单条传会把它顶掉。
    const showing = $toast => !!$toast?.[0]?.isConnected;
    const closeToast = $toast => { if (showing($toast)) toast?.clear?.($toast, { force: true }); };

    function showStale(server) {
        const key = shortStamp(server);
        if (staleKey === key && showing(staleToast)) return;
        closeToast(staleToast);
        staleKey = key;
        log('warn', '另一个页面改过小剧场设置，本页是旧的', { local: shortStamp(stampOf(getSettings())), server: key });
        staleToast = toast?.warning?.('另一个页面改过小剧场设置（指令、模板、标签等），本页显示的还是旧的。请先刷新本页再修改；不刷新的话，本页保存时可能把那边的新内容盖回去。',
            '小剧场设置已在别处更新', PERSISTENT);
    }

    function showRestore(kind, serverSettings) {
        if (restoreKind === kind && showing(restoreToast)) return;
        closeToast(restoreToast);
        const local = getSettings();
        const detail = countsText(settingsCounts(local), settingsCounts(serverSettings));
        const message = kind === 'overwritten'
            ? `酒馆里的小剧场设置被另一个页面的旧版本盖回去了${detail}。本页还留着较新的一份，可以用它补回。`
            : `另一个页面也保存过小剧场设置，酒馆里现在是那一份，本页的改动不在里面${detail}。如果那边的改动不要紧，可以用本页补回（那边的改动会被盖掉）；拿不准的话，先在「指令模板库」点「导出」留一份，再刷新本页。`;
        log('warn', kind === 'overwritten' ? '酒馆里的小剧场设置被旧版本盖回去了' : '两个页面都改过小剧场设置', { local: shortStamp(stampOf(local)), server: shortStamp(stampOf(serverSettings)) });
        const $toast = toast?.warning?.(`${message}<div class="teh-actions"><button type="button" data-settings-guard-restore>用本页补回</button></div>`,
            kind === 'overwritten' ? '小剧场设置被盖回了旧的' : '两个页面都改过小剧场设置', { ...PERSISTENT, tapToDismiss: false, escapeHtml: false });
        restoreToast = $toast;
        restoreKind = kind;
        const button = $toast?.[0]?.querySelector?.('[data-settings-guard-restore]');
        button?.addEventListener('click', () => { void restoreFromThisPage($toast, button); });
    }

    // 点「用本页补回」：先重新看一眼服务器，情况变了就不补。
    async function restoreFromThisPage($toast, button) {
        if (button.disabled) return;
        button.disabled = true;
        const { serverSettings, verdict } = await readVerdict('点了用本页补回');
        closeToast($toast);
        if (verdict === 'overwritten' || verdict === 'diverged') {
            supersedeNext = stampOf(serverSettings);
            const saved = new Promise(resolve => confirmWaiters.push(resolve));
            runtime.save();
            // 等酒馆真正存完，再看一眼服务器，确认补上了才说成功。
            await Promise.race([saved, wait(RESTORE_CONFIRM_MS)]);
            const after = await readVerdict('补回后核对');
            if (after.verdict === 'same' || after.verdict === 'same-content') {
                log('info', '已用本页的小剧场设置补回', { verdict });
                toast?.success?.('已用本页的设置补回；其他开着的页面请刷新一下。');
            } else {
                log('warn', '补回后核对没有通过', { verdict: after.verdict });
                toast?.warning?.('补回还没存进酒馆。请确认酒馆还连着（可以看看有没有“设置保存失败”的提示）；连上后，本页下次保存时会一起补上。过一会儿重新打开小剧场确认一下。', '小剧场设置', PERSISTENT);
            }
        } else if (verdict === 'stale') {
            showStale(stampOf(serverSettings));
        } else if (verdict === 'error') {
            toast?.warning?.('暂时读不到酒馆里的设置，这次没有补回，请稍后再试。');
        } else {
            toast?.info?.('酒馆里已经是本页这份或更新的设置了，不用补回。');
        }
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
        const verdict = compareSettingsStamps({ local: stampOf(getSettings()), server: stampOf(serverSettings), me, confirmed });
        // 版本对不上、但用户写的内容两边一样（只差上次停在哪个标签页之类）：不打扰，只记一笔。
        if ((verdict === 'stale' || verdict === 'overwritten' || verdict === 'diverged') && sameProtectedContent(getSettings(), serverSettings || {})) {
            log('info', '小剧场设置的版本对不上，但内容一样，不提醒', { reason, verdict, local: shortStamp(stampOf(getSettings())), server: shortStamp(stampOf(serverSettings)) });
            return { serverSettings, verdict: 'same-content' };
        }
        return { serverSettings, verdict };
    }

    async function runCheck(reason) {
        let { serverSettings, verdict } = await readVerdict(reason);
        // “被盖回”隔几秒再看一次：本页刚保存的那一笔可能正好还在路上。
        if (verdict === 'overwritten') {
            await wait(RECHECK_DELAY_MS);
            ({ serverSettings, verdict } = await readVerdict(reason));
        }
        // 情况变了，就收掉和现在对不上的旧提醒，免得两条相反的提醒同时挂着。
        if (verdict === 'same' || verdict === 'same-content' || verdict === 'stale') closeToast(restoreToast);
        if (verdict === 'same' || verdict === 'same-content' || verdict === 'overwritten' || verdict === 'diverged') closeToast(staleToast);
        if (verdict === 'stale') showStale(stampOf(serverSettings));
        else if (verdict === 'overwritten' || verdict === 'diverged') showRestore(verdict, serverSettings || {});
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
