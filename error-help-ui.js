import { diagnosticSignalInfo, diagnosticSignalCatalog } from './request-diagnostics.js';
import { isProviderMessageChinese } from './provider-message.js';

const sides = {
    far: '服务商 / 中转那边 · 不用改设置',
    net: '网络 / 连接',
    settings: '需要检查设置',
    content: '内容或篇幅',
    local: '本机保存 / 排版',
    unknown: '原因暂不明确',
};

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const stepsHTML = steps => '<ol>' + steps.map(step => '<li>' + esc(step) + '</li>').join('') + '</ol>';
const sideHTML = side => `<span class="teh-side teh-side-${side}">${sides[side]}</span>`;

function workStatus(issue, retained) {
    const connectionCheck = /连接测试|测试连接|获取模型|模型列表|排版\s*API\s*连接/.test(issue.stage || '');
    if (issue.contextNote) return ['kept', issue.contextNote];
    if (issue.signal === 'T-STORAGE-WRITE') return ['danger', '这次的内容还没存进浏览器，请先复制或导出。'];
    if (connectionCheck) return ['neutral', '这只是连接检查，不影响任何作品。'];
    if (issue.signal === 'T-RENDER-INVALID' || /排版/.test(issue.stage || '')) return ['kept', '正文已保留，只是排版没有完成。'];
    if (issue.retainedChars > 0) return ['kept', `已保留此前写好的 ${Number(issue.retainedChars).toLocaleString('zh-CN')} 字。`];
    if (retained || issue.retained) return ['kept', '此前写好的正文已保留。'];
    return ['neutral', '这次没有收到正文。已保存的作品不受影响。'];
}

function requestDetails(issue) {
    const mainMode = issue.mainMode === 'stream' ? ' · 流式' : issue.mainMode === 'non-stream' ? ' · 非流式' : '';
    const route = issue.transport === 'main' ? '主 API' + mainMode
        : issue.transport === 'stream' ? '独立 API · 流式'
        : ['non_stream', 'non-stream'].includes(issue.transport) ? '独立 API · 非流式'
        : '';
    const duration = Number.isFinite(issue.elapsedMs) ? `${Math.round(issue.elapsedMs / 1000)} 秒` : '';
    const received = [
        issue.heartbeats > 0 ? `${issue.heartbeats} 次心跳` : '',
        issue.hasText === false ? '0 字正文' : '',
    ].filter(Boolean).join('，');
    return { route, duration, received };
}

export function errorHelpHTML(issue, { retained = false, actions = false, version } = {}) {
    if (!issue) return '';
    const info = diagnosticSignalInfo(issue.signal);
    const [tone, status] = workStatus(issue, retained);
    const { route, duration, received } = requestDetails(issue);
    const provider = issue.providerMessage;
    const rows = [
        ['原文', provider?.original],
        ['HTTP 状态', issue.httpStatus === 200 ? '200（连接本身是通的）' : issue.httpStatus],
        ['线路', route],
        ['用时', duration],
        ['已收到', received],
        ['插件版本', version],
    ].filter(([, value]) => value);
    const technical = rows.length ? `<dl>${rows.map(([key, value]) => `<dt>${key}</dt><dd>${esc(value)}</dd>`).join('')}</dl>` : '';
    const showEnglishHint = provider?.known && !isProviderMessageChinese(provider.original);
    return `<article class="theater-error-help">
        <small class="teh-context">${esc(issue.stage || '请求处理')}时出错</small>
        <div class="teh-heading"><b>${esc(info.title)}</b><span>${esc(issue.signal || 'T-UNKNOWN')}</span></div>
        ${sideHTML(info.side)}
        <p class="teh-work-status teh-work-${tone}">${esc(status)}</p>
        <p>${esc(info.what)}</p>
        ${provider?.zh ? `<section class="teh-provider"><small>服务商 / 中转返回的说明</small>
            <p>${esc(provider.zh)}</p>${showEnglishHint ? '<small>英文原文见“技术信息”</small>' : ''}</section>` : ''}
        <div class="teh-steps"><b>现在可以</b>${stepsHTML(info.steps)}</div>
        ${technical ? `<details><summary>技术信息（给维护者看）</summary>${technical}</details>` : ''}
        ${actions ? `<div class="teh-actions"><button type="button" data-error-copy>复制问题信息</button>
            <button type="button" data-error-diagnostics>打开诊断</button></div><p data-error-status role="status"></p>` : ''}
    </article>`;
}

export function errorCopyText(issue, { version, time = new Date() } = {}) {
    const { route, duration } = requestDetails(issue);
    const provider = issue.providerMessage;
    const timestamp = time.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
    const title = diagnosticSignalInfo(issue.signal).title;
    return [
        '【千夜浮梦 报错信息】',
        `时间：${timestamp}`,
        `在做什么：${issue.stage || '请求处理'}`,
        `结果：${title}`,
        `错误码：${issue.signal || 'T-UNKNOWN'}`,
        issue.httpStatus && `HTTP 状态：${issue.httpStatus}`,
        route && `线路：${route}`,
        duration && `用时：${duration}`,
        provider?.zh && `服务商说明：${provider.zh}`,
        provider?.original && `${isProviderMessageChinese(provider.original) ? '服务商原文' : '英文原文'}：${provider.original}`,
        version && `插件版本：${version}`,
        '（不含正文、Key 和接口地址）',
    ].filter(Boolean).join('\n');
}

export function errorCatalogHTML() {
    const list = diagnosticSignalCatalog();
    const options = [...new Set(list.map(item => item.group))].map(group => `<option>${esc(group)}</option>`).join('');
    const items = list.map(item => `<details class="teh-catalog-item" data-error-item data-group="${esc(item.group)}">
        <summary>${esc(item.title)}<small>${esc(item.signal)}</small></summary>
        ${sideHTML(item.side)}<p>${esc(item.what)}</p>${stepsHTML(item.steps)}
    </details>`).join('');
    return `<div class="theater-error-library">
        <div class="teh-filters"><select data-error-group aria-label="按问题类别筛选"><option value="">全部类别</option>${options}</select>
            <input type="search" data-error-search placeholder="搜索错误码、凭证、超时…" aria-label="搜索错误类别"></div>
        <div data-error-items>${items}</div><p data-error-empty hidden>没有匹配的问题，请换一个关键词。</p>
    </div>`;
}

export function bindErrorLibrary(root) {
    for (const library of root?.querySelectorAll?.('.theater-error-library') || []) {
        if (library.dataset.bound) continue;
        library.dataset.bound = 'true';
        const filter = () => {
            const group = library.querySelector('[data-error-group]').value;
            const query = library.querySelector('[data-error-search]').value.trim().toLowerCase();
            let count = 0;
            for (const item of library.querySelectorAll('[data-error-item]')) {
                item.hidden = !!(group && item.dataset.group !== group || query && !item.textContent.toLowerCase().includes(query));
                if (!item.hidden) count++;
            }
            library.querySelector('[data-error-empty]').hidden = count > 0;
        };
        library.addEventListener('input', filter);
        library.addEventListener('change', filter);
    }
}
