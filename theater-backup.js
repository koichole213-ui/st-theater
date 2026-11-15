import { BACKUP_FORMAT, BACKUP_MANIFEST, MAX_BACKUP_BYTES, createCompleteBackup, parseCompleteBackup, normalizeBackupData, backupCounts, backupProtection, digest, stableJson } from './backup-data.js';
import { createGithubBackupClient, validateBackupRepository } from './backup-github.js';
import { createBackupStorage } from './backup-storage.js';
import { backupSettingsHTML, backupDiagnosticHTML, backupStatusText, BACKUP_LABELS, escapeBackup as e, restoreDialog, isBackupReduction, formatBackupSize, serverSpaceText } from './backup-ui.js';
import { newHistoryKey } from './history-collections.js';
import { parseInstructionBackup } from './instruction-backup.js';
import { normalizeHistoryBackup, HISTORY_ARCHIVE_MANIFEST, historyItemsFromArchive } from './history-backup.js';
import { parseLongDreamBackup } from './long-dream-backup.js';
import { LONG_DREAM_ARCHIVE_MANIFEST, parseLongDreamArchive } from './long-dream-archive.js';
import { sanitizeLogText } from './runtime-log.js';
import { backupFileMetadata, createBackupImportTrace } from './backup-import-diagnostics.js';
import { discoverOldArchives } from './archive-discovery.js';
import { ARCHIVE_SEARCH_SCOPE, archiveSearchHTML } from './archive-discovery-ui.js';
import { archiveClosedError, archiveWriteFailureDetail } from './archive-rescue.js';
import { createServerBackupClient, readServerBackupAccount, serverBackupEnabled, serverBackupName, serverBackupPath, mergeServerBackups, compareServerBackup, isEmptyServerBackup, SERVER_BACKUP_GIB } from './server-backup.js';

export function createTheaterBackup(runtime, { storage = createBackupStorage(runtime), githubClient = createGithubBackupClient,
    serverClient = createServerBackupClient(), readAccount = readServerBackupAccount, confirmAccount = confirmServerBackupAccount,
    origin = globalThis.location?.origin || '' } = {}) {
    let config = { enabled:false, local:true, github:false, server:true, days:1, repository:'', token:'', deviceName:'本机' };
    let state = {}, ready = null, busy = false, recoveredCount = 0;
    let catalog = [], indexPaths = new Set();
    const SERVER_SETTINGS_LIMIT = 100;
    let serverAccount = null, accountReady;
    let progress = null;
    const progressLabels = {
        reading: '正在读取存档…',
        packing: '正在打包…',
        downloading: '正在交给浏览器下载…',
        uploading: '正在上传到 GitHub…',
        verifying: '正在校验…',
    };
    const root = () => document.querySelector('.theater-popup');
    const safeError = error => sanitizeLogText(archiveWriteFailureDetail(error) || '备份操作未完成，请重试');
    const canRescueToServer = () => !!origin && serverBackupEnabled(config, runtime.settings, origin);
    const canRescueToGithub = () => !!(config.repository && config.token);
    const serverOwnerConfirmed = () => !serverAccount || config.ownerHandle === serverAccount.handle;
    const localServerState = () => !serverAccount || state.server?.ownerHandle === serverAccount.handle ? state.server : undefined;
    const serverCheckpointEntries = () => {
        const local = localServerState();
        return mergeServerBackups(local?.pending, local?.entry ? [local.entry] : []);
    };
    const entriesForOrigin = () => catalog.filter(entry => entry.origin === origin);
    function displayedState() {
        const own = entriesForOrigin();
        const local = localServerState();
        return { ...state, server: { ...local, time: own[0]?.time || local?.time,
            count: own.length, bytes: own.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0),
            off: !canRescueToServer(), awaitingOwner: canRescueToServer() && !serverOwnerConfirmed() } };
    }
    const configForDisplay = () => ({ ...config, server: canRescueToServer() });
    function initializeServerAccount() {
        if (!accountReady) accountReady = Promise.resolve().then(readAccount).then(account => { serverAccount = account; });
        return accountReady;
    }
    const idle = () => { if (runtime.isGenerating || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) throw new Error('请先完成或停止生成与章节编辑，再恢复备份'); };
    async function initialize() {
        if (runtime.archiveClosed) return;
        if (!ready) ready = (async () => {
            await initializeServerAccount();
            if (!runtime.idb) return;
            try {
                const saved = await storage.get('backup-config');
                config = { ...config, ...saved, days: [1,3,7].includes(Number(saved?.days)) ? Number(saved.days) : 1, sourceId:saved?.sourceId || newHistoryKey(), deviceName:saved?.deviceName || (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? '手机' : '电脑') };
                const changedAccount = serverAccount && config.ownerHandle && config.ownerHandle !== serverAccount.handle;
                if (!saved || changedAccount) {
                    const initialized = await storage.saveConfiguration(latest => {
                        const next = { ...config, ...latest };
                        if (serverAccount && next.ownerHandle !== serverAccount.handle) delete next.ownerHandle;
                        return next;
                    });
                    config = initialized.config;
                }
                state = await storage.get('backup-state') || {};
                if(state.github?.time&&state.github.repository!==config.repository)delete state.github;
                await storage.recoverJournal();
                recoveredCount = ((await (storage.getRecovered ? storage.getRecovered() : storage.get('backup-recovered-results'))) || []).length;
                catalog = mergeServerBackups(runtime.settings?.serverBackups, serverCheckpointEntries());
            } catch { state.protection = '备份设置未能完整读取，自动备份已暂停；请重新加载。'; config.enabled = false; }
        })();
        await ready;
    }
    function refresh() {
        const current = displayedState();
        document.querySelectorAll('[data-backup-status]').forEach(el => { el.textContent = backupStatusText(current,el.dataset.backupStatus,progress); });
        document.querySelectorAll('[data-server-backup-notice]').forEach(el => { el.textContent = current.server.notice || ''; el.hidden = !current.server.notice; });
        const space = serverSpaceText(current.server.bytes);
        document.querySelectorAll('[data-server-backup-space]').forEach(el => { el.textContent = space; el.hidden = !space; });
        document.querySelectorAll('[data-backup-protection]').forEach(el => { el.hidden=!state.protection; el.textContent=state.protection || ''; });
        refreshBackupControls();
    }
    function refreshBackupControls() {
        const panel = root();
        panel?.querySelectorAll('[data-theater-restore], [data-backup-action="download"], [data-backup-action="upload"], [data-backup-action="save-server"]').forEach(button => {
            button.disabled = !!progress;
        });
        for (const [action, label, icon] of [['download', '下载备份', 'fa-download'], ['upload', '立即上传', 'fa-cloud-arrow-up'], ['save-server', '立即保存到酒馆', 'fa-server']]) {
            const button = panel?.querySelector(`[data-backup-action="${action}"]`);
            if (!button) continue;
            const active = progress?.action === action;
            button.toggleAttribute('aria-busy', active);
            if (active) button.setAttribute('aria-busy', 'true');
            button.querySelector('span').textContent = active ? progress.label : label;
            button.querySelector('i').className = `fa-solid ${active ? 'fa-spinner fa-spin' : icon}`;
        }
        root()?.querySelectorAll('[data-backup-protection-panel]').forEach(el=>{el.hidden=!state.protection;});
        root()?.querySelectorAll('[data-backup-reduction-controls]').forEach(el=>{el.hidden=!isBackupReduction(state);});
        const confirm=root()?.querySelector('[data-backup-confirm-reduction]');
        if(confirm&&!isBackupReduction(state))confirm.checked=false;
        root()?.querySelectorAll('[data-backup-action="confirmed-backup"]').forEach(el=>{el.disabled=!isBackupReduction(state)||!confirm?.checked||busy;});
        root()?.querySelectorAll('[data-backup-recovered]').forEach(el=>{el.hidden=!recoveredCount;});
    }
    async function saveState() { await storage.put('backup-state',state); refresh(); }
    async function saveServerState() {
        try { await saveState(); }
        catch (error) {
            runtime.runtimeLog('warn', '酒馆备份的本机状态未保存', { reason: safeError(error) });
            refresh();
        }
    }
    function feedback(text) { const el = root()?.querySelector('[data-backup-feedback]'); if (el) { el.textContent=text; el.hidden=!text; } }
    function connectionFeedback(button,text,status) {
        if(!button.isConnected)return;
        const el=button.closest('.theater-config-extra-body')?.querySelector('[data-backup-connection-feedback]');
        if(el){el.textContent=text;el.hidden=!text;el.dataset.state=status;}
    }
    async function exclusive(operation, { onStart, onFinish } = {}) {
        if (busy) throw new Error('备份操作正在进行，请稍后再试');
        busy=true;
        try {
            onStart?.();
            return await storage.withLease(operation);
        } finally {
            busy = false;
            if (onFinish) onFinish();
            else refreshBackupControls();
        }
    }
    function readForm() {
        const value = id => document.getElementById(id)?.value;
        const checked = id => document.getElementById(id)?.checked;
        return { ...config, server:checked('theater-backup-server') ?? config.server, enabled:!!checked('theater-backup-enabled'), local:!!checked('theater-backup-local'), github:!!checked('theater-backup-github'), days:Number(value('theater-backup-interval')) || 1, repository:String(value('theater-backup-repository') || '').trim(), deviceName:String(value('theater-backup-device') || '').trim().slice(0,30) || '本机', token:value('theater-backup-token')?.trim() || config.token };
    }
    async function zipPacket(packet) {
        const text=JSON.stringify(packet);
        if (new Blob([text]).size>MAX_BACKUP_BYTES) throw new Error('备份内容超过 128 MB，请先分项导出保留');
        const JSZip=await runtime.loadJSZip(), zip=new JSZip(); zip.file(BACKUP_MANIFEST,text);
        return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}});
    }
    function download(bytes,filename) {
        const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
        const a=document.createElement('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    async function readServerCatalog() {
        await checkServerSession();
        try {
            const indexed = await serverClient.readIndex();
            await checkServerSession();
            indexPaths = new Set(indexed.map(entry => entry.path));
            catalog = mergeServerBackups(catalog, runtime.settings?.serverBackups, indexed, serverCheckpointEntries());
        } catch (error) {
            indexPaths = new Set();
            runtime.runtimeLog('warn', '酒馆服务器备份目录读取失败', { reason: safeError(error) });
            catalog = mergeServerBackups(catalog, runtime.settings?.serverBackups, serverCheckpointEntries());
        }
        return catalog;
    }
    async function rememberServerEntries(entries) {
        catalog = mergeServerBackups(catalog, runtime.settings?.serverBackups, entries);
        async function mirror() {
            if (!runtime.settings) return;
            if (!runtime.archiveClosed) {
                try {
                    const saved = await storage.get('backup-config');
                    if (saved?.server === false) runtime.settings.serverBackupOff = { ...runtime.settings.serverBackupOff, [origin]: true };
                } catch { /* Keep the server mirror available when the local database is unavailable. */ }
            }
            await checkServerSession();
            // 酒馆设置每次保存都整份上传，这里只留最近 100 条；完整清单在服务器的目录文件里。
            runtime.settings.serverBackups = mergeServerBackups(runtime.settings.serverBackups, catalog).slice(0, SERVER_SETTINGS_LIMIT);
            try { runtime.save?.(); } catch (error) {
                runtime.runtimeLog('warn', '酒馆备份清单保存失败', { reason: safeError(error) });
            }
        }
        try {
            await mirror();
            const indexed = await serverClient.publish(catalog, { checkSession: checkServerSession });
            indexPaths = new Set(indexed.map(entry => entry.path));
            const merged = mergeServerBackups(catalog, indexed);
            if (merged.length !== catalog.length) { catalog = merged; await mirror(); }
            return true;
        } catch (error) {
            runtime.runtimeLog('warn', '酒馆服务器备份目录补写未完成', { reason: safeError(error) });
            return false;
        }
    }
    // 关闭服务器备份时，同时记到酒馆设置里（浏览器被清后仍保持关闭）。账号一时核对不了就先只关本机，下次打开面板再补记。
    async function syncServerOff() {
        if (config.server !== false || !origin || !runtime.settings || runtime.settings.serverBackupOff?.[origin] === true) return true;
        try {
            await checkServerSession();
            runtime.settings.serverBackupOff = { ...runtime.settings.serverBackupOff, [origin]: true };
            runtime.save?.();
            return true;
        } catch (error) {
            runtime.runtimeLog('warn', '关闭酒馆服务器备份的选择暂未同步到酒馆设置', { reason: safeError(error) });
            return false;
        }
    }
    async function checkServerSession() {
        if (!serverAccount) return;
        const current = await serverClient.sessionAccount?.();
        if (!current) throw new Error('未能核对酒馆当前账号，请刷新后重试。需要抢救时可以先下载备份。');
        if (current !== serverAccount.handle) throw new Error('酒馆登录账号已经变化，请先刷新页面。需要抢救时可以先下载备份。');
    }
    async function authorizeServerBackup(allowConfirm, counts) {
        if (serverOwnerConfirmed()) return true;
        if (!allowConfirm || isEmptyServerBackup(counts)) return false;
        await checkServerSession();
        if (!await confirmAccount(serverAccount)) return false;
        await checkServerSession();
        const result = await storage.saveConfiguration(latest => ({ ...config, ...latest, ownerHandle: serverAccount.handle }));
        config = result.config;
        return true;
    }
    async function uploadServerPacket(packet, bytes, now, { reduced, rescue, onVerifying, name = serverBackupName(packet, now, rescue) } = {}) {
        const path = await serverClient.upload(bytes, name, { onVerifying, checkSession: checkServerSession });
        return { path, origin, sourceId: packet.sourceId, device: packet.deviceName, time: now,
            counts: packet.counts, checksum: packet.checksum, bytes: bytes.length, ...(reduced ? { reduced: true } : {}) };
    }
    function serverUploadNotices(comparison, packet, previous) {
        const labels = { ...BACKUP_LABELS, chapters:'正式章节', retained:'保留版本', candidates:'待选择候选', drafts:'已保存草稿' };
        const messages = [];
        const firstDevice = comparison.other && !previous.firstDeviceNotice;
        const lossKey = runtime.archiveLossSuspected ? runtime.archiveLossSuspected.since || 'active' : null;
        if (comparison.reductions.length) {
            const changes = comparison.reductions.map(key => `${labels[key]}从 ${comparison.last.counts[key]} 变为 ${packet.counts[key]}`).join('；');
            messages.push(`这次备份的作品比上一份少了很多（${changes}）。旧备份都还在，如果作品不见了，可以在「恢复备份」里找回。`);
        } else if (lossKey && lossKey !== previous.lossNoticeKey && !firstDevice) {
            messages.push('这个浏览器提示存档疑似丢失，本次备份已保存。可以在「恢复备份」里找回之前的作品。');
        }
        if (firstDevice) {
            const { device, time, counts } = comparison.other;
            messages.push(`这个浏览器是第一次保存到酒馆。同一网址下还有 ${device || '其他设备'} 在 ${new Date(time).toLocaleString('zh-CN')} 的备份（普通历史 ${Number(counts.history) || 0} 篇，长梦 ${Number(counts.dreams) || 0} 部）。如果作品不见了，可以在「恢复备份」里找回；如果这是另一台设备，忽略就好。`);
        }
        const notice = messages.join('\n');
        // Keep the most recent notice visible and avoid repeating it for the same verified contents.
        if (notice && previous.noticeChecksum !== packet.checksum) toastr.info(notice, '酒馆服务器备份', { escapeHtml: true });
        return { notice: notice || previous.notice, noticeChecksum: notice ? packet.checksum : previous.noticeChecksum,
            firstDeviceNotice: previous.firstDeviceNotice || !!firstDevice, lossNoticeKey: lossKey };
    }
    async function showServerSpaceNotice() {
        if (!runtime.settings) return;
        const bytes = displayedState().server.bytes;
        const level = Math.floor((bytes - 1) / SERVER_BACKUP_GIB);
        if (level <= (runtime.settings.serverBackupNotice?.[origin] || 0)) return;
        await checkServerSession();
        runtime.settings.serverBackupNotice = { ...runtime.settings.serverBackupNotice, [origin]: level };
        runtime.save?.();
        toastr.info(`酒馆服务器备份已占 ${formatBackupSize(bytes)}。可在备份设置查看存放位置。`, '酒馆服务器备份', { escapeHtml: true });
    }
    async function runRescueBackup(destination) {
        if (!runtime.archiveClosed) throw new Error('当前页面没有需要抢救的存档');
        if (destination === 'server') await initializeServerAccount();
        if (destination !== 'local' && !(destination === 'github' && canRescueToGithub()) && !(destination === 'server' && canRescueToServer())) {
            throw new Error('当前无法保存到此位置，请先下载抢救备份');
        }
        if (!config.sourceId) config = { ...config, sourceId: newHistoryKey() };
        const rescueConfig = { ...config, deviceName: `${config.deviceName || '本机'}-抢救` };
        const now = new Date();
        const packet = await createCompleteBackup(storage.rescueSnapshot(), { ...rescueConfig, now });
        const bytes = await zipPacket(packet);
        if (destination === 'local') {
            download(bytes, `theater-rescue-${now.toISOString().replace(/[:.]/g, '-')}.zip`);
        } else if (destination === 'server') {
            const entry = await uploadServerPacket(packet, bytes, now.getTime(), { rescue: true });
            await rememberServerEntries([entry]);
        } else {
            try {
                await githubClient(rescueConfig).upload(bytes, { ...rescueConfig, counts: packet.counts, timestamp: now.getTime() });
            } catch (error) {
                throw new Error(safeError(error));
            }
        }
    }
    async function runBackup(kinds, { automatic=false, confirmed=false, action=null, onStage } = {}) {
        if (runtime.archiveClosed) throw archiveClosedError();
        await initialize();
        if(!kinds.length)throw new Error('请先在备份设置中选择保存方式');
        function stage(name, activeKinds = kinds) {
            const label = name === 'uploading' && activeKinds[0] === 'server' ? '正在保存到酒馆…' : progressLabels[name];
            progress = { label, kinds: activeKinds, action };
            refresh();
            onStage?.(name, activeKinds.length === 1 ? activeKinds[0] : null);
        }
        return exclusive(async () => {
            const saved = await storage.get('backup-config');
            config={ ...config, ...saved, ownerHandle: saved?.ownerHandle };
            state=await storage.get('backup-state') || {};
            const serverRequested = kinds.includes('server') && canRescueToServer();
            const originalKinds = kinds.filter(kind => kind !== 'server');
            if ((!serverRequested || (!serverOwnerConfirmed() && action !== 'save-server')) && !originalKinds.length) return;
            if (automatic) {
                // 自动备份先只看时间：都还没到期时，不读存档、不打包、不请求服务器，打开面板不会每次都卡一下。
                const checkAt = Date.now(), every = config.days * 86400000;
                const timeDue = previous => (!previous?.lastAttempt || checkAt - previous.lastAttempt > 300000)
                    && (!previous?.time || checkAt - previous.time >= every);
                const server = localServerState();
                const serverDue = serverRequested && serverOwnerConfirmed() && (timeDue(server) || !!server?.pending?.length);
                if (!serverDue && !originalKinds.some(kind => timeDue(state[kind]))) return;
            }
            const snapshot=await storage.snapshot();
            stage('packing');
            const packet=await createCompleteBackup(snapshot.data,config);
            const useServer = serverRequested && await authorizeServerBackup(action === 'save-server', packet.counts);
            const reduced=backupProtection(state.baseline,packet.counts);
            const blockOriginal = originalKinds.length && reduced.length && !confirmed;
            if (blockOriginal) {
                const labels={...BACKUP_LABELS,chapters:'正式章节',retained:'保留版本',candidates:'待选择候选',drafts:'已保存草稿'};
                state.protection=`${reduced.map(k=>`${labels[k]}从 ${state.baseline[k]} 变为 ${packet.counts[k]}`).join('；')}。自动备份已暂停，旧备份保留；请先核对数据。`;
                if (!useServer) { await saveState(); throw new Error(state.protection); }
            }
            if (originalKinds.length && !reduced.length) delete state.protection;
            const now=Date.now(), interval=config.days*86400000;
            const due=blockOriginal ? [] : originalKinds.filter(kind=>!automatic || ((!state[kind]?.lastAttempt || now-state[kind].lastAttempt>300000) && (!state[kind]?.time || now-state[kind].time>=interval) && (kind==='local' || state[kind]?.checksum!==packet.checksum || state[kind]?.repository!==config.repository)));
            let comparison;
            if (useServer) try {
                comparison = compareServerBackup(await readServerCatalog(), packet, origin, runtime.archiveLossSuspected);
                const previous = localServerState() || {};
                const lastTime = comparison.last?.time || previous.time;
                const newContent = comparison.last?.checksum !== packet.checksum;
                const readyToUpload = !automatic || ((!previous.lastAttempt || now - previous.lastAttempt > 300000) && (!lastTime || now - lastTime >= interval));
                const empty = isEmptyServerBackup(packet.counts);
                if (!empty && newContent && readyToUpload) due.push('server');
                else {
                    const own = mergeServerBackups(previous.pending, previous.entry ? [previous.entry] : []);
                    const missing = own.filter(entry => !indexPaths.has(entry.path));
                    if (!empty && missing.length && await rememberServerEntries(missing)) state.server = { ...previous, pending: [] };
                    if (!automatic) feedback(empty ? '当前没有普通历史或长梦作品可备份。' : '作品内容没有变化，已保留现有服务器备份。');
                }
            } catch (error) {
                const previous = localServerState() || {};
                state.server = { ...previous, error: safeError(error), ...(serverAccount ? { ownerHandle: serverAccount.handle } : {}) };
                if (!automatic) feedback(`酒馆服务器备份失败：${state.server.error}`);
            }
            if (!due.length) { await saveState(); return; }
            const bytes=await zipPacket(packet), outcomes=[];
            for (const kind of due) {
                const previous=(kind === 'server' ? localServerState() : state[kind]) || {};
                state[kind]={...previous,lastAttempt:now, ...(kind === 'server' && serverAccount ? { ownerHandle: serverAccount.handle } : {})};
                try {
                    stage(kind === 'local' ? 'downloading' : 'uploading', [kind]);
                    if (kind === 'server') {
                        // 同样内容上次没传成功时沿用上次的文件名，重试会覆盖那份没校验过的文件，不在服务器上越堆越多。
                        const retry = previous.failedUpload?.checksum === packet.checksum ? previous.failedUpload.name : '';
                        const name = retry || serverBackupName(packet, now);
                        state.server.failedUpload = { name, checksum: packet.checksum };
                        const entry = await uploadServerPacket(packet, bytes, now, { reduced: comparison.reduced, name,
                            onVerifying: () => stage('verifying', [kind]) });
                        const pending = mergeServerBackups(previous.pending, previous.entry ? [previous.entry] : [], [entry]);
                        state.server = { ...state.server, time: now, lastAttempt: now, entry, pending, error: undefined, failedUpload: undefined };
                        const [indexed] = await Promise.all([rememberServerEntries(pending), saveServerState()]);
                        if (indexed) state.server.pending = [];
                        Object.assign(state.server, serverUploadNotices(comparison, packet, previous));
                        if (!previous.introShown) {
                            state.server.introShown = true;
                            toastr.info('已把作品备份到运行酒馆的设备上。备份成功后，即使清理了浏览器，也能从同一个酒馆恢复。可在「设置 → 备份与恢复」里关闭。', '酒馆服务器备份', { escapeHtml: true });
                        }
                        await showServerSpaceNotice().catch(error => {
                            runtime.runtimeLog('warn', '酒馆服务器备份空间提醒未保存', { reason: safeError(error) });
                        });
                        outcomes.push('已保存到酒馆服务器，文件校验通过');
                        runtime.runtimeLog('info', '酒馆服务器备份已保存并校验', { history: packet.counts.history, dreams: packet.counts.dreams });
                    } else {
                    if (kind==='local') download(bytes,`theater-backup-${new Date(now).toISOString().replace(/[:.]/g,'-')}.zip`);
                    else await githubClient(config).upload(bytes, { ...config, counts:packet.counts, timestamp:now,
                        onVerifying: () => stage('verifying', [kind]) });
                    state[kind]=kind==='local'
                        ? {time:now,lastAttempt:now}
                        : {time:now,lastAttempt:now,checksum:packet.checksum,repository:config.repository};
                    state.baseline=packet.counts; outcomes.push(kind==='local'?'已发起本机下载，请核对浏览器下载记录':'GitHub 上传成功，文件校验通过');
                    runtime.runtimeLog('info',kind==='local'?'完整备份已发起本机下载':'GitHub完整备份上传并校验成功',{history:packet.counts.history,dreams:packet.counts.dreams,instructions:packet.counts.instructions});
                    }
                } catch (error) {
                    state[kind].error=safeError(error); outcomes.push(`${{ local:'本机', github:'GitHub', server:'酒馆服务器' }[kind]}备份失败：${state[kind].error}`);
                    runtime.runtimeLog('warn','定期备份未完成',{destination:kind,reason:state[kind].error});
                }
                if (kind === 'server') await saveServerState();
                else await saveState();
            }
            feedback(outcomes.join('；'));
            if (!automatic && outcomes.length) toastr.info(outcomes.join('；'));
        }, {
            onStart: () => stage('reading'),
            onFinish: () => {
                progress = null;
                refresh();
            },
        });
    }

    async function onOpen() {
        if (runtime.archiveClosed) return;
        await initialize(); refresh();
        await syncServerOff();
        if (busy) return;
        const kinds=[...(config.enabled && config.local?['local']:[]),...(config.enabled && config.github?['github']:[]),...(canRescueToServer()?['server']:[])];
        if (!kinds.length) return;
        try { await runBackup(kinds,{automatic:true}); }
        catch(error) {
            if (busy) return;
            state.protection=safeError(error); refresh();
            try { await saveState(); } catch {}
            runtime.runtimeLog('warn','自动备份已暂停',{reason:state.protection});
        }
    }
    async function decodeFile(file,scope,progress=()=>{}, requireComplete=false) {
        if (file.size>MAX_BACKUP_BYTES) throw new Error('备份文件超过 128 MB，请分项导入');
        let data;
        try {
            if (/\.zip$/i.test(file.name)) {
                progress('zipLibrary');
                const JSZip=await runtime.loadJSZip();
                progress('zipRead');
                const zip=await JSZip.loadAsync(file);
                const entries=Object.values(zip.files).filter(x=>!x.dir);
                if (entries.length>5000 || entries.reduce((n,x)=>n+Number(x._data?.uncompressedSize || 0),0)>MAX_BACKUP_BYTES) throw new Error('备份解压内容超过安全上限');
                const findManifest=name=>entries.find(x=>x.name.replace(/\\/g,'/').split('/').pop().toLowerCase()===name.toLowerCase());
                progress('manifest');
                const completeManifest=findManifest(BACKUP_MANIFEST),dreamManifest=findManifest(LONG_DREAM_ARCHIVE_MANIFEST),historyManifest=findManifest(HISTORY_ARCHIVE_MANIFEST);
                if (completeManifest) data=JSON.parse(await completeManifest.async('string'));
                else if (requireComplete) throw new Error('服务器文件缺少完整备份清单');
                else if (dreamManifest) {
                    const manifest=JSON.parse(await dreamManifest.async('string'));
                    const files=await Promise.all(entries.filter(x=>x.name!==LONG_DREAM_ARCHIVE_MANIFEST).map(async x=>({name:x.name,content:await x.async('string')})));
                    data={dreams:parseLongDreamArchive(manifest,files)};
                } else {
                    const manifest=historyManifest?JSON.parse(await historyManifest.async('string')):null;
                    const html=await Promise.all(entries.filter(x=>/\.html?$/i.test(x.name)).map(async x=>({name:x.name,html:await x.async('string')})));
                    data={history:historyItemsFromArchive(manifest,html),folders:manifest?.folders || []};
                }
            } else if (/\.html?$/i.test(file.name) && scope==='history') data={history:[{title:file.name.replace(/\.html?$/i,''),html:await file.text(),mode:'html'}]};
            else data=JSON.parse(await file.text());
        } catch { throw new Error('无法读取备份，请检查格式、文件是否完整或大小是否超限'); }
        progress('validate');
        if (data?.format===BACKUP_FORMAT || requireComplete) return parseCompleteBackup(data);
        progress('normalize');
        let content;
        if (data?.format==='st-theater-instructions') { const parsed=parseInstructionBackup(data); if(parsed)content={instructions:parsed.templates,instructionTags:parsed.tags}; }
        else if (data?.format==='st-theater-long-dream') content={dreams:parseLongDreamBackup(data)};
        else if (Array.isArray(data?.dreams)) content={dreams:data.dreams};
        else content={history:normalizeHistoryBackup(data),folders:data?.folders || []};
        const normalized=normalizeBackupData(content || {});
        if (!normalized.instructions.length&&!normalized.history.length&&!normalized.dreams.length) throw new Error('没有可恢复的有效内容；其他指令格式请使用“导入其他指令文件”');
        return createCompleteBackup(normalized,{sourceId:(await digest(normalized)).slice(0,32),deviceName:'旧格式备份'});
    }
    async function openRestore(scope='all', initialSource='local') {
        if (runtime.archiveClosed) throw archiveClosedError();
        const archives=initialSource==='archives';
        const openingTrace=createBackupImportTrace(runtime,{scope,source:initialSource});
        openingTrace.step('opening');
        try { await initialize(); idle(); if (progress) throw new Error('备份操作正在进行，请稍后再试'); if (!root()) throw new Error('小剧场窗口未找到，请重新打开'); } catch(error) { openingTrace.fail(); throw error; }
        root().querySelector('.theater-backup-dialog')?.close();
        let view;
        try { view=restoreDialog(root(),scope,archives?{title:'查找旧存档'}:{}); openingTrace.finish(); } catch(error) { openingTrace.fail(); throw error; }
        if(archives)view.element.classList.add('archive-dialog');
        const allowed=archives?['history','dreams']:scope==='all'?Object.keys(BACKUP_LABELS):[scope];
        let packet=null, preview=null, entries=[], selected=[...allowed], ticket=0, committing=false, readingTrace=null, currentSource=initialSource;
        let archiveController=null,archiveResult=null;
        let serverResults = [], serverRecoveryEntry;
        function beginTrace(stage,meta={}) {
            readingTrace?.cancel();
            const trace=createBackupImportTrace(runtime,{scope,source:currentSource,onProgress:value=>{if(view.alive()&&readingTrace===trace)view.status(value);}});
            readingTrace=trace;trace.step(stage,meta);return trace;
        }
        function failure(error,trace=readingTrace) { const diagnostic=trace?.fail();if(view.alive())view.error(`${safeError(error)}${diagnostic?'。'+diagnostic:''}`); }
        view.element.addEventListener('close',()=>{archiveController?.abort();readingTrace?.cancel();ticket++;},{once:true});
        function options(){return `<div class="theater-backup-source-tabs"><button type="button" class="theater-btn" data-source="server">酒馆服务器</button><button type="button" class="theater-btn" data-source="local">本地文件</button><button type="button" class="theater-btn" data-source="github">GitHub 仓库</button></div>`;}
        function renderServerList() {
            const list = serverResults.map((entry, index) => {
                const title = entry.device || entry.path.split('/').at(-1);
                const date = entry.time ? new Date(entry.time).toLocaleString('zh-CN', { hour12: false }) : '时间未知';
                const counts = entry.counts ? ` · 普通历史 ${Number(entry.counts.history) || 0} 篇 · 长梦 ${Number(entry.counts.dreams) || 0} 部` : '';
                return `<button type="button" class="theater-backup-list-item" data-server-file="${index}"><b>${e(title)} · ${e(date)}</b><small>${counts ? e(counts.slice(3)) + ' · ' : ''}${formatBackupSize(entry.bytes)}${entry.reduced ? ' · 数量明显减少' : ''}</small></button>`;
            }).join('');
            view.body.innerHTML = options() + `<div>${list || '<p class="theater-dialog-note">暂未找到酒馆服务器备份。</p>'}</div>
                <div class="theater-btn-row theater-server-backup-tools"><button type="button" class="theater-btn" data-server-find>查找服务器备份</button><button type="button" class="theater-btn" data-server-name>输入文件名</button></div><div data-server-option></div>`;
            view.body.querySelector('[data-source=server]').setAttribute('aria-pressed', 'true');
        }
        async function readServerFile(entry) {
            const current = ++ticket;
            const trace = beginTrace('remoteDownload');
            await checkServerSession();
            const bytes = await serverClient.readZip(entry.path, entry.bytes);
            await checkServerSession();
            if (!view.alive() || current !== ticket) return;
            const next = await decodeFile(new File([bytes], 'backup.zip'), scope, stage => trace.step(stage), true);
            if (!view.alive() || current !== ticket) return;
            if (entry.checksum && entry.checksum !== next.checksum) throw new Error('服务器备份内容校验失败');
            serverRecoveryEntry = entry.checksum ? null : { path: entry.path, origin: '', sourceId: next.sourceId,
                device: next.deviceName, time: Date.parse(next.exportedAt) || entry.time || Date.now(),
                counts: next.counts, checksum: next.checksum, bytes: bytes.length };
            packet = next;
            selected = [...allowed];
            await review(trace);
        }
        async function choose(source='local') {
            const current=++ticket; readingTrace?.cancel();currentSource=source;view.error('');view.status(''); preview=null;serverRecoveryEntry=null;
            if(archives&&source==='archives'){
                archiveController?.abort();archiveController=new AbortController();
                const controller=archiveController;
                archiveResult=null;
                view.body.innerHTML=ARCHIVE_SEARCH_SCOPE+'<div class="archive-state" role="status"><span class="archive-spinner" aria-hidden="true"></span><b>正在查找旧存档…</b><p class="theater-dialog-note">正在只读检查，不会改动现有作品。</p></div>';
                runtime.runtimeLog('info','旧存档查找开始');
                try{
                    const result=await discoverOldArchives({currentDatabaseName:runtime.idb?.name||'st-theater',settings:runtime.settings,current:{history:runtime.historyCache,dreams:runtime.longDreamCache},signal:controller.signal});
                    if(!view.alive()||current!==ticket)return;
                    archiveResult=result;view.body.innerHTML=archiveSearchHTML(result);
                    runtime.runtimeLog('info','旧存档查找完成',{checked:result.checked,candidates:result.candidates.length,failed:result.failed,partial:result.status!=='complete'});
                }catch(error){if(view.alive()&&current===ticket&&error.name!=='AbortError'){archiveResult={candidates:[],status:'failed'};view.body.innerHTML=archiveSearchHTML(archiveResult);}}
                return;
            }
            if (source === 'server') {
                view.body.innerHTML = options();
                view.body.querySelector('[data-source=server]').setAttribute('aria-pressed', 'true');
                view.status('正在读取酒馆服务器备份…');
                let entries;
                try { entries = await readServerCatalog(); }
                catch (error) { if (view.alive() && current === ticket) { view.status(''); failure(error); } return; }
                if (view.alive() && current === ticket) {
                    serverResults = mergeServerBackups(serverResults, entries);
                    renderServerList();
                    view.status('');
                    refresh();
                }
                return;
            }
            view.body.innerHTML=options();
            view.body.querySelector(`[data-source="${source}"]`).setAttribute('aria-pressed','true');
            if (source==='local') {
                view.body.insertAdjacentHTML('beforeend',`<label class="theater-backup-file"><b>选择备份文件</b><input type="file" data-backup-file accept=".zip,.json${scope==='history'?',.html,.htm':''}" ${scope==='history'?'multiple':''}></label>${scope==='instructions'?'<button type="button" class="theater-btn" data-legacy-instructions>导入其他指令文件</button>':''}`);
                return;
            }
            const trace=beginTrace('remoteList');
            try {
                entries=await createGithubBackupClient(config).list();
                if (!view.alive()||current!==ticket)return;
                const devices=[...new Set(entries.map(x=>x.device))];
                view.body.innerHTML=options()+`<p class="theater-dialog-note">${e(config.repository)}</p><label class="theater-backup-device-filter">备份设备<select class="theater-select" data-device><option value="">全部设备</option>${devices.map((d,i)=>`<option value="${i}">${e(d)}</option>`).join('')}</select></label><div data-backup-list></div><p class="theater-dialog-note">配置丢失时，可到设置中重新填写仓库与密钥，再取回备份。</p>`;
                view.body.querySelector('[data-source=github]').setAttribute('aria-pressed','true');
                const render=()=>{const index=view.body.querySelector('[data-device]').value, device=index===''?'':devices[Number(index)];
                    view.body.querySelector('[data-backup-list]').innerHTML=entries.map((x,i)=>({x,i})).filter(({x})=>!device||x.device===device).slice(0,100).map(({x,i})=>`<button type="button" class="theater-backup-list-item" data-remote="${i}"><b>${e(new Date(x.time).toLocaleString('zh-CN',{hour12:false}))}</b><small>${e(x.device)} · 历史 ${x.history} 条 · 长梦 ${x.dreams} 部 · 指令 ${x.instructions} 条</small></button>`).join('')||'<p class="theater-dialog-note">这个来源还没有备份。</p>';};
                view.body.querySelector('[data-device]').addEventListener('change',render); render();trace.finish();
            }catch(error){if(view.alive()&&current===ticket)failure(error,trace);}
        }
        async function review(trace=beginTrace('preview')) {
            const current=++ticket; view.error('');
            const oldConfirm=view.body.querySelector('[data-confirm]');if(oldConfirm)oldConfirm.disabled=true;
            trace.step('preview');
            const nextPreview=await storage.preview(packet,selected,config.sourceId);
            if(!view.alive()||current!==ticket)return;
            preview=nextPreview;
            const plan=preview.plan,c=packet.counts;
            view.body.innerHTML=`<p class="theater-dialog-note">${e(packet.deviceName)}${archives?'':` · ${e(new Date(packet.exportedAt).toLocaleString('zh-CN',{hour12:false}))}`}</p>
              <table class="theater-backup-counts"><thead><tr><th>恢复内容</th><th>新增</th><th>跳过</th><th>另存</th></tr></thead><tbody>${allowed.map(kind=>{const s=selected.includes(kind)?plan.stats[kind]:null;return `<tr><th scope="row"><label class="theater-backup-pick"><input type="checkbox" value="${kind}" ${selected.includes(kind)?'checked':''}><b>${e(BACKUP_LABELS[kind])}</b></label></th><td>${s?s.added:'—'}</td><td>${s?s.same:'—'}</td><td>${s?s.different:'—'}</td></tr>`;}).join('')}</tbody></table>
              ${selected.includes('dreams')&&c.candidates?`<p class="theater-dialog-note">含 ${c.candidates} 篇待选候选，恢复后仍需选择。</p>`:''}
              ${selected.includes('recent')?'<p class="theater-dialog-note">最近结果恢复为找回副本，保留当前结果。</p>':''}
              <p class="theater-dialog-note">相同跳过，差异另存，保留当前内容。</p>
              <footer><button type="button" class="theater-btn" data-back>${archives?'返回查找结果':'重新选择'}</button><button type="button" class="theater-btn primary" data-confirm ${!plan.changed||!selected.length?'disabled':''}>${plan.changed?'确认恢复':'无需重复恢复'}</button></footer>`;
            trace.finish();
            view.body.querySelectorAll('.theater-backup-pick input').forEach(input=>input.addEventListener('change',async()=>{selected=[...view.body.querySelectorAll('.theater-backup-pick input:checked')].map(x=>x.value);try{await review();}catch(error){failure(error);}}));
        }
        view.element.addEventListener('change',async event=>{
            if(committing)return;
            if(!event.target.matches('[data-backup-file]'))return;
            const files=[...event.target.files]; if(!files.length)return;
            const current=++ticket;view.error('');const trace=beginTrace('selected',backupFileMetadata(files));
            try {
                const packets=await Promise.all(files.map(file=>decodeFile(file,scope,stage=>trace.step(stage))));
                if(!view.alive()||current!==ticket)return;
                packet=packets.length===1?packets[0]:{packets,deviceName:`${packets.length} 份备份`,exportedAt:packets[0].exportedAt,counts:packets.reduce((sum,x)=>{for(const k of Object.keys(x.counts))sum[k]=(sum[k]||0)+x.counts[k];return sum;},{})};
                await review(trace);
            }catch(error){if(view.alive()&&readingTrace===trace)failure(error,trace);}
        });
        view.element.addEventListener('click',async event=>{
            if(event.target.matches('[data-backup-file]')) { ticket++;const picker=beginTrace('choosing');picker.finish(); }
            const button=event.target.closest('button');if(!button||button.disabled)return;
            if(committing)return;
            try {
                if(button.hasAttribute('data-archive-retry'))await choose('archives');
                else if(button.hasAttribute('data-archive-backup')){view.close();await openRestore('all');}
                else if(button.hasAttribute('data-archive-review')){
                    const index=Number(view.body.querySelector('[data-archive-choice]:checked')?.value);
                    const candidate=archiveResult?.candidates[index];if(!candidate)return;
                    packet=candidate.packet;selected=allowed.filter(kind=>packet.counts[kind]>0);await review();
                }
                else if(button.dataset.source)await choose(button.dataset.source);
                else if(button.hasAttribute('data-back')){if(archives&&archiveResult){ticket++;view.error('');view.status('');view.body.innerHTML=archiveSearchHTML(archiveResult);}else await choose(currentSource === 'server' ? 'server' : 'local');}
                else if (button.hasAttribute('data-server-find')) {
                    view.body.querySelector('[data-server-option]').innerHTML = '<p class="theater-dialog-note">酒馆会扫描文件和聊天记录。聊天较多时可能需要等一会儿。</p><button type="button" class="theater-btn" data-server-start-find>开始查找</button>';
                    view.body.querySelector('[data-server-start-find]').focus();
                } else if (button.hasAttribute('data-server-start-find')) {
                    const current = ++ticket;
                    button.disabled = true;
                    view.error('');
                    view.status('酒馆正在查找备份文件…');
                    try {
                        await checkServerSession();
                        const found = await serverClient.find();
                        await checkServerSession();
                        if (!view.alive() || current !== ticket) return;
                        if (found === null) {
                            view.status('这个酒馆不支持自动查找，请输入文件名。');
                            return;
                        }
                        const previousCount = serverResults.length;
                        serverResults = mergeServerBackups(serverResults, found);
                        renderServerList();
                        view.status(serverResults.length > previousCount ? `找到 ${serverResults.length - previousCount} 份额外备份。` : '没有找到额外备份。');
                    } catch (error) {
                        if (view.alive() && current === ticket) {
                            view.status('');
                            failure(error);
                        }
                    } finally {
                        if (button.isConnected) button.disabled = false;
                    }
                } else if (button.hasAttribute('data-server-name')) {
                    view.body.querySelector('[data-server-option]').innerHTML = '<label class="theater-backup-file">服务器文件名<input class="theater-input" data-server-filename type="text" autocomplete="off" placeholder="st-theater-backup-….zip"></label><button type="button" class="theater-btn" data-server-read>读取备份</button>';
                    view.body.querySelector('[data-server-filename]').focus();
                } else if (button.hasAttribute('data-server-read')) {
                    const path = serverBackupPath(view.body.querySelector('[data-server-filename]').value);
                    await readServerFile(serverResults.find(entry => entry.path === path) || { path });
                } else if (button.hasAttribute('data-server-file')) {
                    const entry = serverResults[Number(button.dataset.serverFile)];
                    if (entry) await readServerFile(entry);
                }
                else if(button.hasAttribute('data-legacy-instructions')){view.close();runtime.importInstructionTemplates();}
                else if(button.hasAttribute('data-remote')){
                    const current=++ticket;button.disabled=true;
                    const trace=beginTrace('remoteDownload');
                    const bytes=await createGithubBackupClient(config).download(entries[Number(button.dataset.remote)]);
                    if(!view.alive()||current!==ticket)return;
                    packet=await decodeFile(new File([bytes],'backup.zip'),scope,stage=>trace.step(stage));await review(trace);
                }else if(button.hasAttribute('data-confirm')){
                    beginTrace('writing');
                    committing=true;view.writing(true);view.element.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
                    try {
                        const result=await exclusive(()=>storage.restore(packet,selected,config.sourceId,preview.before));
                        if(!view.alive())return;
                        if(result===false)throw new Error('本页存档已过期，请刷新后重新预览并恢复。');
                        readingTrace?.finish();
                        if(selected.includes('recent')&&(result.stats.recent?.added||result.stats.recent?.different))recoveredCount=Math.max(1,recoveredCount);refreshBackupControls();
                        view.body.innerHTML=`<h3>所选内容已恢复</h3><p class="theater-dialog-note">${selected.map(kind=>{const s=result.stats[kind];return `${e(BACKUP_LABELS[kind])}：新增 ${s.added}，相同 ${s.same} 已跳过，差异 ${s.different} 已保留`;}).join('；')}</p>${selected.includes('dreams')?`<p class="theater-dialog-note">${result.counts.candidates} 篇候选仍待选择，未自动成为正式章节。</p>`:''}<footer><button type="button" class="theater-btn" data-repeat>再次核对这份备份</button>${selected.includes('recent')?'<button type="button" class="theater-btn" data-read-recovered>查看找回的结果</button>':''}<button type="button" class="theater-btn primary" data-done>返回原页面</button></footer>`;
                        runtime.runtimeLog('info','备份恢复完成',{scope});
                        if (serverRecoveryEntry) {
                            void rememberServerEntries([serverRecoveryEntry]).then(() => refresh());
                        }
                    }finally{committing=false;view.writing(false);view.element.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
                }else if(button.hasAttribute('data-repeat'))await review();
                else if(button.hasAttribute('data-read-recovered')){view.close();await recoveredResults();}
                else if(button.hasAttribute('data-done'))view.close();
            }catch(error){failure(error);view.writing(false);if(button.isConnected)button.disabled=false;}
        });
        await choose(initialSource);
    }
    async function recoveredResults() {
        await initialize();const items=await storage.getRecovered();
        const dialog=restoreDialog(root(),'recent');
        dialog.body.innerHTML=items.length?items.map((item,i)=>`<section class="theater-backup-recovered-item"><button type="button" class="theater-backup-list-item" data-read="${i}"><b>${e(item.title||'找回的生成结果')}</b><small>${e(item.date||item.time||item.createdAt||'')}</small></button><button type="button" class="theater-btn" data-save-recovered="${i}">存入历史</button></section>`).join(''):'<p class="theater-dialog-note">暂无找回的结果。恢复时勾选“当前与最近结果”后，可在这里查看。</p>';
        dialog.body.addEventListener('click',event=>{const button=event.target.closest('[data-read],[data-save-recovered]');if(button){const save=button.hasAttribute('data-save-recovered'),item=items[Number(save?button.dataset.saveRecovered:button.dataset.read)];dialog.close();if(save)void runtime.saveToHistory(item);else runtime.openFullscreenReader(item);}});
    }
    function bind(documentRoot=document) {
        if(documentRoot.__theaterBackupHandler)documentRoot.removeEventListener('click',documentRoot.__theaterBackupHandler);
        if(documentRoot.__theaterBackupEntryHandler)documentRoot.removeEventListener('click',documentRoot.__theaterBackupEntryHandler,true);
        if(documentRoot.__theaterBackupChangeHandler)documentRoot.removeEventListener('change',documentRoot.__theaterBackupChangeHandler);
        const entryHandler=event=>{
            const button=event.target.closest?.('[data-theater-restore],#theater-import-inst-btn,#theater-import-history-btn,#theater-dream-import-backup,[data-history-import]');
            if(!button||button.disabled||!root()?.contains(button))return;
            const scope=button.dataset.theaterRestore||({'theater-import-inst-btn':'instructions','theater-import-history-btn':'history','theater-dream-import-backup':'dreams'}[button.id])||'history';
            const source = ['github', 'server'].includes(button.dataset.restoreSource) ? button.dataset.restoreSource : 'local';
            runtime.runtimeLog('info','备份导入入口点击',{scope:['all','instructions','history','dreams','recent'].includes(scope)?scope:'all',source});
        };
        const changeHandler=event=>{
            if (['theater-backup-enabled', 'theater-backup-server'].includes(event.target.id)) {
                const schedule = root()?.querySelector('[data-backup-schedule]');
                if (schedule) schedule.hidden = !document.getElementById('theater-backup-enabled')?.checked
                    && !document.getElementById('theater-backup-server')?.checked;
            }
            if(event.target.matches?.('[data-backup-confirm-reduction]'))refreshBackupControls();
            if(event.target.matches?.('#theater-backup-repository,#theater-backup-token')){
                const message=event.target.closest('.theater-config-extra-body')?.querySelector('[data-backup-connection-feedback]');
                if(message&&message.dataset.state!=='pending'){message.hidden=true;message.textContent='';}
            }
        };
        documentRoot.__theaterBackupEntryHandler=entryHandler;documentRoot.addEventListener('click',entryHandler,true);
        documentRoot.__theaterBackupChangeHandler=changeHandler;documentRoot.addEventListener('change',changeHandler);
        const handler=async event=>{
            const button=event.target.closest('[data-theater-restore],[data-backup-action]');if(!button||button.disabled)return;
            event.preventDefault();
            const testing=button.dataset.backupAction==='test';
            let testedConnection=null;
            const connectionChanged=()=>{const current=readForm();return testedConnection&&(current.repository!==testedConnection.repository||current.token!==testedConnection.token);};
            if(testing){button.disabled=true;button.textContent='测试中…';button.setAttribute('aria-busy','true');connectionFeedback(button,'正在测试连接…','pending');}
            try {
                if(button.hasAttribute('data-theater-restore')){await openRestore(button.dataset.theaterRestore,button.dataset.restoreSource||'local');return;}
                const action=button.dataset.backupAction;
                if(action==='settings'){runtime.activateTheaterTab('config');return;}
                if(!testing&&runtime.archiveClosed)throw archiveClosedError();
                if(action==='recovered'){await recoveredResults();return;}
                await initialize();
                if(busy)throw new Error('备份操作正在进行，请稍后再试');
                if(action==='save'){
                    const next=readForm(),previous=config;
                    const serverWasEnabled = canRescueToServer();
                    const serverChanged = next.server !== serverWasEnabled;
                    if(next.enabled&&!next.local&&!next.github)throw new Error('请至少开启一种保存方式');
                    if(next.github){validateBackupRepository(next.repository);if(!next.token)throw new Error('请先填写 GitHub 访问密钥');}
                    if (serverChanged && next.server) await checkServerSession();
                    const saved = await storage.saveConfiguration(latest => ({
                        ...next, sourceId: latest?.sourceId || next.sourceId, ownerHandle: latest?.ownerHandle,
                        server: serverChanged ? next.server : latest?.server ?? next.server,
                    }), previous.repository!==next.repository);
                    config = saved.config;
                    if (serverChanged && next.server && origin && runtime.settings) {
                        await checkServerSession();
                        const off = { ...runtime.settings.serverBackupOff };
                        delete off[origin];
                        runtime.settings.serverBackupOff = off;
                        runtime.save?.();
                    } else if (serverChanged && !next.server) await syncServerOff();
                    if(saved.state)state=saved.state;
                    const serverToggle = document.getElementById('theater-backup-server');
                    if (serverToggle) serverToggle.checked = canRescueToServer();
                    refresh();
                    const input=document.getElementById('theater-backup-token');if(input){input.value='';input.placeholder=config.token?'密钥已保存，留空保留':'填写访问密钥';}
                    feedback('备份设置已保存');
                    const first=[...(config.enabled&&config.local&&(!previous.enabled||!previous.local)?['local']:[]),...(config.enabled&&config.github&&(!previous.enabled||!previous.github||previous.repository!==config.repository)?['github']:[]),
                        ...(canRescueToServer()&&!serverWasEnabled?['server']:[])];
                    if(first.length)await runBackup(first);
                }else if(action==='test'){
                    testedConnection=readForm();await createGithubBackupClient(testedConnection).test();
                    if(connectionChanged())connectionFeedback(button,'连接设置已变更，请重新测试。','changed');
                    else connectionFeedback(button,'连接成功：私有仓库可读取。请保存设置；写入权限将在首次上传时核对。','success');
                }else if(action==='clear-key'){
                    const saved = await storage.saveConfiguration(latest => ({ ...config, ...latest, token: '', github: false, ownerHandle: latest?.ownerHandle }));
                    config = saved.config;
                    const input=document.getElementById('theater-backup-token');if(input){input.value='';input.placeholder='填写访问密钥';}document.getElementById('theater-backup-github').checked=false;feedback('已清除本机保存的密钥，并关闭 GitHub 自动备份');connectionFeedback(button,'','idle');
                }else if(action==='save-server'){
                    if (!canRescueToServer()) throw new Error('请先开启「保存到酒馆服务器」并保存设置');
                    await runBackup(['server'], { action });
                }else if(action==='download'||action==='upload')await runBackup([action==='download'?'local':'github'], { action });
                else if(action==='confirmed-backup'){
                    if(!root()?.querySelector('[data-backup-confirm-reduction]')?.checked)throw new Error('请先核对数据，并勾选确认是自己删除的');
                    await runBackup([...(config.local?['local']:[]),...(config.github?['github']:[])],{confirmed:true});
                }
            }catch(error){
                if(!testing&&runtime.archiveRescue?.reportWriteFailure())return;
                if(testing&&(!button.isConnected||connectionChanged())){connectionFeedback(button,'连接设置已变更，请重新测试。','changed');return;}
                const message=safeError(error);
                if(testing)connectionFeedback(button,`连接失败：${message}`,'error');else feedback(message);
                toastr.warning(message);
            }
            finally{if(button.isConnected&&testing){button.disabled=false;button.textContent='测试连接';button.removeAttribute('aria-busy');}refreshBackupControls();}
        };
        refresh();
        documentRoot.__theaterBackupHandler=handler;documentRoot.addEventListener('click',handler);
    }
    return { initialize,initializeServerAccount,onOpen,bind,openRestore,runBackup,noteSettingsSave:storage.noteSettingsSave, secret:()=>config.token,
        canRescueToGithub,canRescueToServer,runRescueBackup, serverAccountName: () => serverAccount?.name || '',
        settingsHTML:()=>backupSettingsHTML(configForDisplay(),displayedState(),{recoveredCount,progress}),diagnosticHTML:()=>backupDiagnosticHTML(displayedState(),progress),
        diagnosticText:()=>`酒馆服务器 ${backupStatusText(displayedState(),'server',progress)}；${backupStatusText(state,'local',progress)}；${backupStatusText(state,'github',progress)}${state.protection?'；'+state.protection:''}`,
        diagnosticLevel:()=>state.protection||state.local?.error||state.github?.error||localServerState()?.error||localServerState()?.notice||(canRescueToServer()&&!serverOwnerConfirmed())?'warn':'ok',
        hasAutomaticGithub:()=>config.enabled&&config.github,
    };
}

function confirmServerBackupAccount(account) {
    const context = globalThis.SillyTavern?.getContext();
    return context?.Popup?.show?.confirm?.('确认酒馆备份账号',
        `这些作品是存在这个浏览器里的，不分酒馆账号。要把它们备份到当前账号 ${e(account.name)} 吗？`,
        { okButton: '是，以后自动备份到这个账号', cancelButton: '先不了' }) ?? false;
}
