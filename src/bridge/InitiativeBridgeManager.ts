// src/bridge/InitiativeBridgeManager.ts
// v8 - 26-02-2026 - Summon/wildshape HP sync, late PC listener refresh, external turn sync

import { App, Notice } from 'obsidian';
import { ITPluginAccess, type ITCreatureState, type ITViewState } from './itPluginAccess';
import { itCreatureToWebappCombatant, webappCombatantToITCreature, type WebappCombatant } from './fieldMapping';
import {
    doc, getDoc, setDoc, updateDoc, collection,
    onSnapshot, getDocs, serverTimestamp,
    type Unsubscribe
} from '../firebase';
import { getDb, isAuthenticated } from '../firebase';

// Suppress echo loops — ignore changes within this window (ms)
const ECHO_SUPPRESSION_MS = 2000;

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

/**
 * Core orchestrator for bidirectional sync between the IT plugin and Firestore.
 *
 * Matching strategy: Each Firestore combatant stores `obsidianId` which maps to
 * the IT creature's `id` field. This provides stable matching even when multiple
 * creatures share the same base name (e.g. "Goblin 1", "Goblin 2").
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

    // Echo loop prevention
    private suppressFirestoreUntil: number = 0;
    private suppressITUntil: number = 0;
    private isDisconnecting: boolean = false;

    // Last known state for diffing
    private lastFirestoreState: any = null;
    private lastITCreatureIds: Set<string> = new Set();
    // Map from IT creature.id → last known state
    private lastITCreatureMap: Map<string, { name: string; hp: number; initiative: number; hidden: boolean; active: boolean }> = new Map();

    // PC character data cache (from Firestore character docs)
    private pcCharacterData: Map<string, any> = new Map();
    private monitoredPcIds: Set<string> = new Set();

    get isConnected(): boolean {
        return this._isConnected;
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

    /**
     * Create a new tracker in Firestore from the current IT encounter.
     */
    async createNewTracker(caravanId: string, name: string): Promise<string> {
        const db = getDb();
        if (!db) throw new Error('Firestore not initialized');

        // Get live Creature objects for proper display names
        const itCreatures = this.itAccess.getOrderedCreatures();
        const combatants: WebappCombatant[] = itCreatures.map((c: any) => {
            const state = c.toJSON ? c.toJSON() as ITCreatureState : c;
            const displayName = getCreatureDisplayName(c);
            const combatant = itCreatureToWebappCombatant(state);
            combatant.name = displayName; // Use full name with number
            combatant.id = `obs_${state.id}_${Date.now()}`;
            combatant.obsidianId = state.id; // Store IT creature ID for matching
            return combatant;
        });

        const trackerRef = doc(collection(db, 'caravans', caravanId, 'initiativeTrackers'));

        await setDoc(trackerRef, {
            name,
            combatants,
            round: 1,
            turn: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        return trackerRef.id;
    }

    /**
     * Merge IT encounter into an existing webapp tracker.
     */
    async mergeWithExistingTracker(caravanId: string, trackerId: string): Promise<void> {
        const db = getDb();
        if (!db) throw new Error('Firestore not initialized');

        const trackerRef = doc(db, 'caravans', caravanId, 'initiativeTrackers', trackerId);
        const snap = await getDoc(trackerRef);
        if (!snap.exists()) throw new Error('Tracker not found');

        const existingData = snap.data();
        const existingCombatants: WebappCombatant[] = existingData.combatants || [];
        const existingObsidianIds = new Set(existingCombatants
            .filter(c => c.obsidianId)
            .map(c => c.obsidianId));

        // Get live Creature objects for proper display names
        const itCreatures = this.itAccess.getOrderedCreatures();
        const newCombatants: WebappCombatant[] = [];

        for (const c of itCreatures) {
            const state = c.toJSON ? c.toJSON() as ITCreatureState : c;
            // Skip if IT creature already mapped to a Firestore combatant
            if (existingObsidianIds.has(state.id)) continue;
            // Skip players — they should already exist in the webapp
            if (state.player) continue;

            const displayName = getCreatureDisplayName(c);
            const combatant = itCreatureToWebappCombatant(state);
            combatant.name = displayName;
            combatant.id = `obs_${state.id}_${Date.now()}`;
            combatant.obsidianId = state.id;
            newCombatants.push(combatant);
        }

        if (newCombatants.length > 0) {
            await updateDoc(trackerRef, {
                combatants: [...existingCombatants, ...newCombatants],
                updatedAt: serverTimestamp(),
            });
        }
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
            const name = getCreatureDisplayName(c);
            this.lastITCreatureIds.add(id);
            this.lastITCreatureMap.set(id, {
                name,
                hp: c.hp ?? 0,
                initiative: c.initiative ?? 0,
                hidden: c.hidden ?? false,
                active: c.active ?? false,
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

        for (const ref of this.itEventRefs) {
            this.app.workspace.offref(ref);
        }
        this.itEventRefs = [];

        this.isDisconnecting = false;
        this.caravanId = null;
        this.trackerId = null;
        this.lastFirestoreState = null;
        this.lastITCreatureIds.clear();
        this.lastITCreatureMap.clear();
        this.pcCharacterData.clear();

        new Notice('🔴 Initiative Bridge disconnected');
        console.log('[Bridge] Disconnected');
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
                if (!this.lastFirestoreState || this.characterUnsubscribes.length === 0) {
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

                    // Push HP/AC changes to Obsidian
                    if (this._isConnected && prevData) {
                        this.handleCharacterDataChange(pcId, charData, prevData);
                    } else if (this._isConnected) {
                        // First load — sync initial HP/AC
                        this.handleCharacterDataChange(pcId, charData, null);
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
                    console.log(`[Bridge] Wildshape HP: "${name}" → ${effectiveHP}/${effectiveMaxHP}`);
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
                this.itAccess.setCreatureFullStats(name, effectiveHP, effectiveMaxHP, effectiveAC);
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
                this.itAccess.setCreatureFullStats(name, effectiveHP, effectiveMaxHP, effectiveAC);
                console.log(`[Bridge] Wildshape ${isWildshaped ? 'entered' : 'exited'}: "${name}" → ${effectiveHP}/${effectiveMaxHP}`);
                continue;
            }

            // Incremental updates
            if (effectiveHP !== undefined && effectiveHP !== prevEffHP) {
                this.itAccess.setCreatureHP(name, effectiveHP);
                console.log(`[Bridge] HP sync: "${name}" → ${effectiveHP}`);
            }
            if (effectiveMaxHP !== undefined && effectiveMaxHP !== prevEffMaxHP) {
                this.itAccess.setCreatureMaxHP(name, effectiveMaxHP);
            }
            if (effectiveAC !== undefined && effectiveAC !== prevEffAC) {
                this.itAccess.setCreatureAC(name, effectiveAC);
                console.log(`[Bridge] AC sync: "${name}" → ${effectiveAC}`);
            }
        }
    }

    private handleFirestoreChange(data: any, prevData: any): void {
        if (!this.itAccess.isAvailable()) return;

        const combatants: WebappCombatant[] = data.combatants || [];
        const prevCombatants: WebappCombatant[] = prevData?.combatants || [];

        // Refresh character listeners if the set of PC IDs changed
        this.refreshCharacterListenersIfNeeded(combatants);

        // Build lookup maps — by obsidianId if available, else by name
        const prevByObsId = new Map<string, WebappCombatant>();
        const prevByName = new Map<string, WebappCombatant>();
        for (const c of prevCombatants) {
            if (c.obsidianId) prevByObsId.set(c.obsidianId, c);
            prevByName.set(c.name, c);
        }

        const newByObsId = new Map<string, WebappCombatant>();
        const newByName = new Map<string, WebappCombatant>();
        for (const c of combatants) {
            if (c.obsidianId) newByObsId.set(c.obsidianId, c);
            newByName.set(c.name, c);
        }

        // --- Detect turn change ---
        if (prevData && data.turn !== prevData.turn) {
            this.handleFirestoreTurnChange(data, combatants);
        }

        // --- Detect new combatants (added from webapp, or first load) ---
        for (const c of combatants) {
            const isNew = c.obsidianId
                ? !prevByObsId.has(c.obsidianId)
                : !prevByName.has(c.name);

            // On first load (no prevData), add combatants that don't exist in IT yet
            if (isNew) {
                this.handleNewCombatantFromFirestore(c);
            }
        }

        // --- Detect removed combatants ---
        for (const c of prevCombatants) {
            const isRemoved = c.obsidianId
                ? !newByObsId.has(c.obsidianId)
                : !newByName.has(c.name);

            if (isRemoved) {
                this.handleRemovedCombatantFromFirestore(c);
            }
        }

        // --- Detect initiative changes (webapp → IT) ---
        for (const c of combatants) {
            const prev = c.obsidianId
                ? prevByObsId.get(c.obsidianId)
                : prevByName.get(c.name);

            if (prev && prev.initiative !== c.initiative && c.initiative !== null) {
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                // Find the right name in IT (might be numbered)
                const itName = this.findITCreatureName(c);
                if (itName) {
                    this.itAccess.setCreatureInitiative(itName, c.initiative);
                }
            }
        }

        // --- Detect death changes (webapp → Obsidian) ---
        for (const c of combatants) {
            const prev = c.obsidianId
                ? prevByObsId.get(c.obsidianId)
                : prevByName.get(c.name);

            if (prev && !prev.isDead && c.isDead) {
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                const itName = this.findITCreatureName(c);
                if (itName) {
                    this.itAccess.killCreature(itName);
                    console.log(`[Bridge] Death synced to IT: "${itName}"`);
                }
            }
        }
    }

    /**
     * Find the IT creature name (with number suffix) that matches a Firestore combatant.
     */
    private findITCreatureName(combatant: WebappCombatant): string | null {
        if (combatant.obsidianId) {
            const creatures = this.itAccess.getOrderedCreatures();
            const match = creatures.find((c: any) => c.id === combatant.obsidianId);
            if (match) return getCreatureDisplayName(match);
        }
        // Fallback: match by name
        return combatant.name;
    }

    private handleFirestoreTurnChange(data: any, combatants: WebappCombatant[]): void {
        const turnIndex = data.turn ?? 0;

        const sorted = [...combatants]
            .filter(c => !c.isDead)
            .sort((a, b) => {
                const initDiff = (b.initiative || 0) - (a.initiative || 0);
                if (initDiff !== 0) return initDiff;
                return (b.tieBreaker || 0) - (a.tieBreaker || 0);
            });

        if (sorted.length === 0) return;

        const activeIndex = turnIndex % sorted.length;
        const targetCombatant = sorted[activeIndex];

        if (targetCombatant) {
            const itName = this.findITCreatureName(targetCombatant);
            if (itName) {
                console.log(`[Bridge] Firestore turn → "${itName}" (index ${activeIndex})`);
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                this.itAccess.setActiveTurn(itName);
            }
        }
    }

    private handleNewCombatantFromFirestore(combatant: WebappCombatant): void {
        // Don't re-add if IT already has this creature
        if (combatant.obsidianId) {
            const creatures = this.itAccess.getOrderedCreatures();
            if (creatures.some((c: any) => c.id === combatant.obsidianId)) return;
        }

        // Check by name too
        const existing = this.itAccess.getOrderedCreatures();
        const alreadyExists = existing.some((c: any) =>
            getCreatureDisplayName(c) === combatant.name
        );
        if (alreadyExists) return;

        console.log(`[Bridge] New combatant from Firestore: "${combatant.name}"`);

        const itCreature = webappCombatantToITCreature(combatant);
        this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
        this.itAccess.addCreaturesWithInitiative([{
            creature: itCreature,
            initiative: combatant.initiative ?? 0,
        }]);

        // After adding, find the IT creature and save its ID back to Firestore
        // This enables reliable matching even after webapp name changes
        if (!combatant.obsidianId) {
            this.assignObsidianId(combatant);
        }
    }

    /**
     * After adding a webapp combatant to IT, find its assigned ID and 
     * write it back as obsidianId on the Firestore combatant.
     */
    private async assignObsidianId(combatant: WebappCombatant): Promise<void> {
        const db = getDb();
        if (!db || !this.caravanId || !this.trackerId) return;

        const creatures = this.itAccess.getOrderedCreatures();
        const match = creatures.find((c: any) => {
            const name = getCreatureDisplayName(c);
            return name === combatant.name || c.name === combatant.name;
        });

        if (!match) return;

        const obsidianId = match.id as string;
        console.log(`[Bridge] Assigned obsidianId "${obsidianId}" to "${combatant.name}"`);

        // Update the Firestore combatant with the obsidianId
        const trackerRef = doc(db, 'caravans', this.caravanId, 'initiativeTrackers', this.trackerId);
        const currentCombatants: WebappCombatant[] = this.lastFirestoreState?.combatants || [];

        const updated = currentCombatants.map(c => {
            if (c.id === combatant.id || c.name === combatant.name) {
                return { ...c, obsidianId };
            }
            return c;
        });

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
        const itName = this.findITCreatureName(combatant);
        if (itName) {
            console.log(`[Bridge] Combatant removed from Firestore: "${itName}"`);
            this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
            this.itAccess.removeCreatureByName(itName);
        }
    }

    // ==========================================
    // OBSIDIAN → FIRESTORE
    // ==========================================

    private startITListeners(): void {
        const saveRef = (this.app.workspace as any).on(
            'initiative-tracker:save-state',
            (state: ITViewState) => {
                if (!this._isConnected || this.isDisconnecting) return;

                // Guard: If most tracked creatures vanished, this is likely a new encounter.
                // Don't sync this to Firestore — let the start-encounter event handle disconnect.
                const liveCreatures = this.itAccess.getOrderedCreatures();
                const liveIds = new Set(liveCreatures.map((c: any) => c.id as string));
                let matchCount = 0;
                for (const id of this.lastITCreatureIds) {
                    if (liveIds.has(id)) matchCount++;
                }
                // If we had tracked creatures and now 0 match, a new encounter started
                if (this.lastITCreatureIds.size > 0 && matchCount === 0) {
                    console.log('[Bridge] All tracked creatures gone — likely new encounter, skipping sync');
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

        // Auto-disconnect on tracker close
        const stopRef = (this.app.workspace as any).on(
            'initiative-tracker:stop-viewing',
            () => {
                if (this._isConnected) {
                    new Notice('Initiative Tracker closed — bridge disconnecting');
                    this.disconnect();
                }
            }
        );
        this.itEventRefs.push(stopRef);

        // Auto-disconnect on new encounter
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

        // Current Firestore combatants
        const currentFirestoreCombatants: WebappCombatant[] =
            this.lastFirestoreState?.combatants || [];
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
        const newMonsters: WebappCombatant[] = [];
        for (const c of liveCreatures) {
            const id = c.id as string;
            const name = getCreatureDisplayName(c);

            if (!this.lastITCreatureIds.has(id) && !firestoreByObsId.has(id)) {
                // Also check by display name (in case it was added from webapp without obsidianId)
                if (!firestoreByName.has(name)) {
                    const state = c.toJSON ? c.toJSON() as ITCreatureState : c;
                    const combatant = itCreatureToWebappCombatant(state);
                    combatant.name = name; // Full name with number
                    combatant.id = `obs_${id}_${Date.now()}`;
                    combatant.obsidianId = id;
                    newMonsters.push(combatant);
                    console.log(`[Bridge] New monster from IT: "${name}" (hidden: ${combatant.isHiddenFromPlayers})`);
                }
            }
        }

        if (newMonsters.length > 0) {
            needsFullCombatantUpdate = true;
        }

        // --- Detect removed creatures (log only, don't remove from Firestore) ---
        // We intentionally do NOT remove creatures from Firestore when they disappear from IT.
        // This prevents new encounters from wiping the webapp's tracker.
        // Removal should be done manually from the webapp.
        for (const prevId of this.lastITCreatureIds) {
            if (!currentIds.has(prevId)) {
                const prevName = this.lastITCreatureMap.get(prevId)?.name;
                console.log(`[Bridge] Creature no longer in IT (not removing from Firestore): "${prevName}"`);
            }
        }

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
                console.log(`[Bridge] HP change: "${name}" → ${c.hp}`);
            }

            // Hidden flag changed
            if (c.hidden !== prev.hidden) {
                firestoreCombatant.isHiddenFromPlayers = c.hidden;
                needsFullCombatantUpdate = true;
            }

            // Initiative changed
            if (c.initiative !== prev.initiative) {
                firestoreCombatant.initiative = c.initiative;
                needsFullCombatantUpdate = true;
                console.log(`[Bridge] Initiative change: "${name}" → ${c.initiative}`);
            }

            // Turn changed (active creature)
            if (c.active && !prev.active) {
                // This creature became active — find its turn index
                const activeSorted = [...currentFirestoreCombatants]
                    .filter(fc => !fc.isDead)
                    .sort((a, b) => {
                        const initDiff = (b.initiative || 0) - (a.initiative || 0);
                        if (initDiff !== 0) return initDiff;
                        return (b.tieBreaker || 0) - (a.tieBreaker || 0);
                    });

                const turnIndex = activeSorted.findIndex(fc =>
                    fc.obsidianId === id || fc.name === name
                );
                if (turnIndex >= 0) {
                    firestoreUpdate.turn = turnIndex;
                    console.log(`[Bridge] Turn change → "${name}" (index ${turnIndex})`);
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
                this.itAccess.setCreatureHidden(activeName, false);
                console.log(`[Bridge] Auto-reveal: "${activeName}"`);
            }
        }

        // --- Build final combatant array ---
        if (needsFullCombatantUpdate) {
            // Add new monsters (no removal — that's webapp-only)
            let result = [...currentFirestoreCombatants, ...newMonsters];
            firestoreUpdate.combatants = result;
        }

        // --- Write to Firestore ---
        if (Object.keys(firestoreUpdate).length > 1) {
            this.suppressFirestoreUntil = Date.now() + ECHO_SUPPRESSION_MS;
            try {
                await updateDoc(trackerRef, firestoreUpdate);
            } catch (err) {
                console.error('[Bridge] Firestore write error:', err);
            }
        }

        // Update tracked state
        this.snapshotITState();
    }
}
