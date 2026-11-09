import { escapeBackup as e } from './backup-ui.js';

export const ARCHIVE_SEARCH_SCOPE = '<p class="theater-dialog-note archive-scope">仅查找当前浏览器在此酒馆地址下可访问的存档。</p>';
export function archiveSearchHTML(result) {
    const candidates=result.candidates||[],partial=result.status!=='complete'||result.truncated;
    const retry='<button type="button" class="theater-btn" data-archive-retry>重新查找</button>';
    const backup='<button type="button" class="theater-btn primary" data-archive-backup>恢复备份</button>';
    if(!candidates.length){
        const title=result.status==='unsupported'?'当前浏览器无法列出本地存档库':result.status==='failed'?'查找未完成':partial?'查找未完成，暂未找到可恢复的旧存档':'未找到可恢复的旧存档';
        const note=result.status==='unsupported'?'可以更新浏览器后重试，或使用已有备份恢复。':partial?'部分存档未能读取或查找达到上限，请稍后重试。':'其他酒馆地址、浏览器或设备里的存档不在本次查找范围内。';
        return ARCHIVE_SEARCH_SCOPE+`<div class="archive-state" role="${partial?'alert':'status'}"><b>${title}</b><p class="theater-dialog-note">${note}</p></div><footer>${retry}${backup}</footer>`;
    }
    const warning=partial?'<p class="theater-dialog-note archive-warning" role="status">部分存档未能读取或查找达到上限，以下是已找到的内容。</p>':'';
    return ARCHIVE_SEARCH_SCOPE+warning+`<p class="archive-found-title" role="status">找到 ${candidates.length} 份旧存档</p>`+candidates.map((candidate,index)=>{
        const packet=candidate.packet;
        const samples=[...packet.data.history.map(item=>({title:item.title,kind:'普通历史'})),...packet.data.dreams.map(item=>({title:item.title,kind:`长梦 · ${item.chapters.length} 章`}))];
        return `<section class="archive-candidate"><label class="archive-candidate-heading"><input type="radio" name="archive-choice" value="${index}" data-archive-choice ${index===0?'checked':''}><span><b>${e(candidate.label)}</b><span>历史 ${packet.counts.history} 条 · 长梦 ${packet.counts.dreams} 部</span></span></label>${candidate.latest?`<p class="theater-dialog-note">最新作品：${e(new Date(candidate.latest).toLocaleDateString('zh-CN'))}</p>`:''}<details class="archive-samples"><summary>查看作品预览</summary><ul>${samples.slice(0,10).map(item=>`<li><span>${e(String(item.title||'未命名作品').slice(0,100))}</span><small>${e(item.kind)}</small></li>`).join('')}</ul>${samples.length>10?`<p class="theater-dialog-note">另有 ${samples.length-10} 篇作品。</p>`:''}</details></section>`;
    }).join('')+'<p class="theater-dialog-note">先核对内容，确认后才恢复。</p>'+`<footer>${retry}<button type="button" class="theater-btn primary" data-archive-review>核对恢复内容</button></footer>`;
}
