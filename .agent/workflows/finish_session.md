---
description: Finish the coding session by bumping the version and pushing changes to GitHub to trigger a release.
---

1. Check for uncommitted changes.
   - Run `git status --porcelain`.
   - If there are changes, ask the user if they want to commit them first. Ideally, the `version` command should be run on a clean working directory or one that only has the changes ready for release.

2. Ask the user for the version bump type.
   - "Should this be a patch (0.0.x), minor (0.x.0), or major (x.0.0) release?"

3. Run the npm version command.
   - Based on the user's choice, run one of the following:
     - `npm version patch`
     - `npm version minor`
     - `npm version major`
   - This command will automatically run the `version` script defined in `package.json`, which runs `version-bump.mjs` and adds `manifest.json` and `versions.json` to the commit.

4. Push the changes and tags.
   - Run `git push --follow-tags`
   - This pushes both the commit and the new version tag to GitHub, which triggers the `release.yml` workflow.

5. Confirm completion.
   - "Version bumped and pushed. The GitHub Action should now be building and releasing the new version."

..