// src/bridge/linking.ts
// v1 - 27-09-2026 - Pure matching between IT creatures, webapp combatants and caravan player characters

import type { WebappCombatant } from './fieldMapping';

/** Minimal view of an IT creature, taken from the live Creature object. */
export interface ItCreatureRef {
    id: string;
    name: string;          // base name
    displayName: string;   // getName(): "Goblin 2", or the display override
    player: boolean;
    initiative?: number;
    modifier?: number;
}

/** A player character registered in the caravan (caravans/{id}.characterMembers). */
export interface CaravanPc {
    characterId: string;
    name: string;
}

export interface LinkPlan {
    /** Combatant index → IT creature id, for every combatant whose obsidianId must be set or repaired. */
    relinks: { index: number; obsidianId: string }[];
    /** IT creature ids that are now linked to a combatant (existing or new). */
    claimedItIds: Set<string>;
    /** New webapp PC combatants for IT players that belong to a caravan PC not yet in the tracker. */
    newPcCombatants: WebappCombatant[];
    /** IT players that match no combatant and no caravan PC (left alone in Obsidian). */
    unlinkedPlayers: string[];
}

// The bridge writes fake initiatives (1000 - position, or -100) into IT to force the webapp's order.
const FAKE_INIT_MIN = 900;
const FAKE_INIT_UNLISTED = -100;

export function normalizeName(name: string | undefined | null): string {
    return (name ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function firstWord(name: string): string {
    return normalizeName(name).split(' ')[0] ?? '';
}

function namesOf(creature: ItCreatureRef): string[] {
    return [normalizeName(creature.displayName), normalizeName(creature.name)];
}

/** Exactly one candidate whose normalized name equals the target, else null. */
function uniqueExact<T>(candidates: T[], names: (c: T) => string[], target: string): T | null {
    const wanted = normalizeName(target);
    if (!wanted) return null;
    const hits = candidates.filter(c => names(c).includes(wanted));
    return hits.length === 1 ? hits[0] : null;
}

/**
 * Exactly one candidate sharing the target's first word, where one side is a single word
 * ("Ayla" ↔ "Ayla Moonwhisper"). Two different full names never match ("Ayla Moon" ↔ "Ayla Star").
 */
function uniqueFirstWord<T>(candidates: T[], names: (c: T) => string[], target: string): T | null {
    const wanted = normalizeName(target);
    const wantedFirst = firstWord(target);
    if (!wantedFirst) return null;
    const hits = candidates.filter(c => names(c).some(n => {
        if (!n || n.split(' ')[0] !== wantedFirst) return false;
        return !n.includes(' ') || !wanted.includes(' ');
    }));
    return hits.length === 1 ? hits[0] : null;
}

function matchName<T>(candidates: T[], names: (c: T) => string[], target: string): T | null {
    return uniqueExact(candidates, names, target) ?? uniqueFirstWord(candidates, names, target);
}

/** Real IT initiative, or null when it is one of the bridge's fake ordering values. */
export function realInitiative(initiative: number | undefined): number | null {
    if (initiative === undefined || initiative === null || Number.isNaN(initiative)) return null;
    if (initiative >= FAKE_INIT_MIN || initiative === FAKE_INIT_UNLISTED) return null;
    return initiative;
}

/** Build a webapp PC combatant the same way the webapp's Add Combatant modal does. */
export function buildPcCombatant(pc: CaravanPc, creature: ItCreatureRef): WebappCombatant {
    return {
        id: pc.characterId,
        name: pc.name,
        type: 'Player Character',
        pcId: pc.characterId,
        initiative: realInitiative(creature.initiative),
        isDead: false,
        initiative_modifier: creature.modifier ?? 0,
        tieBreaker: Math.floor(Math.random() * 20) + 1,
        obsidianId: creature.id,
    };
}

/** Match an IT player to a caravan PC by name (exact, then unique first word). */
export function matchCaravanPc(creature: ItCreatureRef, caravanPcs: CaravanPc[]): CaravanPc | null {
    return uniqueExact(caravanPcs, pc => [normalizeName(pc.name)], creature.displayName)
        ?? uniqueExact(caravanPcs, pc => [normalizeName(pc.name)], creature.name)
        ?? uniqueFirstWord(caravanPcs, pc => [normalizeName(pc.name)], creature.displayName);
}

/**
 * Pair webapp combatants with IT creatures so a reconnect never adds anyone twice.
 *
 * Order: stored obsidianId → exact name → unique first word (PCs only). IT ids for players
 * change whenever Obsidian restarts (IT rebuilds players by name), so stale ids are expected
 * and repaired here. Remaining IT players are linked to caravan PCs when the name matches.
 */
export function planLinks(
    combatants: WebappCombatant[],
    creatures: ItCreatureRef[],
    caravanPcs: CaravanPc[],
): LinkPlan {
    const claimed = new Set<string>();
    const relinks: { index: number; obsidianId: string }[] = [];
    const resolved = new Set<number>();

    const free = (wantPlayer?: boolean) => creatures.filter(c =>
        !claimed.has(c.id) && (wantPlayer === undefined || c.player === wantPlayer));
    const isPc = (c: WebappCombatant) => c.type === 'Player Character';

    // 1. Stored ids that still exist.
    combatants.forEach((c, index) => {
        if (c.obsidianId && creatures.some(cr => cr.id === c.obsidianId) && !claimed.has(c.obsidianId)) {
            claimed.add(c.obsidianId);
            resolved.add(index);
        }
    });

    const link = (index: number, creature: ItCreatureRef) => {
        claimed.add(creature.id);
        resolved.add(index);
        if (combatants[index].obsidianId !== creature.id) {
            relinks.push({ index, obsidianId: creature.id });
        }
    };

    // 2. Exact name, same kind first (PC ↔ IT player), then any kind.
    combatants.forEach((c, index) => {
        if (resolved.has(index)) return;
        const match = uniqueExact(free(isPc(c)), namesOf, c.name) ?? uniqueExact(free(), namesOf, c.name);
        if (match) link(index, match);
    });

    // 3. PCs only: unique first-word match against IT players ("Ayla" ↔ "Ayla Moonwhisper").
    combatants.forEach((c, index) => {
        if (resolved.has(index) || !isPc(c)) return;
        const match = uniqueFirstWord(free(true), namesOf, c.name);
        if (match) link(index, match);
    });

    // 4. Remaining IT players: link to a caravan PC, reusing its combatant if the tracker has one.
    const newPcCombatants: WebappCombatant[] = [];
    const unlinkedPlayers: string[] = [];
    for (const creature of free(true)) {
        const pc = matchCaravanPc(creature, caravanPcs);
        if (!pc) {
            unlinkedPlayers.push(creature.displayName);
            continue;
        }
        const existingIndex = combatants.findIndex((c, i) =>
            !resolved.has(i) && isPc(c) && (c.pcId === pc.characterId || c.id === pc.characterId));
        if (existingIndex >= 0) {
            link(existingIndex, creature);
        } else if (!combatants.some(c => c.pcId === pc.characterId) &&
                   !newPcCombatants.some(c => c.pcId === pc.characterId)) {
            claimed.add(creature.id);
            newPcCombatants.push(buildPcCombatant(pc, creature));
        } else {
            // This PC is already linked to another IT creature: a real duplicate in Obsidian.
            unlinkedPlayers.push(creature.displayName);
        }
    }

    return { relinks, claimedItIds: claimed, newPcCombatants, unlinkedPlayers };
}
