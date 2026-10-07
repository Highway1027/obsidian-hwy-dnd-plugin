Everything is live: plugin 0.5.0 is released on GitHub, and the webapp fixes are in production.

**1. Plugin release:** yes, a new `manifest.json` version is what triggers the release. I set it to 0.5.0, pushed to `develop` and `main`, and the workflow published release 0.5.0 with `main.js`, `manifest.json` and `styles.css`.

**2. What "not permitted" meant:** it was your local copy, `D:\Webapps\obsidian-hwy-dnd-plugin`. Claude Code's built-in safety check blocked me from changing that folder's git state, so I left it alone. I never tried to change the Initiative Tracker repository; I only read a copy of it to check what it does. Your local folder is still the old 0.2.5 from December. Want me to update it to match GitHub (0.5.0 now)? Say so and I'll do it. Or run this yourself in that folder:
`git -c safe.directory=D:/Webapps/obsidian-hwy-dnd-plugin pull --ff-only`

**3. Webapp:** committed on `develop`, merged into `main` and deployed. I confirmed the live site serves the new build (commit `cb9954f`).

## Test steps for tomorrow

**Preparation**
1. In the DM's Obsidian, update Highway DnD Tools to **0.5.0**. Use your usual update route (BRAT, or copy `main.js`, `manifest.json` and `styles.css` from the GitHub release into `.obsidian/plugins/highway-dnd-tools/`). Then reload Obsidian.
2. Check under Settings → Community plugins that it shows 0.5.0.
3. In the webapp, do a hard refresh (Ctrl+F5).

**A. Reconnecting mid-combat next session (no duplicate players)**
1. In the webapp, start a tracker with the player characters and a few monsters, roll initiative, and play a round or two.
2. In Obsidian, connect the bridge to that tracker. Check that everyone appears once, in the same order as the webapp.
3. Close Obsidian completely and reopen it, to simulate next week.
4. Open the Initiative Tracker and connect the bridge to the **same** tracker again.
   - Expected: nobody is added twice, in either Obsidian or the webapp.
   - Expected: player HP and AC come through from the webapp.
5. Change a player's HP in the webapp. It should update in Obsidian within a second or two.

**B. New encounter with the players still in the Initiative Tracker**
1. While connected, click **New encounter** in the Initiative Tracker. It keeps the players and removes the monsters.
   - Expected: a message says the bridge has disconnected from the old tracker.
2. Add new monsters in Obsidian, then connect the bridge with **Create new tracker**.
   - Expected: in the webapp, the players show as proper player characters under their webapp names.
   - Expected: HP and AC sync when you change them in the webapp.
3. If a player's name in Obsidian doesn't match their caravan character, a message names them. They stay in Obsidian only. Matching works on the full name, or on the first name alone when no one else shares it ("Ayla" matches "Ayla Moonwhisper").

**C. Bridge behaviour**
1. Kill a monster in the webapp. In Obsidian it should get 0 HP and "Unconscious", and be skipped in the turn order.
2. Open a monster's statblock in Obsidian, then close it. The bridge should **stay** connected; before this fix, closing it disconnected the bridge.
3. Close the Initiative Tracker pane itself. The bridge should disconnect after about a second and a half.
4. Create a tracker from Obsidian, then open it in the webapp as the DM. You should get DM view there, including hidden monsters.
5. Turn order: advance the turn in the webapp, then in Obsidian. Both sides should follow each other.

**D. Webapp crash fixes (quick checks)**
1. Developer → Tech Tree → **Clear**: no crash.
2. Profile → open a saved entry: no crash, and the translate button works.
3. Open a campaign and switch caravans quickly. The daily orders section shouldn't crash while it loads.

If something goes wrong, the bridge logs every step to Obsidian's developer console (Ctrl+Shift+I, lines starting with `[Bridge]`). Copy those lines to me and I can pinpoint it.