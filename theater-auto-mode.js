// theater-auto-mode: receives live state and cross-feature callbacks from index.js.
import { resolveAutoInstruction } from './auto-mode.js';
import { TAG_UNCATEGORIZED } from './tag-system.js';
import { REQUEST_DIAGNOSTIC_SIGNAL } from './request-diagnostics.js';

export function createTheaterAutoMode(runtime) {
// @theater-source-begin currentAutoInstruction
function currentAutoInstruction() {
    return resolveAutoInstruction({
        source: runtime.settings.autoSource,
        lastInstruction: runtime.settings.lastInstruction,
        lastTags: runtime.settings.lastInstructionTags,
        templates: runtime.settings.instructionTemplates,
        tags: runtime.settings.instructionTags,
        tagFilter: runtime.settings.autoTagFilter,
    });
}
// @theater-source-end currentAutoInstruction

// @theater-source-begin autoSourceKind
function autoSourceKind(source) {
    if (source === '__last__') return 'last';
    if (source === '__all__') return 'all';
    if (source === TAG_UNCATEGORIZED) return 'uncategorized';
    return 'tags';
}
// @theater-source-end autoSourceKind

// @theater-source-begin pickAutoInstruction
function pickAutoInstruction() {
    return currentAutoInstruction().text;
}
// @theater-source-end pickAutoInstruction

// @theater-source-begin autoTick
async function autoTick() {
    if (!runtime.settings.autoMode || runtime.isGenerating || runtime.isPreparingGeneration || runtime.longDreamGenerationController?.active || runtime.longDreamChapterEditController || runtime.longDreamCanonSuggestionState.controller) return;
    const ctx = SillyTavern.getContext();
    const chatId = String(ctx.chatId ?? '');
    if (!chatId || chatId === 'undefined' || chatId === 'null') return;
    const floors = (ctx.chat || []).filter(m => !m.is_user && !m.is_system).length;

    if (!runtime.settings.autoAnchors || typeof runtime.settings.autoAnchors !== 'object') runtime.settings.autoAnchors = {};
    if (Object.keys(runtime.settings.autoAnchors).length > 200) runtime.settings.autoAnchors = {};

    const prev = runtime.settings.autoAnchors[chatId];
    if (prev === undefined) {
        // 第一次见这个聊天：先立锚，从现在开始数
        runtime.settings.autoAnchors[chatId] = floors;
        runtime.save();
        return;
    }
    let anchor = prev;
    if (anchor > floors) {
        anchor = floors;
        runtime.settings.autoAnchors[chatId] = floors;
        runtime.save();
    }
    if (floors - anchor < Math.max(1, Number(runtime.settings.autoInterval) || 10)) return;

    const autoInstruction = currentAutoInstruction();
    const instruction = autoInstruction.text;
    if (!instruction) {
        const fingerprint = `${chatId}:${autoInstruction.signal}:${autoInstruction.source}`;
        runtime.lastAutoIssue = {
            signal: autoInstruction.signal || REQUEST_DIAGNOSTIC_SIGNAL.AUTO_NO_INSTRUCTION,
            source: autoInstruction.source,
            candidateCount: autoInstruction.candidateCount,
            aiFloors: floors,
            interval: Math.max(1, Number(runtime.settings.autoInterval) || 10),
        };
        if (runtime.lastAutoIssueFingerprint !== fingerprint) {
            runtime.lastAutoIssueFingerprint = fingerprint;
            runtime.runtimeLog('warn', '自动模式未发起请求', {
                signal: runtime.lastAutoIssue.signal,
                source: autoSourceKind(autoInstruction.source),
                candidates: autoInstruction.candidateCount,
                ai_floors: floors,
                interval: runtime.lastAutoIssue.interval,
            });
            toastr.warning(`自动模式未发起请求：${runtime.lastAutoIssue.signal}。请打开【诊断】查看说明。`, '', { timeOut: 6500 });
        }
        return;
    }
    runtime.lastAutoIssue = null;
    runtime.lastAutoIssueFingerprint = '';
    runtime.settings.autoAnchors[chatId] = floors;
    runtime.save();
    runtime.runtimeLog('info', '自动模式触发', { chat: 'current', ai_floors: floors, interval: Math.max(1, Number(runtime.settings.autoInterval) || 10) });
    console.log(`[Theater] 自动生成触发：${chatId} @ ${floors} 层 AI 楼`);

    // 弹窗未打开或切过角色卡时，也要确认缓存属于当前书单与读取模式。
    try {
        const started = await runtime.runGeneration(instruction, true, autoInstruction.tags);
        if (started === false && runtime.settings.autoAnchors[chatId] === floors) {
            runtime.settings.autoAnchors[chatId] = anchor;
            runtime.save();
        }
    } catch (error) {
        if (runtime.settings.autoAnchors[chatId] === floors) {
            runtime.settings.autoAnchors[chatId] = anchor;
            runtime.save();
        }
        console.warn('[Theater] Auto generation preparation failed:', error);
        toastr.warning(`自动模式未发起请求：${error?.message || '生成资料读取失败'}`);
    }
}
// @theater-source-end autoTick

// @theater-source-begin setBallDot
function setBallDot(on) {
    const ball = document.getElementById('theater-floating-ball');
    if (!ball) return;
    let dot = ball.querySelector('.theater-ball-dot');
    if (on && !dot) {
        dot = document.createElement('span');
        dot.className = 'theater-ball-dot';
        ball.appendChild(dot);
    }
    if (!on && dot) dot.remove();
}
// @theater-source-end setBallDot

return { currentAutoInstruction, autoSourceKind, pickAutoInstruction, autoTick, setBallDot };
}
