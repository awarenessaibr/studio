# Brand packs and brand identity

A **brand pack** is a ZIP of a scraped brand-kit folder: one portfolio
(group) plus one or more businesses, each with its own palette, type, logos,
photography, Word guide and starter templates.

> Reviewing a new scrape before importing it? See
> [scraped-brand-kit-review.md](scraped-brand-kit-review.md) and
> [scraped-july-dalton-review.md](scraped-july-dalton-review.md) for the audit
> checklists and the common schema/asset traps.
>
> The most recent group drop, its re-curated rebuild and the resulting pipeline
> plan are in [pulpo-hospitality-review.md](pulpo-hospitality-review.md),
> [pulpo-hospitality-refinement.md](pulpo-hospitality-refinement.md) and
> [pulpo-hospitality-improvements.md](pulpo-hospitality-improvements.md).
>
> Choosing which imported packs the studio shows (developer surface):
> [management.md](management.md).

Importing it gives the studio a brand system it can theme, validate against
and generate real designs from — no design tool, no per-brand coding.

---

## 1. When to use it

- You have a **brand-kit ZIP** (the output of a scraping + brand-identity
  step) and want it usable in the studio.
- You want a **starter menu / card / flyer / voucher** built from the guide
  before any manual design.
- You want **one brand kit shared by many compositions**, so an edit reaches
  every campaign.
- You want **validate/guardrail** checks to know the brand (palette, fonts,
  logos).

If all you need is a finished asset from an already-imported brand, go
straight to [Asset Studio](asset-studio.md).

---

## 2. Expected ZIP structure

```
brand-kit/
├── README.md                          group name + description
├── tokens/<group>.tokens.json         optional combined tokens
├── 00-portfolio/
│   ├── <Group>-Overview.docx          group guide, recommendations
│   └── assets/                        brochure imagery, lockup, diagrams
├── 01-<brand>/
│   ├── <Brand>-Brand-Guide.docx       the Word guide (optional)
│   ├── tokens/<brand>.tokens.json     colours, type scale, voice, logo
│   ├── content/<brand>.json           menus, drinks, hours, booking link
│   ├── documents/                     source PDFs and page transcripts
│   └── assets/
│       ├── logos/                     SVG + PNG cuts, variants, plates
│       ├── colors/palette.png
│       ├── type/specimen.png
│       ├── photography/
│       └── cover.png
└── 02-<brand>/ …
```

**Discovery rules**

- A brand is any folder that owns `tokens/*.tokens.json`.
- With no token folders, the importer falls back to
  `*Brand-Guide.docx` folders.
- Anything whose path says *portfolio* or *social* is skipped as a brand.
  In particular `social/social-profile.json` is research, not a token file.
- A ZIP wrapped in a single top-level folder is unwrapped automatically.
- Numbered folders keep their reading order.

---

## 3. What the importer reads

| Source | Becomes |
|---|---|
| `tokens/*.tokens.json` | Palette (HEX / RGB / CMYK, role, share, tier), typography families + scale, voice attributes / prefer / avoid, logo notes |
| `documents/*` | Source PDFs, saved page transcripts and terms, copied into the pack so `content.documents[]` resolves after a re-import |
| `content/*.json` | Structured menus/drinks, hours, booking link and the authored `copy` deck (headline, body, dish special, voucher terms, festive campaign, campaign blocks). Asset Studio and the Agent Studio use the menu to prefill menu designs and the copy deck to replace their shared sample text. A brand with `copy.kind: 'ice-cream'` also gets the ice-cream/social template set |
| `<brand>/social/` | Read-only social-intelligence evidence (profile, voice, channels, reviews). Ignored as tokens and as brand photography; the Social index reads it and `brand.social` carries the bounded summary |
| `assets/{logos,photography}` | Logo cuts and photo pool; `social/assets/` is excluded from both |
| `*.docx` guide | Positioning statement, **applications matrix** (menu, brochure, voucher, social, …), print specification, canonical contact block, facts, type hierarchy, logo rules, full section outline |
| `assets/logos` | Logo cuts classified by variant (`light`, `dark`, `color`, `primary`) and kind (`wordmark`, `mark`, `logo`); presentation plates are excluded from selection |
| `assets/{colors,type,photography}` | Palette images, type specimens, photography with pixel dimensions |
| `cover.png` | Brand cover on the gate card and the identity hero |
| group `README.md` | Group name and description |

Every brand is also written back as a **shared brand kit** under
`data/brand-kits/`, so the existing validation, guardrails and Brand kit
dialog work unchanged.

### Robustness details

- **SVG repair.** A recoloured logo that keeps its original `fill` produces a
  duplicate attribute, which browsers refuse to decode. The importer keeps the
  first value, drops event handlers and scripts, ensures the SVG namespace and
  reports a warning. The repaired file is what is served.
- **Licensed fonts.** Guides name commercial families (Neue Haas Grotesk,
  Practice, Brandon Grotesque, Cinzel, DIN) but no binaries travel with the
  pack. Generated templates substitute explicit system stand-ins —
  `Helvetica Neue` for sans, `Georgia` for serif — record the mapping in
  `meta.fontSubstitutions`, and add those families to the kit so validation
  agrees with what renders. Export works immediately; upload the licensed
  files through the font API and relink the text layers for exact brand
  typesetting. The studio still refuses an export when a *user-chosen* font
  has not been loaded.
- **Duplicates.** Logo variants that are really the same artwork are
  de-duplicated; presentation plates never land in a design slot.
- **The token file is kept.** `<brand>/tokens/*.tokens.json` is the brand's
  canonical record and the importer parses it into `pack.json`, so it is
  written to `files/<brand>/…` as well: `brand.tokensPath` must resolve on
  disk, not only in the manifest. Packs imported before that was fixed have a
  dangling `tokensPath` and no file; repair them with
  `node scripts/backfill-tokens.js` (idempotent, rebuilds from the palette,
  type and voice already in `pack.json`, never overwrites an existing file).

### Provenance

A pack and every brand inside it carry where the material came from:

```json
"provenance": { "kind": "public", "confidence": "medium", "note": "…" }
```

`kind` is `supplied` (the business handed it over), `public` (captured from a
public source), `extracted` (derived from other material), `inferred` (associated
without a declaration) or `unknown`. The default is **`unknown`**, not
`supplied`: a pack assembled from live websites is not a licensed asset library,
and defaulting to "supplied" would assert a right nobody confirmed.

This is provenance only. Permission to publish is a separate decision, held per
file in the asset library as `review.state` (`approved` is the clearance — see
[asset-library.md](asset-library.md#review-states)). A brand can be
`extracted`/`high` and its photography still be unapproved.

---

## 4. Palette roles, automatically

A template needs a ground, an ink and an accent. The builder does not
hard-code a brand:

1. It looks for the template's row in the **applications matrix** and reads
   the colours named in prose — “black ground, brass section heads” picks
   those two swatches first.
2. Otherwise it matches role keywords (`menu paper`, `page ground`,
   `primary brand ground`, …) and then share within the primary tier.
3. **Ink** is the palette colour with the highest contrast against the ground
   (this is why The Physician gets ink artwork on vermilion rather than
   white).
4. **Accent** is a documented colour, a designated accent role, or the most
   legible remaining primary — whichever wins first. A small-text accent that
   falls below 4:1 is swapped for the ink colour; the true brand colour stays
   on rules and large display type.

---

## 5. The Brand identity workspace

Open it from the Layer Studio sidebar (**Brand identity** → *Open brand
identity*, or **Import brand ZIP**). Asset Studio has its own **Brand
identity** drawer (palette, type, logos, guidelines) backed by the same pack,
but it is a read-mostly view rather than this workspace.

### Sidebar section
Shows a summary (`n packs · m brands` or “No brand pack imported yet”),
brand chips for the active group, and the two primary actions.

### Dialog
- **Group tab** first, then one tab per brand.
- Each brand has five detail tabs:

| Tab | Contents |
|---|---|
| **Identity** | Cover hero, palette swatches with names/roles, typography families with weights and cuts, voice attributes, logo cuts by variant, photography with dimensions, type specimens |
| **Templates** | A live miniature of each generated template, the guide sentence that shaped it, **Create** and **Use kit**; below them, **Saved brand templates** (published snapshots with **GIF**/**MP4**) and **In progress** projects created from this brand |
| **Guidelines** | Applications matrix, print specification, canonical contact block, facts, type hierarchy, logo rules, and the source document's sections; the Word guide is downloadable |
| **Library** | Read-only asset-library health for the brand (total, verified, proposed, duplicates, orphaned, palette drift) and a link to `/library.html` |
| **Social** | Read-only social-intelligence profile matched by brand name/slug |

Identity, guidelines and the initial templates are read from the pack; saved
templates and in-progress projects are read from the pack's `templates/`
folder and `data/imports/`. Nothing is retyped in the UI.

---

## 6. Starter templates

Thirteen real v3 compositions are generated from the identity, the guide and
the brand's photography. Seven are print/stationery sizes at 300 dpi; six are
digital loops with keyframes.

| Template | Size | Channel | Layers | Variables | What is already built |
|---|---|---|---:|---:|---|
| `menu` | A4 · 2480 × 3508 | print | 22 | 17 | Ground, rule, logo, kicker, title, 5 dishes × (name, description, price), footer |
| `business-card-front` | 85 × 55 mm · 1004 × 650 | print | 5 | 2 | Brand ground, mark/wordmark, tagline, hairline, website |
| `business-card-back` | 85 × 55 mm · 1004 × 650 | print | 8 | 6 | Name, role, phone, email, address, website, social from the guide's contact block |
| `flyer` | A5 · 1748 × 2480 | print | 8 | 5 | Photo band, logo, headline, sub-head, body, CTA, footer |
| `table-card` | A6 · 1240 × 1748 | print | 8 | 5 | Mark, kicker, dish, description, price, allergen note |
| `voucher` | DL · 2480 × 1169 | print | 8 | 5 | Logo, title, value, terms, redemption code panel, footer |
| `social-post` | 1080 × 1080 | social | 6 | 3 | Logo, headline, sub-head, handle/website |
| `social-story` | 1080 × 1920 · 6 s | social | 9 | 4 | Photo push, scrim, logo, kicker, headline, sub-head, footer |
| `social-reel` | 1080 × 1920 · 8 s | video | 9 | 4 | Parallax photo, rule, kicker, large headline, detail, footer |
| `square-loop` | 1080 × 1080 · 5 s | social | 6 | 3 | Ink ground, moving accent bar, logo, headline, tagline, footer |
| `display-screen` | 1920 × 1080 · 6 s | display | 9 | 4 | Photo push, scrim, logo, rule, headline, tagline, detail, footer |
| `digital-menu-board` | 1920 × 1080 · 5 s | display | 20 | 17 | Ground, moving rule, logo, title, 5 dishes × (name, description, price), footer |
| `link-preview` | 1200 × 630 · 4 s | social | 7 | 4 | Accent bar, logo, kicker, headline, sub-head, footer |

Every one is a normal composition: per-template variables with bindings, a
format list, the brand kit and safe zones. Nothing is a screenshot or a
special layer type, so the variable editor, brief ingestion, contact sheet,
batch export, guardrails and agent protocol all apply to it. The digital
templates are loop-safe (first and last keyframe match), so the same scene
exports as a still PNG, an animated GIF or an MP4.

### Venue social set (Boardwalk)

A pack can add its own designs to the set for one brand. The Cawley pack's
Boardwalk tab carries ten more compositions rebuilt from the venue's social
pack (`01.pdf`), filtered with `appliesTo` so only Boardwalk sees them:

| Template | Size | Variables | What is already built |
|---|---:|---:|---|
| `bw-dessert` | 1080 × 1080 | 5 | Wordmark, kicker, circular dish-photo slot, dish, description and price, waves, scallop footer |
| `bw-sweets-menu` | 1080 × 1350 | 11 | Wordmark, SWEETS, waves, white menu card with four dishes and prices, tagline, footer |
| `bw-a-la-carte` | 1000 × 1500 | 7 | Wordmark, à la carte kicker, dashed pizza-photo frame, sea-salt eyebrow, dish, flavours, price |
| `bw-good-morning` | 1080 × 1920 | 5 | Cawley lockup, GOOD MORNING, breakfast line, Full Scottish, gull, sun and waves |
| `bw-seasons` | 1080 × 1920 | 7 | Cawley lockup, sunset glow, gull, SEASONS, Scottish set menu, two price lines, dessert list |
| `bw-event-post` | 1200 × 630 | 5 | Wordmark, event type, headline, date/CTA, circular photo slot, scallop footer |
| `bw-announcement` | 1200 × 630 | 4 | Cawley lockup, topic, headline, supporting line, gull, sun and waves |
| `bw-from-the-sea` | 1600 × 900 | 5 | Blue-tinted wordmark, FROM THE SEA, dish, description and price, circular photo slot |
| `bw-banner` | 1600 × 600 | 1 | Full wordmark, gull, Cawley endorsement, waves, scallop footer |
| `bw-group-banner` | 1600 × 400 | 1 | Cawley lockup, sunset glow, five venue names, waves |

The waves, scallop shingles, sun, glow and gull are generated as small inline
SVG images with an explicit intrinsic size (without one, a canvas export
rasterises them at 300 × 150 and the pattern breaks). Photo slots are `image`
variables whose default is the dashed placeholder, so swapping the variable
removes the cue in one step. The ten cards declare a 4 % safe margin — the
margin the artwork was drawn with — instead of the social channel default, and
merge their brighter site palette into the composition kit so the off-palette
guardrail stays honest. The group lockup comes from the pack's portfolio
assets; without a portfolio the template still builds, just without the group
mark.

A menu arrives with 17 variables (`menu_title`, five × `item_N_name`,
`item_N_desc`, `item_N_price`, `menu_footer`); a business-card back carries
the canonical contact block; a voucher has value, terms and code. Row-based
briefs can replace any of them.

### Create, Use kit and publish
- **Create** writes a new project, opens it in the studio and closes the
  dialog. The action:

  1. builds the composition in Node (the same code the studio loads),
  2. writes `data/imports/<id>/composition.json`,
  3. copies referenced images/logos into `data/imports/<id>/assets/` and
     rewrites layer and kit URLs to `/data/imports/<id>/assets/…`; the static
     server exposes only image/video files inside an import, never
     `composition.json`, `source.zip` or the rest of `data/`,
  4. records the pack's shared kit id in `meta.sharedKitId` but keeps a
     **local kit snapshot**, so deleting the pack cannot break the creative.

- **Use kit** attaches the brand kit to the *current* composition without
  leaving it — useful for a scene that already exists.

- **Save current composition…** (Export panel) and **Publish…** (on an
  in-progress project) snapshot the scene into the brand's template library.
  The snapshot is independent of the project: later edits do not rewrite a
  template someone already published.

- **Open copy** on a saved template creates a new project and copies the
  snapshot's files into it, so deleting the template cannot break the copy.

### Saved templates and in-progress work
The Templates tab reads `GET /api/brand-packs/:id/templates?brandId=…` and
shows two extra sections:

- **Saved brand templates** — published snapshots under
  `data/brand-packs/<pack>/templates/<brand>/<template>/template.json`, with
  **GIF**, **MP4** and **Delete** actions.
- **In progress** — projects whose `composition.meta.packId`/`brandId` match
  the brand and whose `meta.source` is `brand-template`. These are the scenes
  already generated for that business; open one, keep editing, then publish.

Published snapshots are also listed in the **Brand templates** libraries in
Studio Agent and Asset Studio, where they can be opened as editable designs.

### Publishing every template at once
`npm run publish:templates` snapshots every built-in template for every brand
in every pack, using the same `saveBrandTemplate` path as the Studio's
**Publish…** button (no HTTP server required).

```bash
npm run publish:templates -- --dry-run            # list what would be written
npm run publish:templates -- --pack okja          # one pack (substring match)
npm run publish:templates -- --brand <brandId>    # one brand
npm run publish:templates -- --template flyer     # one template id
npm run publish:templates -- --force              # replace existing snapshots
```

The run is idempotent: templates already published for a `sourceTemplateId`
are skipped, so a second run reports `Published 0 · skipped N · failed 0`.
`--force` deletes the stale snapshot before writing the new one, so
re-publishing after a composition change replaces the artwork instead of
stacking a duplicate.

Both sections render the composition through the same preview path as the
initial cards and offer **GIF**/**MP4** without replacing the scene open in
the editor. GIFs are capped at 480 px / 10 fps by the existing export pipeline.
MP4 records at 30 fps; when the optional `ffmpeg` binary is present the server
transcodes the browser recording to H.264/AVC (see
`POST /api/video/transcode`), otherwise the browser's own MP4/WebM is kept.

---

## 7. Shared brand kits

A kit can live in one place and be attached by many compositions.

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/brand-kits` | `{ kits: [{ id, name, palette, fonts, logos, updatedAt }] }` |
| `GET` | `/api/brand-kits/:id` | `{ kit, updatedAt }` |
| `PUT` | `/api/brand-kits/:id` | save (create or replace) |
| `DELETE` | `/api/brand-kits/:id` | delete |

Kits are JSON under `data/brand-kits/`, validated through
`normalizeBrandKit`, capped at 512 KB each and 200 kits.

In **Tools → Brand kit**:

- **Save as shared kit** creates the shared kit and attaches it.
- **Attach** points `brandKitId` at an existing kit.
- **Save kit** writes the *shared* kit when one is attached, so an edit
  reaches every composition that uses it.
- **Detach** drops the reference and keeps the local copy.
- **Delete shared kit** removes it; compositions keep working because
  attaching also stores a local snapshot.

That snapshot is the important detail: `effectiveBrandKit()` prefers the
shared kit and falls back to the embedded one, so a deleted or unreachable
shared kit degrades to the last known version instead of leaving a
composition kitless.

---

## 8. API and storage

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/api/brand-packs` | `{ packs: [{ id, name, description, brandCount, brands, createdAt, storage }] }` |
| `POST` | `/api/brand-packs/import` | `{ zip: dataUrl, zipName?, name? }` → `{ pack, summary }` |
| `GET` | `/api/brand-packs/:id` | `{ pack, updatedAt }` |
| `DELETE` | `/api/brand-packs/:id` | `{ deleted: true }`; the pack's shared kits are removed, while existing compositions keep their embedded snapshots and created templates keep their copied assets |
| `GET` | `/api/brand-packs/:id/files/<brand>/<path>` | An asset or a guide with its real content type |
| `POST` | `/api/brand-packs/:id/templates` | `{ brandId, templateId, name? }` → `{ project, composition }` (Create) |
| `GET` | `/api/brand-packs/:id/templates?brandId=…` | `{ templates, projects }` — published snapshots and in-progress brand projects |
| `POST` | `/api/brand-packs/:id/templates/save` | `{ brandId, name?, composition?, projectId? }` → `{ template, composition }`; publishes a snapshot |
| `POST` | `/api/brand-packs/:id/templates/<brand>/<template>/open` | `{ name? }` → `{ project, composition }`; creates an editable copy |
| `DELETE` | `/api/brand-packs/:id/templates/<brand>/<template>` | `{ deleted: true }`; the source project is untouched |
| `GET` | `/api/brand-packs/:id/templates/<brand>/<template>/files/<path>` | Copied template asset (image/video only) |
| `POST` | `/api/video/transcode` | Raw video body → H.264 MP4; `501` when `ffmpeg` is unavailable |
| `GET` | `/data/imports/<id>/<path>` | Read-only raster/video files inside an import; JSON, ZIPs and dotfiles are `404` |

A pack is `data/brand-packs/<id>/pack.json` plus `files/<brand>/…`.
Limits: 160 MB ZIP, 480 MB extracted, 4000 files, 40 MB per asset, 240
assets per brand, 50 packs.

---

## 9. Adding a brand pack

1. Produce the ZIP in the structure above (one folder per brand, a Word
   guide and/or a tokens JSON).
2. Layer Studio → Brand identity → **Import brand ZIP**.
3. Check the summary for warnings (dark/light mismatches, repaired SVGs,
   missing guides).
4. Open a brand → *Identity* to confirm palette, type and logo cuts.
5. *Templates* → **Create** the pieces you need.
6. Edit the scene, then **Export → Save to brand…** (or **Publish…** on an
   in-progress card). It appears under *Saved brand templates* and can be
   reopened as a copy or exported as PNG, GIF or MP4.
7. In Asset Studio, the new group appears in the gate automatically.

No code change is required. The gate tabs, group selector and brand switch
are driven by `/api/brand-packs`.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Import says no brands found | No folder with `tokens/*.tokens.json` or `*Brand-Guide.docx`; check the ZIP root |
| A brand is missing | Its folder was detected as *portfolio*, or it had no tokens and no guide |
| Colours look inverted | The guide names ground/ink explicitly; check the applications-matrix row |
| Text renders in Helvetica/Georgia | Licensed fonts are substituted by design; upload the real files and relink |
| A logo is blank | The SVG was unrepairable; re-export it as a clean SVG or PNG |
| Template fonts warn on export | Upload the family, or accept the recorded substitution |
| A created template shows broken photos/logos | The static `/data/imports/<id>/assets/…` route must be reachable; the server exposes image/video files only, so a `composition.json` URL is a bug |
| MP4 downloads but will not play elsewhere | Install `ffmpeg` (or set `STUDIO_FFMPEG`) so the server can transcode the browser recording to H.264 |
| Deleting a pack broke nothing, but kits vanished | Expected: compositions keep snapshots; shared kits and the pack's saved templates are removed |


### Library linkage

Imported pack files can be indexed into the Business Asset library from
`/library.html` or `POST /api/assets/index-pack`. The library stores references,
not copies: deleting a pack marks its records `orphaned` and the export gate
blocks them. The Brand identity drawer shows a per-brand Library health tab.


### Social tab

Brand identity can now show a read-only **Social** tab. It calls
`GET /api/social/by-brand?brandId=&name=` and matches the pack brand to a
scraped profile by name/slug/alias. The tab shows followers, rating, reviews,
channels and the number of evidence-backed actions, then links to
`/social.html`. The full method and limits are in
[social-intelligence.md](social-intelligence.md).
