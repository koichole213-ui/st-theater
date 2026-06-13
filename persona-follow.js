import { power_user } from '../../../power-user.js';
import { user_avatar } from '../../../personas.js';

export function readCurrentUserPersona() {
    const ctx = SillyTavern.getContext();
    const currentAvatar = user_avatar || ctx.user_avatar || ctx.userAvatar || window.user_avatar || '';

    const descriptor = currentAvatar ? power_user?.persona_descriptions?.[currentAvatar] : null;
    const currentDescription = descriptor ? (descriptor.description || '') : (power_user?.persona_description || '');
    if (String(currentDescription).trim()) return String(currentDescription).trim();

    const fromDom = (() => {
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
        for (const sel of selectors) {
            const el = [...document.querySelectorAll(sel)]
                .find(node => !node.closest('.theater-popup') && !node.disabled && node.offsetParent !== null);
            const val = el ? (el.value || el.textContent || '').trim() : '';
            if (val) return val;
        }
        return '';
    })();
    if (fromDom) return fromDom.trim();

    const selectedPersonaSelects = [...document.querySelectorAll('#persona_select, #user_avatar_select, select')]
        .filter(el => !el.closest('.theater-popup') && /persona|avatar/i.test(el.id || el.name || '') && el.offsetParent !== null);

    const selectedKeys = [
        currentAvatar,
        ctx.user_avatar,
        ctx.userAvatar,
        window.user_avatar,
        power_user?.user_avatar,
        window.power_user?.user_avatar,
        $('#user_avatar_block img').attr('src')?.split('/').pop(),
        ...selectedPersonaSelects.map(el => el.value),
        ...selectedPersonaSelects.map(el => el.selectedOptions?.[0]?.textContent),
        ctx.name1,
    ].filter(Boolean).map(v => String(v).trim());

    const stores = [
        power_user?.persona_descriptions,
        window.power_user?.persona_descriptions,
        ctx.powerUserSettings?.persona_descriptions,
    ].filter(Boolean);

    for (const store of stores) {
        if (Array.isArray(store)) {
            for (const item of store) {
                const keys = [item?.avatar, item?.name, item?.key, item?.id, item?.filename].filter(Boolean).map(v => String(v).trim());
                if (keys.some(k => selectedKeys.includes(k))) {
                    const desc = item.description || item.persona_description || item.content || item.value || '';
                    if (String(desc).trim()) return String(desc).trim();
                }
            }
        } else if (typeof store === 'object') {
            for (const key of selectedKeys) {
                const direct = store[key] ?? store[key.replace(/^.*[\\/]/, '')];
                const desc = typeof direct === 'string'
                    ? direct
                    : (direct?.description || direct?.persona_description || direct?.content || direct?.value || '');
                if (String(desc).trim()) return String(desc).trim();
            }
        }
    }

    const cached = window.power_user?.persona_description || ctx.powerUserSettings?.persona_description || '';
    return String(cached || '').trim();
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
