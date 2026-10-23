# Status

Start here. Current state and open work only. Last update: 23-10-2026.

## Now

- **0.8.0** released 23-10-2026 (main `848498f`, tag `0.8.0`), webapp live the same day (wildshape-tracker main `f8eeaa2`, live bundle has the "DM Order" column). **DM tie order:** A drag in IT keeps the creature where dropped, players too: the bridge writes `tieOrder` ({init, rank}) for the tie, and the webapp sort puts a DM order before modifier, DEX and players-first. A newcomer to an ordered tie goes after it. The turn stays with the same creature when the order changes. The webapp's own "Accept order" tool writes `tieOrder` too (it used to flip "Accept All"). Also: a DEX score for creatures added from IT (10 + 2 x modifier), a warning on connect when IT sorts ascending, old version headers gone. Self-test R5-R7 changed/added. **Release order: webapp first, then plugin** (a new plugin against the old webapp disagrees on the order). Hand test: sitting K.
- **0.7.0** released 21-10-2026 (main `b679416`, tag `0.7.0`): sync reliability (below) plus drags in IT seen straight away. Sitting J (self-test, drags, offline) passed on 22-10-2026.
- **Webapp 22-10-2026:** the sort debugger (tracker → gear) has a "Show HP" switch, so the DM can see monster HP for J4. Live (wildshape-tracker main e36c671).
- **0.6.0** released 21-10-2026: bridge button, one-click reconnect, new connect window, new encounter, players added back.
- **0.5.2** released 21-10-2026: adds Ctrl+P → "Run bridge self-test (test campaign)". It passed 19/19 in Tim's desktop vault on "TEST - Arc van Noah" (uses Tim's own "TEST - HP TESTER" for player HP), so the bridge sync of 0.5.0/0.5.1 is checked. No bridge code changes since 0.5.1.
- **Hand tests passed 21-10-2026:** sittings B (restart, IT's buttons), C (DM's PC) and E (pane button). Sittings F and G (new encounter removes the players, creates a tracker by itself) passed too. Sittings H and I passed. Webapp quick checks (D) dropped. No hand tests open.
- **In 0.6.0:** bridge button in IT's own icon row (works in the sidebar) (red/green swords; click = connect, reconnect or status), one-click reconnect to the last tracker within 12 hours, a redesigned connect window (one list: new tracker or an existing one, newest first, button says what happens; the new tracker's name is an empty field with the date and time as grey placeholder), and "New encounter" while connected removes IT's kept players and connects straight to a new empty webapp tracker (the DM adds the party in the webapp, the bridge brings it to IT). A player character removed in IT by accident is added back from the webapp, with a message. Hand-tested and passed (sitting I).
- **In 0.7.0 (sync reliability):** IT saves are handled once IT is quiet (300 ms), one at a time. Bridge writes are patches in a Firestore transaction, so webapp changes made meanwhile are kept. The 2-second echo windows are gone: echoes are recognised instead. IT's drag-and-drop fires no save event, so the bridge also watches IT's store. Self-test R1-R6.
- **Next:** sitting K (Tim, by hand).

## Known issues

- Very fast drags one after another in IT can still break sync (seen 22-10-2026, edge case).
- A bridge write fails when offline (transactions don't queue). The DM gets a notice; the change is sent again with the next IT change.
- If assigning `obsidianId` to a webapp combatant fails, the name fallback breaks after a rename.
- Monsters "hidden until their turn": `isHiddenFromPlayers` is set, but the webapp only hides them in the public view (webapp backlog).
- The bridge assumes IT sorts high initiative first (IT's default). With "ascending" in IT the order is reversed; the bridge warns on connect.
- `ordering.ts` copies the webapp's sort (`src/components/initiative/combatUtils.js`, `getSortedCombatants`, `dmTieRank`). Change both together; the sort tests are copies too (`tests/ordering.test.mjs` here, `tests/combatSort.test.js` there).
- A drag is recognised by IT's `manualOrder` changing. If an IT update starts setting `manualOrder` by itself, the bridge would take that for a drag.

## Inbox

Ideas parked during a session, one dated line each.

- 21-10-2026: Small: split `main.ts` (1100+ lines, unrelated features).
