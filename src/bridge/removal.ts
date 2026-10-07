// src/bridge/removal.ts
// Pure rule: what removing a creature in Initiative Tracker means for the webapp tracker.

import type { WebappCombatant } from './fieldMapping';

/** An IT creature that was in the last snapshot and is gone now. */
export interface RemovedCreature {
    id: string;
    name: string;      // display name at the time ("Goblin 2")
    player: boolean;
}

/**
 * The DM removes beaten monsters in IT, often without setting their HP to 0 first.
 * Each removed monster or ally becomes dead in the webapp (graveyard), like the webapp's
 * own kill button: isDead plus the round it died. Player characters and player summons
 * are never killed this way; they stay as they are.
 *
 * Mutates the given combatants (pass copies) and returns the names of the ones killed.
 */
export function markRemovedMonstersDead(
    combatants: WebappCombatant[],
    removed: RemovedCreature[],
    round: number | undefined,
): string[] {
    const killed: string[] = [];
    for (const creature of removed) {
        if (creature.player) continue;
        const combatant = combatants.find(c => c.obsidianId === creature.id)
            ?? combatants.find(c => !c.obsidianId && c.name === creature.name);
        if (!combatant || combatant.isDead) continue;
        if (combatant.type === 'Player Character' || combatant.isPlayerSummon) continue;

        combatant.isDead = true;
        combatant.deathRound = combatant.deathRound || round || 1;
        killed.push(combatant.name);
    }
    return killed;
}
