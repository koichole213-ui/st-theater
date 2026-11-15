import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLongDreamWorkspace } from '../long-dream-workspace.js';

const PARTS = ['long-dream-workspace.js', 'long-dream-workspace-library.js', 'long-dream-workspace-create.js', 'long-dream-workspace-memory.js'];
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// 长梦工作区拆成了几个文件：一个文件里用到别的文件的函数（包括写在参数默认值里的），
// 必须在本文件里有转发，否则运行到那里才报“未定义”。
test('长梦工作区各部分用到的函数都有定义或转发，包括参数默认值里的', () => {
    const sources = Object.fromEntries(PARTS.map(file => [file, read(file)]));
    const names = new Set(Object.values(sources).flatMap(src => [...src.matchAll(/^\s*(?:async )?function (\w+)\(/gm)].map(m => m[1])));
    assert.ok(names.size >= 81);
    for (const [file, src] of Object.entries(sources)) {
        const defined = new Set([
            ...[...src.matchAll(/^(?:async )?function (\w+)\(/gm)].map(m => m[1]),
            ...[...src.matchAll(/^const (\w+) = \(\.\.\.args\) => ws\.\1\(\.\.\.args\);$/gm)].map(m => m[1]),
            ...(src.match(/^const \{ ([^}]+) \} = ws;$/m)?.[1].split(', ') || []),
        ]);
        // 只去掉独占一行或前面有空白的 // 注释（网址里的 // 前面是冒号，不会被当成注释）；字符串不去掉，宁可多报。
        const code = src.replace(/(^|\s)\/\/.*$/gm, '$1');
        const missing = [...names].filter(name => !defined.has(name) && new RegExp(`\\b${name}\\b`).test(code));
        assert.deepEqual(missing, [], `${file} 缺少转发`);
    }
});

test('真实组装的长梦工作区：打开窗口时不带参数刷新新建页世界书状态不会报错', () => {
    const saved = { $: globalThis.$, document: globalThis.document };
    let html = null;
    globalThis.$ = () => ({ val: () => 'missing-source' });
    globalThis.document = { getElementById: id => (id === 'theater-dream-world-book-state' ? { set innerHTML(value) { html = value; } } : null) };
    try {
        const runtime = { settings: {}, esc: value => String(value ?? ''), longDreamCache: [], historyCache: [], recentCache: [], historyCollections: [],
            histSelected: new Set(), knownInstructionTags: () => [], htmlToPlainText: () => '' };
        const workspace = createLongDreamWorkspace(runtime);
        assert.doesNotThrow(() => workspace.refreshLongDreamCreateWorldBookState());
        assert.equal(typeof html, 'string');
    } finally {
        globalThis.$ = saved.$;
        globalThis.document = saved.document;
    }
});
