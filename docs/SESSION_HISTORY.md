# Session history

Short log for troubleshooting. Newest first, 3 to 6 lines per session; details in commit messages. Earlier plugin history is in the webapp repo, git tag `ai-prompting-legacy` (`.AI_PROMPTING/SESSION_HISTORY.md`).

## 21-10-2026 - Review, bridge button in the IT pane

- Code review: structure sound; main weak spot is time-based echo suppression (real changes in the 2 s window are lost) plus parallel IT-save writes (drag-and-drop issue). Parked in the Inbox as "sync reliability".
- New: bridge button in IT's pane (`TrackerPaneButton.ts`), IT's code untouched. First via `view.addAction`, but a pane in the sidebar has no header (where the DM keeps IT), so it now sits first in IT's own icon row (`.buttons > .clean`, selector in `itPluginAccess.ts`), built with `ExtraButtonComponent` like IT's icons. A MutationObserver puts it back when IT redraws; header only as a fallback after 3 s.
- One-click reconnect (`reconnect.ts`, tested): only to the last tracker, only within 12 h of the last connect, so next week's fight is never merged into last week's tracker. The self-test's test tracker is never remembered.
- New encounter: the manager calls `onNewEncounter`; main.ts clears the last tracker and shows a sticky notice with "Create a new webapp tracker for this encounter".
- Tim confirmed the button works in the sidebar.
- Connect window redesigned: one radio list (new tracker with editable name first, then existing trackers newest first with "updated ... ago" and a "last used" badge), campaign + IT summary on top, button text says what happens, double-click connects. Preselection uses the same 12 h rule as the pane button. Pure helpers in `connectChoices.ts` (tested); tracker names now `Combat DD-MM-YYYY HH:MM`. Rest of sitting E not tested yet.

## 21-10-2026 - Self-test runs, fixes, release 0.5.2

- Run in Obsidian: 16 passed, C1 + A3 failed, A5 skipped. Cause: the TEST campaign is a copy of Arc van Noah, whose real character is "Ogg of the Cragmaw tribe", the same name the self-test used for its made-up PC. C1 then read the real Ogg's link; on reconnect the made-up Ogg got its full name (clash with "Ogg the Younger") and IT showed the name twice.
- Fix: made-up PCs are now "Zorvath of the Selftest clan" / "Zorvath the Younger", and C1/D3 find them by webapp combatant id instead of name. Bridge code unchanged.
- A5 skip (permission-denied on the character doc): webapp rules let only the owner (`uid`) update a character, nothing to do with D&D Beyond. The self-test now picks a campaign character owned by the plugin's account for its PC (A5 runs), and skips A5 with a clear reason otherwise. Tim added "TEST - HP TESTER" to the TEST campaign: 19/19 passed.
- Released 0.5.2 (main `afeb39a`, tag `0.5.2`).
- Second run: 18 passed, A5 skipped. "Selftest Stranger" in IT but not the webapp is step E5 (a player without a campaign character stays Obsidian-only), by design.

## 21-10-2026 - TESTING.md in sittings, bridge self-test (not released)

- `docs/test-plans/` (3 overlapping files) replaced by one `docs/TESTING.md` in sittings, with the "How to write a sitting" rules from the webapp and Loadout Manager.
- New command "Run bridge self-test (test campaign)" (`src/selftest/`): clears IT, adds test creatures, creates its own tracker, plays the webapp by writing to it like the webapp does and the DM through IT's store, checks 18 steps, writes the note `Bridge self-test.md`. Deletes its tracker when everything passed.
- Safety: refuses unless the campaign has `isTestCopy: true` and a "TEST - " name (test copies have their own character copies, so A5 may change a test character's HP and puts it back). Asks before clearing IT. Each step waits 3 s first, past the bridge's 2 s echo window.
- Decided against Playwright-style flows (Obsidian is a desktop app) and a fake IT on the emulator (it wouldn't test the real IT access). Not run in Obsidian yet; 39 unit tests pass, build clean.

## 07/08-10-2026 - Bridge 0.5.1 (released)

- Released 08-10-2026: main `4841d98`, tag `0.5.1`, GitHub release with main.js, manifest.json, styles.css. `package.json` version now matches the manifest (was 0.1.9); release skill updated for that.

- Found: removing a creature in IT did nothing in the webapp (monster stayed alive and was re-added to IT on the next connect). Now removed monsters/allies get `isDead` + `deathRound` (`removal.ts`), also during the echo window; PCs and player summons never die this way; dead monsters are not re-added on connect; reviving one in the webapp adds it back.
- Fake 1000/999 initiatives replaced: IT gets the real value plus `manualOrder` = webapp position (`ordering.ts`; IT 13.0.17+ sorts initiative, then manualOrder). IT doesn't save manualOrder, so it is reapplied on every webapp change. Old fake values are still ignored.
- With real numbers, monster initiative edits in IT now sync to the webapp; the bridge then writes `sortIndex` itself with a copy of the webapp sort. Player initiative edits in IT are put back (webapp owns PCs).
- PCs added from the webapp show by first name in IT unless another PC shares it (`itNameFor`); lookup by first name via `findCreatureFor`. New test file `tests/bridgeRules.test.mjs` (30 tests total).

## 28-09-2026 - Agent setup

- Replaced the sample-plugin `AGENTS.md` with project rules; added `CLAUDE.md`, `docs/STATUS.md`, this log, the `plugin-release` skill and Antigravity files. Test plans moved here from the webapp.

## 27-09-2026 - Bridge 0.5.0

- Reconnect mid-combat no longer duplicates players (link pass on connect); IT players auto-linked to campaign PCs; creatures addressed by IT id; new-encounter and tracker-close detection; tracker `ownerUid`. Matching logic moved to pure `linking.ts` with tests.
