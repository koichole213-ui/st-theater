// Channel metadata is separate from the wire protocol. Legacy presets remain custom.
export const API_CHANNELS = Object.freeze({
    custom: { name: '自定义接口', url: '', note: '继续使用自己的中转站或兼容服务，自行填写地址与请求格式。', models: true },
    glm: { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', note: '使用智谱官方连接；标准 API 与 Coding Plan 分开配置。', plan: true },
    volc: { name: '火山引擎', url: 'https://ark.cn-beijing.volces.com/api/v3', note: '使用火山方舟连接；模型名称或推理接入点 ID 以控制台为准。', plan: true },
    deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', note: '使用 DeepSeek 官方 API，按所选模型配置连接。', models: true },
    qwen: { name: '阿里百炼 / 千问', url: '', note: '填写百炼控制台对应地区的 OpenAI 兼容地址，模型与密钥需属于同一服务地区。', models: true },
    kimi: { name: 'Kimi / 月之暗面', url: 'https://api.moonshot.cn/v1', note: '使用 Kimi 开放平台的标准 API，与编程订阅分开。', models: true },
    vertex: { name: 'Google Vertex · JSON 凭证', url: '/api/backends/chat-completions/generate', note: '通过酒馆后端的 JSON 凭证连接 Google Cloud，此入口先支持 Gemini。' },
    silicon: { name: '硅基流动', url: 'https://api.siliconflow.cn/v1', note: '模型 ID 使用平台提供的完整名称。', models: true },
    router: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', note: '通过 OpenRouter 连接模型，模型 ID 使用平台提供的完整名称。', models: true },
});
const text=(value,max=300)=>String(value||'').trim().slice(0,max);
export function apiChannel(config={}) { return Object.hasOwn(API_CHANNELS,config.apiChannel)?config.apiChannel:'custom'; }
export function channelFields(config={}) {
    const channel=apiChannel(config);
    if(channel==='custom') return {};
    return { apiChannel:channel, apiPlan:API_CHANNELS[channel].plan && config.apiPlan==='coding'?'coding':'standard',
        ...(channel==='vertex'?{vertexCredentialId:text(config.vertexCredentialId,100),vertexProjectId:text(config.vertexProjectId),vertexLocation:text(config.vertexLocation,80)||'global'}:{}) };
}
export function captureIndependentConfig(config={}) {
    const channel=apiChannel(config);
    return { apiUrl:channel==='vertex'?API_CHANNELS.vertex.url:text(config.apiUrl,1000).replace(/\/+$/,''),
        apiKey:channel==='vertex'?'':text(config.apiKey,4000),apiModel:text(config.apiModel),
        apiProtocol:channel==='custom'?(config.apiProtocol||'auto'):'openai',
        maxOutputTokens:config.maxOutputTokens,...channelFields(config) };
}
export function channelConfigError(config={}, {requireModel=true}={}) {
    const channel=apiChannel(config);
    if(channel==='vertex') {
        if(!config.vertexCredentialId) return '请先导入或绑定酒馆中的 Vertex JSON 凭证';
        if(config.vertexProjectId&&!/^[a-z0-9][a-z0-9-]{3,62}$/.test(String(config.vertexProjectId))) return '请填写凭证所属的 Google Cloud 项目 ID';
        if(!/^(global|[a-z]+(?:-[a-z]+)+\d)$/.test(String(config.vertexLocation||''))) return '请填写有效的 Vertex 地区，例如 global 或 us-central1';
        if(requireModel&&!/^gemini-[a-z0-9._-]+$/i.test(String(config.apiModel||''))) return '此入口只支持 Gemini，请填写 Gemini 模型 ID';
    } else {
        try { const url=new URL(config.apiUrl); if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error(); }
        catch { return '请填写有效的 HTTP(S) 接口地址，地址中不要包含凭证'; }
    }
    if(requireModel&&!String(config.apiModel||'').trim()) return '请先选择或填写模型名称';
    return '';
}
export function channelBaseUrl(channel,plan='standard') {
    if(plan==='coding'&&channel==='glm') return 'https://open.bigmodel.cn/api/coding/paas/v4';
    if(plan==='coding'&&channel==='volc') return 'https://ark.cn-beijing.volces.com/api/coding/v3';
    return API_CHANNELS[channel]?.url||'';
}
