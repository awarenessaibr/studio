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

The same animation can also be exported as a file and replayed in the Asset
Studio Agent timeline (**Export → Animation JSON** in Studio, then **Import** in
the Agent timeline).

The export bakes the motion instead of copying preset names, because the two
pages run different animation engines: `parallax`, `pulse`, and the whole
`clip*` family exist only in Studio, and a name like `pulse` means a scale bump
in the Agent engine but an opacity dip in Studio. Reusing the name would change
the animation. So the exporter evaluates the same `@keyframes` and timing
functions the stage runs, samples them at 25 fps (plus a sample on every event
boundary), and the Agent replays those frames with linear interpolation.

```jsonc
{
  "schema": "agent-studio/animation/2",
  "duration": 10000,                  // the Studio timeline length
  "fps": 25,
  "tracks": [{
    "layerId": "headline",            // used for matching, not applied blindly
    "layerName": "Headline",
    "role": "headline",               // background|image|logo|headline|subhead|body|cta|footer
    "text": "Garnethill after dark.", // helps match a design whose copy matches
    "box": { "x": 0.08, "y": 0.34, "w": 0.84, "h": 0.12 },
    "segments": [{                    // one per timeline event
      "preset": "fadeIn",
      "label": "Fade In",
      "start": 300,
      "duration": 900,
      "loop": false,
      "frames": [                     // t is relative to the segment start
        { "t": 0, "a": 0, "dy": 0.02 },
        { "t": 160, "a": 0.42, "dy": 0.0116 },
        { "t": 900, "a": 1 }
      ]
    }]
  }]
}
```

Frame keys are `a` (opacity), `dx`/`dy` (fraction of canvas width/height),
`s`/`sx`/`sy` (scale multipliers), and `clip` (a `{shape:"poly",points}` or
`{shape:"circle",cx,cy,r}` reveal in box-normalised units). Missing keys default
to the neutral value, and constant runs are collapsed to their first and last
sample so a long hold costs two frames.

On import the Agent matches tracks to elements by layer id, then copy, then
role and reading order. It replaces the timeline it had, fits the timeline
length to the file, and names each bar after the original event. A track with no
plausible element is reported by name instead of being dropped on an arbitrary
layer — cross-app designs do not always have the same layers, and a silent
mismatch is worse than a visible one.

Files in the old `agent-studio/animation/1` shape (preset names only) are
refused with an explanation rather than remapped, because that mapping cannot
reproduce the source motion. Re-export them from Studio.

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
