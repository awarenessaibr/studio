# Business Asset Intelligence — implementation proposal

**Status:** proposal, not built. This is the engineering companion to
[`BusinessAssetInteligence-start.md`](../BusinessAssetInteligence-start.md):
that document makes the market case, this one makes the code case.

It answers four questions:

1. Which parts of the brief are already true of this repository?
2. Which parts assume UI or infrastructure that does not exist?
3. What exactly gets built, in what order, against which files?
4. How do we know it works, and what is it deliberately not?

---

## 1. Executive summary

The thesis is right: the repository has the two ends of the chain — brand
packs encode what a brand *is*, Asset Studio produces what the business
*needs* — and it has no memory of what the business already *owns*. BAI is
the missing middle. Three findings from auditing the code change the shape
of the plan, though:

1. **Asset Studio is slot-based, not a compositor.** Each of the 50 designs
   is a fixed draw function with optional photo, logo and text slots. There
   is no free placement. BAI can feed the photo slot, the pack logo slot and
   the copy fields; arbitrary placement is Layer Studio's job, not Asset
   Studio's. The brief's "select a BAI asset and place it in a design"
   overstates what the surface can do.
2. **There are already two asset stores, and BAI must not become a third.**
   Pack files in `data/brand-packs/<id>/files/…` are authoritative and
   immutable; Asset Studio saved designs live in `localStorage` and are
   per-browser. BAI should *reference* pack bytes and *instrument* saved
   designs, copying bytes only for genuinely new uploads.
3. **There is no OCR, no embedding model, no OAuth, no auth.** Classification
   must therefore be tiered — deterministic metadata first, optional LLM
   vision second, human verification last — and the channel story must start
   with upload plus the existing crawler, not with WhatsApp, Drive and email
   connectors.

**Proposal in one sentence:** add a code-owned asset schema
(`asset-intel.js`), a reference-first asset store (`data/assets/`), a review
queue and a small `/library.html` surface, then wire the *existing* Asset
Studio photo slot, text fields and print gate to it — in four increments,
with no new runtime dependencies and no second compositor.

| In scope | Out of scope (see §14) |
|---|---|
| Asset record + taxonomy + capability declaration | WhatsApp Business API, Drive/Dropbox OAuth, inbound email |
| Reference-first store, indexing existing packs | Multi-user auth, roles, enforceable rights management |
| Tiered classification, dedupe, review queue | Visual embedding search, background removal/segmentation |
| Resize / crop / recolour / extract-rows operations | Video/audio transcription, OCR at scale |
| Asset Studio photo + text + print-gate integration | Freeform asset placement in Asset Studio |
| Library page, identity-drawer health, usage events | Enterprise DAM workflows (approvals, campaigns, portals) |

### What this proposal adds beyond the brief

- **A seed path.** The brief starts with an empty library; this starts by
  indexing the 191 assets already inside the five shipped packs, so the
  feature is useful on its first run.
- **A working surface.** The brief names a review queue but no place to do
  the reviewing; this adds `/library.html` and keeps Asset Studio a design
  tool.
- **A contract, not a wish.** Classes, operations, rule codes and caps are
  code-owned and unit-tested, so the UI cannot promise an operation the build
  cannot execute.
- **An enforcement mechanism.** "Refuse to export" becomes
  `evaluateUsage()` driven by the page's own `mm`/`dpi` metadata and six
  hard codes.
- **A reuse path through the crawler.** Channel ingestion starts with the
  crawler that already exists, not with three connectors that do not.
- **Numbers, not a dashboard.** Four health measures, chosen so they can be
  wrong — which is the only way they prove anything.

---

## 2. What already exists (verified, not assumed)

| Capability | Where | What BAI reuses |
|---|---|---|
| Brand-pack schema, normalisers, caps | `brand-pack.js` (`normalizeBrand` 475, `normalizeBrandPack` 521) | The record shape, text clamps, id patterns, `normalize*` discipline |
| Pack import, brand detection, asset kinds | `server.js` (`createBrandPackImport` 3002, `brandFromDirectory` 2773, `assetKind` 2740, `writeBrandAsset` 2754) | ZIP handling, logo vs photography vs specimen classification, safe file names |
| Pack file serving with traversal guard | `server.js` 3606 | The exact route/storage pattern for asset variants |
| Pack summary / list / delete | `server.js` 2483, 2522, 2543 | Summary shape, cascade discipline |
| Shared kits and template builders | `brand-pack.js` (`brandKitFor` 550, `paletteRoles` 749, `createTemplateComposition` 1557) | Palette roles and brand-fit inputs |
| 11 categories / 50 designs | `asset-studio/categories.js` | The slot model, size presets, `mm`/`dpi`/`print` metadata |
| Per-design export profile | `asset-studio/app.js` (`currentProfile` 635) | The gate BAI extends from design level to asset level |
| Print specs, CMYK PDF, preflight | `asset-studio/print.js` (`resolveSpec` 54, `checkBoxes`, `pageMetrics`) | Physical page size and DPI for asset-level rules |
| Tabular copy parsers | `asset-studio/engine.js` (`parseItems` 819, `parseRows` 917) | The exact text syntax extraction must emit |
| Saved designs already carry image sources | `asset-studio/app.js` (`saveAsset` 2685, `restoreSaved` 2738) | Adding `assetId` to `photoSources` needs no new storage |
| Crawler ZIP contract + content packs | `scripts/crawler-combined.py`, `docs/crawler.md` | Channel ingestion and menu/hours extraction precedent |
| Local LLM client and JSON-mode calls | `server.js` (`callOllama` 1629) | Vision classification with no new dependency |
| Atomic writes, body caps, path guards | `server.js` (`writeFileAtomic` 788, limits 47–70) | Store safety |
| Test harnesses | `tests/*.test.js`, `tests/asset-studio.js`, `tests/smoke.js` | Where new acceptance tests go |

So the hard plumbing the brief claims already exists mostly does. What does
not exist is the asset record, the store, the review workflow, and every
asset-level rule.

---

## 3. Where the brief and the code disagree

This is the most important section: each row is a place where implementing
the brief literally would produce a dead feature or a duplicate system.

| Brief claim | Reality in this repo | Decision |
|---|---|---|
| "BAI should live under `data/assets/` with one record per asset" | Pack bytes already live under `data/brand-packs/<id>/files/<brand>/…`; `data/` is git-ignored | Keep `data/assets/` **for records and new uploads only**. Pack-sourced records reference the pack file; bytes are never copied |
| "Selecting a BAI asset should show its operations before placing it" | Asset Studio designs have fixed slots; there is no `place()` | Expose BAI only where a slot exists: photo slot, logo slot, text fields. Say so in the UI copy |
| "The Image tab should list Business assets alongside brand photography" | `renderImagePanel` (`app.js` 1910) only renders for designs with a photo slot, and reads `state.photoSources` built by `loadBrandMedia` (1015) | Add a "Business library" section **inside that panel**, using thumbnails and lazy loading, not another eager `Promise.all` of full images |
| "The Text tab should pull structured copy from a document asset" | Text fields are fixed per design; tabular parsing expects `Name \| Description \| Price` lines (`engine.js` 819) | Extraction stores rows in exactly that syntax; insertion is one button per field, no engine change |
| "The Saved tab should record which BAI assets a design used" | Saved entries are `localStorage` and already persist `photoSources` verbatim (`app.js` 2712) | Add `assetId`/`variantId` to the source object; POST a usage event best-effort. Never block saving on the network |
| "The print pack should refuse to export an asset whose usage rules prohibit it" | `renderHeader` (`app.js` 2151) gates by **design** profile only; `resolveSpec` knows the physical page | Add `evaluateUsage()` in the shared module; block only hard rules, warn the rest. Enforcement is per *active source*, not per library |
| "Brand-fit scoring against the applications matrix" | `applications` is parsed from the Word guide into `guidelines.applications`, is often empty (Monteleone: `[]`), and Asset Studio does not consume it; `paletteRoles` only infers ground/ink/accent | Fit = palette distance + logo match + resolution + optional applications hint. An empty matrix means `unknown`, never "approved" |
| "Visual embedding classification" | No embedding infrastructure; Ollama may have a vision model, not an embedding model | Tiered: deterministic → optional LLM vision → human. Embeddings become an optional future tier |
| "WhatsApp share-to-BAI" | No service worker, no HTTPS, localhost-only, no PWA manifest | Ship multi-file upload and a mobile-friendly library page; a real share target needs hosting (deferred) |
| "Drive/Dropbox/email connectors" | No OAuth, no secrets store, no inbound mail | Defer. Folder/ZIP import and crawler handoff cover the same job for now |
| "Rights and consent governance" | Single-operator localhost app; no users or sessions | Advisory flags with hard export checks. It is a safety rail, not access control |
| "50 layouts, 11 categories, print/screen/thermal" | Exactly true | No change |

Two claims in the brief are simply ahead of the code: the identity drawer
does **not** show library health, and the Image tab does **not** already list
business assets. Both are additions, not extensions.

---

## 4. Design decisions

**D1 — Reference first.** A record points at bytes; it does not own them
unless the asset was uploaded. `source.kind` is `pack` or `upload`. Deleting
a pack marks its records `orphaned` instead of deleting history.

**D2 — Taxonomy lives in code.** `asset-intel.js` owns `CLASSES`,
`OPERATIONS` and the class→operation matrix, exported as `taxonomy()`.
`data/assets/taxonomy.json` is not a config file in v1: two sources of truth
is how the brief's "eight classes" would drift from the UI.

**D3 — Propose, verify, trust.** Every record has
`review.state ∈ {proposed, verified, rejected}`. A classifier can never
auto-verify a brand-critical class (`brand-identity`, `business-document`,
`compliance`). The one exception is a pack-sourced logo: its presence in the
pack is the brand owner's declaration, not an inference, so it may start
`verified`. Only `verified` assets may be placed without a warning.

**D4 — Operations are declarations, not promises.** An asset declares only
operations the build can actually execute. The UI renders the declaration;
the server refuses undeclared operations with `409`. See §5.3 for what is
executable in which phase.

**D5 — Classification is tiered and interruptible.** Ingest must succeed
with no Python, no Ollama and no network. Tiers run in order and stop when
confidence is sufficient:

| Tier | Needs | Produces |
|---|---|---|
| **T0 metadata** | Node only | MIME, dimensions, aspect, filename tokens, folder hints, pack kind, SHA-256 |
| **T1 perceptual** | Python sidecar (Pillow) | 64-bit pHash, dominant palette, alpha channel, EXIF date, thumbnail |
| **T2 vision LLM** | Ollama vision model (or configured remote) | class, role, tags, caption, confidence |
| **T3 human** | Library page | corrected class/tags/usage, verify or reject |

**D6 — No new runtime dependency.** Node standard library and browser APIs
stay the only hard requirements. The Python sidecar is optional, exactly as
the crawler is optional; when absent, T1 and image operations degrade with a
reported reason, never a failed ingest.

**D7 — Advisory governance, honest limits.** Consent and rights are flags
that drive export warnings and hard blocks in the print path. They are not
enforceable authentication. The docs must say this.

**D8 — Additive integration.** No change to the composition schema, the
brand-pack schema or the design catalogue. BAI adds a new schema, new routes
and new sections; existing saved work keeps rendering unchanged.

---

## 5. The asset record, v1

Schema id: `layer-studio/asset/v1`. One record per asset, stored at
`data/assets/<asset-id>/metadata.json`, with `original.<ext>` only for
uploads. `normalizeAsset()` clamps and drops unknown fields the same way
`brand-pack.js` does.

### 5.1 Shape

```json
{
  "schema": "layer-studio/asset/v1",
  "id": "ast_butterfly-pig-mark-raspberry-20261102-4f2a",
  "name": "Butterfly & Pig mark, raspberry",
  "class": "brand-identity",
  "role": "logo",
  "tags": ["mark", "raspberry", "primary"],
  "identity": {
    "sha256": "9c1f…",
    "pHash": "6b3d8a0c1e5f2497",
    "bytes": 48213,
    "format": "png",
    "width": 945,
    "height": 700,
    "aspect": 1.35,
    "alpha": true
  },
  "source": {
    "kind": "pack",
    "channel": "brand-pack",
    "packId": "monteleone-group-20261031144502-45be",
    "brandId": "the-butterfly-and-the-pig",
    "path": "assets/logos/butterfly-pig-mark-raspberry.png",
    "originName": "butterfly-pig-mark-raspberry.png",
    "capturedAt": "2026-10-31T14:45:02.000Z",
    "uploadedBy": null
  },
  "binding": {
    "packId": "monteleone-group-20261031144502-45be",
    "brandId": "the-butterfly-and-the-pig",
    "match": "declared",
    "confidence": 1
  },
  "operations": ["resize", "recolour", "compose", "preflight"],
  "usage": {
    "profile": "print-and-screen",
    "printMinDpi": 300,
    "formats": { "allow": [], "deny": [] },
    "consent": "not-applicable",
    "rights": "brand-owned",
    "notes": "Never place on a photographic background below 40% opacity."
  },
  "fit": {
    "score": 0.98,
    "paletteDelta": 0.02,
    "logoMatch": "exact",
    "warnings": []
  },
  "variants": [
    {
      "id": "w480",
      "op": "resize",
      "params": { "width": 480 },
      "url": "/api/assets/ast_butterfly-pig-mark-raspberry-20261102-4f2a/file/w480.png",
      "width": 480, "height": 356, "format": "png", "bytes": 14402
    }
  ],
  "extracted": null,
  "master": { "isMaster": true, "of": null },
  "review": { "state": "verified", "by": "pack-import", "at": "…", "note": "" },
  "status": "active",
  "usageLog": { "designs": 0, "downloads": 0, "lastUsedAt": null },
  "createdAt": "…",
  "updatedAt": "…"
}
```

An uploaded menu PDF that has been extracted but not verified:

```json
{
  "schema": "layer-studio/asset/v1",
  "id": "ast_autumn-menu-20261102-8b1c",
  "name": "Autumn menu (scan)",
  "class": "business-document",
  "role": "menu",
  "identity": { "sha256": "…", "format": "pdf", "bytes": 918233, "width": null, "height": null },
  "source": { "kind": "upload", "channel": "upload", "originName": "autumn-menu.pdf", "capturedAt": "…" },
  "binding": { "packId": "monteleone-group-…", "brandId": "the-marlborough", "match": "manual", "confidence": 1 },
  "operations": ["extract-rows", "extract-text", "resize"],
  "usage": { "profile": "reference-only", "consent": "not-applicable", "rights": "staff-supplied" },
  "fit": { "score": 0.61, "paletteDelta": 0.18, "logoMatch": "none", "warnings": ["PALETTE_DRIFT"] },
  "extracted": {
    "kind": "menu",
    "method": "ocr+llm",
    "confidence": 0.71,
    "rows": [
      "# Small plates",
      "Olives | Marinated, citrus | 4.50",
      "Sourdough | Cultured butter | 5.00"
    ]
  },
  "review": { "state": "proposed", "by": "classifier", "at": "…", "note": "Rows need a human check." },
  "status": "active"
}
```

`extracted.rows` uses the studio's existing tabular syntax verbatim so
`engine.js` needs no change.

### 5.2 Classes

The brief's eight classes, plus one honest addition — `unclassified` — because
T0 cannot tell a dish from an interior, and a record must be allowed to say so.

| Class | Typical pack source | Asset Studio consumer |
|---|---|---|
| `brand-identity` | `assets/logos`, `assets/type`, `assets/colors` | Logo slot, brand rules |
| `food-product` | `assets/photography` + T2 | Photo slot (menus, flyers) |
| `premises` | `assets/photography` + T2 | Photo slot (signage, flyers) |
| `people` | uploads + T2 | Photo slot, consent-gated |
| `marketing-collateral` | `cover`, old campaigns | Photo slot, extraction |
| `content` | uploads (audio/video/text) | Copy fields (future) |
| `business-document` | uploads (PDF/DOCX) | Text tab via `extracted.rows` |
| `compliance` | uploads (allergen/thermal specs) | Allergen/prep designs |
| `unclassified` | anything T0/T2 cannot place | Library review only |

### 5.3 Operations

Fixed vocabulary in `asset-intel.js`, with an executability column so the
proposal does not promise segmentation or transcription it cannot deliver.

| Operation | Meaning | Executable | Phase |
|---|---|---|---|
| `resize` | Server-side variant at a target width | Yes, Pillow sidecar | 3 |
| `crop` | Aspect/format crop with a focal anchor | Yes, Pillow sidecar | 3 |
| `recolour` | Palette-role tint; SVG fill/stroke rewrite; raster via mask | Yes (SVG in JS, raster in sidecar) | 3 |
| `compose` | The asset is *eligible* for a layout slot | Declaration only (studio does the work) | 1 |
| `extract-rows` | PDF/image → `Name \| Description \| Price` rows | Yes, OCR if `tesseract` present; LLM fallback | 4 |
| `extract-text` | PDF/DOCX → plain text | Yes for DOCX (existing reader); PDF partial | 4 |
| `transcribe` | Audio/video → text | **No** — deferred, declared by no asset | — |
| `qr` | Link an asset/URL to a QR | In-browser only (`asset-studio/vendor/qrcode.min.js`) | 3 |
| `preflight` | The asset may appear in a print pack | Enforcement, not a file operation | 3 |

Class→default operations (overridable per asset, never beyond the global
vocabulary):

| Class | Defaults |
|---|---|
| `brand-identity` | `resize`, `recolour`, `compose`, `preflight` |
| `food-product` | `crop`, `resize`, `compose` |
| `premises` | `crop`, `resize`, `compose` |
| `people` | `crop`, `resize`, `compose` |
| `marketing-collateral` | `crop`, `resize`, `extract-text`, `compose` |
| `content` | `extract-text` |
| `business-document` | `extract-rows`, `extract-text`, `resize` |
| `compliance` | `extract-rows`, `preflight`, `resize` |
| `unclassified` | `resize` |

### 5.4 Usage rules

```js
usage = {
  profile: 'print-and-screen' | 'screen-only' | 'print-only' | 'reference-only',
  printMinDpi: 150..600,
  formats: { allow: [sizeName…], deny: [sizeName…] },
  consent: 'not-applicable' | 'granted' | 'missing',
  rights: 'brand-owned' | 'licensed' | 'staff-supplied' | 'unknown',
  notes: '≤ 280 chars'
}
```

`evaluateUsage(assets, context)` in the shared module returns codes with a
severity, and both Asset Studio and the library page render the same result.
When `formats.allow` is non-empty it is an allowlist: sizes outside it get
`FORMAT_DENIED`, and the listed sizes downgrade the `MIN_WIDTH` and
`PRINT_DPI` codes to warnings. The operator's judgement beats a conservative
heuristic, but never beats consent.

| Code | Severity | Trigger |
|---|---|---|
| `ASSET_ORPHANED` | block | Source pack was deleted |
| `ASSET_REJECTED` | block | `review.state === 'rejected'` |
| `USAGE_PROFILE_BLOCK` | block | `screen-only` in a print pack, `print-only` in a screen export, or `reference-only` anywhere |
| `FORMAT_DENIED` | block | Selected size is in `formats.deny`, or missing from a non-empty `formats.allow` |
| `CONSENT_MISSING` | block | `people` asset with `consent: 'missing'` used outside the library |
| `MIN_WIDTH` | block | Asset is too small for the selected page at the page's own DPI |
| `RIGHTS_UNKNOWN` | warn | Print export with `rights: 'unknown'` (confirm to continue) |
| `PALETTE_DRIFT` | warn | Brand-fit below threshold |
| `ASSET_UNVERIFIED` | warn | `proposed` asset in a design |
| `PRINT_DPI` | warn | Asset below the page DPI but above the block floor |
| `DUPLICATE` | warn | Asset has a master other than itself |

**DPI rule, using the repository's own metadata.** The studio's presets are
not all 300 dpi: the A4 flyer page is 1240 × 1754 px at 150 dpi, the A1
signage page is 2339 × 3311 at 100 dpi, business-card presets are 300 dpi
(`asset-studio/categories.js` 193–201, 518–521). A blanket 300 dpi rule would
block every asset against the studio's own flyer. So:

```js
const pageDpi = size.dpi || spec.dpi || 150;      // the page's own resolution
const dir = Math.max(pageDpi, usage.printMinDpi || 0);
const need = Math.ceil((Math.min(spec.w, spec.h) / 25.4) * dir);
const ratio = assetShortEdge / need;
// ratio < 0.5 → MIN_WIDTH block; ratio < 1 → PRINT_DPI warn.
// usage.printMinDpi raises `dir` for brand-critical assets (a logo may
// demand 300 on a 150 dpi page).
```

That is conservative (it assumes the asset covers the page's short edge), it
degrades correctly for large format, and it uses only data the app already
has.

---

## 6. Architecture

### 6.1 Where BAI sits

```
Brand pack (identity rules)                data/brand-packs/<id>/pack.json + files/
        │                                              │
        │  binding                                     │  reference (no copy)
        ▼                                              ▼
Business Asset Intelligence               data/assets/<asset-id>/metadata.json
  asset-intel.js  (schema, taxonomy,                   │
  fit scoring, usage evaluation)                       │
        │                                              │
        ├──► Asset Studio   photo slot · text fields · print gate
        ├──► Library page    review · operations · health
        └──► Identity drawer library health per brand
```

### 6.2 Module map

| Module | Runs in | Responsibility |
|---|---|---|
| `asset-intel.js` (new) | browser **and** Node | `normalizeAsset`, `taxonomy()`, `operationsFor`, `evaluateUsage`, `brandFit`, `phashDistance`, `extractRowsFromText` |
| `asset-store.js` (new) | Node | `listAssets`, `readAsset`, `saveAsset`, `deleteAsset`, `ingestAssets`, `indexPack`, `runOperation`, `recordUsage`, `assetHealth` |
| `asset-service.js` (new) | Node | Optional Python sidecar runner (`inspect`, `resize`, `crop`, `recolour`, `extract`), job queue, capability status |
| `scripts/asset-intel.py` (new) | Python | Pillow inspection and operations; optional `tesseract` OCR; JSON on stdout |
| `library.html` / `library.js` / `library.css` (new) | browser | Library grid, filters, review queue, operations, health |
| `server.js` | Node | Route wiring, limits, static serving |
| `asset-studio/app.js` | browser | Photo-slot section, text insertion, print gate, saved usage |
| `brand-identity.js` | browser | Per-brand library health tab |

`asset-intel.js` follows `brand-pack.js`'s UMD wrapper so `require()` works in
tests and in `server.js`, and the browser gets `window.AssetIntel`. Pure logic
only: no `document`, no `fs`.

### 6.3 Storage

```
data/assets/                        git-ignored, like the rest of data/
├── index.json                      optional cache: id → summary + mtime
├── <asset-id>/
│   ├── metadata.json               the record (writeFileAtomic)
│   ├── original.<ext>              uploads only
│   ├── thumb.webp                  320 px sidecar thumbnail
│   └── variants/<variant-id>.<ext> operations output
└── usage.json                      append-only usage events, capped
```

Pack-sourced records have no `original.*`; their `source.kind` is `pack` and
their bytes are served by the existing `/api/brand-packs/:id/files/…` route.
`index.json` is a cache that can be rebuilt by scanning `metadata.json`
files; it is never the only copy. Every write goes through
`writeFileAtomic()`.

Constraints, matching the house's existing caps:

| Limit | Value | Why |
|---|---|---|
| Assets per workspace | 2,000 | Keeps a directory scan and JSON cache sane |
| Bytes per uploaded asset | 40 MB | Same as `MAX_BRAND_ASSET_BYTES` |
| Files per ingest request | 60 | One phone-gallery batch |
| Body per ingest request | 200 MB | Under `MAX_BODY` (320 MB) |
| Variants per asset | 8 | Bounded operation output |
| Thumbnail | 320 px longest edge, WebP | Lazy grid loading; without the sidecar a tile falls back to the source URL |
| Workspace asset bytes | 4 GB | Warn at 80%, refuse upload at 100% |
| Tags / name / notes | 12 / 120 / 280 chars | Normaliser clamps |
| Usage events | 5,000 | Oldest dropped; counts are recomputable from the rest |

### 6.4 Request flow

1. `POST /api/assets/ingest` with base64 data URLs (the repository's binary
   convention) or `POST /api/assets/index-pack` with a pack id.
2. The server sniffs MIME/dimensions with the existing header parsers,
   computes SHA-256, writes the record as `proposed`, and queues a sidecar
   `inspect` job if available.
3. T0 fills `identity`, guesses `class` from folder/name/pack kind, and binds
   the asset to `packId`/`brandId` from the request (manual) or from pack
   provenance (declared).
4. T1 adds `pHash`, dominant palette, alpha, EXIF, thumbnail.
5. T2 runs only when the class is `unclassified` or the request asks for it;
   it uses the existing `callOllama()` JSON-mode pattern with a strict prompt
   and a 60 s timeout.
6. T3 is the library page: a human confirms or corrects, which flips
   `review.state` to `verified`.
7. Dedupe runs after T1: exact SHA-256 matches link into one group with a
   single `master.of`; pHash groups within a Hamming threshold link as
   near-duplicates. Nothing is deleted.

### 6.5 Brand-fit scoring

Deterministic and explainable, computed from data the pack already has:

```
paletteDelta = min over pack palette entries of ΔE(dominantColour, entry)
fit.score    = 0.55 * paletteScore + 0.25 * logoScore + 0.20 * resolutionScore
```

- `paletteScore` from the top 5 dominant colours, weighted by area.
- `logoScore` = exact SHA-256 match, else pHash distance ≤ 4, else `none`.
- `resolutionScore` = min(1, shortEdge / 1600).
- Typography is **not** scored: there is no text in a raster and no reliable
  font detector. The brief implies typography fit; the code cannot deliver
  it, so the record does not pretend to.

`fit.warnings` is advisory. A low score never blocks; it sorts the review
queue and lights the health panel.

### 6.6 Dedupe and master selection

- Exact duplicates: identical `sha256`.
- Near duplicates: 64-bit pHash, Hamming ≤ 6, connected components.
- Master: highest pixel area → verified before proposed → earliest capture →
  pack-sourced before upload (pack bytes are authoritative).
- Non-master records keep their own metadata, name and usage rules; they point
  at the master via `master.of`. Nothing is deleted automatically.

### 6.7 Sidecar contract

`scripts/asset-intel.py` is spawned by `asset-service.js` with a JSON
manifest on stdin and writes one JSON object on stdout, mirroring the
crawler's "optional Python, reported status" pattern:

```bash
.venv/bin/python scripts/asset-intel.py inspect --json -
```

```json
{ "ok": true, "phash": "6b3d8a0c1e5f2497", "palette": ["#801c4c", "#4d5744", "#eae6e1"],
  "alpha": true, "exif": { "capturedAt": "2025-03-14T12:04:11" },
  "width": 945, "height": 700, "thumbnail": "…base64…" }
```

Safety: a 20 s timeout per job, a Pillow pixel budget (decompression-bomb
guard), a 40 MB input cap, a fixed output directory under the asset record,
and no network access. If Python or Pillow is missing, an operation endpoint
returns `503` with the reason and ingest continues without T1. `GET /api/assets/status`
reports `{ python, pillow, ocr, vision }` the way `/api/crawler/status` does.

---

## 7. API surface

All JSON; binaries as base64 data URLs on the way in and served with a
content type on the way out. Errors are `{ "error": "…" }` with the usual
400/404/409/413/415/503.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/assets/status` | Sidecar/OCR/vision availability + reasons |
| `GET` | `/api/assets/taxonomy` | Classes, operations, class→operation matrix, rule codes |
| `GET` | `/api/assets` | `?packId=&brandId=&class=&state=&q=&status=&limit=&offset=` → summaries + total |
| `GET` | `/api/assets/health` | Counts by class/state, unverified, duplicates, orphaned, palette drift |
| `POST` | `/api/assets/ingest` | `{ packId?, brandId?, origin, files: [{ name, dataUrl, capturedAt?, rights?, consent? }] }` → created records + warnings |
| `POST` | `/api/assets/index-pack` | `{ packId, includePhotography? }` → index pack files as records; idempotent |
| `GET` | `/api/assets/:id` | Full record + variants |
| `PATCH` | `/api/assets/:id` | `{ name?, class?, role?, tags?, binding?, usage?, status? }` |
| `DELETE` | `/api/assets/:id` | Archive by default; `?purge=1` removes an upload (refuses pack-sourced bytes) |
| `POST` | `/api/assets/:id/verify` | `{ state: 'verified' \| 'rejected', note? }` |
| `POST` | `/api/assets/:id/classify` | `{ provider?, model?, force? }` → re-run T2 |
| `POST` | `/api/assets/:id/master` | `{ of: [assetId…] }` → link a duplicate group |
| `POST` | `/api/assets/:id/operations/:op` | `{ params }` → a variant record |
| `GET` | `/api/assets/:id/file/:variant` | Variant bytes (`original` allowed for uploads) |
| `POST` | `/api/assets/usage` | `{ events: [{ assetId, action, designId?, size?, profile? }] }` (max 100) |
| `GET` | `/api/assets/:id/usage` | Aggregated counts + recent events |

**Id pattern:** `^ast_[A-Za-z0-9_-]{1,72}$`, validated before any path join —
the same discipline as `BRAND_KIT_ID` and the pack file route.

**Variant route:** resolve inside
`data/assets/<id>/variants/` with a `safeRelativePath`-style guard and a
starts-with check, exactly as `brandPackFileMatch` does at `server.js:3606`.

**No URL import in v1.** `POST /api/assets/import-url` is deliberately absent:
it would introduce an SSRF surface the project has no need for yet. The
crawler already handles URL ingestion with its own validation.

**Delete semantics:** pack-sourced records are metadata over immutable pack
bytes, so `DELETE` archives them; `purge` only applies to uploads. Deleting a
pack cascades: the pack delete path marks matching records `orphaned` (a new
status) rather than removing history.

---

## 8. Studio integration

Every hook below is additive and individually shippable.

### 8.1 Asset Studio — Image tab

`renderImagePanel()` (`asset-studio/app.js` 1910) gains a **Business library**
section above the brand photography grid:

- Class filter chips, `All` by default; a "Verified only" toggle.
- Tiles load `/api/assets/:id/file/thumb` lazily (`loading="lazy"`), never
  the full image. `loadBrandMedia()`'s eager `Promise.all` stays untouched.
- Selecting a tile sets
  `state.photoSources[i] = { name, src: variantUrl, assetId, variantId, class, verified }`.
  Everything downstream — session persistence, `renderWorkspace`, print,
  saved entries — already handles arbitrary sources.
- The tile shows a state dot (verified/proposed/rejected) and the asset's
  block/warn codes for the current size, computed with `evaluateUsage`.
- Uploading an image now tries `POST /api/assets/ingest` first and falls back
  to the existing local data URL when the server is unreachable. A "Save to
  library" action on the current upload covers the offline case.

### 8.2 Asset Studio — Text tab

For fields the engine parses as tabular (`items`, `wines`), if the active
brand has a `business-document` asset with `extracted.rows`, show
**Insert menu rows**. It writes the rows verbatim; `parseItems()` already
understands them. The field remains fully editable, so the insertion is just
a normal text edit rather than a new state.

### 8.3 Asset Studio — Size and export bar

`renderHeader()` (`app.js` 2151) already owns the profile note. It gains an
asset line:

```js
// illustrative; `assetCache` is a small Map filled from /api/assets
const active = state.photoSources[state.photoIndex] || null;
const asset = active?.assetId ? assetCache.get(active.assetId) : null;
const verdict = asset
  ? window.AssetIntel.evaluateUsage([asset], {
      spec: window.AssetPrint.resolveSpec(state.categoryId, currentSize()),
      size: currentSize(),
      profile: currentProfile(),
      surface: 'export',
    })
  : { blockers: [], warnings: [] };
```

- **Blockers** replace the export buttons with a disabled state and the reason
  (`This photo is marked screen-only`), except *Download PNG*, which stays
  available so the operator is never trapped.
- **Warnings** render under the export bar and appear again in the print-pack
  dialog with a confirm step.
- The print-pack builder does not need to change: the block happens before it
  opens.

### 8.4 Asset Studio — Saved

Saved entries already serialise `photoSources` (`app.js:2712`), so `assetId`
travels for free. On *Save asset* and on each download, POST a usage event
best-effort. If the server is down, drop the event; saved designs must never
depend on telemetry. The Saved list shows a small badge when a referenced
asset is archived or orphaned.

### 8.5 Library page — `/library.html`

The working surface for the messy half, deliberately separate from Asset
Studio so the design tool stays a design tool:

| Area | Contents |
|---|---|
| Header | Health strip: total, verified, proposed, duplicates, orphaned, sidecar state |
| Filters | Brand pack, brand, class, review state, operation, text search |
| Grid | Thumbnails with class chip and state dot; multi-select for batch verify |
| Detail drawer | Record fields, fit warnings, usage rules editor, operations, variants, extracted rows preview, usage history |
| Review queue | Proposed records sorted by confidence, brand-critical first |

### 8.6 Brand identity drawer — library health

`brand-identity.js` (`renderDetailSectionTabs` 332) gains a **Library** tab
per brand: counts by class, unverified count, orphaned count, top three
palette-drift assets, and a link to `/library.html?brandId=…`. Read-only, so
the drawer keeps its "everything is read from the pack" character.

### 8.7 What integration is deliberately not claimed

- **No freeform placement in Asset Studio.** The photo slot is the only image
  slot; the logo slot is still fed by the pack.
- **No Layer Studio integration in this plan.** It is the natural home for
  arbitrary placement later (`layer.url` + `resolveLayer`), but it would need
  asset URLs to survive export and agent specs. That is a separate increment.
- **No automatic use of `applications`.** An empty matrix must not read as
  approval.

---

## 9. Seeding the existing packs

The repository already ships five packs and seventeen brands with logos,
photography, specimens and covers. A library that starts empty would feel
like a regression, so Phase 1 includes indexing:

| Pack source | Class | Role | Review state | Operations |
|---|---|---|---|---|
| `logos[]` | `brand-identity` | `logo` | `verified` (pack import is declarative) | `resize`, `recolour`, `compose`, `preflight` |
| `typeSpecimens[]`, `paletteImages[]` | `brand-identity` | `specimen` | `verified` | `resize`, `compose` |
| `photography[]` | `unclassified` | `photo` | `proposed` | `crop`, `resize`, `compose` |
| `cover` | `marketing-collateral` | `cover` | `proposed` | `crop`, `resize`, `compose` |
| `guidelines.applications` | — | — | metadata hint only | — |

Logos can be trusted because the importer already classified them by folder
and kind (`assetKind`), and the pack is the brand owner's declaration.
Photography cannot: nothing in the file tells a dish from a dining room until
T2 runs. Indexing is idempotent — re-running it updates metadata, never
duplicates records.

The result after one command: about **191 records** today (5 packs, 17 brands),
with a review queue that contains only photography and marketing covers.

---

## 10. Delivery plan

Effort is focused developer-days for one person who knows this codebase. The
brief's phase estimates total 20–28 weeks; the difference is plumbing that
already exists here (ZIP, packs, LLM client, print specs, saved sources).
Nothing here needs a new runtime dependency, a bundler or a migration.

### Phase 0 — Freeze the contract (1–2 days)

- Confirm the decisions in §15.
- Freeze `layer-studio/asset/v1`, the class list and the operation vocabulary.
- Create fixtures: one logo (SVG + PNG), one dish photo, one staff photo, one
  menu PDF, one duplicate pair, one near-duplicate pair.

**Done when:** the schema in §5.1 is the schema in the fixture files and
`asset-intel.js` normalises all of them without loss.

### Phase 1 — Records, store, seed (8–10 days)

- `asset-intel.js`: `normalizeAsset`, `taxonomy`, `operationsFor`,
  `evaluateUsage` (rules only), `brandFit` (palette + resolution).
- `asset-store.js` + routes: ingest (metadata-only), list, read, patch, delete,
  verify, file, index-pack, health.
- Index the five existing packs; wire `POST /api/assets/index-pack` into the
  crawler's post-import step as an explicit button (not automatic).
- `/library.html` minimal: grid, filters, detail, verify.
- Tests: normaliser, taxonomy, caps, traversal, index idempotency.

**Done when:** `npm test` passes with the new suites; a fresh checkout can
index all five packs, upload three files, verify one, and browse them at
`/library.html`; no existing page changes behaviour.

### Phase 2 — Classify, dedupe, fit (8–10 days)

- `scripts/asset-intel.py` + `asset-service.js`: inspect (pHash, palette,
  alpha, EXIF, thumbnail), status endpoint, degradation path.
- T2 vision classification through `callOllama`, with a strict JSON prompt and
  a confidence threshold of 0.75.
- Dedupe groups and master selection; `master.of` linking.
- Brand-fit scoring and warning codes.
- Review queue UI: confidence sort, brand-critical first, batch verify.

**Done when:** the 50-file mixed-photo fixture groups into the four expected
classes with ≥ 80% top-1 agreement against hand labels; the exact duplicate
pair collapses to one record with a linked master; the near-duplicate pair
links without deleting either; unverifiable images remain `proposed` and are
visible in the queue.

### Phase 3 — Operations and enforcement (8–10 days)

- Sidecar `resize`, `crop`, `recolour`; variant records; thumbnails.
- `evaluateUsage` in export and print paths; DPI rule; confirm-then-continue
  for warnings.
- Asset Studio: Image-tab business section, text insertion, saved usage events.
- Identity drawer Library tab.
- Tests: browser harness for selection, print block, text insertion, save
  round-trip.

**Done when:** a screen-only photo and a 600 px photo each fail the A3 print
pack for their own reason, and the reason is visible; PNG still downloads; a
menu PDF's rows populate the `items` field; a saved design restores with its
asset source and one usage event is recorded.

### Phase 4 — Extraction and feeding back (6–8 days)

- `extract-rows` / `extract-text` with OCR-if-present and LLM fallback;
  confidence and a mandatory human confirm before `extracted.rows` is usable.
- Usage analytics: most-used, never-used, most-warned, duplicates.
- Pack-delete cascade to `orphaned`; library health in the drawer and header.
- Mobile-friendly upload page, `capture` and multi-select; docs.

**Done when:** a photographed menu produces editable rows that populate a
menu design after one confirmation; deleting a pack leaves no broken tiles;
the health strip reports a real number for every card.

| Phase | Effort | Risk |
|---|---|---|
| 0 | 1–2 d | Low |
| 1 | 8–10 d | Low — CRUD over existing helpers |
| 2 | 8–10 d | Medium — sidecar portability, LLM latency |
| 3 | 8–10 d | Medium — enforcement edge cases across 50 designs |
| 4 | 6–8 d | Medium–high — OCR quality is the honest wildcard |
| **Total** | **31–40 d** | |

Assumptions: one developer, the existing test harnesses are kept green, the
five shipped packs remain the fixtures, and no hosting/multi-user work is
attempted.

---

## 11. Test plan

Tests follow the house pattern: pure logic under `node --test`, endpoint
guards in `tests/server.test.js`, real-browser checks in
`tests/asset-studio.js` (or a new `tests/library.js` if the page grows).

### Node — `tests/asset-intel.test.js` (new)

- `normalizeAsset` clamps name/tags/notes and rejects unknown classes.
- `operationsFor(class, overrides)` never returns an unexecutable operation.
- `evaluateUsage` returns `CONSENT_MISSING` for a people asset with missing
  consent and no blocker for `not-applicable`.
- `evaluateUsage` blocks `screen-only` for print and allows it for PNG.
- The DPI rule warns at 0.9× page resolution and blocks at 0.45×, using a
  real A4 flyer spec (210 × 297 mm, 150 dpi).
- `brandFit` scores an exact palette match above 0.9 and a foreign palette
  below 0.5.
- `phashDistance` groups a 4-bit difference and separates a 20-bit one.

### Node — `tests/server.test.js` (extend)

- Ingest rejects a non-data-URL payload and a 41 MB file.
- Ingest rejects more than 60 files and an unknown class.
- `GET /api/assets/:id` rejects `../` ids and unknown ids.
- `PATCH` cannot change `schema`, `id` or `source.packId`.
- `index-pack` twice yields the same record count (idempotent).
- `DELETE ?purge=1` refuses a pack-sourced record.
- Deleting a pack marks its records `orphaned`.
- `usage` caps at 100 events and ignores unknown asset ids.

### Browser — `tests/asset-studio.js` (extend)

- The Image tab renders a Business library section for a photo design and no
  section for a text-only design.
- Selecting an asset updates the preview and the saved entry carries
  `assetId`.
- The A3 print pack is blocked for a screen-only asset and the reason text is
  present.
- *Download PNG* remains enabled for the same asset.
- A document asset exposes *Insert menu rows* and the field gains
  `Name | Description | Price` lines.
- Restoring a saved asset re-selects the same library source.

### Manual, per release

- Index the five packs on a clean `data/`: expected record counts, no
  duplicates, all logos verified.
- Delete a pack and confirm tiles become orphaned rather than broken.
- Run with `.venv` absent and confirm ingest still works and the status
  endpoint says why T1 is off.

---

## 12. What success looks like

The brief's ROI arguments are about avoided external spend and brand
consistency. In-product, those become four numbers the library can report
without inventing a dashboard:

| Measure | Definition | Target after Phase 4 |
|---|---|---|
| Verified share | verified / active assets | ≥ 70% for pack-sourced, ≥ 50% overall |
| Library reuse | designs saved that reference a library asset | ≥ 1 in 3 saved designs |
| Time to placement | library filter → design preview | under 30 s, measured manually on the migrated packs |
| Superseded assets | assets with a master other than themselves | reported, not hidden |

If none of those move, BAI is an archive and the thesis has not been proven
inside the product.

---

## 13. Risks and honest limits

| Risk | Mitigation |
|---|---|
| Two stores drift (pack files vs asset records) | Reference, never copy; `orphaned` status; idempotent `index-pack`; health strip |
| `index.json` corruption | Per-asset `metadata.json` + `writeFileAtomic`; index is a rebuildable cache |
| LLM latency or absence stalls ingest | Ingest is synchronous only for T0; T1/T2 are queued; status endpoint reports why |
| Pillow missing on another machine | Sidecar is optional; operations return 503 with a reason; T0 still works |
| pHash merges unrelated images | Advisory only; no auto-delete; master link is reversible |
| 150 dpi page presets trigger false "low resolution" | Rule uses the page's own `dpi`; `printMinDpi` is an opt-in floor |
| Print enforcement breaks a working export | Blocks are limited to six hard codes; PNG always works; warnings confirm rather than block |
| localStorage references a deleted asset | Saved entry keeps its URL until it fails; UI badge says orphaned; no data loss on save |
| Consent/rights flags are not security | Documented as advisory. A single-operator localhost app cannot enforce identity |
| Empty `applications` matrix reads as approval | Default is `unknown`; fit warns, never approves |
| Storage growth | 2,000 records, 40 MB/file, 4 GB workspace, thumbnails only in grids |
| Scope creep towards a DAM | §14 is the contract: connectors, roles and workflows are out |

Two limits deserve to be stated in the product copy, not just the docs:

1. **BAI does not know what a photo is until someone (or a vision model)
   says.** The record's confidence and review state are part of the UI, not
   hidden metadata.
2. **BAI cannot enforce rights.** It can refuse to export an asset marked
   `unknown` without confirmation; it cannot know whether the business
   actually holds the rights.

---

## 14. Out of scope for this proposal

| Deferred | Why | Revisit when |
|---|---|---|
| WhatsApp share target | Needs HTTPS + service worker; the studio is localhost HTTP | There is a hosted deployment |
| Drive/Dropbox OAuth | No secrets store, no OAuth client, no server-side network policy | Hosted, multi-user |
| Inbound email ingest | Needs MX/webhook infrastructure | Hosted |
| Social profile import as assets | The crawler deliberately treats social as research; rights are murkier | A rights model exists |
| Auth, roles, approvals | Single-operator app | Multi-tenant |
| Background removal / segmentation | Needs a model and a GPU story; `crop` covers most real use | A local segmentation model is acceptable |
| Embedding/semantic search | No embedding model installed; text search + class filters first | T2 volume proves the need |
| Transcription | No audio pipeline in this repo | Video becomes a first-class asset class |
| Auto-archive / auto-delete | Destructive automation on business records is the wrong default | Never without explicit consent |
| Layer Studio asset picker | `resolveLayer` + export + agent spec would all need asset URLs | After Phase 4 |

---

## 15. Decisions needed before Phase 1

| # | Decision | Recommendation |
|---|---|---|
| 1 | Store records globally (`data/assets/`) or inside each pack? | Global records, pack bytes referenced. Cross-brand search is the point, and `data/` is already a peer-level store |
| 2 | Is an optional Python sidecar acceptable? | Yes. It mirrors the crawler, already ships Pillow in `.venv`, and keeps Node dependency-free. Without it, classification is folder-and-filename only |
| 3 | New `/library.html` surface or a drawer inside Asset Studio? | A page. The review queue, batch actions and operations do not belong in a design tool |
| 4 | Index existing packs automatically on server start, or on demand? | On demand, with a prompt after pack import. Automatic indexing of five packs on every start is surprising work |
| 5 | Are consent/rights advisory or a hard gate? | Advisory flags with teeth: `consent: missing` blocks print/social export until the operator sets it to `granted`; `rights: unknown` asks for confirmation. Both actions are recorded on the record |
| 6 | Is `unclassified` acceptable as a ninth class? | Yes. Pretending every image lands in one of eight classes is what makes review queues lie |

---

## Appendix A — summary of changes from the source brief

| Brief position | This proposal |
|---|---|
| `data/assets/` holds copies of everything | Records live there; pack bytes are referenced |
| BAI places assets into Asset Studio designs | BAI feeds the photo slot, text fields and print gate; placement stays Layer Studio's job |
| Eight asset classes | Nine, adding `unclassified` |
| Separate taxonomy file | Taxonomy in `asset-intel.js`, exported |
| Embedding classification first | Deterministic → pHash/palette → optional vision LLM → human |
| Operations include segmentation, transcription and QR | Only executable operations are declarable: segmentation and transcription are dropped, QR stays in-browser, the rest ship |
| Notifications and workflows implied by "review queue" | A page with filters and batch verify; no notification system |
| Drive, email, WhatsApp ingestion in Phase 4 | Upload + folder/ZIP + crawler handoff in Phase 4; connectors deferred to hosting |
| Applications matrix gates approval | Matrix is an optional hint; empty means unknown |
| Usage analytics as a dashboard | Usage events + four health numbers; no dashboard until the numbers are proven |

## Appendix B — files added or changed

| File | Change |
|---|---|
| `asset-intel.js` | **New.** Shared schema, taxonomy, fit, usage, pHash helpers |
| `asset-store.js` | **New.** Record storage, ingest, indexing, operations, usage |
| `asset-service.js` | **New.** Optional Python sidecar runner and status |
| `scripts/asset-intel.py` | **New.** Pillow inspection/operations, optional OCR |
| `library.html`, `library.js`, `library.css` | **New.** Library and review surface |
| `server.js` | Asset routes, limits, pack-delete cascade |
| `asset-studio/app.js` | Image library section, text insertion, export gate, usage events |
| `brand-identity.js` | Per-brand Library health tab |
| `tests/asset-intel.test.js` | **New.** Pure-logic suite |
| `tests/server.test.js` | Asset endpoint guards and caps |
| `tests/asset-studio.js` | Library selection, print block, text insertion |
| `docs/asset-studio.md`, `docs/api-and-cli.md`, `docs/architecture.md`, `docs/brand-packs.md` | Document the new surface once it ships |
| `README.md` | Surface table, repository map, test counts |
