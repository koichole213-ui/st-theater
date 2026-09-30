// theater-api: receives live state and cross-feature callbacks from index.js.
import { createRequestTrace } from './request-trace.js';
import { resolveMainApiModel, DEFAULT_MAX_OUTPUT_TOKENS, API_PROTOCOLS, normalizeMaxTokens, resolveProtocol, buildApiEndpoint, buildApiRequest } from './api-client.js';
import { createRequestMetrics, markFallback } from './request-metrics.js';
import { requestMainApi, requestCustomApi } from './api-runtime.js';
import { classifyRequestFailure } from './request-diagnostics.js';

export function createTheaterApi(runtime) {
// @theater-source-begin captureActualRequestTrace
function captureActualRequestTrace(details, purpose = 'support') {
    if (purpose !== 'creative') return;
    runtime.lastRequestTrace = createRequestTrace({ ...details, purpose });
}
// @theater-source-end captureActualRequestTrace

// @theater-source-begin captureGenerationApiRoute
function captureGenerationApiRoute(ctx = SillyTavern.getContext()) {
    const mode = runtime.settings.apiMode === 'main' ? 'main' : 'custom';
    const shouldStream = runtime.settings.streamEnabled !== false;
    if (mode === 'main') {
        const oai = ctx?.oai_settings || globalThis.oai_settings;
        return Object.freeze({
            mode,
            protocol: 'main',
            model: resolveMainApiModel(ctx, oai) || '未识别',
            maxTokens: oai?.openai_max_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            shouldStream,
        });
    }
    const custom = Object.freeze({
        apiUrl: String(runtime.settings.apiUrl || '').replace(/\/+$/, ''),
        apiProtocol: runtime.settings.apiProtocol || API_PROTOCOLS.AUTO,
        apiKey: runtime.settings.apiKey || '',
        apiModel: runtime.settings.apiModel || '',
        maxOutputTokens: normalizeMaxTokens(runtime.settings.maxOutputTokens),
    });
    return Object.freeze({
        mode,
        protocol: resolveProtocol(custom.apiProtocol, custom.apiUrl),
        model: custom.apiModel || '未填写',
        maxTokens: custom.maxOutputTokens,
        shouldStream,
        custom,
    });
}
// @theater-source-end captureGenerationApiRoute

// @theater-source-begin requestConfiguredGenerationApi
async function requestConfiguredGenerationApi({
    apiRoute = captureGenerationApiRoute(),
    ctx = SillyTavern.getContext(),
    systemPrompt,
    userPrompt,
    onChunk,
    signal,
    requestOptions = {},
    metricScope = '',
} = {}) {
    runtime.lastApiResponseSummary = null;
    runtime.lastApiConnectionSummary = null;
    const scope = metricScope ? `:${metricScope}` : '';
    if (apiRoute.mode === 'main') {
        runtime.lastRequestMetrics = createRequestMetrics(`main:ChatCompletionService${scope}`);
        return generateWithMainAPI(
            ctx,
            systemPrompt,
            userPrompt,
            onChunk,
            apiRoute.shouldStream,
            signal,
            requestOptions,
        );
    }
    if (!apiRoute.custom?.apiUrl || !apiRoute.custom?.apiModel) {
        throw new Error('请先在【设置】里填好 API URL 和模型再生成');
    }
    runtime.lastRequestMetrics = createRequestMetrics(`custom:${apiRoute.protocol}${scope}`);
    return callCustomAPIStream(
        systemPrompt,
        userPrompt,
        onChunk,
        apiRoute.shouldStream,
        signal,
        { ...requestOptions, apiConfig: apiRoute.custom },
    );
}
// @theater-source-end requestConfiguredGenerationApi

// @theater-source-begin generateWithMainAPI
async function generateWithMainAPI(ctx, systemPrompt, prompt, onChunk, shouldStream = true, signal = runtime.abortController?.signal, requestOptions = {}) {
    runtime.lastApiResponseSummary = null;
    runtime.lastApiConnectionSummary = null;
    return requestMainApi({
        ctx,
        systemPrompt,
        userPrompt: prompt,
        messages: requestOptions.messages,
        postProcessing: requestOptions.postProcessing || '',
        presetName: requestOptions.presetName || runtime.settings.selectedPresetName || '未指定',
        onChunk,
        onRequest: details => captureActualRequestTrace(details, requestOptions.tracePurpose),
        shouldStream,
        signal,
        log: runtime.runtimeLog,
        onFallback: path => markFallback(runtime.lastRequestMetrics, path),
        onPath: path => { if (runtime.lastRequestMetrics) runtime.lastRequestMetrics.path = path; },
        onResponse: summary => { runtime.lastApiResponseSummary = summary; },
        tavernHelper: window.TavernHelper,
        getContext: () => SillyTavern.getContext(),
    });
}
// @theater-source-end generateWithMainAPI

// @theater-source-begin callCustomAPIStream
async function callCustomAPIStream(systemPrompt, userPrompt, onChunk, shouldStream = true, signal = runtime.abortController?.signal, requestOptions = {}) {
    runtime.lastApiResponseSummary = null;
    runtime.lastApiConnectionSummary = null;
    const apiConfig = requestOptions.apiConfig || {
        apiUrl: runtime.settings.apiUrl,
        apiProtocol: runtime.settings.apiProtocol,
        apiKey: runtime.settings.apiKey,
        apiModel: runtime.settings.apiModel,
        maxOutputTokens: runtime.settings.maxOutputTokens,
    };
    return requestCustomApi({
        config: apiConfig,
        systemPrompt,
        userPrompt,
        messages: requestOptions.messages,
        postProcessing: requestOptions.postProcessing || '',
        presetName: requestOptions.presetName || runtime.settings.selectedPresetName || '未指定',
        onChunk,
        onRequest: details => captureActualRequestTrace(details, requestOptions.tracePurpose),
        shouldStream,
        signal,
        log: runtime.runtimeLog,
        onFallback: path => markFallback(runtime.lastRequestMetrics, path),
        onResponse: summary => { runtime.lastApiResponseSummary = summary; },
        onConnection: summary => { runtime.lastApiConnectionSummary = summary; },
    });
}
// @theater-source-end callCustomAPIStream

// @theater-source-begin fetchModelList
async function fetchModelList() {
    const url = ($('#theater-api-url').val() || runtime.settings.apiUrl || '').trim().replace(/\/+$/, '');
    const key = ($('#theater-api-key').val() || runtime.settings.apiKey || '').trim();
    if (!url) { toastr.warning('请先填写 API URL'); return; }

    const $btn = $('#theater-fetch-models-btn');
    $btn.addClass('disabled');
    $btn.find('span').text('获取中…');
    runtime.clearRequestIssue();

    try {
        const protocol = resolveProtocol($('#theater-api-protocol').val() || runtime.settings.apiProtocol, url);
        if (protocol === API_PROTOCOLS.ANTHROPIC && !key) throw new Error('Anthropic 接口需要 API Key');
        const apiEndpoint = buildApiEndpoint(url, protocol);
        const modelsEndpoint = apiEndpoint.replace(/\/(chat\/completions|messages)$/, '/models');
        const headers = protocol === API_PROTOCOLS.ANTHROPIC
            ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
            : (key ? { 'Authorization': `Bearer ${key}` } : {});
        runtime.lastRequestContext = { kind: '模型列表' };
        const res = await fetch(modelsEndpoint, { method: 'GET', headers });
        if (!res.ok) {
            throw { code: 'THEATER_HTTP_STATUS', theaterFailure: { status: res.status } };
        }
        const data = await res.json();

        if (!data) throw new Error('无法获取模型列表');

        // 解析模型列表：兼容 { data: [...] } 和直接数组两种格式
        const rawList = data.data || data;
        const models = (Array.isArray(rawList) ? rawList : [])
            .map(m => typeof m === 'string' ? m : m.id)
            .filter(Boolean)
            .sort();

        if (!models.length) {
            toastr.warning('API返回了数据但没找到可用模型');
            return;
        }

        // 渲染下拉菜单
        const $select = $('#theater-api-model-select');
        $select.empty();
        $select.append('<option value="">-- 选择模型 --</option>');
        models.forEach(m => {
            $select.append(`<option value="${runtime.esc(m)}" ${m === runtime.settings.apiModel ? 'selected' : ''}>${runtime.esc(m)}</option>`);
        });
        $select.show();

        if (runtime.settings.apiModel && models.includes(runtime.settings.apiModel)) {
            $select.val(runtime.settings.apiModel);
        }

        toastr.success(`找到 ${models.length} 个模型`);
    } catch (e) {
        const issue = classifyRequestFailure(e, { stage: '模型列表' });
        runtime.lastRequestIssue = issue;
        console.error('[Theater] 获取模型列表失败:', issue.signal);
        runtime.theaterError(runtime.requestFailureMessage('获取模型失败', issue));
    } finally {
        $btn.removeClass('disabled');
        $btn.find('span').text('获取模型列表');
    }
}
// @theater-source-end fetchModelList

// @theater-source-begin testAPIConnection
async function testAPIConnection() {
    const url = ($('#theater-api-url').val() || runtime.settings.apiUrl || '').trim().replace(/\/+$/, '');
    const key = ($('#theater-api-key').val() || runtime.settings.apiKey || '').trim();
    const model = $('#theater-api-model-select').val() || $('#theater-api-model').val()?.trim();
    if (!url) { toastr.warning('请先填写 API URL'); return; }
    if (!model) { toastr.warning('请先选择或填写模型名称'); return; }

    const $btn = $('#theater-test-api-btn');
    $btn.addClass('disabled');
    $btn.find('span').text('测试中…');
    runtime.clearRequestIssue();

    try {
        runtime.lastRequestContext = { kind: '连接测试' };
        const request = buildApiRequest({
            url,
            protocol: $('#theater-api-protocol').val() || runtime.settings.apiProtocol,
            key,
            model,
            systemPrompt: '',
            userPrompt: 'Hi',
            maxTokens: 16,
            stream: false,
        });
        if (request.protocol === API_PROTOCOLS.ANTHROPIC && !key) { toastr.warning('Anthropic 接口需要 API Key'); return; }
        runtime.runtimeLog('info', '连接测试请求发出', {
            protocol: request.protocol,
            preset_generation_options: 'not_inherited',
        });
        const res = await fetch(request.endpoint, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body) });
        if (res.ok) toastr.success('连接成功！');
        else {
            const issue = classifyRequestFailure({
                code: 'THEATER_HTTP_STATUS',
                theaterFailure: { status: res.status },
            }, { stage: '连接测试' });
            runtime.lastRequestIssue = issue;
            runtime.theaterError(runtime.requestFailureMessage('连接失败', issue));
        }
    } catch (e) {
        const issue = classifyRequestFailure(e, { stage: '连接测试' });
        runtime.lastRequestIssue = issue;
        runtime.theaterError(runtime.requestFailureMessage('连接失败', issue));
    } finally {
        $btn.removeClass('disabled');
        $btn.find('span').text('测试连接');
    }
}
// @theater-source-end testAPIConnection

return { captureActualRequestTrace, captureGenerationApiRoute, requestConfiguredGenerationApi, generateWithMainAPI, callCustomAPIStream, fetchModelList, testAPIConnection };
}
