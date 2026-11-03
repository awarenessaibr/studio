# Melano Sorvetes — copy deck, brand alignment and social assets

**Scope.** The Melano Sorvetes brand pack, its published templates and a new
set of ice-cream/social assets. Locale: **pt-BR**.

**Pack kept.** `sorvetes-melano-fa-brica-de-sorvetes-pic-20261103160525-d1c0`.
The two earlier imports (`…141616-7cab` and `…144835-ee3e`) were deleted, along
with their entries in `data/settings/groups.json`.

---

## 1. What was wrong

The imported pack had **no content at all** (`content: {}`) and its palette was
scraped from the website's UI framework, not from the brand:

| Finding | Effect | Fix |
|---|---|---|
| Palette contained `#3B82F6`, `#16A34A`, `#EAB308`, `#9333EA`, `#25D366` (Tailwind/WhatsApp colours) and pure black/white | Every template looked like a generic web page, not Melano | Palette rebuilt from the logo: Melano blue, sky, yellow, red, orange, white, ink, cream, plus cacao/gold for the premium line |
| Typography was `Apple Color Emoji`, `Courier New`, `Monaco` | "Sabor de felicidade" set in a monospace/emoji stack | Poppins (display/headings) + Roboto (body); Roboto added to the font store, Poppins was already there |
| No copy deck | Templates fell back to the catalogue's restaurant sample (dish, price, address) | Authored `content.copy` for Melano, in Portuguese |
| Logo assets were two "primary" cuts of the full badge | The studio tints logos to one colour, so the badge became a white blob | Added wordmark cuts (white, ink, red) and kept the badge as a colour logo |
| Photography names were `photo 01…12` and one "photo" was just the logo | Photo selection picked a package shot and a logo | Renamed/reordered: açaí hero, Melaninho mascot, gelo line, cut-out products; logo removed from photography |
| No product cut-outs | Product shots on white could not sit on a coloured/dark ground | Seven transparent cut-outs in `assets/products/` |

---

## 2. Sources

- **Site:** `melano.com.br` — home, Quem Somos, Nossos Produtos (97 items),
  Encontre um Revendedor, Contato.
- **Facts:** 29 years, family-run, Gurupi–TO; 100+ products, 80+ flavours, 97
  items on the site; resellers in TO, PA, BA and MT; Monday–Friday
  7h30–11h30 and 13h30–17h30, Saturday 7h30–11h30; (63) 3312-2726 /
  (63) 3351-3307; atendimento@melano.com.br and comercial@melano.com.br.
- **Social crawl:** Instagram [@sorvetesmelano](https://www.instagram.com/sorvetesmelano/)
  (8,713 followers), Facebook [/melanobr](https://www.facebook.com/melanobr/)
  (1,394), Google 4.7/5 from 137 reviews.
- **Brand guide (auto):** positioning "Picolés e sorvetes com sabor de
  felicidade", applications social/business card/A-board.
- **Logo:** `logo-primary-0.png` sampled for the exact brand hexes.
- **Moodboard in the project root:** the Magnum references
  (`mag.jpeg`, `images.jpeg`, `113271659.avif`, etc.) informed the **premium**
  direction — dark chocolate, gold, product hero, ingredient detail. No
  third-party artwork, logo or copy was used in the Melano assets.

---

## 3. Brand system

| Role | Colour | Use |
|---|---|---|
| Azul Melano | `#0070D3` | Primary ground, header, call to action |
| Azul Céu | `#0098FF` | Gradients and secondary blue |
| Amarelo Melano | `#FFEC00` | Sun, highlights, badges |
| Vermelho Melano | `#FF313C` | Wordmark, urgency, appetite |
| Laranja Melano | `#FF7110` | Warm accent, açaí/sunset |
| Branco | `#FFFFFF` | Page ground, breathing space |
| Tinta | `#1A1A1A` | Body copy on light grounds |
| Creme | `#FFF6E5` | Warm paper |
| Cacau Premium | `#2B1207` | Chocolate ground for the premium line |
| Dourado Premium | `#D9A441` | Gold rules, badges and premium type |

**Type:** Poppins (display/headings) + Roboto (body). Poppins is in the font
store; Roboto was added as `data/fonts/roboto-3f2a1c.ttf`. The Melano brand is
marked `fontReady`, so published templates keep Poppins/Roboto instead of being
substituted with Helvetica.

---

## 4. Copy deck

The full deck lives at
`files/melano-com-br/content/melano-com-br.json` and is mirrored into
`pack.json` → `brands[0].content`.

### Base copy

| Slot | Copy |
|---|---|
| Eyebrow | Fábrica de sorvetes, picolés e açaí · Gurupi – TO |
| Headline | Sabor de felicidade. |
| Sub-headline | Melano Sorvetes |
| Detail | picolés · sorvetes · açaí |
| Body | Há 29 anos em Gurupi, a Melano faz sorvetes, picolés e açaí em mais de 80 sabores — e leva essa alegria a revendedores no Tocantins, Pará, Bahia e Mato Grosso. |
| CTA | Conheça os sabores |
| Bold title | Todo mundo ama. |

### Product list (used by the menu, menu board and range post)

| Produto | Linha | Tamanho |
|---|---|---|
| Açaí com leitinho | Pote 1,5 L | 1,5 L |
| Brigadeiro | Pote Deliciosíssimo 2 L | 2 L |
| Cupuaçu | Picolé ao leite | 60 g |
| Açaí trufado com avelã | Picolé | 60 g |
| Gelo de coco | Gelo para drinks | un. |

### Campaign blocks

| Block | Copy |
|---|---|
| Range | "Mais de 80 sabores." — Potes, picolés, açaí e gelo para drinks — uma linha para cada momento. |
| Reseller | "Leve a Melano para a sua região." — Fábrica familiar há 29 anos, com apoio comercial e revendedores em TO, PA, BA e MT. · (63) 3312-2726 · comercial@melano.com.br |
| Premium | "Brigadeiro." — Brigadeiro cremoso, cobertura de chocolate e 75 g de felicidade. · selo "29 anos de sabor" |
| Flavour spotlight | Picolé brigadeiro — brigadeiro cremoso com cobertura de chocolate, 75 g · CTA "Encontre um revendedor" |

### Concepts, not published offers

| Template | Copy used | Status |
|---|---|---|
| Gift voucher | "Vale-presente Melano" · R$ 50 · valid 12 months, participating resellers | **Concept** — no gift voucher is documented on the site |
| Christmas/festive | "Natal Melano" · December · gift kits | **Concept** — no festive campaign is documented on the site |

If Melano does not run gift vouchers or Christmas kits, say so and these two
templates will be re-worded or dropped.

---

## 5. Templates

### Existing catalogue (13, regenerated)

Menu, business card front/back, flyer, table card, gift voucher, social post,
story, reel, square loop, display screen, digital menu board, link preview.

### New ice-cream templates (6)

| ID | Label | Size | What it does |
|---|---|---|---|
| `flavour-card` | Flavour spotlight | 1080×1350 | Blue 4:5 card: cut-out picolé, "Direto da fábrica", size badge, reseller CTA |
| `flavour-story` | Flavour story | 1080×1920 | The same idea in Stories format |
| `range-social` | Range post | 1080×1080 | "Mais de 80 sabores" with three cut-out products |
| `reseller-social` | Reseller post | 1080×1350 | Recruitment: "Seja um revendedor", phone, email, CTA |
| `premium-social` | Premium post | 1080×1350 | Chocolate + gold, brigadeiro cut-out, 29-year seal |
| `premium-story` | Premium story | 1080×1920 | Premium post adapted to Stories |

They are filtered by `content.copy.kind === 'ice-cream'`, so they appear for
Melano (and any future ice-cream brand) but not for Cawley or the other packs.

### Exported assets

`deliverables/melano-social/` (PNG, exact pixel sizes):

1. `01-premium-story.png` — 1080×1920
2. `02-flavour-story.png` — 1080×1920
3. `03-premium-post.png` — 1080×1350
4. `04-reseller-post.png` — 1080×1350
5. `05-range-post.png` — 1080×1080
6. `06-flavour-spotlight.png` — 1080×1350
7. `07-digital-menu-board.png` — 1920×1080
8. `08-menu.png` — 2480×3508 (A4 300 dpi)

Re-export with:

```bash
node scripts/export-brand-templates.js \
  --pack=sorvetes-melano-fa-brica-de-sorvetes-pic-20261103160525-d1c0 \
  --brand=melano-com-br --out=deliverables/melano-social \
  --templates="Menu,Digital menu board,Premium post,Flavour spotlight,Range post,Reseller post,Premium story,Flavour story"
```

---

## 6. Open items

1. **No prices.** The site does not publish prices. The menu uses pack sizes in
   the price column; add a price list before a customer-facing print run.
2. **Product cut-outs are packaging, not ice cream.** The pack only has pack
   shots. The premium/flavour layouts use cut-out packaging; a real product
   photo (unwrapped picolé, cut, on dark) would lift the premium line further.
3. **Flavour-to-image mapping.** Not every listed flavour has a pack shot
   (açaí trufado picolé, cupuaçu picolé, pistachio). Supply two or three more
   product photos to rotate the flavour spotlight weekly.
4. **Gift voucher and Christmas kits** are concepts, as flagged above.
5. **Reseller story.** The campaign names the commercial phone and
   `comercial@melano.com.br`; confirm this is the right inbox and that the
   distributors in `onde-encontrar` can be named regionally.
6. **"29 anos"** is taken from the site; check it stays current in 2027.
7. **Logo cuts.** The wordmark cuts were extracted from the raster logo. If the
   original vector wordmark exists, replace
   `assets/logos/melano-wordmark-*.png` with clean SVGs.
8. **Licensing.** Poppins and Roboto are open-licensed; the uploaded font files
   are the studio's copies. Confirm Melano is happy with these families before
   a print run.

---

## 7. How to re-run

```bash
# 1. content file → pack.json
node scripts/sync-brand-content.js --pack=sorvetes-melano-fa-brica-de-sorvetes-pic-20261103160525-d1c0

# 2. regenerate all 19 templates
node scripts/publish-brand-templates.js --pack=sorvetes-melano-fa-brica-de-sorvetes-pic-20261103160525-d1c0 --force

# 3. export the social set
node scripts/export-brand-templates.js --pack=sorvetes-melano-fa-brica-de-sorvetes-pic-20261103160525-d1c0 --brand=melano-com-br --out=deliverables/melano-social
```
