// theater-diagnostics: receives live state and cross-feature callbacks from index.js.
import { autoSourceLabel } from './auto-mode.js';
import { REQUEST_DIAGNOSTIC_SIGNAL, diagnosticSignalCatalog, formatConnectionDiagnostics } from './request-diagnostics.js';
import { isPlainTextSelection } from './plain-text-renderer.js';
import { isAdaptiveRenderSelection } from './adaptive-render.js';
import { summarizeMetrics } from './request-metrics.js';
import { readableCharCount } from './text-counter.js';
import { resolveProtocol, normalizeMaxTokens } from './api-client.js';
import { requestTraceCompatibilityLabel, formatRequestTrace, requestTraceMessageLabel } from './request-trace.js';
import { getRuntimeLogEntries, MAX_RUNTIME_LOGS, formatRuntimeLogs, sanitizeLogText } from './runtime-log.js';

export function createTheaterDiagnostics(runtime) {
// @theater-source-begin diagnosticLine
function diagnosticLine(status, name, detail) {
    const icon = status === 'ok' ? 'OK' : (status === 'warn' ? '注意' : '异常');
    return { status, name, detail, text: `[${icon}] ${name}: ${detail}` };
}
// @theater-source-end diagnosticLine

// @theater-source-begin formatApiResponseSummary
function formatApiResponseSummary(summary) {
    if (!summary) return '暂无完整响应摘要；独立 API 是否收到响应头及读取中断阶段请看“独立 API 连接过程”。不记录正文。';
    const usage = summary.usage || {};
    const tokenParts = [
        usage.inputTokens != null ? `输入 ${usage.inputTokens}` : '',
        usage.outputTokens != null ? `输出 ${usage.outputTokens}` : '',
        usage.reasoningTokens != null ? `思考 ${usage.reasoningTokens}` : '',
        usage.totalTokens != null ? `合计 ${usage.totalTokens}` : '',
    ].filter(Boolean);
    return `${summary.transport || 'unknown'} · HTTP ${summary.httpStatus || '未知'} · ${summary.contentType || 'unknown'} · 格式 ${summary.format || 'unknown'} · 事件 ${summary.events || 0} · 正文 ${summary.hasText ? '有' : '无'} · 思考 ${summary.hasReasoning ? '有' : '无'} · 结束 ${summary.rawStopReason || '未报告'}${tokenParts.length ? ` · Token ${tokenParts.join('/')}` : ''}`;
}
// @theater-source-end formatApiResponseSummary

// @theater-source-begin buildAutoModeDiagnostic
function buildAutoModeDiagnostic() {
    if (!runtime.settings.autoMode) return diagnosticLine('ok', '自动模式', '未开启');
    const readiness = runtime.currentAutoInstruction();
    const sourceLabel = autoSourceLabel(readiness.source, runtime.settings.instructionTags, runtime.settings.autoTagFilter);
    const issue = runtime.lastAutoIssue || (!readiness.text ? {
        signal: readiness.signal || REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
        source: readiness.source,
        candidateCount: readiness.candidateCount,
    } : null);
    if (issue) {
        return diagnosticLine('warn', '自动模式', `${issue.signal} · 指令来源“${sourceLabel}”当前没有可用正文；达到间隔时不会发出 API 请求。`);
    }
    return diagnosticLine('ok', '自动模式', `已开启 · 指令来源“${sourceLabel}”可用（${readiness.candidateCount} 条）· 每 ${Math.max(1, Number(runtime.settings.autoInterval) || 10)} 层 AI 楼触发一次；自动结果在“生成”页的最近生成中查看。`);
}
// @theater-source-end buildAutoModeDiagnostic

// @theater-source-begin diagnosticCatalogHTML
function diagnosticCatalogHTML() {
    return diagnosticSignalCatalog().map(item => `
        <div class="theater-diagnostic-catalog-item ${item.status}">
            <div class="theater-diagnostic-catalog-head">
                <code>${runtime.esc(item.signal)}</code>
                <b>${runtime.esc(item.title)}</b>
            </div>
            <p class="theater-diagnostic-catalog-reason"><strong>原因</strong><span>${runtime.esc(item.detail)}</span></p>
            ${item.aliases?.length ? `<p class="theater-diagnostic-catalog-alias"><strong>同类信号</strong><span>${runtime.esc(item.aliases.join('、'))}</span></p>` : ''}
            <p class="theater-diagnostic-catalog-action"><strong>可以怎么处理</strong><span>${runtime.esc(item.action)}</span></p>
        </div>
    `).join('');
}
// @theater-source-end diagnosticCatalogHTML

// @theater-source-begin buildDiagnostics
function buildDiagnostics() {
    const apiMode = runtime.settings.apiMode || 'custom';
    const apiUrl = ($('#theater-api-url').val() || runtime.settings.apiUrl || '').trim();
    const apiKey = ($('#theater-api-key').val() || runtime.settings.apiKey || '').trim();
    const apiModel = ($('#theater-api-model').val() || runtime.settings.apiModel || '').trim();
    const selectedRender = runtime.settings.selectedRenderIndex || '__default__';
    const customRenderOk = selectedRender === '__default__'
        || selectedRender === '__default_pc__'
        || isPlainTextSelection(selectedRender)
        || isAdaptiveRenderSelection(selectedRender)
        || !!(runtime.settings.renderTemplates || [])[parseInt(selectedRender)];
    const timingDetail = runtime.requestMetricsLog.length
        ? runtime.requestMetricsLog.slice(0, 3).reverse().map((metrics, index, list) => `请求${runtime.requestMetricsLog.length - list.length + index + 1}：${summarizeMetrics(metrics)}`).join('；')
        : summarizeMetrics(runtime.lastRequestMetrics);
    const timingStatus = runtime.lastRequestIssue?.status
        || (runtime.lastRequestMetrics?.completedAt || runtime.lastRequestMetrics?.firstTokenAt ? 'ok' : 'warn');
    const recentReadableCounts = runtime.recentCache.map(item => readableCharCount(runtime.htmlToPlainText(item?.html || '')));
    const recentContentOk = recentReadableCounts.every(count => count > 0);
    const recentContentDetail = recentReadableCounts.length
        ? recentReadableCounts.map((count, index) => `第${index + 1}条约 ${count} 字`).join('；')
        : '暂无最近生成';

    const rows = [
        diagnosticLine('ok', '诊断范围', '这份报告只检查小剧场插件，不检查酒馆正文生成链路'),
        diagnosticLine('ok', '插件版本', `本地 v${runtime.VERSION}${runtime.latestRemoteVersion ? `，正式版 v${runtime.latestRemoteVersion}` : ''}${runtime.installedBranchStatusKnown && runtime.installedBranchName ? `，当前分支 ${runtime.installedBranchName}${runtime.installedBranchHasUpdate ? ' 有新更新' : ' 已是最新'}` : '，还没有拿到分支状态'}`),
        diagnosticLine('ok', 'API 模式', apiMode === 'main' ? '酒馆主 API（实验）' : '独立 API'),
        diagnosticLine('ok', '独立 API 协议', apiMode === 'main' ? '不适用' : `${runtime.settings.apiProtocol || 'auto'}（实际：${resolveProtocol(runtime.settings.apiProtocol, apiUrl)}）`),
        diagnosticLine('ok', '最大输出 Token', apiMode === 'main' ? '遵循酒馆当前设置' : String(normalizeMaxTokens(runtime.settings.maxOutputTokens))),
        diagnosticLine(timingStatus, '最近请求计时', timingDetail),
        diagnosticLine(apiMode === 'main' || (apiUrl && apiModel) ? 'ok' : 'bad', 'API 配置', apiMode === 'main' ? '使用酒馆当前 API 设置' : (apiUrl && apiModel ? `已填写，模型：${apiModel}${apiKey ? '，已填写 Key' : '，未填写 Key（OpenAI 兼容本地服务可为空）'}` : 'API URL 和模型名至少有一项没填')),
        diagnosticLine(typeof fetch === 'function' && typeof AbortController === 'function' ? 'ok' : 'bad', '请求能力', 'fetch / AbortController ' + (typeof fetch === 'function' && typeof AbortController === 'function' ? '可用' : '不可用')),
        diagnosticLine(window.indexedDB ? (runtime.idb ? 'ok' : 'warn') : 'bad', '本地存档库', window.indexedDB ? (runtime.idb ? 'IndexedDB 已打开' : 'IndexedDB 存在，但当前未打开，可能会回退到 settings') : '浏览器不支持 IndexedDB'),
        diagnosticLine('warn', '历史存储提示', '历史存在浏览器本地存储里。夸克等手机浏览器崩溃或清理后可能丢失，建议定期批量导出备份'),
        diagnosticLine(customRenderOk ? 'ok' : 'bad', '渲染模板', customRenderOk ? `当前模板：${runtime.renderSelectionMeta(selectedRender, runtime.settings.renderTemplates).name}` : `当前选择 ${selectedRender} 找不到对应模板`),
        diagnosticLine(runtime.continueContext ? 'warn' : 'ok', '续写状态', runtime.continueContext ? `续写模式仍有前情：约 ${readableCharCount(runtime.continueContext)} 字` : '未处于续写模式'),
        diagnosticLine(runtime.isGenerating ? 'warn' : 'ok', '生成状态', runtime.isGenerating ? '正在生成中' : '空闲'),
        diagnosticLine(runtime.lastRequestIssue ? runtime.lastRequestIssue.status : (runtime.bgError ? 'bad' : 'ok'), '最近错误信号', runtime.lastRequestIssue
            ? `${runtime.lastRequestIssue.signal} · ${runtime.lastRequestIssue.title}${runtime.lastRequestIssue.rawStopReason ? `（上游结束原因：${runtime.lastRequestIssue.rawStopReason}）` : ''}`
            : (runtime.bgError ? `${REQUEST_DIAGNOSTIC_SIGNAL.UNKNOWN} · 请打开“常见问题汇总”查询` : '无')),
        ...(runtime.lastRequestIssue ? [diagnosticLine('warn', '错误处理建议', `${runtime.lastRequestIssue.signal}：${runtime.lastRequestIssue.action}`)] : []),
        diagnosticLine(runtime.lastRequestContext ? 'ok' : 'warn', '最近请求摘要', runtime.formatRequestContextSummary(runtime.lastRequestContext)),
        diagnosticLine(runtime.lastRequestTrace ? 'ok' : 'warn', '创作请求结构', runtime.lastRequestTrace
            ? `${runtime.lastRequestTrace.route}/${runtime.lastRequestTrace.transport} · ${runtime.lastRequestTrace.messages.length} 条消息 · ${runtime.lastRequestTrace.route === 'custom' ? '预设采样参数未继承' : '预设采样参数由酒馆主 API 决定'} · 消息兼容：${requestTraceCompatibilityLabel(runtime.lastRequestTrace)} · 工具已强制禁用`
            : '暂无；完成一次插件正文请求后会在此显示发送前的角色、来源和长度，不包含消息正文'),
        diagnosticLine(runtime.lastApiResponseSummary?.hasText ? 'ok' : 'warn', '最近响应结构', formatApiResponseSummary(runtime.lastApiResponseSummary)),
        diagnosticLine(runtime.lastApiConnectionSummary?.state === 'failed' ? 'bad' : runtime.lastApiConnectionSummary?.state === 'complete' ? 'ok' : 'warn', '独立 API 连接过程', formatConnectionDiagnostics(runtime.lastApiConnectionSummary)),
        buildAutoModeDiagnostic(),
        diagnosticLine('ok', '数据数量', `历史 ${runtime.historyCache.length} 条，最近生成 ${runtime.recentCache.length} 条，指令模板 ${(runtime.settings.instructionTemplates || []).length} 个`),
        diagnosticLine(recentContentOk ? 'ok' : 'warn', '最近生成正文', recentContentDetail),
        diagnosticLine('ok', '世界书', `已选 ${(runtime.settings.selectedWorldBooks || []).length} 本，当前加载 ${runtime.wbEntries.length} 条`),
    ];

    return {
        rows,
        text: [
            `千夜浮梦插件诊断报告`,
            `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
            ...rows.map(r => r.text),
            '',
            formatRequestTrace(runtime.lastRequestTrace),
        ].join('\n'),
    };
}
// @theater-source-end buildDiagnostics

// @theater-source-begin exportDiagnosticsText
function exportDiagnosticsText() {
    const report = buildDiagnostics();
    const entries = getRuntimeLogEntries();
    const content = [
        report.text,
        '',
        `===== 脱敏运行日志（最近 ${entries.length}/${MAX_RUNTIME_LOGS} 条）=====`,
        entries.length ? formatRuntimeLogs() : '暂无运行日志',
    ].join('\n');
    const date = new Date().toISOString().slice(0, 10);
    runtime.downloadTextContent(sanitizeLogText(content).replace(/\r?\n/g, '\r\n'), `千夜浮梦-排查报告-${date}.txt`, '已发起下载，请查看浏览器下载列表');
}
// @theater-source-end exportDiagnosticsText

// @theater-source-begin runDiagnostics
function runDiagnostics() {
    const report = buildDiagnostics();
    const rowsHtml = report.rows.map(r => `
        <div class="theater-diagnostic-row ${r.status}">
            <span class="theater-diagnostic-status">${r.status === 'ok' ? 'OK' : (r.status === 'warn' ? '注意' : '异常')}</span>
            <div><b>${runtime.esc(r.name)}</b><br><span>${runtime.esc(r.detail)}</span></div>
        </div>
    `).join('');
    const traceHtml = runtime.lastRequestTrace ? `
        <details class="theater-request-trace">
            <summary>查看创作请求结构（${runtime.lastRequestTrace.messages.length} 条，不含正文）</summary>
            <div class="theater-request-trace-meta">
                <span>线路 ${runtime.esc(runtime.lastRequestTrace.route)}/${runtime.esc(runtime.lastRequestTrace.transport)}</span>
                <span>协议 ${runtime.esc(runtime.lastRequestTrace.protocol)}</span>
                <span>模型 ${runtime.esc(runtime.lastRequestTrace.model)}</span>
                <span>预设 ${runtime.esc(runtime.lastRequestTrace.presetName)}</span>
                <span>后处理 ${runtime.esc(runtime.lastRequestTrace.postProcessing)}</span>
                <span>预设采样参数 ${runtime.lastRequestTrace.route === 'custom' ? '未继承（使用线路默认值）' : '由酒馆主 API 决定'}</span>
                <span>消息兼容 ${runtime.esc(requestTraceCompatibilityLabel(runtime.lastRequestTrace))}</span>
                <span>工具 已强制禁用</span>
            </div>
            ${(runtime.lastRequestTrace.messages || []).map(message => `
                <div class="theater-request-trace-message">
                    <span>${message.index}. ${runtime.esc(requestTraceMessageLabel(message))}</span>
                    <small>${Number(message.chars) || 0} 字符 · 约 ${Number(message.estimatedTokens) || 0} token${message.foldedMessageCount > 1 ? ` · 合并 ${Number(message.foldedMessageCount)} 条` : ''}</small>
                </div>
            `).join('')}
        </details>` : '';
    $('#theater-diagnostics-output').html(rowsHtml + traceHtml).data('report', report.text).show();
    $('#theater-copy-diagnostics-btn').show();
    $('#theater-toggle-diagnostics-btn').show().find('i').removeClass('fa-chevron-down').addClass('fa-chevron-up');
    $('#theater-toggle-diagnostics-btn').find('span').text('收起报告');
}
// @theater-source-end runDiagnostics

// @theater-source-begin toggleDiagnosticsReport
function toggleDiagnosticsReport() {
    const $out = $('#theater-diagnostics-output');
    if (!$out.data('report')) { toastr.warning('请先生成诊断报告'); return; }
    const show = !$out.is(':visible');
    $out.toggle(show);
    $('#theater-toggle-diagnostics-btn').find('i').toggleClass('fa-chevron-up', show).toggleClass('fa-chevron-down', !show);
    $('#theater-toggle-diagnostics-btn').find('span').text(show ? '收起报告' : '展开报告');
}
// @theater-source-end toggleDiagnosticsReport

return { diagnosticLine, formatApiResponseSummary, buildAutoModeDiagnostic, diagnosticCatalogHTML, buildDiagnostics, exportDiagnosticsText, runDiagnostics, toggleDiagnosticsReport };
}
