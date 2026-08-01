export const HISTORY_BACKUP_FORMAT = 'st-theater-history';
export const HISTORY_BACKUP_VERSION = 2;
export const HISTORY_ARCHIVE_MANIFEST = 'theater-history.json';

function cleanText(value) {
    return String(value || '').trim();
}

function normalizeHistoryItem(item, fallbackTitle = '导入的小剧场') {
    const html = String(item?.html || '');
    if (!html.trim()) return null;
    return {
        title: cleanText(item?.title) || fallbackTitle,
        date: cleanText(item?.date),
        instruction: String(item?.instruction || ''),
        sourceConfig: item?.sourceConfig && typeof item.sourceConfig === 'object'
            ? {
                metadataCaptured: item.sourceConfig.metadataCaptured === true,
                presetName: cleanText(item.sourceConfig.presetName),
                selectedWorldBooks: Array.isArray(item.sourceConfig.selectedWorldBooks)
                    ? item.sourceConfig.selectedWorldBooks.map(cleanText).filter(Boolean)
                    : [],
                readChatContext: item.sourceConfig.readChatContext !== false,
                contextRange: Math.max(0, Math.floor(Number(item.sourceConfig.contextRange) || 0)),
                renderSelection: cleanText(item.sourceConfig.renderSelection),
                renderLabel: cleanText(item.sourceConfig.renderLabel),
                textTheme: cleanText(item.sourceConfig.textTheme),
            }
            : null,
        html,
        mode: cleanText(item?.mode) || 'html',
    };
}

function safeFilePart(value, fallback) {
    return cleanText(value)
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .slice(0, 70) || fallback;
}

function uniqueHtmlFilename(item, index, usedNames) {
    const datePart = cleanText(item.date).replace(/[\\/:*?"<>|]/g, '-').slice(0, 10);
    const titlePart = safeFilePart(item.title, `小剧场${index + 1}`);
    const base = `${datePart ? `${datePart}_` : ''}${titlePart}`;
    let filename = `${base}.html`;
    let suffix = 2;
    while (usedNames.has(filename.toLocaleLowerCase())) {
        filename = `${base} (${suffix++}).html`;
    }
    usedNames.add(filename.toLocaleLowerCase());
    return filename;
}

export function normalizeHistoryBackup(data) {
    const source = Array.isArray(data)
        ? data
        : Array.isArray(data?.history)
            ? data.history
            : Array.isArray(data?.items)
                ? data.items
                : data?.html
                    ? [data]
                    : [];
    return source
        .map((item, index) => normalizeHistoryItem(item, `导入的小剧场 ${index + 1}`))
        .filter(Boolean);
}

export function createHistoryJsonBackup(items = []) {
    return {
        format: HISTORY_BACKUP_FORMAT,
        version: HISTORY_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        items: normalizeHistoryBackup(items),
    };
}

export function createHistoryArchive(items = []) {
    const normalized = normalizeHistoryBackup(items);
    const usedNames = new Set();
    const files = [];
    const manifestItems = normalized.map((item, index) => {
        const file = uniqueHtmlFilename(item, index, usedNames);
        files.push({ name: file, html: item.html });
        return {
            title: item.title,
            date: item.date,
            instruction: item.instruction,
            sourceConfig: item.sourceConfig,
            mode: item.mode,
            file,
        };
    });
    return {
        manifest: {
            format: HISTORY_BACKUP_FORMAT,
            version: HISTORY_BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            items: manifestItems,
        },
        files,
    };
}

function normalizedArchivePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase();
}

function legacyHistoryItem(entry, index) {
    const path = String(entry?.name || '').replace(/\\/g, '/');
    const basename = path.split('/').pop()?.replace(/\.html?$/i, '') || `导入的小剧场 ${index + 1}`;
    const dated = basename.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
    return normalizeHistoryItem({
        title: dated?.[2] || basename,
        date: dated ? dated[1].replace(/-/g, '/') : '',
        instruction: '',
        html: entry?.html,
        mode: 'html',
    }, `导入的小剧场 ${index + 1}`);
}

export function historyItemsFromArchive(manifest, htmlEntries = []) {
    const entries = (Array.isArray(htmlEntries) ? htmlEntries : [])
        .filter(entry => /\.html?$/i.test(String(entry?.name || '')) && String(entry?.html || '').trim());
    const htmlByName = new Map(entries.map(entry => [normalizedArchivePath(entry.name), String(entry.html)]));
    if (manifest?.format === HISTORY_BACKUP_FORMAT && Array.isArray(manifest.items)) {
        return manifest.items.map((item, index) => {
            const html = htmlByName.get(normalizedArchivePath(item?.file)) || String(item?.html || '');
            return normalizeHistoryItem({ ...item, html }, `导入的小剧场 ${index + 1}`);
        }).filter(Boolean);
    }
    return entries.map(legacyHistoryItem).filter(Boolean);
}
