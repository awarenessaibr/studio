# History

How the project arrived at its current shape, and where the original plans
still live. Dates come from the files in `_dev/`; the phases are marked in
the code and match `_dev/improvements-30-10-26.md`.

---

## 1. Timeline of the work

### Phase 0 — LayerStudio and the animation agent
The core is a from-scratch layered-image editor (`_.js` + `_.css`) built
around PNG cut-outs. A generator (`composition-generator.js`) turned a folder
of segments into a composition, and an **agent protocol** let a model set
presets by id. The plan for this phase is
`_dev/done/01-layers-implementation.md`; the task list the coding agent
followed is `_dev/done/AGENT.md`, and what actually differed is recorded in
`_dev/done/AGENT_DEVIATIONS.md`.

### Phase 1 — text layers
`studio-core.js` was introduced as the shared schema + layout module, with
one typesetter (`layoutText`) for DOM, canvas and SVG, and one resolver
(`resolveLayer`). Text layers gained a font model where size is a percentage
of the format height.

### Phase 2 — formats
A composition became multi-format: a master plus channel-specific formats,
with per-format `layerOverrides`, pinning (`M` badge) and the contact sheet.
The batch export (`All formats (ZIP)`) came with it.

### Phase 3 — variables and the brand kit
Typed template slots (`text`, `color`, `url`, `image`), layer bindings, locale
variants, and a non-blocking brand-drift report. At this point a composition
*is* a template when it has variables and a binding.

### Phase 4 — safe zones, guardrails, shared kits, briefs
Channel-derived safe zones (editor-only guide), an opt-in rules engine that
can refuse exports, shared brand kits with a local snapshot fallback, and
brief ingestion (CSV/XLSX → N creatives) in both the studio and the CLI.

### Phase 5 — import pipeline and character rigs
- `server.js` (zero-dependency Node) added **Import ZIP + image**: extracts
  segments, builds one layer per cut-out, aligns to the final image, saves
  and autosaves. Repository compositions can be copied into editable imports.
- A **local vision director** (Ollama) proposes four animation sets from the
  final image, the layer inventory and optional story context.
- **Character rigs**: detection from names/geometry, a v2 eyes/mouth rig and
  then the **v3 full cut-out rig** (18 parts, expressions, blink, gaze,
  breathing, head sway, 13-viseme lip-sync, saved performances). The `beards`
  import is the reference implementation.
- **Segment organisation**: a vision model proposes readable names/groups/
  roles, reviewed before applying; grouped ZIP download.

### Phase 6 — brand packs and final assets
- `brand-pack.js` + `brand-docx.js`: a brand-kit ZIP becomes a group of
  identities with a Word guide read into structured guidelines, shared kits,
  palette-role inference and seven starter templates.
- `asset-studio.html` + `asset-studio/`: a focused final-asset surface with
  five brand groups, six categories, 25 designs, live brand theming, the
  identity drawer, saved assets, full-resolution PNG and a CMYK print pack.
- Uploaded fonts, studio-v2's minimal toolbar, and the per-brand copy/type
  profiles (Monteleone, Cawley, KitchenOS, Okja) followed.

### Phase 7 — the next 25 assets
Driven by the expansion spec in `_dev/specs/` (the spreadsheet's Roadmap,
Sizes and Notes sheets). Asset Studio grew from **6 categories / 25 designs**
to **11 categories / 50 designs**: signage and posters (5), four more menus
including a tabular wine list, guest and hotel cards (4), stationery (2),
packaging and merch (4, die-cut), four more social designs including a
carousel, and compliance (allergen matrix, thermal prep label).

That wave added engine capabilities rather than one-off layouts: die-cut
shapes with a transparent PNG and a vector cut line, tabular copy blocks
(wine list, 14-allergen grid, stamp grid), per-design size presets and
export profiles (print / screen / thermal), large-format dpi defaults,
multi-slide rendering and numbered slide export.

---

## 2. Deliberate deviations from the original plans

These were choices, not accidents. The full logs are in `_dev/done/`.

| Plan | Shipped | Why |
|---|---|---|
| Patch `studio.html` in place | `studio.html` frozen, all new UI in `studio-v2.html` | The page had drifted; a new page was safer than patching a live one |
| `POST /api/imports/:id/fonts` (per project) | `POST /api/fonts`, global registry | One upload serves every project |
| Playwright + `pixelmatch` fixtures | A custom Chromium harness + a three-way visual corpus (`tests/visual.js`) | No dependencies; the corpus compares DOM, canvas and SVG |
| Batch export `png \| gif \| video` | `png`, `gif`, `svg`, `video` | SVG is free once text has one layout |
| Feature flags opt-in | Flags exist and default **on** | Nothing was unsafe enough to gate |
| Reference layer at `z: -1000` | Reference at `z: 0`, segments from `z: 2` | Negative z rendered white holes between cut-outs |
| Numbered segment files as sprite frames | One layer per file | Segmentation archives contain distinct objects, not frames |
| Safe zones / guardrails / kits / briefs "not shipped" (early README) | All shipped in Phase 4 | The README lagged the code — corrected in this documentation pass |

`exportAgentSpec()` additionally returns the document (the plan had it only
download), so scripts and tests can read the spec.

---

## 3. What changed in the documentation/cleanup pass

- The README was **rebuilt** as a short entry point. Its unclosed `markdown`
  fence had swallowed the entire 1,170-line document, and several sections
  contradicted the code (no server, no safe zones, no guardrails, no briefs,
  an `agent-prompt.md` “to be created”, paths under `_dev/` that had moved).
- Documentation moved into `docs/`, one file per surface plus a capability
  catalogue.
- `agent-prompt.md` was updated to the real vocabulary: 19 presets, variable
  commands, formats, character presets, settings, shorthands.
- Removed: `studio-layers-project.md` (a stale 1,963-line directory dump),
  `studio-minimal/main-toolbar.html` (a dead 107-line copy of markup already
  inline in `studio-v2.html`), 23 `.DS_Store` files and Python `__pycache__`.
- Archived: `AGENT.md` and `AGENT_DEVIATIONS.md` moved to `_dev/done/`;
  screenshots moved to `_dev/screenshots/` (ignored).
- `data/imports/` was pruned of probe and duplicate copies (alignment probe,
  four older copies of one scene, older duplicates of two template projects,
  and seven brand-kit template test imports).
- `server.js` now serves `studio-v2.html` at `/` instead of the frozen page.
- The ~545-line inline script in `studio-v2.html` moved to `studio-v2.js`,
  and the segment tree now shares the engine's 19-preset vocabulary instead
  of a stale 10-preset copy.
- Added a scripts-only `package.json` (`npm test`, `npm run test:smoke`, …) —
  no dependencies.
- Test harnesses honour `PLAYWRIGHT_PATH` instead of hard-coding one machine
  path.

The current state is verified by 104 Node tests, 68 studio checks and 38
Asset Studio checks in Chromium, plus the visual corpus.

---

## 4. Where the old material lives

| Path | Contents |
|---|---|
| `_dev/done/01-layers-implementation.md` | The canonical Phase 0 patch plan |
| `_dev/done/00-layers-implementation.md` | The superseded first plan |
| `_dev/done/0-layers-project-info.md` | Background research |
| `_dev/done/01-model-reasoning.md` | Reasoning notes from the model phase |
| `_dev/done/AGENT.md` | The original coding-agent task list |
| `_dev/done/AGENT_DEVIATIONS.md` | Implementation log and post-plan additions |
| `_dev/done/0-review-…`, `02-studio-improvements-…` | Review and improvement plans |
| `_dev/done/studio-v2.md` | The v2 page brief |
| `_dev/improvements-30-10-26.md` | The text / formats / variables / guardrails plan |
| `_dev/alignment-professional-design-workflow.md` | How the design workflow maps to professional print practice |
| `_dev/comparison-30-10-26.md` | Before/after comparison |
| `_dev/screenshots/` | Demo screenshots for each phase (ignored by git) |

These are **reference only**; they are not maintained and may describe
features differently from the current code. Where they disagree with `docs/`,
the code and `docs/` win.
