// 长梦工作区·资料与存取：历史卡片、开卷来源、AI 定梦建议、导出导入、章节导出与编辑、完卷状态。
// 从 long-dream-workspace.js 拆出；由 createLongDreamWorkspace 组装，不单独使用。
import { manualLayoutSource, resultRelayoutTarget } from './manual-relayout.js';
import { longDreamFolderSources } from './long-dream-series.js';
import { isHistoryItemExpanded } from './history-ui.js';
import { normalizeRoleSources } from './history-roles.js';
import { itemTags } from './tag-system.js';
import { LONG_DREAM_CANON_SUGGESTION_CATEGORIES } from './long-dream-canon-suggestions.js';
import { createLongDreamWorldBookSnapshot, updateLongDreamChapter, LONG_DREAM_STATUS, setLongDreamStatus } from './long-dream.js';
import { createLongDreamArchive, LONG_DREAM_ARCHIVE_MANIFEST, MAX_LONG_DREAM_ARCHIVE_BYTES, MAX_LONG_DREAM_ARCHIVE_FILES, parseLongDreamArchive } from './long-dream-archive.js';
import { createLongDreamBackup, MAX_LONG_DREAM_BACKUP_BYTES, parseLongDreamBackup } from './long-dream-backup.js';
import { isTextOutputMode } from './plain-text-renderer.js';
import { readableErrorText } from './error-text.js';

export function createLongDreamLibrary(runtime, ws) {
// 其他部分的函数：调用时转给 ws（组装完成后才会被调用）。
const renderLongDreamPanel = (...args) => ws.renderLongDreamPanel(...args);
// @theater-source-begin historyItemHTML
function historyItemHTML(h, options = {}) {
    const checked = runtime.histSelected.has(h.id) ? 'checked' : '';
    const selClass = runtime.histSelected.has(h.id) ? ' theater-history-item-selected' : '';
    const title = h.title || '未命名小剧场', id = runtime.esc(h.id);
    const expanded = !runtime.histBatchMode && isHistoryItemExpanded(h.id);
    const roles = normalizeRoleSources(h.roleSources);
    const roleLabel = roles.length ? roles.map(role => role.name).join('、') : '未指定';
    const tags = itemTags(h, runtime.knownInstructionTags());
    const shownTags = expanded ? tags : tags.slice(0, options.folderId ? 1 : 2);
    const badges = shownTags.map(tag => `<span class="theater-tag-badge" title="${runtime.esc(tag)}">#${runtime.esc(tag)}</span>`).join('') + (shownTags.length < tags.length ? `<span class="theater-tag-badge theater-history-tag-more">+${tags.length - shownTags.length}</span>` : '') || '<span class="theater-tag-badge is-uncategorized">未分类</span>';
    const action = (cls, label, icon, extra = '') => `<button type="button" class="${cls}" data-id="${id}" ${extra}><i class="fa-solid fa-${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
    const versions = options.versions || [];
    const version = versions.length > 1 ? `<span class="theater-history-version-badge">${expanded ? '第 ' + (versions.indexOf(h) + 1) + ' 版' : versions.length + ' 个版本'}</span>` : '';
    const versionControls = versions.length > 1 ? `<div class="theater-history-version" role="group" aria-label="本篇版本"><span>本篇版本</span>${versions.map((item, n) => `<button type="button" data-history-version="${runtime.esc(options.versionKey)}" data-version-id="${runtime.esc(item.id)}" aria-pressed="${item.id === h.id}">第 ${n + 1} 版</button>`).join('')}</div>` : '';
    return `<article class="theater-history-item${selClass}${expanded ? ' is-expanded' : ''}" data-id="${id}">
        <input type="checkbox" class="theater-hist-checkbox" data-id="${id}" ${checked} aria-label="选择这条历史">
        <div class="theater-history-heading">
            <button type="button" class="theater-history-expand" data-id="${id}"${runtime.histBatchMode ? ` aria-pressed="${!!checked}"` : ` aria-expanded="${expanded}"`}>
                ${options.position != null ? `<span class="theater-history-chapter-number">${options.position + 1}</span>` : ''}
                <span class="theater-history-main"><span class="theater-history-title" title="${runtime.esc(title)}">${runtime.esc(title)}${version}</span>
                    <span class="theater-history-meta-row"><span class="theater-history-date">${runtime.esc(h.date || '')}</span><span class="theater-history-classification"><span class="theater-history-role${roles.length ? '' : ' is-unassigned'}" title="${runtime.esc(roleLabel)}"><i class="fa-solid fa-user" aria-hidden="true"></i><span>${runtime.esc(roleLabel)}</span></span><span class="theater-history-tags">${badges}</span></span></span>
                </span>
            </button>
            ${expanded ? `<div class="theater-history-body">${versionControls}
                <div class="theater-history-actions">${action('theater-history-view', '查看', 'book-open')}${action('theater-history-continue', '续写', 'pen')}</div>
                ${options.collectionActions || ''}
                <div class="theater-history-secondary-actions">${action('theater-history-export', '导出', 'download', 'title="导出 HTML"')}${action('theater-history-rename', '改名', 'pen')}${action('theater-history-tags-edit', '标签', 'tags')}${action('theater-history-roles-edit', '角色', 'user')}${action('theater-history-delete', '删除', 'trash')}</div>
                ${options.folderId ? '' : `<div class="theater-history-extra-actions">${action('theater-history-move', '移到文件夹', 'folder-open')}</div>`}
            </div>` : ''}
        </div>
    </article>`;
}
// @theater-source-end historyItemHTML

// @theater-source-begin historyTagBadgesHTML
function historyTagBadgesHTML(item) {
    const tags = itemTags(item, runtime.knownInstructionTags());
    if (!tags.length) {
        return '<span class="theater-tag-badge is-uncategorized"><i class="fa-solid fa-tag"></i><span>未分类</span></span>';
    }
    const visible = tags.slice(0, 2);
    const hidden = tags.slice(2);
    const badges = visible.map(tag => `<span class="theater-tag-badge" title="${runtime.esc(tag)}"><i class="fa-solid fa-tag"></i><span>${runtime.esc(tag)}</span></span>`).join('');
    const more = hidden.length
        ? `<span class="theater-tag-badge theater-history-tag-more" title="${runtime.esc(hidden.join('、'))}"><span>+${hidden.length}</span></span>`
        : '';
    return `<span class="theater-tag-badges">${badges}${more}</span>`;
}
// @theater-source-end historyTagBadgesHTML

// @theater-source-begin longDreamSources
function longDreamSources() {
    const sources = [];
    const currentHtml = runtime.lastGeneratedHtml || runtime.currentDisplayHtml;
    if (currentHtml) {
        const matchingHistory = runtime.historyCache.slice().reverse().find(item => item.html === currentHtml);
        const matchingRecent = runtime.recentCache.find(item => item.html === currentHtml);
        const currentResult = resultRelayoutTarget(runtime, 'continuation') || resultRelayoutTarget(runtime, 'generate');
        const layoutSource = currentResult?.html === currentHtml && manualLayoutSource(currentResult) ? currentResult.layoutSource : null;
        const currentMeta = matchingHistory || currentResult || matchingRecent;
        sources.push({
            key: 'current',
            kind: 'current',
            refId: matchingHistory?.id ?? null,
            title: matchingHistory?.title || '当前正在查看的小剧场',
            // 查看旧历史时宁可明确显示“未保存”，也不能拿当前输入框冒充当年的指令。
            instruction: currentMeta ? (currentMeta.instruction || '') : ($('#theater-instruction').val() || runtime.settings.lastInstruction || ''),
            sourceConfig: currentMeta?.sourceConfig || null,
            html: currentHtml,
            // The staged manuscript belongs to this exact result; legacy sources still use their own HTML.
            text: layoutSource?.text ?? runtime.htmlToPlainText(currentHtml),
            ...(layoutSource ? { targetChars: layoutSource.targetChars } : {}),
            mode: currentMeta?.mode || runtime.currentOutputMode || 'html',
        });
    }
    runtime.recentCache.forEach((item, index) => {
        const layoutSource = manualLayoutSource(item) ? item.layoutSource : null;
        sources.push({
            key: `recent:${index}`,
            kind: 'recent',
            refId: index,
            title: `最近生成 ${index + 1}`,
            instruction: item.instruction || '',
            sourceConfig: item.sourceConfig || null,
            html: item.html || '',
            text: layoutSource?.text ?? runtime.htmlToPlainText(item.html || ''),
            ...(layoutSource ? { targetChars: layoutSource.targetChars } : {}),
            mode: item.mode || 'html',
        });
    });
    runtime.historyCache.slice().reverse().forEach(item => {
        sources.push(withLazyText({
            key: `history:${item.id}`,
            kind: 'history',
            refId: item.id,
            title: item.title || '未命名小剧场',
            date: item.date || '', order: runtime.historyCache.indexOf(item),
            instruction: item.instruction || '',
            sourceConfig: item.sourceConfig || null,
            html: item.html || '',
            mode: item.mode || 'html',
        }, () => runtime.htmlToPlainText(item.html || '')));
    });
    sources.unshift(...longDreamFolderSources(runtime).reverse());
    // 先看 HTML：历史一般都有 HTML，不用为了过滤把每篇都转一遍纯文字。
    return sources.filter(source => source.html.trim() || source.text.trim());
}
// @theater-source-end longDreamSources

// @theater-source-begin withLazyText
// 历史很多时，每次打开“选择作品”都把全部历史转成纯文字会卡；用到 text 时才转，转过就记住。
function withLazyText(source, compute) {
    let text;
    return Object.defineProperty(source, 'text', {
        enumerable: true,
        configurable: true,
        get() { return text ??= String(compute() ?? ''); },
        set(value) { text = value; },
    });
}
// @theater-source-end withLazyText

// @theater-source-begin resolveLongDreamSource
function resolveLongDreamSource(key) {
    return longDreamSources().find(source => source.key === key) || null;
}
// @theater-source-end resolveLongDreamSource

// @theater-source-begin longDreamDate
function longDreamDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
}
// @theater-source-end longDreamDate

// @theater-source-begin longDreamExcerpt
function longDreamExcerpt(value, limit = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
// @theater-source-end longDreamExcerpt

// @theater-source-begin longDreamSourceInstructionState
function longDreamSourceInstructionState(source) {
    const instruction = String(source?.instruction || '').trim();
    if (instruction && source?.sourceConfig?.metadataCaptured === true) {
        return {
            instruction,
            className: 'is-saved',
            icon: 'fa-circle-check',
            label: '找到当时保存的创作指令',
            hint: '已把当时保存的创作指令带入下方。请只留下这场梦必须遵守的世界线事实。',
        };
    }
    if (instruction) {
        return {
            instruction,
            className: 'is-legacy',
            icon: 'fa-circle-exclamation',
            label: '旧记录中有一份指令，请核对',
            hint: '旧版没有把正文与生成配置绑定保存，这份指令可能来自当时的输入框。请根据第一章正文核对后，只留下世界线事实。',
        };
    }
    return {
        instruction: '',
        className: 'is-missing',
        icon: 'fa-triangle-exclamation',
        label: '这条历史没有保存当时的创作指令',
        hint: '第一章正文和排版仍然完整，但旧记录无法还原当时的创作指令。请根据正文补充这场梦必须遵守的设定。',
    };
}
// @theater-source-end longDreamSourceInstructionState

// @theater-source-begin longDreamSourcePreviewHTML
function longDreamSourcePreviewHTML(source) {
    const state = longDreamSourceInstructionState(source);
    return `<header class="theater-dream-source-meta">
            <span>${runtime.esc(source?.title || '')}</span>
            <small class="${state.className}"><i class="fa-solid ${state.icon}"></i>${state.label}</small>
        </header>
        <div class="source-preview-text">${runtime.esc(longDreamExcerpt(source?.text, 220))}</div>`;
}
// @theater-source-end longDreamSourcePreviewHTML

// @theater-source-begin resetLongDreamCanonSuggestions
function resetLongDreamCanonSuggestions({ abort = true } = {}) {
    if (abort && runtime.longDreamCanonSuggestionState.controller) {
        runtime.longDreamCanonSuggestionState.controller.abort();
    }
    runtime.longDreamCanonSuggestionState.sourceKey = '';
    runtime.longDreamCanonSuggestionState.items = [];
    runtime.longDreamCanonSuggestionState.status = 'idle';
    runtime.longDreamCanonSuggestionState.errorSignal = '';
    runtime.longDreamCanonSuggestionState.controller = null;
    runtime.longDreamCanonSuggestionState.requestId++;
}
// @theater-source-end resetLongDreamCanonSuggestions

// @theater-source-begin activeLongDreamCanonSuggestions
function activeLongDreamCanonSuggestions(sourceKey) {
    return runtime.longDreamCanonSuggestionState.sourceKey === String(sourceKey || '')
        ? runtime.longDreamCanonSuggestionState.items
        : [];
}
// @theater-source-end activeLongDreamCanonSuggestions

// @theater-source-begin longDreamCanonSuggestionCardsHTML
function longDreamCanonSuggestionCardsHTML(sourceKey) {
    const items = activeLongDreamCanonSuggestions(sourceKey);
    return items.map(item => {
        const categoryOptions = LONG_DREAM_CANON_SUGGESTION_CATEGORIES
            .map(category => `<option value="${runtime.esc(category)}" ${item.category === category ? 'selected' : ''}>${runtime.esc(category)}</option>`)
            .join('');
        return `<article class="theater-dream-canon-suggestion canon-suggest-item ${item.accepted ? 'is-accepted accepted' : ''}" data-dream-canon-suggestion-id="${runtime.esc(item.id)}">
            <div class="theater-dream-canon-suggestion-head">
                <select class="ui-select theater-select" data-select2-id="${runtime.theaterNativeSelectCompatId()}" data-dream-canon-suggestion-category aria-label="建议分类">${categoryOptions}</select>
                <span class="theater-dream-canon-suggestion-state">${item.accepted ? '<i class="fa-solid fa-check"></i>已采纳' : '待决定'}</span>
                ${item.uncertain ? '<span class="theater-dream-canon-uncertain"><i class="fa-solid fa-circle-question"></i>不确定 · 需要确认</span>' : ''}
            </div>
            <textarea class="ui-textarea theater-textarea" rows="2" maxlength="800" data-dream-canon-suggestion-content aria-label="修改这条定梦建议">${runtime.esc(item.content)}</textarea>
            ${item.uncertain && item.uncertaintyNote ? `<p class="theater-dream-canon-uncertainty-note">AI 标注：${runtime.esc(item.uncertaintyNote)}</p>` : ''}
            <div class="theater-dream-canon-suggestion-actions">
                <button type="button" class="ui-btn ui-btn-sm theater-btn ${item.accepted ? 'is-selected' : ''}" data-dream-canon-suggestion-action="toggle" aria-pressed="${item.accepted}">
                    <i class="fa-solid ${item.accepted ? 'fa-rotate-left' : 'fa-check'}"></i><span>${item.accepted ? '撤回采纳' : '采纳这条'}</span>
                </button>
                <button type="button" class="ui-btn ui-btn-sm ui-btn-danger theater-btn danger" data-dream-canon-suggestion-action="delete"><i class="fa-solid fa-trash"></i><span>删除</span></button>
            </div>
        </article>`;
    }).join('');
}
// @theater-source-end longDreamCanonSuggestionCardsHTML

// @theater-source-begin longDreamCanonSuggestionHTML
function longDreamCanonSuggestionHTML(sourceKey) {
    const key = String(sourceKey || '');
    const items = activeLongDreamCanonSuggestions(key);
    const acceptedCount = items.filter(item => item.accepted).length;
    const isLoading = runtime.longDreamCanonSuggestionState.sourceKey === key && runtime.longDreamCanonSuggestionState.status === 'loading';
    const failed = runtime.longDreamCanonSuggestionState.sourceKey === key && runtime.longDreamCanonSuggestionState.status === 'error';
    const empty = runtime.longDreamCanonSuggestionState.sourceKey === key && runtime.longDreamCanonSuggestionState.status === 'empty';
    const statusText = isLoading
        ? '正在只读分析第一章；结果回来前不会修改此梦设定。'
        : (failed
            ? `整理失败：${runtime.longDreamCanonSuggestionState.errorSignal || 'T-API-INVALID-RESPONSE'}。手写定梦仍可直接使用。`
            : (empty ? 'AI 没有找到足够可靠的硬事实；你仍可直接手写定梦。' : ''));
    return `<section id="theater-dream-canon-assist" class="theater-dream-canon-assist canon-suggest-box ${items.length ? 'has-items' : ''}">
        <div class="theater-dream-canon-assist-head canon-suggest-head">
            <div>
                <span class="theater-dream-canon-assist-kicker">可选 · AI 只提供草稿</span>
                <b>从第一章整理定梦建议</b>
            </div>
            <button type="button" id="theater-dream-canon-suggest" class="ui-btn ui-btn-sm theater-btn" aria-busy="${isLoading}">
                <i class="fa-solid ${isLoading ? 'fa-stop' : 'fa-wand-magic-sparkles'}"></i><span>${isLoading ? '停止整理' : (items.length ? '重新整理' : 'AI 帮我整理')}</span>
            </button>
        </div>
        <p class="theater-dream-canon-assist-note">AI 只会看到所选第一章正文，不会读取聊天前文或世界书。建议可逐项修改、删除和采纳；未采纳内容不会写入长卷。</p>
        <div id="theater-dream-canon-suggestion-status" class="theater-dream-canon-suggestion-status ${failed ? 'is-error' : ''}" role="status" ${statusText ? '' : 'hidden'}>${runtime.esc(statusText)}</div>
        <div id="theater-dream-canon-suggestion-list" class="theater-dream-canon-suggestion-list canon-suggest-list">${longDreamCanonSuggestionCardsHTML(key)}</div>
        <div id="theater-dream-canon-suggestion-summary" class="theater-dream-canon-suggestion-summary" ${items.length ? '' : 'hidden'}>
            <span>已采纳 ${acceptedCount}/${items.length} 条</span>
            <small>只有“确认定梦并开卷”后，采纳项才会和手写内容一起成为 canon。</small>
        </div>
    </section>`;
}
// @theater-source-end longDreamCanonSuggestionHTML

// @theater-source-begin renderLongDreamCanonSuggestions
function renderLongDreamCanonSuggestions(sourceKey = $('#theater-dream-source').val()) {
    const container = document.getElementById('theater-dream-canon-assist');
    if (!container) return;
    container.outerHTML = longDreamCanonSuggestionHTML(sourceKey);
}
// @theater-source-end renderLongDreamCanonSuggestions

// @theater-source-begin findLongDreamCanonSuggestion
function findLongDreamCanonSuggestion(id) {
    return runtime.longDreamCanonSuggestionState.items.find(item => String(item.id) === String(id));
}
// @theater-source-end findLongDreamCanonSuggestion

// @theater-source-begin captureCurrentLongDreamWorldBooks
function captureCurrentLongDreamWorldBooks(bookNames) {
    return createLongDreamWorldBookSnapshot({
        bookNames,
        entries: runtime.wbEntries.map((entry, index) => ({ ...entry, enabled: runtime.wbStates[index] !== false })),
    });
}
// @theater-source-end captureCurrentLongDreamWorldBooks

// @theater-source-begin longDreamSnapshotEntryCount
function longDreamSnapshotEntryCount(snapshot) {
    return (snapshot?.books || []).reduce((total, book) => total + (book.entries?.length || 0), 0);
}
// @theater-source-end longDreamSnapshotEntryCount

// @theater-source-begin longDreamBackupFileName
function longDreamBackupFileName(scope = 'archive', extension = 'json') {
    return `theater-long-dream-${scope}-${Date.now()}.${extension}`;
}
// @theater-source-end longDreamBackupFileName

// @theater-source-begin exportLongDreamZip
async function exportLongDreamZip(records, scope) {
    const JSZipCtor = await runtime.loadJSZip();
    const zip = new JSZipCtor();
    const archive = createLongDreamArchive(records);
    zip.file(LONG_DREAM_ARCHIVE_MANIFEST, JSON.stringify(archive.manifest, null, 2));
    archive.files.forEach(file => zip.file(file.name, file.content));
    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = longDreamBackupFileName(scope, 'zip');
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return archive.manifest.dreams.length;
}
// @theater-source-end exportLongDreamZip

// @theater-source-begin chooseExportFormat
function chooseExportFormat({ title, count, jsonBytes = 0, maxJsonBytes = Infinity }) {
    const previous = document.querySelector('[data-theater-export-format]');
    if (previous?.open) previous.close('cancel');
    else previous?.remove();
    const host = document.querySelector('.theater-popup');
    if (!host) return Promise.resolve(null);
    const jsonUnavailable = jsonBytes > maxJsonBytes;
    const dialog = document.createElement('dialog');
    dialog.className = 'theater-export-format-dialog';
    dialog.dataset.theaterExportFormat = '';
    dialog.setAttribute('aria-labelledby', 'theater-export-format-title');
    dialog.innerHTML = `<form method="dialog" class="theater-export-format-sheet">
        <div class="theater-export-format-handle" aria-hidden="true"></div>
        <header>
            <span><small>导出格式</small><b id="theater-export-format-title">${runtime.esc(title)}</b></span>
            <button type="submit" value="cancel" aria-label="关闭导出格式选择"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <p>共 ${count} 项。按这次用途选择，不会自动替你更换格式。</p>
        <div class="theater-export-format-options">
            <button type="submit" value="zip" class="theater-export-format-option">
                <i class="fa-solid fa-file-zipper"></i><span><b>ZIP 可读归档</b><small>包含清单和分项文件，适合打开查看，也可重新导入。</small></span><i class="fa-solid fa-chevron-right"></i>
            </button>
            <button type="submit" value="json" class="theater-export-format-option" ${jsonUnavailable ? 'disabled' : ''}>
                <i class="fa-solid fa-database"></i><span><b>JSON 完整备份</b><small>${jsonUnavailable ? '内容超过单个 JSON 的安全上限，请改用 ZIP。' : '单文件保留完整数据，适合备份和迁移。'}</small></span><i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
    </form>`;
    host.appendChild(dialog);
    return new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            dialog.remove();
            resolve(value === 'zip' || value === 'json' ? value : null);
        };
        dialog.addEventListener('close', () => finish(dialog.returnValue));
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            dialog.close('cancel');
        });
        dialog.addEventListener('click', event => {
            if (event.target === dialog) dialog.close('cancel');
        });
        try {
            dialog.showModal();
        } catch {
            dialog.setAttribute('open', '');
        }
    });
}
// @theater-source-end chooseExportFormat

// @theater-source-begin exportLongDreamBackup
async function exportLongDreamBackup(records = runtime.longDreamCache, scope = 'archive', format = 'json') {
    const backup = createLongDreamBackup(records);
    if (!backup.dreams.length) {
        toastr.warning('没有可导出的长梦');
        return;
    }
    const serialized = JSON.stringify(backup, null, 2);
    const jsonBytes = new Blob([serialized]).size;
    if (format === 'zip') {
        try {
            const count = await exportLongDreamZip(records, scope);
            toastr.success(`已导出 ${count} 卷长梦 ZIP 可读归档`);
            return;
        } catch (error) {
            console.error('[Theater] Long dream ZIP export failed:', error);
            toastr.error('ZIP 生成失败，请检查酒馆 ZIP 组件后重试');
            return;
        }
    }
    if (jsonBytes > MAX_LONG_DREAM_BACKUP_BYTES) {
        toastr.warning('内容超过单个 JSON 的安全上限，请选择 ZIP 导出');
        return;
    }
    runtime.downloadFile(longDreamBackupFileName(scope, 'json'), serialized, 'application/json');
    toastr.success(`已导出 ${backup.dreams.length} 卷长梦 JSON 备份`);
}
// @theater-source-end exportLongDreamBackup

// @theater-source-begin requestLongDreamExport
async function requestLongDreamExport(records = runtime.longDreamCache, scope = 'archive') {
    const backup = createLongDreamBackup(records);
    if (!backup.dreams.length) {
        toastr.warning('没有可导出的长梦');
        return;
    }
    const jsonBytes = new Blob([JSON.stringify(backup, null, 2)]).size;
    const format = await chooseExportFormat({
        title: scope === 'all' ? '导出全部长梦' : '导出这部长梦',
        count: backup.dreams.length,
        jsonBytes,
        maxJsonBytes: MAX_LONG_DREAM_BACKUP_BYTES,
    });
    if (format) await exportLongDreamBackup(records, scope, format);
}
// @theater-source-end requestLongDreamExport

// @theater-source-begin readLongDreamZip
async function readLongDreamZip(file) {
    if (file.size > MAX_LONG_DREAM_ARCHIVE_BYTES) throw new Error('长梦 ZIP 超过 512 MB 安全上限');
    const JSZipCtor = await runtime.loadJSZip();
    const zip = await JSZipCtor.loadAsync(file);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (entries.length > MAX_LONG_DREAM_ARCHIVE_FILES) throw new Error('长梦 ZIP 文件数量异常，已停止导入');
    const manifestEntry = entries.find(entry => runtime.normalizedZipEntryName(entry.name) === LONG_DREAM_ARCHIVE_MANIFEST.toLocaleLowerCase());
    if (!manifestEntry) throw new Error('长梦 ZIP 缺少清单文件');
    const manifest = JSON.parse(await manifestEntry.async('string'));
    const files = [];
    let extractedBytes = 0;
    for (const entry of entries) {
        if (entry === manifestEntry) continue;
        const content = await entry.async('string');
        extractedBytes += new Blob([content]).size;
        if (extractedBytes > MAX_LONG_DREAM_ARCHIVE_BYTES) throw new Error('长梦 ZIP 解压后超过 512 MB 安全上限');
        files.push({ name: entry.name, content });
    }
    return parseLongDreamArchive(manifest, files);
}
// @theater-source-end readLongDreamZip

// @theater-source-begin importedLongDreamTitle
function importedLongDreamTitle(record) {
    const base = String(record?.title || '导入的长梦').trim() || '导入的长梦';
    const titles = new Set(runtime.longDreamCache.map(item => String(item?.title || '').trim().toLocaleLowerCase()));
    const candidateFor = index => {
        const suffix = index === 1 ? '（导入）' : `（导入） ${index}`;
        const prefix = base.slice(0, Math.max(1, 80 - suffix.length)).trim() || '导入的长梦';
        return `${prefix}${suffix}`;
    };
    let index = 1;
    let candidate = candidateFor(index);
    while (titles.has(candidate.toLocaleLowerCase())) {
        index++;
        candidate = candidateFor(index);
    }
    return candidate;
}
// @theater-source-end importedLongDreamTitle

// @theater-source-begin importLongDreamBackup
function importLongDreamBackup() {
    if (runtime.backup) { void runtime.backup.openRestore('dreams').catch(() => toastr.warning('暂时无法打开恢复，请停止生成后重试')); return; }
    if (runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) {
        toastr.warning('请先完成或停止当前长梦生成，再导入备份');
        return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.json,application/zip,application/json';
    input.onchange = async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const isZip = /\.zip$/i.test(file.name) || /(?:application|multipart)\/zip/i.test(file.type);
            if (!isZip && file.size > MAX_LONG_DREAM_BACKUP_BYTES) {
                toastr.warning('JSON 长梦备份超过 25 MB；请改用多文件 ZIP 备份');
                return;
            }
            const records = isZip
                ? await readLongDreamZip(file)
                : parseLongDreamBackup(JSON.parse(await file.text()));
            const total = records.length;
            let added = 0;
            for (const record of records) {
                const saved = await runtime.longDreamAdd({ ...record, title: importedLongDreamTitle(record) });
                if (saved) added++;
            }
            if (!added) {
                toastr.warning('没有长梦成功导入，本地存档可能无法写入');
                return;
            }
            runtime.longDreamView = 'list';
            runtime.activeLongDreamId = null;
            runtime.longDreamWorkspaceSection = 'works';
            runtime.longDreamWorkLevel = 'list';
            runtime.activeLongDreamChapterId = null;
            renderLongDreamPanel();
            if (added < total) {
                toastr.warning(`已导入 ${added}/${total} 卷长梦；已导入部分已新建副本，未覆盖现有长卷。请检查本地存档空间后再导入剩余备份。`, '', { timeOut: 9000 });
            } else {
                toastr.success(`已导入 ${added} 卷长梦；导入内容会新建副本，不会覆盖现有长卷。`);
            }
        } catch (error) {
            console.error('[Theater] 长梦备份导入失败: invalid_backup');
            toastr.error('导入长梦备份失败：文件格式或内容不受支持');
        }
    };
    input.click();
}
// @theater-source-end importLongDreamBackup

// @theater-source-begin readLongDreamChapter
function readLongDreamChapter(chapter, { startPlain = false } = {}) {
    if (!chapter) return;
    const text = chapter.text || undefined;
    runtime.openFullscreenReader({
        title: chapter.title || `第 ${chapter.number} 章`,
        text,
        html: chapter.html || runtime.textFallbackHtml(text || ''),
        mode: chapter.mode || (chapter.html ? 'html' : 'text'),
        startPlain,
    });
    toastr.info(`已打开${chapter.title || `第 ${chapter.number} 章`}`);
}
// @theater-source-end readLongDreamChapter

// @theater-source-begin longDreamChapterFileName
function longDreamChapterFileName(dream, chapter, extension) {
    const dreamTitle = String(dream?.title || '未命名长梦').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60).trim() || '未命名长梦';
    const chapterTitle = String(chapter?.title || `第 ${chapter?.number || '?'} 章`).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60).trim() || `第 ${chapter?.number || '?'} 章`;
    return `${dreamTitle}-第${chapter?.number || '?'}章-${chapterTitle}.${extension}`;
}
// @theater-source-end longDreamChapterFileName

// @theater-source-begin exportLongDreamChapter
function exportLongDreamChapter(dream, chapter) {
    if (!dream || !chapter) return;
    const text = String(chapter.text || runtime.htmlToPlainText(chapter.html || '')).trim();
    if (isTextOutputMode(chapter.mode) || !String(chapter.html || '').trim()) {
        runtime.downloadFile(longDreamChapterFileName(dream, chapter, 'txt'), text, 'text/plain;charset=utf-8');
    } else {
        runtime.downloadFile(longDreamChapterFileName(dream, chapter, 'html'), chapter.html, 'text/html;charset=utf-8');
    }
    toastr.success(`已导出《${chapter.title || `第 ${chapter.number} 章`}》`);
}
// @theater-source-end exportLongDreamChapter

// @theater-source-begin saveLongDreamChapterEdits
async function saveLongDreamChapterEdits() {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    const chapter = dream?.chapters?.find(item => String(item.id) === String(runtime.activeLongDreamChapterId));
    if (!dream || !chapter) return;
    if (runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) {
        toastr.warning('请先完成当前长梦任务');
        return;
    }
    if (dream.draft) {
        toastr.warning('请先处理未完成或待确认章节，再编辑正式章节');
        return;
    }
    const title = String($('#theater-dream-chapter-edit-title').val() || '').trim();
    const text = String($('#theater-dream-chapter-edit-text').val() || '').trim();
    if (!title) { toastr.warning('章节标题不能为空'); return; }
    if (!text) { toastr.warning('章节正文不能为空'); return; }

    const textChanged = text !== String(chapter.text || '').trim();
    let html = chapter.html;
    let mode = chapter.mode;
    if (textChanged) {
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            `保存《${chapter.title || `第 ${chapter.number} 章`}》的正文修改？`,
            '正文改变后会使用当前排版设置重新生成富 HTML 阅读版；原排版不会被静默替换为纯文本。梦脉会从本章起重新织录。',
        );
        if (!confirmed) return;
        runtime.longDreamChapterEditController = new AbortController();
        $('#theater-dream-save-chapter').prop('disabled', true);
        $('#theater-dream-chapter-edit-status').text('正在使用现有最终排版链路重建阅读版……');
        try {
            const rendered = await runtime.renderLongDreamChapter({
                text,
                originalInstruction: chapter.instruction || '',
                signal: runtime.longDreamChapterEditController.signal,
                apiRoute: runtime.captureGenerationApiRoute(SillyTavern.getContext()),
            });
            html = rendered.html;
            mode = rendered.mode;
        } catch (error) {
            const issue = runtime.captureRequestIssue(error, { stage: '长梦章节编辑排版' });
            runtime.theaterError(`章节正文没有保存：最终排版失败（${issue.signal}）`);
            $('#theater-dream-save-chapter').prop('disabled', false);
            $('#theater-dream-chapter-edit-status').text('排版失败，原章节和原始 HTML 均未改变。');
            return;
        } finally {
            runtime.longDreamChapterEditController = null;
        }
    }

    try {
        const latest = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        const currentChapter = latest?.chapters.find(item => String(item.id) === String(chapter.id));
        if (!currentChapter || latest.draft || String(runtime.activeLongDreamId) !== String(dream.id)
            || String(runtime.activeLongDreamChapterId) !== String(chapter.id)
            || JSON.stringify(currentChapter) !== JSON.stringify(chapter)) {
            $('#theater-dream-save-chapter').prop('disabled', false);
            toastr.info('章节状态已变化，请核对后再保存');
            return;
        }
        const updated = updateLongDreamChapter(latest, chapter.id, {
            title,
            text: textChanged ? text : chapter.text,
            html,
            mode,
        });
        const saved = await runtime.longDreamPut(updated);
        if (!saved) {
            $('#theater-dream-save-chapter').prop('disabled', false);
            $('#theater-dream-chapter-edit-status').text('章节写入失败，原章节保持不变。');
            return;
        }
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamWorkLevel = 'chapter';
        runtime.activeLongDreamChapterId = chapter.id;
        runtime.rememberLongDreamNavigation();
        renderLongDreamPanel();
        toastr.success(textChanged ? '章节正文与富 HTML 已更新，梦脉将从本章起重新织录' : '章节标题已保存，原始 HTML 保持不变');
        if (textChanged) runtime.queueLongDreamMemoryWeave(saved.id, { force: true });
    } catch (error) {
        toastr.warning(readableErrorText(error, '章节没有保存，请再试一次。', { context: '保存长梦章节编辑' }));
        $('#theater-dream-save-chapter').prop('disabled', false);
    }
}
// @theater-source-end saveLongDreamChapterEdits

// @theater-source-begin setCurrentLongDreamStatus
async function setCurrentLongDreamStatus(status) {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (!dream) return;
    if ((String(runtime.activeLongDreamGenerationId) === String(runtime.activeLongDreamId) && runtime.longDreamGenerationController?.active) || runtime.longDreamChapterEditController) {
        toastr.warning('请先完成或停止当前章节生成');
        return;
    }
    if (dream.draft) {
        toastr.warning('请先确认或放弃当前草稿，再改变长卷状态');
        return;
    }
    const complete = status === LONG_DREAM_STATUS.COMPLETE;
    const confirmed = await SillyTavern.getContext().Popup.show.confirm(
        complete ? `确认让《${dream.title}》完卷？` : `继续《${dream.title}》？`,
        complete
            ? '完卷后不会删除任何章节，只会停止“续写下一章”。以后仍可随时继续此梦。'
            : '这会恢复“续写下一章”，已经保存的章节不会改变。',
    );
    if (!confirmed) return;
    const latest = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
    if (!latest || String(runtime.activeLongDreamId) !== String(dream.id) || latest.draft
        || latest.status !== dream.status || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) {
        toastr.info('长梦状态已变化，请重新确认');
        return;
    }
    const saved = await runtime.longDreamPut(setLongDreamStatus(latest, status));
    if (!saved) return;
    renderLongDreamPanel();
    toastr.success(complete ? '这场梦已经完卷，章节仍可随时阅读和导出' : '这场梦已恢复继续续写');
    if (complete) runtime.queueLongDreamMemoryWeave(saved.id, { force: true });
}
// @theater-source-end setCurrentLongDreamStatus

return { historyItemHTML, historyTagBadgesHTML, longDreamSources, resolveLongDreamSource, longDreamDate, longDreamExcerpt, longDreamSourceInstructionState, longDreamSourcePreviewHTML, resetLongDreamCanonSuggestions, activeLongDreamCanonSuggestions, longDreamCanonSuggestionCardsHTML, longDreamCanonSuggestionHTML, renderLongDreamCanonSuggestions, findLongDreamCanonSuggestion, captureCurrentLongDreamWorldBooks, longDreamSnapshotEntryCount, longDreamBackupFileName, exportLongDreamZip, chooseExportFormat, exportLongDreamBackup, requestLongDreamExport, readLongDreamZip, importedLongDreamTitle, importLongDreamBackup, readLongDreamChapter, longDreamChapterFileName, exportLongDreamChapter, saveLongDreamChapterEdits, setCurrentLongDreamStatus };
}
