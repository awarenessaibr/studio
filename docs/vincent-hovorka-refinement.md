# Vincent Hovorka refinement — from crawl output to a brand system

**Baseline** the imported pack reviewed in
[vincent-hovorka-review.md](vincent-hovorka-review.md)
**Refined in place** `data/brand-packs/vincent-hovorka-20261111070926-3fde/`
**Importable copy** `data/_crawler/runs/vincent-hovorka-20261111065755-6834/output/Vincent-Hovorka-brand-kit-refined.zip`
(99 files, 9.7 MB)
**Date** 11 November 2026
**Businesses** Vincent Hovorka · Business Breakthroughs · Borders Web

---

## 1. What "refined" means here

The crawl captured the raw material; this pass turns it into a brand system by
making four decisions explicit:

1. **Evidence over inference.** Every price, fact and claim comes from a page or
   PDF that travels in the pack. Where sources disagree, both are recorded.
2. **One identity per brand, stated once.** Every colour has a name and a role;
   every family has a job; every logo has a variant; every service has a source.
3. **No placeholders.** No `Not found`, no other business's logo, no invented
   review counts, no menu of scallops on a podcast.
4. **Honest gaps.** Where the crawl cannot know something, the field is blank
   and the reason is written down — not filled with a sentinel.

**Rules applied**

| Rule | Rationale |
|---|---|
| The business's own site and published PDF are the source of record | Anything else is inference |
| A price is either published or blank with "contact for pricing" | A guessed price is worse than no price |
| Gold is an ornament; a darker Antique Gold carries small text | `#c9a442` is 2.37:1 on white, below the studio's 2.4:1 accent bar |
| Logos are real artwork, vector where possible, named for the classifier | `logo-primary-wordmark` groups correctly in the identity panel |
| Derived artwork is labelled derived | The podcast and web-studio marks are studio lockups, not supplied assets |
| Photography is named for its subject and checked for print size | `photo-07.jpg` cannot be chosen confidently |
| Covers are 3:2 landscape at 1800 px+ | The gate card is the first impression |
| Menus cite a document and a page | A price without a source cannot be checked |

---

## 2. The three identities after refinement

### 2.1 Vincent Hovorka — white, ink and antique gold

| | |
|---|---|
| Wordmark | `VINCENT HOVORKA` with the VH monogram |
| Brand line | **Property · Business · Action** |
| Tagline | **Property partner. Keynote speaker.** |
| Ground | White `#FFFFFF` |
| Ink | Ink `#14111C` |
| Accent | Antique Gold `#8A6B14` (5.01:1); Gold `#C9A442` (2.37:1) for rules and display |
| Secondary | Navy `#232F43`, Blue `#1D476B`, Light Blue `#D4DDEC`, Muted `#74807D` |
| Type | Instrument Serif (display) · Inter (text) · Georgia stand-in |
| Logos | 6 cuts: wordmark/mark × primary/ink/white |
| Photography | 17: stage, property, portrait, book |
| Voice | Direct · Evidence-led · Operator-first · Warm but unsentimental · Transatlantic |
| Guides | 12 facts, 7 applications, 10 type rows, 5 logo rules, 6 print specs |

### 2.2 Business Breakthroughs — cream, night and gold

| | |
|---|---|
| Wordmark | `BUSINESS BREAKTHROUGHS` with the gold microphone mark |
| Brand line | **With Vincent Hovorka** |
| Tagline | **Real stories. Real numbers.** |
| Ground | Cream `#F9F7F2` |
| Ink | Night `#14111C` |
| Accent | Antique Gold `#8A6B14` (4.68:1); Gold `#C9A442` (2.21:1) for the mark |
| Secondary | Navy `#232F43`, Gold Light `#E8C96A`, Sage `#74807D`, Mist `#D4DDEC` |
| Type | Instrument Serif (display) · Inter (text) · Georgia stand-in |
| Logos | 5 cuts |
| Photography | 9: two stage frames and seven guest portraits |
| Voice | Founder-first · Curious · Numbers-led · Candid · Generous |
| Guides | 8 facts, 7 applications, 10 type rows, 5 logo rules, 6 print specs |

### 2.3 Borders Web — paper, ink and orange

| | |
|---|---|
| Wordmark | `Borders Web` with the W mark and the orange full stop |
| Brand line | **Built free. Looked after monthly.** |
| Tagline | **A new website for your business. Free.** |
| Ground | Paper `#F7F5F0` |
| Ink | Ink `#121316` |
| Accent | Accent `#FF5A1F` (2.86:1 — display, buttons, marks) |
| Secondary | Ink 2 `#2A2C31`, Muted `#5D6068`, Green `#1D5C4C`, Stone `#B5B0A5` |
| Type | Bricolage Grotesque (display) · Inter (text) · Helvetica Neue stand-in |
| Logos | 4 cuts |
| Photography | 10: six live-site screenshots and four credibility portraits |
| Voice | Plain-spoken · Local · Practical · Reassuring · No-jargon |
| Guides | 12 facts, 7 applications, 10 type rows, 5 logo rules, 6 print specs |

---

## 3. The catalogue: 9 menus, 67 items

The studio's content model was built for restaurants, so the `kind` list now
also accepts `services`, `products` and `topics`. That is the only model change
the content needed.

| Brand | Menu | Kind | Sections | Items | Published prices | Source |
|---|---|---|---:|---:|---|---|
| Vincent Hovorka | Property partnership | services | 3 | 10 | £31,000 profit (Durham), £60,000 expected (Scotland); partnerships quoted | `property-partners.md`, `homepage.md` |
| | Speaking | services | 3 | 12 | none — contact for pricing | `Vincent_Hovorka_Speaker_Sheet.pdf`, `speaking.md` |
| | Coaching & membership | services | 3 | 5 | £20 deposit; memberships quoted | `terms-and-coaching.md` |
| | Books & press kit | products | 1 | 3 | none — book sold via Amazon | `about-and-track-record.md` |
| Business Breakthroughs | Guest packages | services | 2 | 2 | Free / £49 | `guest-packages.md` |
| | Episode topics | topics | 3 | 6 | none — editorial catalogue | `episode-topics.md` |
| Borders Web | Website & care | services | 2 | 9 | £0, £39, £378 | `pricing.md` |
| | Extras | services | 1 | 4 | quoted | `pricing.md` |
| | Where I work | other | 2 | 16 | none — service area | `services-and-areas.md` |

**What a designer can now drag onto a canvas:** the property partnership as a
whole, each of its three sections, the ten individual services, the two deal
cases with their real figures, the four speaking formats, the six signature
talks, the two podcast packages, the six episode angles, the build and care
prices, the four extras and the sixteen towns.

**Price honesty.** 16 price tokens are checked against their sources; 0 are
missing. Blank prices are deliberate: speaking is "contact for pricing" on the
site; the memberships are "shown on the relevant page or in the proposal"; the
book is sold through Amazon in local currency. The one price that could have
been invented — a speaking fee — is left blank.

**Two menus are thinner than the rest, and say so.** The coaching menu exists
because the terms and privacy pages name and price those products, but the
offer pages themselves were not captured. The podcast has two products; the
menu template's five slots simply leave three empty rather than borrowing
another brand's dishes.

### Copy decks

Each brand also has an authored copy deck (`content.copy`): eyebrow, headline,
subhead, kicker, body, CTA, tag, a special/offer block, a menu title, voucher
terms, a business-card name/role and a campaign set. That is what fills the 13
generated templates — no other venue's sample text survives.

---

## 4. Logos

| Brand | Artwork | Source | Variants |
|---|---|---|---|
| Vincent Hovorka | VH monogram in `#E8C96A` on an ink tile, Instrument Serif wordmark, PROPERTY · BUSINESS · ACTION | The site's vector favicon (monogram) and the published speaker sheet (wordmark line) | primary, ink, white; wordmark and mark |
| Business Breakthroughs | Gold microphone-and-arrow mark, Instrument Serif wordmark, WITH VINCENT HOVORKA | The gold microphone on the podcast's 181 px card, redrawn as vector | primary, ink, white; wordmark and mark |
| Borders Web | Geometric W in an ink tile with an orange full stop, Bricolage Grotesque wordmark | The site's vector favicon | primary, white; wordmark and mark |

- **Real letterforms, not font references.** Every wordmark is outlined with
  `fontTools`, so the PNG and SVG render identically without the font
  installed.
- **Two deliverables per cut.** PNG for the studio's picker, SVG in
  `assets/logo-source/` for editing (and in the ZIP's `vectors/` folder).
- **Honest attribution.** The podcast and web-studio lockups are studio-derived
  and labelled as such in the guide and provenance. The Vincent Hovorka lockup
  reuses the site's own monogram. Replace with supplied artwork when it exists.
- **The wrong logo is gone.** The Business Catalyst Club file that the crawl
  filed as Vincent Hovorka's logo is not in the pack; its hash match is in the
  review.

---

## 5. Photography and covers

| Brand | Before | After |
|---|---|---|
| Vincent Hovorka | 12 unnamed images, including two toilet/bathroom shots and an empty room | 17 named images: 6 stage, 9 property (including two before/after cards), 1 portrait, 1 book; bathroom shots dropped |
| Business Breakthroughs | 3 images, one of which was a logo card | 9: hero interview, Charlie Sheen, 7 guest portraits |
| Borders Web | 12 images; half were duplicated stage shots from the other brand | 10: 6 live-site screenshots, 2 portraits, 2 stage frames |

Covers are now distinct and channel-appropriate:

- **Vincent Hovorka** — 1800 × 1200 stage frame, his name in lights.
- **Business Breakthroughs** — 1920 × 1280 LA interview with Charlie Sheen.
- **Borders Web** — a designed 2000 × 1333 cover: ink ground, the white
  wordmark, "A new website for your business. Free." and a browser mockup of a
  live client site. The old 900 × 1200 portrait of Vincent with Charlie Sheen
  was the wrong aspect and the wrong promise.

Hero filenames (`hero-*`) make `photoFor()` choose the intended frame instead of
whatever sorts first alphabetically.

**What is not print-capable:** the seven podcast guest portraits are 405 × 720
phone crops, the six Borders Web screenshots are 1200 × 750, and both are
documented as social-grade. The guides say so rather than letting a designer
discover it at 300 dpi.

---

## 6. Guides and portfolio

Each `*-Brand-Guide.docx` is rebuilt and parsed back with the real
`parseBrandDocx` on every apply, so the Word guide and `pack.json` cannot drift.
The guide now carries:

- a positioning paragraph written from the source, not the metadata;
- a 7-row applications matrix per brand (a speaker one-sheet and stage slide; a
  3000 × 3000 episode cover and 1080 × 1920 clips; a website hero and Google
  Business Profile cover);
- the canonical contact block with no placeholders;
- a 10-step type hierarchy with roles, families, sizes and notes;
- a colour table with rendered swatches and roles;
- five logo rules (clear space, minimum size, light/dark use, misuse);
- six print specifications, labelled recommendations;
- 8–12 facts with the source conflicts recorded;
- voice attributes, prefer/avoid;
- a photography inventory and a content inventory;
- provenance and rights notes.

The **portfolio overview** is rebuilt as a real group document: the three
businesses, what each sells, its price anchor, the shared visual language, the
things that must stay separate, the shared legal entities, and how to use the
pack. The invented review/follower/score table is gone.

The **palette strip and type specimen** are regenerated from the curated
palette and scale (they were still showing all 14 old colours and a
Helvetica specimen), and `pack.json` records their new dimensions.

---

## 7. Studio changes made along the way

| Change | File | Why |
|---|---|---|
| `services`, `products`, `topics` added to `MENU_KINDS` | `src/shared/brand-pack.js` | A service catalogue is not a food menu; `other` lost the distinction |
| `menuItems()` reads `content.menus` and accepts any number of real items | `src/shared/brand-pack.js` | It only read the legacy `content.menu` projection, and a 2-item podcast menu fell through to the scallops/beef fallback |
| Brand import copies `documents/*` | `server.js` | A re-imported ZIP lost every source document, leaving `content.documents[]` dangling |
| `verify-brand-sources.js` reads `.md`/`.txt` sources | `scripts/verify-brand-sources.js` | A service pack has page transcripts, not PDFs; the price check now runs on them |
| Menu register says "services, products and prices" for a service catalogue | `scripts/export-menu-register.js` | The venue wording was wrong for all three brands |
| New `apply-vincent-hovorka-refinement.js` | `scripts/` | Rebuilds `pack.json` + shared kits from the curated files with the import normalizers |

`node --test "tests/*.test.js"`: **321 pass, 1 fail**. The failure
(`tests/html-posts.test.js`, `happy-birthday.json` expects 1 layer, finds 65) is
pre-existing and unrelated to the brand work.

---

## 8. Verification

| Check | Result |
|---|---|
| Source verification (`verify-brand-sources.js`) | **27 / 27 checks passed**, 0 failed, 0 warnings; 16 price tokens checked |
| Menu register | 3 brands, 9 menus, 67 items, every menu with a source document |
| Generated templates | **39 / 39** build (13 × 3 brands); 135 image URLs checked, **0 missing** |
| Whole-pack normalise | 3 brands; palette 9/8/7; logos 6/5/4; photos 17/9/10; docs 6/2/3 |
| Shared kits | 3 rewritten to match (palette, fonts, logos) |
| Round-trip import of the refined ZIP | 3 brands, same counts **17/9/10 photos, 6/5/4 logos**, documents present, then the test pack and its kits were deleted |
| Office checker | 4 / 4 DOCX pass ZIP/XML integrity |
| Visual check | guides and portfolio rendered; logo headers, swatches, tables and page flow inspected |
| Studio test suite | 321 pass / 1 pre-existing fail |

**The design proof.** The generated `digital-menu-board`, `menu`, `table-card`,
`voucher`, `flyer`, `business-card-back`, social posts, stories and reels now
carry:

- Vincent Hovorka: "Property partnership", the flip/BRRR services, the Durham
  £31,000 profit case, the Kelso address and `team@vincenthovorka.com`.
- Business Breakthroughs: "Guest packages", Guest Feature (Free) and Amplify
  (£49), the podcast URL, the host name.
- Borders Web: "Website & care", Website build £0, care £39/£378, the phone,
  email and website.

No template prints `Not found`, the Business Catalyst logo or another brand's
dishes.

---

## 9. Residual gaps

1. **No licensed font binaries.** Instrument Serif, Inter and Bricolage
   Grotesque are named; Georgia and Helvetica Neue stand in and the mapping is
   recorded. Upload the real files and relink for exact typesetting.
2. **Two logos are studio-derived.** Business Breakthroughs and Borders Web
   need client approval or supplied artwork. The Vincent Hovorka lockup reuses
   the site's monogram but sets the name in a new arrangement.
3. **Print resolution.** Podcast guest portraits and Borders Web screenshots are
   social-grade; a print campaign needs a reshoot or higher-resolution files.
4. **Coaching prices are missing.** The offer pages were not crawled. The menu
   names the products and the £20 deposit, and says the rest is on application.
5. **Speaking fees are not published.** "Contact for pricing" is the honest
   answer; do not invent a day rate.
6. **Book price is local.** `The Operator Trap` is sold through Amazon; no price
   is carried.
7. **Source conflicts remain on the record.** 200+ vs 250+ stage hours; 85+ vs
   100+ deals; 85+ vs 86 episodes. Resolve with Vincent, then edit one line.
8. **Photography rights are unverified.** Every image is public, none is
   licensed. Provenance is `public / medium`; the library's per-file review
   state is still the place to clear them.
9. **Social intelligence is not usable for these brands.** The review and
   follower counts were crawler artefacts; they were removed from the pack and
   the guide rather than dressed up.
10. **The group has no separate group mark.** The portfolio uses the Vincent
    Hovorka wordmark, which is accurate for now but not a family logo.

---

## 10. Files produced

```
data/brand-packs/vincent-hovorka-20261111070926-3fde/
├── pack.json                                    refined manifest
└── files/
    ├── portfolio/{Vincent-Hovorka-Overview.docx, portfolio.json}
    ├── vincenthovorka/
    │   ├── vincenthovorka-Brand-Guide.docx      rebuilt
    │   ├── tokens/, content/, documents/ (6)
    │   ├── cover.jpg
    │   └── assets/{logos (6 PNG), logo-source (6 SVG), colors, type, photography (17)}
    ├── businessbreakthroughs-vincenthovorka/    same shape, 5 logos / 9 photos / 2 docs
    └── bordersweb/                              same shape, 4 logos / 10 photos / 3 docs

data/brand-kits/vincent-hovorka-*.json           three shared kits rewritten

data/_crawler/runs/vincent-hovorka-…/output/
├── Vincent-Hovorka-brand-kit-refined.zip        importable copy, 99 files
└── _refine/
    ├── inventory.json                           before / after metrics
    ├── backup/                                  original pack.json + files
    ├── kit/                                     staged refined kit
    └── 9 script / report artefacts

scripts/apply-vincent-hovorka-refinement.js     rebuilds pack.json + kits
docs/vincent-hovorka-review.md                  intake audit
docs/vincent-hovorka-refinement.md              this document
deliverables/vincent-hovorka/
├── menus-and-services.md                        the catalogue, per brand
└── source-verification.md                       27 checks, per brand
```

## Appendix — how the work was validated

- **Palette:** WCAG contrast computed for every ground/ink/accent trio; the
  accent had to clear 2.4:1, which is why Antique Gold exists.
- **Type:** outlined wordmarks rendered through Chrome at 2× and inspected on
  light grounds; the specimen is rendered from the real TTFs.
- **Docs:** `parseBrandDocx` round-trip on every apply; the office checker for
  package integrity; LibreOffice render for layout.
- **Content:** `normalizeContent` + `contentAssets` for every brand; the menu
  register and the source verifier for prices.
- **Assets:** every generated template's image URL resolved to a file on disk;
  the refined ZIP imported through the real `createBrandPackImport` and deleted
  afterwards.
