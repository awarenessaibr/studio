# Animating layered projects

Use this guide when animating a composition in `data/projects/<project>/`.
The Scotland View project is the worked example: its motion plan lives beside
the project metadata and its active composition is
`compositions/0---Scotland-View.composition.json`.

## Files and ownership

- `scene.json` describes semantic objects; `layers.json` records exported
  image bounds. Treat both as source metadata.
- A `.composition.json` file is the studio document. It owns layer geometry,
  visibility, duration, and keyframes.
- `images/` contains transparent cut-outs. Recovered layers fill holes created
  when the source image was segmented.
- `images/reference.jpg` is the original image, normally represented by the
  locked `referenceLayerId` layer.
- Keep project-specific motion rules in `motion.plan.json`. Apply them with
  `scripts/apply-motion.py`.

## Studio keyframes

Persisted composition keyframes use the studio's legacy layer format, with all
six animated properties on every frame:

```json
{
  "time": 0,
  "x": 10,
  "y": 20,
  "w": 30,
  "h": 40,
  "rotation": 0,
  "opacity": 1
}
```

Coordinates and dimensions are percentages of the canvas; `time` is
milliseconds. Do not copy the other agent API formats (`{t, values}`) or the
unrecognized `{t, x, ...}` format into a composition. The studio interpolates
these persisted frames linearly. The generator samples sinusoidal motion,
includes a frame at both ends of the duration, and keeps those endpoint poses
equal so playback can wrap without a position jump.

The Studio timeline also supports multiple animation events on a layer. Existing
compositions with a single `animation` or `keyframes` field remain supported;
new compositions store additional timeline events in an `animations` array.
Timeline events can be copied, pasted, duplicated, and dragged to another
layer's track.

Use **Save animation** in the timeline to save all current animation tracks to
the shared Studio library at `data/settings/studio-animation-library.json`.
Saved entries are independent of brands and templates. Select one from
**Saved animations** and choose **Apply** to add its tracks to the current
composition. Tracks match layers by ID first, then by layer name; unmatched
tracks are skipped and reported. The **Delete** button removes the selected
entry from the shared library.

The studio accepts at most 30 seconds and 400 keyframes per layer. The motion
script enforces those limits, keeps translation at or below 1% of the canvas,
rotation at or below 1 degree, and scale amplitude at or below 10%.

## Protecting segmented artwork

Segmentation layers are cut-outs, not a fully overlapping stack. Moving one
can reveal transparent holes. Keep the original-image reference visible,
locked, and at the bottom of the layer order so it acts as a static plate.
Move recovered patches with the same rule as their parent; never animate just
one fragment of a cut-out. Use small motion and leave cliffs, shore, and other
rigid anchors static unless the artwork has been prepared for larger movement.

The plan uses first-match, case-sensitive filename globs. Put specific rules
before broad rules and a `{"match": "*", "static": true}` fallback last.
`static` deliberately clears keyframes for that matched layer. Layers not
matched by any rule are left unchanged.

## Applying a motion plan

From the studio directory:

```sh
python3 scripts/apply-motion.py \
  data/projects/0---Scotland-View/compositions/0---Scotland-View.composition.json \
  data/projects/0---Scotland-View/motion.plan.json
```

By default, the script writes an `.animated.json` sidecar and does not replace
the input. Review it in the studio before promoting it. Use `--in-place` only
when intentionally updating the active composition; `-o PATH` selects another
output path. Options include `--duration MS`, `--fps N` (default 12), and
`--no-plate` for cases where a reference plate is not wanted.

After applying a plan, preview the start, middle, and loop boundary in the
studio. Reduce amplitudes or keep a layer static if motion exposes seams.
`motion.plan.json` applies only to its matching layer names; inspect new
projects' layers and recovered patches before reusing a plan.

## Scotland View notes

The active plan gives the sky a slow drift, moves water and offshore rocks
together, staggers the foam pulse, and gives the foreground grass bank a tiny
drift. The lighthouse and wildflowers mentioned in `scene.json` are not
exported as separate layers, so they cannot receive independent motion yet.
The large lower-left foam swirl is part of the water layer.
