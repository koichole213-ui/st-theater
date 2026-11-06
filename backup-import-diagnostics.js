// Fixed labels and numeric metadata only: never log file names, paths, credentials or contents.
export const BACKUP_IMPORT_STAGES = Object.freeze({
    opening:'正在打开恢复窗口…', choosing:'请选择备份文件', selected:'已选择文件，准备读取…',
    zipLibrary:'正在加载 ZIP 组件…', zipRead:'正在读取 ZIP…', manifest:'正在读取备份清单…',
    validate:'正在校验备份内容…', normalize:'正在整理备份内容…', preview:'正在核对可恢复内容…',
    remoteList:'正在读取远端备份列表…', remoteDownload:'正在下载所选备份…', writing:'正在恢复所选内容…',
});
const scopes = new Set(['all','instructions','history','dreams','recent']);
const sources = new Set(['local','github']);
let sequence=0;
export function backupFileMetadata(files) {
    return { files:files.length, bytes:files.reduce((sum,file)=>sum+(Number(file.size)||0),0),
        format:files.every(file=>/\.zip$/i.test(file.name))?'zip':files.every(file=>/\.json$/i.test(file.name))?'json':files.every(file=>/\.html?$/i.test(file.name))?'html':'other' };
}
export function createBackupImportTrace(runtime, { scope='all', source='local', onProgress=()=>{}, waitMs=8000 } = {}) {
    const id=++sequence, started=Date.now();
    let stage='opening', timer=null, ended=false;
    const write=(level,status,meta={})=>{
        const numeric={};for(const key of ['files','bytes','added','same','different'])if(Number.isFinite(meta[key]))numeric[key]=Math.max(0,meta[key]);
        const format=['zip','json','html','other'].includes(meta.format)?meta.format:undefined;
        try { runtime.runtimeLog?.(level,'备份导入诊断',{operation:id,scope:scopes.has(scope)?scope:'all',source:sources.has(source)?source:'local',stage,status,elapsedMs:Math.max(0,Date.now()-started),...numeric,...(format?{format}:{})}); } catch {}
    };
    const clear=()=>{clearTimeout(timer);timer=null;};
    return {
        step(next,meta={}){if(ended)return;clear();stage=Object.hasOwn(BACKUP_IMPORT_STAGES,next)?next:'opening';write('info','开始',meta);onProgress(BACKUP_IMPORT_STAGES[stage]);timer=setTimeout(()=>{if(ended)return;write('warn','仍在等待');onProgress(`${BACKUP_IMPORT_STAGES[stage]}仍在等待，可到诊断页查看进度。`);},waitMs);},
        finish(meta={}){if(ended)return;ended=true;clear();write('info','完成',meta);onProgress('');},
        fail(){if(ended)return;ended=true;clear();write('warn','失败');onProgress('');return `备份操作未完成（${BACKUP_IMPORT_STAGES[stage].replace(/[.…]+$/,'')}），请到诊断页复制日志。`;},
        cancel(){if(ended)return;ended=true;clear();write('info','已取消');},
    };
}
