import { power_user } from '../../../power-user.js';
import { user_avatar } from '../../../personas.js';

export function readCurrentUserPersona() {
    const ctx = SillyTavern.getContext();
    const currentAvatar = user_avatar || ctx.user_avatar || ctx.userAvatar || window.user_avatar || '';
    const selectedKeys = [
        currentAvatar,
        ctx.user_avatar,
        ctx.userAvatar,
        window.user_avatar,
        power_user?.user_avatar,
        window.power_user?.user_avatar,
        ctx.name1,
    ].filter(Boolean).map(v => String(v).trim());

    const stores = [
        power_user?.persona_descriptions,
        window.power_user?.persona_descriptions,
        ctx.powerUserSettings?.persona_descriptions,
    ].filter(Boolean);

    const lookupStores = keysToFind => {
        for (const store of stores) {
            if (Array.isArray(store)) {
                for (const item of store) {
                    const keys = [item?.avatar, item?.name, item?.key, item?.id, item?.filename].filter(Boolean).map(v => String(v).trim());
                    if (keys.some(key => keysToFind.includes(key))) {
                        const desc = item.description || item.persona_description || item.content || item.value || '';
                        if (String(desc).trim()) return String(desc).trim();
                    }
                }
            } else if (typeof store === 'object') {
                for (const key of keysToFind) {
                    const direct = store[key] ?? store[key.replace(/^.*[\\/]/, '')];
                    const desc = typeof direct === 'string'
                        ? direct
                        : (direct?.description || direct?.persona_description || direct?.content || direct?.value || '');
                    if (String(desc).trim()) return String(desc).trim();
                }
            }
        }
        return '';
    };

    const fromApiStore = lookupStores(selectedKeys);
    if (fromApiStore) return fromApiStore;

    const cached = power_user?.persona_description || window.power_user?.persona_description || ctx.powerUserSettings?.persona_description || '';
    if (String(cached).trim()) return String(cached).trim();

    // DOM 是最后降级路径；命中时记录具体选择器，便于 ST 改版后排查。
    const selectors = [
        '#persona_description',
        '#personaDescription',
        '#user_persona',
        '#user-persona',
        'textarea[name="persona_description"]',
        'textarea[id*="persona"]',
        'textarea[id*="Persona"]',
        '[id*="persona"] textarea',
        '[id*="Persona"] textarea',
    ];
    for (const selector of selectors) {
        const element = [...document.querySelectorAll(selector)]
            .find(node => !node.closest('.theater-popup') && !node.disabled && node.offsetParent !== null);
        const value = element ? (element.value || element.textContent || '').trim() : '';
        if (value) {
            console.info(`[Theater] User 人设使用 DOM 降级路径：${selector}`);
            return value;
        }
    }

    const selectedPersonaSelects = [...document.querySelectorAll('#persona_select, #user_avatar_select, select')]
        .filter(element => !element.closest('.theater-popup') && /persona|avatar/i.test(element.id || element.name || '') && element.offsetParent !== null);
    const avatarImage = document.querySelector('#user_avatar_block img');
    const domKeys = [
        avatarImage?.getAttribute('src')?.split('/').pop(),
        ...selectedPersonaSelects.map(element => element.value),
        ...selectedPersonaSelects.map(element => element.selectedOptions?.[0]?.textContent),
    ].filter(Boolean).map(value => String(value).trim());
    const fromDomSelection = lookupStores(domKeys);
    if (fromDomSelection) {
        const source = selectedPersonaSelects[0]?.id ? `#${selectedPersonaSelects[0].id}` : '#user_avatar_block img / persona select';
        console.info(`[Theater] User 人设使用 DOM 降级路径：${source}`);
        return fromDomSelection;
    }
    return '';
}

export function syncPersonaToSettings(settings, save, theaterError, { silent = false } = {}) {
    try {
        const persona = readCurrentUserPersona();
        if (persona) {
            $('#theater-user-persona').val(persona);
            settings.userPersona = persona;
            save();
            if (!silent) toastr.success('已读取');
            return persona;
        }
        if (!silent) toastr.warning('未找到人设，请手动填写');
    } catch (e) {
        if (!silent) theaterError('读取失败');
    }
    return '';
}

export function bindPersonaFollowRefresh({ eventSource, event_types, settings, save, theaterError }) {
    const refreshFollowedPersona = () => {
        if (!settings.followUserPersona) return;
        try {
            syncPersonaToSettings(settings, save, theaterError, { silent: true });
        } catch (e) {
            console.warn('[Theater] 跟随 User 人设失败:', e);
        }
    };
    const scheduleFollowedPersonaRefresh = () => {
        if (!settings.followUserPersona) return;
        [0, 120, 500].forEach(ms => setTimeout(refreshFollowedPersona, ms));
    };

    if (event_types?.PERSONA_CHANGED) eventSource.on(event_types.PERSONA_CHANGED, scheduleFollowedPersonaRefresh);
    if (event_types?.PERSONA_UPDATED) eventSource.on(event_types.PERSONA_UPDATED, scheduleFollowedPersonaRefresh);
    $(document).off('.theaterPersonaFollow').on(
        'click.theaterPersonaFollow change.theaterPersonaFollow input.theaterPersonaFollow',
        '#user_avatar_block .avatar-container, #persona_description, #persona-management-dropdown, #persona_sort_order',
        scheduleFollowedPersonaRefresh,
    );
}
