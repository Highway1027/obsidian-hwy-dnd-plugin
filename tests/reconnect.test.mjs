// tests/reconnect.test.mjs
// One-click reconnect from the IT pane button: only the last tracker, only shortly after the last connect.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let R;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-reconnect-'));
    const outfile = join(dir, 'reconnect.mjs');
    await build({ entryPoints: [resolve('src/bridge/reconnect.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    R = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;
const now = 1_000 * HOUR;
const trackers = [{ id: 't1', name: 'Goblin ambush' }, { id: 't2', name: 'Dragon' }];

describe('quickReconnectTarget', () => {
    it('reconnects to the last tracker shortly after the last connect', () => {
        const target = R.quickReconnectTarget({ trackerId: 't2', connectedAt: now - 2 * HOUR }, trackers, now);
        assert.equal(target?.id, 't2');
    });

    it('asks instead when the last connect is too long ago (next session)', () => {
        assert.equal(R.quickReconnectTarget({ trackerId: 't2', connectedAt: now - 13 * HOUR }, trackers, now), null);
    });

    it('asks instead when the last tracker was deleted', () => {
        assert.equal(R.quickReconnectTarget({ trackerId: 'gone', connectedAt: now - HOUR }, trackers, now), null);
    });

    it('asks instead when there is no last tracker (never connected, or a new encounter)', () => {
        assert.equal(R.quickReconnectTarget({ trackerId: '', connectedAt: 0 }, trackers, now), null);
        assert.equal(R.quickReconnectTarget({ trackerId: 't1', connectedAt: 0 }, trackers, now), null);
    });
});
