// src/selftest/checks.ts
// Pure helpers for the in-Obsidian bridge self-test (tested in tests/selfTestChecks.test.mjs).

import type { WebappCombatant } from '../bridge/fieldMapping';
import { webappOrder, withSortIndex } from '../bridge/ordering';

export type StepStatus = 'pass' | 'fail' | 'skip';

export interface StepResult {
    id: string;
    title: string;
    status: StepStatus;
    detail?: string;
}

/** Only a webapp test copy may be used: flagged isTestCopy and named "TEST - ...". */
export function isTestCampaign(caravan: { name?: unknown; isTestCopy?: unknown } | null | undefined): boolean {
    return !!caravan
        && caravan.isTestCopy === true
        && typeof caravan.name === 'string'
        && caravan.name.startsWith('TEST - ');
}

/** "13.0.18" >= "13.0.17". Missing or unreadable versions count as too old. */
export function versionAtLeast(version: string | null | undefined, minimum: string): boolean {
    if (!version) return false;
    const parts = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
    const a = parts(version);
    const b = parts(minimum);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x > y;
    }
    return true;
}

export interface ItCreatureLite {
    id: string;
    name: string;
}

/**
 * Do IT and the webapp show the linked creatures in the same order?
 * Returns null when they agree, else both orders by name (for the report).
 * Creatures only one side has (removed in IT, unlinked players) are left out.
 */
export function orderMismatch(combatants: WebappCombatant[], itCreatures: ItCreatureLite[]): string | null {
    const itIds = new Set(itCreatures.map(c => c.id));
    const webapp = webappOrder(combatants).filter(c => c.obsidianId && itIds.has(c.obsidianId));
    const linked = new Set(webapp.map(c => c.obsidianId));
    const it = itCreatures.filter(c => linked.has(c.id));

    const same = webapp.length === it.length && webapp.every((c, i) => c.obsidianId === it[i].id);
    if (same) return null;
    return `webapp: ${webapp.map(c => c.name).join(', ')} / IT: ${it.map(c => c.name).join(', ')}`;
}

/** A webapp-side edit of one combatant, with sortIndex recomputed like the webapp does. */
export function editCombatant(
    combatants: WebappCombatant[],
    id: string,
    patch: Partial<WebappCombatant>
): WebappCombatant[] {
    return withSortIndex(combatants.map(c => (c.id === id ? { ...c, ...patch } : c)));
}

/** The report note: summary on top, one line per step, details only for steps that did not pass. */
export function formatReport(
    results: StepResult[],
    meta: { date: string; pluginVersion: string; itVersion: string; campaign: string; tracker: string; trackerKept: boolean }
): string {
    const count = (s: StepStatus) => results.filter(r => r.status === s).length;
    const icon: Record<StepStatus, string> = { pass: '✅', fail: '❌', skip: '⏭️' };

    const lines = [
        '# Bridge self-test',
        '',
        `**${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped** (${meta.date})`,
        '',
        `Plugin ${meta.pluginVersion}, Initiative Tracker ${meta.itVersion}, campaign "${meta.campaign}".`,
        meta.trackerKept
            ? `Tracker "${meta.tracker}" was kept so you can look at it; delete it in the webapp when done.`
            : `Tracker "${meta.tracker}" was deleted again.`,
        '',
        ...results.map(r => `- ${icon[r.status]} **${r.id}** ${r.title}${r.status !== 'pass' && r.detail ? ` — ${r.detail}` : ''}`),
        '',
    ];
    if (count('fail') > 0) {
        lines.push('Something failed: copy this note and the `[Bridge]` lines from the console (Ctrl+Shift+I) to Claude.', '');
    }
    return lines.join('\n');
}
