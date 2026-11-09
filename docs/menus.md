# Menus, venue hire and content assets

A brand's menus are structured data, not a page of text. Prices, dishes,
dietary marks, dates and which branch a menu belongs to are extracted from the
business's own PDFs once, kept in the brand pack, and then handed to every
surface that needs them: the **Menus** tab in Agent Studio, the **Menu source**
picker in Asset Studio, and the business asset library.

The point is speed with the typography already decided: drag *Home Baked
Granola* onto a canvas and it arrives as a set layer — dish, description and
price set in the brand's own faces — so the only decision left is which dish
goes on today's poster.

---

## 1. Where the data lives

| Layer | File |
|---|---|
| Editable source | `data/brand-packs/<pack>/files/<brand>/content/<brand>.json` |
| What the app reads | `data/brand-packs/<pack>/pack.json` → `brands[].content` |
| Source documents | `data/brand-packs/<pack>/files/<brand>/documents/*.pdf` |
| Library records | `data/assets/ast_<brand>-menu-*/metadata.json` |

The content file is the only place to edit menus by hand. `pack.json` is a
copy with the schema applied, written by the sync script:

```bash
node scripts/sync-brand-content.js --pack=singl-end-merchant-city-20261107164459-3-20261109103425-e780
node scripts/sync-brand-content.js              # every pack, after any content edit
```

The script also copies `documents[]` onto the brand so the asset library can
index the PDFs. It is idempotent and skips brands that are already in sync.

---

## 2. The content model

`content.menus[]` is the list; each menu is one printed piece, dated and
scoped to one or both branches.

```json
{
  "menus": [{
    "id": "all-day",
    "name": "All-day menu",
    "kind": "food",
    "branches": ["garnethill", "merchant-city"],
    "summary": "Fruits & grains, singl-eggs, breakfasts, lunch, sides.",
    "availability": "Open everyday · menu served all day",
    "serves": ["breakfast", "brunch", "lunch"],
    "validFrom": "2026-04",
    "validTo": "",
    "priceNote": "",
    "notes": ["Please speak to our staff if you have any allergies."],
    "source": { "document": "documents/Singl-end-Menu-APRIL2026-FINAL.pdf", "page": 1 },
    "sections": [{
      "name": "Singl-eggs",
      "note": "Add halloumi + £3.25.",
      "price": "",
      "items": [{
        "name": "Benedict",
        "description": "Crispy baked ham, poached eggs, hollandaise, toasted sourdough",
        "price": "£14.75",
        "dietary": ["GFi"]
      }]
    }],
    "packages": []
  }]
}
```

| Field | Meaning |
|---|---|
| `id` | stable, `[a-z0-9-]`, also used inside drag payloads |
| `kind` | `food`, `drinks`, `kids`, `functions`, `christmas`, `desserts`, `canapes`, `buffet`, `other` |
| `branches` | location ids this menu may be used for; **empty means every branch** |
| `validFrom` / `validTo` | `YYYY-MM` or `YYYY-MM-DD`; a dated menu, not a timeless one |
| `source` | the document and page the menu was read from — never lose it |
| `sections[].price` | a set menu's price (`£15.00 per person`) |
| `items[].dietary` | `V`, `Ve`, `GFi`, `GF`, `DF`; the studio prints them in brackets |
| `packages[]` | set menus / bundles (`name`, `description`, `price`, `unit`, `minOrder`, `includes`) |
| `notes` | the allergen line and other standing copy |

### Venue hire

`content.venue` holds what a venue-hire brief needs, and `offers[]` is the
short list that becomes draggable offer cards:

```json
{
  "venue": {
    "name": "The Singl-end Garnethill — function & event hire",
    "hireFee": "£250",
    "hireFeeNote": "Exclusive use of the Garnethill café from 7pm–12am.",
    "minimumSpend": "£1,800 (Terms & Conditions 2026)",
    "deposit": "£100 to confirm a booking",
    "minGuests": "40", "maxGuests": "100", "minCatering": "40",
    "exclusiveUse": "…", "setupFrom": "…", "arrivalFrom": "…",
    "lastOrders": "11.45pm", "closes": "12am",
    "accessibility": "…", "parking": "…", "decorations": "…", "music": "…", "drinks": "…",
    "terms": ["…"],
    "faqs": [{ "q": "Is there a hire fee?", "a": "Yes. £250…" }],
    "occasions": ["Weddings", "Christmas parties"],
    "entertainment": [{ "name": "Whisky tasting", "detail": "…", "price": "Priced on application" }],
    "offers": [{ "title": "Private hire", "detail": "7pm–12am · 40–100 guests", "price": "£250", "branches": ["garnethill"] }]
  }
}
```

**Contradictions are recorded, not resolved.** The Singl-end's 2026 Terms &
Conditions state a £1,800 minimum spend while its 2026 brochure states there
is no minimum spend. Both are in `minimumSpend`, `terms` and `notes`, and the
hire FAQ repeats the conflict, because a designer quoting one of them silently
would be wrong half the time. Confirm with the venue and then edit one line.

### Branches, locations and documents

```json
{
  "locations": [
    { "id": "garnethill", "name": "Garnethill", "address": "263 Renfrew Street",
      "postcode": "G3 6TT", "email": "garnethill@thesingl-end.co.uk",
      "hours": { "mon": "8:30am–5pm" } },
    { "id": "merchant-city", "name": "Merchant City", "address": "15 John Street",
      "postcode": "G1 1HP", "email": "merchantcity@thesingl-end.co.uk" }
  ],
  "documents": [{
    "title": "Garnethill function menu (February 2026)",
    "path": "documents/GH-FUNCTION-MENU-NEWEST-FEB2026.pdf",
    "kind": "menu", "pages": 2, "updated": "2026-02",
    "branch": "garnethill", "note": "Set menus 1–3 and desserts.",
    "menuIds": ["functions"]
  }]
}
```

`documents[]` is what the library indexes; `menuIds` links a document to the
menus read out of it.

---

## 3. What the surfaces do with it

### Agent Studio — the **Menus** tab

`/studio.html` gets a Menus tab whenever the active brand has menus. It lists,
per menu: the whole menu, its set-menu packages, each section (collapsible, one
row per dish with its price) and a **Venue & functions** group for the offers.
A **Branch** selector filters the list — pick Merchant City and the Garnethill
Christmas and function menus disappear.

Every row is draggable. A drop creates a **text layer** with `format` set, at
the drop point:

| Dropped | `format` | Default box |
|---|---|---|
| a dish | `menu-item` | 48% × 9.5% |
| a section | `menu-list` | 52% × 32% |
| a whole menu | `menu-list` | 54% × 64% |
| a venue offer | `offer` | 46% × 11% |

The layer stays editable: the `text` is still `Name | Description | Price`
(`#` for a section heading), so retyping a dish in the inspector is enough.
The block is drawn twice — `paintMenuBlock` for the canvas and export, and
`menuBlockHTML` for the live preview — from the same parsed rows, and both
shrink the type to fit the layer. Below ~55% of the requested size the
descriptions are dropped rather than printed two pixels high.

### Asset Studio — **Menu source**

In the **Text** tab of any menu design, **Menu source** picks which menu (or
which section of a menu) prefills the design. The chooser is the brand's own
content, so names, descriptions and prices arrive already correct, and the
title becomes the menu's name. A menu documented for one branch prints that
branch's address in the footer (the Christmas and function menus are
Garnethill's).

The **Insert menu rows from the library** button also prefers the curated rows
over a second pass over the PDF, which cannot keep a two-column menu's prices
with their dishes.

### Post ideas

The same dish data finishes the job. In Asset Studio’s **Post Ideas**
category, the *Dish* picker fills a feed post or reel cover, and the
**Caption** tab writes the caption, the hashtags and a motion idea from that
dish — see [asset-studio.md](asset-studio.md#post-ideas--2-designs) for the
feed cards, [Reel ideas](asset-studio.md#reel-ideas--12-designs) for the
twelve 9:16 layouts and [Story reels](asset-studio.md#story-reels--6-designs)
for the six collaboration stories. The Agent Studio **Menus** tab links each menu straight
into it.

### Business asset library

`/library.html` indexes the PDFs as `business-document` / role `menu`, with the
curated rows attached (`extracted.method: "curated"`). The review drawer shows
them, and `extract-rows` remains available for a document that has no curated
menu. Re-index after changing documents:

```bash
curl -X POST http://127.0.0.1:8008/api/assets/index-pack \
  -H 'content-type: application/json' \
  -d '{"packId":"singl-end-merchant-city-20261107164459-3-20261109103425-e780"}'
```

---

## 4. Adding a brand's menus

1. Put the PDFs in `files/<brand>/documents/` inside the pack.
2. Write or extend `files/<brand>/content/<brand>.json` — `menus`, `venue`,
   `locations`, `documents`. Copy the shape above; keep `source.document` and
   `source.page` for every menu.
3. Run `node scripts/sync-brand-content.js --pack=<pack>`.
4. Re-index the pack (command above) so the library sees the documents.
5. Write the review register and check it back against the PDFs:

   ```bash
   node scripts/export-menu-register.js --pack=<pack>
   # → deliverables/<pack-name>/menus-and-venue.md
   ```

6. Open `/studio.html?pack=<pack>&brand=<brand>` → **Menus**, or
   `/asset-studio.html?brand=<brand>` → a menu design → **Text** → *Menu source*.

The register is generated from the pack, so it cannot drift from what the
studio prints. It is the document to send back to the venue: every price, every
branch, every term, plus the conflicts and the source page for each menu.

Rules that keep this honest:

- **Never invent a price.** No price in the source → empty `price`; the block
  prints without one.
- **Never merge branches silently.** If a document is written for one venue,
  its menu lists that branch.
- **Keep the source reference.** A menu without `source.document` cannot be
  checked when the venue changes its prices.
- **Record conflicts in `notes`.** Someone has to resolve them; the data should
  not pretend there is only one version.
- **Dated menus get a date.** `validFrom` from the document, `validTo` for a
  campaign (the Christmas 2026 menu ends 2026-12-31).

---

## 5. Tests

```bash
node --test tests/menu-content.test.js   # model, formatting, assets, real pack
node tests/menus.js                      # browser: Menus tab drop + Asset Studio source
node scripts/export-menu-register.js --pack=singl-end-merchant-city-20261107164459-3-20261109103425-e780
```

The `deliverables/singl-end-merchant-city/menus-and-venue.md` register is
committed as the review copy; regenerate it after any content change.

The model tests cover branch filtering, the older `content.menu` / `content.drinks`
shape folding into `menus` without duplicating on a re-normalise, the
`Name | Description | Price` format, and every document in the Singl-end pack
existing on disk.
