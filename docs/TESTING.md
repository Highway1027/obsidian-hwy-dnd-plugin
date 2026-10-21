# Testing (Obsidian plugin)

**Blocking right now:** nothing. Everything below can wait for a convenient moment.

Hand tests Tim still has to do, in sittings (one topic, one go). Last update: 21-10-2026.

How to write a sitting (Tim, 15-10-2026: "concise, checklists with short bullet points, not novels"):
- One action per line, then what you should see. One short sentence each.
- Each sitting has a letter; steps are numbered per sitting (A1, A2 ...), so Tim can say "C3 failed". When needed add .1 (C5.1, C5.2).
- Lines name the exact side (Obsidian or webapp), button or pane to use.
- **A step you don't mention counts as passed.**
- What the sitting needs (plugin version, IT version, a tracker with players and monsters) goes in "Before you start".
- **Self-test first**: what the bridge does with IT and the webapp gets a step in the self-test (`src/selftest/BridgeSelfTest.ts`, step ids like the sittings). Hand sittings only hold what it can't check: an Obsidian restart, IT's own buttons and panes, the webapp's look, the DM's PC. Pure rules belong in `tests/` (`npm test`). Mark a step *assumed* when an earlier result covers it.
- When a release passes, remove its steps and add one dated line under Results.

**If something goes wrong:** open Obsidian's console (Ctrl+Shift+I) and copy the lines starting with `[Bridge]`.

## Results so far

- 21-10-2026: self-test built (on `develop`, not released). It checks old steps A1-A5, B1-B4, C1-C4, D1-D5 and E5 by itself.
- 21-10-2026 first run: 16 passed. C1 and A3 failed because the test's made-up "Ogg of the Cragmaw tribe" had the same name as the real character in the TEST campaign (a test bug, now renamed "Zorvath").
- 21-10-2026 second run: **18 passed, A5 skipped** (all bridge behaviour of 0.5.0/0.5.1 except player HP). A5 skipped because only a character's owner may change it, and no character in the TEST campaign is yours. Fixed: the test now uses one of your own characters when the campaign has one.
- 21-10-2026 third run (with Tim's "TEST - HP TESTER" in the TEST campaign): **19/19 passed**.

---

## Sitting B: Restart and IT's own buttons (≈ 5 min)

**Before you start:** a webapp tracker with players and monsters, connected in Obsidian.
- [ ] B1. Close Obsidian completely, reopen, connect to the same tracker. Nobody is added twice; player HP and AC came through. Change a player's HP in D&D Beyond: it shows in IT within a few seconds.
- [ ] B2. Open a monster's statblock in Obsidian and close it. The bridge stays connected.
- [ ] B3. Click **New encounter** in IT. A message says the bridge disconnected. The old monsters do not die in the webapp.
- [ ] B4. Add new monsters, connect with **Create new tracker**. Open it in the webapp as DM: DM view, hidden monsters included.
- [ ] B5. Close the IT pane. The bridge disconnects after about 1.5 seconds.

## Sitting D: Bridge button in the IT pane (≈ 5 min)

**Before you start:** a plugin build from `develop` with the IT pane button (not released yet; copied into the desktop vault). Reload the plugin. The IT pane open in the sidebar, with players and a monster.
- [ ] D1. Look at IT's top icon row, left of the eye icon. A red swords icon; hover says "Connect to the webapp".
- [ ] D2. Click it (first time today). The connect window opens. Connect to a tracker. The icon turns green.
- [ ] D3. Click the green icon. The Bridge Status panel opens on the right.
- [ ] D4. Disconnect, then click the red icon again. It reconnects straight away to the same tracker, with no window ("Bridge reconnected to ...").
- [ ] D5. Ctrl+P → "Share Initiative to Webapp". The last tracker is already selected, marked "(last used)". Click it again: it is deselected.
- [ ] D6. While connected, click **New encounter** in IT. A message stays with the button "Create a new webapp tracker for this encounter". Click it: a new tracker "Combat - ..." appears in the webapp, the icon is green.
- [ ] D7. Close the IT pane and open it again. The icon is still there (one, not two).
- [ ] D8. Press play in IT, then stop. The icon stays (IT redraws that row).

## Sitting C: The DM's PC (≈ 2 min, at the next session)

**Before you start:** the next plugin release is installed on the DM's PC.
- [ ] C1. Settings → Community plugins: Initiative Tracker is 13.0.17 or newer.
- [ ] C2. Connect and play a round. The order and turns match the webapp.

## Sitting D: Webapp quick checks from 27-09-2026 (≈ 3 min)

Webapp fixes released with 0.5.0. They belong to the webapp, but were only listed here.
- [ ] D1. Developer → Tech Tree → **Clear**. No crash.
- [ ] D2. Profile → open a saved entry. No crash, and the translate button works.
- [ ] D3. Open a campaign and switch caravans quickly. Daily orders don't crash while loading.
- [ ] D4. Rename a caravan to a name under 3 characters. You get a clear message, not a generic error.
