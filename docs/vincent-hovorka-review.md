# Vincent Hovorka brand intake review

**Reviewed** `data/brand-packs/vincent-hovorka-20261111070926-3fde/` (imported
11 November 2026) against its crawl
`data/_crawler/runs/vincent-hovorka-20261111065755-6834/`
**Businesses** Vincent Hovorka (property investment and speaking), Business
Breakthroughs (podcast), Borders Web (websites)
**Verdict** the crawl is rich; the pack is thin. Three of three brands import,
none is design-ready without curation.
**Follow-up** the refined pack and the decisions behind it are in
[vincent-hovorka-refinement.md](vincent-hovorka-refinement.md).

---

## 1. What the intake got right

- **The right three businesses and the right URLs.** The group is coherent: one
  operator, three offers, one shared contact.
- **A useful palette starting point.** Every brand's page colours were captured
  with RGB, CMYK, share, tier and a role; the crawler even found the dark gold
  (`#8a6b14`) that would become the accessible accent.
- **Real type evidence.** Instrument Serif + Inter for Vincent Hovorka and the
  podcast; Bricolage Grotesque + Inter for Borders Web. These match the sites.
- **Good raw photography for two brands.** The stage archive (Museo Ferrari,
  Lamborghini, MEGA SUCCESS, Charlie Sheen) and the Duns/Selkirk refurbishment
  set are genuinely usable.
- **The source PDF nobody used.** The crawl downloaded
  `Vincent_Hovorka_Speaker_Sheet.pdf` (2 pages) but the pack did not carry it.
- **The site copy is unusually specific** — prices, deal figures, package
  inclusions, terms — which is why an honest catalogue is possible at all.

## 2. What the intake got wrong

### Blocking defects

| # | Defect | Evidence |
|---|---|---|
| 1 | **The only Vincent Hovorka logo is another business's logo.** | `files/vincenthovorka/assets/logos/logo-primary-0.png` is byte-identical to `Business-Catalyst-Club-Logo.png` (SHA-256 `20de606b…`). A generated card would carry a third-party mark. |
| 2 | **Business Breakthroughs and Borders Web have no logo at all.** | `brands[].logos` is `[]` for both. |
| 3 | **No content anywhere.** | `brand.content` is `null` for the podcast and Borders Web, and only a stray `bookingUrl` for Vincent Hovorka. The Menus tab is empty; menu designs print generic dishes. |
| 4 | **The stray booking URL points at a different coach.** | `https://www.facebook.com/deborahfryercoaching` — unrelated to any of the three businesses. |
| 5 | **No documents.** | `files/*/documents/` did not exist even though the crawl downloaded a speaker sheet. Nothing in the pack can be checked against its source. |
| 6 | **The guide prints `Email: Not found`** for two brands and `Address: Not found` for the podcast. | The contact table is fed straight into card backs. |
| 7 | **The portfolio table invents authority.** | `Reviews 144` (podcast), `25` (Borders Web), `Followers 7,472 / 6,622` and a `Score` column. These are crawler artefacts, not business facts, and they were presented as the group's benchmark. |
| 8 | **The guide claims a food-hygiene rating of 5** for a property investor. | The crawler's hospitality template bled into a non-hospitality brand. |

### Quality defects

| # | Defect | Effect |
|---|---|---|
| 9 | **Palettes carry platform junk.** | Vincent Hovorka has 14 entries, six of them unnamed hex keys (`#4A5568`, `#1F8A4C`, `#8A6B14`, `#A8862C`, `#F87171`). Nothing names which gold is which. |
| 10 | **Typography is a CSS sample, not a scale.** | Five steps (`display/h1/h2/body/caption`) from observed sizes, no studio ids, so `fontFor()` falls back for heading/label roles. |
| 11 | **Voice is empty.** | Zero attributes, zero prefer/avoid for all three brands; the guide has nothing to write with. |
| 12 | **Taglines are empty.** | The three most useful lines in the source — "Real deals. Real numbers.", "Real stories. Real numbers.", "A new website for your business. Free." — were not captured. |
| 13 | **The applications matrix is the same restaurant template everywhere.** | `business-card 90x55`, `social-posts`, `a-board` for a speaker, a podcast and a web studio. A speaker needs a one-sheet; a podcast needs 3000 × 3000 cover art. |
| 14 | **Photography is uncategorised.** | Vincent Hovorka's pool includes two toilet/bathroom shots; the podcast's third "photo" is a logo card; Borders Web's pool is website screenshots plus duplicated stage shots. Filenames are `photo-01…12`, so nothing is findable. |
| 15 | **The Borders Web cover is a 900 × 1200 portrait** of Vincent and Charlie Sheen — the wrong aspect and the wrong message for a web studio. | The gate card crops it badly. |
| 16 | **The social dossier is unusable for these businesses.** | Review counts are not real; a podcast does not have 144 Google reviews. Social data was correctly dropped from `brand.social`, but the numbers still reached the guide. |
| 17 | **Guide sections are boilerplate.** | "Keep clear space around the mark; exact measurement is not known", "No menu or hours data extracted", "Asset rights and licensing were not verified". True, but not a guide. |

## 3. What the studio could not do with it

| Studio surface | Result on the imported pack |
|---|---|
| Brand identity → Identity | One wrong logo; 14 swatches including junk; 5-step type scale; no voice |
| Brand identity → Templates | 13 templates per brand generate, but from generic copy and, for two brands, no logo |
| Brand identity → Guidelines | Applications tables all say `business-card / social-posts / a-board`; contact prints `Not found` |
| Agent Studio → Menus | No menus, so no Menus tab |
| Asset Studio → Menu source | Empty; designs fall back to another brand's dishes |
| Asset Studio → Menu item / post ideas | No items to pick |
| Library | No documents to index |

## 4. What the source material actually supports

The crawl is more than enough for a real catalogue. The three businesses sell:

| Brand | Services / products found | Published prices |
|---|---|---|
| Vincent Hovorka | Property partnerships (flip, BRRR), speaking (keynote, workshop, masterclass, virtual), six signature talks, Pitch Me a Deal membership, one-to-one coaching, events, the book, the speaker one-sheet, the press kit | Pitch Me a Deal deposit **£20**; speaking and partnerships **contact for pricing**; book sold via Amazon |
| Business Breakthroughs | Guest Feature (free, by application), Amplify | **Free** / **£49** per episode |
| Borders Web | Website build, care plan (monthly/yearly), booking, shop, extra pages, photography, service area | **£0** build; **£39** a month; **£378** a year |

The figures that make the catalogue credible are all quoted in the sources: the
County Durham flip (£22,000 in, £104,000 out, £31,000 profit), 12 South Street
Duns (£85,000 bought, £190,000 surveyed), the in-progress Scotland flip
(£140,000 in, £60,000 expected), 86 podcast episodes, 6 live sites in the
Borders Web portfolio.

## 5. Three conflicts the pack must not smooth over

1. **Stage hours: 200+ or 250+?** The speaker sheet says 200+; the website says
   250+. Both are recorded; use 200+ where a conservative claim is needed.
2. **Property deals: 85+ or 100+?** The About page says 85+ closed; the Borders
   Web page says 100+ property deals. The pack records both rather than
   averaging them.
3. **Episodes: 85+ or 86?** The site markets 85+; the all-episodes page lists
   86. The pack says 86 with the date of the count.

## 6. Priority list

| Priority | Action |
|---|---|
| P0 | Replace the wrong logo; give each brand a real lockup |
| P0 | Write the content files: services, products, prices, sources |
| P0 | Carry documents so every price is checkable |
| P1 | Curate palettes, build a 10-step scale, write voice and taglines |
| P1 | Curate photography, name it, replace the Borders Web cover |
| P1 | Rewrite the guides: applications, contact, facts, type, logo rules, print spec |
| P2 | Rebuild the portfolio without the invented review/follower table |
| P2 | Fix the studio gaps that block service catalogues (menu kinds, menu item source, documents on import) |
