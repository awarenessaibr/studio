# Business Asset Intelligence (asset library)

**Status:** implemented core (Phases 0–3, plus the usable parts of Phase 4). See
the proposal in [business-asset-intelligence.md](business-asset-intelligence.md)
for the market case and the original delivery plan.

The library answers a different question from Brand identity and Asset Studio:

| Surface | Question |
|---|---|
| Brand identity | What is this brand? |
| Business asset library | What does the business already own, and may we use it? |
| Asset Studio | What do we need to make now? |

It is **reference-first**: pack files stay authoritative under
`data/brand-packs/<id>/files/…`; the library stores metadata that points at
them. Only genuine uploads own bytes under `data/assets/<id>/original.*`.

---

## 1. What was built

| Layer | Module |
|---|---|
| Shared contract | [src/shared/asset-intel.js](../src/shared/asset-intel.js) — schema, classes, operations, usage rules, fit, pHash |
| Store | [src/server/asset-store.js](../src/server/asset-store.js) — records, ingest, pack indexing, dedupe, operations, usage, health |
| Optional sidecar | [src/server/asset-service.js](../src/server/asset-service.js) + [scripts/asset-intel.py](../scripts/asset-intel.py) — Pillow inspection, thumbnails, resize/crop/recolour, text/OCR extraction |
| Review surface | [library.html](../pages/library.html), [src/client/library/library.js](../src/client/library/library.js), [src/client/library/library.css](../src/client/library/library.css) |
| API | `server.js` `/api/assets/...` |
| Asset Studio | Image-tab Business library, text-row insertion, export gate, saved usage, upload ingest |
| Brand identity | per-brand **Library** tab with health counts |

No new runtime dependency: Node standard library + browser APIs. Python is
optional, exactly like the crawler.

---

## 2. The record (`layer-studio/asset/v1`)

```json
{
  "schema": "layer-studio/asset/v1",
  "id": "ast_the-physician-photo-physician-small-plates-da508ed621",
  "name": "physician small plates",
  "class": "unclassified",
  "role": "photo",
  "tags": ["photo", "unclassified", "the physician"],
  "identity": { "sha256": "…", "pHash": "…", "bytes": 112000, "format": "jpg",
                 "width": 1400, "height": 933, "aspect": 1.5, "alpha": false,
                 "palette": ["#cacac5"] },
  "source": { "kind": "pack", "channel": "brand-pack",
              "packId": "dalton-family-venues-…", "brandId": "the-physician",
              "path": "assets/photography/physician-small-plates.jpg" },
  "binding": { "packId": "…", "brandId": "the-physician", "match": "declared", "confidence": 1 },
  "operations": ["crop", "resize", "compose"],
  "usage": { "profile": "print-and-screen", "printMinDpi": 150,
             "formats": { "allow": [], "deny": [] },
             "consent": "not-applicable", "rights": "unknown", "notes": "" },
  "fit": { "score": 0.59, "paletteDelta": null, "logoMatch": "none", "warnings": [] },
  "variants": [],
  "extracted": null,
  "master": { "isMaster": true, "of": null },
  "review": { "state": "proposed", "by": "classifier", "at": "…", "note": "" },
  "status": "active",
  "usageLog": { "designs": 0, "downloads": 0, "lastUsedAt": null }
}
```

### Classes

`brand-identity`, `food-product`, `premises`, `people`, `marketing-collateral`,
`content`, `business-document`, `compliance`, `unclassified`.

### Operations

Declared, not promised. `resize`, `crop`, `recolour`, `compose`, `preflight`,
`qr`, `extract-rows`, `extract-text`. `transcribe` exists in the vocabulary but
is executable by no asset. `compose` and `preflight` are declarations; the
server returns `409` if asked to run them as file operations.

Brand-identity logos pick up `resize`, `recolour`, `compose`, `preflight`.
Uploaded menus pick up `extract-rows`, `extract-text`, `resize`.

### Review states

`proposed` → `verified` or `rejected`. Pack logos and specimens start
`verified` because the pack importer already classified them by folder/kind;
photography, covers and uploads start `proposed`. Only verified assets avoid the
`ASSET_UNVERIFIED` warning.

---

## 3. Usage rules and the export gate

`evaluateUsage(assets, context)` is shared by the library, Asset Studio and the
print path. It returns `{ ok, blockers, warnings }` with seven honest rules:

| Code | Severity | Meaning |
|---|---|---|
| `ASSET_ORPHANED` | block | source pack deleted |
| `ASSET_REJECTED` | block | rejected in review |
| `USAGE_PROFILE_BLOCK` | block | screen-only in print, print-only in screen, reference-only anywhere |
| `FORMAT_DENIED` | block | size denied / outside allowlist |
| `CONSENT_MISSING` | block | people asset without consent |
| `MIN_WIDTH` | block | below half the page's required short edge |
| `RIGHTS_UNKNOWN` | warn | print with unknown rights |
| `PALETTE_DRIFT` | warn | brand fit below threshold |
| `ASSET_UNVERIFIED` | warn | proposed asset in a design |
| `PRINT_DPI` | warn | below page dpi but above the block floor |
| `DUPLICATE` | warn | linked to a master |

The DPI rule uses the page's **own** `dpi` metadata (A4 flyer is 150 dpi, A1
signage 100 dpi, cards 300 dpi), not a blanket 300 dpi:

```js
const dir = Math.max(pageDpi, usage.printMinDpi || 0);
const need = Math.ceil((Math.min(spec.w, spec.h) / 25.4) * dir);
const ratio = assetShortEdge / need;
// < 0.5 block, < 1 warn
```

In Asset Studio:

- blockers disable **Print** and **Print pack** and explain why in the export
  note; **Download PNG remains available** so an operator is never trapped;
- warnings are shown in the export note and again in the print dialog; the
  first *Download print pack* click acknowledges, the second continues;
- only the active photo source is evaluated, not the whole library.

The gate is advisory governance, not authentication. See §10.

---

## 4. Storage and seeding

```
data/assets/                       git-ignored
├── <asset-id>/
│   ├── metadata.json              one normalised record
│   ├── original.<ext>             uploads only
│   ├── thumb.webp                 when the sidecar has inspected it
│   └── variants/<variant-id>.*    resize/crop/recolour output
└── usage.json                     capped usage events
```

Pack-sourced records have no `original.*`; their bytes are served through the
existing pack file path (or the `/api/assets/:id/file/...` wrapper).

### Seed the five shipped packs

In `/library.html` → **Index a pack**, or:

```bash
curl -X POST http://127.0.0.1:8008/api/assets/index-pack \
  -H 'content-type: application/json' \
  -d '{"packId":"dalton-family-venues-20261031093013-d35d"}'
```

Indexing is idempotent. On the current five packs it creates **191 records**:

| Source | Class | State |
|---|---|---|
| `logos`, `paletteImages`, `typeSpecimens` | `brand-identity` | verified (122) |
| `photography` | `unclassified` | proposed (52) |
| `cover` | `marketing-collateral` | proposed (17) |

Duplicates are grouped by SHA-256 and pHash; the master is chosen by area,
verification, pack provenance and capture date. Nothing is deleted.

---

## 5. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/assets/status` | sidecar/Pillow/OCR/PDF/vision readiness + health |
| GET | `/api/assets/taxonomy` | classes, operations, rule codes |
| GET | `/api/assets` | list (`packId`, `brandId`, `class`, `state`, `status`, `operation`, `q`, `verified`, `limit`, `offset`) |
| GET | `/api/assets/health` | counts by class/state, duplicates, orphaned, palette drift |
| POST | `/api/assets/ingest` | `{packId?, brandId?, files:[{name,dataUrl,class?,rights?,consent?}]}` |
| POST | `/api/assets/index-pack` | `{packId}` — idempotent references |
| GET | `/api/assets/:id` | full record |
| PATCH | `/api/assets/:id` | name, class, role, tags, usage, status, binding |
| DELETE | `/api/assets/:id` | archive; `?purge=1` for uploads only |
| POST | `/api/assets/:id/verify` | `{state:'verified' \| 'rejected', note?}` |
| POST | `/api/assets/:id/classify` | Pillow analysis + optional local vision classification |
| POST | `/api/assets/:id/master` | `{of:[ids]}` — link duplicates |
| POST | `/api/assets/:id/operations/:op` | execute a declared operation |
| GET | `/api/assets/:id/file/:variant` | original / thumb / variant bytes |
| POST | `/api/assets/usage` | up to 100 `{assetId, action, designId?, size?, profile?}` events |
| GET | `/api/assets/:id/usage` | counts + recent events |

The asset id is validated before any path join. Pack bytes are resolved inside
the pack's `files/<brand>/` root; variants inside the asset's `variants/` root.

**Delete cascade:** deleting a brand pack marks its records `orphaned` instead
of deleting history. The library keeps the tile and the export gate blocks it.

---

## 6. The library page

`/library.html` or `/library`:

- **Health strip** — total, verified, proposed, duplicates, orphaned, palette
  drift, sidecar state.
- **Filters** — pack, brand, class, review state, operation, verified-only and
  free text.
- **Grid** — lazy thumbnails, class chip, fit score, state dot, duplicate badge,
  multi-select.
- **Detail drawer** — preview, blocking/warning codes, editable name/class/role/
  tags, usage profile/min DPI/rights/consent/notes, review actions, Pillow
  analysis, declared operations, variants, extracted rows and usage history.
- **Review queue** — sets `state=proposed`, brand-critical classes first.
- **Upload** — multi-file/drop, optional pack/brand binding, rights and consent.
- **Index** — one pack or all packs.

Review is intentionally manual: a classifier cannot auto-verify
`brand-identity`, `business-document` or `compliance`.

---

## 7. Asset Studio integration

### Image tab

A **Business library** section appears for designs with a photo slot:

- class chips and a verified-only toggle;
- lazy thumbnails from `/api/assets/:id/file/thumb`;
- selecting a tile fetches the full record, loads the original image, and appends
  `{name, src, uploaded, assetId, class, verified}` to `state.photoSources`;
- session persistence, preview render, print and saved entries all already
  accept arbitrary sources, so no composition change was needed.

### Text tab

When the active brand has a `business-document` asset with extracted rows, the
`items`/`wines` field gains **Insert menu rows from the library**. It inserts
the `Name | Description | Price` syntax the engine already parses. The field
stays editable.

### Export bar

The active photo source is evaluated on every header render. Blockers disable
Print / Print pack; warnings are shown and acknowledged in the print dialog.
PNG download remains available.

### Saved and usage

Saved entries already serialise `photoSources`, so `assetId` travels unchanged.
Saving a design, downloading a PNG/JPG/print pack, and the corresponding source
selection post best-effort usage events. Telemetry never blocks a save.

### Uploads

Uploading an image now tries `POST /api/assets/ingest` first, binds it to the
current pack/brand, and uses the stored asset URL. If the server is unreachable,
the existing local data URL path remains.

---

## 8. Brand identity

The brand detail drawer has a fourth **Library** tab: total, verified, proposed,
duplicates, orphaned, palette drift and a link to
`/library.html?brandId=…`. It is read-only; the drawer still reads the pack.

---

## 9. Sidecar

```bash
.venv/bin/python scripts/asset-intel.py status
.venv/bin/python scripts/asset-intel.py inspect <image>
.venv/bin/python scripts/asset-intel.py operate --op resize --input in.jpg --output out.jpg --params '{"width":480}'
.venv/bin/python scripts/asset-intel.py extract <pdf|docx|image>
```

Provides: dHash (stored as `pHash`), dominant palette, alpha, EXIF date, 320 px
WebP thumbnail, resize/crop/recolour, PDF text via `pdftotext`, DOCX text, OCR
via `tesseract` when present.

Limits: 20 s per job, 80 MP image guard, 40 MB input, fixed output paths, no
network. Missing Pillow returns `503` with the reason; ingest still records T0
metadata. SVG is deliberately not handed to Pillow.

`GET /api/assets/status` also reports local vision availability. If Ollama has
a vision model, **Analyze image** can classify unclassified assets; otherwise it
returns the analysis/Pillow result and asks for human review.

---

## 10. Honest limits

- **Vision classification is optional and unverified.** Without a local vision
  model the class stays `unclassified`; the library says so. A classifier never
  auto-verifies brand-critical classes.
- **Consent and rights are advisory.** `consent: missing` blocks people assets
  outside the library and `rights: unknown` asks for confirmation. The app
  cannot know whether the business actually holds the rights.
- **No freeform placement in Asset Studio.** The photo slot is the only image
  slot; the logo slot still comes from the pack. Layer Studio placement is a
  separate increment.
- **No WhatsApp/Drive/email connectors, no auth, no approvals.** This is a
  single-operator localhost tool.
- **No segmentation, background removal, transcription or embedding search.**
  Operations that do not exist are not declared executable.
- **Pack dedupe is advisory.** Near-duplicate masters are reversible and never
  delete records.
- **Thumbnails need the sidecar.** Without it the grid falls back to the original
  pack/upload URL; the layout still works.
- **Applications matrix is not approval.** Brand-fit uses palette, resolution
  and logo role; empty applications means unknown.

---

## 11. Verification

```bash
npm test                         # includes tests/asset-intel.test.js
node tests/asset-studio.js       # library section + existing 57 checks
node tests/smoke.js
npm run test:visual
```

Manual acceptance:

1. `/library.html` shows **191** seeded records; all logos verified, photos
   proposed.
2. Open a photo, change usage to `screen-only`, save; select it in an Asset
   Studio flyer; Print is disabled and the reason is visible; PNG still works.
3. Upload a menu PDF; **Extract rows**; verify it; the Menus **Text** tab shows
   **Insert menu rows from the library**.
4. Index a pack twice: the second run reports `0 created / N skipped`.
5. Delete a pack: its records become `orphaned` and the gate blocks them.

---

## 12. Files

| File | Role |
|---|---|
| `src/shared/asset-intel.js` | shared schema/taxonomy/rules/fit/pHash |
| `src/server/asset-store.js` | reference-first store, indexing, ingest, operations, usage |
| `src/server/asset-service.js` | optional Python runner |
| `scripts/asset-intel.py` | Pillow/PDF/OCR sidecar |
| `pages/library.html`, `src/client/library/library.js/.css` | review surface |
| `server.js` | `/api/assets/*`, static `/library`, pack-delete cascade |
| `src/client/asset-studio/app.js` | library section, menu rows, export gate, usage, upload |
| `src/client/asset-studio/app.css` | library section styling |
| `src/client/brand/brand-identity.js` | per-brand Library tab |
| `tests/asset-intel.test.js` | shared-contract tests |
| `docs/asset-library.md` | this document |
