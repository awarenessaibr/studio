# Scene library — Singl-End Bicicle

The **scene library** is the level above segment groups. A segment group tells
an agent which cut-outs move together. A scene record tells it what those
groups are, how they sit on a canvas, which motion was observed, what is safe
to reuse and what the source data got wrong.

The first reviewed scene is the supplied
`_dev/agent-first-canvas-library-expansion/agent-awareness-granular-library/`
export: **The Butterfly and the Pig — Singl-End Bicicle — cyclist ride and
light dim**.

| | |
|---|---|
| Scene library UI | `/segments#scene` |
| Data | `data/library/scene-library/` |
| Index | `/data/library/scene-library/index.json` |
| Scene | `/data/library/scene-library/scenes/singl-end-bicicle-cyclist-ride.json` |
| Build API | `POST /api/scene-library/build` |
| Source export | `_dev/agent-first-canvas-library-expansion/agent-awareness-granular-library/the-butterfly-and-the-pig-singl-end-bicicle-cyclist-ride-and-light-dim-20261111-0247-segments/` |
| Clean art source | `data/projects/Singl-End-Bicicle/images/` |
| Rebuild | `npm run build:scene-library` (`python3 scripts/build-scene-library.py`) |

---

## 1. What the source contains

The export is one complete composition:

| | |
|---|---|
| Canvas | 1098 × 976 px |
| Duration | 8.0 s |
| Composition layers | 35 (one hidden final-image reference) |
| Segment files | 34 transparent PNGs |
| Part records after review | 34 (29 buildable, 5 reference) |
| Groups | 11 |
| Concepts | 16 (14 supported, 2 missing) |
| Animated parts | 12 |
| Animation tracks | 12 (201-frame ride tracks; 68–160-frame lighting tracks) |

The scene is a sloping café street at night: brick buildings, a Singl-end
wordmark wall, pavement, bollards, chalkboard, street lamp, overhead lights,
a cyclist and bicycle split into six animated parts, a workshop foreground and
a night-glow/dimmer stack.

The index is not just a file list. Every part carries a label, description,
category, zone, tags, search concepts, source box, build order, group
membership, motion evidence and provenance. See
[`data/library/scene-library/README.md`](../data/library/scene-library/README.md).

---

## 2. Data-quality review

The source export is useful but not clean enough to hand to an agent without
normalisation. These findings are part of the library and are shown in the
Scene studio’s **Data quality** card.

### 2.1 Full-canvas padding vs clean cut-outs

The `segments/*.png` files are **full-canvas** images with transparent padding.
The source project’s `images/**` files are the clean, cropped cut-outs. The
export’s `segments.json` `box` is the composition layer box, not the padded
image’s alpha bbox.

The library therefore:

- copies the clean cropped `data/projects/Singl-End-Bicicle/images/**` art;
- keeps the composition box as `part.box` (authoritative placement);
- records the padded image’s content box as `part.contentBox` and `part.crop`
  for auditability;
- keeps the original segment path in `part.source.segment`.

This matters for the bicycle and cyclist: their padded alpha content sits at
~43% of the canvas, while their composition layer starts at ~20%. Using the
padded bbox directly made the rider detach from the bike. Using the layer box
and cropped art makes the observed ride align with the wall’s cyclist-shaped
hole.

### 2.2 Mislabeled parts

| File / part | What it actually is | Decision |
|---|---|---|
| `cobblestone-sidewalk` | A large side-view bicycle cut-out, not pavement | Reference-only duplicate |
| `bollard-middle` | A large bicycle-wheel cut-out, not a bollard | Reference-only duplicate |
| `large-brick-wall 3` | An identical copy of wall section 2 | Reference-only duplicate |
| `large-brick-wall` | A full-frame flattened plate containing the whole scene | Reference-only plate |
| `unassigned` | A full-frame flattened plate containing the whole scene | Reference-only plate |

The buildable bollards are `bollard-right` and `bollard-left`. The buildable
wall is `large-brick-wall 2`.

### 2.3 Baked content and duplicates

- `large-brick-wall 2` is the clean wall cut-out with:
  - the **Singl-end wordmark baked into the brick**;
  - a **transparent cyclist-shaped hole** that the observed rider fills over
    the 8 s ride.
- The separate `cafe-sign` cut-out is valid for another wall, but when the wall
  is selected the composer drops the separate sign to avoid doubling the
  wordmark. This is recorded as `bakedInto` on the part and `deduped` in the
  build response.
- `sloped-street` had a baked figure at the right edge. The buildable part is a
  documented **210 px clean crop** of the left pavement (`derived: true`).
- `light pool on cyclist` and `scene dimmer` are fully transparent in the
  still frame; their observed opacity tracks make them visible.

### 2.4 Missing vocabulary

The library deliberately records what it does **not** have:

- **Cars / vehicles** — no car, van or truck cut-outs. The closest moving
  subject is the bicycle/cyclist rig.
- **Trees** — no tree or woodland cut-outs in this street set.

If a user asks for cars, the agent shows a missing chip and explains the
closest available build instead of inventing a car. This is the behaviour the
Scene studio examples exercise.

---

## 3. Library files

```
data/library/scene-library/
├── index.json                  scenes, all parts, groups, concepts, examples
├── scenes/<scene-id>.json      full scene: parts, groups, animation tracks
├── parts/<part-id>.json        one part + build block + source metadata
├── groups/<group-id>.json      one group + members + bbox + counts
├── animations/<scene-id>.json  the observed 8 s animation
├── assets/<scene-id>/          clean cut-outs + flattened preview
└── README.md                   generated human/agent notes
```

### Index counts

```json
{
  "scenes": 1,
  "parts": 34,
  "buildableParts": 29,
  "referenceParts": 5,
  "groups": 11,
  "concepts": 16,
  "missingConcepts": 2,
  "animatedParts": 12,
  "tracks": 12
}
```

### Part record

```jsonc
{
  "id": "layer-bicycle-bicycle-frame",
  "sceneId": "singl-end-bicicle-cyclist-ride",
  "name": "bicycle-frame",
  "label": "Bicycle frame",
  "description": "The bicycle frame; the anchor part for the ride rig.",
  "category": "bicycle",
  "groupIds": ["bicycle", "cyclist-rig"],
  "role": "prop",
  "buildable": true,
  "staticVisible": true,
  "zone": "subject",
  "box": { "x": 20.66, "y": 57.14, "w": 4.74, "h": 6.59 },
  "sourceBox": { "x": 20.66, "y": 57.14, "w": 4.74, "h": 6.59 },
  "contentBox": { "x": 43.26, "y": 55.43, "w": 19.76, "h": 27.46 },
  "url": "/data/library/scene-library/assets/.../24-bicycle-frame-bicycle-frame.png",
  "tags": ["bicycle", "bike", "frame", "ride", "animated"],
  "concepts": ["bicycle", "cyclist", "motion"],
  "motion": {
    "tracked": true,
    "layerId": "layer-bicycle-bicycle-frame",
    "frames": 201,
    "fields": ["dx", "dy", "sx", "sy"],
    "duration": 8000
  }
}
```

`box` is in **percentage of the scene canvas**. `contentBox` is the alpha bbox
of the padded export, kept for review. `buildZ` is the scene-build order.

### Groups

| Group | Parts | Role |
|---|---:|---|
| Reference plates | 5 | Flattened and mislabeled parts; never build |
| Architecture | 2 | Buildings + brick wall |
| Street & pavement | 1 | Clean pavement crop |
| Street furniture & signage | 6 | Bollards, signs, lamp, overhead |
| Café signage | 2 | Wordmark + A-board |
| Café frontage | 5 | Wall, buildings, A-board, sign, lamp |
| Foreground workshop | 7 | Bench, clay, tools, jar, plants |
| Bicycle | 3 | Wheels + frame |
| Cyclist + bicycle rig | 6 | The moving subject |
| Cyclist | 3 | Head, torso, leg |
| Lighting & night | 9 | Lamp, softbox, overhead, glows, dimmer |

### Concepts

Supported: `buildings`, `bricks`, `street`, `cyclist`, `bicycle`, `bollards`,
`cafe`, `lighting`, `plants`, `tools`, `props`, `street-furniture`, `people`,
`night`.

Missing: `cars`, `trees`.

Aliases are word-aware. `scattered clay pieces` does not match `car`; `cars`
matches `car`; plurals are accepted.

---

## 4. Animation model

The source animation is `agent-studio/animation/2` with 12 tracks. The full
track data is in the scene record and served from
`/data/library/scene-library/animations/singl-end-bicicle-cyclist-ride.json`.

Each track has one or more segments; each frame has:

| Field | Meaning |
|---|---|
| `t` | Time in ms relative to the segment start |
| `dx` | Horizontal offset as a fraction of canvas width (`0.01` = 1%) |
| `dy` | Vertical offset as a fraction of canvas height |
| `sx` | Width multiplier on the part’s build box |
| `sy` | Height multiplier on the part’s build box |
| `a` | Opacity multiplier (lighting tracks) |

The client applies:

```
x        = part.box.x + dx * 100
y        = part.box.y + dy * 100
w        = part.box.w * sx
h        = part.box.h * sy
opacity  = part.opacity * a
```

The **cyclist ride** recipe covers the six bicycle/cyclist tracks. The
**night glow + dim** recipe covers the lamp/softbox/overhead/spot/light pool/
dimmer tracks. Everything else is a **hold** at its source box.

The animated cyclist starts small at the left and grows into the wall’s
transparent cyclist-shaped hole over the 8 seconds. That is the behaviour the
clean composition preserves.

---

## 5. Build algorithm

`src/server/scene-library.js` implements a deterministic interpreter. It is
not an LLM; the LLM/agent can use its output as structured evidence.

1. **Normalise** the idea and match concept aliases with word boundaries.
2. **Collect** matching concept part ids plus direct part-name hits.
3. **Add the documented base** (buildings + wall + pavement) and street
   furniture so a subject is not floating in space.
4. **Add** cyclist/bicycle parts for cyclist concepts, foreground parts for
   workshop/plants concepts, and the lighting stack for night/lighting.
5. **Deduplicate** baked overlays (`cafe-sign` inside the wall).
6. **Remove** reference/plate/duplicate parts.
7. **Sort** by `buildZ`, build the composition layers and filter the observed
   animation tracks to the selected layers.
8. **Report** what was matched, what is missing, what was deduped and why.

### Example outputs

**“Buildings, cars, bricks and a cyclist.”**

- Matched: buildings, bricks, cyclist
- Missing: cars
- Layers: 14
- Tracks: 6 (the ride rig)
- Notes: no car/van cut-outs; closest moving subject is the bicycle/cyclist.
- The reference plates and duplicate wheel/bicycle plates are excluded.

**“A cyclist passing a brick café at night, with warm lights and bollards.”**

- Matched: bricks, cyclist, bollards, café, lighting, street furniture
- Missing: none
- Layers: 21
- Tracks: 12 (ride + night glow)
- Café wordmark is the baked wall; separate sign omitted.
- The clean wall, pavement, workshop props, bollards, lamp and glows are used.

**“A workshop foreground with tools and plants, street behind.”**

- Matched: street, plants, tools, props
- Layers: 15
- No cyclist; foreground workshop and street base.

### Build response

```jsonc
{
  "schema": "studio/scene-build/1",
  "idea": "…",
  "scene": { "id": "…", "width": 1098, "height": 976, "duration": 8000, "background": "#15130f" },
  "interpretation": {
    "concepts": [{ "id": "bricks", "label": "Bricks & brick walls", "count": 3 }],
    "missing": [{ "id": "cars", "label": "Cars & vehicles", "description": "No car…" }],
    "note": "Matched …"
  },
  "parts": [ /* selected part records */ ],
  "groups": [ /* relevant groups */ ],
  "layers": [ /* composition-ready layers */ ],
  "composition": { "version": 3, "width": 1098, "height": 976, "duration": 8000, "layers": [] },
  "animation": { "url": "…", "duration": 8000, "tracks": [], "recipes": [] },
  "notes": [ /* agent/readable reasoning */ ],
  "agent": { "canBuild": [], "buildHints": [], "dataQuality": [], "missingVocabulary": [] }
}
```

---

## 6. API

| Endpoint | Returns |
|---|---|
| `GET /api/scene-library` | full index |
| `GET /api/scene-library/summary` | counts, palette, scene summary, examples |
| `GET /api/scene-library/scenes` | scene summaries |
| `GET /api/scene-library/scenes/:id` | full scene, parts, groups, tracks |
| `GET /api/scene-library/parts?q=&group=&concept=&scene=&limit=` | filtered parts |
| `GET /api/scene-library/parts/:id` | one part |
| `GET /api/scene-library/groups?q=&limit=` | filtered groups |
| `GET /api/scene-library/groups/:id` | one group |
| `GET /api/scene-library/build?q=…&scene=…` | build from query |
| `POST /api/scene-library/build` | body `{ "idea": "…" }` |

The static files are also public:

```
/data/library/scene-library/index.json
/data/library/scene-library/scenes/<id>.json
/data/library/scene-library/animations/<id>.json
/data/library/scene-library/assets/<scene>/<file>.png
```

---

## 7. Scene studio UI

`/segments#scene` adds the last tab to the segment library.

- **Describe** a scene in the textarea or pick an example.
- **Build scene** calls the build API.
- **Clean canvas** renders only the documented parts, on the scene background;
  no source plate is used as a shortcut.
- **Interpreted** chips show matched concepts and missing vocabulary.
- **Parts in this build** groups the selected parts by their documented group.
- **Agent notes** explain base additions, baked overlays, missing vocabulary.
- **Data quality** lists the source issues that affect reuse.
- **Play / Restart / scrub / speed** play the observed tracks on the composition.
- **Copy build JSON** copies the composition; **Download composition** saves it.
- The canvas opens on a still hero frame at 75% of the duration; press Play to
  see the ride fill the wall’s cyclist hole.

No drag editing is claimed here. This is an **agent proposal surface**: the
user describes, the library interprets, and the result is a composition that
can be opened in Studio. The next step is a “send to Studio” action.

---

## 8. Agent workflow

An agent should:

1. `GET /api/scene-library/summary` to learn the vocabulary and counts.
2. Search parts/groups with `q`, `group` or `concept`.
3. Call `POST /api/scene-library/build` with the user’s idea.
4. Read `interpretation`, `notes`, `agent.dataQuality` and
   `agent.missingVocabulary`.
5. Keep the returned `composition.layers` and `buildZ`.
6. Apply only the returned `animation.tracks`, matching `layerId` to
   `sourceLayerId`.
7. Preview the returned composition in the Scene studio before using it.

The agent must not treat reference plates as parts, must not add the separate
café sign on the baked wall, and must not invent cars or trees.

---

## 9. Rebuild and extend

```bash
npm run build:scene-library
# equivalent: python3 scripts/build-scene-library.py
```

The script reads the reviewed export, copies clean art, computes the index,
parts, groups, concepts, scene and animation metadata, and removes stale asset
copies. It writes a deterministic library apart from `generatedAt` and the
`reviewedAt` timestamp.

To add a new scene:

1. Export the composition, segments and animation from Studio.
2. Add a scene block to the script (or a second curation file).
3. Map every part to a human label, group, description, tags and concepts.
4. Review alpha, baked content and mislabeled duplicates before making a part
   buildable.
5. Rebuild, inspect `/segments#scene`, and add a build test.

---

## 10. Tests

- `node --test tests/scene-library.test.js` — 9 unit checks over the index,
  clean-art paths, missing cars, dedupe, workshop build, search and readers.
- `node tests/scene-studio.js` — 12 Chromium checks over the tab, 21-part
  build, data-quality card, missing-car path and playback.
- The existing `npm test` suite includes the Node test automatically.

---

## 11. Limits

- One scene only. The library is a pattern for many, not a finished universal
  scene grammar.
- No cars, trees or other missing vocabulary yet. The agent reports the gap.
- No drag/position editing in Scene studio yet; the build is a proposal.
- The source export has no clean full ground; the build uses a documented
  pavement crop and the scene’s dark canvas.
- The flattened plates remain reference-only; they are not reconstructed into
  parts.
- “Café sign” is a separate library part for other walls, but this scene’s
  wall already has the wordmark baked in.
