// src/bridge/itPluginAccess.ts
// v9 - 27-09-2026 - Creatures found by IT id first (then name); statuses use IT's Set of conditions; unused order helper removed

import { App } from 'obsidian';

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

/** IT's view type for the tracker itself (not the statblock pane). */
export const IT_TRACKER_VIEW_TYPE = 'initiative-tracker-view';

/**
 * Provides access to the IT plugin's internal tracker store and API.
 *
 * Access path:
 *   window.InitiativeTracker          → API instance
 *   window.InitiativeTracker.plugin   → InitiativeTracker plugin instance
 *   window.InitiativeTracker.plugin.tracker → Svelte store with all methods
 *
 * Every setter takes a creature key: the IT creature id (preferred, stable while
 * Obsidian runs) or its display name ("Goblin 2") as a fallback.
 */
export class ITPluginAccess {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    private getAPI(): any | null {
        return (window as any).InitiativeTracker ?? null;
    }

    private getPlugin(): any | null {
        return this.getAPI()?.plugin ?? null;
    }

    private getTrackerStore(): any | null {
        return this.getPlugin()?.tracker ?? null;
    }

    /** Check if the IT plugin is available and loaded. */
    isAvailable(): boolean {
        return this.getTrackerStore() !== null;
    }

    /** Find a live creature by IT id, then display name, then base name. */
    findCreature(key: string): any | null {
        const ordered: any[] = this.getOrderedCreatures();
        return ordered.find(c => c.id === key)
            ?? ordered.find(c => c.getName?.() === key)
            ?? ordered.find(c => c.name === key)
            ?? null;
    }

    private updateCreature(key: string, apply: (creature: any) => void): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateAndSave) return false;
        const creature = this.findCreature(key);
        if (!creature) {
            console.warn(`[ITPluginAccess] Creature "${key}" not found`);
            return false;
        }
        apply(creature);
        store.updateAndSave();
        return true;
    }

    // ==========================================
    // TURN MANAGEMENT
    // ==========================================

    /** Make one creature the active turn. */
    setActiveTurn(key: string): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateAndSave) return this.advanceToCreature(key);

        const target = this.findCreature(key);
        if (!target) {
            console.warn(`[ITPluginAccess] Creature "${key}" not found`);
            return false;
        }
        for (const creature of this.getOrderedCreatures()) {
            creature.active = creature === target;
        }
        store.updateAndSave();
        return true;
    }

    /** Advance turns until we reach the target creature (fallback without updateAndSave). */
    private advanceToCreature(key: string, maxSteps: number = 30): boolean {
        const store = this.getTrackerStore();
        const target = this.findCreature(key);
        if (!store?.goToNext || !target) return false;

        for (let i = 0; i < maxSteps; i++) {
            if (this.getOrderedCreatures().find((c: any) => c.active) === target) return true;
            store.goToNext();
        }
        console.warn(`[ITPluginAccess] Could not reach "${key}" in ${maxSteps} steps`);
        return false;
    }

    // ==========================================
    // CREATURE UPDATES
    // ==========================================

    setCreatureHP(key: string, hp: number): boolean {
        return this.updateCreature(key, c => { c.hp = hp; });
    }

    /**
     * Kill a creature: disable it first (so IT skips its turn even if the
     * status update fails), set HP to 0 and add the Unconscious condition.
     */
    killCreature(key: string): boolean {
        this.setCreatureEnabled(key, false);
        return this.updateCreature(key, c => {
            c.hp = 0;
            this.addCondition(c, 'Unconscious');
        });
    }

    setCreatureAC(key: string, ac: number | string): boolean {
        return this.updateCreature(key, c => {
            c.ac = ac;
            c.current_ac = ac;
        });
    }

    /** Set max HP (absolute). IT's own `max` change is a delta, so we set the fields directly. */
    setCreatureMaxHP(key: string, maxHp: number): boolean {
        return this.updateCreature(key, c => {
            c.max = maxHp;
            c.current_max = maxHp;
            if (c.hp > maxHp) c.hp = maxHp;
        });
    }

    /** Set HP, max HP and AC at once (initial PC setup). */
    setCreatureFullStats(key: string, hp: number, maxHp: number, ac?: number | string): boolean {
        return this.updateCreature(key, c => {
            c.hp = hp;
            c.max = maxHp;
            c.current_max = maxHp;
            if (ac !== undefined) {
                c.ac = ac;
                c.current_ac = ac;
            }
        });
    }

    setCreatureInitiative(key: string, initiative: number): boolean {
        return this.updateCreature(key, c => { c.initiative = initiative; });
    }

    /** Add a condition by name. IT stores conditions as a Set of {name, id, description}. */
    addStatusByName(key: string, statusName: string): boolean {
        return this.updateCreature(key, c => this.addCondition(c, statusName));
    }

    private addCondition(creature: any, statusName: string): void {
        const status = creature.status;
        if (status instanceof Set) {
            if ([...status].some((s: any) => s?.name === statusName)) return;
            const condition = this.findConfiguredCondition(statusName)
                ?? { name: statusName, id: statusName.toLowerCase(), description: null };
            if (typeof creature.addCondition === 'function') {
                creature.addCondition(condition);
            } else {
                status.add(condition);
            }
        } else if (Array.isArray(status)) {
            // Older IT versions stored plain names.
            if (!status.includes(statusName)) status.push(statusName);
        } else {
            creature.status = new Set([{ name: statusName, id: statusName.toLowerCase(), description: null }]);
        }
    }

    /** IT's configured condition with this name (keeps its description and id), if any. */
    private findConfiguredCondition(statusName: string): any | null {
        const statuses: any[] = this.getPlugin()?.data?.statuses ?? [];
        return statuses.find(s => s?.name === statusName) ?? null;
    }

    setCreatureHidden(key: string, hidden: boolean): boolean {
        return this.updateCreature(key, c => { c.hidden = hidden; });
    }

    /** Enable or disable a creature. Disabled creatures are skipped during turn order. */
    setCreatureEnabled(key: string, enabled: boolean): boolean {
        return this.updateCreature(key, c => { c.enabled = enabled; });
    }

    // ==========================================
    // CREATURE ADD / REMOVE
    // ==========================================

    /**
     * Add creatures using the public API.
     * NOTE: This calls rollInitiative() internally on the added creatures.
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
     * Add one creature, set its initiative, and return its new IT id
     * (found by diffing ids, so creatures with the same name can't be confused).
     */
    addCreatureWithInitiative(creature: any, initiative: number): string | null {
        const before = new Set(this.getOrderedCreatures().map((c: any) => c.id));
        if (!this.addCreatures([creature])) return null;
        const added = this.getOrderedCreatures().find((c: any) => !before.has(c.id));
        if (!added) return null;
        this.setCreatureInitiative(added.id, initiative);
        return added.id as string;
    }

    removeCreature(key: string): boolean {
        const store = this.getTrackerStore();
        const creature = this.findCreature(key);
        if (!store?.remove || !creature) {
            console.warn(`[ITPluginAccess] Creature "${key}" not found for removal`);
            return false;
        }
        store.remove(creature);
        return true;
    }

    // ==========================================
    // STATE READING
    // ==========================================

    /** Get the ordered list of live creatures in the current encounter. */
    getOrderedCreatures(): any[] {
        const store = this.getTrackerStore();
        if (!store?.getOrderedCreatures) return [];
        return store.getOrderedCreatures();
    }

    /** Is an Initiative Tracker view open anywhere in the workspace? */
    isTrackerViewOpen(): boolean {
        return this.app.workspace.getLeavesOfType(IT_TRACKER_VIEW_TYPE).length > 0;
    }

    /**
     * Trigger a save on the tracker store.
     * Used by the bridge to persist direct creature mutations (e.g., enforced initiative).
     */
    triggerSave(): boolean {
        const store = this.getTrackerStore();
        if (!store?.updateAndSave) return false;
        store.updateAndSave();
        return true;
    }
}
