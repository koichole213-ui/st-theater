// Published releases. Fold preview iterations into the next published entry.
export const RELEASE_NOTES = Object.freeze([
    { version: '4.4.4', date: '2026.10.28', label: '测试版', changes: [
        ['测试', '按需更新，欢迎反馈', '本次为测试版本，建议此前反馈过相关问题的用户更新测试；目前使用正常的用户可以暂不更新。'],
        ['调整', '长梦分轮与收束安排', '目标达到 5000 字、开启自动补写且允许至少两轮时，新章先写前半部分，再接续收束；已有同章草稿直接承接。可能增加等待和用量，仍不能保证字数达标或结尾绝不截断。'],
        ['兼容', '主 API 慢回复多等一会儿', '主 API 兼容路径最长等待从 5 分钟延长至 15 分钟，停止按钮仍可随时结束插件等待，不增加自动重试。'],
        ['修复', '辅助请求、正文识别与预设适配', '辅助请求跟随所选预设额度和流式开关；修正部分空响应被误当正文的情况，并改善普通生成与续写的预设变量、思考及附加输出处理。失败时保留已有内容。'],
    ] },
    { version: '4.4.3', date: '2026.10.20', changes: [
        ['新增', '独立 HTML 排版 API', '在设置中的独立卡片开启并选择已保存的 API 预设，将原有的独立排版交给所选线路。默认关闭；正文生成和一次性正文加 HTML 的流程保持不变。'],
        ['保护', '排版失败保留正文，可以单独重试', '普通结果可重试或停止 HTML 排版，无需重新生成正文；手改正文并成功保存后，旧排版任务会失效，避免覆盖修改。'],
        ['新增', '设置里可以查看更新日志', '检查更新按钮下方新增更新日志，随插件内置，无需联网。最多保留最近 5 个正式版本，查看后清除未读提示，不自动弹窗。'],
    ] },
    { version: '4.4.2', date: '2026.10.19', changes: [
        ['新增', '创作增强，可按需开启', '在「设置 → 生成控制」开启，为正文加入虚构叙事约定。默认关闭，不额外发起请求。'],
        ['新增', '长梦概要可以直接修改', '在长梦概要区进入编辑，自行选择已有分章；只有整篇概要时，直接编辑整篇。打开即带入原文。'],
        ['保护', '手改概要保留，保存前留旧版', '取消不写入。后续更新保留有效手稿；事实纠错后，手稿会保留并提示核对。'],
    ] },
    { version: '4.4.1', date: '2026.10.18', changes: [
        ['新增', '普通续写文件夹可以带入长梦', '在长梦选择作品时选择已有文件夹，按原章节顺序带入，并保留正文与原 HTML。'],
        ['优化', '大篇幅普通续写先完成正文，再排版', '新增目标达到 5000 字时，先完成正文，再统一套用所选 HTML 模板。原文承接和新增字数口径保持一致。'],
        ['新增', '历史记录支持导入 HTML / HTM', '可将已有 HTML 文件导入历史，保留原有排版。'],
        ['保护', '存档读取失败时保护已有内容', '各类存档分别读取；读取失败会明确提示，避免把失败误当作空记录并覆盖。'],
    ] },
    { version: '4.4.0', date: '', changes: [
        ['优化', '普通续写更方便比较和接写', '可以查看本段不同版本、重写本段，再接着选定版本继续写。'],
        ['优化', '长梦续章与候选保留', '新章先进入待确认区，可比较候选后再确认；未完成内容保留供后续继续。'],
    ] },
].slice(0, 5));

export function releaseNotesHTML(esc) {
    return RELEASE_NOTES.map((release, index) => {
        const content = `<ul>${release.changes.map(([kind, title, text]) => `<li><span class="theater-change-kind">${esc(kind)}</span><div><b>${esc(title)}</b><p>${esc(text)}</p></div></li>`).join('')}</ul>`;
        if (!index) return `<article class="theater-release"><header><h3>v${esc(release.version)} <span>${esc(release.label || '最新正式版')}</span></h3><time>${esc(release.date)}</time></header>${content}</article>`;
        return `<details class="theater-release theater-release-previous"><summary><b>v${esc(release.version)}</b><small>${esc(release.date)}</small><i class="fa-solid fa-chevron-down"></i></summary>${content}</details>`;
    }).join('');
}

export function latestReleaseVersion() { return RELEASE_NOTES[0]?.version || ''; }
export function hasUnreadRelease(settings) { return settings?.releaseNotesReadVersion !== latestReleaseVersion(); }

export function bindReleaseNotes($d, runtime) {
    $d.off('click.treleasenotes').on('click.treleasenotes', '#theater-release-notes-toggle', function () {
        const open = $(this).attr('aria-expanded') !== 'true';
        $(this).attr('aria-expanded', String(open));
        $('#theater-release-notes-content').prop('hidden', !open);
        if (open) {
            runtime.settings.releaseNotesReadVersion = latestReleaseVersion();
            $('#theater-release-notes-dot').prop('hidden', true);
            runtime.save();
        }
    });
}
