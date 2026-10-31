// Request-local variation only. Never mutate presets, chat history or response text.
function nonce() {
    const bytes = new Uint8Array(8);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function structured(text) {
    if (/^\s*(?:<\?xml|<(?:think|thinking|plan|konatan_planning)\b)/i.test(text)) return true;
    try { return typeof JSON.parse(text) === 'object'; } catch { return false; }
}

// Be conservative around executable/structured material. XML/HTML messages and
// JSON documents retain their exact bytes; code, URLs and macros in prose do too.
function varyProse(text, budget) {
    if (/[<>`"'()=\\]/.test(text)) return text;
    const spans = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|\{\{[\s\S]*?\}\}|[a-z][a-z0-9+.-]*:[^\s]+/gi;
    const vary = plain => plain.split(/(\r?\n)/).map(line => {
        if (/^(?: {4}|\t)/.test(line) || /[{}\[\]\\]/.test(line)) return line;
        return line.replace(/([，。；：、！？])(?=[\u4e00-\u9fffA-Za-z])/g, mark => {
            if (budget.left <= 0 || Math.random() >= 0.45) return mark;
            budget.left--;
            return mark + ' ';
        });
    }).join('');
    let result = '', end = 0;
    for (const match of text.matchAll(spans)) {
        result += vary(text.slice(end, match.index)) + match[0];
        end = match.index + match[0].length;
    }
    return result + vary(text.slice(end));
}

export function applyAntiRoute(messages, enabled = false) {
    if (enabled !== true) return messages;
    const headed = new Set();
    const budget = { left: 64 };
    return messages.map(message => {
        if (!message || !['system', 'user'].includes(message.role)
            || message.tool_calls || message.function_call
            || typeof message.content !== 'string' || !message.content.trim()
            || structured(message.content)) return message;
        const prefix = headed.has(message.role) ? '' : `<!-- st-theater:${nonce()} -->\n`;
        headed.add(message.role);
        return { ...message, content: prefix + varyProse(message.content, budget) };
    });
}
