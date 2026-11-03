# Owner-facing artefacts

What is in here is generated, not drawn. Both artefacts read the same pack that
the studio reads, so a correction in the data lands on the page. Nothing is
retyped, and nothing here is hand-tuned per venue.

```
deliverables/<group>/
├── group-identity-map.png           five venues on one page
├── bobby-s-sub-brand-map.pdf        one name traced across the group (A4 landscape)
├── <venue>-one-pager.html|.pdf      A4 scorecard, one page per venue
├── cawley-asset-register.xlsx       provenance register: summary, register, corrections
├── cawley-asset-register.csv        the same rows, machine-readable
└── samples/                         collateral rendered by Asset Studio
```

## Cawley Hotels (`deliverables/cawley/`)

| File | What it shows |
|---|---|
| `group-identity-map.png` | Five lockups, five primaries, the shared Cawley Grey, and the contrast each pairing actually achieves — with Coast (1.6:1) and Duck Bay (2.3:1) called out against the 3:1 floor. |
| `boardwalk-one-pager.pdf` | Falkirk. 4.5 consensus over 6,969 reviews, 48 read in full; 0.5 point spread between platforms; 6% owner response; social last dated 2022-06-17. |
| `river-house-one-pager.pdf` | Stirling. 0% owner response across 50 reviews read; trend 3.75 recent vs 4.11 older. |
| `coast-one-pager.pdf` | Langbank. |
| `duck-bay-one-pager.pdf` | Loch Lomond. |
| `bobby-s-sub-brand-map.pdf` | Bobby's across the group: four venues, four descriptions, no lockup — and the guides only document three of them. |
| `cawley-asset-register.xlsx` | All 50 indexed assets: provenance, rights, approval, who cleared them — plus every correction made to the pack. |
| `samples/` | Seven Boardwalk designs rendered by Asset Studio: menu, flyer, social post, voucher, table card, digital board, letterhead. |

Boat Yard has no scorecard on purpose: it has brand assets and a guide but no
social or reputation crawl, so its profile carries `status: not-crawled`. The
generator refuses to invent one.

## Regenerating

```bash
python3 scripts/build-identity-map.py \
    --pack cawley-hotels-20261031152439-d04d \
    --out deliverables/cawley/group-identity-map.png

node scripts/build-venue-scorecard.js \
    --pack cawley-hotels-20261031152439-d04d \
    --venue boardwalk --out deliverables/cawley --pdf
```

Both scripts accept any pack id under `data/brand-packs/`. Drop `--pdf` to get
just the HTML (open it and print to A4 yourself).

## What is deliberately absent

- **No unapproved photography.** All 50 Cawley assets were approved for use on
  2 November 2026 on the owner's instruction, recorded per asset with who
  cleared it. The register shows the approval and the rights record separately:
  approval is a decision, rights are a fact.
- **No promise of an outcome.** Actions are states that can be observed —
  reply coverage, an idle calendar, contact data that disagrees — not forecasts
  about ratings or revenue.
- **No client-supplied material.** Everything derives from publicly available
  business information; the pack says so in `provenance` and every page repeats
  it in the footer.
