---
name: plugin-release
description: Release a new version of the Highway DnD Tools Obsidian plugin - tests and build, npm version bump, merge to main so GitHub publishes the release, and the test steps for Tim. Use when Tim asks to release or ship the Obsidian plugin.
---

# Plugin release

Only with Tim's OK. If git refuses with "dubious ownership", use `git -c safe.directory=<this folder>`.

1. **Clean tree**: `git status --porcelain` must be empty (commit or ask first).
2. **Checks**: `npm test` and `npm run build` must pass.
3. **Version** on `develop`: `npm version patch|minor|major` (ask Tim which), or an explicit `npm version 0.5.2`. This runs `version-bump.mjs`, updates `package.json`, `manifest.json` and `versions.json`, commits and tags (tags have no `v`, e.g. `0.5.1`). Check first that `package.json` and `manifest.json` show the same version; before 0.5.1 `package.json` lagged (0.1.9), so `patch` would have made 0.1.10.
4. **Release**: merge `develop` into `main` (`git merge --no-ff develop -m "Release <version>"`), then `git push --follow-tags origin develop main`. The workflow runs because `manifest.json` changed on `main`. Check: `gh run list --limit 1`, then `gh release view <version>`.
5. **Tell Tim** how to update: BRAT, or copy `main.js`, `manifest.json`, `styles.css` from the release into `.obsidian/plugins/highway-dnd-tools/` and reload Obsidian. Add or update the in-Obsidian test steps in `docs/test-plans/`.
6. Update `docs/STATUS.md` and the history.
