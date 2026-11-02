# Scraped brand-kit review

**Reviewed** `data/_scraped/AseniGroup/` and `data/_scraped/Monteleone/`  
**Drop date** 1 November 2026 (files scraped 20:10–20:33)  
**Purpose** judge the scrape against what the studio's brand-pack importer
and Asset Studio actually need.

> `data/` is git-ignored, so the paths below are local to the machine that
> holds the drop. This document is the durable record of the review.

> **Follow-up:** the v2 crawler output for the same client group is reviewed
> in [scraped-july-dalton-review.md](scraped-july-dalton-review.md).

---

## 1. Verdict

The **raw material is strong** — four complete site captures with menus,
brand copy, contact details, logos and photography. The **packaging is not
import-ready**: every site imports with **zero palette colours and zero
typography**, empty guidelines, and a machine-derived brand name. Generated
artwork therefore falls back to generic template copy (and one hard-coded
"Dalton family venue" line), not the venue's brand.

`AseniGroup/` holds **4 site captures, 270 files, 62 MB**. `Monteleone/` is
**empty** (created at 20:33, five minutes after the last Aseni scrape).

| Brand | Palette data | Typography | Logo | Photography | Guide readable | Copy | Import today |
|---|---|---|---|---|---|---|---|
| Bar91 | 6 colours, roles + CMYK | 12 families, mostly Wix internals; scale `0px` | 1 usable wordmark among 18 files | 1 large hero + small food shots | flat text, parsed as empty | menus, PDFs, contact | ✗ |
| Boteco do Brasil | 6 colours, roles + CMYK | 10 families (Montserrat/Raleway among them) | 1 design, max 219 px | 1 image, 167×111 px | flat text, parsed as empty | menus, PDFs | ✗ |
| Piccolino Edinburgh | 14 colours, roles + CMYK | 28 families (Futura/Avenir usable) | 2 usable lockups among 14 files | 10 social-grade images | flat text, parsed as empty | menus, PDFs | ✗ |
| Ronzio Broomhill | 14 colours, roles + CMYK | 10 families (Space Grotesk/Raleway good) | **0 usable** (UI icons + default favicon) | 7 print-grade (WebP mislabelled) | flat text, parsed as empty | thin: 171 words, no menu text | ✗ |
| Monteleone | — | — | — | — | — | — | no data |

**Raw material: 3 of 4 brands are viable. Import-ready today: 0 of 4.** The
gap is fixable in the scraper output plus two small importer changes; see
[§8](#8-action-plan).

**Three decisions before the next drop:**

1. Fix the scraper's token/guide output (recommended) or teach the importer
   to accept this schema — ideally both, with the adapter as a safety net.
2. Deliver **one Aseni Group pack** with a portfolio and four brands, not four
   separate single-brand packs.
3. Rerun `Monteleone/` or delete it; do not leave an empty group in a drop.

---

## 2. Inventory

```
data/_scraped/
├── AseniGroup/                       62 MB, 270 files
│   ├── bar91.co.uk_root/             22 MB
│   ├── botecodobrasil.com_root/      4.8 MB
│   ├── piccolinoedinburgh.com_root/  8.4 MB
│   └── ronziobroomhill.co.uk_root/   27 MB
└── Monteleone/                       0 B, 0 files
```

Each site folder has the same shape:

```
<domain>_root/
├── brand-kit/                  importer-ready ZIP contents (unpacked)
├── brand-kit.zip               identical copy of brand-kit/
├── documents/                  downloaded PDFs (menus, policies)
├── images/                     every downloaded image, unfiltered
├── pages_text/                 visible text of each page
├── social/                     platform JSON + one avatar
├── videos/                     empty for all four sites
└── discovered_media.csv        every media URL found (no dimensions/licence)
```

| Site | Size | brand-kit | documents | images | pages_text | social | videos | CSV rows | ZIP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bar91.co.uk | 22 MB | 34 | 6 | 29 | 8 | 6 | 0 | 135 | 7.1 MB |
| botecodobrasil.com | 4.8 MB | 10 | 4 | 6 | 24 | 6 | 0 | 256 | 192 KB |
| piccolinoedinburgh.com | 8.4 MB | 30 | 5 | 42 | 9 | 6 | 0 | 151 | 960 KB |
| ronziobroomhill.co.uk | 27 MB | 15 | 3 | 9 | 4 | 6 | 0 | 14 | 8.1 MB |

File mix: 94 jpg, 59 png, 48 txt, 24 json, 15 pdf, 8 jpeg, 4 zip, 4 md,
4 docx, 4 csv, 3 svg, 3 ico.

---

## 3. What is in these folders

### 3.1 `brand-kit/` — the importable artefact

The structure is already close to the studio contract:

```
brand-kit/
├── README.md                                  group/brand name + description
└── 01-<domain>_root/
    ├── <domain>_root-Brand-Guide.docx         1.7–2.2 KB, flat text
    ├── tokens/<domain>_root.tokens.json       palette, type, voice, logo, contact
    └── assets/
        ├── logos/                             4–18 files
        ├── photography/                       1–12 files
        ├── colors/                            **empty in all four**
        ├── type/                              **empty in all four**
        └── cover.jpg|jpeg                     one per brand
```

- **README** is genuinely useful: it carries the brand name, description,
  source URL and scrape timestamp. Pack names come from here and are good
  ("Bar91", "Boteco Do Brasil", "piccolinoedinburgh", "Ronzio Broomhill").
- **Tokens** are rich — palette entries include RGB, CMYK, share, tier,
  luminance, saturation and a role (`ink`, `accent`, `ground`, `neutral`);
  contact has phones/emails/social/address; menu/guide URLs and Open Graph
  data are captured. **But the JSON wrapper is not the shape the importer
  reads** ([§4](#4-alignment-with-studio-layers)).
- **Brand guide DOCX** is a 2 KB flat document: no `word/styles.xml`, no
  heading styles, no tables. It reads as one paragraph of labels and values.
- **Asset folders**: `colors/` and `type/` exist but contain no palette image
  or type specimen. Logos include duplicates, favicons, UI icons, one photo,
  and two unrelated loyalty-card logos ([§5](#5-useful-low-value-irrelevant)).
- **`brand-kit.zip` is byte-for-byte the same content as `brand-kit/`** (34,
  10, 30 and 15 files respectively). Keeping both doubles the storage
  (about 16 MB) and guarantees they drift eventually.

### 3.2 `documents/` — 15 PDFs, high value

| Site | Documents | Text extractable |
|---|---|---|
| Bar91 | breakfast, food, drinks, Christmas menu, privacy policy | yes (346–1,116 words each) |
| Boteco | food menu, drinks menu, Christmas menu | yes (501–1,404 words each) |
| Piccolino | food menu, drinks menu, Christmas menu, privacy policy | menus yes; privacy is image-only (0 words) |
| Ronzio | brunch, à la carte, drinks | yes (499–1,082 words each) |

These are real, priced menus — the best content source in the drop. The
studio cannot ingest PDFs today; see [§6.4](#64-content-pack-missing).

### 3.3 `images/` — the raw download pool

| Site | Files | Formats | Tiny (<150 px) | Large (≥1000 px) | Used by brand-kit |
|---|---:|---|---:|---:|---:|
| Bar91 | 29 | 17 PNG, 12 JPEG | 11 | 1 | 22 of 29 (by hash) |
| Boteco | 6 | 5 PNG, 1 JPEG | 3 | 0 | all 6 |
| Piccolino | 42 | 7 PNG, 35 JPEG | 11 | 1 | 19 of 42 |
| Ronzio | 9 | 7 WebP, 1 ICO, 1 SVG | 1 | 7 | 7 of 9 |

The pool is unfiltered: Wix 40×40 UI icons, favicons, duplicated size
variants, and — for Piccolino — 23 files that never reach the brand kit.
Ronzio's ".jpg" files are **WebP bytes** served under a JPEG filename.

### 3.4 `pages_text/` — 45 pages, 12,087 words

| Site | Pages | Words | Menu pages | £ prices | Notes |
|---|---:|---:|---:|---:|---|
| Bar91 | 8 | 2,250 | 2 (duplicates) | 80 | about, menu, contact, private hire, bookings |
| Boteco | 24 | 5,308 | 2 (duplicates) | 116 | many thin tag/category pages |
| Piccolino | 9 | 4,358 | 5 (duplicates) | 184 | food + drinks, bookings, contact |
| Ronzio | 4 | 171 | 0 | 0 | home/contact only; menus exist only as PDF |

Quality is good where it matters: `menu.txt` is structured enough to parse
section headings, dish names, descriptions and prices. Noise is
predictable — `top of page`/`bottom of page` on every Wix page, duplicated
page dumps (`index` = `home`, `menu` = `menu_menu=…`), one admin profile page
(`profile_luigi_profile.txt`), and thin "what's on" tag pages.

### 3.5 `social/` — metadata only

Four platform files per site. Only Instagram carries data: handle, follower
count, post count, a generic bio and a 100×100 avatar. Facebook, TikTok and
TripAdvisor contain a URL and the capture method, nothing else. Voice
samples are the Instagram meta description ("See Instagram photos and videos
from …"), hashtags and keywords are empty.

| Site | Instagram | Followers | Posts |
|---|---|---:|---:|
| Bar91 | @bar91glasgow | 1,987 | 696 |
| Boteco | @botecodobrasil | 19,000 | 2,149 |
| Piccolino | @piccolinoedinburgh | 2,398 | 940 |
| Ronzio | @ronzio_broomhill | 2,567 | 272 |

Useful as handles and credibility context; not usable as voice or content.

### 3.6 `videos/` and `discovered_media.csv`

`videos/` is empty for all four sites even though the CSV lists 25 "video"
URLs. Those URLs are false positives — Wix feature strings such as
`specs.stores.Mov`, `specs.thunderbolt.mov` and `/file.mp4` — so nothing was
lost that actually exists.

The CSV is a crawler log, not an asset manifest: 556 rows, no dimensions, no
licence, no status. Boteco's 85 "documents" include CSS fragments such as
`/.1-.4.2-.7.5-.9.7z`. It adds little once downloads have happened; if kept,
it should be enriched rather than treated as an inventory.

### 3.7 `Monteleone/`

Empty. The timestamp (20:33) is five minutes after the last Aseni scrape,
which suggests a run that was queued or failed before writing anything.
Decide whether to rerun it or delete the placeholder.

---

## 4. Alignment with studio-layers

### 4.1 What the importer reads vs what the drop contains

| The importer expects (`server.js` → `brandFromDirectory`, `brand-pack.js`) | The drop contains | Result |
|---|---|---|
| `tokens.brand = { name, wordmark, tagline, url }` | top-level `name`, `description`, `source` | name falls back to folder → **"Bar91.Co.Uk Root"**, URL/tagline empty |
| `tokens.color` (array/object of colour entries) | top-level `palette` (well formed) | **palette lost, 0 colours** |
| `tokens.typography.families` as strings | array of objects `{name, weights, styles, role, source}` | families dropped → **0 fonts** |
| `tokens.typography.scale` as `{id, family, size, px}` objects | CSS size dump (`"0px"`, `"3%"`, `".01em"`, random px) | unusable even if mapped |
| `tokens.voice` attributes/prefer/avoid | all three empty | no voice data |
| guide DOCX with heading styles + tables for applications, print spec, contact, facts, type hierarchy, logo rules | flat 2 KB text, no styles/tables | **guidelines empty** (only doc title/URL) |
| `contact` as `guidelines.contact[]` | `tokens.contact { phones, emails, social, address }` | contact ignored → blank card backs, name-only footers |
| logos under `assets/logos`, variant/kind encoded in the filename | all named `logo-primary-logo-N`, mixed with icons/photos | `normalizeLogos` sees 18/5/14/2 "logos"; only 1–2 are real |
| `assets/colors` and `assets/type` images | empty folders | identity gallery has no palette/type imagery |
| one ZIP = one group (optional portfolio + several brand folders) | four separate single-brand ZIPs | imports as **4 groups of 1 brand**, not one Aseni Group |
| cover `cover.png`/`jpg` | present for all four | works, but Boteco's is 167×111 |

### 4.2 What actually happened on import

Tested by importing each `brand-kit.zip` through the real
`createBrandPackImport`, then creating real templates, then deleting the
test artefacts.

| Imported field | Bar91 | Boteco | Piccolino | Ronzio |
|---|---|---|---|---|
| Pack name | Bar91 | Boteco Do Brasil | piccolinoedinburgh | Ronzio Broomhill |
| Brand name | Bar91.Co.Uk Root | Botecodobrasil.Com Root | Piccolinoedinburgh.Com Root | Ronziobroomhill.Co.Uk Root |
| Brand id | bar91-co-uk-root | botecodobrasil-com-root | piccolinoedinburgh-com-root | ronziobroomhill-co-uk-root |
| URL / tagline | empty / empty | empty / empty | empty / empty | empty / empty |
| Palette | 0 | 0 | 0 | 0 |
| Type families | 0 | 0 | 0 | 0 |
| Guidelines | title + URL, one empty section | same | same | same |
| Logos | 18 | 5 | 14 | 2 |
| Photography | 12 | 1 | 12 | 7 |
| Cover | yes | yes (167×111) | yes (logo) | yes |
| Warnings | none | none | none | none |

Warnings are empty because the importer cannot tell a wrong-schema file from
a thin one — the failure is silent.

### 4.3 Downstream effect in Asset Studio

With the pack imported as-is:

- **Palette** falls back to the studio default, so none of the 50 designs
  shows the venue's colours.
- **Typography** falls back to system stacks; the brand's real faces are not
  used even where the CSS names were captured.
- **Logo slot**: Bar91/Boteco/Piccolino do get a logo, but it is chosen by
  score from an unclassified set (PNG/SVG and wide crops win), so it is a
  low-resolution wordmark at best. Ronzio's best-scoring file is a Squarespace UI-icon
  SVG that renders blank; the next option is the 32×32 favicon.
- **Business card back** contains only "Your name" and "General manager" —
  no phone, email, address or website, because `guidelines.contact` is empty.
- **Flyer / menu / social footers** fall back to the brand name instead of an
  address + website.
- **Menu and drinks content** is the generic template set (Hand-dived
  scallops, Dry-aged beef…) — unrelated to the venue, despite the real menus
  sitting in `documents/` and `pages_text/`.
- **Voucher terms** literally read *"Redeemable at any Dalton family venue"*,
  a hard-coded template default, for every new brand.
- **Photography**: Boteco's only image is 167×111, so any photo-led layout is
  visibly soft, including at social sizes.
- **Brand group**: each ZIP becomes its own group; there is no "Aseni Group"
  gate with four venues.

### 4.4 Root causes

1. **Token schema drift** — the scraper emits `name`/`palette` at the top
   level; the importer reads `brand`/`color`. Fixing the keys alone restores
   palette, name and URL.
2. **Typography shape drift** — objects instead of family strings, and a CSS
   size dump instead of a designed scale.
3. **Guide structure** — the DOCX is a text dump; structured extraction has
   nothing to key on. The same information exists in the tokens, so a JSON
   guide would be more reliable than Word for this pipeline.
4. **No asset curation** — logo detection is name/path based and includes
   favicons, UI icons, photos and other brands; photography is whatever the
   crawler found; duplicates are not removed.
5. **Contact is captured but not wired** — `tokens.contact` has the data; the
   importer only looks at guide tables.

### 4.5 What the 50 designs need from a pack

| Asset Studio need | Used by | Present in the drop? |
|---|---|---|
| Ground / ink / accent palette | all 50 designs | yes, but under `palette`, not `color` |
| Wordmark (SVG/PNG, transparent) | menus, cards, flyers, signage, packaging | 3 brands only; Ronzio none |
| Mark / monogram | stickers, coasters, avatars | piccolino has icons; others no |
| Hero photography | flyers, event poster, roll-up, social | Bar91 yes; Ronzio yes; Piccolino social-grade; Boteco no |
| Food photography | menus, table cards, social | yes for 3, small for Piccolino |
| Contact block | business-card back, stationery, review/welcome cards | in tokens, not imported |
| Website / booking URL | QR, footers, email header | in `source`/`og:url`, not imported |
| Menu items and prices | menus (8), table cards, digital board | **yes** (PDF + page text), not imported |
| Opening hours | notice sign, welcome card | Bar91 page text; others partial |
| Social handles | social designs, footers | yes (tokens + social JSON) |
| Voice / tagline | headlines and CTAs | tagline missing; description present; voice empty |
| Applications / brand fit | which categories to show | inferable from documents, not captured |

---

## 5. Useful, low value, irrelevant

### 5.1 High value — keep and wire up

- **`documents/*.pdf`** — priced menus, drinks, brunch and Christmas menus.
  Best source for menu copy and table-card/digital-board content.
- **`pages_text/menu*`, `contact*`, `index*`** — structured dish/price text,
  contact details, about copy, private-hire and booking language.
- **`brand-kit/README.md`** — canonical pack name and description.
- **`tokens` palette block** — roles, CMYK and share are exactly what the
  brand kit needs once the wrapper is fixed.
- **`tokens.contact`** — phones, emails, social and address; needs validation.
- **Logos that survived review** — Bar91/Boteco/Piccolino wordmarks, and
  Piccolino's square navy lockup.
- **Covers for Bar91, Piccolino, Ronzio** (see caveats: Piccolino's is a
  logo, Boteco's is unusable).
- **Instagram handles + follower/post counts** — context for social work.

### 5.2 Low value — keep only if cheap

- `discovered_media.csv` — a crawler log; superseded by the downloads.
- `social/platforms/*.json` — URL + capture mode only.
- `brand-kit.zip` **or** `brand-kit/` — one of the two is redundant.
- `pages_text` duplicates (`index`/`home`, `menu`/`menu_menu=…`).
- `robots.txt` copies.
- Piccolino's 23 downloaded images that never reached the kit.

### 5.3 Irrelevant or misleading — remove before packaging

| Item | Where | Why |
|---|---|---|
| `logo-primary-logo-5.png` ("THE CIRCLE loyalty card") | Bar91, Piccolino | Different sub-brand, not the venue |
| `logo-primary-logo-11.jpg` / `-17.jpg` (storefront photo) | Bar91 | A photo in the logo slot; also duplicated as cover/photo |
| `logo-inline-1.svg`, `logo-inline-5.svg` | Ronzio | Squarespace UI icon sprite + Instagram social icon |
| `logo-primary-mark-0.ico`, `-3.ico` (default dark cube) | Ronzio | Squarespace default favicon, not the brand |
| 32×32 / 40×40 / 180×180 / 192×192 favicon and app-icon variants | all | Too small, often cropped |
| Cropped wordmarks (`logo-10/14/16/8` on Bar91) | Bar91 | Missing letters — unusable |
| Piccolino logo lockups under `assets/photography` (photo-00/01) | Piccolino | Duplicate of the logo, pollutes the photo pool and cover |
| `.7z`-looking "documents", `specs.stores.Mov`, `specs.thunderbolt.mov`, `/file.mp4` | CSV | CSS/JS artefacts, not assets |
| `profile_luigi_profile.txt` | Bar91 | Admin profile page, personal data, no brand value |
| Tag/category pages under 30 words | Boteco (10 pages) | Boilerplate nav dumps |
| Empty `assets/colors`, `assets/type` | all | No content; either fill them or drop the folders |

### 5.4 Data-quality issues

- **MIME mismatch**: Ronzio's photography and cover are WebP bytes named
  `.jpg`/`.jpeg`. The server serves by extension, so clients receive the
  wrong content type (browsers usually recover, print pipelines may not).
- **Duplicates**: Bar91 has 6 duplicate logo groups (18 files → 12 unique);
  Piccolino 5 groups (14 → 9 unique); Ronzio 2 identical ICOs; covers are
  often copies of a photo or a logo.
- **Low resolution**: Boteco's only photo/cover is 167×111; Piccolino's
  photos top out at 1080×1080 (logo) and 480×720 (food); Bar91 has one
  1994×1330 hero and many 301×344 shots.
- **Contact conflicts** (details in [Appendix B](#appendix-b-contact-conflicts)):
  Bar91 tokens phone ≠ site phone; Boteco phone is malformed (`+440141…`);
  Piccolino tokens contain a typo email (`piccoino…`); Ronzio tokens have no
  phone/email/address although the site text does.
- **Name inconsistency**: `Bar91` / `Bar 91`; `Boteco Do Brasil` /
  `Boteco do Brasil`; `piccolinoedinburgh` (lowercase, no space) vs
  `Piccolino Edinburgh`; `Ronzio Broomhill` vs `Ronzio Restaurant & Bar
  Broomhill`.
- **No rights metadata** for logos, photography or fonts; no font binaries
  and therefore no licence to embed them.
- **Monteleone** has no data at all.

---

## 6. Gaps — what else is needed

### 6.1 Per brand

| Needed | Bar91 | Boteco | Piccolino | Ronzio |
|---|---|---|---|---|
| Canonical name, slug, legal name, group | partial | partial | partial | partial |
| Wordmark SVG + PNG (≥1200 px) | ✓ (PNG 455 px max) | ✓ (219 px max) | ✓ (256 px max) | **missing** |
| Mark/monogram, light/dark/mono variants | icons only | none | icons only | none |
| Palette with roles validated for contrast | data ✓, mapping ✗ | data ✓, mapping ✗ | data ✓, mapping ✗ | data ✓, mapping ✗ |
| Licensed fonts / fallback stacks | Poppins/Museo names only | Montserrat/Raleway names only | Futura/Avenir/Courier names only | Space Grotesk/Raleway names only |
| Real type scale (H1/H2/body/caption) | **missing** | **missing** | **missing** | **missing** |
| Hero / interior / food photography ≥2000 px | 1 hero, small food | **missing** | social-grade only | ✓ (WebP) |
| Contact block (validated) | phones conflict | phone malformed | email typo | **missing in tokens** |
| Website / booking URL | `source` only | `source` only | `source` only | `source` only |
| Tagline, 50/150-word descriptions | description ✓ | description ✓ | description ✓ | description short |
| Menu items + prices | PDF + pages ✓ | PDF + pages ✓ | PDF + pages ✓ | PDF only |
| Opening hours | pages ✓ | partial | partial | partial |
| Voice attributes / prefer / avoid | **empty** | **empty** | **empty** | **empty** |
| Applications matrix | inferable | inferable | inferable | inferable |
| Brand-fit tags for Asset Studio | inferable | inferable | inferable | inferable |
| Rights/licence per asset | **missing** | **missing** | **missing** | **missing** |

### 6.2 Group-level

- **Group identity**: "Aseni Group" exists only as a folder name. There is no
  group README, portfolio overview, or relationship map (4 venues).
- **One pack, not four**: to appear as one group in Asset Studio, the four
  brands need to sit in a single ZIP with a `00-portfolio/` folder.
- **Monteleone**: rerun the scrape or delete the empty placeholder; decide
  whether it belongs to the same group as the existing Monteleone brands.
- **Cross-brand rules**: shared palette/type? sub-brand relationships
  (e.g. "THE CIRCLE" loyalty card belongs to Bar91/Piccolino)? None recorded.

### 6.3 Missing studio-side wiring (small)

- Map `tokens.contact` → `guidelines.contact[]` (`field`/`value`), so cards
  and footers fill automatically.
- Accept top-level `name`/`description`/`palette` aliases (or require the
  scraper to emit the importer shape — preferable).
- Use `tokens.brand.url` / `source` for `brand.url`, so QR defaults and
  website footers work.
- Stop templates from hard-coding "Dalton family venue" and generic dishes
  for brands without content.

### 6.4 Content pack (missing)

The site text and PDFs already contain what the design templates need. A
small `content/<brand>.json` next to the tokens would remove the last manual
step:

```json
{
  "menu": {
    "title": "Bar91 menu",
    "sections": [
      { "name": "91 Classics", "items": [
        { "name": "Beef Stew", "description": "Slow cooked beef…", "price": "£14.90" }
      ] }
    ]
  },
  "drinks": { "sections": [] },
  "hours": { "mon_thu": "12:00–23:00" },
  "bookingUrl": "https://www.bar91.co.uk/book-online",
  "deliveryUrl": "https://deliveroo.co.uk/menu/…",
  "allergens": "Ask your server…"
}
```

---

## 7. Recommended contract

### 7.1 One group pack

```
AseniGroup-brand-kit.zip
├── README.md                       group name + one-paragraph description
├── 00-portfolio/
│   ├── AseniGroup-Overview.docx
│   └── assets/
├── 01-bar91/
│   ├── bar91-Brand-Guide.docx
│   ├── tokens/bar91.tokens.json
│   ├── assets/
│   │   ├── logos/logo-primary-wordmark.svg
│   │   ├── logos/logo-primary-wordmark.png   (≥1200 px wide)
│   │   ├── logos/logo-light-wordmark.svg
│   │   ├── logos/logo-primary-mark.svg
│   │   ├── photography/hero-exterior.jpg
│   │   ├── photography/food-beef-stew.jpg
│   │   ├── colors/palette.png
│   │   └── type/specimen.png
│   └── cover.jpg                   a hero image, ≥1600×1000
├── 02-boteco-do-brasil/ …
├── 03-piccolino-edinburgh/ …
└── 04-ronzio-broomhill/ …
```

Folder numbers set reading order; the folder name after the number becomes
the brand id, so use the canonical slug (`02-boteco-do-brasil`, not
`02-botecodobrasil.com_root`).

### 7.2 Tokens — importer-native

Keep the rich palette entries (roles, CMYK, share), but wrap them the way
`brandFromDirectory` reads:

```json
{
  "brand": {
    "name": "Bar91",
    "slug": "bar91",
    "wordmark": "Bar91",
    "tagline": "Merchant City bar & pub",
    "url": "https://www.bar91.co.uk/",
    "locale": "en-GB",
    "currency": "GBP"
  },
  "color": [
    { "name": "Ink", "hex": "#000000", "rgb": [0,0,0], "cmyk": [0,0,0,100],
      "role": "ink", "tier": "primary", "share": 0.565 },
    { "name": "Ground", "hex": "#ffffff", "rgb": [255,255,255],
      "cmyk": [0,0,0,0], "role": "ground", "tier": "primary", "share": 0.043 }
  ],
  "typography": {
    "families": ["Poppins", "Museo Sans 700"],
    "scale": [
      { "id": "display", "family": "Museo Sans 700", "size": "72px", "px": 72 },
      { "id": "h1", "family": "Poppins", "size": "48px", "px": 48 },
      { "id": "body", "family": "Poppins", "size": "16px", "px": 16 }
    ],
    "weights": { "display": [700], "body": [400, 600] }
  },
  "voice": {
    "attributes": ["warm", "unpretentious", "Merchant City"],
    "prefer": ["craft beer", "live music", "brunch"],
    "avoid": ["corporate", "stiff fine dining"],
    "samples": ["…real sentence from the site…"]
  },
  "contact": {
    "address": "91 Candleriggs, Glasgow G1 1NP",
    "phones": ["0141 406 4561"],
    "emails": ["info@bar91.co.uk"],
    "website": "https://www.bar91.co.uk/",
    "instagram": "https://www.instagram.com/bar91glasgow/",
    "facebook": "https://www.facebook.com/bigbar91/",
    "tiktok": "https://www.tiktok.com/@bar91glasgow"
  },
  "applications": [
    { "asset": "menu", "sizes": ["A4", "A5"], "priority": 1 },
    { "asset": "drinks-list", "sizes": ["A4", "DL"], "priority": 1 },
    { "asset": "a-board", "sizes": ["A1"], "priority": 2 }
  ],
  "brandFit": ["menus", "drinks", "signage", "social", "takeaway"],
  "menuUrls": ["…"],
  "og": { "title": "…", "description": "…", "image": "…" }
}
```

The last four blocks (`contact` per-field, `applications`, `brandFit`,
content) are a small **studio enhancement** today; the first four are what
the importer already reads.

### 7.3 Guide — structured, or JSON instead

If a Word guide is kept for humans, give it real headings and tables so the
reader can extract them:

- `Positioning` (H1) + paragraph
- `Applications` (H2) + table: Application | Sizes | Priority
- `Print specification` (H2) + table: Format | Size | Bleed | Paper
- `Contact` (H2) + table: Field | Value (Address, Telephone, Email, Website,
  Instagram, Booking URL)
- `Type hierarchy` (H2) + table: Role | Family | Weight | Size
- `Logo rules` (H2) + bullets (clear space, minimum size, backgrounds)
- `Facts` (H2) + table: Label | Value

For automation, emit `brand-guide.json` with the same fields and let the
importer prefer it; the DOCX stays a human document. The current flat DOCX
is the single biggest reason guidelines import empty.

### 7.4 Asset rules

- **Logos**: one primary wordmark (SVG + PNG ≥1200 px), one mark, plus
  light/dark/mono variants where they exist. Transparent background. Name
  `logo-<variant>-<kind>.<ext>`. Exclude favicons, UI/social icons, photos,
  sub-brands and cropped files. De-duplicate by hash.
- **Photography**: classify `hero-`, `interior-`, `food-`, `people-`,
  `event-`; short edge ≥2000 px for print-capable images; record source URL
  and rights. Normalise format to the real type (no WebP in `.jpg`).
- **Cover**: a hero photograph or a deliberate brand lockup ≥1600×1000, never
  a 167 px thumbnail or a duplicate of the first photo.
- **Palette/type**: write `assets/colors/palette.png` and
  `assets/type/specimen.png` (or drop the folders) so the identity gallery
  has imagery.
- **Dedupe** before zipping; the current 18 logos for Bar91 are 12 unique
  files and about 2–3 usable crops.

---

## 8. Action plan

| Priority | Action | Owner | Effort |
|---|---|---|---|
| **P0** | Emit `brand`, `color`, `brand.url`, `brand.name` in tokens (keep the rich entries) | scraper | S |
| **P0** | Typography: families as strings, a designed scale as objects, drop Wix/Squarespace internals and CSS dumps | scraper | S |
| **P0** | Curate logos: remove The Circle, storefront photo, favicons, UI icons, cropped variants; add light/dark/mono where available | scraper + manual | M |
| **P0** | Contact block: canonical address/phone/email/website, validated; merge social handles | scraper | S |
| **P0** | One Aseni Group ZIP with `00-portfolio/` + four brand folders, canonical slugs | scraper | S |
| **P0** | Structured guide (or `brand-guide.json`) with applications, contact, type hierarchy, logo rules | scraper | M |
| **P1** | Map `tokens.contact` → `guidelines.contact[]`; read `brand.url`/`name` (or aliases) | studio | S |
| **P1** | Stop template fallbacks: venue-specific voucher terms, generic menu placeholders that are obviously empty | studio | S |
| **P1** | Photography quality gate (min short edge; real MIME; cover rules) | scraper | M |
| **P1** | Menu/hours content pack from pages + PDFs (feeds menu, table card, digital board) | scraper | M |
| **P1** | Voice: real samples, attributes, prefer/avoid | scraper | S |
| **P1** | Rerun or remove `Monteleone/` | ops | S |
| **P2** | Brand-fit tags per venue so irrelevant categories can be hidden | scraper + studio | S |
| **P2** | Rights/licence metadata per asset; font licences | ops/legal | M |
| **P2** | Automated audit in the scraper (the checklist in [§9](#9-acceptance-checklist)) | scraper | M |
| **P2** | Drop the CSV or enrich it with dimensions, status, rights, hash | scraper | S |

Importer-side changes are deliberately small: a contact mapping and a name/
palette alias. Fixing the scraper output is the right primary fix; the alias
keeps older drops importable.

---

## 9. Acceptance checklist

A brand pack is import-ready when all of these are true:

- [ ] `brand.name` equals the canonical name (not `Bar91.Co.Uk Root`).
- [ ] `brand.url` is set; QR defaults and website footers resolve.
- [ ] Palette ≥ 4 entries with one `ground`, one `ink`, one `accent`.
- [ ] Typography ≥ 2 real families with weights; a scale with at least
      display / h1 / body in px.
- [ ] Exactly one primary wordmark ≥1200 px (SVG preferred) + one mark.
- [ ] No logo files that are photos, favicons, UI icons or other brands.
- [ ] Photography ≥ 3 images with short edge ≥2000 px for print brands; no
      WebP served as `.jpg`.
- [ ] Cover ≥1600×1000 and not a duplicate of the first photo.
- [ ] `guidelines.contact` has Address, Telephone, Email, Website.
- [ ] `guidelines.applications` lists the collateral the venue actually needs.
- [ ] `voice.attributes` / `prefer` / `avoid` populated (not empty arrays).
- [ ] Menu content available as structured JSON (or clearly marked absent).
- [ ] One ZIP → one group; brand order is intentional.
- [ ] No Monteleone-style empty folder in the drop.

Target state after the P0/P1 work (new photography or logo sourcing is
called out where the current drop cannot reach it):

| Brand | Palette | Families | Wordmark | Photos ≥2000 px | Contact | Menu JSON |
|---|---:|---:|---|---:|---|---|
| Bar91 | 6 | 2–3 | ✓ | ≥3 (needs upscale of food shots) | ✓ | ✓ |
| Boteco | 6 | 2 | ✓ (needs a larger cut) | needs re-shoot/source | ✓ | ✓ |
| Piccolino | 14 | 3 | ✓ | needs re-shoot/source | ✓ | ✓ |
| Ronzio | 14 | 2 | **needs a real logo** | ✓ | ✓ (from site text) | ✓ (PDF) |

---

## Appendix A — asset inventory

### Logos

| Site | Files | Unique hashes | Duplicate groups | Usable for a design |
|---|---:|---:|---:|---|
| Bar91 | 18 | 12 | 6 | 1 wordmark (several crops, max 455×262) |
| Boteco | 5 | 5 | 0 | 1 design (max 219×162) |
| Piccolino | 14 | 9 | 5 | 1 transparent wordmark (256×78) + 1 square navy lockup (1080×1080) |
| Ronzio | 4 | 3 | 1 | 0 — UI icon SVGs and the default Squarespace favicon |

Bar91's 18 files break down as: wide wordmark crops (118×69 to 455×262),
square favicon-style crops with letters cut off (168–192 px), two 32×32
icons, one 297×271 "THE CIRCLE loyalty card" logo, one 1994×1330 storefront
photo.

### Photography

| Site | Files | Unique | Largest | Smallest | Format notes |
|---|---:|---:|---|---|---|
| Bar91 | 12 | 11 | 1994×1330 (also cover and one "logo") | 147×110 | one large hero; food shots ≈301×344 |
| Boteco | 1 | 1 | 167×111 | 167×111 | same file as cover |
| Piccolino | 12 | 11 | 1080×1080 (logo lockup) | 88×133 | real food shots ≤480×720 |
| Ronzio | 7 | 6 | 2500×5414 | 2500×3333 | WebP bytes in `.jpg`/`.jpeg` files |

### Covers

| Site | Size | Content | Verdict |
|---|---|---|---|
| Bar91 | 1994×1330 | storefront photo | usable |
| Boteco | 167×111 | same as the only photo | unusable |
| Piccolino | 1080×1080 | logo lockup on navy | branded but not a hero |
| Ronzio | 2500×3333 | food photo | usable (WebP) |

### Documents

| Site | PDFs | Words extracted |
|---|---:|---|
| Bar91 | 5 | 3,119 (privacy 621) |
| Boteco | 3 | 2,633 |
| Piccolino | 4 | 2,282 (privacy 0 — scanned) |
| Ronzio | 3 | 2,094 |

---

## Appendix B: contact conflicts

| Field | Tokens | Page text | Issue |
|---|---|---|---|
| Bar91 phone | 0141 552 5211 | 0141 406 4561 / 0141 406 4562 | conflicting numbers |
| Bar91 email | info@bar91.co.uk, info@bar91.com | — | two addresses, none on page text |
| Boteco phone | `+4401414064561` | 0141 406 4561 | malformed country code |
| Boteco address | — | — | absent |
| Piccolino email | `hello@piccoinoedinburgh.com` **and** `hello@piccolinoedinburgh.com` | `hello@piccolinoedinburgh.com` | typo variant |
| Piccolino phone | `+4401312025423` and `0131 202 5423` | same | duplicate formats |
| Ronzio phone | — | 0141 338 6606 | missing from tokens |
| Ronzio email | — | ronziobroomhill@gmail.com | missing from tokens |
| Ronzio address | — | — | absent |

Piccolino's address is correct in the tokens (`103 High Riggs, Edinburgh,
SCT, EH3 9RP, GB`); the others need a validated canonical block.

---

## Appendix C — CSV noise examples

- Boteco "documents": `/.1-.4.2-.7.5-.9.7z`, `/.1-1.7.1.2-.3.5-.5.8-.7z`,
  `/.1.1.1.1.2h-1zm31.5-2.2h-1l.7-.7h.5c-.1.3-.1.5-.2.7z` — CSS path
  fragments.
- Videos: `specs.stores.Mov`, `specs.thunderbolt.mov`, `/file.mp4`,
  `/profile/luigi/file.mp4` — feature strings and a deleted profile upload.
- Images: `static.wixstatic.com/.../fill/w_40,h_40,...` UI icons, favicons
  and duplicate size variants (25 AVIF variants in Bar91's CSV).
- Ronzio CSV: 14 rows, one of which is the Squarespace default favicon.

---

## Appendix D — import test output

```
Bar91        → Bar91.Co.Uk Root        palette 0, fonts 0, logos 18, photos 12, guidelines: docTitle,docUrl
Boteco       → Botecodobrasil.Com Root palette 0, fonts 0, logos 5,  photos 1,  guidelines: docTitle,docUrl
Piccolino    → Piccolinoedinburgh.Com Root palette 0, fonts 0, logos 14, photos 12, guidelines: docTitle,docUrl
Ronzio       → Ronziobroomhill.Co.Uk Root palette 0, fonts 0, logos 2, photos 7, guidelines: docTitle,docUrl
```

Template consequences for Bar91:

```
business-card-back → text: ["Your name", "General manager"]          // no contact block
menu               → title "Bar91.Co.Uk Root menu", generic dishes    // no venue menu
voucher            → "Redeemable at any Dalton family venue…"         // wrong group
```

These test packs, kits and imports were removed after inspection; the
studio's five existing brand packs are unchanged.

---

## Appendix E — how this was measured

- File inventory: `find`, `du`, `unzip -l`.
- Image dimensions, formats, alpha and duplicate hashes: Python + Pillow.
- PDF word counts: `pdftotext` and `pdfinfo`.
- DOCX parsing: `brand-docx.js` with the server's ZIP reader.
- Real import behaviour: `createBrandPackImport`, `createBrandTemplateProject`
  and `deleteBrandPack` through `server.js`; artefacts deleted afterwards.
- Source files remain untouched in `data/_scraped/`.
