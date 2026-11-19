// 长梦工作区·梦脉与章节操作：梦脉预设与状态、概要历史、冲突说明、梦脉卡片、分支命名、章节操作。
// 从 long-dream-workspace.js 拆出；由 createLongDreamWorkspace 组装，不单独使用。
import { summaryEditorHTML } from './long-dream-summary-editor.js';
import { LONG_DREAM_MEMORY_STATUS, LONG_DREAM_MEMORY_TYPES, createLongDreamBranch, truncateLongDreamAfter, deleteLongDreamFrom } from './long-dream.js';
import { normalizeApiPresetList } from './api-presets.js';
import { normalizeLongDreamMemoryPresetList } from './long-dream-memory-presets.js';
import { summaryUnavailableReason } from './long-dream-summary-ui.js';
import { condenseSummaryPlan, CONDENSE_KEEP_RECENT_CHAPTERS } from './long-dream-story-summary.js';
import { selectRelevantLongDreamMemoryItems, LONG_DREAM_RECENT_CHAPTER_COUNT, selectRelevantLongDreamMemoryCards } from './long-dream-payload.js';

export function createLongDreamMemoryView(runtime, ws) {
// 其他部分的函数：调用时转给 ws（组装完成后才会被调用）。
const longDreamDate = (...args) => ws.longDreamDate(...args);
const longDreamExcerpt = (...args) => ws.longDreamExcerpt(...args);
const renderLongDreamPanel = (...args) => ws.renderLongDreamPanel(...args);
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
    if ((runtime.settings.longDreamSeriesPausedIds || []).includes(String(dream.id))) return `已织录 ${memory.processedThroughChapter || 0}/${dream.chapters.length} 章 · ${memory.status === LONG_DREAM_MEMORY_STATUS.WEAVING ? '当前批次完成后停止' : '已停止'}`;
    if (dream.seriesMemoryAutoWeave === false) return `已织录 ${memory.processedThroughChapter || 0}/${dream.chapters.length} 章 · 暂停自动整理`;
    if (!selectedLongDreamMemoryApiPreset()) return `${pending || dream?.chapters?.length || 0} 章待织录 · 尚未绑定副 API`;
    if (dream.source?.kind === 'history-folder' && runtime.refreshingLongDreamSummaries.has(String(dream.id))) return `已织录 ${memory.processedThroughChapter || 0}/${dream.chapters.length} 章 · 正在分批补齐概要`;
    if (dream.source?.kind === 'history-folder' && memory.status === LONG_DREAM_MEMORY_STATUS.WEAVING) return `已织录 ${memory.processedThroughChapter || 0}/${dream.chapters.length} 章 · 正在分批整理`;
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
    if (!original && conflict?.reason === 'rejected-by-user') original = '这条内容曾被你删除，并选了“以后别再记”。';
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
        'rejected-by-user': '新章节又写到了你选过“以后别再记”的内容',
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
                    <details class="theater-dream-memory-editor-more"><summary>更多操作</summary><div>${item.lockedByUser ? `<button type="button" data-dream-memory-v2-action="unlock" ${memoryLocked ? 'disabled' : ''}>交还自动更新</button>` : ''}<button type="button" data-dream-memory-v2-action="${item.hiddenFromPrompt ? 'show' : 'hide'}" ${memoryLocked ? 'disabled' : ''}>${item.hiddenFromPrompt ? '恢复参与续写' : '暂不参与续写'}</button><button type="button" class="is-danger" data-dream-memory-v2-action="reject" ${memoryLocked ? 'disabled' : ''}>删除，并且以后别再记</button></div></details>
                    <div class="theater-dream-memory-editor-main-actions"><button type="button" class="theater-dream-memory-editor-delete" data-dream-memory-v2-action="delete" ${memoryLocked ? 'disabled' : ''}><i class="fa-solid fa-trash-can"></i><span>删除</span></button><button type="button" class="theater-dream-memory-editor-save" data-dream-memory-v2-action="save" ${memoryLocked ? 'disabled' : ''}><i class="fa-solid fa-check"></i><span>保存修改</span></button></div>
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
            <div class="theater-dream-summary-actions"><button type="button" data-dream-summary-edit ${summaryUnavailableReason(dream, runtime.refreshingLongDreamSummaries.has(String(dream.id))) ? 'disabled' : ''}>编辑概要</button><button type="button" data-dream-summary-refresh aria-busy="${runtime.refreshingLongDreamSummaries.has(String(dream.id))}" ${runtime.refreshingLongDreamSummaries.has(String(dream.id)) || memoryLocked || conflicts.length || memory.pendingChapterNumbers?.length ? 'disabled' : ''}>${runtime.refreshingLongDreamSummaries.has(String(dream.id)) ? '正在更新…' : '更新概要'}</button>${condenseButtonHTML(runtime, dream)}</div>
            <div data-dream-summary-editor-mount>${summaryEditorHTML(runtime, dream)}</div>
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
        const latest = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        if (!latest || String(runtime.activeLongDreamId) !== String(dream.id) || latest.draft
            || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController
            || JSON.stringify(latest.chapters) !== JSON.stringify(dream.chapters)) {
            toastr.info('长梦章节已变化，请重新确认');
            return;
        }
        const saved = await runtime.longDreamPut(truncateLongDreamAfter(latest, chapter.id));
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
        const latest = runtime.longDreamCache.find(item => String(item.id) === String(dream.id));
        if (!latest || String(runtime.activeLongDreamId) !== String(dream.id) || latest.draft
            || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController
            || JSON.stringify(latest.chapters) !== JSON.stringify(dream.chapters)) {
            toastr.info('长梦章节已变化，请重新确认');
            return;
        }
        const saved = await runtime.longDreamPut(deleteLongDreamFrom(latest, chapter.id));
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

return { selectedLongDreamMemoryApiPreset, longDreamMemoryAnalysisPresets, selectedLongDreamMemoryAnalysisPreset, refreshLongDreamMemoryPresetControls, longDreamMemoryStatusText, longDreamActiveMemoryCount, longDreamSummaryHistoryHTML, toggleLongDreamSummaryPreview, longDreamMemoryConflictTarget, longDreamMemoryConflictSubjects, longDreamMemoryConflictItemText, longDreamMemoryConflictOperationText, longDreamMemoryConflictDetails, longDreamMemoryCardsHTML, longDreamMemorySelectionHTML, refreshLongDreamMemorySelection, longDreamMemoryTags, longDreamMemoryV2Fields, uniqueLongDreamBranchTitle, handleLongDreamChapterAction };
}

function condenseButtonHTML(runtime, dream) {
    const busy = runtime.refreshingLongDreamSummaries.has(String(dream.id));
    const reason = summaryUnavailableReason(dream, busy) || condenseSummaryPlan(dream).reason || '';
    const hint = reason || `把较早章节的概要压成一段，最近 ${CONDENSE_KEEP_RECENT_CHAPTERS} 章保留逐章；旧版可在“最近版本”恢复`;
    return `<button type="button" data-dream-summary-condense ${reason ? 'disabled' : ''} title="${runtime.esc(hint)}">精简概要</button>`;
}
