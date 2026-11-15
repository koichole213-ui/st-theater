// 从 core.test.js 拆出：history-backup
import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_ARCHIVE_MANIFEST, createHistoryArchive, createHistoryJsonBackup, historyItemsFromArchive, normalizeHistoryBackup } from '../history-backup.js';

test('历史 ZIP 清单保留元数据并为重名小剧场生成唯一 HTML 文件名', () => {
    const source = [
        {
            title: '同名', date: '2026/07/28 10:00', instruction: '第一条指令', html: '<html>甲</html>', mode: 'html',
            sourceConfig: {
                metadataCaptured: true,
                presetName: '长篇预设',
                selectedWorldBooks: ['人物设定'],
                readChatContext: true,
                contextRange: 20,
                renderSelection: '__default__',
                renderLabel: '内置默认',
                textTheme: 'light',
            },
        },
        { title: '同名', date: '2026/07/28 10:01', instruction: '第二条指令', tags: ['刀子', '角色甲'], html: '<html>乙</html>', mode: 'text-dark' },
    ];
    const archive = createHistoryArchive(source);
    assert.equal(HISTORY_ARCHIVE_MANIFEST, 'theater-history.json');
    assert.equal(archive.files.length, 2);
    assert.notEqual(archive.files[0].name, archive.files[1].name);
    assert.equal(archive.manifest.items[1].instruction, '第二条指令');
    assert.equal(archive.manifest.items[1].mode, 'text-dark');
    assert.deepEqual(archive.manifest.items[1].tags, ['刀子', '角色甲']);
    assert.equal(archive.manifest.items[0].sourceConfig.renderLabel, '内置默认');
    const restored = historyItemsFromArchive(archive.manifest, archive.files);
    assert.deepEqual(restored, normalizeHistoryBackup(source));
});

test('历史导入兼容旧 JSON、带清单的新 JSON 和只有 HTML 的旧 ZIP', () => {
    const oldJson = [{ title: '旧 JSON', html: '<html>旧内容</html>' }];
    assert.equal(normalizeHistoryBackup(oldJson)[0].title, '旧 JSON');
    const newJson = createHistoryJsonBackup([{ title: '新 JSON', html: '<html>新内容</html>', mode: 'text' }]);
    assert.equal(normalizeHistoryBackup(newJson)[0].mode, 'text');
    const legacyZipItems = historyItemsFromArchive(null, [
        { name: '2026-07-28_旧版导出.html', html: '<html>ZIP 内容</html>' },
    ]);
    assert.equal(legacyZipItems[0].title, '旧版导出');
    assert.equal(legacyZipItems[0].date, '2026/07/28');
    assert.equal(legacyZipItems[0].html, '<html>ZIP 内容</html>');
});
