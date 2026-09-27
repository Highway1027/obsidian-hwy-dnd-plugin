// tests/linking.test.mjs
// v1 - 27-09-2026 - Link pass scenarios: reconnect after restart, new encounter, name variants
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let L;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-linking-'));
    const outfile = join(dir, 'linking.mjs');
    await build({ entryPoints: ['src/bridge/linking.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    L = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

const it_ = (id, name, extra = {}) => ({ id, name, displayName: extra.displayName ?? name, player: false, ...extra });
const player = (id, name, extra = {}) => it_(id, name, { player: true, ...extra });
const pcCombatant = (characterId, name, extra = {}) => ({ id: characterId, pcId: characterId, name, type: 'Player Character', initiative: 12, ...extra });
const monster = (id, name, extra = {}) => ({ id, name, type: 'Monster', initiative: 10, ...extra });

describe('reconnect next session (Obsidian restarted)', () => {
    it('repairs stale player ids by name instead of adding the PCs again', () => {
        const combatants = [
            pcCombatant('c1', 'Ayla', { obsidianId: 'old-ayla' }),
            pcCombatant('c2', 'Bram', { obsidianId: 'old-bram' }),
            monster('m1', 'Goblin 1', { obsidianId: 'g1' }),
        ];
        const creatures = [player('new-ayla', 'Ayla'), player('new-bram', 'Bram'), it_('g1', 'Goblin', { displayName: 'Goblin 1' })];
        const plan = L.planLinks(combatants, creatures, []);

        assert.deepEqual(plan.relinks, [{ index: 0, obsidianId: 'new-ayla' }, { index: 1, obsidianId: 'new-bram' }]);
        assert.equal(plan.newPcCombatants.length, 0);
        assert.deepEqual(plan.unlinkedPlayers, []);
    });

    it('links the DM\'s IT party name to the webapp\'s full character name', () => {
        const combatants = [pcCombatant('c1', 'Ayla Moonwhisper', { obsidianId: 'stale' })];
        const creatures = [player('p1', 'Ayla')];
        const plan = L.planLinks(combatants, creatures, [{ characterId: 'c1', name: 'Ayla Moonwhisper' }]);

        assert.deepEqual(plan.relinks, [{ index: 0, obsidianId: 'p1' }]);
        assert.equal(plan.newPcCombatants.length, 0, 'no second Ayla');
    });

    it('keeps valid ids untouched and relinks a numbered monster by name', () => {
        const combatants = [monster('m1', 'Goblin 1', { obsidianId: 'g1' }), monster('m2', 'Goblin 2', { obsidianId: 'gone' })];
        const creatures = [
            it_('g1', 'Goblin', { displayName: 'Goblin 1' }),
            it_('g2', 'Goblin', { displayName: 'Goblin 2' }),
        ];
        const plan = L.planLinks(combatants, creatures, []);
        assert.deepEqual(plan.relinks, [{ index: 1, obsidianId: 'g2' }]);
    });
});

describe('new encounter: players kept in Initiative Tracker', () => {
    const caravan = [
        { characterId: 'c1', name: 'Ayla Moonwhisper' },
        { characterId: 'c2', name: 'Bram' },
    ];

    it('turns IT players into linked webapp PCs for a new tracker', () => {
        const creatures = [player('p1', 'Ayla', { initiative: 17, modifier: 3 }), player('p2', 'bram'), it_('o1', 'Orc')];
        const plan = L.planLinks([], creatures, caravan);

        assert.equal(plan.newPcCombatants.length, 2);
        const ayla = plan.newPcCombatants.find(c => c.pcId === 'c1');
        assert.equal(ayla.id, 'c1');
        assert.equal(ayla.name, 'Ayla Moonwhisper');
        assert.equal(ayla.type, 'Player Character');
        assert.equal(ayla.obsidianId, 'p1');
        assert.equal(ayla.initiative, 17);
        assert.equal(ayla.initiative_modifier, 3);
        assert.ok(!plan.claimedItIds.has('o1'), 'monsters are handled separately');
    });

    it('links IT players to PCs already in the chosen webapp tracker instead of adding them', () => {
        const combatants = [pcCombatant('c2', 'Bram')];
        const creatures = [player('p2', 'Bram'), player('p1', 'Ayla')];
        const plan = L.planLinks(combatants, creatures, caravan);

        assert.deepEqual(plan.relinks, [{ index: 0, obsidianId: 'p2' }]);
        assert.deepEqual(plan.newPcCombatants.map(c => c.pcId), ['c1']);
    });

    it('leaves players without a caravan character in Obsidian only', () => {
        const plan = L.planLinks([], [player('p9', 'Cedric')], caravan);
        assert.deepEqual(plan.newPcCombatants, []);
        assert.deepEqual(plan.unlinkedPlayers, ['Cedric']);
    });

    it('drops the bridge\'s fake ordering initiative for new PCs', () => {
        const plan = L.planLinks([], [player('p2', 'Bram', { initiative: 998 })], caravan);
        assert.equal(plan.newPcCombatants[0].initiative, null);
        assert.equal(L.realInitiative(-100), null);
        assert.equal(L.realInitiative(14), 14);
    });
});

describe('name matching safety', () => {
    it('never guesses between two characters with the same first name', () => {
        const caravan = [{ characterId: 'a', name: 'Ayla Moon' }, { characterId: 'b', name: 'Ayla Star' }];
        const plan = L.planLinks([], [player('p1', 'Ayla')], caravan);
        assert.deepEqual(plan.unlinkedPlayers, ['Ayla']);
    });

    it('does not match two different full names', () => {
        const plan = L.planLinks([], [player('p1', 'Ayla Star')], [{ characterId: 'a', name: 'Ayla Moon' }]);
        assert.deepEqual(plan.unlinkedPlayers, ['Ayla Star']);
    });

    it('ignores case, accents and punctuation', () => {
        assert.equal(L.normalizeName('  Éowyn  of-Rohan '), 'eowyn of rohan');
        const plan = L.planLinks([], [player('p1', 'eowyn of rohan')], [{ characterId: 'e', name: 'Éowyn of-Rohan' }]);
        assert.equal(plan.newPcCombatants[0]?.pcId, 'e');
    });

    it('does not link one IT player to a PC that is already linked', () => {
        const combatants = [pcCombatant('c1', 'Ayla', { obsidianId: 'p1' })];
        const creatures = [player('p1', 'Ayla'), player('p2', 'Ayla')];
        const plan = L.planLinks(combatants, creatures, [{ characterId: 'c1', name: 'Ayla' }]);
        assert.deepEqual(plan.relinks, []);
        assert.deepEqual(plan.newPcCombatants, []);
        assert.deepEqual(plan.unlinkedPlayers, ['Ayla']);
    });
});
