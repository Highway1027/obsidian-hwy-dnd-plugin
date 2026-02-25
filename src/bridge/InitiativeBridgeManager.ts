// src/bridge/InitiativeBridgeManager.ts
// v1 - 25-02-2026 - Core bidirectional sync between Obsidian IT and webapp Firestore

import { App, Notice } from 'obsidian';
import {
    getDb, doc, getDoc, getDocs, updateDoc, setDoc,
    collection, query, where, orderBy, limit, onSnapshot,
    arrayUnion, runTransaction, serverTimestamp,
    type Unsubscribe
} from '../firebase';
import { ITPluginAccess } from './itPluginAccess';
import { itCreatureToFirestore, firestoreCombatantToIT, diffCombatants } from './fieldMapping';

export interface BridgeState {
    isConnected: boolean;
    activeTrackerId: string | null;
    activeCaravanId: string | null;
    currentRound: number;
    currentTurn: number;
}

/**
 * Core sync orchestrator for the Initiative Bridge.
 * Manages bidirectional sync between the Obsidian IT plugin and Firestore.
 */
export class InitiativeBridgeManager {
    private app: App;
    private itAccess: ITPluginAccess;

    // Connection state
    private _state: BridgeState = {
        isConnected: false,
        activeTrackerId: null,
        activeCaravanId: null,
        currentRound: 0,
        currentTurn: 0,
    };

    // Listeners / cleanup
    private firestoreUnsubscribe: Unsubscribe | null = null;
    private itStateUnsubscribe: (() => void) | null = null;
    private itStopUnsubscribe: (() => void) | null = null;

    // Echo loop prevention: ignore Firestore updates we just wrote
    private lastWriteTimestamp: number = 0;
    private suppressFirestoreUntil: number = 0;
    private suppressITUntil: number = 0;

    // Last known state for diffing
    private lastKnownFirestoreCombatants: any[] = [];
    private lastKnownITCreatures: any[] = [];

    // Map: Firestore combatant ID → IT creature name (for cross-referencing)
    private idToNameMap: Map<string, string> = new Map();
    private nameToIdMap: Map<string, string> = new Map();

    constructor(app: App) {
        this.app = app;
        this.itAccess = new ITPluginAccess(app);
    }

    get state(): BridgeState {
        return { ...this._state };
    }

    get isConnected(): boolean {
        return this._state.isConnected;
    }

    /**
     * Connect to a tracker. Sets up bidirectional listeners.
     */
    async connect(caravanId: string, trackerId: string): Promise<void> {
        if (this._state.isConnected) {
            await this.disconnect();
        }

        if (!this.itAccess.isAvailable()) {
            new Notice('❌ Initiative Tracker plugin not found. Please install/enable it.');
            throw new Error('IT plugin not available');
        }

        this._state.activeCaravanId = caravanId;
        this._state.activeTrackerId = trackerId;

        // 1. Start Firestore listener
        this.startFirestoreListener(caravanId, trackerId);

        // 2. Start IT plugin listener
        this.startITListener(caravanId, trackerId);

        this._state.isConnected = true;
        new Notice('🟢 Initiative Bridge connected!');
    }

    /**
     * Disconnect from the tracker. Cleans up all listeners.
     */
    async disconnect(): Promise<void> {
        // Unsubscribe Firestore listener
        if (this.firestoreUnsubscribe) {
            this.firestoreUnsubscribe();
            this.firestoreUnsubscribe = null;
        }

        // Unsubscribe IT plugin listeners
        if (this.itStateUnsubscribe) {
            this.itStateUnsubscribe();
            this.itStateUnsubscribe = null;
        }
        if (this.itStopUnsubscribe) {
            this.itStopUnsubscribe();
            this.itStopUnsubscribe = null;
        }

        // Reset state
        this._state = {
            isConnected: false,
            activeTrackerId: null,
            activeCaravanId: null,
            currentRound: 0,
            currentTurn: 0,
        };
        this.lastKnownFirestoreCombatants = [];
        this.lastKnownITCreatures = [];
        this.idToNameMap.clear();
        this.nameToIdMap.clear();

        new Notice('⏹ Initiative Bridge disconnected.');
    }

    // ──────────────────────────────────────────────
    //  FIRESTORE → OBSIDIAN (onSnapshot listener)
    // ──────────────────────────────────────────────

    private startFirestoreListener(caravanId: string, trackerId: string): void {
        const db = getDb();
        const trackerRef = doc(db, 'caravans', caravanId, 'initiativeTrackers', trackerId);

        this.firestoreUnsubscribe = onSnapshot(trackerRef, (snapshot) => {
            if (!snapshot.exists()) {
                console.warn('[Bridge] Tracker document deleted from Firestore.');
                this.disconnect();
                return;
            }

            // Echo loop prevention: skip if we just wrote this
            const now = Date.now();
            if (now < this.suppressFirestoreUntil) {
                return;
            }

            const data = snapshot.data();
            this.handleFirestoreUpdate(data);
        }, (error) => {
            console.error('[Bridge] Firestore listener error:', error);
            new Notice('⚠️ Initiative Bridge: connection error. Try reconnecting.');
        });
    }

    private handleFirestoreUpdate(data: any): void {
        const combatants: any[] = data.combatants || [];
        const round = data.round ?? 1;
        const turn = data.turn ?? 0;

        // Detect turn change
        if (round !== this._state.currentRound || turn !== this._state.currentTurn) {
            const turnChanged = this._state.currentRound > 0; // Skip first load
            this._state.currentRound = round;
            this._state.currentTurn = turn;

            if (turnChanged) {
                // A player advanced the turn from the webapp → update IT plugin
                this.syncTurnToIT(round, turn, combatants);
            }
        }

        // Detect combatant changes (new summons, removals, HP changes)
        const diff = diffCombatants(this.lastKnownFirestoreCombatants, combatants);

        // New combatants added from webapp (e.g., summons)
        for (const added of diff.added) {
            // Only sync webapp-originated additions (not our own obsidian-bridge adds)
            if (added.addedVia !== 'obsidian-bridge') {
                const itCreature = firestoreCombatantToIT(added);
                this.itAccess.addCreatures([itCreature]);
                // Track the mapping
                this.idToNameMap.set(added.id, added.name);
                this.nameToIdMap.set(added.name, added.id);
            }
        }

        // Combatants removed from webapp (e.g., summon graveyard)
        for (const removed of diff.removed) {
            const name = removed.name || removed._itName;
            if (name) {
                this.itAccess.removeCreature(name);
                this.nameToIdMap.delete(name);
                this.idToNameMap.delete(removed.id);
            }
        }

        // HP/AC changes from webapp (e.g., D&D Beyond sync on turn advance)
        for (const { id, changes } of diff.updated) {
            if (changes.hp !== undefined || changes.ac !== undefined) {
                const name = this.idToNameMap.get(id);
                if (name) {
                    if (changes.hp !== undefined) {
                        this.itAccess.updateCreatureHP(name, changes.hp);
                    }
                }
            }
        }

        // Update last known state
        this.lastKnownFirestoreCombatants = combatants;

        // Rebuild ID↔Name maps
        for (const c of combatants) {
            this.idToNameMap.set(c.id, c.name);
            this.nameToIdMap.set(c.name, c.id);
        }
    }

    private syncTurnToIT(round: number, turn: number, combatants: any[]): void {
        // Suppress IT listener to avoid echo
        this.suppressITUntil = Date.now() + 2000;

        // For now, we use advanceTurn which moves one step forward.
        // In the future, we could set the exact turn/round directly.
        this.itAccess.advanceTurn();
    }

    // ──────────────────────────────────────────────
    //  OBSIDIAN → FIRESTORE (IT plugin event listener)
    // ──────────────────────────────────────────────

    private startITListener(caravanId: string, trackerId: string): void {
        // Listen to IT plugin state changes
        this.itStateUnsubscribe = this.itAccess.onStateChange((state: any) => {
            // Echo loop prevention
            const now = Date.now();
            if (now < this.suppressITUntil) {
                return;
            }

            this.handleITStateChange(state, caravanId, trackerId);
        });

        // Listen for encounter stop
        this.itStopUnsubscribe = this.itAccess.onEncounterStop(() => {
            console.log('[Bridge] IT plugin encounter stopped.');
            // Don't auto-disconnect – DM might just be reorganizing
        });
    }

    private async handleITStateChange(state: any, caravanId: string, trackerId: string): Promise<void> {
        if (!state?.creatures) return;

        const creatures: any[] = state.creatures || [];
        const round = state.round ?? 1;

        // Detect which creature is active (their turn)
        const activeIndex = creatures.findIndex((c: any) => c.active);

        // Suppress Firestore listener to avoid echo
        this.suppressFirestoreUntil = Date.now() + 2000;

        const db = getDb();
        const trackerRef = doc(db, 'caravans', caravanId, 'initiativeTrackers', trackerId);

        try {
            await runTransaction(db, async (transaction) => {
                const trackerSnap = await transaction.get(trackerRef);
                if (!trackerSnap.exists()) return;

                const currentData = trackerSnap.data();
                const existingCombatants: any[] = currentData.combatants || [];

                // Build updated combatants list
                const updatedCombatants = [...existingCombatants];

                // 1. Handle new creatures from IT (DM added in Obsidian)
                for (const creature of creatures) {
                    const creatureName = creature.name || creature.display;
                    const existingId = this.nameToIdMap.get(creatureName);

                    if (!existingId) {
                        // New creature from Obsidian → add to Firestore
                        const firestoreCombatant = itCreatureToFirestore(creature);
                        updatedCombatants.push(firestoreCombatant);
                        this.idToNameMap.set(firestoreCombatant.id, creatureName);
                        this.nameToIdMap.set(creatureName, firestoreCombatant.id);
                    } else {
                        // Existing creature → check for updates
                        const idx = updatedCombatants.findIndex(c => c.id === existingId);
                        if (idx >= 0) {
                            const fc = updatedCombatants[idx];

                            // HP update from DM
                            const newHp = creature.currentHP ?? creature.hp;
                            if (newHp !== undefined && newHp !== fc.hp) {
                                fc.hp = newHp;
                                // Monster HP = 0 → mark dead (graveyard)
                                if (newHp <= 0 && fc.type !== 'Player Character') {
                                    fc.isDead = true;
                                }
                            }

                            // AC update
                            if (creature.ac !== undefined && creature.ac !== fc.ac) {
                                fc.ac = creature.ac;
                            }
                        }
                    }
                }

                // 2. Handle removed creatures from IT (DM removed in Obsidian)
                const itNames = new Set(creatures.map((c: any) => c.name || c.display));
                const toRemove: string[] = [];
                for (const [name, id] of this.nameToIdMap) {
                    if (!itNames.has(name)) {
                        // Creature was in IT but no longer → removed by DM
                        const idx = updatedCombatants.findIndex(c => c.id === id);
                        if (idx >= 0 && updatedCombatants[idx].addedVia === 'obsidian-bridge') {
                            updatedCombatants.splice(idx, 1);
                            toRemove.push(name);
                        }
                    }
                }
                for (const name of toRemove) {
                    const id = this.nameToIdMap.get(name);
                    if (id) this.idToNameMap.delete(id);
                    this.nameToIdMap.delete(name);
                }

                // 3. Enemy reveal: if a hidden creature's turn arrived, reveal them
                if (activeIndex >= 0) {
                    const activeCreatureName = creatures[activeIndex]?.name || creatures[activeIndex]?.display;
                    const activeId = this.nameToIdMap.get(activeCreatureName);
                    if (activeId) {
                        const idx = updatedCombatants.findIndex(c => c.id === activeId);
                        if (idx >= 0 && updatedCombatants[idx].isHiddenFromPlayers) {
                            updatedCombatants[idx].isHiddenFromPlayers = false;
                        }
                    }
                }

                // 4. Write the update
                const updatePayload: any = {
                    combatants: updatedCombatants,
                    round: round,
                };

                // Calculate turn index: find the active creature's position in the sorted list
                if (activeIndex >= 0) {
                    const activeCreatureName = creatures[activeIndex]?.name || creatures[activeIndex]?.display;
                    const activeId = this.nameToIdMap.get(activeCreatureName);
                    if (activeId) {
                        const turnIdx = updatedCombatants.findIndex(c => c.id === activeId);
                        if (turnIdx >= 0) {
                            updatePayload.turn = turnIdx;
                            this._state.currentTurn = turnIdx;
                        }
                    }
                }

                this._state.currentRound = round;
                transaction.update(trackerRef, updatePayload);
            });

            // Update local cache
            this.lastKnownITCreatures = creatures;

        } catch (error) {
            console.error('[Bridge] Failed to sync IT state to Firestore:', error);
        }
    }

    // ──────────────────────────────────────────────
    //  INITIAL SYNC: Connect to existing tracker
    // ──────────────────────────────────────────────

    /**
     * Merge DM's Obsidian creatures into an existing Firestore tracker,
     * and pull existing combatants into the IT plugin.
     */
    async mergeWithExistingTracker(caravanId: string, trackerId: string): Promise<void> {
        const db = getDb();
        const trackerRef = doc(db, 'caravans', caravanId, 'initiativeTrackers', trackerId);
        const trackerSnap = await getDoc(trackerRef);

        if (!trackerSnap.exists()) {
            throw new Error('Tracker not found in Firestore.');
        }

        const trackerData = trackerSnap.data();
        const existingCombatants: any[] = trackerData.combatants || [];

        // 1. Get IT plugin's current creatures
        const itState = this.itAccess.getCurrentState();
        const itCreatures: any[] = itState?.creatures || [];

        // 2. Convert IT creatures to Firestore format and add (hidden for players)
        const newFirestoreCombatants: any[] = [];
        for (const creature of itCreatures) {
            const fc = itCreatureToFirestore(creature);
            newFirestoreCombatants.push(fc);
            this.idToNameMap.set(fc.id, creature.name || creature.display);
            this.nameToIdMap.set(creature.name || creature.display, fc.id);
        }

        // 3. Add IT creatures to Firestore
        if (newFirestoreCombatants.length > 0) {
            // Suppress echo
            this.suppressFirestoreUntil = Date.now() + 3000;

            await updateDoc(trackerRef, {
                combatants: [...existingCombatants, ...newFirestoreCombatants]
            });
        }

        // 4. Pull existing Firestore combatants into IT plugin
        const existingForIT = existingCombatants.map(c => {
            const itCreature = firestoreCombatantToIT(c);
            this.idToNameMap.set(c.id, c.name);
            this.nameToIdMap.set(c.name, c.id);
            return itCreature;
        });

        if (existingForIT.length > 0) {
            this.itAccess.addCreatures(existingForIT);
        }

        // Cache the full list
        this.lastKnownFirestoreCombatants = [...existingCombatants, ...newFirestoreCombatants];
    }

    /**
     * Create a new tracker in Firestore with the DM's current IT creatures.
     */
    async createNewTracker(caravanId: string, trackerName: string): Promise<string> {
        const db = getDb();
        const trackersRef = collection(db, 'caravans', caravanId, 'initiativeTrackers');

        // Get IT plugin's current creatures
        const itState = this.itAccess.getCurrentState();
        const itCreatures: any[] = itState?.creatures || [];

        // Convert to Firestore format
        const combatants: any[] = [];
        for (const creature of itCreatures) {
            const fc = itCreatureToFirestore(creature);
            combatants.push(fc);
            this.idToNameMap.set(fc.id, creature.name || creature.display);
            this.nameToIdMap.set(creature.name || creature.display, fc.id);
        }

        // Create the tracker document
        const { doc: firestoreDoc } = await import('../firebase');
        const newTrackerRef = firestoreDoc(trackersRef);
        const trackerId = newTrackerRef.id;

        // Suppress echo
        this.suppressFirestoreUntil = Date.now() + 3000;

        await setDoc(newTrackerRef, {
            name: trackerName,
            round: itState?.round || 1,
            turn: 0,
            combatants,
            createdAt: serverTimestamp(),
            caravanId,
        });

        this.lastKnownFirestoreCombatants = combatants;

        return trackerId;
    }

    /**
     * Fetch active trackers for a caravan from Firestore.
     */
    async fetchActiveTrackers(caravanId: string): Promise<any[]> {
        const db = getDb();
        const trackersRef = collection(db, 'caravans', caravanId, 'initiativeTrackers');
        const q = query(trackersRef, orderBy('createdAt', 'desc'), limit(10));

        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({
            id: d.id,
            name: d.data().name || 'Unnamed Tracker',
            round: d.data().round || 1,
            combatantCount: (d.data().combatants || []).length,
            createdAt: d.data().createdAt,
        }));
    }
}
