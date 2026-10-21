// tests/itSnapshot.test.mjs
// Sync reliability: the bridge's own IT changes go into the snapshot; the DM's pending edits do not.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let S;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-snap-'));
    const outfile = join(dir, 'out.mjs');
    await build({ entryPoints: [resolve('src/bridge/itSnapshot.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    S = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

const creature = (id, name, extra = {}) => ({ id, name, hp: 20, initiative: 10, hidden: false, active: false, player: false, ...extra });
const snap = (list) => S.takeSnapshot(list, c => c.name);

describe('takeSnapshot', () => {
    it('reads the fields the bridge compares', () => {
        const s = snap([creature('a', 'Goblin 1', { player: undefined, hp: undefined })]);
        assert.deepEqual(s.get('a'), { name: 'Goblin 1', hp: 0, initiative: 10, hidden: false, active: false, player: false });
    });
});

describe('foldOwnChanges', () => {
    it('keeps a DM edit that was not sent yet, next to a bridge change on another field', () => {
        const snapshot = snap([creature('a', 'Goblin')]);              // what the webapp knows
        const live = creature('a', 'Goblin', { hp: 12 });              // DM edit, not sent yet
        const before = snap([live]);
        live.active = true;                                            // bridge applies a webapp turn
        S.foldOwnChanges(snapshot, before, snap([live]));
        assert.equal(snapshot.get('a').active, true, 'the bridge change is known');
        assert.equal(snapshot.get('a').hp, 20, 'the DM edit still differs, so it is sent');
    });

    it('takes in creatures the bridge added and drops ones it removed', () => {
        const snapshot = snap([creature('a', 'Goblin'), creature('b', 'Orc')]);
        S.foldOwnChanges(snapshot, snap([creature('a', 'Goblin'), creature('b', 'Orc')]), snap([creature('a', 'Goblin'), creature('c', 'Ayla', { player: true })]));
        assert.deepEqual([...snapshot.keys()].sort(), ['a', 'c']);
    });

    it('leaves out a creature the DM added and the bridge only touched', () => {
        const snapshot = snap([creature('a', 'Goblin')]);
        const before = snap([creature('a', 'Goblin'), creature('d', 'Wolf')]);
        const after = snap([creature('a', 'Goblin'), creature('d', 'Wolf', { initiative: 3 })]);
        S.foldOwnChanges(snapshot, before, after);
        assert.equal(snapshot.has('d'), false, 'still new, so it is sent to the webapp');
    });

    it('changes nothing when the bridge changed nothing', () => {
        const snapshot = snap([creature('a', 'Goblin')]);
        const same = snap([creature('a', 'Goblin', { hp: 3 })]);
        S.foldOwnChanges(snapshot, same, same);
        assert.equal(snapshot.get('a').hp, 20);
    });
});
