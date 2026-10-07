# Status

Start here. Current state and open work only. Last update: 07-10-2026.

## Now

- **0.5.1** released on GitHub 08-10-2026 (main `4841d98`, tag `0.5.1`), **not yet tested in Obsidian**: real initiative numbers in IT (real value + `manualOrder` = webapp position, no more 1000/999), monster initiative edits in IT sync to the webapp, first names for player characters in IT, monsters removed in IT become dead in the webapp. 30 unit tests pass. Needs IT 13.0.17+ on the DM's PC (ask him his version). Test steps: `test-plans/Obsidian bridge 0.5.1 test steps.md`.
- **0.5.0** on GitHub (27-09-2026): relink on connect, IT players auto-linked to campaign PCs, creatures addressed by IT id, new-encounter and tracker-close detection. **Not yet tested in Obsidian**: steps in `test-plans/Obsidian bridge 0.5.0 test steps.md`.

## Known issues

- Drag-and-drop reordering in IT triggers rapid changes that can break the bridge. Workaround: change initiative values directly (since 0.5.1, monster values typed in IT sync to the webapp).
- If assigning `obsidianId` to a webapp combatant fails, the name fallback breaks after a rename.
- Monsters "hidden until their turn": `isHiddenFromPlayers` is set, but the webapp only hides them in the public view (webapp backlog).
- The bridge assumes IT sorts high initiative first (IT's default). With "ascending" in IT settings the order is reversed.
- `ordering.ts` copies the webapp's sort (`src/components/initiative/combatUtils.js`, `getSortedCombatants`). Change both together.

## Inbox

Ideas parked during a session, one dated line each.
