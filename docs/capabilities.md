# Capabilities

What this project can do, when to reach for each capability, and what it
takes in and gives back. Use it as the map; the per-surface docs have the
button-level detail.

- Layer Studio: [layer-studio.md](layer-studio.md)
- Asset Studio: [asset-studio.md](asset-studio.md)
- Brand intelligence: [brand-packs.md](brand-packs.md)
- Under the hood: [architecture.md](architecture.md)
- API, CLI and briefs: [api-and-cli.md](api-and-cli.md)
- LLM protocol: [agent-protocol.md](agent-protocol.md)

---

## 1. Pick a surface

| You want… | Use | Because |
|---|---|---|
| Move layered cut-outs, add parallax, make a GIF/MP4 | **Layer Studio v2** | Timeline, keyframes, presets, sprite frames |
| Turn a segments ZIP into an editable scene | **Layer Studio → Import ZIP + image** | Extracts, builds layers, aligns to the final image |
| One design that fits feed, story, banner and print | **Layer Studio formats + variables** | Per-format overrides, typed slots, batch export |
| A finished, on-brand flyer/menu/voucher/social post | **Asset Studio** | 50 print-aware layouts, live brand theming |
| A CMYK PDF with bleed and crop marks | **Asset Studio → Print pack** | Bleed/trim boxes, marks, safe-zone preflight |
| A brand system imported from a kit ZIP | **Brand identity** | Palette, type, logos, guides, starter templates |
| A new business turned into a brand pack | **Brand intake** | Name → website/profiles → website + social crawl → importable ZIP |
| What the business already owns | **Asset library** | Referenced pack files + uploads, review, usage rules, print gate |
| A spoken line or a designed voice | **Voice Studio** | Local MLX-Audio speech + two-direction voice agent |
| What the public says | **Social intelligence** | Channels, reviews, themes and voice from scraped profiles |
| 40 menu variants from a spreadsheet | **Brief ingestion** (studio or CLI) | One row per creative, formats × locales |
| Let a local vision model suggest animation | **Animation ideas** | Reads the final image, proposes preset commands |
| Let an LLM direct the scene or a character | **Agent protocol** | Structured JSON commands, validated |
| Rename 60 meaningless cut-outs | **Organize with AI** | Vision model proposes name/group/role |

The rule of thumb: **Brand intake finds the source material, the asset library
remembers and governs it, Social intelligence reads the public evidence, Voice
Studio gives it a voice, Layer Studio composes and animates, Asset Studio
finishes, Brand identity supplies the rules.** Anything created by a brand
pack is an ordinary composition, so it opens in Layer Studio like any other
scene; Asset Studio themes its own layouts from the same pack.

---

## 2. Scene composition and animation

### Build a composition from images
- **What**: drop a folder of PNG/JPEG/GIF/WebP cut-outs into the studio and
  each file becomes a layer, sized and stacked by filename semantics.
- **Use case**: an illustrator exported one PNG per element and needs a
  first assembly before hand-tuning.
- **In → out**: images → a v3 composition (in memory, or saved to the
  backend).
- **Where**: Layer Studio → *Add images* / *Add folder*.
- **Limit**: 500 layers per composition.

### Import a segments ZIP and auto-align
- **What**: upload the segmentation archive plus the assembled final image;
  the server extracts, one layer per cut-out, layers are matched to the
  reference by template matching, and the result is saved and reopened
  later.
- **Use case**: a background-removal/scraping pipeline produced `swans-1.png
  … swans-10.png` and the composite; you want an editable scene in one step.
- **In → out**: ZIP + reference image → `data/imports/<id>/` with
  `composition.json`, `segments/`, `reference.*`.
- **Behaviour**: numbered files are **separate objects**, not animation
  frames. Exact matches are confirmed; ambiguous ones take the best
  candidate and stay flagged `!` for review.
- **Limits**: 220 MB ZIP, 60 MB reference, 500 layers.
- **Doc**: [layer-studio.md](layer-studio.md#3-projects-and-imports)

### Keyframes and playback
- **What**: 0–30 s timeline, position/size/rotation/opacity keyframes,
  scrubbable playhead, real-time playback.
- **Use case**: precise timing that presets cannot express (a beat, a hold,
  a hand-off between two layers).
- **Where**: Keyframes panel + playhead.
- **Per-format keyframes are out of scope**; keyframes are base-level.

### 19 animation presets
`breathe, idle, sway, walk, float, flicker, drift, pulse, fadeIn, parallax,
fadeOut, zoom, spin, shake, hop, swing, orbit, nod, blinkIn`

- **What**: one click writes a full keyframe set on the selected layer.
  Presets take parameters and an easing name.
- **Use case**: `sway` on foliage, `parallax` on a background, `hop` on a
  prop, `fadeIn` on a title, `blinkIn` on a UI element.
- **In → out**: layer + optional params → keyframes shared by every format.
- **Where**: Inspector → *Animation presets*; also the agent vocabulary.
- **Params**: `amplitude`, `tilt`, `distance`, `height`, `count`, `scale`,
  `from`, `to`, `turns`, `decay`, `radius`, `cycles`, `startX`, `endX`,
  `easing`.
- **Detail**: [layer-studio.md](layer-studio.md#presets)

### Sprite animation
- **What**: a layer with several frames cycles them at 1–30 fps in `loop`,
  `pingpong` or `once` mode; playback and export both resolve the same
  frame.
- **Use case**: a hand-drawn water loop, a fire flicker sequence, a
  character turn.
- **Where**: Inspector → *Sprite FPS* / *Sprite mode* (only when the layer
  has >1 frame).

### Image effects
- **What**: *Contain/cover* fit, replace visible pixels with a flat colour,
  and a contour (outline) 1–16 px.
- **Use case**: recolouring a logo cut-out for dark grounds; a sticker
  outline around a character.
- **Where**: Inspector → *Image fit*, *Image color*, *Contour*.

### Character rigs
- **What**: portraits become rigged characters with 18 recognised parts
  (`face, eyes, pupils, highlights, eyelids, brows, mouth, jaw, teeth,
  tongue, mustache, beard, head, body, hands, ears, neck, fx`), expressions,
  blinking, gaze, breathing, head sway and 13-viseme lip-sync driven by
  typed text.
- **Use case**: a talking-head cut-out for a short film or explainer; a
  mascot that should react.
- **In → out**: named cut-outs (+ optional rig JSON) → ordinary layer
  keyframes, so every exporter and the agent protocol keep working.
- **Where**: Inspector → Character; 10 starter performances in the
  *Animations* section.
- **Doc**: [layer-studio.md](layer-studio.md#character-rigs)

---

## 3. Templates, formats and content operations

### Multi-format design
- **What**: one composition carries a master plus up to 23 additional
  formats across six channels — `social, display, video, instore, print,
  custom` — with ready-made presets (Meta feed, story, leaderboard,
  skyscraper, mobile banner, pre-roll, A4/A5 print, …).
- **Use case**: one campaign key visual adapted to feed, story, banner and
  poster without duplicating the file.
- **Where**: format tabs, `+ Format`, `Contact sheet`.
- **Detail**: [layer-studio.md](layer-studio.md#7-formats-and-templates)

### Per-format pinning
- **What**: with a non-master format active, **Pin to this format** snapshots
  a layer's geometry (and type size) into that format only; the layer gets an
  `M` badge. **Reset** removes it.
- **Use case**: the headline needs to sit lower in the story crop; the
  mascot must be 20 % smaller on the leaderboard.

### Typed template variables
- **What**: `text`, `color`, `url` and `image` slots with per-format values,
  optional locks, and layer bindings (content, colour, image).
- **Use case**: the same design for 12 venues with different copy and
  photos; guarded against invalid values.
- **In → out**: variable values → resolved layer fields on every render and
  export.
- **Validation**: text ≤ 4000 chars; colours `#rrggbb`; images https,
  relative or data URLs.
- **Limits**: 60 variables per composition.

### Brief ingestion
- **What**: a CSV or `.xlsx` table — one row per creative, one column per
  variable — becomes N compositions or one ZIP of exports.
- **Use case**: 40 menu rows from the kitchen, 12 venue cards, a campaign
  matrix of offers.
- **In → out**: table + template → previews, derived compositions, or ZIP of
  formats × locales × outputs.
- **Where**: Layer Studio → Tools → *Brief…*; CLI `--brief`.
- **Detail**: [api-and-cli.md](api-and-cli.md#5-briefs-in-detail)

### Locales and localisation
- **What**: 21 locale presets plus any locale already in the content;
  locale-keyed text (per-layer), preview locale switcher, batch export per
  locale.
- **Use case**: one campaign in en / pt-BR / es without cloning the design.

### Fonts
- **What**: system families out of the box; upload WOFF2/WOFF/TTF/OTF
  (≤ 2 MB, magic-byte validated) to a global registry; every text layer
  references a family by name; exports **fail loudly** if a visible text
  layer's font is not loaded.
- **Use case**: licensed brand type; the same face in preview and export.
- **Where**: text inspector → *Upload a font…*; Tools → *Load fonts*.

### Safe zones
- **What**: channel-aware safe area (social 12/6/16/6 %, video 10/6/10/6 %,
  print and in-store 8 %, display 5 %), overridable per format, with an
  editor-only dashed guide.
- **Use case**: keeping copy out of a story's caption bar or a print trim
  margin.
- **Never exported**: guides exist only in the editor.

### Guardrails
- **What**: optional rules that can **refuse** an export: off-kit font
  (blocking), scoped layer crossing the safe area (blocking), off-palette
  colour (advisory), logo-named layer not in the kit (advisory).
- **Use case**: enforcing a brand system at hand-off without turning a
  subjective check into a hard stop.
- **Where**: Tools → *Validate brand* → enable rules.

---

## 4. Brand intelligence

### Brand pack import
- **What**: one ZIP of a scraped brand-kit folder becomes a *group* with one
  identity per business: palette, type scale, voice, logo cuts, photography,
  the Word guide read into structured guidelines, and a shared brand kit.
- **Use case**: onboarding a portfolio of venues (the Cawley pack carries
  five) or a single café from the same artefact the brand-identity step
  produces.
- **What it reads**: `tokens/*.tokens.json`, `*Brand-Guide.docx`,
  `assets/logos|colors|type|photography`, `cover.png`, the group `README.md`.
- **Robustness**: repairs duplicate SVG attributes, strips scripts/handlers,
  substitutes licensed fonts with recorded system stand-ins, and reports
  warnings instead of failing.
- **Limits**: 160 MB ZIP, 480 MB extracted, 4000 files, 240 assets/brand,
  50 packs.
- **Doc**: [brand-packs.md](brand-packs.md)

### Starter templates per brand
- **What**: seven real v3 compositions generated from the identity and the
  guide — menu, business-card front/back, flyer, table card, voucher, social
  post — with variables, formats, safe zones and the kit already attached.
- **Use case**: a new venue needs a menu and a card today, before any design
  work.
- **Palette inference**: the builder reads the guide's applications matrix
  and role keywords, picks ground/ink/accent by contrast and legibility, and
  keeps small-text accents above 4:1.
- **Where**: Brand identity → brand → *Templates* → *Create*.

### Brand kits and validation
- **What**: shared kits under `data/brand-kits/`, attachable by many
  compositions, with a local snapshot fallback so deletion never breaks a
  creative; a non-blocking drift report for palette, fonts and logos.
- **Use case**: one kit, many campaigns; changing the kit updates every
  composition that shares it.
- **Limits**: 512 KB per kit, 200 kits.

---

## 5. Final assets and print

### Asset Studio
- **What**: a focused final-asset surface with a brand gate, eleven
  categories and 50 layouts across 1–5 sizes each.
- **Categories**: flyers (5), menus (8), gift vouchers (4), business cards
  (3), table cards (4), social posts (9), signage (5), guest cards (4),
  stationery (2), packaging (4), compliance (2).
- **Live theming**: brand palette, brand/studio fonts and uploads, brand
  photography and uploads, motif swaps, copy, QR code — every change
  repaints the canvas.
- **Use case**: a restaurant manager makes the week's specials flyer and
  story post without touching the layer editor.
- **Out**: full-resolution PNG, browser print, CMYK print-pack PDF, JPG for
  screen designs, greyscale PNG for thermal labels, saved assets
  (restorable).
- **Doc**: [asset-studio.md](asset-studio.md)

### Signage and large format
- **What**: A-boards, event posters, digital menu boards, roll-up banners and
  notice signs, with physical millimetres and working dpi per preset.
- **Use case**: the pavement board and the lobby screen should share the
  brand, not the layout file.
- **Output**: print pack at 100 dpi for A1/A2 and 50 dpi for a roll-up; the
  digital board is screen-only (PNG/JPG).

### Packaging and die-cuts
- **What**: circular stickers, coasters, a three-panel cup/bottle sleeve, a
  door hanger and voucher envelopes.
- **How**: the preview and PNG clip to the shape (transparent outside it);
  the print pack keeps unclipped artwork for the bleed and draws a magenta
  **vector cut line** at trim, including the hanger hole.
- **Use case**: a café needs bag seals and a hotel needs door hangers without
  a separate die-line tool.

### Compliance and thermal
- **What**: a dish × 14-allergen matrix and a prep/day-dot label.
- **How**: the matrix parses `Dish | allergen, allergen` rows (names, codes
  or numbers 1–14); the label renders black-on-white and exports greyscale
  with no CMYK path.
- **Use case**: the kitchen's allergen sheet and the day-dot labels for
  prepped food.

### Carousels
- **What**: a 3–10 slide carousel from one cover, one line per slide, and a
  CTA, with a slide navigator under the preview.
- **How**: **Download N slides** renders numbered PNGs; slide state persists
  with the saved asset and the session.
- **Use case**: a five-slide "five things to know" post in one style.

### Print pack
- **What**: a CMYK PDF at 300 dpi with a configurable bleed (3 mm
  default), trim box, crop marks, slug and a preflight note listing
  text/logo boxes inside the safe margin.
- **Use case**: sending a piece to a printer with unambiguous boxes.
- **Honest limit**: direct RGB→CMYK, no ICC output intent, not PDF/X. The
  printer's profile and preflight remain authoritative.

---

## 6. AI assistance

### Animation director (local vision LLM)
- **What**: sends a downscaled final image, a layer inventory and optional
  story context to a local vision model, then to a writing model, and
  returns four structured animation ideas you can apply in one click.
- **Use case**: "10 seconds, dreamy, the leaves move and she walks slowly" —
  without hand-keying 20 layers.
- **In → out**: project + context → validated preset commands → keyframes;
  ideas persist in `proposals.json`.
- **Requirements**: Ollama with a vision model and a text model (defaults
  `granite3.2-vision:2b` / `qwen3.5:9b`); credentials stay on the server.
- **Doc**: [layer-studio.md](layer-studio.md#10-ai-assistance)

### Segment organiser
- **What**: a vision model looks at each cut-out next to the assembled
  image and proposes a readable name, group and semantic role; you review
  and apply.
- **Use case**: 60 layers named `image-013.png` become "left fern", "lantern
  glow", "main character".
- **Providers**: local Ollama, or one configured OpenAI-compatible vision
  endpoint.

### Agent protocol
- **What**: `exportAgentSpec()` emits `layer-studio/agent/v1` — every layer,
  format, variable, character and the full preset vocabulary.
  `applyAgentCommands()` applies `{commands:[…]}` in one pass, validating
  layer/variable ids and normalising parameters.
- **Use case**: an external LLM or script directs a scene or drives a
  character ("sad, blink, speak this line, look left").
- **Command kinds**: layer preset, raw keyframes, `set-variable`, character
  preset or settings patch, speak/blink/head-sway.
- **Doc**: [agent-protocol.md](agent-protocol.md)

---

## 7. Projects, data and integration

| Capability | What it does | Where |
|---|---|---|
| Repository projects | Read compositions from `data/projects/<project>/compositions/` | Project picker |
| Saved imports | List, reopen and autosave ZIP imports | *Saved projects* |
| Save/autosave | Writes to `data/imports/<id>/composition.json` after edits | *Save project* + debounce |
| Alignment review | Per-layer confirm/reopen, confirm all | Inspector / *Confirm all positions* |
| Segment tree | Search, group, expand, download all as grouped ZIP | Layers panel |
| Group export | Two PNGs per group: transparent, and over the reference | Segment tree |
| Static server | Serves the pages, `data/`, fonts and packs | `server.js` |
| Health check | `GET /api/health` | API |

---

## 8. Capability matrix

| Capability | Layer Studio v2 | Classic studio | Asset Studio | CLI |
|---|:--:|:--:|:--:|:--:|
| Layered scene animation | ✓ | ✓ | — | — |
| Keyframes and presets | ✓ | ✓ | — | — |
| Sprite frames | ✓ | ✓ | — | — |
| Character rigs | ✓ | ✓ (basic UI) | — | — |
| ZIP import + alignment | ✓ | ✓ | — | — |
| Text layers | ✓ | — | — | ✓ (scaffold) |
| Formats and pinning | ✓ | — | size presets | ✓ |
| Variables and bindings | ✓ | — | — | ✓ (fill) |
| Brand kit / validation | ✓ | — | ✓ (theming) | — |
| Brand pack import | ✓ | — | ✓ (consumes) | — |
| Business asset library | ✓ (health tab) | — | ✓ (photo/gate) | `/library.html` |
| Voice / TTS | — | — | — | `/voice.html` |
| Social intelligence | ✓ (Social tab) | — | — | `/social.html` |
| Brief ingestion | ✓ | — | — | ✓ |
| Print pack (CMYK PDF) | — | — | ✓ | — |
| Agent spec / commands | ✓ | ✓ | — | — |
| AI animation ideas | ✓ | ✓ | — | — |

Classic (`studio.html`) can *open and export* a v3 composition because it
shares the engine; it simply has no UI to create text, formats or variables.

---

## 9. Four end-to-end recipes

### A. Segments ZIP → animated scene → MP4
1. `npm start`, open `/`.
2. Project → **Import ZIP + image** → segments ZIP + assembled image → name.
3. Review flagged (`!`) layers, confirm or nudge; *Confirm all positions*.
4. Select foliage → preset **sway**; character → **walk**; title → **fadeIn**.
5. Set duration 10 s, press **Play**.
6. Export panel → **Video** (MP4 where the browser supports it, else WebM),
   or **GIF**.
7. **Save project** (or let autosave run); it reopens under *Saved projects*.

### B. Brand ZIP → starter templates → 40 menu variants
1. Sidebar → Brand identity → **Import brand ZIP**.
2. Brand tab → *Templates* → **Create** on *Menu*.
3. The menu opens as a v3 composition with 17 variables and A5/A3 formats.
4. Tools → **Brief…** → drop the kitchen's `.xlsx`.
5. Map columns → *Preview* one row → *Export all rows*.
6. One ZIP of all rows × formats comes down, named per row.

### C. Brand pack → finished social post and print voucher
1. Open `/asset-studio.html`, pass the gate, pick the brand.
2. Category **Social posts** → design *Announcement*; edit copy, motif, type.
3. **Download PNG** for the feed.
4. Category **Gift vouchers** → design *Cream classic* → **Print pack (PDF)**
   for the printer, with the safe-zone report checked.

### D. Let an agent direct the scene
1. Open a saved project; Tools → *Validate brand* is optional.
2. Export → **Agent spec** (JSON) and keep `agent-prompt.md` as the system
   prompt.
3. Ask for "10 s, dreamy; she walks left-to-right; leaves sway".
4. Paste the returned `{commands:[…]}` into the console:
   `window.layerStudio.applyAgentCommands(cmds)`.
5. Status reports applied/skipped; press **Play**; autosave keeps it.

---

## 10. Limits and gotchas

- **`file://`** blocks canvas readback and `fetch`: alignment, video export
  and every API feature need HTTP. Serve with `npm start`.
- **Video is real-time** — a 20 s composition takes ~20 s per format; MP4
  depends on the browser's `MediaRecorder` support, otherwise WebM.
- **Fonts must be loaded** before a raster/GIF/video export that uses them,
  by design.
- **Keyframes are base-level**; a pinned layer offsets its base animation.
- **Numbered segment files are objects**, not frames — construct sprites
  explicitly when you need frame animation.
- **Print pack is not PDF/X**; no ICC output intent is embedded.
- **AI features need Ollama** (or a configured remote vision endpoint) and
  are review-first: nothing is applied until you press Apply.
- **Die-cut PNGs are transparent** outside the shape; JPG is not offered for
  shaped items. The print pack's cut line is a guide, not a printer spot
  colour.
- **Thermal labels are greyscale** and skip CMYK; the print pack is hidden by
  design.

## 11. Not in scope

Inline text editing on canvas, animating text-specific properties,
per-format keyframes, curved motion paths, an image generator, a hosted
multi-user service, and a bundler/package ecosystem.
