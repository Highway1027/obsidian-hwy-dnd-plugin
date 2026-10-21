# Status

Start here. Current state and open work only. Last update: 21-10-2026.

## Now

- **0.5.2** released 21-10-2026 (main `afeb39a`, tag `0.5.2`): adds Ctrl+P → "Run bridge self-test (test campaign)". It passed 19/19 in Tim's desktop vault on "TEST - Arc van Noah" (uses Tim's own "TEST - HP TESTER" for player HP), so the bridge sync of 0.5.0/0.5.1 is checked. No bridge code changes since 0.5.1.
- **Still by hand** (`docs/TESTING.md`): Obsidian restart, IT's own buttons (New encounter, closing the pane), the DM's PC (IT 13.0.17+, update via BRAT), webapp quick checks.
- **On `develop`, not released:** bridge button in IT's own icon row (works in the sidebar) (red/green swords; click = connect, reconnect or status), one-click reconnect to the last tracker within 12 hours, a redesigned connect window (one list: new tracker or an existing one, newest first, button says what happens), and after "New encounter" a message with "Create a new webapp tracker for this encounter". Hand test: sitting D.
- **Next:** sitting D, then release 0.6.0; the DM's PC at the next session; then the sync-reliability work (Inbox).

## Known issues

- Drag-and-drop reordering in IT triggers rapid changes that can break the bridge. Workaround: change initiative values directly (since 0.5.1, monster values typed in IT sync to the webapp).
- If assigning `obsidianId` to a webapp combatant fails, the name fallback breaks after a rename.
- Monsters "hidden until their turn": `isHiddenFromPlayers` is set, but the webapp only hides them in the public view (webapp backlog).
- The bridge assumes IT sorts high initiative first (IT's default). With "ascending" in IT settings the order is reversed.
- `ordering.ts` copies the webapp's sort (`src/components/initiative/combatUtils.js`, `getSortedCombatants`). Change both together.

## Inbox

Ideas parked during a session, one dated line each.

- 21-10-2026: Sync reliability (needs Tim's OK, changes how the sync works). (1) Replace the 2-second echo windows: after applying webapp values to IT, store them as the IT snapshot, and use Firestore's `hasPendingWrites` for our own writes. Today real changes in that window are lost for good (a DM HP edit just after a webapp turn change; a webapp turn change just after a DM edit). (2) Debounce IT saves (~300 ms) and write one at a time: the cause of the drag-and-drop issue. (3) Write combatants in a Firestore transaction instead of overwriting the whole list from the cache. Add self-test steps for each.
- 21-10-2026: Small: warn when IT sorts ascending; drop the old version headers in the source files; split `main.ts` (1100+ lines, unrelated features).
