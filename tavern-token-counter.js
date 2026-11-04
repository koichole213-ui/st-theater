import { estimateTokenCount } from './token-estimator.js';
import { tavernRequestHeaders } from './vertex-credentials.js';
// Same local backend and text-message adjustment as Tavern's counterWrapperOpenAIAsync.
export function tokenizerForModel(model='') {
 const name=String(model).toLowerCase();
 if(/gemini|gemma/.test(name))return 'gemma';
 if(/claude/.test(name))return 'claude';
 if(/deepseek|\br1\b/.test(name))return 'deepseek';
 if(/qwen|qwq/.test(name))return 'qwen2';
 if(/llama[- ]?3/.test(name))return 'llama3';
 if(/mistral/.test(name))return 'mistral';
 if(/gpt-4o|gpt-4\.[15]|gpt-5|\bo[134](?:-|$)/.test(name))return 'gpt-4o';
 if(/gpt-4/.test(name))return 'gpt-4';
 if(/gpt-3\.5/.test(name))return 'gpt-3.5-turbo';
 return null;
}
const cache=new Map();
export async function estimateTavernTexts(texts,settings={},options={}) {
 const values=texts.map(v=>String(v||''));
 const fallback=()=>({counts:values.map(estimateTokenCount),source:'字符粗估（分词统计暂不可用）',tokenizer:null});
 try {
  let tokenizer=tokenizerForModel(settings.apiModel);
  if(settings.apiMode==='main'){
   // Read only the selected tokenizer name. Never call a host remote-tokenize branch.
   const host=await (options.loadHost||(()=>import('/scripts/tokenizers.js')))();
   const selected=String(host.getTokenizerModel());
   const local=new Set(['gemma','gemini','claude','deepseek','qwen2','llama3','llama','mistral','yi','jamba','command-r','command-a','nemo']);
   tokenizer=local.has(selected)?selected:tokenizerForModel(selected);
  }
  if(!tokenizer)return fallback();
  const fetchImpl=options.fetchImpl||globalThis.fetch,headers=await (options.getHeaders||tavernRequestHeaders)();
  const counts=await Promise.all(values.map(async text=>{
   if(!text)return 0;
   const key=tokenizer+'\0'+text;
   if(cache.has(key))return cache.get(key);
   const task=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{
     const res=await fetchImpl('/api/tokenizers/openai/count?model='+encodeURIComponent(tokenizer),{method:'POST',headers,signal:controller.signal,body:JSON.stringify([{role:'system',content:text}])});
     if(!res.ok)throw Error('tokenizer unavailable');const data=await res.json();
     if(typeof data.token_count!=='number'||!Number.isFinite(data.token_count)||data.token_count<1)throw Error('invalid count');
     return Math.max(0,data.token_count-1);
    }finally{clearTimeout(timer)}
   })();
   cache.set(key,task);if(cache.size>64)cache.delete(cache.keys().next().value);
   try{return await task}catch{cache.delete(key);throw Error('tokenizer unavailable')}
  }));
  return {counts,source:'酒馆分词估算',tokenizer};
 }catch{return fallback()}
}
