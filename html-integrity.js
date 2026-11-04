// Bounded structural checks only: never execute generated code or fetch resources.
// A passing result does not prove arbitrary JavaScript interactions are correct.
const BUILTIN_ACTIONS = new Set([
    'alert', 'confirm', 'prompt', 'print', 'open', 'close', 'focus', 'blur', 'click',
    'submit', 'requestSubmit', 'reset', 'show', 'showModal', 'requestFullscreen',
    'scroll', 'scrollTo', 'scrollBy', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'getSelection',
    'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask',
    'addEventListener', 'removeEventListener', 'dispatchEvent', 'postMessage',
    'fetch', 'getComputedStyle', 'matchMedia', 'structuredClone', 'createImageBitmap',
    'reportError', 'find', 'moveTo', 'moveBy', 'resizeTo', 'resizeBy', 'stop',
    'atob', 'btoa', 'eval', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
    'escape', 'unescape', 'String', 'Number', 'Boolean', 'BigInt', 'Symbol',
    'Object', 'Array', 'Date', 'RegExp', 'Function', 'Error', 'TypeError',
    'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError',
]);
const MESSAGES = Object.freeze({
    'missing-script': '互动按钮需要的脚本缺失，后续正文可能无法打开',
    'unclosed-script': '互动脚本未完整结束，页面可能被截断',
    'unclosed-style': '页面样式未完整结束，正文可能无法显示',
    'incomplete-document': '互动 HTML 文档未完整结束，不能将补闭合标签当作排版完成',
});

export function htmlCandidate(source = '') {
    const text = String(source || '');
    const fence = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/);
    if (fence) return fence[1].trim();
    const full = text.match(/(<!DOCTYPE[\s\S]*?<\/html\s*>)/i) || text.match(/(<html\b[\s\S]*?<\/html\s*>)/i);
    if (full) return full[1].trim();
    const partial = text.match(/(<!DOCTYPE[\s\S]*)/i) || text.match(/(<html\b[\s\S]*)/i);
    return (partial ? partial[1] : text).trim();
}

function attributes(text) {
    const result = new Map();
    const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const match of text.matchAll(pattern)) result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    return result;
}

export function inspectHtmlIntegrity(source = '') {
    const html = htmlCandidate(source);
    const issues = new Set();
    let executableScripts = 0, handlers = 0, missingScriptCalls = 0;
    const tokens = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
    for (let match; (match = tokens.exec(html));) {
        if (!match[1] || /^<\//.test(match[0])) continue;
        const tag = match[1].toLowerCase();
        const attrs = attributes(match[2]);
        // Raw-text/inert regions must not contribute fake onclick attributes.
        if (['script', 'style', 'textarea', 'title', 'noscript', 'template'].includes(tag)) {
            const closing = new RegExp(`<\\/${tag}\\s*>`, 'gi');
            closing.lastIndex = tokens.lastIndex;
            const end = closing.exec(html);
            if (tag === 'script') {
                const type = (attrs.get('type') || '').split(';')[0].trim().toLowerCase();
                const executable = !type || type === 'module' || /^(?:text|application)\/(?:java|ecma)script$/.test(type);
                if (executable && (attrs.get('src') || html.slice(tokens.lastIndex, end?.index ?? html.length).trim())) executableScripts++;
            }
            if (!end && (tag === 'script' || tag === 'style')) issues.add(`unclosed-${tag}`);
            tokens.lastIndex = end ? closing.lastIndex : html.length;
            continue;
        }
        for (const [name, value] of attrs) {
            if (!/^on[a-z]+$/.test(name)) continue;
            handlers++;
            const call = value.match(/^\s*(?:return\s+)?(?:(?:window|globalThis)\s*\.\s*)?([a-z_$][\w$]*)\s*\(/i);
            if (call && !BUILTIN_ACTIONS.has(call[1])) missingScriptCalls++;
        }
    }
    if (missingScriptCalls && !executableScripts) issues.add('missing-script');
    const hasInteractions = handlers > 0 || executableScripts > 0;
    if (hasInteractions && /<(?:!doctype|html)\b/i.test(html)
        && (!/<\/html\s*>/i.test(html) || /<body\b/i.test(html) && !/<\/body\s*>/i.test(html))) {
        issues.add('incomplete-document');
    }
    return { valid: issues.size === 0, issues: [...issues], executableScripts, handlers };
}

export function assertHtmlIntegrity(source = '') {
    const inspection = inspectHtmlIntegrity(source);
    if (!inspection.valid) {
        const error = new Error(MESSAGES[inspection.issues[0]]);
        error.code = 'THEATER_RENDER_VALIDATION';
        error.htmlIntegrityReason = inspection.issues[0];
        throw error;
    }
    return inspection;
}

// Recover only text already present in the document; never invent a missing story.
export function recoverHtmlText(source = '') {
    const text = htmlCandidate(source)
        .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
        .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
        .replace(/<br\s*\/?>|<\/(?:p|div|section|article|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[\da-f]+);/gi, entity => {
            const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
            if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
            const hex = /^&#x/i.test(entity);
            const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
        });
    return text.replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
