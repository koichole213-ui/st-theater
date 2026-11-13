import { statusError } from './api-response.js';
import { estimateTavernTexts } from './tavern-token-counter.js';
import { showModelPicker } from './model-picker.js';
import { beginApiFormRequest } from './api-channel-settings.js';
import { beginVertexRequest } from './vertex-credentials.js';
import { createIndependentRequest, checkVertexCredential } from './independent-request.js';
import { captureIndependentConfig, apiChannel, channelConfigError, API_CHANNELS } from './api-channels.js';
import { beginPromptInspection, recordSentInspection } from './prompt-inspector.js';
// theater-api: receives live state and cross-feature callbacks from index.js.
import { captureLayoutApiSelection } from './layout-api.js';
import { createRequestTrace } from './request-trace.js';
import { resolveMainApiModel, DEFAULT_MAX_OUTPUT_TOKENS, API_PROTOCOLS, normalizeMaxTokens, resolveProtocol, buildApiEndpoint, buildApiRequest } from './api-client.js';
import { createRequestMetrics, markFallback, markCompleted, markFailed } from './request-metrics.js';
import { requestMainApi, requestCustomApi } from './api-runtime.js';
import { classifyRequestFailure } from './request-diagnostics.js';
import { beginRequestDiagnostics } from './request-ownership.js';

export function createTheaterApi(runtime, { presentModelPicker = showModelPicker } = {}) {
// @theater-source-begin captureActualRequestTrace
function captureActualRequestTrace(details, purpose = 'support') {
    if (purpose !== 'creative') return;
    const trace = runtime.lastRequestTrace = createRequestTrace({ ...details, purpose });
    // Display-only accounting. Never delay or modify the generation request.
    if (typeof estimateTavernTexts === 'function') estimateTavernTexts((details.messages || []).map(m => m.content),
        { apiMode: details.route === 'main' ? 'main' : 'custom', apiModel: details.model }).then(result => {
        if (runtime.lastRequestTrace !== trace) return;
        trace.messages.forEach((message, i) => { message.estimatedTokens = result.counts[i]; });
        trace.tokenCountSource = result.source;
    }).catch(() => {});
}
// @theater-source-end captureActualRequestTrace

// @theater-source-begin captureGenerationApiRoute
function captureGenerationApiRoute(ctx = SillyTavern.getContext()) {
    const mode = runtime.settings.apiMode === 'main' ? 'main' : 'custom';
    const shouldStream = runtime.settings.streamEnabled !== false;
    const layoutSelection = captureLayoutApiSelection(runtime.settings);
    if (mode === 'main') {
        const oai = ctx?.oai_settings || globalThis.oai_settings;
        return Object.freeze({
            mode,
            protocol: 'main',
            model: resolveMainApiModel(ctx, oai) || '未识别',
            maxTokens: oai?.openai_max_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            shouldStream, layoutSelection,
        });
    }
    const custom = Object.freeze(captureIndependentConfig({ ...runtime.settings,
        maxOutputTokens: normalizeMaxTokens(runtime.settings.maxOutputTokens),
    }));
    return Object.freeze({
        mode,
        protocol: resolveProtocol(custom.apiProtocol, custom.apiUrl),
        model: custom.apiModel || '未填写',
        maxTokens: custom.maxOutputTokens,
        shouldStream, layoutSelection,
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
    const diagnostics = beginRequestDiagnostics(runtime);
    const inspectionId = beginPromptInspection({ purpose: requestOptions.tracePurpose,
        label: requestOptions.inspectionLabel,
        round: requestOptions.inspectionRound || 1, presetName: requestOptions.presetName || runtime.settings.selectedPresetName,
        route: 'main', messages: requestOptions.messages, systemPrompt, userPrompt: prompt });
    try { return await requestMainApi({
        ctx,
        systemPrompt,
        userPrompt: prompt,
        messages: requestOptions.messages,
        postProcessing: requestOptions.postProcessing || '',
        recoverFormat: ['creative', 'continuation'].includes(requestOptions.tracePurpose),
        presetName: requestOptions.presetName || runtime.settings.selectedPresetName || '未指定',
        onChunk,
        onRequest: details => { if (diagnostics.current()) captureActualRequestTrace(details, requestOptions.tracePurpose); recordSentInspection(inspectionId, details); },
        shouldStream,
        signal,
        log: runtime.runtimeLog,
        onFallback: path => markFallback(diagnostics.metrics, path),
        onPath: path => { if (diagnostics.metrics) diagnostics.metrics.path = path; },
        onResponse: summary => { diagnostics.publish({ lastApiResponseSummary: summary }); },
        tavernHelper: window.TavernHelper,
        getContext: () => SillyTavern.getContext(),
    }); } finally { diagnostics.finish(); }
}
// @theater-source-end generateWithMainAPI

// @theater-source-begin callCustomAPIStream
async function callCustomAPIStream(systemPrompt, userPrompt, onChunk, shouldStream = true, signal = runtime.abortController?.signal, requestOptions = {}) {
    const diagnostics = beginRequestDiagnostics(runtime);
    const apiConfig = requestOptions.apiConfig || {
        ...captureIndependentConfig(runtime.settings),
        apiUrl: runtime.settings.apiUrl,
        apiProtocol: runtime.settings.apiProtocol,
        apiKey: runtime.settings.apiKey,
        apiModel: runtime.settings.apiModel,
        maxOutputTokens: runtime.settings.maxOutputTokens,
    };
    const inspectionId = beginPromptInspection({ purpose: requestOptions.tracePurpose,
        label: requestOptions.inspectionLabel,
        round: requestOptions.inspectionRound || 1, presetName: requestOptions.presetName || runtime.settings.selectedPresetName,
        route: 'custom', messages: requestOptions.messages, systemPrompt, userPrompt });
    try { return await requestCustomApi({
        config: apiConfig,
        systemPrompt,
        userPrompt,
        messages: requestOptions.messages,
        postProcessing: requestOptions.postProcessing || '',
        recoverFormat: ['creative', 'continuation'].includes(requestOptions.tracePurpose),
        presetName: requestOptions.presetName || runtime.settings.selectedPresetName || '未指定',
        onChunk,
        onRequest: details => { if (diagnostics.current()) captureActualRequestTrace(details, requestOptions.tracePurpose); recordSentInspection(inspectionId, details); },
        shouldStream,
        signal,
        log: runtime.runtimeLog,
        onFallback: path => markFallback(diagnostics.metrics, path),
        onResponse: summary => { diagnostics.publish({ lastApiResponseSummary: summary }); },
        onConnection: summary => { diagnostics.publish({ lastApiConnectionSummary: summary }); },
    }); } finally { diagnostics.finish(); }
}
// @theater-source-end callCustomAPIStream

// @theater-source-begin fetchModelList
async function fetchModelList() {
    const config = runtime.readApiFormConfig();
    const url = config.apiUrl, key = config.apiKey;
    const error = channelConfigError(config, { requireModel: false });
    if (error) { toastr.warning(error); return; }
    if (!API_CHANNELS[apiChannel(config)].models) { toastr.info('此渠道请在控制台查看可用模型，并手动填写模型名称或接入点 ID'); return; }

    const formRequest = beginApiFormRequest(runtime, 'models', config);
    const $btn = $('#theater-fetch-models-btn');
    $btn.addClass('disabled');
    $btn.find('span').text('获取中…');
    const diagnostics = beginRequestDiagnostics(runtime, { auxiliary: true,
        context: { kind: '模型列表' }, metrics: createRequestMetrics('support:models') });

    try {
        const protocol = resolveProtocol(config.apiProtocol, url);
        if (protocol === API_PROTOCOLS.ANTHROPIC && !key) throw new Error('Anthropic 接口需要 API Key');
        const apiEndpoint = buildApiEndpoint(url, protocol);
        const modelsEndpoint = apiEndpoint.replace(/\/(chat\/completions|messages)$/, '/models');
        const headers = protocol === API_PROTOCOLS.ANTHROPIC
            ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
            : (key ? { 'Authorization': `Bearer ${key}` } : {});
        const res = await fetch(modelsEndpoint, { method: 'GET', headers });
        if (!res.ok) {
            throw statusError(res.status, await res.text().catch(() => ''));
        }
        const data = await res.json();
        if (!formRequest.current()) return;

        if (!data) throw new Error('无法获取模型列表');

        // 解析模型列表：兼容 { data: [...] } 和直接数组两种格式
        const rawList = data.data || data;
        const models = (Array.isArray(rawList) ? rawList : [])
            .map(m => typeof m === 'string' ? m : m?.id)
            .filter(m => typeof m === 'string' && m.trim())
            .sort();

        if (!models.length) {
            toastr.warning('API返回了数据但没找到可用模型');
            return;
        }

        presentModelPicker(models, {
            selected: config.apiModel || '', isCurrent: formRequest.current,
            onSelect: model => {
                if (!formRequest.current()) return;
                $('#theater-api-model').val(model);
                // Keep the original autosave only when this is the saved connection.
                const saved = captureIndependentConfig(runtime.settings);
                if (apiChannel(saved) === apiChannel(config) && saved.apiUrl === config.apiUrl
                    && saved.apiKey === config.apiKey && saved.apiProtocol === config.apiProtocol) {
                    runtime.settings.apiModel = model;
                    runtime.save();
                    runtime.scheduleTokenEstimate?.(); runtime.scheduleLongDreamTokenEstimate?.(); runtime.updateWBCount?.();
                }
            },
        });

        toastr.success(`找到 ${models.length} 个模型`);
    } catch (e) {
        const issue = classifyRequestFailure(e, { stage: '模型列表' });
        markFailed(diagnostics.metrics, issue.signal);
        diagnostics.publish({ lastRequestIssue: issue });
        console.error('[Theater] 获取模型列表失败:', issue.signal);
        if (formRequest.current()) runtime.theaterError(runtime.requestFailureMessage('获取模型失败', issue), '', { requestIssue: issue, retained: false });
    } finally {
        if (!diagnostics.metrics.failedAt) markCompleted(diagnostics.metrics);
        runtime.recordRequestMetrics(diagnostics.metrics);
        diagnostics.finish();
        if (formRequest.latest()) {
            $btn.removeClass('disabled');
            $btn.find('span').text(API_CHANNELS[apiChannel(runtime.readApiFormConfig())].models ? '获取' : '手动填写');
        }
    }
}
// @theater-source-end fetchModelList

// @theater-source-begin testAPIConnection
async function testAPIConnection() {
    const config = runtime.readApiFormConfig();
    const error = channelConfigError(config);
    if (error) { toastr.warning(error); return; }
    const key = config.apiKey;
    let releaseVertex = () => {};
    const formRequest = beginApiFormRequest(runtime, 'test', config);

    const $btn = $('#theater-test-api-btn');
    $btn.addClass('disabled');
    $btn.find('span').text('测试中…');
    const diagnostics = beginRequestDiagnostics(runtime, { auxiliary: true,
        context: { kind: '连接测试' }, metrics: createRequestMetrics('support:connection-test') });

    try {
        if (apiChannel(config) === 'vertex') releaseVertex = beginVertexRequest();
        const preparedRequest = createIndependentRequest(config, {
            systemPrompt: '', userPrompt: 'Hi',
            maxTokens: apiChannel(config) === 'custom' ? 16 : 256, stream: false,
        });
        const request = preparedRequest?.then ? await preparedRequest : preparedRequest;
        if (apiChannel(config) === 'vertex') await checkVertexCredential(config);
        if (request.protocol === API_PROTOCOLS.ANTHROPIC && !key) { toastr.warning('Anthropic 接口需要 API Key'); return; }
        runtime.runtimeLog('info', '连接测试请求发出', {
            protocol: request.protocol,
            preset_generation_options: 'not_inherited',
        });
        if (!formRequest.current()) return;
        const res = await fetch(request.endpoint, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body) });
        if (res.ok) {
            const data = await res.json().catch(() => null);
            if (!data || data.error) throw new Error('接口返回了错误或无效响应');
            if (formRequest.current()) toastr.success('接口已响应；实际写作与长文本输出仍需体验');
        }
        else {
            const issue = classifyRequestFailure(statusError(res.status, await res.text().catch(() => '')), { stage: '连接测试' });
            markFailed(diagnostics.metrics, issue.signal);
            diagnostics.publish({ lastRequestIssue: issue });
            if (formRequest.current()) runtime.theaterError(runtime.requestFailureMessage('连接失败', issue), '', { requestIssue: issue, retained: false });
        }
    } catch (e) {
        const issue = classifyRequestFailure(e, { stage: '连接测试' });
        markFailed(diagnostics.metrics, issue.signal);
        diagnostics.publish({ lastRequestIssue: issue });
        if (formRequest.current()) runtime.theaterError(runtime.requestFailureMessage('连接失败', issue), '', { requestIssue: issue, retained: false });
    } finally {
        if (!diagnostics.metrics.failedAt) markCompleted(diagnostics.metrics);
        runtime.recordRequestMetrics(diagnostics.metrics);
        diagnostics.finish();
        if (formRequest.latest()) { $btn.removeClass('disabled'); $btn.find('span').text('测试连接'); }
        releaseVertex();
    }
}
// @theater-source-end testAPIConnection

return { captureActualRequestTrace, captureGenerationApiRoute, requestConfiguredGenerationApi, generateWithMainAPI, callCustomAPIStream, fetchModelList, testAPIConnection };
}
