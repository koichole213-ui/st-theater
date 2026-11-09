import { createCompleteBackup, normalizeBackupData, itemFingerprint, digest, MAX_BACKUP_BYTES } from './backup-data.js';

const limits = { databases:100, records:10000, bytes:MAX_BACKUP_BYTES, openMs:2500, readMs:5000, totalMs:30000 };
const cancelled = () => Object.assign(new Error('旧存档查找已取消'), {name:'AbortError'});
const interrupted = () => new Error('旧存档未能完整读取');
const list = value => Array.isArray(value) ? value : [];
const epoch = '1970-01-01T00:00:00.000Z';

// Never request a version: if the listed database disappeared, abort its creation.
function openExisting(factory, name, signal, timeout) {
    return new Promise((resolve, reject) => {
        let request, settled=false;
        const finish=(error,db) => {
            if(settled){db?.close();return;}
            settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
            if(error){db?.close();reject(error);}else resolve(db);
        };
        const abort=()=>finish(cancelled());
        const timer=setTimeout(()=>finish(interrupted()),timeout);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        try {
            request=factory.open(name);
            request.onupgradeneeded=()=>{try{request.transaction.abort();}catch{}finish(interrupted());};
            request.onsuccess=()=>finish(null,request.result);
            request.onerror=()=>finish(interrupted());
            request.onblocked=()=>finish(interrupted());
        }catch{finish(interrupted());}
    });
}

function readCompatible(db, name, signal, budget, timeout) {
    const names=[...db.objectStoreNames];
    const named=/^st[-_]theater(?:$|[-_.: ])/i.test(name);
    const complete=['history','dreams','kv'].every(key=>names.includes(key));
    if(!complete&&!named)return Promise.resolve(null);
    const stores=['history','dreams','kv'].filter(key=>names.includes(key));
    if(!stores.some(key=>key==='history'||key==='dreams'))return Promise.resolve(null);
    return new Promise((resolve,reject)=>{
        let tx,settled=false;
        const data={history:[],dreams:[],folders:[]};
        const finish=(error)=>{
            if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
            if(error){try{tx?.abort();}catch{}reject(error);}else resolve(data);
        };
        const abort=()=>finish(cancelled());
        const timer=setTimeout(()=>finish(interrupted()),timeout);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        try{
            tx=db.transaction(stores,'readonly');
            // Similar store names alone are insufficient for unrelated databases.
            if(!named&&(['history','dreams'].some(key=>tx.objectStore(key).keyPath!=='id')||tx.objectStore('kv').keyPath!==null)){
                tx.abort();finish();return;
            }
            tx.oncomplete=()=>finish();tx.onerror=tx.onabort=()=>finish(interrupted());
            for(const key of ['history','dreams'].filter(key=>stores.includes(key))){
                const req=tx.objectStore(key).openCursor();
                req.onerror=()=>finish(interrupted());
                req.onsuccess=()=>{
                    if(settled)return;
                    const cursor=req.result;if(!cursor)return;
                    try{budget(cursor.value);data[key].push(cursor.value);cursor.continue();}catch{finish(interrupted());}
                };
            }
            if(stores.includes('kv')){
                // Read this single archive key, never backup configuration or secrets.
                const req=tx.objectStore('kv').get('history-collections');
                req.onerror=()=>finish(interrupted());
                req.onsuccess=()=>{if(settled)return;try{if(req.result){budget(req.result);data.folders=list(req.result);}}catch{finish(interrupted());}};
            }
        }catch{finish(interrupted());}
    });
}

function archiveData(data) {
    return normalizeBackupData({
        history:list(data.history).filter(item=>item&&typeof item.html==='string'&&item.html.trim()),
        folders:list(data.folders),
        dreams:list(data.dreams).filter(item=>item&&Array.isArray(item.chapters)).map(item=>({...item,createdAt:item.createdAt||epoch,updatedAt:item.updatedAt||item.createdAt||epoch})),
    });
}

// All reads are scoped to this page's storage partition. No disk/network access.
export async function discoverOldArchives({ factory=globalThis.indexedDB, currentDatabaseName='st-theater', settings={}, current={}, signal, onProgress=()=>{}, constraints={} }={}) {
    const cap={...limits,...constraints},started=Date.now();
    let bytes=0,records=0,checked=0,failed=0,truncated=false;
    const candidates=[];
    const check=()=>{if(signal?.aborted)throw cancelled();if(Date.now()-started>cap.totalMs)throw interrupted();};
    const budget=value=>{
        check();records++;bytes+=new TextEncoder().encode(JSON.stringify(value)).byteLength;
        if(records>cap.records||bytes>cap.bytes){truncated=true;throw interrupted();}
    };
    const baseline=archiveData(current),fingerprints={history:new Set(),dreams:new Set()};
    for(const kind of ['history','dreams'])for(const item of baseline[kind]){check();fingerprints[kind].add(await itemFingerprint(kind,item));}
    async function candidate(raw,key,label){
        check();const data=archiveData(raw);
        if(!data.history.length&&!data.dreams.length)return;
        let missing=false;
        for(const kind of ['history','dreams'])for(const item of data[kind]){check();if(!fingerprints[kind].has(await itemFingerprint(kind,item)))missing=true;}
        if(!missing)return;
        const sourceId=await digest('st-theater-old-archive:'+key);
        const packet=await createCompleteBackup(data,{sourceId,deviceName:label,now:new Date(0)});
        check();
        const dates=[...data.history.map(x=>x.date),...data.dreams.map(x=>x.updatedAt)].map(x=>Date.parse(x)).filter(x=>Number.isFinite(x)&&x>0);
        candidates.push({label,packet,latest:dates.length?Math.max(...dates):null});
    }
    // Only the known legacy archive fields are considered; never copy settings.
    try{
        const legacy={history:list(settings.history),dreams:list(settings.longDreams),folders:list(settings.historyCollections)};
        if(legacy.history.length||legacy.dreams.length){for(const item of [...legacy.history,...legacy.dreams,...legacy.folders])budget(item);await candidate(legacy,'legacy-settings','旧版设置存档');}
    }catch(error){if(error.name==='AbortError')throw error;failed++;}
    let databases=[],supported=typeof factory?.databases==='function',enumerated=false;
    if(supported){
        try{
            // Browsers cannot cancel enumeration; discard a late result after closing.
            databases=await new Promise((resolve,reject)=>{
                let settled=false;
                const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
                const abort=()=>finish(cancelled());
                const timer=setTimeout(()=>finish(interrupted()),cap.openMs);
                signal?.addEventListener('abort',abort,{once:true});
                if(signal?.aborted){abort();return;}
                Promise.resolve().then(()=>factory.databases()).then(x=>finish(null,x),()=>finish(interrupted()));
            });
            enumerated=true;
        }catch(error){if(error.name==='AbortError')throw error;failed++;}
    }
    const names=[...new Set(list(databases).map(x=>x?.name).filter(name=>typeof name==='string'&&name&&name!==currentDatabaseName))];
    if(names.length>cap.databases)truncated=true;
    for(const name of names.slice(0,cap.databases)){
        let db;
        try{
            check();if(truncated&&(records>cap.records||bytes>cap.bytes))break;
            db=await openExisting(factory,name,signal,cap.openMs);
            const raw=await readCompatible(db,name,signal,budget,cap.readMs);
            db.close();db=null;
            if(raw)await candidate(raw,'database:'+name,`旧存档 ${candidates.length+1}`);
        }catch(error){if(error.name==='AbortError')throw error;failed++;if(Date.now()-started>cap.totalMs){truncated=true;break;}}
        finally{db?.close();}
        checked++;onProgress({checked,total:Math.min(names.length,cap.databases)});
    }
    if(signal?.aborted)throw cancelled();
    return {candidates,checked,failed,truncated,status:!supported?'unsupported':!enumerated?'failed':failed||truncated?'partial':'complete'};
}
