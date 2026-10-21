// src/selftest/BridgeSelfTest.ts
// In-Obsidian self-test of the Initiative Bridge: plays the webapp side by writing to its own
// tracker in a webapp test copy, plays the DM side through IT's store, and checks both sides.
// Steps carry the ids of the hand-test sittings in docs/TESTING.md.

import { App, Modal, Notice, TFile } from 'obsidian';
import type { InitiativeBridgeManager } from '../bridge/InitiativeBridgeManager';
import { ITPluginAccess } from '../bridge/itPluginAccess';
import type { WebappCombatant } from '../bridge/fieldMapping';
import { webappOrder, withSortIndex } from '../bridge/ordering';
import {
    authenticateWithApiToken, isAuthenticated, getCurrentUser, getDb,
    doc, getDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../firebase';
import { isTestCampaign, versionAtLeast, orderMismatch, editCombatant, formatReport, type StepResult } from './checks';

const MIN_IT_VERSION = '13.0.17';
// Pause between steps, so each step starts from a quiet bridge.
const SETTLE_MS = 3000;
const WAIT_MS = 10000;
const REPORT_PATH = 'Bridge self-test.md';

// Made-up names: they must not match a real character in the test campaign (a copy of a real one).
const LONG_PC = 'Zorvath of the Selftest clan';
const SHORT_PC = 'Zorvath';
const SECOND_PC = 'Zorvath the Younger';
const STRANGER = 'Selftest Stranger';

class SkipStep extends Error {}

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function itName(c: any): string {
    return c.getName?.() ?? c.display ?? c.name;
}

function hasCondition(c: any, name: string): boolean {
    const status = c.status;
    const all: any[] = status instanceof Set ? [...status] : Array.isArray(status) ? status : [];
    return all.some(s => (typeof s === 'string' ? s : s?.name) === name);
}

export interface SelfTestOptions {
    apiToken: string;
    caravanId: string;
    pluginVersion: string;
}

export class BridgeSelfTest {
    private it: ITPluginAccess;
    private results: StepResult[] = [];
    private campaignName = '';
    private pcMember: { characterId: string; name: string } | null = null;
    private ownsPc = false;   // the DM's account owns pcMember's character, so A5 may change its HP
    private trackerId: string | null = null;
    private trackerName = '';
    private ids: Record<string, string> = {};   // role → IT id
    private webappIds: Record<string, string> = {};   // role → webapp combatant id

    constructor(private app: App, private bridge: InitiativeBridgeManager, private opts: SelfTestOptions) {
        this.it = new ITPluginAccess(app);
    }

    get creatureCount(): number {
        return this.it.getOrderedCreatures().length;
    }

    get campaign(): string {
        return this.campaignName;
    }

    /** Everything that must be true before the test touches anything. Returns the problem, or null. */
    async preflight(): Promise<string | null> {
        if (!this.opts.apiToken) return 'Set your API token in the plugin settings first.';
        if (!this.opts.caravanId) return 'Set "Self-test campaign ID" in the plugin settings (the id of a TEST - copy).';
        if (!this.it.isAvailable()) return 'Initiative Tracker is not loaded.';
        if (!this.it.isTrackerViewOpen()) return 'Open the Initiative Tracker view first.';
        const itVersion = this.it.getVersion();
        if (!versionAtLeast(itVersion, MIN_IT_VERSION)) {
            return `Initiative Tracker ${itVersion ?? '(unknown)'} is too old; the bridge needs ${MIN_IT_VERSION} or newer.`;
        }

        if (!isAuthenticated()) await authenticateWithApiToken(this.opts.apiToken);
        const snap = await getDoc(doc(getDb(), 'caravans', this.opts.caravanId));
        const caravan = snap.exists() ? snap.data() : null;
        if (!isTestCampaign(caravan)) {
            return 'The self-test campaign must be a webapp test copy (named "TEST - ..."). Make one on the webapp Developer page.';
        }
        this.campaignName = caravan!.name;
        const members: any[] = (caravan!.characterMembers || []).filter((m: any) => m?.characterId && m?.name);
        // Only the owner may write a character, so prefer one of the DM's own for A5 (HP).
        const uid = getCurrentUser()?.uid;
        let member = members[0];
        for (const m of members) {
            const charSnap = await getDoc(doc(getDb(), 'characters', m.characterId));
            if (uid && charSnap.exists() && charSnap.data().uid === uid) {
                member = m;
                this.ownsPc = true;
                break;
            }
        }
        this.pcMember = member ? { characterId: member.characterId, name: member.name } : null;
        return null;
    }

    async run(): Promise<void> {
        new Notice('🧪 Bridge self-test started. Takes about a minute; leave Obsidian alone meanwhile.', 8000);
        try {
            if (this.bridge.isConnected) await this.bridge.disconnect();
            await this.steps();
        } catch (err) {
            this.results.push({ id: 'X', title: 'Self-test stopped early', status: 'fail', detail: String(err) });
        }
        await this.cleanup();
    }

    // ==========================================
    // THE STEPS
    // ==========================================

    private async steps(): Promise<void> {
        const pc = this.pcMember;

        await this.step('S1', 'Clear IT and add the test creatures', async () => {
            for (const c of this.it.getOrderedCreatures()) this.it.removeCreature(c.id);
            this.ids.boss = this.addIt({ name: 'Goblin Boss', hp: 21, ac: 17, modifier: 1 }, 15);
            this.ids.bugbear = this.addIt({ name: 'Bugbear', hp: 27, ac: 16, modifier: 2 }, 12);
            this.ids.stranger = this.addIt({ name: STRANGER, hp: 10, ac: 10, player: true, friendly: true }, 5);
            if (pc) this.ids.pc = this.addIt({ name: pc.name, hp: 30, ac: 15, player: true, friendly: true }, 18);
            const expected = pc ? 4 : 3;
            if (this.creatureCount !== expected) throw new Error(`IT has ${this.creatureCount} creatures, expected ${expected}`);
        });

        await this.step('A1', 'Create a tracker from Obsidian and connect: everyone once, players linked', async () => {
            this.trackerName = `Self-test ${new Date().toLocaleString('nl-NL')}`;
            this.trackerId = await this.bridge.createNewTracker(this.opts.caravanId, this.trackerName);
            await this.bridge.connect(this.opts.caravanId, this.trackerId);
            await this.waitFor(async () => {
                const list = await this.combatants();
                const names = list.map(c => c.name);
                if (new Set(names).size !== names.length) return `a name appears twice: ${names.join(', ')}`;
                const boss = list.find(c => c.name === 'Goblin Boss');
                if (boss?.obsidianId !== this.ids.boss || boss?.type !== 'Monster') return 'Goblin Boss missing or not linked';
                if (!list.some(c => c.obsidianId === this.ids.bugbear)) return 'Bugbear missing or not linked';
                if (pc) {
                    const linked = list.find(c => c.pcId === pc.characterId);
                    if (!linked || linked.obsidianId !== this.ids.pc) return `${pc.name} is not linked to the campaign character`;
                }
                if (this.creatureCount !== (pc ? 4 : 3)) return `IT now has ${this.creatureCount} creatures (something was added twice)`;
                return null;
            });
        });

        await this.step('E5', 'A player without a campaign character stays in Obsidian only', async () => {
            const list = await this.combatants();
            if (list.some(c => c.name === STRANGER)) throw new Error(`${STRANGER} was added to the webapp`);
            if (!this.itById(this.ids.stranger)) throw new Error(`${STRANGER} is gone from IT`);
        });

        await this.step('A2', 'IT shows the real initiative numbers, in the webapp order', async () => {
            await this.waitFor(async () => this.initiativeMismatch(await this.combatants()) ?? this.orderProblem());
        });

        await this.step('C4', 'Monsters keep their full names', async () => {
            if (itName(this.itById(this.ids.boss)) !== 'Goblin Boss') throw new Error(`IT shows "${itName(this.itById(this.ids.boss))}"`);
        });

        await this.step('B1', 'A tie set in the webapp shows in the same order on both sides', async () => {
            if (!pc) throw new SkipStep('the test campaign has no player characters');
            const list = await this.combatants();
            const pcCombatant = list.find(c => c.pcId === pc.characterId)!;
            await this.webappWrite(editCombatant(list, pcCombatant.id!, { initiative: 15 }));
            await this.waitFor(async () => {
                if (this.itById(this.ids.pc)?.initiative !== 15) return `${pc.name} has initiative ${this.itById(this.ids.pc)?.initiative} in IT`;
                return this.orderProblem();
            });
        });

        await this.step('B2', 'A monster\'s initiative changed in IT reaches the webapp', async () => {
            this.it.setCreatureInitiative(this.ids.bugbear, 25);
            await this.waitFor(async () => {
                const bugbear = (await this.combatants()).find(c => c.obsidianId === this.ids.bugbear);
                if (bugbear?.initiative !== 25) return `webapp Bugbear initiative is ${bugbear?.initiative}`;
                return this.orderProblem();
            });
        });

        await this.step('B3', 'A player\'s initiative changed in IT jumps back to the webapp value', async () => {
            if (!pc) throw new SkipStep('the test campaign has no player characters');
            const webappValue = (await this.combatants()).find(c => c.pcId === pc.characterId)?.initiative;
            this.it.setCreatureInitiative(this.ids.pc, 1);
            await this.waitFor(async () => {
                const now = this.itById(this.ids.pc)?.initiative;
                return now === webappValue ? null : `IT shows ${now}, webapp has ${webappValue}`;
            });
        });

        await this.step('B4', 'A turn advanced in the webapp moves the turn in IT', async () => {
            const list = await this.combatants();
            const ordered = webappOrder(list);
            const target = ordered[1];
            await this.webappWrite(list, { turn: 1 });
            await this.waitFor(async () => {
                const active = this.it.getOrderedCreatures().find((c: any) => c.active);
                return active?.id === target.obsidianId ? null : `IT turn is on "${active ? itName(active) : 'nobody'}", expected "${target.name}"`;
            });
        });

        await this.step('B5', 'A turn set in IT moves the turn in the webapp', async () => {
            const ordered = webappOrder(await this.combatants());
            const index = ordered.findIndex((c, i) => i > 1 && c.obsidianId && this.itById(c.obsidianId));
            if (index < 0) throw new SkipStep('no third linked creature to move the turn to');
            this.it.setActiveTurn(ordered[index].obsidianId!);
            await this.waitFor(async () => {
                const turn = (await this.trackerData())?.turn;
                return turn === index ? null : `webapp turn is ${turn}, expected ${index} (${ordered[index].name})`;
            });
        });

        await this.step('R1', 'Ten fast initiative changes in IT (like a drag) reach the webapp as the last value', async () => {
            const writesBefore = this.bridge.trackerWrites;
            for (let i = 1; i <= 10; i++) {
                this.it.setCreatureInitiative(this.ids.boss, 20 + i);
                await sleep(20);
            }
            await this.waitFor(async () => {
                const list = await this.combatants();
                const boss = list.find(c => c.obsidianId === this.ids.boss);
                if (boss?.initiative !== 30) return `webapp Goblin Boss initiative is ${boss?.initiative}, expected 30`;
                const names = list.map(c => c.name);
                if (new Set(names).size !== names.length) return `a name appears twice: ${names.join(', ')}`;
                return this.orderProblem();
            });
            const writes = this.bridge.trackerWrites - writesBefore;
            if (writes > 2) throw new Error(`the bridge wrote the tracker ${writes} times for one burst (expected 1 or 2)`);
        });

        await this.step('R5', 'A monster dragged to the top in IT reaches the webapp without another change', async () => {
            const top = this.it.getOrderedCreatures()[0];
            if (!top || top.id === this.ids.bugbear) throw new Error('Bugbear is already at the top of IT');
            const target = top.initiative;
            if (!this.it.dragCreature(this.ids.bugbear, 0)) throw new Error('could not drag in IT');
            await this.waitFor(async () => {
                const bugbear = (await this.combatants()).find(c => c.obsidianId === this.ids.bugbear);
                return bugbear?.initiative === target ? null : `webapp Bugbear initiative is ${bugbear?.initiative}, expected ${target}`;
            });
        });

        await this.step('R6', 'A player dragged in IT jumps back to the webapp value without another change', async () => {
            if (!pc) throw new SkipStep('the test campaign has no player characters');
            const webappValue = (await this.combatants()).find(c => c.pcId === pc.characterId)?.initiative;
            const ordered = this.it.getOrderedCreatures();
            if (!this.it.dragCreature(this.ids.pc, ordered.length - 1)) throw new Error('could not drag in IT');
            await this.waitFor(async () => {
                const now = this.itById(this.ids.pc)?.initiative;
                if (now !== webappValue) return `IT shows ${now}, webapp has ${webappValue}`;
                return this.orderProblem();
            });
        });

        await this.step('R2', 'A webapp change made just before the bridge writes is kept', async () => {
            let played = false;
            this.bridge.beforeTrackerWrite = async () => {
                // The webapp writes while the bridge has its change ready but has not written it yet.
                const list = await this.combatants();
                const boss = list.find(c => c.obsidianId === this.ids.boss)!;
                await this.webappWrite(editCombatant(list, boss.id!, { tempHp: 5 }));
                played = true;
            };
            try {
                this.it.setCreatureHP(this.ids.bugbear, 22);
                await this.waitFor(async () => {
                    if (!played) return 'the bridge did not write';
                    const list = await this.combatants();
                    const bugbear = list.find(c => c.obsidianId === this.ids.bugbear);
                    const boss = list.find(c => c.obsidianId === this.ids.boss);
                    if (bugbear?.hp !== 22) return `webapp Bugbear HP is ${bugbear?.hp}, expected 22`;
                    return boss?.tempHp === 5 ? null : `the webapp's change was lost (Goblin Boss temp HP ${boss?.tempHp}, expected 5)`;
                });
            } finally {
                this.bridge.beforeTrackerWrite = null;
            }
        });

        await this.step('R3', 'A monster HP edit in IT right after a webapp turn change reaches the webapp', async () => {
            const list = await this.combatants();
            const ordered = webappOrder(list);
            const turn = ordered.findIndex(c => c.obsidianId === this.ids.boss);
            if (turn < 0) throw new Error('Goblin Boss is not in the webapp');
            await this.webappWrite(list, { turn });
            await this.waitFor(async () => this.itById(this.ids.boss)?.active ? null : 'the webapp turn did not reach IT');
            // Straight after (before 0.7.0 this edit fell in a 2-second window and was lost).
            this.it.setCreatureHP(this.ids.bugbear, 18);
            await this.waitFor(async () => {
                const bugbear = (await this.combatants()).find(c => c.obsidianId === this.ids.bugbear);
                return bugbear?.hp === 18 ? null : `webapp Bugbear HP is ${bugbear?.hp}, expected 18`;
            });
        });

        await this.step('R4', 'A webapp turn change right after a monster HP edit in IT reaches IT', async () => {
            this.it.setCreatureHP(this.ids.boss, 16);
            await this.waitFor(async () => {
                const boss = (await this.combatants()).find(c => c.obsidianId === this.ids.boss);
                return boss?.hp === 16 ? null : `webapp Goblin Boss HP is ${boss?.hp}, expected 16`;
            });
            // Straight after the bridge wrote (before 0.7.0 the webapp was ignored for 2 seconds then).
            const list = await this.combatants();
            const ordered = webappOrder(list);
            const turn = ordered.findIndex(c => c.obsidianId === this.ids.bugbear);
            if (turn < 0) throw new Error('Bugbear is not in the webapp');
            await this.webappWrite(list, { turn });
            await this.waitFor(async () => {
                const active = this.it.getOrderedCreatures().find((c: any) => c.active);
                return active?.id === this.ids.bugbear ? null : `IT turn is on "${active ? itName(active) : 'nobody'}", expected Bugbear`;
            });
        });

        await this.step('C1', 'A player character added in the webapp shows with its first name in IT', async () => {
            const list = await this.combatants();
            const added = this.webappPc('long', LONG_PC, 8);
            this.webappIds.long = added.id!;
            await this.webappWrite(withSortIndex([...list, added]));
            await this.waitFor(async () => {
                const creature = this.it.getOrderedCreatures().find((c: any) => itName(c) === SHORT_PC);
                if (!creature) return `no "${SHORT_PC}" in IT`;
                this.ids.long = creature.id;
                const linked = (await this.combatants()).find(c => c.id === added.id);
                return linked?.obsidianId === creature.id ? null : `webapp ${SHORT_PC} is not linked to the IT creature`;
            });
        });

        await this.step('C3', 'A second character with the same first name keeps the full name', async () => {
            const list = await this.combatants();
            await this.webappWrite(withSortIndex([...list, this.webappPc('second', SECOND_PC, 7)]));
            await this.waitFor(async () =>
                this.it.getOrderedCreatures().some((c: any) => itName(c) === SECOND_PC) ? null : `no "${SECOND_PC}" in IT`);
        });

        await this.step('A5', 'A player\'s HP changed in the webapp reaches IT', async () => {
            if (!pc) throw new SkipStep('the test campaign has no player characters');
            if (!this.ownsPc) throw new SkipStep('no character in the test campaign belongs to your account (only the owner may change HP)');
            const charRef = doc(getDb(), 'characters', pc.characterId);
            const snap = await getDoc(charRef);
            const data: any = snap.exists() ? snap.data() : null;
            const field = data && typeof data.currentHP === 'number' ? 'currentHP' : data && typeof data.hp === 'number' ? 'hp' : null;
            if (!field) throw new SkipStep('the test character has no HP field');
            const original: number = data[field];
            const target = Math.max(1, original - 3);
            try {
                await updateDoc(charRef, { [field]: target });
            } catch (err) {
                throw new SkipStep(`could not change the character's HP (${String(err)})`);
            }
            try {
                await this.waitFor(async () => {
                    const hp = this.itById(this.ids.pc)?.hp;
                    return hp === target ? null : `IT shows HP ${hp}, expected ${target}`;
                });
            } finally {
                await updateDoc(charRef, { [field]: original }).catch(() => undefined);
            }
        });

        await this.step('D1', 'A monster killed in the webapp gets 0 HP, Unconscious and no turn in IT', async () => {
            const data = await this.trackerData();
            const list: WebappCombatant[] = data?.combatants || [];
            const boss = list.find(c => c.obsidianId === this.ids.boss)!;
            await this.webappWrite(editCombatant(list, boss.id!, { isDead: true, deathRound: data?.round || 1 }));
            await this.waitFor(async () => {
                const c = this.itById(this.ids.boss);
                if (!c) return 'Goblin Boss is gone from IT';
                if (c.hp !== 0) return `HP is ${c.hp}`;
                if (c.enabled !== false) return 'still enabled (would get a turn)';
                return hasCondition(c, 'Unconscious') ? null : 'no Unconscious condition';
            });
        });

        await this.step('D2', 'A living monster removed in IT becomes dead in the webapp', async () => {
            this.it.removeCreature(this.ids.bugbear);
            await this.waitFor(async () => {
                const bugbear = (await this.combatants()).find(c => c.obsidianId === this.ids.bugbear);
                if (!bugbear) return 'Bugbear is gone from the webapp (should stay, dead)';
                return bugbear.isDead && bugbear.deathRound ? null : 'Bugbear is not marked dead with a round';
            });
        });

        await this.step('D3', 'A player removed in IT stays alive in the webapp and comes back in IT', async () => {
            if (!this.ids.long) throw new SkipStep(`C1 did not add ${SHORT_PC}`);
            const oldId = this.ids.long;
            this.it.removeCreature(oldId);
            await sleep(SETTLE_MS);
            await this.waitFor(async () => {
                const player = (await this.combatants()).find(c => c.id === this.webappIds.long);
                if (!player) return `${SHORT_PC} is gone from the webapp`;
                if (player.isDead) return `${SHORT_PC} was marked dead`;
                if (!player.obsidianId || player.obsidianId === oldId) return `${SHORT_PC} was not added back in IT`;
                if (!this.itById(player.obsidianId)) return `${SHORT_PC} is linked to a creature that is not in IT`;
                this.ids.long = player.obsidianId;
                return null;
            });
            const names = this.it.getOrderedCreatures().map(itName);
            if (new Set(names).size !== names.length) throw new Error(`IT has a creature twice: ${names.join(', ')}`);
        });

        await this.step('D3.1', 'A campaign character removed in IT comes back with its HP', async () => {
            if (!pc || !this.ids.pc) throw new SkipStep('the test campaign has no player characters');
            const snap = await getDoc(doc(getDb(), 'characters', pc.characterId));
            const data: any = snap.exists() ? snap.data() : null;
            const sheetHp = data?.activeWildshapeData?.currentHP ?? data?.currentHP ?? data?.hp;
            if (typeof sheetHp !== 'number') throw new SkipStep('the test character has no HP field');
            const oldId = this.ids.pc;
            this.it.removeCreature(oldId);
            await sleep(SETTLE_MS);
            await this.waitFor(async () => {
                const player = (await this.combatants()).find(c => c.pcId === pc.characterId);
                if (!player?.obsidianId || player.obsidianId === oldId) return `${pc.name} was not added back in IT`;
                const creature = this.itById(player.obsidianId);
                if (!creature) return `${pc.name} is linked to a creature that is not in IT`;
                if (creature.hp !== sheetHp) return `IT shows HP ${creature.hp}, the character sheet has ${sheetHp}`;
                this.ids.pc = player.obsidianId;
                return null;
            });
        });

        await this.step('A3', 'Reconnecting adds nobody twice and keeps removed monsters out', async () => {
            const before = (await this.combatants()).length;
            await this.bridge.disconnect();
            await this.bridge.mergeWithExistingTracker(this.opts.caravanId, this.trackerId!);
            await this.bridge.connect(this.opts.caravanId, this.trackerId!);
            await sleep(SETTLE_MS);
            await this.waitFor(async () => {
                const list = await this.combatants();
                if (list.length !== before) return `webapp has ${list.length} combatants, had ${before}`;
                const names = this.it.getOrderedCreatures().map(itName);
                if (new Set(names).size !== names.length) return `IT has a creature twice: ${names.join(', ')}`;
                if (names.includes('Bugbear')) return 'the dead Bugbear was added back to IT';
                return null;
            });
        });

        await this.step('A4', 'After reconnecting the order is right straight away', async () => {
            await this.waitFor(async () => this.orderProblem());
        });

        await this.step('D4', 'A monster revived in the webapp comes back in IT', async () => {
            const list = await this.combatants();
            const bugbear = list.find(c => c.obsidianId === this.ids.bugbear)!;
            await this.webappWrite(editCombatant(list, bugbear.id!, { isDead: false, deathRound: null, hp: bugbear.maxHp ?? 27 }));
            await this.waitFor(async () =>
                this.it.getOrderedCreatures().some((c: any) => itName(c) === 'Bugbear' && c.enabled !== false) ? null : 'no living Bugbear in IT');
        });
    }

    // ==========================================
    // HELPERS
    // ==========================================

    private async step(id: string, title: string, run: () => Promise<void>): Promise<void> {
        await sleep(SETTLE_MS);
        try {
            await run();
            this.results.push({ id, title, status: 'pass' });
        } catch (err) {
            const skipped = err instanceof SkipStep;
            this.results.push({ id, title, status: skipped ? 'skip' : 'fail', detail: (err as Error)?.message ?? String(err) });
            console.log(`[Bridge self-test] ${id} ${skipped ? 'skipped' : 'FAILED'}: ${(err as Error)?.message ?? err}`);
        }
    }

    /** Poll until `check` returns null (fine); throws its last answer after WAIT_MS. */
    private async waitFor(check: () => Promise<string | null>): Promise<void> {
        const until = Date.now() + WAIT_MS;
        let problem: string | null = 'not checked';
        while (Date.now() < until) {
            problem = await check();
            if (problem === null) return;
            await sleep(250);
        }
        throw new Error(problem ?? 'timed out');
    }

    private addIt(creature: any, initiative: number): string {
        const id = this.it.addCreatureWithInitiative(creature, initiative);
        if (!id) throw new Error(`could not add ${creature.name} to IT`);
        return id;
    }

    private itById(id: string | undefined): any | null {
        return id ? this.it.getOrderedCreatures().find((c: any) => c.id === id) ?? null : null;
    }

    private trackerRef() {
        return doc(getDb(), 'caravans', this.opts.caravanId, 'initiativeTrackers', this.trackerId!);
    }

    private async trackerData(): Promise<any | null> {
        const snap = await getDoc(this.trackerRef());
        return snap.exists() ? snap.data() : null;
    }

    private async combatants(): Promise<WebappCombatant[]> {
        return (await this.trackerData())?.combatants || [];
    }

    /** Write like the webapp does: the whole combatants array, plus any extra fields. */
    private async webappWrite(combatants: WebappCombatant[], extra: Record<string, unknown> = {}): Promise<void> {
        await updateDoc(this.trackerRef(), { combatants, ...extra, updatedAt: serverTimestamp() });
    }

    private webappPc(key: string, name: string, initiative: number): WebappCombatant {
        return {
            id: `selftest_${key}_${Date.now()}`, name, type: 'Player Character', initiative,
            hp: 30, maxHp: 30, ac: 14, isHiddenFromPlayers: false,
        };
    }

    private initiativeMismatch(list: WebappCombatant[]): string | null {
        for (const c of list) {
            const creature = this.itById(c.obsidianId);
            if (creature && creature.initiative !== c.initiative) {
                return `${c.name}: IT ${creature.initiative}, webapp ${c.initiative}`;
            }
        }
        return null;
    }

    private async orderProblem(): Promise<string | null> {
        const it = this.it.getOrderedCreatures().map((c: any) => ({ id: c.id, name: itName(c) }));
        const mismatch = orderMismatch(await this.combatants(), it);
        return mismatch ? `order differs (${mismatch})` : null;
    }

    private async cleanup(): Promise<void> {
        if (this.bridge.isConnected) await this.bridge.disconnect();
        for (const c of this.it.getOrderedCreatures()) this.it.removeCreature(c.id);

        const failed = this.results.some(r => r.status === 'fail');
        let trackerKept = !!this.trackerId && failed;
        if (this.trackerId && !failed) {
            try {
                await deleteDoc(this.trackerRef());
            } catch (err) {
                trackerKept = true;
                console.error('[Bridge self-test] Could not delete the test tracker:', err);
            }
        }

        const report = formatReport(this.results, {
            date: new Date().toLocaleString('nl-NL'),
            pluginVersion: this.opts.pluginVersion,
            itVersion: this.it.getVersion() ?? 'unknown',
            campaign: this.campaignName,
            tracker: this.trackerName || '(none)',
            trackerKept,
        });
        const existing = this.app.vault.getAbstractFileByPath(REPORT_PATH);
        const file = existing instanceof TFile
            ? (await this.app.vault.modify(existing, report), existing)
            : await this.app.vault.create(REPORT_PATH, report);
        await this.app.workspace.getLeaf(true).openFile(file);

        const passed = this.results.filter(r => r.status === 'pass').length;
        new Notice(`🧪 Bridge self-test done: ${passed}/${this.results.length} passed. Report: ${REPORT_PATH}`, 10000);
    }
}

/** Asks before the self-test clears the IT encounter. */
export class SelfTestConfirmModal extends Modal {
    constructor(app: App, private test: BridgeSelfTest) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '🧪 Bridge self-test' });
        contentEl.createEl('p', {
            text: `This clears the Initiative Tracker encounter (${this.test.creatureCount} creatures now), ` +
                `disconnects the bridge and makes a test tracker in "${this.test.campaign}". ` +
                'It takes about a minute. Leave Obsidian alone until the report note opens.',
        });
        const buttons = contentEl.createDiv({ cls: 'hwy-button-container' });
        buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const start = buttons.createEl('button', { text: 'Start', cls: 'mod-cta' });
        start.addEventListener('click', () => {
            this.close();
            this.test.run();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
