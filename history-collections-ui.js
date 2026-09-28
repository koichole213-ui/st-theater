import { collectionPage, collectionChapters } from './history-collections.js';

export const escapeHistoryText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const e = escapeHistoryText;
const collectionIcons = { up: 'arrow-up', down: 'arrow-down', move: 'folder-open', remove: 'arrow-right-from-bracket', add: 'folder-plus', rename: 'pen', dissolve: 'folder-minus' };
const button = (action, label, id, disabled = false) => `<button type="button" class="theater-btn" data-collection-action="${action}" data-collection-id="${e(id)}" ${disabled ? 'disabled' : ''}><i class="fa-solid fa-${collectionIcons[action]}" aria-hidden="true"></i><span>${label}</span></button>`;

export function collectionCardHTML(entry, { expanded, selected, itemHTML, batch = false, searching = false }) {
    const { folder, chapters, count } = entry;
    return `<section class="theater-collection-card">
        <button type="button" class="theater-series-head" data-collection-action="toggle" data-collection-id="${e(folder.id)}" aria-expanded="${expanded}" ${searching || batch ? 'aria-disabled="true" title="搜索或批量管理时自动展开"' : ''}>
            <i class="fa-regular fa-folder theater-folder-icon"></i><span class="theater-history-heading"><span class="theater-history-title">${e(folder.title)}</span><span class="theater-series-meta">${count} 篇${chapters.length !== count ? ` · 显示 ${chapters.length} 篇` : ''}</span></span><span aria-hidden="true">${expanded ? '⌄' : '›'}</span>
        </button>
        ${expanded ? `<div class="theater-chapter-list">${chapters.map((versions, index) => {
            const position = entry.positions?.[index] ?? index;
            const item = versions.find(item => String(item.id) === selected.get(`${folder.id}:${index}`)) || versions.at(-1);
            return `<div class="theater-chapter-wrap" data-chapter-id="${e(item.id)}">
                <div class="theater-chapter-line"><button type="button" class="theater-history-view theater-chapter" data-id="${e(item.id)}"><span class="theater-chapter-number">${String(position + 1).padStart(2, '0')}</span><span class="theater-chapter-copy"><strong>${e(item.title)}</strong><small>${e(item.date)}${versions.length > 1 ? ` · ${versions.length} 个版本` : ''}</small></span></button><button type="button" class="theater-chapter-options" data-collection-action="menu" data-collection-id="${e(folder.id)}" aria-label="${e(item.title)}的操作" aria-expanded="false">⋯</button></div>
                ${versions.length > 1 ? `<label class="theater-history-version">本篇版本 <select class="theater-input" data-collection-version="${e(folder.id)}:${index}">${versions.map((version, n) => `<option value="${e(version.id)}" ${version.id === item.id ? 'selected' : ''}>版本 ${n + 1} · ${e(version.title)}</option>`).join('')}</select></label>` : ''}
                <div class="theater-chapter-menu" ${batch ? '' : 'hidden'}>${batch ? versions.map(itemHTML).join('') : itemHTML(item)}<div class="theater-chapter-organize">${button('up', '上移', folder.id, position === 0)}${button('down', '下移', folder.id, position === count - 1)}${button('move', '移到文件夹', folder.id)}${button('remove', '移出文件夹', folder.id)}</div></div>
            </div>`;
        }).join('')}</div>` : ''}
        <div class="theater-collection-actions">${button('add', '加入剧场', folder.id)}${button('rename', '改名', folder.id)}${button('dissolve', '解散文件夹', folder.id)}</div>
    </section>`;
}

// Native modal is appended inside the popup to inherit its selected skin and focus scope.
export function collectionDialog({ root, title, name, items, folders, note = '', submit = '保存' }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'theater-organize-dialog';
        const selected = new Set();
        let page = 0, query = '';
        dialog.innerHTML = `<form method="dialog"><header><h2>${e(title)}</h2><button type="button" data-close aria-label="关闭">×</button></header>
            ${name !== undefined ? `<label class="theater-field-label">文件夹名称<input class="theater-input" name="folderName" maxlength="160" required value="${e(name)}" placeholder="给这个系列起个名字"></label>` : ''}
            ${folders ? `<label class="theater-field-label">移入文件夹<select class="theater-input" name="folderId" required>${folders.map(folder => `<option value="${e(folder.id)}">${e(folder.title)}</option>`).join('')}</select></label>` : ''}
            ${note ? `<p class="theater-dialog-note">${e(note)}</p>` : ''}
            ${items ? `<input type="search" class="theater-input" data-pick-search placeholder="搜索要收纳的剧场标题" aria-label="搜索要收纳的剧场标题"><div class="theater-pick-summary"><span data-pick-count role="status"></span><button type="button" data-pick-clear>清空已选</button></div><div class="theater-pick-list"></div><nav class="theater-collection-pagination" aria-label="选择剧场翻页"></nav>` : ''}
            <footer><button type="button" class="theater-btn" data-close>取消</button><button class="theater-btn primary" type="submit">${e(submit)}</button></footer></form>`;
        const render = () => {
            if (!items) return;
            const state = collectionPage(items.filter(item => String(item.title || '').toLocaleLowerCase().includes(query)), page, 10);
            page = state.page;
            dialog.querySelector('.theater-pick-list').innerHTML = state.items.map(item => `<label class="theater-pick-row"><input type="checkbox" value="${e(item.id)}" ${selected.has(String(item.id)) ? 'checked' : ''}><span><strong>${e(item.title || '未命名小剧场')}</strong><small>${e(item.date)}</small></span></label>`).join('') || '<p class="theater-dialog-note">没有找到可加入的剧场</p>';
            dialog.querySelector('[data-pick-count]').textContent = `已选 ${selected.size} 篇 · 找到 ${state.total} 篇`;
            dialog.querySelector('[data-pick-clear]').disabled = !selected.size;
            dialog.querySelector('nav').innerHTML = `<button type="button" data-pick-step="-1" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${state.pageCount}</span><button type="button" data-pick-step="1" ${page + 1 === state.pageCount ? 'disabled' : ''}>下一页</button>`;
        };
        let result = null;
        dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
        dialog.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button || button.disabled) return;
            if (button.hasAttribute('data-close')) dialog.close();
            if (button.hasAttribute('data-pick-clear')) { selected.clear(); render(); }
            if (button.dataset.pickStep) { page += Number(button.dataset.pickStep); render(); dialog.querySelector('.theater-pick-list').scrollTop = 0; }
        });
        dialog.addEventListener('input', event => { if (event.target.matches('[data-pick-search]')) { query = event.target.value.trim().toLocaleLowerCase(); page = 0; render(); } });
        dialog.addEventListener('change', event => {
            if (event.target.matches('input[type=checkbox]')) { event.target.checked ? selected.add(event.target.value) : selected.delete(event.target.value); render(); }
        });
        dialog.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            const field = dialog.querySelector('[name=folderName]');
            if (field && !field.value.trim()) { field.setCustomValidity('请填写文件夹名称'); field.reportValidity(); field.oninput = () => field.setCustomValidity(''); return; }
            result = { title: field?.value.trim(), ids: [...selected], folderId: dialog.querySelector('[name=folderId]')?.value };
            dialog.close();
        });
        (root || document.body).append(dialog); render(); dialog.showModal();
    });
}

export function collectionChapterIds(folder, items, itemId) {
    return (collectionChapters(folder, items).find(versions => versions.some(item => String(item.id) === String(itemId))) || []).map(item => String(item.id));
}
