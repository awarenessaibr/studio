# Project canvas

`/project-canvas` opens **one real project composition** and lets a person and an
agent work on a variant of it. It is the per-project counterpart to the
[segment library](segment-library.md): instead of browsing reusable groups, the
canvas shows everything a single project has — the whole animation, its
segmentation, its text, its timing — and the agent already knows all of it.

- Page: `pages/project-canvas.html`
- Client: `src/client/project-canvas/project-canvas.js` + `project-canvas.css`
- Manifest (shared): `src/shared/project-manifest.js`
- Timeline editor (shared): `src/shared/project-timeline.js`
- Server: `src/server/project-canvas.js`
- Tests: `tests/project-canvas.test.js`

Nothing on the page is hardcoded for a project. Labels, ids, descriptions,
colours, fonts, code times and geometry are all read from the project's files, so
another project loads with the same page and the same agent contract.

## Opening a project

```
/project-canvas                      → the last project used in this browser
/project-canvas?project=<id>         → that project, first composition
/project-canvas?project=<id>&composition=<cid>
/project-canvas?project=<id>&composition=<motion id or display name>
```

The project picker is filled from `GET /api/project-canvas/projects`, which lists
every `data/projects/<id>/` that has a `compositions/*.composition.json`. The
composition is served through the existing read-only project window
(`/data/projects/<id>/compositions/…`, `…/images/…`), so the page needs no upload
and no server-side rendering.

A project with several compositions **and motions** shows a second picker. The
picker contains the base/editable compositions **and** every playable file under
`data/projects/<id>/animations/`:

- a **composition-style** motion (layers with `keyframes`) is opened as its own
  composition, with its own duration, layers and timeline;
- a **track-style** motion (`tracks`) is composed onto the project's base layers
  into a new in-memory composition;
- cue/type-only legacy files (no layers, no tracks) are skipped.

`composition` may be the motion's file id, its filename, or its display name —
the review matrix links use the display name so a library motion and the
project's own animation file resolve even when their ids differ.

The master composition is never changed: the page always builds a variant with
`ProjectManifest.start()`.

## What the canvas shows

| Part | Source | Behaviour |
|---|---|---|
| Stage | The composition | 1080×1920 (or whatever the project is) fitted to the available space, every layer at its keyframed pose. |
| Playback | `keyframes` | Play/pause, scrub, loop and speed. Space toggles playback; arrow keys step 100 ms. |
| Text | `text`, `font`, `color` | Rendered as text with the project's font loaded from Google Fonts on demand. `font.sizePct` is resolved against the basis the files imply (see below). |
| Image layers | `url` | Parent images and every segmented child PNG/SVG, positioned by its box; missing files are outlined instead of silently vanishing. |
| Selection | click | Whole semantic group by default, `Alt`-click for one part, `Shift`-click to add. The panel lists image sources, groups, every part and every text layer. Flat extracted projects get their semantic groups from `segmentGroup` even when they have no parented image sources. |
| Start mode | toolbar | **Original animation** keeps all keyframes. **Blank** keeps every element as a static asset at its first visible pose. Either way the work goes into a new variant. |
| Motion picker | `animations/*.json` | Base/editable compositions plus every playable project motion; selecting one reopens the manifest against that composition. |
| Variant | toolbar | Undo (30 steps) and *Download variant* write `<project>--<mode>.composition.json`. The master file is not touched. |
| Agent context | panel | The text the agent receives with every message, including the selection, the layers you added and your drawings. Copyable, and it updates with the selection, start mode, drawings and annotation window. |
| Drawings | canvas overlay | Freehand paths drawn over the stage, each with a green start dot, a purple end dot and an arrowhead. They are attached to your messages with the annotation window. |
| Added images | toolbar | Local images become real layers of the working variant; they are listed under *Added in this session* and the agent can animate them exactly like project layers. |

`font.sizePct` is a percentage of the canvas height in compositions authored in
the studio, but HTML-imported projects measured it against the canvas width. The
manifest infers the basis from the measured text boxes (`textBasis`) and reports
it in the context, so both kinds of project render at the size they were
measured at without a project-specific switch. The same boxes say how many lines
a text layer took, so single-line copy does not wrap and multi-line copy does.

## The manifest

`ProjectManifest.build(composition, segmentationIndex)` returns:

- `entities` — one per layer: id, label (`meta.segmentation.objectLabel`), description, box, z, url, text, colour, font, visibility windows from the opacity keyframes, keyframe count.
- `parents` — the segmented image sources, their children, source size and the scene description from the index.
- `groups` — the semantic groups (`segmentGroup` / `groupId`), their union box and combined visibility window. Parented segmentation groups come from the segmentation index; a flat project's groups are derived from the layer `segmentGroup` labels so it is still navigable as Architecture, Wall Art, Props, etc.
- `events` — the original animation, clustered per subject and time window, so 13 limbs moving together is one line: `2.3s→2.67s BOO! moves dx12 dy1.69 dw-24`.
- `notes` — facts the agent must plan around, derived from the files: children inherit parent keyframes, which images are not segmented, whether the project has any video/sprite frames, and where background parts stack above a subject.
- `textBasis` — `width` or `height`, inferred from the measured text boxes.

`context(manifest, {selection, mode})` is the compact agent view (roughly 7 KB for
the reference project, against ~200 KB for the raw composition). It is stable
text, not project-specific code. `find()`, `at()` and `keyframes()` are the
on-demand query side used by the agent's query round.

## The timeline editor

`ProjectTimeline` is pure and runs in the browser and under Node:

```js
pose(layer, ms)                         // the pose at a time
applyEdits(comp, manifest, edits)       // write edits, returns { summary, earliest }
addGeneratedLayer(comp, spec)           // new inline-SVG layer (a ghost, a flame, a prop)
```

An edit targets layer ids, group ids or image-source ids; groups are expanded to
their members. Two modes:

- **Relative** (the default, and what the agent uses): `{time, dx, dy, scale, rotation, opacity}` are offsets composed **on top of** the existing animation. `dx/dy` are canvas percent, `scale` and `rotation` orbit a pivot (canvas percent, default the group centre), `opacity` multiplies. Because the union of the edit times and every existing keyframe time is rewritten, moving a subject does not erase the exit jump that is already in the project.
- **Absolute**: `{time, x, y, w, h, rotation, opacity}`; omitted fields keep the current value.

A pivot is what makes a step cycle possible: the agent can rotate a leg or an arm
around a hip or shoulder point while the group motion stays underneath. There are
no walk frames in a segmented project, so this is the honest limit of what can be
animated from its own parts.

Generated layers are inline SVG data URLs with `generated: true` in their meta, so
they can be told apart from the project's own assets. The SVG must be one
complete element with no scripts, event handlers, iframes or external references.

## Drawing a path

**Annotate** turns the stage into a drawing surface. Drag from where the motion starts
to where it ends; the canvas records the path in canvas percent, not screen pixels, so
it survives resizing and reloads the layout. Every stroke is drawn with:

- a **green dot** at the start,
- a **purple dot** at the end,
- an **arrowhead** showing the direction,
- and its points in order.

`Undo stroke` and `Clear` manage the drawings. **Applies from … to …** is the window
the drawing describes. It defaults to the selected subject's visible window (select the
character and it becomes `0.0–7.4 s`), can be overridden by typing, and is pinned as
soon as you draw so a later selection change does not silently retime it. *Use selection
window* restores the selection's window on demand.

The drawings are not project layers and are not written into the downloaded
composition. They are sent with each agent message, and the server turns the route
into **suggested relative keyframes** for the selection: the first offset is `0`, the
subject starts where it already is, and each later offset follows the drawn
displacement while the subject's own animation is subtracted, so the route is tracked
exactly. That is why the agent can act on "follow the drawn path" without guessing.

## Adding images

**Add image** (or dropping an image file on the stage) adds a local image as a layer
of the working variant. It is centred, sized from its natural aspect ratio (up to 40 %
wide and 55 % high), placed above the project's layers, given a name from the file and
selected when nothing else was selected. Raster images larger than 1600 px are
downscaled in the browser before they are stored. It appears under *Added in this session* and
in the agent context, and it can be moved, scaled, faded or animated by the agent in
exactly the same edits as a project layer.

The image lives in the browser (a data URL inside the variant), is never uploaded to
the server, and survives a *Download variant* because the data URL is part of the
composition JSON. A page reload starts again from the master, so download the variant
if you need to keep it.

## The agent

`POST /api/project-canvas/agent` is one turn:

```json
{
  "projectId": "…",
  "compositionId": "…",
  "mode": "original",
  "selection": ["m04-photo-t-pby-sp-on--group-character"],
  "variant": {
    "layers": [{ "id": "gen-…", "name": "my photo", "kind": "uploaded", "x": 30, "y": 42, "w": 40, "h": 15, "z": 25 }],
    "annotations": {
      "strokes": [{ "points": [[22, 62], [28, 58], […], [64, 34]] }],
      "from": 1000,
      "to": 4000
    }
  },
  "messages": [{ "role": "user", "content": "make him follow the drawing" }]
}
```

`variant` is optional and carries only what the browser added: layers created in this
session (uploaded images, generated elements) and the drawings with their window. The
server validates it (20 layers, 12 strokes, 400 points per stroke, coordinates clamped
to the canvas), appends a **CLIENT VARIANT** and **USER ANNOTATIONS** section to the
context, and includes **SUGGESTED PATH KEYFRAMES** whenever a subject is selected.
Client-variant ids are accepted in `edits` exactly like master ids, so the agent can
animate an uploaded image or a generated element in the same reply.

The server rebuilds the manifest from disk on every turn, appends the selection
and start mode, and asks the model for exactly one JSON object:

```json
{
  "reply": "one short sentence",
  "beats": ["walk to the right", "sees the ghost and turns"],
  "ask": null,
  "edits": [{ "ids": ["…"], "relative": true, "pivot": { "x": 23, "y": 60 }, "keyframes": [{ "time": 0, "dx": 0 }, { "time": 2000, "dx": 30 }] }],
  "layers": []
}
```

If the context is genuinely not enough, the model may instead ask for one round of
lookups:

```json
{ "queries": [{ "tool": "find_elements", "query": "blue top" }] }
```

`find_elements`, `get_keyframes` and `visible_at` run server-side against the
manifest and composition, and the model's second call receives the results. There
is no native tool-calling dependency: the same contract works with the DeepSeek
API (`response_format: json_object`) and with local Ollama models (`format: json`).
The prompt is owned by `src/server/project-canvas.js`, so a client cannot change
what the agent is allowed to do.

Every reply is validated and bounded before it reaches the page: at most 12
edits, 200 keyframes per edit, 6 generated layers, times clamped to the duration,
unknown ids dropped, unsafe SVG rejected. Uploaded and generated layer ids are kept
and expanded just like group ids. Rejected parts come back in `warnings` and are shown
in the chat instead of failing silently.

### What the page does with a turn

1. It applies `edits` through `ProjectTimeline.applyEdits`, building on the
   existing animation. Edits can target project layers, groups, uploaded images or
   generated elements.
2. It adds `layers` through `ProjectTimeline.addGeneratedLayer`.
3. It rebuilds the manifest and the stage, jumps to the first edited time and
   plays.
4. It records the applied summary in the conversation, so the next turn knows
   what already happened.

Undo restores the previous variant. All of this is client state: the server never
writes a project file.

The context is rebuilt from the **master** composition on every turn, while the
browser owns the working variant. Relative edits therefore keep composing on top
of whatever the browser has already done, and the conversation carries the
applied summary back to the agent so it knows what changed. That also means a
page reload starts again from the master unless the variant is downloaded.

## API

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/project-canvas/projects` | Projects with at least one composition: id, name, canvas, duration, layer count, composition ids and whether they are segmented. |
| `GET` | `/api/project-canvas/project/<id>[?composition=<cid>]` | The project summary, the master composition JSON and the segmentation index. |
| `GET` | `/api/agent-canvas/providers` | The model providers the agent can use (shared with the Agent Canvas). |
| `POST` | `/api/project-canvas/agent` | One validated agent turn (above). |

Errors are ordinary JSON `{ error }` responses with 400/404/502/503 statuses and
are shown in the chat.

## Tests

```bash
node --test tests/project-canvas.test.js
npm run test:project-canvas
```

The tests use the repository's own project
(`data/projects/06----giovannin-senza-paura-reels-03`) and a fake model, so they
run without any API key. They cover the manifest counts and context, selection
expansion, the query round, validation and clamping, generated layers, uploaded
images, the relative-keyframe composition, variant layers and drawn annotations,
the suggested path keyframes, the project reader's path safety, and the page
route/asset wiring.

## Limits, stated plainly

- The agent speaks JSON, not native tool calls. One query round keeps the contract portable; a plan that needs a third round is answered from what it has.
- Segmented parts are separate layers, so a convincing walk depends on the model choosing good hip/shoulder pivots. There are no walk frames to sample.
- New characters and effects have to be generated as SVG layers; the project has no video, sprite or image-generation pipeline of its own.
- Stacking order can be odd in an imported cut-out (a white "background" part above the limbs). The manifest reports it in `notes`; the page does not silently reorder the project.
- Missing image files are outlined on the stage rather than replaced.
- The agent is text-only: it receives an uploaded image's id, name and box, not its
  pixels, so it can place and animate it but cannot describe what it shows.
- Drawings describe one route. Several strokes are consecutive legs in the order
  drawn; independent simultaneous motions need separate messages or explicit words.
- Drawings and added images are browser state, not master-file edits. Download the
  variant to keep them; a reload starts from the master composition.
