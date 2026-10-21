// src/bridge/itSnapshot.ts
// Pure: the bridge's picture of IT (what the webapp already knows), and how the bridge's own
// changes to IT go into it, so that only the DM's own changes are sent to the webapp.

export interface CreatureSnap {
    name: string;
    hp: number;
    initiative: number;
    hidden: boolean;
    active: boolean;
    player: boolean;
}

export type ItSnapshot = Map<string, CreatureSnap>;

const FIELDS: (keyof CreatureSnap)[] = ['name', 'hp', 'initiative', 'hidden', 'active', 'player'];

/** Snapshot of live IT creatures; `nameOf` gives the display name ("Goblin 2"). */
export function takeSnapshot(creatures: any[], nameOf: (creature: any) => string): ItSnapshot {
    const snapshot: ItSnapshot = new Map();
    for (const c of creatures) {
        snapshot.set(c.id, {
            name: nameOf(c),
            hp: c.hp ?? 0,
            initiative: c.initiative ?? 0,
            hidden: c.hidden ?? false,
            active: c.active ?? false,
            player: c.player === true,
        });
    }
    return snapshot;
}

/**
 * The bridge changed IT (from `before` to `after`, taken around its own change): put those
 * changes into `snapshot`, so the next IT save does not send them back to the webapp. Fields the
 * bridge did not touch keep their snapshot value, so a DM edit not yet sent is still seen.
 *
 * - A creature the bridge added is taken in whole; one it removed is dropped.
 * - A creature not in the snapshot (added by the DM, not yet sent) stays out of it.
 */
export function foldOwnChanges(snapshot: ItSnapshot, before: ItSnapshot, after: ItSnapshot): void {
    for (const [id, now] of after) {
        const was = before.get(id);
        if (!was) {
            snapshot.set(id, { ...now });
            continue;
        }
        const known = snapshot.get(id);
        if (!known) continue;
        for (const field of FIELDS) {
            if (was[field] !== now[field]) (known as any)[field] = now[field];
        }
    }
    for (const id of before.keys()) {
        if (!after.has(id)) snapshot.delete(id);
    }
}
