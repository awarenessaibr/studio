# Function hire, rooms and events

A venue's hire business is **not** one menu. It is a product made of five
connected records — the venue terms, the rooms, the hire packages, the food
menus that go with them, and the photography that sells them. This page
defines that model, where each fact comes from, how a designer uses it, and
how the pack is checked against the venue's own pages and brochure.

It is the companion to [menus.md](menus.md): menus answer *what can we eat*,
function hire answers *where can we hold it, what does it cost, who can get
in, and what does it look like*.

---

## 1. The records

| Record | Lives in | What it is |
|---|---|---|
| **Venue** | `content.venue` | The hire product: fees, deposit, guest range, catering, drinks, accessibility, terms, FAQs, occasions, entertainment |
| **Rooms** | `content.venue.rooms[]` | One hireable space: location, capacity, layout, AV, toilets, access, availability, photos, source |
| **Offers** | `content.venue.offers[]` | The draggable sales cards: private dining, drinks-only, corporate, afternoon tea, buffet, Christmas… |
| **Function menus** | `content.menus[].kind` = `functions` or `christmas` | The food packages themselves, priced per person and dated where relevant |
| **Photography** | `brand.photography[]` + `assets/photography/rooms/` | The room cards and galleries, served to the Image tab |
| **Sources** | `content.documents[]`, `sources/site/*.txt`, `sources/room-photos.json` | The brochure, menu PDFs, saved page snapshots and the image manifest |

A room is deliberately **not** a menu and **not** an offer:

- a **menu** is priced food that becomes a printed list;
- an **offer** is a package a designer drops to make a sales card;
- a **room** is a physical space with facts that must stay true (capacity,
  stairs, toilets) and photography that must stay attached to it.

---

## 2. The room record

```json
{
  "id": "the-drawing-room",
  "name": "The Drawing Room",
  "location": "First floor, up the grand spiral staircase",
  "capacity": "2 long tables of 20 · 5 separate tables",
  "layout": "Dining layout · afternoon tea layout · drinks & mingling · U-shape / top table",
  "av": "Sound system",
  "toilets": "Toilets and baby changing on this floor",
  "accessibility": "No disabled access or accessible toilets on this level",
  "available": "Any time of day",
  "features": ["One of the largest private dining spaces", "Antique furnishings…"],
  "image": "assets/photography/rooms/the-drawing-room-01.webp",
  "gallery": ["assets/photography/rooms/the-drawing-room-02.webp"],
  "url": "https://www.thebutterflyandthepig.com/drawing-room",
  "brochurePage": 6,
  "note": "Set atop the grand spiral staircase…"
}
```

| Field | Meaning |
|---|---|
| `capacity` | The room's true layout, in the venue's own numbers — never a guessed headcount |
| `layout` | How the tables can be arranged (dining, afternoon tea, drinks, U-shape) |
| `av` | Sound, TV, stage, DJ booth, microphone, karaoke |
| `toilets` / `accessibility` | The constraint a guest will ask about first; stated exactly |
| `available` | When the room can be privately hired |
| `features` | Short selling points, one line each |
| `image` | The room card photo, also the first photography entry |
| `gallery` | The rest of the room's photos, in page order (a page gallery can include food and detail shots) |
| `url` / `brochurePage` | The two sources a fact can be checked against |

The room list is capped at 12; the image gallery at 24 per room.

---

## 3. Where the facts come from

Three sources, in this order of specificity:

1. **The room page** (`/the-tearooms`, `/room-13`, `/drawing-room`,
   `/board-room`, `/cafe-function-room`) — the current description, layout
   options, AV and access.
2. **The function brochure PDF** — the room grid with numbers, the package
   prices, the service times and the FAQs.
3. **The function hire page** (`/function-room-hire`) — the sales framing,
   hire terms, corporate offer, six room cards and their photos.

The page and the brochure disagree in four places. **Both readings are kept**
in the data and in `venue.notes`; a designer quoting one silently would be
wrong half the time:

| Conflict | Website | Brochure |
|---|---|---|
| Number of spaces | "five distinctive spaces", then six listed | Six: Tea Rooms, Drawing Room, Board Room, Room 13, Café, Club |
| Room 13 capacity | "cosiest", one large table or two smaller | "Holds 40 people" while its layout lists 12 or 14 |
| Café evening hire | Sunday–Wednesday | Monday–Wednesday |
| Christmas lunch | 12–3:30pm on the Christmas page | 12:30–3pm on the Thursday–Saturday sheet |

Three more conflicts — and one absence — are kept on the record because a poster can quote the wrong one:

- kids menu: "under-12s only" on the menus page vs "12 and under" on the artwork;
- afternoon tea: a 42-flavour tea menu vs "choose from up to 25 varieties";
- buffet: the only PDF is dated September 2024, so its prices are dated;
- no minimum spend is published at all — do not invent one.

The brochure in the pack is the **Canva PDF by Tamzin Young, created 24
February 2026**, byte-identical to the one linked from the function page.

---

## 4. How it surfaces

### Agent Studio → Menus

The **Venue & functions** group now carries:

- hire facts in one line (`Hire £100 for drinks-only · free with food bookings · 12–100 guests…`);
- every offer as a draggable card;
- every room as a draggable card **and** a reference row with capacity, location, availability and access;
- a collapsible **Hire terms** list.

Dragging a room creates an offer block: name, `capacity · location`, and the
layout/AV on the detail line. Dropping an offer creates the sales card. Both
stay editable text layers.

### Image tab and Asset Studio

All 78 room photos are in `brand.photography[]` (82 with the brand's original
four). They appear in the Image tab and the Asset Studio photo picker, so a
room card or a photo-led reel can use the real room, not a stock image.

### Register

`deliverables/<pack>/menus-and-venue.md` prints the room table, then one
section per room with its card photo, capacities, AV, access, source and
features. Send that to the venue.

### Verification

`deliverables/<pack>/source-verification.md` is generated by
`scripts/verify-brand-sources.js`. It checks:

- every document exists and its page count is true;
- every price token appears in the PDF(s) the menu was read from;
- every room's site phrases appear in the saved page snapshot and its
  brochure phrases on the named page;
- every capacity number appears in the source that carries it;
- every room image and gallery file exists and is listed in the pack;
- every known conflict is still recorded in the notes.

A source change fails the run rather than silently shipping a new price.

---

## 5. Using it dynamically

The content assets already carry stable ids, so an agent or a template can
address them:

| Asset | Id | Drop format |
|---|---|---|
| Room | `room-<room-id>` | `offer` (room card) |
| Offer | `venue-<offer-id>` | `offer` |
| Function menu | `menu-<menu-id>` | `menu-list` |
| Set menu | `menu-<menu-id>-pack-<n>` | `offer` |
| Dish | `menu-<menu-id>-s<i>-i<j>` | `menu-item` |

Three patterns that work with the existing animation presets:

1. **Room tour** — drop each room card, set the card photo as the layer image,
   then run a slow pan (`parallax`) or a clip reveal (`clipWipeRight`) between
   rooms. The facts stay in the text, the photo carries the atmosphere.
2. **What's included** — one offer card at a time (private dining → corporate
   → afternoon tea → Christmas), each arriving with `fadeUp` and a price
   pulse. The offer text is already the sales sentence.
3. **Christmas party** — the `christmas-lunch` / `christmas-dinner` offers
   plus the two dated Christmas menus: dates, price, deposit and the Buff Club
   line, one beat each.

Because the room and offer text is `title | detail | price`, a dropped block
can still be retyped in the inspector without touching the pack.

---

## 6. Adding or refreshing a venue

1. **Fetch the pages and photos** into `files/<brand>/sources/site/` and
   `files/<brand>/assets/photography/rooms/`. The manifest
   `sources/room-photos.json` records each remote URL, local file and size.
2. **Project the photos** into the content and the pack:

   ```bash
   node scripts/apply-room-photos.js --pack=<packId> [--brand=<brandId>]
   ```

   This fills `rooms[].image`, `rooms[].gallery` and `brand.photography[]`;
   it never edits capacities or notes.

3. **Sync the content** the app reads:

   ```bash
   node scripts/sync-brand-content.js --pack=<packId>
   ```

4. **Regenerate the register and verify the sources:**

   ```bash
   node scripts/export-menu-register.js --pack=<packId>
   node scripts/verify-brand-sources.js --pack=<packId> --verbose
   ```

5. If a source changed, edit the **content file**, not the register, and
   re-run 3–4. If a fact genuinely conflicts, add both readings to
   `venue.notes` and a `CONFLICTS` rule to the verifier.

6. Re-index the pack so the library sees the new documents and photos:

   ```bash
   curl -X POST http://127.0.0.1:8008/api/assets/index-pack \
     -H 'content-type: application/json' \
     -d '{"packId":"<packId>"}'
   ```

---

## 7. What not to do

- Do not invent a headcount, a hire fee, a minimum spend or a capacity. Empty
  is honest; a guessed number is a complaint.
- Do not merge the website and brochure versions of a conflicting fact.
- Do not drop a room's `url` or `brochurePage`; they are how the number is
  checked next year.
- Do not add a room photo to the folder without adding it to the manifest —
  `apply-room-photos.js` and the verifier both read the manifest.
- Do not treat the kids or Sunday-roast artwork as machine-verified: the kids
  PDF has no text layer and the Sunday roast is a promo image. They are
  transcribed, and the verifier says so.
