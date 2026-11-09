# Agent library: HTML projects → business / composition / groups / animations

The HTML-to-LayerStudio pipeline writes one project per `.stage`:

```
data/projects/<project>/compositions/<project>.composition.json
data/projects/<project>/images/*
data/projects/<project>/layers.json
```

That output is editor-ready but not agent-ready. The **agent library** is a
derived index that turns the same files into a queryable catalogue:

```
business
  └─ collection
       └─ composition
            ├─ scene (time window)
            ├─ group (background, photography, menu items, prices, …)
            ├─ asset (image / shape / artwork)
            └─ animation clip (layer or group)
```

It is rebuilt from the compositions, so it never becomes a second source of
truth.

## Build / refresh

```bash
npm run build:agent-library
```

Writes `data/settings/agent-library.json`.

The Studio server also watches `data/projects` for new or changed
`*.composition.json` files and rebuilds the index after a short debounce. The
manual/CI equivalent is:

```toml
POST /api/agent-library/rebuild
```

The index is lazy: the first library request also builds it if the file does
not exist.

## Index shape

```jsonc
{
  "schema": "agent-studio/library/1",
  "generatedAt": "…",
  "counts": {
    "businesses": 35,
    "compositions": 125,
    "groups": 589,
    "assets": 2292,
    "animations": 2056,
    "scenes": 125,
    "menuItems": 265
  },
  "businesses": [
    { "id": "…", "name": "…", "palette": [], "guidelines": {}, "compositions": [], "menuItems": [] }
  ],
  "compositions": [
    {
      "id": "…", "name": "…", "businessId": "…", "collection": "…",
      "width": 1080, "height": 1920, "duration": 10000, "format": "portrait",
      "layers": [], "groups": [], "scenes": [], "assets": [], "menuItems": [],
      "animations": { "layer": [], "groups": [], "original": {} }
    }
  ],
  "groups": [], "assets": [], "animations": [], "scenes": [], "menuItems": [],
  "mappings": {
    "businessCompositions": {},
    "businessMenuItems": {},
    "compositionGroups": {},
    "compositionAnimations": {},
    "compositionScenes": {},
    "compositionAssets": {},
    "groupLayers": {},
    "groupAnimations": {}
  }
}
```

### Business / collection matching

The builder reads brand packs and matches the composition's
`sourceFacts.htmlSource` / project folder against brand names. The readable
prefix becomes the business; the part after `·` becomes the collection. This
groups the 125 HTML examples under their actual café/brand where a brand pack
exists and under a stable synthetic business otherwise.

### Menu extraction

Text layers are classified as `headline`, `menu-item`, `price`, `badge`,
`body`, `contact` or `cta`. Menu items are paired with the nearest price text
within a small box distance. Each result records the source layer, group,
price and box, so an agent can work with "Eggs on toast — £7.50" without
re-parsing the HTML.

### Groups

Semantic groups are derived from roles and layer metadata:

- background
- artwork (rasterized SVG/HTML art)
- photography
- shapes
- headlines
- menu items
- prices
- badges & labels
- body copy
- contact/footer
- calls to action
- text

Repeated CSS class signatures (for example every `.badge` or `.dish`) are also
added as class groups. A group carries layer ids, z range, bounds, time range,
asset ids and animation clip ids. Groups are the unit the Agent Canvas lets the
user select before asking for a new animation/composition.

### Animations

Layer keyframes become compact animation clips (`channels`, sampled frames,
start/end). Group clips combine the layers in a group, so "photography motion"
or "menu item motion" can be selected independently and assembled into a
longer sequence. The composition also gets an `original` animation entry.

### Scenes

Scene boundaries come from animation start/end times, trimmed to intervals of
at least 80 ms and capped at 12 per composition. Each scene lists its active
layers, groups and animation clips.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent-library` | Compact catalogue (default) |
| `GET` | `/api/agent-library?full=1` | Full index with all layer/scene/group records |
| `GET` | `/api/agent-library/compositions/:id` | One composition with groups/scenes/assets/animations/menu |
| `GET` | `/api/agent-library/businesses/:id` | Business + its compositions + menu items |
| `POST` | `/api/agent-library/rebuild` | Regenerate from `data/projects` |

## Agent use

The Agent Canvas fetches the summary, matches the selected template to its
source composition, and sends the selected groups to
`POST /api/agent-canvas` as `library`. The model receives:

- business and collection;
- menu items;
- selected grouped layers and their assets;
- scene/group animation clips;
- only animation choices that are compatible with the current composition.

That lets the user say "use the menu item and price groups for a two-beat
reveal, then use the photography group for a slow push" and have the model
return a new animation using existing layer ids/assets. The generated
animation is then saved per template by the existing Agent Canvas flow.

See [Agent First library](agent-first-library.md) for the `data/library` catalogue used by both new UIs.
