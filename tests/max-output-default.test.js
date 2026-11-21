import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_SCHEMA } from '../api-client.js';
import { migrateMaxOutputDefault } from '../api-presets.js';
import { readTheaterImplementation } from './theater-source.js';

// 单轮输出上限默认 16384 → 32768（禾禾 2026-11-21）：只调还停在旧默认值的，自己改过的不动。
test('max output default: 32768, schema 3', () => {
    assert.equal(DEFAULT_MAX_OUTPUT_TOKENS, 32768);
    assert.equal(MAX_OUTPUT_TOKENS_SCHEMA, 3);
});

test('migration: schema 2 users still on 16384 move to 32768, custom values stay', () => {
    for (const [from, to] of [[16384, 32768], [8192, 8192], [4096, 4096], [65536, 65536], [131072, 131072]]) {
        const settings = { maxOutputTokens: from, maxOutputTokensSchema: 2, apiPresets: [] };
        migrateMaxOutputDefault(settings);
        assert.equal(settings.maxOutputTokens, to, String(from));
        assert.equal(settings.maxOutputTokensSchema, 3);
    }
});

test('migration: very old settings without a schema treat 8192 and 16384 as defaults', () => {
    for (const [from, to] of [[8192, 32768], [16384, 32768], [12000, 12000]]) {
        const settings = { maxOutputTokens: from, apiPresets: [] };
        const changed = migrateMaxOutputDefault(settings);
        assert.equal(settings.maxOutputTokens, to, String(from));
        assert.equal(changed.settings, to === from ? null : from);
    }
});

test('migration: API presets saved at 16384 move too; runs only once', () => {
    const settings = { maxOutputTokens: 20000, maxOutputTokensSchema: 2, apiPresets: [
        { id: 'a', maxOutputTokens: 16384 }, { id: 'b', maxOutputTokens: 8192 }, { id: 'c', maxOutputTokens: 65536 },
    ] };
    const changed = migrateMaxOutputDefault(settings);
    assert.deepEqual(changed, { settings: null, presets: 1 });
    assert.deepEqual(settings.apiPresets.map(p => p.maxOutputTokens), [32768, 8192, 65536]);
    assert.equal(settings.maxOutputTokens, 20000);
    settings.maxOutputTokens = 16384; // 之后用户自己改回 16384：不再动
    assert.equal(migrateMaxOutputDefault(settings), null);
    assert.equal(settings.maxOutputTokens, 16384);
});

test('init reads the schema before defaults are merged in', () => {
    const source = readTheaterImplementation();
    const before = source.indexOf('const maxOutputSchemaBefore');
    const merge = source.indexOf('if (!hasOwn(extensionSettings[MODULE_NAME], k)) extensionSettings[MODULE_NAME][k] = defaultSettings[k];');
    const migrate = source.indexOf('migrateMaxOutputDefault(settings)');
    assert.ok(before > 0 && merge > before && migrate > merge);
});
