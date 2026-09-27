// HTML edits only touch static text nodes. No script execution or AI re-render.
const EXCLUDED = 'head,script,style,noscript,template,svg,textarea,select,[hidden],[aria-hidden="true"]';

export function createHtmlTextEdit(html, Parser = globalThis.DOMParser) {
    if (!Parser) throw new Error('当前环境无法安全编辑 HTML，原稿已保留。');
    const source = String(html || '');
    const doc = new Parser().parseFromString(source, 'text/html');
    // Interactive scripts may reconstruct the visible text on every load. Do not
    // report a successful edit that is then silently overwritten by that script.
    if ([...doc.querySelectorAll('script')].some(script => !/^(application\/(?:ld\+)?json)$/i.test(script.type || ''))) {
        throw new Error('这篇包含互动脚本，暂时无法保证改字后不被脚本还原。原 HTML 已保留，不会转为纯文字。');
    }
    if ([...doc.querySelectorAll('*')].some(element => [...element.attributes].some(attribute => /^on/i.test(attribute.name)))) {
        throw new Error('这篇包含互动事件，暂时无法保证改字后不被还原。原 HTML 已保留，不会转为纯文字。');
    }
    const nodes = [];
    const walker = doc.createTreeWalker(doc.body, 4);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.data.trim() || node.parentElement?.closest(EXCLUDED)) continue;
        if (node.parentElement?.closest('[style*="display:none"],[style*="display: none"]')) continue;
        nodes.push(node);
    }
    if (!nodes.length) throw new Error('未找到可以安全修改的正文，原 HTML 已保留。');
    const originalData = nodes.map(node => node.data);
    const original = originalData.map(data => data.replace(/\s+/g, ' ').trim());
    return {
        text: original.join('\n'),
        apply(value) {
            const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
            if (lines.length !== nodes.length) throw new Error('保留排版修改时，请保持原有行数，只修改行内文字；你的修改仍留在编辑框中。');
            if (!lines.some(line => line.trim())) throw new Error('正文不能为空，原稿已保留。');
            if (lines.every((line, i) => line === original[i])) return source;
            if (nodes.some((node, i) => lines[i] !== original[i] && node.parentElement?.closest('pre,[style*="white-space"]'))) {
                throw new Error('这段文字使用了特殊空白排版，暂时无法安全修改；你的修改仍保留在编辑框中。');
            }
            nodes.forEach((node, i) => {
                if (lines[i] === original[i]) { node.data = originalData[i]; return; }
                const leading = originalData[i].match(/^\s*/)[0];
                const trailing = originalData[i].match(/\s*$/)[0];
                node.data = leading + lines[i] + trailing;
            });
            return (doc.doctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML;
        },
    };
}

export function previousResults(current, recent) {
    if (!current?.html) return recent;
    return [current, ...recent.filter(item => item !== current && (!current.resultId || item.resultId !== current.resultId))].slice(0, 3);
}

export function readingPosition(reading, recent) {
    const index = recent.indexOf(reading);
    return { index, count: recent.length, retained: !!reading && index < 0 };
}
