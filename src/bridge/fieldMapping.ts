// src/bridge/fieldMapping.ts
// v2 - 25-02-2026 - Updated to use correct IT plugin CreatureState field names

import type { ITCreatureState } from './itPluginAccess';

/**
 * Webapp combatant format (Firestore document fields).
 */
export interface WebappCombatant {
    id?: string;
    name: string;
    type: string;                // 'Player Character' | 'Monster' | 'Summon'
    initiative: number | null;
    hp?: number;
    maxHp?: number;
    tempHp?: number;
    ac?: number;
    isDead?: boolean;
    isHiddenFromPlayers?: boolean;
    deathRound?: number | null;
    pcId?: string;
    dndBeyondId?: string;
    isPlayerSummon?: boolean;
    summonInstanceId?: string;
    conditions?: any[];
    tieBreaker?: number;
    initiative_modifier?: number;
    hasAdvantage?: boolean;
    obsidianId?: string;       // IT creature ID for bridge matching
}

/**
 * Map an IT plugin CreatureState → webapp combatant format.
 *
 * Key field mappings:
 *   IT: currentHP, currentMaxHP, tempHP, currentAC, player, active, hidden
 *   Webapp: hp, maxHp, tempHp, ac, type='Player Character'|'Monster', isDead, isHiddenFromPlayers
 */
export function itCreatureToWebappCombatant(creature: ITCreatureState): WebappCombatant {
    const isPlayer = creature.player === true;
    const name = creature.display || creature.name;

    // Determine type
    let type = 'Monster';
    if (isPlayer) {
        type = 'Player Character';
    } else if (creature.friendly) {
        type = 'Summon'; // Friendly non-player = ally/summon
    }

    return {
        name: name,
        type: type,
        initiative: creature.initiative ?? null,
        hp: creature.currentHP ?? creature.hp ?? 0,
        maxHp: creature.currentMaxHP ?? creature.hp ?? 0,
        tempHp: creature.tempHP ?? 0,
        ac: typeof creature.ac === 'number' ? creature.ac : parseInt(String(creature.ac)) || 0,
        isDead: (creature.currentHP ?? creature.hp ?? 1) <= 0,
        isHiddenFromPlayers: creature.hidden ?? (!isPlayer), // Monsters default to hidden
        initiative_modifier: Array.isArray(creature.modifier)
            ? creature.modifier[0]
            : (creature.modifier ?? 0),
    };
}

/**
 * Map a webapp combatant → IT plugin HomebrewCreature format for adding.
 * Used when syncing new combatants FROM the webapp TO the IT plugin.
 */
export function webappCombatantToITCreature(combatant: WebappCombatant): any {
    return {
        name: combatant.name,
        hp: combatant.maxHp ?? combatant.hp ?? 0,
        ac: combatant.ac ?? 0,
        modifier: combatant.initiative_modifier ?? 0,
        player: combatant.type === 'Player Character',
        friendly: combatant.type === 'Summon' || combatant.type === 'Player Character',
        hidden: false, // PCs/summons from webapp are visible
    };
}

/**
 * Diff two combatant arrays to find changes.
 * Returns added, removed, and changed combatants.
 */
export function diffCombatants(
    oldList: WebappCombatant[],
    newList: WebappCombatant[]
): {
    added: WebappCombatant[];
    removed: WebappCombatant[];
    changed: { combatant: WebappCombatant; changes: Partial<WebappCombatant> }[];
} {
    const oldMap = new Map(oldList.map(c => [c.name, c]));
    const newMap = new Map(newList.map(c => [c.name, c]));

    const added = newList.filter(c => !oldMap.has(c.name));
    const removed = oldList.filter(c => !newMap.has(c.name));

    const changed: { combatant: WebappCombatant; changes: Partial<WebappCombatant> }[] = [];

    for (const [name, newC] of newMap) {
        const oldC = oldMap.get(name);
        if (!oldC) continue;

        const changes: Partial<WebappCombatant> = {};

        if (oldC.hp !== newC.hp) changes.hp = newC.hp;
        if (oldC.maxHp !== newC.maxHp) changes.maxHp = newC.maxHp;
        if (oldC.ac !== newC.ac) changes.ac = newC.ac;
        if (oldC.initiative !== newC.initiative) changes.initiative = newC.initiative;
        if (oldC.isDead !== newC.isDead) changes.isDead = newC.isDead;
        if (oldC.isHiddenFromPlayers !== newC.isHiddenFromPlayers) {
            changes.isHiddenFromPlayers = newC.isHiddenFromPlayers;
        }

        if (Object.keys(changes).length > 0) {
            changed.push({ combatant: newC, changes });
        }
    }

    return { added, removed, changed };
}
