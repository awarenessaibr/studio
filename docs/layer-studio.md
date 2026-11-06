# Layer Studio

The composition and animation surface. Two pages share one engine:

| Page | Path | Status |
|---|---|---|
| **Layer Studio v2** | `/` or `/studio-v2.html` | current — use this |
| Classic studio | `/studio.html` | frozen — layers and animation only |

Everything below describes v2 unless stated. The classic page is covered at
the end.

---

## 1. When to use it

- You have **cut-out artwork** (PNG/JPEG/GIF/WebP) and want a moving scene.
- You imported a **segments ZIP** and need to fix placement and timing.
- One design must become **several formats** (feed, story, banner, print).
- Copy, colours or images must become **swappable slots**.
- A portrait should **blink, look around and talk**.
- An LLM should **direct the animation**.

For finished brand artwork (a flyer, a menu, a printable voucher) use
[Asset Studio](asset-studio.md) instead — this page is for composition.

---

## 2. Page anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ Composition ▾   Name            status   Canvas Character Keyframes  │
│                                          Export Tools                │
│                                            (one panel at a time)     │
├───────────────┬──────────────────────────────────────────────────────┤
│ SIDEBAR       │  [Format tabs]            + Format   Contact sheet   │
│ Project       ├──────────────────────────────────────────────────────┤
│ Brand identity│                                                      │
│ Animation ideas│              CANVAS (zoom, drag, resize)            │
│ Layers (tree) │                                                      │
│ Variables     ├──────────────────────────────────────────────────────┤
│ Save / Hide   │  ▶ Play   0 ms ──────●───────────── 3000 ms          │
│               ├──────────────────────────────────────────────────────┤
│               │  INSPECTOR: layer fields, character, presets        │
└───────────────┴──────────────────────────────────────────────────────┘
```

The top bar is deliberately **one panel at a time**: clicking a chip opens
that panel and closes the previous one; `Escape` closes it. The sidebar keeps
only *Layers* expanded by default. Panels and the sidebar are resizable
(drag the divider; arrow keys work when it has focus).

---

## 3. Projects and imports

### Project picker
`Project ▾` lists repository projects (compositions under
`data/projects/<project>/compositions/`) and saved ZIP imports. Choosing a
project fills the `Composition ▾` picker. A repository composition opens
read-only-ish: **Save project** creates an editable import copy, after which
edits autosave.

### Add images / Add folder
A file picker. Each image becomes a layer, ordered by size and filename.
Nothing is uploaded. Images are read as data URLs, so a small set works from
`file://`.

### Import ZIP + image (recommended for segmentation output)
1. Sidebar → Project → **Import ZIP + image**.
2. Choose the segments archive and the assembled final image, name the
   composition.
3. The backend extracts to `data/imports/<id>/` and creates:
   - one layer per image (numbered files are **separate objects**, not
     animation frames),
   - named layer groups when the ZIP includes an `image-to-layers.json`
     segmentation manifest,
   - a locked reference layer for the final image at `z: 0`,
   - segments starting at `z: 2`.
4. Alignment runs immediately: exact template matches are confirmed;
   ambiguous matches take the best candidate and stay flagged `!`.
5. The composition is saved automatically; later edits autosave.

Use the `!` marker as the review queue, then **Confirm all positions** when
the scene is right. The manual **Use as final image and align layers**
button (click the reference layer) is stricter: it reports a match count and
leaves unmatched layers alone.

The Image → Layers **Recover missing** tool can also add cutouts directly to
an existing project. It preserves the current layers and project files, matches
recovered regions against the project's scene names/groups, and appends the
recovered cutouts. The final image dimensions must match. Choosing no target
project creates a separate recovered project instead.

Limits: 220 MB ZIP, 60 MB final image, 500 layers.

### Import character
Imports a character bundle (reference + named part cut-outs) and registers it
in `composition.characters`, ready for the rig controls.

### Saved projects / Save / autosave
`Saved projects` lists everything under `data/imports/`. **Save project** is
enabled once a composition is server-backed; edits autosave after a short
debounce, and the status bar reports failures. Without a server the studio
still edits in memory and exports, but cannot persist.

### Segment tree and group export
The Layers section is a tree, not a flat list:

- **Search** (`Find a segment`) filters by name/group.
- **Expand** toggles every group.
- **Organize with AI** proposes names/groups/roles (see §10).
- **Download all ZIP** packages every segment image into one ZIP with a
  folder per layer group.
- Per-group download exports **two PNGs**: the group on transparency, and
  the group composited over the reference image.
- Applied groups are stored as `segmentGroup` on each layer.

---

## 4. Canvas, playback and keyboard

- **Canvas size** (Canvas panel): 1080², 1080×1350, 1920×1080, 1080×1920 or
  custom (1–10000 px). Editing the size updates the **master** format;
  `width`/`height` always mirror it.
- **Zoom** −/+ / *Fit*.
- **Drag** to move; **handles** to resize and rotate; the layer list,
  inspector and canvas stay in sync.
- **Character panel**: `Scale %` and `Move X/Y` transform every non-reference
  layer together — useful for reframing an imported scene.
- **Playback**: Play/Pause, scrubbable playhead, `ms` read-outs. Duration is
  set in the Keyframes panel (500–30000 ms).
- **Keyboard**: `Delete`/`Backspace` removes the selected layer when focus is
  not in a field; `Escape` closes the open top-bar panel; arrow keys nudge a
  focused panel divider.

---

## 5. Inspector

Fields appear only when they apply. Numeric fields commit on change; every
edit marks the composition dirty and autosaves.

| Group | Field | Notes |
|---|---|---|
| Identity | Name | ≤ 160 chars |
| | Role | `background, midground, ground, foreground, character, character-part, prop, effect` — drives safe-zone scope and z-order guidance |
| Sprite | Sprite FPS / mode | only when the layer has > 1 frame; 1–30 fps, `loop / pingpong / once` |
| Animation | Animation presets | 19 one-click presets (§6) |
| Transform | X, Y, Width, Height | percent of canvas |
| | Rotation | degrees, −3600…3600 |
| | Opacity | percent, 0–100 |
| | Z-index | draw order |
| Image | Image fit | `contain` / `cover` / `fill` (`fill` stretches, used by generated shapes and gradients) |
| | Link image | bind to a `url`/`image` variable |
| | Replace visible pixels + colour | flat recolour (logos, silhouettes) |
| | Contour: enable, colour, thickness | 1–16 px outline |
| Format | Pin to this format / Reset | only outside the master (§7) |
| Review | Lock layer position | prevents accidental drags |
| | Confirm this position | toggles the `!` review flag |

### Text layers

`Add text` (Tools) inserts a text layer. Text shares the transform model with
images (drag, resize, rotate, keyframes, presets, pinning) and adds:

| Field | Range / values |
|---|---|
| Content | plain text; locale-keyed internally; 4000-char cap |
| Font | any registered family (system or uploaded) |
| Weight / Style | 100–900 / normal, italic |
| Size (% of height) | 0.5–30 — percent of the **format height**, not the box |
| Line height | 0.8–3 |
| Letter spacing | −0.1…0.5 em |
| Case | none, uppercase, lowercase, capitalize |
| Colour | `#rrggbb`, bindable to a colour variable |
| Align / Vertical align | left, centre, right / top, middle, bottom |
| Overflow | `clip` (drop out-of-box lines) / `visible` |
| Link content | bind to a `text` variable |
| Upload a font… | WOFF2/WOFF/TTF/OTF, ≤ 2 MB |

Because `sizePct` is relative to the format height, one headline scales
correctly across every format. A clipped line count is shown in the inspector
as a warning — clipping is silent in an export, so the editor says it out
loud.

---

## 6. Animation

### Presets

Select a layer, click a preset. Keyframes are written to the **base** layer
and apply to every format.

| Preset | Motion | Parameters (defaults) |
|---|---|---|
| `breathe` | 2 % scale in/out | `easing` |
| `idle` | ±0.5 % drift + ±0.4° tilt | `easing` |
| `sway` | sine on X and rotation | `amplitude` (2), `tilt` (3) |
| `walk` | X sweep with a slight rocking | `startX`, `endX` (100 − w) |
| `float` | slow vertical bob | `distance` (2) |
| `flicker` | random opacity 55–100 % | — |
| `drift` | continuous X travel | `distance` (15) |
| `pulse` | 6 % scale pop | `scale` (1.06) |
| `fadeIn` | opacity 0 → base over 800 ms | `easing` |
| `parallax` | ∓X around base | `distance` (4) |
| `fadeOut` | base → 0 in the last 800 ms | — |
| `zoom` | scale from → to | `from` (0.5), `to` (1.2) |
| `spin` | full rotations | `turns` (1) |
| `shake` | decaying jitter | `amplitude` (1.5), `decay` (0.85) |
| `hop` | repeated jumps with squash | `height` (4), `count` (2) |
| `swing` | rotation arc | `amplitude` (8) |
| `orbit` | circular path | `radius` (3) |
| `nod` | rotation cycles | `amplitude` (3), `cycles` (2) |
| `blinkIn` | opacity 0/1/0/1 steps | — |

All presets accept `easing` where a smooth interpolation is used; the
vocabulary is `linear, easeIn/Out/InOut, easeInOutSine, easeInOutQuad,
easeOutCubic, easeInOutCubic, easeOutBack, easeInBack, stepStart, stepEnd`
(plus the sine/quad variants in the source). `flicker` uses randomness at
creation time; the written keyframes are then fixed, so playback and export
are stable.

Presets replace the layer's existing keyframes. `none` clears them.

### Keyframes
- **Set keyframe** captures the current pose at the playhead.
- **Delete keyframe** removes the pose at/nearest the playhead.
- The Keyframes panel shows the count; duration is 500–30000 ms.
- Animated properties: `x, y, w, h, rotation, opacity`.

### Character rigs

When detection finds a face/body, a **Character** fieldset appears above the
layer fields.

- **Detection**: from layer names, part metadata and geometry. `rigVersion 2`
  is the legacy eyes/mouth rig; `3` is the full cut-out rig (the Beards
  project). Existing projects can re-detect once.
- **Parts**: `face, eyes, pupils, highlights, eyelids, brows, mouth, jaw,
  teeth, tongue, mustache, beard, head, body, hands, ears, neck, fx`.
  Variant layers (brows, eyelids, mouths) share a bounding box and swap by
  opacity keyframes, so no new channels are needed.
- **Controls**:
  - Expressions: `neutral, happy, sad, surprised, angry`.
  - Toggles: **Blink**, **Talk**, **Wander**, **Breathe**.
  - **Eyes X / Eyes Y** gaze sliders (−1…1).
  - **Speak** (≤ 220 chars) + **Play line**: maps English graphemes to 13
    visemes (`rest a e i o u mbp fv l wq smile frown open`).
  - **Mouth open** (0–2) scales lip movement without changing shapes.
  - **Fine controls**: blink rate/amount, talk intensity/speed, breathe
    amount, head sway, eye/beard pulse, speech rate, micro eye moves
    (saccades), and a forced **Mouth shape** for QA.
  - **Animations**: 10 starter performances; click to play, **Save current**
    to add one (persisted in the project's `animations.json`).
  - **Animate character** writes the rig keyframes; **Clear animation**
    removes them and restores the reference.
  - **Export** bundles the rig for reuse.
- **Exporting with no keyframes** auto-applies the v3 rig so a GIF/MP4 is not
  a still, and says so in the status bar.
- **Ghosting**: the rig hides the static reference eyes/brows/mouth while
  applied, so animated features do not double-expose; clearing restores it.

Generated rig motion is ordinary layer keyframes — the editor, exporters,
SVG and agent protocol treat it like any other animation.

---

## 7. Formats and templates

### Formats
`+ Format` opens channel → preset:

| Channel | Presets |
|---|---|
| social | 1080×1080 Meta Feed, 1080×1350 Instagram Portrait, 1080×1920 Story/Reels, 1200×628 LinkedIn |
| display | 300×250 Medium Rectangle, 728×90 Leaderboard, 160×600 Wide Skyscraper, 320×50 Mobile Banner |
| video | 1920×1080 Pre-roll, 1080×1080 Square, 1080×1920 Vertical |
| instore | 1920×1080 Landscape, 1080×1920 Portrait |
| print | 2480×3508 A4 @300 dpi, 1748×2480 A5 @300 dpi |
| custom | any 1–10000 px |

Up to 24 formats. Exactly one is the **master**; its size is the
composition's `width`/`height`. Format tabs switch the canvas; **Contact
sheet** renders every format through the real export path.

### Pinning
With a non-master format active, **Pin to this format** snapshots geometry
(and, for text, type size) into `format.layerOverrides`. Pinned edits write
only that format and the layer gets an `M` badge. **Reset** drops the
override. Keyframes stay base-level: pinning an animated layer offsets its
base animation, and new poses still write base keyframes.

### Variables and bindings
A composition *is* a template when it has variables and at least one binding.

1. Variables panel → **Add variable** → `text`, `color`, `url` or `image`.
2. Bind in the inspector: **Link content** (text), **Link colour** (colour),
   **Link image** (url/image).
3. Changing a variable updates every bound layer in every format.
4. A non-master format gets its own value column unless the variable is
   locked.

Limits: 60 variables; text ≤ 4000 chars; colours `#rrggbb`; image values
must be https, relative or data URLs.

### Locales
Canvas panel → **Locale** offers 21 presets plus any locale already used.
Text layers may carry locale-keyed content; `defaultLocale` is the fallback
and `activeLocale` is the preview. Batch export can render a list of locales.

### Brand kit and validation
Tools → **Brand kit**: edit palette, fonts and logos. Shared kits can be
saved, attached, detached or deleted; attaching also keeps a local snapshot,
so a deleted kit degrades gracefully.

Tools → **Validate brand** produces a **non-blocking drift report** (palette,
fonts, logo-named layers). Enable guardrail rules there to make two of the
four rules *blocking* — see §8.

---

## 8. Safe zones and guardrails

**Safe zones** come from the format's channel and can be overridden per
format (`format.safeZone`, fractions capped at 0.45, or `null` to disable):

| Channel | top / right / bottom / left |
|---|---|
| social | 12 % / 6 % / 16 % / 6 % |
| video | 10 % / 6 % / 10 % / 6 % |
| instore, print | 8 % all edges |
| display | 5 % all edges |
| custom | none |

Checked layers: all text plus `foreground`, `character`, `character-part`.
Backgrounds and props are assumed to bleed; any layer can opt out with
`bleed: true`. The dashed guide is editor-only and never exported
(Tools → **Safe zones on/off**).

**Guardrails** are opt-in (`composition.guardrails = { enabled, block }`):

| Rule | Severity |
|---|---|
| Text layer uses a font outside the kit | **Blocking** |
| Scoped layer crosses the safe area | **Blocking** |
| Colour outside the palette | Advisory |
| `logo`-named layer not in the kit | Advisory |

With `block` on, every export path — PNG, GIF, video, SVG, batch and brief —
refuses and lists the reasons. A refusal is a policy outcome, not an error.

---

## 9. Briefs and fonts

### Briefs
Tools → **Brief…**: choose a CSV/`.xlsx`, map columns to variables (matched
by name, adjustable), then either:

- **Preview** a row — applied to variable defaults, reversible, never saved;
- **Export all rows** — formats × locales × outputs into one ZIP named per
  row.

Invalid cells are reported per row and skipped; the rest export. Unmatched
columns are ignored; unmatched variables keep their template value. See
[api-and-cli.md](api-and-cli.md#5-briefs-in-detail) for the CLI equivalent and coercion
rules.

### Fonts
System families need no loading. **Upload a font…** accepts WOFF2/WOFF/TTF/OTF
≤ 2 MB, validates magic bytes, stores it under `data/fonts/` and registers it
in the browser so it survives reload (memory-only without a backend).
**Load fonts** primes every family the composition references.

Raster, GIF and video exports **fail loudly** if a visible text layer's font
is not loaded — a silent fallback would produce a wrong export.

---

## 10. AI assistance

Every feature here is review-first and optional; nothing is applied until you
press Apply.

### Animation ideas (director)
- **Provider choice**: choose **Ollama · local** to select installed vision
  and writing models, or **DeepSeek Flash · API** to use the configured
  DeepSeek model. Ollama defaults are `granite3.2-vision:2b` and
  `qwen3.5:9b`; the server auto-detects `127.0.0.1:11434` / `:11436`,
  honours `OLLAMA_HOST` and `STUDIO_OLLAMA_URL`, and model defaults can be
  overridden with `STUDIO_VISION_MODEL` / `STUDIO_TEXT_MODEL`.
- **DeepSeek setup**: configure `STUDIO_DEEPSEEK_API_KEY` and
  `STUDIO_DEEPSEEK_MODEL` on the server (optionally
  `STUDIO_DEEPSEEK_BASE_URL`; defaults to `https://api.deepseek.com/v1`).
  Credentials never reach the browser. The configured API model must accept
  image input and return JSON chat completions.
- **Flow**: optionally write **Story / context** → **Suggest animations** →
  the backend sends a downscaled final image + compact layer inventory to the
  selected provider, validates every proposed command against real layer ids
  and the preset vocabulary, and saves four ideas. Ollama uses the selected
  vision model followed by the writing model; DeepSeek uses the configured
  API model for both steps.
- **Local performance**: on CPU, 9B Ollama models can take a few minutes to
  generate ideas. The local writer uses a compact prompt and bounded output to
  avoid requests running past Ollama's request limit.
- **Apply** writes their keyframes; **Reset** clears animation keyframes.
  Context and provider/model choice persist in the project meta; ideas persist
  in `proposals.json`.
- **Unavailable provider**: the panel explains whether Ollama needs to be
  started or DeepSeek credentials/model configuration are missing.
  Local generation time depends on the selected models and hardware.

### Layout alternatives
**Layouts…** (Export bar) asks the local planner for five layout concepts —
photo-led, ink night, framed editorial, type poster and motion — and shows
each as a painted thumbnail with its command list. They are complete
alternatives, not increments: applying one rewinds to the scene captured when
the dialog opened, so the second concept does not inherit the first one's
layers. **Revert** restores that captured scene; **Regenerate** re-plans from
the current state. Nothing is applied until **Apply**.

The concepts are ordinary `layer-studio/agent-commands/v2` batches
([agent-protocol.md §8](agent-protocol.md#8-batch-protocol-v2--layer-studioagent-commandsv2)),
so an outside model can produce the same thing. Applying a batch advances the
composition's `revision`; the dialog and the status bar show it, and one
batch can be undone.

### Organize with AI (segments)
- Sends each cut-out thumbnail next to the final image and asks for a
  readable **name**, **group** and **role**.
- Local Ollama vision models or one configured OpenAI-compatible endpoint
  (`STUDIO_OPENAI_API_KEY`, `STUDIO_OPENAI_MODEL`,
  `STUDIO_OPENAI_BASE_URL`; credentials never reach the browser).
- Suggestions appear in an editable review list and are applied only on
  **Apply suggestions**. Downstream, **Download all ZIP** groups by the
  applied grouping.

---

## 11. Exports

Export panel:

| Button | Output | Notes |
|---|---|---|
| **PNG** | one frame | All layers except the final-image reference; capped at 4096 px / 24 MP |
| **SVG** | vector + real `<text>` | Text stays selectable; raster layers reference their image URL (data URLs are embedded) |
| **GIF** | animated GIF | Longest side capped at 480 px, ~10 fps; works from keyframes or a v3 character rig |
| **MP4** | H.264 MP4 | `MediaRecorder` real time at 30 fps, 8 Mbps; the client posts the recording to `/api/video/transcode` when `ffmpeg` is available so the file is H.264/AVC rather than VP9-in-MP4. Without ffmpeg the browser's MP4/WebM is kept |
| **Save to brand…** | a published brand template | Snapshots the current composition into its brand pack; available again from Brand identity → Templates |
| **JSON** | the composition | Round-trippable document |
| **Agent spec** | `layer-studio/agent/v1` | Layer/format/variable/character inventory |
| **Agent snapshot** | `layer-studio/agent-commands/v2` | `<name>-agent-snapshot-r<revision>.json`: resolved scene, measured per-layer bounds, asset catalogue, brand kit, effective guardrails and `sourceFacts` — the input a v2 batch is planned against |
| **Layouts…** | five layout concepts | Not an export: opens the layout dialog (§10) |
| **All formats (ZIP)** | formats × locales × outputs | Outputs: PNG, GIF, SVG, Video; video is the slow path and is transcoded per clip |

Guardrails can refuse any of these (§8). Exports that need pixels or fonts
report specific reasons (e.g. `Load "Brand Sans" before exporting`).

Brand identity template cards can export a composition that is **not** the one
open in the editor (initial, saved or in-progress) through
`studio.exportCompositionAs(composition, 'gif' | 'video' | 'png')`. It uses the
same snapshot, font gate, guardrail, asset loader and encoders, so a card export
and an editor export cannot drift.

---

## 12. `studio.html` is now the Agent Studio

The old “classic studio” described here no longer ships. `/studio.html` is a
different, brand-wired page: brand packs → palette/type/logos → layers, a
rule-based agent with apply/undo, guardrails, a 10-second CSS-animation
timeline and an Asset Studio design importer.

See [agent-studio.md](agent-studio.md) for the full page reference, source
map and dependency index.

---

## 13. Recipes

### Fix up an imported scene
1. **Import ZIP + image** → review `!` layers → nudge, then **Confirm all**.
2. Character panel → `Scale` / `Move` to reframe everything at once.
3. Presets: `sway` on foliage, `parallax` on the background, `breathe` on the
   character, `fadeIn` on the title.
4. 10 s duration → **Play** → **Video**.

### One design, four channels
1. Master 1080×1080; add 1080×1920 story, 728×90 leaderboard, A4 print.
2. On the story tab, select the headline → **Pin to this format** → move and
   enlarge it; pin the character smaller on the leaderboard.
3. **Contact sheet** to check all four at once.
4. **All formats (ZIP)** with PNG + SVG.

### Template from a brand
1. Brand identity → *Templates* → **Create** a menu.
2. Tools → **Brief…** → map the kitchen spreadsheet → **Export all rows**.
3. Guardrails on → any off-kit font blocks the batch and names the layer.

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Alignment does nothing, video export fails | Opened over `file://`; use `npm start` |
| "Load … before exporting" | A visible text layer's font is not loaded → Tools → Load fonts |
| Video exports as `.webm` | The browser has no MP4 `MediaRecorder` |
| GIF looks small | GIF is capped at 480 px by design; use video for quality |
| Pinned edits do not animate | Keyframes are base-level; pinning offsets the base animation |
| Guardrailed export refuses | Tools → Validate brand lists the rules; disable `block` or fix the layer |
| No animation provider available | Start Ollama and install a vision model, or configure the DeepSeek API key and model on the server |
| Layers missing after import | 500-layer cap, or the ZIP had > 500 images |
