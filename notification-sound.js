const SOUNDS_BASE_URL = '/scripts/extensions/third-party/st-theater/sounds/';

let notifyAudio = null;

export function playSoundFile(file, volume) {
    if (!file) return;
    try {
        if (notifyAudio) {
            try { notifyAudio.pause(); } catch (_) {}
        }
        const audio = new Audio(SOUNDS_BASE_URL + file);
        audio.volume = Math.max(0, Math.min(100, Number(volume) || 0)) / 100;
        notifyAudio = audio;
        audio.play().catch(err => console.warn('[Theater] sound play blocked:', err?.message || err));
    } catch (e) {
        console.warn('[Theater] sound play failed:', e);
    }
}
