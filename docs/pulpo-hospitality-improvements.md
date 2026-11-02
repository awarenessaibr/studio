# Pulpo Hospitality — improving the scrape → pack → import pipeline

**Based on** the as-is review ([pulpo-hospitality-review.md](pulpo-hospitality-review.md))
and the refined rebuild ([pulpo-hospitality-refinement.md](pulpo-hospitality-refinement.md))
**Scope** what to change in the crawler, the pack contract and the studio so the
next automatic drop lands closer to the refined result
**Date** 2 November 2026

---

## 1. The short version

The crawl is not the problem. On this drop it captured everything needed for a
good brand system — four sites, 33 menu PDFs, 571 photographs, correct
addresses, real logos (in the PDFs) and a full social dossier. **The identity
layer throws that evidence away and substitutes CSS and page markup.** Then the
studio adds three template behaviours that would spoil even a perfect pack.

The fix splits cleanly:

| Where | What | Why it matters |
|---|---|---|
| Crawler | Read identity from the print PDFs and the download pool, not from CSS/page markup | Recovers palette, type, logos, menus |
| Crawler | Validate before writing (prices, contrast, placeholders, brand affinity) | Stops silent thin packs |
| Studio | Use `brand.content` in the template builder; region-aware voucher terms; no sentinel contact values; covers from photography | Stops a good pack from producing a bad design |
| Studio | Pack update by stable id | Stops duplicate groups when a pack is improved |

Everything below is ordered by **impact on the next drop**, with the code
location that owns it.

---

## 2. Diagnosis map

Each row is a defect observed in this run, its cause, where it lives, and
whether the fix is mechanical (automatable) or judgment.

| # | Defect | Cause | Owner / location | Automatable? |
|---|---|---|---|---|
| 1 | Menus 0/0/1/1 | `menu_text = menu_text or text` keeps the first "menu" file (kids/lunch); `pdftotext -layout` mangles multi-column menus | `extract_content_pack()` 2685, `extract_pdf_text()` | **Yes** |
| 2 | WP preset palette, wrong accent | CSS-frequency palette; roles by luminance; accent by saturation; platform hex list incomplete | `build_palette()` 2313 | **Yes** |
| 3 | Icon fonts, wrong scale ids | Families from all CSS; display = largest observed size; ids don't match the studio | `build_typography()` 2421, `build_type_scale()` 2460 | **Yes** |
| 4 | 3 of 4 brands with no logo | Logo candidates only from page markup; no pool/PDF scan | `extract_logo_candidates()` 1220, `select_curated_logos()` 2182 | **Yes** |
| 5 | La Casa 0 photos, no cover | Selection iterates page candidates, not the 172 downloaded files | `select_curated_photography()` 2230, `select_cover()` 2280 | **Yes** |
| 6 | `Email: Not found` printed | Guide writer emits a sentinel for a missing field | `write_brand_guide_docx()` 3213 | **Yes** |
| 7 | Wrong Le Bistrot address | Canonical NAP from one source (Google), no print/site cross-check | `build_contact_block()` 1021 | **Yes** |
| 8 | 4 guide tables empty | Writer/reader header mismatch; sections never written | `write_brand_guide_docx()` vs `brand-docx.js` 300–335 | **Yes** |
| 9 | Empty voice, null tagline | Attributes never inferred; `normalizeVoice` drops samples | `extract_voice_samples()` 2765, `normalizeVoice()` `brand-pack.js` 250 | Partly |
| 10 | Cross-brand PDFs/photos | No brand-affinity check on media or documents | download/candidate extraction | **Yes** (with a human confirm) |
| 11 | Single address for multi-room brands | NAP model is one address per brand | `build_contact_block()` | **Yes** |
| 12 | Menus in templates are generic | `menuItems()` hard-codes HATCH/Physician names, then returns scallops | `brand-pack.js` 1135 | **Yes** |
| 13 | Voucher says "Dalton family venue" | Hard-coded default terms | `brand-pack.js` 1431–1462 | **Yes** |
| 14 | Cards show full Instagram URLs | Contact mapping passes URLs, not handles | `brand-pack.js` `contactMap()` 825 | **Yes** |
| 15 | No pack update path | Import always creates a new pack id | `server.js` `createBrandPackImport()` 3006 | Yes (feature) |

---

## 3. Crawler changes

### 3.1 Menu and content extraction — the highest-value fix

**Problem.** The crawler has 32 distinct priced menu PDFs and imports 2 dishes. The cause is
three lines of source selection and a text-mode choice.

**Change**

1. **Collect every menu source, not the first.** Score by priced-item density
   after parsing, not by filename:
   `score = name_price_lines × 2 + £ markers + word count / 100`.
   Keep the top source as `content.menu`, the best drinks source as
   `content.drinks`, and record the rest under `menus` (see 3.6).
2. **Use `pdftotext -raw`.** It preserves one dish per line; `-layout`
   interleaves columns and is the reason the four-column La Casa à la carte
   produced nothing.
3. **Validate every price.** The refinement script rejects an item whose price
   string does not appear in the source text. Run the same check in the crawler
   and fail the brand if the match rate is under ~90%.
4. **Never treat a kids/lunch/set menu as the main menu** unless it is the only
   priced source; tag menus by kind (`a_la_carte`, `lunch`, `kids`, `dessert`,
   `drinks`, `christmas`, `takeaway`).
5. **Store the extra menus.** The studio schema accepts only `menu`, `drinks`,
   `hours`, `bookingUrl`; add a `menus` map to the content pack and let the
   studio ignore unknown keys for now (3.7).

**Acceptance:** `content.menu.items ≥ 20` for a restaurant with a priced PDF, or
an explicit `null` plus a reason.

### 3.2 Palette — sample the brand, not the stylesheet

**Problem.** 41 of 56 palette slots are WordPress presets; every accent is a
WordPress UI colour.

**Change**

1. **Evidence order:** print PDFs (ground, rules, display type, covers) → logo
   artwork → site CSS brand variables → `themeColor`. CSS becomes a fallback,
   not the source.
2. **Reject platform palettes by signature**, not by a short hex list: a palette
   containing 6+ of the WordPress preset set (`#cf2e2e`, `#ff6900`, `#fcb900`,
   `#7bdcb5`, `#00d084`, `#8ed1fc`, `#0693e3`, `#9b51e0`, `#abb8c3`, `#313131`,
   `#f78da7`) is a theme palette; drop those entries before ranking. Also drop
   names matching `Wp Preset`, `Wp Admin`, `Wp Editor`, `Eicons`, `Fbx Legacy`.
3. **Assign roles from surfaces, not luminosity alone:** paper ground (largest
   light area), ink (text colour, largest dark area), accent (the saturated
   colour with the highest area on rules/display type). In the refinement this
   produced the right answer for all four brands.
4. **Contrast gate:** ground→ink ≥ 4.5:1, ground→accent ≥ 2.4:1. If the true
   accent fails, add an accessible shade as a separate entry with a
   `call to action` role (La Casa's seal gold) instead of replacing the brand
   gold.
5. **Record provenance per colour** (`pdf:menu-2026-08`, `logo`, `css`).

**Acceptance:** zero entries whose name matches a platform signature; one
`ground`, one `ink`, one accent; contrast gates logged.

### 3.3 Typography — read the PDFs

**Problem.** The display face is FontAwesome for POMO and the body face is a
handwriting font for Mia. The scale ids do not match the studio, so every
template falls back.

**Change**

1. **`pdffonts` on every menu PDF** gives the real embedded families
   (`CormorantGaramond-Light`, `NeutraText-Book`, `BodoniAntiquaTOT-BolCon`,
   `WhenNightComes-Regular`, `ADAM.CGPRO`). Rank families by glyph coverage and
   usage, not by CSS frequency.
2. **Hard-exclude icon fonts** by name and by evidence: `FontAwesome`,
   `Dashicons`, `Ionicons`, `Eicons`, `Glyphicons`, `IcoMoon`, and any family
   whose glyph set is PUA/private-use.
3. **Assign roles:** the script/display face used for covers and section heads →
   `display`; the face carrying dish descriptions → `body`; the UI face →
   `label`.
4. **Build the scale with the studio's ids** — `display--wordmark`, `title`,
   `heading-xl/l/m/s`, `body-l/m/s`, `menu--navigation` — and real px values
   measured from the PDF headings, not CSS defaults.
5. **Ship a stand-in map** (`typography.substitutes`) and add the stand-ins to
   the kit so validation matches what renders.

**Acceptance:** ≥2 real families, 0 icon fonts, 10 scale steps, all ids
resolvable by `fontFor()`.

### 3.4 Logos — scan the pool and the PDFs

**Problem.** One logo across four brands. The other three existed in the
download pool (two brands) and in the PDFs (all brands).

**Change**

1. **Scan the whole download pool** for logo-shaped artwork: transparency, aspect
   1:6–6:1, low colour count, high edge density, filename hints. Do not rely on
   `<img>` tags.
2. **Extract print logos from PDFs at 600 dpi**: detect the emblem bbox by
   luminance against the page ground, key the ground to alpha, unpremultiply,
   generate `ink`/`white` variants. This is what recovered La Casa's badge and
   POMO's gold lockup.
3. **Classify and name** for the importer: `logo-primary-*`, `logo-ink-*`,
   `logo-white-*`, `logo-mark-*`; `wordmark`/`lockup`/`emblem` in the name.
4. **Reject** favicons (<300 px), UI sprites, campaign graphics ("View our
   Christmas menu"), photographs and other brands.
5. **Record dimensions and a min-size recommendation** so the studio can warn.

**Acceptance:** ≥1 real logo ≥800 px wide per brand; no favicon/UI/photo in
`assets/logos`.

### 3.5 Photography and covers — use the pool

**Problem.** La Casa had 172 downloaded images and 0 selected; its cover fell
back to the palette strip. The other three covers duplicate photo 01.

**Change**

1. **Select from the download pool**, not only from page candidates.
2. **Brand affinity first:** compare each image against the brand's logo palette
   and page context; drop images that belong to a sister brand (Mia's pool holds
   50 La Casa and 11 POMO photographs).
3. **Classify**: `hero-`, `interior-`, `exterior-`, `food-`, `drink-`, `people-`,
   `detail-`; require short edge ≥1600 px for print, ≥1200 for social.
4. **Cover rule:** 3:2 crop at 2000 px from the best hero, explicitly different
   from `photo-01`; never a palette image.
5. **Record source URL, capture date and rights status** per file.

**Acceptance:** ≥3 print-capable photos; cover ≥1600×1000 and distinct from
photo 01; zero cross-brand files.

### 3.6 Contact — validate, don't guess

**Problem.** `Email: Not found` on four brands, one wrong address, three
multi-room brands flattened to one address.

**Change**

1. **Merge sources with priority** — print PDFs and site text (current) over
   social listings (may be stale) over crawl hints. Le Bistrot's PDFs and site
   both say George IV Bridge; the hint said W Parliament Sq.
2. **Model locations, not a single address:** `contact.locations[]` with
   `name/address/phone/verified`; the primary is the verified flagship.
3. **Never emit sentinels.** Omit a missing field; write the reason in prose.
4. **Normalise phones** (`0131 225 4021`) and dedupe variants.
5. **Strip social noise** (other businesses' handles, `policy.php` links).
6. **Capture booking URL** from the reserve flow if it resolves to a provider;
   otherwise leave it absent rather than guessing.

**Acceptance:** no `Not found`/`Unknown`; address and phone from a cited source;
every extra room listed as verified or "to confirm".

### 3.7 Guide contract — make the tables parse

The reader (`brand-docx.js`) is the contract; the writer must match it.

| Section | Table header to write | Read as |
|---|---|---|
| Applications | `Application | Sizes | Priority` | applications matrix |
| Print specification | `Item | Specification` | printSpec |
| Contact block | `Field | Value` | contact |
| Facts | `Fact | Detail` | facts |
| Type hierarchy | `Role | Typeface | Size | Notes` | typeHierarchy |
| Logo rules | `Rule | Specification` | logoRules |

Also: add `Positioning` as the first H1 paragraph, keep `brand-guide.json` as
the machine copy, and stop writing `Not found`. If the studio starts reading
`brand-guide.json` (3.10), the DOCX becomes purely human-facing and the contract
can relax.

### 3.8 Voice, tagline, group and hygiene

- **Voice:** infer 4–6 attributes and prefer/avoid lists from the site's own
  copy, menu language and review themes; **exclude demo blog posts** (Mia's
  "Quay"/"Royale" articles are theme filler).
- **Tagline:** extract from the hero/OG description; if absent, leave it empty
  rather than repeating the brand name.
- **Group:** write the cross-brand rules (shared paper/gold, distinct grounds,
  shared ownership) into the portfolio; keep brand order stable.
- **Hygiene:** keep the social dossier out of the brand kit (or under a clearly
  named `research/`), prune obsolete PDFs, resolve brand affinity for documents
  (three POMO PDFs sat under Mia), remove staging paths.

### 3.9 Provenance and rights

Every asset should carry `source_url`, `captured_at`, `rights: unverified|cleared`,
`hash`, `width`, `height`. This is a small JSON addition that makes the rights
question answerable per asset instead of per pack.

---

## 4. Studio changes

These are small, and three of them are the difference between "good pack" and
"good design".

### 4.1 P0 — template content

1. **`menuItems(brand)` uses `brand.content.menu`.** Replace the hard-coded
   HATCH/Physician branches and the scallops fallback with the same selection
   logic Asset Studio already uses (`asset-studio/app.js` `categoryDefaultText`):
   first three sections, up to ten lines, descriptions ≤70 characters. Keep the
   current dishes only as a last-resort fallback.
2. **`buildVoucher()` terms come from the brand or group.** Use
   `guidelines.facts` / a `voucherTerms` field, defaulting to neutral wording
   such as "Redeemable at {brand.name}. Valid for 12 months from purchase."
   Delete the Dalton sentence.
3. **Cover fallback:** if no `cover.*`, use the highest-scoring photograph; use
   the palette image only when there is no photography at all.
4. **Contact sanitisation on import:** drop values matching
   `not found|unknown|n/a|tbc|—`, map `locations[0]` to the card address, keep
   the rest as notes, and do not print an email row when none exists.
5. **Map handles, not URLs:** `contact.instagram` → `@lacasaedinburgh` for
   footers; keep the URL in a separate field.

### 4.2 P1 — pack intelligence

6. **Read `brand-guide.json`** and prefer it over the DOCX where present
   (type hierarchy, print spec, facts, logo rules, menus). The refinement writes
   both; the JSON is richer.
7. **Honour `typography.substitutes`** and validate families against loaded
   fonts; add the stand-ins to the shared kit (already partially done in
   `brandKitFor`).
8. **Extend the content schema**: `menus: { lunch, dessert, kids, christmas,
   takeaway }`, `allergens`, `bookingUrl`; use them for category defaults
   (lunch → menu, dessert → table card).
9. **Pack update/upsert by stable id**: `PUT /api/brand-packs/:id` that replaces
   files and metadata while preserving pack and brand ids, so improving a pack
   does not create a second group. Warn on duplicate brand ids/names/URLs across
   packs.
10. **Display provenance/version** in Brand identity ("refined-1 from run …")
    and a "quality" panel showing the acceptance checklist.

### 4.3 P2 — finishing

11. **Flyer body copy** from voice samples and content, not a hard-coded
    paragraph; if nothing is known, leave it neutral.
12. **Social tab**: surface the dossier (rating, themes, handles) as research —
    the data is already there.
13. **Asset library**: index pack files with rights flags; show orphaned status
    as today. Take the portfolio card title from the group/README instead of the
    hard-coded "Portfolio brand overview" (`brandFromDirectory()`).
14. **Localisation**: `locale`/`currency` are already read; use them for price
    formatting and date strings.

---

## 5. Gates: make the pipeline refuse to ship a thin pack

A pack should be audited before it is zipped, with a machine-readable report and
a non-zero exit when a **P0** check fails.

| Gate | Check | P0? |
|---|---|---|
| Palette | ≥4 entries, 0 platform signatures, one ground/ink/accent, ground→ink ≥4.5:1, ground→accent ≥2.4:1 | P0 |
| Typography | ≥2 real families, 0 icon fonts, 10 steps with the studio ids | P0 |
| Logos | ≥1 real logo ≥500 px (≥1200 px recommended for large format), 0 favicons/UI icons/photos | P0 |
| Photography | ≥3 print-capable, 0 cross-brand, cover ≥1600×1000 and ≠ photo 01 | P0 |
| Content | ≥1 menu with ≥10 priced items and ≥90% price-match, or explicit null + reason | P0 |
| Contact | address + phone + website, 0 sentinels, rooms modelled | P0 |
| Guide | the six tables parse with the real reader | P0 |
| Voice | ≥3 attributes, ≥5 prefer, ≥3 avoid, tagline present or explicitly absent | P1 |
| Group | one portfolio, stable brand ids, no staging paths, no social dossier in the kit | P1 |
| Rights | every asset has source + rights state | P2 |

Implementation: a `pack-audit` step at the end of `crawler-combined.py` (or a
separate Node script using `brand-docx.js` and the normalizers) that prints a
table and writes `audit.json` next to the kit. The refined-kit scripts in
`output/_refine/` are a working prototype for the palette, menu and guide
checks.

---

## 6. What stays human

Automation can get the pack to "correct". It cannot get it to "on brand" alone:

- **Brand affinity of photography.** The pool contains other brands' images;
  a visual check or a vision model is needed for the final call.
- **Hero and cover choice.** The best frame is a judgment about the room and the
  season.
- **Voice and tagline.** Attributes can be inferred; the sentence a brand would
  actually say cannot.
- **Namespace and naming.** "Le Bistrot – French Restaurant" vs "Le Bistrot";
  "LA CASA" vs "La Casa"; when to use the emblem vs the wordmark.
- **Rights and licensing.** No crawl can decide whether a photograph may be
  printed.
- **Resolving conflicts.** Two addresses, three phone numbers, a second room
  with no postcode: the pipeline should surface the conflict, a human decides.

The right division is: **the pipeline produces a complete, validated candidate
and flags every conflict; a designer makes the five judgment calls above and
signs the pack off.**

---

## 7. Metrics to track per drop

| Metric | This drop | Target |
|---|---:|---:|
| Brands import-ready (all P0 gates) | 0 / 4 | 4 / 4 |
| Palette entries from print/logo evidence | 0 / 56 (15 non-platform theme greys) | ≥95% |
| Icon fonts in kits | 8 | 0 |
| Brands with a real logo | 1 / 4 | 4 / 4 |
| Brands with ≥3 print-capable photos | 3 / 4 | 4 / 4 |
| Covers that are not photo 01 / palette | 0 / 4 | 4 / 4 |
| Menu items imported vs the 344 curated from the PDFs | 2 / 344 | ≥90% |
| Contact placeholders | 4 | 0 |
| Guide tables parsed (of 6) | 2 | 6 |
| Manual refinement time per brand | ~2–3 h | <30 min (review only) |

The last row is the real business metric: the refinement pass took a few hours
per brand because every step required reading the PDFs. Most of that work is
mechanical and belongs in the crawler.

---

## 8. Suggested rollout

| Drop | Ship | Why first |
|---|---|---|
| **N+1** | Content fix (3.1), palette evidence (3.2), type from PDFs (3.3), gate script (5) | Largest quality jump per line of code; fixes 3 of the 4 worst defects |
| **N+2** | Logo pool/PDF extraction (3.4), photography + cover rules (3.5), contact validation (3.6) | Completes the visual identity |
| **N+3** | Guide contract (3.7), voice/tagline (3.8), studio template fixes (4.1), pack update (4.2) | Makes the pack produce good designs, not just good data |
| **N+4** | Rights/provenance (3.9), content schema extension (4.2), quality panel (4.2) | Operational maturity |

Each drop should be measured against §7 and the acceptance checklist in the
review document. The refined kit in this run is the reference output for what
"good" looks like.
