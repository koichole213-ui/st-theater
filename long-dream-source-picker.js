const states = new WeakMap();
function state(runtime) { return states.get(runtime); }
export function resetLongDreamSourcePicker(runtime) { states.delete(runtime); }
function dateText(source) {
    const date = new Date(source.date || '');
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN');
}
export function sourcePickerHTML(runtime, sources) {
    const folders = sources.filter(source => source.kind === 'history-folder');
    const singles = sources.filter(source => source.kind === 'history');
    const first = folders[0] || sources[0];
    states.set(runtime, { sources, key: first?.key || '', tab: folders.length ? 'folder' : 'single', query: '', page: 0, sort: 'recent' });
    const quick = [sources.find(s => s.kind === 'current'), sources.find(s => s.kind === 'recent')].filter(Boolean);
    return `<div class="theater-source-picker"><input type="hidden" id="theater-dream-source" value="${runtime.esc(first?.key || '')}">
        <div class="theater-source-library">
            <div class="theater-source-quick">${quick.map(s => `<button type="button" class="ui-btn" data-source-pick="${runtime.esc(s.key)}"><span aria-hidden="true">${s.kind === 'current' ? '↗' : '◷'}</span>${s.kind === 'current' ? '正在查看的剧场' : '最近生成'}</button>`).join('')}</div>
            <div class="theater-source-tabs" role="group" aria-label="来源分类">${[['folder', `文件夹 · ${folders.length}`], ['single', `单篇 · ${singles.length}`]].map(([tab, label]) => `<button type="button" class="ui-btn" data-source-tab="${tab}" aria-pressed="${state(runtime).tab === tab}">${label}</button>`).join('')}</div>
            <div class="theater-source-tools">
                <input type="search" class="ui-input" id="theater-source-search" placeholder="搜索标题或正文…" aria-label="搜索标题或正文">
                <select id="theater-source-sort" aria-label="排列顺序" class="ui-select theater-select" data-select2-id="${runtime.esc(runtime.theaterNativeSelectCompatId?.() || 'long-dream-source-sort')}"><option value="recent">最近保存优先</option><option value="old">最早保存优先</option></select>
            </div>
            <div id="theater-source-results">${sourcePickerResults(runtime)}</div>
        </div>
        <aside class="theater-source-selected" id="theater-source-selected" aria-label="已选作品" aria-live="polite">${sourcePickerSelected(runtime)}</aside></div>`;
}
export function sourcePickerResults(runtime) {
    const s = state(runtime); if (!s) return '';
    const q = s.query.trim().toLocaleLowerCase();
    const results = s.sources.filter(x => x.kind === (s.tab === 'folder' ? 'history-folder' : 'history'))
        .filter(x => !q || `${x.title}\n${x.searchText || x.text || ''}`.toLocaleLowerCase().includes(q));
    // Sources are already newest-first; sort changes browsing only, never chapters.
    results.sort((a, b) => s.sort === 'old' ? (a.order || 0) - (b.order || 0) : (b.order || 0) - (a.order || 0));
    const pages = Math.max(1, Math.ceil(results.length / 5)); s.page = Math.max(0, Math.min(s.page, pages - 1));
    const html = results.slice(s.page * 5, s.page * 5 + 5).map(x => {
        const text = x.searchText || x.text || '', hit = q ? text.toLocaleLowerCase().indexOf(q) : -1;
        const fragment = hit >= 0 ? text.slice(Math.max(0, hit - 15), hit + 65).replace(/\s+/g, ' ') : '';
        return `<button type="button" class="theater-source-item" data-source-pick="${runtime.esc(x.key)}" aria-pressed="${s.key === x.key}"><span class="theater-source-item-top"><span class="theater-source-title">${runtime.esc(x.title)}</span><span class="theater-source-kind">${x.chapters ? '文件夹' : '单篇'}</span></span><span class="theater-source-meta"><span>${runtime.esc(dateText(x))}</span>${x.chapters ? `<span class="theater-source-count-badge">${x.chapters.length}篇</span>` : ''}</span>${fragment ? `<span class="theater-source-fragment">${runtime.esc(fragment)}</span>` : ''}</button>`;
    }).join('');
    return `<div class="theater-source-result-count"><span>共 ${results.length} ${s.tab === 'folder' ? '个文件夹' : '篇剧场'}</span><span>每页 5 项</span></div><div class="theater-source-list">${html || '<p class="theater-hint">没有找到，试试更短的关键词。</p>'}</div><div class="theater-source-pagination"><button type="button" data-source-page="-1" ${s.page === 0 ? 'disabled' : ''}>上一页</button><span>${s.page + 1} / ${pages}</span><button type="button" data-source-page="1" ${s.page === pages - 1 ? 'disabled' : ''}>下一页</button></div>`;
}
export function sourcePickerSelected(runtime) {
    const s = state(runtime), x = s?.sources.find(x => x.key === s.key);
    if (!x) return '';
    const folder = Boolean(x.chapters);
    const meta = folder ? `${x.chapters.length} 章 · 按文件夹顺序导入` : x.kind === 'current' ? '正在查看的剧场 · 从此篇开始' : x.kind === 'recent' ? '最近生成 · 从此篇开始' : `${dateText(x)} · 从单篇开始`;
    return `<div class="theater-source-selected-top"><div><div class="theater-source-kicker">已选作品</div><h3 class="theater-source-selected-title">${runtime.esc(x.title)}</h3><div class="theater-source-selection-note">${runtime.esc(meta)}</div></div><span class="theater-source-check" aria-hidden="true">✓</span></div>${folder ? `<details class="theater-source-chapters" open><summary>章节顺序 <span>· ${x.chapters.length} 章</span></summary><ol>${x.chapters.map(c => `<li>${runtime.esc(c.title || '未命名剧场')}</li>`).join('')}</ol></details><label class="theater-source-consent"><input type="checkbox" id="theater-source-auto-weave" ${runtime.settings.longDreamSeriesAutoWeave === true ? 'checked' : ''}><span><strong>生成梦脉与概要</strong><span class="theater-source-consent-description">需要调用副 API 整理章节记忆。首次默认关闭，之后记住你的选择；不勾选时只复制历史内容，不会发起整理请求。</span></span></label><p class="theater-source-status-note">章节会按原文件夹内部顺序导入，并保留原始历史与 HTML。这里的列表排序只影响查找，不会改变章节顺序。</p>` : `<p class="theater-source-status-note">将以这篇作品作为长梦的第一章，原始内容与历史会保留。</p>`}`;
}
export function pickerSelectedSource(runtime) { const s = state(runtime); return s?.sources.find(x => x.key === s.key) || null; }
export function bindSourcePicker($d, runtime) {
    const redraw = () => { $('#theater-source-results').html(sourcePickerResults(runtime)); $('.theater-source-tabs [data-source-tab]').each(function () { $(this).attr('aria-pressed', String($(this).attr('data-source-tab') === state(runtime)?.tab)); }); };
    $d.off('click.tdsourcepick').on('click.tdsourcepick', '[data-source-pick]', function () {
        const s = state(runtime); if (!s) return;
        const key = $(this).attr('data-source-pick');
        if (!s.sources.some(x => x.key === key)) return;
        s.key = key; $('#theater-dream-source').val(key);
        $('#theater-source-selected').html(sourcePickerSelected(runtime)); redraw();
        $('#theater-dream-source').trigger('change');
    });
    $d.off('click.tdsourcetab').on('click.tdsourcetab', '[data-source-tab]', function () { const s = state(runtime); if (!s) return; s.tab = $(this).attr('data-source-tab'); s.page = 0; redraw(); });
    $d.off('input.tdsourcesearch').on('input.tdsourcesearch', '#theater-source-search', function () { const s = state(runtime); if (!s) return; s.query = $(this).val(); s.page = 0; redraw(); });
    $d.off('change.tdsourcesort').on('change.tdsourcesort', '#theater-source-sort', function () { const s = state(runtime); if (!s) return; s.sort = $(this).val(); s.page = 0; redraw(); });
    $d.off('click.tdsourcepage').on('click.tdsourcepage', '[data-source-page]', function () { const s = state(runtime); if (!s) return; s.page += Number($(this).attr('data-source-page')); redraw(); });
}
