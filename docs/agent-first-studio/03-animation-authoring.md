# Animation authoring

The client plays an animation by interpolating per-layer frames. Motion is
expressed as offsets and scale around each layer’s own box. You do not send
absolute layer positions here; composition geometry belongs in
`composition_fixes`.

---

## 1. Schema

```json
{
  "name": "Slow headline reveal",
  "duration": 6000,
  "keepOthers": true,
  "tracks": [
    {
      "layerId": "m04-text-hungry",
      "segments": [
        {
          "preset": "keyframes",
          "start": 0,
          "duration": 1800,
          "loop": false,
          "frames": [
            { "t": 0,    "dx": 0, "dy": 0.06, "sx": 1, "sy": 1, "a": 0, "e": "out" },
            { "t": 1800, "dx": 0, "dy": 0,    "sx": 1, "sy": 1, "a": 1, "e": "out" }
          ]
        }
      ]
    }
  ]
}
```

### Frame fields

| Field | Meaning | Range / default |
|---|---|---|
| `t` | milliseconds from segment start | `0 … segment.duration` |
| `dx`, `dy` | offset as a fraction of artboard | e.g. `0.05` = 5% |
| `sx`, `sy` | scale multipliers | default `1`; keep ~`0.8–1.2` |
| `a` | opacity | `0 … 1` |
| `e` | easing to reach this frame | `linear`, `in`, `out`, `inOut` |

### Segment fields

| Field | Meaning |
|---|---|
| `preset` | always `"keyframes"` for generated tracks |
| `start` | absolute start in the animation timeline (ms) |
| `duration` | segment length (ms) |
| `loop` | repeat the segment while the animation runs |
| `frames` | ordered keyframes |

### HARD TRAP — `sx/sy` is top-left scaling, not centred

`dx/dy` shift the layer; `sx/sy` scale **from the layer's left/top box**, not
from its centre. A scale-in grows right/down. CSS intuition is wrong here.

To pop around the centre, compensate explicitly:

```json
[
  { "t": 0,   "dx": 0.01, "dy": 0.02, "sx": 0.98, "sy": 0.98, "a": 0.8 },
  { "t": 300, "dx": 0,    "dy": 0,    "sx": 1,    "sy": 1,    "a": 1 }
]
```

If you cannot compute the compensation, prefer a fade or slide. Never claim a
centred scale when only `sx/sy` was supplied.

### Fields that are NOT part of generated animation

The current `saveAnimation()` mapper sends only:

```
t dx dy sx sy a e
```

Do **not** put `r`, `clip` or `filter` in generated frames. They may exist in
renderer internals but will be dropped on save. Use composition `rotation` for a
static rotation, and do not promise animated clip/filter effects.

---

## 2. `keepOthers`

- `true` — unlisted layers keep the current animation’s tracks. Use for
  “make this slower”, “change only the headline”, “add a beat”. Preserve the
  current animation duration unless the user explicitly asks to change the
  total length.
- `false` or omitted — unlisted layers are static in the new animation. Use for
  a complete new motion concept.

If the current animation is the source-exact Original motion, there are no
editable tracks to keep; propose a generated animation instead.

---

## 3. Timing language

| Intent | Suggested timing |
|---|---|
| Micro state / hover-like emphasis | 120–220 ms |
| UI-like enter | 180–320 ms |
| Editorial fade/slide | 300–600 ms |
| Headline reveal | 500–900 ms |
| Slow cinematic reveal | 1.2–2.5 s |
| Ambient loop | 3–8 s cycle |
| Full reel | 3–15 s |

Use staggered starts of **60–120 ms** for grouped elements. Use exits shorter
than entrances (about 60–75% of the enter duration) and subtler travel. Avoid
overshoot/bounce unless the user asks for playful motion.

Easing:

- `out` for enters, settles, reveals;
- `in` for exits;
- `inOut` for loops/ambient drift;
- `linear` for constant pans or mechanical movement.

---

## 4. Motion laws

Apply these before returning a proposal:

1. **Continuity** — no element teleports between adjacent frames. Every change
   is a continuous interpolation from the previous value.
2. **One idea per beat** — do not animate every layer. Choose 3–8 meaningful
   layers.
3. **Hierarchy** — the main subject/headline moves first or most deliberately;
   supporting elements follow, slightly later and smaller.
4. **Loop closure** — if the user asks for a loop, the last frame must match the
   first for position/scale/opacity.
5. **Physics** — anticipation, settle, follow-through; avoid simultaneous
   identical motion on unrelated layers.
6. **Readability** — text should not move during the moment it must be read.
7. **No accidental hiding** — do not fade the only product name to 0 or move it
   off-canvas.
8. **Stacked text is a swap slot** — if multiple text layers share a box/z, keep
   only one visible at a time with a full fade-out before the next fade-in.
9. **No strobe** — no rapid full-canvas opacity flashing.

Adapted from `game-animation-frames`: loop closure, continuity, the “flip test”
(view frames in order and narrate the motion), and energy matching the ask.

---

## 5. Common recipes

### Fade and rise

```json
{
  "name": "Headline fade rise",
  "duration": 5000,
  "keepOthers": true,
  "tracks": [
    {
      "layerId": "m04-headline",
      "segments": [{
        "preset": "keyframes",
        "start": 0,
        "duration": 700,
        "loop": false,
        "frames": [
          { "t": 0,   "dx": 0, "dy": 0.035, "sx": 1, "sy": 1, "a": 0, "e": "out" },
          { "t": 700, "dx": 0, "dy": 0,     "sx": 1, "sy": 1, "a": 1, "e": "out" }
        ]
      }]
    }
  ]
}
```

### Slide in from left

```json
{
  "name": "Headline slide left",
  "duration": 5000,
  "keepOthers": true,
  "tracks": [
    {
      "layerId": "m04-headline",
      "segments": [{
        "preset": "keyframes",
        "start": 0,
        "duration": 500,
        "loop": false,
        "frames": [
          { "t": 0,   "dx": -0.08, "dy": 0, "sx": 1, "sy": 1, "a": 0, "e": "out" },
          { "t": 500, "dx": 0,     "dy": 0, "sx": 1, "sy": 1, "a": 1, "e": "out" }
        ]
      }]
    }
  ]
}
```

### Staggered group (raw tracks)

```json
{
  "name": "Staggered cards",
  "duration": 6000,
  "keepOthers": false,
  "tracks": [
    {
      "layerId": "card-1",
      "segments": [{
        "start": 0, "duration": 450, "loop": false,
        "frames": [
          { "t": 0, "dx": 0, "dy": 0.04, "sx": 1, "sy": 1, "a": 0, "e": "out" },
          { "t": 450, "dx": 0, "dy": 0, "sx": 1, "sy": 1, "a": 1, "e": "out" }
        ]
      }]
    },
    {
      "layerId": "card-2",
      "segments": [{
        "start": 100, "duration": 450, "loop": false,
        "frames": [
          { "t": 0, "dx": 0, "dy": 0.04, "sx": 1, "sy": 1, "a": 0, "e": "out" },
          { "t": 450, "dx": 0, "dy": 0, "sx": 1, "sy": 1, "a": 1, "e": "out" }
        ]
      }]
    }
  ]
}
```

### Ambient drift loop

```json
{
  "name": "Gentle drift",
  "duration": 8000,
  "keepOthers": true,
  "tracks": [
    {
      "layerId": "m01-photo",
      "segments": [{
        "start": 0, "duration": 8000, "loop": true,
        "frames": [
          { "t": 0,    "dx": 0,     "dy": 0,      "sx": 1,    "sy": 1,    "a": 1, "e": "inOut" },
          { "t": 4000, "dx": 0.006, "dy": -0.004, "sx": 1.02, "sy": 1.02, "a": 1, "e": "inOut" },
          { "t": 8000, "dx": 0,     "dy": 0,      "sx": 1,    "sy": 1,    "a": 1, "e": "inOut" }
        ]
      }]
    }
  ]
}
```

---

## 6. Clips and `steps`

When `library` is present, the client sends reusable clips:

```json
[
  { "id": "clip-fade-in-400", "effect": "fade-in", "direction": "", "duration": 400, "mode": "in" },
  { "id": "clip-slide-in-from-left-500", "effect": "slide-in", "direction": "from-left", "duration": 500, "mode": "in" }
]
```

Prefer `steps` for assembling known motion:

```json
{
  "name": "Assemble the card",
  "steps": [
    { "target": "headline", "clip": "clip-fade-in-400", "start": 0 },
    { "target": "description", "clip": "clip-fade-in-400", "start": 80 },
    { "target": "price", "clip": "clip-pop-in-300", "start": 160 }
  ]
}
```

`target` may be a group id (animates all layers in the group with stagger) or a
single layer id. `start` is ms. `stagger` overrides the group delay. `duration`
rescales the clip. Do not combine with `animation` in the same response.

`steps` requires a library design; it is not available for published templates
without the library compose route.

---

## 7. Validation and failure

The server rejects broken animations (400); the client filters unknown layer
ids before saving. A response with no usable tracks produces “no usable layers”.

Common failures:

| Failure | Fix |
|---|---|
| Unknown layer id | Use the exact id from the current context |
| Frame beyond segment duration | Set `t ≤ duration` |
| One-frame segment | Add a second frame or a hold endpoint |
| `r`, `clip`, `filter` in frame | Remove; unsupported in the save path |
| Duration < 3 s or > 15 s | Use 3000–15000 (policy is stricter than the client clamp) |
| `keepOthers` missing on an edit | Add `true` |
| Text layer moved off-canvas | Use `composition_fixes`, not animation |

---

## 8. Animation quality gate

Before returning:

- 3–8 meaningful moving layers;
- no more than ~25 tracks;
- sorted frames;
- no duplicate tracks for a layer;
- no accidental opacity 0 or off-canvas position;
- loop closes if requested;
- text readable during the hold;
- design colours/fonts unchanged;
- duration 3–15 s;
- `keepOthers` matches the intent.
