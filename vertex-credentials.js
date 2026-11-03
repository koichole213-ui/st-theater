// Only secret IDs and project metadata may leave these helpers. Never log raw JSON.
let activeRequests=0,writingCredential=false;
export function beginVertexRequest() {
    if(writingCredential) throw new Error('Vertex 凭证正在更换，请稍后重试');
    activeRequests++;let released=false;return ()=>{if(!released){released=true;activeRequests--}};
}
export const VERTEX_SECRET_KEY='vertexai_service_account_json';
export async function tavernRequestHeaders() {
    const ctx=globalThis.SillyTavern?.getContext?.();
    if(typeof ctx?.getRequestHeaders==='function') return ctx.getRequestHeaders();
    const {getRequestHeaders}=await import('/script.js');
    return getRequestHeaders();
}
export async function activeVertexCredential({fetchImpl=globalThis.fetch,getHeaders=tavernRequestHeaders,signal}={}) {
    const response=await fetchImpl('/api/secrets/read',{method:'POST',headers:await getHeaders(),signal});
    if(!response.ok) throw new Error('无法读取酒馆凭证状态，请检查登录状态及酒馆版本');
    const state=await response.json();
    const items=state?.[VERTEX_SECRET_KEY];
    const active=Array.isArray(items)?items.find(item=>item?.active===true):null;
    return active&&typeof active.id==='string'?{id:active.id}:null;
}
export async function validateVertexJson(raw,{cryptoImpl=globalThis.crypto}={}) {
    let data;
    try { data=JSON.parse(raw); } catch { throw new Error('凭证文件不是有效的 JSON'); }
    if(data?.type!=='service_account'||typeof data.private_key!=='string'||typeof data.client_email!=='string'
        ||!/^.+@.+\.iam\.gserviceaccount\.com$/.test(data.client_email)
        ||!/^[a-z0-9][a-z0-9-]{3,62}$/.test(String(data.project_id||''))) throw new Error('需要 Google Cloud 服务账号 JSON，当前文件类型或必要字段不正确');
    try {
        const base64=data.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
        const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        await cryptoImpl.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    } catch { throw new Error('JSON 中的私钥格式无效，请重新下载服务账号凭证'); }
    return {type:'service_account',project_id:data.project_id,client_email:data.client_email,private_key:data.private_key,
        ...(typeof data.private_key_id==='string'?{private_key_id:data.private_key_id}:{}),token_uri:'https://oauth2.googleapis.com/token'};
}
export async function importVertexCredential(raw,{fetchImpl=globalThis.fetch,getHeaders=tavernRequestHeaders,cryptoImpl=globalThis.crypto}={}) {
    if(writingCredential||activeRequests) throw new Error('Vertex 请求正在进行，暂不能更换凭证');
    writingCredential=true;
    try {
    const credential=await validateVertexJson(raw,{cryptoImpl});
    const response=await fetchImpl('/api/secrets/write',{method:'POST',headers:await getHeaders(),
        body:JSON.stringify({key:VERTEX_SECRET_KEY,value:JSON.stringify(credential),label:'小剧场 Vertex 凭证'})});
    if(!response.ok) throw new Error('酒馆未能保存凭证，原设置未更新');
    const result=await response.json();
    if(typeof result?.id!=='string'||!result.id) throw new Error('酒馆未返回凭证引用，请检查酒馆版本');
    return {vertexCredentialId:result.id,vertexProjectId:credential.project_id};
    } finally { writingCredential=false; }
}
