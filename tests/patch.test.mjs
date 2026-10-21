// tests/patch.test.mjs
// Sync reliability: bridge writes are patches applied to the newest tracker, so webapp changes are kept.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let P;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-patch-'));
    const outfile = join(dir, 'out.mjs');
    await build({ entryPoints: [resolve('src/bridge/patch.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    P = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

const monster = (id, name, initiative, extra = {}) => ({ id, name, type: 'Monster', initiative, hp: 20, obsidianId: `it_${id}`, ...extra });
const pc = (id, name, initiative, pcId) => ({ id, name, type: 'Player Character', initiative, pcId });

describe('changesBetween', () => {
    it('lists only changed fields, matched by the old identity', () => {
        const before = [monster('a', 'Goblin', 12), monster('b', 'Orc', 8)];
        const after = before.map(c => ({ ...c }));
        after[1].hp = 5;
        after[1].isDead = false;
        const changes = P.changesBetween(before, after);
        assert.deepEqual(changes, [{ match: { id: 'b', obsidianId: 'it_b', name: 'Orc' }, fields: { hp: 5, isDead: false } }]);
    });

    it('sends a removed field as null', () => {
        const before = [monster('a', 'Goblin', 12, { deathRound: 2 })];
        const after = [{ ...before[0], deathRound: undefined }];
        assert.deepEqual(P.changesBetween(before, after)[0].fields, { deathRound: null });
    });
});

describe('applyPatch', () => {
    it('keeps a webapp change made after the bridge read its cache', () => {
        const cache = [monster('a', 'Goblin', 12), monster('b', 'Orc', 8)];
        const edited = cache.map(c => ({ ...c }));
        edited[1].hp = 5;                                        // DM edit in IT
        const patch = { changes: P.changesBetween(cache, edited), add: [] };

        // Meanwhile the webapp gave the Goblin temp HP and added a player.
        const fresh = [{ ...cache[0], tempHp: 5 }, { ...cache[1] }, pc('p', 'Ayla', 15, 'char1')];
        const { combatants, changed } = P.applyPatch(fresh, patch);
        assert.equal(changed, true);
        assert.equal(combatants.find(c => c.id === 'a').tempHp, 5);
        assert.equal(combatants.find(c => c.id === 'b').hp, 5);
        assert.ok(combatants.some(c => c.id === 'p'));
    });

    it('drops a change for a combatant the webapp removed meanwhile', () => {
        const patch = { changes: [{ match: { id: 'gone', name: 'Goblin' }, fields: { hp: 1 } }], add: [] };
        const fresh = [monster('x', 'Goblin', 12)];
        const { combatants, changed } = P.applyPatch(fresh, patch);
        assert.equal(changed, false);
        assert.equal(combatants[0].hp, 20, 'a combatant with the same name is not touched');
    });

    it('matches by linked IT id, then name, when there is no combatant id', () => {
        const fresh = [{ name: 'Goblin', type: 'Monster', initiative: 5, obsidianId: 'it_1' }, { name: 'Orc', type: 'Monster', initiative: 3 }];
        const patch = { changes: [
            { match: { obsidianId: 'it_1', name: 'renamed' }, fields: { hp: 3 } },
            { match: { name: 'Orc' }, fields: { obsidianId: 'it_2' } },
        ], add: [] };
        const { combatants } = P.applyPatch(fresh, patch);
        assert.equal(combatants[0].hp, 3);
        assert.equal(combatants[1].obsidianId, 'it_2');
    });

    it('adds a new combatant only once', () => {
        const goblin = monster('obs_1', 'Goblin', 12);
        const fresh = [goblin];
        const patch = { changes: [], add: [{ ...goblin, id: 'obs_1_other' }, monster('obs_2', 'Orc', 9)] };
        const { combatants } = P.applyPatch(fresh, patch);
        assert.deepEqual(combatants.map(c => c.name), ['Goblin', 'Orc'], 'same IT creature is not added twice');

        const twice = P.applyPatch(fresh, { changes: [], add: [pc('p1', 'Ayla', 10, 'char1')] });
        const again = P.applyPatch(twice.combatants, { changes: [], add: [pc('p2', 'Ayla', 10, 'char1')] });
        assert.equal(again.combatants.filter(c => c.pcId === 'char1').length, 1, 'a PC is added once');
        assert.equal(again.changed, false);
    });

    it('sets sortIndex like the webapp when something changed', () => {
        const fresh = [monster('a', 'Goblin', 5), monster('b', 'Orc', 8)];
        const { combatants } = P.applyPatch(fresh, { changes: [{ match: { id: 'a', name: 'Goblin' }, fields: { initiative: 20 } }], add: [] });
        assert.equal(combatants.find(c => c.id === 'a').sortIndex, 0);
        assert.equal(combatants.find(c => c.id === 'b').sortIndex, 1);
    });

    it('works out the turn on the final list', () => {
        const fresh = [monster('a', 'Goblin', 15), monster('b', 'Orc', 10)];
        const patch = { changes: [], add: [monster('c', 'Bugbear', 20)], turnTo: 'b' };
        const { turn } = P.applyPatch(fresh, patch);
        assert.equal(turn, 2, 'Bugbear (20) and Goblin (15) go first');
        assert.equal(P.applyPatch(fresh, { changes: [], add: [], turnTo: 'missing' }).turn, null);
    });

    it('an unchanged list is reported as unchanged', () => {
        const fresh = [monster('a', 'Goblin', 15)];
        const { changed } = P.applyPatch(fresh, { changes: [{ match: { id: 'a', name: 'Goblin' }, fields: { hp: 20 } }], add: [] });
        assert.equal(changed, false);
        assert.equal(P.isEmptyPatch({ changes: [], add: [], turnTo: null }), true);
    });
});
