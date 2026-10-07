# Session history

Short log for troubleshooting. Newest first, 3 to 6 lines per session; details in commit messages. Earlier plugin history is in the webapp repo, git tag `ai-prompting-legacy` (`.AI_PROMPTING/SESSION_HISTORY.md`).

## 07-10-2026 - Bridge 0.5.1 (built, not released)

- Found: removing a creature in IT did nothing in the webapp (monster stayed alive and was re-added to IT on the next connect). Now removed monsters/allies get `isDead` + `deathRound` (`removal.ts`), also during the echo window; PCs and player summons never die this way; dead monsters are not re-added on connect; reviving one in the webapp adds it back.
- Fake 1000/999 initiatives replaced: IT gets the real value plus `manualOrder` = webapp position (`ordering.ts`; IT 13.0.17+ sorts initiative, then manualOrder). IT doesn't save manualOrder, so it is reapplied on every webapp change. Old fake values are still ignored.
- With real numbers, monster initiative edits in IT now sync to the webapp; the bridge then writes `sortIndex` itself with a copy of the webapp sort. Player initiative edits in IT are put back (webapp owns PCs).
- PCs added from the webapp show by first name in IT unless another PC shares it (`itNameFor`); lookup by first name via `findCreatureFor`. New test file `tests/bridgeRules.test.mjs` (30 tests total).

## 28-09-2026 - Agent setup

- Replaced the sample-plugin `AGENTS.md` with project rules; added `CLAUDE.md`, `docs/STATUS.md`, this log, the `plugin-release` skill and Antigravity files. Test plans moved here from the webapp.

## 27-09-2026 - Bridge 0.5.0

- Reconnect mid-combat no longer duplicates players (link pass on connect); IT players auto-linked to campaign PCs; creatures addressed by IT id; new-encounter and tracker-close detection; tracker `ownerUid`. Matching logic moved to pure `linking.ts` with tests.
