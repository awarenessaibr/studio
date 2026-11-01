# Estudio Layers ↔ Professional Design Workflow — Alignment Review

**Reviewed against:** *Functionality & Process Map — AI-Assisted Graphic Design Workflow*
(a 15-stage workflow map built from a working Brazilian designer's own account of his
process: reference-based compositing, product variants, vector text, print export).

**Reviewed artifact:** this repository as it stands — `studio-core.js`, `_.js`,
`studio-v2.html`, `server.js`, `composition-generator.js`, plus the shipped test suites.

**Method:** every capability claimed below was read out of the code, not out of a plan
document. Where the repo's own prose and the code disagreed, the code won. All three test
suites were executed for this review: `node --test "tests/*.test.js"` → 94 pass;
`node tests/smoke.js` → 64 checks pass in real Chromium; `node tests/visual.js` → 11
fixture×format renders within budget (worst DOM↔export 2.14 %, worst PNG↔SVG 0.50 %).

**One-sentence verdict:**

> Estudio Layers already implements the **second half** of the map's workflow — intake,
> lock, template, variants, layout, vector type, batch export, and the codified pipeline
> the map's own §6 proposes as the next step — and implements **almost none of the first
> half**: there is no engine in the box that creates, relights, inpaints or upscales a
> pixel. It is the **control plane without the render farm**.

---

## 1. The two things being compared

### 1.1 What the map describes

The map's own summary is the correct starting point:

> AI is used as a **fragment generator, retoucher, and scene/asset helper**, but the real
> work is **reference-based compositing, product-variant consistency, vector/text layout,
> upscaling, and print-ready export**.

So the map is not a wish list of image generators. It is a description of a **production
pipeline** whose input is a client's real reference photo plus AI fragments, and whose
output is a print-ready file for a graphic shop. Its 15 stages split cleanly into two
families:

| Family | Stages | What it is |
|---|---|---|
| **Pixels** | 4 (relight/shadow), 5 (scene extension), 6 (inpaint), 7 (generate assets), 11 (upscale) | Operations that *create or alter raster content* |
| **Pipeline** | 1 (intake), 2 (compositing), 3 (product lock), 8 (variants), 9 (layout), 10 (raster editing), 12 (vector text), 13 (print export), 15 (automation) | Operations that *organize, constrain, lay out and deliver* content |

The map's central complaint — *"nenhuma, absolutamente nenhuma IA me entrega o material
pronto"* — is about the **pixel** family. Its description of his actual value — *"the
controlled production pipeline around it"* — is the **pipeline** family.

### 1.2 What Estudio Layers actually is

A zero-build, zero-dependency, browser-based **layered composition studio** for
PNG cut-out scenes, with a Node backend that stores projects and proxies local LLMs.
Precisely:

- a **layer model** (`x/y/w/h/rotation/opacity/z/fit/visible/locked`, keyframes,
  sprite frames, per-pixel recolour and contour effects) rendered through **one shared
  function** — `resolveLayer()` in `studio-core.js:956` — used by the DOM view, the
  canvas exporter, the SVG exporter, the contact sheet and the batch exporter;
- a **format system** (up to 24 formats, 6 channels, per-format geometry pins, per-format
  type scale, per-channel safe zones);
- a **template system** (typed variables `text | color | url | image`, bindings, per-format
  values, brand kits, guardrails);
- a **brief system** (CSV/`.xlsx` rows → N creatives × formats × locales × outputs in a ZIP);
- a **motion system** (19 presets, 16 easings, a v3 character rig with 18 parts,
  5 expressions and 13 visemes, plus a local-LLM animation director);
- an **export system** (PNG, SVG, GIF, MP4/WebM, JSON, agent spec, ZIP batches, contact sheet);
- an **agent protocol** (`layer-studio/agent/v1`) that lets an external model drive the
  composition without ever inventing a layer id.

What it is **not**: it contains no diffusion model, no inpainting, no relighting, no
super-resolution, no segmentation, no PDF writer, and no colour-managed output. The only
models it can talk to are **vision and text models** used to *read* the scene
(organize segments, propose animation) — never to *produce* pixels.

---

## 2. Scorecard

Scoring: ✅ full = 1 · 🟡 partial = 0.5 · ❌ absent = 0.

| # | Stage from the map | Status | Score |
|---|---|---|---|
| 1 | Intake real client references | ✅ | 1.0 |
| 2 | Hybrid compositing (real + AI parts) | ✅ | 1.0 |
| 3 | Product stays fixed (lock) | ✅ | 1.0 |
| 4 | Shadow correction / relighting | ❌ | 0 |
| 5 | Scene extension / floor props | 🟡 | 0.5 |
| 6 | Retouching / object removal | 🟡 | 0.5 |
| 7 | Generative image pieces | ❌ | 0 |
| 8 | Variant / menu assembly | ✅ | 1.0 |
| 9 | Banner composition | ✅ | 1.0 |
| 10 | Photoshop-style raster editing | 🟡 | 0.5 |
| 11 | Upscaling | ❌ | 0 |
| 12 | Vector text / hybrid layout | ✅ | 1.0 |
| 13 | Print export / format conversion | ❌ | 0 |
| 14 | Conversational AI | 🟡 | 0.5 |
| 15 | Codified / agentic automation | ✅ | 1.0 |
| | **Total** | **7 ✅ · 4 🟡 · 4 ❌** | **9.0 / 15 = 60 %** |

Split by family, which is the number that actually matters:

| Family | Coverage | Reading |
|---|---|---|
| **Pipeline** (1, 2, 3, 8, 9, 10, 12, 13, 15) | **7.5 / 9 = 83 %** | The half he calls his real value is largely built. |
| **Pixels** (4, 5, 6, 7, 11) | **1.0 / 5 = 20 %** | The half he says no AI delivers is still not delivered. |
| **Assistant** (14) | **0.5 / 1** | Task-scoped AI instead of a chat box. |

That asymmetry *is* the finding. Estudio Layers does not compete with the tools he
already rejects; it occupies the part of his day those tools cannot touch.

---

## 3. Stage-by-stage alignment

Statuses are about **capability**, not polish. "Mechanism" names the thing that already
exists in this repo.

| # | Stage | Status | Mechanism in Estudio Layers today | Where it stops |
|---|---|---|---|---|
| 1 | Intake real client references | ✅ | ZIP import (`POST /api/imports`) stores the cut-outs and the client's final image as a **locked reference layer**; `alignToReference()` (`_.js:7498`) template-matches every cut-out onto that image at 12 scales (25 %–200 %) and reports `matched` / `ambiguous` / `unmatched` / `unsupported-rotation`. The reference is a normal layer, so it can back the art or be excluded: PNG export drops it, and a group download writes both a transparent and a with-reference PNG. Projects are listed and reloadable from `data/projects/` and `data/imports/`. | It needs **pre-separated PNGs**. It cannot cut a flat client photo into layers. |
| 2 | Hybrid compositing | ✅ | Real photo parts and AI-made fragments are peers in one z-stack. Per layer: position, scale, rotation, opacity, `fit` (`contain`/`cover`), z-order, recolour, contour, keyframes. The stack is alpha-correct and re-renderable to PNG/SVG/video. | It merges what you give it. It does not synthesize the seam, the contact shadow or a matching light direction. |
| 3 | Product stays fixed | ✅ | The product is a **layer**, so it is fixed by construction: `locked` prevents editing, `positionConfirmed` records sign-off (`confirm-layer` / `confirm-all`, `_.js:4422`), a geometry write resets that sign-off (`_.js:7369`, `_.js:7422`), and the reference plate is locked and confirmable by the aligner itself. No prompt can move it, because no prompt touches it. | Nothing missing in the guarantee itself. The gap is that the *environment* around it cannot be generated. |
| 4 | Shadow correction / relighting | ❌ | Nothing. The only raster operations are per-pixel recolour (flood + composite) and contour (dilate). There is no blur, no light model, no shadow synthesis, no generative fill. | A shadow must arrive as a pre-made semi-transparent PNG and be placed by hand. |
| 5 | Scene extension / floor props | 🟡 | Props **are** first-class layers: add, scale, rotate, place, animate, group, download per group. A generated prop can be dropped in as a layer, and an `image`/`url` variable can bind a layer's `url` so the prop is swapped per format or per brief row. | No outpainting: it cannot extend a floor, a table edge or a background beyond the pixels you supplied. |
| 6 | Retouching / object removal | 🟡 | In a segmented scene, removal is **hiding the layer** — lossless, reversible, and exact (better than an inpaint guess). `visible`, `locked`, and the segment tree make this a one-click operation. | No heal/clone/patch brush on a flat image, no scratch removal inside a single layer, no content-aware fill. |
| 7 | Generative image pieces | ❌ | No text-to-image anywhere. `server.js` proxies **vision and text** models only (`/api/segments/organize`, `/api/imports/:id/proposals`, `/api/llm/models`). | The one capability it deliberately does not have. |
| 8 | Variant / menu assembly | ✅ | The strongest match in the document. A composition with variables **is** a template; a brief row fills it (`composeBriefRow`, `studio-core.js:1312`); `exportBrief()` (`_.js:6609`) writes formats × locales × outputs into one ZIP named per row; per-format values and locked variables are respected; the contact sheet renders every format through the export pipeline. | The **variant image itself** (each flavour's product photo) must be supplied — via a brief column or an `image` variable. It will not generate the missing flavours. |
| 9 | Banner composition | ✅ | 6 channels with real presets (`social`, `display`, `video`, `instore`, `print`, `custom`), 24 formats per composition, per-channel safe zones (social 12/6/16/6 %, print 8 % all round), `Pin to this format` for per-size geometry, per-format `fontSizePct`, contact sheet, batch export. | Print formats stop at A4/A5@300 dpi presets and a custom size — see 13. |
| 10 | Photoshop-style editing | 🟡 | Non-destructive transform stack (nothing is baked until export), recolour, contour, keyframes, presets, 16 easings, sprite frames, groups. | No selection, mask, liquify, heal, dodge/burn, blur/gaussian shadow, smart object, blend modes, or undo history. It is a compositor, not a pixel editor. |
| 11 | Upscaling | ❌ | No super-resolution. Exports are capped instead: PNG ≤ 4096 px on the long edge and ≤ 24 MP; video ≤ 1920 px; GIF fixed at 480 px / 10 fps. | Anything above the source resolution is impossible, and anything above the caps is downscaled. |
| 12 | Vector text / hybrid layout | ✅ | Text is a first-class layer type. **One typesetter** (`layoutText`, `studio-core.js:350`) feeds DOM, canvas and SVG, so line breaks cannot drift. `exportSvg()` (`_.js:9404`) emits real `<text>` elements with family/weight/style/letter-spacing — no `foreignObject`. A visual gate asserts PNG ↔ SVG ≤ 1.0 % on every fixture. | The SVG is a **web** SVG: fonts are referenced by family name, not outlined or embedded, and the colour space is RGB. "Vector text" ✅, "print-ready vector file" ❌. |
| 13 | Print export / format conversion | ❌ | Only the *layout* side exists: print channel, A4/A5@300 dpi presets (2480×3508 fits under the PNG cap), 8 % print safe zone, bleed exemption per layer, and guardrails that can refuse an export. | No PDF, no PDF/X-1a or X-3, no CMYK, no ICC profile, no bleed/trim box or marks, no spot colour, no AI/EPS, no TIFF. Canvas is RGB-only, so this needs a server-side writer, not a browser tweak. |
| 14 | Conversational AI | 🟡 | Local Ollama (vision + writer) proposes four animation schemes from the assembled image plus a story context; a remote OpenAI-compatible vision model can be configured server-side for the organizer; keys never reach the browser. | There is no chat panel for design Q&A. The AI is scoped to two verbs: *organize* and *propose motion*. |
| 15 | Codified / agentic automation | ✅ | `exportAgentSpec()` (`_.js:5309`) emits `layer-studio/agent/v1` with aliased layer ids (`L01`…), preset/character/viseme vocabularies, formats and variables; `applyAgentCommands()` (`_.js:5227`) applies `{commands:[…]}` in one pass, including `{"type":"set-variable",…}`. The server-side director validates every command against the real layer list, so the model cannot hallucinate a layer. Every batch path is deterministic and repeatable. | It automates the repeatables it owns; it does not automate generation or print output, because those engines are absent. |

### 3.1 Where the line falls

Read the table as one continuous boundary. Everything to the **left of the pixel** is
built; everything that **writes a pixel** is missing.

- **Built:** knowing which object is the product, keeping it still, recording that a human
  approved its position, re-flowing a template into 24 sizes and N locales, typesetting
  copy in a way that survives three renderers, naming and zipping the outputs, and letting
  a machine repeat any of it.
- **Missing:** inventing a better shadow, removing a scratch, extending a floor, rendering
  a fifth flavour of brigadeiro at the same angle, doubling resolution, or writing a
  PDF/X-3.

That is a coherent product, not a half-built one — but it is **not** the product the map
describes end-to-end, and the documentation should not pretend otherwise.

---

## 4. The six gaps he named, re-assessed

The map's §3 lists what he says he cannot find. Against this codebase:

| Map gap | Status | Honest reading |
|---|---|---|
| 1. End-to-end AI that delivers **treated, finished material** | 🟡 | It delivers a **finished file** — correct size, correct safe area, real type, brand-checked, correctly named, in a ZIP — from material that is already good. It does not *treat* the material. |
| 2. Generation that matches his **exact specification** | ✅ *by substitution* | Instead of conditioning a sampler with a prompt, the specification **is the composition**: a JSON document he can inspect, diff, version, re-render and hand to a colleague. Deterministic, not "prompt-and-hope". This is the map's stated goal achieved by a different route. |
| 3. AI that respects **real references and fixed products** | 🟡 | The lock is total — the product is a layer that no model can touch. The generative edit around it does not exist. |
| 4. **Angle consistency + batch variant layout** | 🟡 | Batch layout ✅ (template + brief + formats). Angle consistency ✅ *only because* the camera is whatever the supplied photo says: reuse the same box layer, the same geometry, the same light — only the product image and the copy change. It cannot create a *new* angle. |
| 5. **Print-production awareness** | 🟡 | Layout awareness ✅: print sizes, print safe zones, bleed exemptions, vector text, refusable exports. Output awareness ❌: no PDF/X, CMYK, bleed marks or ICC. |
| 6. **Template-driven catalog generation** | ✅ *with one input* | Variables + briefs + batch ZIP + per-row naming + contact sheet is exactly this. Feed it a brief whose column holds each variant's image URL and the catalogue assembles itself. Feed it only text and you get a text catalogue. |

**Two of six closed, three met halfway, none entirely.** The missing half of gap 5 is an
engineering task. The missing halves of gaps 1 and 3 are a model.

---

## 5. Where Estudio Layers is ahead of the map

The question the map leaves open — what does this have that his own process does not —
has eight answers, all shipped:

1. **One specification → many formats and locales.** The map has no answer to this; he
   makes each banner size by hand. Here: up to 24 formats per composition, per-format
   geometry pins, per-format type scale, locale-keyed copy, `formats × locales × outputs`
   in one ZIP. `+ Add format` → all sizes re-flow at once.
2. **A deterministic, versionable artifact.** A composition is JSON. It can be diffed,
   reviewed, re-rendered byte-identically, and regenerated from a brief. His current
   `.psd` + "cada caso é um caso" process cannot be reproduced or audited this way.
3. **An approval gate that actually gates.** `positionConfirmed` marks sign-off per layer,
   invalidates on geometry change, and surfaces a pending count. Nothing else in his
   pipeline records *who approved which object at which position*.
4. **Guardrails that can refuse an export.** Opt-in, deliberately narrow: a text layer in a
   font outside the brand kit **blocks**; a scoped layer crossing the safe area **blocks**;
   palette drift and a logo-named layer missing from the kit are advisory. A refusal is
   reported as a policy outcome, not an error. `assertGuardrails`, `_.js:6856`.
5. **Brand kits as shared, versioned objects.** One kit, many compositions, with a local
   snapshot fallback so a deleted kit degrades instead of breaking. Palette, fonts, logos.
6. **AI that reads instead of draws.** The segment organizer proposes *name, group, role*
   per cut-out from thumbnails; the animation director proposes four motion schemes from
   the assembled image. Both are validated against the real layer inventory. This is
   AI doing asset hygiene and motion — the two repetitive tasks no tool currently helps him
   with, and the two where a wrong answer is cheap to reject.
7. **Motion on a print workflow.** 19 presets, 16 easings, sprite frames, and a v3
   character rig (18 part slots, 5 expressions, 13 visemes, blink/gaze/head-sway,
   grapheme→viseme lip sync). Entirely outside the map — and it means the same catalogue
   that produces a menu card also produces a reel, a story, an in-store loop, and a
   talking character for the brand.
8. **Local-first privacy and zero dependencies.** Client photos never leave the machine;
   Ollama on loopback by default, remote vision opt-in with the key server-side. No
   `npm install`, no cloud account, no per-seat licence. For a designer working under
   client NDAs, this is a commercial argument, not a technical footnote.

Plus the one he would not think to ask for: **export parity as a gate.** The suite renders
every fixture three ways (DOM, canvas, SVG) and fails the build if they disagree beyond
measured budgets (1.0 % PNG↔SVG, 3.5 % DOM↔export, 2.0 % ink centroid). "WYSIWYG" is
asserted, not hoped for — which is precisely the property a graphic shop cares about when
it receives a file.

---

## 6. The map's §6 ("agentic automation, carefully") against what shipped

The map lists seven rule-based bottlenecks. This is the most concrete way to show that
Estudio Layers is already doing the "next level" the map proposes:

| Map §6 bottleneck | Status | What exists |
|---|---|---|
| Batch-generate product variants from reference + template | 🟡 | Batch **assembly** yes (variables + brief + ZIP). Generation no. |
| Enforce same angle/box/lighting across variants | 🟡 | Guaranteed by template reuse: same box layer, same geometry, same lighting layers. New angles cannot be synthesized. |
| Auto-name and organize PNG variants | ✅ | Brief row labels → filenames (`safeFilename`), segment organizer suggests names/groups/roles, `Download all ZIP` writes one folder per group. |
| Run upscaling only on selected assets | ❌ | Selective *export* exists (per group, per format); no upscaler. |
| Composite vector text over raster backgrounds | ✅ | Text layers + real `<text>` in SVG, one typesetter across renderers. |
| Export PDF/X and AI files with print checks | ❌ | Print *checks* partially exist (safe zones, guardrails, 300 dpi canvas). No PDF/X, no AI. |
| Convert formats for the graphic shop | ❌ | PNG / SVG / GIF / MP4 / WebM / JSON / ZIP only. |

Four of seven are already automated or guaranteed — two outright, two by template reuse.
The three that are missing are the same three: **generate, upscale, print-output.**

---

## 7. What it would take to close the rest

Three pieces of work, ordered from the largest commitment to the smallest. None of them
requires rewriting anything: the layer model, the binding system and the agent protocol
are already the right shape to receive them.

### 7.1 Engine A — generative pixels, scoped to layers

The hard part is already built. A generated image needs only to become **a layer's `url`**
(or a new layer) — and `applyBindings` (`studio-core.js:852`) already swaps a layer's `url`
from a variable, with sprite-frame awareness. That means:

- **No new payload type.** An image returned by a model is just a URL. `image`/`url`
  variables, per-format values and `set-variable` agent commands already carry it.
- **One new backend surface.** Mirror the existing LLM proxy: `POST /api/generate` with
  `{ operation, layerId, prompt, mask?, reference?, model }`, local-first (ComfyUI / a
  local SD endpoint) and remote opt-in behind an env var, key server-side, exactly like
  `STUDIO_OPENAI_*` today.
- **Operations map 1:1 to stages 4–7 and 11:** `relight`, `shadow`, `inpaint`,
  `outpaint`, `generate-asset`, `upscale`.
- **Provenance is the one schema addition, and it is small.** Persistence already carries
  it: `serializeComposition` spreads `...layer` and `saveComposition` spreads `...incoming`.
  Only `makeLayer` needs the field, because it rebuilds each layer from an explicit
  whitelist (`_.js:436`) — one line for `generated: {model, prompt, seed, sourceLayerId,
  createdAt}`. That is the whole cost, and it is what lets him *defend* an image to a
  client and re-render it later.
- **The protocol keeps the guarantee.** Generation writes a layer; it never touches the
  product layer. The map's gap 3 is then closed by construction, not by prompt discipline.

Honest caveat: this is the largest, least predictable piece. Model choice, licence terms
for client work, and deterministic re-rendering (seeds, model versions) are product
decisions, not just code.

### 7.2 Engine B — print output

The browser cannot do this: Canvas is RGB, and there is no PDF writer in the dependency
set. It needs a Node-side path.

- True-size, high-resolution raster: raise or tile the 4096 px / 24 MP caps for print
  formats, and add the missing standard sizes (A3, A2, 300 dpi custom with bleed added to
  the canvas).
- **PDF with vector text** — reuse `layoutText()` output as text objects rather than
  rasterising; embed or outline fonts; keep images as separate XObjects so a shop can
  inspect them.
- **Bleed / trim / marks**, then CMYK conversion through an ICC profile for the target
  press. PDF/X-3 is the pragmatic target; PDF/X-1a if the shop is strict.
- A **preflight report** as a first-class output: effective dpi per placed image, colour
  space, bleed presence, font embedding, safe-area crossings. The project already computes
  the last one.
- **Layered PSD / TIFF export** as the bridge — see 7.3.

### 7.3 Bridge C — meet him inside Photoshop (highest adoption value)

He will not abandon Photoshop for final retouching, and he does not need to. The cheapest
high-impact addition is an export that hands his own document back to him:

- **Layered PSD** (one layer per composition layer, transforms baked, names preserved) —
  then his existing muscle memory does steps 4, 6 and 10, and Estudio Layers does 1, 2, 3,
  8, 9, 12 and 15 around it.
- Failing a PSD writer: **per-layer PNG + placement JSON/SVG** in one ZIP. The group
  download already produces transparent per-group PNGs; extending it to per-layer PNG plus
  a placement manifest is small, and a short Photoshop script rebuilds the stack.

This is the move that makes the tool usable *next week* instead of after Engine A ships.
It also reframes the pitch: not "replace your Photoshop", but "never drag a layer into
place again."

---

## 8. How to talk to him about it

The map's §7 is right that the losing argument is "AI can do your job". The evidence above
supports a sharper one.

**Lead with the demo he can verify in ninety seconds:** a template with three variables,
a three-row `.xlsx`, one click → one ZIP containing three creatives, named per row, at the
right sizes. Then change the headline in the template and re-export: the same three files,
still correct. That is his "cardápio" problem, minus the manual alignment.

**Then the two claims that are true and checkable:**

- *"Your product never moves, because it is not an image to the model — it is a locked
  layer with a sign-off flag."*
- *"The file is not a suggestion. Same spec in, same pixels out, every time — and the
  test suite fails if the SVG and the PNG disagree by more than one percent."*

**Do not claim:** that it will retouch the photo better than he does, that it generates
the missing flavours, that it produces a PDF/X for the printer, or that it replaces
Photoshop. Each of those is a real gap, and each will be tested in the first ten minutes.

**The honest framing** (adapted from the map's §7):

> You already use AI for fragments. This is not a bigger model — it is the pipeline around
> the fragments: the product locked in place, the template that knows every size, the type
> that stays vector, the variants exported and named in one pass, and the guardrails that
> stop a wrong font or a cropped headline before it reaches the printer.
> You keep the retouching. It gets the repetitive half.

---

## 9. Questions only he can answer

These decide what to build first:

1. **What does the graphic shop actually accept?** PDF/X-1a, PDF/X-3, AI, or "a PDF is
   fine"? The whole print-output spec hangs on this one sentence.
2. **Does he get flat photos or cut-outs?** Estudio Layers needs separated PNGs. If every
   job starts as one flat JPEG, segmentation is the real bottleneck — not relighting.
3. **Which variants exist as assets?** If each flavour is already photographed in the same
   box, the catalogue problem is solved today. If the photos do not exist, generation is
   the only path — and that is Engine A.
4. **Would a layered PSD export change his week?** If yes, that is the first thing to
   build, ahead of everything above.
5. **What is "print-ready" worth?** Is the pain the file format, the colour, or the
   resolution? They are three different builds.

---

## 10. Evidence & reproduction

Everything claimed in this document is checkable:

```bash
node --test "tests/*.test.js"   # 94 pass — schema, typesetter, formats, variables,
                                # briefs, safe zones, guardrails, brand kits, server
node tests/smoke.js             # 64 checks in real Chromium against the real server:
                                # text, formats, pinning, contact sheet, ZIP batch,
                                # brief load + preview + export, legacy load,
                                # safe zones, shared kits, blocking guardrails
node tests/visual.js            # 11 fixture×format renders, DOM vs canvas vs SVG;
                                # worst measured: 2.14 % DOM↔export, 0.50 % PNG↔SVG
```

Hard limits that shaped the statuses above (`server.js`, `studio-core.js`, `_.js`):
500 layers per composition · 220 MB ZIP · 60 MB reference image · 2 MB fonts
(WOFF2/WOFF/TTF/OTF, magic-byte validated) · 4000-char text · 24 formats ·
60 variables · 200 shared kits. Export caps: PNG 4096 px / 24 MP · video 1920 px,
30 fps, 8 Mbps · GIF 480 px, 10 fps.

### Key locations

| Concern | Where |
|---|---|
| Single render path | `studio-core.js:956` (`resolveLayer`) |
| Single typesetter | `studio-core.js:350` (`layoutText`) |
| Reference alignment | `_.js:7498` (`alignToReference`) |
| Agent spec / command apply | `_.js:5309` / `_.js:5227` |
| Batch formats × locales × outputs | `_.js:6119` (`exportAllFormats`) |
| Brief export | `_.js:6609` (`exportBrief`) |
| SVG export (real `<text>`) | `_.js:9404` |
| Guardrails / refusal | `_.js:6856` (`assertGuardrails`) |
| Safe zones | `studio-core.js:724`, `:749` |
| Variable → layer binding | `studio-core.js:852` (`applyBindings`) |
| Brief row → composition | `studio-core.js:1312` (`composeBriefRow`) |
| Backend routes | `server.js:2615` onward |

### Caveats on this review

- The demo screenshots in `_dev/` and the project/import trees under `data/` were inspected
  as evidence of what the system stores, renders and shows. No new project was created for
  this review beyond running the three suites.
- The map's **attached image** (the folder of nine "Brigadeiros…" PNGs) was not available
  to this review. Its description in the map — same pink box, same angle, same template,
  different filling and label — is exactly the shape of stage 8, and is scored on that
  basis.
- The map's transcript quotes were not re-verified against audio; the stage definitions are
  taken as written.
