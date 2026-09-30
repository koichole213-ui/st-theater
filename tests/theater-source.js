import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

let implementation;

// Existing behavioral fixtures execute selected production functions in an isolated
// browser sandbox. Follow relocation markers to read those exact function bodies;
// do not change the moved code or replace it with a test implementation.
export function readTheaterImplementation() {
    if (implementation) return implementation;
    const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    implementation = entry.replace(/^\/\/ @theater-source (\S+) (\w+)$/gm, (_, file, name) => {
        const module = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        const begin = `// @theater-source-begin ${name}\n`;
        const end = `// @theater-source-end ${name}`;
        const start = module.indexOf(begin);
        const finish = module.indexOf(end, start);
        if (start < 0 || finish < 0) throw new Error(`Missing production function: ${file}:${name}`);
        return module.slice(start + begin.length, finish).replace(/^export /gm, '').trimEnd();
    });
    return implementation;
}

// A factory receives live bindings to the same sandbox state used by the older
// fixtures. This preserves their assertions about writes, identity and failures.
export function runInNewContext(code, sandbox = {}, options) {
    const context = createContext(sandbox);
    const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const bindings = entry.slice(entry.indexOf('const runtime = {'), entry.indexOf('\n};', entry.indexOf('const runtime = {')) + 3);
    // Compile the production accessors in the fixture's lexical environment, so
    // they can also see its top-level let/const declarations, not only properties.
    sandbox.runtime = runInContext(bindings.replace('const runtime = ', '(').replace(/;$/, ')'), context);
    return runInContext(code, context, options);
}
