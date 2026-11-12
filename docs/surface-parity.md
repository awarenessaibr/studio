# The four surfaces: parity, availability and review marks

The four studio UIs browse the same brand material from different catalogues.
This page records what each surface can do, the availability bug that made the
same motion work in one UI and look blocked in another, and the shared review
system that now lets you mark what works where.

The four surfaces:

| Surface | Page | Catalogue it opens |
|---|---|---|
| **AFS** (Agent First Studio) | `/afs.html` | `data/library` designs + published brand templates; menus, narration and audio |
| **Studio Agent** (Clean Canvas) | `/studio-agent.html?clean=1` | brand templates + the `data/library` drawer |
| **Project canvas** | `/project-canvas` | real project compositions under `data/projects` |
| **Studio** (Agent Studio) | `/studio.html` | brand packs, published templates and project compositions, with the timeline |

![The review matrix](../deliverables/review-parity/review-matrix.png)

## What was wrong

AFS loaded a library animation only when the JSON had a `tracks` array, and it
trusted the animation `status` written at build time:

- A **composition-style** motion file (a whole composition whose layers carry
  `keyframes`, as Project Canvas and Studio play them) has no `tracks`. AFS
  dropped it, so a design could show **0 animations** and be labelled
  **blocked** while the same file played in Studio Agent, Project Canvas or
  Studio. `Butterfly-The-Stairs` was the clearest case: three valid motions,
  all archived as compositions, all listed as `broken`.
- Some track files were archived as `broken` even though the current validator
  accepts them. Studio Agent filtered to `status === 'ok'` and AFS filtered
  `status !== 'broken'`, so each UI hid a different subset.
- The same published template could appear once as a library design and once as
  a published template, with different status labels.

## What changed

**One animation normaliser.** `src/shared/animation-normalize.js` turns layer
keyframes into `agent-studio/animation/2` tracks (base geometry removed,
`sx`/`sy`/rotation/opacity preserved). AFS and Studio Agent load it and normalise
every motion file before listing it, so a composition-style motion plays in
both. AFS switches the canvas to that composition when it is selected.

**Availability is measured, not trusted.** Both library UIs now load every
animation file and keep what can play: normalised tracks, or a source video.
`status` is advisory and is shown as an auto hint; it no longer decides whether
a motion is listed. The same rule applies to designs: `blocked` + playable
motions is shown as **playable** in AFS.

**Statuses were revalidated.** `scripts/revalidate-library.js` re-runs the save
path's validator, resolves the composition each track actually fits, and
understands composition-style motion. It updated 28 stale statuses (mostly
`broken → ok` for poster-hold motions and composition files) and turned a few
`ok → warn` where a track really has a non-positive scale. Current library:
**119 designs** (97 ready / 22 review / 0 blocked) and **156 ok / 11 warn /
4 broken** animations. The four broken ones belong to
`singl-end-giovannin-senza-paura-03` and are still listed in the review matrix,
not silently dropped. `Butterfly-The-Stairs` is no longer blocked: its empty
"Original motion" was retired and its three real motions remain.

**No more duplicate cards in AFS.** A library design and a published template
with the same composition id or the same (suffix) name now merge into one card;
the library record owns the motion, the published record only adds a flag.

**The review vocabulary.** Every motion problem is not a status code to guess:
each surface can carry a manual mark.

| Mark | Meaning |
|---|---|
| **Works** | verified working in this surface |
| **Doesn't work** | broken or unusable in this surface |
| **Needs review** | loads, but the result is questionable |
| *Unmarked* | no manual mark; the auto status is shown |

Marks are **per surface**, because the same design can work in Studio Agent and
fail in AFS. A shared item still collects the marks from all four surfaces, so
opening the same composition in another UI shows what the others say.

Items are matched by any of their ids — `designId`, `compositionId`,
`animationId`, `projectId`, `templateId` — so a library design in AFS and the
same composition in Project Canvas share one row. Animations are their own
items; they do not inherit their design's mark.

Data and API:

- `data/settings/reviews.json` — `{schema: "studio/reviews/1", items: [...]}`
- `GET /api/reviews` — the whole registry
- `POST /api/reviews` — `{ids, name, kind, surface, status, note, auto}`; use
  `status: "unmarked"` to clear one surface
- `POST /api/reviews` with `mode: "note"` — `{ids, name, kind, note}` sets the
  item note without changing a surface mark
- `GET /api/thumbnail?src=…&w=…` — cached, resized JPEG cover for a public
  raster image (see [Covers](#covers))
- Surfaces: `afs`, `studio-agent`, `project-canvas`, `studio`
- Statuses: `works`, `broken`, `review`, `unmarked`

## Where to mark

| Surface | Where the control is |
|---|---|
| AFS | designs drawer → design detail → **Review in AFS**; every motion row has a badge, and the selected motion has its own control; the card has a review badge; the drawer has a **Review** filter |
| Studio Agent | Designs drawer → selected library card → **Review · Studio Agent**; each motion shows a badge and the selected motion has a control; the drawer has a review filter |
| Project canvas | toolbar → **Review · Project canvas** for the open composition (matched by composition/project id) |
| Studio | canvas toolbar → **Review · Studio** for the current template/project/scene |

All four link to the **review matrix** (`/reviews`) — one table of designs,
motions, project compositions and brand templates with a cover, a Note column,
four surface cells and a **↗** next to each cell that opens that exact item in
the surface. Click a cell to cycle: unmarked → works → doesn't work → needs
review → unmarked. Filter by brand, text, surface and status.

### Covers

Every row starts with a cover so the matrix is scannable without opening each
item. The source is the item's own final image:

| Row | Cover |
|---|---|
| Library design | `thumbnail` in `data/library/index.json` (the saved final image) |
| Motion | its design's cover, at 72 px, with a play badge |
| Project composition | the composition's reference layer, then `images/poster.png`, then its largest raster artwork layer |
| Brand template | the composition's reference/artwork layer, else the brand cover |

`GET /api/thumbnail?src=<public image URL>&w=<32–640>` resizes the original to
one small JPEG and caches it under `data/cache/thumbnails/<sha1>.jpg` (mtime and
width are part of the key), so the matrix never downloads print/reel-sized
references. Only images the server already publishes as static files are
accepted — project/import/library media, project assets, brand-pack files and
saved-template files — and the source must be PNG/JPEG/WebP; SVG is rejected
because ffmpeg cannot rasterise it reliably. If generation fails the tile falls
back to a monogram. Clicking a cover opens the item in the surface currently
selected in the Surface filter.

### Notes

Notes are **item-level**, shared by every surface and every UI (the ✎ in the
per-UI control edits the same note as the matrix's Note column). A note can be
saved without a mark; the item keeps the note and the four surface cells stay
unmarked.

### Jump links

Each ↗ opens the right page with the item preloaded:

| Surface | URL |
|---|---|
| AFS | `/afs.html?design=<designId>` or `&animation=<animationId>` |
| Studio Agent | `/studio-agent.html?clean=1&library=<designId>` or `&animation=<animationId>` |
| Project canvas | `/project-canvas?project=<projectId>&composition=<compositionId>` |
| Studio | `/studio.html?project=<projectId>&composition=<compositionId>` or `?pack=<packId>&brand=<brandId>&template=<templateId>` |

Motion rows link to AFS and Studio Agent by animation id, and to Project canvas
and Studio by display name when the motion belongs to a project
(`data/projects/<id>/animations/`). Project canvas and Studio now resolve a
motion id, filename or display name to the project's own motion file. Broken
motions with no source recording get no link.

## Capability matrix

| Capability | AFS | Studio Agent | Project canvas | Studio |
|---|---|---|---|---|
| Browse the `data/library` catalogue | all designs | drawer (all designs) | projects only | no (brand templates) |
| Play library **source recordings** | yes | yes | source link | no |
| Play **track** animations | yes | yes | yes (keyframes) | yes (timeline) |
| Play **composition-keyframe** animations | yes (normalised) | yes (normalised) | yes | yes |
| Menus and menu variations | yes | no | no | yes |
| Narration and audio mix | yes | no | no | no |
| Edit layers / geometry | no | limited (copy, assets, colour) | yes | yes |
| Save a library animation | yes | yes (agent canvas) | no | shared animation library |
| Manual review marks | yes | yes | yes | yes |
| Review matrix | yes | yes | yes | yes |

AFS keeps menus and narration; Studio and Project Canvas keep layer editing and
the timeline. The library, animation availability and review marks are shared.
A full single-catalogue service (one endpoint feeding all four) is the next
step if the surfaces should converge further; the current change removes the
availability mismatch without changing each UI's editing model.

## Rebuild / audit

```bash
node scripts/revalidate-library.js --dry   # report status drift
node scripts/revalidate-library.js         # write corrected statuses
npm test                                   # review store, normaliser, library tests
```

Tests: `tests/review-store.test.js`, `tests/animation-normalize.test.js`,
`tests/canvas-decks.test.js`, `tests/layered-animation.test.js`.
