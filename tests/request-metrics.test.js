// 从 core.test.js 拆出：request-metrics
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestMetrics, markCompleted, markFailed, markFallback, markFirstToken, summarizeMetrics } from '../request-metrics.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, classifyRequestFailure, createDiagnosticError, diagnosticSignalInfo } from '../request-diagnostics.js';

test('请求诊断记录开始、首字、完成和 fallback 时间', () => {
    const metrics = createRequestMetrics('main:first');
    metrics.requestStartedAt = 1000;
    const originalNow = Date.now;
    try {
        Date.now = () => 1120;
        markFirstToken(metrics);
        Date.now = () => 1400;
        markFallback(metrics, 'main:first');
        Date.now = () => 1800;
        markCompleted(metrics);
    } finally {
        Date.now = originalNow;
    }
    const summary = summarizeMetrics(metrics);
    assert.match(summary, /首字 \+120ms/);
    assert.match(summary, /主体完成 \+800ms/);
    assert.match(summary, /fallback \+400ms/);
});

test('请求诊断能把 HTTP 与内容过滤错误映射成稳定信号', () => {
    const contentFilter = classifyRequestFailure(createDiagnosticError(REQUEST_DIAGNOSTIC_SIGNAL.CONTENT_FILTER, {
        code: 'THEATER_CONTENT_FILTER', rawStopReason: 'content_filter',
    }), { stage: '正文生成' });
    assert.equal(contentFilter.signal, 'T-API-CONTENT-FILTER');
    assert.equal(contentFilter.rawStopReason, 'content_filter');
    assert.match(contentFilter.detail, /不一定是这次的指令/);

    const server = classifyRequestFailure({
        code: 'THEATER_HTTP_STATUS',
        theaterFailure: { status: 500 },
    }, { stage: '正文生成' });
    assert.equal(server.signal, 'T-HTTP-500');
    assert.equal(diagnosticSignalInfo(server.signal).title, '服务器内部出错');

    const rateLimit = classifyRequestFailure({
        code: 'THEATER_HTTP_STATUS',
        theaterFailure: { status: 429 },
    });
    assert.equal(rateLimit.signal, 'T-HTTP-429');
});

test('请求计时会记录最终错误信号', () => {
    const metrics = createRequestMetrics('custom:openai');
    metrics.requestStartedAt = 1000;
    const originalNow = Date.now;
    try {
        Date.now = () => 1250;
        markFailed(metrics, 'T-API-EMPTY');
    } finally {
        Date.now = originalNow;
    }
    assert.match(summarizeMetrics(metrics), /失败 \+250ms（T-API-EMPTY）/);
});
