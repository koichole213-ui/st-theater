import {
    LONG_DREAM_BACKUP_FORMAT,
    LONG_DREAM_BACKUP_VERSION,
    createLongDreamBackup,
    parseLongDreamBackup,
} from './long-dream-backup.js';

export const LONG_DREAM_ARCHIVE_FORMAT = 'st-theater-long-dream-archive';
export const LONG_DREAM_ARCHIVE_VERSION = 1;
export const LONG_DREAM_ARCHIVE_MANIFEST = 'long-dream-manifest.json';
export const MAX_LONG_DREAM_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_LONG_DREAM_ARCHIVE_FILES = 5000;

function normalizedPath(value = '') {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toLocaleLowerCase();
}

function chapterFilePaths(dreamIndex, chapterIndex) {
    const base = `dreams/${String(dreamIndex + 1).padStart(3, '0')}/chapters/${String(chapterIndex + 1).padStart(4, '0')}`;
    return { textFile: `${base}.txt`, htmlFile: `${base}.html` };
}

export function createLongDreamArchive(records = [], { now = new Date() } = {}) {
    const backup = createLongDreamBackup(records, { now });
    const files = [];
    const dreams = backup.dreams.map((dream, dreamIndex) => {
        const chapters = dream.chapters.map((chapter, chapterIndex) => {
            const { text, html, ...metadata } = chapter;
            const paths = chapterFilePaths(dreamIndex, chapterIndex);
            files.push({ name: paths.textFile, content: String(text || '') });
            files.push({ name: paths.htmlFile, content: String(html || '') });
            return { ...metadata, ...paths };
        });
        let draft = dream.draft;
        if (draft) {
            const { text, html, ...metadata } = draft;
            const base = `dreams/${String(dreamIndex + 1).padStart(3, '0')}/draft`;
            const paths = { textFile: `${base}.txt`, htmlFile: `${base}.html` };
            files.push({ name: paths.textFile, content: String(text || '') });
            files.push({ name: paths.htmlFile, content: String(html || '') });
            draft = { ...metadata, ...paths };
        }
        return { ...dream, chapters, draft };
    });
    return {
        manifest: {
            format: LONG_DREAM_ARCHIVE_FORMAT,
            version: LONG_DREAM_ARCHIVE_VERSION,
            exportedAt: backup.exportedAt,
            dreams,
        },
        files,
    };
}

function archiveFileMap(files = []) {
    if (files instanceof Map) {
        return new Map([...files.entries()].map(([name, content]) => [normalizedPath(name), String(content || '')]));
    }
    return new Map((Array.isArray(files) ? files : []).map(file => [
        normalizedPath(file?.name),
        String(file?.content || ''),
    ]));
}

function readRequiredFile(files, name, label) {
    const path = normalizedPath(name);
    if (!path || !files.has(path)) throw new Error(`长梦 ZIP 缺少${label}：${name || '未指定路径'}`);
    return files.get(path);
}

export function parseLongDreamArchive(manifest, archiveFiles = []) {
    if (!manifest || typeof manifest !== 'object' || manifest.format !== LONG_DREAM_ARCHIVE_FORMAT) {
        throw new Error('这不是千夜浮梦长梦 ZIP 备份');
    }
    const version = Number(manifest.version || 0);
    if (!Number.isInteger(version) || version < 1 || version > LONG_DREAM_ARCHIVE_VERSION) {
        throw new Error(`不支持的长梦 ZIP 版本：${manifest.version ?? '未知'}`);
    }
    const files = archiveFileMap(archiveFiles);
    const dreams = (Array.isArray(manifest.dreams) ? manifest.dreams : []).map((dream, dreamIndex) => {
        const chapters = (Array.isArray(dream?.chapters) ? dream.chapters : []).map((chapter, chapterIndex) => {
            const { textFile, htmlFile, ...metadata } = chapter || {};
            return {
                ...metadata,
                text: readRequiredFile(files, textFile, `第 ${dreamIndex + 1} 卷第 ${chapterIndex + 1} 章正文`),
                html: readRequiredFile(files, htmlFile, `第 ${dreamIndex + 1} 卷第 ${chapterIndex + 1} 章 HTML`),
            };
        });
        let draft = dream?.draft || null;
        if (draft) {
            const { textFile, htmlFile, ...metadata } = draft;
            draft = {
                ...metadata,
                text: readRequiredFile(files, textFile, `第 ${dreamIndex + 1} 卷草稿正文`),
                html: readRequiredFile(files, htmlFile, `第 ${dreamIndex + 1} 卷草稿 HTML`),
            };
        }
        return { ...dream, chapters, draft };
    });
    return parseLongDreamBackup({
        format: LONG_DREAM_BACKUP_FORMAT,
        version: LONG_DREAM_BACKUP_VERSION,
        exportedAt: manifest.exportedAt,
        dreams,
    });
}
