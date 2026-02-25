// src/bridge/InitiativeBridgeManager.ts
// v3 - 25-02-2026 - PC HP/AC sync, initiative IT→Firestore, killCreature for death

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
 * Core orchestrator for bidirectional sync between the IT plugin and Firestore.
 *
 * Firestore → Obsidian:
 *   - Turn advance (via turn index change)
 *   - New combatants (summons added by webapp)
 *   - Initiative value changes
 *   - Combatant removal / death
 *
 * Obsidian → Firestore:
 *   - New monsters (hidden from players)
 *   - HP changes (including HP=0 → graveyard)
 *   - Turn advance
 *   - Enemy reveal (on their turn)
 *   - Monster removal
 */
export class InitiativeBridgeManager {
    private app: App;
    private itAccess: ITPluginAccess;

    // Connection state
    private _isConnected: boolean = false;
    private caravanId: string | null = null;
    private trackerId: string | null = null;
    private firestoreUnsubscribe: Unsubscribe | null = null;
    private itEventRefs: any[] = [];

    // Echo loop prevention
    private suppressFirestoreUntil: number = 0;
    private suppressITUntil: number = 0;

    // Last known state for diffing
    private lastFirestoreState: any = null;
    private lastITState: ITViewState | null = null;
    private lastITCreatureNames: Set<string> = new Set();

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

    /**
     * Fetch active trackers for carrier selection UI.
     */
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
     * Create a new tracker in Firestore and return its ID.
     */
    async createNewTracker(caravanId: string, name: string): Promise<string> {
        const db = getDb();
        if (!db) throw new Error('Firestore not initialized');

        // Build combatant list from current IT state
        const itCreatures = this.itAccess.getOrderedCreatures();
        const combatants: WebappCombatant[] = itCreatures.map((c: any) => {
            const state = c.toJSON ? c.toJSON() as ITCreatureState : c;
            const combatant = itCreatureToWebappCombatant(state);
            combatant.id = `obs_${state.id || state.name.replace(/\s/g, '_')}_${Date.now()}`;
            return combatant;
        });

        // Create the tracker document
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
     * Merge the current IT encounter into an existing webapp tracker.
     */
    async mergeWithExistingTracker(caravanId: string, trackerId: string): Promise<void> {
        const db = getDb();
        if (!db) throw new Error('Firestore not initialized');

        const trackerRef = doc(db, 'caravans', caravanId, 'initiativeTrackers', trackerId);
        const snap = await getDoc(trackerRef);
        if (!snap.exists()) throw new Error('Tracker not found');

        const existingData = snap.data();
        const existingCombatants: WebappCombatant[] = existingData.combatants || [];
        const existingNames = new Set(existingCombatants.map(c => c.name));

        // Get IT creatures and add any that don't already exist
        const itCreatures = this.itAccess.getOrderedCreatures();
        const newCombatants: WebappCombatant[] = [];

        for (const c of itCreatures) {
            const state = c.toJSON ? c.toJSON() as ITCreatureState : c;
            if (state.player) continue; // Don't re-add players that are already in webapp
            if (existingNames.has(state.display || state.name)) continue;

            const combatant = itCreatureToWebappCombatant(state);
            combatant.id = `obs_${state.id || state.name.replace(/\s/g, '_')}_${Date.now()}`;
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

        // Store initial IT state
        const itCreatures = this.itAccess.getOrderedCreatures();
        this.lastITCreatureNames = new Set(
            itCreatures.map((c: any) => c.getName?.() || c.name)
        );

        // 1. Start Firestore listener
        this.startFirestoreListener();

        // 2. Start IT plugin event listeners
        this.startITListeners();

        console.log(`[Bridge] Connected: ${caravanId}/${trackerId}`);
    }

    /**
     * Stop the sync and clean up.
     */
    async disconnect(): Promise<void> {
        // Unsubscribe Firestore listener
        if (this.firestoreUnsubscribe) {
            this.firestoreUnsubscribe();
            this.firestoreUnsubscribe = null;
        }

        // Unregister IT event listeners
        for (const ref of this.itEventRefs) {
            this.app.workspace.offref(ref);
        }
        this.itEventRefs = [];

        this._isConnected = false;
        this.caravanId = null;
        this.trackerId = null;
        this.lastFirestoreState = null;
        this.lastITState = null;
        this.lastITCreatureNames.clear();

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

            // Skip if we just pushed changes (echo prevention)
            if (Date.now() < this.suppressFirestoreUntil) {
                this.lastFirestoreState = data;
                return;
            }

            this.handleFirestoreChange(data);
            this.lastFirestoreState = data;
        });
    }

    private handleFirestoreChange(data: any): void {
        if (!this.itAccess.isAvailable()) return;

        const prevData = this.lastFirestoreState;
        const combatants: WebappCombatant[] = data.combatants || [];
        const prevCombatants: WebappCombatant[] = prevData?.combatants || [];

        // Build lookup maps
        const prevMap = new Map(prevCombatants.map(c => [c.name, c]));
        const newMap = new Map(combatants.map(c => [c.name, c]));

        // --- Detect turn change ---
        if (prevData && data.turn !== prevData.turn) {
            this.handleFirestoreTurnChange(data, combatants);
        }

        // --- Detect new combatants (summons/PCs added from webapp) ---
        for (const [name, combatant] of newMap) {
            if (!prevMap.has(name)) {
                this.handleNewCombatantFromFirestore(combatant);
            }
        }

        // --- Detect removed combatants ---
        for (const [name, combatant] of prevMap) {
            if (!newMap.has(name)) {
                this.handleRemovedCombatantFromFirestore(name);
            }
        }

        // --- Detect initiative changes (webapp → IT) ---
        for (const [name, combatant] of newMap) {
            const prev = prevMap.get(name);
            if (prev && prev.initiative !== combatant.initiative && combatant.initiative !== null) {
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                this.itAccess.setCreatureInitiative(name, combatant.initiative);
            }
        }

        // --- Detect death changes (webapp → Obsidian) ---
        for (const [name, combatant] of newMap) {
            const prev = prevMap.get(name);
            if (prev && !prev.isDead && combatant.isDead) {
                // Combatant was killed in webapp → kill in IT (HP=0 + Unconscious)
                this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                this.itAccess.killCreature(name);
                console.log(`[Bridge] Death synced to IT: "${name}"`);
            }
        }

        // --- Sync PC HP/AC from Firestore → Obsidian ---
        // The webapp has live D&D Beyond data for PCs; sync this TO Obsidian so DM can see stats
        for (const [name, combatant] of newMap) {
            const prev = prevMap.get(name);
            if (combatant.type !== 'Player Character' && combatant.type !== 'Summon') continue;

            // HP sync: sync if changed or on first load
            if (combatant.hp !== undefined && combatant.hp !== null) {
                if (!prev || prev.hp !== combatant.hp) {
                    this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                    this.itAccess.setCreatureHP(name, combatant.hp);
                }
            }

            // Max HP sync
            if (combatant.maxHp !== undefined && combatant.maxHp !== null) {
                if (!prev || prev.maxHp !== combatant.maxHp) {
                    this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                    this.itAccess.setCreatureMaxHP(name, combatant.maxHp);
                }
            }

            // AC sync
            if (combatant.ac !== undefined && combatant.ac !== null) {
                if (!prev || prev.ac !== combatant.ac) {
                    this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
                    this.itAccess.setCreatureAC(name, combatant.ac);
                }
            }
        }
    }

    private handleFirestoreTurnChange(data: any, combatants: WebappCombatant[]): void {
        const turnIndex = data.turn ?? 0;

        // Find which combatant should be active based on turn index
        // Sort combatants the same way the webapp does (by initiative desc, then tieBreaker)
        const sorted = [...combatants]
            .filter(c => !c.isDead)
            .sort((a, b) => {
                const initDiff = (b.initiative || 0) - (a.initiative || 0);
                if (initDiff !== 0) return initDiff;
                return (b.tieBreaker || 0) - (a.tieBreaker || 0);
            });

        const totalActive = sorted.length;
        if (totalActive === 0) return;

        const activeIndex = turnIndex % totalActive;
        const targetCombatant = sorted[activeIndex];

        if (targetCombatant) {
            console.log(`[Bridge] Firestore turn → "${targetCombatant.name}" (index ${activeIndex})`);
            this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
            this.itAccess.setActiveTurn(targetCombatant.name);
        }
    }

    private handleNewCombatantFromFirestore(combatant: WebappCombatant): void {
        // Don't re-add if IT already has this creature
        const existing = this.itAccess.getOrderedCreatures();
        const alreadyExists = existing.some((c: any) =>
            (c.getName?.() || c.name) === combatant.name
        );
        if (alreadyExists) return;

        console.log(`[Bridge] New combatant from Firestore: "${combatant.name}"`);

        // Convert to IT creature format and add
        const itCreature = webappCombatantToITCreature(combatant);

        this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
        this.itAccess.addCreaturesWithInitiative([{
            creature: itCreature,
            initiative: combatant.initiative ?? 0,
        }]);
    }

    private handleRemovedCombatantFromFirestore(name: string): void {
        console.log(`[Bridge] Combatant removed from Firestore: "${name}"`);
        this.suppressITUntil = Date.now() + ECHO_SUPPRESSION_MS;
        this.itAccess.removeCreatureByName(name);
    }

    // ==========================================
    // OBSIDIAN → FIRESTORE
    // ==========================================

    private startITListeners(): void {
        // Listen to save-state events (fires on every IT change)
        const saveRef = (this.app.workspace as any).on(
            'initiative-tracker:save-state',
            (state: ITViewState) => {
                if (!this._isConnected) return;
                if (Date.now() < this.suppressITUntil) {
                    this.lastITState = state;
                    return;
                }
                this.handleITStateChange(state);
                this.lastITState = state;
            }
        );
        this.itEventRefs.push(saveRef);

        // Listen for encounter stop → disconnect
        const stopRef = this.app.workspace.on(
            'initiative-tracker:stop-viewing' as any,
            () => {
                if (this._isConnected) {
                    new Notice('Initiative Tracker closed — bridge disconnecting');
                    this.disconnect();
                }
            }
        );
        this.itEventRefs.push(stopRef);

        // Listen for new encounter → disconnect old bridge
        const newEncounterRef = this.app.workspace.on(
            'initiative-tracker:start-encounter' as any,
            () => {
                if (this._isConnected) {
                    new Notice('New encounter started — bridge disconnecting');
                    this.disconnect();
                }
            }
        );
        this.itEventRefs.push(newEncounterRef);
    }

    private async handleITStateChange(state: ITViewState): Promise<void> {
        if (!this.caravanId || !this.trackerId) return;

        const db = getDb();
        if (!db) return;

        const trackerRef = doc(db, 'caravans', this.caravanId, 'initiativeTrackers', this.trackerId);
        const prevState = this.lastITState;
        const creatures = state.creatures || [];
        const prevCreatures = prevState?.creatures || [];

        const newNames = new Set(creatures.map(c => c.display || c.name));
        const prevNames = new Set(prevCreatures.map(c => c.display || c.name));

        // We'll build a partial update to Firestore
        const firestoreUpdate: any = { updatedAt: serverTimestamp() };
        let needsFullCombatantUpdate = false;

        // Get the current Firestore combatants
        const currentFirestoreCombatants: WebappCombatant[] =
            this.lastFirestoreState?.combatants || [];
        const firestoreMap = new Map(currentFirestoreCombatants.map(c => [c.name, c]));

        // --- Detect new monsters from IT ---
        const newMonsters: WebappCombatant[] = [];
        for (const creature of creatures) {
            const name = creature.display || creature.name;
            if (!this.lastITCreatureNames.has(name) && !firestoreMap.has(name)) {
                // New creature in IT that's not in Firestore
                const combatant = itCreatureToWebappCombatant(creature);
                combatant.id = `obs_${creature.id || name.replace(/\s/g, '_')}_${Date.now()}`;
                newMonsters.push(combatant);
                console.log(`[Bridge] New monster from IT: "${name}" (hidden: ${combatant.isHiddenFromPlayers})`);
            }
        }

        if (newMonsters.length > 0) {
            needsFullCombatantUpdate = true;
        }

        // --- Detect removed creatures from IT ---
        const removedNames: string[] = [];
        for (const prevName of this.lastITCreatureNames) {
            if (!newNames.has(prevName)) {
                removedNames.push(prevName);
                console.log(`[Bridge] Creature removed from IT: "${prevName}"`);
            }
        }

        if (removedNames.length > 0) {
            needsFullCombatantUpdate = true;
        }

        // --- Detect turn change (active creature changed) ---
        const activeCreature = creatures.find(c => c.active);
        const prevActiveCreature = prevCreatures.find(c => c.active);

        if (activeCreature && prevActiveCreature &&
            (activeCreature.display || activeCreature.name) !== (prevActiveCreature.display || prevActiveCreature.name)) {
            // Turn changed in IT → update Firestore turn index
            const activeName = activeCreature.display || activeCreature.name;
            const firestoreCombatants = needsFullCombatantUpdate
                ? this.buildUpdatedCombatantList(currentFirestoreCombatants, newMonsters, removedNames, creatures)
                : currentFirestoreCombatants;

            // Find the new turn index
            const activeSorted = firestoreCombatants
                .filter(c => !c.isDead)
                .sort((a, b) => {
                    const initDiff = (b.initiative || 0) - (a.initiative || 0);
                    if (initDiff !== 0) return initDiff;
                    return (b.tieBreaker || 0) - (a.tieBreaker || 0);
                });

            const turnIndex = activeSorted.findIndex(c => c.name === activeName);
            if (turnIndex >= 0) {
                firestoreUpdate.turn = turnIndex;
                console.log(`[Bridge] Turn change → "${activeName}" (index ${turnIndex})`);
            }

            // Update round if IT advanced
            if (state.round !== prevState?.round) {
                firestoreUpdate.round = state.round;
            }
        }

        // --- Detect HP changes for monsters ---
        for (const creature of creatures) {
            const name = creature.display || creature.name;
            const prev = prevCreatures.find(c => (c.display || c.name) === name);
            if (!prev) continue;

            // HP changed
            if (creature.currentHP !== prev.currentHP) {
                const firestoreCombatant = firestoreMap.get(name);
                if (firestoreCombatant) {
                    firestoreCombatant.hp = creature.currentHP;
                    firestoreCombatant.isDead = creature.currentHP <= 0;
                    if (creature.currentHP <= 0 && !firestoreCombatant.deathRound) {
                        firestoreCombatant.deathRound = state.round;
                    }
                    needsFullCombatantUpdate = true;
                    console.log(`[Bridge] HP change: "${name}" → ${creature.currentHP}`);
                }
            }

            // Hidden flag changed (enemy reveal)
            if (creature.hidden !== prev.hidden) {
                const firestoreCombatant = firestoreMap.get(name);
                if (firestoreCombatant) {
                    firestoreCombatant.isHiddenFromPlayers = creature.hidden;
                    needsFullCombatantUpdate = true;
                }
            }

            // Initiative changed (IT → Firestore)
            if (creature.initiative !== prev.initiative) {
                const firestoreCombatant = firestoreMap.get(name);
                if (firestoreCombatant) {
                    firestoreCombatant.initiative = creature.initiative;
                    needsFullCombatantUpdate = true;
                    console.log(`[Bridge] Initiative change: "${name}" → ${creature.initiative}`);
                }
            }
        }

        // --- Enemy auto-reveal on their turn ---
        if (activeCreature && !activeCreature.player && activeCreature.hidden) {
            const activeName = activeCreature.display || activeCreature.name;
            const firestoreCombatant = firestoreMap.get(activeName);
            if (firestoreCombatant?.isHiddenFromPlayers) {
                firestoreCombatant.isHiddenFromPlayers = false;
                needsFullCombatantUpdate = true;
                // Also reveal in IT
                this.itAccess.setCreatureHidden(activeName, false);
                console.log(`[Bridge] Auto-reveal: "${activeName}"`);
            }
        }

        // --- Build final combatant array if needed ---
        if (needsFullCombatantUpdate) {
            firestoreUpdate.combatants = this.buildUpdatedCombatantList(
                currentFirestoreCombatants, newMonsters, removedNames, creatures
            );
        }

        // --- Write to Firestore ---
        if (Object.keys(firestoreUpdate).length > 1) { // More than just updatedAt
            this.suppressFirestoreUntil = Date.now() + ECHO_SUPPRESSION_MS;
            try {
                await updateDoc(trackerRef, firestoreUpdate);
            } catch (err) {
                console.error('[Bridge] Firestore write error:', err);
            }
        }

        // Update tracked names
        this.lastITCreatureNames = newNames;
    }

    /**
     * Build the updated combatant array for Firestore.
     */
    private buildUpdatedCombatantList(
        existing: WebappCombatant[],
        toAdd: WebappCombatant[],
        toRemoveNames: string[],
        itCreatures: ITCreatureState[]
    ): WebappCombatant[] {
        // Start with existing, remove deleted ones
        let result = existing.filter(c => !toRemoveNames.includes(c.name));

        // Update existing combatants with IT data
        for (const combatant of result) {
            const itCreature = itCreatures.find(c =>
                (c.display || c.name) === combatant.name
            );
            if (itCreature && combatant.type !== 'Player Character') {
                // Sync monster HP from IT
                combatant.hp = itCreature.currentHP;
                combatant.maxHp = itCreature.currentMaxHP ?? itCreature.hp;
                combatant.isDead = itCreature.currentHP <= 0;
            }
        }

        // Add new monsters
        result = [...result, ...toAdd];

        return result;
    }
}
