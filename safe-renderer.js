import { bindResultSwipe } from './result-swipe.js';

const HEIGHT_MESSAGE = 'st-theater:height';
const SWIPE_MESSAGE = 'st-theater:workspace-swipe';
const frames = new WeakMap();
const frameStates = new WeakMap();
const pendingStates = new Set();
let installed = false;

export const RENDER_REPORT_TIMEOUT_MS = 1000;
export const RENDER_EMPTY_GRACE_MS = 1500;

export function sandboxPermissions() {
    return 'allow-scripts';
}

export function injectResizeReporter(html, workspaceSwipe = false) {
    const reporter = `<script data-st-theater-reporter>
(() => {
    ${workspaceSwipe ? `(${bindResultSwipe.toString()})(document, page => parent.postMessage({ type: '${SWIPE_MESSAGE}', page }, '*'));` : ''}
    const report = () => {
        const root = document.documentElement;
        const body = document.body;
        const visibleText = String(body?.innerText || '').trim();
        let sourceText = visibleText;
        if (!sourceText && body) {
            const copy = body.cloneNode(true);
            copy.querySelectorAll('script, style, noscript, template, svg').forEach(node => node.remove());
            sourceText = String(copy.textContent || '').trim();
        }
        parent.postMessage({
            type: '${HEIGHT_MESSAGE}',
            height: Math.ceil(Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0)),
            textLength: sourceText.length,
        }, '*');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report, { once: true });
    else report();
    window.addEventListener('load', report, { once: true });
    if (typeof ResizeObserver === 'function' && document.documentElement) {
        new ResizeObserver(report).observe(document.documentElement);
    }
    [0, 50, 250, 750, 1400].forEach(delay => setTimeout(report, delay));
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

export function renderSafeIframe(frame, html, {
    sourceHasText = false,
    onBlank = null,
    fixedHeight = false,
    fallbackOnNoReport = true,
    blankGraceMs = RENDER_EMPTY_GRACE_MS,
    onWorkspaceSwipe = null,
} = {}) {
    configureSafeIframe(frame);
    if (fixedHeight) frame.style.height = '100%';
    const previousState = frameStates.get(frame);
    if (previousState) {
        clearTimeout(previousState.timeoutId);
        clearTimeout(previousState.blankTimeoutId);
        pendingStates.delete(previousState);
    }
    frame.srcdoc = injectResizeReporter(html, typeof onWorkspaceSwipe === 'function');
    const sourceWindow = frame.contentWindow;
    const state = {
        frame,
        sourceWindow,
        sourceHasText,
        onBlank,
        onWorkspaceSwipe,
        fixedHeight,
        blankGraceMs: Math.max(0, Number(blankGraceMs) || 0),
        blankHandled: false,
        received: false,
        lastTextLength: null,
        timeoutId: null,
        blankTimeoutId: null,
    };
    frameStates.set(frame, state);
    frames.set(sourceWindow, state);
    pendingStates.add(state);
    state.timeoutId = setTimeout(() => {
        if (frameStates.get(frame) !== state || state.received) return;
        pendingStates.delete(state);
        if (!state.fixedHeight) frame.style.height = window.innerWidth <= 768 ? '60vh' : '420px';
        if (fallbackOnNoReport && state.sourceHasText && !state.blankHandled && typeof state.onBlank === 'function') {
            state.blankHandled = true;
            state.onBlank({ reason: 'no-report' });
        }
    }, RENDER_REPORT_TIMEOUT_MS);
}

export function installSafeResizeListener() {
    if (installed) return;
    installed = true;
    window.addEventListener('message', event => {
        if (![HEIGHT_MESSAGE, SWIPE_MESSAGE].includes(event?.data?.type)) return;
        let state = frames.get(event.source);
        if (!state || frameStates.get(state.frame) !== state || state.frame.contentWindow !== event.source) {
            state = [...pendingStates].find(candidate =>
                frameStates.get(candidate.frame) === candidate
                && candidate.frame.contentWindow === event.source
            );
        }
        if (!state || frameStates.get(state.frame) !== state || state.frame.contentWindow !== event.source) return;
        if (event.data.type === SWIPE_MESSAGE) {
            if (['read', 'generate'].includes(event.data.page) && state.frame.isConnected && state.frame.getClientRects().length) {
                state.onWorkspaceSwipe?.(event.data.page);
            }
            return;
        }
        state.sourceWindow = event.source;
        frames.set(event.source, state);
        pendingStates.delete(state);
        state.received = true;
        clearTimeout(state.timeoutId);
        const requested = Number(event.data.height);
        if (Number.isFinite(requested) && !state.fixedHeight) {
            const max = window.innerWidth <= 768 ? window.innerHeight * 0.75 : 720;
            state.frame.style.height = `${Math.min(Math.max(requested, 240), max)}px`;
        }
        const textLength = Number(event.data.textLength);
        if (!state.sourceHasText || !Number.isFinite(textLength)) return;
        state.lastTextLength = textLength;
        if (textLength > 0) {
            clearTimeout(state.blankTimeoutId);
            state.blankTimeoutId = null;
            return;
        }
        if (state.blankHandled || state.blankTimeoutId || typeof state.onBlank !== 'function') return;
        state.blankTimeoutId = setTimeout(() => {
            state.blankTimeoutId = null;
            if (frameStates.get(state.frame) !== state || state.lastTextLength !== 0 || state.blankHandled) return;
            state.blankHandled = true;
            state.onBlank({ reason: 'empty-body' });
        }, state.blankGraceMs);
    });
}
