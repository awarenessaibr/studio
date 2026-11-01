# Asset Studio

The final-asset surface: choose a brand, choose a category, choose a layout,
change the copy, download a print-ready result. No timeline, no layer tree,
no keyframes.

`/asset-studio.html`

---

## 1. When to use it

Use Asset Studio when the artwork is **finished and on-brand**:

- this week's specials flyer, a new menu, a gift voucher;
- a business card, table card, door hanger or welcome card;
- an A-board, poster, digital menu board or roll-up banner;
- a sticker, coaster, sleeve or voucher envelope;
- an allergen matrix or a thermal prep label;
- an announcement, carousel, link image, cover or email header.

Use [Layer Studio](layer-studio.md) instead when you need to **compose or
animate** something (a scene from cut-outs, a character rig, a template with
per-format overrides, an MP4).

Both read the same brand packs and share the `data/` tree. A template
created from a brand pack opens in Layer Studio like any other composition;
Asset Studio themes its own layouts from the same identity.

---

## 2. The gate

On load, a full-screen gate asks which brand you are working for.

- **Group tabs** across the top of the gate: Dalton family venues,
  Monteleone Group, Cawley Hotels, KitchenOS, Okja (every imported brand pack
  becomes a group automatically).
- A grid of brand cards, each with its cover image, wordmark and venue count.
- Choosing a card opens the workspace and remembers the choice.
- The top bar's **group selector** switches groups while working, and each
  group remembers the **last brand used**, so switching back restores context.
- Saved assets are global: they survive a group switch and restore with their
  own brand and design.

Shipped groups (from `data/brand-packs/`): **5 packs / 17 brands** —
Dalton (The Adamson, HATCH, The Physician), Monteleone (The Butterfly and the
Pig, The Marlborough, The Singl-end), Cawley (Boardwalk, The Boat Yard, Coast
Bar & Restaurant, Duck Bay Hotel & Cottages, River House), KitchenOS
(Kitchen OS, Food Safe System, Food Label System, AllerQ, F*** Waste), Okja
(okja).

If no pack is imported, the gate explains that brand packs need the local
server (`npm start`) and nothing renders.

---

## 3. Workspace anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ Group ▾   Asset Studio   [brand switch]      Brand identity  Studio V2│
├──────────────────────────────────────────────────────────────────────┤
│ Flyers (5)  Menus (4)  Gift vouchers (4)  Business cards (3)  …     │
├───────────────┬──────────────────────────────────────────────────────┤
│ DESIGNS       │  Brand · Category                                    │
│ [thumb] [thumb]│  ┌────────────────────────────────────────────────┐  │
│ 1 of 5        │  │            LIVE CANVAS PREVIEW                 │  │
├───────────────┤  └────────────────────────────────────────────────┘  │
│ CONTROLS      │  Download PNG  Print  Print pack  Save asset        │
│ Colours Type  │                                                      │
│ Image Motif   │                                                      │
│ Text Size Saved│                                                     │
└───────────────┴──────────────────────────────────────────────────────┘
```

- **Category nav** — eleven categories, each labelled with its design count.
- **Designs** — thumbnail grid of that category's layouts; `n of m` shows
  position. Thumbnails render with the current text so they preview the
  brand, not a placeholder.
- **Controls** — one tab at a time: *Colours, Type, Image, Motif, Text, Size,
  Saved*.
- **Preview** — a canvas at the design's true aspect, repainted on every
  change.
- **Export bar** — PNG, print, print pack, save.

**Brand identity** opens a drawer with the active brand's palette,
typography, logos, photography, applications matrix, voice and a link to the
Word guide. **Apply this palette & type** restores the pack defaults after
experimenting.

---

## 4. Categories and designs

50 layouts across eleven categories. Sizes are the presets offered in *Size*;
a design exposes only the presets that suit it (a roll-up does not offer a
story crop).

### Flyers — 5 designs
| Design | Character |
|---|---|
| Table worth crossing | Full-bleed photo band, gradient, CTA |
| Christmas · photo | Framed photo, poster type |
| Christmas · type | All-type poster with accent rule |
| Bold colour | Flat accent flood, contrast-aware text |
| Night photo | Dark photo, accent price, CTA |

Sizes: A4 portrait 1240×1754, A3 poster 1754×2480, portrait 4:5 1080×1350,
story 9:16 1080×1920.

### Menus — 8 designs
| Design | Character |
|---|---|
| Classic | Logo, rule, and a name / description / price list |
| Festive | Uppercase title, two courses, footer |
| Centred | Centred items, quieter |
| Photo header | Photo band above the list |
| Drinks / cocktail list | Accent spine, glass motif, sectioned list |
| Wine list | Two columns of name / region with glass and bottle prices |
| Kids menu | Family list plus a colour-in activity panel (portrait and landscape) |
| Takeaway / delivery menu | Compact list with an order QR and delivery line |

Sizes: A4 1240×1754, A5 874×1240, slim DL 585×1240, A4 landscape
1754×1240, story 1080×1920. Items are typed one per line; start a line with
`#` for a section heading. See [tabular copy](#tabular-copy) for the wine list.

### Gift vouchers — 4 designs
| Design | Character |
|---|---|
| Brand accent | Accent field, big amount, code panel or QR |
| Secret Santa | Oversized amount, festive code |
| Cream classic | Paper ground, side accent bar, code panel |
| Christmas sprig | Botanical motif, seasonal message |

Sizes: wide card 2480×1169, A5 landscape 1748×1240, digital 16:9 1600×900.

### Business cards — 3 designs
| Design | Character |
|---|---|
| Brand accent | Accent front, quote/tagline, back with contact block |
| Cream & accent | Paper ground, centred logo, hairline |
| Photo front | Photographic front, back with contact block |

Sizes: front 1004×650, back 1004×650, both sides as one image 1004×1340
(85 × 55 mm at 300 dpi). The back is generated from the brand guide's
canonical contact block.

### Table cards — 4 designs
| Design | Character |
|---|---|
| Chef's special | Dish, description, price, allergen note |
| Season's greetings | Botanical motif and greeting |
| Scan for the menu | Large QR with a short line |
| Reserved | Big word, name and time, accent band |

Sizes: A5 portrait 1240×1748, square 1200×1200.

### Social posts — 9 designs
| Design | Character |
|---|---|
| Statement | Type-led, logo, handle |
| Chef's special | Photo, dish, price |
| Sunday sessions | Photo, big title, CTA |
| Christmas icon | Illustrated glass, dates, offer |
| Announcement | Flat accent field, rule, headline |
| Carousel set | 3–10 slides from a cover, one point per line, and a CTA |
| Link-share image | Open Graph 1200×630 with a copy panel and motif |
| Cover banner | Centred for Facebook events/pages and LinkedIn |
| Email header | Logo, headline and a footer rule at 1200×400 |

Sizes: square 1080×1080, portrait 4:5 1080×1350, story 9:16 1080×1920,
link 1200×630, Facebook event 1920×1005 (and a 1200×628 minimum),
Facebook page 820×312, LinkedIn personal 1584×396, LinkedIn company
1128×191, email 1200×400. Carousel uses square and portrait only; cover
banner uses the five cover sizes.

### Signage — 5 designs
| Design | Character |
|---|---|
| A-board special | Chalkboard ground, street-readable specials with dotted leaders |
| Event poster | Full-bleed photo, poster title, date, act, CTA |
| Digital menu board | Two-column screen menu (single column in portrait) |
| Roll-up banner | Tall banner: logo, photo, headline, QR, address |
| Opening hours & notice sign | Large type for hours, notices, “please wait” |

Sizes: A1 2339×3311 (100 dpi), A3 1754×2480, A2 1654×2339 (100 dpi),
screen 1920×1080 and 1080×1920, roll-up 1673×3937 (50 dpi), A4 1240×1754,
A5 874×1240, DL 585×1240. The digital menu board is screen-only; the
others are print.

### Guest cards — 4 designs
| Design | Character |
|---|---|
| Loyalty stamp card | 6/8/10 stamp grid, reward line, terms on the back |
| Review-us card | Large review QR with a thank-you line |
| Door hanger | Die-cut hanger with a punched hole, two sides |
| Welcome & Wi-Fi card | Network, password, join QR, breakfast and reception |

Sizes: loyalty 85×55 mm both sides (1004×1340 canvas), review card
85×55 mm and A6, door hanger 90×210 mm die-cut both sides, welcome card A6.
The door hanger is shaped; the print pack adds a cut line.

### Stationery — 2 designs
| Design | Character |
|---|---|
| Letterhead | Logo, brand line, address block, footer rule, clear body |
| Thank-you / compliment card | Centred note with logo, rule and contact |

Sizes: A4 1240×1754, DL landscape 1240×585, A6 landscape 874×620.

### Packaging — 4 designs
| Design | Character |
|---|---|
| Round sticker / bag seal | Circular seal: short line, motif, brand handle |
| Coaster | Round or square coaster: logo, motif, tagline |
| Cup / bottle sleeve | Three-panel wrap: logo panel, message panel, venue panel |
| Voucher envelope | Envelope with a flap line, logo, message and QR |

Sizes: sticker 50 mm and 70 mm circles, coaster 90 mm circle and 95 mm
square, sleeve 230×90 mm, envelope DL 220×110 mm and C6 162×114 mm. All
carry a die-cut shape; the print pack draws the cut line.

### Compliance — 2 designs
| Design | Character |
|---|---|
| Allergen matrix | Dish × 14-allergen grid with abbreviation header, legend and updated date |
| Prep / day-dot label | Thermal label: item, prep/use-by boxes, initials, allergens, storage |

Sizes: allergen matrix A4 landscape 1754×1240, prep label 50×30 mm and
76×51 mm (thermal, greyscale).

---

## 5. Controls

### Colours
- Four one-click palettes: **Brand** (ground/ink/accent inferred from the
  pack for this category), **Inverted**, **Light**, **Dark**.
- Per-role controls for **Background / Text / Accent**: pick any brand
  swatch by name, or a custom colour.
- Text on a colour flood is contrast-aware: the engine picks a legible ink
  for the ground or accent rather than trusting a fixed hex.

### Type
- **Display** and **body** roles, each selectable from the brand's families,
  a curated studio stack (~37 options on the display role) and uploaded
  fonts.
- Per-brand type profiles apply where the brand system requires them (for
  example Cawley's uppercase Mulish 700 titles, Okja's 900-weight headline).
- **Upload a font** accepts WOFF2/WOFF/TTF/OTF and stores it in the shared
  font registry (`data/fonts/`), so it appears in both studios.

### Image
- Brand **photography** from the pack (dimensions shown), plus uploads.
- Brands without photography get a *branded pattern or flat tile* instead of
  a grey hole — the Image tab still says no photography is attached.
- Logos are sampled against the area they cover: a white logo over a bright
  photo falls back to brand ink.

### Motif
14 options: **Original, Botanical, Cocktail, Rod, Sparkle, Sun, Arch, Wave,
Leaf, Diamond, Cross, Laurel, Ring, None**. *Original* keeps the motif the
layout was designed with; some brands default the medical rod off.

### Text
The copy fields for the selected design (headline, sub-head, body, date,
price, CTA, footer, address, contact, …). Empty fields disappear from the
design. Designs that support it also offer a **QR code link** (with a
"use the website" shortcut). Copy is brandified on brand switch, but
design-specific labels are preserved (a Secret Santa voucher still says
Secret Santa).

#### Tabular copy

Menus use one line per item, `# Section` for headings and `Name | Description
| Price` for rows. Three designs accept more columns:

| Design | Field | Row syntax |
|---|---|---|
| Wine list | `wines` | `Name \| Region / grape \| Glass price \| Bottle price` |
| Allergen matrix | `items` | `Dish \| allergen, allergen, …` |
| Digital menu board | `items` | `Name \| Description \| Price` (split at `#` headings) |

Allergen names may be full (`milk`, `sulphites`), abbreviated (`Mil`, `Sul`)
or numbers 1–14. The 14 columns are Celery, Gluten, Crustaceans, Eggs, Fish,
Lupin, Milk, Molluscs, Mustard, Tree nuts, Peanuts, Sesame, Soya, Sulphites.

#### Slides

The **Carousel set** is multi-slide. `points` is one line per slide; the first
slide is the cover (`eyebrow`, `title`, `sub`) and the last is the CTA
(`cta`, `foot`), so *n* points make *n + 2* slides (3–10). A slide navigator
appears under the preview (`‹`, `Slide 2 of 6`, `›`) with **Download 6
slides**, which renders numbered PNGs (`…-slide-01.png`).

### Export profile

Each design declares a profile:

| Profile | Exports offered |
|---|---|
| **print** (default) | PNG, Print, Print pack (PDF) |
| **screen** | PNG, JPG — the print pack is hidden, with a note |
| **thermal** | greyscale PNG; no CMYK print pack |

Profiles are per design, so a category can mix them (the signage board is
screen-only, the A-board is print).

### Brand fit

The expansion spec suggests some designs for particular brands (hotel cards
for Cawley, wine lists for restaurants, allergen and prep labels for
KitchenOS). Every design is currently available to every brand — the gate
stays predictable and a venue can still choose a layout outside its usual
run. Hiding by brand would be a small addition to `CATEGORY_META` if wanted.

### Size
The size presets that apply to the selected design, with their dimensions in
the label. A category can mix print and screen sizes; each design filters the
list (a roll-up banner offers only the roll-up, a carousel only square and
portrait).

### Saved
- **Save asset** stores the design, size, palette, type, copy, motif and
  images in browser storage (`assetStudio.saved.v1`).
- The tab lists saved assets with **Open** and delete; the count appears in
  the tab.
- Saved assets restore across groups and survive a reload, but they live in
  **this browser profile** — they are not written to `data/`.

---

## 6. Output

| Action | What it does |
|---|---|
| **Download PNG** | Renders at the full resolution of the selected size (die-cut shapes export with transparency; thermal export is greyscale) |
| **Download JPG** | Screen designs only; flattened on white |
| **Print** | Opens the browser print dialog with a print stylesheet (page = the asset size) |
| **Print pack (PDF)** | CMYK PDF with bleed, trim, crop marks and (for die-cuts) a vector cut line, plus the safe-zone report |
| **Save asset** | Stores it in the Saved tab (see above) |
| **Download N slides** | Carousel only; numbered PNGs for every slide |

### Print pack

The dialog exposes:

| Option | Values |
|---|---|
| Bleed | 0 mm (trim only), 3 mm (standard), 5 mm (large format) |
| Safe margin | 3 mm, 4 mm (standard), 5 mm |
| Resolution | 300 dpi (print), 150 dpi (draft / large), 100 dpi (poster), 50 dpi (banner) |
| Crop marks and slug | on/off |

The resolution opens at the preset's working dpi (A1/A2 100 dpi, roll-up
50 dpi, print 300 dpi). The metadata block reports **Large format** when
applicable.

It then:
1. renders the asset at the chosen resolution,
2. extends the edge artwork into the bleed and lays the trim render over the
   centre,
3. draws crop marks and a slug line, plus a magenta **cut line** for a
   die-cut shape (circle, rounded rectangle or hanger with its hole),
4. converts RGB to CMYK and writes the PDF streams (compressed where the
   browser supports it),
5. reports **trim / bleed / page** dimensions and a **safe-zone check**:
   dashed line = safe margin, red boxes = text or logo boxes inside it. The
   notice is advisory — the PDF can still be generated.

**Honest limits:** the conversion is direct RGB→CMYK with no ICC output
intent, so this is not PDF/X-certified. It reliably provides trim/bleed
boxes, crop marks and a box-based preflight. The printer's own profile and
preflight remain authoritative. The safe-zone check covers recorded text and
logo boxes, not every decorative shape; full-bleed images are meant to cross
the trim.

---

## 7. Where the brand data comes from

- Brand packs and kits: `/api/brand-packs` (see [brand-packs.md](brand-packs.md)).
- Uploaded fonts: `/api/fonts`.
- Layouts: `asset-studio/categories.js` (the 50 designs).
- Renderer and motif library: `asset-studio/engine.js`.
- Print writer and preflight: `asset-studio/print.js`.
- Brand adapter, controls, saved assets, exports: `asset-studio/app.js`.

Only **copy defaults** for the Monteleone, Cawley, KitchenOS and Okja groups
are hard-coded (`BRAND_COPY` in `app.js`) — deliberate, hand-written brand
voice. Identity data itself always comes from the pack. Adding a new group is
a pack import; the gate and selectors pick it up with no code change.

---

## 8. Recipes

### Weekly specials, three channels
1. Gate → venue → **Flyers** → *Night photo*.
2. Text tab → headline, price, description.
3. Size → *Portrait 4:5* → Download PNG.
4. Size → *A4 portrait* → Print pack (3 mm bleed, 300 dpi) → send to print.

### New venue kit in ten minutes
1. Brands with no photography: pick a motif (Arch, Wave, Leaf) so the flat
   tile still looks designed.
2. **Business cards** → *Cream & accent* → *Both sides* → print pack.
3. **Menus** → *Classic* → paste the dish list → A4 print pack.
4. **Social posts** → *Announcement* → download PNG.

### Signage and screen from one brand
1. **Signage** → *Digital menu board* → edit the item list → *Landscape 16:9*
   → Download PNG. Screen designs hide the print pack.
2. Same category → *A-board special* → *A1 portrait* → Print pack. The dialog
   opens at 100 dpi and says **Large format**.
3. **Signage** → *Opening hours* → *DL* → print a stack for the door.

### Packaging and labels
1. **Packaging** → *Round sticker* → *Circle 50 mm* → PNG (transparent
   outside the circle) or print pack (magenta cut line).
2. **Packaging** → *Coaster* → *Round 90 mm*; swap the motif.
3. **Compliance** → *Prep label* → *Label 50×30* → Download greyscale PNG.
4. **Compliance** → *Allergen matrix* → paste `Dish | allergen` rows → A4
   landscape print pack.

### Swap a campaign's palette
1. Open the Colours tab → *Inverted* (or a custom brand swatch).
2. Check the design's contrast-aware text has flipped correctly.
3. **Apply this palette & type** in the identity drawer restores pack
   defaults if you change your mind.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Gate says packs need the local server | Open via `npm start`, not `file://` |
| A brand is missing from the gate | Its pack is not in `data/brand-packs/`; import it in Brand identity |
| Saved assets disappeared | Browser storage was cleared, or you are in another browser profile |
| Print PDF has no CMYK intent warning | Expected — not PDF/X; the printer's preflight is authoritative |
| A logo looks wrong in the slot | Only a real wordmark is used; marks and presentation plates fall back to type |
| A brand shows no photography | That pack has none; the engine uses a branded tile |
| Print pack is missing | The design is screen-only or thermal; export PNG/JPG instead |
| A die-cut preview shows a light square | The stage sits behind the shape; the PNG is transparent outside it |
| The cut line is not the printer's die-line | It is a guide in magenta; use the supplier's die-line for the final cut |
| Slide download only saved one file | Allow multiple downloads for the site, or use the per-slide preview to save individually |
| A new category has no copy fields | The Text panel derives fields from the design; check the template's `t` keys |
