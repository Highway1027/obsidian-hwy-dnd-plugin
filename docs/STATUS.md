# Status

Start here. Current state and open work only. Last update: 21-10-2026.

## Now

- **0.5.2** released 21-10-2026 (main `afeb39a`, tag `0.5.2`): adds Ctrl+P → "Run bridge self-test (test campaign)". It passed 19/19 in Tim's desktop vault on "TEST - Arc van Noah" (uses Tim's own "TEST - HP TESTER" for player HP), so the bridge sync of 0.5.0/0.5.1 is checked. No bridge code changes since 0.5.1.
- **Still by hand** (`docs/TESTING.md`): Obsidian restart, IT's own buttons (New encounter, closing the pane), the DM's PC (IT 13.0.17+, update via BRAT), webapp quick checks.
- **Next:** the DM's PC at the next session; then pick from the Inbox.

## Known issues

- Drag-and-drop reordering in IT triggers rapid changes that can break the bridge. Workaround: change initiative values directly (since 0.5.1, monster values typed in IT sync to the webapp).
- If assigning `obsidianId` to a webapp combatant fails, the name fallback breaks after a rename.
- Monsters "hidden until their turn": `isHiddenFromPlayers` is set, but the webapp only hides them in the public view (webapp backlog).
- The bridge assumes IT sorts high initiative first (IT's default). With "ascending" in IT settings the order is reversed.
- `ordering.ts` copies the webapp's sort (`src/components/initiative/combatUtils.js`, `getSortedCombatants`). Change both together.

## Inbox

Ideas parked during a session, one dated line each.
