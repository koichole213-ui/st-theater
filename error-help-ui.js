import { diagnosticSignalInfo, diagnosticSignalCatalog } from './request-diagnostics.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function errorHelpHTML(issue,{retained=false,actions=false}={}){
 if(!issue)return '';
 const info=diagnosticSignalInfo(issue.signal),steps=info.steps||[info.action];
 return '<article class="theater-error-help"><div class="teh-heading"><b>'+esc(info.title)+'</b><span>'+esc(issue.httpStatus?'HTTP '+issue.httpStatus:issue.signal)+'</span></div><p>'+esc(info.detail)+'</p><small>'+esc(issue.stage||'请求处理')+' · '+esc(issue.signal)+'</small>'+(retained||issue.retained?'<p class="teh-retained">此前已收到的正文已保留。</p>':'')+(issue.contextNote?'<p>'+esc(issue.contextNote)+'</p>':'')+'<p>建议：'+esc(info.action)+'</p><details><summary>查看处理建议</summary><ol>'+steps.map(step=>'<li>'+esc(step)+'</li>').join('')+'</ol></details>'+(actions?'<div class="teh-actions"><button type="button" data-error-diagnostics>打开诊断自查</button><button type="button" data-error-copy>复制问题信息</button></div><p data-error-status role="status"></p>':'')+'</article>';
}
export function errorCatalogHTML(){
 const list=diagnosticSignalCatalog();
 return '<div class="theater-error-library"><div class="teh-filters"><select data-error-group aria-label="按问题类别筛选"><option value="">全部类别</option>'+[...new Set(list.map(c=>c.group||'其他情况'))].map(g=>'<option>'+esc(g)+'</option>').join('')+'</select><input type="search" data-error-search placeholder="搜索错误码、凭证、超时…" aria-label="搜索错误类别"></div><div data-error-items>'+list.map(c=>'<details class="teh-catalog-item" data-error-item data-group="'+esc(c.group||'其他情况')+'"><summary>'+esc(c.title)+'<small>'+esc(c.signal)+'</small></summary><p>'+esc(c.detail)+'</p><ol>'+(c.steps||[c.action]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol></details>').join('')+'</div><p data-error-empty hidden>没有匹配的问题，请换一个关键词。</p></div>';
}
export function bindErrorLibrary(root){
 for(const library of root?.querySelectorAll?.('.theater-error-library')||[]){
  if(library.dataset.bound)continue;library.dataset.bound='true';
  const filter=()=>{const group=library.querySelector('[data-error-group]').value,q=library.querySelector('[data-error-search]').value.trim().toLowerCase();let count=0;for(const item of library.querySelectorAll('[data-error-item]')){item.hidden=!!(group&&item.dataset.group!==group||q&&!item.textContent.toLowerCase().includes(q));if(!item.hidden)count++}library.querySelector('[data-error-empty]').hidden=count>0};
  library.addEventListener('input',filter);library.addEventListener('change',filter);
 }
}
