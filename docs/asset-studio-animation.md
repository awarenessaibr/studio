# Asset Studio Agent animation

This guide covers the short preset timeline on `/studio-agent.html` (the
**Timeline** button in Asset Studio Agent). It does not describe the
keyframe-based animation system in [Layer Studio](layer-studio.md#6-animation)
or the project motion-plan workflow in [animation.md](animation.md).

## Where animation is defined

The timeline UI lives in `pages/studio-agent.html`; preset definitions and
motion calculations live in `src/client/asset-studio/animation.js`:

| Concern | Implementation |
|---|---|
| Timeline markup and controls | `#timeline`, `#tlPreset`, `#tlAdd`, `#tlClear`, and `#tlRec` |
| Timeline state and preset wiring | `DUR`, `TL`, `ART`, `PRESETS`, and `presetDur` |
| Selecting animatable elements | `hookBoxes`, `extractEls`, and `hit` |
| Preset IDs, labels, durations, and motion calculations | `PRESETS`, `durationFor`, and `at` in `animation.js` |
| Drawing animated frames | `buildArt`, `drawFrame`, `drawText`, and `drawLogo` |
| Timeline tracks, timing, playback, and recording | `tlBuild`, `barDown`, `play`, `seek`, and `record` |
| Applying and clearing animations | `run` handles `anim` and `clearAnim` commands; the timeline buttons call `commit` |
| UI wiring | The final `wiring` section fills the preset selector and connects the controls |

The page loads `src/client/asset-studio/engine.js` and
`src/client/asset-studio/categories.js` to render the underlying static design.
The timeline captures text and logo bounds from that render, then draws those
elements separately over the rendered artwork. `art` is a single target for
the background and motif. The preset math and timeline state are not currently
in those shared engine modules. The preset module is also imported directly by
Node tests at `tests/asset-studio-animation.test.js`.

The preset registry is grouped; the timeline dropdown shows the same groups
and bars are coloured by group (entrance orange, exit purple, emphasis teal,
ambient blue). Each entry is `[id, label, default duration, group]`.

| Group | Presets (default duration) |
|---|---|
| Entrance (`in`) | `fadeIn`, `slideUp`, `slideDown`, `slideLeft`, `slideRight`, `zoomIn`, `zoomOut`, `popIn` (700), `elasticIn` (1300), `dropIn` (1100), `riseSettle` (1000), `spinIn` (1000), `tiltIn`, `flipIn` (800), `stretchIn` (800), `swingIn` (1300), `slam` (500), `wipeRight`, `wipeLeft`, `wipeDown`, `wipeUp` (800); `bounce` is 1200, the rest 900 |
| Exit (`out`) | `fadeOut` (900), `exitUp`, `exitDown`, `exitLeft`, `exitRight`, `shrinkOut`, `growOut`, `wipeOut` (800), `popOut` (600), `spinOut` (900) |
| Emphasis (`emph`) | `pulse` (2400, loops), `heartbeat` (1400, loops), `shake` (600), `wobble` (900), `tada` (1000), `flash` (800), `rubber` (900), `hop` (900), `spin` (1000), `pop` (500) |
| Ambient (`loop`) | `float` (2400), `breathe` (3600), `sway` (3200), `orbit` (4000), `zoom`, `drift`, `panLeft`, `panRight`, `pullBack` (8000) |

`window.AssetStudioAnimation` exposes `DURATION`, `GROUPS`, `PRESETS`,
`durationFor(id)`, `groupOf(id)`, `events(track)`, `canPlace(track, event)`,
`findSlot(track, start, duration, total, direction)`, `at(animation, time)`
and `atTrack(track, time)`.

The timeline is 8 seconds long. A track can contain multiple animation events
in `S.anim[elementId]`, ordered by start time. Events on the same target cannot
overlap; events on different targets may run simultaneously. The **Animate
selected** button finds the next available slot for entrances and effects, and
places exits as late as possible. Double-clicking a track requests the clicked
time and moves the new event to the next free slot if necessary. If no space is
available, Studio reports that instead of silently replacing an event.

Each event has a stable `id`, `preset`, `start`, and `duration`. Older saved
designs with a single event object are still read as a one-event track and are
converted to an event array when another animation is added. Bars can be moved
only within the free interval between their neighbors; resizing is limited by
the next event. Focus a bar and press **Delete** to remove just that event;
**Clear** removes the selected target's whole track. Events are saved with the
design state in browser `localStorage`, under an
`assetStudioAgent.v1` key scoped to brand, category, and template. Changing
category or template clears the animation map.

Timeline and layout controls on `/studio-agent.html`:

- **Replay** (top-left of the timeline, shortcut `R`) restarts playback from 0;
  **Play/Pause** is `Space`; **Loop** repeats the preview.
- The timeline height is resizable: drag the grip above the header (or focus it
  and use the arrow keys; double-click resets). The height is remembered in
  `localStorage` (`assetStudioAgent.timelineH.v1`).
- Both side panels can be hidden from the buttons in the preview header, or with
  `[` (designs and controls) and `]` (agent). The choice is remembered
  (`assetStudioAgent.view.v1`). `fitCanvas` scales the canvas to the room left
  in the stage, so hiding a panel or growing the timeline resizes the preview.

The animatable targets are the whole artwork/motif (`art`), captured text
groups, and captured logos. Individual motif parts and arbitrary template
shapes are not separate targets. Exporting PNG/JPG renders the static design;
**Record WebM** records the 8-second animated preview.

## Guidelines for adding a preset

1. Add an entry to `PRESETS` in `src/client/asset-studio/animation.js` with a
   stable ID, display label, sensible default duration in milliseconds, and a
   group (`in`, `out`, `emph` or `loop`).
   `PRESETS` populates the dropdown, and `durationFor` supplies the duration
   when the preset is added.
2. Implement the ID in `at` in the same module with the `frame({...})` helper,
   which fills in neutral values. The core fields are `a` (opacity, 0–1), `dx`
   and `dy` (translation as fractions of canvas width and height, positive `dy`
   moves down) and `s` (scale, 1 is neutral). Optional fields are `r` (rotation
   in radians, clockwise), `sx` / `sy` (extra horizontal / vertical scale, used
   for flips and squash-and-stretch) and `wipe` (`{ d, p }`: reveal amount `p`
   travelling right (`'r'`), left (`'l'`), down (`'d'`) or up (`'u'`), clipped to
   the element's box). Easing helpers (`ease`, `inOut`, `back`, `elastic`,
   `bounceOut`, ...) are local to the module.
3. Keep the preset ID consistent between the registry and `at`; an
   unrecognized ID falls back to an unchanged frame. Before their start,
   entrance (`in`) presets hold their starting pose (so staggered elements stay
   hidden until their turn); every other group returns the unchanged pose. Account for the 8-second
   timeline and clamping in `run` when choosing the default duration. Use
   `findSlot` when adding events and `canPlace` when moving or resizing them;
   never replace existing events on the same target.
4. Decide how the preset should behave after its duration. `atTrack` holds the
   previous event's final pose through gaps and evaluates the next event when
   it starts. One-shot presets
   clamp progress and hold their final pose; a fade-out therefore stays hidden.
   Looping presets (`pulse`, `heartbeat`, `float`, `breathe`, `sway`, `orbit`)
   use the bar duration as their cycle period and repeat until the end of their
   event; one-shot emphasis presets (`shake`, `tada`, ...) return to the neutral
   pose when they finish. `panLeft` / `panRight` / `pullBack` start
   zoomed in, so add them to the background at 0 s.
5. Add the new preset to `elCards` or the contextual quick prompts only if it
   should be suggested for those element types. The timeline dropdown itself
   makes every registered preset available for any supported target.
6. Add or update coverage in `tests/asset-studio-animation.test.js`. Preserve
   the separation between the static `AssetEngine` render and the
   animated overlay. Any change to element capture or overlay drawing should
   be checked for text wrapping, logo bounds, and the `art` target.

Run `node --test tests/asset-studio-animation.test.js`. In the browser, select
each relevant target type, add the preset, and scrub before its start, during
the motion, at its end, and at the 8-second boundary. Also check that
moving/resizing the timeline bar still behaves sensibly and that WebM recording
captures the same motion. Keep translation, scale, and opacity restrained so
elements remain legible and do not leave the canvas unexpectedly.