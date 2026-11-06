# Studio Layers change handoff

This bundle captures the current uncommitted changes from the `main` branch.
It contains a binary-capable Git patch (`changes.patch`) and full snapshots of
changed files under `files/`. The patch is the preferred way to incorporate
changes on another checkout because it can preserve unrelated edits there;
the snapshots are for reference or manual conflict resolution.

## Change overview

The working changes cover Asset Studio UI and documentation, brand identity/
brand-pack and publishing behavior, the studio agent page, and related tests.
The file list and patch below are authoritative for exact details.

## Changed paths at export

 M docs/asset-studio.md
 M docs/brand-packs.md
 M package.json
 M pages/asset-studio.html
 M pages/studio-agent.html
 M scripts/publish-brand-templates.js
 M server.js
 M src/client/asset-studio/app.css
 M src/client/asset-studio/app.js
 M src/client/brand/brand-identity.js
 M src/shared/brand-pack.js
 M tests/asset-studio.js
 M tests/brand.test.js
?? tests/agent-studio.js

## Applying on another server

1. Copy this folder to the other checkout and make a backup or commit its current work.
2. From the repository root, preview compatibility with `git apply --check /path/to/changes.patch`.
3. If applicable, apply with `git apply --3way /path/to/changes.patch`; review and resolve any conflicts, then run that repository's tests.
4. Do not copy `files/` over the other checkout wholesale. Use those snapshots only to compare or resolve conflicts, since they contain this server's complete versions of the changed files.

If the other server has diverged from the same Git base, the patch may need conflict resolution. `git apply --check` does not change files.
