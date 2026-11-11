# Segmentation automation (image-to-layers → Studio)

The image-to-layers segmenter already writes a complete provisional Studio
project:

```
data/projects/<target>-segmented/
  compositions/<target>-segmented.composition.json   reference + parts
  images/<group>/<part>.png
  images/reference.png
  layers.json    names, groups, labels, descriptions, boxes
  scene.json     description, style, objects
```

**Studio now imports that project into the real target project in one step**,
instead of keeping a second project that has to be wired and indexed by hand.
The importer validates it, maps the parts into the target image's layer,
recomputes z, writes the canonical segmentation pack and the
`<target>-segmented` composition, updates the index, and archives the
provisional project. The target's master poster and editable frame archive are
never changed.

The reference run is `borders-web-where-i-work-animated-03`: **55 parts in 8
groups** imported into `source-frame-png` and verified to reproduce the poster
with **0 differing pixels**.

---

## 1. The export contract

A valid `<target>-segmented` project:

- has `compositions/*.composition.json` with a hidden `reference` layer and
  the cut-out layers (parts may omit `type: "image"`; a `url` is enough);
- has `images/reference.png` (the exact image the user segmented) and one PNG
  per part;
- has `layers.json` with `{name, file, group, label, description, role, bbox}`
  for every part;
- has `scene.json` with the overall `description`, `style` and `objects`;
- names the project `<target>-segmented`.

Optional `studio-target.json` (written by the image-to-layers app when a Studio
project is selected):

```json
{
  "projectId": "borders-web-where-i-work-animated-03",
  "imagePath": "images/poster.png",
  "layerId": "source-frame"
}
```

If the marker, `--image` or `--layer` is absent, Studio chooses the target's
poster layer (or its only full-canvas image layer) and validates that the
reference size matches that image.

## 2. Studio CLI

```bash
npm run wire:segmentation -- borders-web-where-i-work-animated-03-segmented

# explicit target / image / layer
node scripts/wire-segmentation-project.js <id> \
  --target borders-web-where-i-work-animated-03 \
  --image images/poster.png \
  --layer source-frame

# validate only (no writes, no moves)
node scripts/wire-segmentation-project.js <id> --check --json

# keep the provisional project instead of archiving it
node scripts/wire-segmentation-project.js <id> --keep-source
```

`--json` prints one object, which is what the image-to-layers server consumes:

```json
{
  "ok": true,
  "targetProjectId": "…",
  "segmentedProjectId": "…",
  "parent": { "id": "source-frame", "name": "Poster" },
  "counts": { "parts": 55, "groups": 8 },
  "groups": [{ "label": "Map Labels", "count": 19, "z": [0.54, 0.87] }],
  "compositionId": "…-segmented",
  "compositionFile": "compositions/…-segmented.composition.json",
  "archivedTo": "images/segmentation/_source/…",
  "compositionUrl": "/project-canvas?project=…&composition=…-segmented"
}
```

## 3. Studio API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/segmentation/exports` | List provisional `<project>-segmented` projects still waiting to be imported. |
| `POST` | `/api/segmentation/wire` | `{segmentedProjectId, targetProjectId?, imagePath?, layerId?, keepSource?, check?}` → import and return the report. |

Errors are normal `{error}` JSON responses with 400/404/413/500 statuses. The
same id/path validation is used by the CLI.

## 4. What the import writes

For target `T` and parent layer `P` (for example `source-frame`):

| Output | Meaning |
|---|---|
| `T/images/segmentation/<P>-png/images/<group>/<part>.png` | canonical pack assets |
| `T/images/segmentation/<P>-png/compositions/<P>-png.composition.json` | pack composition (reference + parts) |
| `T/images/segmentation/<P>-png/layers.json` | pack manifest with local boxes, labels, descriptions |
| `T/images/segmentation/<P>-png/scene.json` | overall description, style and objects |
| `T/images/segmentation/index.json` | merged parent/group/part map (existing packs are kept) |
| `T/compositions/<T>-segmented.composition.json` | the wired composition |
| `T/images/segmentation/_source/<T>-segmented/` | archived provisional project (composition, layers, scene, reference) |
| `T/images/segmentation/README.md` | human notes |

Every child gets `parentId`, `groupId`, `segmentGroup` and
`meta.segmentation`, plus one keyframe per parent keyframe. The exported
`<T>-segmented` project is removed after the archive, so it stops appearing as
a project in Studio.

## 5. Coordinate mapping

The export's boxes are percentages of the reference image, which is the
selected target image. For each parent keyframe:

```
rect = the parent image rectangle at that time
       (the parent box for fit: fill; the contained/cropped image rect for
        contain/cover)
child.x = rect.x + local.x / 100 × rect.w
child.y = rect.y + local.y / 100 × rect.h
child.w = local.w / 100 × rect.w
child.h = local.h / 100 × rect.h
```

Rotation and opacity are inherited from the parent keyframe. A parent with no
keyframes gets a static pair at `0` and the target duration.

For a full-poster target this is the identity transform, which is why the 55
parts reproduce the poster exactly.

## 6. Z order

The exporter's z is the order the layers were added, which puts backgrounds
above labels. The importer assigns a semantic stack instead:

| Group family | Base |
|---|---:|
| Background / Unassigned / Sky / Ground | 1–2 |
| Map Base / Terrain | 10 |
| Routes / Map Details / Roads / Rivers | 20 |
| Map Markers / Pins / Dots | 30 |
| Map Labels / Labels / Text | 40 |
| Kelso / Characters / Subject | 45 |
| Map Icons / Icons / Symbols | 50 |
| Compass | 55 |
| Typography | 60 |
| Header / Branding / Logo | 70 |
| Footer | 80 |
| Unknown groups | 35 (warning) |

Parts stay inside the parent's z slot:

```
parent.z < child.z < next sibling z
```

so the segmented composition composes correctly with the rest of the target
composition. Within a group the exporter's order is preserved.

## 7. App integration (image-to-layers)

The image-to-layers app adds a **Studio project** selector and an **Image**
selector in the Composition panel:

1. Pick a project (the list excludes `*-segmented` exports).
2. Pick one of its master image layers (the poster by default). The image is
   loaded as the reference and the project name becomes `<target>-segmented`.
3. Run. After the CLI writes the provisional project, the app server calls the
   Studio CLI with `--json` and the selected target/image. The result shows
   **“Wired into <target> — N parts · G groups”** with a direct link to the
   segmented composition in Studio.
4. If wiring fails, the provisional project is kept and the error is shown; no
   data is lost. `POST /api/studio/wire` retries the import.

The app talks to the importer through the **Studio CLI**, not HTTP, so it works
even when the Studio server is not running; it only needs the `node` binary and
the Studio checkout (`STUDIO_ROOT`, default `../studio`).

## 8. Tests

```bash
npm run test:segmentation-autowire
```

Eight Node checks cover the semantic z helper, the parent-rectangle mapping,
the imported 55 parts/8 groups, every URL and PNG aspect, the pack/index
agreement, the untouched master and editable archive, the project canvas
manifest, and the archived source.

The reference run was also composited externally: the 55 parts in the imported
z order reproduce `poster.png` with **0 differing pixels**.

## 9. Limits

- One parent image per import; importing another image into the same target
  adds a second pack and the index/composition keep both.
- The reference must be the full selected image. The importer maps it into the
  target layer's box, so a crop of an image is not a valid reference unless its
  box is set up accordingly.
- The target master composition must still contain the parent layer.
- The imported composition is static unless animated; the original motion stays
  the source recording / editable frame archive.
- The provisional project is archived under `_source/` rather than deleted
  without trace. Use `--keep-source` to keep it as a normal project.
- Do not run the generic `npm run wire:segments` on these targets; it expects
  segmentation packs inside a composition, while this pipeline imports a
  full provisional project.
