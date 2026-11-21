import test from 'node:test';
import assert from 'node:assert/strict';
import { API_PROTOCOLS } from '../api-client.js';
import { readSSEStream } from '../api-runtime.js';
import { addGenerationSegment, createGenerationJob, streamEndNotice } from '../generation-job.js';
import { createLongDreamRecord } from '../long-dream.js';
import { createLongDreamGenerationController } from '../long-dream-generation.js';

// 断流提醒（4.4.9d）：流怎么结束的要记下来，只有“没信号就断了”和“写了一半报错”算可疑。
const sse = (...events) => new Response(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } });
const delta = content => ({ choices: [{ delta: { content }, finish_reason: null }] });

test('stream end: silent close without [DONE] or finish_reason is eof', async () => {
    const result = await readSSEStream(sse(delta('她推开门，'), delta('看见')), () => {}, API_PROTOCOLS.OPENAI);
    assert.equal(result.text, '她推开门，看见');
    assert.equal(result.streamEnd, 'eof');
    assert.equal(result.responseSummary.streamEnd, 'eof');
});

test('stream end: [DONE] or a finish reason counts as a confirmed ending', async () => {
    assert.equal((await readSSEStream(sse(delta('完整。'), '[DONE]'), () => {}, API_PROTOCOLS.OPENAI)).streamEnd, 'done');
    const withReason = await readSSEStream(sse(delta('完整。'), { choices: [{ delta: {}, finish_reason: 'stop' }] }), () => {}, API_PROTOCOLS.OPENAI);
    assert.equal(withReason.streamEnd, 'stop-reason');
    const length = await readSSEStream(sse(delta('写到上限'), { choices: [{ delta: {}, finish_reason: 'length' }] }, '[DONE]'), () => {}, API_PROTOCOLS.OPENAI);
    assert.equal(length.streamEnd, 'stop-reason');
    assert.equal(length.stopReason, 'length');
});

test('stream end: text followed by an error event is provider-error and the text is kept', async () => {
    const result = await readSSEStream(sse(delta('前半段正文'), { error: { message: 'upstream retries exhausted' } }), () => {}, API_PROTOCOLS.OPENAI);
    assert.equal(result.text, '前半段正文');
    assert.equal(result.streamEnd, 'provider-error');
});

test('stream end: Anthropic message_stop and a whole JSON body are confirmed endings', async () => {
    const anthropic = await readSSEStream(sse(
        { type: 'content_block_delta', delta: { type: 'text_delta', text: '完整。' } },
        { type: 'message_stop' },
    ), () => {}, API_PROTOCOLS.ANTHROPIC);
    assert.equal(anthropic.text, '完整。');
    assert.equal(anthropic.streamEnd, 'done');
    const whole = await readSSEStream(new Response(JSON.stringify({ choices: [{ message: { content: '一次给完' } }] }),
        { headers: { 'content-type': 'application/json' } }), () => {}, API_PROTOCOLS.OPENAI);
    assert.equal(whole.text, '一次给完');
    assert.equal(whole.streamEnd, 'done');
});

test('stream end notice: only eof and provider-error produce a notice; the job keeps the last round', () => {
    assert.match(streamEndNotice('eof'), /没有确认写完/);
    assert.match(streamEndNotice('provider-error'), /报了错/);
    for (const value of ['done', 'stop-reason', 'unknown', null, undefined, 'toString']) assert.equal(streamEndNotice(value), '');
    const job = createGenerationJob({ targetChars: 100, autoContinue: true, maxRounds: 3 });
    addGenerationSegment(job, '第一轮', 'stop', null, 'eof');
    assert.equal(job.streamEnd, 'eof');
    addGenerationSegment(job, '第二轮', 'stop', 'stop', 'stop-reason');
    assert.equal(job.streamEnd, 'stop-reason');
    addGenerationSegment(job, '第三轮', 'stop');
    assert.equal(job.streamEnd, null);
});

test('long dream controller reports how the last body round ended', async () => {
    for (const streamEnd of ['eof', 'done']) {
        const controller = createLongDreamGenerationController({
            checkpointIntervalMs: 0,
            requestChapter: async () => ({ text: '第二章停在半句，她推开门', stopReason: 'stop', streamEnd }),
            renderChapter: async ({ text }) => ({ html: `<article>${text}</article>`, mode: 'html' }),
            persistRecord: async next => next,
        });
        const generated = await controller.run({
            record: createLongDreamRecord({ source: { text: '第一章。', html: '<main>第一章。</main>' } }),
            chapterTitle: '第二章', instruction: '', targetChars: 0,
        });
        assert.equal(generated.streamEnd, streamEnd);
        assert.equal(generated.record.draft.text, '第二章停在半句，她推开门');
    }
});
