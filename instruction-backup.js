export const INSTRUCTION_BACKUP_FORMAT = 'st-theater-instructions';
export const INSTRUCTION_BACKUP_VERSION = 2;

function cleanGroupName(value) {
    return String(value || '').trim();
}

export function createInstructionBackup(groups = [], templates = []) {
    const normalizedTemplates = (Array.isArray(templates) ? templates : [])
        .filter(item => String(item?.content || '').trim())
        .map(item => {
            const template = {
                name: String(item.name || '未命名指令').trim() || '未命名指令',
                content: String(item.content || ''),
            };
            const group = cleanGroupName(item.group);
            if (group) template.group = group;
            return template;
        });
    const groupSet = new Set((Array.isArray(groups) ? groups : []).map(cleanGroupName).filter(Boolean));
    normalizedTemplates.forEach(item => { if (item.group) groupSet.add(item.group); });
    return {
        format: INSTRUCTION_BACKUP_FORMAT,
        version: INSTRUCTION_BACKUP_VERSION,
        groups: [...groupSet],
        templates: normalizedTemplates,
    };
}

export function parseInstructionBackup(data) {
    if (!data || data.format !== INSTRUCTION_BACKUP_FORMAT || !Array.isArray(data.templates)) return null;
    const backup = createInstructionBackup(data.groups, data.templates);
    return { groups: backup.groups, templates: backup.templates };
}
