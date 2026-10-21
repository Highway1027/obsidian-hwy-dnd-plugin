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
- 21-10-2026: sittings B (restart, IT's own buttons), C (DM's PC) and E (bridge button in the IT pane) passed. Feedback: after New encounter the players stayed in IT. Now removed (sitting F).

---

## Sitting F: New encounter removes the players (≈ 3 min)

**Before you start:** a plugin build from `develop` (copied into the desktop vault, plugin reloaded). IT connected to a tracker with players and monsters.
- [ ] F1. Click **New encounter** in IT. IT is empty: no monsters, no players.
- [ ] F2. Add a monster in IT, click "Create a new webapp tracker for this encounter". The new tracker has only that monster.
- [ ] F3. In the webapp, add the adventuring party to that tracker. The players show up in IT with their first names, within a few seconds. Nobody twice.

## Sitting D: Webapp quick checks from 27-09-2026 (≈ 3 min)

Webapp fixes released with 0.5.0. They belong to the webapp, but were only listed here.
- [ ] D1. Developer → Tech Tree → **Clear**. No crash.
- [ ] D2. Profile → open a saved entry. No crash, and the translate button works.
- [ ] D3. Open a campaign and switch caravans quickly. Daily orders don't crash while loading.
- [ ] D4. Rename a caravan to a name under 3 characters. You get a clear message, not a generic error.
