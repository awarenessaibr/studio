I'll check current platform specs first, since digital sizes change often.

I read section 4 against the six existing categories and checked current platform specs. Your current 25 designs are all single-canvas, mostly print, and weighted toward promotion (flyers, vouchers, social). The gaps are drinks and takeaway menus, signage, screens, guest and hotel items, stationery, packaging, multi-slide social and compliance material (which suits your KitchenOS brands).

I picked 25 more across five new categories plus extensions to Menus and Social. Print sizes are in mm because your pixel presets use different dpi values.

**Signage and posters (new category, 5\)**

| \# | Design | Sizes |
| ----- | ----- | ----- |
| 1 | A-board special (chalkboard, photo and bold-colour variants) | A1 594×841 mm portrait |
| 2 | Event poster (live music, quiz, sport) | A3 and A2 portrait |
| 3 | Digital menu board | 1920×1080 landscape, 1080×1920 portrait |
| 4 | Roll-up banner | 850×2000 mm |
| 5 | Opening hours and notice sign (open, hiring, please wait to be seated) | A4 portrait, A5, DL |

**Menus (extend, \+4)**

| \# | Design | Sizes |
| ----- | ----- | ----- |
| 6 | Drinks / cocktail list | A4, A5, DL |
| 7 | Wine list (two columns, glass and bottle price columns) | A4 portrait |
| 8 | Kids menu with activity side | A4 landscape and portrait |
| 9 | Takeaway / delivery menu with order QR | A5 portrait, DL |

**Guest and hotel cards (new category, 4\)**

| \# | Design | Sizes |
| ----- | ----- | ----- |
| 10 | Loyalty stamp card (6, 8 or 10 stamps, front and back) | 85×55 mm |
| 11 | Review-us card (large QR to Google or TripAdvisor) | 85×55 mm, A6 |
| 12 | Door hanger (do not disturb / service please) | 90×210 mm, die-cut |
| 13 | Welcome and Wi-Fi card (network, password, join QR, breakfast hours) | A6 105×148 mm |

**Stationery (new category, 2\)**

| \# | Design | Sizes |
| ----- | ----- | ----- |
| 14 | Letterhead | A4 portrait |
| 15 | Thank-you / compliment card | DL landscape, A6 |

**Packaging and merch (new category, 4\)**

| \# | Design | Sizes |
| ----- | ----- | ----- |
| 16 | Round sticker / bag seal | 50 mm and 70 mm circle |
| 17 | Coaster | 90 mm round, 95 mm square |
| 18 | Cup or bottle sleeve (wrap) | about 230×90 mm, die-cut |
| 19 | Voucher envelope / sleeve (pairs with your gift vouchers) | DL, C6 |

**Digital and social (extend, \+4)**

| \# | Design | Sizes |
| ----- | ----- | ----- |
| 20 | Carousel set (3 to 10 slides sharing one style) | 1080×1350, 1080×1080 |
| 21 | Link-share image | 1200×630 |
| 22 | Cover banner | Facebook event 1920×1005, Facebook page 820×312, LinkedIn 1584×396 |
| 23 | Email header | 1200×400 (shows at 600 px wide) |

**Compliance (new category, 2\)**

| \# | Design | Sizes |
| ----- | ----- | ----- |
| 24 | Allergen matrix (14-allergen grid) | A4 landscape |
| 25 | Prep / day-dot label | 50×30 mm, 76×51 mm |

**Platform specs.** Sources disagree slightly, so treat these as defaults and let the Size tab hold alternates:

* Facebook event covers are recommended at 1920×1005 pixels, and LinkedIn personal covers at 1584×396.  
* LinkedIn company covers are a much shallower 1128×191, so keep key content centred.  
* A 1200×630 image is the recommended size for link previews and shared content.  
* Instagram feed images accept ratios between 1.91:1 and 4:5, which is why 1080×1350 is your safe carousel size.  
* One source gives a smaller 1200×628 minimum for Facebook event covers, so I'd offer both.

**What each item needs from the engine**

* **Fits today** (rectangular, single canvas, existing fields): 1, 2, 3, 5, 6, 8, 9, 11, 14, 15, 21, 22, 23\.  
* **Needs tabular copy input** (rows and columns, not free text): 7 (wine list), 10 (stamp grid), 24 (allergen matrix). Your Menus tab already handles `#` headings, so a column syntax would extend that.  
* **Needs multi-frame output:** 20 (carousel), exported as numbered PNGs or one PDF. Business cards already handle two sides, so there is a precedent.  
* **Needs die-cut or non-rectangular output** (a cut-line layer in the print pack, plus a circular or shaped clip): 12, 16, 17, 18, 19\.  
* **Needs large-format scaling:** 1 and 4 should cap at 100 to 150 dpi, which your 150 dpi draft option already supports.  
* **Needs a different export profile:** 3, 20 to 23 are screen-only, so hide Print pack and offer PNG/JPG. Item 25 is thermal, so greyscale and no CMYK.

**Suggested order**

1. **Wave 1, high value and low effort:** A-board (1), digital menu board (3), drinks list (6), takeaway menu (9), loyalty card (10), review-us card (11), welcome and Wi-Fi card (13), carousel (20), link image (21), cover banner (22).  
2. **Wave 2, still simple layouts:** event poster (2), roll-up (4), notice sign (5), wine list (7), kids menu (8), letterhead (14), thank-you card (15), email header (23), allergen matrix (24).  
3. **Wave 3, needs die-cut or label support:** door hanger (12), sticker (16), coaster (17), sleeve (18), voucher envelope (19), prep label (25).

Per group, the hotel items suit Cawley, wine and drinks suit Monteleone, and the allergen and label items suit KitchenOS. Brand-specific designs that aren't relevant to a brand could be hidden at the gate rather than shown as empty categories.

I can turn this into a spec with copy fields, default text and size presets for each of the 25 designs, in the same format as section 4\. Would that help?

I've built the spreadsheet with four sheets: Summary, Roadmap (the 25 designs), Sizes (44 presets) and Notes & sources. Its totals recalculated cleanly and all the cross-checks on the Summary read OK.

* **Summary:** shows the 25 existing designs plus 25 proposed, so 50 in total. It then counts the new designs by category, wave, engine requirement and export profile, and tracks how many are Done.  
* **Roadmap:** has one row per design with its category, description, sizes, export profile, engine requirement, wave and suggested brand fit. Status (a dropdown), Owner and Notes are yellow cells for you to fill in.  
* **Sizes:** lists each preset in mm or px. The working-dpi cells are editable, and the pixel dimensions and megapixels recalculate from them.  
* **Notes & sources:** records my assumptions and the platform spec sources, which I checked on 31 Oct 2026\.

Two things differ slightly from my earlier answer:

* I counted the Welcome & Wi-Fi card as "fits today". I left it off that list in my reply.  
* The A-board (A1) is classed "fits today", and only the roll-up banner is tagged large-format scaling. The A1 working size is capped at 100 dpi, so its file stays under 8 MP.

The A1/A2/roll-up dpi values, the sleeve and door-hanger sizes, and the wave rankings are my assumptions. Final sizes should come from your printer's die-lines.

Files are in /mnt/user-data/outputs:

* asset-studio-next-25-designs.xlsx

