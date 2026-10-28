// Request-local subset of prompt macros. Never calls host macros, eval, or shared variables.
export function resolveTheaterPreset(entries = [], context = {}, { targetChars = null, random = Math.random } = {}) {
    const variables = new Map();
    const stats = { resolvedMacros: 0, unsupportedMacros: 0, lengthOverrides: 0 };
    let operations = 0;
    const splitArguments = text => {
        const parts = []; let depth = 0, start = 0;
        for (let i = 0; i < text.length - 1; i++) {
            const pair = text.slice(i, i + 2);
            if (pair === '{{') { depth++; i++; }
            else if (pair === '}}') { depth--; i++; }
            else if (pair === '::' && depth === 0) { parts.push(text.slice(start, i)); start = i + 2; i++; }
        }
        return [...parts, text.slice(start)];
    };
    const expand = (value, depth = 0) => {
        if (depth > 32 || ++operations > 10000) throw new Error('预设变量嵌套或数量超过安全处理范围，请精简所选条目');
        const text = String(value || ''); let output = '', cursor = 0;
        while (cursor < text.length) {
            const start = text.indexOf('{{', cursor);
            if (start < 0) { output += text.slice(cursor); break; }
            output += text.slice(cursor, start);
            let nesting = 1, end = start + 2;
            for (; end < text.length - 1; end++) {
                const pair = text.slice(end, end + 2);
                if (pair === '{{') { nesting++; end++; }
                else if (pair === '}}' && --nesting === 0) break;
                else if (pair === '}}') end++;
            }
            if (nesting) { output += text.slice(start); break; }
            const original = text.slice(start, end + 2);
            const body = text.slice(start + 2, end).trim();
            const parts = splitArguments(body);
            const name = parts[0].trim().toLowerCase();
            let replacement;
            if (name.startsWith('//')) replacement = '';
            else if (name === 'trim') replacement = '\u0000THEATER_TRIM\u0000';
            else if (name === 'setvar' && parts.length >= 3) {
                const key = expand(parts[1], depth + 1).trim();
                variables.set(key, expand(parts.slice(2).join('::'), depth + 1));
                replacement = '';
            } else if (name === 'getvar' && parts.length === 2) replacement = variables.get(expand(parts[1], depth + 1).trim()) || '';
            else if (name === 'random' && parts.length > 1) {
                const options = parts.slice(1);
                const chosen = Math.min(options.length - 1, Math.max(0, Math.floor(Number(random()) * options.length) || 0));
                replacement = expand(options[chosen], depth + 1);
            } else if (['user', 'char', 'lastusermessage'].includes(name)) {
                const key = name === 'lastusermessage' ? 'lastUserMessage' : name;
                replacement = context[key] == null ? undefined : String(context[key]);
            }
            if (replacement === undefined) { stats.unsupportedMacros++; output += original; }
            else { stats.resolvedMacros++; output += replacement; }
            cursor = end + 2;
        }
        if (output.length > 2000000) throw new Error('预设变量展开结果过大，请精简所选条目');
        return output.replace(/\s*\u0000THEATER_TRIM\u0000\s*/g, '');
    };
    const target = Math.round(Number(targetChars));
    const resolved = entries.map(entry => {
        let content = expand(entry.content);
        if (target > 0 && Number.isFinite(target)) {
            let lengthSection = false;
            content = content.split('\n').map(line => {
                if (/^\s*#{1,6}\s/.test(line)) lengthSection = /^\s*#{1,6}\s*(?:正文)?(?:字数|字數|篇幅)(?:要求|目标|限制)?\s*$/.test(line);
                const standaloneLength = /^\s*(?:[-*]\s*)?(?:正文|<content>|字数|字數|篇幅)/.test(line);
                if (!lengthSection && !standaloneLength) return line;
                // Only the number attached to an explicit body-length directive is changed.
                // A heading does not authorize rewriting thought steps, quotations, or examples.
                const range = '(?:约|約|~)?\\s*\\d[\\d,]*(?:\\s*[-–—~～至到]\\s*\\d[\\d,]*)?\\s*字';
                const directive = new RegExp(`((?:正文(?:<content>)?(?:内|的)?|<content>内?|字数(?:要求|目标)?|字數(?:要求|目标)?|篇幅(?:要求|目标)?)(?:\\s|[:：=]|必须|应|需要|请|输出|写出|写|字数|长度|篇幅|目标|控制在|控制|为|约|至少|不少于|达到){0,12})${range}`, 'g');
                let rewritten = line.replace(directive, (_match, prefix, offset) => {
                    if (/(?:示例|例如|举例|例子|引用|引文|台词|角色说)/.test(line.slice(0, offset))) return _match;
                    stats.lengthOverrides++; return `${prefix}${target} 字（以本次目标为准）`;
                });
                if (lengthSection && new RegExp(`^\\s*(?:[-*]\\s*)?${range}\\s*[。.!！]?\\s*$`).test(line)) {
                    rewritten = line.replace(new RegExp(range), () => {
                        stats.lengthOverrides++; return `${target} 字（以本次目标为准）`;
                    });
                }
                return rewritten;
            }).join('\n');
        }
        return { ...entry, content };
    });
    return { entries: resolved, stats };
}
