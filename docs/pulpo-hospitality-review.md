# Pulpo Hospitality crawl review — as it is

**Run** `data/_crawler/runs/pulpo-hospitality-20261102044318-7071/`
**Crawl** 2 November 2026, 04:43–04:55 UTC (741 s), group mode, four targets
**Imported pack** `pulpo-hospitality-20261102065339-9f00` (auto, in the studio now)
**Purpose** judge the automatic scrape → brand kit → studio import against what
a brand system and Asset Studio actually need.

> `data/` is git-ignored; paths are local to this machine. This document is the
> durable record. The reviewed and re-built output is described in
> [pulpo-hospitality-refinement.md](pulpo-hospitality-refinement.md); the
> pipeline changes it argues for are in
> [pulpo-hospitality-improvements.md](pulpo-hospitality-improvements.md).
>
> **Studio state:** the automatic pack reviewed here
> (`pulpo-hospitality-20261102065339-9f00`) is untouched. The refined pack
> (`pulpo-hospitality-refined-20261102073203-ae4c`) was imported beside it as
> a second group so the two can be compared in the brand gate.

---

## 1. Verdict

The **raw material is the best this pipeline has produced**: four complete site
captures, 33 menu PDFs, 571 downloaded photographs, four social dossiers,
and a group pack that imports as **one group with four brands** and native
tokens. The capture is genuinely usable.

The **automatic identity layer is not**: the palette is WordPress preset
colours, the typography is icon fonts, three of four brands have no logo, one
has no photography and no cover, the menus are empty, the email field prints
`Not found`, and the guides carry no type hierarchy, print spec, facts or logo
rules. Imported as-is, Asset Studio themes every design in the wrong colours and
every menu in the same scallops-and-beef placeholder.

**Scores**

| Layer | Score | Why |
|---|---|---|
| Structure & schema | 9/10 | One group pack, `00-portfolio/`, importer-native tokens, `content/` field, clean folder order |
| Importable brand metadata | **3/10** | Palette 83% WordPress UI, accents `#ff6900` / `#fcb900` / `#007cba`, icon fonts, no tagline, empty voice |
| Importable visual assets | **3/10** | 1 logo across 4 brands, La Casa 0 photos and no cover (palette strip becomes the gate card), covers duplicate photo 01 |
| Content (menus) | **2/10** | 0 / 0 / 1 / 1 dishes imported against 32 distinct priced PDFs and 18,791 words |
| Contact | 5/10 | Present, but one address per multi-site brand, wrong Le Bistrot address, `Email: Not found` on every brand |
| Guides | 4/10 | Positioning, applications and contact parse; **type hierarchy 0, print spec 0, facts 0, logo rules 0** |
| Studio fit | 4/10 | Generic menu items, "Dalton family venue" voucher terms, website URL in the Instagram slot, no email |
| Social research | 7/10 | Ratings, review themes, NAP and handles are strong — and correctly kept out of the brand assets |
| **Overall** | **4.5/10** | Strong crawl, weak identity; the gap is fixable in the pack, not in the crawl |

**Three decisions before the next Pulpo-style drop**

1. **Treat the print PDFs as the identity source of record.** Every brand's real
   palette, typeface and logo is in its menu PDFs; every one of those signals is
   currently ignored in favour of CSS variables and page markup.
2. **Fix content extraction before anything else.** `extract_content_pack` takes
   the *first* file whose name contains "menu" — which is the kids menu (Pomo)
   and the lunch menu (Mia). That single line explains the 0/0/1/1 result.
3. **Decide who owns the guide contract.** The DOCX writer emits `Role | Family |
   Observed size` and logo rules as prose; the reader looks for `ROLE | TYPEFACE`
   and a `RULE | SPECIFICATION` table. Either side could move; the mismatch is
   why four of the six guide tables import empty.

---

## 2. Inventory

### 2.1 The run

| Path | Size | Files | Contents |
|---|---:|---:|---|
| `output/<domain>_root/` ×4 | 174 MB | 571 images + 33 PDFs | pages text, images, documents, CSVs |
| `output/_social/` | 12 MB | 240 | four reputation/social dossiers + cache |
| `output/Pulpo-Hospitality-brand-kit/` | 11.6 MB | 92 | the importable group pack |
| `output/Pulpo-Hospitality-brand-kit.zip` | 11.3 MB | 88 | same pack |
| **run total** | **174 MB** | **1,026** | |

| Site | Pages visited | Text pages | Words | £ markers | Images | PDFs | PDF words |
|---|---:|---:|---:|---:|---:|---:|---:|
| la-casa-restaurant.co.uk | 121 | 35 | 3,689 | 0 | 172 | 12 | 6,372 |
| lebistrot.co.uk | 121 | 19 | 3,898 | 2 | 96 | 3 | 2,640 |
| mia-restaurant.co.uk | 107 | 17 | 4,319 | 0 | 166 | 13 | 6,419 |
| pomopizzeria.co.uk | 72 | 7 | 2,318 | 0 | 137 | 5 | 3,360 |
| **total** | **421** | **78** | **14,224** | **2** | **571** | **33** | **18,791** |

The £ column is the tell: **the menu pages are PDF or image embeds** (11–24 words
each), so all priced content lives in the PDFs. Page text is still good for
story, contact and voice; it is not a menu source.

### 2.2 The automatic kit

```
Pulpo-Hospitality-brand-kit/            92 files, 11.6 MB
├── README.md                           group name, brand table
├── targets.json                        crawler hand-off (business records)
├── 00-portfolio/                       overview.docx, portfolio.json, group report
├── 01-la-casa-restaurant/              guide.docx, brand-guide.json, tokens/, content/,
│                                       assets/{colors,type} only, social/
├── 02-lebistrot/                       + 1 logo, 5 photos, cover.webp
├── 03-mia-restaurant/                  + 6 photos, cover.jpg
└── 04-pomopizzeria/                    + 6 photos, cover.jpg
```

Each brand folder also carries the full `social/` dossier (insights, HTML
report, reviews CSV, platform JSON). It is research, and the importer correctly
skips it — but it adds ~10 MB and invites the wrong assets to be copied.

### 2.3 What is in each brand, as crawled

| Brand | Palette | Accent | Families | Icons in families | Scale | Voice | Menu items | Logos | Photos | Cover |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|
| La Casa | 14 (12 WP) | `#ff6900` | 6 | 1 | 5 | empty | 0 | **0** | **0** | **none** |
| Le Bistrot | 14 (12 WP) | `#ff6900` | 4 | 1 | 5 | empty | 0 | 1 | 5 | photo dup |
| Mia | 14 (8 WP) | `#fcb900` | 8 | 3 | 5 | empty | 1 | **0** | 6 | photo dup |
| POMO | 14 (9 WP) | `#007cba` | 8 | 3 | 5 | empty | 1 | **0** | 6 | photo dup |

WordPress presets found in the palettes include `Wp Preset Color Black`,
`Wp Preset Color Luminous Vivid Orange` (`#ff6900`), `Wp Preset Color Luminous
Vivid Amber` (`#fcb900`), `Wp Admin Theme Color` (`#007cba`) and the seven
`Wp Preset Color` swatches that ship with every block theme. La Casa's accent is
the WordPress link orange; POMO's is the WP admin blue.

### 2.4 What the studio actually imported

Through the real `createBrandPackImport` (not a simulation):

| Imported field | La Casa | Le Bistrot | Mia | POMO |
|---|---|---|---|---|
| Pack name | Pulpo Hospitality | same | same | same |
| Brand name / id | La Casa / `la-casa-restaurant` | Le Bistrot / `lebistrot` | Mia Italian Kitchen / `mia-restaurant` | POMO Pizzeria / `pomopizzeria` |
| Tagline | empty | empty | empty | empty |
| Palette | 14 | 14 | 14 | 14 |
| Type families | 6 | 4 | 8 | 8 |
| Type scale | 5 | 5 | 5 | 5 |
| Logos | **0** | 1 | **0** | **0** |
| Photography | **0** | 5 | 6 | 6 |
| Cover | `palette.png` | `cover.webp` | `cover.jpg` | `cover.jpg` |
| Content | none | none | 1 section / 1 dish | 1 section / 1 dish |
| Guidelines | positioning, 3 apps, 6 contacts | 5 apps | 4 apps | 4 apps |
| Type hierarchy / print spec / facts / logo rules | 0 / 0 / 0 / 0 | same | same | same |
| Warnings | **none** | none | none | none |

Warnings are empty because the importer cannot distinguish a wrong-schema
document from a thin one. **The failure is silent** — which is the single most
expensive property of the current pipeline.

---

## 3. What the automatic pipeline got right

1. **One group, one pack.** `00-portfolio/` plus four numbered brand folders
   import as a single group, in order. This is the structural contract from the
   July/Dalton review, now met.
2. **Importer-native tokens.** `brand`, `color`, `brand.url`, `slug`, `locale`,
   `currency`, `voice`, `contact`, `applications`, `brandFit`, `menuUrls` are all
   read. No alias shim was needed.
3. **Applications.** The matrix exists per brand (3–5 lines) and is usable:
   La Casa gets card/social/A-board, Le Bistrot gets menu/drinks/card/social/A-board.
4. **Contact exists.** Address, phone, website, Instagram and Facebook arrive on
   the brand; that alone fixed the blank business-card backs of the first drop.
5. **The group benchmark.** `group.report.md` and `group.summary.json` rank the
   four brands (68.4 / 64.3 / 64.1 / 64.7) and are genuinely useful for
   prioritising content work.
6. **Sourcing discipline.** Everything is traceable: `targets.json`,
   `scrapedAt`, menu URLs, OG data, and a per-brand social dossier.
7. **The download pool.** 571 photographs and 32 distinct priced menus were
   captured. Nothing in the review needed a re-crawl; every fix was a curation
   fix on material already on disk.

---

## 4. What is wrong, aspect by aspect

### 4.1 Palette — the wrong colours, confidently

`build_palette` counts CSS colour frequency, drops a fixed list of platform UI
hexes, then assigns roles by luminance: lightest is `ground`, darkest is `ink`,
and the remaining most-saturated swatch is `accent`. WordPress block themes emit
their preset palette as CSS variables on every page, so the presets win by
frequency, and the most saturated survivor is the link orange.

| Brand | Accent imported | Accent in the brand's own print menu | Consequence |
|---|---|---|---|
| La Casa | `#ff6900` WP vivid orange | antique gold `#B8A481` on forest green `#3D504A` | every design reads "WordPress demo" |
| Le Bistrot | `#ff6900` WP vivid orange | gold `#B3944D` on midnight navy `#17202F` | gold identity lost |
| Mia | `#fcb900` WP amber | olive `#677356` on cream `#FAF8F1` | olive identity lost |
| POMO | `#007cba` WP admin blue | red `#BA1F23` + gold `#C7AC62` on ink navy `#212531` | the red stripe disappears |

The print PDFs were downloaded and text-extracted; the palette builder never
looks at them. The `themeColor` meta tag is also near-worthless here: two of the
four brands expose `#ffffff`.

### 4.2 Typography — icon fonts and unrenderable names

| Brand | Families imported | Problem |
|---|---|---|
| La Casa | WhenNightComes-Regular, LunarAlchemy-Regular, Roboto, Playfair, Roboto Slab, **Eicons** | 2 real print faces + theme/icon noise; display/body actually correct |
| Le Bistrot | Mulish, Cormorant Garamond, Cormorant_Garamond Italic, **Eicons** | real print face present, but display uses the UI sans |
| Mia | Cormorant Garamond, **Dawning Of A New Day**, **FontAwesome**, **Dashicons**, **Ionicons**, Comic Sans MS, Open Sans, Roboto | body font is a handwriting face; display is a serif |
| POMO | **FontAwesome**, Bodoni-Antiqua-TOT-Bold-Condensed, GreatVibes-Regular, Quattrocento, **Dashicons**, **Ionicons**, Megante, Abigail | **display and body are both icon fonts** |

The scale is five steps (`display/h1/h2/body/caption`) taken from observed CSS
pixel sizes. The studio's template builder looks for `title`, `heading-xl`,
`heading-l`, `heading-m`, `heading-s`, `body-l`, `body-m`, `body-s` and
`menu--navigation`; none exist, so every template falls through to
`families[0]` and `families[1]`. For POMO that is FontAwesome and a
Bodoni cut whose family name does not resolve.

No font binaries or licences travel with the pack, and no substitution map is
recorded. The shared kit silently appends `Helvetica Neue` and `Georgia`.

### 4.3 Logos — one real cut across four brands

| Brand | Kit logos | Reality |
|---|---:|---|
| La Casa | **0** | The emblem exists as a 140×150 WebP and as vector artwork in every menu PDF |
| Le Bistrot | 1 | `logo-primary-logo-0.png`, 2560×1965, transparent — genuinely good |
| Mia | **0** | `mia-authentic-italian-edinburgh-HOME-PAGE-FG-1.png` (1850 canvas) and `HEADER-LOGO` were downloaded but not selected |
| POMO | **0** | `Logo Gold.png` (290×144) and `logo.jpg` were downloaded but not selected |

`extract_logo_candidates` reads page markup (`img`, `meta`, inline SVG). La
Casa's emblem is a CSS/background asset and a print PDF element; Mia's and
POMO's logos sit in theme folders that the page rarely renders as `<img>`.
Nothing scans the download pool or the PDFs for logo-shaped artwork.

### 4.4 Photography and covers — the pool is there, the selector is not

| Brand | Downloaded | Selected | Cover |
|---|---:|---:|---|
| La Casa | 172 | **0** | none → importer uses `palette.png` |
| Le Bistrot | 96 | 5 | `cover.webp` = photo 01 |
| Mia | 166 | 6 | `cover.jpg` = photo 01 |
| POMO | 137 | 6 | `cover.jpg` = photo 01 |

The WP REST media endpoint alone gave La Casa 136 media URLs and 172 files,
including 1600×1600 gallery photography, yet `select_curated_photography` found
none because it iterates `photography_urls` (page-derived candidates), not the
download pool. `select_cover` reuses the same candidates, so when photography is
empty the cover is empty and the importer's palette-image fallback takes over.

Where photography was selected it is competent but uncatalogued: no
hero/interior/food classification, no source URL per file, no dedupe against the
cover, and cross-brand files sit in the pool (see §5).

### 4.5 Content — 32 distinct priced menus in, 2 dishes out

| Brand | Kit `content/*.json` | What it contains | Source actually used |
|---|---|---|---|
| La Casa | 3 bytes (`{}`) | nothing | first "menu" PDF: the à la carte — `-layout` text, 4 columns, parser found 0 |
| Le Bistrot | 3 bytes (`{}`) | nothing | first "menu" PDF, parser found 0 |
| Mia | 408 B | `LUNCH MENU / 2 COURSE £14.95`, Mon–Fri 12–3 | the **lunch menu** PDF |
| POMO | 221 B | `KIDS MENU / £8.50` | the **kids menu** PDF |

The root cause is one line: `menu_text = menu_text or text` keeps the *first*
source whose name contains "menu". That is the kids menu for POMO and the lunch
menu for Mia. `pdftotext -layout` is used, which interleaves the four-column
menus; the parser then finds no name–price lines.

The consequence in the studio is worse than "no content": Asset Studio's menu
prefill (`asset-studio/app.js`) reads `brand.content.menu` and, when present,
replaces the generic dish set with it. Mia and POMO therefore render menus with
**one line** — the kids menu price — instead of the generic placeholders.

### 4.6 Contact — present, but flattened and partly wrong

| Brand | Imported | Correct? |
|---|---|---|
| La Casa | 1-5 Newington Rd EH9 1QR · 0131 563 1773 | true for Newington only; the brand has **three rooms** (Dalry Road, Leith Walk, Newington) |
| Le Bistrot | **W Parliament Sq EH1 1RF** | **wrong** — site and print menus say 59-63 George IV Bridge EH1 1RN, inside the Institut Français; FHRS agrees |
| Mia | 96 Dalry Rd EH11 2AX · 0131 629 1750 | true for Dalry only; Morningside is a second room |
| POMO | 250 Morrison St EH3 8DT · 0131 248 3801 | correct |

Also: `Email: Not found` on all four (rendered verbatim on card backs), phones
stored unformatted (`01315631773`), Instagram lists polluted
(`landys_fishandchips` under Le Bistrot, `facebook.com/policy.php` under Mia),
and no booking URL even though all four sites have a reserve flow.

### 4.7 Guides — three of eight tables parse

The DOCX is structured (11 sections, 5 tables) and parses for positioning,
applications and contact. The rest misses the reader:

| Guide table | Written as | Reader looks for | Result |
|---|---|---|---|
| Typography | `Role | Family | Observed size` | `ROLE | TYPEFACE ...` | 0 type hierarchy |
| Logo rules | prose bullets | `RULE | SPECIFICATION` table | 0 logo rules |
| Print specification | **not written** | `ITEM | SPECIFICATION` | 0 |
| Facts | **not written** | `FACT | DETAIL` | 0 |
| Contact | `Field | Value`, includes `Not found` | `FIELD | VALUE` | 6 rows, 1 placeholder |

`brand-guide.json` carries type hierarchy and content, but the importer reads
only the DOCX for guidelines — the JSON is written and ignored.

### 4.8 Voice and tagline

Five real samples per brand are captured (they are strong — "Pomo comes from
pomodoro. Simple as that."), but `attributes`, `prefer` and `avoid` are all
empty, and `tagline` is `null` on all four. `normalizeVoice` also drops
`samples`, so even the captured sentences never reach the studio. Generated
headlines fall back to generic template copy.

### 4.9 Group and drop hygiene

Good: group README, portfolio DOCX (correctly named this time), ordered folders,
one ZIP.

Not good:

- `targets.json` duplicates the run hand-off (business records only; no staging
  paths, so it is harmless but redundant).
- The social dossier (~10 MB) is copied into every brand folder.
- **Cross-brand pollution in the download pools**: Mia's folder contains 60 files
  named for La Casa, 15 for POMO and **three POMO menu PDFs**
  (`pomo-ALC-WEB.pdf`, `pomo-dessert-WEB-2.pdf`, `pomo-drinks-WEB.pdf`); La Casa's
  folder contains Mia's storefront photograph. Curation by filename would
  mis-assign all of it.
- Obsolete and duplicate documents: Christmas 2026 and `2026-1` are identical;
  2024 and 2025 à la carte / dessert / drinks versions sit beside the 2026 ones.
- Mia's site carries theme demo blog posts ("Quay", "Royale", a named Australian
  restaurant) in `pages_text`; they are not Mia's story and must not reach voice.
- 20 Elementor screenshot PNGs (`Elementor-post-screenshot_*.png`) are in La
  Casa's image pool.

---

## 5. What is useful, low value, or irrelevant

### 5.1 High value — keep and use

- **32 distinct priced menu PDFs** (33 files, one duplicate; 6,372 / 2,640 /
  6,419 / 3,360 words). The only reliable source of dishes, prices, hours, address and type.
- **The print identity in those PDFs**: forest green / navy / olive / red grounds,
  gold ornament, Cormorant Garamond, Neutra Text, Bodoni, When Night Comes,
  Lunar Alchemy, Adam CG Pro, and each brand's emblem.
- **The 571-image download pool**, including 1600–2560 px gallery and food
  photography for every brand.
- **Page text** for story and voice: 14,224 words across 78 pages.
- **The social dossiers**: ratings (4.67 / 4.4 / 4.62 / 4.68), review themes, NAP
  variants, handles and follower counts.
- **Group portfolio and benchmark**.
- The Le Bistrot logo cut (2560×1965, transparent).

### 5.2 Low value — keep only if cheap

- `discovered_media.csv` per site (crawler log, no dimensions or status).
- `social/platforms/*.json` — mostly URL + mode.
- Duplicate/obsolete PDFs (Christmas `2026-1`, 2024 and 2025 menu versions).
- `report.html` alongside `insights.md`.
- Instagram avatars (100×100) and Facebook covers (682–720 px).

### 5.3 Irrelevant or misleading — remove before packaging

| Item | Where | Why |
|---|---|---|
| WordPress preset swatches (`#ff6900`, `#fcb900`, `#007cba`, `#abb8c3`…) | all tokens | Platform defaults, not brand evidence |
| `Eicons`, `FontAwesome`, `Dashicons`, `Ionicons`, `Comic Sans MS`, `Dawning Of A New Day` | token families | Icon/OS fonts; POMO's display and body are icon fonts |
| `Email: Not found` | all four guides | Prints verbatim on cards |
| `landys_fishandchips` Instagram URL | Le Bistrot | Another business |
| `facebook.com/policy.php` | Mia | Not a brand page |
| 3 POMO PDFs under Mia | Mia `documents/` | Wrong brand |
| Mia storefront photo under La Casa | La Casa `images/` | Wrong brand |
| `Elementor-post-screenshot_*.png` | La Casa | Admin screenshots, not photography |
| Theme-demo blog posts ("Quay", "Royale") | Mia `pages_text` | Not Mia's story |
| Palette strip as cover | La Casa import | Gate card is a colour bar |

---

## 6. Data-quality notes

- **Phone normalisation**: site and social expose `(0131) 629 1750`,
  `+44 131 629 1750` and `01316291750`; the kit keeps the unformatted digits.
- **Address conflicts**: Le Bistrot `W Parliament Sq` vs `59-63 George IV Bridge`;
  La Casa `Newington` vs `103-105 Dalry Rd`; Mia `Dalry` vs `394 Morningside Rd`.
  The crawl records all variants but picks one silently.
- **Rating sample**: Google exposes ~5 reviews to anonymous browsers; "reviews
  analysed 5" out of 845–4,433. The dossier says so; the kit does not.
- **PDF layout**: La Casa's à la carte is four columns; `-layout` output is
  unparseable, `-raw` output parses cleanly. The choice of mode decides whether
  menu extraction works at all.
- **MIME**: La Casa photography is WebP, Le Bistrot and Mia JPEG, POMO JPEG —
  extensions are correct in this drop (a regression fixed since the Aseni drop).

---

## 7. Acceptance checklist — as-is result

| Check | Result |
|---|---|
| One ZIP → one group, ordered | ✅ |
| `brand.name` canonical (not domain-derived) | ✅ |
| `brand.url` set | ✅ |
| Palette ≥ 4 with ground / ink / accent | ⚠️ 14 each, but platform colours and wrong accent |
| Typography: ≥2 real families, display/h1/body scale | ❌ icon fonts, 5 steps, wrong ids |
| One primary wordmark ≥1200 px + a mark | ❌ 1 brand only |
| No favicons / UI icons / other brands in logos | ✅ (because almost no logos) |
| Photography ≥3 print-capable images | ❌ La Casa 0; others 5–6 at 800–2560 px |
| Cover ≥1600×1000, not a photo duplicate | ❌ 1 none, 3 duplicates |
| `guidelines.contact` with address/phone/email/website | ⚠️ no real email, one wrong address |
| `guidelines.applications` | ✅ 3–5 per brand |
| `voice.attributes/prefer/avoid` populated | ❌ empty, samples dropped |
| Menu content as structured JSON | ❌ 0 / 0 / 1 / 1 |
| Tagline and wordmark | ❌ tagline empty; wordmark = name |
| No empty or junk assets in the pack | ❌ social dossiers, staging paths |
| Warnings surfaced on import | ❌ none, silently thin |
| **Import-ready** | **0 of 4 brands** |

---

## 8. Root causes (and where they live)

| # | Symptom | Cause | Location |
|---|---|---|---|
| 1 | WP preset palette; wrong accent | CSS-frequency palette; fixed platform-hex list misses presets; roles by luminance; accent by saturation | `scripts/crawler-combined.py` `build_palette()` (2313) |
| 2 | Icon-font typography; broken scale ids | Families collected from all CSS; display = largest observed size; scale ids don't match the studio contract | `build_typography()` (2421), `build_type_scale()` (2460) |
| 3 | 3 of 4 brands without logos | Logo candidates only from page markup; no pool/PDF scan, no raster logo detection | `extract_logo_candidates()` (1220), `select_curated_logos()` (2182) |
| 4 | La Casa without photos or cover | Photography selection iterates page-derived candidates, not the 172 downloaded files | `select_curated_photography()` (2230), `select_cover()` (2280) |
| 5 | 0/0/1/1 menu items | `menu_text = menu_text or text` keeps the first "menu" file; `-layout` text for multi-column menus | `extract_content_pack()` (2685), `extract_pdf_text()` |
| 6 | `Not found`, wrong Le Bistrot address | Guide writer emits `Not found`; canonical NAP from a single source, no print/site cross-check | `write_brand_guide_docx()` (3213), `build_contact_block()` (1021) |
| 7 | Empty type/print/facts/logo-rule tables | Header mismatch between writer and reader; sections not written | `write_brand_guide_docx()` vs `brand-docx.js` (300–335) |
| 8 | Empty voice; no tagline | Attributes never inferred; samples dropped by the normalizer | `extract_voice_samples()` (2765), `normalizeVoice()` (`brand-pack.js` 250) |
| 9 | Cross-brand PDFs and photos | No brand-affinity check on downloaded or linked media | `download_all()`/`extract_*_candidates()` |
| 10 | Generic menus and "Dalton" vouchers | Template builder ignores `brand.content`; voucher terms hard-coded | `menuItems()` (`brand-pack.js` 1135), `buildVoucher()` (1431) |

---

## Appendix A — run manifest

```
id            pulpo-hospitality-20261102044318-7071
state         done · exit 0 · 741 s (2026-11-02T04:43:18Z → 04:55:40Z)
group         Pulpo Hospitality
targets       4 (La Casa Edinburgh, Le Bistrot, Mia Italian Kitchen, POMO Pizzeria)
options       social, browser, deep · maxPages 120 · maxReviews 200 · maxPosts 30
imported     pulpo-hospitality-20261102065339-9f00
```

## Appendix B — social snapshot

| Brand | Rating | Reviews | Followers | Score | Sources |
|---|---:|---:|---:|---:|---|
| La Casa | 4.67 | 1,623 | 8,573 | 68.4 | Restaurant Guru, Google |
| Le Bistrot | 4.4 | 845 | 4,817 | 64.3 | Google |
| Mia | 4.62 | 3,817 | 9,229 | 64.1 | Restaurant Guru, Google |
| POMO | 4.68 | 4,433 | 3,856 | 64.7 | Restaurant Guru, Google |

## Appendix C — how this was measured

- Inventory and sizes: `find`, `du`, `unzip -l`.
- Image dimensions, formats, alpha and duplicate hashes: Python + Pillow.
- PDF text, page counts and embedded fonts: `pdfinfo`, `pdftotext -layout/-raw`,
  `pdffonts`.
- Guide structure: the real `brand-docx.js` parser with the server ZIP reader.
- Import behaviour: `createBrandPackImport` and `createBrandTemplateProject`
  through `server.js`, then deleted.
- Social: `business.profile.json`, `social.json`, `insights.md`, `platforms/*`.
- Source crawl and pack untouched.
