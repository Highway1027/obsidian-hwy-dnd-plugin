---
name: plugin-wrap-up
description: End-of-session routine for the Highway DnD Tools Obsidian plugin - update STATUS, TESTING and SESSION_HISTORY, make sure the vault has the newest build, commit, give a kickstart prompt. Use when Tim says wrap up, finish, end the session, or before a long break.
---

# Plugin session wrap-up

1. **docs/STATUS.md**: remove finished items, add new open work, update the "Now" lines and the date. Keep it short; it is read at every session start.
2. **docs/SESSION_HISTORY.md**: add one entry at the top, `## DD-MM-YYYY - <topic>`, 3 to 6 bullets: what changed, decisions and why, gotchas, what was released. Delete entries older than about two months.
3. **docs/TESTING.md**: add every check this session could not do to a sitting (rules at its top; self-test steps first). Remove what Tim reported as passed and add a dated line under Results. Update "Blocking right now".
4. **Newest build in the vault**: if a sitting tests code that is not in a release, run `npm run vault` yourself. Its "Before you start" then only says what Tim checks or does (wording at the top of TESTING.md): which version and build he should see, and to restart Obsidian or update via BRAT. No agent commands in it.
5. **Inbox** (in STATUS): for ideas parked this session, ask Tim in one line each: plan it, keep it, or drop it.
6. **AGENTS.md**: only if a rule, command or file changed (file table). Procedures belong in skills.
7. **Skills**: if a skill was wrong this session, make sure it is fixed; if a routine repeated without a skill, propose one.
8. `git status`: remove or ignore stray files (logs, screenshots, the self-test note).
9. Commit on `develop` with a descriptive message and push (`git fetch` first, push only `HEAD`). No merge to `main` (that is `plugin-release`).
10. Tell Tim in two or three lines what is done, what is open, and what is not verified.
11. **Kickstart prompt**: when the next steps are clear, end with a short prompt Tim can paste into the next chat, in a fenced code block: what to check or decide first and what to build. A few lines; point to STATUS instead of repeating it. Skip it when the next step is unclear and say why.
