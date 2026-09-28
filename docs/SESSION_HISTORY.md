# Session history

Short log for troubleshooting. Newest first, 3 to 6 lines per session; details in commit messages. Earlier plugin history is in the webapp repo, git tag `ai-prompting-legacy` (`.AI_PROMPTING/SESSION_HISTORY.md`).

## 28-09-2026 - Agent setup

- Replaced the sample-plugin `AGENTS.md` with project rules; added `CLAUDE.md`, `docs/STATUS.md`, this log, the `plugin-release` skill and Antigravity files. Test plans moved here from the webapp.

## 27-09-2026 - Bridge 0.5.0

- Reconnect mid-combat no longer duplicates players (link pass on connect); IT players auto-linked to campaign PCs; creatures addressed by IT id; new-encounter and tracker-close detection; tracker `ownerUid`. Matching logic moved to pure `linking.ts` with tests.
