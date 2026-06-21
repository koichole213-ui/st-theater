export function theaterError(message, title = '', opts = {}) {
    const text = String(message || '');
    toastr.error(text, title, { timeOut: 7000, extendedTimeOut: 2000, closeButton: false, ...opts });
    console.error('[Theater]', title || 'Error', text);
}
