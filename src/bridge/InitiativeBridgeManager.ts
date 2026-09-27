// src/bridge/InitiativeBridgeManager.ts
// v14 - 27-09-2026 - Link pass on connect (no duplicate PCs after restart), IT players auto-linked to caravan PCs,
//                    creatures addressed by IT id, new-encounter and tracker-close detection, tracker ownerUid

import { App, Notice } from 'obsidian';
import { ITPluginAccess, type ITCreatureState, type ITViewState } from './itPluginAccess';
import { itCreatureToWebappCombatant, webappCombatantToITCreature, type WebappCombatant } from './fieldMapping';
import { planLinks, matchCaravanPc, buildPcCombatant, type CaravanPc, type ItCreatureRef } from './linking';
import {
    doc, getDoc, setDoc, updateDoc, collection,
    onSnapshot, getDocs, serverTimestamp,
    type Unsubscribe
} from '../firebase';
import { getDb, getCurrentUser } from '../firebase';

// Suppress echo loops — ignore changes within this window (ms)
const ECHO_SUPPRESSION_MS = 2000;
// Wait this long after a layout change before deciding the tracker view is really closed.
const TRACKER_CLOSE_GRACE_MS = 1500;

// No bridgeSortCombatants needed — the webapp is the master.
// We use "Enforced Initiative" (fake init values) to force the IT plugin
// to display in the exact order the webapp dictates via sortIndex.

/**
 * Helper: get the "full display name" from an IT Creature object.
 * IT creatures with the same base name get numbered: "Goblin 1", "Goblin 2", etc.
 * The number is on the live Creature object, NOT in toJSON()/CreatureState.
 */
function getCreatureDisplayName(creature: any): string {
    if (creature.getName) {
        return creature.getName(); // Returns "Goblin 1", "Goblin 2" etc.
    }
    // Fallback for CreatureState (no getName)
    return creature.display || creature.name;
}

function toCreatureRef(creature: any): ItCreatureRef {
    const modifier = Array.isArray(creature.modifier) ? creature.modifier[0] : creature.modifier;
    return {
        id: creature.id,
        name: creature.name,
        displayName: getCreatureDisplayName(creature),
        player: creature.player === true,
        initiative: creature.initiative,
        modifier: typeof modifier === 'number' ? modifier : 0,
    };
}

/** Webapp combatant for an IT monster/ally (players go through the caravan link instead). */
function monsterCombatantFromIT(creature: any): WebappCombatant {
    const state = creature.toJSON ? creature.toJSON() as ITCreatureState : creature;
    const combatant = itCreatureToWebappCombatant(state);
    combatant.name = getCreatureDisplayName(creature); // Full name with number
    combatant.id = `obs_${state.id}_${Date.now()}`;
    combatant.obsidianId = state.id;
    return combatant;
}

/**
 * Core orchestrator for bidirectional sync between the IT plugin and Firestore.
 *
 * Matching strategy: Each Firestore combatant stores `obsidianId` which maps to
 * the IT creature's `id` field. IT gives players a new id whenever Obsidian
 * restarts, so every connect runs a link pass (linking.ts) that repairs stale ids
 * by name before any sync happens.
 */
export class InitiativeBridgeManager {
    private app: App;
    private itAccess: ITPluginAccess;

    // Connection state
    private _isConnected: boolean = false;
    private caravanId: string | null = null;
    private trackerId: string | null = null;
    private firestoreUnsubscribe: Unsubscribe | null = null;
    private characterUnsubscribes: Unsubscribe[] = [];
    private itEventRefs: any[] = [];
    private trackerCloseTimer: number | null = null;

    // Echo loop prevention
    private suppressFirestoreUntil: number = 0;
    private suppressITUntil: number = 0;
    private isDisconnecting: boolean = false;

    // Last known state for diffing
    private lastFirestoreState: any = null;
    private lastITCreatureIds: Set<string> = new Set();
    // Map from IT creature.id → last known state
    private lastITCreatureMap: Map<string, { name: string; hp: number; initiative: number; hidden: boolean; active: boolean; player: boolean }> = new Map();

    // PC character data cache (from Firestore character docs)
    private pcCharacterData: Map<string, any> = new Map();
    private monitoredPcIds: Set<string> = new Set();

    // Caravan player characters, for linking IT players to webapp PCs
    private caravanPcs: CaravanPc[] = [];
    private warnedUnlinkedPlayers: Set<string> = new Set();

    // Status change callback for UI components (status bar, sidebar)
    public onStatusChange: ((connected: boolean, info?: { trackerName?: string; caravanId?: string }) => void) | null = null;

    get isConnected(): boolean {
        return this._isConnected;
    }

    get trackerName(): string | null {
        return this.lastFirestoreState?.name || null;
    }

    /** Get current bridge status info for UI display */
    getStatusInfo(): { connected: boolean; trackerName: string | null; caravanId: string | null; combatantCount: number; round: number; turn: number } {
        return {
            connected: this._isConnected,
            trackerName: this.lastFirestoreState?.name || null,
            caravanId: this.caravanId,
            combatantCount: this.lastFirestoreState?.combatants?.length || 0,
            round: this.lastFirestoreState?.round || 0,
            turn: this.lastFirestoreState?.turn || 0,
        };
    }

    constructor(app: App) {
        this.app = app;
        this.itAccess = new ITPluginAccess(app);
    }

    // ==========================================
    // CONNECTION LIFECYCLE
    // ==========================================

    async fetchActiveTrackers(caravanId: string): Promise<any[]> {
        const db = getDb();
        if (!db) throw new Error('Firestore not initialized');

        const trackersRef = collection(db, 'caravans', caravanId, 'initiativeTrackers');
        const snapshot = await getDocs(trackersRef);

        return snapshot.docs.map(d => ({
            id: d.id,
            name: d.data().name || 'Unnamed',
            round: d.data().round || 1,
            combatantCount: (d.data().combatants || []).length,
        }));
    }

    /** Load the caravan's player characters (name + character id) for linking. */
    private async loadCaravanPcs(caravanId: string): Promise<CaravanPc[]> {
        try {
            const snap = await getDoc(doc(getDb(), 'caravans', caravanId));
            const members: any[] = snap.exists() ? (snap.data().characterMembers || []) : [];
            this.caravanPcs = members
                .filter(m => m?.characterId && m?.name)
                .map(m => ({ characterId: m.characterId, name: m.name }));
        } catch (err) {
            console.error('[Bridge] Could not load caravan characters:', err);
            this.caravanPcs = [];
        }
        return this.caravanPcs;
    }

    private noticeUnlinkedPlayers(names: string[]): void {
        const fresh = names.filter(n => !this.warnedUnlinkedPlayers.has(n));
        if (fresh.length === 0) return;
        fresh.forEach(n => this.warnedUnlinkedPlayers.add(n));
        new Notice(
            `⚠️ Not linked to a caravan character: ${fresh.join(', ')}.\n` +
            'They stay in Obsidian only. Use the same name as in the webapp to sync HP and AC.',
            10000
        );
    }

    /**
     * Create a new tracker in Firestore from the current IT encounter.
     * IT players become proper webapp PCs (linked to their caravan character);
     * players without a caravan character are left out so no unsynced copies appear.
     */
    async createNewTracker(caravanId: string, name: string): Promise<string> {
        const db = getDb();
        if (!db) throw new Error('Firestore not initialized');

        const liveCreatures = this.itAccess.getOrderedCreatures();
        const pcs = await this.loadCaravanPcs(caravanId);
        const plan = planLinks([], liveCreatures.map(toCreatureRef), pcs);

        const monsters = liveCreatures
            .filter((c: any) => !c.player)
            .map(monsterCombatantFromIT);
        const combatants = [...plan.newPcCombatants, ...monsters];

        const user = getCurrentUser();
        let creatorName = 'Obsidian';
        if (user) {
            try {
                const profile = await getDoc(doc(db, 'users', user.uid));
                creatorName = profile.exists() ? (profile.data().screenName || creatorName) : creatorName;
            } catch {
                // Name is cosmetic; keep the default.
            }
        }

        const trackerRef = doc(collection(db, 'caravans', caravanId, 'initiativeTrackers'));
        await setDoc(trackerRef, {
            name,
            combatants,
            round: 1,
            turn: 0,
            caravanId,
            // Same fields as the webapp's createInitiativeTracker, so the DM gets DM view there.
            ...(user ? { ownerUid: user.uid } : {}),
            creatorName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        this.noticeUnlinkedPlayers(plan.unlinkedPlayers);
        return trackerRef.id;
    }

    /**
     * Link the IT encounter to an existing webapp tracker (also used to reconnect
     * next session): repair stale obsidianIds, link IT players to their webapp PCs,
     * and add IT monsters the tracker doesn't have yet. Nothing is added twice.
     */
    async mergeWithExistingTracker(caravanId: string, trackerId: string): Promise<void> {
        const db = getDb();
        if (!db) throw new Error('Firestore not initialized');

        const trackerRef = doc(db, 'caravans', caravanId, 'initiativeTrackers', trackerId);
        const snap = await getDoc(trackerRef);
        if (!snap.exists()) throw new Error('Tracker not found');

        const existingCombatants: WebappCombatant[] = snap.data().combatants || [];
        const liveCreatures = this.itAccess.getOrderedCreatures();
        const pcs = await this.loadCaravanPcs(caravanId);
        const plan = planLinks(existingCombatants, liveCreatures.map(toCreatureRef), pcs);

        const combatants = existingCombatants.map(c => ({ ...c }));
        for (const { index, obsidianId } of plan.relinks) {
            combatants[index].obsidianId = obsidianId;
        }

        // IT monsters the tracker doesn't know yet (players are handled by the link plan).
        const newMonsters = liveCreatures
            .filter((c: any) => !c.player && !plan.claimedItIds.has(c.id))
            .map(monsterCombatantFromIT);

        const added = [...plan.newPcCombatants, ...newMonsters];
        if (plan.relinks.length > 0 || added.length > 0) {
            await updateDoc(trackerRef, {
                combatants: [...combatants, ...added],
                updatedAt: serverTimestamp(),
            });
            console.log(`[Bridge] Link pass: ${plan.relinks.length} relinked, ${plan.newPcCombatants.length} PCs linked, ${newMonsters.length} monsters added`);
        }

        this.noticeUnlinkedPlayers(plan.unlinkedPlayers);
    }

    /**
     * Start the bidirectional sync.
     */
    async connect(caravanId: string, trackerId: string): Promise<void> {
        if (this._isConnected) {
            await this.disconnect();
        }

        this.caravanId = caravanId;
        this.trackerId = trackerId;
        this._isConnected = true;
        if (this.caravanPcs.length === 0) {
            await this.loadCaravanPcs(caravanId);
        }

        this.onStatusChange?.(true, { caravanId });

        // Store initial IT creature state
        this.snapshotITState();

        // 1. Start Firestore tracker listener
        this.startFirestoreListener();

        // 2. Start IT plugin event listeners
        this.startITListeners();

        console.log(`[Bridge] Connected: ${caravanId}/${trackerId}`);
    }

    /**
     * Capture the current IT state for diff tracking.
     */
    private snapshotITState(): void {
        const itCreatures = this.itAccess.getOrderedCreatures();
        this.lastITCreatureIds.clear();
        this.lastITCreatureMap.clear();

        for (const c of itCreatures) {
            const id = c.id;
            this.lastITCreatureIds.add(id);
            this.lastITCreatureMap.set(id, {
                name: getCreatureDisplayName(c),
                hp: c.hp ?? 0,
                initiative: c.initiative ?? 0,
                hidden: c.hidden ?? false,
                active: c.active ?? false,
                player: c.player === true,
            });
        }
    }

    /**
     * Stop the sync and clean up.
     */
    async disconnect(): Promise<void> {
        // Set flag FIRST to prevent save-state from processing
        this._isConnected = false;
        this.isDisconnecting = true;

        if (this.firestoreUnsubscribe) {
            this.firestoreUnsubscribe();
            this.firestoreUnsubscribe = null;
        }

        // Unsubscribe character listeners
        for (const unsub of this.characterUnsubscribes) {
            unsub();
        }
        this.characterUnsubscribes = [];
        this.monitoredPcIds.clear();

        for (const ref of this.itEventRefs) {
            this.app.workspace.offref(ref);
        }
        this.itEventRefs = [];
        if (this.trackerCloseTimer !== null) {
            window.clearTimeout(this.trackerCloseTimer);
            this.trackerCloseTimer = null;
        }

        this.isDisconnecting = false;
        this.caravanId = null;
        this.trackerId = null;
        this.lastFirestoreState = null;
        this.lastITCreatureIds.clear();
        this.lastITCreatureMap.clear();
        this.pcCharacterData.clear();
        this.caravanPcs = [];
        this.warnedUnlinkedPlayers.clear();

        new Notice('🔴 Initiative Bridge disconnected');
        console.log('[Bridge] Disconnected');
        this.onStatusChange?.(false);
    }

    // ==========================================
    // CREATURE LOOKUP
    // ==========================================

    /**
     * Key for ITPluginAccess: the linked IT creature id when it is live,
     * otherwise the combatant's name (display-name fallback).
     */
    private creatureKey(combatant: WebappCombatant): string {
        if (combatant.obsidianId && this.itAccess.findCreature(combatant.obsidianId)?.id === combatant.obsidianId) {
            return combatant.obsidianId;
        }
        return combatant.name;
    }

    /** Is there a live IT creature for this combatant (by id or display name)? */
    private hasITCreature(combatant: WebappCombatant): boolean {
        return this.itAccess.findCreature(this.creatureKey(combatant)) !== null;
    }

    // ==========================================
    // FIRESTORE → OBSIDIAN
    // ==========================================

    private startFirestoreListener(): void {
        const db = getDb();
        if (!db || !this.caravanId || !this.trackerId) return;

        const trackerRef = doc(db, 'caravans', this.caravanId, 'initiativeTrackers', this.trackerId);

        this.firestoreUnsubscribe = onSnapshot(trackerRef, (snapshot) => {
            if (!snapshot.exists()) {
                new Notice('⚠️ Tracker was deleted');
                this.disconnect();
                return;
            }

            const data = snapshot.data();
            if (!data) return;

            if (Date.now() < this.suppressFirestoreUntil) {
                this.lastFirestoreState = data;
                // Still set up character listeners on first load
                if (this.characterUnsubscribes.length === 0) {
                    this.setupCharacterListeners(data.combatants || []);
                }
                return;
            }
            // CRITICAL: Set lastFirestoreState BEFORE processing so that
            // assignObsidianId() and handleCharacterDataChange() can read current data
            const prevState = this.lastFirestoreState;
            this.lastFirestoreState = data;

            this.handleFirestoreChange(data, prevState);
        });
    }

    /**
     * Set up listeners for PC character documents to get live HP/AC from D&D Beyond.
     */
    private setupCharacterListeners(combatants: WebappCombatant[]): void {
        const db = getDb();
        if (!db) return;

        // Clean up old listeners
        for (const unsub of this.characterUnsubscribes) {
            unsub();
        }
        this.characterUnsubscribes = [];
        this.monitoredPcIds.clear();

        // Find unique PC IDs
        const pcIds = new Set<string>();
        for (const combatant of combatants) {
            const pcId = combatant.pcId || (combatant as any).ownerId;
            if (pcId && (combatant.type === 'Player Character' || (combatant as any).isPlayerSummon)) {
                pcIds.add(pcId);
            }
        }

        // Listen to each character document
        for (const pcId of pcIds) {
            const charRef = doc(db, 'characters', pcId);
            const unsub = onSnapshot(charRef, (snap) => {
                if (snap.exists()) {
                    const charData = { id: snap.id, ...snap.data() };
                    const prevData = this.pcCharacterData.get(pcId);
                    this.pcCharacterData.set(pcId, charData);

                    // Push HP/AC changes to Obsidian (prevData null = first load, full sync)
                    if (this._isConnected) {
                        this.handleCharacterDataChange(pcId, charData, prevData ?? null);
                    }
                }
            });
            this.characterUnsubscribes.push(unsub);
        }

        console.log(`[Bridge] Listening to ${pcIds.size} character docs for HP/AC sync`);
        this.monitoredPcIds = pcIds;
    }

    /**
     * Check if the set of PC IDs in the combatant list changed, and refresh listeners if so.
     */
    private refreshCharacterListenersIfNeeded(combatants: WebappCombatant[]): void {
        const currentPcIds = new Set<string>();
        for (const combatant of combatants) {
            const pcId = combatant.pcId || (combatant as any).ownerId;
            if (pcId && (combatant.type === 'Player Character' || (combatant as any).isPlayerSummon)) {
                currentPcIds.add(pcId);
            }
        }

        // Check if the set changed
        if (currentPcIds.size !== this.monitoredPcIds.size ||
            [...currentPcIds].some(id => !this.monitoredPcIds.has(id))) {
            console.log(`[Bridge] PC set changed (${this.monitoredPcIds.size} → ${currentPcIds.size}), refreshing character listeners`);
            this.setupCharacterListeners(combatants);
        }
    }

    /**
     * When a character document changes (HP/AC from D&D Beyond), push to Obsidian.
     */
    private handleCharacterDataChange(pcId: string, charData: any, prevData: any): void {
        // NOTE: No suppressITUntil check here — character doc changes are one-directional
        // (Firestore → IT) so there's no echo loop risk.

        const combatants: WebappCombatant[] = this.lastFirestoreState?.combatants || [];

        for (const combatant of combatants) {
            const refId = combatant.pcId || (combatant as any).ownerId;
            if (refId !== pcId) continue;

            const name = combatant.name;
            const key = this.creatureKey(combatant);
            const isSummon = combatant.type === 'Summon' && (combatant as any).isPlayerSummon;

            // --- Resolve effective HP based on combatant type ---
            let effectiveHP: number | undefined;
            let effectiveMaxHP: number | undefined;
            let effectiveAC: number | string | undefined;

            if (isSummon) {
                // Summon: read from activeSummon on the OWNER's character doc
                const summonData = charData.activeSummon;
                if (summonData && summonData.instanceId === (combatant as any).summonInstanceId) {
                    effectiveHP = summonData.currentHP;
                    effectiveMaxHP = summonData.maxHP;
                } else {
                    // No active summon data for this instance — skip
                    continue;
                }
            } else {
                // PC: check for wildshape first, then base stats
                const wildshapeData = charData.activeWildshapeData;
                if (wildshapeData) {
                    // Wildshaped — show wildshape HP
                    effectiveHP = wildshapeData.currentHP;
                    effectiveMaxHP = wildshapeData.maxHPOverride || wildshapeData.currentHP;
                } else {
                    // Normal PC stats
                    effectiveHP = charData.currentHP ?? charData.hp;
                    effectiveMaxHP = charData.maxHP ?? charData.maxHp;
                }
                effectiveAC = charData.armorClass ?? charData.ac;
            }

            // --- Apply stats ---
            if (!prevData && effectiveHP !== undefined && effectiveMaxHP !== undefined) {
                // First load — set all stats at once
                this.itAccess.setCreatureFullStats(key, effectiveHP, effectiveMaxHP, effectiveAC);
                console.log(`[Bridge] Initial stats: "${name}" → ${effectiveHP}/${effectiveMaxHP} AC:${effectiveAC ?? '-'}`);
                continue;
            }

            // Resolve previous effective stats for diffing
            let prevEffHP: number | undefined;
            let prevEffMaxHP: number | undefined;
            let prevEffAC: number | string | undefined;

            if (prevData) {
                if (isSummon) {
                    const prevSummon = prevData.activeSummon;
                    prevEffHP = prevSummon?.currentHP;
                    prevEffMaxHP = prevSummon?.maxHP;
                } else {
                    const prevWild = prevData.activeWildshapeData;
                    if (prevWild) {
                        prevEffHP = prevWild.currentHP;
                        prevEffMaxHP = prevWild.maxHPOverride || prevWild.currentHP;
                    } else {
                        prevEffHP = prevData.currentHP ?? prevData.hp;
                        prevEffMaxHP = prevData.maxHP ?? prevData.maxHp;
                    }
                    prevEffAC = prevData.armorClass ?? prevData.ac;
                }
            }

            // Detect wildshape state change (entered or exited)
            const wasWildshaped = !!prevData?.activeWildshapeData;
            const isWildshaped = !!charData.activeWildshapeData;
            if (wasWildshaped !== isWildshaped && effectiveHP !== undefined && effectiveMaxHP !== undefined) {
                // Wildshape state changed — full refresh
                this.itAccess.setCreatureFullStats(key, effectiveHP, effectiveMaxHP, effectiveAC);
                console.log(`[Bridge] Wildshape ${isWildshaped ? 'entered' : 'exited'}: "${name}" → ${effectiveHP}/${effectiveMaxHP}`);
                continue;
            }

            // Incremental updates
            if (effectiveHP !== undefined && effectiveHP !== prevEffHP) {
                this.itAccess.setCreatureHP(key, effectiveHP);
            }
            if (effectiveMaxHP !== undefined && effectiveMaxHP !== prevEffMaxHP) {
                this.itAccess.setCreatureMaxHP(key, effectiveMaxHP);
            }
            if (effectiveAC !== undefined && effectiveAC !== prevEffAC) {
                this.itAccess.setCreatureAC(key, effectiveAC);
            }
        }
    }

    private handleFirestoreChange(data: any, prevData: any): void {
        if (!this.itAccess.isAvailable()) return;

        const combatants: WebappCombatant[] = data.combatants || [];
        const prevCombatants: WebappCombatant[] = prevData?.combatants || [];

        // Refresh character listeners if the set of PC IDs changed
        this.refreshCharacterListenersIfNeeded(combatants);

        // Build lookup maps — by combatant id, obsidianId, else name
        const matchKey = (c: WebappCombatant) => c.id || c.obsidianId || c.name;
        const prevByKey = new Map<string, WebappCombatant>();
        for (const c of prevCombatants) prevByKey.set(matchKey(c), c);
        const newByKey = new Map<string, WebappCombatant>();
        for (const c of combatants) newByKey.set(matchKey(c), c);

        // --- Detect turn change ---
        if (prevData && data.turn !== prevData.turn) {
            this.handleFirestoreTurnChange(data, combatants);
        }

        // --- Detect new combatants (added from webapp, or first load) ---
        for (const c of combatants) {
            if (!prevByKey.has(matchKey(c))) {
                this.handleNewCombatantFromFirestore(c);
            }
        }

        // --- Detect removed combatants ---
        for (const c of prevCombatants) {
            if (!newByKey.has(matchKey(c))) {
                this.handleRemovedCombatantFromFirestore(c);
            }
        }

        // --- Detect initiative changes (webapp → IT) ---
        for (const c of combatants) {
            const prev = prevByKey.get(matchKey(c));
            if (prev && prev.initiative !== c.initiative && c.initiative !== null) {
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                this.itAccess.setCreatureInitiative(this.creatureKey(c), c.initiative);
            }
        }

        // --- Detect death/revive changes (webapp → Obsidian) ---
        for (const c of combatants) {
            const prev = prevByKey.get(matchKey(c));
            if (!this.hasITCreature(c)) continue;
            const key = this.creatureKey(c);

            if (prev && !prev.isDead && c.isDead) {
                // Killed in webapp → kill + disable in IT
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                this.itAccess.killCreature(key);
                console.log(`[Bridge] Death synced to IT: "${c.name}" (disabled)`);
            } else if (prev && prev.isDead && !c.isDead) {
                // Revived in webapp → re-enable in IT and set HP
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                this.itAccess.setCreatureEnabled(key, true);
                if (c.hp !== undefined) {
                    this.itAccess.setCreatureHP(key, c.hp);
                }
                console.log(`[Bridge] Revive synced to IT: "${c.name}" (re-enabled)`);
            } else if (!prev && c.isDead) {
                // First load — combatant already dead, disable in IT
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                this.itAccess.killCreature(key);
            }
        }

        // --- Enforced Initiative: assign fake init values to force IT order ---
        // The webapp's sortIndex is the source of truth. We assign decreasing
        // initiative values (1000, 999, 998...) so the IT plugin's own sort
        // (by initiative descending) produces the exact same order.
        this.enforceInitiativeOrder(combatants);
    }

    /**
     * Enforced Initiative: assign fake initiative values to IT creatures
     * so the IT plugin's own sort (by initiative descending) produces
     * the exact same display order as the webapp.
     *
     * Position 0 → initiative 1000, position 1 → 999, and so on.
     * Real initiative values are managed by the webapp only.
     */
    private enforceInitiativeOrder(combatants: WebappCombatant[]): void {
        const sorted = [...combatants].sort((a, b) => (a.sortIndex ?? 99999) - (b.sortIndex ?? 99999));
        if (sorted.length === 0) return;

        const itCreatures = this.itAccess.getOrderedCreatures();
        if (itCreatures.length === 0) return;

        let changed = false;
        const usedIds = new Set<string>();

        for (let i = 0; i < sorted.length; i++) {
            const c = sorted[i];
            const fakeInit = 1000 - i;

            // Find the IT creature — by obsidianId first, then by name
            let itCreature: any = null;
            if (c.obsidianId) {
                itCreature = itCreatures.find((itc: any) => itc.id === c.obsidianId);
            }
            if (!itCreature) {
                itCreature = itCreatures.find((itc: any) =>
                    !usedIds.has(itc.id) &&
                    (getCreatureDisplayName(itc) === c.name || itc.name === c.name)
                );
            }

            if (itCreature) {
                usedIds.add(itCreature.id);
                if (itCreature.initiative !== fakeInit) {
                    itCreature.initiative = fakeInit;
                    changed = true;
                }
            }
        }

        // Also set any IT creatures NOT in the webapp list to very low initiative
        for (const itc of itCreatures) {
            if (!usedIds.has(itc.id)) {
                const lowInit = -100;
                if (itc.initiative !== lowInit) {
                    itc.initiative = lowInit;
                    changed = true;
                }
            }
        }

        if (changed) {
            // Save and suppress echo — these fake values should NOT sync back
            this.itAccess.triggerSave();
            this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
            // Re-snapshot so the fake values become the baseline
            this.snapshotITState();
        }
    }

    private handleFirestoreTurnChange(data: any, combatants: WebappCombatant[]): void {
        const turnIndex = data.turn ?? 0;

        // NOTE: Do NOT filter out dead combatants here!
        // The webapp's turn index maps into getSortedCombatants() which includes ALL combatants.
        // Dead ones are only filtered for display, not for turn indexing.
        const sorted = [...combatants]
            .sort((a, b) => (a.sortIndex ?? 99999) - (b.sortIndex ?? 99999));

        if (sorted.length === 0) return;

        const targetCombatant = sorted[turnIndex % sorted.length];
        if (targetCombatant && this.hasITCreature(targetCombatant)) {
            this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
            this.itAccess.setActiveTurn(this.creatureKey(targetCombatant));
        }
    }

    private handleNewCombatantFromFirestore(combatant: WebappCombatant): void {
        // Already in IT (linked id, or same display name)?
        if (this.hasITCreature(combatant)) return;

        // A PC the DM already has in Obsidian under a (slightly) different name,
        // e.g. IT party "Ayla" ↔ webapp "Ayla Moonwhisper": link instead of adding.
        const claimed = new Set(
            (this.lastFirestoreState?.combatants || [])
                .map((c: WebappCombatant) => c.obsidianId)
                .filter(Boolean)
        );
        const unclaimed = this.itAccess.getOrderedCreatures()
            .filter((c: any) => !claimed.has(c.id))
            .map(toCreatureRef);
        const plan = planLinks([combatant], unclaimed, []);
        if (plan.relinks.length > 0) {
            this.assignObsidianId(combatant, plan.relinks[0].obsidianId);
            return;
        }

        console.log(`[Bridge] New combatant from Firestore: "${combatant.name}"`);

        const itCreature = webappCombatantToITCreature(combatant);
        this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
        const newId = this.itAccess.addCreatureWithInitiative(itCreature, combatant.initiative ?? 0);

        // Re-apply enforced initiative order so the new creature gets
        // the correct fake initiative value and slots into position.
        const allCombatants: WebappCombatant[] = this.lastFirestoreState?.combatants || [];
        this.enforceInitiativeOrder(allCombatants);

        // Save the new IT id back to Firestore so later syncs match by id.
        if (newId && combatant.obsidianId !== newId) {
            this.assignObsidianId(combatant, newId);
        }
    }

    /**
     * Write the IT creature id back as obsidianId on the Firestore combatant.
     */
    private async assignObsidianId(combatant: WebappCombatant, obsidianId: string): Promise<void> {
        const db = getDb();
        if (!db || !this.caravanId || !this.trackerId) return;

        console.log(`[Bridge] Assigned obsidianId "${obsidianId}" to "${combatant.name}"`);

        const trackerRef = doc(db, 'caravans', this.caravanId, 'initiativeTrackers', this.trackerId);
        const currentCombatants: WebappCombatant[] = this.lastFirestoreState?.combatants || [];
        const sameCombatant = (c: WebappCombatant) => combatant.id ? c.id === combatant.id : c.name === combatant.name;

        const updated = currentCombatants.map(c => sameCombatant(c) ? { ...c, obsidianId } : c);
        // Keep the cache current so several assignments in a row don't overwrite each other.
        this.lastFirestoreState = { ...this.lastFirestoreState, combatants: updated };

        this.suppressFirestoreUntil = Date.now() + ECHO_SUPPRESSION_MS;
        try {
            await updateDoc(trackerRef, {
                combatants: updated,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('[Bridge] Failed to assign obsidianId:', err);
        }
    }

    private handleRemovedCombatantFromFirestore(combatant: WebappCombatant): void {
        if (!this.hasITCreature(combatant)) return;
        console.log(`[Bridge] Combatant removed from Firestore: "${combatant.name}"`);
        this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
        this.itAccess.removeCreature(this.creatureKey(combatant));
    }

    // ==========================================
    // OBSIDIAN → FIRESTORE
    // ==========================================

    private startITListeners(): void {
        const saveRef = (this.app.workspace as any).on(
            'initiative-tracker:save-state',
            (state?: ITViewState) => {
                if (!this._isConnected || this.isDisconnecting) return;

                if (this.isNewEncounter(state)) {
                    new Notice(
                        'New encounter in Obsidian — bridge disconnected from the old webapp tracker.\n' +
                        'Connect again to link this encounter; players are linked to their characters automatically.',
                        10000
                    );
                    this.disconnect();
                    return;
                }

                if (Date.now() < this.suppressITUntil) {
                    this.snapshotITState();
                    return;
                }
                this.handleITStateChange();
            }
        );
        this.itEventRefs.push(saveRef);

        // Disconnect when the tracker view itself closes. (IT's 'stop-viewing' event
        // belongs to the statblock pane, so it is not used here.)
        const layoutRef = this.app.workspace.on('layout-change', () => this.scheduleTrackerCloseCheck());
        this.itEventRefs.push(layoutRef);

        const unloadedRef = (this.app.workspace as any).on('initiative-tracker:unloaded', () => {
            if (this._isConnected) {
                new Notice('Initiative Tracker was disabled — bridge disconnecting');
                this.disconnect();
            }
        });
        this.itEventRefs.push(unloadedRef);

        // Another plugin started an encounter through IT's API event.
        const newEncounterRef = (this.app.workspace as any).on(
            'initiative-tracker:start-encounter',
            () => {
                if (this._isConnected) {
                    new Notice('New encounter started — bridge disconnecting');
                    this.disconnect();
                }
            }
        );
        this.itEventRefs.push(newEncounterRef);
    }

    /**
     * IT's "New encounter" keeps only the players and resets to round 1, not started.
     * Starting an encounter from a note replaces all monsters the same way.
     */
    private isNewEncounter(state?: ITViewState): boolean {
        const liveIds = new Set(this.itAccess.getOrderedCreatures().map((c: any) => c.id as string));
        const trackedMonsters = [...this.lastITCreatureMap.entries()].filter(([, s]) => !s.player);

        // Everything we tracked is gone.
        if (this.lastITCreatureIds.size > 0 && ![...this.lastITCreatureIds].some(id => liveIds.has(id))) {
            return true;
        }
        // Every tracked monster is gone and the round was reset.
        const monstersGone = trackedMonsters.length > 0 && !trackedMonsters.some(([id]) => liveIds.has(id));
        const reset = (state?.round ?? 1) <= 1 && state?.state !== true;
        return monstersGone && reset;
    }

    private scheduleTrackerCloseCheck(): void {
        if (this.trackerCloseTimer !== null) window.clearTimeout(this.trackerCloseTimer);
        this.trackerCloseTimer = window.setTimeout(() => {
            this.trackerCloseTimer = null;
            if (this._isConnected && !this.itAccess.isTrackerViewOpen()) {
                new Notice('Initiative Tracker closed — bridge disconnecting');
                this.disconnect();
            }
        }, TRACKER_CLOSE_GRACE_MS);
    }

    /**
     * Handle IT state change by diffing live Creature objects against our last snapshot.
     * Uses getOrderedCreatures() for proper display names and creature IDs.
     */
    private async handleITStateChange(): Promise<void> {
        if (!this.caravanId || !this.trackerId) return;

        const db = getDb();
        if (!db) return;

        const trackerRef = doc(db, 'caravans', this.caravanId, 'initiativeTrackers', this.trackerId);

        // Get live Creature objects from the IT plugin
        const liveCreatures = this.itAccess.getOrderedCreatures();

        // Current Firestore combatants (copies, so a failed write leaves the cache untouched)
        const currentFirestoreCombatants: WebappCombatant[] =
            (this.lastFirestoreState?.combatants || []).map((c: WebappCombatant) => ({ ...c }));
        const firestoreByObsId = new Map(
            currentFirestoreCombatants
                .filter(c => c.obsidianId)
                .map(c => [c.obsidianId!, c])
        );
        const firestoreByName = new Map(
            currentFirestoreCombatants.map(c => [c.name, c])
        );

        const firestoreUpdate: any = { updatedAt: serverTimestamp() };
        let needsFullCombatantUpdate = false;

        // Build current ID set
        const currentIds = new Set(liveCreatures.map((c: any) => c.id as string));

        // --- Detect new creatures in IT ---
        const newCombatants: WebappCombatant[] = [];
        const unlinked: string[] = [];
        for (const c of liveCreatures) {
            const id = c.id as string;
            const name = getCreatureDisplayName(c);
            if (this.lastITCreatureIds.has(id) || firestoreByObsId.has(id) || firestoreByName.has(name)) continue;

            if (c.player) {
                // Players are linked to their caravan character, never added as unsynced copies.
                const pc = matchCaravanPc(toCreatureRef(c), this.caravanPcs);
                if (!pc) {
                    unlinked.push(name);
                    continue;
                }
                const existing = currentFirestoreCombatants.find(fc => fc.pcId === pc.characterId);
                if (existing) {
                    if (!existing.obsidianId || !currentIds.has(existing.obsidianId)) {
                        existing.obsidianId = id;
                        firestoreByObsId.set(id, existing);
                        needsFullCombatantUpdate = true;
                        console.log(`[Bridge] Linked IT player "${name}" to "${existing.name}"`);
                    }
                } else {
                    newCombatants.push(buildPcCombatant(pc, toCreatureRef(c)));
                    console.log(`[Bridge] New PC from IT: "${name}" → "${pc.name}"`);
                }
                continue;
            }

            newCombatants.push(monsterCombatantFromIT(c));
            console.log(`[Bridge] New monster from IT: "${name}"`);
        }
        this.noticeUnlinkedPlayers(unlinked);

        if (newCombatants.length > 0) {
            needsFullCombatantUpdate = true;
        }

        // Creatures removed in IT are intentionally NOT removed from Firestore;
        // removal is done from the webapp (prevents new encounters wiping the tracker).

        // --- Detect changes per creature ---
        for (const c of liveCreatures) {
            const id = c.id as string;
            const prev = this.lastITCreatureMap.get(id);
            if (!prev) continue;

            const name = getCreatureDisplayName(c);
            const firestoreCombatant = firestoreByObsId.get(id) || firestoreByName.get(name);
            if (!firestoreCombatant) continue;

            // HP changed (monsters only — PC HP flows the other direction)
            if (!c.player && c.hp !== prev.hp) {
                firestoreCombatant.hp = c.hp;
                firestoreCombatant.isDead = c.hp <= 0;
                if (c.hp <= 0 && !firestoreCombatant.deathRound) {
                    firestoreCombatant.deathRound = this.lastFirestoreState?.round;
                }
                needsFullCombatantUpdate = true;

                // Auto-disable non-PC creatures at 0 HP (monsters die instantly per D&D 5e)
                // PCs are NOT auto-disabled — they get death saving throws.
                // GUARD: Only call setCreatureEnabled if state actually needs to change,
                // otherwise updateAndSave triggers save-state → re-enters handleITStateChange → infinite loop
                if (c.hp <= 0 && c.enabled !== false) {
                    this.itAccess.setCreatureEnabled(id, false);
                } else if (prev.hp <= 0 && c.hp > 0 && c.enabled !== true) {
                    // Healed back from 0 — re-enable
                    this.itAccess.setCreatureEnabled(id, true);
                    firestoreCombatant.isDead = false;
                    firestoreCombatant.deathRound = null;
                }
            }

            // Hidden flag changed
            if (c.hidden !== prev.hidden) {
                firestoreCombatant.isHiddenFromPlayers = c.hidden;
                needsFullCombatantUpdate = true;
            }

            // Initiative changed — SKIP sync from IT→Firestore.
            // We use fake initiative values (1000-N) in IT to enforce order.
            // Real initiative is managed exclusively by the webapp.

            // Turn changed (active creature)
            if (c.active && !prev.active) {
                // Use sortIndex (matches webapp's exact sort) instead of simplified sort
                const activeSorted = [...currentFirestoreCombatants]
                    .sort((a, b) => (a.sortIndex ?? -1) - (b.sortIndex ?? -1));

                const turnIndex = activeSorted.findIndex(fc => fc.obsidianId === id || fc.name === name);
                if (turnIndex >= 0) {
                    firestoreUpdate.turn = turnIndex;
                }
            }
        }

        // --- Enemy auto-reveal on turn ---
        const activeCreature = liveCreatures.find((c: any) => c.active);
        if (activeCreature && !activeCreature.player && activeCreature.hidden) {
            const activeName = getCreatureDisplayName(activeCreature);
            const fc = firestoreByObsId.get(activeCreature.id) || firestoreByName.get(activeName);
            if (fc?.isHiddenFromPlayers) {
                fc.isHiddenFromPlayers = false;
                needsFullCombatantUpdate = true;
                this.itAccess.setCreatureHidden(activeCreature.id, false);
            }
        }

        // --- Build final combatant array ---
        if (needsFullCombatantUpdate) {
            // Add new combatants (no removal — that's webapp-only)
            firestoreUpdate.combatants = [...currentFirestoreCombatants, ...newCombatants];
        }

        // --- Write to Firestore ---
        if (Object.keys(firestoreUpdate).length > 1) {
            this.suppressFirestoreUntil = Date.now() + ECHO_SUPPRESSION_MS;
            try {
                await updateDoc(trackerRef, firestoreUpdate);
            } catch (err) {
                console.error('[Bridge] Firestore write error:', err);
            }

            // If new combatants were added, schedule a delayed re-enforcement.
            // The webapp (source of truth) will auto-heal the sortIndex within ~100ms,
            // but this bridge ignores Firestore updates during the echo suppression window.
            // After suppression expires, re-read the latest Firestore state and enforce order.
            if (newCombatants.length > 0) {
                window.setTimeout(async () => {
                    if (!this._isConnected || !this.caravanId || !this.trackerId) return;
                    try {
                        const freshDoc = await getDoc(trackerRef);
                        if (!freshDoc.exists()) return;
                        const freshCombatants: WebappCombatant[] = freshDoc.data().combatants || [];
                        // Store the healed state so future operations use correct sortIndexes
                        this.lastFirestoreState = freshDoc.data();
                        this.refreshCharacterListenersIfNeeded(freshCombatants);
                        this.enforceInitiativeOrder(freshCombatants);
                    } catch (err) {
                        console.error('[Bridge] Delayed re-enforcement failed:', err);
                    }
                }, ECHO_SUPPRESSION_MS + 500);
            }
        }

        // Update tracked state
        this.snapshotITState();
    }
}
