// src/bridge/patch.ts
// Pure: a bridge change to the webapp tracker as a patch, applied to the newest combatant
// list inside a Firestore transaction, so webapp changes made meanwhile are kept.

import type { WebappCombatant } from './fieldMapping';
import { webappOrder, withSortIndex } from './ordering';

/** Which webapp combatant a change is for: its id, else its linked IT id, else its name. */
export interface CombatantMatch {
    id?: string;
    obsidianId?: string;
    name: string;
}

export interface CombatantChange {
    match: CombatantMatch;
    fields: Partial<WebappCombatant>;
}

export interface TrackerPatch {
    changes: CombatantChange[];
    add: WebappCombatant[];
    /** Webapp id of the combatant whose turn it is now. */
    turnTo?: string | null;
}

export interface PatchResult {
    combatants: WebappCombatant[];
    /** New turn index, or null when the patch doesn't move the turn. */
    turn: number | null;
    /** False when the combatants are unchanged (nothing to write). */
    changed: boolean;
}

export function matchOf(c: WebappCombatant): CombatantMatch {
    return { id: c.id, obsidianId: c.obsidianId, name: c.name };
}

export function isEmptyPatch(patch: TrackerPatch): boolean {
    return patch.changes.length === 0 && patch.add.length === 0 && !patch.turnTo;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The field changes from `before` to `after`: two lists of the same combatants in the same
 * order (`after` is an edited copy of `before`). A field that became undefined is sent as null,
 * because Firestore does not accept undefined.
 */
export function changesBetween(before: WebappCombatant[], after: WebappCombatant[]): CombatantChange[] {
    const changes: CombatantChange[] = [];
    before.forEach((old, i) => {
        const now: any = after[i];
        if (!now) return;
        const fields: any = {};
        const keys = new Set([...Object.keys(old), ...Object.keys(now)]);
        for (const key of keys) {
            if (!same((old as any)[key], now[key])) fields[key] = now[key] ?? null;
        }
        if (Object.keys(fields).length > 0) changes.push({ match: matchOf(old), fields });
    });
    return changes;
}

/**
 * Position of the matched combatant, or -1. A change for a combatant with an id only goes to
 * that id: when the webapp removed it meanwhile, the change is dropped, never moved to another.
 */
function findMatch(list: WebappCombatant[], m: CombatantMatch): number {
    if (m.id) return list.findIndex(c => c.id === m.id);
    if (m.obsidianId) {
        const byIt = list.findIndex(c => c.obsidianId === m.obsidianId);
        if (byIt >= 0) return byIt;
    }
    return list.findIndex(c => c.name === m.name);
}

/** Is this new combatant already in the list (same id, same IT creature, or the same PC)? */
function alreadyThere(list: WebappCombatant[], added: WebappCombatant): boolean {
    return list.some(c =>
        (added.id && c.id === added.id) ||
        (added.obsidianId && c.obsidianId === added.obsidianId) ||
        (added.pcId && added.type === 'Player Character' && c.pcId === added.pcId && c.type === 'Player Character'));
}

/**
 * Apply a patch to the newest combatant list. Fields are only set where they differ, new
 * combatants are only added once, and sortIndex is set the way the webapp does when anything
 * changed. The turn is worked out on the final list.
 */
export function applyPatch(current: WebappCombatant[], patch: TrackerPatch): PatchResult {
    const list = current.map(c => ({ ...c }));
    let changed = false;

    for (const { match, fields } of patch.changes) {
        const i = findMatch(list, match);
        if (i < 0) continue;
        for (const [key, value] of Object.entries(fields)) {
            if (!same((list[i] as any)[key], value)) {
                (list[i] as any)[key] = value;
                changed = true;
            }
        }
    }

    for (const added of patch.add) {
        if (alreadyThere(list, added)) continue;
        list.push({ ...added });
        changed = true;
    }

    const combatants = changed ? withSortIndex(list) : list;
    let turn: number | null = null;
    if (patch.turnTo) {
        const index = webappOrder(combatants).findIndex(c => c.id === patch.turnTo);
        if (index >= 0) turn = index;
    }
    return { combatants, turn, changed };
}
