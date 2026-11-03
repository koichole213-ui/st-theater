import {buildApiRequest,API_PROTOCOLS} from './api-client.js';
import {apiChannel,channelConfigError} from './api-channels.js';
import {activeVertexCredential,tavernRequestHeaders} from './vertex-credentials.js';
import {createDiagnosticError,REQUEST_DIAGNOSTIC_SIGNAL} from './request-diagnostics.js';

function configError(message) {
    const error=createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONFIG,{code:'THEATER_CONFIG',phase:'body',transport:'custom'});
    // Fixed user-facing guidance only. No server response or credential material.
    error.message=message;return error;
}
export async function checkVertexCredential(config,options={}) {
    const active=await activeVertexCredential(options);
    if(!active||active.id!==config.vertexCredentialId) throw configError('Vertex 当前凭证已改变或失效，请重新绑定对应凭证后保存预设');
}
export function createIndependentRequest(config,args,{getHeaders=tavernRequestHeaders}={}) {
    const channel=apiChannel(config),vertex=channel==='vertex';
    const message=channelConfigError(config);
    if(message) throw configError(message);
    const request=buildApiRequest({url:vertex?'https://vertex.invalid/v1':config.apiUrl,
        protocol:channel==='custom'?(config.apiProtocol||API_PROTOCOLS.AUTO):API_PROTOCOLS.OPENAI,
        key:vertex?'':config.apiKey,model:config.apiModel,...args});
    if(!vertex) return request;
    return Promise.resolve(getHeaders()).then(headers => ({...request,endpoint:'/api/backends/chat-completions/generate',headers,
        body:{...request.body,chat_completion_source:'vertexai',vertexai_auth_mode:'full',
            vertexai_region:config.vertexLocation,use_sysprompt:true,include_reasoning:false}}));
}
