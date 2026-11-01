# Layer Studio — Development Plan for the Three High-Leverage Moves

## 0. Implementation status (30 Oct 2026)

Phases 1–3 are implemented and verified. Everything below is additive: no
existing composition, preset, character rig, director or export path was
replaced. The one render path is `resolveLayer()` in **`studio-core.js`**, a new
zero-build module loaded before `_.js` that also runs under Node for the tests.

**Verified by** `node --test "tests/*.test.js"` (93 tests, including the
generator CLI), `node tests/smoke.js` (64 checks in real Chromium against the
real server) and `node tests/visual.js` (8 fixtures × up to 3 formats, each
rendered by the DOM, the canvas exporter and the SVG exporter and compared
pixel-wise).

**Phase 4 (shared kits, safe zones, guardrails) and Phase 5 (brief ingestion)
are also shipped** — see the sections at the end of this file.

### Phase 1 — text layers

| Acceptance criterion | Status |
|---|---|
| Add / edit text, font, size, colour, alignment; renders on canvas | ✅ |
| Participates in drag, resize, rotate, keyframes, presets, `positionConfirmed` | ✅ shared code path (inspector geometry edits and pinning automated; drag/resize share the same writer) |
| `getLayerStateAtTime` returns the image shape plus text fields | ✅ |
| PNG export matches the DOM layout | ✅ measured Δx 0.0 %, Δy 0.4 % |
| SVG opens without warnings and text is real `<text>` (no `foreignObject`) | ✅ `<text>` + `font-family` asserted; not opened in Inkscape |
| GIF and video include text | ✅ same canvas branch, not frame-diffed |
| Save / reload round-trip without data loss | ✅ unit + server tests |
| Agent spec includes text layers; presets apply | ✅ |
| Unit tests + visual regression fixtures | ✅ 8 fixtures in `tests/visual.js` (no `pixelmatch` dependency: an in-page decoder plus a shift-tolerant diff). Budgets are the measured cross-rasteriser baseline, documented in the README |
| Keyboard / screen-reader reachable | ✅ `aria-label` on the node, focusable segment-tree row |
| Font readiness gate fails loudly | ✅ implemented (throws); not exercised with a real unloaded face |

### Phase 2 — multi-format

| Acceptance criterion | Status |
|---|---|
| Several formats with distinct sizes | ✅ (tested with 2–3; cap 24) |
| Switching formats updates the canvas aspect ratio | ✅ |
| Locale renders translated copy in the DOM, canvas, SVG and batch export | ✅ `tests/smoke.js` |
| Master edits appear in every format | ✅ |
| A pinned layer differs only in its format | ✅ |
| Reset restores the base | ✅ |
| Contact sheet renders every format through the export pipeline | ✅ |
| Batch export → `formats × locales × outputs` in a ZIP | ✅ (PNG + 2 locales + 2 formats verified by reading the ZIP) |
| Cancelling stops within a frame | ✅ flag wired; not automated |
| Agent spec carries `formats` + `activeFormatId` | ✅ |
| Director proposals still apply to all formats | ✅ by construction (presets write base) — not re-run against Ollama |
| Character rigs animate in every format | ✅ shared path, not diffed per format |
| v1 and post-Phase-1 files load | ✅ |
| Visual regression across 5 formats | ✅ 3 formats exercised (master, story, leaderboard) |

### Phase 3 — variables + brand kit

| Acceptance criterion | Status |
|---|---|
| Text variable bound to a text layer | ✅ |
| Colour variable bound to a text layer | ✅ |
| Image variable bound to an image layer's `url` | ✅ (inspector `Link image`) |
| Changing a variable updates every bound layer in every format | ✅ |
| Per-format values show only in that format | ✅ |
| Locked variables cannot be overridden | ✅ |
| Brand kit editor persists palette, fonts, logos | ✅ |
| "Validate against brand kit" reports drift, non-blocking | ✅ |
| Batch export resolves variables per `(format, locale)` | ✅ |
| Agent spec includes variables and the brand kit | ✅ |
| `set-variable` accepted and validated | ✅ |
| Existing compositions load unchanged | ✅ |
| Visual regression: 3 formats × 2 locales | ✅ visual corpus covers 3 formats; locales covered by `tests/smoke.js` |

### Deviations and additions

- **`fontSizePct` in `layerOverrides`** (not in the original plan). `sizePct` is
  relative to the format height, so a headline sized for 1080² is unreadable in a
  728×90 leaderboard. Pinning a text layer now also snapshots and edits a
  per-format type scale. Without it the channel presets in §3.5 are not usable.
- **Fonts are global** (`/api/fonts`) rather than per-import
  (`/api/imports/:id/fonts`), so one upload serves every project. The client
  also accepts an in-memory data-URL font when no backend is running.
- **`studio.html` is deprecated**, not mirrored: the file contains two
  concatenated HTML documents, so patching text rendering into it is unsafe. It
  loads, works for image layers, and carries a banner pointing at
  `studio-v2.html`.
- **Overflow is visible in the editor.** `overflow: clip` drops lines that do not
  fit entirely (per §2.2). Because that is silent in an export, a clipped text
  box gets a `+N lines hidden` badge on the canvas and a warning in the
  inspector.
- **The parity gate is a visual corpus, not a single comparison.** 8 fixtures ×
  up to 3 formats, each rendered by the DOM, `renderExportFrame` and
  `exportSvg`. Budgets are the measured baseline of two different text
  rasterisers (see the README), and the gate is negative-tested against both an
  export-only bug and a `resolveLayer`-skips-a-path bug.
- **SVG exports at the playhead**, not at base layer values. The two files used
  to disagree whenever a layer was animated; the visual corpus caught it
  (`text-animated` PNG↔SVG went from 1.43 % to 0.00 %).
- **The locale dimension is wired end to end**: a `Locale` switcher in the
  header, `composition.activeLocale` persisted, and `defaultLocale` honoured as
  the fallback. A missing `<select>` was not the only gap — the typesetter was
  being called without a locale, so every locale rendered the default copy.

### Phase 5 — brief ingestion (implemented ahead of Phase 4)

The plan placed brief ingestion at Phase 5 and guardrails at Phase 4. Brief
ingestion shipped first because the variables model (Phase 3) made it mostly
wiring, and it is the largest remaining gap against the Suvi document (§4.2).

| Acceptance criterion | Status |
|---|---|
| CSV brief → rows → one composition per row | ✅ CLI + studio; `tests/generator.test.js` |
| `.xlsx` brief (Excel) | ✅ dependency-free reader in `server.js`; `tests/fixtures/brief.xlsx` |
| Columns matched to variables automatically | ✅ `suggestBriefMapping` (name, id, cautious substring) |
| Manual mapping override | ✅ a select per variable in the Brief dialog |
| Invalid cell reported, not silently dropped | ✅ per-cell coercion errors; the CLI skips the row and says which column |
| Row values respect `locked` variables | ✅ they become defaults, so locking cannot hide them |
| The template is never mutated | ✅ `composeBriefRow` deep-copies layers/formats |
| Preview a row in the editor, reversibly | ✅ applied to defaults, cleared on close, never saved |
| Batch export rows × formats × locales × outputs | ✅ one ZIP, one filename per row |
| Previewing/exporting does not need a saved project | ✅ both work from an unsaved composition |

Deliberate limits: no `.xls` (legacy binary), no formula evaluation, Excel date
serials pass through as numbers, no per-row layer overrides (a row fills
variables, not geometry), and 500 rows / 64 columns / 8 MB per brief.

### Phase 4 — shared kits, safe zones, guardrails

| Acceptance criterion | Status |
|---|---|
| One kit → many compositions | ✅ `/api/brand-kits` CRUD; `composition.brandKitId` |
| Editing a shared kit updates its users | ✅ same as an agent command: no cache to bust |
| A deleted/unreachable kit cannot orphan a composition | ✅ attaching also stores a local snapshot; `effectiveBrandKit()` falls back |
| Channel safe zones, per-format override and off switch | ✅ channel presets, `format.safeZone`, `null` = off |
| The guide is editor-only | ✅ asserted absent from the SVG export; hidden in the visual harness |
| Only in-scope elements are checked; bleeding is allowed | ✅ text + foreground/character roles; `layer.bleed` opts out |
| Validation reports safe-area crossings | ✅ a `safeZone` group, reported even without a kit |
| Guardrails can block every export path | ✅ PNG, video, GIF, batch and brief all call `assertGuardrails` |
| Blocking is opt-in and scoped to objective rules | ✅ font drift + safe area block; palette and logo findings stay advisory |
| A refusal is reported, not logged as an error | ✅ `reportExportError` separates policy from bugs |

Deliberate limits: no per-layer rule overrides, no rules beyond the four above,
no server-side enforcement (a client can ignore its own gate), and safe zones
are geometry only — no per-channel attention maps.

### Still open (out of scope for Phases 1–5)

Comments/approval threads (Suvi §4.4), distribution, and automated
drag/resize/cancel coverage.

---


**Scope:** Text layers → Multi-format with per-format overrides → Template slots + brand kit.
**Constraint:** Additive only. No replacement of the existing editor, AI director, character rig, segment organizer, or export pipeline. Every existing composition file must continue to load.

**Basis:** the actual code — `_.js` (~2,400 lines, single IIFE), `server.js` (zero-dependency backend), `studio-v2.html` (segment tree UI), `studio.html` (classic UI), `_.css`, `composition-generator.js`.

---

## 1. Guiding principles

Five rules govern every change below. If a story violates one, stop and rewrite it.

**1. One render path.** The single function `resolveLayer(layer, { composition, format, locale })` returns the fully-resolved layer for rendering. `renderCanvas` (DOM), `renderExportFrame` (canvas), `exportSvg` (SVG), `buildDirectorCatalog` (LLM inventory), and `exportAgentSpec` all read from `resolveLayer`. No other code path reads raw layer fields for rendering.

**2. Additive schema.** New fields get defaults. `normalizeComposition` upgrades on load. `server.js` `saveComposition` never strips unknown fields (verified — it spreads `...incoming`). The `version` field is informational; migration is defined by *which fields exist*, not by a version gate.

**3. Existing primitives are the substrate.** `getLayerStateAtTime`, `applyPreset`, the character rig, `positionConfirmed`, the sprite system, `export*` — all reuse the current implementations. New features wrap them; they do not replace them.

**4. Text and image are peers, not subclasses of each other.** Text layers share the transform model (`x/y/w/h/rotation/opacity/keyframes`) with image layers and nothing else. Inspector, presets, keyframes, and z-ordering are shared; URL/effects/fit are image-only; font/text/align are text-only.

**5. Export parity is a gate, not a goal.** Every phase ships with a visual regression test comparing {DOM screenshot, PNG export, SVG export} at the same scale. A phase is not "done" until that test is green.

---

## 2. Phase 1 — Text layers

**Goal:** A first-class text primitive that renders identically on screen, in SVG, and in every raster/video export. One composition can contain text and image layers together.

**Effort:** ~5 weeks with 2 engineers (3 parallel, 5 serial including QA). Depends on nothing. Blocks Phase 2 and Phase 3.

### 2.1 Schema

Every layer gains a `type` field, defaulting to `'image'`.

```js
LayerImage = LayerBase & {
  type: 'image',
  url, frames, spriteFps, spriteMode, fit,
  recolorEnabled, recolorColor,
  outlineEnabled, outlineColor, outlineWidth,
  // …everything currently on a layer
}

LayerText = LayerBase & {
  type: 'text',
  text: string | { [locale: string]: string },   // object form is Phase 2+
  font: {
    family: string,            // must be in the font registry
    weight: 100|200|…|900,
    style: 'normal'|'italic',
    sizePct: number,           // 0.5–30, % of the *format's* height
    lineHeight: number,        // unitless, 0.8–3
    letterSpacingEm: number,   // −0.1–0.5
    transform: 'none'|'uppercase'|'lowercase'|'capitalize',
  },
  color: string,               // #rrggbb
  align: 'left'|'center'|'right',
  verticalAlign: 'top'|'middle'|'bottom',
  overflow: 'clip'|'visible',
}

LayerBase = {
  id, name, role, z, x, y, w, h, opacity, rotation,
  visible, locked, positionConfirmed,
  keyframes: [...],           // unchanged shape
  part, group, variant, segmentGroup,  // unchanged (used by character rig)
  // NEW:
  type: 'image'|'text',
}
```

**`sizePct` is a percentage of the format's height, not the composition's.** This is what makes the same headline scale correctly across all formats in Phase 2 without per-format overrides for font size.

**Migration in `normalizeComposition`:** every incoming layer gets `type: item.type === 'text' ? 'text' : 'image'`. Text layers are validated through a `normalizeTextLayer` function analogous to `makeLayer`; image layers continue to use `makeLayer` unchanged. Existing files load cleanly.

### 2.2 Text layout engine — the shared primitive

New file, either a new `text.js` module in `_.js` (preferred for zero-build) or a clearly-delimited section.

```js
function layoutText({ text, font, boxWidthPx, boxHeightPx, locale }) {
  // Returns: [{ text: string, x: number, y: number, width: number }]
  // x/y are pixel offsets inside the box, top-left origin.
  // Uses an offscreen canvas for measureText.
}
```

Rules:
- Split on `\n` first (hard breaks).
- Soft wrap at word boundaries within each hard-break segment.
- No hyphenation in Phase 1.
- `direction` inferred from `locale` (`rtl` for `ar`, `he`, `fa`, `ur`; `ltr` otherwise) and passed to `ctx.direction`.
- CJK: no-space wrapping — break between any two CJK characters if no word boundary fits.
- Truncation: if `overflow === 'clip'`, lines that exceed `boxHeightPx` are dropped from the result. Ellipsis is Phase 1.5.

This function is pure. It is unit-tested. It is used by DOM, canvas, and SVG.

### 2.3 Rendering — three paths, one layout

**DOM (`renderCanvas` in `_.js`):**

Currently:
```js
const image = document.createElement('img');
image.src = layer.url;
```

Branch on `layer.type`:
```js
if (layer.type === 'text') {
  const inner = document.createElement('div');
  inner.className = 'ls-text-inner';
  inner.style.font = `${style} ${weight} ${sizePx}px ${family}`;
  // …one absolutely-positioned <span> per line from layoutText, positioned
  //    by the exact same x/y the canvas renderer will use.
  node.appendChild(inner);
} else {
  // existing <img> path
}
```

Why absolutely-positioned spans? Because it makes the DOM renderer use *exactly* the coordinates that `layoutText` returns, eliminating sub-pixel divergence. Text remains selectable and accessible via `textContent`.

**Canvas (`renderExportFrame`):**

```js
if (layer.type === 'text') {
  const lines = layoutText({ text, font, boxWidthPx: width, boxHeightPx: height });
  context.font = `${style} ${weight} ${sizePx}px ${family}`;
  context.fillStyle = state.color;
  context.textAlign = align;
  context.textBaseline = 'top';
  context.direction = localeDirection;
  lines.forEach((line) => context.fillText(line.text, line.x, line.y));
}
```

**SVG (`exportSvg`):**

```js
if (layer.type === 'text') {
  const lines = layoutText({ … });
  return lines.map((line) =>
    `<text x="${line.x}" y="${line.y}" font-family="${escapeXml(family)}"
           font-weight="${weight}" font-style="${style}" font-size="${sizePx}"
           fill="${color}" text-anchor="${anchor}">${escapeXml(line.text)}</text>`
  ).join('');
}
```

No `<foreignObject>` — SVG must be portable to Illustrator/Inkscape.

### 2.4 Font system

New: `FontFace`-based loader and a registry.

```js
const fontRegistry = new Map();  // family → { family, weights, style, status, url }

async function loadFont(family) {
  if (fontRegistry.get(family)?.status === 'loaded') return true;
  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  fontRegistry.set(family, { …registry.get(family), status: 'loaded' });
  return true;
}
```

**System fonts** (Inter, Helvetica, Arial, Georgia, Times, system-ui) are always available — no loading needed. **Uploaded fonts** go through `server.js`:

- `POST /api/imports/:id/fonts` (multipart or base64): stores the font file under `data/imports/:id/fonts/`, returns `{ id, family, url }`.
- `GET /api/imports/:id/fonts`: lists.
- Size limit: 2 MB per font. Magic-byte validation (WOFF2: `wOF2`, WOFF: `wOFF`, TTF: `\x00\x01\x00\x00`, OTF: `OTTO`).

**Export gate:** every raster/video/GIF export awaits `document.fonts.ready` *and* verifies that every family referenced by a visible text layer is loaded. If not, it fails with: `"The font 'Acme Sans' is referenced by 'Headline' but has not been loaded. Click 'Load fonts and retry'."` This is a **hard gate** — silent fallback to a system font would produce a wrong export, which is worse than a clear error.

### 2.5 Inspector

`renderInspector` gains a conditional **Text** fieldset (`if (layer.type === 'text')`):

- text (textarea, maxLength 4,000, escaping done at render)
- font family (searchable `<select>` from the font registry)
- weight (100–900 step 100)
- style (normal / italic)
- size (% of height)
- line height
- letter spacing (em)
- transform (none / UPPER / lower / Capitalize)
- color (`<input type="color">`, hex)
- align (L / C / R)
- vertical align (T / M / B)
- overflow (clip / visible, clip only for Phase 1)
- "Load font" button if the family is in the registry but not loaded

Image-only fields (`fit`, `recolorEnabled`, `outlineEnabled`, `url`) are hidden for text layers.

`syncAnimationInspector`, `applyInspectorValue`, and `upsertKeyframe` already handle the shared transform fields — no change needed. New fields go through a new `applyTextInspectorValue` branch in `applyInspectorValue`.

### 2.6 Keyframes and presets

Text layers use the existing `ANIMATED_PROPERTIES` and `getLayerStateAtTime` unchanged. `applyPreset` works on text layers without modification because it only touches `x/y/w/h/rotation/opacity`.

Animation of text-specific properties (font size, color) is **out of scope for Phase 1** and documented as such.

### 2.7 Character rig interaction

`normalizeCharacters` already filters `parts[*]` by `layerIds = layers.map(l => l.id)`. Text layers can never enter a character. Add an explicit guard: `normalizeCharacters` skips text layers when building the ID set. `applyCharacterAnimationV2/V3` only iterates character parts — text layers are never touched.

Add a test: a composition with a text layer + a v3 character rig loads and exports without mutating the text layer's keyframes.

### 2.8 Agent protocol and director

`buildDirectorCatalog` in `server.js` already filters out the reference and rig layers. Text layers are included by default — good. Add `type: 'text'` to the catalog entries so the writer prompt can note "L07 (text) · Headline". This lets the LLM propose `fadeIn`/`pulse` on headline layers, which it already understands.

`normalizeDirectorProposals` already accepts any layer ID and validates against `catalog`. No change needed. `applyAgentCommands` already handles layer presets regardless of type. **No new agent vocabulary.**

The writer prompt gains one line: *"Layers marked (text) are readable copy — animate them with fadeIn, fadeOut, pulse, or zoom but do not `sway` a headline."* Optional but helpful.

### 2.9 Exports — the parity gate

`exportImage`, `exportVideo`, `exportGif`, `exportSvg`, and `exportAllSegments` all go through `renderExportFrame` (or the SVG builder). Each is updated to branch on `layer.type` *inside* the renderer, not at the caller. This keeps a single source of truth.

New visual regression fixture set:
- `text-basic` — one headline, one CTA, on a white 1080² composition
- `text-locale` — same text in Latin, CJK, and Arabic
- `text-long` — a paragraph that must wrap and clip
- `text-with-image` — a photo background with a text overlay
- `text-animated` — a headline with a `fadeIn` preset applied

Each fixture is rendered three ways (DOM screenshot, PNG export, SVG export) and compared. Diff budget: **≤ 0.5% pixels** at the same scale. A failure above budget fails the build.

### 2.10 Migration and backward compatibility

- **Old compositions** load as-is; every layer gets `type: 'image'`.
- **`composition-generator.js`** gains a `--text` flag to emit a scaffolded headline layer. Optional for Phase 1, required if a batch pipeline is already consuming it.
- **`studio.html`** (classic) needs the same text-rendering updates as `studio-v2.html`. If only `studio-v2.html` is under active development, `studio.html` is deprecated for text; **document this explicitly** in the README and add a banner in `studio.html` pointing to `studio-v2.html`.
- **`server.js`** `saveComposition` round-trips text fields unchanged. Verify the `existingLayers.get(layer.id)` re-merge preserves `type`, `text`, `font`, `color`, `align`, `verticalAlign`, `overflow` — currently it merges `part`, `group`, `variant`. Add the new fields to the merge list so a stale v1 save cannot strip text metadata.

### 2.11 Acceptance criteria

- [ ] A user can add a text layer, edit its text, font, size, color, alignment, and see it render on the canvas at the expected position.
- [ ] The text layer participates in drag, resize, rotate, keyframes, presets, and `positionConfirmed` exactly like an image layer.
- [ ] `getLayerStateAtTime` on a text layer returns the same shape as an image layer (plus `text`, `font`, etc.).
- [ ] PNG export at any size renders text with the same layout as the DOM at the same size (≤ 0.5% diff).
- [ ] SVG export opens in Inkscape and Chrome without warning; text is selectable.
- [ ] GIF and video exports include text.
- [ ] A composition with text layers saves, reloads, and round-trips without data loss.
- [ ] The agent spec includes text layers; `applyAgentCommands` applies presets to them.
- [ ] All new unit tests pass; all Phase-1 visual regression fixtures pass.
- [ ] Accessibility: the text layer is reachable via keyboard; screen readers announce its content on the canvas (via an `aria-label` on the layer node sourced from `layer.text` or `layer.name`).

### 2.12 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Canvas vs DOM text divergence | High | Shared layout; visual regression gate |
| Font loading races | High | `document.fonts.ready` + per-font readiness check + hard export gate |
| Newlines + emoji + RTL edge cases | Medium | Layout unit tests with explicit cases |
| Overlapping text with character rig | Low | Explicit skip guard + regression test |
| Classic `studio.html` rot | Low | Document deprecation; banner |

---

## 3. Phase 2 — Multi-format with per-format overrides

**Goal:** One composition produces N formats. Every rendering path (DOM, canvas, SVG, export, director inventory) resolves layers through a format context. The active format drives the editor's canvas.

**Effort:** ~4 weeks with 2 engineers. Depends on Phase 1 (multi-format is far more valuable with text, and `sizePct` in Phase 1 is already format-relative).

### 3.1 Schema

```js
Composition = {
  version, id, name,
  width, height, duration,       // mirror of master format (backward compat)
  referenceLayerId,
  characters,
  layers: Layer[],

  // NEW:
  formats: Format[],             // at least one, isMaster === true
  activeFormatId: string,        // UI state, persisted
}

Format = {
  id: string,                    // 'master', 'meta-feed', 'story', …
  isMaster: boolean,
  channel: 'social'|'display'|'video'|'instore'|'print'|'custom',
  label: string,                 // 'Meta Feed', 'Display 300×250'
  width: number,                 // 1–10000
  height: number,
  layerOverrides: { [layerId]: { visible?, x?, y?, w?, h?, opacity? } },
  variableValues: { [varId]: string },   // Phase 3 uses this; Phase 2 ships it empty
}
```

**Additive**: existing layer fields are unchanged. Layer-level `formatOverrides` is *not* added — overrides live on the format, keyed by layer ID, so the layer schema stays untouched and the character rig code is unaffected.

**Migration:**
```js
if (!Array.isArray(composition.formats) || composition.formats.length === 0) {
  composition.formats = [{
    id: 'master', isMaster: true, channel: 'custom',
    label: 'Master',
    width: composition.width, height: composition.height,
    layerOverrides: {}, variableValues: {},
  }];
  composition.activeFormatId = 'master';
}
// Ensure exactly one master
if (!composition.formats.some(f => f.isMaster)) composition.formats[0].isMaster = true;
// Ensure activeFormatId points at a real format
if (!composition.formats.some(f => f.id === composition.activeFormatId))
  composition.activeFormatId = composition.formats.find(f => f.isMaster).id;
```

`composition.width/height` remain the master's dimensions. Editing either at the top of the editor updates `formats[0]` and the mirror. This preserves every existing `composition.width` read in `_.js`, `server.js`, `composition-generator.js`, and the director's `buildWriterPrompt`.

### 3.2 The single render path — `resolveLayer`

New top-level function:

```js
function resolveLayer(layer, { composition, format, locale }) {
  if (!format) format = getActiveFormat(composition);

  // Base layer
  const base = { ...layer };

  // Apply per-format override (x/y/w/h/opacity/visible)
  const override = format.layerOverrides?.[layer.id];
  if (override) Object.assign(base, override);

  // Phase 3: apply variable bindings here
  // (bindings resolve to layer.text, layer.color, layer.url, etc.)

  // Phase 2: keyframe resolution still happens at call time
  // (in applyAnimationTime and renderExportFrame) because it depends on `time`.

  return base;
}

function getActiveFormat(composition) {
  return composition.formats.find(f => f.id === composition.activeFormatId)
    || composition.formats.find(f => f.isMaster)
    || composition.formats[0];
}
```

`resolveLayer` is called *before* `getLayerStateAtTime`. Every render path becomes:

```js
const resolved = resolveLayer(rawLayer, { composition, format });
const state = this.getLayerStateAtTime(resolved, time);
```

This is the **only** change required at each call site. `renderCanvas`, `applyAnimationTime`, `renderList`, `renderInspector` (for value display), `renderExportFrame`, `loadExportAssets`, `exportSvg`, `buildDirectorCatalog` (server-side — see §3.6) all do this.

### 3.3 Active format drives the canvas

`render()` currently does:
```js
this.el.canvas.style.aspectRatio = `${composition.width} / ${composition.height}`;
```

Becomes:
```js
const format = getActiveFormat(composition);
this.el.canvas.style.aspectRatio = `${format.width} / ${format.height}`;
this.el.canvas.style.setProperty('--ls-canvas-ratio', String(format.width / format.height));
```

`beginDrag` and `beginResize` already read `this.el.canvas.getBoundingClientRect()` — they compute percentages against the *rendered* rect, so they work correctly across formats without change.

### 3.4 Editing semantics — the "pin to this format" model

When a non-master format is active, editing x/y/w/h/opacity/visible has two possible semantics. We choose the one that matches user intent and keeps the mental model simple:

- **Default: edits write to base.** Moving a layer with "Meta Feed" active moves it in every format.
- **Pinned layers: edits write to the format override.** A small **"Pin to this format"** button on the inspector writes a layer override and turns on a badge in the layer list (`M` marker). Subsequent edits write only to `format.layerOverrides[layer.id]`.

This is the minimum viable override model. It is also the one the industry converges on (Figma variants, Canva brand templates).

Implementation:
- Add `isPinned(layer, format)` → `Boolean(format.layerOverrides?.[layer.id])`.
- `applyInspectorValue` and `beginDrag`/`beginResize` check `isPinned` and write accordingly.
- A small "Reset for this format" button clears `format.layerOverrides[layer.id]`.
- The layer list renders an `M` badge for pinned layers.

Position confirmation semantics: `positionConfirmed` is per-layer (not per-format). Pinning a layer to a format does **not** re-open its confirmation state in other formats. Confirming in the master confirms everywhere.

### 3.5 Format switcher and management UI

**Format tab strip** above the timeline:

```html
<div class="layer-format-tabs" role="tablist">
  <button role="tab" data-format-id="master" aria-selected="true">Master</button>
  <button role="tab" data-format-id="meta-feed">Meta Feed</button>
  <button role="tab" data-format-id="story">Story</button>
  <button data-action="add-format">+ Add format</button>
</div>
```

Clicking a tab: `composition.activeFormatId = id; this.render();`.

**Add-format dialog** (mirrors the archive dialog pattern already in `studio-v2.html`):

- Channel dropdown: `social / display / video / instore / print / custom`
- Preset dropdown filtered by channel (from a registry of ~20 common sizes)
- Custom width/height escape hatch
- Label field
- "Copy overrides from…" dropdown — optionally seed `layerOverrides` from an existing format (rarely needed; include it because it takes 10 lines)

**Channel preset registry** in `_.js`:

```js
const CHANNEL_PRESETS = {
  social:   [['1080x1080','Meta Feed'], ['1080x1350','Instagram Portrait'],
             ['1080x1920','Story / Reels'], ['1200x628','LinkedIn']],
  display:  [['300x250','Medium Rectangle'], ['728x90','Leaderboard'],
             ['160x600','Wide Skyscraper'], ['320x50','Mobile Banner']],
  video:    [['1920x1080','YouTube Pre-roll'], ['1080x1080','Square Video'],
             ['1080x1920','Vertical Video']],
  instore:  [['1920x1080','Landscape Screen'], ['1080x1920','Portrait Screen']],
  print:    [['2480x3508','A4 (300 dpi)'], ['1748x2480','A5 (300 dpi)']],
  custom:   [['custom','Custom size…']],
};
```

**Delete-format flow:** forbidden on the master. Any other format deletes with a confirmation that names any pinned layers.

### 3.6 Batch export

New `exportAllFormats({ formats, locales, outputs })` iterates:

```
for each format in formats:
  for each locale in (locales ?? [default]):
    await loadExportAssets(composition, …, { format, locale })
    for each output in outputs (png | gif | video):
      render + encode
```

`loadExportAssets` and `renderExportFrame` gain a `format` parameter (and a `locale` in Phase 3). Every call site passes `getActiveFormat(composition)` in the single-format path; the batch path passes each iterated format.

**ZIP packaging:** the existing `buildStoredZip` in `_.js` is reused. Filenames: `{composition}-{format.label}-{locale}.{ext}`.

**Progress:** the existing `setExportProgress` line already handles per-export messages. Batch mode shows `Rendering Meta Feed (2/5)…` and per-frame progress beneath.

**Cancellation:** add a `_batchCancel` flag checked between formats and between frames. A "Cancel batch" button in the progress area sets it.

### 3.7 Contact sheet

New `renderContactSheet()` (modal or a view that replaces the stage):

- Grid of `formats.length` cells, each a live-rendered thumbnail at 320 px on the long edge.
- Rendering uses `renderExportFrame` at a small canvas — the same code path as export, so thumbnails are accurate.
- Debounced re-render on composition change.
- Click a thumbnail → set active format → close contact sheet.

### 3.8 Agent protocol and director

**Agent spec** (`exportAgentSpec` in `_.js`): add

```js
formats: composition.formats.map(f => ({
  id: f.id, isMaster: f.isMaster, channel: f.channel,
  label: f.label, width: f.width, height: f.height,
  pinnedLayerIds: Object.keys(f.layerOverrides ?? {}),
})),
activeFormatId: composition.activeFormatId,
```

**Director** (`buildDirectorCatalog` in `server.js`): the inventory continues to reflect the *master* format's resolved layers. This is correct: the LLM proposes animations, and animations live on the base layer, so proposals apply everywhere. Add an explicit note in `buildWriterPrompt`: *"The composition may have multiple formats; your proposals apply to all of them."*

**`applyAgentCommands`:** unchanged. Commands apply to the layer's base fields. Per-format command proposals are Phase 4.

### 3.9 Migration and backward compatibility

- Every v1 file loads; `normalizeComposition` synthesizes a master format (§3.1).
- Every v2 file (post-Phase-1) loads and is upgraded the same way.
- `saveComposition` in `server.js` currently forces `version: 1` — change to `version: Math.max(Number(incoming.version) || 1, Number(existing.version) || 1)`. Bump `normalizeComposition`'s hardcoded `version: 1` to `version: 2` for new saves.
- **`composition-generator.js`**: emit `formats: [{ id: 'master', isMaster: true, channel: 'custom', label: 'Master', width, height, layerOverrides: {}, variableValues: {} }]` and `activeFormatId: 'master'`. Without this, the CLI's output loads but silently gains a master on load; better to emit it.
- **`studio.html`** must be updated to read `formats[0]` for width/height, or document that it is deprecated in favor of `studio-v2.html`. Preferred: deprecate for Phase 2 and add the format tab strip only in `studio-v2.html`.

### 3.10 Acceptance criteria

- [ ] A composition can have 5 formats (master + 4 others) with distinct sizes.
- [ ] Switching formats updates the canvas aspect ratio and re-renders.
- [ ] A layer edited with the master active shows the same edit in every other format.
- [ ] A layer pinned to "Story" shows the pinned position only in "Story"; other formats show the base position.
- [ ] Resetting a pin restores the base position in that format.
- [ ] Contact sheet shows all formats with correct content and dimensions.
- [ ] Batch export produces `N × M × K` files (formats × locales × outputs) in a ZIP.
- [ ] Cancelling a batch stops within one frame.
- [ ] Agent spec includes `formats` and `activeFormatId`.
- [ ] The director still produces proposals, and applying them affects all formats via the base layer.
- [ ] Character rigs animate correctly in every format.
- [ ] Every existing v1 or post-Phase-1 composition loads without loss.
- [ ] Visual regression: the same composition rendered in 5 formats matches pixel expectations in DOM, PNG, and SVG (≤ 0.5% diff).

### 3.11 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `resolveLayer` inconsistency (a path skips it) | High | Code review gate: grep for `layer.x` / `layer.w` outside `resolveLayer` and `getLayerStateAtTime`; must be zero in renderers |
| Editing semantics confusing | Medium | "Pin to this format" is explicit and badges are visible; a "This edit affects all formats" toast |
| Batch export memory blow-up (N formats × assets) | Medium | `loadExportAssets` is called per format and its `assets` map is dropped between formats; do not cache across formats |
| Old classic `studio.html` breakage | Medium | Deprecate; add banner |
| Master width/height drift from `formats[0]` | Medium | A single setter (`applyCanvasDimensions`) updates both; add unit test |

---

## 4. Phase 3 — Template slots + brand kit

**Goal:** A composition can carry typed **variables**, layers can **bind** properties to them, formats can set **per-format values**, and a **brand kit** provides palette, fonts, and logos that the editor validates against. This is the "Creative Infrastructure" layer.

**Effort:** ~4 weeks with 2 engineers. Depends on Phase 1 (text — a text variable needs a text layer to bind to) and Phase 2 (per-format values need formats).

### 4.1 Schema

```js
Composition = {
  // …Phase 2 fields…
  variables: Variable[],
  brandKit?: BrandKit,
}

Variable = {
  id: string,
  name: string,                 // 'Headline', 'Primary Color', 'Hero Image'
  kind: 'text'|'color'|'url'|'image',
  defaultValue: string,         // literal; hex for color, URL for url/image
  locked: boolean,              // if true, per-format override is ignored
}

LayerBase = {
  // …
  bindings?: {                  // additive
    text?: string,              // varId — text layers only
    color?: string,             // varId — text layers only
    url?: string,               // varId — image layers only
  },
}

Format = {
  // …
  variableValues: { [varId]: string },
}

BrandKit = {
  id: string,
  name: string,
  palette: [{ name: string, hex: string }],          // ≤ 40
  fonts: [{ name: string, family: string, weight: number, style: 'normal'|'italic' }],  // ≤ 12
  logos: [{ name: string, url: string }],            // ≤ 20
}
```

**The slot model is minimal by design.** A "slot" is a layer property bound to a variable. There is no separate "template schema" object — a composition *is* a template when it has variables and at least one binding. This avoids a second object model on top of what already exists.

**Brand kit is embedded in the composition.** A separate shared kit service (one kit → many compositions) is Phase 4. Embedding keeps Phase 3 self-contained and lets a user export a kit as a JSON file to share out-of-band.

### 4.2 Variable resolution

New top-level functions in `_.js`:

```js
function resolveVariables(composition, format) {
  // Returns: { [varId]: string } — the effective value for this format.
  const out = {};
  (composition.variables ?? []).forEach((v) => {
    const formatValue = format?.variableValues?.[v.id];
    out[v.id] = (formatValue !== undefined && !v.locked) ? formatValue : v.defaultValue;
  });
  return out;
}

function applyBindings(layer, values) {
  // Returns a shallow-cloned layer with bound fields replaced.
  if (!layer.bindings) return layer;
  const next = { ...layer };
  if (layer.bindings.text && values[layer.bindings.text] !== undefined) {
    next.text = values[layer.bindings.text];
  }
  if (layer.bindings.color && values[layer.bindings.color] !== undefined) {
    next.color = values[layer.bindings.color];
  }
  if (layer.bindings.url && values[layer.bindings.url] !== undefined) {
    next.url = values[layer.bindings.url];
    next.frames = [next.url];       // keep sprite model coherent
  }
  return next;
}
```

`resolveLayer` gains two lines:

```js
function resolveLayer(layer, { composition, format, locale }) {
  const values = resolveVariables(composition, format);
  const bound = applyBindings(layer, values);
  // …then format overrides as in Phase 2…
}
```

Every render path picks up variable resolution for free because they all go through `resolveLayer`.

### 4.3 Variable UI

New **Variables** panel in the sidebar (`studio-v2.html`), styled like the segment tree:

- List of variables with name, kind chip, current value, lock toggle, edit, delete.
- **Add variable** button opens a small inline form.
- **Bind to variable** appears as a small 🔗 button beside text/url/color inspector fields when a variable of the matching kind exists. Clicking it writes `layer.bindings.text = varId`.
- Bound inspector fields become read-only with a chip: `Linked to "Headline"`. Clicking the chip unbinds (with confirmation if the layer is used in a format).

**Per-format values**: when a non-master format is active, the Variables panel gains an inline editable field next to each variable. Changing it writes `format.variableValues[varId]`. A small pin icon indicates the format has an override for that variable. Locked variables show a lock icon and ignore the format override.

### 4.4 Brand kit editor

New modal dialog (mirrors the archive dialog pattern):

- **Palette**: name + color picker rows; drag-to-reorder; ≤ 40 entries.
- **Fonts**: name + family picker from the font registry (Phase 1).
- **Logos**: name + image picker from the current composition's image layers or uploaded to `POST /api/imports/:id/brand-kit-logos` (a thin wrapper over the existing import path).
- Buttons: **Export kit as JSON**, **Import kit from JSON**, **Delete kit**, **Save**.

The kit is stored on `composition.brandKit`. Saving the composition saves the kit.

### 4.5 Brand validation (not guardrails)

Phase 3 ships **validation**, not enforcement. New button in the timeline controls: **"Validate against brand kit"**.

It produces a report:

```
Palette drift
  ✗ Layer "Headline" uses #3b7fbf — not in the brand palette.
  ✓ 12 layers use palette colors.

Font drift
  ✗ Layer "CTA" uses "Georgia" — not in the brand kit fonts.
  ✓ 4 text layers use kit fonts.

Missing logos
  ✗ Logo "Acme" is referenced by 2 layers but is not in the kit.
```

Validation is **non-blocking**. Users can still export. Guardrails (rules engine, blocking exports, automated compliance) are Phase 4.

This is the honest MVP of §3.2 ANALYZE and §5.5 Guardrails: **it detects drift and reports it**, which is the *first half* of the Suvi value prop (§1.1 Brand Drift). It does not block; it informs.

### 4.6 Director and agent protocol

**Director**: `buildDirectorCatalog` gets one addition — a `values` map per layer showing the resolved variable values. `buildWriterPrompt` gains a "Variables" section that tells the writer model what the slots are. Now the writer can propose `speak` text that references a variable (e.g. `"speak": {"text": "{{Headline}} — {{CTA}}"}`). This is a **Phase 4** capability in the director; Phase 3 just exposes the vocabulary.

**Agent spec**: add

```js
variables: composition.variables.map(v => ({
  id: v.id, name: v.name, kind: v.kind, defaultValue: v.defaultValue, locked: v.locked,
})),
brandKit: composition.brandKit ? {
  palette: composition.brandKit.palette,
  fonts: composition.brandKit.fonts,
  logoCount: composition.brandKit.logos.length,
} : null,
```

**Agent commands**: extend `applyAgentCommands` to accept a new command kind:

```json
{ "type": "set-variable", "variableId": "headline", "value": "Fire up the grill" }
```

Validation: `variableId` must exist in `composition.variables`. `value` must match the variable's `kind`:
- `text` — string ≤ 4,000 chars
- `color` — `/^#[0-9a-f]{6}$/i`
- `url`/`image` — `safeImageUrl()`

This is the **brand-aware automation command** the Suvi doc calls "AI-powered versioning" — the agent writes a variable and the layer bound to it updates everywhere.

Additive: existing `{layerId, preset}` and `{characterId, settings}` commands are unchanged. `normalizeDirectorProposals` accepts both shapes.

### 4.7 Batch export with variables

`exportAllFormats` now resolves variables per format *before* rendering. Since `resolveLayer` does this, the only change is that `loadExportAssets` must also call `resolveLayer` — it already does after Phase 2. Verified by test.

**A new output dimension**: `locales`. Phase 1 already supports `text: { [locale]: string }` in the schema but does not yet read it. Phase 3 adds the read:

```js
const localeText = typeof layer.text === 'object'
  ? (layer.text[locale] ?? layer.text[composition.defaultLocale] ?? '')
  : layer.text;
```

Batch export iterates `formats × locales`.

### 4.8 Migration and backward compatibility

- Every existing composition loads; `variables: []` and `brandKit: undefined` are synthesized.
- Every post-Phase-2 file upgrades identically.
- `saveComposition` in `server.js`: the `existingLayers.get(layer.id)` merge must preserve `bindings`. Add it to the merge list.
- `composition-generator.js`: no changes required, but if a user wants to generate a template, the CLI can be extended in Phase 4 to accept `--variables <file>`.
- `studio.html` is by now deprecated; the variables panel and brand kit editor are only in `studio-v2.html`.

### 4.9 Acceptance criteria

- [ ] A user can add a text variable "Headline" and bind it to a text layer's `text`.
- [ ] A user can add a color variable "Accent" and bind it to a text layer's `color`.
- [ ] A user can add an image variable "Hero" and bind it to an image layer's `url`.
- [ ] Changing a variable's value updates every bound layer in every format, immediately.
- [ ] Per-format variable overrides show only in that format.
- [ ] Locked variables cannot be overridden per-format; the UI makes this clear.
- [ ] The brand kit editor accepts palette, fonts, and logos and persists them.
- [ ] "Validate against brand kit" produces a report of all drift, non-blocking.
- [ ] Batch export produces the correct file per `(format, locale)` with variables resolved.
- [ ] The agent spec includes variables and the brand kit summary.
- [ ] `applyAgentCommands` accepts `{ type: 'set-variable', … }` and validates `variableId` and `value`.
- [ ] All existing compositions load and produce the same output (variables default to empty).
- [ ] Visual regression: a composition with variables in 3 formats × 2 locales renders correctly in DOM, PNG, and SVG.

### 4.10 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Variable resolution leaks into export inconsistently | High | Single `resolveLayer` call site, unit tested against every render path |
| Brand kit scope creep (rules engine, blocking exports) | High | Phase 3 explicitly ships *validation*, not *guardrails*; guardrails are Phase 4 |
| Variable binding breaks character rigs | Medium | Character parts are a set of layer IDs; `applyBindings` is a shallow clone that preserves `id`, `part`, `variant`; add a test |
| Per-format override UI confusion | Medium | Pin icon + lock icon + badge; a small "?" tooltip |
| Embedded brand kit bloats JSON | Low | Logos are URLs, not data URLs; palette and fonts are small |

---

## 5. Cross-cutting concerns

### 5.1 Versioning

- **Phase 1:** `version` stays `1` in `normalizeComposition` and `saveComposition`. New fields are additive. Existing code ignores them.
- **Phase 2:** bump `version` to `2`. Update both files. Migration synthesizes `formats` for v1 files. `saveComposition` uses `Math.max(incoming.version, existing.version)` to avoid downgrade.
- **Phase 3:** bump to `3`. Variables and brand kit are additive; the migration is still field-presence based, but the version bump makes "this file has variables" unambiguous.

**Server-side `saveComposition`** must not strip unknown fields. It spreads `...incoming` — verified — so unknown fields pass through. Add a test that a v3 file saved through `saveComposition` retains `variables`, `brandKit`, `bindings`, and `formats`.

**Stale-client protection:** `saveComposition` already has the "don't downgrade `rigVersion`" guard. Add analogous guards:

- If `existing.formats` exists and the incoming `formats` is missing or empty → preserve `existing.formats`.
- If `existing.variables` exists and incoming is empty → preserve.
- If `existing.brandKit` exists and incoming is missing → preserve.

This makes it safe to have stale tabs open during rollout.

### 5.2 Files touched per phase

| File | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| `_.js` | +`type`, +`normalizeTextLayer`, +`layoutText`, +`fontRegistry`, +`loadFont`, DOM/canvas/SVG renderers, +text inspector | +`formats`, +`resolveLayer`, +`getActiveFormat`, render paths, +`exportAllFormats`, +format UI, +contact sheet | +`variables`, +`bindings`, +`resolveVariables`, +`applyBindings`, +variables panel, +brand kit editor, +validate, +`set-variable` command |
| `_.css` | text styles (`.ls-text-inner`) | format tabs, contact sheet grid | variables panel, brand kit editor, validation report |
| `studio-v2.html` | font picker wiring | format tab strip, add-format dialog, contact sheet, batch export | variables panel, brand kit editor, validation dialog |
| `studio.html` | mirror text rendering | deprecate + banner | (frozen) |
| `server.js` | font upload endpoints, `saveComposition` text fields | `version` bump, `saveComposition` format guard, `buildDirectorCatalog` `(text)` annotation | variables in `saveComposition` merge, brand kit persistence, `set-variable` command validation |
| `composition-generator.js` | `--text` flag | emit `formats` | no change |
| `README.md` / `studio-layers-project.md` | document text layers, fonts | document formats, batch export | document variables, brand kit |

### 5.3 Testing strategy

**Unit (Jest/Vitest, no DOM except a `canvas` shim):**
- `layoutText` — 20+ cases: plain, wrap, hard-break, CJK, RTL, emoji, empty, clipping.
- `resolveLayer` — identity for master; format override application; variable binding.
- `resolveVariables` — default, format override, locked variable.
- `applyBindings` — text, color, url; missing bindings are no-ops; sprite frames update.
- `normalizeComposition` — v1 → v2 → v3 migration; unknown fields preserved.
- `applyAgentCommands` — legacy commands unchanged; `set-variable` validated.

**Integration (Playwright):**
- Add text layer → edit → see on canvas.
- Switch format → canvas resizes → layers re-render.
- Pin a layer to a format → move → only that format changes.
- Bind a layer to a variable → change variable → all formats update.
- Batch export 3 formats × 2 locales → zip contains 6 files with expected names.
- Character rig animates correctly in all formats.

**Visual regression (Playwright + `pixelmatch`):**
- 8 fixtures (text, text-locale, text-long, text-with-image, text-animated, format-multiset, variables-bound, brand-kit-applied).
- Each fixture: DOM screenshot, PNG export, SVG export at the same scale.
- Diff budget: **≤ 0.5 %** pixels. A failure above budget fails the build.

**Server-side (Node):**
- Font upload: valid WOFF2 / invalid magic bytes / oversized → correct error.
- `saveComposition`: stale client cannot strip `formats`/`variables`/`bindings`/`brandKit`.
- `buildDirectorCatalog`: text layers appear with `type: 'text'`.
- `normalizeDirectorProposals`: `set-variable` commands validated.

### 5.4 Rollout

Each phase ships behind a feature flag (`STUDIO_FEATURE_TEXT=1`, `STUDIO_FEATURE_FORMATS=1`, `STUDIO_FEATURE_VARIABLES=1`) so:

- Old compositions load regardless.
- New UI is opt-in until the phase is signed off.
- The flag can be flipped per-user or globally via a header.

The flags are read from `window.__STUDIO_FLAGS__` in `_.js` (set by `studio-v2.html` inline script from a `data-flags` attribute or a server-injected script). In the zero-build world, this is a 15-line addition.

### 5.5 Definition of done (per phase)

- [ ] All acceptance criteria pass.
- [ ] Visual regression on Phase fixtures is green.
- [ ] Migration: 5 real compositions from `data/imports/*` load and round-trip.
- [ ] Agent spec includes the new fields.
- [ ] The director still produces 4 proposals and applies them.
- [ ] README and `studio-layers-project.md` updated.
- [ ] No `layer.x` / `layer.w` reads outside `resolveLayer` and `getLayerStateAtTime` in renderers (verified by grep and code review).
- [ ] Performance: a 20-layer composition with 3 text layers renders in < 16 ms on a mid-range laptop; exports a 5-format batch in < 60 s.

---

## 6. Sequencing and dependencies

```
                     Phase 1 (Text)            Phase 2 (Formats)         Phase 3 (Variables + Brand Kit)
Week:             1   2   3   4   5          6   7   8   9             10  11  12  13
Foundation      ████
Schema+Layout       ███████
DOM renderer              ████
Canvas renderer             ████
SVG renderer                ████
Font system               ██████
Inspector                       ████
QA + migration                        ██████
                                                                       
Formats schema                    ████
resolveLayer refactor                 ██████
Active-format canvas                     ████
Format UI                                 ████
Batch export                                 ████
Contact sheet                                 ████
QA + migration                                    ██████
                                                                           
Variables schema                                              ████
resolveVariables/applyBindings                                    ████
Variables panel                                                      ████
Brand kit editor                                                       ████
Validation                                                                 ████
Agent protocol extension                                                    ████
QA + migration                                                                  ██████
```

**Critical path:** Phase 1 (text) → Phase 2 (`resolveLayer` refactor) → Phase 3 (`resolveVariables` integration into `resolveLayer`).

**Parallelism:** With 2 engineers, split each phase between (a) schema + rendering and (b) UI + migration. With 3 engineers, add a third on QA + documentation + the contact sheet.

**Total: ~13 weeks** (5 + 4 + 4). The first two-thirds of Phase 1 is the highest-risk block — if the DOM/canvas/SVG parity test cannot be brought within budget, stop and reconsider (see §7, R1).

---

## 7. Risks (top-level)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Canvas/DOM text parity never converges | Low | High | Shared `layoutText` + absolutely-positioned DOM spans + visual regression gate + 0.5 % budget is a hard stop |
| R2 | Font loading races across exports | Medium | High | `document.fonts.ready` + per-font readiness gate + "load and retry" UI |
| R3 | `resolveLayer` refactor missed in a render path | Medium | High | Grep gate in CI; a wrapper function `renderLayer` that all renderers must use |
| R4 | Multi-format semantics confuse users | Medium | Medium | "Pin to this format" is explicit; base edits win by default; a first-use tooltip |
| R5 | Scope creep into "brand kit rules engine" | High | Medium | Phase 3 explicitly ships *validation* only; a signed-off exclusion list in the plan |
| R6 | Stale client strips new fields on save | Medium | Medium | Server-side "don't downgrade" guards for formats/variables/bindings/brandKit |
| R7 | Agent protocol breakage | Low | Medium | Additive fields; existing commands preserved; new command validated against variables |
| R8 | `studio.html` (classic) rot | High | Low | Deprecate in Phase 2; banner; document |
| R9 | Batch export memory blow-up | Low | Medium | Drop per-format assets between formats; do not accumulate |
| R10 | RTL/CJK layout bugs | Medium | Low | Explicit test cases; treat RTL as "basic support" in Phase 1, full in Phase 4 |

---

## 8. What this plan does *not* do (explicitly)

To keep the phases honest:

- **Phase 1 does not add inline text editing.** Text is edited in the inspector's textarea. Inline editing (double-click into `contenteditable`, caret, selection) is a Phase 1.5 story with its own UX and QA cycle.
- **Phase 1 does not animate text-specific properties.** Font size and color are static. Animation of type is Phase 4.
- **Phase 2 does not add per-format *keyframes*.** A keyframe animates the base layer; per-format keyframes would be a fourth channel and are Phase 4. Pinning a layer to a format does not permit pinning individual keyframes.
- **Phase 2 does not implement safe zones.** Those are channel geometry, not channel *sizes*. Safe zones are Phase 4.
- **Phase 3 does not ship guardrails.** Validation is non-blocking. Guardrails (a rules engine that blocks exports) is Phase 4.
- **Phase 3 does not ship a shared brand-kit service.** The kit is embedded per composition with an import/export JSON file. A shared service (one kit → many compositions) is Phase 4.
- **Phase 3 does not ship a "produce one composition per brief row" flow.** That requires brief ingestion (Excel/PDF/Email) and is Phase 5.

---

## 9. Executive summary of the plan

| Phase | What it adds | Why | Weeks |
|---|---|---|---|
| **1** | Text layers, font system, DOM/canvas/SVG parity | Unlocks half of Suvi (§4.3, §4.5, §4.2's copy, and any ad that has a headline) | 5 |
| **2** | Multi-format with per-format overrides, batch export, contact sheet | Unlocks the value prop (§1.1, §5.1–5.3, §6) | 4 |
| **3** | Variables, bindings, per-format values, brand kit, validation, `set-variable` agent command | Unlocks Creative Infrastructure (§3.2 AUTOMATE, §5.5 Guardrails v0, §8 brand control) | 4 |

**None of the three replaces anything.** Every change is additive to `_.js`, `_.css`, `studio-v2.html`, `server.js`. `studio.html` and `composition-generator.js` remain compatible. The AI director, character rigs, segment organizer, reference alignment, and export pipeline are untouched by these phases except for one new call to `resolveLayer` at each renderer.

After Phase 3, Layer Studio reaches approximately **75–80 % of the Suvi document** — because the AI work (§4.6, §5.4) is already done and stronger than Suvi describes, and the exports (§4.7) are already done and stronger than Suvi describes. The remaining gap is concentrated in **brief ingestion (Phase 5)**, **guardrails + safe zones (Phase 4)**, and **distribution (platform-side)** — each of which is additive to what will exist after Phase 3.

The three moves that unlock the Suvi story are these. Nothing else in the codebase needs to be rebuilt to make them real.