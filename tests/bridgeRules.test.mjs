// tests/bridgeRules.test.mjs
// Bridge 0.5.1: removed monsters die in the webapp, real initiative + manualOrder in IT, first names for PCs.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let B;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-rules-'));
    const entry = join(dir, 'entry.ts');
    const src = (f) => resolve('src/bridge', f).replace(/\\/g, '/');
    writeFileSync(entry, [
        `export * from '${src('ordering.ts')}';`,
        `export * from '${src('removal.ts')}';`,
        `export * from '${src('linking.ts')}';`,
        `export * from '${src('fieldMapping.ts')}';`,
    ].join('\n'));
    const outfile = join(dir, 'rules.mjs');
    await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    B = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

const pc = (id, name, extra = {}) => ({ id, pcId: id, name, type: 'Player Character', initiative: 12, ...extra });
const monster = (id, name, extra = {}) => ({ id, name, type: 'Monster', initiative: 10, ...extra });
const creature = (id, name, extra = {}) => ({ id, name, displayName: extra.displayName ?? name, player: false, ...extra });

/** Sort IT creatures the way Initiative Tracker 13.0.18 does (descending, then manualOrder). */
function itSort(creatures) {
    return [...creatures].sort((a, b) => {
        if (a.initiative !== b.initiative) return b.initiative - a.initiative;
        if (a.manualOrder != null && b.manualOrder != null && a.manualOrder !== b.manualOrder) return a.manualOrder - b.manualOrder;
        return 0;
    });
}

function applyPlan(creatures, changes) {
    return creatures.map(c => {
        const ch = changes.find(x => x.id === c.id);
        return ch ? { ...c, initiative: ch.initiative, manualOrder: ch.manualOrder } : c;
    });
}

describe('monsters removed in Initiative Tracker', () => {
    it('makes a removed monster dead in the webapp, with the round it died', () => {
        const combatants = [monster('m1', 'Goblin 1', { obsidianId: 'g1', hp: 5 }), monster('m2', 'Goblin 2', { obsidianId: 'g2' })];
        const killed = B.markRemovedMonstersDead(combatants, [{ id: 'g1', name: 'Goblin 1', player: false }], 3);

        assert.deepEqual(killed, ['Goblin 1']);
        assert.equal(combatants[0].isDead, true);
        assert.equal(combatants[0].deathRound, 3);
        assert.equal(combatants[0].hp, 5, 'HP is left as it was');
        assert.ok(!combatants[1].isDead, 'other goblin untouched');
    });

    it('never kills player characters or player summons', () => {
        const combatants = [
            pc('c1', 'Ogg of the Cragmaw tribe', { obsidianId: 'p1' }),
            monster('s1', 'Wolf', { type: 'Summon', isPlayerSummon: true, obsidianId: 'w1' }),
        ];
        const killed = B.markRemovedMonstersDead(combatants, [
            { id: 'p1', name: 'Ogg', player: true },
            { id: 'w1', name: 'Wolf', player: false },
        ], 2);
        assert.deepEqual(killed, []);
        assert.ok(!combatants[0].isDead);
        assert.ok(!combatants[1].isDead);
    });

    it('kills a removed ally (non-player summon) like a monster', () => {
        const combatants = [monster('a1', 'Guard', { type: 'Summon', obsidianId: 'x1' })];
        assert.deepEqual(B.markRemovedMonstersDead(combatants, [{ id: 'x1', name: 'Guard', player: false }], 1), ['Guard']);
    });

    it('keeps an existing death round and skips monsters that are already dead or unknown', () => {
        const combatants = [monster('m1', 'Orc', { obsidianId: 'o1', isDead: true, deathRound: 1 })];
        const killed = B.markRemovedMonstersDead(combatants, [
            { id: 'o1', name: 'Orc', player: false },
            { id: 'zz', name: 'Unknown', player: false },
        ], 4);
        assert.deepEqual(killed, []);
        assert.equal(combatants[0].deathRound, 1);
    });

    it('falls back to the name only for combatants without a linked id', () => {
        const combatants = [monster('m1', 'Orc', { obsidianId: 'other' }), monster('m2', 'Ogre')];
        const killed = B.markRemovedMonstersDead(combatants, [
            { id: 'o1', name: 'Orc', player: false },
            { id: 'o2', name: 'Ogre', player: false },
        ], 2);
        assert.deepEqual(killed, ['Ogre'], 'Orc is linked to another IT creature, so it is not the removed one');
    });
});

describe('real initiative numbers in Initiative Tracker', () => {
    it('sorts like the webapp (initiative, modifier, dex, players first, tie breaker, id)', () => {
        const list = [
            monster('m1', 'Goblin', { initiative: 15, initiative_modifier: 2 }),
            pc('c1', 'Ayla', { initiative: 15, initiative_modifier: 2 }),
            monster('m2', 'Orc', { initiative: 15, initiative_modifier: 3 }),
            monster('m3', 'Rat', { initiative: null }),
            monster('m4', 'Bat', { initiative: 20 }),
            monster('m5', 'Imp', { initiative: 15, initiative_modifier: 2, tieBreaker: 5 }),
        ];
        assert.deepEqual(B.sortLikeWebapp(list).map(c => c.name), ['Bat', 'Orc', 'Ayla', 'Imp', 'Goblin', 'Rat']);
        assert.deepEqual(B.withSortIndex(list).map(c => [c.name, c.sortIndex]),
            [['Goblin', 4], ['Ayla', 2], ['Orc', 1], ['Rat', 5], ['Bat', 0], ['Imp', 3]]);
    });

    it('gives IT the real numbers and breaks ties with manualOrder in webapp order', () => {
        // Webapp order: Ayla (15, wins tie as player) before Goblin 1 (15), then Goblin 2 (8).
        const combatants = B.withSortIndex([
            monster('m1', 'Goblin 1', { initiative: 15, obsidianId: 'g1' }),
            pc('c1', 'Ayla Moonwhisper', { initiative: 15, obsidianId: 'p1' }),
            monster('m2', 'Goblin 2', { initiative: 8, obsidianId: 'g2' }),
        ]);
        const creatures = [
            creature('g1', 'Goblin', { displayName: 'Goblin 1', initiative: 999 }),
            creature('p1', 'Ayla', { player: true, initiative: 1000 }),
            creature('g2', 'Goblin', { displayName: 'Goblin 2', initiative: 998 }),
        ];
        const changes = B.planItOrder(combatants, creatures);
        assert.deepEqual(changes.find(c => c.id === 'p1'), { id: 'p1', initiative: 15, manualOrder: 0 });
        assert.deepEqual(changes.find(c => c.id === 'g1'), { id: 'g1', initiative: 15, manualOrder: 1 });
        assert.deepEqual(changes.find(c => c.id === 'g2'), { id: 'g2', initiative: 8, manualOrder: 2 });

        const shown = itSort(applyPlan(creatures, changes)).map(c => c.id);
        assert.deepEqual(shown, ['p1', 'g1', 'g2'], 'IT shows the same order as the webapp');
    });

    it('changes nothing when IT already matches', () => {
        const combatants = B.withSortIndex([monster('m1', 'Orc', { initiative: 12, obsidianId: 'o1' })]);
        const creatures = [creature('o1', 'Orc', { initiative: 12, manualOrder: 0 })];
        assert.deepEqual(B.planItOrder(combatants, creatures), []);
    });

    it('puts combatants without initiative last, and unknown IT creatures after the webapp ones on ties', () => {
        const combatants = B.withSortIndex([
            monster('m1', 'Orc', { initiative: 3, obsidianId: 'o1' }),
            monster('m2', 'Rat', { initiative: null, obsidianId: 'r1' }),
        ]);
        const creatures = [
            creature('r1', 'Rat', { initiative: 17 }),
            creature('o1', 'Orc', { initiative: 3 }),
            creature('x1', 'Cedric', { player: true, initiative: 0 }),
            creature('x2', 'Old fake', { initiative: -100 }),
        ];
        const changes = B.planItOrder(combatants, creatures);
        const rat = changes.find(c => c.id === 'r1');
        assert.equal(rat.initiative, 0, 'no initiative → lowest in play, at most 0');
        assert.deepEqual(changes.find(c => c.id === 'x1'), { id: 'x1', initiative: 0, manualOrder: 2 });
        assert.equal(changes.find(c => c.id === 'x2').initiative, 0, 'an old fake value is replaced');
        assert.deepEqual(itSort(applyPlan(creatures, changes)).map(c => c.id), ['o1', 'r1', 'x1', 'x2']);
    });

    it('a linked id wins over a name match for another combatant', () => {
        const combatants = B.withSortIndex([
            monster('m1', 'Goblin', { initiative: 20 }),               // no link, same name
            monster('m2', 'Goblin', { initiative: 5, obsidianId: 'g1' }),
        ]);
        const creatures = [creature('g1', 'Goblin', { initiative: 5 }), creature('g2', 'Goblin', { initiative: 1 })];
        const changes = B.planItOrder(combatants, creatures);
        assert.equal(changes.find(c => c.id === 'g2').initiative, 20, 'the unlinked goblin takes the free creature');
        assert.equal(changes.find(c => c.id === 'g1').manualOrder, 1);
    });

    it('finds a PC that IT shows under the first name', () => {
        const combatants = B.withSortIndex([pc('c1', 'Ogg of the Cragmaw tribe', { initiative: 11 })]);
        const changes = B.planItOrder(combatants, [creature('p9', 'Ogg', { player: true, initiative: 0 })]);
        assert.deepEqual(changes, [{ id: 'p9', initiative: 11, manualOrder: 0 }]);
    });

    it('uses stored sortIndex when every combatant has one', () => {
        const list = [monster('a', 'A', { initiative: 10, sortIndex: 1 }), monster('b', 'B', { initiative: 10, sortIndex: 0 })];
        assert.deepEqual(B.webappOrder(list).map(c => c.id), ['b', 'a']);
    });

    it('keeps old fake values out of new webapp combatants', () => {
        const state = { name: 'Orc', initiative: 998, hp: 7, currentHP: 7, currentMaxHP: 7, ac: 13, modifier: 1, player: false };
        assert.equal(B.itCreatureToWebappCombatant(state).initiative, null);
        assert.equal(B.itCreatureToWebappCombatant({ ...state, initiative: 14 }).initiative, 14);
    });
});

describe('first names for player characters in IT', () => {
    it('sends only the first name of a player character', () => {
        const ogg = pc('c1', 'Ogg of the Cragmaw tribe');
        assert.equal(B.itNameFor(ogg, ['Ogg of the Cragmaw tribe', 'Ayla Moonwhisper']), 'Ogg');
        assert.equal(B.webappCombatantToITCreature(ogg, 'Ogg').name, 'Ogg');
    });

    it('keeps full names when two player characters share a first name', () => {
        const a = pc('c1', 'Ayla Moon');
        assert.equal(B.itNameFor(a, ['Ayla Moon', 'Ayla Star']), 'Ayla Moon');
        assert.equal(B.itNameFor(a, ['Ayla Moon', 'ayla']), 'Ayla Moon', 'case does not matter');
    });

    it('keeps full names for monsters and summons, and single names as they are', () => {
        assert.equal(B.itNameFor(monster('m1', 'Goblin Boss'), []), 'Goblin Boss');
        assert.equal(B.itNameFor(monster('s1', 'Spirit Wolf', { type: 'Summon' }), []), 'Spirit Wolf');
        assert.equal(B.itNameFor(pc('c1', 'Bram'), ['Bram']), 'Bram');
        assert.equal(B.itNameFor(pc('c1', 'Bram, the Bold'), []), 'Bram');
    });

    it('links the first-name creature back to the full-name combatant', () => {
        const ogg = pc('c1', 'Ogg of the Cragmaw tribe');
        const found = B.findCreatureFor(ogg, [creature('g1', 'Goblin'), creature('p1', 'Ogg', { player: true })]);
        assert.equal(found?.id, 'p1');
    });

    it('does not guess when two IT players share the first name', () => {
        const ogg = pc('c1', 'Ogg of the Cragmaw tribe');
        const found = B.findCreatureFor(ogg, [creature('p1', 'Ogg', { player: true }), creature('p2', 'Ogg', { player: true })]);
        assert.equal(found, null);
    });

    it('does not match monsters by first word', () => {
        assert.equal(B.findCreatureFor(monster('m1', 'Goblin Boss'), [creature('g1', 'Goblin')]), null);
    });
});
