// @theater-source-begin fallbackCopy
export function fallbackCopy(text, target = document.body) {
    let ta = null;
    try {
        // 关键：先把当前焦点和选区清掉，避免 execCommand('copy') 复制到之前选中的输入框内容
        // 这是 v2.1.1 修的 bug——之前 #theater-instruction 处于焦点/有选区时，临时 textarea 抢不到 selection
        const prevActive = document.activeElement;
        if (prevActive && typeof prevActive.blur === 'function') {
            try { prevActive.blur(); } catch {}
        }
        const sel = window.getSelection();
        if (sel) { try { sel.removeAllRanges(); } catch {} }

        // Mount inside the active dialog when the surrounding page is inert.
        ta = document.createElement('textarea');
        ta.value = text;
        ta.readOnly = true;
        // 保持元素位于可渲染区域但完全透明，部分移动端 WebView 不会复制屏幕外元素。
        ta.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:.01;z-index:2147483647';
        target.appendChild(ta);

        // iOS 需要特殊处理
        const isIOS = navigator.userAgent.match(/ipad|iphone/i);
        if (isIOS) {
            const range = document.createRange();
            range.selectNodeContents(ta);
            const s2 = window.getSelection();
            s2.removeAllRanges();
            s2.addRange(range);
            ta.setSelectionRange(0, text.length);
        } else {
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
        }

        const ok = document.execCommand('copy');
        target.removeChild(ta);
        ta = null;
        return !!ok;
    } catch {
        return false;
    } finally {
        if (ta?.parentNode) ta.parentNode.removeChild(ta);
    }
}
// @theater-source-end fallbackCopy
