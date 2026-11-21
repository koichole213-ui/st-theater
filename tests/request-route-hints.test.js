import test from 'node:test';
import assert from 'node:assert/strict';
import { requestCustomApi } from '../api-runtime.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, REQUEST_ROUTE_HINTS, classifyRequestFailure, requestRouteHints, withRequestRouteHints } from '../request-diagnostics.js';
import { createTheaterRequestState } from '../theater-request-state.js';

// 连不上时把话说清楚（4.4.9d）：网页直连别的网站失败 → 可能是中转不许网页访问；
// “自动判断”成 Anthropic 又被 401 → 提示改成 OpenAI 兼容格式。其余情况不加话。
const page = { origin: 'http://192.168.1.5:8000' };

test('route hints: cross-origin only when the request leaves the tavern page', () => {
    assert.equal(requestRouteHints({}, { endpoint: 'https://relay.example.com/v1/chat/completions', protocol: 'openai' }, page).crossOrigin, true);
    assert.equal(requestRouteHints({}, { endpoint: '/api/backends/chat-completions/generate', protocol: 'openai' }, page).crossOrigin, false);
    assert.equal(requestRouteHints({}, { endpoint: 'http://192.168.1.5:8000/api/x', protocol: 'openai' }, page).crossOrigin, false);
});

test('route hints: auto-detected Anthropic only when the format was left on auto', () => {
    const req = { endpoint: 'https://claude-relay.example.com/v1/messages', protocol: 'anthropic' };
    assert.equal(requestRouteHints({ apiProtocol: 'auto' }, req, page).autoAnthropic, true);
    assert.equal(requestRouteHints({}, req, page).autoAnthropic, true);
    assert.equal(requestRouteHints({ apiProtocol: 'anthropic' }, req, page).autoAnthropic, false);
    assert.equal(requestRouteHints({ apiProtocol: 'auto' }, { ...req, protocol: 'openai' }, page).autoAnthropic, false);
});

test('classify: hints appear only for the matching failure', () => {
    const cross = { crossOrigin: true, autoAnthropic: true };
    const failed = withRequestRouteHints(new TypeError('Failed to fetch'), cross);
    assert.equal(classifyRequestFailure(failed, { stage: '连接测试' }).signal, REQUEST_DIAGNOSTIC_SIGNAL.NETWORK);
    assert.equal(classifyRequestFailure(failed).hint, REQUEST_ROUTE_HINTS.crossOrigin);
    const unauthorized = withRequestRouteHints(Object.assign(new Error('401'), { theaterFailure: { status: 401 } }), cross);
    assert.equal(classifyRequestFailure(unauthorized).signal, 'T-HTTP-401');
    assert.equal(classifyRequestFailure(unauthorized).hint, REQUEST_ROUTE_HINTS.autoAnthropic);
    assert.equal(classifyRequestFailure(new TypeError('Failed to fetch')).hint, undefined);
    const sameSite = withRequestRouteHints(new TypeError('Failed to fetch'), { crossOrigin: false, autoAnthropic: false });
    assert.equal(classifyRequestFailure(sameSite).hint, undefined);
    const timeout = withRequestRouteHints(new Error('timeout 超时'), cross);
    assert.equal(classifyRequestFailure(timeout).hint, undefined);
});

test('failure message shows the hint under the first suggestion', () => {
    const { requestFailureMessage } = createTheaterRequestState({});
    const issue = classifyRequestFailure(withRequestRouteHints(new TypeError('Failed to fetch'), { crossOrigin: true }), { stage: '连接测试' });
    const message = requestFailureMessage('连接失败', issue);
    assert.match(message, /T-NET-FAILED/);
    assert.match(message, /不允许网页直接访问/);
    assert.match(message, /酒馆主 API/);
    const plain = requestFailureMessage('连接失败', classifyRequestFailure(new TypeError('Failed to fetch')));
    assert.doesNotMatch(plain, /不允许网页直接访问/);
});

test('independent API: a blocked browser request carries the cross-origin hint', async () => {
    const error = await requestCustomApi({
        config: { apiUrl: 'https://relay.example.com/v1', apiProtocol: 'openai', apiKey: 'synthetic', apiModel: 'm', maxOutputTokens: 1024 },
        systemPrompt: '系统', userPrompt: '用户', shouldStream: false,
        fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
    }).then(() => null, e => e);
    const issue = classifyRequestFailure(error);
    assert.equal(issue.signal, REQUEST_DIAGNOSTIC_SIGNAL.NO_RESPONSE);
    assert.equal(issue.hint, REQUEST_ROUTE_HINTS.crossOrigin);
});

test('independent API: 401 after auto-detecting Anthropic suggests the OpenAI format', async () => {
    const run = apiProtocol => requestCustomApi({
        config: { apiUrl: 'https://claude-relay.example.com/v1', apiProtocol, apiKey: 'synthetic', apiModel: 'm', maxOutputTokens: 1024 },
        systemPrompt: '系统', userPrompt: '用户', shouldStream: false,
        fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    }).then(() => null, e => e);
    const auto = classifyRequestFailure(await run('auto'));
    assert.equal(auto.signal, 'T-HTTP-401');
    assert.equal(auto.hint, REQUEST_ROUTE_HINTS.autoAnthropic);
    const chosen = classifyRequestFailure(await run('anthropic'));
    assert.equal(chosen.signal, 'T-HTTP-401');
    assert.equal(chosen.hint, undefined);
});

test('error popup shows the hint as the first suggestion, and the copy text carries it', async () => {
    const { errorHelpHTML, errorCopyText } = await import('../error-help-ui.js');
    const issue = classifyRequestFailure(withRequestRouteHints(new TypeError('Failed to fetch'), { crossOrigin: true }), { stage: '连接测试' });
    const html = errorHelpHTML(issue, { actions: true });
    const steps = html.slice(html.indexOf('teh-steps'));
    assert.ok(steps.indexOf('不允许网页直接访问') > 0, 'hint is inside the steps');
    assert.ok(steps.indexOf('不允许网页直接访问') < steps.indexOf('检查网络后再试'), 'hint comes first');
    assert.match(errorCopyText(issue), /补充说明：.*不允许网页直接访问/);
    const plain = classifyRequestFailure(new TypeError('Failed to fetch'));
    assert.doesNotMatch(errorHelpHTML(plain), /不允许网页直接访问/);
    assert.doesNotMatch(errorCopyText(plain), /补充说明/);
});

test('route hints: a page reporting origin "null" still recognises a full http(s) address as cross-origin', () => {
    assert.equal(requestRouteHints({}, { endpoint: 'https://relay.example.com/v1/chat/completions' }, { origin: 'null' }).crossOrigin, true);
    assert.equal(requestRouteHints({}, { endpoint: '/api/backends/chat-completions/generate' }, { origin: 'null' }).crossOrigin, false);
});
