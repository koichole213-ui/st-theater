import { closeModelPicker } from './model-picker.js';
import {API_CHANNELS,apiChannel,channelFields,channelBaseUrl} from './api-channels.js';
import {activeVertexCredential,importVertexCredential} from './vertex-credentials.js';

let channelFormRevision=0;

export function apiChannelSettingsHTML(config={},esc=value=>String(value)) {
    const channel=apiChannel(config);
    const groups=[['模型官方',['glm','volc','deepseek','qwen','kimi']],['Google 云服务',['vertex']],['多模型平台',['silicon','router']],['其他线路',['custom']]];
    return `<div class="theater-channel-card"><div class="theater-config-field"><label for="theater-api-channel"><b>API 渠道</b><small>选择后显示对应的连接设置</small></label><select id="theater-api-channel" class="theater-select">${groups.map(([name,ids])=>`<optgroup label="${name}">${ids.map(id=>`<option value="${id}" ${channel===id?'selected':''}>${API_CHANNELS[id].name}</option>`).join('')}</optgroup>`).join('')}</select></div><p class="theater-channel-note" id="theater-api-channel-note">${API_CHANNELS[channel].note}</p></div>
    <div class="theater-config-field" id="theater-api-plan-field" ${API_CHANNELS[channel].plan?'':'hidden'}><label for="theater-api-plan"><b>接入类型</b><small>区分按量服务与编程套餐</small></label><select id="theater-api-plan" class="theater-select"><option value="standard">标准 API · 按量计费</option><option value="coding" ${config.apiPlan==='coding'?'selected':''}>Coding Plan · 编程套餐</option></select></div>
    <div id="theater-vertex-fields" ${channel==='vertex'?'':'hidden'} data-credential-id="${esc(config.vertexCredentialId||'')}">
      <div class="theater-vertex-credential"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i><div><b id="theater-vertex-status">${config.vertexCredentialId?'已保存凭证引用':'尚未绑定 JSON 凭证'}</b><p>凭证由酒馆保管，小剧场只保存连接引用。</p></div><button type="button" id="theater-vertex-import" class="theater-btn">导入 JSON 凭证</button><input type="file" id="theater-vertex-file" accept=".json,application/json" hidden></div>
      <button type="button" id="theater-vertex-bind" class="theater-btn theater-config-text-button">使用酒馆已有凭证</button>
      <p class="theater-channel-note">与酒馆共用一份当前凭证；更换后，旧预设需重新绑定。不支持自动切换多份 JSON。</p>
      <div class="theater-vertex-grid"><div class="theater-config-field"><label for="theater-vertex-project"><b>项目 ID</b><small>使用凭证所属项目</small></label><input id="theater-vertex-project" class="theater-input" readonly placeholder="由酒馆凭证自动读取" value="${esc(config.vertexProjectId||'')}" autocomplete="off"></div><div class="theater-config-field"><label for="theater-vertex-location"><b>地区</b><small>需与模型支持地区匹配</small></label><input id="theater-vertex-location" class="theater-input" list="theater-vertex-regions" value="${esc(config.vertexLocation||'global')}" placeholder="global"><datalist id="theater-vertex-regions"><option value="global"><option value="us-central1"><option value="asia-southeast1"></datalist></div></div>
    </div>`;
}
export function readApiChannelFields() {
    const channel=$('#theater-api-channel').val()||'custom';
    return channelFields({apiChannel:channel,apiPlan:$('#theater-api-plan').val(),
        vertexCredentialId:$('#theater-vertex-fields').attr('data-credential-id'),vertexProjectId:$('#theater-vertex-project').val(),vertexLocation:$('#theater-vertex-location').val()});
}
export function syncApiChannelForm(config) {
    if(!$('#theater-api-channel').length) return;
    closeModelPicker();
    if(config) {
        channelFormRevision++;
        $('#theater-api-channel').val(apiChannel(config));$('#theater-api-plan').val(config.apiPlan||'standard');
        $('#theater-vertex-fields').attr('data-credential-id',config.vertexCredentialId||'');
        $('#theater-vertex-project').val(config.vertexProjectId||'');$('#theater-vertex-location').val(config.vertexLocation||'global');
    }
    const channel=$('#theater-api-channel').val()||'custom',vertex=channel==='vertex';
    $('#theater-api-channel-note').text(API_CHANNELS[channel].note);
    $('#theater-api-plan-field').prop('hidden',!API_CHANNELS[channel].plan);
    $('#theater-vertex-fields').prop('hidden',!vertex);
    $('#theater-api-protocol').closest('.theater-config-field').prop('hidden',channel!=='custom');
    $('#theater-api-url,#theater-api-key').closest('.theater-config-field').prop('hidden',vertex);
    $('#theater-vertex-status').text($('#theater-vertex-fields').attr('data-credential-id')?'已保存凭证引用':'尚未绑定 JSON 凭证');
    $('#theater-api-model').attr('placeholder',channel==='volc'?'模型名称或推理接入点 ID':vertex?'Gemini 模型 ID':'模型名称');
    $('#theater-fetch-models-btn span').text(API_CHANNELS[channel].models?'获取':'手动填写');
}
export function bindApiChannelSettings(runtime,$d) {
    syncApiChannelForm();
    channelFormRevision++;
    let importing=false;
    const busy=()=>runtime.isGenerating||runtime.longDreamGenerationController?.getState?.()?.status==='generating';
    $d.off('change.tchannelpreset').on('change.tchannelpreset','#theater-api-preset-select',()=>{channelFormRevision++});
    const resetPreset=()=>{runtime.settings.selectedApiPresetId='';runtime.refreshApiPresetControls('')};
    $d.off('change.tchannel').on('change.tchannel','#theater-api-channel',function(){
        channelFormRevision++;const channel=$(this).val();$('#theater-api-plan').val('standard');$('#theater-api-url').val(channelBaseUrl(channel));
        $('#theater-api-key,#theater-api-model').val('');$('#theater-api-model-select').empty().hide();
        $('#theater-api-protocol').val(channel==='custom'?'auto':'openai');
        $('#theater-vertex-fields').attr('data-credential-id','');$('#theater-vertex-project').val('');
        resetPreset();syncApiChannelForm();
    });
    $d.off('change.tchannelplan').on('change.tchannelplan','#theater-api-plan',function(){channelFormRevision++;$('#theater-api-url').val(channelBaseUrl($('#theater-api-channel').val(),$(this).val()));syncApiChannelForm()});
    $d.off('click.tverteximport').on('click.tverteximport','#theater-vertex-import',async function(){
        if(busy()||importing){toastr.warning('请等当前请求结束后再更换凭证');return}
        const ok=await SillyTavern.getContext().Popup.show.confirm('导入 Vertex 凭证？','这会更换酒馆当前的 Vertex 服务账号，也会影响酒馆及其他 Vertex 预设。凭证只交给酒馆后端保管。');
        if(ok&&!busy()) $('#theater-vertex-file').trigger('click');
    });
    $d.off('change.tvertexfile').on('change.tvertexfile','#theater-vertex-file',async function(){
        const file=this.files?.[0];this.value='';if(!file||importing)return;
        if(busy()){toastr.warning('请等当前请求结束后再更换凭证');return}
        if(file.size>65536){toastr.warning('凭证文件过大，请选择服务账号 JSON');return}
        const token=++channelFormRevision;importing=true;$('#theater-vertex-import').prop('disabled',true);
        try {
            const raw=await file.text();
            if(token!==channelFormRevision||busy())return;
            const ref=await importVertexCredential(raw);
            if(token!==channelFormRevision||$('#theater-api-channel').val()!=='vertex') {toastr.warning('酒馆凭证已更新；当前表单已切换，请在 Vertex 中重新绑定');return}
            $('#theater-vertex-fields').attr('data-credential-id',ref.vertexCredentialId);$('#theater-vertex-project').val(ref.vertexProjectId);syncApiChannelForm();
            toastr.success('凭证已交给酒馆保管，请保存当前 API 配置');
        }catch{toastr.error('凭证未能导入，请检查服务账号 JSON 与酒馆版本；不会记录凭证内容')}
        finally{importing=false;$('#theater-vertex-import').prop('disabled',false)}
    });
    $d.off('click.tvertexbind').on('click.tvertexbind','#theater-vertex-bind',async function(){
        const token=++channelFormRevision;
        try{const ref=await activeVertexCredential();if(token!==channelFormRevision||$('#theater-api-channel').val()!=='vertex')return;
            if(!ref){toastr.warning('酒馆尚未保存可用的 Vertex 服务账号 JSON');return}
            $('#theater-vertex-fields').attr('data-credential-id',ref.id);$('#theater-vertex-project').val('');syncApiChannelForm();toastr.success('已绑定酒馆当前凭证；请求使用该凭证所属项目，请保存设置');
        }catch{toastr.error('无法读取酒馆凭证状态，请检查酒馆版本及登录状态')}
    });
}

// A late support response must not populate another channel's form.
const formRequests = new WeakMap();
export function beginApiFormRequest(runtime, kind, config) {
    const requests = formRequests.get(runtime) || {};
    formRequests.set(runtime, requests);
    const token = {}; requests[kind] = token;
    const latest = () => requests[kind] === token;
    const current = () => {
        if (!latest()) return false;
        const form = runtime.readApiFormConfig();
        return apiChannel(form) === apiChannel(config)
            && ['apiUrl', 'apiKey', 'apiProtocol', 'apiPlan', 'vertexCredentialId', 'vertexLocation', ...(kind === 'test' ? ['apiModel'] : [])]
                .every(key => String(form[key] || '') === String(config[key] || ''));
    };
    return { latest, current };
}
