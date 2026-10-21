# Testing (Obsidian plugin)

**Blocking right now:** nothing. Everything below can wait for a convenient moment, or a real session.

Hand tests Tim still has to do, in sittings (one topic, one go). Last update: 21-10-2026.

How to write a sitting (Tim, 15-10-2026: "concise, checklists with short bullet points, not novels"):
- One action per line, then what you should see. One short sentence each.
- Each sitting has a letter; steps are numbered per sitting (A1, A2 ...), so Tim can say "C3 failed". When needed add .1 (C5.1, C5.2).
- Lines name the exact side (Obsidian or webapp), button or pane to use.
- **A step you don't mention counts as passed.**
- What the sitting needs (plugin version, IT version, a tracker with players and monsters) goes in "Before you start".
- Only test by hand what Claude cannot check: behaviour inside Obsidian and the live webapp. Matching, ordering and mapping rules belong in `tests/` (`npm test`). Mark a step *assumed* when an earlier result covers it.
- When a release passes, remove its steps and add one dated line under Results.

**Before every sitting:**
- The DM's Obsidian has **Highway DnD Tools 0.5.1** (BRAT, or copy `main.js`, `manifest.json`, `styles.css` from the GitHub release into `.obsidian/plugins/highway-dnd-tools/`, then reload Obsidian).
- The DM's **Initiative Tracker (IT) is 13.0.17 or newer** (Settings → Community plugins). Older versions may show ties in a different order.
- The webapp tracker page is open as DM, hard refreshed (Ctrl+F5).

**If something goes wrong:** open Obsidian's console (Ctrl+Shift+I) and copy the lines starting with `[Bridge]`.

## Results so far

- Nothing tested yet. 0.5.0 (27-09-2026) and 0.5.1 (08-10-2026) are both covered by the sittings below.

---

## Sitting A: Connect and reconnect (≈ 5 min)

**Before you start:** a webapp tracker with the player characters and a few monsters, initiative rolled.
- [ ] A1. Connect the bridge in Obsidian. Everyone appears once, in the same order as the webapp.
- [ ] A2. Obsidian shows the real initiative numbers (no 1000, 999 ...).
- [ ] A3. Close Obsidian completely, reopen, connect to the same tracker. Nobody is added twice, on either side.
- [ ] A4. The order is right straight away. Player HP and AC came through from the webapp.
- [ ] A5. Change a player's HP in the webapp. Obsidian follows within a second or two.

## Sitting B: Initiative and turns (≈ 5 min)

**Before you start:** connected, as after sitting A.
- [ ] B1. Give a player and a monster the same initiative in the webapp. Both sides show them in the same order.
- [ ] B2. Change a monster's initiative in Obsidian. The webapp follows, the order matches.
- [ ] B3. Change a player's initiative in Obsidian. It jumps back to the webapp value.
- [ ] B4. Advance the turn in the webapp, then in Obsidian. Both sides agree whose turn it is.

## Sitting C: Names (≈ 5 min)

**Before you start:** connected.
- [ ] C1. Add a player character with a long name (e.g. "Ogg of the Cragmaw tribe") in the webapp. Obsidian shows "Ogg".
- [ ] C2. Change Ogg's HP in the webapp. It reaches "Ogg" in Obsidian.
- [ ] C3. Two characters with the same first name keep their full names in Obsidian.
- [ ] C4. Monsters keep their full names ("Goblin Boss").

## Sitting D: Monsters dying and removed (≈ 5 min)

**Before you start:** connected, a few living monsters.
- [ ] D1. Kill a monster in the webapp. In Obsidian it gets 0 HP and "Unconscious", and its turn is skipped.
- [ ] D2. Remove a living monster in Obsidian. In the webapp it moves to the Graveyard with "DEAD (Rnd N)".
- [ ] D3. Remove a player in Obsidian. Nothing happens to them in the webapp.
- [ ] D4. Revive the removed monster in the webapp. It comes back in Obsidian.
- [ ] D5. Reconnect. The dead monster is not added back to Obsidian.

## Sitting E: New encounter and closing (≈ 5 min)

**Before you start:** connected, players and monsters in IT.
- [ ] E1. Open a monster's statblock in Obsidian and close it. The bridge stays connected.
- [ ] E2. Click **New encounter** in IT. A message says the bridge disconnected. The old monsters do not die in the webapp.
- [ ] E3. Add new monsters in Obsidian, connect with **Create new tracker**. In the webapp the players show under their webapp names.
- [ ] E4. Change a player's HP and AC in the webapp. Obsidian follows.
- [ ] E5. A player whose Obsidian name doesn't match a caravan character gets a message naming them, and stays in Obsidian only.
- [ ] E6. Open the tracker from E3 in the webapp as DM. You get DM view, hidden monsters included.
- [ ] E7. Close the IT pane. The bridge disconnects after about 1.5 seconds.

## Sitting F: Webapp quick checks from 27-09-2026 (≈ 3 min)

Webapp fixes released with 0.5.0. They belong to the webapp, but were only listed here.
- [ ] F1. Developer → Tech Tree → **Clear**. No crash.
- [ ] F2. Profile → open a saved entry. No crash, and the translate button works.
- [ ] F3. Open a campaign and switch caravans quickly. Daily orders don't crash while loading.
- [ ] F4. Rename a caravan to a name under 3 characters. You get a clear message, not a generic error.
