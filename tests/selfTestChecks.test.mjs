// tests/selfTestChecks.test.mjs
// Pure helpers of the in-Obsidian bridge self-test: test-campaign guard, version check, order compare, report.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let S;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-selftest-'));
    const outfile = join(dir, 'checks.mjs');
    await build({ entryPoints: [resolve('src/selftest/checks.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    S = await import(pathToFileURL(outfile).href);
    rmSync(dir, { recursive: true, force: true });
});

describe('isTestCampaign', () => {
    it('accepts a flagged "TEST - " copy only', () => {
        assert.equal(S.isTestCampaign({ name: 'TEST - Arc van Noah', isTestCopy: true }), true);
    });
    it('refuses the real game, even with the flag or the name alone', () => {
        assert.equal(S.isTestCampaign({ name: 'Arc van Noah', isTestCopy: true }), false);
        assert.equal(S.isTestCampaign({ name: 'TEST - Arc van Noah' }), false);
        assert.equal(S.isTestCampaign({ name: 'TEST - Arc van Noah', isTestCopy: 'yes' }), false);
        assert.equal(S.isTestCampaign(null), false);
    });
});

describe('versionAtLeast', () => {
    it('compares part by part', () => {
        assert.equal(S.versionAtLeast('13.0.18', '13.0.17'), true);
        assert.equal(S.versionAtLeast('13.0.17', '13.0.17'), true);
        assert.equal(S.versionAtLeast('13.0.9', '13.0.17'), false);
        assert.equal(S.versionAtLeast('14', '13.0.17'), true);
    });
    it('treats an unknown version as too old', () => {
        assert.equal(S.versionAtLeast(null, '13.0.17'), false);
    });
});

describe('orderMismatch', () => {
    const combatants = [
        { id: 'a', name: 'Ayla', type: 'Player Character', initiative: 18, obsidianId: 'it-a', sortIndex: 0 },
        { id: 'g', name: 'Goblin Boss', type: 'Monster', initiative: 15, obsidianId: 'it-g', sortIndex: 1 },
        { id: 'o', name: 'Ogg', type: 'Player Character', initiative: 8, sortIndex: 2 },   // not linked
    ];
    it('is null when the linked creatures are in the same order', () => {
        const it = [{ id: 'it-a', name: 'Ayla' }, { id: 'x', name: 'Stranger' }, { id: 'it-g', name: 'Goblin Boss' }];
        assert.equal(S.orderMismatch(combatants, it), null);
    });
    it('names both orders when they differ', () => {
        const it = [{ id: 'it-g', name: 'Goblin Boss' }, { id: 'it-a', name: 'Ayla' }];
        assert.match(S.orderMismatch(combatants, it), /webapp: Ayla, Goblin Boss \/ IT: Goblin Boss, Ayla/);
    });
    it('leaves out combatants that are not in IT (removed monsters)', () => {
        assert.equal(S.orderMismatch(combatants, [{ id: 'it-g', name: 'Goblin Boss' }]), null);
    });
});

describe('editCombatant', () => {
    it('patches one combatant and recomputes sortIndex like the webapp', () => {
        const list = [
            { id: 'a', name: 'Ayla', type: 'Player Character', initiative: 18, sortIndex: 0 },
            { id: 'g', name: 'Goblin', type: 'Monster', initiative: 15, sortIndex: 1 },
        ];
        const out = S.editCombatant(list, 'g', { initiative: 25 });
        assert.equal(out.find(c => c.id === 'g').initiative, 25);
        assert.equal(out.find(c => c.id === 'g').sortIndex, 0);
        assert.equal(out.find(c => c.id === 'a').sortIndex, 1);
        assert.equal(list[1].initiative, 15, 'input is not changed');
    });
});

describe('formatReport', () => {
    const meta = { date: '21-10-2026', pluginVersion: '0.5.2', itVersion: '13.0.18', campaign: 'TEST - Arc', tracker: 'Self-test', trackerKept: true };
    it('sums up and shows details only for steps that did not pass', () => {
        const text = S.formatReport([
            { id: 'A1', title: 'Connect', status: 'pass', detail: 'hidden' },
            { id: 'B2', title: 'Monster initiative', status: 'fail', detail: 'webapp Bugbear initiative is 12' },
            { id: 'A5', title: 'Player HP', status: 'skip', detail: 'no write access' },
        ], meta);
        assert.match(text, /1 passed, 1 failed, 1 skipped/);
        assert.match(text, /B2\*\* Monster initiative — webapp Bugbear initiative is 12/);
        assert.doesNotMatch(text, /hidden/);
        assert.match(text, /copy this note/);
        assert.match(text, /was kept/);
    });
});
