# Business social intelligence

**Status:** implemented on top of the crawler's social output.

The page answers a different question from Brand identity and the asset library:

| Surface | Question |
|---|---|
| Brand identity | What is this brand? |
| Asset library | What does it own, and may we use it? |
| Social intelligence | What does the public evidence say about its channels, reputation and voice? |

It is deliberately a **reading**, not a dashboard of invented metrics. Every
number and quote comes from the crawler's `business.profile.json` and
`social.tokens.json`; the page keeps the source path and the gaps visible.

---

## 1. What it shows

`/social.html` (or `/social`):

- **Reading** — a deterministic posture: healthy, steady, thin evidence,
  attention needed or no evidence, with the reason.
- **Audience / rating / reviews / channels** — total followers, consensus rating,
  published review count, how many reviews were actually readable, and the
  channel gaps.
- **Signal scores** — the crawler's overall, reputation, social strength,
  content health and discoverability scores.
- **Where they show up** — one card per scraped channel: handle, followers,
  posts, posts read, profile completeness, bio, warnings and a link to the
  profile.
- **What they post** — content mix, cadence, latest activity, review velocity
  and hashtags/keywords when the crawler returned them.
- **What guests say** — rating distribution, sentiment counts, owner response
  rate, review velocity, sources and the best/worst review quote.
- **What comes up** — recurring themes with their positive/negative/neutral
  split, net sentiment and a quoted sample.
- **What they sound like** — the crawler's voice keywords and samples, profile
  bio, website/phone/address, identity consistency and booking signal.
- **What to do next** — actions derived from the evidence, then the crawler's
  own opportunity list.
- **Where this came from** — source file, crawl kind, timestamp, group,
  channel count, warnings, and an explicit “what this does not prove” note.

The per-brand **Social** tab in Brand identity is a compact version with
followers, rating, reviews, channels and action count, plus the full-reading
link.

---

## 2. Data sources

`src/server/social-store.js` scans, in priority order:

```
data/_scraped/<group>/_social/<slug>/business.profile.json
data/_crawler/runs/<run>/output/_social/<slug>/business.profile.json
data/_crawler/runs/<run>/output/<kit>/<brand>/social/business.profile.json
data/brand-packs/<pack>/files/<brand>/social/business.profile.json
```

It also reads the sibling `social.tokens.json` for voice keywords and samples.
The index is read-only, cached for a few seconds, and deduplicated by
group + business slug; the richer copy wins, with the crawler's working `_social`
copy preferred over its assembled kit copy.

Current local index: **4 businesses** (Results, The Physician, The Adamson,
HATCH) across 2 groups. A run that is still crawling simply will not appear until
its `business.profile.json` is written.

### Running a crawl for this business

When the studio administrator enables **Client social crawler** for a business
(Management → group → Client social crawler), this page gains a **Run social
crawler** button. It starts a focused social-only run from the profile's
website and channel URLs — no website re-crawl, no brand-pack import.

The dialog exposes the crawler's own variables:

| Control | What it does |
|---|---|
| **Depth** — Light / Standard / Deep | Presets for reviews, posts and pagination (1/1, 20/6, 80/12); every field stays editable |
| **Sources** | Instagram, Facebook, TikTok, YouTube, Google reviews, Tripadvisor; unticked channels are skipped. None ticked = let the crawler choose |
| **Reviews to read** | 1–500 per business (`--max-reviews`) |
| **Posts per profile** | 1–60 (`--max-posts`) |
| **Deep pagination** | `--deep` |
| **Browser** | `--no-browser` when off; needed for gated channels |
| **HTTP cache** | `--no-cache` when off |
| **Download post images** | `--no-assets` when off |
| **Keep raw HTML** | `--keep-raw` |
| **Sequential channels** | `--sequential` (default parallel) |
| **Merge earlier run data** | `--no-merge` when off |

The run is a managed crawler job (`data/_crawler/runs/<id>/`): the dialog
shows its phase and live log, **Cancel run** stops it, and on completion the
page reloads the new `business.profile.json` and selects it. A profile cannot
start a second crawl while its first is running, and the server enforces a
30-second cooldown plus the global two-job limit.

API keys come from the project `.env` (`GOOGLE_PLACES_API_KEY`,
`SERPAPI_KEY`, …), loaded by the Node server at startup and inherited by the
Python child. The dialog only shows whether each key is present.

The run is refused with `403` when the business is not enabled and `422` when
it has no website on file.

To refresh the page without a crawl, press **Refresh** or:

```bash
curl -s 'http://127.0.0.1:8008/api/social/sources?refresh=1'
```

---

## 3. The reading

`src/server/social-intel.js` is a shared, dependency-free normaliser. It produces:

- `channels[]` from `social.matrix`, sorted by presence and followers;
- `reputation` with distribution, sentiment, velocity, owner response rate,
  sources, themes, topics, best/worst reviews;
- `voice` from `social.tokens.json`, falling back to review topics;
- `identity` and `web` signals;
- `warnings` from channel and review-source warnings;
- `intelligence`.

The posture is a small deterministic tree, not a model call:

| Tone | When |
|---|---|
| `empty` | no channel and no rating |
| `risk` | negative share ≥ 30%, rating < 4, or a high-severity action |
| `thin` | fewer than 10 readable reviews or one channel |
| `strong` | rating ≥ 4.3 and total followers ≥ 2,000 |
| `steady` | everything else |

Actions are evidence-backed and limited to what the data supports:

- `NEGATIVE_THEME` — a theme has ≥ 2 mentions and net sentiment ≤ −0.2;
- `RATING_BELOW_COMFORT` — consensus below 4.0;
- `NO_OWNER_RESPONSES` — visible reviews but no owner replies;
- `THIN_REVIEW_DEPTH` — fewer than 10 readable reviews out of 20+ published;
- `CHANNEL_GAP`, `HANDLE_DRIFT`, `STALE_CHANNEL`;
- `NO_ONLINE_BOOKING`;
- `NO_REVIEW_SOURCE`, `NO_SOCIAL_CHANNEL`.

Each action carries the reason and the limit. The page never says “sentiment is
negative” when it only has five readable reviews without saying so.

---

## 4. Brand matching

Brand packs and scraped profiles use different slugs (`the-physician` vs
`thephysician-bar`). `SocialIntel.matchBrand` normalises name, id, slug and
aliases; `GET /api/social/by-brand` chooses the best match. This is how the Brand
identity **Social** tab finds the right profile without storing a second mapping.

A missing match is shown as missing, not as an empty profile.

---

## 5. Crawl API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/social/sources?refresh=1` | Indexed profiles |
| `GET` | `/api/social/:id` | One profile plus `crawl: { enabled, packId, brandId, … }` |
| `POST` | `/api/social/:id/crawl` | Start a social-only crawl for an enabled business (`{ options }`) |
| `GET` | `/api/crawler/runs/:id` | Run phase, log and state |
| `POST` | `/api/crawler/runs/:id/cancel` | Cancel a running crawl |

The crawl endpoint only accepts businesses enabled in Management; it does not
take a URL or a target from the client.

## 6. Read API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/social/sources` | indexed businesses + health; `?refresh=1` rescans |
| GET | `/api/social/by-brand?brandId=&name=` | best match for a pack brand |
| GET | `/api/social/:id` | full normalised dataset |

Profiles are still written only by the Python crawler — the page never edits
them. The only write endpoint is starting a run.

---

## 7. Honest limits

- **Public evidence only.** The crawler reads public profiles and whatever review
  detail the source exposes anonymously. Private insights, DMs and ad accounts
  are not available.
- **Thin review depth is common.** Google often exposes ~5 reviews to a browser;
  the page labels that instead of treating the sample as a study.
- **The crawler's sentiment is lexical, not a human audit.** Themes and quotes
  are pointers for a person to read.
- **No real-time monitoring.** This is a snapshot; refresh by re-running intake.
- **No WhatsApp/Drive/email connectors, auth, approvals, transcription or
  embedding search.** Same boundary as the rest of the current build.
- **No freeform Asset Studio placement.** Social images are research; the asset
  library still governs what may be used.
- **The crawler's opportunity list is shown as the crawler wrote it.** The page's
  own actions are separate and deterministic.

---

## 8. Verification

```bash
npm test                         # includes tests/social-intel.test.js
curl -s http://127.0.0.1:8008/api/social/sources
```

Manual acceptance:

1. `/social.html` lists the indexed businesses; Results, The Physician, The
   Adamson and HATCH render without console errors.
2. The Physician shows the 3.7 rating, two channels, seven themes and a
   “reputation needs attention” reading.
3. The brand identity Social tab matches The Physician and links back.
4. A business with no social profile shows the honest empty state.
5. `/api/social/by-brand?brandId=okja&name=Okja` returns `matched: false`.

---

## 9. Files

| File | Role |
|---|---|
| `src/server/social-intel.js` | normalisation, posture, actions, brand matching |
| `src/server/social-store.js` | read-only dataset index, dedupe, source scan |
| `pages/social.html`, `src/client/social/social.js/.css` | the full social reading |
| `src/client/brand/brand-identity.js` | per-brand Social tab |
| `server.js` | `/api/social/*`, static `/social` |
| `tests/social-intel.test.js` | contract and edge-case tests |
| `docs/social-intelligence.md` | this document |
