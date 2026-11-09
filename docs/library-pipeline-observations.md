# Library pipeline observations

**Status:** 63 library designs, 61 source-exact original recordings.

This document records the full pipeline used to turn HTML templates into Agent
First library designs, with batches 7–9 (eighteen unique HTML sources → forty-eight stages)
as the worked examples. The goal is to make the next batch faster and
avoid re-discovering the same failure modes.

## Outcome

| Metric | Value |
|---|---|
| Batch 7 sources / stages | 7 / 18 |
| Batch 8 unique sources / stages | 6 / 17 |
| Batch 9 sources / stages | 5 / 13 |
| Source recordings captured | 61 total |
| Library designs | 63 |
| Ready / review / blocked | 41 / 21 / 1 |
| Brands | 9 |
| Assets | 665 |
| Clips | 195 |
| Source recordings on disk | 419 MB |

The earlier batches are attached too, so every source-derived design has an
original recording and poster.

## Pipeline

```text
HTML source
  ↓
1. source inventory + known-gap audit
  ↓
2. Chrome measurement (fonts, boxes, start/end, 16 time samples)
  ↓
3. measured composition (layers, groups, menu entities, keyframes)
  ↓
4. library build (detail, original animation, assets, clips, index)
  ↓
5. source recording (stage isolated, animation from t=0)
  ↓
6. attach sourceVideo/sourcePoster to detail + index
  ↓
7. Agent First / Clean Canvas source playback
  ↓
8. source-vs-Studio QA + tests
```

## Batch 7 results

| Design | Source | Stage | Duration | Status | Layers |
|---|---|---|---:|---|---:|
| tartan-guys-immersive-01 | 03-immersive.html | 1 | 12.0 s | ready | 7 |
| deep-thinkers-cinematic-reels-01 | Deep Thinkers · cinematic reels.html | 1 | 15.0 s | review | 30 |
| deep-thinkers-cinematic-reels-02 | Deep Thinkers · cinematic reels.html | 2 | 15.0 s | review | 31 |
| deep-thinkers-cinematic-reels-03 | Deep Thinkers · cinematic reels.html | 3 | 18.0 s | ready | 33 |
| heritage-collection-places-reels-01 | Heritage Collection · places reels.html | 1 | 13.5 s | ready | 51 |
| heritage-collection-places-reels-02 | Heritage Collection · places reels.html | 2 | 11.0 s | review | 34 |
| heritage-collection-places-reels-03 | Heritage Collection · places reels.html | 3 | 14.2 s | ready | 83 |
| heritage-collection-video-posts-01 | Heritage Collection · video posts.html | 1 | 4.9 s | review | 33 |
| heritage-collection-video-posts-02 | Heritage Collection · video posts.html | 2 | 10.0 s | ready | 22 |
| heritage-collection-video-posts-03 | Heritage Collection · video posts.html | 3 | 4.9 s | ready | 28 |
| singl-end-italian-places-reels-01 | Singl-end · Italian places reels.html | 1 | 12.0 s | review | 84 |
| singl-end-italian-places-reels-02 | Singl-end · Italian places reels.html | 2 | 10.0 s | review | 48 |
| singl-end-le-regole-della-nonna-01 | Singl-end · Le Regole della Nonna (3-episode series).html | 1 | 10.0 s | review | 34 |
| singl-end-le-regole-della-nonna-02 | Singl-end · Le Regole della Nonna (3-episode series).html | 2 | 10.0 s | review | 34 |
| singl-end-le-regole-della-nonna-03 | Singl-end · Le Regole della Nonna (3-episode series).html | 3 | 10.0 s | review | 34 |
| singl-end-pinocchio-storytelling-reels-01 | Singl-end × Pinocchio · storytelling reels.html | 1 | 10.0 s | review | 20 |
| singl-end-pinocchio-storytelling-reels-02 | Singl-end × Pinocchio · storytelling reels.html | 2 | 10.0 s | ready | 10 |
| singl-end-pinocchio-storytelling-reels-03 | Singl-end × Pinocchio · storytelling reels.html | 3 | 10.0 s | review | 25 |

## Batch 8 results

`next-html-pages` contained seven files; one was byte-identical to the
Pinocchio storytelling source already processed in batch 7, so it was skipped.
The remaining six sources produced 17 stages, all ready.

| Design | Source | Stage | Duration | Status | Layers |
|---|---|---|---:|---|---:|
| melano-posts-stop-motion-01 | Melano · stop-motion style posts.html | 1 | 10.0 s | ready | 4 |
| melano-posts-stop-motion-02 | Melano · stop-motion style posts.html | 2 | 10.0 s | ready | 4 |
| melano-posts-stop-motion-03 | Melano · stop-motion style posts.html | 3 | 10.0 s | ready | 4 |
| singl-end-pinocchio-alt-storytelling-reels-01 | Singl-end Pinocchio · ALT reels.html | 1 | 10.0 s | ready | 18 |
| singl-end-pinocchio-alt-storytelling-reels-02 | Singl-end Pinocchio · ALT reels.html | 2 | 10.0 s | ready | 26 |
| singl-end-pinocchio-alt-storytelling-reels-03 | Singl-end Pinocchio · ALT reels.html | 3 | 10.0 s | ready | 25 |
| singl-end-3-minimalist-reels-01 | Singl-end · 3 minimalist reels.html | 1 | 10.0 s | ready | 6 |
| singl-end-3-minimalist-reels-02 | Singl-end · 3 minimalist reels.html | 2 | 10.0 s | ready | 6 |
| singl-end-3-minimalist-reels-03 | Singl-end · 3 minimalist reels.html | 3 | 10.0 s | ready | 5 |
| singl-end-3-more-reel-styles-01 | Singl-end · 3 more reel styles.html | 1 | 10.0 s | ready | 7 |
| singl-end-3-more-reel-styles-02 | Singl-end · 3 more reel styles.html | 2 | 10.0 s | ready | 9 |
| singl-end-3-more-reel-styles-03 | Singl-end · 3 more reel styles.html | 3 | 10.0 s | ready | 16 |
| singl-end-9-16-reel-concepts-01 | Singl-end · 9_16 reel concepts.html | 1 | 10.0 s | ready | 15 |
| singl-end-9-16-reel-concepts-02 | Singl-end · 9_16 reel concepts.html | 2 | 10.0 s | ready | 15 |
| singl-end-giovannin-senza-paura-01 | Singl-end × Giovannin Senza Paura · reels.html | 1 | 10.0 s | ready | 33 |
| singl-end-giovannin-senza-paura-02 | Singl-end × Giovannin Senza Paura · reels.html | 2 | 10.0 s | ready | 36 |
| singl-end-giovannin-senza-paura-03 | Singl-end × Giovannin Senza Paura · reels.html | 3 | 10.0 s | ready | 25 |

Batch-8 lessons:

- **Duplicate inputs happen.** Compare SHA-256 before extracting; the
  Pinocchio storytelling page was already in batch 7.
- **Not every page uses `.stage`.** Melano uses `.post`; the capture manifest
  now accepts a per-item `selector`.
- **`fonts: loading` can be acceptable only when text is baked.** Melano's
  lettering is flattened artwork, so the warning is expected; it must not be
  ignored for live text designs.
- **Playwright video capture is the most reliable size contract.** It produced
  exact 1080×1350 / 1080×1920, 25 fps, 10.0 s recordings for all 17 stages.
- **Attach after rebuild.** The library rebuild drops `sourceVideo`; running
  `attach-source-videos.js` restored it for all 48 source-derived designs.

## Batch 9 results

Five sources produced 13 stages. The auto-generated project id for
`03-immersive-2` collided with the earlier `03-immersive` design, so the new
project was installed as `tartan-guys-immersive-2-01` and its composition file
and URLs were rewritten before building.

| Design | Source | Stage | Duration | Status | Layers |
|---|---|---|---:|---|---:|
| tartan-guys-brutal-01 | 02-brutal.html | 1 | 9.0 s | ready | 11 |
| tartan-guys-brutal-02 | 02-brutal.html | 2 | 11.0 s | review | 18 |
| tartan-guys-brutal-03 | 02-brutal.html | 3 | 10.0 s | ready | 11 |
| tartan-guys-immersive-2-01 | 03-immersive-2.html | 1 | 11.0 s | review | 42 |
| tartan-guys-impact-01 | 02-impact.html | 1 | 10.0 s | review | 42 |
| tartan-guys-impact-02 | 02-impact.html | 2 | 10.0 s | ready | 62 |
| tartan-guys-impact-03 | 02-impact.html | 3 | 10.5 s | ready | 39 |
| tartan-guys-noir-01 | 01-noir.html | 1 | 11.0 s | ready | 11 |
| tartan-guys-noir-02 | 01-noir.html | 2 | 13.0 s | review | 18 |
| tartan-guys-noir-03 | 01-noir.html | 3 | 11.0 s | ready | 12 |
| tartan-guys-cinematic-01 | 01-cinematic.html | 1 | 12.0 s | review | 41 |
| tartan-guys-cinematic-02 | 01-cinematic.html | 2 | 12.0 s | ready | 62 |
| tartan-guys-cinematic-03 | 01-cinematic.html | 3 | 12.5 s | ready | 38 |

Batch-9 lessons:

- **Slug collisions are real.** `03-immersive-2` normalises to the same project
  slug as `03-immersive`; always compare against existing project ids before
  installing.
- **Renaming the project folder is not enough.** The composition filename,
  `id`, `project` and image URLs must be rewritten too, otherwise the builder
  creates `project--old-stem` ids.
- **No-`data-d` pages need a duration manifest.** Extraction estimated the
  stage lengths; the source recording manifest records the real values.
- **`02-brutal`, `02-impact`, `01-noir` and `01-cinematic` use stage containers
  without a direct `.stage` child in some cases.** The extractor's aspect-ratio
  fallback still measured them correctly; the source capture uses `.stage`
  because the rendered page does expose those elements.
- **25 fps Playwright recording is the reliable path** for these 1080×1920
  stages; all 13 came out at exact 1080×1920.

## What worked

### Measure at a fixed stage width

`measure-html-chrome.py` forces every stage to 1080 px. This makes `cqw`
values, text wrapping and border rounding match the library composition.
Without it, text boxes and `--p` animation endpoints drift between the page and
the extracted design.

### Wait for fonts before measuring

The extractor now waits up to 8 s for `document.fonts.ready` and uses a
12 s virtual-time budget. When Google Fonts still stall, a local `@font-face`
override is used for the measurement/capture page. Fonts are the difference
between correct line breaks and a plausible-looking but wrong typography.

### Sample every progress variable at the sampled time

The earlier sampler only moved `--p`; `--f`, `--k` and `--w` stayed at `1`.
That froze state-based reels at their ending frame. The sampler now sets every
detected progress variable to `t / duration`, then toggles `data-s`/`data-e`
and calls the page's own `f(t)` when present.

### Measure all three states

The extractor measures:

- `start` — all progress variables at 0
- `end` — all progress variables at 1
- `layout` — transforms disabled, for the static box
- `samples` — 16 timed snapshots for boxes, opacity, text variants, clip and
  filter changes

This is why the composition can distinguish intro/outro text and stack the
right state variants.

### Treat clip and filter as animation channels

Many reels use:

- `clip-path: inset(...)` for split/wipe reveals;
- `filter: grayscale() brightness()` for before/after transitions;
- `-webkit-text-stroke` for outline type.

These are not optional styling. The extractor now writes `clip` and `filter`
into keyframes; the library builder preserves them; Agent First and Clean
Canvas render them. Without this, split screens stay one-sided, before/after
reels stay colour, and FESTA-style outline text disappears.

### Record the source separately

The editable layer composition is a useful approximation, not a guaranteed
pixel-perfect render. The source recording is the ground truth for
**Original motion**. The current architecture keeps both:

- **Source poster / recording** → what the source actually looks like.
- **Editable layers** → what generated animations and edits use.

This is the only way to guarantee the original view while still allowing
layer-level work. A source recording is not a substitute for a good
composition; it is a reference and a safe original playback path.

## Failure modes and lessons

### 1. `fonts: loading` is not a harmless warning

If the extraction reports `fonts: loading`, stop and fix fonts before judging
the result. A fallback font changes text box widths, wrapping and vertical
centres. The later stages may still look “close”, but they are not 100%.

### 2. Progress variables can be separate from `--p`

`--f`, `--k`, `--w` and `--z` are common. A page can animate entirely from
those variables while `--p` remains 0. Query every custom property declared on
the stage rather than assuming `--p`.

### 3. `data-s` / `data-e` is only visibility

The window controls whether an element is in the DOM state; it does not carry
the element’s transforms, clip or filter. Those need to be sampled or read from
computed style.

### 4. Some effects cannot be expressed as 2D boxes

Known hard cases:

- `perspective()` + `rotateY()` + `backface-visibility`;
- `mix-blend-mode` glows;
- animated SVG drawings inside `<svg>`;
- pseudo-element decoration;
- background videos.

The source recording handles the original view. If the editable composition
must also be exact, these need rasterized flipbooks or a CSS-effects layer,
not another keyframe pass.

### 5. Source screenshots must isolate the stage

Taking a screenshot of a `.stage` inside the full grid can include overlapping
sibling stages when the stage is resized. Always move the stage into an empty
body, or use a dedicated page, before capturing the reference.

### 6. Capture dimensions need an explicit contract

CDP screencast dimensions can differ from the viewport because of scrollbars
and capture-surface limits. The reliable path is a Playwright `recordVideo`
context sized to the exact stage dimensions, then trim the load/isolate
prefix. That is what `scripts/capture-source-stages.js` does.

### 7. Do not use the first video frame as a poster

Many reels start with a flash / white overlay. A poster sampled at 20% can
still be mid-transition. Use the 50% frame, as the capture script does.

### 8. Video-post durations come from the video, not the page

`Heritage Collection · video posts` has 4.9 s and 10 s stages but no declared
`data-d`. The capture manifest must declare the real duration, otherwise the
video loops early or records pad time.

### 9. The builder must preserve every animation channel

`kfs_of()` originally stripped `clip` and `filter`, and
`normaliseAnimation()` stripped them on save. Both now preserve those fields.
Always check the emitted `original.animation.json`, not only the composition.

### 10. A library rebuild destroys source attachments unless you re-attach

`build-library.py` regenerates the index/detail from projects. Run:

```bash
node scripts/attach-source-videos.js
```

after every rebuild, or source playback disappears even though the recordings
are still on disk.

## Rebuild runbook

### Extract the HTML sources

```bash
cd /Users/leandrodisconzi/repos/image-to-layers
python3 tools/html-to-projects.py \
  --html "/path/to/source.html" \
  --out /tmp/batch \
  --layout measure \
  --max-stages 20
```

### Install projects

Copy each emitted project to `data/projects/<stable-id>/`. Keep the project id
and composition filename aligned; the library design id is derived from that
pair.

### Build the library

```bash
cd /Users/leandrodisconzi/repos/studio
python3 _dev/agent-first-canvas-library-expansion/claude-interaction-downloads/02-files/build-library.py build \
  --projects data/projects --library data/library
```

### Record source originals

```bash
node scripts/capture-source-stages.js scripts/source-manifests/batch9.json
```

The manifest declares source file, stage index, id, width, height and real
duration. The script writes `.webm` and `.jpg` into `data/library/sources/`.

### Attach and verify

```bash
node scripts/attach-source-videos.js
node --test tests/library-source-videos.test.js
npm test
```

## Quality gates

A batch is done when:

- all source HTML files are inventoried with stage count and duration;
- font status is `loaded` for every stage;
- every stage has a project and a library design;
- every design has a source recording and poster;
- Agent First lists all 63 designs; Clean Canvas exposes the full set in admin mode;
- Original Motion plays the source recording in both Agent First and Clean
  Canvas;
- generated animation switches back to the editable canvas;
- source export downloads the recording;
- `npm test` passes.

The source-exact original gate is what protects against unacceptable visual
drift while the editable layer extraction continues to improve.

## Remaining editable-composition gaps

These are recorded per source in `image-to-layers/docs/examples/`:

- **03-immersive**: chapter DOM is rebuilt by JS; decorative pseudo-elements.
- **Deep Thinkers**: mirrored quote flip, `mix-blend-mode` glows, floating dust,
  masked portraits.
- **Heritage places**: sampled SVG map/quiz flipbooks step rather than tween.
- **Heritage video posts**: videos are posters, not live video layers.
- **Italian places**: sampled route/spotlight flipbooks and missing row
  highlight.
- **Le Regole della Nonna**: badge stacking order.
- **Pinocchio**: curtain timing and window clipping.

Those are composition-editing limitations. The original-motion recordings are
the source of truth for the visual comparison.
