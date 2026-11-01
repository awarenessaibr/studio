# Cawley Hotels — Asset Studio brief

**Status:** the Cawley Hotels pack is imported as the third Asset Studio group,
alongside Monteleone Group and Dalton family venues. It has five venue brands,
the Cawley type profile, brand-specific copy, and a verified CMYK print pack.

This is the hand-off list for the remaining brand assets. The app is usable now;
the items below are what makes the Cawley group print-ready and properly
differentiated from the other groups.

---

## 1. What is already in place

- **Five venue brands**
  - Boardwalk — restaurant, carvery & bar, Falkirk
  - The Boat Yard — restaurant, carvery & lounge, Lochwinnoch
  - Coast Bar & Restaurant — bar & restaurant, Langbank
  - Duck Bay Hotel & Cottages — hotel, cottages & restaurant, Loch Lomond
  - River House — restaurant & bar, Stirling
- **Assets in the imported pack**: three photographs and four logo cuts per
  venue, plus the colour plate, type specimen and cover; the full Word guides
  and the Cawley Group portfolio overview.
- **Fonts uploaded**: Mulish, Mulish Italic and Frank Ruhl Libre (SIL OFL). The
  studio applies the Cawley type profile: title fields are set in uppercase
  **Mulish 700**, matching the brand guides, while body copy uses Mulish 400.
- **Brand copy pass**: venue descriptor, tagline, body, menu/drinks list,
  voucher terms, Christmas copy and contact details are brand-specific in
  `asset-studio/app.js` (`BRAND_COPY`).
- **Palette and contrast**: the studio uses the brand's ink/charcoal on aqua
  and cyan rather than replicating the white-on-light failures. Accent-flooded
  vouchers, cards and socials choose a contrasting text colour automatically.
- **Motifs**: arch for Boardwalk and River House, wave for The Boat Yard, Coast
  and Duck Bay; the Christmas sprig voucher keeps its seasonal sprig. The
  medical rod from the extracted layouts is not used for Cawley.
- **Print pack**: CMYK PDF, bleed/trim boxes, crop marks/slug, safe-zone check.
  Verified on a Boardwalk A4 flyer at 150 dpi (CMYK, 4-component, safe).
- **Group access**: the gate has Cawley / Monteleone / Dalton tabs; the top-bar
  group selector switches groups; the last brand per group is remembered; saved
  assets restore across groups.

---

## 2. What I need from you

### Priority 1 — Confirm the group and masterbrand

The studio group is labelled **Cawley Hotels**; the documents call it **The
Cawley Group**. The group mark (`cawley-wordmark-black/white/cyan.png`) lives in
`00-portfolio/assets`, but the studio currently has **five venue cards**, not a
sixth Cawley masterbrand card.

**Please confirm:**
1. The group label: Cawley Hotels or The Cawley Group?
2. Whether the Cawley masterbrand should become a sixth designable identity in
   the studio, or stay as the group layer. A sixth card would need group tokens
   and a short guide; the portfolio overview is not a venue brand guide.

### Priority 2 — SVG masters and small-size cuts

All six marks are **raster PNGs**. The shared letterform family — a geometric
sans with a notch cut through the curved letters — is not a webfont and has not
been redrawn. The studio displays the wordmarks at about 34–40 px, where the
known weaknesses show.

| Mark | What exists | What is needed |
|---|---|---|
| Boardwalk | Striped wordmark, 3 colour cuts | A **solid small-size cut**; the stripe fills in below about 220 px |
| The Boat Yard | Wordmark + hand-drawn gull, 3 cuts | A **gull-less small-size cut**; the gull disappears below about 120 px |
| Coast | Solid wide wordmark, 3 cuts | Keep the **ink** cut as primary on aqua; confirm white cut use |
| Duck Bay | Solid wide wordmark, 3 cuts | SVG master and a small-size cut |
| River House | Letterspaced wordmark, 3 cuts | SVG master and a compact cut |
| Cawley | Group wordmark, black/white/cyan | SVG master; decide if it becomes a sixth card |

Preferred formats: **SVG** (primary), plus AI/EPS/PDF. Variants: colour, ink,
white/cream; transparent; clear space and minimum sizes from the guides.

### Priority 3 — High-resolution photography

The pack has **three photographs per venue**, all web-sized:

| Brand | Files and pixels |
|---|---|
| Boardwalk | interior 1500×844; breakfast 1200×800; bar 1500×319 |
| The Boat Yard | terrace 1500×1125; carvery 1200×800; restaurant 1500×844 |
| Coast | window 1500×689; exterior 1500×1000; dish 1500×450 |
| Duck Bay | cottage 1000×667; bobbys 1500×337; cottages exterior 1000×667 |
| River House | interior 1500×934; bar 1500×922; lounge 1500×742 |

The wide 319–450 px strips are useful for site bands but not for full-bleed A4.
Please supply high-resolution originals or approve AI-generated replacements
using §3. Target **300 dpi at final size**: about 2480×3508 px for A4 and
3508×4961 px for A3, plus 3 mm bleed.

### Priority 4 — Print typography

The web face is **Mulish**; print is a different pair:

| Use | Web / in the app | Print per the guides |
|---|---|---|
| Headings / menus | Mulish 700 uppercase | **Futura** |
| Editorial | Mulish 400 | **Baskerville** |
| Festive | — | **Bickham Script Pro** |
| Duck Bay script accent | Bright Gesture / Georgia (not applied) | Bright Gesture |

Futura, Baskerville and Bickham Script are commercial and are **not included**.
Please confirm the print pair and provide licensed files if the studio should
render print-accurate type. The current app uses the OFL Mulish files and the
Cawley type profile; Frank Ruhl Libre is documented but not used by the web
tokens.

### Priority 5 — Contrast at source and second colours

The guides record two failures:

- **Coast:** white on aqua `#98D6D7` = **1.62:1** — fails at every size.
- **Duck Bay:** white on cyan `#5CB8D0` = **2.28:1** — fails.

The Asset Studio avoids both by choosing ink/charcoal on the light primaries and
by using the accent text helper on accent backgrounds. The **websites, menus and
signage still need the source fix**: either set type in ink or darken the
primaries to 4.5:1 against white.

The portfolio also recommends a second colour per venue. The app currently uses
the existing palettes (Cawley grey, sky, charcoal, loch brown, aqua, lilac,
stone). If you add new accent colours, send the HEX/CMYK values and we add them
to the packs.

### Priority 6 — Copy and contact approval

`BRAND_COPY` in `asset-studio/app.js` supplies Cawley defaults. Please approve or
replace:

- The menu/drinks lists. They are neutral first-pass content: Boardwalk
  breakfast/carvery/all day; Boat Yard carvery/classics/Bobby's Lounge; Coast
  riverside/mains/drinks; Duck Bay lochside/afternoon tea/dinner; River House
  starters/mains/Bobby's.
- The Christmas copy: “Christmas at …”, “Available throughout December”,
  “Festive menus available”. No dates or prices are invented.
- The email field. All five contact tables say **“Enquiries via the site form”**
  and none publish a direct email. The business-card back will print that
  phrase. Confirm or provide direct addresses.
- The social fields. Instagram and Facebook are blank for all five; the studio
  hides the handle line. Confirm or provide handles.
- The venue phone numbers and addresses as printed in the contact blocks.
- The **Bobby's** sub-brand. The guides mention a Bobby's lockup as a missing
  piece for River House (and a Bobby's Lounge menu at The Boat Yard). Decide
  whether it needs its own lockup.
- The group name and the Cawley masterbrand decision in Priority 1.

### Priority 7 — Print specification

Confirm final sizes, bleed and safe margin per category, and whether the printer
requires **PDF/X-1a or PDF/X-4 with an ICC output intent**. The current print
pack is a direct RGB→CMYK conversion with trim/bleed boxes and crop marks; it is
**not PDF/X-certified** and embeds no ICC profile. The CMYK values in the guides
are screen conversions and must be proofed.

### Priority 8 — Templates

The five venues reuse the same 25 brand-aware layouts. If you want bespoke
Cawley layouts (the guides describe Futura/Baskerville menus, wedding brochures,
funeral packs, private-dining cards), send reference boards. No new HTML is
needed for a new group; another pack import appears in the group tabs
automatically.

---

## 3. AI image prompts

Use a photorealistic editorial style, no text, no logos and no watermarks. The
app overlays type separately. Generate **4:5 portrait** for flyers/social and
**3:2 landscape** for wide photo bands; deliver originals at 300 dpi.

Add this negative prompt to all of them:

> no text, no logos, no watermark, no captions, no distorted hands, no plastic
> food, no oversaturated colours, no stock-photo smiles, no HDR halos, no
> fisheye, no illustration

### Boardwalk — Falkirk

Teal `#055768`, Cawley grey `#A5B0B7`, ink `#212529`, paper `#FFFFFF`. All-day
dining beside the Falkirk Wheel; family-friendly; carvery; terraces; bright,
roomy, modern.

**B1 — All-day restaurant hero (3:2)**
> Editorial interior photograph of a bright, modern all-day restaurant beside
> the Falkirk Wheel in Scotland. Deep teal accents, pale oak tables, soft grey
> upholstery, large windows, a carvery counter in the middle distance, families
> and a few couples, a wall of dimensional lettering without readable letters,
> plants, polished concrete, daylight. Warm, roomy, unshowy. 35mm film, natural
> grain, no text or logos.

**B2 — Sunday carvery (4:5)**
> Close editorial food photograph of a Sunday carvery plate: sliced roast beef,
> Yorkshire pudding, roast potatoes, carrots, greens and gravy on a white plate,
> a teal linen napkin, a glass of red, a pale oak table, soft window light.
> Generous, home-cooked, not fine-dining. 4:5 portrait, natural grain, no text.

**B3 — Puddings / afternoon tea (4:5)**
> Overhead editorial photograph of a shared pudding board and afternoon tea:
> sticky toffee pudding, chocolate cake, scones, clotted cream, berries, a pot
> of tea, pale grey linen and a teal napkin. Bright, generous, family-style,
> soft daylight, natural texture, negative space at the top. No hands, no text.

**B4 — Falkirk Wheel terraces (3:2)**
> Architectural photograph of a contemporary Scottish restaurant terrace beside
> the Falkirk Wheel at golden hour. Teal awnings, pale oak furniture, planters,
> the wheel and canal in the background, warm interior lights, a few empty
> tables. Calm, spacious, editorial travel photography, 35mm, natural grain. No
> readable signage.

### The Boat Yard — Lochwinnoch

Boat Yard blue `#3369B1`, sky `#5BB0E3`, Cawley grey, ink, paper. Country
restaurant overlooking Castle Semple; carvery, sun room, terrace, Bobby's
Lounge; relaxed, neighbourly.

**Y1 — Terrace and Castle Semple (3:2)**
> Editorial photograph of a country restaurant terrace overlooking Castle Semple
> and the Renfrewshire countryside. Pale timber tables, blue-grey cushions,
> planters, a glass of white wine, distant water and hills, soft Scottish
> daylight, a few empty chairs. Relaxed, panoramic, unpretentious. 35mm film,
> natural grain, no text or logos.

**Y2 — Weekend carvery (4:5)**
> Close editorial food photograph of a weekend carvery plate: roast pork with
> crackling, Yorkshire pudding, roast potatoes, greens, apple sauce, on a white
> plate with a blue linen napkin, pale wood table, soft daylight. Generous,
> traditional, well-made. 4:5 portrait, natural grain, no text.

**Y3 — Sun room / lounge (3:2)**
> Editorial interior photograph of a country restaurant sun room and lounge.
> Blue-grey walls, pale wood, wicker chairs, large windows onto green fields, a
> low table with coffee cups and a newspaper, a small bar in the background.
> Warm, neighbourly, comfortable, daylight, 35mm film. No people looking at
> camera, no text.

**Y4 — Exterior fascia (3:2)**
> Daylight exterior photograph of a Scottish country restaurant on the edge of
> Lochwinnoch. Blue fascia without readable letters, pale stone, a terrace,
> planters, a few cars, green fields and Castle Semple in the distance. Honest,
> local, editorial travel photography, 35mm, natural grain. No text or logos.

### Coast — Langbank

Coast aqua `#98D6D7`, charcoal `#3D3E3E`, Cawley grey, paper. Riverside
restaurant on the Clyde; nautical room; extensive menu from ten; one of the best
views in Inverclyde; relaxed luxury.

**C1 — Riverside interior (3:2)**
> Editorial interior photograph of a riverside restaurant on the Clyde at
> Langbank. Charcoal walls, aqua accents, pale wood tables, leather banquettes,
> large windows onto the water, a nautical detail or two, soft daylight, a few
> empty tables set with glassware. Relaxed luxury, not a seafood shack. 35mm
> film, natural grain, no text or logos.

**C2 — Dish (4:5)**
> Close editorial food photograph of a riverside restaurant plate: seared fish,
> seasonal greens, crushed potatoes, a lemon butter sauce, on a white plate with
> a charcoal linen napkin, pale wood table, soft window light, the river blurred
> behind. Refined but relaxed. 4:5 portrait, natural grain, no text.

**C3 — Terrace and Clyde (3:2)**
> Editorial photograph of a riverside terrace on the Clyde. Aqua and charcoal
> furniture, a glass of white wine, a small plate, the water and far shore in
> soft focus, late-afternoon Scottish light. Calm, expansive, relaxed luxury.
> 35mm film, natural grain, no text or logos.

**C4 — Building exterior (3:2)**
> Daylight exterior photograph of a contemporary riverside restaurant building
> at Langbank. Aqua and charcoal cladding, large windows, a terrace, water
> beyond, green shrubs, soft cloud. Clean, nautical, editorial architecture
> photography, 35mm, natural grain. No readable signage or text.

### Duck Bay — Loch Lomond

Duck Bay cyan `#5CB8D0`, loch brown `#673511`, ink, paper, lilac, stone. Hotel,
cottages and restaurant on Loch Lomond since 1985; lochside luxury; afternoon
tea, weddings, hot tubs, Ben Lomond.

**D1 — Lochside hotel hero (3:2)**
> Editorial photograph of a family-run hotel on the banks of Loch Lomond, with
> Ben Lomond beyond. Pale stone, cyan accents, lawns, a terrace, a few guests
> walking, still water, soft Scottish light. Lochside luxury without gloss,
> 35mm film, natural grain, space at the top for a headline. No text or logos.

**D2 — Cottage hot tub (4:5)**
> Editorial photograph of a self-catering cottage deck at Loch Lomond: a private
> hot tub, pale timber, a bottle of wine and two glasses, towels, the loch and
> hills beyond, late-afternoon light. Private, warm, occasion-ready, 35mm film,
> natural grain. No people, no text.

**D3 — Afternoon tea / wedding table (4:5)**
> Editorial photograph of an afternoon tea or small wedding table overlooking
> Loch Lomond. Cream linen, cake stand, scones, delicate cakes, champagne
> flutes, soft candlesticks, a window with water beyond. Romantic but unfussy,
> soft daylight, natural texture, 4:5 portrait. No text or logos.

**D4 — Loch view / restaurant (3:2)**
> Editorial interior photograph of a lochside hotel restaurant. Warm wood,
> cream and cyan accents, tables set with glassware, a wall of windows onto Loch
> Lomond and Ben Lomond, soft late-afternoon light. Calm, generous, family-run
> luxury, 35mm film, natural grain. No people looking at camera, no text.

### River House — Stirling

River blue `#0071AB`, aqua `#97D6D6`, ink, paper. Restaurant and bar above a
loch, Stirling Castle in the view, private dining for twelve, Bobby's bar after
dark; elevated, occasion-ready.

**R1 — Castle-view restaurant (3:2)**
> Editorial interior photograph of a contemporary Stirling restaurant with a
> view to Stirling Castle. Deep blue accents, pale wood, soft grey upholstery,
> tables set with wine glasses, large windows, late-afternoon light, a hint of
> blossom. Elevated, calm, occasion-ready. 35mm film, natural grain, space at the
> top for a headline. No text or logos.

**R2 — Private dining (4:5)**
> Editorial photograph of a private dining room for twelve. A long pale table,
> blue-grey chairs, low candles, glassware, a window with a castle or loch view,
> warm evening light. Intimate, celebratory, not formal. 4:5 portrait, natural
> grain. No people, no text.

**R3 — Bobby's cocktails (4:5)**
> Close editorial photograph of a cocktail on a dark bar top at Bobby's: a coupe
> glass, a twist, a small bowl of olives, a candle, deep blue and aqua
> reflections, bokeh, late-night mood. Grown-up, playful, a little theatrical.
> 4:5 portrait, 35mm film, grain. No text, no logos, no hands.

**R4 — Blossom interior / bar (3:2)**
> Editorial interior photograph of a contemporary restaurant and bar in
> Stirling in spring: a blossom tree in the room, deep blue walls, pale wood,
> velvet seating, a bar with bottles and glassware, soft daylight, a few empty
> tables. Elevated but relaxed, 35mm film, natural grain. No people looking at
> camera, no text.

### Cawley masterbrand (optional)

**G1 — Family hospitality (3:2)**
> Editorial photograph of a warm Scottish family-run hospitality scene: a
> welcoming table by a loch or a fireside, a few generations arriving, coats and
> glasses, a sense of five different places under one family. No logos or
> readable text, natural light, 35mm film, grain. Use only if the Cawley
> masterbrand becomes a sixth card.

---

## 4. Logo brief (for a designer, not AI)

- **Cawley** — masterbrand lockup: CAWLEY with HOTELS & RESTAURANTS beneath, in
  the shared geometric letterforms. Black, white, cyan. SVG.
- **Boardwalk** — keep the striped inline wordmark for large sizes; draw a solid
  small-size cut and a one-colour cut. SVG.
- **The Boat Yard** — keep the gull for large sizes; draw a gull-less small-size
  cut; a stacked lockup. SVG.
- **Coast** — solid wide wordmark; ink is primary on aqua; white is only for
  dark grounds. SVG.
- **Duck Bay** — solid wide wordmark; a compact cut for small sizes. SVG.
- **River House** — letterspaced wordmark; a compact cut. SVG.
- **Bobby's** — decide if it is a sub-brand; if yes, a lockup that can sit with
  River House and The Boat Yard without becoming a fourth mark.
- All: transparent SVG/AI/EPS/PDF, colour/ink/white variants, clear space and
  minimum sizes, no effects.

---

## 5. Asset checklist before sign-off

- [ ] Group label confirmed (Cawley Hotels / The Cawley Group).
- [ ] Cawley masterbrand card decision.
- [ ] SVG masters for all six marks.
- [ ] Boardwalk solid small-size cut.
- [ ] Boat Yard gull-less small-size cut.
- [ ] Coast ink/white usage approved.
- [ ] Duck Bay and River House compact cuts.
- [ ] High-resolution photography (300 dpi at final size) or approved AI images.
- [ ] Print type decision: Futura/Baskerville/Bickham Script licences, or Mulish.
- [ ] Contrast fix at source for Coast and Duck Bay.
- [ ] Second colours per venue (or confirm the current palettes).
- [ ] Menu/drinks/Christmas copy approved.
- [ ] Direct emails and social handles, or confirm site-form/blank.
- [ ] Bobby's sub-brand decision.
- [ ] Print spec: bleed, safe margin, ICC/PDF-X.
- [ ] Final visual review of each category × venue.

---

## 6. How the group model works

- Every imported pack is a **group** in the Asset Studio.
- The gate has group tabs; the top-bar group selector switches groups.
- The last brand used in each group is remembered.
- Saved assets record their group/brand and restore across groups.
- A new group later is another pack import; the tabs and selector pick it up.
- The shared design engine means all groups reuse the same 25 layouts, with
  brand data, fonts, logos, photos and copy substituted.

---

## 7. Current implementation notes

- Pack: `data/brand-packs/cawley-hotels-20261031152439-d04d/`
- Shared kits: `data/brand-kits/cawley-hotels-*`
- The pack and fonts live in the local `data` store (gitignored), the same
  pattern as Monteleone and Dalton.
- Fonts: `data/fonts/` (Mulish, Mulish Italic, Frank Ruhl Libre; OFL)
- Brand copy: `asset-studio/app.js` → `BRAND_COPY`
- Cawley type profile: `asset-studio/engine.js` (`typeProfile === 'cawley'`)
- Cawley motifs: arch / wave; Christmas sprig preserved
- Palette/contrast helper: `accentTextColor` in `asset-studio/engine.js`
- Print pack: `asset-studio/print.js`
- The app defaults to the newest group (Cawley); switch from the gate tabs or the
  top-bar selector.

If the source pack is re-imported under a new name, brand IDs can change and
browser-saved assets that reference the old IDs will not restore. Export any
assets you need to keep before replacing a pack.
