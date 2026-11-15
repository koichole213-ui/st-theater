// 长梦工作区·列表与新建：长梦列表、新建页（来源、世界线关系、世界书）、生成进度文字。
// 从 long-dream-workspace.js 拆出；由 createLongDreamWorkspace 组装，不单独使用。
import { normalizeManualTarget } from './length-policy.js';
import { sourcePickerHTML } from './long-dream-source-picker.js';
import { latestLongDreamChapter, LONG_DREAM_WORLD_LINE_RELATION } from './long-dream.js';
import { LONG_DREAM_GENERATION_STAGE } from './long-dream-generation.js';
import { readableCharCount } from './text-counter.js';

export function createLongDreamCreatePage(runtime, ws) {
// 其他部分的函数：调用时转给 ws（组装完成后才会被调用）。
const longDreamSources = (...args) => ws.longDreamSources(...args);
const longDreamDate = (...args) => ws.longDreamDate(...args);
const longDreamExcerpt = (...args) => ws.longDreamExcerpt(...args);
const longDreamSourceInstructionState = (...args) => ws.longDreamSourceInstructionState(...args);
const longDreamActiveMemoryCount = (...args) => ws.longDreamActiveMemoryCount(...args);
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
            <div class="theater-dream-header-actions"><details class="theater-dream-backup-menu">
                <summary aria-label="备份与恢复" title="备份与恢复"><i class="fa-solid fa-box-archive" aria-hidden="true"></i></summary>
                <div class="theater-dream-backup-popover">        <section class="ui-card theater-dream-action-card theater-dream-library-tools">
            <div class="theater-dream-action-heading"><span class="theater-dream-action-icon"><i class="fa-solid fa-box-archive"></i></span><span><b>备份与恢复</b><small>导入可信备份，或导出全部长梦</small></span></div>
            <div class="theater-dream-library-action-grid">
                <button type="button" id="theater-dream-import-backup" class="theater-dream-fat-btn is-secondary"><i class="fa-solid fa-upload"></i><span>导入备份</span></button>
                <button type="button" id="theater-dream-export-all" class="theater-dream-fat-btn is-primary" ${dreams.length ? '' : 'disabled'}><i class="fa-solid fa-download"></i><span>导出全部</span></button>
            </div>
            <small class="theater-dream-archive-note">备份会保留章节原始 HTML，请只导入可信来源。</small>
        </section></div>
            </details>
            <button type="button" id="theater-dream-new" class="ui-btn ui-btn-sm ui-btn-primary"><i class="fa-solid fa-plus"></i><span>新建</span></button></div>
        </header>
        ${cards ? `<div class="theater-dream-list">${cards}</div>` : `<section class="ui-card theater-dream-empty"><div class="theater-dream-empty-icon">☾</div><b>还没有长梦</b><span>从定梦开始建立第一本作品。</span><button type="button" data-dream-new class="ui-btn ui-btn-primary">创建第一部长梦</button></section>`}

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
    const first = sources.find(s => s.kind === 'history') || sources.find(s => s.kind === 'current') || sources.find(s => s.kind === 'recent') || null;
    const selectedBooks = (runtime.settings.selectedWorldBooks || []).filter(Boolean);
    return `<div class="theater-dream-create">
        ${sources.length ? `<div class="theater-dream-form-grid">
            <section class="ui-card theater-dream-form-card">
                <div class="ui-title"><span><i class="fa-solid fa-book-open" aria-hidden="true"></i> 选择作品</span></div>
                ${sourcePickerHTML(runtime, sources)}
                <div id="theater-dream-source-preview" hidden></div>
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
    const targetChars = normalizeManualTarget(progress?.targetChars, normalizeManualTarget(fallbackTarget));
    const round = Math.max(0, Number(progress?.round) || 0);
    const maxRounds = Math.max(1, Number(progress?.maxRounds) || 1);
    return `<div class="theater-dream-progress-meta" aria-live="polite">
        <span id="theater-dream-progress-round">${progress?.stage === LONG_DREAM_GENERATION_STAGE.RENDERING ? '最终排版' : (maxRounds > 1 ? `第 ${Math.max(1, round)} / ${maxRounds} 轮` : '正文生成')}</span>
        <span id="theater-dream-progress-elapsed">已等待 ${runtime.esc(formatLongDreamElapsed(progress?.startedAt))}</span>
        <span id="theater-dream-progress-chars">约 ${currentChars.toLocaleString()} / ${targetChars.toLocaleString()} 字</span>
    </div>`;
}
// @theater-source-end longDreamProgressMetaHTML

return { longDreamListHTML, longDreamRelationLabel, longDreamRelationChoicesHTML, longDreamSourceWorldBooks, sameWorldBookSelection, longDreamCreateWorldBookStateHTML, refreshLongDreamCreateWorldBookState, longDreamCreateHTML, longDreamGenerationStageText, formatLongDreamElapsed, longDreamProgressStageText, longDreamProgressLabelText, longDreamProgressKickerText, longDreamProgressMetaHTML };
}
