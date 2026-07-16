const HEIGHT_MESSAGE = 'st-theater:height';
const frames = new WeakMap();
const frameStates = new WeakMap();
let installed = false;

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

export function renderSafeIframe(frame, html, { sourceHasText = false, onBlank = null } = {}) {
    configureSafeIframe(frame);
    const previousState = frameStates.get(frame);
    if (previousState) clearTimeout(previousState.timeoutId);
    const sourceWindow = frame.contentWindow;
    const state = { frame, sourceWindow, sourceHasText, onBlank, blankHandled: false, received: false, timeoutId: null };
    frameStates.set(frame, state);
    frames.set(sourceWindow, state);
    frame.srcdoc = injectResizeReporter(html);
    state.timeoutId = setTimeout(() => {
        if (!state.received && frame.contentWindow === sourceWindow) {
            frame.style.height = window.innerWidth <= 768 ? '60vh' : '420px';
        }
    }, 500);
}

export function installSafeResizeListener() {
    if (installed) return;
    installed = true;
    window.addEventListener('message', event => {
        if (event?.data?.type !== HEIGHT_MESSAGE) return;
        const state = frames.get(event.source);
        if (!state || frameStates.get(state.frame) !== state || state.sourceWindow !== event.source || state.frame.contentWindow !== event.source) return;
        state.received = true;
        clearTimeout(state.timeoutId);
        const requested = Number(event.data.height);
        if (!Number.isFinite(requested)) return;
        const max = window.innerWidth <= 768 ? window.innerHeight * 0.75 : 720;
        state.frame.style.height = `${Math.min(Math.max(requested, 240), max)}px`;
        const textLength = Number(event.data.textLength);
        if (state.sourceHasText && Number.isFinite(textLength) && textLength === 0 && !state.blankHandled && typeof state.onBlank === 'function') {
            state.blankHandled = true;
            state.onBlank();
        }
    });
}
