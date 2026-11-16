// 作品 HTML 转纯文字时保留分段。
// 只取 textContent 时，`<br>`、挤在一行的 <p>/<div>、列表都会被粘成一整段；
// 这里在块级元素前后放一个分段记号、把 <br> 换成换行，再把记号连同周围的空白收成换行。
// HTML 源码里本来就有的换行照旧：块与块之间原来空一行的仍空一行，原来只换一行的仍只换一行。

const BREAK = '\u0001';      // 块级元素的边界
const LINE_BREAK = '\u0002'; // <br>
const BLOCK_SELECTOR = [
    'address', 'article', 'aside', 'blockquote', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
    'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
].join(',');

export function stripBreakMarks(value) {
    return String(value ?? '').replaceAll(BREAK, '').replaceAll(LINE_BREAK, '');
}

export function collapseBlockBreaks(text) {
    const result = String(text ?? '')
        .replace(/\r\n?/g, '\n')
        // <br> 后面紧跟的源码换行（和缩进）是排版习惯，不再多算一行。
        .replace(/\u0002[ \t]*\n[ \t]*/g, LINE_BREAK)
        // 块与块之间：源码里原来空一行的仍空一行，否则只换一行。
        // 段尾的一个 <br> 不另起一行（浏览器里也不显示），多出来的 <br> 才算空行。
        .replace(/[ \t\n\u0001\u0002]*\u0001[ \t\n\u0001\u0002]*/g, run => {
            const lines = (run.match(/\n/g)?.length || 0) + Math.max(0, (run.match(/\u0002/g)?.length || 0) - 1);
            return lines >= 2 ? '\n\n' : '\n';
        })
        .replaceAll(LINE_BREAK, '\n')
        // 只去首尾的普通空白；段首的全角缩进（　　）是正文的一部分。
        .replace(/^[ \t\n\u00a0]+|[ \t\n\u00a0]+$/g, '');
    // 只剩空白（包括全角空格）时当作没有文字，调用处会退回别的来源。
    return /\S/.test(result) ? result : '';
}

// root：已经在空白文档里解析好的元素（不能是酒馆页面上的元素）。没有 DOM 能力时退回 textContent。
export function plainTextFromParsedHtml(root) {
    const doc = root?.ownerDocument;
    if (doc?.createTextNode && typeof root.querySelectorAll === 'function') {
        root.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode(LINE_BREAK)));
        root.querySelectorAll('td,th').forEach(cell => cell.after(doc.createTextNode(' ')));
        root.querySelectorAll(BLOCK_SELECTOR).forEach(element => {
            element.before(doc.createTextNode(BREAK));
            element.after(doc.createTextNode(BREAK));
        });
    }
    return collapseBlockBreaks(root?.textContent || root?.innerText || '');
}
