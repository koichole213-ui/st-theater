import { restoreStorySummary } from './long-dream-story-summary.js';

// Explain existing guards without changing which versions can be restored.
export function summaryUnavailableReason(record, busy = false, versionId = null) {
    const memory = record?.memory;
    if (!memory) return '未找到当前作品，请重新打开后再试。';
    if (busy) return '概要正在更新，完成后会重新检查可恢复的版本。';
    if (memory.status === 'weaving') return '梦脉正在织录，完成后会重新检查概要操作。';
    if (memory.pendingConflicts?.length) return '还有梦脉冲突待确认。处理完冲突后，再检查可恢复的版本。';
    if (memory.pendingChapterNumbers?.length) return '还有已保存章节待织录。完成织录后，才能更新或恢复概要。';
    if (versionId !== null) {
        const version = memory.summaryVersions?.find(item => item.id === versionId);
        if (version?.canRestore === false) return '用户决定已改变，这版仅供查看。';
        try { restoreStorySummary(record, versionId); }
        catch { return '这版概要对应的正文已改变或记录不完整，不能恢复。'; }
    }
    return '';
}
