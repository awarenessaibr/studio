# Composition image segmentation

The Giovannin reels 03 project now carries **nested image segmentation**
inside its composition. Four source image layers were decomposed into
semantic child layers; those children inherit the parent image's animation and
are wired back into the same 1080×1920, 10-second composition.

| | |
|---|---|
| Project | `data/projects/06----giovannin-senza-paura-reels-03/` |
| Segmentation root | `images/segmentation/` |
| Map/index | `images/segmentation/index.json` |
| Human notes | `images/segmentation/README.md` |
| Wired composition | `compositions/06----giovannin-senza-paura-reels-03.composition.json` |
| Original backup | `compositions/06----giovannin-senza-paura-reels-03.pre-segmentation.json.bak` |
| Wiring script | `scripts/wire-segmented-layers.js` |
| Restore | `node scripts/wire-segmented-layers.js --restore` |

---

## 1. What was wired

The source image layers and their segmentation packs:

| Parent | Source size | Child layers | Groups |
|---|---:|---:|---|
| `html-bg` — background pattern | 3375×6000 | 10 | Background, Pattern Columns, Dot Clusters |
| `m04-photo-t-pby-sp-on` — pixel character | 1010×964 | 15 | Character, Background |
| `m05-shape-gradient` — thin gradient | 3375×54 | 2 | Background |
| `m15-photo-t-pop2-sp-mf-on` — pixel photo | 38×28 | 7 | Background, Subject |

`m13-photo-t-sp-me-on` has no segmentation pack and remains one SVG image
layer. The composition goes from **25 parent layers to 55 layers**:
4 parents were removed and replaced by **34 child layers** in **8 semantic
groups**.

The segmentation packs are the original `image-to-layers` exports. They
already contain:

- `compositions/<pack>.composition.json` — source-pixel composition
- `layers.json` — object boxes and file paths
- `scene.json` — description, style, object labels/descriptions (except m05)
- `images/**/*.png` — cropped cut-outs

---

## 2. Coordinate mapping

Each segmentation child is placed inside the parent image's **current
keyframe box**:

```
child.x = parent.x + local.x × parent.w
child.y = parent.y + local.y × parent.h
child.w = local.w × parent.w
child.h = local.h × parent.h
```

`local` is the source segmentation layer's box in **percent of its source
image**, from `0..1`. The parent keyframe box is in percent of the main
1080×1920 canvas.

The parent image layers use `fit: "fill"`, so the local box is stretched with
the parent. If a future parent uses `contain`, the script computes the actual
contained image rectangle first. The child layers use `fit: "fill"` for fill
parents and `contain` for contain parents.

---

## 3. Animation inheritance

Every child gets one keyframe per parent keyframe, at the same time:

- `x/y/w/h`: remapped through the formula above
- `rotation`: parent rotation
- `opacity`: parent opacity
- `easing`: parent easing

This means the character, background pattern, gradient and pixel photo move,
fade and appear exactly when their parent did. The parent layer's end/start
window is inherited through opacity. The child keeps the parent box at each
time, not just the base box.

There is no independent animation invented for the children. The child tracks
are a **projection of the parent track**, not a new motion.

---

## 4. Z order

Main `z` is fractional:

```
child.z = parent.z + sourceZ / 1000
```

Examples:

- `html-bg` (z0) → children `0.002 … 0.011`
- `m04` (z2) → children `2.002 … 2.016`
- `m05` (z3) → children `3.002 … 3.003`
- `m15` (z13) → children `13.002 … 13.008`

This keeps each child between the old parent layer and the next sibling while
preserving the source segmentation stack. The renderer sorts by numeric `z`,
so fractional values work without changing the composition schema.

---

## 5. Reference and unassigned layers

- `reference` / Final image layers are **excluded**; they are visual previews.
- `unassigned` layers are **kept**; they contain leftover pixels that did not
  match a semantic object, so removing them would lose pixels.
- `white-background`, `background`, `main-brown-block` and other full-bleed
  parts are ordinary child layers.

---

## 6. Layer metadata and IDs

Each child has:

```jsonc
{
  "id": "m04-photo-t-pby-sp-on--seg-layer-character-character-head",
  "parentId": "m04-photo-t-pby-sp-on",
  "groupId": "m04-photo-t-pby-sp-on--group-character",
  "segmentGroup": "Photo (m04) / Character",
  "name": "Photo (m04) · Character Head",
  "role": "character-part",
  "z": 2.013,
  "url": "/data/projects/…/images/segmentation/…/character/character-head.png",
  "fit": "fill",
  "keyframes": [ /* one per parent keyframe */ ],
  "meta": {
    "segmentation": {
      "parentLayerId": "m04-photo-t-pby-sp-on",
      "parentName": "Photo (m04)",
      "sourceFolder": "m04-photo-t-pby-sp-on-png",
      "sourceImage": "m04-photo-t-pby-sp-on.png",
      "sourceWidth": 1010,
      "sourceHeight": 964,
      "objectName": "character-head",
      "objectLabel": "Character Head",
      "objectDescription": "The peach-colored block forming the character's face.",
      "objectGroup": "Character",
      "objectRole": "character-part",
      "bbox": [283, 72, 770, 402],
      "localBox": { "x": 28.0198, "y": 7.4689, "w": 48.2178, "h": 34.2324 },
      "sourceZ": 13,
      "sceneDescription": "A flat, pixel-art style illustration…",
      "sceneStyle": "pixel art",
      "coordinateSpace": "percent of source image; mapped into the parent keyframe box",
      "inheritedKeyframes": 18
    }
  }
}
```

`parentId`, `groupId`, `segmentGroup` and `meta.segmentation` are preserved by
the Studio’s `compositionLayer()` and `compositionFromScene()` round-trip.

---

## 7. Composition metadata

The wired composition adds:

```jsonc
{
  "meta": {
    "segmentation": {
      "schema": "studio/image-segmentation/1",
      "method": "image-to-layers",
      "parents": [ /* source sizes, descriptions, groups, child counts */ ],
      "groups": [ /* parent/group and members */ ],
      "counts": { "segmentedParents": 4, "childLayers": 34, "groups": 8, "skippedParents": 0 },
      "mapping": { "sourceSpace": "…", "rule": "…" },
      "indexFile": "images/segmentation/index.json"
    },
    "agentAwareness": {
      "summary": "Four source images…",
      "groups": [],
      "howItWorks": [],
      "instructions": [],
      "queryHints": []
    }
  }
}
```

The same map is in `images/segmentation/index.json` for agents that only read
the segmentation folder. The Studio preserves the composition-level map when
saving a composition and reconstructs a minimal map from per-layer
`meta.segmentation` if the page was reloaded from a saved scene.

---

## 8. Agent awareness in Studio

The Studio agent has four layers of context:

1. **Layer context** — the selected child’s `meta.segmentation` includes the
   parent layer, object label, description, group, source scene and local box.
2. **Timeline groups** — segmented children are grouped by `segmentGroup`
   (e.g. `Photo (m04) / Character`) instead of the generic role. Group
   **Select** selects every part in that source/group.
3. **Composition context** — with nothing selected, the context reads
   `34 segmented parts in 8 groups`. The agent’s greeting mentions segmented
   parts when they exist.
4. **Local intent** — asking **“segments”**, **“parts”**, **“structure”** or
   **“how is this built”** returns the source parents, semantic groups and
   their object labels. The quick prompt **Segments** appears on a selected
   part.

The agent is instructed not to recolour/crop the cut-outs, to treat text
layers as text, to use the group selection for a semantic set, and to read
`meta.segmentation` before answering about a part.

The local agent still does not call an LLM; a real LLM agent can read
`meta.segmentation`, `meta.agentAwareness` and the index directly.

---

## 9. Rebuild / restore

```bash
# first run writes a backup and wires the four packs
node scripts/wire-segmented-layers.js

# restore the original 25-layer composition
node scripts/wire-segmented-layers.js --restore

# another project with the same folder convention
node scripts/wire-segmented-layers.js data/projects/<project-id>
```

The library card `data/library/designs/singl-end-giovannin-senza-paura-03.json`
now points at this wired composition and exposes
`images/segmentation/index.json` as its `segmentation` source.

The script:

- discovers `images/segmentation/<parent-id>-png/` packs;
- uses the pre-wiring backup on later runs so it is idempotent;
- maps each parent keyframe;
- writes the wired composition and `images/segmentation/index.json`;
- writes a human-readable `images/segmentation/README.md`;
- skips missing parents, reference layers and malformed parts with warnings.

---

## 10. Better long-term schema

The current implementation is a **non-destructive bridge**: children are flat
layers with fractional z and parent metadata. That fits the existing
`agent-studio/composition/1` schema without a migration.

A cleaner future schema would add real nested groups:

```jsonc
{
  "groups": [{
    "id": "m04-photo-t-pby-sp-on",
    "type": "image-segmentation",
    "source": "m04-photo-t-pby-sp-on.png",
    "transform": { "x": 12, "y": 59.62, "w": 22, "h": 15.75 },
    "keyframes": [ /* parent animation */ ],
    "children": [ /* local boxes */ ]
  }]
}
```

Then the editor would move/retime the parent once, not 34 child tracks.
Until the schema and renderer support nested transforms, the flat projection
is the safe implementation: it is visually exact with the current engine and
the metadata makes the structure explicit.

---

## 11. Tests

- `npm run test:segmentation-wire` — 6 Node checks over the parent/child
  inventory, keyframe timing, local-to-parent box mapping, fractional z,
  opacity inheritance, composition meta and the segmentation index.
- `npm run test:segmented-composition` — 14 Chromium checks over the 55-layer
  Studio import, timeline groups, selected-child context and the agent’s
  “segments” report.

## 12. Limitations

- A child is a **projection** of the parent track; editing one child does not
  edit the parent group. Use the timeline group Select to manipulate a set.
- There are 55 layers and 844 keyframes in the wired composition; the timeline
  groups and filters are essential.
- The source segmentation for `m13-photo-t-sp-me-on` is missing; it remains a
  single SVG image.
- The segmentation packs were produced by `image-to-layers` with model
  descriptions; object labels/descriptions are only as good as that export.
- Reference plates are excluded; unassigned pixels are retained, which can
  produce transparent leftovers that look odd in isolation but preserve the
  image.
- The script assumes segmentation folder names end in `-png` and match the
  parent layer id. Rename the parent or folder consistently.
