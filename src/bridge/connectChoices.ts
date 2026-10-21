// src/bridge/connectChoices.ts
// Pure helpers for the connect window: tracker order, default choice, labels.

import { quickReconnectTarget, type LastTracker } from './reconnect';

export const NEW_TRACKER = 'new';

export interface TrackerSummary {
    id: string;
    name: string;
    round: number;
    combatantCount: number;
    updatedAt: number;   // ms since epoch, 0 = unknown
}

/** Newest first; trackers without a time go last. */
export function sortTrackers<T extends { updatedAt: number }>(trackers: T[]): T[] {
    return [...trackers].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Preselected choice: the last tracker when the pane button would reconnect to it, else a new tracker. */
export function defaultChoice(trackers: { id: string }[], last: LastTracker, now: number): string {
    return quickReconnectTarget(last, trackers, now)?.id ?? NEW_TRACKER;
}

/** "just now", "5 min ago", "2 h ago", "3 days ago"; empty when unknown. */
export function formatAge(updatedAt: number, now: number): string {
    if (!updatedAt) return '';
    const minutes = Math.floor(Math.max(0, now - updatedAt) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** "Combat 21-10-2026 14:38" (DD-MM-YYYY, 24 h). */
export function defaultTrackerName(date: Date): string {
    const two = (n: number) => String(n).padStart(2, '0');
    return `Combat ${two(date.getDate())}-${two(date.getMonth() + 1)}-${date.getFullYear()} ` +
        `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** "Round 3 · 5 combatants · updated 2 h ago" */
export function trackerDetails(t: TrackerSummary, now: number): string {
    const parts = [`Round ${t.round}`, `${t.combatantCount} ${t.combatantCount === 1 ? 'combatant' : 'combatants'}`];
    const age = formatAge(t.updatedAt, now);
    if (age) parts.push(`updated ${age}`);
    return parts.join(' · ');
}
