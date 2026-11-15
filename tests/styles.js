import { readFileSync } from 'node:fs';

// style.css 只是入口，真正的样式按顺序拆在 css/ 下。
// 测试要看“浏览器最终拿到的全部样式”，就按 @import 的顺序拼回一整份。
export function readStyles() {
    const entry = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    return entry.replace(/^@import url\('([^']+)'\);\n/gm, (_, path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
}
