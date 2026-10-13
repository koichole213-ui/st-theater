// Session-only display state. Never writes stored works or generation settings.
import { captureHistoryRoles, historyRoleOptions, matchesRoleFilter, ROLE_UNASSIGNED } from './history-roles.js';
import { normalizeTagList, TAG_UNCATEGORIZED } from './tag-system.js';
import { escapeHistoryText as e } from './history-collections-ui.js';

let expandedItem = null;
let filterPanel = null;
export const isHistoryItemExpanded = id => expandedItem === String(id);
export function setExpandedHistoryItem(id) { expandedItem = id == null ? null : String(id); }
export function toggleHistoryItem(id) { setExpandedHistoryItem(isHistoryItemExpanded(id) ? null : id); }
export function setHistoryFilterPanel(panel) { filterPanel = panel; }
export function toggleHistoryFilterPanel(panel) { filterPanel = filterPanel === panel ? null : panel; }

export function historyFiltersHTML(runtime, ctx = {}) {
    // Retain the existing invalid-source-filter reset and same-name identity rules.
    runtime.historyRoleFilterHTML();
    const current = captureHistoryRoles(ctx);
    const roles = [{ id: '', label: '全部角色' }, { id: '__current__', label: '只看当前角色' },
        ...historyRoleOptions(runtime.historyCache, ctx.characters || []), { id: ROLE_UNASSIGNED, label: '未指定角色' }];
    const roleLabel = roles.find(role => role.id === runtime.historyRoleFilter)?.label || '全部角色';
    const tags = normalizeTagList([...runtime.knownInstructionTags(), ...runtime.historyCache.flatMap(item => item.tags || [])]);
    const selected = runtime.settings.historyTagFilter || [];
    const rolePanel = filterPanel === 'role' ? `<div class="theater-history-filter-panel" id="theater-history-role-panel" role="group" aria-label="按角色筛选"><div class="theater-history-role-options">${roles.map(role => `<button type="button" class="theater-history-role-option" data-history-role="${e(role.id)}" aria-pressed="${runtime.historyRoleFilter === role.id}"><span class="theater-history-radio" aria-hidden="true"></span><span>${e(role.label)}</span>${current.some(card => card.id === role.id) ? '<em>当前角色</em>' : ''}<small>${runtime.historyCache.filter(item => matchesRoleFilter(item, role.id, current)).length}</small></button>`).join('')}</div></div>` : '';
    const tagPanel = filterPanel === 'tag' ? `<div class="theater-history-filter-panel" id="theater-history-tag-panel" role="group" aria-label="按标签筛选"><p class="theater-hint">可多选：作品需同时带有所选标签。</p><div class="theater-history-filter-pills">${[TAG_UNCATEGORIZED, ...tags].map(tag => `<button type="button" data-history-tag="${e(tag)}" aria-pressed="${selected.includes(tag)}"${tag === TAG_UNCATEGORIZED ? ' class="is-uncategorized"' : ''}>${tag === TAG_UNCATEGORIZED ? '未分类' : '# ' + e(tag)}</button>`).join('')}</div><div class="theater-history-filter-footer"><button type="button" data-history-tags-clear>不限标签</button><button type="button" data-history-filter-done>完成</button></div></div>` : '';
    return `<div class="theater-history-filters"><button type="button" id="theater-history-role-filter" class="theater-history-role-filter-wrap" aria-expanded="${filterPanel === 'role'}" aria-controls="theater-history-role-panel"><i class="fa-solid fa-user" aria-hidden="true"></i><strong>角色</strong><span>${e(roleLabel)}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button><button type="button" id="theater-history-tag-filter" aria-expanded="${filterPanel === 'tag'}" aria-controls="theater-history-tag-panel"><strong># 标签</strong><span data-history-tag-value>${e(runtime.historyTagFilterLabel())}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button></div>${rolePanel}${tagPanel}`;
}
