# studio-layers

A zero-build, zero-dependency studio for turning **layered artwork** and
**brand identities** into animated scenes, print-ready brand assets, and
agent-drivable templates.

Three browser surfaces share one brand-data model, one backend and the same
no-build approach. The two Layer Studio pages also share one composition
model and one render path. Nothing needs installing: the app is hand-written
HTML/CSS/JS, the server is the Node standard library, and the shared logic
runs unchanged under Node for tests.

---

## The three surfaces

| Surface | URL (after `npm start`) | What it is for | Doc |
|---|---|---|---|
| **Layer Studio v2** | `/` or `/studio-v2.html` | Compose, animate and export layered scenes and templates. Segments, keyframes, presets, text, formats, variables, characters, AI animation ideas. | [layer-studio.md](docs/layer-studio.md) |
| **Asset Studio** | `/asset-studio.html` | Produce final, on-brand artwork fast: flyers, menus, vouchers, cards, social, signage, packaging and compliance labels, with print- and screen-ready output. | [asset-studio.md](docs/asset-studio.md) |
| **Brand identity** | sidebar of the studio | Import a brand-kit ZIP, read the Word guides, browse palette/type/logos/guidelines and generate starter templates. Also available as a drawer inside Asset Studio. | [brand-packs.md](docs/brand-packs.md) |

Two more entry points exist and are documented but secondary:
`/studio.html` is the **classic, frozen** Layer Studio (layers + animation
only), and the CLI (`composition-generator.js`) builds compositions and
brief-driven batches without a browser.

---

## Quickstart

```bash
node server.js            # or: npm start
# → http://127.0.0.1:8008/            Layer Studio v2
# → http://127.0.0.1:8008/asset-studio.html
```

`PORT=8010 node server.js` moves it. The static pages also open from
`file://`, but **alignment, video export and every API-backed feature need
HTTP** (browsers block canvas pixel readback and `fetch` on `file://`).

Requirements: Node ≥ 22.6 for the test runner (glob support in `node --test`),
Chrome for the browser test harnesses (plus a Playwright module — see
[testing.md](docs/testing.md#1-quick-reference)). Optional:
[Ollama](https://ollama.com/) for the local vision features. Application
modules: none.

---

## What you can do

| Capability | Use it when | Where | Details |
|---|---|---|---|
| Layered scene animation | You have PNG cut-outs and want motion, parallax, sprites | Layer Studio | [layer-studio.md](docs/layer-studio.md) |
| Segment import + auto-align | You have a segments ZIP and the assembled image | Layer Studio → *Import ZIP + image* | [layer-studio.md](docs/layer-studio.md#3-projects-and-imports) |
| 19 animation presets + keyframes | A layer needs life in one click, or exact timing | Inspector / Keyframes | [layer-studio.md](docs/layer-studio.md#6-animation) |
| Character rigs (face, eyes, speech) | A portrait needs blinks, gaze, expressions, lip-sync | Inspector → Character | [layer-studio.md](docs/layer-studio.md#character-rigs) |
| Multi-format templates | One design must fit feed, story, leaderboard, print | Format bar / Variables | [layer-studio.md](docs/layer-studio.md#7-formats-and-templates) |
| Typed template variables | Copy, colours or images should be swapped per channel | Variables panel | [layer-studio.md](docs/layer-studio.md#7-formats-and-templates) |
| Brief ingestion | One CSV/XLSX row per creative → N exports | Tools → *Brief…* or CLI | [api-and-cli.md](docs/api-and-cli.md#5-briefs-in-detail) |
| Brand packs + guides | You have a scraped brand-kit ZIP with Word guides | Brand identity | [brand-packs.md](docs/brand-packs.md) |
| Starter brand templates | A new brand needs a menu/card/flyer/voucher in seconds | Brand identity → Templates | [brand-packs.md](docs/brand-packs.md#6-starter-templates) |
| Final brand assets | You need a finished social post or print PDF, not a scene | Asset Studio | [asset-studio.md](docs/asset-studio.md) |
| Signage, packaging, labels | A-boards, screens, stickers, coasters, allergen matrices, thermal prep labels | Asset Studio | [asset-studio.md](docs/asset-studio.md#4-categories-and-designs) |
| Screen and die-cut output | A screen-only design needs PNG/JPG, or a sticker needs a cut line | Asset Studio | [asset-studio.md](docs/asset-studio.md#export-profile) |
| Print pack | CMYK PDF with bleed, trim, crop marks, safe-zone preflight | Asset Studio → *Print pack* | [asset-studio.md](docs/asset-studio.md#print-pack) |
| AI animation director | You want project-specific motion ideas from the final image | Layer Studio → *Animation ideas* | [layer-studio.md](docs/layer-studio.md#10-ai-assistance) |
| Segment organiser | Cut-out names are meaningless (`image-042.png`) | Layers → *Organize with AI* | [layer-studio.md](docs/layer-studio.md#10-ai-assistance) |
| Agent protocol | An LLM should direct the scene or drive a character | `exportAgentSpec` / `applyAgentCommands` | [agent-protocol.md](docs/agent-protocol.md) |
| Safe zones + guardrails | Exports must respect channel chrome and brand rules | Tools → *Validate brand* | [layer-studio.md](docs/layer-studio.md#8-safe-zones-and-guardrails) |

A single end-to-end tour, with use cases and inputs/outputs, lives in
[capabilities.md](docs/capabilities.md).

---

## Repository map

```
studio-layers/
├── studio-v2.html          ← Layer Studio: the current studio
├── studio-v2.js            ← its page behaviour (tree, zoom, organizer, saved)
├── studio.html             ← classic studio (frozen, banner in page)
├── asset-studio.html       ← final-asset surface
├── _.css                   ← shared Layer Studio styles
├── _.js                    ← Layer Studio engine (single IIFE, ~9.5k lines)
├── studio-core.js          ← shared schema + the one render path (browser + Node)
├── brand-identity.css/.js  ← Brand identity workspace (dialog + gallery)
├── brand-pack.js           ← brand-pack schema, kit mapping, template builders
├── brand-docx.js           ← zero-dependency Word guide reader
├── studio-minimal/
│   ├── studio-minimal.css  ← compact top bar + one-at-a-time panels
│   └── studio-minimal.js   ← panel toggles
├── asset-studio/
│   ├── app.js              ← brand adapter, controls, saved assets, exports
│   ├── app.css
│   ├── categories.js       ← 11 categories, 50 designs
│   ├── engine.js           ← brand-aware canvas renderer + motif library
│   ├── print.js            ← CMYK PDF, bleed/trim boxes, crop marks
│   └── vendor/qrcode.min.js
├── server.js               ← zero-dependency backend (static + JSON API)
├── composition-generator.js← CLI: segments → .composition.json, briefs → batches
├── agent-prompt.md         ← system prompt for the animation agent
├── docs/                   ← this documentation set
├── tests/                  ← Node suites + Chromium harnesses
├── tools/                  ← one-off asset/rig/preview pipelines (Beards)
├── _dev/                   ← research, plans, screenshots (not shipped)
└── data/                   ← local studio state (git-ignored)
```

`data/` is **your work, not the project**: imported ZIPs, saved
compositions, brand packs, shared kits and uploaded fonts. It is ignored by
git; back it up like any other document folder.

---

## Documentation

| Document | Read it for |
|---|---|
| [capabilities.md](docs/capabilities.md) | The full capability catalogue: what exists, when to use it, inputs and outputs, and four end-to-end recipes |
| [layer-studio.md](docs/layer-studio.md) | Every panel, control and workflow in Layer Studio v2 (plus the classic page) |
| [asset-studio.md](docs/asset-studio.md) | Asset Studio: gate, categories, controls, saved assets, PNG/print/print-pack |
| [brand-packs.md](docs/brand-packs.md) | Brand-kit ZIP structure, what the importer reads, identity UI, templates, brand kits |
| [architecture.md](docs/architecture.md) | Module boundaries, data model, single render path, storage layout |
| [agent-protocol.md](docs/agent-protocol.md) | `layer-studio/agent/v1`: spec shape, commands, presets, character control |
| [api-and-cli.md](docs/api-and-cli.md) | Every endpoint, the CLI, briefs, limits and environment variables |
| [testing.md](docs/testing.md) | Node suites, Chromium harnesses, the visual gate, and how to add a test |
| [history.md](docs/history.md) | How the project got here, what changed, where the old plans live |

---

## Verify a checkout

```bash
npm test                  # 104 Node tests: schema, render path, server guards, CLI
npm run test:smoke        # 68 checks in Chromium against the real studio
npm run test:asset-studio # 57 checks in Chromium across all five brand groups
npm run test:visual       # 8 fixtures × formats, DOM vs canvas vs SVG
npm run test:all          # everything (slow: real-time video, three Chromium runs)
```

The browser harnesses start `server.js` on a random port and drive your
installed Chrome (`CHROME_PATH` overrides it). They write screenshots to
`_dev/screenshots/` and diffs to `_dev/visual/`, both ignored.

---

## Principles

- **No build step, no dependencies.** Browser-native APIs and the Node
  standard library only. `package.json` contains scripts, not packages.
- **One render path.** Screen, PNG, GIF, video, SVG, contact sheet, batch and
  agent exports all resolve layers through `resolveLayer()` and lay out text
  through `layoutText()`. See [architecture.md](docs/architecture.md).
- **Nothing is a special case.** Brand templates are ordinary v3
  compositions; generated keyframes are ordinary keyframes. Every feature
  therefore works on every artefact.
- **Fail loudly.** A missing font or a blocked export reports why instead of
  silently substituting.

Not a runtime engine (no game loop ships), not an image generator, and not a
replacement for a printer's own preflight.
