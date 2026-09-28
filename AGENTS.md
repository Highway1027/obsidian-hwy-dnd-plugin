# Highway DnD Tools (Obsidian plugin)

Rules and context for every AI coding agent (Claude Code, Antigravity, Codex). This is the single source; tool-specific files only point here.

**Start of a session:** read `docs/STATUS.md`.

## What this is

Obsidian plugin (id `highway-dnd-tools`) for the DM of Tim's D&D group. Main feature: a live **bridge between the Obsidian Initiative Tracker plugin (IT) and the webapp's initiative tracker** (`D:\Webapps\wildshape-tracker`, Firebase project `wildshape-tracker`): combatants, HP, AC, conditions, turns and deaths sync both ways. Only the DM uses it.

| Path | Purpose |
| --- | --- |
| `main.ts` | Plugin entry: settings tab, ribbon icon, status bar, commands |
| `src/firebase.ts` | Firebase connection to the webapp backend |
| `src/bridge/InitiativeBridgeManager.ts` | Two-way sync logic (connect, relink, echo suppression, new-encounter and tracker-close detection) |
| `src/bridge/itPluginAccess.ts` | Access to IT's Svelte stores; creatures addressed by IT id |
| `src/bridge/linking.ts` | Pure matching of IT creatures ↔ webapp combatants ↔ campaign PCs (tested) |
| `src/bridge/fieldMapping.ts` | Stat translation between IT and the webapp |
| `src/bridge/BridgeStatusView.ts`, `ShareInitiativeModal.ts` | Sidebar status view, connect modal |

## Commands

| What | Command |
| --- | --- |
| Watch build | `npm run dev` |
| Production build (type check + bundle) | `npm run build` |
| Tests | `npm test` |
| Release | see the `plugin-release` skill |

Git in this folder needs `git -c safe.directory=D:/Webapps/obsidian-hwy-dnd-plugin ...` (the folder was created on another PC).

## Rules

- **Webapp is the source of truth** for player characters (HP, AC from D&D Beyond sync); IT is the source for monsters added in Obsidian. Never let a sync echo bounce back (echo suppression in the manager).
- **Link by id, not name**: IT id ↔ webapp `obsidianId`. Names are only a fallback for the first match (full name, or first name when unique).
- Keep matching and mapping logic pure (in `linking.ts` / `fieldMapping.ts`) and covered by `tests/`.
- IT internals (Svelte stores) can change with IT updates: keep all IT access inside `itPluginAccess.ts`.
- Webapp-side changes (Firestore rules, initiative functions) follow the webapp `AGENTS.md`.
- Obsidian plugin basics: register listeners with `this.registerEvent`/`registerInterval` so they unload cleanly; no network calls beyond Firebase; `main.js` is build output (git-ignored).

## Git

Work on `develop`. Merging to `main` with a new version in `manifest.json` publishes a GitHub release (`.github/workflows/release.yml`). Only with Tim's OK. Commit messages carry the details; no file version headers needed.

## Focus, skills, writing

- At session start name the top open items from `docs/STATUS.md`. When a new idea comes up mid-task, ask **"Now, or park it in the backlog?"** (small same-area fixes excepted); parked ideas go to the Inbox in `docs/STATUS.md`.
- Skills: `plugin-release` (`.claude/skills/`, Antigravity workflow points to it). Fix a skill as soon as it proves wrong; propose one when a routine repeats.
- End of a session: update `docs/STATUS.md`, add 3 to 6 lines at the top of `docs/SESSION_HISTORY.md` (what changed, decisions, gotchas), commit.
- Tim prefers plain English, short sentences, dates as DD-MM-YYYY.
