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
    authenticateWithApiToken, isAuthenticated, getDb,
    doc, getDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../firebase';
import { isTestCampaign, versionAtLeast, orderMismatch, editCombatant, formatReport, type StepResult } from './checks';

const MIN_IT_VERSION = '13.0.17';
// Longer than the bridge's echo window (2 s), so each action is seen as a new change.
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
        const members: any[] = caravan!.characterMembers || [];
        const member = members.find(m => m?.characterId && m?.name);
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
                throw new SkipStep(`no write access to the test character (${String(err)})`);
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

        await this.step('D3', 'A player removed in IT stays alive in the webapp', async () => {
            if (!this.ids.long) throw new SkipStep(`C1 did not add ${SHORT_PC}`);
            this.it.removeCreature(this.ids.long);
            await sleep(SETTLE_MS);
            const player = (await this.combatants()).find(c => c.id === this.webappIds.long);
            if (!player) throw new Error(`${SHORT_PC} is gone from the webapp`);
            if (player.isDead) throw new Error(`${SHORT_PC} was marked dead`);
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
