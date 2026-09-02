export const TAG_SCHEMA_VERSION = 1;
export const TAG_UNCATEGORIZED = '__uncategorized__';

export function cleanTagName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 30);
}

export function normalizeTagList(values = []) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const tag = cleanTagName(value);
        const key = tag.toLocaleLowerCase();
        if (!tag || tag === TAG_UNCATEGORIZED || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

export function itemTags(item, knownTags = []) {
    const known = new Map(normalizeTagList(knownTags).map(tag => [tag.toLocaleLowerCase(), tag]));
    return normalizeTagList(item?.tags)
        .map(tag => known.get(tag.toLocaleLowerCase()))
        .filter(Boolean);
}

export function normalizeTagFilter(value, knownTags = []) {
    const raw = Array.isArray(value) ? value : [];
    if (raw.includes(TAG_UNCATEGORIZED)) return [TAG_UNCATEGORIZED];
    return itemTags({ tags: raw }, knownTags);
}

export function matchesTagFilter(item, filter = [], knownTags = []) {
    const selected = normalizeTagFilter(filter, knownTags);
    if (!selected.length) return true;
    const tags = itemTags(item, knownTags);
    if (selected[0] === TAG_UNCATEGORIZED) return tags.length === 0;
    return selected.every(tag => tags.includes(tag));
}

function legacyFilter(value, knownTags) {
    if (value === '__none__') return [TAG_UNCATEGORIZED];
    return knownTags.includes(value) ? [value] : [];
}

function legacySource(value, knownTags, fallback) {
    if (value === '__none__') return { source: TAG_UNCATEGORIZED, tags: [] };
    if (knownTags.includes(value)) return { source: '__tags__', tags: [value] };
    if (value === '__all__' || value === fallback) return { source: value, tags: [] };
    return { source: fallback, tags: [] };
}

export function migrateLegacyTagSettings(settings = {}) {
    const alreadyMigrated = Number(settings.tagSchemaVersion) >= TAG_SCHEMA_VERSION;
    const legacyGroups = normalizeTagList(settings.instructionGroups);
    const templates = Array.isArray(settings.instructionTemplates) ? settings.instructionTemplates : [];
    const discovered = templates.flatMap(template => [
        ...normalizeTagList(template?.tags),
        ...(!alreadyMigrated && cleanTagName(template?.group) ? [cleanTagName(template.group)] : []),
    ]);
    settings.instructionTags = normalizeTagList([
        ...normalizeTagList(settings.instructionTags),
        ...legacyGroups,
        ...discovered,
    ]);

    templates.forEach(template => {
        const tags = normalizeTagList(template?.tags);
        const group = cleanTagName(template?.group);
        template.tags = normalizeTagList([
            ...tags,
            ...(!alreadyMigrated && group && settings.instructionTags.includes(group) ? [group] : []),
        ]).filter(tag => settings.instructionTags.includes(tag));
    });

    if (!alreadyMigrated) {
        settings.instructionTagFilter = legacyFilter(settings.instructionGroupFilter, settings.instructionTags);
        const random = legacySource(settings.randomScope, settings.instructionTags, '__current__');
        settings.randomScope = random.source;
        settings.randomTagFilter = random.tags;
        const auto = legacySource(settings.autoSource, settings.instructionTags, '__last__');
        settings.autoSource = auto.source;
        settings.autoTagFilter = auto.tags;
        settings.tagSchemaVersion = TAG_SCHEMA_VERSION;
    }

    settings.instructionTagFilter = normalizeTagFilter(settings.instructionTagFilter, settings.instructionTags);
    settings.randomTagFilter = normalizeTagFilter(settings.randomTagFilter, settings.instructionTags);
    settings.autoTagFilter = normalizeTagFilter(settings.autoTagFilter, settings.instructionTags);
    if (![TAG_UNCATEGORIZED, '__current__', '__all__', '__tags__'].includes(settings.randomScope)) settings.randomScope = '__current__';
    if (![TAG_UNCATEGORIZED, '__last__', '__all__', '__tags__'].includes(settings.autoSource)) settings.autoSource = '__last__';
    return !alreadyMigrated;
}

export function renameTagInList(values, oldName, newName) {
    return normalizeTagList((Array.isArray(values) ? values : []).map(tag => tag === oldName ? newName : tag));
}

export function removeTagFromList(values, name) {
    return normalizeTagList(values).filter(tag => tag !== name);
}
