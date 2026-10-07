// src/bridge/ordering.ts
// Pure turn-order logic: the webapp's sort, and how IT gets the same order.

import type { WebappCombatant } from './fieldMapping';
import { findCreatureFor, realInitiative, type ItCreatureRef } from './linking';

/**
 * Same order as the webapp's getSortedCombatants
 * (wildshape-tracker src/components/initiative/combatUtils.js). Keep the two in step:
 * the bridge and the webapp must agree on positions, because the turn is stored as an index.
 */
export function sortLikeWebapp<T extends WebappCombatant>(combatants: T[]): T[] {
    return [...combatants].sort((a: any, b: any) => {
        const initDiff = (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity);
        if (initDiff !== 0) return initDiff;

        const modA = a.initiative_modifier ?? 0;
        const modB = b.initiative_modifier ?? 0;
        if (modB !== modA) return modB - modA;

        const dexA = a.dexterity_score ?? 10;
        const dexB = b.dexterity_score ?? 10;
        if (dexB !== dexA) return dexB - dexA;

        const isPlayerA = a.type === 'Player Character';
        const isPlayerB = b.type === 'Player Character';
        if (isPlayerA !== isPlayerB) return isPlayerA ? -1 : 1;

        const tieA = a.tieBreaker ?? 0;
        const tieB = b.tieBreaker ?? 0;
        if (tieB !== tieA) return tieB - tieA;

        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
}

/** Copies with `sortIndex` set, like the webapp's applySortIndex. */
export function withSortIndex<T extends WebappCombatant>(combatants: T[]): T[] {
    const sorted = sortLikeWebapp(combatants);
    return combatants.map(c => ({ ...c, sortIndex: sorted.indexOf(c) }));
}

/** Combatants in webapp turn order: stored sortIndex when every combatant has one, else the webapp sort. */
export function webappOrder<T extends WebappCombatant>(combatants: T[]): T[] {
    if (combatants.every(c => typeof c.sortIndex === 'number')) {
        return [...combatants].sort((a, b) => (a.sortIndex as number) - (b.sortIndex as number));
    }
    return sortLikeWebapp(combatants);
}

export interface OrderedCreatureRef extends ItCreatureRef {
    manualOrder?: number | null;
}

export interface ItOrderChange {
    id: string;
    initiative: number;
    manualOrder: number;
}

/**
 * Initiative and manualOrder for each IT creature so IT shows the webapp's order with the
 * real initiative numbers. IT (13.0.17+) sorts by initiative (high first), then manualOrder
 * (low first, only when both creatures have one), then its own tie setting.
 *
 * - Linked creatures get the webapp initiative and their webapp position as manualOrder.
 * - A combatant without initiative gets the lowest initiative in play (0 at most), so it
 *   sorts last, like in the webapp.
 * - IT creatures the webapp doesn't know keep their own initiative and go after the
 *   webapp creatures on ties.
 *
 * Returns only creatures whose values must change.
 */
export function planItOrder(combatants: WebappCombatant[], creatures: OrderedCreatureRef[]): ItOrderChange[] {
    const ordered = webappOrder(combatants);
    const known = ordered.map(c => c.initiative).filter((n): n is number => typeof n === 'number');
    const floor = Math.min(0, ...known);

    const changes: ItOrderChange[] = [];
    const want = (creature: OrderedCreatureRef, initiative: number, manualOrder: number) => {
        if (creature.initiative !== initiative || creature.manualOrder !== manualOrder) {
            changes.push({ id: creature.id, initiative, manualOrder });
        }
    };

    // Linked ids first, so a name fallback never takes a creature another combatant is linked to.
    const free = [...creatures];
    const matched = new Map<number, OrderedCreatureRef>();
    const claim = (position: number, creature: OrderedCreatureRef | null | undefined) => {
        if (!creature) return;
        free.splice(free.indexOf(creature), 1);
        matched.set(position, creature);
    };
    ordered.forEach((c, position) => claim(position, c.obsidianId ? free.find(cr => cr.id === c.obsidianId) : null));
    ordered.forEach((c, position) => {
        if (!matched.has(position)) claim(position, findCreatureFor(c, free));
    });
    matched.forEach((creature, position) => want(creature, ordered[position].initiative ?? floor, position));

    free.forEach((creature, i) => {
        want(creature, realInitiative(creature.initiative) ?? floor, ordered.length + i);
    });

    return changes;
}
