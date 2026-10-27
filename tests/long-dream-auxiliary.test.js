import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { requestCustomApi } from '../api-runtime.js';
import { normalizeMaxTokens } from '../api-client.js';
import { createLongDreamRecord, normalizeLongDreamRecord, setLongDreamMemoryStatus, applyLongDreamMemoryPatch, LONG_DREAM_MEMORY_STATUS } from '../long-dream.js';
import { buildLongDreamMemoryPayload, parseLongDreamMemoryResponse, shouldWeaveLongDreamMemory, DEFAULT_LONG_DREAM_MEMORY_PRESET } from '../long-dream-memory.js';
import { refreshLongDreamSummary } from '../long-dream-summary.js';
import { refreshSeriesStorySummary, applySeriesStoryBatch } from '../long-dream-series.js';
import { hasPendingManualSummary } from '../long-dream-story-summary.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, diagnosticSignalInfo } from '../request-diagnostics.js';

const source = readFileSync(new URL('../long-dream-runtime.js', import.meta.url), 'utf8');
function entry(name) {
    const start = source.indexOf(`// @theater-source-begin ${name}`);
    const end = source.indexOf(`// @theater-source-end ${name}`, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

async function exercise(kind, { tokens, stream, failure = false } = {}) {
    let current = createLongDreamRecord({ source: { text: '虚构第一章', html: '<p>虚构第一章</p>' } });
    if (kind !== 'weave') current = applyLongDreamMemoryPatch(current, { operations: [] }, 1);
    if (kind === 'series') current.source.kind = 'history-folder';
    current.memory.currentState = '保留的旧概要';
    const beforeChapters = JSON.stringify(current.chapters);
    const beforeEntries = JSON.stringify(current.memory.storyEntries);
    const saved = [], requests = [], warnings = [];
    const preset = { name: 'synthetic', apiUrl: 'https://example.invalid/v1', apiModel: 'synthetic', maxOutputTokens: tokens };
    const beforePreset = JSON.stringify(preset);
    const runtime = {
        settings: { streamEnabled: stream, longDreamMemoryEnabled: true, longDreamMemoryBatchSize: 1 },
        longDreamCache: [current], activeLongDreamId: null, refreshingLongDreamSummaries: new Set(),
        selectedLongDreamMemoryApiPreset: () => preset,
        async longDreamPut(value) {
            current = normalizeLongDreamRecord(value);
            runtime.longDreamCache = [current]; saved.push(current); return current;
        },
        runtimeLog() {}, renderLongDreamPanel() {}, theaterError() {},
    };
    let chunksObserved = 0;
    const request = options => requestCustomApi({ ...options, fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); requests.push(body);
        assert.equal(body.max_tokens, normalizeMaxTokens(tokens));
        assert.equal(body.stream, stream !== false);
        const json = JSON.stringify({ operations: [], storyEntries: [{ chapterNumber: 1, text: '完整的新概要' }] });
        const output = failure ? json.slice(0, -12) : json;
        if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: output }, finish_reason: failure ? 'length' : 'stop' }] }), { headers: { 'content-type': 'application/json' } });
        if (failure === 'protocol') return new Response(': keep-alive\n\n'.repeat(251)
            + 'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } });
        const cut = Math.floor(output.length / 2);
        const parts = [output.slice(0, cut), output.slice(cut)];
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({ pull(controller) {
            // A partial stream must not publish a half-built memory or summary.
            assert.equal(current.memory.currentState, '保留的旧概要');
            assert.equal(JSON.stringify(current.memory.storyEntries), beforeEntries);
            if (failure === 'interrupted' && chunksObserved === 1) { controller.error(new Error('synthetic stream interruption')); return; }
            if (parts.length) {
                chunksObserved++;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: parts.shift() }, finish_reason: null }] })}\n\n`));
            } else {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: failure ? 'length' : 'stop' }] })}\n\ndata: [DONE]\n\n`));
                controller.close();
            }
        } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const scope = {
        runtime, normalizeMaxTokens, LONG_DREAM_MEMORY_STATUS, setLongDreamMemoryStatus, applyLongDreamMemoryPatch,
        buildLongDreamMemoryPayload, parseLongDreamMemoryResponse, shouldWeaveLongDreamMemory, DEFAULT_LONG_DREAM_MEMORY_PRESET,
        applySeriesStoryBatch, refreshLongDreamSummary, refreshSeriesStorySummary, hasPendingManualSummary,
        REQUEST_DIAGNOSTIC_SIGNAL, diagnosticSignalInfo, AbortController, setTimeout, clearTimeout,
        syncLongDreamSummaryButton() {},
        toastr: { info() {}, success() {}, warning(value) { warnings.push(value); } },
        requestCustomApi: request,
    };
    if (kind === 'weave') {
        // Keep the automatic follow-up summary outside this single-request test.
        scope.refreshLongDreamSummaryNow = async () => {};
        runInNewContext(entry('weaveLongDreamMemory'), scope);
        await scope.weaveLongDreamMemoryBatch(current.id, { force: true });
    } else {
        runInNewContext(entry('refreshLongDreamSummaryNow'), scope);
        await scope.refreshLongDreamSummaryNow(current.id, { fillMissing: kind === 'series' });
    }
    assert.equal(requests.length, 1);
    assert.equal(JSON.stringify(preset), beforePreset);
    assert.equal(JSON.stringify(current.chapters), beforeChapters);
    assert.equal(runtime.refreshingLongDreamSummaries.size, 0);
    if (stream !== false) assert.equal(chunksObserved, failure === 'protocol' ? 0 : failure === 'interrupted' ? 1 : 2);
    if (failure) {
        assert.equal(current.memory.currentState, '保留的旧概要');
        assert.equal(JSON.stringify(current.memory.storyEntries), beforeEntries);
        if (kind === 'weave') assert.equal(current.memory.status, LONG_DREAM_MEMORY_STATUS.FAILED);
        else { assert.equal(saved.length, 0); assert.equal(warnings.length, 1); }
    } else {
        assert.match(current.memory.currentState, /完整的新概要/);
        assert.ok(saved.length > 0);
    }
}

for (const kind of ['weave', 'summary', 'series']) {
    test(`${kind}: 实际请求遵循副API额度与流式开关，完整结果才保存`, async () => {
        for (const tokens of [4096, 16384, 32768, undefined]) {
            for (const stream of [true, false, undefined]) {
                // Include absent saved settings to verify the existing defaults.
                await exercise(kind, { tokens, stream });
            }
        }
    });
    test(`${kind}: 心跳协议空正文不覆盖旧概要或章节`, async () => {
        await exercise(kind, { stream: true, failure: 'protocol' });
    });
    test(`${kind}: 流式及非流式截断不覆盖旧概要或推进完成进度`, async () => {
        for (const stream of [true, false]) await exercise(kind, { stream, failure: true });
        await exercise(kind, { stream: true, failure: 'interrupted' });
    });
}