import { inspectHtmlIntegrity, recoverHtmlText } from './html-integrity.js';
import { buildPlainTextHtml } from './plain-text-renderer.js';
import { bindResultSwipe } from './result-swipe.js';

const HEIGHT_MESSAGE = 'st-theater:height';
const SWIPE_MESSAGE = 'st-theater:workspace-swipe';
const STORY_ERROR_MESSAGE = 'st-theater:story-error';
const STORY_ERROR_NAMES = /^(?:Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError|SecurityError|NotAllowedError|NotSupportedError|InvalidStateError|AbortError)$/;
const frames = new WeakMap();
const frameStates = new WeakMap();
const pendingStates = new Set();
const installedWindows = new WeakSet();
let nextRenderId = 0;

export const RENDER_REPORT_TIMEOUT_MS = 1000;
export const RENDER_EMPTY_GRACE_MS = 1500;

export function sandboxPermissions() {
    return 'allow-scripts';
}

export function injectStoryErrorReporter(html, renderId) {
    const reporter = `<script data-st-theater-story-errors>
(() => {
    let reported = 0;
    function report(error) {
        if (reported >= 3) return;
        reported++;
        const name = error?.name;
        parent.postMessage({
            type: '${STORY_ERROR_MESSAGE}',
            renderId: ${JSON.stringify(renderId)},
            message: ${STORY_ERROR_NAMES}.test(name) ? name : 'Error',
        }, '*');
    }
    addEventListener('error', event => report(event.error));
    addEventListener('unhandledrejection', event => report(event.reason));
})();
</script>`;
    // Match only the opening document structure. A head-like tag inside a
    // comment, attribute, or inline script must not move the reporter there.
    const prefix = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype\b[^>]*>(?:\s|<!--[\s\S]*?-->)*)?(?:<html(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>(?:\s|<!--[\s\S]*?-->)*)?(?:<head(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>)?/i;
    const offset = html.match(prefix)[0].length;
    return html.slice(0, offset) + reporter + html.slice(offset);
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

function forgetFrameState(frame) {
    const state = frameStates.get(frame);
    if (!state) return;
    clearTimeout(state.timeoutId);
    clearTimeout(state.blankTimeoutId);
    pendingStates.delete(state);
    frameStates.delete(frame);
    frames.delete(state.sourceWindow);
}

export function clearSafeIframe(frame) {
    forgetFrameState(frame);
    frame.srcdoc = '';
}

export function renderSafeIframe(frame, html, {
    sourceHasText = false,
    onBlank = null,
    fixedHeight = false,
    fallbackOnNoReport = true,
    blankGraceMs = RENDER_EMPTY_GRACE_MS,
    onWorkspaceSwipe = null,
    onStoryError = null,
} = {}) {
    configureSafeIframe(frame);
    if (fixedHeight) frame.style.height = '100%';
    forgetFrameState(frame);
    // Stored/imported originals remain untouched; only a confirmed broken preview
    // uses a readable recovery view. CSS-only and complete scripted pages pass through.
    const inspection = inspectHtmlIntegrity(html);
    const displayHtml = inspection.valid ? html : buildPlainTextHtml(
        '【页面交互未完成】下方显示文件中可读取的内容，原 HTML 文件保持不变。\n\n' + recoverHtmlText(html),
    );
    const renderId = ++nextRenderId;
    const reportStoryError = inspection.valid && typeof onStoryError === 'function'
        && (inspection.executableScripts > 0 || inspection.handlers > 0);
    const reportedHtml = reportStoryError ? injectStoryErrorReporter(displayHtml, renderId) : displayHtml;
    const swipeInside = typeof onWorkspaceSwipe === 'function'
        && (!inspection.valid || (inspection.executableScripts === 0 && inspection.handlers === 0));
    frame.srcdoc = injectResizeReporter(reportedHtml, swipeInside);
    const sourceWindow = frame.contentWindow;
    const state = {
        frame,
        sourceWindow,
        sourceHasText,
        onBlank,
        onWorkspaceSwipe: swipeInside ? onWorkspaceSwipe : null,
        onStoryError: reportStoryError ? onStoryError : null,
        renderId,
        storyErrorCount: 0,
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
    if (installedWindows.has(window)) return;
    installedWindows.add(window);
    window.addEventListener('message', event => {
        if (![HEIGHT_MESSAGE, SWIPE_MESSAGE, STORY_ERROR_MESSAGE].includes(event?.data?.type)) return;
        let state = frames.get(event.source);
        if (!state || frameStates.get(state.frame) !== state || state.frame.contentWindow !== event.source) {
            state = [...pendingStates].find(candidate =>
                frameStates.get(candidate.frame) === candidate
                && candidate.frame.contentWindow === event.source
            );
        }
        if (!state || frameStates.get(state.frame) !== state || state.frame.contentWindow !== event.source) return;
        if (event.data.type === STORY_ERROR_MESSAGE) {
            if (!state.onStoryError || !state.frame.isConnected || event.data.renderId !== state.renderId || state.storyErrorCount >= 3) return;
            state.storyErrorCount++;
            const message = event.data.message;
            state.onStoryError(typeof message === 'string' && STORY_ERROR_NAMES.test(message) ? message : 'Error');
            return;
        }
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
