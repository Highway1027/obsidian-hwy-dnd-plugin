# Status

Start here. Current state and open work only. Last update: 22-10-2026.

## Now

- **0.7.0** released 21-10-2026 (main `b679416`, tag `0.7.0`): sync reliability (below) plus drags in IT seen straight away. Sitting J (self-test, drags, offline) passed on 22-10-2026.
- **Webapp 22-10-2026:** the sort debugger (tracker → gear) has a "Show HP" switch, so the DM can see monster HP for J4. Live (wildshape-tracker main e36c671).
- **0.6.0** released 21-10-2026: bridge button, one-click reconnect, new connect window, new encounter, players added back.
- **0.5.2** released 21-10-2026: adds Ctrl+P → "Run bridge self-test (test campaign)". It passed 19/19 in Tim's desktop vault on "TEST - Arc van Noah" (uses Tim's own "TEST - HP TESTER" for player HP), so the bridge sync of 0.5.0/0.5.1 is checked. No bridge code changes since 0.5.1.
- **Hand tests passed 21-10-2026:** sittings B (restart, IT's buttons), C (DM's PC) and E (pane button). Sittings F and G (new encounter removes the players, creates a tracker by itself) passed too. Sittings H and I passed. Webapp quick checks (D) dropped. No hand tests open.
- **In 0.6.0:** bridge button in IT's own icon row (works in the sidebar) (red/green swords; click = connect, reconnect or status), one-click reconnect to the last tracker within 12 hours, a redesigned connect window (one list: new tracker or an existing one, newest first, button says what happens; the new tracker's name is an empty field with the date and time as grey placeholder), and "New encounter" while connected removes IT's kept players and connects straight to a new empty webapp tracker (the DM adds the party in the webapp, the bridge brings it to IT). A player character removed in IT by accident is added back from the webapp, with a message. Hand-tested and passed (sitting I).
- **In 0.7.0 (sync reliability):** IT saves are handled once IT is quiet (300 ms), one at a time. Bridge writes are patches in a Firestore transaction, so webapp changes made meanwhile are kept. The 2-second echo windows are gone: echoes are recognised instead. IT's drag-and-drop fires no save event, so the bridge also watches IT's store. Self-test R1-R6.
- **Next:** pick from the Inbox; the DM tie order is the top candidate.

## Known issues

- A drag in IT copies the neighbour's initiative, so it always makes a tie; the webapp settles ties by its own rule (modifier, Dex, players first, tie-breaker), so a dragged monster can land just next to where it was dropped. Players always jump back (webapp is the truth). Fix idea in the Inbox.
- Very fast drags one after another in IT can still break sync (seen 22-10-2026, edge case).
- A bridge write fails when offline (transactions don't queue). The DM gets a notice; the change is sent again with the next IT change.
- If assigning `obsidianId` to a webapp combatant fails, the name fallback breaks after a rename.
- Monsters "hidden until their turn": `isHiddenFromPlayers` is set, but the webapp only hides them in the public view (webapp backlog).
- The bridge assumes IT sorts high initiative first (IT's default). With "ascending" in IT settings the order is reversed.
- `ordering.ts` copies the webapp's sort (`src/components/initiative/combatUtils.js`, `getSortedCombatants`). Change both together.

## Inbox

Ideas parked during a session, one dated line each.

- 21-10-2026 (expanded 22-10-2026): DM tie order. A creature dragged in IT stays exactly where dropped, players too, and the webapp remembers it when a new combatant joins the tie. Needs: bridge writes `tieBreaker` for the tie group after a drag; webapp sort lets a DM-set order beat modifier, DEX and players-first (sort lives in both repos, turn is an index: change together, webapp deploy + plugin release). Same job: monsters and players added from IT get no `dexterity_score` (IT only keeps the modifier; harmless, modifier mostly follows DEX).
- 21-10-2026: Small: warn when IT sorts ascending; drop the old version headers in the source files (done for the manager); split `main.ts` (1100+ lines, unrelated features).
