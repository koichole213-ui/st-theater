// Local metadata only. Avatar filenames identify cards; names are display snapshots.
export const ROLE_UNASSIGNED = '__unassigned__';
export function normalizeRoleSources(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).filter(role => role && typeof role.id === 'string' && role.id && !seen.has(role.id) && seen.add(role.id))
        .map(role => ({ id: role.id, name: String(role.name || '未命名角色'), avatar: String(role.avatar || '') }));
}
export function characterRole(character) {
    const avatar = String(character?.avatar || '');
    return avatar && avatar !== 'none' ? { id: `card:${avatar}`, name: String(character.name || character.data?.name || '未命名角色'), avatar } : null;
}
export function captureHistoryRoles(ctx = {}) {
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    if (ctx.groupId != null && ctx.groupId !== '') {
        const group = (ctx.groups || []).find(group => String(group.id) === String(ctx.groupId));
        const disabled = new Set(group?.disabled_members || []);
        const members = new Set((group?.members || []).filter(avatar => !disabled.has(avatar)));
        return normalizeRoleSources(characters.filter(card => members.has(card.avatar)).map(characterRole));
    }
    return normalizeRoleSources([characterRole(characters[ctx.characterId])]);
}
export function matchesRoleFilter(item, filter = '') {
    const roles = normalizeRoleSources(item?.roleSources);
    return !filter || (filter === ROLE_UNASSIGNED ? !roles.length : roles.some(role => role.id === filter));
}
export function historyRoleOptions(items = [], characters = []) {
    const saved = normalizeRoleSources(items.flatMap(item => normalizeRoleSources(item.roleSources)));
    const current = normalizeRoleSources(characters.map(characterRole));
    const roles = normalizeRoleSources([...current, ...saved]);
    return roles.map(role => {
        const previous = [...new Set(items.flatMap(item => normalizeRoleSources(item.roleSources)).filter(old => old.id === role.id && old.name !== role.name).map(old => old.name))];
        const duplicate = roles.filter(other => other.name === role.name).length > 1;
        return { ...role, label: `${role.name}${duplicate ? `（${role.avatar || role.id}）` : ''}${previous.length ? ` · 原名 ${previous.join('、')}` : ''}${current.some(card => card.id === role.id) ? '' : ' · 已留存来源'}` };
    });
}
