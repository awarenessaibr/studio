# Menu-enabled designs

First version scope: **Agent First Studio only**, brand **Singl-end**, confirmed
menu data from the brand pack.

The menu catalogue and design mapping are data, not hard-coded UI:

- `data/library/menu-catalog.json` — confirmed menus/items generated from the brand pack.
- `data/library/menu-designs.json` — designs with safe product slots.
- `scripts/build-menu-catalog.js` — rebuilds the catalogue from brand packs.

## Supported in v1

| Design | Product | Fields changed | Image slot |
|---|---|---|---|
| `posts---tarantella-01` | Prosecco · Spumante Brut | name, glass/bottle price | — |
| `posts---tarantella-02` | Moretti | product line, 330ml price | — |
| `reels---before-after-01` | Meaty breakfast | name, description, price | — |
| `reels---before-after-02` | Le Croque Gary | name, description, price | — |
| `reels---before-after-03` | Royale | name, description, price | — |
| `singl-end-3-minimalist-reels-01` | Eggs on toast | name, description, price | — |
| `singl-end-3-minimalist-reels-02` | Home Baked Granola | name, description, price | — |
| `singl-end-3-minimalist-reels-03` | Flat White | name, price | — |
| `singl-end-3-more-reel-styles-02` | Cure yer Heid | name, description, price | — |
| `singl-end-9-16-reel-concepts-01` | Homemade Brioche French Toast | name, description, price | — |
| `singl-end-9-16-reel-concepts-02` | Aperol Spritz | name, description, price | — |
| `singl-end-pinocchio-storytelling-reels-02` | The Everything | name, description, price | — |

The manifest is the authority. Add a design only after checking its exact
name/description/price layer IDs against the editable composition.

## Not supported in v1, and why

| Design | Reason |
|---|---|
| `posts---tarantella-03` | two products in one composition (Aranciata + Limonata) |
| `reels---news-bulletin-reel-01/02/03` | product is embedded in multi-card/state layouts and ticker copy |
| `singl-end-3-more-reel-styles-01` | venue/offer copy, no single product |
| `singl-end-3-more-reel-styles-03` | ingredient list is split into multiple independent layers |
| `singl-end-italian-places-reels-01/02` | multiple stops/products in one route composition |
| `singl-end-le-regole-della-nonna-01/02/03` | narrative episode; price is incidental |
| `singl-end-pinocchio-storytelling-reels-01` | multiple product statements and a punchline |
| `singl-end-pinocchio-storytelling-reels-03` | quiz/game copy, no simple product slot |
| `singl-end-fixed` | duplicate/fixed composition; not a unique source design |
| All non-Singl-end brands | no confirmed menu in the brand pack yet |

## First-version behaviour

When a supported design is selected:

1. The panel shows **Menu item** with the current product and price.
2. A tooltip explains that the item can be changed without changing the visual
   style.
3. **Change item** opens a searchable picker limited to the allowed menus.
4. Selecting an item creates a separate `Menu variation — <item>` animation.
   - one variation per item;
   - selecting the same item again reuses that variation;
   - each variation can be deleted.
5. The variation replaces the mapped text fields while keeping the same layer
   boxes, fonts, alignment and colours.
6. Text is reduced slightly if it no longer fits; allowing more lines is a
   future option.
7. No supported v1 design has a verified **product-image slot**. The image code
   is ready for a design whose manifest defines `imageLayerId`; the variation
   will then offer upload/search. Without a verified slot, the design keeps its
   existing imagery and only the product text changes. Do not map a scene photo
   as a product image.

## Notes

- The source-exact **Original motion** remains untouched. Menu variations are
  generated from the editable composition, not the source recording.
- Menu data is read-only. The menu picker never edits the confirmed menu.
- The same catalogue and design manifest can be reused by Studio Agent later,
  but no Studio Agent changes are part of v1.
