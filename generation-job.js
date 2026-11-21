export const TARGET_COMPLETION_RATIO = 0.9;

export function targetCompletionChars(targetChars) {
    return targetChars ? Math.ceil(targetChars * TARGET_COMPLETION_RATIO) : 0;
}

export function createGenerationJob({
    targetChars = null,
    maxRounds = 3,
    minimumRounds = 1,
    autoContinue = false,
    requireTargetCompletion = false,
} = {}) {
    const normalizedMaxRounds = Math.max(1, Math.floor(Number(maxRounds) || 1));
    return {
        targetChars,
        targetCompletionChars: targetCompletionChars(targetChars),
        actualChars: 0,
        round: 1,
        maxRounds: normalizedMaxRounds,
        minimumRounds: Math.min(normalizedMaxRounds, Math.max(1, Math.floor(Number(minimumRounds) || 1))),
        autoContinue,
        requireTargetCompletion: !!requireTargetCompletion,
        stopReason: null,
        rawStopReason: null,
        streamEnd: null,
        aborted: false,
        finishAuthorized: false,
        completedBelowTarget: false,
        segments: [],
    };
}

export function addGenerationSegment(job, text, stopReason = 'unknown', rawStopReason = null, streamEnd = null) {
    job.segments.push(String(text || '').trim());
    job.stopReason = stopReason;
    job.rawStopReason = rawStopReason;
    job.streamEnd = streamEnd || null;
    return job;
}

// 断流提醒（4.4.9d）：只看最后一轮怎么结束。只提醒，不改正文、轮数和提示词。
// 'eof'：连接关了，但服务既没发结束信号也没给结束原因；'provider-error'：写了一部分后服务商报错。
export const STREAM_END_NOTICES = Object.freeze({
    eof: '连接结束了，但服务没有确认写完，结尾可能断在半截。',
    'provider-error': '服务商在写的过程中报了错，结尾可能不完整。',
});

export function streamEndNotice(streamEnd) {
    return Object.hasOwn(STREAM_END_NOTICES, streamEnd) ? STREAM_END_NOTICES[streamEnd] : '';
}

export function generationTextWithLiveSegment(job, liveSegment = '') {
    return [
        ...(Array.isArray(job?.segments) ? job.segments : []),
        String(liveSegment || '').trim(),
    ].map(value => String(value || '').trim()).filter(Boolean).join('\n\n').trim();
}

export function shouldContinueJob(job, countChars) {
    if (!job.autoContinue || !job.targetChars || job.aborted || job.stopReason === 'error') return false;
    job.actualChars = countChars(job.segments.join('\n\n'));
    if (job.round < job.minimumRounds) return job.round < job.maxRounds;
    if (job.actualChars >= job.targetCompletionChars) {
        if (job.requireTargetCompletion && !job.finishAuthorized && job.round < job.maxRounds) return true;
        return false;
    }
    // Permission to conclude the plot is not proof that the length target was met.
    return job.round < job.maxRounds;
}

export function shouldAuthorizeFinishRound(job, countChars) {
    if (!job.targetChars) return false;
    const actualChars = countChars(job.segments.join('\n\n'));
    const lastSegmentChars = countChars(job.segments[job.segments.length - 1] || '');
    const remaining = Math.max(0, job.targetCompletionChars - actualChars);
    const nextRoundIsLastAllowed = job.round + 1 >= job.maxRounds;
    return nextRoundIsLastAllowed || remaining <= Math.max(1, lastSegmentChars);
}

export function authorizeFinish(job, allowed = true) {
    // Once the story is concluding, extra rounds must not reopen its middle.
    job.finishAuthorized = job.finishAuthorized || !!allowed;
    return job;
}

export function abortGenerationJob(job) {
    job.aborted = true;
    job.stopReason = 'abort';
}
