export const LIST_PAGE_SIZE = 10;

export function listPage(items, requestedPage = 0) {
    const pageCount = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE));
    const page = Math.max(0, Math.min(pageCount - 1, Math.trunc(Number(requestedPage) || 0)));
    return { page, pageCount, total: items.length, items: items.slice(page * LIST_PAGE_SIZE, (page + 1) * LIST_PAGE_SIZE) };
}

export function requestedListPage(action, current, pageCount, input) {
    if (action === 'first') return 0;
    if (action === 'last') return pageCount - 1;
    if (action === 'prev') return current - 1;
    if (action === 'next') return current + 1;
    const value = Number(input);
    return Number.isInteger(value) && value >= 1 ? value - 1 : current;
}

export function listPaginationHTML(kind, state) {
    if (!state.total) return '';
    const { page, pageCount, total } = state;
    const label = kind === 'inst' ? '模板' : '历史';
    const button = (action, title, disabled = false) => `<button type="button" class="theater-btn theater-list-page" data-page-action="${action}" aria-label="${title}" ${disabled ? 'disabled' : ''}>${action === 'prev' ? '‹' : action === 'next' ? '›' : title}</button>`;
    return `<nav class="theater-inst-pagination" data-list-kind="${kind}" data-page-count="${pageCount}" aria-label="${label}分页">
        <span class="theater-page-summary">共 ${total} 条 · 每页 ${LIST_PAGE_SIZE} 条</span>
        <div class="theater-page-navigation">${button('first', '首页', page === 0)}${button('prev', '上一页', page === 0)}<span class="theater-page-position" aria-live="polite" aria-label="第 ${page + 1} 页，共 ${pageCount} 页"><strong>${page + 1}</strong><span>/ ${pageCount}</span></span>${button('next', '下一页', page === pageCount - 1)}${button('last', '末页', page === pageCount - 1)}</div>
        <div class="theater-page-jump"><label>跳至 <input class="theater-input theater-page-number" type="number" inputmode="numeric" min="1" max="${pageCount}" value="${page + 1}" aria-label="${label}页码"> 页</label>${button('jump', '跳转')}</div>
    </nav>`;
}
