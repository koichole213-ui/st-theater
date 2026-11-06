import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVersion } from '../version-check.js';
import { createTheaterUpdate } from '../theater-update.js';

const ordered = ['4.4.4', '4.4.5', '4.4.5a', '4.4.5b', '4.4.5z', '4.4.5aa', '4.4.6', '4.4.6e', '4.4.7', '4.4.7a', '4.4.7b', '4.4.10', '4.5.0', '5.0.0'];
test('numeric releases and successive preview letters have a stable total order', () => {
    for (let a = 0; a < ordered.length; a++) for (let b = 0; b < ordered.length; b++) {
        assert.equal(compareVersion(ordered[a], ordered[b]), Math.sign(a - b), `${ordered[a]} vs ${ordered[b]}`);
    }
    assert.equal(compareVersion('4.4.5A', '4.4.5a'), 0);
    assert.equal(compareVersion(' 4.4.5b ', '4.4.5a'), 1);
    assert.equal(compareVersion('4.4', '4.4.0'), 0);
    assert.equal(compareVersion('4.4.5a', '4.4.5.0a'), 0);
});

test('published version is identical in manifest and the actual runtime entry', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(manifest.version, '4.4.7a');
    assert.equal(source.match(/const VERSION = '([^']+)';/)[1], manifest.version);
});

test('branch status stays authoritative while numeric fallback handles preview letters correctly', () => {
    const runtime = { VERSION: '4.4.5a', latestRemoteVersion: '4.4.5', installedBranchStatusKnown: false };
    const update = createTheaterUpdate(runtime);
    assert.equal(update.hasRemoteUpdate(), false);
    runtime.latestRemoteVersion = '4.4.5b';
    assert.equal(update.hasRemoteUpdate(), true);
    runtime.latestRemoteVersion = '4.4.6';
    assert.equal(update.hasRemoteUpdate(), true);
    runtime.installedBranchStatusKnown = true; runtime.installedBranchHasUpdate = false;
    assert.equal(update.hasRemoteUpdate(), false);
    runtime.installedBranchHasUpdate = true; runtime.latestRemoteVersion = '4.4.5';
    assert.equal(update.hasRemoteUpdate(), true);
});
