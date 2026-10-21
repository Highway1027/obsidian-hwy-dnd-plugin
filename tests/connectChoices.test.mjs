// tests/connectChoices.test.mjs
// Connect window: tracker order, preselected choice, labels.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let C;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-connect-'));
    const outfile = join(dir, 'connect.mjs');
    await build({ entryPoints: [resolve('src/bridge/connectChoices.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    C = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const now = 1_000 * HOUR;
const tracker = (id, updatedAt, extra = {}) => ({ id, name: id, round: 1, combatantCount: 0, updatedAt, ...extra });

describe('sortTrackers', () => {
    it('puts the newest first and unknown times last', () => {
        const sorted = C.sortTrackers([tracker('old', now - 5 * HOUR), tracker('unknown', 0), tracker('new', now - MIN)]);
        assert.deepEqual(sorted.map(t => t.id), ['new', 'old', 'unknown']);
    });
});

describe('defaultChoice', () => {
    const trackers = [tracker('t1', now), tracker('t2', now)];

    it('preselects the last tracker within 12 hours', () => {
        assert.equal(C.defaultChoice(trackers, { trackerId: 't2', connectedAt: now - HOUR }, now), 't2');
    });

    it('preselects a new tracker when the last connect is old, gone or unknown', () => {
        assert.equal(C.defaultChoice(trackers, { trackerId: 't2', connectedAt: now - 20 * HOUR }, now), C.NEW_TRACKER);
        assert.equal(C.defaultChoice(trackers, { trackerId: 'gone', connectedAt: now - HOUR }, now), C.NEW_TRACKER);
        assert.equal(C.defaultChoice(trackers, { trackerId: '', connectedAt: 0 }, now), C.NEW_TRACKER);
    });
});

describe('labels', () => {
    it('formats ages', () => {
        assert.equal(C.formatAge(now - 10 * 1000, now), 'just now');
        assert.equal(C.formatAge(now - 5 * MIN, now), '5 min ago');
        assert.equal(C.formatAge(now - 2 * HOUR, now), '2 h ago');
        assert.equal(C.formatAge(now - 30 * HOUR, now), '1 day ago');
        assert.equal(C.formatAge(now - 72 * HOUR, now), '3 days ago');
        assert.equal(C.formatAge(0, now), '');
    });

    it('names a new tracker with a DD-MM-YYYY date and 24 h time', () => {
        assert.equal(C.defaultTrackerName(new Date(2026, 9, 21, 14, 8)), 'Combat 21-10-2026 14:08');
    });

    it('describes a tracker', () => {
        assert.equal(C.trackerDetails(tracker('t', now - 2 * HOUR, { round: 3, combatantCount: 5 }), now), 'Round 3 · 5 combatants · updated 2 h ago');
        assert.equal(C.trackerDetails(tracker('t', 0, { combatantCount: 1 }), now), 'Round 1 · 1 combatant');
    });
});
