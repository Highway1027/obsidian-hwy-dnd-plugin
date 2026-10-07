# Obsidian bridge 0.5.1: test steps

About 15 minutes, or during a real session. Built and unit-tested 07-10-2026 (30 tests); not yet run inside Obsidian.

## Before you start
1. The DM's Initiative Tracker must be **13.0.17 or newer** (Settings → Community plugins). Older versions ignore the tie order, so ties may show in a different order than the webapp. Tim's desktop vault has 13.0.18.
2. Update **Highway DnD Tools** to **0.5.1** (BRAT, or copy `main.js`, `manifest.json` and `styles.css` from the GitHub release into `.obsidian/plugins/highway-dnd-tools/`) and reload Obsidian.
3. In the webapp, open the tracker page as DM and do a hard refresh (Ctrl+F5).

## A. Real initiative numbers
- [ ] Connect the bridge to a tracker with players and monsters. Obsidian shows the **real** initiative numbers (no more 1000, 999, ...), in the same order as the webapp.
- [ ] Give a player and a monster the **same** initiative in the webapp. Both sides show them in the same order.
- [ ] Change a **monster's** initiative in Obsidian: the webapp follows within a second or two, and the order matches on both sides.
- [ ] Change a **player's** initiative in Obsidian: it jumps back to the webapp value (players' initiative belongs to the webapp).
- [ ] Advance turns on both sides: they agree on whose turn it is.
- [ ] Close and reopen Obsidian, connect again: the order is right straight away.

## B. First names for player characters
- [ ] Add a player character with a long name (e.g. "Ogg of the Cragmaw tribe") in the **webapp**: Obsidian shows "Ogg".
- [ ] HP changes in the webapp still reach "Ogg" in Obsidian.
- [ ] Two characters with the same first name keep their full names in Obsidian.
- [ ] Monsters keep their full names ("Goblin Boss").

## C. Removing a monster in Obsidian
- [ ] Remove a living monster in Obsidian (without setting HP to 0): in the webapp it moves to the **Graveyard** with "DEAD (Rnd N)", and its turn is skipped.
- [ ] Remove a player in Obsidian: nothing happens to them in the webapp.
- [ ] Revive the removed monster in the webapp: it comes back in Obsidian.
- [ ] Reconnect after removing a monster: the dead monster is **not** added back to Obsidian.
- [ ] "New encounter" in Obsidian still only disconnects the bridge; the old monsters do not all die in the webapp.
