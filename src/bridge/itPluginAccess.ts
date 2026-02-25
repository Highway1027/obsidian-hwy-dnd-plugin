// src/bridge/itPluginAccess.ts
// v1 - 25-02-2026 - Wrapper for interacting with the javalent Initiative Tracker plugin

import { App, Notice } from 'obsidian';

/**
 * Wrapper for accessing and controlling the javalent Initiative Tracker plugin.
 * Uses official API where available, falls back to internal access for
 * turn advancement, HP changes, and creature removal.
 */
export class ITPluginAccess {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Get the Initiative Tracker plugin instance.
     */
    getPlugin(): any | null {
        return (this.app as any).plugins?.plugins?.['initiative-tracker'] ?? null;
    }

    /**
     * Check if the IT plugin is installed and enabled.
     */
    isAvailable(): boolean {
        const plugin = this.getPlugin();
        return plugin !== null && plugin !== undefined;
    }

    /**
     * Get the IT plugin's public API.
     */
    getApi(): any | null {
        const plugin = this.getPlugin();
        return plugin?.api ?? null;
    }

    /**
     * Get the current encounter state from the IT plugin.
     * Listens to the workspace event to capture current state.
     */
    getCurrentState(): any | null {
        const plugin = this.getPlugin();
        if (!plugin) return null;

        // Try to access the tracker view's state directly
        try {
            // The IT plugin stores its tracker view state internally
            // We try several known access paths
            const view = this.getTrackerView();
            if (view) {
                return this.extractStateFromView(view);
            }
        } catch (e) {
            console.warn('[Bridge] Could not read IT plugin state:', e);
        }

        return null;
    }

    /**
     * Get the tracker Leaf/View from the workspace.
     */
    private getTrackerView(): any | null {
        const plugin = this.getPlugin();
        if (!plugin) return null;

        // The IT plugin registers a view type 'initiative-tracker-view' or similar
        const leaves = this.app.workspace.getLeavesOfType('initiative-tracker');
        if (leaves.length > 0) {
            return leaves[0].view;
        }

        // Fallback: check for the tracker view type used by newer versions
        const altLeaves = this.app.workspace.getLeavesOfType('initiative-tracker-view');
        if (altLeaves.length > 0) {
            return altLeaves[0].view;
        }

        return null;
    }

    /**
     * Extract state from the tracker view instance.
     */
    private extractStateFromView(view: any): any {
        // The view may expose state through different properties depending on version
        // Common patterns in Svelte-based Obsidian plugins:
        if (view.state) return view.state;
        if (view.data) return view.data;
        if (view.getState) return view.getState();

        // Try accessing the Svelte component's store
        if (view.component?.$$.ctx) {
            // Svelte component context - varies by version
            return null;
        }

        return null;
    }

    /**
     * Add creatures to the current encounter using the official API.
     */
    addCreatures(creatures: any[], rollHP: boolean = false): boolean {
        const api = this.getApi();
        if (!api) {
            new Notice('Initiative Tracker plugin not found.');
            return false;
        }

        try {
            api.addCreatures(creatures, rollHP);
            return true;
        } catch (e) {
            console.error('[Bridge] Failed to add creatures via API:', e);
            return false;
        }
    }

    /**
     * Start a new encounter with the given state using the official API.
     */
    newEncounter(state?: any): boolean {
        const api = this.getApi();
        if (!api) {
            new Notice('Initiative Tracker plugin not found.');
            return false;
        }

        try {
            api.newEncounter(state);
            return true;
        } catch (e) {
            console.error('[Bridge] Failed to start new encounter via API:', e);
            return false;
        }
    }

    /**
     * Register a listener for the IT plugin's state changes.
     * The IT plugin emits 'initiative-tracker:save-state' on every change.
     */
    onStateChange(callback: (state: any) => void): () => void {
        const handler = this.app.workspace.on('initiative-tracker:save-state' as any, callback);

        return () => {
            this.app.workspace.offref(handler);
        };
    }

    /**
     * Register a listener for encounter stop.
     */
    onEncounterStop(callback: () => void): () => void {
        const handler = this.app.workspace.on('initiative-tracker:stop-viewing' as any, callback);

        return () => {
            this.app.workspace.offref(handler);
        };
    }

    /**
     * Try to advance the turn in the IT plugin.
     * This uses internal access since the official API doesn't expose this.
     */
    advanceTurn(): boolean {
        try {
            const view = this.getTrackerView();
            if (!view) return false;

            // Try known internal methods/stores
            // Method 1: Direct method call
            if (typeof view.next === 'function') {
                view.next();
                return true;
            }

            // Method 2: Svelte store dispatch
            if (view.component) {
                // Try accessing the component's methods
                const component = view.component;
                if (typeof component.next === 'function') {
                    component.next();
                    return true;
                }
            }

            // Method 3: Workspace event trigger
            this.app.workspace.trigger('initiative-tracker:next' as any);
            return true;

        } catch (e) {
            console.error('[Bridge] Failed to advance turn:', e);
            return false;
        }
    }

    /**
     * Update a creature's HP in the IT plugin.
     * Uses internal access since the official API doesn't support this.
     */
    updateCreatureHP(creatureName: string, hp: number, maxHp?: number): boolean {
        try {
            const view = this.getTrackerView();
            if (!view) return false;

            // Try to find the creature in the view's data and update it
            // This will depend on the internal structure we discover at runtime
            const state = this.extractStateFromView(view);
            if (state?.creatures) {
                const creature = state.creatures.find((c: any) =>
                    c.name === creatureName || c.display === creatureName
                );
                if (creature) {
                    creature.currentHP = hp;
                    if (maxHp !== undefined) creature.maxHP = maxHp;
                    // Trigger a re-render / save
                    this.app.workspace.trigger('initiative-tracker:should-save' as any);
                    return true;
                }
            }

            return false;
        } catch (e) {
            console.error('[Bridge] Failed to update creature HP:', e);
            return false;
        }
    }

    /**
     * Remove a creature from the IT plugin by name.
     * Uses internal access.
     */
    removeCreature(creatureName: string): boolean {
        try {
            const state = this.getCurrentState();
            if (!state?.creatures) return false;

            // Filter out the creature and replace the state
            const filtered = state.creatures.filter((c: any) =>
                c.name !== creatureName && c.display !== creatureName
            );

            if (filtered.length < state.creatures.length) {
                // Use newEncounter to replace the full state (official API fallback)
                return this.newEncounter({
                    ...state,
                    creatures: filtered
                });
            }

            return false;
        } catch (e) {
            console.error('[Bridge] Failed to remove creature:', e);
            return false;
        }
    }
}
