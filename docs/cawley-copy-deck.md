# Cawley Hotels — copy deck and asset review

**Scope.** All copy in the Cawley Hotels brand pack
(`cawley-hotels-20261031152439-d04d`): the five venue copy decks, the 65
published templates, and the Asset Studio / Agent Studio sample copy those
templates are built from.

**Group.** Cawley Hotels & Restaurants — Boardwalk (Falkirk), The Boat Yard
(Lochwinnoch), Coast Bar & Restaurant (Langbank), Duck Bay Hotel & Cottages
(Loch Lomond) and River House (Stirling).

**Status.** Applied. Every venue now has an authored copy deck, every template
was regenerated from it, and the Christmas/seasonal designs no longer inherit
another client's event.

---

## 1. What was wrong

| Finding | Where it showed | Fix |
|---|---|---|
| Voucher terms said **“Redeemable at any Dalton family venue”** — a different client's group | Every gift-voucher template and the Asset Studio voucher design | Terms now read “any Cawley Hotels venue” (the site confirms gift cards work in all venues) and state the real terms: valid 12 months, non-refundable |
| The same **five invented dishes with invented prices** (hand-dived scallops £14, cured salmon £12, dry-aged beef £34…) appeared on every venue's menu, menu board and table card | Menu, digital menu board, table card, 5 venues | Replaced with each venue's own dishes and published prices |
| **Another client's flyer headline**, “A table worth crossing town for”, and its body (“Seasonal plates… a quiet drink at the bar”) | Boardwalk saved flyer, Asset Studio flyer design | Replaced with the venue's own line and body |
| **“Christmas Brunch — Sunday 13th December — 2 courses + cocktail £49 — Decadance DJs, singalongs, confetti & glowsticks”** (The Adamson's event) appeared on Duck Bay artwork | Agent Studio → Templates → Christmas · photo / Christmas · type; Asset Studio Christmas designs | Replaced with each venue's real festive menu: courses, price, service time and venue |
| The Agent Studio's **sub-headline was the brand-guide positioning paragraph, cut mid-word** (“…a family-run hotel, restaurant and cluster of sel”), then repeated as body copy | Every flyer generated in the Agent Studio | Sub-headline is the venue name; body copy is the authored sentence. Text clipping is now word-safe |
| Business cards carried **“General manager”** and another client's phone/email/address | Business-card templates, Asset Studio business cards | Real venue phone, address and site; role is an explicit placeholder (“Your role”) because the pack records no manager name |
| Website/social copy was **keyword soup** (“lochside · Loch Lomond · cottages and hot tub”) | Flyer bodies, display screens, social captions | Replaced with venue-specific sentences from the sites and brand guides |
| Christmas voucher message **“Find your cure this Christmas”** (another client's tagline) | Christmas voucher design | Venue Christmas message |

Nothing on the Cawley sites mentions a Christmas brunch, Decadance DJs or a
£49 cocktail offer. That copy was sample text in the shared design catalogue,
not Cawley copy, and has been removed from every Cawley surface.

### 1.1 Design-engine faults found while aligning the copy

The wrong words exposed a few geometry faults in the shared catalogue. They
affected every brand, so they were fixed at the source rather than patched in
Cawley templates:

- **Text boxes sat 0.75% left of the design.** The text layer conversion
  subtracted half the click padding from `x`; a layout drawn at an 8% margin
  tested as 7.25% and failed the safe-zone guardrail. Text layers now use the
  glyph box, so margin-respecting designs measure as drawn.
- **The Christmas · photo / Christmas · type designs used a 4% margin.** Both
  now use the 8% print margin; the photo design also reserves room for a
  two-line headline and a real price line.
- **Voucher margins.** The accent voucher used a 7% margin and a code panel
  that ended at 93%; both are inside 8–92% now, and the cream voucher's code
  reads white on ink instead of accent-on-ink (2.3:1).
- **Secondary text.** The shared `mute` tone was 40% toward paper and measured
  ~4.2:1 on white; at 30% it clears the 4.5:1 guardrail.
- **Footers.** Menu, social and table-card footers were set at 93–95% of the
  height; they now end by 91–92%.
- **Dark photo flyer.** The accent eyebrow and price were accent-on-dark
  (1.3:1 for Cawley's brown); they use the layout's cream ink now.

The remaining guardrail warnings in four secondary menu layouts (drinks, wine,
kids, takeaway) and two experimental social layouts come from those
catalogue designs' own type sizes, not from the Cawley copy. They are logged
for a design pass; the dishes, prices and venue details in them are correct.

---

## 2. Sources

Read for this review (November 2026):

- **Sites:** [duckbay.co.uk](https://www.duckbay.co.uk/),
  [boardwalkfalkirk.co.uk](https://boardwalkfalkirk.co.uk/),
  [boatyardlochwinnoch.co.uk](https://boatyardlochwinnoch.co.uk/),
  [coastbarandrestaurant.com](https://www.coastbarandrestaurant.com/),
  [riverhousestirling.co.uk](https://www.riverhousestirling.co.uk/)
- **Group pages:** [Christmas at Cawley](https://www.duckbay.co.uk/christmas-at-cawley/)
  (festive menus, private dining, gift cards, cracker-less policy),
  [Buy a gift](https://www.duckbay.co.uk/buy-a-gift/) (voucher validity and
  non-refundable terms), Duck Bay cottages page (three double bedrooms,
  hot tub, one dog, £600 housekeeping deposit)
- **Menus (PDF):** Duck Bay `DB-ALC.pdf`, `DB-Festive-Menu-A4-WEB.pdf`,
  `DB00-Sweet-Menu-A5-APR-25.pdf`; Boardwalk `BW-A-LA-CARTE-2026.pdf`,
  `BOARDWALK-Festive-Menu-A4-DEC-26.pdf`, `BW-SWEET-2026.pdf`; Boat Yard
  `BY0018-A-LA-CARTE-Menu-A3-Apr-26-3.pdf`,
  `BOAT-YARD-Festive-Menu-A4-DEC-26.pdf`, `BY-SWEET.pdf`; Coast
  `COAST0038-ALC-Menu-A3-APR-26-4.pdf`, `COAST-Festive-Menu-A4-DEC-26.pdf`,
  `COAST-SWEET.pdf`; River House `RH-ALC-2.pdf`,
  `RIVER-HOUSE-Festive-Menu-A4-DEC-26.pdf`, `RH-Sweets.pdf`
- **Brand guides** in the pack: positioning, voice (prefer/avoid), contact
  block, facts, private dining and festive applications.

Where sources disagree, the live site wins for customer-facing facts and the
guide wins for voice. One disagreement is recorded in §6.

---

## 3. The copy standard

1. **Every line must be true of that venue.** A fact that is true of the
   group is not automatically true of the venue; a fact that is true of
   another client is never true here.
2. **Prices and dates are quoted, not invented.** A template that needs a
   price either has a published one or leaves the price out.
3. **The brand's own words win.** The site taglines (“Lochside luxury.”,
   “Stylish, all day dining.”, “Riverside dining.”, “Relaxed dining,
   elevated.”, “Renfrewshire's premier restaurant & bar.”) are the display
   headlines; the guide's positioning is context for the writer, not a
   headline.
4. **Voice constraints are hard constraints.** Boardwalk avoids “eatery”,
   “vibes”, “foodie”. The Boat Yard avoids “gastropub”, “curated”,
   “elevated”. Coast avoids “seaside”, “beach”, “coastal”. Duck Bay avoids
   “budget”, “stopover”. River House avoids “cheap”, “quick bite”.
5. **Placeholders stay placeholders.** A business card cannot know the
   manager's name, so it says “Your name” / “Your role”, not a plausible
   invented title.

---

## 4. Approved copy, venue by venue

### Duck Bay Hotel & Cottages — Loch Lomond

| Slot | Copy |
|---|---|
| Eyebrow | Hotel, cottages & restaurant · Loch Lomond |
| Headline | Lochside luxury. |
| Sub-headline | Duck Bay Hotel & Cottages |
| Detail | lochside dining · cottages · Loch Lomond |
| Body | Family-run since 1985: lochside dining, afternoon tea in Bobby's, cottages with private hot tubs and Windows on the Loch for up to 60. |
| CTA | Book a table |
| Menu | À la carte — haggis, neeps & tatties £10.95 · seared scallops £16.95 · classic seafood grill £37.95 · fish & chips £20.95 · salted caramel profiteroles £9.95 |
| Special | Duck Bay's classic seafood grill — £37.95 |
| Voucher | Redeemable at any Cawley Hotels venue. Valid for 12 months from purchase. Non-refundable; not exchangeable for cash. |
| Festive | Christmas at Duck Bay · 3 courses £39.50 · from 12 noon |

### Boardwalk — Falkirk

| Slot | Copy |
|---|---|
| Eyebrow | Restaurant, carvery & bar · Falkirk |
| Headline | Stylish, all day dining. |
| Sub-headline | Boardwalk |
| Detail | Falkirk Wheel · carvery · terraces |
| Body | Breakfast from nine, lunch and dinner beside the Falkirk Wheel, a Sunday carvery and a bar that stays open late. |
| CTA | Book a table |
| Menu | À la carte — haggis bon bons £8.95 · bang bang cauliflower £8.95 · sea-salt margherita £12.95 · slow-braised steak pie £19.95 · sticky toffee pudding £8.95 |
| Special | Slow-braised steak pie — £19.95 |
| Festive | Christmas at Boardwalk · 2 courses £31.95 / 3 courses £39.95 · from 12 noon |

### The Boat Yard — Lochwinnoch

| Slot | Copy |
|---|---|
| Eyebrow | Restaurant, carvery & lounge · Lochwinnoch |
| Headline | Renfrewshire's premier restaurant & bar. |
| Sub-headline | The Boat Yard |
| Detail | Castle Semple · carvery · Lochwinnoch |
| Body | Country dining at Lochwinnoch: breakfast, lunch and dinner with views over Castle Semple, a weekend carvery and Bobby's Lounge. |
| CTA | Book a table |
| Menu | À la carte — Cullen skink £10.95 · haggis & black pudding fritters £10.95 · roast chicken Balmoral £20.95 · steak & sausage pie £20.95 · lemon meringue pie sundae £10.95 |
| Special | Roast chicken Balmoral — £20.95 |
| Festive | Christmas at The Boat Yard · 2 courses £31.95 / 3 courses £39.95 · from 12 noon |

### Coast Bar & Restaurant — Langbank

| Slot | Copy |
|---|---|
| Eyebrow | Bar & restaurant · Langbank, Inverclyde |
| Headline | Riverside dining. |
| Sub-headline | Coast Bar & Restaurant |
| Detail | River Clyde · nautical · Langbank |
| Body | Riverside dining on the Clyde at Langbank: a nautical room, an extensive menu from ten and one of the best views in Inverclyde. |
| CTA | Book a table |
| Menu | À la carte — haggis bon bons £9.95 · seared king scallops £16.95 · seafood linguini £24.95 · fish & chips £20.95 · white chocolate crème brûlée £9.95 |
| Special | Coast seafood linguini — £24.95 |
| Festive | Christmas at Coast · 2 courses £31.95 / 3 courses £39.95 · from 12 noon |

### River House — Stirling

| Slot | Copy |
|---|---|
| Eyebrow | Restaurant & bar · Stirling |
| Headline | Relaxed dining, elevated. |
| Sub-headline | River House |
| Detail | Stirling Castle · private dining · Bobby's |
| Body | Contemporary dining above the loch, with Stirling Castle in the view, a private dining area and Bobby's bar after dark. |
| CTA | Book a table |
| Menu | À la carte — haggis pakora £9.95 · roast king scallops £16.95 · oven-baked salmon £22.95 · trio of Ayrshire pork £25.95 · sticky toffee pudding £9.95 |
| Special | Chateaubriand for two — £99.95 |
| Festive | Christmas at River House · 3 courses £44.95 · from 12 noon |

### Festive menu dishes

The **Festive** menu design uses these five dishes (names kept short enough for
one line; descriptions carry the detail):

| Venue | Festive dishes |
|---|---|
| Duck Bay | Roast turkey · Daube of beef · Haddock & prawn gratin · Squash pithivier · Christmas pudding |
| Boardwalk | Roast turkey · Chianti ox cheek · Pollo Parmigiana · Christmas roast · Christmas pudding |
| The Boat Yard | Roast turkey · Beef & ale casserole · Haddock & prawn gratin · Christmas roast · Christmas pudding |
| Coast | Roast turkey · Slow-braised pork belly · Beef & ale casserole · Roast salmon · Christmas pudding |
| River House | Roast turkey · Daube of beef · Roast chicken · Roast salmon · Christmas pudding |

---

## 5. Where the copy now lives

| Store | File | What it holds |
|---|---|---|
| Brand content | `files/<brand>/content/<brand>.json` | `menu` (real sections, dishes, descriptions, prices), `hours`, `bookingUrl`, and `copy` |
| Pack manifest | `pack.json` → `brands[].content` | The same record, normalised on read; `scripts/sync-brand-content.js` keeps the two in step |
| Copy block | `content.copy` | `headline`, `subhead`, `kicker`, `detail`, `body`, `cta`, `tag`, `boldTitle`, `menu`, `special`, `voucher`, `festive`, `card` |
| Published templates | `templates/<brand>/<template>/template.json` | Regenerated default text for all 13 designs per venue, plus the hand-made Boardwalk flyer |
| Asset Studio / Agent Studio | `applyTemplateCopy()` in `src/shared/brand-pack.js` | Maps the deck onto the shared design catalogue so both surfaces show the same words |

`content.copy` is normalised (length caps, known keys only) by
`normalizeCopy()` in `src/shared/brand-pack.js`, so a malformed deck cannot
push unbounded text into a template.

---

## 6. Open items (client confirmation, not blockers)

1. **River House private dining capacity.** The brand guide says 12 with a £50
   room fee; the Christmas page says 14. The approved copy says “a private
   dining area” without a number. Confirm which is current before someone puts
   a number on a brochure.
2. **Prices move.** Menu prices are as published on the current PDFs (spring
   2026 where dated). Re-check before a print run; the templates are designed
   to be edited, and the price is a variable in every menu/table-card design.
3. **Business-card names and roles.** “Your name” / “Your role” are
   placeholders. If a real card is wanted, supply name, role, direct email and
   mobile for each venue.
4. **Email addresses.** The sites publish a contact form rather than a
   readable address, so cards say “Enquiries via the site form”. Supply
   role-based addresses (e.g. reservations@) if they should be printed.
5. **Instagram handles.** The pack's contact block has none, so social footers
   show the website only. The crawler found `@duckbaymarina`,
   `@coastlangbank`, `@boardwalkfalkirk` and `@theriverhousestirling`; add
   them to the contact facts if they should appear on artwork. No Boat Yard
   handle was found.
6. **Boat Yard menu freshness.** The current à la carte is dated April 2026 and
   the festive menu December 2026; both were used. If a newer set is issued,
   update `content.menu` and regenerate.

---

## 7. How to re-run

```bash
# 1. write the edited content decks into pack.json
node scripts/sync-brand-content.js \
  --pack=cawley-hotels-20261031152439-d04d

# 2. re-read the decks and regenerate every Cawley template
node scripts/publish-brand-templates.js \
  --pack=cawley-hotels-20261031152439-d04d --force

# 3. tests
npm test
```

The regeneration is idempotent: it replaces each saved template for its
catalogue design and leaves any hand-made saved design alone. One hand-made
design exists (`boardwalk-flyer-2`); its copy was corrected in place.
