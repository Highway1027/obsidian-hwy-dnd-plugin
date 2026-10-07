# Status

Start here. Current state and open work only. Last update: 28-09-2026.

## Now

- **0.5.0** on GitHub (27-09-2026): relink on connect, IT players auto-linked to campaign PCs, creatures addressed by IT id, new-encounter and tracker-close detection. **Not yet tested in Obsidian**: steps in `test-plans/Obsidian bridge 0.5.0 test steps.md`.

## Known issues

- Drag-and-drop reordering in IT triggers rapid changes that can break the bridge. Workaround: change initiative values directly.
- If assigning `obsidianId` to a webapp combatant fails, the name fallback breaks after a rename.
- Monsters "hidden until their turn": `isHiddenFromPlayers` is set, but the webapp only hides them in the public view (webapp backlog).

## Inbox

Ideas parked during a session, one dated line each.

- 07-10-2026: Bridge 0.5.1. (1) Normal initiative numbers in IT: in `enforceInitiativeOrder`, replace the fake 1000/999 values with the real initiative plus `manualOrder` = webapp sortIndex. IT sorts by initiative, then `manualOrder`, then its tie setting (IT 13.0.17+; IT does not save `manualOrder`, so reapply on connect). The DM dislikes the fake numbers. (2) Send only first names of player characters to IT ("Ogg of the Cragmaw tribe" becomes "Ogg"); monsters keep full names; keep the full name if two PCs share a first name; check the name-fallback matching. Tests for both.
