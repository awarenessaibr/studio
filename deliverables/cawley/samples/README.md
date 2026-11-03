# Boardwalk sample collateral

Rendered by **Asset Studio itself** — not redrawn for this folder. Each file is
the studio's own render of a real template with Boardwalk's palette, type,
wordmark and an approved photograph. `scripts/render-samples.js` boots the
server, opens the studio, selects the design and presses *Download PNG*, so
these are the same files an operator would get.

| File | Design | Size |
|---|---|---|
| `boardwalk-01-menus-classic.png` | Menus — Classic | A4 portrait, 1240×1754 |
| `boardwalk-02-flyers-night-photo.png` | Flyers — Night photo | A5 portrait, 1240×1754 |
| `boardwalk-03-social-posts-brand-accent.png` | Social posts — Brand accent | square |
| `boardwalk-04-gift-vouchers-brand-accent.png` | Gift vouchers — Brand accent | voucher |
| `boardwalk-05-table-cards-brand-accent.png` | Table cards — Brand accent | table card |
| `boardwalk-06-signage-digital-menu-board.png` | Signage — Digital menu board | 16:9 |
| `boardwalk-07-stationery-letterhead.png` | Stationery — Letterhead | A4 portrait |

## What the copy is, and is not

- **Address, phone, email and site** come from Boardwalk's own contact block in
  the brand guide. The studio substitutes them per brand; the flyer originally
  printed another venue's real address ("129 South Street, St Andrews") because
  the substitution only matched one exact string, and a fake company number
  ("SC000000") survived into the letterhead. Both are fixed in
  `src/client/asset-studio/app.js`.
- **Headlines and dish names are sample copy** from the design catalogue, not
  Boardwalk's live menu. They demonstrate the layout; they are not claims about
  the venue. Say so when showing them.
- **The photograph** in the flyer is `boardwalk-photo-boardwalk-bar`, captured
  from the venue's public site and approved for use on 2 November 2026.

## Regenerating

```bash
node scripts/render-samples.js \
    --pack cawley-hotels-20261031152439-d04d \
    --venue boardwalk --out deliverables/cawley/samples
```

Add `--design "Menus:Festive"` (repeatable) to render a different selection.
The script needs Chrome and the Playwright module that ships with the studio's
test harness.
