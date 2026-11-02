# JulyDaltonGroup scrape review

**Reviewed** `data/_scraped/JulyDaltonGroup/`  
**Drop date** 1 November 2026 (crawl 22:00–22:13; social 21:59–22:02)  
**Group** Julie Dalton / St Andrews — The Physician, The Adamson, HATCH

> `data/` is git-ignored; paths are local to this machine. This document is
> the durable record of the review, alongside
> [scraped-brand-kit-review.md](scraped-brand-kit-review.md) (the earlier
> AseniGroup/Monteleone drop this one should be compared with).

---

## 1. Verdict

This is a **major structural improvement** over the previous drop and the
first genuinely importable group pack: one ZIP becomes **one group with three
brands**, the token schema is importer-native, and the guide now yields
positioning, applications and a contact block.

It is **not ready to replace the existing Dalton pack** in the studio. The
importable kit contains **no photography, no covers and no logos for two of
the three brands**, its palette is largely Wix UI colours, its typography is
uncurated, and its contact block contains literal `Not found` placeholders
that print on generated cards. The full site and social scrapes contain the
raw material to fix some of this, but nothing joins them to the kit.

It is also a **re-scrape of a group already installed** as *Dalton family
venues* (The Adamson, HATCH, The Physician). Importing it as-is creates a
second group with the same three brands and worse assets.

**Scores**

| Layer | Score | Why |
|---|---|---|
| Structure & schema | 8/10 | Group pack, native tokens, JSON + DOCX guide, applications, rights note |
| Importable brand metadata | 6/10 | Palette/fonts/contact/applications arrive, but polluted or wrong in places |
| Importable visual assets | **2/10** | 1 real logo, 0 photos, 0 covers across three hospitality brands |
| Full site scrape | 5/10 | Excellent page text and PDFs; image extractor is broken; HATCH nearly empty |
| Social scrape | 7/10 | Strong reputation/NAP/review data; no post captions or media; identity false match |
| Studio fit | 4/10 | Imports, but duplicates the existing group, shows `Not found`, generic menus and wrong voucher terms |

---

## 2. What we have

### 2.1 Inventory

| Path | Size | Files | Contents |
|---|---:|---:|---|
| `Julie-Dalton-STAndrews-brand-kit/` | 152 KB | 26 | importable group pack |
| `Julie-Dalton-STAndrews-brand-kit.zip` | 28 KB | 22 entries | same pack, no `.DS_Store` |
| `theadamson.com_root/` | 53 MB | 42 | full site crawl |
| `thephysician.bar_root/` | 12 MB | 22 | full site crawl |
| `hatchstandrews.com_root/` | 56 KB | 11 | full site crawl (nearly empty) |
| `_social/` | 11 MB | 133 | group + per-brand social/reputation crawl |
| `targets.json` | 4 KB | 1 | crawler staging paths |
| **total** | **76 MB** | **236** | |

### 2.2 The group pack

```
Julie-Dalton-STAndrews-brand-kit/
├── README.md                       group name, description, brand table
├── targets.json                    staging paths (not used on import)
├── 00-portfolio/
│   ├── Aseni-Group-Overview.docx   **wrong filename**; contains the right table
│   └── assets/                     empty
├── 01-thephysician-bar/
│   ├── tokens/thephysician-bar.tokens.json
│   ├── thephysician-bar-Brand-Guide.docx
│   ├── brand-guide.json
│   ├── content/thephysician-bar.json
│   └── assets/{logos,colors,type,photography}
├── 02-theadamson/                  same shape
└── 03-hatchstandrews/              same shape
```

The structure is exactly what the importer wants: `00-portfolio/` plus one
folder per brand, each owning `tokens/*.tokens.json`. The ZIP contains every
meaningful file (22 entries; only `.DS_Store` is excluded).

### 2.3 What is in the brand kit, per brand

| Brand | Tokens | Guide DOCX | Guide JSON | Content JSON | Palette SVG | Type SVG | Logo files | Photos | Cover |
|---|---|---|---|---|---|---|---|---|---|
| The Physician | ✓ | ✓ | ✓ | hours only | ✓ | ✓ | **1** (real SVG wordmark) | **0** | **none** |
| The Adamson | ✓ | ✓ | ✓ | hours only | ✓ | ✓ | **0** | **0** | **none** |
| HATCH | ✓ | ✓ | ✓ | menu + drinks + hours | ✓ | ✓ | **0** | **0** | **none** |

Token contents: 14 colours each, 33/16/20 raw font families, **one** type
scale entry (`Arial` 10 px), 5 voice samples, 5/4/5 applications and 4/3/4
brand-fit tags, six contact fields.

### 2.4 The full site scrape

| Site | Pages | Words | £ markers | PDFs (real) | Images | Videos | CSV rows |
|---|---:|---:|---:|---:|---:|---:|---:|
| The Adamson | 24 | 4,780 | 362 | 4 (47 MB) | 10 **broken** | 1 **fake** | 202 |
| The Physician | 17 | 5,829 | 534 | 2 (12 MB) | **0** | 0 | 55 |
| HATCH | 8 | 2,047 | 193 | **0** | **0** | 0 | 58 |

The page text is excellent: full menus, drinks lists, Christmas menus, kids
menus, private hire, events and contact pages. The PDFs are real and
text-extractable (private events, Christmas, cocktail masterclass, private
dining). See [Appendix C](#appendix-c-content-available).

**The image extractor is broken.** Adamson's ten "images" are all **HTML
error pages** saved as 512 KB files with names taken from URL fragments
(`v.WEBP`, `r.fileType.GIF`, `7Emv2.jpg`, `u.SVG`). The one "video" is also
an HTML error page. Physician and HATCH downloaded no images at all. The URLs in
`discovered_media.csv` are site-root basenames (`/115126.png`,
`/0019.jpg`, `/2.png`) — the real CDN paths were lost, so every download
returned the site's 404 page.

### 2.5 The social scrape

`_social/` is a second, independent product: a group benchmark plus a
per-brand reputation and social audit.

- `group.report.md`, `group.summary.json` — ranked group scores.
- Per brand: `business.profile.json`, `src/client/social/social.json`, `social.tokens.json`,
  `insights.md`, `report.html`, `reviews.csv`, `reviews.all.json`,
  `discovery.json`, `state.json`, `crawl.log`, `platforms/*.json`,
  `assets/…`.
- `_cache/` — 64 gzipped response snapshots (9.7 MB), useful only for
  re-parsing.

| Brand | Rating | Reviews | Followers | Overall score | IG posts captured | IG posts total |
|---|---:|---:|---:|---:|---:|---:|
| The Adamson | 4.3 | 870 | 14,566 | 61.2 | 10 URLs | 1,486 |
| The Physician | 3.7 | 65 | 1,794 | 52.3 | 9 URLs | 342 |
| HATCH | 3.5 | 128 | 4,327 | 51.9 | 9 URLs | 238 |

The reports contain ratings, distributions, review themes, sentiment,
standout quotes, owner-response rates, red flags, NAP variants, social
handles and a compliance record. Post rows are **URLs only** — no captions,
no media, no dates; `latest_activity` is `null`, `cadence` is empty and
hashtags are empty despite 9–10 posts being found.

Social media assets are minimal: an Instagram avatar (100×100), Facebook
covers where captured (539–720 px), and one website/listing photo per brand. The
best of these are The Physician's 2000×2000 website PNG and The Adamson's
1655×1330 website JPG — hidden in `_social`, not in the brand kit.

---

## 3. What works — progress since the AseniGroup drop

1. **One group pack.** `00-portfolio/` + three brand folders import as a
   single group. This was the main structural gap before.
2. **Importer-native tokens.** `brand`, `color`, `brand.url`, `name`,
   `slug`, `locale`, `currency` now match what `brandFromDirectory` reads.
3. **Guide with real structure.** The DOCX has `word/styles.xml`, headings
   and tables. The parser extracts **9 sections, positioning, 5/4/5
   applications and 6 contact fields** — previously zero.
4. **Structured JSON alongside the DOCX.** `brand-guide.json` carries
   positioning, applications, brand fit, logo rules, photography, cover,
   content and a rights statement. `content/*.json` carries hours and (for
   HATCH) menu/drinks.
5. **Applications and brand fit exist.** They describe the collateral each
   venue needs (menu, drinks, business card, social, A-board), which is
   exactly the vocabulary the studio uses.
6. **Palette entries carry roles, CMYK and share.** 14 entries per brand.
7. **Group README and portfolio.** One readable description and a brand
   table.
8. **Rights are disclosed.** "Asset rights and licensing were not verified
   by this crawl" — the right honesty, even though nothing enforces it.
9. **Social intelligence is genuinely useful** for positioning and content
   strategy: ratings, review themes, NAP, handles, group benchmark.

---

## 4. What we need — the blocking gaps

### 4.1 Visual assets (blocking)

| Need | Physician | Adamson | HATCH |
|---|---|---|---|
| Primary wordmark | 1 SVG ✓ (no PNG fallback) | **missing** | **missing** |
| Mark/monogram + light/dark variants | missing | missing | missing |
| Hero / interior / food photography | **0** | **0** | **0** |
| Cover | **none** (palette strip used instead) | **none** | **none** |
| Print-capable resolution | n/a | n/a | n/a |

The site crawls cannot fill this because their image downloads are broken.
The social crawl has 1–2 usable photos per brand, at best 2000 px on one
side, and nothing for Adamson/HATCH beyond a cover and a listing image.

### 4.2 Palette roles are wrong

The new palette is larger but **less brand-accurate** than the existing
curated pack. It is dominated by Wix theme colours, and the accent is the
Wix link blue:

| Brand | New accent | Real brand accent (curated pack) | Problem |
|---|---|---|---|
| The Physician | `#116dff` (Wix blue) | `#eb5b3c` vermilion | accent is a UI link colour; vermilion is absent |
| The Adamson | `#116dff` (Wix blue) | `#bfa36b` brass | brass is absent; ink/brass identity lost |
| HATCH | `#f9ad4d` (Wix orange) | plum `#5f224d` / brass `#c78132` | plum is present but tagged `neutral` |

All three share the same Wix palette values (`#f4b8b9`, `#597dff`,
`#acbeff`, `#ed8f90`, `#d7b7fb`), which is a strong signal that these are
platform defaults, not brand evidence. Used as-is, every Asset Studio design
would paint The Physician and The Adamson in Wix blue.

### 4.3 Typography is uncurated

- Raw families: **33 / 16 / 20**, but the first entries are Wix internals
  (`wf_151e…`, `wfont_8da…`), Adobe font IDs (`brandon-grot-w01-light`,
  `din-next-w01-light`, `bree-w01-thin-oblique`), CJK fallbacks and CSS
  artefacts (`sans-serif!important`, `unset)`, `arial)`).
- The importer keeps the first 12, so real display faces can be crowded out
  or mixed with unusable names.
- The type scale is a single entry: **Arial, 10 px**. There is no
  display/H1/H2/body hierarchy.
- `specimen.svg` sets `font-family` to the Wix/Adobe IDs above; those fonts
  are not installed, so it renders browser fallbacks, not a specimen.
- No font binaries or licences are included.

### 4.4 Contact is wrong or placeholder

| Brand | Kit contact | What it should be | Issue |
|---|---|---|---|
| The Physician | 127 South Street; `01334479191`; `info@theadamson.com` | 129 South Street; emails verified | wrong street number; Adamson-branded inbox on the Physician card (may be a group inbox — unverified) |
| The Adamson | Address/Phone/Email = **“Not found”** | 127 South Street, 01334 479191, reservations@… | data exists in page text and social profile but was not used |
| HATCH | Address = **“Not found”**; phone/email ✓ | 129 South Street | address missing |

This is not cosmetic: the template builder copies the strings verbatim.
Generated business cards read:

```
The Adamson → "Not found", "Not found", "Not found"
```

and its flyer footer reads `Not found · www.theadamson.com`. A placeholder
must never be a value.

The social NAP layer knows better for Adamson/Physician in places, but also
contains conflicts and one false match (see [§6.4](#64-social-identity-issues)).

### 4.5 Content extraction is partial and semantically wrong

| Brand | Content JSON | Reality |
|---|---|---|
| The Physician | `hours` only — and they are **oyster-offer times** (Sun–Thu 5:00–6:30 pm), not opening hours | site has full cocktails, drinks, food, Christmas, cocktail-trail menus |
| The Adamson | `hours` only — lunch/food-service times, not full opening hours | site has main, drinks, kids, Sunday roast, Thanksgiving, Christmas menus; 4 PDFs |
| HATCH | `menu` + `drinks` + `hours` | parsed, but structure is wrong: drinks are modelled as section names with sizes as items; menu "sections" are individual dishes with modifier items |

No menu content reaches the studio: the importer ignores `content/*.json`,
so generated menus still use the generic scallops/beef placeholder set.

### 4.6 Voice is raw text, not a voice

- 5 samples per brand, but attributes/prefer/avoid are empty.
- Samples are mixed sources: event copy (Physician), positioning sentences
  (Adamson), founder story (HATCH). Social `voice.samples` is a single review
  quote; `topKeywords` are review themes.
- No tagline: `brand.tagline` is `null` for all three, although the existing
  pack has "Find your cure.", "Locally sourced, carefully served." and "A new
  experience for St Andrews."

### 4.7 Group identity and duplication

- Pack name: `Julie-Dalton-STAndrews` (machine slug, not a client-facing
  group name such as *Dalton family venues*).
- Brand ids: `thephysician-bar`, `theadamson`, `hatchstandrews` — they do
  **not** match the existing pack's `the-physician`, `the-adamson`, `hatch`.
- The existing *Dalton family venues* pack already holds the same three
  brands with curated logos (12/4/11), photography (3/3/3), covers and
  correct taglines/addresses.
- Importing this drop adds a **second group** with the same brands and worse
  assets. Saved Asset Studio entries resolve their brand by `brandId`, and
  the session stores `packId`; a replacement must keep those ids (or
  migrate) so saved assets and the last-open brand still resolve.
- `00-portfolio/Aseni-Group-Overview.docx` is misnamed (wrong project) and
  its parsed name is "Portfolio brand overview", not the group name.
- `targets.json` still points at `crawler_output/Julie-Dalton-STAndrews/…`
  staging paths.
- 11 `.DS_Store` files across the drop.

---

## 5. What we should have but don't

### 5.1 Scraper / crawler

| Missing | Impact |
|---|---|
| A working media resolver (real CDN URLs, magic-byte validation, reject HTML) | 0 real site images; 10 fake files + 1 fake video |
| Logo extraction for raster/site-header logos with PNG + SVG and variants | Adamson/HATCH have no logo; Physician has no fallback |
| Logo selection and de-duplication (wordmark vs mark vs icon vs photo) | A single SVG for one brand; no variants |
| Photography classification and minimum resolution (`hero`, `interior`, `food`, ≥2000 px) | no photography at all |
| Cover generation from hero or logo | palette strip becomes the identity card |
| Palette role inference that ignores platform/theme colours | Wix blue becomes the brand accent |
| Type curation: whitelist real families, drop platform IDs/artefacts, build a display/H1/body scale | unusable specimen and scale |
| Font licence/family availability check | names like `brandon-grot-w01` cannot render |
| Contact validation: no sentinel values, cross-source merge, per-brand correctness | `Not found` printed on cards; wrong street/emails |
| Content extraction for every page/PDF, normalised schema, hours semantics | menus remain generic; happy hour becomes opening hours |
| Voice attributes and a real tagline | generic headlines/CTAs |
| Social post captions, media, dates, cadence, hashtags | cannot use social as a content or photography source |
| Identity resolution / business-match confidence | wrong FHRS record in the Physician report |
| Stable brand ids and an update/merge contract | duplicate group, broken saved assets |
| Canonical group name and portfolio naming | gate shows `Julie-Dalton-STAndrews` |
| Rights/licence per asset and font | cannot legally publish scraped media |
| Clean drop: no `.DS_Store`, no staging paths, no HTML-as-image | noise and false confidence |

### 5.2 Studio / importer

| Missing | Impact |
|---|---|
| Pack **update** flow (replace assets/metadata in place, preserve pack and brand ids) | importing creates a duplicate group |
| Read `brand-guide.json` and `content/*.json` | structured data written but ignored |
| Consume `applications` / `brandFit` | category defaults and hiding are not driven by the pack |
| Sanitise contact values (`Not found`, empty sentinels) | placeholders print |
| Map social handles/URLs to the fields cards expect | cards show full Instagram URLs |
| Cover fallback that is not a palette strip | gate cards look like swatches |
| Font family validation against loaded families | unrenderable families silently fall back |
| Template copy that is brand-specific | generic scallops and "Dalton family venue" voucher terms |
| Optional social/reputation surface in Brand identity | rich insights remain outside the studio |
| Pack provenance/version display and duplicate detection | two groups with the same brands is invisible |

---

## 6. Alignment with studio-layers and Asset Studio

### 6.1 What happened on import

Tested with the real `createBrandPackImport` and `createBrandTemplateProject`;
test pack, kits and imports were deleted afterwards.

| Imported field | The Physician | The Adamson | HATCH |
|---|---|---|---|
| Pack name | Julie-Dalton-STAndrews | same | same |
| Brand id | thephysician-bar | theadamson | hatchstandrews |
| Palette | 14 | 14 | 14 |
| Families | 12 (raw 33) | 12 (raw 16) | 12 (raw 20) |
| Type scale | 1 (`Arial` 10 px) | 1 | 1 |
| Logos | 1 SVG | **0** | **0** |
| Photography | **0** | **0** | **0** |
| Cover | `palette.svg` | `palette.svg` | `palette.svg` |
| Guidelines | positioning, 5 apps, 6 contacts | positioning, 4 apps, 6 contacts | positioning, 5 apps, 6 contacts |
| Type hierarchy / logo rules / print spec / facts | 0 / 0 / 0 / 0 | same | same |
| Brand kit palette / fonts | 14 / 12 | 14 / 12 | 14 / 12 |

The import is structurally correct — one group, three brands, palettes and
kits — and is a big step forward. The failures are content quality, not
plumbing.

### 6.2 What Asset Studio would do with it

- **Brand gate**: a second group next to *Dalton family venues*, with three
  cards whose cover is a horizontal palette strip.
- **Palette controls**: 14 swatches, but the accent is Wix blue (Physician,
  Adamson) or Wix orange (HATCH), so every design is themed wrong.
- **Type tab**: mostly Wix/Adobe internal names; selecting one falls back to
  a system stack. The "type specimen" shows browser fallbacks.
- **Logo slot**: Physician uses a real vector wordmark (tinted to one ink);
  Adamson/HATCH fall back to a typographic wordmark. No light/dark variants.
- **Photography**: every photo-led design (flyers, event poster, roll-up,
  menu photo header, social) uses the branded-pattern fallback.
- **Business cards**: Physician/Adamson/HATCH cards show `Not found` where
  address/phone/email are missing; Physician's address is the wrong street
  and its email is the Adamson's.
- **Menus / table cards / digital board**: generic template dishes, not the
  menus that exist in page text and PDFs.
- **Vouchers**: still "Redeemable at any Dalton family venue" — which happens
  to name the right group here, but for the wrong reason (hard-coded).
- **Applications/brandFit**: not read, so no category defaults or hiding.
- **Social/reputation**: invisible in the studio.

### 6.3 Existing vs new pack

| | Existing *Dalton family venues* | New *Julie-Dalton-STAndrews* |
|---|---|---|
| Structure | 3 brands, no portfolio | 3 brands + portfolio |
| Import | curated manually | one group, native schema |
| Brand ids | `the-adamson`, `hatch`, `the-physician` | `theadamson`, `hatchstandrews`, `thephysician-bar` |
| Palette | 9 / 10 / 10, curated roles | 14 / 14 / 14, Wix-dominated |
| Families | 4 / 6 / 4, curated | 12 / 12 / 12 from 33/16/20 raw |
| Logos | 12 / 4 / 11 with variants | 1 / 0 / 0 |
| Photography | 3 / 3 / 3 | 0 / 0 / 0 |
| Covers | yes | no (palette strip) |
| Contact | correct addresses, curated | `Not found`; wrong Physician address/emails |
| Taglines/wordmarks | yes | tagline null; wordmark = name |
| Applications | 7 each | 5 / 4 / 5 |
| Structured guide | DOCX only | DOCX + JSON |
| Content | template defaults | hours (+ HATCH menu) |
| Social intelligence | none | rich |

**Conclusion:** do not import this as a second group. Use its metadata,
applications and content to **update the existing pack** (or rebuild the
existing pack with fixed assets), preserving the existing pack id and brand
ids so saved assets keep working.

### 6.4 Social identity issues

- **The Physician is matched to a Birmingham food-hygiene record**:
  `36 Harborne Road, Birmingham`, FHRS 5, match confidence 1.05. The venue is
  in St Andrews. This is a false positive and appears in `insights.md` and
  `business.profile.json`.
- Physician canonical address is **127 South Street**, while the site says
  **129 South Street** (and 129 appears in `addresses_seen`). The conflict
  block only reports 127 vs Birmingham, so 129 is not flagged.
- Physician emails are the Adamson's; Adamson NAP is incomplete in the kit
  but present in the social profile; HATCH is the cleanest.
- Adamson phone variants include `0 0 4960 7016`; consistency 0.33.
- Google exposes only ~5 reviews to anonymous browsers (explicit warning);
  TripAdvisor is blocked (403), press empty, TikTok timed out for Adamson,
  RestaurantGuru found only for HATCH.

The social data is useful, but it needs disambiguation and a
"do-not-publish-without-review" flag before it feeds external assets.

### 6.5 What to do with this drop

- **Do not import it into Asset Studio as a new group.** It would show
  *Dalton family venues* and *Julie-Dalton-STAndrews* side by side with the
  same three brands, the new one with palette-strip covers and no photos.
- **Keep the existing pack's visual assets** (logos, photography, covers,
  taglines) and take the new structured metadata, applications, brand fit
  and content after correcting contact and palette roles.
- **Or rebuild the existing pack from a fixed v2.1 crawl** once real media,
  logos and covers are extracted — but keep the pack id and brand ids so
  saved assets and sessions survive.

---

## 7. Useful, low value, irrelevant

### 7.1 High value — keep and wire up

- Structured tokens: brand identity, 14 colours with CMYK/share, contact,
  applications, brand fit.
- `brand-guide.json` and the structured DOCX: positioning, applications,
  contact, logo rules, rights.
- Page text for all three sites: full menus with prices
  (Physician £534 / Adamson £362 / HATCH £193 worth of menu lines).
- PDFs: Physician cocktail masterclass, Adamson private events / private
  dining / large-party bookings, group Christmas brochure.
- Group README and portfolio table.
- Social insights: ratings, distributions, themes, quotes, NAP variants,
  handles, group benchmark.
- The Physician's real logo SVG (839×84 viewBox, colour #13132f).
- Social website photos: Physician 2000×2000, Adamson 1655×1330.

### 7.2 Low value — keep only if cheap

- `_social/_cache/` (9.7 MB) — replay only; not content.
- `discovered_media.csv` — crawler log with broken URLs and false positives.
- `social/platforms/*` — mostly metadata; posts are URLs only.
- `report.html` — duplicates `insights.md` for humans.
- Instagram avatars (100×100) and Facebook covers (539–720 px).
- `.DS_Store`, `targets.json`, `robots.txt`.

### 7.3 Irrelevant or misleading — remove or fix

| Item | Where | Why |
|---|---|---|
| 10 × 512 KB HTML files named `*.WEBP/GIF/JPG/PNG/SVG/AVIF` | Adamson `images/` | Not images; failed downloads |
| `videos/specs.stores.Mov` | Adamson | HTML, not video |
| `field-context-menu.mov`, `specs.thunderbolt.mov`, `/file.mp4`, `.7z` URLs | all CSVs | JS/CSS artefacts |
| `Aseni-Group-Overview.docx` | portfolio | Wrong project name |
| `brand-guide.json` `cover: null` + palette-as-cover fallback | kit | Gate card is a colour strip |
| `specimen.svg` referencing unavailable Wix/Adobe fonts | all | Renders fallbacks |
| Duplicate group Christmas brochure (12 MB in two sites) | Physician + Adamson | Group asset, not brand asset |
| Cross-brand event posts under Adamson (`Elvis at The Physician`) | pages_text | Needs attribution, not Adamson copy |
| Wix palette colours as brand accent | tokens | Destroy brand recognition |
| `Not found` contact values | guides/tokens | Printed verbatim |
| FHRS Birmingham record | Physician social | Wrong business |
| 11 `.DS_Store` files | everywhere | OS junk |

---

## 8. Recommended path

### 8.1 Scraper (v2.1)

1. **Fix media extraction**: resolve CDN URLs, validate magic bytes/content
   type, reject HTML, never truncate at an arbitrary 512 KB.
2. **Logos**: extract header/site logo, inline SVG and PNG cuts; classify
   wordmark/mark/icon, variants; always provide SVG + PNG (≥1200 px);
   exclude favicons/UI icons/photos/other brands.
3. **Photography**: classify hero/interior/food/people, enforce minimum
   short edge, record source and rights; use social/website photos when the
   site crawl fails.
4. **Cover**: generate from hero photography or a logo lockup, never from
   the palette.
5. **Palette**: exclude platform/theme colours; derive ground/ink/accent
   from brand surfaces (logo, headers, buttons, print PDFs); validate
   contrast and roles.
6. **Typography**: whitelist real families, drop Wix/Adobe IDs and CSS
   artefacts, map display/body, build a real scale from observed headings,
   and render the specimen in fonts the machine has.
7. **Contact**: no sentinel values; merge page text, social NAP and tokens;
   resolve conflicts with per-field confidence; keep 129 South Street for
   The Physician and HATCH, and 127 for The Adamson.
8. **Content**: parse menus from every page and PDF into one normalised
   schema (`menu`, `drinks`, `hours` with explicit `opening` / `kitchen` /
   `offers`), and mark confidence.
9. **Social**: capture post captions, media, dates and hashtags; compute
   cadence; fix identity matching (FHRS/business confidence); keep review
   data in a clearly separate "research" block.
10. **Group**: canonical group name, stable slugs/ids matching the studio,
    correct portfolio filename, no staging paths, clean junk.

### 8.2 Studio (small, high value)

1. **Pack update/merge**: upsert a pack by stable id; preserve brand ids and
   saved assets; warn on duplicate brand names/ids across packs.
2. **Read `brand-guide.json` + `content/*.json`**; prefer JSON over DOCX for
   automation.
3. **Consume `applications` / `brandFit`** to set default categories and
   hide irrelevant ones.
4. **Sanitise contact** (`Not found`, empty, malformed emails/phones) and
   map handles rather than URLs.
5. **Cover fallback**: logo/wordmark tile, not palette strip.
6. **Font validation**: drop/flag families that are not loaded; expose the
   fallback.
7. **Template copy**: use content when present; remove hard-coded Dalton
   terms; blank/neutral placeholders rather than another brand's copy.
8. **Optional social panel** in Brand identity: rating, review themes,
   handles — clearly marked as research, not brand assets.

### 8.3 Order of work

| Priority | Action | Effort |
|---|---|---|
| **P0** | Fix image/logo/cover extraction; validate downloads | M |
| **P0** | Palette role inference from brand evidence | S |
| **P0** | Contact sanitisation + per-brand correctness | S |
| **P0** | Type curation + real scale | M |
| **P0** | Do not import as a duplicate group — update the existing pack | S |
| **P1** | Content extraction for all menus + normalised schema | M |
| **P1** | Studio reads `brand-guide.json` / `content` / applications | M |
| **P1** | Social post captions/media + identity disambiguation | M |
| **P1** | Cover/font/contact fallbacks and template copy fixes | S |
| **P2** | Rights/licence metadata, font files | M |
| **P2** | Pack update tooling and duplicate detection | M |
| **P2** | Remove junk, staging paths, `.DS_Store` | S |

---

## 9. Acceptance checklist

A re-scrape is ready to update the live *Dalton family venues* pack when:

- [ ] The ZIP imports as **one group** without creating a duplicate of the
      existing pack; pack and brand ids are stable.
- [ ] Group name is client-facing (*Dalton family venues*), and the
      portfolio file is not called *Aseni*.
- [ ] Each brand has exactly one primary wordmark (SVG + PNG ≥1200 px) and
      no UI icons/favicons/photos in `assets/logos`.
- [ ] Each brand has ≥3 print-capable photos (short edge ≥2000 px) and a
      cover that is not a palette strip.
- [ ] Palette roles are brand-evidence based: Physician vermilion
      `#eb5b3c`; Adamson brass `#bfa36b`; HATCH plum `#5f224d` (or the
      client's confirmed values), with no `#116dff` accent.
- [ ] Typography has ≥2 real families with a display/H1/body scale, no
      `wf_`/`wfont_`/`unset)`/`arial)` entries, and a specimen that renders.
- [ ] Contact contains no `Not found`; addresses are 129 South Street
      (Physician) and 127 South Street (Adamson/HATCH) as appropriate;
      emails and phones are per-brand verified.
- [ ] `content` has menu and drinks for all three brands (or explicit
      `null` with a reason), hours distinguish opening from kitchen/offers.
- [ ] `applications` sizes use the studio's names (`85×55 mm`, not
      `90x55mm`); `brandFit` uses studio categories.
- [ ] Social identity fields are disambiguated; the Birmingham FHRS record
      is removed from The Physician.
- [ ] Rights/licence status is attached to logos, photos and fonts.
- [ ] No `.DS_Store`, staging paths, broken HTML "media", or duplicate
      12 MB PDFs inside the pack.

**Expected end state**

| Brand | Palette | Families | Logo | Photos | Cover | Contact | Content |
|---|---|---:|---|---:|---|---|---|
| The Physician | roles corrected | 2–3 | SVG + PNG | ≥3 + 2000² website photo | hero | 129 South St, verified emails | menu, drinks, hours |
| The Adamson | roles corrected | 2–3 | SVG + PNG (brass/black) | ≥3 + 1655² website photo | hero | 127 South St, 01334 479191 | menu, drinks, hours |
| HATCH | roles corrected | 2–3 | SVG + PNG (plum) | ≥3 (needs sourcing) | hero or lockup | 129 South St | menu, drinks, hours |

---

## Appendix A — NAP and reputation

| | The Adamson | The Physician | HATCH |
|---|---|---|---|
| Canonical name | The Adamson | The Physician | Hatch (kit: HATCH) |
| Address | 127 South Street | 127 (should be 129) | 129 South Street |
| Phone | 01334 479191 | 01334 479191 | 01334 475557 |
| Email | reservations@theadamson.com | Adamson emails | info@hatchstandrews.com |
| Website | theadamson.com | thephysician.bar | hatchstandrews.com |
| Instagram | @theadamsonstandrews | @thephysician_standrews | @hatch_standrews |
| Facebook | TheAdamsonStAndrews | profile 61554721448724 | HatchStAndrews |
| Rating / reviews | 4.3 / 870 | 3.7 / 65 | 3.5 / 128 |
| Followers | 14,566 | 1,794 | 4,327 |
| Overall score | 61.2 | 52.3 | 51.9 |
| Identity consistency | 0.33 | 0.67 | 0.67 |
| Compliance | FHIS Pass, Fife | **FHRS Birmingham (wrong)** | FHIS Pass, Fife |

Review themes available for all three (service, drinks, food quality,
atmosphere, wait time, value); The Physician has a 20% one-star share and a
40% owner-response rate.

## Appendix B — import test output

```
PACK julie-dalton-standrews-… | Julie-Dalton-STAndrews | brands 3

The Physician  palette 14 | families 12 | logos 1  | photos 0 | cover palette.svg
The Adamson    palette 14 | families 12 | logos 0  | photos 0 | cover palette.svg
HATCH          palette 14 | families 12 | logos 0  | photos 0 | cover palette.svg

business-card-back (Physician): phone, Adamson emails, 127 South St, website, Instagram URL
business-card-back (Adamson):   "Not found", "Not found", "Not found", website, Instagram URL
flyer footer (Adamson):         "Not found · www.theadamson.com"
menu:                           generic scallops/beef placeholders
voucher:                        "Redeemable at any Dalton family venue"
```

Test pack, kits and imports were removed afterwards; the five existing packs
are unchanged.

## Appendix C: content available

**The Physician** — 17 pages, 5,829 words, 534 £ markers
- cocktails, other drinks, food, Christmas food, Christmas drinks, cocktail
  trail, events, private hire, merch, about
- PDFs: Cocktail Masterclass (1 page), group Christmas brochure (20 pages)

**The Adamson** — 24 pages, 4,780 words, 362 £ markers
- main menu, lunch, drinks, kids, Sunday roast, Thanksgiving, Christmas,
  market menu, private hire, jobs, events/blog
- PDFs: Private Events (13 pages), Christmas (20 pages), large-party
  bookings (3 pages), private dining (2 pages)

**HATCH** — 8 pages, 2,047 words, 193 £ markers
- menu, drinks, kids, afternoon tea, Hatch Club, about
- No PDFs (only `robots.txt`)

## Appendix D — social intelligence at a glance

The social crawl is a usable **research** layer, not a brand-asset layer.

| | The Adamson | The Physician | HATCH |
|---|---|---|---|
| Rating / reviews | 4.3 / 870 | 3.7 / 65 | 3.5 / 128 |
| Overall score | 61.2 | 52.3 | 51.9 |
| Review themes | food quality, service, consistency, events | drinks, service, food criticism, atmosphere | food quality, service, drinks, wait time, value |
| Google topics | cocktails 74, fish & chips 17, Sunday roast 13, Chateaubriand 9 | cocktails 31, decor 12, wait time 5, afternoon tea 2 | portion size 10, outdoor seating 4, ox cheek 3, haggis 2 |
| Social presence | Facebook 9,266; Instagram 5,300; TikTok listed | Instagram 1,794; Facebook present | Facebook 1,851; Instagram 2,476 |
| Handle consistency | 0.5 | 0.0 | 0.0 |
| Missing platforms | YouTube | TikTok, YouTube | TikTok, YouTube |
| Red flags | only 5 reviews readable; no owner responses | 13/65 one-star; 40% owner responses; wrong FHRS record | only 5 reviews readable; below-4.0 rating |

**Use it for**: positioning, campaign themes, testimonial shortlists,
photography subject priorities (cocktails for The Adamson and The
Physician; brunch/portions for HATCH), and social handles.

**Do not use it for**: brand templates, palette, typography or logos.
Review quotes need attribution and permission before publishing.

## Appendix E — how this was measured

- File inventory and sizes: `find`, `du`, `unzip -l`, `zipfile`.
- Assets: Pillow dimensions/formats; SHA-256 duplicate checks; `file` to
  detect HTML masquerading as images.
- PDFs: `pdfinfo`, `pdftotext`.
- Guides: `src/server/brand-docx.js` with the server ZIP reader.
- Import behaviour: `createBrandPackImport`, `createBrandTemplateProject`,
  `deleteBrandPack` through `server.js`; all artefacts deleted.
- Social: `business.profile.json`, `src/client/social/social.json`, `insights.md`,
  `platforms/*.json` inspected directly.
- Source drop untouched.
