export const BACKUP_TUTORIAL_URL = 'https://docs.google.com/document/d/1wsqCEkfX0gwvds4ajVY9mCsAknUqBnqOWPDxff0Rvss/edit?usp=sharing';
export const escapeBackup = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
export const BACKUP_LABELS = { instructions: '指令库', history: '普通历史', dreams: '长梦作品', recent: '当前与最近结果' };
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '暂无';
export const isBackupReduction = state => /从\s*\d+\s*变为\s*\d+/.test(state?.protection || '');
export function backupStatusText(state, kind) {
    const item = state?.[kind];
    if (item?.error) return `最近失败：${item.error}；上次${kind === 'local' ? '发起下载' : '成功'}：${date(item.time)}`;
    return item?.time ? `${kind === 'local' ? '最近发起下载（浏览器无法确认是否保存成功）' : '最近上传成功'}：${date(item.time)}` : kind === 'local' ? '尚未发起下载' : '尚未上传';
}
export function backupSettingsHTML(config = {}, state = {}, { recoveredCount = 0 } = {}) {
    const e = escapeBackup;
    const toggle = (id, title, checked) => `<label class="theater-config-switch" aria-label="${title}"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span></span></label>`;
    const tutorial = BACKUP_TUTORIAL_URL ? `<a class="theater-backup-guide" href="${e(BACKUP_TUTORIAL_URL)}" target="_blank" rel="noopener noreferrer">图文教程 ↗</a>` : '<span class="theater-backup-guide">图文教程（待接入）</span>';
    return `<section class="theater-config-card theater-backup-settings" data-config-group="backup" style="order:7"><div class="theater-config-card-title"><span><i class="fa-solid fa-box-archive"></i>备份与恢复</span></div><div class="theater-config-card-body">
      <div class="theater-config-api-actions theater-backup-main-actions"><button type="button" class="theater-btn" data-backup-action="download"><i class="fa-solid fa-download"></i>下载备份</button><button type="button" class="theater-btn" data-theater-restore="all"><i class="fa-solid fa-box-archive"></i>恢复备份</button></div>
      <button type="button" class="theater-btn archive-find" data-backup-action="find-archives"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>查找旧存档</button>
      <div class="theater-section"><div class="theater-config-setting-row"><label class="theater-config-setting-copy" for="theater-backup-enabled"><b>定期备份</b></label>${toggle('theater-backup-enabled','开启定期备份',config.enabled)}</div>
      <div class="theater-backup-schedule" data-backup-schedule ${config.enabled?'':'hidden'}><label class="theater-config-choice-row"><span><b>备份频率</b></span><select id="theater-backup-interval" class="theater-select">${[[1,'每天'],[3,'每三天'],[7,'每周']].map(([n,t]) => `<option value="${n}" ${Number(config.days)===n?'selected':''}>${t}</option>`).join('')}</select></label><p class="theater-layout-note">到期后打开小剧场时备份，内容没变就跳过。</p></div></div>
      <p class="theater-backup-protection theater-layout-note" data-backup-protection ${state.protection?'':'hidden'}>${e(state.protection || '')}</p>
      <div class="theater-section theater-backup-destination"><div class="theater-config-setting-row"><label class="theater-config-setting-copy" for="theater-backup-local"><b>定期下载到本机</b></label>${toggle('theater-backup-local','定期下载到本机',config.local)}</div><p class="theater-layout-note" data-backup-status="local">${e(backupStatusText(state,'local'))}</p></div>
      <div class="theater-section theater-backup-destination"><div class="theater-config-setting-row"><label class="theater-config-setting-copy" for="theater-backup-github"><b>定期上传到 GitHub</b></label>${toggle('theater-backup-github','定期上传到GitHub',config.github)}</div><p class="theater-layout-note" data-backup-status="github">${e(backupStatusText(state,'github'))}</p><div class="theater-config-api-actions theater-backup-equal-actions"><button type="button" class="theater-btn" data-backup-action="upload">立即上传</button><button type="button" class="theater-btn" data-theater-restore="all" data-restore-source="github">远端备份</button></div>
      <details class="theater-config-extra-details"><summary>连接设置<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="theater-config-extra-body">
        <div class="theater-config-field"><label for="theater-backup-repository"><b>私有仓库</b></label><input id="theater-backup-repository" class="theater-input" value="${e(config.repository)}" placeholder="用户名/仓库名" autocomplete="off"></div>
        <div class="theater-config-field"><label for="theater-backup-device"><b>设备名称</b></label><input id="theater-backup-device" class="theater-input" maxlength="30" value="${e(config.deviceName)}"></div>
        <div class="theater-config-field"><label for="theater-backup-token"><b>访问密钥</b></label><input id="theater-backup-token" type="password" class="theater-input" autocomplete="new-password" placeholder="${config.token?'密钥已保存，留空保留':'填写访问密钥'}"></div>
        <div class="theater-config-api-actions"><button type="button" class="theater-btn" data-backup-action="test">测试连接</button><button type="button" class="theater-btn" data-backup-action="clear-key">清除密钥</button></div><p class="theater-layout-note theater-backup-connection-feedback" data-backup-connection-feedback role="status" aria-live="polite" hidden></p>${tutorial}<p class="theater-layout-note">密钥仅存本机；仅授权备份仓库的 Contents 读写权限。</p>
      </div></details></div>
      <details class="theater-config-extra-details theater-backup-about"><summary>备份内容<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="theater-config-extra-body"><p class="theater-layout-note">包含指令库、普通历史、长梦、当前与最近结果，以及已有版本和已保存草稿。长梦候选恢复后仍待选择。密钥不打包，外部图片与音乐保留链接。</p></div></details>
      <div class="theater-config-api-actions theater-backup-settings-footer"><button type="button" class="theater-btn" data-backup-action="recovered" data-backup-recovered ${recoveredCount?'':'hidden'}>查看找回的结果</button><button type="button" class="theater-btn primary" data-backup-action="save">保存设置</button></div><p class="theater-layout-note" data-backup-feedback role="status" aria-live="polite" hidden></p>
    </div></section>`;
}
export function backupDiagnosticHTML(state = {}) {
    const e = escapeBackup;
    return `<div class="theater-section theater-backup-diagnostics"><label class="theater-label"><i class="fa-solid fa-box-archive"></i> 备份状态</label><div class="theater-backup-status-row"><b>本机</b><span data-backup-status="local">${e(backupStatusText(state,'local'))}</span></div><div class="theater-backup-status-row"><b>GitHub</b><span data-backup-status="github">${e(backupStatusText(state,'github'))}</span></div><div class="theater-btn-row theater-backup-equal-actions"><button type="button" class="theater-btn" data-backup-action="settings">备份设置</button><button type="button" class="theater-btn" data-theater-restore="all">恢复备份</button></div>
      <div class="theater-backup-protection-panel" data-backup-protection-panel ${state.protection?'':'hidden'}><p class="theater-layout-note theater-backup-protection" data-backup-protection>${e(state.protection)}</p><details class="theater-config-extra-details" data-backup-reduction-controls ${isBackupReduction(state)?'':'hidden'}><summary>确认是自己删除的？<i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="theater-config-extra-body"><label class="theater-toggle-label"><input type="checkbox" data-backup-confirm-reduction><span>已核对，是我主动删除的</span></label><button type="button" class="theater-btn" data-backup-action="confirmed-backup" disabled>为当前内容创建新备份</button></div></details></div></div>`;
}

export function restoreDialog(root, scope, { title } = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'theater-organize-dialog theater-backup-dialog';
    const e = escapeBackup;
    dialog.innerHTML = `<form><header><h2>${title?e(title):scope==='all'?'恢复备份':`导入${e(BACKUP_LABELS[scope])}备份`}</h2><button type="button" data-restore-close aria-label="${e(title?`关闭${title}`:'关闭恢复备份')}">×</button></header><p class="theater-dialog-note" data-restore-progress role="status" aria-live="polite" hidden></p><p class="theater-dialog-note theater-backup-error" data-restore-error role="alert" hidden></p><div data-restore-body></div></form>`;
    const previousFocus = document.activeElement;
    let writing = false;
    dialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
    dialog.querySelector('[data-restore-close]').addEventListener('click', () => { if (!writing) dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());
    dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true}); }, {once:true});
    root.append(dialog); dialog.showModal();
    const message = (selector, value) => { if (dialog.isConnected) { const el=dialog.querySelector(selector);el.textContent=String(value||'');el.hidden=!value; } };
    return {
        element: dialog, body: dialog.querySelector('[data-restore-body]'),
        alive: () => dialog.open && dialog.isConnected,
        error: value => message('[data-restore-error]',value),
        status: value => message('[data-restore-progress]',value),
        writing: value => { writing = value; dialog.querySelector('[data-restore-close]').disabled = value; },
        close: () => dialog.close(),
    };
}
