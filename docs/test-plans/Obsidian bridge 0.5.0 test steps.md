<!-- .AI_PROMPTING/Test plans/Obsidian bridge 0.5.0 test steps.md -->
<!-- v1 - 28-09-2026 - In-Obsidian test steps for Highway DnD Tools 0.5.0 and the 27-09 webapp fixes -->

# Obsidian bridge 0.5.0: test steps

## Preparation
1. In the DM's Obsidian, update **Highway DnD Tools** to **0.5.0** (BRAT, or copy `main.js`, `manifest.json` and `styles.css` from the GitHub release into `.obsidian/plugins/highway-dnd-tools/`), then reload Obsidian.
2. Settings → Community plugins shows 0.5.0.
3. In the webapp, do a hard refresh (Ctrl+F5).

## A. Reconnecting mid-combat next session (no duplicate players)
1. In the webapp, start a tracker with the player characters and a few monsters, roll initiative, play a round or two.
2. In Obsidian, connect the bridge to that tracker. Everyone appears once, in the same order as the webapp.
3. Close Obsidian completely and reopen it (simulates next week).
4. Open the Initiative Tracker and connect the bridge to the **same** tracker again.
   - Expected: nobody is added twice, in Obsidian or the webapp.
   - Expected: player HP and AC come through from the webapp.
5. Change a player's HP in the webapp: it updates in Obsidian within a second or two.

## B. New encounter with the players still in the Initiative Tracker
1. While connected, click **New encounter** in the Initiative Tracker (it keeps the players, removes the monsters).
   - Expected: a message says the bridge has disconnected from the old tracker.
2. Add new monsters in Obsidian, then connect the bridge with **Create new tracker**.
   - Expected: in the webapp the players show as proper player characters under their webapp names.
   - Expected: HP and AC sync when you change them in the webapp.
3. A player whose name in Obsidian doesn't match their caravan character gets a message naming them and stays in Obsidian only. Matching works on the full name, or on the first name alone when no one else shares it ("Ayla" ↔ "Ayla Moonwhisper").

## C. Bridge behaviour
1. Kill a monster in the webapp: in Obsidian it gets 0 HP and "Unconscious", and is skipped in the turn order.
2. Open a monster's statblock in Obsidian and close it: the bridge **stays** connected.
3. Close the Initiative Tracker pane itself: the bridge disconnects after about 1.5 seconds.
4. Create a tracker from Obsidian, then open it in the webapp as the DM: you get DM view there, including hidden monsters.
5. Turn order: advance the turn in the webapp, then in Obsidian. Both sides follow each other.

## D. Webapp checks
1. Developer → Tech Tree → **Clear**: no crash.
2. Profile → open a saved entry: no crash, and the translate button works.
3. Open a campaign and switch caravans quickly: the daily orders section doesn't crash while loading.
4. Rename a caravan with a name that is too short (under 3 characters): you get a clear message, not a generic error.

## If something goes wrong
Open Obsidian's developer console (Ctrl+Shift+I) and copy the lines starting with `[Bridge]`.
