# AGENT.md — Operational guide for the coding agent

Read this end-to-end before editing anything. The current state of the
repo is *intentional*: `_.js` is the **unpatched** LayerStudio source;
the patches needed to reach the target behavior live in
`_dev/01-layers-implementation.md`. Your job is to apply them, add the
missing pieces, generate the compositions, and verify the workflow.

---

## Mission

Deliver a working end-to-end pipeline that:

1. Takes any folder under `data/layered-images/segments*` and produces
   a `.composition.json` importable by `LayerStudio`.
2. Renders and exports that composition as MP4, GIF, SVG, and JSON
   **without regressions** to the existing editor features.
3. Exposes a documented agent protocol so a language model can emit
   animation commands and have them applied in one call.

You succeed when **all** acceptance criteria in §7 are true.

---

## Ground rules

1. **Do not delete or rewrite existing files.** `_.css` and `_.js` stay
   at their current paths. `_dev/` docs are reference — do not modify.
2. **All patches are additive.** Every code change either:
   - adds a new property to `makeLayer`'s return,
   - adds a new method to `LayerStudio`, or
   - replaces a small, clearly-identified block via FIND/REPLACE.
   If a change feels like it would rewrite a whole method, re-read
   `_dev/01-layers-implementation.md` — the patch is probably smaller
   than it looks.
3. **Keep source assets under `data/` unchanged.** Organize generated
   `.composition.json` files under
   `data/projects/<project>/compositions/`.
4. **No new dependencies.** No `npm install`, no CDN links, no
   polyfills. If something needs a library, use the browser.
5. **Style.** Match the surrounding code: 4-space indent, single quotes,
   semicolons, early returns. `_.js` uses `'use strict'` at IIFE top —
   keep it.
6. **Test in a real browser before declaring victory.** Node unit tests
   are not required; manual verification is required. Screenshot or
   describe the observed result.

---

## Inventory of what exists

| File                                      | State       | Action                    |
|-------------------------------------------|-------------|---------------------------|
| `_.css`                                   | complete    | Append §12 CSS            |
| `_.js`                                    | unpatched   | Apply §§ 1–11             |
| `_dev/0-layers-project-info.md`           | reference   | Do not edit               |
| `_dev/00-layers-implementation.md`        | superseded  | Do not edit               |
| `_dev/01-layers-implementation.md`        | **canonical** | Do not edit             |
| `data/layered-images/segments*/`          | source      | Read-only input           |
| `data/video/*.mp4`                        | reference   | Reference only            |
| `data/hero-images/`, `data/hardcover-books/` | reference | Out of scope            |

Missing (you will create):

| File                       | Purpose                                 |
|----------------------------|-----------------------------------------|
| `studio.html`              | HTML scaffold — see §4                  |
| `composition-generator.js` | CLI generator — copy verbatim from `_dev/01-layers-implementation.md § 13` |
| `agent-prompt.md`          | Agent system prompt — copy verbatim from `_dev/01-layers-implementation.md § 14` |
| `README.md`                | Already provided                        |

---

## Tasks

Execute in order. Each task has a **Done when** criterion — do not
proceed until it is true.

### Task 1 — Patch `_.js` (sections 1–11)

Open `_dev/01-layers-implementation.md`. Apply each of sections **1
through 11** to `_.js`. Each section is written as a FIND / REPLACE block
or an INSERT-AT marker. Read carefully; the anchor strings are exact.

Order matters — some inserts reference methods created by earlier
sections.

**Done when:**

- `grep -n "spriteFps" _.js` returns ≥ 3 hits.
- `grep -n "_spriteState" _.js` returns 2 hits (definition + call).
- `grep -n "applyPreset" _.js` returns ≥ 3 hits.
- `grep -n "exportAgentSpec" _.js` returns ≥ 2 hits.
- `grep -n "case 'export-agent-spec'" _.js` returns 1 hit.

### Task 2 — Append CSS (section 12)

Append the CSS from `_dev/01-layers-implementation.md § 12` to the end of
`_.css`. Do not modify existing rules.

**Done when:**

- `.layer-preset-grid` appears in `_.css`.
- `.layer-sprite-info` appears in `_.css`.

### Task 3 — Create `studio.html`

Use the scaffold in §4 of this file. Every `id` and `data-action` the JS
queries must be present. The `<i class="fas fa-…">` icons use
Font Awesome; add the CDN link if you want the icons to render, or
substitute plain text glyphs (`‹`, `›`).

**Done when:**

- Opening `studio.html` in a browser shows a three-column layout.
- The browser console has zero JavaScript errors.
- Clicking **Add images** opens a file picker.
- `window.layerStudioShowView()` in the console reveals the view.

### Task 4 — Create `composition-generator.js`

Copy verbatim from `_dev/01-layers-implementation.md § 13`. Save at the
project root. Do **not** modify the script — it is already hardened
(pure-Node PNG/JPEG/GIF header parsing, no `canvas` dependency).

**Done when:**

- `node composition-generator.js --help`-equivalent (missing folder) prints the usage line and exits non-zero.
- `node composition-generator.js "data/layered-images/segments" "Scene 1 — Desert Woman" --reference atacama.png` produces a `.composition.json` with > 50 layers.

### Task 5 — Generate all scene compositions

Run the generator once per folder in the map from `README.md`. Skip
`segments (1)` (duplicate of `segments`).

```bash
node composition-generator.js "data/layered-images/segments"       "Scene 1 — Desert Woman"      --reference atacama.png --out "data/projects/Giovanni-Senza-Paura/compositions/scene-1-desert-woman.composition.json"
node composition-generator.js "data/layered-images/segments (2)"   "Scene 3 — Old Man Room"      --out "data/projects/Giovanni-Senza-Paura/compositions/scene-3-old-man-room.composition.json"
node composition-generator.js "data/layered-images/segments (3)"   "Scene 4 — Fairy Forest"      --out "data/projects/Giovanni-Senza-Paura/compositions/scene-4-fairy-forest.composition.json"
node composition-generator.js "data/layered-images/segments (4)"   "Scene 5 — Castle Approach"   --out "data/projects/Giovanni-Senza-Paura/compositions/scene-5-castle-approach.composition.json"
node composition-generator.js "data/layered-images/segments (5)"   "Scene 6 — Lake"              --out "data/projects/Giovanni-Senza-Paura/compositions/scene-6-lake.composition.json"
node composition-generator.js "data/layered-images/segments (6)"   "Scene 1b — Desert Woman 2"   --reference atacama.png --out "data/projects/Giovanni-Senza-Paura/compositions/scene-1b-desert-woman-2.composition.json"
node composition-generator.js "data/layered-images/segments (7)"   "Scene 8 — Night Forest"      --out "data/projects/Giovanni-Senza-Paura/compositions/scene-8-night-forest.composition.json"
```

**Done when:**

- Seven `.composition.json` files exist in
  `data/projects/Giovanni-Senza-Paura/compositions/`.
- Each parses with `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`.
- Scene 1 reports at least one sprite group (`bare-feet` or `woman-in-water`).

### Task 6 — Create `agent-prompt.md`

Copy the content of `_dev/01-layers-implementation.md § 14` verbatim.
This is the system prompt a language model receives.

**Done when:**

- The file contains the phrase `layer-studio/agent/v1`.
- The preset vocabulary table is present.

### Task 7 — Browser smoke test

Serve the folder:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/studio.html`. Then:

1. Choose **Giovanni Senza Paura** in the Project dropdown, then choose
   **Scene 1 — Desert Woman** in the Composition dropdown.
2. Confirm the layer list populates with > 50 entries.
3. Click **Export agent spec** → JSON downloads.
4. Select the woman layer → click **Breathe** preset → click **Play**
   → observe a subtle scale pulse.
5. Select a sprite layer (e.g. `bare-feet`) → confirm the image cycles
   during playback.
6. Click **Export GIF** → download a `.gif` → open it → it animates.
7. Select `atacama` layer → click **Use as final image and align layers**
   → watch the status bar report a match count.

**Done when:** all seven steps succeed without console errors.

### Task 8 — Agent protocol round-trip

Export the agent spec from a scene. Paste it into Claude with the content
of `agent-prompt.md` as the system prompt. Give a task like:

> 10-second dreamy shot; woman walks slowly left-to-right; leaves sway.

Claude should return `{"commands":[…]}`. Back in the browser console:

```js
window.layerStudio.applyAgentCommands(<paste-commands-json>);
```

**Done when:**

- The status bar reports the applied command count.
- Playing the composition shows walking + swaying motion.
- No console errors.

### Task 9 — Document any deviations

If any patch in `_dev/01-layers-implementation.md` fails to apply cleanly
because the anchor string differs from what you observed in `_.js`, do
**not** modify the implementation doc. Instead:

1. Apply the fix manually.
2. Record the deviation in a new file `AGENT_DEVIATIONS.md` at the
   project root with a short note: section number, what differed, what
   you did, and why.

This keeps the canonical doc intact for future readers while capturing
what actually happened.

---