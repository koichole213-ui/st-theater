const HEIGHT_MESSAGE = 'st-theater:height';
const frames = new WeakMap();
const frameStates = new WeakMap();
const pendingStates = new Set();
let installed = false;

export const RENDER_REPORT_TIMEOUT_MS = 1000;

export function sandboxPermissions() {
    return 'allow-scripts';
}

export function injectResizeReporter(html) {
    const reporter = `<script data-st-theater-reporter>
(() => {
    const report = () => {
        const root = document.documentElement;
        const body = document.body;
        parent.postMessage({
            type: '${HEIGHT_MESSAGE}',
            height: Math.ceil(Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0)),
            textLength: String(body?.innerText || '').trim().length,
        }, '*');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report, { once: true });
    else report();
    window.addEventListener('load', report, { once: true });
    if (typeof ResizeObserver === 'function' && document.documentElement) {
        new ResizeObserver(report).observe(document.documentElement);
    }
    setTimeout(report, 0);
})();
</script>`;
    const source = String(html || '');
    const insertBeforeLastClosingTag = tag => {
        const matches = [...source.matchAll(new RegExp(`<\\/${tag}\\s*>`, 'ig'))];
        const last = matches[matches.length - 1];
        return last ? source.slice(0, last.index) + reporter + source.slice(last.index) : '';
    };
    const beforeBody = insertBeforeLastClosingTag('body');
    if (beforeBody) return beforeBody;
    const beforeHtml = insertBeforeLastClosingTag('html');
    if (beforeHtml) return beforeHtml;
    return source + reporter;
}

export function configureSafeIframe(frame) {
    frame.setAttribute('sandbox', sandboxPermissions());
    frame.style.height = window.innerWidth <= 768 ? '60vh' : '420px';
}

export function renderSafeIframe(frame, html, { sourceHasText = false, onBlank = null, fixedHeight = false } = {}) {
    configureSafeIframe(frame);
    if (fixedHeight) frame.style.height = '100%';
    const previousState = frameStates.get(frame);
    if (previousState) {
        clearTimeout(previousState.timeoutId);
        pendingStates.delete(previousState);
    }
    frame.srcdoc = injectResizeReporter(html);
    const sourceWindow = frame.contentWindow;
    const state = { frame, sourceWindow, sourceHasText, onBlank, fixedHeight, blankHandled: false, received: false, timeoutId: null };
    frameStates.set(frame, state);
    frames.set(sourceWindow, state);
    pendingStates.add(state);
    state.timeoutId = setTimeout(() => {
        if (frameStates.get(frame) !== state || state.received) return;
        pendingStates.delete(state);
        if (!state.fixedHeight) frame.style.height = window.innerWidth <= 768 ? '60vh' : '420px';
        if (state.sourceHasText && !state.blankHandled && typeof state.onBlank === 'function') {
            state.blankHandled = true;
            state.onBlank({ reason: 'no-report' });
        }
    }, RENDER_REPORT_TIMEOUT_MS);
}

export function installSafeResizeListener() {
    if (installed) return;
    installed = true;
    window.addEventListener('message', event => {
        if (event?.data?.type !== HEIGHT_MESSAGE) return;
        let state = frames.get(event.source);
        if (!state || frameStates.get(state.frame) !== state || state.frame.contentWindow !== event.source) {
            state = [...pendingStates].find(candidate =>
                frameStates.get(candidate.frame) === candidate
                && candidate.frame.contentWindow === event.source
            );
        }
        if (!state || frameStates.get(state.frame) !== state || state.frame.contentWindow !== event.source) return;
        state.sourceWindow = event.source;
        frames.set(event.source, state);
        pendingStates.delete(state);
        state.received = true;
        clearTimeout(state.timeoutId);
        const requested = Number(event.data.height);
        if (!Number.isFinite(requested)) return;
        if (!state.fixedHeight) {
            const max = window.innerWidth <= 768 ? window.innerHeight * 0.75 : 720;
            state.frame.style.height = `${Math.min(Math.max(requested, 240), max)}px`;
        }
        const textLength = Number(event.data.textLength);
        if (state.sourceHasText && Number.isFinite(textLength) && textLength === 0 && !state.blankHandled && typeof state.onBlank === 'function') {
            state.blankHandled = true;
            state.onBlank({ reason: 'empty-body' });
        }
    });
}
