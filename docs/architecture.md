# Architecture

How the pieces fit together, what the data looks like, and where to change
things. If you only read one section, read [§3 the render path](#3-the-one-render-path).

---

## 1. Shape of the system

```
                        ┌──────────────────────┐
                        │   browser surfaces   │
                        │  studio-v2.html      │  composition + animation
                        │  asset-studio.html   │  final brand artwork
                        │  studio.html         │  classic (frozen)
                        └──────────┬───────────┘
                                   │ fetch /api/*
                        ┌──────────▼───────────┐
                        │      server.js       │  zero-dependency Node HTTP
                        │  static + JSON API   │
                        └──────────┬───────────┘
                                   │ fs
                        ┌──────────▼───────────┐
                        │        data/         │  imports, projects, packs,
                        │   (git-ignored)      │  kits, fonts
                        └──────────────────────┘
```

The two Layer Studio pages share one composition model and one render path.
Asset Studio shares the brand data and the no-build approach but has its own
brand-aware canvas engine. Dependency-free modules sit between them:

| Module | Runs in | Responsibility |
|---|---|---|
| `studio-core.js` | browser **and** Node | Schema normalisers, one text layout, one render-path resolver, formats, variables, brand-kit validation, safe zones, guardrails, brief parsing helpers |
| `brand-pack.js` | browser **and** Node | Brand-pack schema, tokens→kit mapping, palette-role inference, seven template builders |
| `brand-docx.js` | Node | Word `.docx` reader (ZIP + document XML) |
| `_.js` | browser | The Layer Studio engine: state, DOM, canvas, timeline, characters, exports, agent protocol |
| `studio-v2.js` | browser | The studio page's own behaviour: zoom/fit, segment tree, group export, organizer dialog, saved projects |
| `asset-studio/*.js` | browser | Brand adapter, 50 designs, canvas engine (shapes, tabular blocks, motifs), CMYK PDF writer with cut lines |
| `brand-identity.js` | browser | Brand identity workspace (dialog, gallery, templates) |

There is no bundler. Each page loads exactly the scripts it needs, in order.

### Load order

| Page | Scripts |
|---|---|
| `studio-v2.html` | `studio-core.js` → `brand-pack.js` → `_.js` → `brand-identity.js` → `studio-minimal/studio-minimal.js` → `studio-v2.js` |
| `studio.html` | `studio-core.js` → `_.js` |
| `asset-studio.html` | `vendor/qrcode.min.js` → `brand-pack.js` → `engine.js` → `categories.js` → `print.js` → `app.js` |

`studio-core.js` and `brand-pack.js` use a UMD-style wrapper, so the same
files are `require()`-able in Node (tests, server, the CLI).

---

## 2. Module boundaries

The rule that keeps this maintainable: **pure logic in the shared module,
DOM in the page module.**

- Anything that must agree between screen, export and server belongs in
  `studio-core.js` (schema, layout, resolution).
- Anything that touches `document`, `canvas` or a file picker belongs in the
  page module.
- `_.js` is a single IIFE exposing `window.LayerStudio` (including
  `LayerStudio.PRESET_NAMES`), plus `window.layerStudioShowView()` /
  `window.layerStudioHideView()` and an instance on `window.layerStudio`.
- `studio-v2.js` is the page module: it waits for `DOMContentLoaded`, calls
  `layerStudioShowView()`, then wires the parts of the page the engine does
  not own (segment tree, zoom, organizer, saved projects).
- `asset-studio` exposes `window.AssetEngine`, `window.AssetPrint`,
  `window.AssetCategories`.
- `brand-identity.js` exposes `window.brandIdentity` and hooks into the
  studio through `window.layerStudio`.

---

## 3. The one render path

Every renderer — DOM screen, canvas export, SVG, GIF, video, contact sheet,
batch ZIP, agent spec — starts from the same two functions:

```js
const resolved = this.resolveLayer(rawLayer);          // variables + format override
const state    = this.getLayerStateAtTime(resolved, t); // keyframes at time t
```

`resolveLayer(layer, { composition, format, locale })` applies, in order:

1. the format's `layerOverrides[layerId]` (geometry, opacity, z, visibility,
   lock, `fontSizePct`),
2. variable `bindings` (`text`, `color`, `url`),
3. defaults and clamps.

`layoutText()` in the same module is the **one typesetter** for DOM, canvas
and SVG. Text is laid out in *format pixels* and then scaled to whatever
surface is drawing it, so line breaks cannot differ between the screen and
an export.

**Do not read `layer.x` / `layer.w` for rendering outside those functions.**
That was the plan's biggest risk (R3), and the visual gate exists to catch a
regression: skipping `resolveLayer()` moves the ink centroid to 12 % and
trips the pixel budget. See [testing.md](testing.md#3-chromium-harnesses).

`studio-core.js` has no DOM dependency; the canvas text measurer is injected
through `buildTextMetrics()`, with `fallbackTextMetrics()` for Node.

---

## 4. Data model

A composition is a JSON document, currently `version: 3`. The normalisers
live in `studio-core.js` and in `_.js` `makeLayer()`.

### Layer

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable, unique in the composition |
| `type` | `image \| text` | Defaults to `image` |
| `name` | string | Human label, ≤ 160 chars |
| `role` | enum | `background, midground, ground, foreground, character, character-part, prop, effect` |
| `url` | string | Data URL or http(s) — the first frame |
| `frames` | string[] | > 1 means a sprite; max 60 |
| `spriteFps` | int | 1–30 (default 8) |
| `spriteMode` | enum | `loop \| pingpong \| once` |
| `x, y, w, h` | float | **Percent of canvas**; (0,0) is top-left |
| `opacity` | float | 0–1 |
| `rotation` | float | Degrees, −3600…3600 |
| `z` | int | Draw order, −1000…1000 |
| `fit` | enum | `contain \| cover` |
| `keyframes` | array | `{ time, x, y, w, h, rotation, opacity, easing? }` in ms |
| `bindings` | object | `{ text?, color?, url? }` → variable ids |
| `visible`, `locked`, `positionConfirmed` | bool | Editor state |
| `bleed` | bool | Exempt from safe-zone checks |
| `recolorEnabled/Color`, `outlineEnabled/Color/Width` | | Image effects |
| `rig`, `part`, `group`, `segmentGroup`, `variant` | | Segment/rig metadata |

Text layers add `text`, `font` (`family`, `weight`, `style`, `sizePct`,
`lineHeight`, `letterSpacingEm`, `transform`), `color`, `align`,
`verticalAlign`, `overflow`. Their transform model is identical to an image
layer's.

**Units.** `x/y/w/h` are percentages of the canvas, so a layer keeps its
relative position across formats. `font.sizePct` is a percentage of the
**format height**, not the layer box — that is what lets one headline scale
across channels without per-format overrides.

### Composition

```js
{
  version: 3,
  id, name, width, height, duration,     // width/height mirror the master format
  defaultLocale: 'en',
  activeLocale: null,                    // preview locale; null = default
  referenceLayerId,                      // the final assembled image
  characters: [],                        // rigs
  layers: [],
  formats: [Format],                     // ≥ 1, exactly one isMaster
  activeFormatId: 'master',
  variables: [Variable],
  brandKit: BrandKit | null,             // embedded kit / snapshot
  brandKitId: string | null,             // shared kit wins over brandKit
  guardrails: { enabled, block },
  showSafeZones: true,
  meta: { context, director, fontSubstitutions, sharedKitId, … }
}
```

### Format, Variable, BrandKit

```js
Format = {
  id, isMaster, channel,                 // social|display|video|instore|print|custom
  label, width, height,
  layerOverrides: { [layerId]: {
    x?, y?, w?, h?, rotation?, opacity?, z?, visible?, locked?,
    fontSizePct?                        // text layers only
  } },
  variableValues: { [varId]: string },
  safeZone?: { top, right, bottom, left } | null
}

Variable = { id, name, kind, defaultValue, locked }   // kind: text|color|url|image
BrandKit = { id, name, palette: [{name,hex}], fonts: [{name,family,weight,style}],
             logos: [{name,url}] }

Character = {
  id, name, rigVersion,
  parts: { eyes: [layerId], mouth: [...], … },
  hidden: [layerId],
  coverLayerId,
  settings: { expression, blink, talk, gazeX, gazeY, headSway, speechText, … },
  applied: bool
}
```

Caps: 500 layers, 24 formats, 60 variables, 60 sprite frames.

---

## 5. Storage

```
data/                              git-ignored
├── imports/<id>/                  one import / saved composition
│   ├── source.zip                 original segments archive (when imported)
│   ├── reference.<ext>            the assembled final image
│   ├── segments/…                 extracted cut-outs
│   ├── assets/…                   localised template artwork
│   ├── composition.json           the document
│   └── proposals.json             director ideas (optional)
├── projects/<project>/
│   ├── compositions/*.composition.json
│   └── README.md, layers/, sources/, docs/, previews/
├── brand-packs/<id>/pack.json + files/<brand>/…
├── brand-kits/<id>.json
└── fonts/<family>-<hash>.ttf|woff2
```

Repository projects are **curated** by whoever owns the film or brand
work; imports are **working state**. Because `data/` is ignored, both live
locally and are not versioned with the code.
Saving a repository composition creates an import copy rather than mutating
the repository file.

### Save safety
`saveComposition()` merges against what is on disk: it keeps the highest
`version`, preserves formats/variables/brand kit/text metadata/Phase-4 fields
from a stale client, and treats an explicit empty `bindings: {}` as an
intentional unlink. Those rules are covered by `tests/server.test.js`.

---

## 6. Server

`server.js` is ~3.9k lines of Node standard library. It contains:

| Area | Notes |
|---|---|
| HTTP routing | Prefix + regex routing; static file serving with a path-traversal guard |
| ZIP | Reads central directories directly; `stored` and `deflate`; used for segments, fonts, brand packs, `.xlsx` and `.docx` |
| Images | PNG/JPEG/GIF/WebP header parsing for dimensions and content type; no image library |
| XLSX / DOCX | Sheet XML and WordprocessingML readers built on the ZIP reader |
| LLM client | Native `fetch` to Ollama (and an optional OpenAI-compatible endpoint) |
| Composition logic | `buildComposition`, `detectCharacters`, proposal validation/normalisation |
| Stores | Imports, projects, fonts, brand kits, brand packs |

Export surface for tests: see the `module.exports` at the bottom of the file.
Routes and limits are listed in [api-and-cli.md](api-and-cli.md).

### Request flow
1. `POST /api/imports` receives base64 ZIP + reference (≤ 320 MB body).
2. The ZIP is validated and extracted to `data/imports/<id>/segments/`.
3. `buildComposition()` creates one layer per image plus a locked reference,
   assigns z-order and detects characters from names/geometry.
4. The client runs `alignToReference()` against the reference pixels and
   saves the aligned composition back with `PUT`.
5. Edits autosave; the director writes `proposals.json` through its own
   endpoints.

---

## 7. Why it works without a build step

- Scripts are plain `<script>` tags sharing globals by convention.
- No JSX/TypeScript, no CSS preprocessor, no ES module graph to resolve.
- Images are data URLs, so a composition is self-contained.
- The Node server is started directly; the CLI is a single file.
- Tests run with `node --test` and raw Chrome DevTools Protocol (no
  Playwright/Puppeteer).

The trade-offs are deliberate: a large `_.js` IIFE, manual script ordering,
and no tree-shaking. In exchange, the whole thing is readable, greppable and
has no supply chain.

---

## 8. Where to change things

| You want to… | Change |
|---|---|
| Add an animation preset | `_.js` → `PRESET_NAMES` + the `presets` map in `applyPreset()` |
| Add a format preset | `studio-core.js` → `CHANNEL_PRESETS` |
| Add a variable kind | `studio-core.js` → `VARIABLE_KINDS` + validation + inspector UI |
| Add a guardrail rule | `studio-core.js` → `evaluateGuardrails()` |
| Add a brand template | `brand-pack.js` → `TEMPLATES` + a `buildX(ctx)` |
| Add an Asset Studio design | `asset-studio/categories.js` → a category's `tpls` |
| Add a motif | `asset-studio/engine.js` motif library + `MOTIF_LABELS` in `app.js` |
| Add a character part | `_.js` → `CHARACTER_PART_KEYS` + rig generation + detector |
| Add an API endpoint | `server.js` router + a test in `tests/server.test.js` |
| Change the agent schema | `_.js` → `exportAgentSpec()` / `applyAgentCommands()`, then update `agent-prompt.md` |

After a change, run `npm test`; for anything visual, run `npm run test:visual`.

---

## 9. Known constraints

- **`_.js` is large.** It is one IIFE of ~9.5k lines. It is sectioned and
  greppable, and the shared logic has already been extracted to
  `studio-core.js`, but further extraction (timeline, characters, exports)
  would be the next structural improvement.
- **`_.css` uses underscore names.** `_.js` / `_.css` are the historical
  Layer Studio names. Renaming them is churn without behaviour gain; the
  docs refer to them by role.
- **`studio.html` is frozen** with a banner. It shares the engine, so it
  still renders v3 documents, but it is not developed.
- **Canvas ceilings.** PNG export is capped at 4096 px / 24 MP; GIF at 480 px
  on the long edge; video is real-time `MediaRecorder`.
- **Print is not PDF/X.** No ICC output intent is embedded.
- **Sizes carry physical data.** Asset Studio presets hold `mm`, `dpi`,
  `shape`, `sides` and `print` flags; `print.js` resolves the page from them,
  so a new category needs no print-spec table entry.
- **Browser storage is per profile.** Asset Studio's saved assets live in
  `localStorage`, not `data/`.
- **Node ≥ 22.6** for `node --test` glob support.
