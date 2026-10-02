// long-dream-workspace: receives live state and cross-feature callbacks from index.js.
import { normalizeRoleSources } from './history-roles.js';
import { itemTags } from './tag-system.js';
import { LONG_DREAM_CANON_SUGGESTION_CATEGORIES } from './long-dream-canon-suggestions.js';
import { createLongDreamWorldBookSnapshot, updateLongDreamChapter, LONG_DREAM_STATUS, setLongDreamStatus, latestLongDreamChapter, LONG_DREAM_WORLD_LINE_RELATION, LONG_DREAM_MEMORY_STATUS, LONG_DREAM_MEMORY_TYPES, createLongDreamBranch, truncateLongDreamAfter, deleteLongDreamFrom, LONG_DREAM_WORLD_BOOK_POLICY, LONG_DREAM_DRAFT_STATUS, LONG_DREAM_DRAFT_RESUME_STAGE, updateLongDreamDefinition, LONG_DREAM_MAX_CANDIDATES } from './long-dream.js';
import { createLongDreamArchive, LONG_DREAM_ARCHIVE_MANIFEST, MAX_LONG_DREAM_ARCHIVE_BYTES, MAX_LONG_DREAM_ARCHIVE_FILES, parseLongDreamArchive } from './long-dream-archive.js';
import { createLongDreamBackup, MAX_LONG_DREAM_BACKUP_BYTES, parseLongDreamBackup } from './long-dream-backup.js';
import { isTextOutputMode } from './plain-text-renderer.js';
import { LONG_DREAM_GENERATION_STAGE } from './long-dream-generation.js';
import { readableCharCount } from './text-counter.js';
import { normalizeApiPresetList } from './api-presets.js';
import { normalizeLongDreamMemoryPresetList } from './long-dream-memory-presets.js';
import { summaryUnavailableReason } from './long-dream-summary-ui.js';
import { selectRelevantLongDreamMemoryItems, LONG_DREAM_RECENT_CHAPTER_COUNT, selectRelevantLongDreamMemoryCards } from './long-dream-payload.js';
import { renderSafeIframe } from './safe-renderer.js';

export function createLongDreamWorkspace(runtime) {
// @theater-source-begin historyItemHTML
function historyItemHTML(h) {
    const checked = runtime.histSelected.has(h.id) ? 'checked' : '';
    const selClass = runtime.histSelected.has(h.id) ? ' theater-history-item-selected' : '';
    const title = h.title || '未命名小剧场', id = runtime.esc(h.id);
    const roles = normalizeRoleSources(h.roleSources);
    const roleLabel = roles.length ? `${roles[0].name}${roles.length > 1 ? ` +${roles.length - 1}` : ''}` : '未指定';
    const action = (cls, label, icon, extra = '') => `<button type="button" class="${cls}" data-id="${id}" ${extra}><i class="fa-solid fa-${icon}"></i><span>${label}</span></button>`;
    return `<div class="theater-history-item${selClass}" data-id="${id}">
        <input type="checkbox" class="theater-hist-checkbox" data-id="${id}" ${checked} aria-label="选择这条历史">
        <div class="theater-history-heading">
            <div class="theater-history-title-row">
                <button type="button" class="theater-history-title theater-history-view" data-id="${id}" title="${runtime.esc(title)}">${runtime.esc(title)}</button>
                <button type="button" class="theater-history-info-trigger" data-id="${id}" aria-label="查看完整标题、角色与标签">
                    <span class="theater-history-role${roles.length ? '' : ' is-unassigned'}"><i class="fa-solid fa-user"></i><span>${runtime.esc(roleLabel)}</span></span>
                    <span class="theater-history-tags">${historyTagBadgesHTML(h)}</span>
                </button>
            </div>
            <div class="theater-history-bottom-row"><span class="theater-history-date">${runtime.esc(h.date || '')}</span>
                <div class="theater-history-actions">
                    ${action('theater-history-continue', '续写', 'forward')}
                    <button type="button" class="theater-history-menu-trigger" aria-label="${runtime.esc(title)}的更多操作" aria-expanded="false">⋮ 更多</button>
                    <template data-history-menu-content hidden>
                        ${action('theater-history-rename', '改名', 'pen')}
                        ${action('theater-history-tags-edit', '标签', 'tags')}
                        ${action('theater-history-roles-edit', '角色', 'user')}
                        ${action('theater-history-move', '移到文件夹', 'folder-open')}
                        ${action('theater-history-export', '导出', 'download', 'title="导出 HTML"')}
                        ${action('theater-history-delete', '删除', 'trash')}
                    </template>
                </div>
            </div>
        </div>
    </div>`;
}
// @theater-source-end historyItemHTML

// @theater-source-begin historyTagBadgesHTML
function historyTagBadgesHTML(item) {
    const tags = itemTags(item, runtime.knownInstructionTags());
    if (!tags.length) {
        return '<span class="theater-tag-badge is-uncategorized"><i class="fa-solid fa-tag"></i><span>未分类</span></span>';
    }
    const visible = tags.slice(0, 1);
    const hidden = tags.slice(1);
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
        const currentMeta = matchingHistory || matchingRecent;
        sources.push({
            key: 'current',
            kind: 'current',
            refId: matchingHistory?.id ?? null,
            title: matchingHistory?.title || '当前正在查看的小剧场',
            // 查看旧历史时宁可明确显示“未保存”，也不能拿当前输入框冒充当年的指令。
            instruction: currentMeta ? (currentMeta.instruction || '') : ($('#theater-instruction').val() || runtime.settings.lastInstruction || ''),
            sourceConfig: currentMeta?.sourceConfig || null,
            html: currentHtml,
            // 始终从当前 HTML 重新提取，避免历史浏览后误带上一轮生成的 lastGeneratedText。
            text: runtime.htmlToPlainText(currentHtml),
            mode: currentMeta?.mode || runtime.currentOutputMode || 'html',
        });
    }
    runtime.recentCache.forEach((item, index) => {
        sources.push({
            key: `recent:${index}`,
            kind: 'recent',
            refId: index,
            title: `最近生成 ${index + 1}`,
            instruction: item.instruction || '',
            sourceConfig: item.sourceConfig || null,
            html: item.html || '',
            text: runtime.htmlToPlainText(item.html || ''),
            mode: item.mode || 'html',
        });
    });
    runtime.historyCache.slice().reverse().forEach(item => {
        sources.push({
            key: `history:${item.id}`,
            kind: 'history',
            refId: item.id,
            title: item.title || '未命名小剧场',
            instruction: item.instruction || '',
            sourceConfig: item.sourceConfig || null,
            html: item.html || '',
            text: runtime.htmlToPlainText(item.html || ''),
            mode: item.mode || 'html',
        });
    });
    return sources.filter(source => source.text.trim() || source.html.trim());
}
// @theater-source-end longDreamSources

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
function readLongDreamChapter(chapter) {
    if (!chapter) return;
    const text = chapter.text || runtime.htmlToPlainText(chapter.html || '');
    runtime.openFullscreenReader({
        title: chapter.title || `第 ${chapter.number} 章`,
        text,
        html: chapter.html || runtime.textFallbackHtml(text),
        mode: chapter.mode || (chapter.html ? 'html' : 'text'),
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
        const updated = updateLongDreamChapter(dream, chapter.id, {
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
        toastr.warning(error?.message || String(error));
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
    const saved = await runtime.longDreamPut(setLongDreamStatus(dream, status));
    if (!saved) return;
    renderLongDreamPanel();
    toastr.success(complete ? '这场梦已经完卷，章节仍可随时阅读和导出' : '这场梦已恢复继续续写');
    if (complete) runtime.queueLongDreamMemoryWeave(saved.id, { force: true });
}
// @theater-source-end setCurrentLongDreamStatus

// @theater-source-begin longDreamListHTML
function longDreamListHTML() {
    const dreams = runtime.longDreamCache.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const cards = dreams.map(dream => {
        const latest = latestLongDreamChapter(dream);
        const chapterCount = dream.chapters?.length || 0;
        const complete = dream.status === 'complete';
        const memoryCount = longDreamActiveMemoryCount(dream);
        const latestText = latest?.text || runtime.htmlToPlainText(latest?.html || '');
        const progress = chapterCount ? (complete ? `共 ${chapterCount} 章` : `写至第 ${chapterCount} 章`) : '尚未开篇';
        const excerpt = longDreamExcerpt(latestText, 96) || '这部长梦还没有可显示的章节摘要。';
        return `<article class="theater-dream-library-card ${complete ? 'is-completed' : ''}" data-dream-open-work data-id="${runtime.esc(dream.id)}" role="button" tabindex="0" aria-label="打开长卷《${runtime.esc(dream.title)}》的章节目录">
            <div class="theater-dream-library-card-header">
                <h3>《${runtime.esc(dream.title)}》</h3>
                <span class="theater-dream-library-status">${complete ? '已完卷' : '仍在梦中'}</span>
            </div>
            <p class="theater-dream-library-excerpt"><b>${progress}</b><span>${runtime.esc(excerpt)}</span></p>
            <div class="theater-dream-library-card-footer">
                <div class="theater-dream-library-meta">
                    <span><i class="fa-regular fa-clock"></i>${runtime.esc(longDreamDate(dream.updatedAt))}</span>
                    <span><i class="fa-solid fa-layer-group"></i>${memoryCount ? `${memoryCount} 条梦脉` : '暂无梦脉'}</span>
                </div>
                <div class="theater-dream-library-card-actions">
                    <button type="button" class="theater-dream-library-export" data-dream-export-one data-id="${runtime.esc(dream.id)}" title="导出本卷" aria-label="导出长卷《${runtime.esc(dream.title)}》"><i class="fa-solid fa-file-export"></i></button>
                    <i class="fa-solid fa-chevron-right theater-dream-library-arrow" aria-hidden="true"></i>
                </div>
            </div>
        </article>`;
    }).join('');
    return `<div class="ia-works-level active theater-dream-home" data-works-level="shelf">
        <header class="theater-dream-library-header">
            <div class="theater-dream-library-title"><h2><i class="fa-solid fa-book-journal-whills"></i><span>我的长梦</span></h2><p>点击作品卡片进入章节目录</p></div>
            <button type="button" id="theater-dream-new" class="ui-btn ui-btn-sm ui-btn-primary"><i class="fa-solid fa-plus"></i><span>新建</span></button>
        </header>
        ${cards ? `<div class="theater-dream-list">${cards}</div>` : `<section class="ui-card theater-dream-empty"><div class="theater-dream-empty-icon">☾</div><b>还没有长梦</b><span>从定梦开始建立第一本作品。</span><button type="button" data-dream-new class="ui-btn ui-btn-primary">创建第一部长梦</button></section>`}
        <section class="ui-card theater-dream-action-card theater-dream-library-tools">
            <div class="theater-dream-action-heading"><span class="theater-dream-action-icon"><i class="fa-solid fa-box-archive"></i></span><span><b>备份与恢复</b><small>导入可信备份，或导出全部长梦</small></span></div>
            <div class="theater-dream-library-action-grid">
                <button type="button" id="theater-dream-import-backup" class="theater-dream-fat-btn is-secondary"><i class="fa-solid fa-upload"></i><span>导入备份</span></button>
                <button type="button" id="theater-dream-export-all" class="theater-dream-fat-btn is-primary" ${dreams.length ? '' : 'disabled'}><i class="fa-solid fa-download"></i><span>导出全部</span></button>
            </div>
            <small class="theater-dream-archive-note">备份会保留章节原始 HTML，请只导入可信来源。</small>
        </section>
    </div>`;
}
// @theater-source-end longDreamListHTML

// @theater-source-begin longDreamRelationLabel
function longDreamRelationLabel(value) {
    return runtime.LONG_DREAM_RELATION_OPTIONS.find(option => option.value === value)?.label || '完全隔离';
}
// @theater-source-end longDreamRelationLabel

// @theater-source-begin longDreamRelationChoicesHTML
function longDreamRelationChoicesHTML({ name, selected, hasBooks, disabled = false }) {
    return runtime.LONG_DREAM_RELATION_OPTIONS.map(option => {
        const needsBooks = option.value !== LONG_DREAM_WORLD_LINE_RELATION.ISOLATED;
        const isDisabled = disabled;
        return `<label class="theater-dream-choice relation-card ${isDisabled ? 'is-disabled' : ''}" ${needsBooks && !hasBooks ? 'data-needs-world-book="true"' : ''}>
            <input type="radio" name="${runtime.esc(name)}" value="${runtime.esc(option.value)}" ${selected === option.value ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
            <span class="relation-card-copy"><b>${runtime.esc(option.label)}${option.value === LONG_DREAM_WORLD_LINE_RELATION.ISOLATED ? '（推荐）' : ''}</b><small>${runtime.esc(option.description)}</small></span>
        </label>`;
    }).join('');
}
// @theater-source-end longDreamRelationChoicesHTML

// @theater-source-begin longDreamSourceWorldBooks
function longDreamSourceWorldBooks(source) {
    return [...new Set((source?.sourceConfig?.selectedWorldBooks || [])
        .map(name => String(name || '').trim())
        .filter(Boolean))];
}
// @theater-source-end longDreamSourceWorldBooks

// @theater-source-begin sameWorldBookSelection
function sameWorldBookSelection(left, right) {
    const a = [...left].sort();
    const b = [...right].sort();
    return a.length === b.length && a.every((name, index) => name === b[index]);
}
// @theater-source-end sameWorldBookSelection

// @theater-source-begin longDreamCreateWorldBookStateHTML
function longDreamCreateWorldBookStateHTML(source) {
    const selectedBooks = (runtime.settings.selectedWorldBooks || []).map(name => String(name || '').trim()).filter(Boolean);
    const sourceBooks = longDreamSourceWorldBooks(source);
    const canRestoreSource = sourceBooks.length > 0 && !sameWorldBookSelection(selectedBooks, sourceBooks);
    const currentText = selectedBooks.length
        ? `当前将冻结：${selectedBooks.join('、')}`
        : '当前素材页还没有选中的世界书。你仍可先选择 AU 等关系，确认开卷时会提醒补齐资料。';
    const sourceText = sourceBooks.length
        ? `<p class="theater-hint">这条历史记录当时保存过：${runtime.esc(sourceBooks.join('、'))}</p>`
        : '';
    return `<div class="theater-dream-inheritance-source-state ${selectedBooks.length ? 'has-world-books' : 'is-empty'}">
        <p class="theater-hint">非隔离模式只冻结素材页当前明确勾选的条目。${runtime.esc(currentText)}</p>
        ${sourceText}
        <div class="ia-action-row theater-dream-inheritance-tools">
            ${canRestoreSource ? '<button type="button" class="ui-btn ui-btn-sm" data-dream-restore-source-world-books><i class="fa-solid fa-clock-rotate-left"></i><span>恢复当时的世界书</span></button>' : ''}
            ${selectedBooks.length ? '' : '<button type="button" class="ui-btn ui-btn-sm" data-dream-open-world-books><i class="fa-solid fa-book-atlas"></i><span>去设定页选择</span></button>'}
        </div>
    </div>`;
}
// @theater-source-end longDreamCreateWorldBookStateHTML

// @theater-source-begin refreshLongDreamCreateWorldBookState
function refreshLongDreamCreateWorldBookState(source = resolveLongDreamSource($('#theater-dream-source').val())) {
    const container = document.getElementById('theater-dream-world-book-state');
    if (container) container.innerHTML = longDreamCreateWorldBookStateHTML(source);
}
// @theater-source-end refreshLongDreamCreateWorldBookState

// @theater-source-begin longDreamCreateHTML
function longDreamCreateHTML() {
    const sources = longDreamSources();
    const first = sources[0] || null;
    const options = sources.map(source => `<option value="${runtime.esc(source.key)}">${source.kind === 'history' ? '历史 · ' : ''}${runtime.esc(source.title)}</option>`).join('');
    const selectedBooks = (runtime.settings.selectedWorldBooks || []).filter(Boolean);
    return `<div class="theater-dream-create">
        ${sources.length ? `<div class="theater-dream-form-grid">
            <section class="ui-card theater-dream-form-card">
                <div class="ui-title"><span><i class="fa-solid fa-book-bookmark"></i> 第一章来源</span></div>
                <select id="theater-dream-source" class="ui-select theater-select" data-select2-id="${runtime.theaterNativeSelectCompatId()}">${options}</select>
                <div id="theater-dream-source-preview" class="source-preview-card theater-dream-source-preview">${longDreamSourcePreviewHTML(first)}</div>
            </section>
            <section class="ui-card theater-dream-form-card">
                <div class="ui-title"><span><i class="fa-solid fa-pen-nib"></i> 此梦设定 (Canon)</span></div>
                <label class="ia-field" for="theater-dream-title"><span>长卷名字</span><input id="theater-dream-title" class="ui-input theater-input theater-default-name" maxlength="80" value="" placeholder="${runtime.esc(first?.title || '未命名长梦')}"></label>
                <label class="ia-field" for="theater-dream-canon"><span>必须遵守的硬设定</span><textarea id="theater-dream-canon" class="ui-textarea theater-textarea" rows="7" placeholder="填写这场梦必须遵守的硬设定...">${runtime.esc(first?.instruction || '')}</textarea></label>
                <p id="theater-dream-source-hint" class="theater-hint ${longDreamSourceInstructionState(first).className}">${runtime.esc(longDreamSourceInstructionState(first).hint)}</p>
            </section>
            <section class="ui-card theater-dream-form-card theater-dream-inheritance">
                <div class="ui-title"><span><i class="fa-solid fa-code-branch"></i> 世界线继承关系</span></div>
                <div class="relation-cards">${longDreamRelationChoicesHTML({ name: 'theater-dream-world-line-relation', selected: LONG_DREAM_WORLD_LINE_RELATION.ISOLATED, hasBooks: selectedBooks.length > 0 })}</div>
                <div id="theater-dream-world-book-state">${longDreamCreateWorldBookStateHTML(first)}</div>
            </section>
        </div>
        <button type="button" id="theater-dream-create-confirm" class="ui-btn ui-btn-primary theater-dream-primary theater-dream-create-confirm"><i class="fa-solid fa-moon"></i><span>确认定梦并开卷</span></button>` : `<div class="ui-card theater-dream-empty theater-dream-empty-source">
            <i class="fa-regular fa-file-lines"></i>
            <b>还没有可以收入长梦的小剧场</b>
            <span>先去生成一场小剧场，或从备份导入一条历史，再回来开卷。</span>
            <button type="button" class="ui-btn ui-btn-primary theater-btn primary" data-dream-go-generate>去生成</button>
        </div>`}
    </div>`;
}
// @theater-source-end longDreamCreateHTML

// @theater-source-begin longDreamGenerationStageText
function longDreamGenerationStageText(stage) {
    if (stage === LONG_DREAM_GENERATION_STAGE.RENDERING) return '正文已经完成，正在生成最终 HTML 排版……';
    if (stage === LONG_DREAM_GENERATION_STAGE.REVIEW) return '新章节已经完成，等待确认保存';
    if (stage === LONG_DREAM_GENERATION_STAGE.STOPPED) return '生成已停止，当前正文已保存为草稿';
    if (stage === LONG_DREAM_GENERATION_STAGE.ERROR) return '生成遇到问题，当前正文已保存为草稿';
    return '正在续写这场梦……';
}
// @theater-source-end longDreamGenerationStageText

// @theater-source-begin formatLongDreamElapsed
function formatLongDreamElapsed(startedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(startedAt || Date.now())) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes} 分 ${String(remainder).padStart(2, '0')} 秒` : `${remainder} 秒`;
}
// @theater-source-end formatLongDreamElapsed

// @theater-source-begin longDreamProgressStageText
function longDreamProgressStageText(progress) {
    if (progress?.stage === LONG_DREAM_GENERATION_STAGE.RENDERING) return '正文已经完成，正在生成最终 HTML 排版';
    if (progress?.stage === LONG_DREAM_GENERATION_STAGE.REVIEW) return '新版本已经完成，正在准备预览';
    if (!progress?.firstChunkAt) return '正在等待接口返回首字';
    if (Number(progress?.round) > 1) return `正在自动续写第 ${progress.round} 轮`;
    return '正在写正文';
}
// @theater-source-end longDreamProgressStageText

// @theater-source-begin longDreamProgressLabelText
function longDreamProgressLabelText(progress) {
    if (progress?.stage !== LONG_DREAM_GENERATION_STAGE.RENDERING) return longDreamProgressStageText(progress);
    if (runtime.longDreamRenderRepairing) return '排版完整性校验未通过，正在修复 HTML……';
    return runtime.longDreamRenderReceivedChars
        ? `正在生成最终 HTML 排版……已接收 ${runtime.longDreamRenderReceivedChars.toLocaleString()} 字符`
        : '正文已经完成，正在生成最终 HTML 排版';
}
// @theater-source-end longDreamProgressLabelText

// @theater-source-begin longDreamProgressKickerText
function longDreamProgressKickerText(progress) {
    if (progress?.stage === LONG_DREAM_GENERATION_STAGE.RENDERING) return '正文已经写完';
    if (progress?.stage === LONG_DREAM_GENERATION_STAGE.REVIEW) return '新版本已经完成';
    if (!progress?.firstChunkAt) return '请求已经送出';
    return '梦境仍在延伸';
}
// @theater-source-end longDreamProgressKickerText

// @theater-source-begin longDreamProgressMetaHTML
function longDreamProgressMetaHTML(progress, fallbackChars = 0, fallbackTarget = 3000) {
    const currentChars = Math.max(0, Number(progress?.currentChars) || readableCharCount(fallbackChars));
    const targetChars = Math.max(500, Number(progress?.targetChars) || Number(fallbackTarget) || 3000);
    const round = Math.max(0, Number(progress?.round) || 0);
    const maxRounds = Math.max(1, Number(progress?.maxRounds) || 1);
    return `<div class="theater-dream-progress-meta" aria-live="polite">
        <span id="theater-dream-progress-round">${progress?.stage === LONG_DREAM_GENERATION_STAGE.RENDERING ? '最终排版' : (maxRounds > 1 ? `第 ${Math.max(1, round)} / ${maxRounds} 轮` : '正文生成')}</span>
        <span id="theater-dream-progress-elapsed">已等待 ${runtime.esc(formatLongDreamElapsed(progress?.startedAt))}</span>
        <span id="theater-dream-progress-chars">约 ${currentChars.toLocaleString()} / ${targetChars.toLocaleString()} 字</span>
    </div>`;
}
// @theater-source-end longDreamProgressMetaHTML

// @theater-source-begin selectedLongDreamMemoryApiPreset
function selectedLongDreamMemoryApiPreset() {
    const presetId = String(runtime.settings.longDreamMemoryApiPresetId || '');
    return normalizeApiPresetList(runtime.settings.apiPresets).find(preset => String(preset.id) === presetId) || null;
}
// @theater-source-end selectedLongDreamMemoryApiPreset

// @theater-source-begin longDreamMemoryAnalysisPresets
function longDreamMemoryAnalysisPresets() {
    runtime.settings.longDreamMemoryPresets = normalizeLongDreamMemoryPresetList(runtime.settings.longDreamMemoryPresets);
    return runtime.settings.longDreamMemoryPresets;
}
// @theater-source-end longDreamMemoryAnalysisPresets

// @theater-source-begin selectedLongDreamMemoryAnalysisPreset
function selectedLongDreamMemoryAnalysisPreset() {
    const presets = longDreamMemoryAnalysisPresets();
    return presets.find(preset => preset.id === runtime.settings.longDreamMemoryPresetId) || presets[0];
}
// @theater-source-end selectedLongDreamMemoryAnalysisPreset

// @theater-source-begin refreshLongDreamMemoryPresetControls
function refreshLongDreamMemoryPresetControls() {
    const presets = longDreamMemoryAnalysisPresets();
    const preset = selectedLongDreamMemoryAnalysisPreset();
    const select = $('#theater-dream-memory-analysis-preset');
    if (select.length) {
        select.empty().append(presets.map(item => `<option value="${runtime.esc(item.id)}">${runtime.esc(item.name)}${item.author ? ` · ${runtime.esc(item.author)}` : ''}</option>`).join('')).val(preset.id);
    }
    $('#theater-dream-memory-preset-description').text(preset.description || '只改变梦脉的分析侧重点；数据结构和输出合同由程序固定。');
    $('#theater-dream-memory-prompt').val(preset.focusPrompt).prop('readonly', preset.builtin === true);
    $('#theater-delete-dream-memory-preset').prop('hidden', preset.builtin === true);
    runtime.settings.longDreamMemoryPresetId = preset.id;
    runtime.settings.longDreamMemoryPrompt = preset.focusPrompt;
}
// @theater-source-end refreshLongDreamMemoryPresetControls

// @theater-source-begin longDreamMemoryStatusText
function longDreamMemoryStatusText(dream) {
    const memory = dream?.memory || {};
    const pending = Array.isArray(memory.pendingChapterNumbers) ? memory.pendingChapterNumbers.length : 0;
    if (!selectedLongDreamMemoryApiPreset()) return `${pending || dream?.chapters?.length || 0} 章待织录 · 尚未绑定副 API`;
    if (memory.status === LONG_DREAM_MEMORY_STATUS.WEAVING) return `正在后台织录${pending ? ` · ${pending} 章` : ''}`;
    if (memory.status === LONG_DREAM_MEMORY_STATUS.FAILED) return `${pending} 章待重试${memory.lastErrorSignal ? ` · ${memory.lastErrorSignal}` : ''}`;
    if (pending) return `${pending} 章待织录 · 累计 ${Math.max(1, Number(runtime.settings.longDreamMemoryBatchSize) || 3)} 章自动开始`;
    if (memory.processedThroughChapter) return `已织录至第 ${memory.processedThroughChapter} 章`;
    return '尚未开始织录';
}
// @theater-source-end longDreamMemoryStatusText

// @theater-source-begin longDreamActiveMemoryCount
function longDreamActiveMemoryCount(dream) {
    const memory = dream?.memory || {};
    const v2 = ['states', 'transitions', 'threads', 'deviations']
        .reduce((count, key) => count + (memory[key] || []).filter(item => !item.hiddenFromPrompt).length, 0);
    const legacy = [...(memory.cards || []), ...(memory.legacyCards || [])]
        .filter(card => card?.status !== 'dismissed').length;
    return v2 + legacy;
}
// @theater-source-end longDreamActiveMemoryCount

// @theater-source-begin longDreamSummaryHistoryHTML
function longDreamSummaryHistoryHTML(memory, blocked = false, dream = null) {
    const versions = (memory.summaryVersions || []).slice().reverse();
    if (!versions.length) return '';
    return `<details class="theater-dream-summary-history">
        <summary><span>最近版本</span><small>${versions.length} / 5</small><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
        <p class="theater-dream-summary-note">可查看并恢复旧版，仅切换概要，不回退正文或人物关系。</p>
        ${versions.map((version, i) => {
            const date = longDreamDate(version.createdAt);
            const reason = dream ? summaryUnavailableReason(dream, runtime.refreshingLongDreamSummaries.has(String(dream.id)), version.id)
                : version.canRestore === false ? '用户决定已改变，这版仅供查看。' : blocked ? '请先完成概要更新、织录和冲突确认。' : '';
            return `<article class="theater-dream-summary-version">
                <button type="button" class="theater-dream-summary-version-row" data-dream-summary-preview aria-expanded="false">
                    <span class="theater-dream-summary-version-info"><span class="theater-dream-summary-version-title">${i === 0 ? '最新保存' : i === 1 ? '上一版' : `较早 ${i} 版`}${i === 0 ? '<small class="theater-dream-summary-version-tag">最新</small>' : ''}</span><small class="theater-dream-summary-version-meta">截至第 ${version.chapterNumber} 章${date ? ` · ${runtime.esc(date)}` : ''}</small></span>
                    <span class="theater-dream-summary-version-toggle">查看</span>
                </button>
                <div class="theater-dream-summary-version-preview" hidden>
                    <div class="theater-dream-summary-version-text">${runtime.esc(version.text)}</div>
                    <p class="theater-dream-summary-note" data-dream-summary-version-reason="${runtime.esc(version.id)}" ${reason ? '' : 'hidden'}>${runtime.esc(reason)}</p>
                    <div class="theater-dream-summary-version-actions"><button type="button" data-dream-summary-restore="${runtime.esc(version.id)}" ${blocked || reason ? 'disabled' : ''}>${version.canRestore === false ? '仅供查看' : '恢复这版概要'}</button></div>
                </div>
            </article>`;
        }).join('')}
    </details>`;
}
// @theater-source-end longDreamSummaryHistoryHTML

// @theater-source-begin toggleLongDreamSummaryPreview
function toggleLongDreamSummaryPreview(button) {
    const history = button.closest('.theater-dream-summary-history');
    if (!history) return;
    const opening = button.getAttribute('aria-expanded') !== 'true';
    history.querySelectorAll('[data-dream-summary-preview]').forEach(row => {
        const expanded = row === button && opening;
        row.setAttribute('aria-expanded', String(expanded));
        row.querySelector('.theater-dream-summary-version-toggle').textContent = expanded ? '收起' : '查看';
        row.nextElementSibling.hidden = !expanded;
    });
}
// @theater-source-end toggleLongDreamSummaryPreview

// @theater-source-begin longDreamMemoryConflictTarget
function longDreamMemoryConflictTarget(memory, conflict) {
    const targetId = String(conflict?.targetId || conflict?.operation?.targetId || '');
    if (!targetId) return null;
    for (const key of ['states', 'transitions', 'threads', 'deviations']) {
        const item = (memory?.[key] || []).find(entry => String(entry?.id) === targetId);
        if (item) return item;
    }
    return null;
}
// @theater-source-end longDreamMemoryConflictTarget

// @theater-source-begin longDreamMemoryConflictSubjects
function longDreamMemoryConflictSubjects(value) {
    return (Array.isArray(value) ? value : [value])
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .join('、');
}
// @theater-source-end longDreamMemoryConflictSubjects

// @theater-source-begin longDreamMemoryConflictItemText
function longDreamMemoryConflictItemText(item) {
    if (!item) return '';
    if (item.threadKey) {
        const status = item.status === 'resolved'
            ? `已解决${item.resolution ? `：${item.resolution}` : ''}`
            : (item.status === 'abandoned'
                ? `已放弃${item.abandonedReason ? `：${item.abandonedReason}` : ''}`
                : (item.progress ? `当前进展：${item.progress}` : '尚未结束'));
        return longDreamExcerpt(`${item.threadKey}：${item.content || item.threadKey}（${status}）`, 260);
    }
    if (item.value) {
        const subject = longDreamMemoryConflictSubjects(item.subjects);
        return longDreamExcerpt(`${subject ? `${subject} · ` : ''}${item.topic || item.attribute || '当前状态'}：${item.value}`, 260);
    }
    if (item.to || item.cause) {
        const subject = longDreamMemoryConflictSubjects(item.subjects);
        const change = [item.from, item.to].filter(Boolean).join(' → ') || item.cause;
        return longDreamExcerpt(`${subject ? `${subject}：` : ''}${change}${item.cause && change !== item.cause ? `（原因：${item.cause}）` : ''}`, 260);
    }
    if (item.deviationKey || item.dreamChange) {
        return longDreamExcerpt(`${item.deviationKey || '世界线变化'}：${item.dreamChange || item.originalCanon || ''}`, 260);
    }
    return longDreamExcerpt(item.content || '', 260);
}
// @theater-source-end longDreamMemoryConflictItemText

// @theater-source-begin longDreamMemoryConflictOperationText
function longDreamMemoryConflictOperationText(operation = {}) {
    const subject = longDreamMemoryConflictSubjects(operation.subjects);
    if (operation.op === 'set_state') {
        return longDreamExcerpt(`${subject ? `${subject} · ` : ''}${operation.topic || operation.attribute || '当前状态'}：${operation.value || '未提供内容'}`, 260);
    }
    if (operation.op === 'append_transition') {
        const change = [operation.from, operation.to].filter(Boolean).join(' → ') || operation.cause || operation.impact;
        return longDreamExcerpt(`${subject ? `${subject}：` : ''}${change || '未提供变化内容'}${operation.cause && change !== operation.cause ? `（原因：${operation.cause}）` : ''}`, 260);
    }
    if (operation.op === 'open_thread') {
        return longDreamExcerpt(`${operation.threadKey || '未完事项'}：${operation.content || '再次出现'}${operation.progress ? `；新进展：${operation.progress}` : ''}`, 260);
    }
    if (operation.op === 'advance_thread') {
        return longDreamExcerpt(`${operation.threadKey ? `${operation.threadKey}：` : ''}${operation.progress || '事项出现新进展'}`, 260);
    }
    if (operation.op === 'resolve_thread') {
        return longDreamExcerpt(`${operation.threadKey ? `${operation.threadKey}：` : ''}本章提出已解决${operation.resolution ? `，结果是${operation.resolution}` : ''}`, 260);
    }
    if (operation.op === 'abandon_thread') {
        return longDreamExcerpt(`${operation.threadKey ? `${operation.threadKey}：` : ''}本章提出已放弃${operation.reason ? `，原因是${operation.reason}` : ''}`, 260);
    }
    if (operation.op === 'upsert_deviation') {
        return longDreamExcerpt(`${operation.deviationKey || '世界线变化'}：${operation.dreamChange || '未提供变化内容'}`, 260);
    }
    return '本章提出了新的梦脉变化，但没有可显示的内容。';
}
// @theater-source-end longDreamMemoryConflictOperationText

// @theater-source-begin longDreamMemoryConflictDetails
function longDreamMemoryConflictDetails(memory, conflict) {
    const target = longDreamMemoryConflictTarget(memory, conflict);
    let original = longDreamMemoryConflictItemText(target);
    if (!original && conflict?.reason === 'rejected-by-user') original = '这条内容曾被你标记为错误。';
    if (!original && conflict?.reason === 'missing-target') original = '原记录已经不存在，需要从已保存正文补织。';
    if (!original) original = '没有找到对应的旧梦脉记录。';
    return {
        original,
        incoming: longDreamMemoryConflictOperationText(conflict?.operation),
    };
}
// @theater-source-end longDreamMemoryConflictDetails

// @theater-source-begin longDreamMemoryCardsHTML
function longDreamMemoryCardsHTML(dream) {
    const memory = dream?.memory || {};
    const cards = Array.isArray(memory.cards) ? memory.cards : [];
    const legacyCards = Array.isArray(memory.legacyCards) ? memory.legacyCards : [];
    const activeCount = cards.filter(card => card?.status !== 'dismissed').length;
    const dismissedCount = cards.length - activeCount;
    const currentState = String(memory.currentState || '');
    const memoryLocked = memory.status === LONG_DREAM_MEMORY_STATUS.WEAVING;
    const groups = [
        ['state', '当前状态', '下一章开始时仍然成立的事实', memory.states || []],
        ['transition', '关键变化', '人物、关系和长期因果为什么发生变化', memory.transitions || []],
        ['thread', '未完事项', '伏笔、约定、谜团、秘密、任务和威胁的生命周期', memory.threads || []],
        ['deviation', '世界线偏离', '原线事实、本梦改变、后果和失效默认', memory.deviations || []],
    ];
    const v2Count = groups.reduce((count, group) => count + group[3].length, 0);
    const conflicts = Array.isArray(memory.pendingConflicts) ? memory.pendingConflicts : [];
    const conflictLabels = {
        'locked-by-user': '新章节与一条由你锁定的记忆不同',
        'rejected-by-user': '新章节再次出现了你曾否定的记忆',
        'closed-thread': '已经结束的事项似乎再次被提起',
        'missing-target': '新变化引用的旧记忆已经不存在',
        'target-type-mismatch': '新变化引用了不匹配的记忆类型',
    };
    if (!cards.length && !legacyCards.length && !v2Count && !currentState && !conflicts.length && !dream.chapters?.length) return '';

    const field = (name, label, value, { rows = 0, placeholder = '', list = null } = {}) => {
        if (list) return `<label class="ia-field theater-dream-memory-flow-field"><span>${label}</span><select class="ui-select theater-select" data-select2-id="${runtime.theaterNativeSelectCompatId()}" data-dream-memory-v2-field="${name}" ${memoryLocked ? 'disabled' : ''}>${list.map(([option, text]) => `<option value="${runtime.esc(option)}" ${option === value ? 'selected' : ''}>${runtime.esc(text)}</option>`).join('')}</select></label>`;
        if (rows) return `<label class="ia-field theater-dream-memory-flow-field"><span>${label}</span><textarea class="ui-textarea theater-textarea" rows="${rows}" data-dream-memory-v2-field="${name}" placeholder="${runtime.esc(placeholder)}" ${memoryLocked ? 'disabled' : ''}>${runtime.esc(value || '')}</textarea></label>`;
        return `<label class="ia-field theater-dream-memory-flow-field"><span>${label}</span><input class="ui-input theater-input ${placeholder ? 'placeholder-field' : ''}" data-dream-memory-v2-field="${name}" value="${runtime.esc(value || '')}" placeholder="${runtime.esc(placeholder)}" ${memoryLocked ? 'disabled' : ''}></label>`;
    };
    const v2Card = (kind, item) => {
        const sources = (item.sourceChapterNumbers || [item.chapterNumber || item.validFromChapter || item.introducedAt]).filter(Boolean);
        const compactName = item.threadKey || item.deviationKey || item.topic || item.attribute || item.kind || '未命名记录';
        const compactValue = longDreamExcerpt(item.value || item.content || item.to || item.dreamChange || item.progress || '', 72) || '尚未填写当前内容';
        const typeLabels = { state: '状态', transition: '变化', thread: '事项', deviation: '偏离' };
        const common = `${field('subjects', '主体', (item.subjects || []).join('、'), { placeholder: '多个主体用顿号分隔' })}`;
        let body = '';
        if (kind === 'state') {
            body = `${common}${field('attribute', '状态属性', item.attribute, { list: [['location', '所在地'], ['physical_condition', '身体/伤势'], ['relationship', '当前关系'], ['knowledge', '知情状态'], ['identity', '身份状态'], ['possession', '物品归属'], ['condition', '完好/可用状态'], ['ongoing_action', '正在行动'], ['goal', '当前目标'], ['other', '其他']] })}${field('topic', '具体主题', item.topic, { placeholder: '例如：泄密调查、银钥匙' })}${field('value', '当前值', item.value, { rows: 3 })}${item.history?.length ? `<details><summary>查看 ${item.history.length} 条旧值历史</summary>${item.history.map(old => `<p>第 ${old.fromChapter}–${old.toChapter} 章：${runtime.esc(old.value)}</p>`).join('')}</details>` : ''}`;
        } else if (kind === 'transition') {
            body = `${common}${field('domain', '变化领域', item.domain, { list: [['character', '人物'], ['relationship', '关系'], ['identity', '身份'], ['experience', '重要经历'], ['world', '局势/世界']] })}${field('from', '变化前', item.from, { rows: 2 })}${field('to', '变化后', item.to, { rows: 2 })}${field('cause', '变化原因', item.cause, { rows: 2 })}${field('impact', '长期影响', item.impact, { rows: 2 })}`;
        } else if (kind === 'thread') {
            body = `${field('threadKey', '事项名称', item.threadKey)}${common}${field('kind', '事项类型', item.kind, { list: [['foreshadow', '伏笔/待回收因果'], ['promise', '约定/承诺'], ['mystery', '谜团'], ['secret', '秘密'], ['task', '任务'], ['threat', '威胁']] })}${field('content', '事项内容', item.content, { rows: 3 })}${field('progress', '最新进展', item.progress, { rows: 2 })}${field('status', '事项状态', item.status || 'open', { list: [['open', '未解决'], ['progressed', '已推进'], ['resolved', '已解决'], ['abandoned', '已放弃']] })}${field('resolution', '解决结果（已解决时填写）', item.resolution, { rows: 2 })}${field('abandonedReason', '放弃原因（已放弃时填写）', item.abandonedReason, { rows: 2 })}${item.progressHistory?.length ? `<details><summary>查看 ${item.progressHistory.length} 次推进</summary>${item.progressHistory.map(step => `<p>第 ${step.chapterNumber} 章：${runtime.esc(step.content)}</p>`).join('')}</details>` : ''}`;
        } else {
            body = `${field('deviationKey', '偏离名称', item.deviationKey)}${common}${field('originalCanon', '原线事实', item.originalCanon, { rows: 2 })}${field('dreamChange', '本梦改变', item.dreamChange, { rows: 3 })}${field('directConsequences', '直接后果', (item.directConsequences || []).join('\n'), { rows: 3, placeholder: '每行一项' })}${field('invalidatedAssumptions', '失效默认', (item.invalidatedAssumptions || []).join('\n'), { rows: 3, placeholder: '每行一项' })}`;
        }
        const editorKey = `v2-${kind}-${item.id}`;
        const sourceText = `第 ${sources.length ? sources.join('、') : '?'} 章`;
        const subjectText = (item.subjects || []).join('、') || (item.threadKey || item.deviationKey || '梦脉事实');
        return `<article class="theater-dream-memory-flow-entry ${item.hiddenFromPrompt ? 'is-dismissed' : ''}" data-dream-memory-flow-kind="${kind}">
            <button type="button" class="theater-dream-memory-row" data-dream-memory-open-editor data-dream-memory-editor-key="${runtime.esc(editorKey)}" data-dream-memory-editor-title="${runtime.esc(compactName)}" data-dream-memory-editor-meta="${runtime.esc(`${typeLabels[kind] || '梦脉'} · ${sourceText}`)}">
                <span class="theater-dream-memory-row-type">${runtime.esc(typeLabels[kind] || '梦脉')}<small>${runtime.esc(sourceText)}</small></span>
                <span class="theater-dream-memory-row-main"><b>${runtime.esc(compactName)}</b><span>${runtime.esc(subjectText)} · ${runtime.esc(compactValue)}</span><small>${item.lockedByUser ? '已保存修改' : (item.editedByUser ? '人工校正' : '自动织录')}${item.hiddenFromPrompt ? ' · 暂不参与续写' : ''}</small></span>
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
            <template data-dream-memory-editor-template="${runtime.esc(editorKey)}"><div class="theater-dream-memory-editor-record theater-dream-memory-v2-card" data-dream-memory-v2-kind="${kind}" data-dream-memory-v2-id="${runtime.esc(item.id)}">
                <div class="theater-dream-memory-editor-note"><span>${item.lockedByUser ? '已保存修改' : (item.editedByUser ? '人工校正' : '自动织录')}${item.hiddenFromPrompt ? ' · 暂不参与续写' : ''}</span><small>来源${runtime.esc(sourceText)}</small></div>
                <div class="theater-dream-memory-card-grid">${body}</div>
                ${field('tags', '检索标签', (item.tags || []).join('、'), { placeholder: '用顿号或逗号分隔' })}
                ${item.quote ? `<blockquote>${runtime.esc(item.quote)}</blockquote>` : ''}
                <div class="theater-dream-memory-editor-actions">
                    <details class="theater-dream-memory-editor-more"><summary>更多操作</summary><div>${item.lockedByUser ? `<button type="button" data-dream-memory-v2-action="unlock" ${memoryLocked ? 'disabled' : ''}>交还自动更新</button>` : ''}<button type="button" data-dream-memory-v2-action="${item.hiddenFromPrompt ? 'show' : 'hide'}" ${memoryLocked ? 'disabled' : ''}>${item.hiddenFromPrompt ? '恢复参与续写' : '暂不参与续写'}</button><button type="button" class="is-danger" data-dream-memory-v2-action="reject" ${memoryLocked ? 'disabled' : ''}>标记为错误</button></div></details>
                    <button type="button" class="theater-dream-memory-editor-save" data-dream-memory-v2-action="save" ${memoryLocked ? 'disabled' : ''}><i class="fa-solid fa-check"></i><span>保存修改</span></button>
                </div>
            </div></template>
        </article>`;
    };
    return `<section class="theater-dream-memory-flow">
        <header class="theater-dream-memory-flow-header"><span><b>梦脉</b><small>${v2Count + activeCount + legacyCards.length} 项已确立的设定与因果${conflicts.length ? ` · ${conflicts.length} 项待确认` : ''}</small></span><button type="button" class="theater-dream-memory-regenerate" data-dream-memory-regenerate ${memoryLocked ? 'disabled' : ''}><i class="fa-solid fa-rotate" aria-hidden="true"></i><span>重新生成</span></button></header>
        <nav class="theater-dream-memory-flow-filters" aria-label="梦脉分类">
            <button type="button" class="active" data-dream-memory-filter="all" aria-pressed="true">全部 ${v2Count + cards.length + legacyCards.length}</button>
            ${groups.map(([kind, title, , items]) => items.length ? `<button type="button" data-dream-memory-filter="${kind}" aria-pressed="false">${title} ${items.length}</button>` : '').join('')}
            ${cards.length || legacyCards.length ? `<button type="button" data-dream-memory-filter="legacy" aria-pressed="false">旧版 ${cards.length + legacyCards.length}</button>` : ''}
        </nav>
        <div class="theater-dream-memory-state-editor">
            <label><span>全篇概要</span><small>按章保留故事开端、发展与因果；关系现状在下方单独更新。${dream.memory?.summaryNeedsRefresh ? (conflicts.length || memory.pendingChapterNumbers?.length ? '请先完成补织和冲突确认，再更新概要。' : '概要待更新，可点击下方更新概要。') : '可单独重新整理，不改正文或梦脉条目。'}</small>${currentState ? '<button type="button" data-dream-memory-state-toggle aria-expanded="false">展开</button>' : ''}</label>
            <div class="theater-dream-memory-current-state-readonly ${currentState ? 'is-clamped' : ''}">${currentState ? runtime.esc(currentState) : '尚未形成全篇概要。'}</div>
            <div class="theater-dream-summary-actions"><button type="button" data-dream-summary-refresh aria-busy="${runtime.refreshingLongDreamSummaries.has(String(dream.id))}" ${runtime.refreshingLongDreamSummaries.has(String(dream.id)) || memoryLocked || conflicts.length || memory.pendingChapterNumbers?.length ? 'disabled' : ''}>${runtime.refreshingLongDreamSummaries.has(String(dream.id)) ? '正在更新…' : '更新概要'}</button></div>
            ${memory.summaryThroughChapter ? `<small class="theater-dream-summary-note">当前概要截至第 ${memory.summaryThroughChapter} 章 · 正文共 ${dream.chapters.length} 章</small>` : ''}
            <p class="theater-dream-summary-blocked-reason" data-dream-summary-blocked-reason ${summaryUnavailableReason(dream, runtime.refreshingLongDreamSummaries.has(String(dream.id))) ? '' : 'hidden'}>${runtime.esc(summaryUnavailableReason(dream, runtime.refreshingLongDreamSummaries.has(String(dream.id))))}</p>
            ${longDreamSummaryHistoryHTML(memory, memoryLocked || !!conflicts.length || !!memory.pendingChapterNumbers?.length || runtime.refreshingLongDreamSummaries.has(String(dream.id)), dream)}
        </div>
        ${conflicts.length ? `<section class="theater-dream-memory-conflicts"><h4>有 ${conflicts.length} 处需要你决定</h4>${conflicts.map(conflict => {
            const details = longDreamMemoryConflictDetails(memory, conflict);
            return `<article data-dream-memory-conflict="${runtime.esc(conflict.id)}"><p>${runtime.esc(conflictLabels[conflict.reason] || '新章节提出了不能静默覆盖的变化')}。</p><div class="theater-dream-memory-conflict-details"><div><b>原梦脉</b><span>${runtime.esc(details.original)}</span></div><div><b>本章新变化</b><span>${runtime.esc(details.incoming)}</span></div></div><small>来自第 ${conflict.chapterNumber} 章 · ${conflict.reason === 'missing-target' ? '需要从已保存正文补织缺失记录' : '原记忆暂时保持不变'}</small><div class="theater-dream-memory-card-actions"><button type="button" class="theater-btn" ${memoryLocked ? 'disabled' : ''} data-dream-memory-conflict-action="${conflict.reason === 'missing-target' ? 'reweave' : 'accept'}">${conflict.reason === 'missing-target' ? '补织后再确认' : '以新章节为准'}</button><button type="button" class="theater-btn danger" ${memoryLocked ? 'disabled' : ''} data-dream-memory-conflict-action="keep">保留我的版本</button></div></article>`;
        }).join('')}</section>` : ''}
        <div class="theater-dream-memory-flow-list">
        ${groups.map(([kind, , , items]) => items.map(item => v2Card(kind, item)).join('')).join('')}
        ${(cards.length || legacyCards.length) ? [...cards, ...legacyCards].map(card => {
            const dismissed = card?.status === 'dismissed';
            const sources = (Array.isArray(card?.sourceChapterNumbers) ? card.sourceChapterNumbers : [card?.chapterNumber])
                .map(Number).filter(Number.isFinite);
            const typeOptions = LONG_DREAM_MEMORY_TYPES.map(type => `<option value="${runtime.esc(type)}" ${type === card.type ? 'selected' : ''}>${runtime.esc(type)}</option>`).join('');
            const editorKey = `legacy-${card.id}`;
            const compactName = card.key || card.type || '旧版梦脉';
            const compactValue = longDreamExcerpt(card.content || '', 72) || '尚未填写有效事实';
            const sourceText = `第 ${sources.length ? sources.join('、') : '?'} 章`;
            return `<article class="theater-dream-memory-flow-entry theater-dream-memory-legacy ${dismissed ? 'is-dismissed' : ''}" data-dream-memory-flow-kind="legacy">
            <button type="button" class="theater-dream-memory-row" data-dream-memory-open-editor data-dream-memory-editor-key="${runtime.esc(editorKey)}" data-dream-memory-editor-title="${runtime.esc(compactName)}" data-dream-memory-editor-meta="${runtime.esc(`旧版 · ${sourceText}`)}">
                <span class="theater-dream-memory-row-type">旧版<small>${runtime.esc(sourceText)}</small></span>
                <span class="theater-dream-memory-row-main"><b>${runtime.esc(compactName)}</b><span>${runtime.esc(compactValue)}</span><small>${dismissed ? '已废止' : (card.editedByUser ? '人工确认' : '梦脉事实')}</small></span>
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
            <template data-dream-memory-editor-template="${runtime.esc(editorKey)}"><div class="theater-dream-memory-editor-record" data-dream-memory-card="${runtime.esc(card.id)}">
                <div class="theater-dream-memory-editor-note"><span>${dismissed ? '已废止' : (card.editedByUser ? '人工确认' : '梦脉事实')}</span><small>来源${runtime.esc(sourceText)}</small></div>
                <div class="theater-dream-memory-card-grid">
                    <label class="theater-dream-memory-flow-field"><span>分类</span><select class="theater-select" data-select2-id="${runtime.theaterNativeSelectCompatId()}" data-dream-memory-type ${memoryLocked ? 'disabled' : ''}>${typeOptions}</select></label>
                    <label class="theater-dream-memory-flow-field"><span>状态槽位</span><input class="theater-input" data-dream-memory-key maxlength="120" value="${runtime.esc(card.key || '')}" placeholder="例如：林岚/所在地点" ${memoryLocked ? 'disabled' : ''}></label>
                </div>
                <label class="theater-dream-memory-content theater-dream-memory-flow-field"><span>有效事实</span><textarea class="theater-textarea" data-dream-memory-content rows="3" ${memoryLocked ? 'disabled' : ''}>${runtime.esc(card.content || '')}</textarea></label>
                <label class="theater-dream-memory-flow-field"><span>检索标签</span><input class="theater-input" data-dream-memory-tags value="${runtime.esc((card.tags || []).join('、'))}" placeholder="用顿号或逗号分隔" ${memoryLocked ? 'disabled' : ''}></label>
                ${card.quote ? `<blockquote>${runtime.esc(card.quote)}</blockquote>` : ''}
                <div class="theater-dream-memory-editor-actions">
                    <button type="button" class="theater-dream-memory-editor-secondary ${dismissed ? '' : 'is-danger'}" data-dream-memory-action="${dismissed ? 'restore' : 'dismiss'}" ${memoryLocked ? 'disabled' : ''}>${dismissed ? '恢复有效' : '废止此条'}</button>
                    <button type="button" class="theater-dream-memory-editor-save" data-dream-memory-action="save" ${memoryLocked ? 'disabled' : ''}><i class="fa-solid fa-check"></i><span>保存修改</span></button>
                </div>
            </div></template>
        </article>`;
        }).join('') : ''}
        </div>
        <dialog class="theater-dream-memory-editor" data-dream-memory-editor aria-labelledby="theater-dream-memory-editor-title">
            <div class="theater-dream-memory-editor-handle" aria-hidden="true"></div>
            <header class="theater-dream-memory-editor-header"><span><small data-dream-memory-editor-meta>梦脉</small><b id="theater-dream-memory-editor-title" data-dream-memory-editor-title>编辑梦脉</b></span><button type="button" data-dream-memory-close-editor aria-label="关闭编辑"><i class="fa-solid fa-xmark"></i></button></header>
            <div class="theater-dream-memory-editor-content" data-dream-memory-editor-content></div>
        </dialog>
    </section>`;
}
// @theater-source-end longDreamMemoryCardsHTML

// @theater-source-begin longDreamMemorySelectionHTML
function longDreamMemorySelectionHTML(dream, instruction = '') {
    const selectedItems = selectRelevantLongDreamMemoryItems(dream, { instruction, maxItems: 30, recentChapterCount: LONG_DREAM_RECENT_CHAPTER_COUNT });
    const activeCards = ['states', 'transitions', 'threads', 'deviations'].reduce((count, key) => count + (dream?.memory?.[key] || []).filter(item => !item.hiddenFromPrompt).length, 0)
        + [...(dream?.memory?.cards || []), ...(dream?.memory?.legacyCards || [])].filter(card => card?.status !== 'dismissed').length;
    if (!activeCards) return '<details id="theater-dream-memory-selection" class="theater-dream-memory-selection" hidden></details>';
    const selected = selectedItems.length ? selectedItems : selectRelevantLongDreamMemoryCards(dream, { instruction, maxCards: 30, recentChapterCount: LONG_DREAM_RECENT_CHAPTER_COUNT }).map(item => ({ kind: 'legacy', item }));
    const visible = selected.slice(0, 8);
    return `<details id="theater-dream-memory-selection" class="memory-hit-box theater-dream-memory-selection" open>
        <summary class="memory-hit-header"><span><i class="fa-solid fa-filter"></i> 检索命中梦脉 (${selected.length}/${activeCards})</span><i class="fa-solid fa-chevron-down"></i></summary>
        <div class="memory-chips-flow theater-dream-memory-selection-chips">${visible.map(entry => {
            const card = entry.item || entry;
            const label = card.threadKey || card.deviationKey || card.topic || card.key || longDreamExcerpt(card.value || card.content || card.to || card.dreamChange, 36) || '梦脉事实';
            const labels = { state: '状态', transition: '变化', thread: '事项', deviation: '偏离', legacy: card.type || '旧版' };
            return `<span class="memory-chip-tag theater-dream-memory-selection-chip" title="${runtime.esc(entry.text || label)}"><b>${runtime.esc(labels[entry.kind] || '梦脉')}</b><span class="theater-dream-memory-chip-text">${runtime.esc(label)}</span></span>`;
        }).join('')}${selected.length > visible.length ? `<span class="memory-chip-tag theater-dream-memory-selection-chip is-more">+ 另有 ${selected.length - visible.length} 条</span>` : ''}</div>
    </details>`;
}
// @theater-source-end longDreamMemorySelectionHTML

// @theater-source-begin refreshLongDreamMemorySelection
function refreshLongDreamMemorySelection() {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    const current = document.getElementById('theater-dream-memory-selection');
    if (!dream || !current) return;
    current.outerHTML = longDreamMemorySelectionHTML(dream, $('#theater-dream-next-instruction').val());
}
// @theater-source-end refreshLongDreamMemorySelection

// @theater-source-begin longDreamMemoryTags
function longDreamMemoryTags(value = '') {
    return [...new Set(String(value || '').split(/[、,，;；\n]+/).map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
}
// @theater-source-end longDreamMemoryTags

// @theater-source-begin longDreamMemoryV2Fields
function longDreamMemoryV2Fields(card, kind) {
    const value = name => card.find(`[data-dream-memory-v2-field="${name}"]`).val() || '';
    const subjects = longDreamMemoryTags(value('subjects')).slice(0, 8);
    const tags = longDreamMemoryTags(value('tags'));
    if (kind === 'state') return { subjects, attribute: value('attribute'), topic: value('topic'), value: value('value'), tags };
    if (kind === 'transition') return { subjects, domain: value('domain'), from: value('from'), to: value('to'), cause: value('cause'), impact: value('impact'), tags };
    if (kind === 'thread') return {
        threadKey: value('threadKey'), subjects, kind: value('kind'), content: value('content'), progress: value('progress'),
        status: value('status'), resolution: value('resolution'), abandonedReason: value('abandonedReason'), tags,
    };
    return {
        deviationKey: value('deviationKey'), subjects, originalCanon: value('originalCanon'), dreamChange: value('dreamChange'),
        directConsequences: String(value('directConsequences')).split(/\n+/).map(item => item.trim()).filter(Boolean).slice(0, 20),
        invalidatedAssumptions: String(value('invalidatedAssumptions')).split(/\n+/).map(item => item.trim()).filter(Boolean).slice(0, 20),
        tags,
    };
}
// @theater-source-end longDreamMemoryV2Fields

// @theater-source-begin uniqueLongDreamBranchTitle
function uniqueLongDreamBranchTitle(base = '未命名长梦支线') {
    const titles = new Set(runtime.longDreamCache.map(item => String(item?.title || '').trim().toLocaleLowerCase()));
    const cleanBase = String(base || '未命名长梦支线').trim().slice(0, 80) || '未命名长梦支线';
    if (!titles.has(cleanBase.toLocaleLowerCase())) return cleanBase;
    let index = 2;
    while (index < 1000) {
        const suffix = ` ${index}`;
        const candidate = `${cleanBase.slice(0, Math.max(1, 80 - suffix.length)).trim()}${suffix}`;
        if (!titles.has(candidate.toLocaleLowerCase())) return candidate;
        index++;
    }
    return `${cleanBase.slice(0, 65)} ${Date.now()}`;
}
// @theater-source-end uniqueLongDreamBranchTitle

// @theater-source-begin handleLongDreamChapterAction
async function handleLongDreamChapterAction(action, chapterId) {
    if (runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController) {
        toastr.warning('请先完成或停止当前长梦生成');
        return;
    }
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    const chapter = dream?.chapters?.find(item => String(item.id) === String(chapterId));
    if (!dream || !chapter) return;
    if (dream.draft) {
        toastr.warning('请先处理未完成或待确认章节，再管理正式章节');
        return;
    }
    if (action === 'branch' || action === 'rewrite') {
        const rewrite = action === 'rewrite';
        const baseTitle = `${dream.title}（第 ${chapter.number} 章${rewrite ? '重写' : '支线'}）`;
        const branch = createLongDreamBranch(dream, chapter.id, {
            includeChapter: !rewrite,
            title: uniqueLongDreamBranchTitle(baseTitle),
        });
        const saved = await runtime.longDreamAdd(branch);
        if (!saved) return;
        if (rewrite) {
            runtime.setLongDreamComposerDraft(saved.id, {
                chapterTitle: chapter.title,
                title: chapter.title,
                instruction: chapter.instruction || '',
                targetChars: 3000,
            });
        }
        runtime.activeLongDreamId = saved.id;
        runtime.longDreamView = 'detail';
        runtime.longDreamWorkspaceSection = 'continue';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        runtime.rememberLongDreamNavigation();
        renderLongDreamPanel();
        $('.theater-panels-wrapper').scrollTop(0);
        toastr.success(rewrite
            ? `原卷已保留；已创建新支线，可重新生成第 ${chapter.number} 章`
            : `原卷已保留；新支线从第 ${chapter.number} 章结尾继续`);
        return;
    }
    if (action === 'rollback') {
        const removed = dream.chapters.length - chapter.number;
        if (removed <= 0) return;
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            `回退到第 ${chapter.number} 章？`,
            `当前卷将移除后续 ${removed} 章及未完成草稿，梦脉会从保留章节重新织录。原卷不会自动留副本；如需保留，请先使用“另开支线”。`,
        );
        if (!confirmed) return;
        const saved = await runtime.longDreamPut(truncateLongDreamAfter(dream, chapter.id));
        if (!saved) return;
        runtime.clearLongDreamComposerDraft(saved.id);
        renderLongDreamPanel();
        toastr.success(`已回退到第 ${chapter.number} 章，后续 ${removed} 章已移除`);
        return;
    }
    if (action === 'delete-from') {
        const removed = dream.chapters.length - chapter.number + 1;
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            `删除第 ${chapter.number} 章及之后内容？`,
            `将从当前卷删除 ${removed} 章，保留到第 ${chapter.number - 1} 章；梦脉会重新织录。此操作不会删除另开的支线。`,
        );
        if (!confirmed) return;
        const saved = await runtime.longDreamPut(deleteLongDreamFrom(dream, chapter.id));
        if (!saved) return;
        runtime.clearLongDreamComposerDraft(saved.id);
        runtime.longDreamWorkspaceSection = 'works';
        runtime.longDreamWorkLevel = 'detail';
        runtime.activeLongDreamChapterId = null;
        renderLongDreamPanel();
        toastr.success(`已删除第 ${chapter.number} 章及之后 ${removed} 章`);
    }
}
// @theater-source-end handleLongDreamChapterAction

// @theater-source-begin longDreamWorkspaceHTML
function longDreamWorkspaceHTML(content, activeSection = runtime.longDreamWorkspaceSection) {
    const sections = [
        ['definition', '定梦'],
        ['continue', '续写'],
        ['works', '作品'],
    ];
    return `<div class="theater-dream-workspace ia-long-dream-shell" data-dream-workspace-section="${runtime.esc(activeSection)}">
        <nav class="theater-dream-workspace-tabs ia-subnav" aria-label="长梦分类">
            ${sections.map(([section, label]) => `<button type="button" class="theater-dream-workspace-tab ia-subtab ${activeSection === section ? 'active' : ''}" data-dream-section="${section}" aria-current="${activeSection === section ? 'page' : 'false'}">${label}</button>`).join('')}
        </nav>
        <section class="theater-dream-workspace-body ia-category active" data-category-panel="${runtime.esc(activeSection)}"><div class="ia-column">${content}</div></section>
    </div>`;
}
// @theater-source-end longDreamWorkspaceHTML

// @theater-source-begin longDreamDetailState
function longDreamDetailState(dream) {
    const latest = latestLongDreamChapter(dream);
    const chapterText = latest?.text || runtime.htmlToPlainText(latest?.html || '');
    const selectedPolicy = dream.inheritance?.worldBookPolicy === LONG_DREAM_WORLD_BOOK_POLICY.SELECTED;
    const worldLineRelation = dream.inheritance?.worldLineRelation || (selectedPolicy ? LONG_DREAM_WORLD_LINE_RELATION.PARALLEL : LONG_DREAM_WORLD_LINE_RELATION.ISOLATED);
    const selectedBooks = dream.inheritance?.worldBookNames || [];
    const snapshotEntries = longDreamSnapshotEntryCount(dream.inheritance?.snapshot);
    const availableBooks = (runtime.settings.selectedWorldBooks || []).filter(Boolean);
    const currentCheckedEntries = runtime.wbEntries.filter((entry, index) => !entry.manual
        && availableBooks.includes(entry.book)
        && runtime.wbStates[index] !== false).length;
    const bookText = selectedBooks.length ? selectedBooks.join('、') : (availableBooks.length ? availableBooks.join('、') : '当前没有选中的世界书');
    const nextNumber = dream.chapters.length + 1;
    const activeMemoryCount = longDreamActiveMemoryCount(dream);
    const inheritanceSummary = selectedPolicy && selectedBooks.length
        ? `${longDreamRelationLabel(worldLineRelation)} · ${selectedBooks.length} 本资料库`
        : '完全隔离';
    const draft = dream.draft || null;
    const draftCandidates = Array.isArray(draft?.candidates) ? draft.candidates : [];
    const selectedCandidateIndex = draftCandidates.length
        ? Math.min(draftCandidates.length - 1, Math.max(0, Math.floor(Number(draft?.selectedCandidateIndex) || 0)))
        : 0;
    const isGeneratingThisDream = String(runtime.activeLongDreamGenerationId) === String(dream.id)
        && !!runtime.longDreamGenerationController?.active;
    const activeProgress = isGeneratingThisDream ? runtime.longDreamGenerationController.active : null;
    const activeStage = activeProgress?.stage || null;
    const draftText = isGeneratingThisDream ? runtime.longDreamLiveDraftText : (draft?.text || '');
    const hasWritingDraft = draft?.status === LONG_DREAM_DRAFT_STATUS.WRITING;
    const hasReviewDraft = draft?.status === LONG_DREAM_DRAFT_STATUS.REVIEW && !isGeneratingThisDream;
    const hasRenderPendingDraft = hasWritingDraft
        && draft?.resumeStage === LONG_DREAM_DRAFT_RESUME_STAGE.RENDERING
        && !!draftText.trim();
    const controlsDisabled = isGeneratingThisDream || !!runtime.longDreamChapterEditController || hasReviewDraft || dream.status === 'complete';
    const statusControlDisabled = isGeneratingThisDream || !!runtime.longDreamChapterEditController || !!draft;
    const composerDraft = runtime.getLongDreamComposerDraft(dream.id);
    const nextTitle = draft?.title || composerDraft.title || '';
    const nextInstruction = draft ? draft.instruction : composerDraft.instruction;
    const nextTarget = Math.max(500, Math.min(8000, Math.round(Number(draft?.targetChars || composerDraft.targetChars) || 3000)));
    const generationHint = hasReviewDraft
        ? `当前有 ${draftCandidates.length} 版候选，可继续生成；未保留候选仅留最新三版，已保留版本不被替换。`
        : (hasWritingDraft
            ? (hasRenderPendingDraft
                ? '正文已经完整保存；继续时只会重新生成最终排版，不会再次请求或重复正文。'
                : (draftCandidates.length
                    ? `正在准备新版本；此前 ${draftCandidates.length} 版候选仍安全保留。`
                    : '检测到可恢复草稿；继续时重新注入完整基础包和当前全文，只从草稿结尾承接。'))
            : '');
    return {
        latest, chapterText, selectedPolicy, worldLineRelation, selectedBooks, snapshotEntries,
        availableBooks, currentCheckedEntries, bookText, nextNumber, activeMemoryCount,
        inheritanceSummary, draft, draftCandidates, selectedCandidateIndex,
        isGeneratingThisDream, activeProgress, activeStage, draftText, hasWritingDraft, hasReviewDraft,
        hasRenderPendingDraft, controlsDisabled, statusControlDisabled, nextTitle,
        nextInstruction, nextTarget, generationHint,
    };
}
// @theater-source-end longDreamDetailState

// @theater-source-begin longDreamDetailHeaderHTML
function longDreamDetailHeaderHTML(dream, { showTools = false, statusControlDisabled = false } = {}) {
    return `<header class="compact-detail-head theater-dream-detail-head">
        <div class="compact-detail-head-main">
            <span class="step theater-dream-step">${dream.status === 'complete' ? '已完结' : '仍在梦中'} · 共 ${dream.chapters.length} 章</span>
            <h2>《${runtime.esc(dream.title)}》</h2>
        </div>
        ${showTools ? `<div class="compact-tools">
            <button type="button" id="theater-dream-export-current" title="导出本卷" aria-label="导出本卷"><i class="fa-solid fa-file-export"></i></button>
            <button type="button" id="${dream.status === 'complete' ? 'theater-dream-reopen' : 'theater-dream-complete'}" title="${dream.status === 'complete' ? '重新打开作品' : '完卷'}" aria-label="${dream.status === 'complete' ? '重新打开作品' : '完卷'}" ${statusControlDisabled ? 'disabled' : ''}><i class="fa-solid ${dream.status === 'complete' ? 'fa-feather-pointed' : 'fa-book-bookmark'}"></i></button>
        </div>` : ''}
        <div class="compact-seal" aria-hidden="true">梦</div>
    </header>`;
}
// @theater-source-end longDreamDetailHeaderHTML

// @theater-source-begin refreshLongDreamWorldBookSources
async function refreshLongDreamWorldBookSources() {
    if (runtime.refreshingLongDreamWorldBooks) return;
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (!dream) return;
    const state = longDreamDetailState(dream);
    if (state.isGeneratingThisDream || state.hasReviewDraft || runtime.isPreparingGeneration || runtime.longDreamChapterEditController) {
        toastr.warning('请先完成当前生成、待确认章节或章节编辑，再更新世界书');
        return;
    }
    if (!state.selectedPolicy) return;
    const bookNames = (runtime.settings.selectedWorldBooks || []).filter(Boolean);
    if (!bookNames.length) { toastr.warning('素材页当前没有选中的世界书'); return; }
    const key = runtime.worldBookCacheKey();
    runtime.refreshingLongDreamWorldBooks = true;
    runtime.refreshingLongDreamWorldBookId = dream.id;
    syncLongDreamPanel({ renderDrafts: false });
    try {
        const complete = await runtime.reloadWorldBooks({ silent: true, force: true, requireFresh: true });
        if (key !== runtime.worldBookCacheKey()) { toastr.info('世界书选择已变化，冻结资料未改动，请重新更新'); return; }
        if (!complete) { toastr.warning('世界书未全部读取成功，冻结资料未改动，请重试'); return; }
        const current = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        if (String(runtime.activeLongDreamId) !== String(dream.id) || current !== dream) {
            toastr.info('长梦已切换或内容已变化，本次未更新冻结资料');
            return;
        }
        const currentState = longDreamDetailState(current);
        if (currentState.isGeneratingThisDream || currentState.hasReviewDraft || runtime.isPreparingGeneration || runtime.longDreamChapterEditController) {
            toastr.info('长梦正在生成或编辑，本次未更新冻结资料');
            return;
        }
        const snapshot = captureCurrentLongDreamWorldBooks(bookNames);
        const entryCount = longDreamSnapshotEntryCount(snapshot);
        if (!entryCount) { toastr.warning('素材页当前没有已勾选的世界书条目，冻结资料未改动'); return; }
        const saved = await runtime.longDreamPut(updateLongDreamDefinition(current, {
            worldBookNames: bookNames,
            worldBookSnapshot: snapshot,
        }));
        if (!saved) { toastr.warning('冻结资料未能保存，请重试'); return; }
        toastr.success(`冻结资料已更新为当前勾选的 ${entryCount} 条`);
    } catch { toastr.warning('世界书更新失败，请重试'); }
    finally {
        runtime.refreshingLongDreamWorldBooks = false;
        runtime.refreshingLongDreamWorldBookId = null;
        syncLongDreamPanel({ renderDrafts: false });
    }
}
// @theater-source-end refreshLongDreamWorldBookSources

// @theater-source-begin longDreamDefinitionHTML
function longDreamDefinitionHTML(dream) {
    const state = longDreamDetailState(dream);
    return `<div class="theater-dream-detail theater-dream-definition" data-id="${runtime.esc(dream.id)}">
        <section class="ui-card theater-dream-settings is-workspace">
            <div class="ui-title"><span><i class="fa-solid fa-pen-nib"></i> 此梦设定 (Canon)</span></div>
            <div class="theater-dream-settings-body">
                <label class="ia-field" for="theater-dream-edit-title"><span>长卷名字</span><input id="theater-dream-edit-title" class="ui-input theater-input" maxlength="80" value="${runtime.esc(dream.title)}" ${state.isGeneratingThisDream || state.hasReviewDraft ? 'disabled' : ''}></label>
                <label class="ia-field" for="theater-dream-edit-canon"><span>此梦正典与初始设定</span><textarea id="theater-dream-edit-canon" class="ui-textarea theater-textarea" rows="7" placeholder="写下这条世界线必须遵守的事实。" ${state.isGeneratingThisDream || state.hasReviewDraft ? 'disabled' : ''}>${runtime.esc(dream.canon)}</textarea></label>
            </div>
        </section>
        <section class="ui-card theater-dream-inheritance">
            <div class="ui-title"><span><i class="fa-solid fa-code-branch"></i> 世界线继承关系</span></div>
            <div class="relation-cards theater-dream-relation-list">${longDreamRelationChoicesHTML({ name: 'theater-dream-edit-relation', selected: state.worldLineRelation, hasBooks: !!(state.selectedBooks.length || state.availableBooks.length), disabled: state.isGeneratingThisDream || state.hasReviewDraft })}</div>
        </section>
        <section class="ui-card theater-dream-world-book-freeze">
            <div class="ui-title"><span><i class="fa-solid fa-book"></i> 初始设定与冻结资料</span></div>
            <div class="source-preview-card"><div class="source-preview-title">初始设定快照</div><div class="source-preview-text">角色卡、用户人设、固定事实与选定正典已在定梦时保存。</div></div>
            <div class="theater-dream-world-book-summary">
                <div class="theater-dream-world-book-row"><div class="theater-dream-world-book-title">冻结世界书 <span id="theater-dream-frozen-count">· ${state.snapshotEntries} 条</span></div>${state.selectedPolicy ? `<button type="button" id="theater-dream-refresh-world-book" class="ui-btn ui-btn-sm" aria-busy="${runtime.refreshingLongDreamWorldBooks}" ${runtime.refreshingLongDreamWorldBooks || state.isGeneratingThisDream || state.hasReviewDraft ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8"/></svg><span>${runtime.refreshingLongDreamWorldBooks ? '更新中…' : '更新世界书'}</span></button>` : ''}</div>
                <p id="theater-dream-frozen-books" class="theater-dream-world-book-library">${state.selectedPolicy ? `当前冻结资料库：${runtime.esc(state.bookText)}` : '当前完全隔离，不读取原世界书'}</p>
                <p class="theater-dream-world-book-hint">${state.selectedPolicy ? '按素材页勾选，重新读取并更新冻结资料。' : '不会读取或猜测原世界书。'}</p>
            </div>
        </section>
        <button type="button" id="theater-dream-save-definition" class="ui-btn ui-btn-primary theater-btn primary theater-dream-definition-save" ${state.isGeneratingThisDream || state.hasReviewDraft ? 'disabled' : ''}><i class="fa-solid fa-floppy-disk"></i><span>保存定梦设置</span></button>
    </div>`;
}
// @theater-source-end longDreamDefinitionHTML

// @theater-source-begin longDreamDetailHTML
function longDreamDetailHTML(dream) {
    const state = longDreamDetailState(dream);
    const writeFlow = state.hasReviewDraft ? '' : `<div class="ia-flow-state active theater-dream-write-state">
        ${longDreamDetailHeaderHTML(dream, { showTools: true, statusControlDisabled: state.statusControlDisabled })}
        <section class="ui-card theater-dream-next">
            <div class="ui-title"><span><i class="fa-solid fa-feather-pointed"></i> 续写第 ${state.nextNumber} 章</span><button type="button" class="theater-dream-options-trigger" data-dream-options-toggle aria-expanded="false" aria-controls="theater-dream-continuation-options" aria-label="打开本章选项与上下文" title="本章选项与上下文"><i class="fa-solid fa-sliders" aria-hidden="true"></i></button></div>
            <textarea id="theater-dream-next-instruction" class="ui-textarea theater-textarea" rows="5" placeholder="这一章想发生什么？（可留空自然续写）" ${state.controlsDisabled ? 'disabled' : ''}>${runtime.esc(state.nextInstruction)}</textarea>
            <div id="theater-dream-token-summary" class="theater-dream-token-summary" role="button" tabindex="0" aria-expanded="false" aria-controls="theater-dream-token-details"><span id="theater-dream-token-summary-value" aria-live="polite">正在估算…</span><span>明细 ▾</span></div>
            <div id="theater-dream-token-details" class="theater-hint-inline theater-dream-token-details" style="display:none;"></div>
            ${state.isGeneratingThisDream ? '' : `<div class="theater-dream-next-actions ia-action-row">
                <button type="button" id="theater-dream-clear-next-instruction" class="ui-btn ui-btn-sm" ${state.controlsDisabled || state.hasWritingDraft || !state.nextInstruction.trim() ? 'disabled' : ''} title="只清空本章续写指令，不影响已有章节"><i class="fa-solid fa-eraser"></i><span>清空指令</span></button>
                ${state.hasWritingDraft ? `<button type="button" id="theater-dream-discard-draft" class="ui-btn ui-btn-sm"><i class="fa-solid fa-xmark"></i><span>${state.draftCandidates.length ? '放弃本轮生成' : '放弃草稿'}</span></button>` : ''}
                <button type="button" id="theater-dream-generate-next" class="ui-btn ui-btn-primary theater-dream-primary" ${state.controlsDisabled ? 'disabled' : ''}><i class="fa-solid fa-feather-pointed"></i><span>${state.hasRenderPendingDraft ? '重新生成最终排版' : (state.hasWritingDraft ? '继续完整草稿' : '续写下一章')}</span></button>
            </div>`}
            ${state.generationHint ? `<p class="theater-dream-generation-hint">${runtime.esc(state.generationHint)}</p>` : ''}
        </section>
        <section id="theater-dream-continuation-options" class="ui-card ia-options-card theater-dream-next-options">
            <div class="ui-title"><span><i class="fa-solid fa-pen"></i> 本章选项与上下文</span></div>
            <div class="ia-grid-2 theater-dream-next-grid">
                <label class="ia-field"><span>可选章名</span><input id="theater-dream-next-title" class="ui-input theater-input theater-default-name" maxlength="80" value="${runtime.esc(state.nextTitle)}" placeholder="第 ${state.nextNumber} 章" ${state.controlsDisabled ? 'disabled' : ''}></label>
                <label class="ia-field"><span>目标字数</span><input id="theater-dream-next-target" class="ui-input theater-input" type="number" min="500" max="8000" step="500" value="${state.nextTarget}" ${state.controlsDisabled ? 'disabled' : ''}></label>
            </div>
            <div class="theater-dream-context-window">${dream.chapters.slice(-LONG_DREAM_RECENT_CHAPTER_COUNT).reverse().map(chapter => `<div class="ia-context-row"><div class="ia-context-copy"><div class="ia-line-title">第 ${chapter.number} 章 · ${runtime.esc(chapter.title)}</div><div class="ia-line-sub">最近完整章节 · ${readableCharCount(chapter.text || runtime.htmlToPlainText(chapter.html || ''))} 字 · 已注入全文</div></div><span class="memory-v2-tag">近期</span></div>`).join('')}${dream.chapters.length > LONG_DREAM_RECENT_CHAPTER_COUNT ? `<div class="ia-context-row"><div class="ia-context-copy"><div class="ia-line-title">更早章节索引</div><div class="ia-line-sub">第 1–${dream.chapters.length - LONG_DREAM_RECENT_CHAPTER_COUNT} 章旧章索引继续参与检索</div></div><span class="memory-v2-tag">索引</span></div>` : ''}</div>
        </section>
        <section id="theater-dream-generation-status" class="ui-card ia-generation-status theater-dream-generation-status ${state.isGeneratingThisDream || state.hasWritingDraft ? 'open' : ''}" ${state.isGeneratingThisDream || state.hasWritingDraft ? '' : 'hidden'}>
            <header class="theater-dream-progress-head">
                <div class="theater-dream-progress-copy"><span class="theater-dream-progress-kicker"><i class="theater-dream-progress-pulse" aria-hidden="true"></i><small id="theater-dream-generation-kicker">${runtime.esc(state.isGeneratingThisDream ? longDreamProgressKickerText(state.activeProgress) : '草稿仍在这里')}</small></span><b id="theater-dream-generation-label">${runtime.esc(state.isGeneratingThisDream ? longDreamProgressLabelText(state.activeProgress) : (state.hasRenderPendingDraft ? '正文已完成，等待重新排版' : '发现一份未完成草稿'))}</b></div>
                <span id="theater-dream-generation-version" class="theater-dream-progress-version">${state.isGeneratingThisDream ? ((state.activeProgress?.candidateNumber || state.draftCandidates.length + 1) > LONG_DREAM_MAX_CANDIDATES ? '新版本' : `第 ${state.activeProgress?.candidateNumber || state.draftCandidates.length + 1} 版`) : '可恢复'}</span>
            </header>
            ${state.isGeneratingThisDream ? longDreamProgressMetaHTML(state.activeProgress, state.draftText, state.nextTarget) : ''}
            ${state.isGeneratingThisDream ? '<div class="ia-status-track" aria-hidden="true"><span></span></div>' : ''}
            ${state.isGeneratingThisDream && state.draftCandidates.length ? `<div class="theater-dream-progress-pane" data-dream-progress-pane="candidate" hidden><div class="theater-dream-progress-candidate"><iframe id="theater-dream-progress-candidate-frame" sandbox="" title="已保留的第 ${state.draftCandidates[state.selectedCandidateIndex]?.versionNumber || state.selectedCandidateIndex + 1} 版"></iframe><div id="theater-dream-progress-candidate-fallback" hidden></div></div><div class="theater-dream-progress-candidate-note"><p>生成期间旧版安全保留；未保留候选仅留最新三版，已保留版本不被替换。</p><button type="button" id="theater-dream-progress-candidate-fullscreen" class="theater-dream-icon-button"><i class="fa-solid fa-expand" aria-hidden="true"></i><span>全屏阅读</span></button></div></div>` : ''}
            <div class="theater-dream-progress-pane active" data-dream-progress-pane="live">
                <p class="theater-dream-generation-context" title="${state.isGeneratingThisDream ? '这里显示当前版本的实时正文；目标字数只是参考，不代表模型的精确完成百分比。' : '已注入定梦基础包、最近两章全文、旧章索引与当前完整草稿。'}">${state.isGeneratingThisDream ? '实时正文' : '可恢复草稿'}</p>
                <pre id="theater-dream-generation-text">${runtime.esc(state.draftText || (state.isGeneratingThisDream ? '请求正在准备中，首字返回后会在这里出现……' : '已保存本章方向，尚未生成正文。'))}</pre>
            </div>
            ${state.isGeneratingThisDream ? `<footer class="theater-dream-progress-footer">
                ${state.draftCandidates.length ? `<div class="theater-dream-progress-switch" role="tablist" aria-label="切换已有版本与实时草稿"><button type="button" data-dream-progress-view="candidate" role="tab" aria-selected="false">第 ${state.draftCandidates[state.selectedCandidateIndex]?.versionNumber || state.selectedCandidateIndex + 1} 版</button><button type="button" data-dream-progress-view="live" role="tab" aria-selected="true" class="active">实时草稿</button></div>` : '<span></span>'}
                <button type="button" id="theater-dream-stop-generation" class="theater-dream-progress-stop"><i class="fa-solid fa-stop" aria-hidden="true"></i><span>停止生成</span></button>
            </footer>` : ''}
        </section>
        <section class="ui-card theater-dream-latest">
            <div class="ui-title"><span><i class="fa-solid fa-clock-rotate-left"></i> 上次写到 · ${runtime.esc(state.latest?.title || '第一章')}</span><button type="button" id="theater-dream-read-latest" class="theater-dream-icon-button" data-dream-read-chapter data-chapter-id="${runtime.esc(state.latest?.id || '')}" aria-label="阅读本章"><i class="fa-solid fa-book-open"></i></button></div>
            <p>${runtime.esc(longDreamExcerpt(state.chapterText, 230))}</p>
        </section>
    </div>`;
    const reviewFlow = state.hasReviewDraft ? `<div class="ia-flow-state active theater-dream-review-state"><section class="review-wrapper theater-dream-review" data-dream-continuation-stage="review">
        <div class="review-head theater-dream-review-head">
            <div class="review-title-area theater-dream-review-copy"><span>待确认新章</span><h3>${runtime.esc(state.draft.title || `第 ${state.nextNumber} 章`)}</h3></div>
            <div class="theater-dream-review-tools"><div class="candidate-switcher theater-dream-candidate-switcher" aria-label="切换待确认候选版本"><button type="button" data-dream-candidate-step="-1" aria-label="上一版" ${state.selectedCandidateIndex <= 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><strong aria-live="polite">${state.selectedCandidateIndex + 1}/${state.draftCandidates.length}</strong><button type="button" data-dream-candidate-step="1" aria-label="下一版" ${state.selectedCandidateIndex >= state.draftCandidates.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div><button type="button" id="theater-dream-review-fullscreen" class="theater-dream-review-fullscreen" title="全屏阅读当前候选" aria-label="全屏阅读当前候选"><i class="fa-solid fa-expand"></i></button></div>
            <p class="theater-dream-review-count">第 ${state.draftCandidates[state.selectedCandidateIndex]?.versionNumber || state.selectedCandidateIndex + 1} 版 · 正文约 ${readableCharCount(state.draft.text || '')} 字</p>
        </div>
        <div class="review-canvas theater-dream-review-canvas"><iframe id="theater-dream-review-frame" sandbox="" title="待确认长梦章节"></iframe><div id="theater-dream-review-fallback" class="theater-dream-review-fallback" hidden></div></div>
        <div class="theater-dream-review-choice"><div class="theater-dream-review-actions"><button type="button" id="theater-dream-keep-candidate" class="ui-btn ui-btn-sm" aria-pressed="${state.draftCandidates[state.selectedCandidateIndex]?.retained === true}"><i class="fa-${state.draftCandidates[state.selectedCandidateIndex]?.retained ? 'solid' : 'regular'} fa-heart"></i><span>${state.draftCandidates[state.selectedCandidateIndex]?.retained ? '已保留' : '保留这版'}</span></button><button type="button" id="theater-dream-confirm-chapter" class="ui-btn ui-btn-sm ui-btn-primary"><i class="fa-solid fa-check"></i><span>用这版继续</span></button></div>
        <p class="theater-dream-retention-note">其他已保留版本也会收入本章，可随时回看。</p>
        ${longDreamKeptVersionsHTML(dream)}</div>
        <div class="theater-dream-candidate-actions">
        <button type="button" id="theater-dream-regenerate-draft" class="ui-btn ui-btn-sm theater-dream-regenerate" title="按原要求再生成一版；成功后未保留候选仅留最新三版，已保留版本不被替换"><i class="fa-solid fa-plus"></i><span>再来一版</span></button>
        <button type="button" id="theater-dream-revise-draft" class="ui-btn ui-btn-sm theater-dream-regenerate" title="修改要求再生成；成功后未保留候选仅留最新三版，已保留版本不被替换"><i class="fa-solid fa-pen-to-square"></i><span>改要求重写</span></button>
        </div>
    </section></div>` : '';
    return `<div class="theater-dream-detail theater-dream-continuation" data-id="${runtime.esc(dream.id)}">
        ${writeFlow}${reviewFlow}
        <section class="theater-dream-memory-workspace" data-dream-continuation-bottom="memory"><div class="theater-dream-memory-workspace-body"><section class="theater-dream-memory-status ${dream.memory?.status === LONG_DREAM_MEMORY_STATUS.FAILED ? 'is-failed' : ''}"><div class="theater-dream-memory-status-copy"><span><i class="fa-solid fa-route"></i> 梦脉织录</span><b>${runtime.esc(longDreamMemoryStatusText(dream))}</b><small>只处理已确认章节；使用独立副 API，不影响正文线路。</small></div><button type="button" id="theater-dream-weave-now" class="ui-btn ui-btn-sm" ${dream.memory?.status === LONG_DREAM_MEMORY_STATUS.WEAVING || !(dream.memory?.pendingChapterNumbers?.length) ? 'disabled' : ''}><i class="fa-solid fa-wand-magic-sparkles"></i><span>立即织录</span></button></section>${longDreamMemoryCardsHTML(dream)}</div></section>
    </div>`;
}
// @theater-source-end longDreamDetailHTML

// @theater-source-begin longDreamKeptVersionsHTML
function longDreamKeptVersionsHTML(dream, chapter = null) {
    const candidates = chapter ? [chapter, ...(chapter.retainedVersions || [])] : (dream.draft?.candidates || []);
    const rows = candidates.map((item, index) => ({ item, index })).filter(({ item }) => chapter || item.retained);
    if (chapter && candidates.length < 2) return '';
    return `<section class="theater-dream-kept-versions"><h4>${chapter ? '本章版本' : '已保留的版本'}${chapter ? '' : `<small>${rows.length} 版</small>`}</h4>
        ${rows.length ? rows.map(({ item, index }) => `<div class="theater-dream-kept-row"><span>第 ${item.versionNumber || index + 1} 版${chapter && index === 0 ? ' · 续写采用' : ''}${!chapter && index === dream.draft.selectedCandidateIndex ? '<small class="theater-dream-kept-current">当前查看</small>' : ''}</span>
            <button type="button" class="ui-btn ui-btn-sm" ${chapter ? `data-dream-retained-read="${index}"` : `data-dream-kept-pick="${index}"`}>阅读</button>
            ${chapter ? `<button type="button" class="ui-btn ui-btn-sm" data-dream-retained-export="${index}">导出</button>` : ''}</div>`).join('') : '<p class="theater-dream-retention-note">读到喜欢的版本时，点一下「保留这版」。</p>'}
        ${chapter ? '<p class="theater-dream-retention-note">阅读其他版本不会改变后续剧情和梦脉。</p>' : ''}</section>`;
}
// @theater-source-end longDreamKeptVersionsHTML

// @theater-source-begin longDreamChapterDirectoryHTML
function longDreamChapterDirectoryHTML(dream) {
    return dream.chapters.map(chapter => {
        const text = chapter.text || runtime.htmlToPlainText(chapter.html || '');
        return `<div class="ia-chapter-row theater-dream-chapter-row"><div class="ia-chapter-copy"><div class="ia-line-title">第 ${chapter.number} 章 · ${runtime.esc(chapter.title || `第 ${chapter.number} 章`)}</div><div class="ia-line-sub">${readableCharCount(text)} 字 · ${runtime.esc(longDreamDate(chapter.createdAt))}</div></div><button type="button" class="ui-btn ui-btn-sm theater-dream-chapter-open ${chapter.number === dream.chapters.length ? 'ui-btn-primary' : ''}" data-dream-open-chapter data-chapter-id="${runtime.esc(chapter.id)}" aria-label="查看第 ${chapter.number} 章"><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>查看</span></button></div>`;
    }).join('');
}
// @theater-source-end longDreamChapterDirectoryHTML

// @theater-source-begin longDreamWorkDetailHTML
function longDreamWorkDetailHTML(dream) {
    const state = longDreamDetailState(dream);
    return `<div class="ia-works-level active theater-dream-detail theater-dream-work-detail" data-id="${runtime.esc(dream.id)}" data-works-level="work">
        <button type="button" class="ia-back theater-dream-back" data-dream-work-back><i class="fa-solid fa-arrow-left"></i><span>返回作品</span></button>
        ${longDreamDetailHeaderHTML(dream)}
        <section class="ui-card theater-dream-chapter-directory is-workspace">
            <div class="ui-title"><span>章节目录 · ${dream.chapters.length} 章</span><button type="button" id="theater-dream-export-current" class="ui-btn ui-btn-sm"><i class="fa-solid fa-file-export"></i> 整本导出</button></div>
            <div class="theater-dream-chapter-list">${longDreamChapterDirectoryHTML(dream)}</div>
        </section>
        <section class="ui-card theater-dream-action-card theater-dream-work-menu">
            <div class="theater-dream-action-heading"><span class="theater-dream-action-icon"><i class="fa-solid fa-sliders"></i></span><span><b>作品菜单</b><small>管理整部作品；导入备份会新建副本，不会覆盖当前作品</small></span></div>
            <div class="theater-dream-work-menu-actions">
                <button type="button" id="theater-dream-import-backup" class="theater-dream-fat-btn is-secondary"><i class="fa-solid fa-upload"></i><span>导入 / 恢复</span></button>
                <button type="button" id="${dream.status === 'complete' ? 'theater-dream-reopen' : 'theater-dream-complete'}" class="theater-dream-fat-btn is-primary" ${state.statusControlDisabled ? 'disabled' : ''}><i class="fa-solid ${dream.status === 'complete' ? 'fa-feather-pointed' : 'fa-book-bookmark'}"></i><span>${dream.status === 'complete' ? '重新打开作品' : '标记完结'}</span></button>
                <button type="button" id="theater-dream-delete" class="theater-dream-fat-btn is-danger is-wide" ${state.isGeneratingThisDream || state.hasReviewDraft ? 'disabled' : ''}><i class="fa-solid fa-trash"></i><span>删除作品</span></button>
            </div>
        </section>
    </div>`;
}
// @theater-source-end longDreamWorkDetailHTML

// @theater-source-begin longDreamChapterDetailHTML
function longDreamChapterDetailHTML(dream, chapter) {
    const text = chapter?.text || runtime.htmlToPlainText(chapter?.html || '');
    const locked = !!runtime.longDreamGenerationController?.active || !!runtime.longDreamChapterEditController || !!dream.draft;
    const laterCount = Math.max(0, dream.chapters.length - chapter.number);
    const toolsHidden = window.matchMedia?.('(max-width: 520px)').matches ? ' hidden' : '';
    return `<div class="ia-works-level active theater-dream-detail theater-dream-chapter-detail" data-id="${runtime.esc(dream.id)}" data-chapter-id="${runtime.esc(chapter.id)}" data-works-level="chapter">
        <button type="button" class="ia-back theater-dream-back" data-dream-chapter-back><i class="fa-solid fa-arrow-left"></i><span>返回章节目录</span></button>
        <section class="ui-card theater-dream-chapter-editor">
            <div class="ui-title theater-dream-chapter-heading"><span>第 ${chapter.number} 章 · ${runtime.esc(chapter.title)}</span><span class="theater-dream-chapter-heading-tools"><span class="memory-v2-tag">已保存</span><button type="button" id="theater-dream-chapter-tools-toggle" class="theater-dream-options-trigger theater-dream-chapter-tools-toggle" aria-expanded="${toolsHidden ? 'false' : 'true'}" aria-controls="theater-dream-chapter-tools-panel" aria-label="展开章节工具" title="章节工具"><i class="fa-solid fa-sliders"></i></button></span></div>
            <div id="theater-dream-chapter-tools-panel" class="ia-action-row theater-dream-chapter-editor-actions" role="menu" aria-label="章节工具"${toolsHidden}>
                <button type="button" id="theater-dream-save-chapter" class="ui-btn ui-btn-sm ui-btn-primary" role="menuitem" ${locked ? 'disabled' : ''}><i class="fa-solid fa-check"></i><span>保存编辑</span></button>
                <button type="button" id="theater-dream-export-chapter" class="ui-btn ui-btn-sm" role="menuitem"><i class="fa-solid fa-file-export"></i><span>单章导出</span></button>
                <button type="button" id="theater-dream-read-chapter-fullscreen" class="ui-btn ui-btn-sm" role="menuitem"><i class="fa-solid fa-book-open"></i><span>阅读原排版</span></button>
            </div>
            <label class="ia-field"><span>章节标题</span><input id="theater-dream-chapter-edit-title" class="ui-input theater-input" maxlength="80" value="${runtime.esc(chapter.title)}" ${locked ? 'disabled' : ''}></label>
            <label class="ia-field"><span>章节正文</span><textarea id="theater-dream-chapter-edit-text" class="ui-textarea ia-reader theater-textarea" rows="16" ${locked ? 'disabled' : ''}>${runtime.esc(text)}</textarea></label>
            <div id="theater-dream-chapter-edit-status" class="theater-hint">${locked ? '请先处理当前生成或草稿，再编辑正式章节。' : '仅改标题会保留原始 HTML；修改正文时会重新生成阅读排版。'}</div>
        </section>
        ${longDreamKeptVersionsHTML(dream, chapter)}
        <section class="ui-card theater-dream-action-card theater-dream-chapter-operations">
            <div class="theater-dream-action-heading"><span class="theater-dream-action-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span><span><b>章节操作</b><small>从当前章节创建支线，或管理这一章之后的内容</small></span></div>
            <div class="theater-dream-chapter-actions" aria-label="第 ${chapter.number} 章管理">
                ${chapter.number > 1 ? `<button type="button" class="theater-dream-fat-btn is-outline" data-dream-chapter-action="rewrite" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-pen-to-square"></i><span>重写本章</span></button>` : ''}
                <button type="button" class="theater-dream-fat-btn is-primary" data-dream-chapter-action="branch" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-code-branch"></i><span>从此处分支</span></button>
                ${laterCount ? `<button type="button" class="theater-dream-fat-btn is-outline" data-dream-chapter-action="rollback" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-clock-rotate-left"></i><span>回滚上一版</span></button>` : ''}
                ${chapter.number > 1 ? `<button type="button" class="theater-dream-fat-btn is-outline-danger" data-dream-chapter-action="delete-from" data-chapter-id="${runtime.esc(chapter.id)}"><i class="fa-solid fa-trash-can"></i><span>删除本章</span></button>` : ''}
            </div>
        </section>
    </div>`;
}
// @theater-source-end longDreamChapterDetailHTML

// @theater-source-begin longDreamUnavailableHTML
function longDreamUnavailableHTML(section) {
    const labels = { definition: '定梦', continue: '续写' };
    return `<div class="theater-dream-empty theater-dream-workspace-empty">
        <i class="fa-regular fa-moon"></i>
        <b>还没有可进入“${labels[section] || '长梦'}”的作品</b>
        <span>先在“作品”中开启一场长梦，再回来继续。</span>
        <button type="button" class="theater-btn primary" data-dream-section="works">前往作品</button>
    </div>`;
}
// @theater-source-end longDreamUnavailableHTML

// @theater-source-begin longDreamPanelHTML
function longDreamPanelHTML() {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    let content = '';

    if (runtime.longDreamWorkspaceSection === 'definition') {
        if (runtime.longDreamView === 'create' || !dream) {
            runtime.longDreamView = 'create';
            content = longDreamCreateHTML();
        } else {
            runtime.longDreamView = 'detail';
            content = longDreamDefinitionHTML(dream);
        }
    } else if (runtime.longDreamWorkspaceSection === 'continue') {
        if (dream) {
            runtime.longDreamView = 'detail';
            content = longDreamDetailHTML(dream);
        } else {
            runtime.longDreamView = 'list';
            content = longDreamUnavailableHTML('continue');
        }
    } else {
        runtime.longDreamWorkspaceSection = 'works';
        if (runtime.longDreamWorkLevel === 'chapter' && dream) {
            const chapter = dream.chapters?.find(item => String(item.id) === String(runtime.activeLongDreamChapterId));
            if (chapter) content = longDreamChapterDetailHTML(dream, chapter);
            else {
                runtime.longDreamWorkLevel = 'detail';
                runtime.activeLongDreamChapterId = null;
                content = longDreamWorkDetailHTML(dream);
            }
        } else if (runtime.longDreamWorkLevel === 'detail' && dream) {
            content = longDreamWorkDetailHTML(dream);
        } else {
            runtime.longDreamView = 'list';
            runtime.longDreamWorkLevel = 'list';
            runtime.activeLongDreamChapterId = null;
            content = longDreamListHTML();
        }
    }

    return longDreamWorkspaceHTML(content, runtime.longDreamWorkspaceSection);
}
// @theater-source-end longDreamPanelHTML

// @theater-source-begin syncLongDreamPanel
function syncLongDreamPanel({ renderDrafts = true } = {}) {
    const dream = runtime.longDreamCache.find(item => String(item.id) === String(runtime.activeLongDreamId));
    if (runtime.longDreamWorkspaceSection === 'definition' && dream) {
        const state = longDreamDetailState(dream);
        $('#theater-dream-refresh-world-book').prop('disabled', runtime.refreshingLongDreamWorldBooks || state.isGeneratingThisDream || state.hasReviewDraft)
            .attr('aria-busy', String(runtime.refreshingLongDreamWorldBooks)).find('span').text(runtime.refreshingLongDreamWorldBooks ? '更新中…' : '更新世界书');
        $('#theater-dream-frozen-count').text(`· ${state.snapshotEntries} 条`);
        $('#theater-dream-frozen-books').text(state.selectedPolicy ? `当前冻结资料库：${state.bookText}` : '当前完全隔离，不读取原世界书');
        $('#theater-dream-save-definition').prop('disabled', state.isGeneratingThisDream || state.hasReviewDraft || String(runtime.refreshingLongDreamWorldBookId) === String(dream.id));
    }
    if (runtime.longDreamWorkspaceSection === 'continue' && dream) {
        if (renderDrafts) {
            renderLongDreamReviewDraft(dream);
            renderLongDreamProgressCandidate(dream);
        }
        syncLongDreamProgressDisplay();
        runtime.scheduleLongDreamTokenEstimate();
    }
}
// @theater-source-end syncLongDreamPanel

// @theater-source-begin renderLongDreamPanel
function renderLongDreamPanel() {
    const $root = $('#theater-long-dream-root');
    if (!$root.length) return;
    $root.html(longDreamPanelHTML());
    syncLongDreamPanel();
}
// @theater-source-end renderLongDreamPanel

// @theater-source-begin renderLongDreamProgressCandidate
function renderLongDreamProgressCandidate(dream) {
    const frame = document.getElementById('theater-dream-progress-candidate-frame');
    if (!frame) return;
    const candidates = Array.isArray(dream?.draft?.candidates) ? dream.draft.candidates : [];
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(Number(dream?.draft?.selectedCandidateIndex) || 0)));
    const candidate = candidates[index];
    if (!candidate) return;
    const fallback = document.getElementById('theater-dream-progress-candidate-fallback');
    renderSafeIframe(frame, candidate.html, {
        sourceHasText: !!candidate.text,
        fallbackOnNoReport: false,
        onBlank: candidate.text ? () => {
            $(frame).hide();
            $(fallback).text(candidate.text).prop('hidden', false);
        } : null,
    });
}
// @theater-source-end renderLongDreamProgressCandidate

// @theater-source-begin stopLongDreamProgressTicker
function stopLongDreamProgressTicker() {
    if (runtime.longDreamProgressTicker) clearInterval(runtime.longDreamProgressTicker);
    runtime.longDreamProgressTicker = null;
}
// @theater-source-end stopLongDreamProgressTicker

// @theater-source-begin syncLongDreamProgressDisplay
function syncLongDreamProgressDisplay() {
    const progress = runtime.longDreamGenerationController?.active;
    const status = document.getElementById('theater-dream-generation-status');
    if (!progress || !status || String(runtime.activeLongDreamGenerationId) !== String(runtime.activeLongDreamId)) {
        stopLongDreamProgressTicker();
        return;
    }
    $('#theater-dream-generation-version').text(progress.candidateNumber > LONG_DREAM_MAX_CANDIDATES ? '新版本' : `第 ${progress.candidateNumber || 1} 版`);
    $('#theater-dream-generation-kicker').text(longDreamProgressKickerText(progress));
    $('#theater-dream-generation-label').text(longDreamProgressLabelText(progress));
    $('#theater-dream-progress-elapsed').text(`已等待 ${formatLongDreamElapsed(progress.startedAt)}`);
    $('#theater-dream-progress-chars').text(`约 ${Math.max(0, Number(progress.currentChars) || readableCharCount(runtime.longDreamLiveDraftText)).toLocaleString()} / ${Math.max(500, Number(progress.targetChars) || 3000).toLocaleString()} 字`);
    $('#theater-dream-progress-round').text(progress.stage === LONG_DREAM_GENERATION_STAGE.RENDERING
        ? '最终排版'
        : (Number(progress.maxRounds) > 1 ? `第 ${Math.max(1, Number(progress.round) || 1)} / ${progress.maxRounds} 轮` : '正文生成'));
    if (!runtime.longDreamProgressTicker) {
        runtime.longDreamProgressTicker = setInterval(() => {
            if (!document.getElementById('theater-dream-generation-status')) {
                stopLongDreamProgressTicker();
                return;
            }
            syncLongDreamProgressDisplay();
        }, 1000);
    }
}
// @theater-source-end syncLongDreamProgressDisplay

// @theater-source-begin renderLongDreamReviewDraft
function renderLongDreamReviewDraft(dream) {
    const draft = dream?.draft;
    if (draft?.status !== LONG_DREAM_DRAFT_STATUS.REVIEW || !draft.html) return;
    const frame = document.getElementById('theater-dream-review-frame');
    if (!frame) return;
    const $fallback = $('#theater-dream-review-fallback');
    renderSafeIframe(frame, draft.html, {
        sourceHasText: !!draft.text,
        fallbackOnNoReport: false,
        onBlank: draft.text ? () => {
            $(frame).hide();
            $fallback.text(draft.text).prop('hidden', false);
        } : null,
    });
}
// @theater-source-end renderLongDreamReviewDraft

return { historyItemHTML, historyTagBadgesHTML, longDreamSources, resolveLongDreamSource, longDreamDate, longDreamExcerpt, longDreamSourceInstructionState, longDreamSourcePreviewHTML, resetLongDreamCanonSuggestions, activeLongDreamCanonSuggestions, longDreamCanonSuggestionCardsHTML, longDreamCanonSuggestionHTML, renderLongDreamCanonSuggestions, findLongDreamCanonSuggestion, captureCurrentLongDreamWorldBooks, longDreamSnapshotEntryCount, longDreamBackupFileName, exportLongDreamZip, chooseExportFormat, exportLongDreamBackup, requestLongDreamExport, readLongDreamZip, importedLongDreamTitle, importLongDreamBackup, readLongDreamChapter, longDreamChapterFileName, exportLongDreamChapter, saveLongDreamChapterEdits, setCurrentLongDreamStatus, longDreamListHTML, longDreamRelationLabel, longDreamRelationChoicesHTML, longDreamSourceWorldBooks, sameWorldBookSelection, longDreamCreateWorldBookStateHTML, refreshLongDreamCreateWorldBookState, longDreamCreateHTML, longDreamGenerationStageText, formatLongDreamElapsed, longDreamProgressStageText, longDreamProgressLabelText, longDreamProgressKickerText, longDreamProgressMetaHTML, selectedLongDreamMemoryApiPreset, longDreamMemoryAnalysisPresets, selectedLongDreamMemoryAnalysisPreset, refreshLongDreamMemoryPresetControls, longDreamMemoryStatusText, longDreamActiveMemoryCount, longDreamSummaryHistoryHTML, toggleLongDreamSummaryPreview, longDreamMemoryConflictTarget, longDreamMemoryConflictSubjects, longDreamMemoryConflictItemText, longDreamMemoryConflictOperationText, longDreamMemoryConflictDetails, longDreamMemoryCardsHTML, longDreamMemorySelectionHTML, refreshLongDreamMemorySelection, longDreamMemoryTags, longDreamMemoryV2Fields, uniqueLongDreamBranchTitle, handleLongDreamChapterAction, longDreamWorkspaceHTML, longDreamDetailState, longDreamDetailHeaderHTML, refreshLongDreamWorldBookSources, longDreamDefinitionHTML, longDreamDetailHTML, longDreamKeptVersionsHTML, longDreamChapterDirectoryHTML, longDreamWorkDetailHTML, longDreamChapterDetailHTML, longDreamUnavailableHTML, longDreamPanelHTML, syncLongDreamPanel, renderLongDreamPanel, renderLongDreamProgressCandidate, stopLongDreamProgressTicker, syncLongDreamProgressDisplay, renderLongDreamReviewDraft };
}
