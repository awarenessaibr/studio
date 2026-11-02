# Monteleone Group — Asset Studio brief

**Status:** the Monteleone Group pack is imported and the Asset Studio now treats
each brand pack as a **brand group**. Dalton family venues and Monteleone Group
are both available in the same UI, with a group filter and a remembered last
brand per group.

This document is the hand-off list for the remaining brand assets. The app is
usable now; the items below are what turns it from a strong first pass into a
finished print-ready system.

---

## 1. What is already in place

- **Three Monteleone brands**
  - The Butterfly and the Pig
  - The Marlborough
  - The Singl-end
- **Pack data**: names, taglines, wordmarks, URLs, palettes, typography, voice,
  guidelines, contact blocks, facts, applications and the Word guides.
- **Assets already in the imported pack**
  - The Butterfly: 4 photographs + 5 logo cuts (pig/butterfly marks and plate).
  - The Marlborough: 4 photographs + 5 logo cuts (MH marks and plate).
  - The Singl-end: 4 photographs + 4 logo cuts (white/navy wordmarks, badge, plate).
- **Fonts uploaded** to the local font store (`data/fonts`):
  Alegreya, IM Fell Great Primer Regular/Italic, Bebas Neue, Caprasimo,
  Playfair Display and the Open Sans variable font. These are OFL files from the
  source kit and now render in the Type panel.
- **Shared design engine**: the same 25 designs across 6 categories are reused
  for every group. No separate HTML per group is needed. The brand palette,
  type, logo, photography, copy and QR are substituted at render time.
- **Monteleone default copy pass**: headlines/taglines, body copy, menu/drinks
  lists and business-card contact details are pre-filled in
  `asset-studio/app.js` (`BRAND_COPY`), using the guides and the site captures.
- **Group access**:
  - The brand gate has group tabs (Monteleone Group / Dalton family venues).
  - The topbar group selector switches groups while working.
  - The last brand used per group is remembered.
  - Saved assets restore across groups.
- **Print pack**: CMYK PDF, bleed/trim boxes, crop marks/slug, safe-zone check,
  multi-page business cards. Works for Monteleone.

---

## 2. What I need from you

### Priority 1 — Confirm the source of truth

The source folder at
`/Users/leandrodisconzi/repos/JulieDalton/Monteleone/monteleone-brand-kit/`
contains the README, tokens, Word guides and covers, but the per-brand
`assets/logos`, `assets/photography`, `assets/colors` and `assets/type` folders
are **not present** in that copy.

The imported pack in `data/brand-packs/monteleone-group-…` **does** contain
those assets (4 photos and the logo cuts per brand), probably from the richer
version used for the first import.

**Please confirm:** is the imported pack the canonical source, or should the
source folder be restored to match it? If you will keep editing the source
folder, put the assets back there and we re-import from that one folder.

### Priority 2 — Logo masters

The app currently uses a **typographic wordmark** in the brand display font when
a brand has no clean wordmark asset:

- The Butterfly and the Pig — set in Alegreya, lowercase.
- The Marlborough — set in Bebas Neue, uppercase-ish.
- The Singl-end — uses the existing wordmark image.

Please provide vector masters:

| Brand | What exists | What is missing |
|---|---|---|
| The Butterfly and the Pig | Pig/butterfly mark (raspberry, moss, black, white) | A vector **wordmark** and a mark + wordmark lockup |
| The Marlborough | MH mark (charcoal, cream, red) | A vector **wordmark** and a mark + wordmark lockup |
| The Singl-end | White/navy wordmark, badge | Vector versions if the PNGs are not already from vector |

Preferred formats: **SVG** (primary), plus AI/EPS/PDF. Each logo should have
transparent black, white/cream and colour variants. Include clear space and
minimum size rules from the guides.

### Priority 3 — High-resolution photography

The current pack photographs are web-sized:

| Brand | File | Pixels |
|---|---|---|
| Butterfly | butterfly-bar.jpg | 488 × 600 |
| Butterfly | butterfly-dining-room.jpg | 600 × 450 |
| Butterfly | butterfly-facade-bw.jpg | 600 × 450 |
| Butterfly | butterfly-staircase.jpg | 450 × 600 |
| Marlborough | marlborough-ballroom.jpg | 1125 × 1500 |
| Marlborough | marlborough-curtain.jpg | 600 × 400 |
| Marlborough | marlborough-facade.jpg | 1500 × 758 |
| Marlborough | marlborough-neon.jpg | 1001 × 1500 |
| Singl-end | singlend-brunch-table.jpg | 600 × 450 |
| Singl-end | singlend-cake-table.jpg | 600 × 450 |
| Singl-end | singlend-garnethill-wall.jpg | 450 × 600 |
| Singl-end | singlend-merchant-city.jpg | 450 × 600 |

They are fine for screen previews; a 300 dpi A4/A3 print pack will upscale them.
Please either supply high-resolution originals, or approve AI-generated
replacements using the prompts in §3. Target **300 dpi at the final size**:
roughly 2480 × 3508 px for A4 and 3508 × 4961 px for A3, plus 3 mm bleed.

### Priority 4 — Print typography

The guides flag a web/print type split. The Asset Studio currently uses the
**token/web** families, because those are the files that were included:

| Brand | Web/token fonts in the app | Print fonts named in the guide |
|---|---|---|
| Butterfly | Alegreya + IM Fell Great Primer | IM Fell Double Pica |
| Marlborough | Bebas Neue + Open Sans Condensed Light | Motor4F + Cormorant Garamond |
| Singl-end | Caprasimo + Playfair Display | Playfair Display + Raleway |

Please confirm which system the final assets should use. If print must be
Motor4F / Cormorant / IM Fell Double Pica / Raleway, provide licensed files and
we upload them and relink the roles. The Open Sans variable file also needs a
static **Condensed Light** cut if the exact width axis matters; the browser
canvas uses the variable font's default instance.

### Priority 5 — Copy approval

`BRAND_COPY` in `asset-studio/app.js` supplies Monteleone defaults. Some of it is
based directly on the guides; some menu/drinks lines are deliberately neutral
placeholders and should be approved or replaced:

- Butterfly menu sections: Tea Rooms / Restaurant / Bar.
- Marlborough drinks: Cocktails / Champagne / Small plates.
- Singl-end menu: Brunch / Cake table / Coffee.
- Marlborough phone: the guide says “not published”, so the app displays
  **“Email enquiries”**. Confirm that is acceptable.
- Marlborough Instagram/Facebook are blank in the contact table; the app hides
  the handle line.
- Singl-end has two addresses, phones and emails; confirm these should be
  displayed in full on the business card back.
- The Butterfly has two addresses (Bar & Restaurant and Tea Rooms); confirm the
  same.

### Priority 6 — Print specification

Confirm the final sizes, bleed and safe margin per category, and whether the
printer requires **PDF/X-1a or PDF/X-4 with an ICC output intent**. The current
print pack is a direct RGB→CMYK conversion with trim/bleed boxes and crop marks;
it is **not PDF/X-certified** and embeds no ICC profile.

### Priority 7 — Templates

The app reuses the 25 existing layouts. If you want Monteleone-specific
layouts (rather than the current flyer/menu/voucher/card/table-card/social set),
send reference boards or approve the reuse. The current layouts are brand-aware
and do not need new HTML files per group.

---

## 3. AI image prompts

Use a photorealistic editorial style, no text, no logos and no watermarks. The
app overlays type separately. Generate **4:5 portrait** for flyers/social and
**3:2 landscape** for wide photo bands; provide the originals at 300 dpi.

Add this negative prompt to all of them:

> no text, no logos, no watermark, no captions, no distorted hands, no plastic
> food, no oversaturated colours, no stock-photo smiles, no HDR halos, no
> fisheye, no illustration

### The Butterfly and the Pig

Brand cues: Georgian townhouse on Bath Street, Glasgow; established 2005;
Tea Rooms, Restaurant, Bar, Jazz Café, private rooms; cream, moss, raspberry,
peach; romantic, lived-in, a little eccentric.

**B1 — Tea Rooms hero (4:5)**
> Editorial interior photograph of a romantic Georgian townhouse tea room in
> Glasgow. Antique wooden tables set with cream linen, mismatched china, tiered
> cake stands, small glasses of raspberry cordial, arched wall niches, moss-green
> panelling, framed botanical prints, soft window light, a lived-in 20-year-old
> patina. Palette of cream, moss green, raspberry and pale peach. Intimate,
> quiet, slightly eccentric, film photography, 35mm, natural grain, shallow
> depth of field, space at the top for a headline. No people looking at camera.

**B2 — Bar / Jazz Café (3:2)**
> Intimate Glasgow bar and jazz café at night. Deep moss-green walls, leather
> armchairs, small candlelit tables, a double bass and a trumpet resting beside
> a piano, warm lamps, raspberry velvet cushions, framed vintage posters, a
> well-worn wooden floor. Rich, warm, atmospheric, editorial night photography,
> 35mm, gentle grain, low key but inviting. No text or signage.

**B3 — Afternoon tea detail (4:5)**
> Overhead editorial food photograph of an afternoon tea on cream linen:
> scones, clotted cream, raspberry jam, small cakes, finger sandwiches, a pot of
> tea, vintage china with a fine gold rim. Moss-green and raspberry accents,
> soft daylight from a window, natural texture, film photography, generous
> negative space at the top and left. No hands, no text.

**B4 — Bath Street facade (3:2)**
> Architectural photograph of a Georgian townhouse facade on Bath Street,
> Glasgow, at early dusk. Sandstone, tall windows, warm lit interiors, a subtle
> raspberry awning, wet pavement reflections, a few plants by the door. Quiet,
> elegant, lived-in, editorial travel photography, 35mm, natural grain. No
> readable signage or text.

### The Marlborough

Brand cues: restored 1920s venue in Shawlands; The Ballroom, The Red Room,
Dear Josephine’s, B Side; Marlborough red, charcoal, cream; nightlife, ballroom,
club rooms, theatrical, high contrast.

**M1 — Ballroom hero (4:5)**
> Editorial photograph of a restored 1920s ballroom at night. Round tables with
> cream linen and low candles, velvet chairs, a stage with a vintage microphone,
> a large chandelier, deep red and charcoal walls, warm pools of light, a hint of
> smoke. Theatrical, elegant, slightly decadent. Palette of Marlborough red,
> charcoal and cream. 35mm film, high contrast, natural grain, space at the top
> for a headline. No text or logos.

**M2 — Cocktail close-up (4:5)**
> Close-up editorial photograph of a whipped cocktail in a coupe glass on a red
> table, a small plate of canapés, a lit candle, red velvet in the background.
> Dramatic side light, deep shadows, cream foam, glossy glass, a playful
> nightlife mood. Marlborough red, charcoal, cream. Shallow depth of field,
> film grain. No text, no hands, no logos.

**M3 — Red Room / Dear Josephine’s (3:2)**
> Intimate club room interior at night: deep red velvet booths, a low table with
> champagne and small glasses, a neon glow out of focus, dark wood, a small
> stage, warm lamps. Moody, theatrical, adult, a little wild. Marlborough red and
> charcoal with cream highlights. Editorial night photography, 35mm, grain. No
> readable signage or text.

**M4 — Shawlands facade / neon (3:2)**
> Exterior photograph of a restored 1920s Glasgow venue at night. Red neon glow,
> cream stone, dark windows with warm light, a queue of silhouettes, wet
> pavement, a hint of gold signage without readable letters. Cinematic, high
> contrast, nightlife editorial, 35mm, grain, Marlborough red and charcoal. No
> text or logos.

### The Singl-end

Brand cues: café and bakehouse, Garnethill and Merchant City, brunching since
2015; famous for brunch, infamous for the cake table; navy, dusty rose, cream,
butter; playful, generous, homemade, all-day.

**S1 — Brunch table hero (4:5)**
> Overhead editorial photograph of a generous brunch table: pancakes with
> berries, poached eggs on toast, avocado, tomatoes, a flat white with latte art,
> a glass of iced tea, a small vase of flowers. Cream table, dusty-rose linen,
> navy accents, soft daylight, honest homemade food, generous portions, film
> photography, natural grain, negative space at the top. No hands, no text.

**S2 — Cake table (4:5)**
> Editorial photograph of a café cake table: tall layer cakes, cupcakes, a
> vintage cake stand, butter-cream swirls, berries, a slice on a small plate,
> cream and dusty-rose palette with a navy wall behind. Warm daylight, playful,
> abundant, slightly messy in a homemade way. 35mm film, shallow depth of field.
> No text or logos.

**S3 — Café interior (3:2)**
> Warm Glasgow café interior with navy-painted walls, dusty-rose banquettes,
> cream marble tables, plants, large windows, a counter with a pastry case,
> a few empty cups, morning light. Friendly, calm, lived-in, editorial lifestyle
> photography, 35mm, natural grain. No people looking at camera, no text.

**S4 — Garnethill wall / Merchant City storefront (3:2)**
> Daylight exterior photograph of a Glasgow café storefront. Navy fascia,
> dusty-rose accents, a painted wall sign with no readable letters, pavement
> tables, plants, a bicycle, soft Scottish daylight, red sandstone nearby.
> Honest, local, editorial, 35mm, natural grain. No text or logos.

---

## 4. Logo brief (for a designer, not AI)

- **The Butterfly and the Pig:** keep the existing pig/butterfly line mark.
  Create a lowercase wordmark in Alegreya (or a drawn serif close to it) and a
  horizontal lockup. Variants: black, cream/white, raspberry, moss.
- **The Marlborough:** keep the MH + heart mark. Create an uppercase Bebas-style
  wordmark and a stacked lockup (mark above wordmark) and a horizontal lockup.
  Variants: charcoal, cream, red.
- **The Singl-end:** vectorise the existing wordmark and badge. Variants: navy,
  white/cream.
- All: transparent SVG, clear space = cap height, minimum sizes, no effects,
  no outlines unless supplied as a separate cut.

---

## 5. Asset checklist before sign-off

- [ ] Source pack confirmed (or source folder restored with assets).
- [ ] Vector wordmarks and lockups for Butterfly and Marlborough.
- [ ] Vector versions of the Singl-end wordmark and badge.
- [ ] High-resolution photography (300 dpi at final size), or approved AI images.
- [ ] Print type decision and licensed files, if different from the web fonts.
- [ ] Menu/drinks copy approved or replaced.
- [ ] Marlborough phone/Instagram/Facebook decision confirmed.
- [ ] Singl-end and Butterfly multi-address contact display approved.
- [ ] Print specs (bleed, safe margin, ICC/PDF-X) confirmed.
- [ ] Final visual review of each category × brand.

---

## 6. How the group model works

- Every imported brand pack is a **group** in the Asset Studio.
- The brand gate shows group tabs; the topbar group selector switches groups.
- The last brand used in each group is remembered.
- Saved assets record their group/brand and restore across groups.
- Adding another group later is an import, not a new UI: the group tabs and
  selector will pick it up automatically.
- The shared design engine means new groups reuse the same 25 layouts, with
  brand data, fonts, logos and photos substituted. Editorial/menu copy is
  optional: add a `BRAND_COPY` entry for the group; otherwise the generic sample
  copy is brandified with the pack's contact, tagline and website.

---

## 7. Current implementation notes

- Pack: `data/brand-packs/monteleone-group-20261031144502-45be/`
- Shared kits: `data/brand-kits/monteleone-group-*`
- Fonts: `data/fonts/` (OFL files from the source kit)
- Brand copy: `asset-studio/app.js` → `BRAND_COPY`
- Group filter / pack switching: `asset-studio/app.js` → `loadPackSummaries`,
  `activatePack`, `renderGroupSelect`, `renderGateGroups`
- Print pack: `asset-studio/print.js`
- The app defaults to the newest group (Monteleone); switch to Dalton from the
  gate tabs or the topbar selector.

If the source pack is re-imported under a new name, brand IDs can change and
browser-saved assets that reference the old IDs will not restore. Export any
assets you need to keep before replacing a pack.
