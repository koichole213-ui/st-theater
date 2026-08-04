export const TARGET_COMPLETION_RATIO = 0.9;

export function targetCompletionChars(targetChars) {
    return targetChars ? Math.ceil(targetChars * TARGET_COMPLETION_RATIO) : 0;
}

export function createGenerationJob({ targetChars = null, maxRounds = 3, minimumRounds = 1, autoContinue = false } = {}) {
    const normalizedMaxRounds = Math.max(1, Math.floor(Number(maxRounds) || 1));
    return {
        targetChars,
        targetCompletionChars: targetCompletionChars(targetChars),
        actualChars: 0,
        round: 1,
        maxRounds: normalizedMaxRounds,
        minimumRounds: Math.min(normalizedMaxRounds, Math.max(1, Math.floor(Number(minimumRounds) || 1))),
        autoContinue,
        stopReason: null,
        rawStopReason: null,
        aborted: false,
        finishAuthorized: false,
        completedBelowTarget: false,
        segments: [],
    };
}

export function addGenerationSegment(job, text, stopReason = 'unknown', rawStopReason = null) {
    job.segments.push(String(text || '').trim());
    job.stopReason = stopReason;
    job.rawStopReason = rawStopReason;
    return job;
}

export function shouldContinueJob(job, countChars) {
    if (!job.autoContinue || !job.targetChars || job.aborted || job.stopReason === 'error') return false;
    job.actualChars = countChars(job.segments.join('\n\n'));
    if (job.round < job.minimumRounds) return job.round < job.maxRounds;
    if (job.actualChars >= job.targetCompletionChars) return false;
    if (job.finishAuthorized && job.stopReason !== 'length') {
        job.completedBelowTarget = true;
        return false;
    }
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
    job.finishAuthorized = !!allowed;
    return job;
}

export function abortGenerationJob(job) {
    job.aborted = true;
    job.stopReason = 'abort';
}
