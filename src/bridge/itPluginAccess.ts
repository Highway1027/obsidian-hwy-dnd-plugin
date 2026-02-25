// src/bridge/itPluginAccess.ts
// v3 - 25-02-2026 - Fixed HP setter, added AC setter, added kill method with Unconscious

import { App, Notice } from 'obsidian';

/**
 * CreatureState matches the IT plugin's internal CreatureState interface.
 * Used to understand the save-state event data.
 */
export interface ITCreatureState {
    name: string;
    display?: string;
    initiative: number;
    hp: number;          // max HP
    currentHP: number;
    currentMaxHP: number;
    tempHP: number;
    ac: number | string;
    currentAC: number | string;
    modifier: number | number[];
    player: boolean;
    active: boolean;
    hidden: boolean;
    enabled: boolean;
    id: string;
    status: string[];
    friendly?: boolean;
    static?: boolean;
    level?: number;
    xp?: number;
    marker?: string;
    note?: string;
    path?: string;
    cr?: string | number;
    hit_dice?: string;
    rollHP?: boolean;
    number?: number;
    'statblock-link'?: string;
}

/**
 * InitiativeViewState matches the IT plugin's save-state event payload.
 */
export interface ITViewState {
    creatures: ITCreatureState[];
    state: boolean;      // combat started?
    name: string;
    round: number;
    logFile: string;
    roll?: boolean;
    rollHP?: boolean;
    timestamp?: number;
}

/**
 * Provides access to the IT plugin's internal tracker store and API.
 *
 * Access path:
 *   window.InitiativeTracker          → API instance
 *   window.InitiativeTracker.plugin   → InitiativeTracker plugin instance
 *   window.InitiativeTracker.plugin.tracker → Svelte store with all methods
 *
 * The tracker store exposes:
 *   - goToNext() / goToPrevious()   → turn advancement
 *   - updateCreatures({creature, change}) → update HP, initiative, status, etc.
 *   - updateCreatureByName(name, change) → same but by name lookup
 *   - add(plugin, roll, ...creatures) → add creatures (with optional roll)
 *   - remove(...creatures) → remove creatures
 *   - getOrderedCreatures() → get sorted creature array
 *   - ordered → Svelte derived store of ordered creatures
 *   - new(plugin, state?) → start new encounter
 */
export class ITPluginAccess {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Get the IT plugin's API (window.InitiativeTracker).
     */
    private getAPI(): any | null {
        return (window as any).InitiativeTracker ?? null;
    }

    /**
     * Get the IT plugin instance.
     */
    private getPlugin(): any | null {
        return this.getAPI()?.plugin ?? null;
    }

    /**
     * Get the tracker Svelte store with all internal methods.
     */
    private getTrackerStore(): any | null {
        return this.getPlugin()?.tracker ?? null;
    }

    /**
     * Check if the IT plugin is available and loaded.
     */
    isAvailable(): boolean {
        return this.getTrackerStore() !== null;
    }

    // ==========================================
    // TURN MANAGEMENT
    // ==========================================

    /**
     * Advance to the next turn. Uses tracker.goToNext() which
     * handles round increment, status reset, and triggers save-state.
     */
    goToNext(): boolean {
        const store = this.getTrackerStore();
        if (!store?.goToNext) {
            console.warn('[ITPluginAccess] goToNext not available');
            return false;
        }
        store.goToNext();
        return true;
    }

    /**
     * Go to the previous turn.
     */
    goToPrevious(): boolean {
        const store = this.getTrackerStore();
        if (!store?.goToPrevious) {
            console.warn('[ITPluginAccess] goToPrevious not available');
            return false;
        }
        store.goToPrevious();
        return true;
    }

    /**
     * Set a specific creature as the active one by name.
     * Uses updateAndSave to directly manipulate active flags.
     */
    setActiveTurn(targetName: string): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateAndSave) {
            // Fallback: advance until we reach the target
            return this.advanceToCreature(targetName);
        }

        try {
            // Get ordered creatures to find the target
            const ordered = store.getOrderedCreatures?.() ?? [];
            const target = ordered.find((c: any) => c.getName?.() === targetName || c.name === targetName);
            if (!target) {
                console.warn(`[ITPluginAccess] Creature "${targetName}" not found`);
                return false;
            }

            // Use updateCreatures to set active flags
            const updates: { creature: any; change: any }[] = [];
            for (const creature of ordered) {
                if (creature === target) {
                    if (!creature.active) {
                        updates.push({ creature, change: {} }); // Trigger save
                        creature.active = true;
                    }
                } else {
                    if (creature.active) {
                        creature.active = false;
                    }
                }
            }

            // Trigger save
            store.updateAndSave();
            return true;
        } catch (err) {
            console.error('[ITPluginAccess] setActiveTurn error:', err);
            return false;
        }
    }

    /**
     * Advance turns until we reach the target creature.
     * Safety limit prevents infinite loops.
     */
    private advanceToCreature(targetName: string, maxSteps: number = 30): boolean {
        const store = this.getTrackerStore();
        if (!store?.goToNext || !store?.getOrderedCreatures) return false;

        for (let i = 0; i < maxSteps; i++) {
            const ordered = store.getOrderedCreatures();
            const active = ordered.find((c: any) => c.active);
            if (active && (active.getName?.() === targetName || active.name === targetName)) {
                return true; // We've reached the target
            }
            store.goToNext();
        }

        console.warn(`[ITPluginAccess] Could not reach "${targetName}" in ${maxSteps} steps`);
        return false;
    }

    // ==========================================
    // CREATURE UPDATES
    // ==========================================

    /**
     * Update a creature's HP by directly setting it.
     * updateCreatureByName uses {hp: val} for direct set.
     */
    setCreatureHP(name: string, hp: number): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateCreatureByName) {
            console.warn('[ITPluginAccess] updateCreatureByName not available');
            return false;
        }
        store.updateCreatureByName(name, { hp });
        return true;
    }

    /**
     * Kill a creature: set HP to 0 and add Unconscious status.
     */
    killCreature(name: string): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateCreatureByName) return false;
        // Set HP to 0 and add Unconscious status
        store.updateCreatureByName(name, { hp: 0, status: ['Unconscious'] });
        return true;
    }

    /**
     * Set a creature's AC value.
     */
    setCreatureAC(name: string, ac: number | string): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateCreatureByName) return false;
        store.updateCreatureByName(name, { ac });
        return true;
    }

    /**
     * Set a creature's max HP.
     */
    setCreatureMaxHP(name: string, maxHp: number): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateCreatureByName) return false;
        store.updateCreatureByName(name, { set_max_hp: maxHp });
        return true;
    }

    /**
     * Set a creature's initiative value.
     */
    setCreatureInitiative(name: string, initiative: number): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateCreatureByName) {
            console.warn('[ITPluginAccess] updateCreatureByName not available');
            return false;
        }
        store.updateCreatureByName(name, { initiative });
        return true;
    }

    /**
     * Add a status condition to a creature by name.
     * The IT plugin resolves status names from its configured statuses list.
     */
    addStatusByName(creatureName: string, statusName: string): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateCreatureByName) return false;
        store.updateCreatureByName(creatureName, { status: [statusName] });
        return true;
    }

    /**
     * Set creature's hidden flag.
     */
    setCreatureHidden(name: string, hidden: boolean): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateCreatureByName) return false;
        store.updateCreatureByName(name, { hidden });
        return true;
    }

    // ==========================================
    // CREATURE ADD / REMOVE
    // ==========================================

    /**
     * Add creatures using the public API.
     * NOTE: This calls rollInitiative() internally on the added creatures.
     * If you need to set specific initiative values, call setCreatureInitiative() after.
     */
    addCreatures(creatures: any[]): boolean {
        const api = this.getAPI();
        if (!api?.addCreatures) {
            console.warn('[ITPluginAccess] addCreatures API not available');
            return false;
        }
        try {
            api.addCreatures(creatures, false); // false = don't roll HP
            return true;
        } catch (err) {
            console.error('[ITPluginAccess] addCreatures error:', err);
            return false;
        }
    }

    /**
     * Add creatures and then immediately set their initiative values.
     * Solves the problem of addCreatures() rolling random initiative.
     */
    addCreaturesWithInitiative(creatures: { creature: any; initiative: number }[]): boolean {
        // First add all creatures (they'll get random initiative)
        const added = this.addCreatures(creatures.map(c => c.creature));
        if (!added) return false;

        // Then immediately correct their initiative values
        for (const { creature, initiative } of creatures) {
            if (initiative !== undefined && initiative !== null) {
                this.setCreatureInitiative(creature.name, initiative);
            }
        }
        return true;
    }

    /**
     * Remove a creature by name from the tracker.
     */
    removeCreatureByName(name: string): boolean {
        const store = this.getTrackerStore();
        if (!store?.getOrderedCreatures || !store?.remove) return false;

        const ordered = store.getOrderedCreatures();
        const creature = ordered.find((c: any) =>
            c.getName?.() === name || c.name === name
        );

        if (!creature) {
            console.warn(`[ITPluginAccess] Creature "${name}" not found for removal`);
            return false;
        }

        store.remove(creature);
        return true;
    }

    // ==========================================
    // STATE READING
    // ==========================================

    /**
     * Get the ordered list of creatures in the current encounter.
     */
    getOrderedCreatures(): any[] {
        const store = this.getTrackerStore();
        if (!store?.getOrderedCreatures) return [];
        return store.getOrderedCreatures();
    }

    /**
     * Get the currently active creature.
     */
    getActiveCreature(): any | null {
        const ordered = this.getOrderedCreatures();
        return ordered.find((c: any) => c.active) ?? null;
    }

    /**
     * Get the current round number.
     */
    getCurrentRound(): number {
        const store = this.getTrackerStore();
        if (!store?.round) return 1;
        // Svelte store - need to use get()
        try {
            // Try to read from the store directly
            let round = 1;
            const unsub = store.round.subscribe?.((val: number) => { round = val; });
            unsub?.();
            return round;
        } catch {
            return 1;
        }
    }

    /**
     * Check if combat has been started (play button pressed).
     */
    isCombatStarted(): boolean {
        const store = this.getTrackerStore();
        if (!store?.getState) return false;
        return store.getState();
    }

    /**
     * Start a new encounter via the public API.
     * This will replace the current encounter.
     */
    newEncounter(state?: ITViewState): boolean {
        const api = this.getAPI();
        if (!api?.newEncounter) return false;
        try {
            api.newEncounter(state);
            return true;
        } catch (err) {
            console.error('[ITPluginAccess] newEncounter error:', err);
            return false;
        }
    }
}
