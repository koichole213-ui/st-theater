import { normalizeBackupData, stableJson, planBackupRestore } from './backup-data.js';
import { orderedHistory, newHistoryKey } from './history-collections.js';

export function createBackupStorage(runtime) {
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('本地备份存储读取失败')); });
    const done = tx => {
        const completion=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(new Error('本地备份存储事务未完成，原有数据已保留'));});
        // A request may reject before its enclosing transaction aborts. Keep that second
        // rejection handled even when the caller has already left its read/error path.
        void completion.catch(()=>{});return completion;
    };
    const db = () => { if (!runtime.idb) throw new Error('本地数据库未就绪，请保留站点数据并重新加载'); return runtime.idb; };
    const instructionState = () => ({ templates: runtime.settings.instructionTemplates || [], tags: runtime.settings.instructionTags || [],composers:runtime.settings.longDreamComposerDrafts || {} });
    let journal = null, applying = false;
    async function get(key) { const tx = db().transaction('kv'); const completed = done(tx); const value = await request(tx.objectStore('kv').get(key)); await completed; return value; }
    async function put(key, value) { const tx = db().transaction('kv', 'readwrite'), completed = done(tx); tx.objectStore('kv').put(value, key); await completed; }
    async function removeJournal() { const tx = db().transaction('kv', 'readwrite'), completed = done(tx); tx.objectStore('kv').delete('backup-restore-journal'); await completed; journal = null; }
    function applyInstructions(value) {
        applying = true;
        try { runtime.settings.instructionTemplates = value.templates; runtime.settings.instructionTags = value.tags;runtime.settings.longDreamComposerDrafts=value.composers || runtime.settings.longDreamComposerDrafts || {}; runtime.save(); }
        finally { applying = false; }
    }
    function available() {
        db();
        if (Object.values(runtime.storageReadErrors || {}).some(Boolean)) throw new Error('存档尚未完整读取，已暂停备份与恢复；请保留站点数据并重新加载');
    }
    async function rawRead(tx) {
        const kv = tx.objectStore('kv');
        const [history, dreams, folders, current, recent, recovered] = await Promise.all([
            request(tx.objectStore('history').getAll()), request(tx.objectStore('dreams').getAll()),
            ...['history-collections', 'current-result', 'recent', 'backup-recovered-results'].map(key => request(kv.get(key))),
        ]);
        return { history: history || [], dreams: dreams || [], folders: folders || [], current: current || null, recent: recent || [], recovered: recovered || [] };
    }
    async function snapshot() {
        available();
        await Promise.all([runtime.historyWriteQueue, runtime.resultStorageQueue]);
        const tx = db().transaction(['history', 'dreams', 'kv']), completed = done(tx);
        const raw = await rawRead(tx); await completed;
        const instructions = instructionState();
        return { raw, instructionSignature: stableJson(instructions), data: normalizeBackupData({ ...raw,dreams:raw.dreams.map(d=>({...d,composerDraft:instructions.composers[d.id] || d.composerDraft})), instructions: instructions.templates, instructionTags: instructions.tags }) };
    }
    function idle() {
        if (runtime.isGenerating || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) throw new Error('请先完成或停止生成与章节编辑，再恢复备份');
    }
    return {
        get, put, snapshot,
        async saveConfiguration(config, resetGithub = false) {
            const tx=db().transaction('kv','readwrite'),completed=done(tx),kv=tx.objectStore('kv');let nextState=null;
            try{
                if(resetGithub){nextState=await request(kv.get('backup-state'))||{};delete nextState.github;kv.put(nextState,'backup-state');}
                kv.put(config,'backup-config');
            }catch(error){try{tx.abort();}catch{}await completed.catch(()=>{});throw new Error('备份设置保存失败，原有配置已保留');}
            await completed;return nextState;
        },
        async withLease(operation) {
            const owner=newHistoryKey(), tx=db().transaction('kv','readwrite'), completed=done(tx), kv=tx.objectStore('kv');
            try {
                const current=await request(kv.get('backup-operation-lease'));
                if(current?.expires>Date.now())throw new Error('另一窗口正在备份或恢复，请稍后再试');
                kv.put({owner,expires:Date.now()+600000},'backup-operation-lease');
            }catch(error){try{tx.abort();}catch{}await completed.catch(()=>{});throw error;}
            await completed;
            try{return await operation();}
            finally{
                const release=db().transaction('kv','readwrite'), finished=done(release), store=release.objectStore('kv');
                try { const current=await request(store.get('backup-operation-lease'));if(current?.owner===owner)store.delete('backup-operation-lease');await finished; }
                catch { await finished.catch(()=>{}); }
            }
        },
        async recoverJournal() {
            journal = await get('backup-restore-journal');
            if (!journal) return;
            const current = stableJson(instructionState());
            if (current === journal.before) applyInstructions(journal.after);
            else await removeJournal();
        },
        noteSettingsSave() {
            if (!applying && journal && stableJson(instructionState()) !== stableJson(journal.after)) void removeJournal().catch(() => {});
        },
        async preview(packet, selected, sourceId) { idle(); const before = await snapshot(); return { before, plan: await planBackupRestore(before.data, packet, selected, sourceId) }; },
        async restore(packet, selected, sourceId, expected) {
            idle(); available();
            const before = await snapshot();
            if (stableJson(before.data) !== stableJson(expected.data)) throw new Error('预览后存档发生变化，请重新核对恢复预览');
            const plan = await planBackupRestore(before.data, packet, selected, sourceId);
            if (!plan.changed) return plan;
            const restoreSettings=selected.some(kind=>kind!=='recent');
            const settingsAfter={templates:plan.next.instructions,tags:plan.next.instructionTags,composers:{...instructionState().composers}};
            for(const dream of plan.additions.dreams)if(dream.composerDraft)settingsAfter.composers[dream.id]=dream.composerDraft;
            idle();
            const tx = db().transaction(['history', 'dreams', 'kv'], 'readwrite'), completed = done(tx);
            try {
                const actual = await rawRead(tx);
                if (stableJson(actual) !== stableJson(before.raw) || stableJson(instructionState()) !== before.instructionSignature) throw new Error('存档正在变化，请重新核对恢复预览');
                idle();
                for (const item of plan.additions.history) tx.objectStore('history').add(item);
                for (const dream of plan.additions.dreams) tx.objectStore('dreams').add(dream);
                if (selected.includes('history')) tx.objectStore('kv').put(plan.next.folders, 'history-collections');
                if (selected.includes('recent')) tx.objectStore('kv').put(plan.next.recovered, 'backup-recovered-results');
                if (restoreSettings) {
                    const nextJournal = { before: before.instructionSignature, after:settingsAfter };
                    tx.objectStore('kv').put(nextJournal, 'backup-restore-journal');
                }
            } catch (error) { try { tx.abort(); } catch {} await completed.catch(() => {}); throw error; }
            await completed;
            if (selected.includes('history')) { runtime.historyCache = orderedHistory([...before.raw.history, ...plan.additions.history]); runtime.historyCollections = plan.next.folders; }
            if (selected.includes('dreams')) runtime.longDreamCache = [...plan.additions.dreams, ...runtime.longDreamCache];
            if (restoreSettings) { journal = { before: before.instructionSignature, after:settingsAfter }; applyInstructions(journal.after); }
            runtime.refreshInstUI?.(); runtime.refreshHistList?.(); runtime.refreshTagControls?.(); runtime.renderLongDreamPanel?.();
            return plan;
        },
    };
}
