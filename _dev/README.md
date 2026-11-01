# `_dev/` — research, plans and screenshots

This folder is the project's working memory. Nothing here is loaded by the
application. See [`docs/history.md`](../docs/history.md) for how it fits
together.

| Path | What it is |
|---|---|
| `improvements-30-10-26.md` | The text / formats / variables / guardrails plan |
| `alignment-professional-design-workflow.md` | How the studio maps to a professional print/design workflow |
| `comparison-30-10-26.md` | Before/after comparison of the studio work |
| `specs/` | Source briefs for expansions (the next-25 designs `.md` and `.xlsx`) |
| `done/` | Completed plans, research, the original agent task list and its implementation log |
| `screenshots/` | Demo screenshots per phase and per brand group (git-ignored) |
| `visual/` | Diff output from `tests/visual.js` (git-ignored, regenerated) |

## Conventions

- Documents in `done/` are **frozen history**. They describe the state at the
  time and may contradict the current code; `docs/` and the source win.
- Screenshots are produced by the test harnesses
  (`_dev/screenshots/studio-smoke.png`, `asset-studio-smoke.png`) or captured
  during review. They are ignored by git, so do not link to them from
  committed documents as if they were always present.
- New plans should be added as a dated `.md` at this level and moved to
  `done/` when complete.
