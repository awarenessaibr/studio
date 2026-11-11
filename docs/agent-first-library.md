# Agent First library (`data/library`)

The HTML extractor's downstream library builder writes `data/library/`. This is
the catalogue both Agent First UIs use:

| File | Contents |
|---|---|
| `index.json` | design catalogue, status, tags, facets, animation links |
| `designs/<id>.json` | layers, semantic groups, slots, entities, menu items |
| `animations/<id>/*.animation.json` | original and generated animations |
| `clips.json` | 76 reusable motion clips extracted from the designs |
| `assets.json` | 111 de-duplicated images/shapes and their uses |
| `business.json` | 3 brands, hours, taglines, contacts |
| `menu.json` | Extracted menu-item candidates (not the authoritative brand menu) |

At the time of writing: **114 designs**, **92 ready**, **106 source recordings**,
**195 clips**, **716 assets**, **21 extracted menu items**.

## Status rules

- `ready` — safe to show by default
- `review` — usable, but has issues/warnings
- `blocked` — not offered

Animations carry their own `status` (`ok`, `warn`, `broken`). Agent First lists
all designs; the default animation list hides broken animations. Admin mode
includes broken animations. Review/blocked status stays visible on the design
cards.

## Brand filter and video export

The Agent First Studio design drawer starts with a **Brand** selector. It
filters both library designs and published templates by the selected brand, so
the published template list is scoped to that brand. The choice persists in
`localStorage["sa.brand"]`.

The download button in the top-right exports the design currently on the
canvas as a WebM video at 1080×1080 and 30 fps, for the full current animation
(or a short still hold when no animation is selected). The filename includes
the design, motion and format.

The Clean Canvas has the same video export as a **Video** button in the
top-right; it records the selected timeline animation at the canvas resolution.



## Menu item swaps

For supported Singl-end product designs, Agent First shows a **Menu item** card
under the selected design. The card displays the current item, price, menu,
section, description and dietary marks.

- **Change item** opens a searchable picker limited to the brand's confirmed
  menus.
- Choosing an item creates a separate `Menu variation — <item>` animation.
- One variation is kept per item; choosing the same item reuses it.
- Variations can be deleted from the animation list.
- Text fields use the design's existing fonts and boxes; long text is reduced
  slightly to fit.
- If a design has a verified product-image slot, the variation offers an optional
  image upload and an online image search prompt. No v1 design has one yet;
  scene photography is never treated as a product image.

The original source recording is never modified. Menu variations use the
editable composition.

Data:

- `data/library/menu-catalog.json` — confirmed brand menus.
- `data/library/menu-designs.json` — supported designs and product slots.
- `docs/menu-enabled-designs.md` — supported/unsupported design list.

## Source-exact original playback

Each source-derived design (61 at the time of this batch) has a recording of
its original HTML stage under `data/library/sources/<design-id>.webm`, with a
representative `.jpg` poster. `scripts/attach-source-videos.js` attaches those paths to the
library detail and index after a build.

- Selecting a source-derived design shows the source poster, not the
  approximate extracted composition.
- **Original motion** plays the source recording.
- Selecting a generated animation switches back to the editable composition.
- Export downloads the source recording when Original motion is active.

The source recordings are captured at the source stage's native aspect and
width (1080 px for most designs) and up to 60 fps.

### Canvas source decks

A canvas reel has no DOM layer tree to measure: the page exposes a
`draw(ctx, t)` function and the composition would only ever be an
approximation. These decks are installed differently:

- `scripts/capture-canvas-reels.js` steps the page's own `render(t)` at 30 fps
  at 1080×1920, encodes those exact frames with VP9, and records the exact
  poster frame — the time with the most visible text — as a one-layer
  composition. The source HTML is archived under
  `data/library/sources/html/`.
- `scripts/build-canvas-library.js` builds only the new canvas projects in a
  temporary library and merges the designs, animations, assets and brand
  membership into `data/library` without rebuilding (and disturbing) the rest
  of the catalogue.
- `scripts/verify-canvas-reels.js` re-renders the poster from the archived HTML
  and requires a byte-identical hash, then compares three decoded video frames
  with fresh canvas renders at the same frame numbers.

The result is a design whose **Original motion** is the frame-exact recording
and whose editable composition is the exact source still. Canvas art is not
rebuilt as approximate text and shape layers on purpose. The generated
`original.animation.json` is a one-track hold for validation; the UI plays
`sourceVideo` for Original motion.

### HTML stage reels

The DOM extractor is the right first pass for a CSS/JS stage, but its layer
render is not guaranteed to be 100% of the page: a webfont can fall back and a
crop can drift. A stage that must match exactly is installed as:

- **Composition** — the source frame at the chosen poster time, decoded from
  the recording itself, as one full-frame image layer. Composition and
  recording are therefore the same moment by construction.
- **Original motion** — the source recording. `scripts/capture-dom-stages.js`
  isolates the stage, flashes a green marker, resets the page's animation and
  trims by output seek (an input-side seek lands on a keyframe and cuts the end
  of the loop).
- **Archived extraction** — the extractor's multi-layer composition stays at
  `data/projects/<id>/compositions/<id>.editable.json` for future refinement,
  but it is not what the library shows.

`scripts/build-project-subset.js --projects=... --prune` builds only those
projects and merges them, so the rest of the catalogue is untouched.

Some decks declare `data-d` in seconds (`data-d="12"`), while the extractor
expects milliseconds. Normalise a temporary copy (`data-d` × 1000 and divide
the page's own clock by 1000) before extracting; the archived source deck stays
original. When a green marker is not captured, the capture detects the first
dark full-bleed frame (the page body is light) and trims there. A static
carousel is installed as one design per slide at native size, because a single
wide strip would be unreadable in the canvas; those designs have no
`sourceVideo`. A deck whose own clock throws on its first frame can be
frame-stepped instead of recorded: set the page clock per frame and pipe the
native screenshot to ffmpeg. If the deck references sibling images by relative
path, copy those files next to the archived HTML before measuring or capturing. If the fix is a negative-time clamp, keep the
archived original and make the clamp explicit in the capture copy.

### Narrated HTML stage cuts

A spoken version of a stage is a new design, not a new animation on the old
one. The voice has to change the *pacing of the cards*, and on an HTML stage the
cards are `data-s` / `data-e` seconds on the deck, not keyframes in the
composition. Re-timing the 66 extracted layers by hand would not reproduce those
cards, and the extractor's text already drops lines in Layer Studio. So the
narration is authored where the timing lives:

1. **`scripts/build-narrated-composition.py`** takes a `narration-source.json`
   (source clips, measured `speechStart`/`speechEnd`, layout rules), trims and
   levels each clip, lays them on one mix track, writes
   `narration-timeline.json`, and rebuilds the deck with the six cards and the
   outro re-timed around the voice (card opens before the line, holds after it,
   the outgoing card clears before the next one opens).
2. **`scripts/render-narrated-video.js`** renders the deck frame by frame
   (`window.__renderAt(ms)`) and pipes the PNGs into ffmpeg with the mix at
   sample zero. A screen recorder is deliberately not used here: under the
   1080 × 1920 blur/grain load Playwright's writer ran at ~21 fps against a fixed
   25 fps timebase, and the picture played 15 % slow against the muxed track.
   `scripts/capture-dom-stages.js` remains the right tool for silent stages, and
   now muxes a track when a manifest has `audio`.
3. **`scripts/install-narrated-design.py`** installs the cut as a new library
   design (one poster frame, `sourceVideo` = the narrated WebM, a hold animation
   for Original motion, narration windows in the detail) **and links it as an
   animation on the design it was cut from** — `Narrated cut` next to
   `Original motion`, with its own `sourceVideo` and narration pointer. The
   original cut is untouched; counts/facets are updated.

The Agent Studio's `#srcVideo` is no longer `muted`, so a source-backed
animation actually plays its sound. `loadFeed` carries the source fields from
the catalogue entry onto each animation, and `selectAnim` plays a source-backed
animation instead of rendering its (hold) tracks. The sync contract is
`tests/narrated-cinematic.test.js`.

### Audio drawer: narration level, background music, export

The same animation can carry an audio bed in the design detail:

```json
"audioMixes": {
  "<animation-id>": {
    "narration": { "volume": 1, "muted": false },
    "music": {
      "enabled": true, "url": "/data/library/audio/<design>/<track>.mp3",
      "name": "…", "durationMs": 20000, "volume": 0.28,
      "startMs": 2000, "endMs": 30000, "inMs": 0, "loop": true,
      "fadeInMs": 800, "fadeOutMs": 1200, "duck": true, "duckDb": -9
    }
  }
}
```

The **Audio** drawer (`#tAudio`) edits it: narration level, track upload,
music level, start/end on the cut, trim inside the track, loop, duck under the
narration windows, fades, `Play from here` and `Export with music`. The same
drawer, player and mix engine are wired into both `/agent-first-studio.html`
and `/afs.html` (`pages/afs.html`), so the two surfaces share one audio
contract. Saving is
automatic (debounced) to the detail with a localStorage copy; the config is per
animation, and a `default` entry is inherited when an animation has none.

Playback is client-side: the video carries the narration, a hidden `<audio>`
plays the bed, and a rAF mixer follows `video.currentTime`, seeks/loops, applies
the fades and ducks under the narration speech windows. Export is server-side:
`POST /api/library/audio/render` stream-copies the picture and muxes the bed
with ffmpeg (volume, delay, trim, fades, side-chain ducking, Opus), returning
`/data/library/sources/<id>-mix.webm`.

Routes:

| Route | Purpose |
|---|---|
| `POST /api/library/audio/upload?designId=&name=` | store a music file under `data/library/audio/` |
| `POST /api/library/audio` | validate and save `{designId, animationId, config}` |
| `POST /api/library/audio/render` | mux the cut + bed into a WebM |

`/data/library/audio/…` is served by the library allowlist (audio extensions are
now accepted); JSON metadata stays public, the audio folder is the only new
readable path.

**Where an audio track editor belongs.** Neither `agent-first-studio.html` (the
player) nor the source deck is a general editor. Of the two studios,
`studio-v2.html` is the right home: it is the current Layer Studio, it loads
`data/projects/<id>` through the shared engine in `src/client/shared/_.js`, and
it already exports MP4 — so one audio-track implementation there covers the
surface that actually edits compositions. `studio.html` is the older, secondary
Agent Studio and would need a second implementation for no gain. A narrated cut
does not require that editor: the recording is the source of truth and plays
today.

## Admin view

Both UIs have a small admin toggle:

- **`agent-first-studio.html`** — the `A` button beside the Designs icon
- **`studio-agent.html` clean canvas** — the `A` button in the Designs drawer
  header

The setting is shared through `localStorage["agentLibrary.admin"]`. In Agent
First, all designs are always listed; `A` only adds broken animations. In the
clean canvas, the normal library grid remains ready-only and admin exposes the
full design set.

## Extra animations

The following externally generated animations are now registered against the
library:

- `butterfly-the-pig---cinematic-04`:
  - Ambient loop
  - Butterfly flight
  - Cinematic reveal
  - Snappy stagger
- `reels---before-after-01` (the Singl-end before/after source):
  - Slider reveal
  - Cinematic slow-fade

They are shown alongside `Original motion` in both Agent First UIs. To add more,
drop a valid `agent-studio/animation/2` file in
`data/library/animations/<design-id>/` and rebuild the library with the external
`build-library.py`, or POST it to `/api/library/animations`.

One-frame segments are treated as holds: the studio duplicates the frame at the
segment end so the animation plays instead of failing validation.

## Server API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/library` | Library index |
| `GET` | `/api/library/designs/:id` | Design detail |
| `POST` | `/api/library/animations` | Validate + save an animation for a design |
| `POST` | `/api/library/compose` | Build an animation from clips/steps |
| `GET` | `/data/library/...` | Detail, clips and animation files |
| `GET` | `/data/projects/<id>/compositions/...` | Source composition files |

`POST /api/library/animations` accepts:

```json
{ "designId": "…", "animation": { "name": "…", "tracks": [] } }
```

It validates layer ids, segments and frame values; broken animations return 400
and are never saved. `POST /api/library/compose` accepts:

```json
{
  "designId": "…",
  "name": "Composed animation",
  "save": true,
  "steps": [{ "target": "group-or-layer-id", "clip": "clip-id", "start": 0, "stagger": 120 }]
}
```

Both endpoints update the design detail and the catalogue so the animation is
immediately selectable in both UIs.

## Agent context

The clean canvas sends the selected library design's semantic groups, menu
items, entities and animations to `/api/agent-canvas`. The Agent First UI sends
the same categories plus reusable clips to its model and can ask the model for
`steps` that `/api/library/compose` turns into a saved animation.

## Run

Restart `node server.js` after changing the library API. The catalogue itself is
read live from `data/library`; no Studio rebuild is required for detail/clip
changes.
