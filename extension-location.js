// Where this extension is installed: the folder name under third-party/, and whether SillyTavern
// installed it for the current user ("local") or for all users ("global").
// Asking the wrong scope first is harmless on SillyTavern, but TauriTavern shows every failed
// backend command as a red "Backend Error" toast, so ask SillyTavern which scope it is.

export const DEFAULT_EXTENSION_FOLDER = 'st-theater';

export function extensionFolderFromUrl(url) {
    const match = String(url || '').match(/\/scripts\/extensions\/third-party\/([^/?#]+)\//);
    let name = '';
    try { name = match ? decodeURIComponent(match[1]) : ''; } catch { name = ''; }
    return /^[A-Za-z0-9_.-]+$/.test(name) ? name : DEFAULT_EXTENSION_FOLDER;
}

export const EXTENSION_FOLDER = extensionFolderFromUrl(import.meta.url);
export const EXTENSION_TEMPLATE_PATH = `third-party/${EXTENSION_FOLDER}`;
export const EXTENSION_BASE_URL = `/scripts/extensions/third-party/${EXTENSION_FOLDER}/`;

export function extensionScopeFromTypes(types, folder = EXTENSION_FOLDER) {
    if (!types || typeof types !== 'object') return null;
    const key = Object.keys(types).find(id => id === `third-party/${folder}` || (id.startsWith('third-party') && id.endsWith(`/${folder}`)));
    const type = key ? types[key] : '';
    return type === 'global' || type === 'local' ? type : null;
}

const importExtensionsModule = () => import('/scripts/extensions.js');
let knownScope = null;

// Returns 'global', 'local' or null (unknown). Only a definite answer is cached.
export async function resolveExtensionScope({ folder = EXTENSION_FOLDER, importer = importExtensionsModule } = {}) {
    if (knownScope && importer === importExtensionsModule && folder === EXTENSION_FOLDER) return knownScope;
    let scope = null;
    try { scope = extensionScopeFromTypes((await importer())?.extensionTypes, folder); } catch { scope = null; }
    if (scope && importer === importExtensionsModule && folder === EXTENSION_FOLDER) knownScope = scope;
    return scope;
}

// Order of `global` flags to try for /api/extensions/version and /api/extensions/update.
export function extensionScopeAttempts(scope) {
    if (scope === 'global') return [true];
    if (scope === 'local') return [false];
    return [false, true];
}
