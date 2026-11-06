import { BACKUP_FORMAT, BACKUP_MANIFEST, MAX_BACKUP_BYTES, createCompleteBackup, parseCompleteBackup, normalizeBackupData, backupCounts, backupProtection, digest, stableJson } from './backup-data.js';
import { createGithubBackupClient, validateBackupRepository } from './backup-github.js';
import { createBackupStorage } from './backup-storage.js';
import { backupSettingsHTML, backupDiagnosticHTML, backupStatusText, BACKUP_LABELS, escapeBackup as e, restoreDialog } from './backup-ui.js';
import { newHistoryKey } from './history-collections.js';
import { parseInstructionBackup } from './instruction-backup.js';
import { normalizeHistoryBackup, HISTORY_ARCHIVE_MANIFEST, historyItemsFromArchive } from './history-backup.js';
import { parseLongDreamBackup } from './long-dream-backup.js';
import { LONG_DREAM_ARCHIVE_MANIFEST, parseLongDreamArchive } from './long-dream-archive.js';
import { sanitizeLogText } from './runtime-log.js';

export function createTheaterBackup(runtime) {
    const storage = createBackupStorage(runtime);
    let config = { enabled:false, local:true, github:false, days:1, repository:'', token:'', deviceName:'本机' };
    let state = {}, ready = null, busy = false;
    const root = () => document.querySelector('.theater-popup');
    const safeError = error => sanitizeLogText(error?.message || '备份操作未完成，请重试');
    const idle = () => { if (runtime.isGenerating || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) throw new Error('请先完成或停止生成与章节编辑，再恢复备份'); };
    async function initialize() {
        if (!ready) ready = (async () => {
            if (!runtime.idb) return;
            try {
                const saved = await storage.get('backup-config');
                config = { ...config, ...saved, days: [1,3,7].includes(Number(saved?.days)) ? Number(saved.days) : 1, sourceId:saved?.sourceId || newHistoryKey(), deviceName:saved?.deviceName || (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? '手机' : '电脑') };
                if (!saved) await storage.put('backup-config',config);
                state = await storage.get('backup-state') || {};
                if(state.github?.time&&state.github.repository!==config.repository)delete state.github;
                await storage.recoverJournal();
            } catch { state.protection = '备份设置未能完整读取，自动备份已暂停；请重新加载。'; config.enabled = false; }
        })();
        await ready;
    }
    function refresh() {
        document.querySelectorAll('[data-backup-status]').forEach(el => { el.textContent = backupStatusText(state,el.dataset.backupStatus); });
        document.querySelectorAll('[data-backup-protection]').forEach(el => { el.hidden=!state.protection; el.textContent=state.protection || ''; });
    }
    async function saveState() { await storage.put('backup-state',state); refresh(); }
    function feedback(text) { const el = root()?.querySelector('[data-backup-feedback]'); if (el) el.textContent=text; }
    async function exclusive(operation) {
        if (busy) throw new Error('备份操作正在进行，请稍后再试');
        busy=true;
        try {
            return await storage.withLease(operation);
        } finally { busy=false; }
    }
    function readForm() {
        const value = id => document.getElementById(id)?.value;
        const checked = id => document.getElementById(id)?.checked;
        return { ...config, enabled:!!checked('theater-backup-enabled'), local:!!checked('theater-backup-local'), github:!!checked('theater-backup-github'), days:Number(value('theater-backup-interval')) || 1, repository:String(value('theater-backup-repository') || '').trim(), deviceName:String(value('theater-backup-device') || '').trim().slice(0,30) || '本机', token:value('theater-backup-token')?.trim() || config.token };
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
    async function runBackup(kinds, { automatic=false, confirmed=false } = {}) {
        await initialize();
        if(!kinds.length)throw new Error('请先在备份设置中选择保存方式');
        return exclusive(async () => {
            config=await storage.get('backup-config') || config;
            state=await storage.get('backup-state') || {};
            const snapshot=await storage.snapshot();
            const packet=await createCompleteBackup(snapshot.data,config);
            const reduced=backupProtection(state.baseline,packet.counts);
            if (reduced.length && !confirmed) {
                const labels={...BACKUP_LABELS,chapters:'正式章节',retained:'保留版本',candidates:'待选择候选',drafts:'已保存草稿'};
                state.protection=`${reduced.map(k=>`${labels[k]}从 ${state.baseline[k]} 变为 ${packet.counts[k]}`).join('；')}。自动备份已暂停，旧备份保留；请先核对数据。`;
                await saveState(); throw new Error(state.protection);
            }
            if (!reduced.length) delete state.protection;
            const now=Date.now(), interval=config.days*86400000;
            const due=kinds.filter(kind=>!automatic || ((!state[kind]?.lastAttempt || now-state[kind].lastAttempt>300000) && (!state[kind]?.time || now-state[kind].time>=interval) && (state[kind]?.checksum!==packet.checksum || (kind==='github' && state[kind]?.repository!==config.repository))));
            if (!due.length) { await saveState(); return; }
            const bytes=await zipPacket(packet), outcomes=[];
            for (const kind of due) {
                const previous=state[kind] || {}; state[kind]={...previous,lastAttempt:now};
                try {
                    if (kind==='local') download(bytes,`theater-backup-${new Date(now).toISOString().replace(/[:.]/g,'-')}.zip`);
                    else await createGithubBackupClient(config).upload(bytes,{...config,counts:packet.counts,timestamp:now});
                    state[kind]={time:now,lastAttempt:now,checksum:packet.checksum,repository:kind==='github'?config.repository:undefined};
                    state.baseline=packet.counts; outcomes.push(kind==='local'?'已发起本机下载，请核对浏览器下载记录':'GitHub 上传成功，文件校验通过');
                    runtime.runtimeLog('info',kind==='local'?'完整备份已发起本机下载':'GitHub完整备份上传并校验成功',{history:packet.counts.history,dreams:packet.counts.dreams,instructions:packet.counts.instructions});
                } catch (error) {
                    state[kind].error=safeError(error); outcomes.push(`${kind==='local'?'本机':'GitHub'}备份失败：${state[kind].error}`);
                    runtime.runtimeLog('warn','定期备份未完成',{destination:kind,reason:state[kind].error});
                }
                await saveState();
            }
            feedback(outcomes.join('；'));
            if (!automatic && outcomes.length) toastr.info(outcomes.join('；'));
        });
    }
    async function onOpen() {
        await initialize(); refresh();
        if (!config.enabled) return;
        const kinds=[...(config.local?['local']:[]),...(config.github?['github']:[])];
        if (!kinds.length) return;
        try { await runBackup(kinds,{automatic:true}); }
        catch(error) {
            if (busy) return;
            state.protection=safeError(error); refresh();
            try { await saveState(); } catch {}
            runtime.runtimeLog('warn','自动备份已暂停',{reason:state.protection});
        }
    }
    async function decodeFile(file,scope) {
        if (file.size>MAX_BACKUP_BYTES) throw new Error('备份文件超过 128 MB，请分项导入');
        let data;
        try {
            if (/\.zip$/i.test(file.name)) {
                const JSZip=await runtime.loadJSZip(), zip=await JSZip.loadAsync(file);
                const entries=Object.values(zip.files).filter(x=>!x.dir);
                if (entries.length>5000 || entries.reduce((n,x)=>n+Number(x._data?.uncompressedSize || 0),0)>MAX_BACKUP_BYTES) throw new Error('备份解压内容超过安全上限');
                const findManifest=name=>entries.find(x=>x.name.replace(/\\/g,'/').split('/').pop().toLowerCase()===name.toLowerCase());
                const completeManifest=findManifest(BACKUP_MANIFEST),dreamManifest=findManifest(LONG_DREAM_ARCHIVE_MANIFEST),historyManifest=findManifest(HISTORY_ARCHIVE_MANIFEST);
                if (completeManifest) data=JSON.parse(await completeManifest.async('string'));
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
        if (data?.format===BACKUP_FORMAT) return parseCompleteBackup(data);
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
        await initialize(); idle();
        if (!root()) return;
        root().querySelector('.theater-backup-dialog')?.close();
        const view=restoreDialog(root(),scope);
        const allowed=scope==='all'?Object.keys(BACKUP_LABELS):[scope];
        let packet=null, preview=null, entries=[], selected=[...allowed], ticket=0, committing=false;
        function options(){return `<div class="theater-backup-source-tabs"><button type="button" class="theater-btn" data-source="local">本地文件</button><button type="button" class="theater-btn" data-source="github">GitHub 仓库</button></div>`;}
        async function choose(source='local') {
            const current=++ticket; view.error(''); preview=null;
            view.body.innerHTML=options();
            view.body.querySelector(`[data-source="${source}"]`).setAttribute('aria-pressed','true');
            if (source==='local') {
                view.body.insertAdjacentHTML('beforeend',`<label class="theater-backup-file"><b>选择备份文件</b><input type="file" data-backup-file accept=".zip,.json${scope==='history'?',.html,.htm':''}" ${scope==='history'?'multiple':''}></label><p class="theater-dialog-note">先读取和预览，确认前不会写入存档。</p>${scope==='instructions'?'<button type="button" class="theater-btn" data-legacy-instructions>导入其他指令文件</button>':''}`);
                return;
            }
            view.body.insertAdjacentHTML('beforeend','<p class="theater-dialog-note">正在读取远端备份列表…</p>');
            try {
                entries=await createGithubBackupClient(config).list();
                if (!view.alive()||current!==ticket)return;
                const devices=[...new Set(entries.map(x=>x.device))];
                view.body.innerHTML=options()+`<p class="theater-dialog-note">${e(config.repository)}</p><label class="theater-backup-device-filter">备份设备<select class="theater-select" data-device><option value="">全部设备</option>${devices.map((d,i)=>`<option value="${i}">${e(d)}</option>`).join('')}</select></label><div data-backup-list></div><p class="theater-dialog-note">配置丢失时，可到设置中重新填写仓库与密钥，再取回备份。</p>`;
                view.body.querySelector('[data-source=github]').setAttribute('aria-pressed','true');
                const render=()=>{const index=view.body.querySelector('[data-device]').value, device=index===''?'':devices[Number(index)];
                    view.body.querySelector('[data-backup-list]').innerHTML=entries.map((x,i)=>({x,i})).filter(({x})=>!device||x.device===device).slice(0,100).map(({x,i})=>`<button type="button" class="theater-backup-list-item" data-remote="${i}"><b>${e(new Date(x.time).toLocaleString('zh-CN',{hour12:false}))}</b><small>${e(x.device)} · 历史 ${x.history} 条 · 长梦 ${x.dreams} 部 · 指令 ${x.instructions} 条</small></button>`).join('')||'<p class="theater-dialog-note">这个来源还没有备份。</p>';};
                view.body.querySelector('[data-device]').addEventListener('change',render); render();
            }catch(error){if(view.alive()&&current===ticket)view.error(safeError(error));}
        }
        async function review() {
            const current=++ticket; view.error('');
            const oldConfirm=view.body.querySelector('[data-confirm]');if(oldConfirm)oldConfirm.disabled=true;
            const nextPreview=await storage.preview(packet,selected,config.sourceId);
            if(!view.alive()||current!==ticket)return;
            preview=nextPreview;
            const plan=preview.plan,c=packet.counts;
            view.body.innerHTML=`<p class="theater-dialog-note">备份检查通过 · ${e(packet.deviceName)} · ${e(new Date(packet.exportedAt).toLocaleString('zh-CN',{hour12:false}))}</p><p class="theater-dialog-note">${scope==='all'?'选择需要恢复的内容':'本次仅恢复'+e(BACKUP_LABELS[scope])}</p>${allowed.map(kind=>`<label class="theater-backup-pick"><input type="checkbox" value="${kind}" ${selected.includes(kind)?'checked':''}><span><b>${e(BACKUP_LABELS[kind])}</b><small>${kind==='dreams'?`正式章节 ${c.chapters} 篇，待选择候选 ${c.candidates} 篇；保留版本 ${c.retained} 篇，草稿 ${c.drafts} 份`:kind==='recent'?'恢复为可找回的副本，保留当前内容':`${c[kind]} 条`}</small></span></label>`).join('')}
              <p class="theater-dialog-note theater-backup-policy">补回缺失内容，保留当前内容。同一记录内容相同才跳过，差异版本另存；不凭同名合并，不清理已有重复记录。${selected.includes('dreams')?'候选恢复后仍待选择，不会自动成为正式章节。':''}</p>
              <table class="theater-backup-counts"><thead><tr><th>类别</th><th>新增</th><th>相同跳过</th><th>保留差异</th></tr></thead><tbody>${selected.map(kind=>{const s=plan.stats[kind];return `<tr><td>${e(BACKUP_LABELS[kind])}</td><td>${s.added}</td><td>${s.same}</td><td>${s.different}</td></tr>`;}).join('')}</tbody></table>
              <footer><button type="button" class="theater-btn" data-back>重新选择</button><button type="button" class="theater-btn primary" data-confirm ${!plan.changed||!selected.length?'disabled':''}>${plan.changed?'确认恢复所选内容':'无需重复恢复'}</button></footer>`;
            view.body.querySelectorAll('.theater-backup-pick input').forEach(input=>input.addEventListener('change',async()=>{selected=[...view.body.querySelectorAll('.theater-backup-pick input:checked')].map(x=>x.value);try{await review();}catch(error){view.error(safeError(error));}}));
        }
        view.element.addEventListener('change',async event=>{
            if(committing)return;
            if(!event.target.matches('[data-backup-file]'))return;
            const files=[...event.target.files]; if(!files.length)return;
            const current=++ticket;view.error('');
            try {
                const packets=await Promise.all(files.map(file=>decodeFile(file,scope)));
                if(!view.alive()||current!==ticket)return;
                packet=packets.length===1?packets[0]:{packets,deviceName:`${packets.length} 份备份`,exportedAt:packets[0].exportedAt,counts:packets.reduce((sum,x)=>{for(const k of Object.keys(x.counts))sum[k]=(sum[k]||0)+x.counts[k];return sum;},{})};
                await review();
            }catch(error){view.error(safeError(error));}
        });
        view.element.addEventListener('click',async event=>{
            const button=event.target.closest('button');if(!button||button.disabled)return;
            if(committing)return;
            try {
                if(button.dataset.source)await choose(button.dataset.source);
                else if(button.hasAttribute('data-back'))await choose();
                else if(button.hasAttribute('data-legacy-instructions')){view.close();runtime.importInstructionTemplates();}
                else if(button.hasAttribute('data-remote')){
                    const current=++ticket;button.disabled=true;
                    const bytes=await createGithubBackupClient(config).download(entries[Number(button.dataset.remote)]);
                    if(!view.alive()||current!==ticket)return;
                    packet=await decodeFile(new File([bytes],'backup.zip'),scope);await review();
                }else if(button.hasAttribute('data-confirm')){
                    committing=true;view.writing(true);view.element.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
                    try {
                        const result=await exclusive(()=>storage.restore(packet,selected,config.sourceId,preview.before));
                        if(!view.alive())return;
                        view.body.innerHTML=`<h3>所选内容已恢复</h3><p class="theater-dialog-note">${selected.map(kind=>{const s=result.stats[kind];return `${e(BACKUP_LABELS[kind])}：新增 ${s.added}，相同 ${s.same} 已跳过，差异 ${s.different} 已保留`;}).join('；')}</p>${selected.includes('dreams')?`<p class="theater-dialog-note">${result.counts.candidates} 篇候选仍待选择，未自动成为正式章节。</p>`:''}<footer><button type="button" class="theater-btn" data-repeat>再次核对这份备份</button>${selected.includes('recent')?'<button type="button" class="theater-btn" data-read-recovered>查看找回的结果</button>':''}<button type="button" class="theater-btn primary" data-done>返回原页面</button></footer>`;
                        runtime.runtimeLog('info','备份恢复完成',{scope});
                    }finally{committing=false;view.writing(false);view.element.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
                }else if(button.hasAttribute('data-repeat'))await review();
                else if(button.hasAttribute('data-read-recovered')){view.close();await recoveredResults();}
                else if(button.hasAttribute('data-done'))view.close();
            }catch(error){view.error(safeError(error));view.writing(false);if(button.isConnected)button.disabled=false;}
        });
        await choose(initialSource);
    }
    async function recoveredResults() {
        await initialize();const items=await storage.get('backup-recovered-results')||[];
        const dialog=restoreDialog(root(),'recent');
        dialog.body.innerHTML=items.length?items.map((item,i)=>`<section class="theater-backup-recovered-item"><button type="button" class="theater-backup-list-item" data-read="${i}"><b>${e(item.title||'找回的生成结果')}</b><small>${e(item.date||item.time||item.createdAt||'')}</small></button><button type="button" class="theater-btn" data-save-recovered="${i}">存入历史</button></section>`).join(''):'<p class="theater-dialog-note">暂无找回的结果。恢复时勾选“当前与最近结果”后，可在这里查看。</p>';
        dialog.body.addEventListener('click',event=>{const button=event.target.closest('[data-read],[data-save-recovered]');if(button){const save=button.hasAttribute('data-save-recovered'),item=items[Number(save?button.dataset.saveRecovered:button.dataset.read)];dialog.close();if(save)void runtime.saveToHistory(item);else runtime.openFullscreenReader(item);}});
    }
    function bind(documentRoot=document) {
        if(documentRoot.__theaterBackupHandler)documentRoot.removeEventListener('click',documentRoot.__theaterBackupHandler);
        const handler=async event=>{
            const button=event.target.closest('[data-theater-restore],[data-backup-action]');if(!button||button.disabled)return;
            event.preventDefault();
            try {
                if(button.hasAttribute('data-theater-restore')){await openRestore(button.dataset.theaterRestore,button.dataset.restoreSource||'local');return;}
                const action=button.dataset.backupAction;
                if(action==='settings'){runtime.activateTheaterTab('config');return;}
                if(action==='recovered'){await recoveredResults();return;}
                await initialize();
                if(busy)throw new Error('备份操作正在进行，请稍后再试');
                if(action==='save'){
                    const next=readForm(),previous=config;
                    if(next.enabled&&!next.local&&!next.github)throw new Error('请至少开启一种保存方式');
                    if(next.github){validateBackupRepository(next.repository);if(!next.token)throw new Error('请先填写 GitHub 访问密钥');}
                    const newState=await storage.saveConfiguration(next,previous.repository!==next.repository);config=next;
                    if(newState){state=newState;refresh();}
                    const input=document.getElementById('theater-backup-token');if(input)input.value='';
                    feedback('备份设置已保存');
                    if(config.enabled){
                        const first=[...(config.local&&(!previous.enabled||!previous.local)?['local']:[]),...(config.github&&(!previous.enabled||!previous.github||previous.repository!==config.repository)?['github']:[])];
                        if(first.length)await runBackup(first);
                    }
                }else if(action==='test'){
                    button.disabled=true;await createGithubBackupClient(readForm()).test();feedback('私有仓库可读取；写入权限将在首次上传时核对。请保存连接设置后启用自动上传。');
                }else if(action==='clear-key'){
                    config={...config,token:'',github:false};await storage.put('backup-config',config);
                    const input=document.getElementById('theater-backup-token');if(input)input.value='';document.getElementById('theater-backup-github').checked=false;feedback('已清除本机保存的密钥，并关闭 GitHub 自动备份');
                }else if(action==='download'||action==='upload')await runBackup([action==='download'?'local':'github']);
                else if(action==='confirmed-backup'){
                    if(!root()?.querySelector('[data-backup-confirm-reduction]')?.checked)throw new Error('请先核对数据，并勾选确认是自己删除的');
                    await runBackup([...(config.local?['local']:[]),...(config.github?['github']:[])],{confirmed:true});
                }
            }catch(error){const message=safeError(error);feedback(message);toastr.warning(message);}
            finally{if(button.isConnected)button.disabled=false;}
        };
        documentRoot.__theaterBackupHandler=handler;documentRoot.addEventListener('click',handler);
    }
    return { initialize,onOpen,bind,openRestore,runBackup,noteSettingsSave:storage.noteSettingsSave, secret:()=>config.token,
        settingsHTML:()=>backupSettingsHTML(config,state),diagnosticHTML:()=>backupDiagnosticHTML(state),
        diagnosticText:()=>`${backupStatusText(state,'local')}；${backupStatusText(state,'github')}${state.protection?'；'+state.protection:''}`,
        diagnosticLevel:()=>state.protection||state.local?.error||state.github?.error?'warn':'ok',
    };
}
