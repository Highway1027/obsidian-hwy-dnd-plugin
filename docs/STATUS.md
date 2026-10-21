# Status

Start here. Current state and open work only. Last update: 21-10-2026.

## Now

- **Bridge self-test** built 21-10-2026 on `develop` (not released): Ctrl+P → "Run bridge self-test (test campaign)" checks most of 0.5.0/0.5.1 in about a minute, only in a webapp test copy. Second run 21-10-2026: 18 passed, A5 skipped (only a character's owner may write it). The test now uses the DM's own character when the TEST campaign has one. Third run 21-10-2026 with Tim's own "TEST - HP TESTER": **19/19 passed. Next: release 0.5.2.**

- **0.5.1** released on GitHub 08-10-2026 (main `4841d98`, tag `0.5.1`), **not yet tested in Obsidian**: real initiative numbers in IT (real value + `manualOrder` = webapp position, no more 1000/999), monster initiative edits in IT sync to the webapp, first names for player characters in IT, monsters removed in IT become dead in the webapp. 30 unit tests pass. Needs IT 13.0.17+ on the DM's PC (ask him his version). Test steps: `docs/TESTING.md`.
- **0.5.0** on GitHub (27-09-2026): relink on connect, IT players auto-linked to campaign PCs, creatures addressed by IT id, new-encounter and tracker-close detection. **Not yet tested in Obsidian**: covered by the sittings in `docs/TESTING.md`.

## Known issues

- Drag-and-drop reordering in IT triggers rapid changes that can break the bridge. Workaround: change initiative values directly (since 0.5.1, monster values typed in IT sync to the webapp).
- If assigning `obsidianId` to a webapp combatant fails, the name fallback breaks after a rename.
- Monsters "hidden until their turn": `isHiddenFromPlayers` is set, but the webapp only hides them in the public view (webapp backlog).
- The bridge assumes IT sorts high initiative first (IT's default). With "ascending" in IT settings the order is reversed.
- `ordering.ts` copies the webapp's sort (`src/components/initiative/combatUtils.js`, `getSortedCombatants`). Change both together.

## Inbox

Ideas parked during a session, one dated line each.
