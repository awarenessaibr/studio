# Brand packs and brand identity

A **brand pack** is a ZIP of a scraped brand-kit folder: one portfolio
(group) plus one or more businesses, each with its own palette, type, logos,
photography, Word guide and starter templates.

> Reviewing a new scrape before importing it? See
> [scraped-brand-kit-review.md](scraped-brand-kit-review.md) and
> [scraped-july-dalton-review.md](scraped-july-dalton-review.md) for the audit
> checklists and the common schema/asset traps.

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
- Anything whose path says *portfolio* is skipped as a brand.
- A ZIP wrapped in a single top-level folder is unwrapped automatically.
- Numbered folders keep their reading order.

---

## 3. What the importer reads

| Source | Becomes |
|---|---|
| `tokens/*.tokens.json` | Palette (HEX / RGB / CMYK, role, share, tier), typography families + scale, voice attributes / prefer / avoid, logo notes |
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
- Each brand has three detail tabs:

| Tab | Contents |
|---|---|
| **Identity** | Cover hero, palette swatches with names/roles, typography families with weights and cuts, voice attributes, logo cuts by variant, photography with dimensions, type specimens |
| **Templates** | A live miniature of each generated template, the guide sentence that shaped it, **Create** and **Use kit** |
| **Guidelines** | Applications matrix, print specification, canonical contact block, facts, type hierarchy, logo rules, and the source document's sections; the Word guide is downloadable |

Everything is read from the pack; nothing is retyped in the UI.

---

## 6. Starter templates

Seven real v3 compositions are generated from the identity and guide. Sizes
are print sizes at 300 dpi unless stated.

| Template | Size | Formats | Layers | Variables | What is already built |
|---|---|---:|---:|---:|---|
| `menu` | A4 · 2480 × 3508 | A5, A3 | 22 | 17 | Ground, rule, logo, kicker, title, 5 dishes × (name, description, price), footer |
| `business-card-front` | 85 × 55 mm · 1004 × 650 | — | 5 | 2 | Brand ground, mark/wordmark, tagline, hairline, website |
| `business-card-back` | 85 × 55 mm · 1004 × 650 | — | 8 | 6 | Name, role, phone, email, address, website, social from the guide's contact block |
| `flyer` | A5 · 1748 × 2480 | — | 8 | 5 | Photo band, logo, headline, sub-head, body, CTA, footer |
| `table-card` | A6 · 1240 × 1748 | — | 8 | 5 | Mark, kicker, dish, description, price, allergen note |
| `voucher` | DL · 2480 × 1169 | — | 8 | 5 | Logo, title, value, terms, redemption code panel, footer |
| `social-post` | 1080 × 1080 | 4:5 portrait | 6 | 3 | Logo, headline, sub-head, handle/website |

Every one is a normal composition: per-template variables with bindings, a
format list, the brand kit and safe zones. Nothing is a screenshot or a
special layer type, so the variable editor, brief ingestion, contact sheet,
batch export, guardrails and agent protocol all apply to it.

A menu arrives with 17 variables (`menu_title`, five × `item_N_name`,
`item_N_desc`, `item_N_price`, `menu_footer`); a business-card back carries
the canonical contact block; a voucher has value, terms and code. Row-based
briefs can replace any of them.

### Create vs Use kit
- **Create** writes a new project, opens it in the studio and closes the
  dialog. The action:

  1. builds the composition in Node (the same code the studio loads),
  2. writes `data/imports/<id>/composition.json`,
  3. copies referenced images/logos into `data/imports/<id>/assets/` and
     rewrites layer and kit URLs to the static `/data/` path,
  4. records the pack's shared kit id in `meta.sharedKitId` but keeps a
     **local kit snapshot**, so deleting the pack cannot break the creative.

- **Use kit** attaches the brand kit to the *current* composition without
  leaving it — useful for a scene that already exists.

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
| `POST` | `/api/brand-packs/:id/templates` | `{ brandId, templateId, name? }` → `{ project, composition }` |

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
6. In Asset Studio, the new group appears in the gate automatically.

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
| Deleting a pack broke nothing, but kits vanished | Expected: compositions keep snapshots; shared kits are removed |
