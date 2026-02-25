// src/bridge/fieldMapping.ts
// v1 - 25-02-2026 - Field mapping between IT Plugin and Webapp combatant formats

/**
 * Maps an Obsidian Initiative Tracker creature to the webapp's combatant format.
 * IT Plugin CreatureState → Webapp Firestore combatant
 */
export function itCreatureToFirestore(creature: any): any {
    const id = crypto.randomUUID();
    const isPlayer = creature.player === true;

    return {
        id,
        name: creature.name || creature.display || 'Unknown',
        type: isPlayer ? 'Player Character' : 'Monster',
        hp: creature.currentHP ?? creature.hp ?? null,
        maxHp: creature.maxHP ?? creature.hp ?? null,
        ac: creature.ac ?? null,
        initiative: creature.initiative ?? null,
        initiative_modifier: creature.modifier ?? 0,
        dexterity_score: null,
        isDead: (creature.currentHP ?? creature.hp ?? 1) <= 0,
        conditions: mapStatusToConditions(creature.status),
        tieBreaker: Math.floor(Math.random() * 20) + 1,
        isHiddenFromPlayers: !isPlayer,  // Monsters hidden until their turn
        addedVia: 'obsidian-bridge',
        // Preserve original IT name for syncing back
        _itName: creature.name || creature.display,
    };
}

/**
 * Maps a webapp Firestore combatant to IT Plugin HomebrewCreature format.
 * For adding players from the webapp into the IT plugin.
 */
export function firestoreCombatantToIT(combatant: any): any {
    return {
        name: combatant.name,
        display: combatant.name,
        hp: combatant.hp ?? combatant.maxHp ?? 10,
        ac: combatant.ac ?? null,
        initiative: combatant.initiative ?? null,
        modifier: combatant.initiative_modifier ?? 0,
        player: combatant.type === 'Player Character',
    };
}

/**
 * Convert IT Plugin status Set<string> to webapp conditions array.
 */
function mapStatusToConditions(status: any): { name: string; duration: number | null }[] {
    if (!status) return [];

    // Status can be a Set, Array, or other iterable
    const statusArray = Array.isArray(status) ? status : Array.from(status || []);

    return statusArray.map((s: any) => {
        if (typeof s === 'string') {
            return { name: s, duration: null };
        }
        // If it's already an object with name/duration
        return { name: s.name || String(s), duration: s.duration ?? null };
    });
}

/**
 * Convert webapp conditions array back to a simple string array for IT plugin.
 */
export function conditionsToStatus(conditions: any[]): string[] {
    if (!conditions || !Array.isArray(conditions)) return [];
    return conditions.map(c => c.name || String(c));
}

/**
 * Diffs two combatant arrays and returns changes.
 */
export function diffCombatants(
    oldList: any[],
    newList: any[]
): {
    added: any[];
    removed: any[];
    updated: { id: string; changes: Record<string, any> }[];
} {
    const oldMap = new Map(oldList.map(c => [c.id, c]));
    const newMap = new Map(newList.map(c => [c.id, c]));

    const added: any[] = [];
    const removed: any[] = [];
    const updated: { id: string; changes: Record<string, any> }[] = [];

    // Find added and updated
    for (const [id, newC] of newMap) {
        const oldC = oldMap.get(id);
        if (!oldC) {
            added.push(newC);
            continue;
        }

        // Check for meaningful changes
        const changes: Record<string, any> = {};
        if (oldC.hp !== newC.hp) changes.hp = newC.hp;
        if (oldC.maxHp !== newC.maxHp) changes.maxHp = newC.maxHp;
        if (oldC.ac !== newC.ac) changes.ac = newC.ac;
        if (oldC.initiative !== newC.initiative) changes.initiative = newC.initiative;
        if (oldC.isDead !== newC.isDead) changes.isDead = newC.isDead;
        if (oldC.isHiddenFromPlayers !== newC.isHiddenFromPlayers) changes.isHiddenFromPlayers = newC.isHiddenFromPlayers;

        if (Object.keys(changes).length > 0) {
            updated.push({ id, changes });
        }
    }

    // Find removed
    for (const [id, oldC] of oldMap) {
        if (!newMap.has(id)) {
            removed.push(oldC);
        }
    }

    return { added, removed, updated };
}
