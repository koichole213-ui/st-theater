import { syncContextExclusionDraft } from './context-exclusion-ui.js';
import { bindApiChannelSettings } from './api-channel-settings.js';
import { TAG_UNCATEGORIZED } from './tag-system.js';
import { LONG_DREAM_MEMORY_BUILTIN_PRESET_ID, createLongDreamMemoryPreset, normalizeLongDreamMemoryPresetList, MAX_LONG_DREAM_MEMORY_PRESET_BYTES, parseLongDreamMemoryPreset, exportLongDreamMemoryPreset } from './long-dream-memory-presets.js';
import { normalizeMaxTokens } from './api-client.js';
import { normalizeContextExclusionRules } from './context-exclusions.js';
import { normalizeApiPresetList, MAX_API_PRESETS, createApiPresetFromConfig } from './api-presets.js';
import { getRuntimeLogEntries, formatRuntimeLogs, clearRuntimeLogs } from './runtime-log.js';
import { REQUEST_DIAGNOSTIC_SIGNAL } from './request-diagnostics.js';

// Event registration order and handler closures are preserved by the coordinator.
export function bindSettingsEvents(runtime, $d) {
    // ---- Config ----
    bindApiChannelSettings(runtime, $d);
    $d.off('click.tamodeswitch').on('click.tamodeswitch', '[data-theater-api-mode]', function () {
        const mode = $(this).data('theater-api-mode') === 'main' ? 'main' : 'custom';
        $('#theater-api-mode').val(mode).trigger('change');
    });
    $d.off('change.tamode').on('change.tamode', '#theater-api-mode', function () {
        runtime.settings.apiMode = $(this).val();
        $('#theater-custom-api-area').toggle(runtime.settings.apiMode !== 'main');
        $('#theater-custom-api-actions').prop('hidden', runtime.settings.apiMode === 'main');
        $('.theater-config-token-field').prop('hidden', runtime.settings.apiMode === 'main');
        $('[data-theater-api-mode]').removeClass('active').attr('aria-pressed', 'false')
            .filter(`[data-theater-api-mode="${runtime.settings.apiMode}"]`).addClass('active').attr('aria-pressed', 'true');
        runtime.save();
        runtime.scheduleTokenEstimate?.(); runtime.scheduleLongDreamTokenEstimate?.(); runtime.updateWBCount?.();
    });
    $d.off('change.tdmemoryapi').on('change.tdmemoryapi', '#theater-dream-memory-api-preset', function () {
        runtime.settings.longDreamMemoryApiPresetId = $(this).val() || '';
        runtime.save();
        runtime.refreshApiPresetControls();
        if (runtime.settings.longDreamMemoryApiPresetId) {
            runtime.longDreamCache.forEach(dream => runtime.queueLongDreamMemoryWeave(dream.id));
            toastr.success('梦脉织录副 API 已绑定');
        } else {
            toastr.info('自动梦脉织录已暂停；待织录章节不会丢失');
        }
    });
    $d.off('change.tdmemorybatch').on('change.tdmemorybatch', '#theater-dream-memory-batch-size', function () {
        runtime.settings.longDreamMemoryBatchSize = [1, 3, 5].includes(Number(this.value)) ? Number(this.value) : 3;
        this.value = runtime.settings.longDreamMemoryBatchSize;
        runtime.save();
        runtime.refreshApiPresetControls();
        runtime.longDreamCache.forEach(dream => runtime.queueLongDreamMemoryWeave(dream.id));
    });
    $d.off('change.tdmemoryanalysispreset').on('change.tdmemoryanalysispreset', '#theater-dream-memory-analysis-preset', function () {
        runtime.settings.longDreamMemoryPresetId = String($(this).val() || LONG_DREAM_MEMORY_BUILTIN_PRESET_ID);
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
    });
    $d.off('input.tdmemoryprompt').on('input.tdmemoryprompt', '#theater-dream-memory-prompt', function () {
        const preset = runtime.selectedLongDreamMemoryAnalysisPreset();
        if (preset.builtin) return;
        const focusPrompt = String($(this).val() || '').slice(0, 50000);
        runtime.settings.longDreamMemoryPresets = runtime.longDreamMemoryAnalysisPresets().map(item => item.id === preset.id ? { ...item, focusPrompt } : item);
        runtime.settings.longDreamMemoryPrompt = focusPrompt;
        runtime.save();
    });
    $d.off('click.tdmemorypresetcopy').on('click.tdmemorypresetcopy', '#theater-copy-dream-memory-preset', async function () {
        const source = runtime.selectedLongDreamMemoryAnalysisPreset();
        const name = await runtime.askNewItemName('给新的梦脉分析预设起个名字：', source.builtin ? '我的梦脉侧重点' : `${source.name} 副本`);
        if (name === null || !String(name).trim()) return;
        const author = prompt('作者名（可留空）：', source.author || '') ?? '';
        const preset = createLongDreamMemoryPreset({ name, author, description: source.description, focusPrompt: source.focusPrompt });
        runtime.settings.longDreamMemoryPresets = normalizeLongDreamMemoryPresetList([...runtime.longDreamMemoryAnalysisPresets(), preset]);
        runtime.settings.longDreamMemoryPresetId = preset.id;
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
        toastr.success('已创建可编辑的梦脉预设副本');
    });
    $d.off('click.tdmemorypresetimport').on('click.tdmemorypresetimport', '#theater-import-dream-memory-preset', function () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                if (file.size > MAX_LONG_DREAM_MEMORY_PRESET_BYTES) throw new Error('梦脉预设文件过大');
                const preset = parseLongDreamMemoryPreset(await file.text());
                runtime.settings.longDreamMemoryPresets = normalizeLongDreamMemoryPresetList([...runtime.longDreamMemoryAnalysisPresets(), preset]);
                const imported = runtime.settings.longDreamMemoryPresets.find(item => item.id === preset.id)
                    || runtime.settings.longDreamMemoryPresets.slice().reverse().find(item => item.name.startsWith(preset.name));
                runtime.settings.longDreamMemoryPresetId = imported?.id || LONG_DREAM_MEMORY_BUILTIN_PRESET_ID;
                runtime.refreshLongDreamMemoryPresetControls();
                runtime.save();
                toastr.success(`已导入梦脉预设「${imported?.name || preset.name}」`);
            } catch (error) {
                toastr.warning(error?.message || String(error));
            }
        };
        input.click();
    });
    $d.off('click.tdmemorypresetexport').on('click.tdmemorypresetexport', '#theater-export-dream-memory-preset', function () {
        try {
            const preset = runtime.selectedLongDreamMemoryAnalysisPreset();
            const data = exportLongDreamMemoryPreset(preset);
            const filename = `${String(preset.name || '梦脉预设').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.json`;
            runtime.downloadFile(filename, JSON.stringify(data, null, 2), 'application/json');
            toastr.success('梦脉预设已导出；文件不包含 API 或长梦内容');
        } catch (error) {
            toastr.warning(error?.message || String(error));
        }
    });
    $d.off('click.tdmemorypresetdelete').on('click.tdmemorypresetdelete', '#theater-delete-dream-memory-preset', function () {
        const preset = runtime.selectedLongDreamMemoryAnalysisPreset();
        if (preset.builtin || !confirm(`删除梦脉预设「${preset.name}」吗？这不会删除已经生成的梦脉。`)) return;
        runtime.settings.longDreamMemoryPresets = runtime.longDreamMemoryAnalysisPresets().filter(item => item.id !== preset.id);
        runtime.settings.longDreamMemoryPresetId = LONG_DREAM_MEMORY_BUILTIN_PRESET_ID;
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
        toastr.success('梦脉预设已删除');
    });
    $d.off('click.tdmemorypromptreset').on('click.tdmemorypromptreset', '#theater-reset-dream-memory-prompt', function () {
        runtime.settings.longDreamMemoryPresetId = LONG_DREAM_MEMORY_BUILTIN_PRESET_ID;
        runtime.refreshLongDreamMemoryPresetControls();
        runtime.save();
        toastr.success('已切回“连续性梦脉 v2（完善版）”内置预设');
    });
    $d.off('change.tstream').on('change.tstream', '#theater-stream-enabled', function () {
        runtime.settings.streamEnabled = this.checked; runtime.save();
    });
    $d.off('change.tcreativeenhancement').on('change.tcreativeenhancement', '#theater-creative-enhancement', function () {
        runtime.settings.creativeEnhancementEnabled = this.checked === true;
        runtime.save();
        runtime.refreshTokenEstimate?.(); runtime.scheduleLongDreamTokenEstimate?.();
    });
    $d.off('change.tautocont').on('change.tautocont', '#theater-auto-continue', function () {
        runtime.settings.autoContinue = this.checked; runtime.save();
    });
    $d.off('change.tautorounds').on('change.tautorounds', '#theater-max-auto-rounds', function () {
        runtime.settings.maxAutoRounds = Math.min(10, Math.max(1, parseInt(this.value) || 3));
        this.value = runtime.settings.maxAutoRounds;
        runtime.save();
    });
    $d.off('change.tmaxtokens').on('change.tmaxtokens', '#theater-max-output-tokens', function () {
        runtime.settings.maxOutputTokens = normalizeMaxTokens(this.value);
        this.value = runtime.settings.maxOutputTokens;
        runtime.save();
    });

    // 前文排除仅修改读取规则；预览文本不写入设置或聊天。
    $d.off('click.texcladd').on('click.texcladd', '#theater-exclusion-add', runtime.addContextExclusionRule);
    $d.off('click.texclpreview').on('click.texclpreview', '#theater-exclusion-preview-run', runtime.previewContextExclusions);
    $d.off('click.texclmode').on('click.texclmode', '[data-exclusion-type]', function () {
        $('#theater-exclusion-type').val(this.dataset.exclusionType).trigger('change');
    });
    $d.off('change.texcltype').on('change.texcltype', '#theater-exclusion-type', function () {
        $('#theater-exclusion-value').val('');
        syncContextExclusionDraft();
        $('#theater-exclusion-feedback').prop('hidden', true);
    });
    $d.off('input.texclvalue').on('input.texclvalue', '#theater-exclusion-value', () => syncContextExclusionDraft());
    $d.off('change.texcltoggle').on('change.texcltoggle', '[data-exclusion-toggle]', function () {
        const rules = normalizeContextExclusionRules(runtime.settings.contextExclusionRules);
        const index = Number(this.dataset.exclusionToggle);
        if (!Number.isInteger(index) || !rules[index]) return;
        rules[index].enabled = this.checked;
        runtime.settings.contextExclusionRules = rules;
        runtime.refreshContextExclusionRules();
    });
    $d.off('click.texcldelete').on('click.texcldelete', '[data-exclusion-delete]', function () {
        const rules = normalizeContextExclusionRules(runtime.settings.contextExclusionRules);
        const index = Number(this.dataset.exclusionDelete);
        if (!Number.isInteger(index) || !rules[index]) return;
        rules.splice(index, 1);
        runtime.settings.contextExclusionRules = rules;
        runtime.refreshContextExclusionRules();
        $('#theater-exclusion-feedback').text('已删除规则。').prop('hidden', false);
    });
    $d.off('input.texclpreview').on('input.texclpreview', '#theater-exclusion-preview-input', function () {
        runtime.previewContextExclusions();
    });
    $d.off('change.tquickrendera').on('change.tquickrendera', '#theater-quick-render-a', function () {
        runtime.updateQuickRenderSetting('A', $(this).val());
    });
    $d.off('change.tquickrenderb').on('change.tquickrenderb', '#theater-quick-render-b', function () {
        runtime.updateQuickRenderSetting('B', $(this).val());
    });
    $d.off('click.tnumberstep').on('click.tnumberstep', '[data-theater-number-step]', function () {
        const input = document.getElementById(String($(this).data('theater-number-target') || ''));
        if (!input) return;
        const min = Number.isFinite(Number(input.min)) ? Number(input.min) : Number.NEGATIVE_INFINITY;
        const max = Number.isFinite(Number(input.max)) ? Number(input.max) : Number.POSITIVE_INFINITY;
        const step = Number(input.step) || 1;
        const direction = Number($(this).data('theater-number-step')) < 0 ? -1 : 1;
        const current = Number.isFinite(Number(input.value)) ? Number(input.value) : (Number.isFinite(min) ? min : 0);
        input.value = String(Math.min(max, Math.max(min, current + (step * direction))));
        $(input).trigger('change');
    });
    $d.off('change.twbread').on('change.twbread', '#theater-wb-read-mode', async function () {
        runtime.settings.worldBookReadMode = ['enabled', 'lights'].includes($(this).val()) ? $(this).val() : 'all';
        runtime.save();
        await runtime.reloadWorldBooks();
    });
    $d.off('click.tsa').on('click.tsa', '#theater-save-api-btn', function () {
        const config = runtime.readApiFormConfig();
        if (runtime.settings.apiMode !== 'main' && !runtime.validateApiPresetConfig(config)) return;
        runtime.persistCurrentApiConfig(config);
        toastr.success('API 已保存');
    });
    $d.off('change.tapreset').on('change.tapreset', '#theater-api-preset-select', function () {
        const id = $(this).val() || '';
        if (!id) {
            runtime.settings.selectedApiPresetId = '';
            runtime.refreshApiPresetControls('');
            runtime.save();
            return;
        }
        const preset = runtime.findApiPreset(id);
        if (!preset) { runtime.refreshApiPresetControls(''); return; }
        runtime.writeApiFormConfig(preset);
        runtime.settings.selectedApiPresetId = preset.id;
        runtime.persistCurrentApiConfig(preset);
        runtime.refreshApiPresetControls(preset.id);
        runtime.runtimeLog('info', 'API 预设切换', { preset: preset.name, protocol: preset.apiProtocol, model: preset.apiModel });
        toastr.success(`已切换到「${preset.name}」`);
    });
    $d.off('click.tapreset-save').on('click.tapreset-save', '#theater-save-api-preset-btn', async function () {
        const config = runtime.readApiFormConfig();
        if (!runtime.validateApiPresetConfig(config)) return;
        const { Popup } = SillyTavern.getContext();
        const input = await runtime.askNewItemName('保存 API 预设', runtime.apiPresetDefaultName(config), 40, { compact: true });
        const name = String(input || '').trim().slice(0, 40);
        if (!name) return;
        const duplicate = normalizeApiPresetList(runtime.settings.apiPresets).find(preset => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (duplicate) {
            const overwrite = await Popup.show.confirm(`已经有一个叫「${duplicate.name}」的预设`, '要用当前填写的配置覆盖它吗？');
            if (!overwrite) return;
        } else if (normalizeApiPresetList(runtime.settings.apiPresets).length >= MAX_API_PRESETS) {
            toastr.warning(`最多保存 ${MAX_API_PRESETS} 个 API 预设`);
            return;
        }
        const preset = createApiPresetFromConfig(name, config, duplicate?.id || '');
        runtime.settings.apiPresets = duplicate
            ? normalizeApiPresetList(runtime.settings.apiPresets).map(item => item.id === duplicate.id ? preset : item)
            : [...normalizeApiPresetList(runtime.settings.apiPresets), preset];
        runtime.settings.selectedApiPresetId = preset.id;
        runtime.persistCurrentApiConfig(config);
        runtime.refreshApiPresetControls(preset.id);
        runtime.runtimeLog('info', duplicate ? 'API 预设覆盖' : 'API 预设保存', { preset: preset.name, protocol: preset.apiProtocol, model: preset.apiModel });
        toastr.success(duplicate ? `已更新「${preset.name}」` : `已保存「${preset.name}」`);
    });
    $d.off('click.tapreset-update').on('click.tapreset-update', '#theater-update-api-preset-btn', function () {
        const current = runtime.findApiPreset();
        if (!current) { toastr.warning('请先选择一个 API 预设'); return; }
        const config = runtime.readApiFormConfig();
        if (!runtime.validateApiPresetConfig(config)) return;
        const preset = createApiPresetFromConfig(current.name, config, current.id);
        runtime.settings.apiPresets = normalizeApiPresetList(runtime.settings.apiPresets).map(item => item.id === current.id ? preset : item);
        runtime.persistCurrentApiConfig(config);
        runtime.refreshApiPresetControls(preset.id);
        runtime.runtimeLog('info', 'API 预设更新', { preset: preset.name, protocol: preset.apiProtocol, model: preset.apiModel });
        toastr.success(`已更新「${preset.name}」`);
    });
    $d.off('click.tapreset-rename').on('click.tapreset-rename', '#theater-rename-api-preset-btn', async function () {
        const current = runtime.findApiPreset();
        if (!current) { toastr.warning('请先选择一个 API 预设'); return; }
        const { Popup } = SillyTavern.getContext();
        const input = await Popup.show.input('重命名 API 预设', `把「${current.name}」改成：`, current.name);
        const name = String(input || '').trim().slice(0, 40);
        if (!name || name === current.name) return;
        const duplicate = normalizeApiPresetList(runtime.settings.apiPresets).some(preset => preset.id !== current.id && preset.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (duplicate) { toastr.warning('已经有同名的 API 预设'); return; }
        runtime.settings.apiPresets = normalizeApiPresetList(runtime.settings.apiPresets).map(preset => preset.id === current.id ? { ...preset, name } : preset);
        runtime.refreshApiPresetControls(current.id);
        runtime.save();
        runtime.runtimeLog('info', 'API 预设改名', { from: current.name, to: name });
        toastr.success(`已改名为「${name}」`);
    });
    $d.off('click.tapreset-delete').on('click.tapreset-delete', '#theater-delete-api-preset-btn', async function () {
        const current = runtime.findApiPreset();
        if (!current) { toastr.warning('请先选择一个 API 预设'); return; }
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm(`删除 API 预设「${current.name}」？`, '只会删除快捷预设，当前正在使用的 API 配置会保留。');
        if (!ok) return;
        runtime.settings.apiPresets = normalizeApiPresetList(runtime.settings.apiPresets).filter(preset => preset.id !== current.id);
        runtime.settings.selectedApiPresetId = '';
        runtime.refreshApiPresetControls('');
        runtime.save();
        runtime.runtimeLog('info', 'API 预设删除', { preset: current.name });
        toastr.success(`已删除「${current.name}」`);
    });
    $d.off('click.tfm').on('click.tfm', '#theater-fetch-models-btn', runtime.fetchModelList);
    $d.off('click.ttest').on('click.ttest', '#theater-test-api-btn', runtime.testAPIConnection);
    $d.off('click.tdiag').on('click.tdiag', '#theater-run-diagnostics-btn', runtime.runDiagnostics);
    $d.off('click.tarchiveaccept').on('click.tarchiveaccept', '[data-archive-accept]', async () => {
        const accepted = await runtime.archiveSafety?.confirmCurrent(() => SillyTavern.getContext().Popup.show.confirm(
            '以当前存档为准？', '确认后会以当前的作品数量作为新基准，并解除疑似丢失警告。你仍可导入备份。',
        ));
        if (accepted) {
            runtime.runDiagnostics();
            runtime.refreshHistList();
        }
    });
    $d.off('click.tdiagexport').on('click.tdiagexport', '#theater-export-diagnostics-btn', runtime.exportDiagnosticsText);
    $d.off('click.tdiagcopy').on('click.tdiagcopy', '#theater-copy-diagnostics-btn', function () {
        const text = $('#theater-diagnostics-output').data('report') || '';
        if (!text) { toastr.warning('请先生成诊断报告'); return; }
        runtime.copyToClipboard(text);
    });
    $d.off('click.tdiagtoggle').on('click.tdiagtoggle', '#theater-toggle-diagnostics-btn', runtime.toggleDiagnosticsReport);
    $d.off('click.telcopy').on('click.telcopy', '.theater-copy-runtime-log-btn', function () {
        if (!getRuntimeLogEntries().length) { toastr.warning('暂无运行日志'); return; }
        runtime.copyToClipboard(formatRuntimeLogs(), {
            requireVerification: true,
            manualTitle: '手动复制运行日志',
            downloadName: `千夜浮梦-运行日志-${new Date().toISOString().slice(0, 10)}.txt`,
        });
    });
    $d.off('click.tmcopyclose').on('click.tmcopyclose', '[data-theater-manual-copy-close]', function (event) {
        if (event.target !== this && $(this).hasClass('theater-manual-copy-backdrop')) return;
        this.closest('dialog')?.close();
    });
    $d.off('click.tmcopydownload').on('click.tmcopydownload', '#theater-manual-copy-download', function () {
        const $overlay = $('#theater-manual-copy-overlay');
        runtime.downloadTextContent($overlay.find('textarea').val() || '', $overlay.data('download-name') || '千夜浮梦-日志.txt');
    });
    $d.off('click.tmcopyselect').on('click.tmcopyselect', '#theater-manual-copy-text', function () {
        this.focus();
        this.select();
        this.setSelectionRange(0, this.value.length);
    });
    $d.off('click.telclear').on('click.telclear', '#theater-clear-runtime-log-btn', function () {
        clearRuntimeLogs();
        runtime.renderRuntimeLog();
        toastr.success('日志已清空');
    });
    // The fetched dropdown owns its guarded callback; clear the old unconditional autosave.
    $d.off('change.tams');

    // ---- Result bookmark & Floating Ball ----
    $d.off('change.trbe').on('change.trbe', '#theater-result-bookmark-enabled', function () {
        runtime.settings.resultBookmarkEnabled = $(this).is(':checked');
        runtime.save();
        runtime.applyResultToolboxMode();
    });
    $d.off('change.tfb').on('change.tfb', '#theater-floating-ball-toggle', function () {
        runtime.settings.floatingBall = $(this).is(':checked'); runtime.save(); runtime.createFloatingBall();
    });
    $d.off('change.tfbt').on('change.tfbt', '#theater-floating-ball-tuck-toggle', function () {
        runtime.settings.floatingBallTuck = $(this).is(':checked'); runtime.save(); runtime.createFloatingBall();
    });

    // ---- Sound ----
    $d.off('change.tse').on('change.tse', '#theater-sound-enabled', function () {
        runtime.settings.soundEnabled = $(this).is(':checked'); runtime.save();
    });
    $d.off('change.tsp').on('change.tsp', '#theater-sound-preset', function () {
        runtime.settings.soundPreset = $(this).val(); runtime.save();
        runtime.refreshConfigSummaries();
        runtime.playNotificationSound({ force: true });
    });
    $d.off('input.tsv').on('input.tsv', '#theater-sound-volume', function () {
        const v = Math.max(0, Math.min(100, parseInt($(this).val()) || 0));
        runtime.settings.soundVolume = v;
        $('#theater-sound-volume-num').text(v);
        runtime.refreshConfigSummaries();
        runtime.save();
    });
    $d.off('click.tspv').on('click.tspv', '#theater-sound-preview-btn', function () {
        runtime.playNotificationSound({ force: true });
    });

    // ---- Random pick ----
    $d.off('change.tre').on('change.tre', '#theater-random-enabled', function () {
        runtime.settings.randomEnabled = $(this).is(':checked');
        $('#theater-random-btn').toggle(runtime.settings.randomEnabled);
        runtime.save();
    });
    $d.off('change.trs').on('change.trs', '#theater-random-scope', function () {
        runtime.settings.randomScope = $(this).val();
        runtime.refreshTagControls();
        runtime.save();
    });
    $d.off('click.trtagpicker').on('click.trtagpicker', '#theater-random-tag-picker', async function () {
        const chosen = await runtime.chooseTags({ title: '指定“抽一个”的标签', selected: runtime.settings.randomTagFilter, allowUncategorized: true });
        if (chosen === null) return;
        runtime.settings.randomTagFilter = chosen;
        runtime.settings.randomScope = chosen[0] === TAG_UNCATEGORIZED ? TAG_UNCATEGORIZED : '__tags__';
        $('#theater-random-scope').val(runtime.settings.randomScope);
        runtime.save(); runtime.refreshTagControls();
    });
    $d.off('click.trb').on('click.trb', '#theater-random-btn', runtime.rollRandomInstruction);

    // ---- Auto mode ----
    $d.off('change.tae').on('change.tae', '#theater-auto-enabled', function () {
        runtime.settings.autoMode = $(this).is(':checked');
        runtime.save();
        if (runtime.settings.autoMode) {
            const readiness = runtime.currentAutoInstruction();
            if (!readiness.text) {
                runtime.lastAutoIssue = {
                    signal: readiness.signal || REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
                    source: readiness.source,
                    candidateCount: readiness.candidateCount,
                };
                toastr.warning(`自动模式已开启，但当前不会发请求：${runtime.lastAutoIssue.signal}。请打开【诊断】查看说明。`, '', { timeOut: 6500 });
            } else {
                runtime.lastAutoIssue = null;
                toastr.info(`自动模式已开启：每攒 ${runtime.settings.autoInterval || 10} 层 AI 楼生成一次`, '', { timeOut: 4000 });
            }
        } else {
            runtime.lastAutoIssue = null;
            runtime.lastAutoIssueFingerprint = '';
        }
    });
    $d.off('change.tai').on('change.tai', '#theater-auto-interval', function () {
        const v = Math.max(1, Math.min(50, parseInt($(this).val()) || 10));
        runtime.settings.autoInterval = v;
        $(this).val(v);
        runtime.refreshConfigSummaries();
        runtime.save();
    });
    $d.off('change.tas').on('change.tas', '#theater-auto-source', function () {
        runtime.settings.autoSource = $(this).val();
        runtime.lastAutoIssue = null;
        runtime.lastAutoIssueFingerprint = '';
        runtime.refreshTagControls();
        runtime.save();
    });
    $d.off('click.tautagpicker').on('click.tautagpicker', '#theater-auto-tag-picker', async function () {
        const chosen = await runtime.chooseTags({ title: '指定自动生成的模板标签', selected: runtime.settings.autoTagFilter, allowUncategorized: true });
        if (chosen === null) return;
        runtime.settings.autoTagFilter = chosen;
        runtime.settings.autoSource = chosen[0] === TAG_UNCATEGORIZED ? TAG_UNCATEGORIZED : '__tags__';
        $('#theater-auto-source').val(runtime.settings.autoSource);
        runtime.lastAutoIssue = null; runtime.lastAutoIssueFingerprint = '';
        runtime.save(); runtime.refreshTagControls();
    });

    // ---- Instruction Import/Export ----
    $d.off('click.timp').on('click.timp', '#theater-import-inst-btn', () => runtime.backup ? void runtime.backup.openRestore('instructions').catch(() => toastr.warning('暂时无法打开恢复，请停止生成后重试')) : runtime.importInstructionTemplates());
    $d.off('click.texp').on('click.texp', '#theater-export-inst-btn', runtime.exportInstructionTemplates);

    // ---- Preset Collapse ----
    $d.off('click.tpcol').on('click.tpcol', '#theater-preset-collapse-btn', function () {
        const $list = $('#theater-preset-entries');
        const hidden = !$list.is(':visible');
        $list.slideToggle(150);
        $(this).html(hidden ? '<i class="fa-solid fa-chevron-up"></i> 收起' : '<i class="fa-solid fa-chevron-down"></i> 展开');
    });
}
