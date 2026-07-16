export function createGenerationJob({ targetChars = null, maxRounds = 3, autoContinue = false } = {}) {
    return { targetChars, actualChars: 0, round: 1, maxRounds, autoContinue, stopReason: null, rawStopReason: null, aborted: false, segments: [] };
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
    return job.actualChars < job.targetChars && job.round < job.maxRounds;
}

export function abortGenerationJob(job) {
    job.aborted = true;
    job.stopReason = 'abort';
}
