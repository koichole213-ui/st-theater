import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTheaterEvents } from '../theater-events.js';
import { readSSEStream, readNonStreamingResponse, CUSTOM_STREAM_IDLE_TIMEOUT_MS } from '../api-runtime.js';
import * as response from '../api-response.js';

test('actual event modules bind all feature groups in order and can rebind without accumulating handlers', t => {
    const originals = Object.fromEntries(['$', 'document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => { for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
    const operations = [], handlers = new Map();
    let chain;
    chain = new Proxy(() => chain, { get(_target, key) {
        if (key === 'length') return 0;
        if (key === 'off') return event => { operations.push(['off', event]); for (const name of handlers.keys()) if (name.startsWith(event + '|')) handlers.delete(name); return chain; };
        if (key === 'on') return (event, selector, callback) => {
            operations.push(['on', event, typeof selector === 'string' ? selector : '']);
            handlers.set(event + '|' + (typeof selector === 'string' ? selector : ''), typeof selector === 'function' ? selector : callback); return chain;
        };
        return () => chain;
    } });
    globalThis.$ = () => chain; globalThis.window = {};
    globalThis.document = { querySelector: () => null, addEventListener() {}, removeEventListener() {} };
    let saves = 0;
    const functions = new Map();
    const runtime = new Proxy({ settings: {}, save() { saves++; } }, { get(object, key) {
        if (key in object) return object[key]; if (!functions.has(key)) functions.set(key, () => {}); return functions.get(key);
    } });
    const events = createTheaterEvents(runtime);
    events.bindEvents();
    const first = operations.slice(), count = handlers.size;
    assert.equal(handlers.get('click.tstop|#theater-stop-btn'), runtime.stopGeneration);
    assert.equal(handlers.get('click.tsh|#theater-save-history-btn'), runtime.saveToHistory);
    const selectors = first.filter(item => item[0] === 'on').map(item => item[2]);
    assert.ok(selectors.indexOf('#theater-generate-btn') < selectors.indexOf('#theater-preset-search'));
    assert.ok(selectors.indexOf('#theater-preset-search') < selectors.indexOf('#theater-save-history-btn'));
    assert.ok(selectors.indexOf('#theater-save-history-btn') < selectors.indexOf('#theater-stream-enabled'));
    const streamHandler = handlers.get('change.tstream|#theater-stream-enabled');
    assert.equal(typeof streamHandler, 'function'); streamHandler.call({ checked: false });
    assert.equal(runtime.settings.streamEnabled, false); assert.equal(saves, 1);
    operations.length = 0; events.bindEvents();
    assert.deepEqual(operations, first); assert.equal(handlers.size, count);
    for (const handler of handlers.values()) assert.equal(typeof handler, 'function');
});

test('the original API module keeps response exports and timeout identity', () => {
    assert.equal(readSSEStream, response.readSSEStream);
    assert.equal(readNonStreamingResponse, response.readNonStreamingResponse);
    assert.equal(CUSTOM_STREAM_IDLE_TIMEOUT_MS, response.CUSTOM_STREAM_IDLE_TIMEOUT_MS);
    assert.equal(CUSTOM_STREAM_IDLE_TIMEOUT_MS, 10 * 60 * 1000);
});


test('test-only entry relocation metadata contains comments only and every group is referenced', () => {
    const groups = JSON.parse(readFileSync(new URL('./production-source-map.json', import.meta.url), 'utf8'));
    const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const referenced = [...entry.matchAll(/^\/\/ @theater-source-group (\d+)$/gm)].map(match => match[1]);
    assert.deepEqual(referenced, Object.keys(groups));
    for (const block of Object.values(groups)) for (const line of block.split('\n')) {
        assert.ok(!line.trim() || line.trimStart().startsWith('//'), 'runtime statements must never move into test-only metadata');
    }
});
