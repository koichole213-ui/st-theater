import { normalizeMaxTokens, buildApiRequest } from './api-client.js';
import { DEFAULT_LAYOUT_MAX_TOKENS, resolveLayoutApiRoute, captureLayoutApiSelection } from './layout-api.js';
import { classifyRequestFailure } from './request-diagnostics.js';

export function bindLayoutApi($d, runtime) {
    $d.off('change.tlayoutenabled').on('change.tlayoutenabled', '#theater-layout-api-enabled', function () {
        runtime.settings.layoutApiEnabled = this.checked;
        $(this).attr('aria-expanded', String(this.checked));
        $('#theater-layout-api-fields').prop('hidden', !this.checked);
        $('#theater-layout-api-off-note').prop('hidden', this.checked);
        runtime.save();
    });
    $d.off('change.tlayoutpreset').on('change.tlayoutpreset', '#theater-layout-api-preset', function () {
        runtime.settings.layoutApiPresetId = String($(this).val() || '');
        runtime.save();
    });
    $d.off('change.tlayouttokens').on('change.tlayouttokens', '#theater-layout-max-tokens', function () {
        runtime.settings.layoutMaxOutputTokens = normalizeMaxTokens(this.value, DEFAULT_LAYOUT_MAX_TOKENS);
        this.value = runtime.settings.layoutMaxOutputTokens;
        runtime.save();
    });
    $d.off('click.tlayoutsav').on('click.tlayoutsav', '#theater-layout-api-save', function () {
        runtime.settings.layoutApiPresetId = String($('#theater-layout-api-preset').val() || '');
        runtime.settings.layoutMaxOutputTokens = normalizeMaxTokens($('#theater-layout-max-tokens').val(), DEFAULT_LAYOUT_MAX_TOKENS);
        $('#theater-layout-max-tokens').val(runtime.settings.layoutMaxOutputTokens);
        runtime.save();
        try {
            resolveLayoutApiRoute({ layoutSelection: captureLayoutApiSelection({ ...runtime.settings, layoutApiEnabled: true }) });
            toastr.success('排版 API 设置已保存');
        } catch (error) { toastr.warning(error.message); }
    });
    $d.off('click.tlayouttest').on('click.tlayouttest', '#theater-layout-api-test', async function () {
        const $button = $(this);
        if ($button.prop('disabled')) return;
        let route;
        try {
            route = resolveLayoutApiRoute({ layoutSelection: captureLayoutApiSelection({
                ...runtime.settings, layoutApiEnabled: true,
                layoutApiPresetId: String($('#theater-layout-api-preset').val() || ''),
            }) });
        } catch (error) { toastr.warning(error.message); return; }
        $button.prop('disabled', true).find('span').text('测试中…');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const request = buildApiRequest({ url: route.custom.apiUrl, protocol: route.custom.apiProtocol,
                key: route.custom.apiKey, model: route.custom.apiModel,
                systemPrompt: '', userPrompt: 'Hi', maxTokens: 16, stream: false });
            if (request.protocol === 'anthropic' && !route.custom.apiKey) { toastr.warning('Anthropic 接口需要 API Key'); return; }
            const response = await fetch(request.endpoint, { method: 'POST', headers: request.headers,
                body: JSON.stringify(request.body), signal: controller.signal });
            if (!response.ok) throw { code: 'THEATER_HTTP_STATUS', theaterFailure: { status: response.status } };
            toastr.success('排版 API 连接成功');
        } catch (error) {
            const issue = classifyRequestFailure(error, { stage: '排版 API 连接测试' });
            runtime.lastRequestIssue = issue;
            runtime.theaterError(runtime.requestFailureMessage('排版 API 连接失败', issue));
        } finally {
            clearTimeout(timeout);
            $button.prop('disabled', false).find('span').text('测试连接');
        }
    });
}
