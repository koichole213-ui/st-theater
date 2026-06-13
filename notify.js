export function theaterError(message, title = '', opts = {}) {
    const text = String(message || '');
    toastr.error(text, title, { timeOut: 12000, extendedTimeOut: 8000, closeButton: true, ...opts });
    console.error('[Theater]', title || 'Error', text);

    let box = document.getElementById('theater-error-notice');
    if (!box) {
        box = document.createElement('div');
        box.id = 'theater-error-notice';
        box.innerHTML = '<button type="button" class="theater-error-close" title="Close">&times;</button><div class="theater-error-title"></div><pre class="theater-error-text"></pre>';
        document.documentElement.appendChild(box);
        box.querySelector('.theater-error-close')?.addEventListener('click', () => box.remove());
    }
    box.querySelector('.theater-error-title').textContent = title || '小剧场报错';
    box.querySelector('.theater-error-text').textContent = text;
}
