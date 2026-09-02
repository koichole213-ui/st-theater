export const INSTRUCTION_BACKUP_FORMAT = 'st-theater-instructions';
export const INSTRUCTION_BACKUP_VERSION = 3;

function cleanGroupName(value) {
    return String(value || '').trim();
}

function cleanTags(values = []) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const tag = cleanGroupName(value);
        const key = tag.toLocaleLowerCase();
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    return result;
}

export function createInstructionBackup(tags = [], templates = []) {
    const normalizedTemplates = (Array.isArray(templates) ? templates : [])
        .filter(item => String(item?.content || '').trim())
        .map(item => {
            const template = {
                name: String(item.name || '未命名指令').trim() || '未命名指令',
                content: String(item.content || ''),
            };
            template.tags = cleanTags(item.tags);
            const group = cleanGroupName(item.group);
            if (!template.tags.length && group) template.tags = [group];
            return template;
        });
    const tagList = cleanTags(tags);
    normalizedTemplates.forEach(item => item.tags.forEach(tag => { if (!tagList.includes(tag)) tagList.push(tag); }));
    return {
        format: INSTRUCTION_BACKUP_FORMAT,
        version: INSTRUCTION_BACKUP_VERSION,
        tags: tagList,
        templates: normalizedTemplates,
    };
}

export function parseInstructionBackup(data) {
    if (!data || data.format !== INSTRUCTION_BACKUP_FORMAT || !Array.isArray(data.templates)) return null;
    const sourceTags = Array.isArray(data.tags) ? data.tags : data.groups;
    const backup = createInstructionBackup(sourceTags, data.templates);
    return { tags: backup.tags, templates: backup.templates };
}
