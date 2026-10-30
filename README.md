
## 1. `README.md`

```markdown
# studio-layers

A 2D layered-image animation studio that turns folder trees of PNG cutouts
into animated MP4 / GIF / SVG / JSON scenes — with an agent-facing protocol
so a language model can drive the animation layer.

---

## What this project is

`studio-layers` is a **static, zero-build** web application. Open the HTML
file in a browser; it loads `_.css` and `_.js`. There is no bundler, no
`package.json`, no server. Assets are encoded as data URLs at import time
so the whole app works from `file://` (with one caveat noted below).

The pipeline it implements:

```
 segments/  ──►  composition-generator.js  ──►  *.composition.json
                                                        │
                                                        ▼
                                           LayerStudio (browser)
                                              │
                       ┌──────────────────────┼──────────────────────┐
                       ▼                      ▼                      ▼
                 Auto-align           Preset library          Agent API
                 (template            (breathe, walk,         (applyAgentCommands)
                  matching)            sway, …)
                       │                      │                      │
                       └──────────────────────┼──────────────────────┘
                                              ▼
                                    Export: MP4 / GIF / SVG / JSON
```

The **generator** classifies each PNG by filename, assigns a semantic
`role`, groups numbered variants into sprite-frame sequences, and lays out
an initial composition. **LayerStudio** refines positions (including a
template-matcher that projects layers onto a final reference image), applies
animation presets or agent-emitted commands, and exports the result.

---

## Inventory

```
studio-layers/
├── _.css                  ← LayerStudio styles (present)
├── _.js                   ← LayerStudio source (present, UNPATCHED — see Tasks)
├── studio.html            ← NEW — reference HTML scaffold (to be created)
├── composition-generator.js  ← NEW — CLI generator (to be created)
├── agent-prompt.md        ← NEW — agent system prompt (to be created)
├── README.md              ← this file
├── AGENT.md               ← operational guide for the coding agent
│
├── _dev/
│   ├── 0-layers-project-info.md      ← background research (reference only)
│   ├── 00-layers-implementation.md   ← first plan (superseded)
│   └── 01-layers-implementation.md   ← CURRENT plan — all patches live here
│
└── data/
    ├── layered-images/
    │   ├── segments/       ← Scene 1 — Desert Woman (reference: atacama.png)
    │   ├── segments (1)/   ← duplicate of segments — skip
    │   ├── segments (2)/   ← Scene 3 — Old Man Room
    │   ├── segments (3)/   ← Scene 4 — Fairy Forest
    │   ├── segments (4)/   ← Scene 5 — Castle Approach
    │   ├── segments (5)/   ← Scene 6 — Lake
    │   ├── segments (6)/   ← Scene 1b — Desert Woman v2
    │   └── segments (7)/   ← Scene 8 — Night Forest
    ├── video/              ← 3 reference MP4s (Grok-generated) — not consumed by the app
    ├── hero-images/        ← JPGs — not consumed by this pipeline
    ├── hardcover-books/    ← Book covers — not consumed by this pipeline
    └── projects/
        └── Giovanni-Senza-Paura/
            └── compositions/ ← selectable scene compositions
```

The generator consumes `data/layered-images/segments*`. The backend discovers
repository compositions under `data/projects/<project>/compositions/` and
saved ZIP imports under `data/imports/`.

---

## Scene → folder map

| Folder           | Suggested scene name      | Reference image             |
|------------------|---------------------------|-----------------------------|
| `segments`       | Scene 1 — Desert Woman    | `atacama.png`               |
| `segments (1)`   | *duplicate — skip*        |                             |
| `segments (2)`   | Scene 3 — Old Man Room    | `wooden-floor.png`          |
| `segments (3)`   | Scene 4 — Fairy Forest    | `sky.png`                   |
| `segments (4)`   | Scene 5 — Castle Approach | `sky.png`                   |
| `segments (5)`   | Scene 6 — Lake            | `blue-lake.png`             |
| `segments (6)`   | Scene 1b — Desert Woman 2 | `atacama.png`               |
| `segments (7)`   | Scene 8 — Night Forest    | `misty-forest-background.png` |

The generator auto-detects the reference by filename pattern
(`atacama|reference|assembled|final`) or falls back to the largest-area
image. Override with `--reference <file>`.

---

## The data model

Every layer is a JSON object. The schema is defined in
`_dev/01-layers-implementation.md § 1`. Fields that matter most:

| Field       | Type    | Meaning                                                       |
|-------------|---------|---------------------------------------------------------------|
| `id`        | string  | Stable, unique across the composition                         |
| `name`      | string  | Human label (usually the filename stem)                       |
| `role`      | enum    | `background \| ground \| character \| character-part \| prop \| effect` |
| `url`       | string  | Data URL or `http(s)://` — the first frame                    |
| `frames`    | string[]| Data URLs — if >1 this is a sprite (animated at `spriteFps`)  |
| `spriteFps` | int     | 1–30                                                          |
| `spriteMode`| enum    | `loop \| pingpong \| once`                                    |
| `x,y,w,h`   | float   | Percent of canvas — (0,0) is top-left                         |
| `opacity`   | float   | 0–1                                                           |
| `rotation`  | float   | Degrees, -3600..3600                                          |
| `z`         | int     | Draw order — higher is on top                                 |
| `fit`       | enum    | `contain \| cover`                                            |
| `keyframes` | array   | Each `{ time, x, y, w, h, rotation, opacity }` in ms          |

A **composition** wraps layers with `{ version, id, name, width, height, duration, referenceLayerId, layers }`.

---

## Running it

### Generate a composition

```bash
node composition-generator.js "data/layered-images/segments" \
    "Scene 1 — Desert Woman" \
    --reference atacama.png
```

Output defaults to `<scene-id>.composition.json` in the current directory.
For a composition to appear in the project dropdown, save it under that
project's `compositions/` directory, for example:

```bash
node composition-generator.js "data/layered-images/segments" \
    "Scene 1 — Desert Woman" \
    --reference atacama.png \
    --out "data/projects/Giovanni-Senza-Paura/compositions/scene-1-desert-woman.composition.json"
```

Repeat for each scene folder (see map above).

### Open in the browser

1. Open `studio.html` in Chrome, Safari, or Firefox.
2. Start `node server.js` and open `http://127.0.0.1:8008/studio.html` to use
   the project and composition selectors.
3. Choose a project, then choose one of its compositions. Repository
   compositions live in `data/projects/<project>/compositions/`; saved ZIP
   imports are also available in the project selector.
4. Or click **Add folder** → select `data/layered-images/segments`, or import a
   generated `.composition.json` using the file picker.
5. Select a layer → adjust → apply a preset → **Play**.
6. Export a PNG with **Export PNG** to render all composition layers while
   excluding the final-image reference. Other exports include **Video**,
   **GIF**, **JSON**, **SVG**, and **Agent spec**.

### The one browser caveat

Template matching (`alignToReference`) and video export need to read
pixels back from the canvas. Browsers block this for `file://`-loaded
images. **Serve the folder over HTTP** for those features:

```bash
python3 -m http.server 8000
# open http://localhost:8000/studio.html
```

Plain drag, resize, keyframes, sprite playback, JSON/SVG export, and GIF
export all work from `file://`. Video export and auto-align require HTTP
(or an extension that relaxes CORS).

---

## The agent protocol

`LayerStudio.exportAgentSpec()` produces a JSON document with
`schema: "layer-studio/agent/v1"` that describes:

- Every layer with its `id`, `role`, `z`, bounding box, and whether it
  is a sprite.
- The `presetVocabulary` — the complete list of presets the model may use.

The agent's job is to return `{ "commands": [...] }`, where each command
references a `layerId` and a `preset` (plus optional `params`).
`LayerStudio.applyAgentCommands(commands)` applies them in one pass.

`agent-prompt.md` (to be created — see Tasks) contains the system prompt
that teaches the model the vocabulary and the rules. `_dev/01-layers-implementation.md § 14`
has the current draft.

---

## Non-goals

- Not a runtime engine — no `<canvas>` game loop in the output.
- Not an editor for the `_dev/` docs — those are read-only reference.
- Not a package — no `npm install`. Everything is either browser-native
  or stdlib Node.

---

## Where to look

| Question                                | File                                    |
|-----------------------------------------|-----------------------------------------|
| What's the implementation plan?         | `_dev/01-layers-implementation.md`       |
| What did we try first?                  | `_dev/00-layers-implementation.md`       |
| What's the background research?         | `_dev/0-layers-project-info.md`          |
| How do I patch `_.js`?                  | `_dev/01-layers-implementation.md §§ 1–12` |
| How do I run the generator?             | `_dev/01-layers-implementation.md § 13`  |
| What does the agent prompt look like?   | `_dev/01-layers-implementation.md § 14`  |
| What tasks remain?                      | `AGENT.md`                              |

---

## Importing a segmented ZIP + final image

The repository now ships with `server.js`, a **zero-dependency Node backend**
that stores imported ZIP projects and exposes them to the studio. The HTML
app still works as a static file, but ZIP import and server-side saving need
this backend:

```bash
node server.js
# open http://127.0.0.1:8008/studio.html
# PORT=8010 node server.js   # if 8008 is taken
```

The import flow:

1. Click **Import ZIP + image** in the layer sidebar.
2. Choose the ZIP that contains the cut-out segments and the final assembled
   image, then give the composition a name.
3. The backend extracts the archive and stores it under
   `data/imports/<project-id>/`; the final image is added as a locked
   reference/background layer.
4. Every image in the ZIP becomes its own layer. Numbered files such as
   `swans/swans-1.png` … `swans/swans-10.png` are treated as **separate
   objects**, not animation frames, because that is what a segmentation
   archive contains. (Sprite-frame playback still exists for older
   compositions that already have multi-frame layers.)
5. Alignment runs automatically against the final image. Exact matches are
   marked confirmed; ambiguous matches use the best candidate and stay
   flagged (`!`) for review. The result is saved to the backend.
6. Use **Save project** after manual edits, or reopen work later through
   **Saved projects**. Saving a repository composition creates an editable
   copy under `data/imports/`; edits to that copy autosave after a short delay.
7. Use a group's download icon to export two PNGs: the visible group on a
   transparent canvas, and the same group composited over its final image.

Stored layout:

```
data/imports/<project-id>/
├── source.zip          original segments archive
├── reference.jpg       uploaded final image
├── composition.json    generated + saved composition
└── segments/           extracted PNG/JPEG/GIF/WebP cut-outs
```

Backend API:

| Method | Path                                   | Purpose |
|--------|----------------------------------------|---------|
| GET    | `/api/health`                          | health check |
| GET    | `/api/projects`                        | list repository and saved projects with available compositions |
| GET    | `/api/projects/:project/compositions/:composition` | read a repository or saved composition |
| GET    | `/api/imports`                         | list saved projects |
| POST   | `/api/imports`                         | import `{ name, zip, zipName, reference, referenceName }` (base64 payloads) |
| POST   | `/api/imports/copy`                    | create an editable import copy of a repository composition |
| GET    | `/api/imports/:id/composition.json`    | read a saved composition |
| PUT    | `/api/imports/:id/composition.json`    | save `{ composition, meta }` |

Limits: 500 layers per composition, 220 MB ZIP, 60 MB final image. The
backend reads ZIP central directories directly (`stored` and `deflate`
entries) and uses only Node's standard library — no `npm install`.

---
## Animation director — local vision LLM

The sidebar now has an **Animation ideas** panel. It uses a local vision model
to look at the project's final assembled image, combines that with the
project's layer inventory and an optional story/context, and proposes four
animation sets that can be applied with one click.

### Requirements

- [Ollama](https://ollama.com/) running locally (`ollama serve`).
- A vision model and a writing model. The defaults are:
  - vision: `granite3.2-vision:2b`
  - writing: `qwen3.5:9b`

```bash
ollama serve
ollama pull granite3.2-vision:2b
ollama pull qwen3.5:9b
```

The backend auto-detects Ollama on `127.0.0.1:11434` and `127.0.0.1:11436`,
and honours `OLLAMA_HOST` / `STUDIO_OLLAMA_URL`. Override the models with
`STUDIO_VISION_MODEL` and `STUDIO_TEXT_MODEL` if needed.

### How it works

1. Open an imported/aligned project.
2. Press **Suggest animations**. If you want to tailor the result, open the
   sliders button and add **Story / context** first — for example:
   *“A brave mermaid rises from a moonlit river to defend her kingdom.
   Children's storybook, gentle but heroic.”*
3. The backend:
   - sends a downscaled copy of the final image plus a compact layer
     inventory to the vision model,
   - feeds the resulting scene analysis, story context, and layer inventory
     to the writing model,
   - validates every proposed command against the real layer IDs and the
     preset vocabulary, and
   - saves the result to `data/imports/<project-id>/proposals.json`.
4. The four ideas appear as cards in the sidebar. Press **Apply** to write
   their keyframes onto the composition. The result autosaves.
5. **Reset** clears all animation keyframes. The context and model choices
   are saved in the project metadata (`meta.context`, `meta.director`).

The attached `*-agent.json` / `*.json` exports are the same layer data the
backend already reads from `composition.json`; no manual file upload is
needed. The LLM receives aliases (`L01`, `L02`, …) and only the real project
layers, so it cannot reference a layer that does not exist.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/llm/models` | available local models + recommended vision/text defaults |
| GET | `/api/imports/:id/proposals` | saved context, analysis, and ideas |
| POST | `/api/imports/:id/proposals` | generate ideas: `{ context, visionModel, textModel, count, image? }` |
| PUT | `/api/imports/:id/context` | save `{ context, director }` on the project |

Generation is local and can take about 1–2 minutes on an M2 Pro, mostly in
the writing model. If Ollama is not running, the panel reports `LLM offline`
and shows the command needed to start it.

---

## Segment organization

The **Organize with AI** button in the Layers tools reviews each cutout
thumbnail alongside the final image, then proposes a readable layer name,
semantic group, and role for each segment. Choose a local Ollama vision model
or a configured remote OpenAI-compatible vision model. Suggestions appear in
an editable review list; they are not applied until **Apply suggestions** is
pressed. Applied groups are stored as `segmentGroup` on each layer.
**Download all ZIP** packages every segment image into a ZIP with one folder
per layer group.

Local vision models use the existing Ollama setup above. To enable one remote
model, configure the server process (credentials remain on the server and are
never sent to the browser):

```bash
export STUDIO_OPENAI_API_KEY="your-provider-api-key"
export STUDIO_OPENAI_MODEL="your-vision-model"
export STUDIO_OPENAI_BASE_URL="https://api.openai.com/v1" # optional
node server.js
```

`STUDIO_OPENAI_BASE_URL` may point to another OpenAI-compatible service. Its
configured model must accept image inputs. The organizer sends downsized
thumbnails to the selected provider. Set up only the provider you intend to
use, and review the model's suggestions before applying them.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/llm/organizer-models` | available local and configured remote vision models |
| POST | `/api/segments/organize` | suggest names, groups, and roles for supplied segment thumbnails |

---

## Character rigs

When a project has identifiable characters, the Inspector shows a **Character**
fieldset above the layer fields. Detection uses layer names, part metadata and
geometry, so a portrait with eye whites, pupils, eyelids, brows, a mouth set, a
mustache, a beard, hair and a shirt becomes one rig automatically. Rigs are versioned:
`character.rigVersion = 2` is the legacy eyes/mouth rig, `3` is the full cut-out rig.
The beards project is v3.

### v3 — full cut-out rig

| Part | What the rig does |
|---|---|
| `face` | clean skin plate drawn under every feature; the reference is hidden while rigged |
| `eyes`, `pupils`, `highlights` | gaze offset, micro-saccades, blink fallback, catchlight follow |
| `eyelids` | `half` / `closed` variants crossfaded for real blinks and squints |
| `brows` | `neutral` / `raised` / `furrowed` / `sad` variants chosen by expression |
| `mouth` | 13 visemes (`rest a e i o u mbp fv l wq smile frown open`) crossfaded from a speech track |
| `jaw`, `teeth`, `tongue` | optional; open-mouth drop and layered mouth internals |
| `mustache`, `beard`, `head` | rotate with the head group, plus phase-lagged secondary sway |
| `body` | breathing scale anchored at the bottom |
| `hands` | idle sway |
| `ears`, `neck` | follow the head |

Variant layers share one bounding box. They sit at the same z and switch through
opacity keyframes, so playback and export need no new channels.

### Controls

- **Expression** — neutral / happy / sad / surprised / angry.
- **Blink** — rate and amount; drives the eyelid variants.
- **Talk** — continuous idle chatter when there is no text.
- **Speak** — type a line; the rig maps English graphemes to visemes automatically.
  **Play line** restarts playback and speaks it.
- **Eyes X / Eyes Y**, **Wander**, **Micro eye moves** — gaze and saccades.
- **Breathe**, **Head sway**, **Speech rate**, **Mouth open**, **Mouth shape** — body/head
  life and artist QA. **Mouth open** (next to the Speak field) scales how far the mouth
  opens during talk; 0 keeps the shapes while flattening the motion, 2 exaggerates it.
- **Animate character** / **Clear animation** — apply or clear the keyframes.
- **Exporting with no keyframes** auto-applies the v3 rig (so a GIF/MP4 is not a
  still image) and reports it in the status bar.

Rig settings live in `composition.characters[].settings`. The generated keyframes are
ordinary layer keyframes, so the editor, MP4/GIF export, SVG and the agent protocol
work unchanged. When a v3 rig is applied the reference layer is hidden; clearing the
animation restores it. The old v2 face-cover shortcut is skipped for v3.

### Agent commands

`Export agent spec` includes `characters`, `characterPresetVocabulary`,
`characterPartVocabulary`, `visemeVocabulary`, `browPoseVocabulary` and
`expressionVocabulary`. An agent can drive a character with:

```json
{"commands": [
  {"characterId": "character-1", "preset": "happy"},
  {"characterId": "character-1", "settings": {
    "expression": "sad", "blink": true, "blinkRate": 10,
    "talk": false, "speechText": "I remember the old road.",
    "gazeX": -0.4, "gazeY": 0.2, "headSway": 0.8
  }},
  {"characterId": "character-1", "speak": {"text": "Well met, traveler.", "rate": 1}},
  {"characterId": "character-1", "blink": true, "headSway": 0.4}
]}
```

The server-side animation director knows `speechText`, `headSway`, `saccade`,
`speechRate` and `speechStart`, validates them, and can write dialogue.

### Beards reference implementation

The `beards` import is the worked example:

| File | Contents |
|---|---|
| `data/imports/beards-20261019000756-e757/ASSET-PACK.md` | full image-generation brief, prompts, manifest and QA |
| `data/imports/beards-20261019000756-e757/REVIEW.md` | audit of the original project and what was fixed |
| `data/imports/beards-20261019000756-e757/assets/` | 41 PNGs + `manifest.json` + alignment guide |
| `data/imports/beards-20261019000756-e757/preview/` | rendered MP4/GIF, expressions, visemes, blink, UI |
| `tools/build-beards-assets.py` | rebuild the placeholder pack from the final image |
| `tools/apply-beards-rig.js` | wire the pack into the composition and agent spec |
| `tools/render-beards-preview.js` | render previews through the studio export renderer |
| `data/projects/Beards/compositions/` | 10 baked animations, selectable from the Project dropdown |
| `tools/export-beards-animations.js` | re-bake the animations from `animations.json` |

```bash
python3 tools/build-beards-assets.py --preview   # placeholders (optional)
node tools/apply-beards-rig.js                   # wire / re-wire
PORT=8123 node server.js &
node tools/render-beards-preview.js --server-port 8123
node tools/export-beards-animations.js        # bake the Beards animation project
```

### Saved animations

The beards import ships with `animations.json` (ten named performances). The Character
panel's **Animations** section plays them with one tap, and **Save current** adds new
ones. The same ten are baked into `data/projects/Beards/compositions/`, so they can be
opened from the Project/Composition selector and played directly.
