# Brand intake — the combined crawler and its UI

The intake surface turns a business name into an importable brand pack:

```
name → web search → website + profiles → full crawl → brand-kit ZIP → Asset Studio
```

It is a thin studio UI over **[scripts/crawler-combined.py](../scripts/crawler-combined.py)**,
the single Python pipeline that runs the website crawler and the social /
reputation crawler in one pass. The UI never reimplements the crawl; it
searches, confirms the target, starts the process, streams its log and imports
the finished ZIP.

| Surface | Where |
|---|---|
| Intake UI | `/crawler.html` (linked as **Brand intake** in Layer Studio and Asset Studio) |
| Node job/API layer | [src/server/crawler-service.js](../src/server/crawler-service.js) |
| Python crawler | [scripts/crawler-combined.py](../scripts/crawler-combined.py) |
| Output | `data/_crawler/runs/<run-id>/output/` + the ZIP |
| Imported pack | `data/brand-packs/<pack-id>/` |

---

## 1. Before the first run

The Python side is the only dependency-bearing part of the project. Use the
project virtualenv; the Node app remains zero-dependency.

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/playwright install chromium

node server.js
# open http://127.0.0.1:8008/crawler.html
```

`src/server/crawler-service.js` automatically uses `.venv/bin/python` when it exists and
falls back to `python3`. Override with `STUDIO_PYTHON=/path/to/python`.

The readiness pill at the top of the page reports:

- Python version and whether it is a venv,
- Playwright/Chromium availability (needed for Maps search and Google reviews),
- `pdftotext` (PDF menus),
- Pillow (image dimensions, palette/specimen PNGs).

The Node server loads the project **`.env`** at startup (it is git-ignored)
and passes it to the Python child. Keys can also come from the normal
environment; `.env` never overrides a variable that is already set.

Optional keys unlock better sources:

| Variable | What it improves |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Authoritative place search + more Google reviews |
| `SERPAPI_KEY` | More Google reviews: pagination when available, otherwise a small sort/topic sweep (5 reviews per request on the Free Plan) |
| `FB_GRAPH_TOKEN` | Facebook Graph data |
| `TIKTOK_RESEARCH_TOKEN` | TikTok Research API |

Without keys the crawler still runs: Google Maps is read through a headless
browser, reviews are limited to the ~5 Google exposes anonymously, and
bot-walled sources record a warning instead of failing the run.

---

## 2. The UI flow

### Step 1 — Find the business

Search by name, with an optional town/city. The search is deliberately a
**place lookup**, not a generic web crawl:

1. Google Places Text Search, when `GOOGLE_PLACES_API_KEY` is set;
2. Google Maps in a headless browser (primary, no key);
3. OpenStreetMap/Nominatim (name + address, often no website);
4. the crawler's Bing/DuckDuckGo web search (last resort).

Each result becomes a candidate with name, website, address, phone, category,
rating/review count and a map link. If no website is returned, the card says
so and the manual **“I know the website”** form is always available.

> Google Maps is the most reliable provider here because it returns the
> official website, address and phone from the listing. Search-engine HTML is
> increasingly bot-walled; Nominatim frequently has no `website` tag.

### Step 2 — Confirm what we found

Selecting a candidate shallow-crawls the website (six pages by default) and
shows:

- editable name, website, city, category, address and phone;
- a status row for **Instagram, Facebook, TikTok, Tripadvisor, Google and
  YouTube**:
  - **OK** — a profile URL was found (linked from the site, structured data,
    Google Maps for the rating, a verified handle or a manual paste);
  - **NO** — no link was found; the reason is shown (for example
    “No TikTok link on the website.”);
  - **—** — Google is collected during the full run rather than at discovery.
- a per-row URL field, so a missing profile can be pasted before the run;
- **Try handle guesses** (verify plausible handles) and **Re-check**.

Missing profiles are **not** a blocker. They are recorded, not invented.

### Grouping more than one restaurant

The intake can build a group from several businesses without a separate CLI
run. On the confirm step:

1. use **Add to group** instead of continuing;
2. the page clears the form but keeps a **Restaurant group** card in the sidebar;
3. search and confirm the next restaurant, then add it too;
4. remove an entry with ×, or **Clear** the whole group;
5. press **Run group** (or use **Start full crawl** from the run step).

The queue is capped at **12 restaurants** and de-duplicated by website. It is
kept in `localStorage`, so a refresh does not lose the group. The server writes
the whole queue to `target.json` and passes every website to the Python process.
Python then runs the group **sequentially** — `[1/N]`, `[2/N]`, … — with the
same `--group` name, and produces **one group brand-kit ZIP** containing every
brand and the group portfolio/report.

The progress panel shows the queue with `current`, `done` and `pending` states;
`currentIndex`/`currentUrl` come from the crawler's own `[n/N]` log lines. A
failed restaurant is recorded and the remaining restaurants still run.

### Step 3 — Run the crawl

Options:

| Option | Default | Notes |
|---|---|---|
| Group name | first business name | becomes the pack group; edit it for a real group name |
| Pages to crawl | 60 | 20 quick / 60 standard / 120 deep |
| Reviews per source | 20 | 0 disables review text |
| Social posts per profile | 6 | 0 disables post collection |
| Social & reputation phase | on | can be switched off for a website-only pack |
| Headless browser | on | needed for Google reviews and JS sites |
| Deep search for missing profiles | off | slower; tries more discovery |

The run is a managed background job. The page streams:

```
website → social → package → done
```

and the log updates every two seconds. It is safe to leave the page and return
through **Recent runs**; jobs are recorded under `data/_crawler/runs/<id>/`.

When the ZIP is ready:

- **Import into Asset Studio** — the server reads the ZIP and calls the normal
  brand-pack importer, so there is no download/upload round-trip;
- **Download ZIP** — the raw file;
- **Open in Asset Studio** — deep-links to the imported group with
  `asset-studio.html?pack=<pack-id>`.

Runs can be cancelled; cancelling terminates the Python process group.

---

### Social-only re-crawls from Social intelligence

The Social page can start a focused social run for one business when the
administrator enables it in Management. That path calls the same script with:

```bash
.venv/bin/python scripts/crawler-combined.py \
  --social-only --standalone \
  --output-root data/_crawler/runs/<run>/output \
  --max-reviews 20 --max-posts 6 [--only instagram,google] [--deep] …
```

The run writes `output/targets.json` with the single target (this is what keeps
it to one business instead of every configured site) and lands its profile at
`output/_social/<slug>/business.profile.json`, where the Social index reads it.
No brand-pack ZIP is produced. See [social-intelligence.md](social-intelligence.md#running-a-crawl-for-this-business)
for the UI options.

## 3. What the crawler produces

The ZIP is the normal studio brand-pack contract:

```
<Group>-brand-kit/
├── README.md
├── targets.json
├── 00-portfolio/
│   ├── <Group>-Overview.docx
│   ├── portfolio.json
│   ├── group.report.md          # after a social run
│   └── group.summary.json
└── 01-<brand>/
    ├── <brand>-Brand-Guide.docx
    ├── brand-guide.json
    ├── tokens/<brand>.tokens.json
    ├── content/<brand>.json
    ├── cover.<ext>
    ├── assets/logos|photography|colors|type/
    └── social/                  # after a social run
        ├── business.profile.json
        ├── insights.md
        ├── report.html
        ├── reviews.csv / reviews.all.json
        ├── src/client/social/social.json
        ├── social-profile.json
        └── assets/
```

### Brand pack and studio mapping

| Output | Studio consumer |
|---|---|
| `tokens.brand`, `color`, `typography` | pack header, palette, type, all Asset Studio designs |
| `assets/logos` | logo slot; typographic fallback when empty |
| `assets/photography` + `cover` | photo-led designs, gate/identity imagery |
| `content/menu`, `content/drinks`, `content/hours` | menu designs prefill from the crawled menu; table cards/compliance do not use it yet |
| `brand-guide.json`, `*-Brand-Guide.docx` | Brand identity guidelines, contact, applications |
| `applications`, `brandFit` | intended collateral/categories (not yet consumed by Asset Studio) |
| `social/*` | research dossier; not imported as brand assets |

The social outputs are read by the **Social intelligence** surface; see
[social-intelligence.md](social-intelligence.md). The importer deliberately **does not** treat `social/social-profile.json` or
`social/assets/*` as another brand or as brand photography. Earlier output
used `social.tokens.json`, which the importer mistook for a second brand
(`<brand>-social`); that is fixed on both sides.

### `platforms/` — evidence, not a checklist

`social/platforms/<source>.json` exists only for a source that returned
something: `ok`, or a real profile URL, or a payload. A source that was
searched but never located goes to `social/platforms/_discovery.json`
instead, with `status: "not_found"` and the query that was tried.

That split exists because a folder full of
`{ ok: false, url: null, warnings: ["no … URL discovered"] }` reads like a
list of platforms in a file tree, and both people and agents have reported
those as venue gaps nobody verified. The two are not the same thing:

| File | Means |
|---|---|
| `platforms/<source>.json` | The venue is on this source; here is what it said. |
| `platforms/_discovery.json` | We looked for a profile here and did not find one. |

The provenance tables in `insights.md` and `report.html` follow the same
rule: they list only sources that were actually consulted, and summarise the
rest in one line as *discovery gaps, not platform gaps*.

**Embedded widgets count.** Booking and delivery are routinely an `<iframe>`
from the provider (ResDiary, SevenRooms, OpenTable) rather than a link. The
website connector scans `<a href>`, `<iframe src>` and `<embed src>`, because
scanning anchors alone reports "no online booking" for venues that have had
one for years. If a booking row looks wrong, open the live
`/book-a-table/` page and look for the widget before trusting the metric.

---

## 4. What was fixed in the combined crawler

These were real defects found while reviewing the July Dalton group output:

1. **Wix/Squarespace images were all dropped.** The crawler only allowed the
   site's own domain, while Wix serves media from `static.wixstatic.com`. It
   now allows a CDN allowlist (`wixstatic`, `squarespace-cdn`, `cloudfront`,
   `imgix`, `ctfassets`, Shopify, etc.).
2. **`srcset` was split on the commas inside Wix URLs**, producing fake names
   like `v.WEBP` and `a.fileType.GIF`. It now parses `url 1x/2x` and prefers
   the largest cut, including `<picture><source>`.
3. **HTML error pages were saved as images.** Downloads are now rejected on
   `text/html`, verified with Pillow, and tiny images are discarded.
4. **Photos were not deduplicated.** The same image at six sizes is grouped
   by media id; up to `MAX_CURATED_PHOTOS` (12) distinct, ≥600 px photos are
   kept, print-ready flagged at ≥2000 px. A cover falls back to the best photo.
5. **Menus with the price on the next line produced no content.** The parser
   now handles `item / description / £price`, skips page chrome, and picks
   section headings without turning every item into a section.
6. **A 10:1 SVG logo rendered as 300×150** because BeautifulSoup lowercased
   `viewBox`; inline SVGs now get `viewBox`/`preserveAspectRatio` casing and
   explicit `width`/`height`.
7. **Wix theme colours became the brand accent.** Known Wix UI colours
   (`#116dff`, `#f9ad4d`, `#f4b8b9`, …) are filtered before role assignment.
8. **Font lists were full of framework internals.** `wf_`, `wfont_`,
   `HelveticaNeueW01`, CJK fallbacks and CSS fragments are dropped; Adobe
   names are normalised (`brandon-grot-w01-light` → *Brandon Grotesque*);
   a display → body scale is synthesised when the CSS only yields 10 px body.
9. **A custom group still described itself as Julie Dalton.** Description,
   slug and README now follow `--group`; `00-portfolio` is no longer listed
   as a brand.
10. **A confirmed target address was overwritten by a footer address.** A
    Maps/UI target (or `--targets` hints) now wins before the guide is
    written — so The Physician gets 129 South Street, not the Adamson's 127.
11. **Every Google Places lookup failed with HTTP 400.** The Places API (New)
    field mask requested `places.servesCuisine`, which the API rejects as an
    unknown field ("Cannot find matching fields") — failing the whole request
    even though rating and reviews were available. The field is no longer
    requested, so Google rating/reviews load when `GOOGLE_PLACES_API_KEY` is
    set (verified: The Physician, 3.7 · 65 reviews).
12. **Press and partner logos filled the logo slot.** A 32-file
    `assets/logos/` was all *Exame*, *Vogue*, *Monashees* and social icons.
    Logos are now only taken from the header/nav (or a same-site link), and
    press-wall containers, third-party-linked images and known outlet/partner
    names are rejected. Inline SVG marks are written first, at most three
    logos are kept, and at most `MAX_CURATED_LOGOS` files enter the kit.
13. **External SVG wordmarks were downloaded and then deleted.** `.svg` is an
    image extension but Pillow cannot open it, so every header wordmark was
    printed as "Discarding non-image download". Downloads are now sniffed for
    a real `<svg>` root, sized from `viewBox`/`width`, kept as `.svg`, given
    the camel-case `viewBox`/`preserveAspectRatio` casing, and stripped of
    `<script>`, `<foreignObject>`, `on*` handlers and `javascript:` hrefs.
14. **Every venue without an explicit country was treated as British.** The
    Lisbon cafe inherited `country: "United Kingdom"`, so the UK FSA lookup
    ran, "matched" an unrelated shop at score 0.5, and published a live
    `ratings.food.gov.uk` URL for it. Country now comes from the address
    (`COUNTRY_HINTS`) and postal evidence wins over a stale `targets.json`
    label (`resolve_target_country`), stays blank when unknown, is checked
    against the declared country in `reconcile_identity` (a mismatch is a
    conflict), and the FSA connector skips non-UK/unknown venues and never
    emits a ratings URL below `0.55`. `--report-only` re-reads saved platform
    JSON, so `drop_offshore_results` also discards a cached UK rating for a
    non-UK venue; such skipped sources are reported as *not applicable*
    instead of as discovery gaps. `normalize_phone` keeps non-UK numbers as
    written instead of returning `None`.
15. **Unused video downloads dominated the run.** A single crawl pulled 137 MB
    of `.mp4` (one clip 51 MB) that nothing in the brand pack reads. Videos are
    now listed in `discovered_media.csv` but not downloaded; `--with-videos`
    restores the old behaviour.
16. **Photography was capped at six photos.** `MAX_CURATED_PHOTOS = 12`; the
    dedupe-by-media-id and ≥600 px rules are unchanged.
17. **Profile URLs were used exactly as typed.** A hand-entered
    `youtube.com/thecoffeejp` went straight to the connector and 404'd, and
    `instagram.com/name/?igshid=…` was stored with tracking noise.
    `canonical_profile_url` rebuilds social URLs from their identity segment
    (`@handle`, `/channel/UC…`, `/company/x/`, `/in/x/`), keeps legacy
    `/c/`, `/user/` paths intact, drops tracking parameters everywhere, and is
    applied to seeds, website links, structured data, search hits and handle
    guesses. Restaurant Guru slug guesses now use `slugify` (lowercase) instead
    of a capitalised ad-hoc slug. The Maps fallback URL takes `hl`/`gl` from the
    venue country instead of hardcoded `en-GB`.
18. **A dead seed still ran its connector.** `drop_dead_seeds` probes each
    seeded social URL before the social phase; a `404`/`410` removes it from the
    plan and is listed under provenance as a rejected seed, so the report says
    "rejected" rather than "platform empty".
19. **Presence and gaps were misleading.** `ok` alone counted as presence, an
    empty profile page made a platform look active, and gaps were a hardcoded
    Instagram/Facebook/TikTok/YouTube list — LinkedIn was invisible and a
    never-discovered YouTube looked like a defect. Presence now needs a real
    profile field (handle, name, followers, bio, …) or fetched posts; `gaps`
    means "URL known but unreadable" and `not_discovered` is reported
    separately.
20. **`collected_reviews` never matched the per-source counts.** The headline
    number is de-duplicated (author + first 80 chars); `duplicates_merged` and
    `collected_raw` are now published next to it, and the markdown report shows
    the delta.

### Client-rendered sites (Vite/React/Next shells)

Found on `melano.com.br`, which returned a 1.3 KB shell (`<div id="root"></div>`
plus one module script) and produced **1 page, 2 media, no logo, no address** —
the UI still reported success:

21. **A single-page app was crawled as an empty shell.** Only `requests` was
    used, so `extract_links`, `extract_page_text` and `extract_brand_data` all
    read markup with no content. `crawl_pages` now recognises a shell
    (`looks_like_js_shell`: <60 elements, ≤2 media, <600 chars of text, and a
    `#root`/`#app`/`__next`/`__nuxt`/`___gatsby` mount) and, after the static
    pool, renders the seed and up to `SPA_MAX_ROUTES` same-origin routes with
    the browser (`render_js_site`). The same browser pass now runs if HTTP
    returns no HTML at all (for example, when a site blocks the crawler's HTTP
    client), rather than treating that as a terminal failure. Playwright is
    thread-bound, so this pass is serial on the main thread and runs after the
    thread pool. Rendered HTML is written back into `_page_cache`, so the social
    phase reuses it instead of refetching the shell. `--no-browser` or
    `CRAWLER_RENDER_JS=0` skips the render pass; bundle harvesting (below) still
    contributes media when a shell was fetched, so a JS-only site degrades to
    photography without text.
22. **Images imported by the JS bundle were invisible.** A Vite build ships
    `assets/logo-melano-L1W7aZ4g.png` as a module import, so no `<img>` ever
    exists in the DOM. `harvest_bundle_assets` reads up to `BUNDLE_MAX_FILES`
    same-origin `.js`/`.css` files and pulls asset paths out of them; those
    become photography. Assets whose filename matches `logo|logotipo|wordmark|
    marca` become logo candidates (source `bundle`) instead, because the
    filename is the only evidence available. Melano now yields 20 media, a
    1920×1082 wordmark, an 1080×302 SVG lockup and 12 photos.
23. **Route queries duplicated renders.** `_route_key` collapses scheme,
    trailing slash and query so `/produtos?categoria=acai` renders once.
24. **A store locator became the brand's phone list.** Melano's
    `onde-encontrar` page lists every franchisee's mobile, so the guide carried
    15 numbers. `select_brand_phones` prefers numbers from the home and contact
    pages, ignores store-locator pages, and caps a directory-only fallback at 3.
    The pack now shows the two brand numbers.
25. **A `+55` number was dropped.** `normalize_phone` sent unknown-country
    numbers through the UK rules, so `tel:+556333513307` became `None`. An
    explicit foreign dialling code (`+` other than `+44`, `00` other than
    `0044`) is now returned as-is, and a `CEP 00000-000` postcode identifies
    Brazil.
26. **Every pack claimed `en-GB`/`GBP`.** Locale and currency now follow the
    address country (`LOCALE_BY_COUNTRY`); Melano is `pt-BR`/`BRL` and an
    unknown country still falls back to the defaults.
27. **The social phase still reported "1 page crawled".** `discover_from_website`
    re-fetched the site with `requests` (getting the shell again) and only
    followed English nav words, so a Portuguese menu — *Sobre*, *Contato*,
    *Onde Encontrar* — was never queued. It now reuses the rendered HTML from
    `_page_cache` (tolerating scheme/trailing-slash drift) and follows a
    localised `DISCOVERY_PAGE_PATTERN`: 11 pages instead of 1.
28. **Store-locator numbers were reported as NAP conflicts.** The franchisee
    mobile list produced six `phone` conflicts and cost ~8 score points. Pages
    that look like a locator (`onde-encontrar`, `lojas`, `franquia`,
    `distribuidor`, …) no longer feed the NAP text blob; their numbers were
    already excluded from the pack by `select_brand_phones`.
29. **`- TO` in a Brazilian address resolved to Greece.** `normalize_text`
    strips non-Latin scripts, so Greek hints de-accented to `''` and matched
    every string. Hints that normalise to empty are now ignored, and an HTML
    `<address>`/`itemprop` block is read before falling back to `tel:`/`mailto:`
    scraping.

Verified end to end on `melano.com.br`: **5 pages, 20 media, 12 photos, 2 logo
files (PNG wordmark + SVG lockup), full address/phones/emails, `pt-BR`/`BRL`,
score 57.2**, against 1 page / 2 media / no logo / no address before.

---

## 5. CLI reference

The Python script still works standalone. The UI only uses the JSON modes.

```bash
# normal configured run (SITES + TARGET_OVERRIDES)
.venv/bin/python scripts/crawler-combined.py

# one site, website only
.venv/bin/python scripts/crawler-combined.py https://example.com/ \
  --max-pages 40 --skip-social --output-root data/_crawler/manual --group "Example"

# also fetch the (otherwise skipped) video files
.venv/bin/python scripts/crawler-combined.py https://example.com/ --with-videos

# one site with confirmed target and profiles
.venv/bin/python scripts/crawler-combined.py https://example.com/ \
  --targets data/_crawler/targets/example.json \
  --output-root data/_crawler/manual --group "Example" \
  --group-description "Intake crawl for Example." --deep

# social only, from saved targets
.venv/bin/python scripts/crawler-combined.py --social-only

# rebuild reports without network
.venv/bin/python scripts/crawler-combined.py --report-only
```

### Intake modes (used by the UI)

```bash
# environment / dependency readiness
.venv/bin/python scripts/crawler-combined.py --status-json

# business search
.venv/bin/python scripts/crawler-combined.py \
  --search-json "The Physician" --search-city "St Andrews"

# shallow website + profile discovery
.venv/bin/python scripts/crawler-combined.py \
  --discover-json --website https://www.thephysician.bar/ \
  --name "The Physician" --city "St Andrews" --category "Bar" \
  --maps-json '{"rating":3.7,"reviews":65,"address":"129 South St, St Andrews KY16 9UH"}' \
  --profiles-json '{"instagram":"https://www.instagram.com/thephysician_standrews/"}'
```

JSON modes print a single line prefixed with `@@CRAWLER_JSON@@`; all normal
log output is captured. Search/discovery are read-only.

---

## 6. API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/crawler/runs` | Full website + social group/standalone run |
| `POST` | `/api/social/:id/crawl` | One-business social-only run, gated per business in Management |
| `GET` | `/api/crawler/runs/:id` | Status, phase and log |
| `POST` | `/api/crawler/runs/:id/cancel` | Cancel |
| `GET` | `/api/crawler/status` | Python/Playwright/key readiness (booleans only) |

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/crawler/status` | readiness, versions, keys (booleans only) |
| POST | `/api/crawler/search` | `{query, city}` → candidates |
| POST | `/api/crawler/discover` | `{website, name, city, category, maps, profiles, guessProfiles}` → business + per-platform status |
| POST | `/api/crawler/runs` | `{target}` or `{targets:[...]}` → 202 with run status |
| GET | `/api/crawler/runs` | recent runs |
| GET | `/api/crawler/runs/:id` | state, phase, targets, currentIndex/currentUrl, log tail, ZIP |
| GET | `/api/crawler/runs/:id/log` | log only |
| POST | `/api/crawler/runs/:id/cancel` | terminate the process group |
| GET | `/api/crawler/runs/:id/zip` | download the ZIP |
| POST | `/api/crawler/runs/:id/import` | import the ZIP into Asset Studio (idempotent per run) |

Inputs are validated: http(s) only, no credentials, no localhost/private
addresses, bounded strings/numbers, and at most two concurrent runs. The
Python process is started with an argument array — there is no shell string.

---

## 7. Known limits / what to check

### `Can't connect to HTTPS URL because the SSL module is not available`

This is a Python installation problem, not a crawler problem: the venv's
`_ssl` extension cannot find its OpenSSL dylib. It happens when a Homebrew
`python@3.14` upgrade is interrupted and `openssl@4` is left half-linked
(`Cellar/openssl@4/4.1.0.reinstall` with no `4.1.0`).

```bash
brew reinstall openssl@4
.venv/bin/python -c "import ssl; print(ssl.OPENSSL_VERSION)"
```

Then rerun the crawl. The Social dialog now marks a run **failed** when it
exits without writing `business.profile.json`, instead of reporting “complete”.



- **Search provider.** Google Maps returns the best single place; ambiguous
  names may still need the town or a manual website URL. If Maps is blocked,
  Nominatim candidates often lack a website.
- **Reviews.** Without `GOOGLE_PLACES_API_KEY`/`SERPAPI_KEY`, Google exposes
  about five reviews. Ratings and counts are still complete.
- **Bot walls.** Tripadvisor is commonly 403; TikTok often times out; press
  mentions are frequently empty. These are recorded as warnings.
- **Social posts.** The crawler collects profile metrics and review text; it
  does **not** collect post captions or media for Instagram/TikTok. Do not
  treat `social/` as a content library.
- **Palette.** Roles are inferred from CSS + logo evidence. The Wix defaults
  are removed, but the accent is still a best guess; check it in Asset Studio
  and override for a real brand.
- **Typography.** Only font names are captured — no font binaries or licences.
  Adobe/Wix families may not exist on the machine and will fall back. The
  scaled specimen is a design aid, not a licensed font delivery.
- **Content.** The menu parser is heuristic; check section/item splits for
  add-on menus (for example HATCH's “Bacon Brioche” add-ons). `content/*.json`
  is imported and pre-fills the **Menus** designs (up to 10 lines), but the
  parser is not a menu-management system; longer menus need editing in the
  Text tab.
- **Applications/brandFit.** Written into the guide but not yet used to drive
  Asset Studio category defaults.
- **Rights.** Asset rights and font licences are **not** verified. The guide
  says so explicitly. Get client approval before publishing scraped media.
- **Duplicates.** Importing a re-scrape creates a new pack. There is no
  automatic merge with an existing group yet; use the existing pack if it has
  better assets, or delete the old one deliberately.
- **Client-rendered sites need the browser.** A Vite/React/Next shell is
  rendered with Playwright after the static crawl. Without Playwright (or with
  `--no-browser`) the pack keeps the bundle-harvested photography but has no
  page text, no address and no NAP, and the run log says so.
- **No automatic group merge.** A group crawl is sequential and produces one
  new group pack. Re-running the same group creates a new pack; there is no
  merge into an existing pack yet.

---

## 8. Verification

```bash
npm test                  # includes tests/crawler.test.js (input safety, status)
.venv/bin/python scripts/crawler-combined.py --status-json
curl -s http://127.0.0.1:8008/api/crawler/status
```

Manual acceptance for a new business:

1. Search returns a candidate with the right website and address.
2. Confirm shows a reason for every platform (OK/NO), not just a blank list.
3. A website-only run creates `cover`, ≤6 photos, a logo (or a clear fallback),
   menu content and a README that does not list `00-portfolio` as a brand.
4. A full run adds `social/` and still imports as **one** brand.
5. The imported pack opens in Asset Studio with the address from the confirmed
   target, and `asset-studio.html?pack=<id>` selects it.

---

## 9. Files

| File | Role |
|---|---|
| `pages/crawler.html` | intake page |
| `src/client/crawler/crawler.css` | page styles |
| `src/client/crawler/crawler.js` | search → confirm → run → import behaviour |
| `src/server/crawler-service.js` | Python discovery/JSON calls + background run manager (runs live under `data/_crawler/runs/`) |
| `scripts/crawler-combined.py` | website + social crawler, pack writer |
| `tests/crawler.test.js` | API safety and readiness contract |

Run records are local state under `data/` (git-ignored). A run folder contains
`target.json`, `run.log`, `status.json` and `output/`.
