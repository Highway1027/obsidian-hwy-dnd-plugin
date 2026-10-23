// tests/ordering.test.mjs
// The webapp sort copy with the DM's tie order, and planTieOrder (a drag in IT → tieOrder).
// The sort cases match the webapp's tests/combatSort.test.js: keep the two in step.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let O;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-ordering-'));
    const outfile = join(dir, 'out.mjs');
    await build({ entryPoints: [resolve('src/bridge/ordering.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    O = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

const pc = (name, initiative, extra = {}) => ({ id: name, name, initiative, type: 'Player Character', initiative_modifier: 0, ...extra });
const npc = (name, initiative, extra = {}) => ({ id: name, name, initiative, type: 'Monster', initiative_modifier: 0, ...extra });
const names = (list) => O.sortLikeWebapp(list).map(c => c.name);

describe('sortLikeWebapp', () => {
    it('sorts ties by modifier, DEX and players first without a DM order', () => {
        assert.deepEqual(names([
            npc('Goblin', 15),
            pc('Ayla', 15),
            npc('Wolf', 15, { initiative_modifier: 2 }),
            npc('Orc', 18),
        ]), ['Orc', 'Wolf', 'Ayla', 'Goblin']);
    });

    it('lets the DM order beat modifier, DEX and players first', () => {
        assert.deepEqual(names([
            pc('Ayla', 15, { tieOrder: { init: 15, rank: 2 } }),
            npc('Wolf', 15, { initiative_modifier: 4, tieOrder: { init: 15, rank: 1 } }),
            npc('Goblin', 15, { tieOrder: { init: 15, rank: 0 } }),
        ]), ['Goblin', 'Wolf', 'Ayla']);
    });

    it('puts a newcomer to an ordered tie after the ordered ones', () => {
        assert.deepEqual(names([
            npc('Goblin', 15, { tieOrder: { init: 15, rank: 0 } }),
            pc('Ayla', 15, { tieOrder: { init: 15, rank: 1 } }),
            pc('Bram', 15, { initiative_modifier: 5 }),
            npc('Orc', 12),
        ]), ['Goblin', 'Ayla', 'Bram', 'Orc']);
    });

    it('ignores a DM order made for another initiative', () => {
        assert.deepEqual(names([
            npc('Goblin', 15, { tieOrder: { init: 12, rank: 0 } }),
            pc('Ayla', 15),
        ]), ['Ayla', 'Goblin']);
    });
});

describe('planTieOrder', () => {
    it('gives every member of a reordered tie its IT position', () => {
        // Webapp: Ayla before Goblin (players first). The DM dragged Goblin above Ayla.
        const combatants = [pc('Ayla', 15), npc('Goblin', 15), npc('Orc', 12)];
        const changes = O.planTieOrder(combatants, [1, 0, 2]);
        assert.deepEqual(changes, [
            { index: 1, tieOrder: { init: 15, rank: 0 } },
            { index: 0, tieOrder: { init: 15, rank: 1 } },
        ]);
    });

    it('leaves ties alone that IT already shows like the webapp', () => {
        const combatants = [pc('Ayla', 15), npc('Goblin', 15), npc('Orc', 12), npc('Rat', 12)];
        assert.deepEqual(O.planTieOrder(combatants, [0, 1, 2, 3]), []);
    });

    it('orders a creature dragged into another tie (its initiative already copied)', () => {
        // Wolf (was 10) dropped between Ayla and Goblin, so it took Goblin's 15.
        const combatants = [pc('Ayla', 15), npc('Goblin', 15), npc('Wolf', 15, { initiative_modifier: 3 })];
        const changes = O.planTieOrder(combatants, [0, 2, 1]);
        assert.deepEqual(changes.map(c => [combatants[c.index].name, c.tieOrder.rank]), [['Ayla', 0], ['Wolf', 1], ['Goblin', 2]]);
    });

    it('skips IT creatures the webapp does not know and sends only changed ranks', () => {
        const combatants = [
            npc('Goblin', 15, { tieOrder: { init: 15, rank: 1 } }),
            pc('Ayla', 15, { tieOrder: { init: 15, rank: 0 } }),
            pc('Bram', 15),
        ];
        // IT: Goblin, (unknown), Ayla, Bram. The webapp has Ayla, Goblin, Bram.
        const changes = O.planTieOrder(combatants, [0, null, 1, 2]);
        assert.deepEqual(changes.map(c => [combatants[c.index].name, c.tieOrder.rank]), [['Goblin', 0], ['Ayla', 1], ['Bram', 2]]);
        const after = combatants.map((c, i) => ({ ...c, tieOrder: changes.find(ch => ch.index === i)?.tieOrder ?? c.tieOrder }));
        assert.deepEqual(O.sortLikeWebapp(after).map(c => c.name), ['Goblin', 'Ayla', 'Bram']);
    });
});

describe('planTieOrder: a tie a creature was dragged into', () => {
    it('is kept even when IT shows it like the webapp', () => {
        // Goblin (mod 2) dragged next to the Wolf: the webapp would also put it first.
        const combatants = [npc('Goblin', 12, { initiative_modifier: 2 }), npc('Wolf', 12)];
        assert.deepEqual(O.planTieOrder(combatants, [0, 1]), []);
        assert.deepEqual(O.planTieOrder(combatants, [0, 1], [0]), [
            { index: 0, tieOrder: { init: 12, rank: 0 } },
            { index: 1, tieOrder: { init: 12, rank: 1 } },
        ]);
    });
});
