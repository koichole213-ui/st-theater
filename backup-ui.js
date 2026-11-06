export const BACKUP_TUTORIAL_URL = ''; // Fill only after 禾禾 supplies her illustrated guide.
export const escapeBackup = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
export const BACKUP_LABELS = { instructions: '指令库', history: '普通历史', dreams: '长梦作品', recent: '当前与最近结果' };
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '暂无';
export function backupStatusText(state, kind) {
    const item = state?.[kind];
    if (item?.error) return `最近失败：${item.error}；上次${kind === 'local' ? '发起下载' : '成功'}：${date(item.time)}`;
    return item?.time ? `${kind === 'local' ? '最近发起下载' : '最近上传成功'}：${date(item.time)}` : kind === 'local' ? '尚未发起下载' : '尚未上传';
}
export function backupSettingsHTML(config = {}, state = {}) {
    const e = escapeBackup;
    const toggle = (id, title, checked) => `<label class="theater-config-switch" aria-label="${title}"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span></span></label>`;
    const tutorial = BACKUP_TUTORIAL_URL ? `<a class="theater-backup-guide" href="${e(BACKUP_TUTORIAL_URL)}" target="_blank" rel="noopener noreferrer">不会配置？查看图文教程 ↗</a>` : '<span class="theater-backup-guide">不会配置？图文教程待接入</span>';
    return `<section class="theater-config-card theater-backup-settings" data-config-group="backup" style="order:7"><div class="theater-config-card-title"><span><i class="fa-solid fa-box-archive"></i>备份与恢复</span></div><div class="theater-config-card-body">
    <div class="theater-section">
      <div class="theater-config-setting-row"><span class="theater-config-setting-copy"><b>定期备份</b><small>到期后下次打开小剧场时执行，内容未变化则跳过</small></span>${toggle('theater-backup-enabled','开启定期备份',config.enabled)}</div>
      <label class="theater-config-choice-row"><span><b>备份频率</b><small>关闭酒馆期间不在后台运行</small></span><select id="theater-backup-interval" class="theater-select">${[[1,'每天'],[3,'每三天'],[7,'每周']].map(([n,t]) => `<option value="${n}" ${Number(config.days)===n?'selected':''}>${t}</option>`).join('')}</select></label>
      <details class="theater-config-extra-details"><summary>完整备份包含哪些内容？</summary><div class="theater-config-extra-body"><p class="theater-layout-note">指令及标签、全部历史及版本和文件夹、长梦定梦/正式章节/梦脉与概要、已保存的草稿、当前这一轮待选择的有效候选及明确保留的其他版本，以及当前与最近结果。</p><p class="theater-layout-note">不包含已删除/丢弃的候选、报错空内容或无效残片。恢复后候选仍待选择，不会自动成为正式章节。API 和 GitHub 密钥不进入备份；外部图片与音乐仅保留链接。</p></div></details>
      <p class="theater-backup-protection theater-layout-note" data-backup-protection ${state.protection?'':'hidden'}>${e(state.protection || '')}</p>
    </div>
    <div class="theater-backup-destinations">
      <div class="theater-section"><div class="theater-config-setting-row"><span class="theater-config-setting-copy"><b>保存到本机</b><small>下载到当前手机或电脑</small></span>${toggle('theater-backup-local','启用本机备份',config.local)}</div><p class="theater-layout-note" data-backup-status="local">${e(backupStatusText(state,'local'))}</p><p class="theater-layout-note">浏览器可能要求确认；请在下载记录中核对是否保存。</p><div class="theater-config-api-actions"><button type="button" class="theater-btn" data-backup-action="download">立即下载完整备份</button></div></div>
      <div class="theater-section"><div class="theater-config-setting-row"><span class="theater-config-setting-copy"><b>GitHub 仓库</b><small>保存到自己的专用私有仓库</small></span>${toggle('theater-backup-github','启用GitHub备份',config.github)}</div><p class="theater-layout-note" data-backup-status="github">${e(backupStatusText(state,'github'))}</p><details class="theater-config-extra-details"><summary>仓库与连接设置</summary><div class="theater-config-extra-body">
        <div class="theater-config-field"><label for="theater-backup-repository"><b>仓库</b><small>用户名/仓库名</small></label><input id="theater-backup-repository" class="theater-input" value="${e(config.repository)}" placeholder="用户名/仓库名" autocomplete="off"></div>
        <div class="theater-config-field"><label for="theater-backup-device"><b>当前设备名称</b><small>不同设备分开保存</small></label><input id="theater-backup-device" class="theater-input" maxlength="30" value="${e(config.deviceName)}"></div>
        <div class="theater-config-field"><label for="theater-backup-token"><b>GitHub 访问密钥</b><small>${config.token?'已保存；留空保留原密钥':'尚未填写'}</small></label><input id="theater-backup-token" type="password" class="theater-input" autocomplete="new-password" placeholder="${config.token?'留空保留原密钥':'填写访问密钥'}"></div>
        <p class="theater-layout-note">密钥保存在当前浏览器本地，用于自动上传，不进入备份或诊断。只授权专用备份仓库，并开启 Contents 内容读写权限。</p>
        ${tutorial}<p class="theater-layout-note">教程会介绍创建私有仓库、获取密钥及选择权限范围。</p>
        <div class="theater-config-api-actions"><button type="button" class="theater-btn" data-backup-action="test">测试连接</button><button type="button" class="theater-btn" data-backup-action="clear-key">清除已保存密钥</button></div>
      </div></details><div class="theater-config-api-actions"><button type="button" class="theater-btn" data-backup-action="upload">立即上传</button><button type="button" class="theater-btn" data-theater-restore="all" data-restore-source="github">查看远端备份</button></div></div>
    </div>
    <div class="theater-section"><div class="theater-config-api-actions"><button type="button" class="theater-btn" data-theater-restore="all">恢复备份（可选全部）</button><button type="button" class="theater-btn primary" data-backup-action="save">保存备份设置</button></div><button type="button" class="theater-btn" data-backup-action="recovered">查看找回的当前与最近结果</button><p class="theater-layout-note" data-backup-feedback role="status" aria-live="polite"></p></div>
    </div></section>`;
}
export function backupDiagnosticHTML(state = {}) {
    const e = escapeBackup;
    return `<div class="theater-section theater-backup-diagnostics"><label class="theater-label"><i class="fa-solid fa-box-archive"></i> 备份状态</label><p class="theater-layout-note" data-backup-status="local">${e(backupStatusText(state,'local'))}</p><p class="theater-layout-note" data-backup-status="github">${e(backupStatusText(state,'github'))}</p><p class="theater-layout-note theater-backup-protection" data-backup-protection ${state.protection?'':'hidden'}>${e(state.protection)}</p><div class="theater-btn-row"><button type="button" class="theater-btn" data-backup-action="settings">前往备份设置</button><button type="button" class="theater-btn" data-theater-restore="all">导入备份</button></div><label class="theater-toggle-label"><input type="checkbox" data-backup-confirm-reduction><span>已核对：数据减少是自己删除的</span></label><button type="button" class="theater-btn" data-backup-action="confirmed-backup">确认后为当前内容创建新备份</button></div>`;
}

export function restoreDialog(root, scope) {
    const dialog = document.createElement('dialog');
    dialog.className = 'theater-organize-dialog theater-backup-dialog';
    const e = escapeBackup;
    dialog.innerHTML = `<form><header><div><span class="theater-dialog-note">${scope === 'all' ? '设置' : e(BACKUP_LABELS[scope])} / 备份恢复</span><h2>${scope==='all'?'恢复备份':`导入${e(BACKUP_LABELS[scope])}备份`}</h2></div><button type="button" data-restore-close aria-label="关闭恢复备份">×</button></header><p class="theater-dialog-note">${scope==='all'?'可选择全部或部分内容恢复。':`完整备份包也可使用，此处只恢复${e(BACKUP_LABELS[scope])}。`}</p><div data-restore-body></div><p class="theater-dialog-note theater-backup-error" data-restore-error role="alert"></p></form>`;
    const previousFocus = document.activeElement;
    let writing = false;
    dialog.addEventListener('cancel', event => { if (writing) event.preventDefault(); });
    dialog.querySelector('[data-restore-close]').addEventListener('click', () => { if (!writing) dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());
    dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true}); }, {once:true});
    root.append(dialog); dialog.showModal();
    return {
        element: dialog, body: dialog.querySelector('[data-restore-body]'),
        alive: () => dialog.open && dialog.isConnected,
        error: value => { if (dialog.isConnected) dialog.querySelector('[data-restore-error]').textContent = String(value || ''); },
        writing: value => { writing = value; dialog.querySelector('[data-restore-close]').disabled = value; },
        close: () => dialog.close(),
    };
}
