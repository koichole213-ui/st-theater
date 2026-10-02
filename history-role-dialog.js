import { escapeHistoryText as e } from './history-collections-ui.js';
import { normalizeRoleSources } from './history-roles.js';
export function historyRoleDialog({ root, title, roles, selected = [] }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'theater-organize-dialog';
        const ids = new Set(normalizeRoleSources(selected).map(role => role.id));
        dialog.innerHTML = `<form><header><h2>${e(title)}</h2><button type="button" data-close aria-label="关闭">×</button></header>
            <p class="theater-dialog-note">可指定一张或多张来源卡；清空后为未指定。不会改正文、标签或文件夹。</p>
            <input type="search" class="theater-input" placeholder="搜索角色" aria-label="搜索角色" data-role-search>
            <div class="theater-pick-summary"><span data-role-count></span><button type="button" data-role-clear>清空已选</button></div>
            <div class="theater-role-choice-list"></div><footer><button type="button" class="theater-btn" data-close>取消</button><button type="submit" class="theater-btn primary">确定</button></footer></form>`;
        let result = null;
        const render = () => {
            const query = dialog.querySelector('[data-role-search]').value.trim().toLocaleLowerCase();
            dialog.querySelector('.theater-role-choice-list').innerHTML = roles.filter(role => String(role.label || role.name).toLocaleLowerCase().includes(query)).map(role => `<label class="theater-pick-row"><input type="checkbox" value="${e(role.id)}" ${ids.has(role.id) ? 'checked' : ''}><span>${e(role.label || role.name)}</span></label>`).join('') || '<p class="theater-dialog-note">没有可选角色，可保留未指定。</p>';
            dialog.querySelector('[data-role-count]').textContent = `已选 ${ids.size} 张来源卡`;
        };
        dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
        dialog.addEventListener('input', event => { if (event.target.matches('[data-role-search]')) render(); });
        dialog.addEventListener('change', event => { if (event.target.matches('input[type=checkbox]')) { event.target.checked ? ids.add(event.target.value) : ids.delete(event.target.value); render(); } });
        dialog.addEventListener('click', event => { if (event.target.closest('[data-close]')) dialog.close(); if (event.target.closest('[data-role-clear]')) { ids.clear(); render(); } });
        dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); result = normalizeRoleSources(roles.filter(role => ids.has(role.id))); dialog.close(); });
        (root || document.body).append(dialog); render(); dialog.showModal();
    });
}
