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

At the time of writing: **63 designs**, **41 ready**, **61 source recordings**,
**195 clips**, **665 assets**, **21 extracted menu items**.

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
