export const AUTO_CONTINUE_SCHEMA = 2;

export function migrateAutoContinueDefault(settings) {
    if (!settings || Object.prototype.hasOwnProperty.call(settings, 'autoContinueSchema')) return false;
    settings.autoContinue = true;
    settings.autoContinueSchema = AUTO_CONTINUE_SCHEMA;
    return true;
}
