import test from 'node:test';
import assert from 'node:assert/strict';
import { requestMainApi, MAIN_HELPER_RESPONSE_TIMEOUT_MS } from '../api-runtime.js';

const minute = 60 * 1000;
const options = helper => ({ ctx: {}, getContext: () => ({}), systemPrompt: '合成系统', userPrompt: '合成任务', tavernHelper: helper });

test('主API兼容路径等待九分钟的完整回复，不在旧五分钟截断，也不重发', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(MAIN_HELPER_RESPONSE_TIMEOUT_MS, 15 * minute);
    for (const stream of [true, false]) {
        let calls = 0, settled = false, receivedOptions;
        const chunks = [];
        const task = requestMainApi({ ...options({ generateRaw: request => {
            calls++; receivedOptions = request;
            return new Promise(resolve => setTimeout(() => resolve('九分钟后完整正文'), 9 * minute));
        } }), shouldStream: stream, onChunk: value => chunks.push(value) }).then(result => { settled = true; return result; });
        t.mock.timers.tick(5 * minute);
        await Promise.resolve();
        assert.equal(settled, false); assert.deepEqual(chunks, []);
        t.mock.timers.tick(4 * minute);
        assert.equal((await task).text, '九分钟后完整正文');
        assert.equal(calls, 1); assert.equal(receivedOptions.should_stream, stream);
        assert.deepEqual(chunks, ['九分钟后完整正文']);
        assert.equal('max_tokens' in receivedOptions, false);
        assert.equal('thinking' in receivedOptions, false);
    }
});

test('超过十五分钟仍明确超时，迟到回复不再显示保存或重发', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let complete, calls = 0;
    const chunks = [], responses = [];
    const task = requestMainApi({ ...options({ generateRaw: () => { calls++; return new Promise(resolve => { complete = resolve; }); } }),
        onChunk: value => chunks.push(value), onResponse: value => responses.push(value) });
    const rejected = assert.rejects(task, error => error.diagnosticSignal === 'T-NET-TIMEOUT');
    t.mock.timers.tick(MAIN_HELPER_RESPONSE_TIMEOUT_MS);
    await rejected;
    complete('迟到正文'); await Promise.resolve(); await Promise.resolve();
    assert.equal(calls, 1); assert.deepEqual(chunks, []); assert.deepEqual(responses, []);
});

test('用户停止仍立即生效，不必等十五分钟；停止后迟到正文不回写', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let complete, calls = 0;
    const chunks = [], abort = new AbortController();
    const task = requestMainApi({ ...options({ generateRaw: request => {
        calls++; assert.equal(request.signal, abort.signal);
        return new Promise(resolve => { complete = resolve; });
    } }), signal: abort.signal, onChunk: value => chunks.push(value) });
    const rejected = assert.rejects(task, error => error.name === 'AbortError');
    t.mock.timers.tick(minute); abort.abort(); await rejected;
    complete('停止后迟到正文'); await Promise.resolve(); await Promise.resolve();
    assert.equal(calls, 1); assert.deepEqual(chunks, []);
});
