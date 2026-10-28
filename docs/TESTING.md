# Obsidian plugin testing

Blocking right now: nothing. Sitting K is ready (0.8.0 released, webapp live 23-10-2026).

Automated checks: npm test (pure rules in tests/) and the bridge self-test in Obsidian
(Ctrl+P > "Run bridge self-test (test campaign)", src/selftest/BridgeSelfTest.ts).
Rules: last section.

If something goes wrong: open Obsidian's console (Ctrl+Shift+I) and copy the lines
starting with [Bridge].

---

## Sitting K: DM tie order (about 10 min)

Before you start:
- Community plugins shows Highway DnD Tools 0.8.0. If not: BRAT > update, restart Obsidian.
- IT connected to a webapp tracker in a TEST campaign (not Ark van Noah), with 2 players
  and 3 monsters, initiatives rolled.

- [ ] K1 Obsidian: Ctrl+P > "Run bridge self-test (test campaign)".
      -> All steps pass (R5-R7 are new).

- [ ] K2 Make a tie in IT:
      K2.1 Type a monster's initiative equal to a player's.
      K2.2 Drag the monster above the player.
      -> Webapp: the monster is above the player, and it stays.

- [ ] K3 IT: drag a player between two monsters with another initiative.
      -> Webapp: the player is there, with the initiative IT shows.

- [ ] K4 Webapp: add a monster with the K2 initiative.
      -> Both sides: it goes below the tie you made.

- [ ] K5 Start combat. IT: drag a creature from below the active one to above it.
      -> Both sides: the turn stays on the same creature.

- [ ] K6 Webapp only: in a tie group, drag to reorder, click Accept. Reload the page.
      -> Your order holds.

- [ ] K7 Webapp: gear > sort debugger.
      -> The "DM Order" column shows 1, 2 ... for the ordered ties.

## Results so far

- 21-10-2026: self-test built (on `develop`, not released). It checks old steps A1-A5, B1-B4, C1-C4, D1-D5 and E5 by itself.
- 21-10-2026 first run: 16 passed. C1 and A3 failed because the test's made-up "Ogg of the Cragmaw tribe" had the same name as the real character in the TEST campaign (a test bug, now renamed "Zorvath").
- 21-10-2026 second run: **18 passed, A5 skipped** (all bridge behaviour of 0.5.0/0.5.1 except player HP). A5 skipped because only a character's owner may change it, and no character in the TEST campaign is yours. Fixed: the test now uses one of your own characters when the campaign has one.
- 21-10-2026 third run (with Tim's "TEST - HP TESTER" in the TEST campaign): **19/19 passed**.
- 21-10-2026: sittings B (restart, IT's own buttons), C (DM's PC) and E (bridge button in the IT pane) passed. Feedback: after New encounter the players stayed in IT. Now removed.
- 21-10-2026: sitting F passed (New encounter removes the players).
- 21-10-2026: sitting G passed (New encounter creates a webapp tracker by itself). Feedback: a player removed in IT by accident stays gone from IT. Now added back (sitting H).
- 21-10-2026: sitting H passed. Feedback: the player added back had no HP in IT. Fixed (sitting I).
- 21-10-2026: sitting I passed (0.6.0: a player added back keeps HP, max HP and AC).
- 21-10-2026: sitting D (webapp crash checks from 27-09-2026) dropped: no such crashes seen since.
- 21-10-2026: sitting J on the 16:44 build: self-test 23 passed, A5 skipped (test character deleted). J2 failed: a drag in IT was only seen at the next turn. Fixed in 0.7.0 (bridge watches IT's store); J redone below.
- 22-10-2026: J1 and J2 passed on 0.7.0. Edge case: very fast drags one after another can still break sync. Feedback: a DM drag inside a tie the webapp already resolved should be kept and remembered, also when a new combatant with that initiative joins.
- 22-10-2026: J3 and J4 passed (offline notice, HP sent again after wifi back). Sitting J and 0.7.0 done.

## How this file works

Same rules in every project (source: testing-format.md in Tim's ai-setup repo).

- Automated first: unit tests and the self-test check what a script can. This file
  holds only what they cannot: the look, real clicks and keys, a second player or
  device, real AI text, live data.
- "Blocking right now" names only a test whose result changes the next step.
- A sitting is one topic Tim can test in one go, with an estimated time.
- Each sitting takes the next letter (after Z start at A again). Steps use that letter:
  D1, D2, sub-steps D2.1. A big sitting can have parts; each part takes the next letter.
- "Before you start" holds only what Tim must do or check, and how he sees he has the
  right build (which version, shown where). The agent builds, installs and deploys
  beforehand; if it could not, the sitting says what Tim must do instead.
- When a self-test or scenario covers part of a sitting, the first step runs it and
  says which result to expect.
- One action per line, then what you should see on its own line, starting with "-> ".
- Name the exact button, menu, page or test tool.
- Plain text in steps: no bold, italics or backticks. A blank line between steps.
  Sub-steps on their own lines, indented under the step. Lines under about 90 characters.
- A step earlier results make quite safe says "(assumed, based on <result>)": a glance.
- Set-up a step needs (items, objects, sample data) comes from a test tool the build
  adds, never from Tim spawning it by hand.
- Each time a sitting is added or changed, re-read the whole file: one self-test run
  per session of sittings, sittings that share a set-up merged, steps in the order Tim
  walks through them.
- Tim reports by id ("D3 failed"). A step he does not mention counts as passed.
- Passed steps are removed, with one dated line under "Results so far" (newest first).
  When that list gets long, older lines move to TESTING_HISTORY.md.

This project:
- Lines name the exact side (Obsidian, IT or webapp), button or pane to use.
- Right build in "Before you start". Release: "Community plugins shows Highway DnD Tools
  <version>. If not: BRAT > update, restart Obsidian." Unreleased build: "Community plugins
  shows <version>; restart Obsidian to load the build of DD-MM-YYYY HH:MM."
- npm run vault and deploys are agent steps and never appear in a sitting.
