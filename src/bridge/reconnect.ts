// src/bridge/reconnect.ts
// Pure rule for the one-click reconnect from the IT pane button.

/** Reconnect straight away only within this time after the last connect (a restart mid-session). */
export const QUICK_RECONNECT_MS = 12 * 60 * 60 * 1000;

export interface LastTracker {
    trackerId: string;
    connectedAt: number;   // ms since epoch, 0 = never
}

/**
 * The tracker to reconnect to without asking, or null to open the connect window.
 * Only the last tracker, only if it still exists, and only shortly after the last
 * connect: next week's session may be a new fight, so then the DM chooses.
 */
export function quickReconnectTarget<T extends { id: string }>(
    last: LastTracker,
    trackers: T[],
    now: number
): T | null {
    if (!last.trackerId || !last.connectedAt) return null;
    if (now - last.connectedAt > QUICK_RECONNECT_MS) return null;
    return trackers.find(t => t.id === last.trackerId) ?? null;
}
