# Testing

Four suites: three Node unit/integration suites, three Chromium harnesses
(one of which is the visual gate). No install step for the Node suites.

---

## 1. Quick reference

```bash
npm test                  # 134 Node tests
npm run test:smoke        # 68 checks, Layer Studio in Chromium
npm run test:asset-studio # 57 checks, Asset Studio in Chromium
npm run test:visual       # 8 fixtures, 11 renders, visual gate
npm run test:all          # everything (slow: real-time video, three browsers)
```

Raw equivalents:

```bash
node --test "tests/*.test.js"
node tests/smoke.js
node tests/asset-studio.js
node tests/visual.js
node tests/visual.js --report      # report only, never fail the process
```

### Prerequisites

| Suite | Needs |
|---|---|
| Node suites | Node ≥ 22.6 (`node --test` glob support) |
| Chromium harnesses | Chrome at `/Applications/Google Chrome.app/…` (override with `CHROME_PATH`) **and** the Playwright module |
| Visual gate | Same as above |

The harnesses `require()` Playwright from a machine path by default:

```
/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright
```

Override with `PLAYWRIGHT_PATH=/path/to/playwright`. This is the one external
test-only dependency; the application itself has none.

---

## 2. Node suites (`node --test`)

| File | Covers |
|---|---|
| `tests/core.test.js` | Schema normalisers, text layout, formats, overrides, variables/bindings, safe zones, guardrails, brief parsing and row composition |
| `tests/server.test.js` | Server guards and stores: saveComposition merge rules, font upload validation, brief parsing (CSV + real `.xlsx`), brand kits, director catalog, ZIP helpers, import-media privacy, optional H.264 transcode |
| `tests/brand.test.js` | Brand packs, the DOCX reader, kit mapping, template compositions (print + animated digital), saved-template publish/open/delete |
| `tests/generator.test.js` | The CLI in scaffold and brief modes, invalid rows, usage errors |

Fixtures live in `tests/fixtures/` (a 3-row `.xlsx` campaign brief). The
suites use `node:test` and `node:assert`; they write only to temp
directories.

**Behaviour worth knowing** (all covered):

- `saveComposition()` merges a stale client: it keeps the highest version and
  preserves formats, variables, brand kit, text metadata/bindings and the
  Phase-4 fields.
- An explicit `bindings: {}` is an intentional unlink, not a stale payload.
- Font uploads are validated by magic bytes, not extension.
- Brand kit ids and payloads are validated; deleting one 404s afterwards.
- A shared kit validates a composition that has no embedded kit.

---

## 3. Chromium harnesses

All three follow the same pattern:

1. Pick a random port.
2. Spawn `node server.js` with `PORT`/`HOST`.
3. Wait for `/api/health`.
4. Launch Chrome through Playwright.
5. Drive the real UI, asserting as they go.
6. Collect failures, screenshot, close, exit non-zero if anything failed.

They print a checklist (`✓` / `✗`) and a final count. A console error or page
error in the browser counts as a failure.

### `tests/smoke.js` — Layer Studio (68 checks)
Drives the real studio through the phases:

- adds a text layer and compares the DOM ink box with the canvas export and
  the SVG;
- exercises locales, formats, pinning, the contact sheet;
- downloads a PNG and a formats ZIP;
- binds text and image variables, validates against the brand kit;
- replays the agent protocol;
- loads a brief, previews a row, exports it;
- loads a legacy composition, toggles safe zones, attaches a shared kit,
  triggers a blocking guardrail and confirms the export is refused;
- asserts zero browser errors.

Writes `_dev/screenshots/studio-smoke.png`.

### `tests/asset-intel.test.js` — asset contract (8 checks)

Normalisation, operation vocabulary, consent, screen-only print blocking,
the page-DPI rule, palette fit, pHash distance and tabular row parsing.

### `tests/social-intel.test.js` — social reading (4 checks)

Channel/reputation/theme/voice normalisation, honest empty profiles, brand
matching across slug drift, and thin-sample labelling.

### `tests/voice-design.test.js` — voice agent (3 checks)

Exactly two distinct complete proposals, refusal to clone one direction into
two, and the audition payload’s composed instruct/sample.

### `tests/crawler.test.js` — intake safety (7 checks)

Covers the crawler service contract without network I/O: readiness shape,
empty search rejection, private/non-http target rejection, missing run
fields, group size bounds, long Google Maps profile URLs, and invalid run ids. The full crawl is exercised
manually and via the Asset Studio harness after import.

### `tests/asset-studio.js` — final assets (57 checks)
Walks the gate and the workspace: five brand groups, all eleven categories
and 50 designs, palette/type/image/motif/copy changes, tabular wine and
allergen copy, the carousel navigator and numbered slide downloads, screen/
thermal export gating, a die-cut PDF with a vector cut line, large-format dpi
defaults, the identity drawer, saved assets, a full-resolution PNG, the CMYK
print pack with trim/bleed boxes and the safe-zone check, group switching
with uploaded fonts, and no horizontal overflow at 1600 px.

Writes `_dev/screenshots/asset-studio-smoke.png`.

### `tests/visual.js` — the visual gate

For every fixture it renders the **same composition three ways** at the same
pixel size:

| Surface | How |
|---|---|
| DOM | `page.locator('#layerCanvas').screenshot()` |
| PNG | `studio.renderExportFrame()` into a canvas of the same size |
| SVG | `studio.exportSvg()` rasterised through an `<img>` |

Then it compares the pixel ratios (shift-tolerant, ±1 px best alignment) and
the **ink centroid** and size.

| Comparison | Budget | Why |
|---|---|---|
| PNG ↔ SVG | 1.0 % | Both are our own renderers; different rasterisers still differ |
| DOM ↔ export | 3.5 % | Browser text rasterisation differs sub-pixel |
| ink centroid | 2.0 % (size 3.0 %) | Structural check: glyphs are a minority of pixels, so a shift barely moves a ratio but moves the centroid immediately |

Fixtures (`8`, up to three formats each → 11 renders): `text-basic`,
`text-locale`, `text-long`, `text-with-image`, `text-animated`,
`format-multiset` (master/story/leaderboard), `variables-bound`
(master/story), `brand-kit-applied`.

The gate is **negative-tested**:

- making `renderCanvas` skip `resolveLayer()` (the R3 risk) moves the ink
  centroid to 12 % and trips the pixel budget on `variables-bound [story]`;
- dropping `letter-spacing` from the SVG export alone pushes `text-basic` to
  2.30 % on PNG↔SVG.

Both fail the build. `--report` prints the table without a non-zero exit.

Failing pairs write a red diff to `_dev/visual/` (ignored).

---

## 4. What is not covered by automation

- Brand-pack *import* of a new ZIP (the packs under `data/` are exercised,
  the importer is covered by `brand.test.js` at the module level).
- Ollama-dependent features: the director and the segment organiser are
  manual-tested (they need models and take a minute per call).
- Cross-browser behaviour. Chrome is the target; the app uses standard APIs
  (Safari/Firefox work for editing and PNG/SVG, but video is
  browser-dependent).
- Print output beyond the PDF structure assertions (no rip/preflight).

---

## 5. Adding a test

| Change | Add to |
|---|---|
| A schema/format/variable/guardrail rule | `tests/core.test.js` |
| A save/merge or API guard | `tests/server.test.js` |
| A brand-pack or template behaviour | `tests/brand.test.js` |
| A CLI flag or brief behaviour | `tests/generator.test.js` |
| A user-visible studio flow | `tests/smoke.js` (follow the existing `ok()`/`fail()` style) |
| A layout or render change | a fixture in `tests/visual.js` (and re-baseline mentally: the gate compares surfaces, not against stored images) |

The visual gate has **no golden images** — it asserts that the three
renderers agree with each other, so it does not need re-baselining when a
design changes, only when the renderers stop agreeing.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find module …/playwright` | Set `PLAYWRIGHT_PATH` to a Playwright install |
| `the studio server did not start` | Port collision or a crash on boot; run `node server.js` manually |
| Chrome not found | Set `CHROME_PATH` |
| Smoke fails on fonts | A test font was not served; check `data/fonts/` |
| Visual ratios suddenly high | A renderer bypassed `resolveLayer()` / `layoutText()`, or a font fell back |
| `--report` shows failures but exit 0 | Intended: report mode never fails the process |
