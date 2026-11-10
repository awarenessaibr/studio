# Segment library

The reusable **groups of cut-out segments** that form a layer, indexed so a
person can browse them and an agent can drop one into a new scene with a
motion that fits.

Examples: `Clouds`, `Sea`, `Waves`, `Birds`, `Character`, `Animation FX`,
`Vegetation`, `Table Setting`, `Foreground Tools`. A group is the portable
unit — its members, their percentage boxes, the source composition, a
composited preview and one to three motion recipes.

| Surface | URL |
|---|---|
| Segment library UI | `/segments` (also `/segment-library`) |
| Full index | `/data/library/segment-groups/index.json` |
| One group | `/data/library/segment-groups/groups/<id>.json` |
| Motion recipes | `/data/library/segment-groups/motions.json` |
| API | `/api/segment-library` (see below) |

Build the data with:

```bash
npm run build:segments
```

The build reads `data/imports/*/composition.json`, every
`data/library/designs/*.json` (which points at its project composition) and
`data/projects/0-0-Butterfly--bar-santa/compositions/*.composition.json`.
It writes `data/library/segment-groups/` and is deterministic apart from
`generatedAt` and the image previews.

---

## 1. What a group is

A composition has layers. A **segment group** is the subset of layers that
belong together semantically: all the cloud cut-outs, the sea band plus its
whitecaps, the set of characters, the light effects.

The group is not the same as:

- a **design** — a whole composition, including text and layout;
- an **asset** — one image file;
- a **clip** — a generic motion preset that is not tied to a layer set.

A group is a layer set plus the motion language that makes sense for it. That
is what makes it reusable: the same `Clouds` group can sit in a Boardwalk
scene, a coastal hero, or a new scene the agent is building.

### Detection

For every eligible image layer:

1. **Declared** — `layer.segmentGroup` in the composition. Confidence `1.0`.
2. **Folder** — the layer folder (`clouds/`, `birds/`) when no group is
   declared. Confidence `0.68`.
3. **Known name prefix** — `cloud-`, `gull-`, `book-`, `wave-`. Confidence `0.6`.
   A prefix that is not in the known list never becomes a group, so
   `teal-felt-wave-band` does not invent a “Teal” category.
4. **Layer role** — `character-part`, `prop`, `ground`, and so on.
   Confidence `0.42`.

Layers with inline `data:` images (baked sprites and generated gradients) are
skipped: they are not reusable cut-outs, and repeating their base64 in every
JSON would be wasteful. The index reports how many were skipped.

Groups with the same label **and identical member art** are collapsed. The
different compositions become `occurrences` on one group. The canonical copy
is the declared, library-owned, complete one with the shortest project id, so
a `…-copy-2026…` import usually points at the original design rather than
duplicating it.

`origin: "declared"` means the studio already knew the grouping.
`origin: "folder" | "name" | "role"` means the build inferred it; inspect
`members` before relying on it. The UI calls both of those "inferred" and can
filter to declared-only.

---

## 2. Files

```
data/library/segment-groups/
├── index.json              catalogue: counts, categories, motions, group summaries
├── groups/<id>.json        full group: members, occurrences, previews, agent block
├── motions.json            reusable keyframe recipes
├── thumbs/<id>.webp        composited preview (transparent)
├── thumbs/<id>.card.webp   small card preview
└── README.md               generated notes and counts
```

### `index.json`

| Field | Meaning |
|---|---|
| `schema` | `studio/segment-groups/1` |
| `generatedAt` | ISO timestamp |
| `roots` | the three scanned roots |
| `counts` | groups, layers, occurrences, duplicates collapsed, previews, skipped data-URI layers |
| `categories` | semantic families with counts and member group ids |
| `motions` | motion recipes, summary form |
| `groups` | one summary per group (no member arrays) |
| `compositions` | every scanned composition and its group count |
| `warnings` | unreadable compositions and other build notes |

A group summary:

```jsonc
{
  "id": "clouds-1a2b3c4d",
  "name": "Clouds",
  "category": "sky-clouds",
  "categoryLabel": "Sky & clouds",
  "origin": "declared",
  "layerCount": 7,
  "availableCount": 7,
  "complete": true,
  "occurrenceCount": 2,
  "source": { "kind": "library-design", "projectId": "…", "compositionId": "…" },
  "preview": { "card": "/data/library/segment-groups/thumbs/clouds-1a2b3c4d.card.webp",
               "full": "/data/library/segment-groups/thumbs/clouds-1a2b3c4d.webp",
               "mode": "composite" },
  "bbox": { "x": 0, "y": 0, "w": 100, "h": 36 },
  "zRange": [2, 13],
  "motions": [{ "id": "cloud-drift", "label": "Cloud drift", "origin": "label" }],
  "keywords": "clouds sky & clouds …"
}
```

`preview.mode` is `composite` for a normal group. For a very broad inferred
group (more than 70 members) the preview is cropped from the source reference
frame and labelled `reference`: compositing hundreds of props made the build
slow, and the source frame is the honest visual at that scale. The card carries
a "Context" badge and the detail shows the note.

### `groups/<id>.json`

Adds what the catalogue leaves out:

```jsonc
{
  "members": [{
    "layerId": "layer-clouds-cloud-center",
    "name": "cloud-center",
    "role": "background",
    "z": 9,
    "box": { "x": 38.55, "y": 4.01, "w": 12.71, "h": 12.43 },
    "rotation": 0,
    "opacity": 1,
    "url": "/data/projects/…/images/clouds/cloud-center.png",
    "available": true
  }],
  "occurrences": [{ "kind": "import", "projectId": "…", "memberCount": 7, "availableCount": 7 }],
  "reference": { "url": "/data/projects/…/images/reference.jpg", "available": true },
  "motions": [{ "id": "cloud-drift", "origin": "label", "reason": "…" }],
  "observed": {
    "animationCount": 2,
    "labels": [{ "label": "float", "count": 3 }],
    "suggestedMotions": ["float"],
    "examples": [{ "animationId": "…", "layerId": "…" }]
  },
  "agent": { "insert": { "layers": [ … ] }, "motion": { … } }
}
```

`observed` is only present when a library animation already moves one of the
group's layers. It is evidence, not a requirement; `motions` merges category,
label and observed suggestions in that order.

Coordinates are **percentages of the source canvas**. `box` is the exact
rectangle the cut-out occupies in its composition.

### `motions.json`

A recipe is a small, engine-neutral description:

```jsonc
{
  "id": "cloud-drift",
  "label": "Cloud drift",
  "duration": 16000,
  "loop": true,
  "easing": "sine",
  "phase": "stagger",
  "keys": {
    "dx":  [[0, 0], [0.5, 0.018], [1, 0]],
    "dy":  [[0, 0], [0.5, -0.005], [1, 0]],
    "s":   [[0, 1], [0.5, 1.025], [1, 1]],
    "rot": [[0, 0], [0.5, 0.35], [1, 0]],
    "a":   [[0, 1], [1, 1]]
  }
}
```

- `dx` / `dy` are fractions of the canvas (0.018 = 1.8% of canvas width).
- `s` is a multiplier on the layer's `w` and `h`.
- `rot` is degrees added to the layer's rotation.
- `a` is a multiplier on opacity.
- key times are 0–1 over `duration`.
- `phase`: `sync` (all together), `stagger` (offset by member order),
  `alternate` (odd members run the opposite phase and direction).

The recipes are deliberately simple. The Studio engines already understand
per-layer keyframes; these recipes are a way to generate those keyframes
without naming a preset that only exists in one engine.

---

## 3. Categories

| Id | Label | Typical groups |
|---|---|---|
| `sky-clouds` | Sky & clouds | Clouds, Sky, Sky Patches, Sun |
| `sea-waves` | Sea & waves | Sea, Waves, Wave Details, Shoreline, Glints |
| `birds-wildlife` | Birds & wildlife | Birds, Gull, Fauna |
| `characters` | Characters | Subject, Character, Cyclist, snake `dots · …` |
| `nature` | Landscape & vegetation | Vegetation, Flora, Landscape, Mountains |
| `architecture` | Architecture & places | Architecture, Buildings, Room, Staircase |
| `props` | Props & objects | Props, Books, Tableware, Furniture, Decor |
| `text` | Text & lettering | Letters, wordmark, Large/Small Text |
| `effects` | Light & effects | Animation FX, Lighting, Glints, Smoke |
| `foreground` | Foreground | Foreground, Border, Barriers, Tools |
| `background` | Background | Background, Base, Ground, Floor, Recovered |
| `other` | Other | everything not mapped yet |

The UI groups by category; the file lives under `groups/<id>.json` regardless.
Add a category by editing `CATEGORIES`, `ALIASES` and `KEYWORDS` in the build
script, then rebuild.

---

## 4. Using a group in a scene

The group detail's `agent` block is designed to be copied verbatim.

```jsonc
{
  "insert": {
    "method": "add-layers",
    "units": "percent-of-canvas",
    "groupId": "clouds-1a2b3c4d",
    "groupLabel": "Clouds",
    "bbox": { "x": 0, "y": 0, "w": 100, "h": 36 },
    "layers": [{
      "id": "clouds-1a2b3c4d-1",
      "name": "cloud-center",
      "role": "background",
      "z": 9,
      "x": 38.55, "y": 4.01, "w": 12.71, "h": 12.43,
      "url": "/data/projects/…/cloud-center.png",
      "fit": "contain",
      "segmentGroup": "Clouds"
    }]
  },
  "motion": {
    "preset": "cloud-drift",
    "duration": 16000,
    "loop": true,
    "phase": "stagger",
    "keys": { "dx": [ … ], "dy": [ … ], "s": [ … ], "rot": [ … ], "a": [ … ] },
    "applyTo": "each-member"
  }
}
```

Steps:

1. `GET /api/segment-library/groups?q=clouds` (or read `index.json`).
2. `GET /api/segment-library/groups/<id>`.
3. Append `agent.insert.layers` to the target composition; keep the z order.
4. For each inserted layer and each key time `t` (0–1), write a keyframe at
   `t * duration` ms:

```
x        = base.x + dx * 100
y        = base.y + dy * 100
w        = base.w * s
h        = base.h * s
rotation = base.rotation + rot
opacity  = base.opacity * a
```

5. Stagger member phases when `phase` is `stagger`; reverse direction for odd
   members when it is `alternate`.
6. Preview in the Studio before saving. A group that reads well in isolation
   still has to sit inside the scene.

**Do not** recolour, crop or restack the members. The preview is the
reference. **Do not** use a letter group as editable copy; use a text layer.

Missing member images are `available: false`. They are excluded from
`insert.layers` and counted in the group's `availableCount`.

---

## 5. API

All endpoints are read-only. Errors carry the usual JSON `{ error }` shape and
a status code (`400` bad id, `404` unknown group, `503` library not built).

| Endpoint | Returns |
|---|---|
| `GET /api/segment-library` | the full `index.json` |
| `GET /api/segment-library/summary` | counts, categories, motions, projects |
| `GET /api/segment-library/categories` | category records with group ids |
| `GET /api/segment-library/motions` | full motion recipes |
| `GET /api/segment-library/groups?q=&category=&origin=&motion=&project=&hasPreview=&sort=&limit=&offset=` | filtered group summaries |
| `GET /api/segment-library/groups/<id>` | one group detail |

`origin=declared|inferred`, `sort=category|name|layers|sources`,
`limit` 1–200 (default 60). Search is term-based over the name, category,
keywords, tags and source ids.

The static JSON and previews are also served directly:

```
/data/library/segment-groups/index.json
/data/library/segment-groups/groups/<id>.json
/data/library/segment-groups/thumbs/<id>.webp
```

---

## 6. UI

`/segments` has three tabs:

- **Segment groups** — search/filter/sort, preview cards with a play button for
  the group's primary motion, detail drawer with a live animated preview,
  member isolation, motion and speed controls, source list and code copy.
- **Design library** — the library designs with status, brand, counts and a
  link to the composition JSON. The animation-count chip opens the Animations
  tab filtered to that design.
- **Animations** — three sub-tabs:
  - **Library animations** — every original and generated animation. **View**
    plays the original recording when one exists, otherwise renders the design
    layers live from the animation's tracks (images and text), with a track
    list you can isolate.
  - **Motion clips** — the 195 extracted clips. **View** applies the clip to a
    compatible segment group; the *Preview on* picker lets you try it on any
    group in the library.
  - **Group motion recipes** — the 16 reusable recipes with their duration,
    phase and group count. **View** opens a representative segment group with
    that recipe already selected.

The viewer has play/pause, restart, speed, loop and scrub controls. It runs
the same keyframe maths the agent is told to use. Extracted clips whose
opacity channel is all zero are treated as neutral (the clip animates motion,
not visibility). `#group=<id>` deep-links to a group; `#library` and
`#animations` deep-link to the tabs.

---

## 7. Rebuild and extend

Rebuild after adding compositions, changing `segmentGroup` labels, or
importing new segment ZIPs:

```bash
npm run build:segments
```

The build is a single Python script (`scripts/build-segment-library.py`). It
uses Pillow, already present in `.venv`. It:

- resolves old `/data/projects/<name>` URLs against renamed project folders
  and, as a last resort, a unique basename under `projects/` and `imports/`;
- deduplicates exact copies by a cheap head+size fingerprint;
- composes previews with Pillow and writes WebP;
- derives observed motion evidence from `data/library/animations`;
- writes the index, group files, motion recipes and README.

To make a new group explicit, add `segmentGroup` to the layers in the
composition (the Studio's Layers panel groups them), then rebuild. To improve
an inferred group without touching the composition, add its label to
`ALIASES`/`KNOWN_PREFIXES` or its category to `CATEGORIES`.

---

## 8. Current data quality

- 196 compositions are in the repository; this build scans the 152 that the
  three roots cover (77 library designs, 74 imports and 1 bar-santa project;
  the legacy `composition.pre-v3.json` is skipped).
- Exact copies collapse: the copy compositions point at the original group
  through `occurrences`.
- About 5% of grouped image URLs could not be resolved to a file on this
  checkout (the data folder has been renamed/copied many times). They are
  flagged and excluded from insertion. The index counts them. Old
  `/api/projects/…` and `http://localhost:8009/data/…` URLs are rewritten to
  the matching file before giving up.
- Inline `data:` sprite layers are skipped and counted.
- `origin: inferred` groups are useful but unconfirmed; check them first.
- Previews are composited at 900 px and cards at 360 px. Groups over 90
  members use the source frame and are labelled `reference`.

Tests: `node --test tests/segment-library.test.js`.
