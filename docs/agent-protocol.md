# Agent protocol

A JSON contract that lets a language model (or any script) direct a
composition without touching the internals: the studio exports what exists,
the model returns commands, the studio validates and applies them.

Two schema ids, both served by the studio:

| Schema id | Scope | Entry point |
|---|---|---|
| `layer-studio/agent/v1` | Preset/keyframe commands for animating an existing scene (§1–6) | **Export → Agent spec** → `exportAgentSpec()`, `applyAgentCommands()` |
| `layer-studio/agent-commands/v2` | Batches that also restyle, re-layout and re-format a scene, with guardrails, sandboxing and snapshots (§8) | `src/shared/agent-commands.js` |

System prompt: [agent-prompt.md](briefs/agent-prompt.md)

---

## 1. Round trip

### In the UI
1. Open a composition.
2. **Export → Agent spec** downloads `<name>-agent.json`.

### In a script
```js
const spec = window.layerStudio.exportAgentSpec(); // downloads and returns the document
```

Send `spec` to the model together with the task and `agent-prompt.md` as the
system prompt. Paste the reply back:

```js
window.layerStudio.applyAgentCommands({
  commands: [
    { layerId: 'layer-abc-hair', preset: 'sway', params: { amplitude: 1.5 } },
    { characterId: 'character-1', preset: 'happy' },
  ],
});
```

The status bar reports `Applied N agent command(s); M skipped.` and the
composition autosaves.

---

## 2. What the spec contains

| Field | Meaning |
|---|---|
| `schema` | `layer-studio/agent/v1` |
| `scene` | `{ id, name, width, height, duration }` — duration in ms |
| `reference` | The final-image layer id (or `null`) |
| `layers` | Every animatable layer: `id, name, type, role, z, box{x,y,w,h}, rotation, opacity, sprite, keyframes`, plus `text` (text layers) and `bindings` |
| `rigLayers` | Layer ids owned by a character rig — never animate directly |
| `characters` | Rigs: `id, name, rigVersion, parts{}, hidden[], coverLayerId, settings, applied` |
| `formats` | `{ id, isMaster, channel, label, width, height, pinnedLayerIds, pinnedOverrides }` |
| `variables` | `{ id, name, kind, defaultValue, locked }` |
| `brandKit` | `{ id, name, shared, palette, fonts, logoCount }` or `null` |
| `guardrails` | `{ enabled, block }` |
| `safeZones` | Per-format zone and rect |
| `presetVocabulary` | 19 layer presets + `none` |
| `characterPresetVocabulary` | `neutral, happy, sad, surprised, angry, blink, talk, speak, gaze, pulse, idle, none` |
| `characterPartVocabulary` | The 18 rig parts |
| `visemeVocabulary` | 13 visemes |
| `browPoseVocabulary` | `neutral, raised, furrowed, sad` |
| `expressionVocabulary` | `neutral, happy, sad, surprised, angry` |
| `variableCommandVocabulary` | The `set-variable` command template |

`layers` **excludes** the final-image reference, rig-internal layers
(`rig: true`) and character part layers; they appear under `rigLayers` or
inside `characters.parts`. This is deliberate: it prevents an agent from
animating both a character and its parts.

Coordinates are percentages of the canvas. `box` is rounded to 2 decimals.

---

## 3. Commands

`applyAgentCommands()` accepts either an array or `{ commands: [...] }`.

### Layer preset

```json
{ "layerId": "layer-abc", "preset": "sway", "params": { "amplitude": 1.5, "tilt": 2 } }
```

The preset vocabulary and parameter names are the same as the Inspector;
see [capabilities.md](capabilities.md#19-animation-presets) and
[layer-studio.md](layer-studio.md#presets). `preset: "none"` clears the
layer's keyframes.

### Raw keyframes

```json
{ "layerId": "layer-abc", "keyframes": [
  { "time": 0,    "x": 10, "y": 40, "w": 20, "h": 30, "rotation": 0, "opacity": 1 },
  { "time": 3000, "x": 70, "y": 40, "w": 20, "h": 30, "rotation": 0, "opacity": 1 }
] }
```

Accepted, but the prompt discourages it: presets are easier to validate and
produce consistent timing. Keyframes in a command **replace** the layer's
existing keyframes.

### Template variable

```json
{ "type": "set-variable", "variableId": "headline", "value": "Fire up the grill" }
```

Also accepted without `type` when `variableId` is present and there is no
`layerId`/`characterId`. Validation follows the variable's `kind`: `text`
≤ 4000 chars, `color` as `#rrggbb`, `url`/`image` as https, relative or data
image URLs. An unknown id or an invalid value is reported and **not**
applied.

### Character preset

```json
{ "characterId": "character-1", "preset": "happy" }
{ "characterId": "character-1", "preset": "speak", "params": { "text": "Well met.", "rate": 1 } }
```

Presets: `neutral, happy, sad, surprised, angry, blink, talk, speak, gaze,
pulse, idle, none`. Parameters per preset:

| Preset | Params |
|---|---|
| `blink` | `rate` (blinks/min) |
| `talk` | `text` (lip-sync line), `rate`, `intensity`, `speed`; without `text`, continuous idle chatter |
| `speak` | `text`, `rate`, `start` (ms offset) |
| `gaze` | `x`, `y` in −1…1 |
| `pulse` | `amount` 0…1 |
| `neutral` | resets expression, talk off, gaze centred |

### Character settings patch

```json
{ "characterId": "character-1", "settings": {
  "expression": "sad", "blink": true, "blinkRate": 10,
  "speechText": "I remember the old road.", "gazeX": -0.4, "gazeY": 0.2,
  "headSway": 0.8, "mouthOpen": 1.2
} }
```

Settable settings include `expression, blink, blinkRate, blinkAmount, talk,
talkIntensity, talkSpeed, speechText, speechRate, speechStart, gazeX, gazeY,
eyeWander, saccade, breathe, breatheAmount, headSway, pulseAmount, mouthOpen,
mouthPose`. Settings are clamped to their ranges and persisted on the
composition; they regenerate the rig keyframes.

### Shorthands

```json
{ "characterId": "character-1", "speak": { "text": "Well met, traveler.", "rate": 1 } }
{ "characterId": "character-1", "expression": "sad" }
{ "characterId": "character-1", "gaze": { "x": -0.4, "y": 0.2 } }
{ "characterId": "character-1", "blink": true, "headSway": 0.4 }
```

---

## 4. Validation and skip rules

Every command is checked before it mutates anything:

| Situation | Result |
|---|---|
| Unknown `layerId` | Skipped, counted |
| `layerId` that belongs to a character rig | Skipped (the rig owns it) |
| Unknown `characterId` | Skipped |
| Unknown `preset` | Reported as `Unknown preset: …` and skipped |
| Unknown/invalid `variableId` | Reported with the reason, not applied |
| Command that is not an object | Skipped |
| No `layerId`, `characterId` or `variableId` | Skipped |

The status bar always reports applied vs skipped. Nothing throws on a bad
command; a bad batch still applies the valid entries.

Layer presets write **base** keyframes, so a proposal applies to every
format. Per-format animation is not part of the protocol.

---

## 5. Relationship to the server-side director

The **Animation ideas** feature uses the same vocabulary, but the validation
lives on the server: it maps short aliases (`L01`…), filters to real project
layer ids, restricts to the preset vocabulary, deduplicates per layer,
normalises parameters per preset, validates character settings, retries once
on invalid output, and stores the result in `proposals.json`. The browser
then applies ideas through the same `applyAgentCommands()` path.

That means a command set generated by an external model and one generated
by the local director are interchangeable.

---

## 6. Writing a good prompt

- Give the model the **whole spec**, not a hand-written layer list — ids must
  match exactly.
- State the duration and the mood; the spec already carries the canvas size.
- Ask for **3–8 moving layers**, not all of them.
- Ask for JSON only. `agent-prompt.md` already enforces that contract.
- Cap the list (the prompt says ~25 entries); big lists are slow to render
  and rarely better.
- For characters, prefer a preset or a small settings patch over animating
  individual parts.

Example task that works well:

> 10-second dreamy shot. The woman walks slowly left to right, the leaves and
> hair sway, the lantern pulses, and the title fades in. Keep the background
> quiet.

Expected shape: `walk` on the character, `sway` on foliage/hair,
`pulse` on the lantern, `fadeIn` on the title, `parallax` or `none` on the
background.

---

## 7. Versioning

The schema string is the contract. Adding presets or vocabulary is additive
and keeps `v1`; changing command shapes or removing fields would require
`layer-studio/agent/v2` and an update to `exportAgentSpec()`,
`applyAgentCommands()`, `agent-prompt.md` and this document.

`layer-studio/agent/v2` **has not been created**. The broader batch protocol in
§8 uses its own id (`layer-studio/agent-commands/v2`) and its own module, so
`v1` keeps its exact shape and both can be served at the same time.

---

## 8. Batch protocol v2 — `layer-studio/agent-commands/v2`

`v1` animates a scene whose layout is already settled. v2 is the *scene* edit
protocol: it can restyle, re-layout, add and remove layers, swap assets, set
formats and retime, and it decides whether the result is allowed to land.

Implementation: [src/shared/agent-commands.js](../src/shared/agent-commands.js)
(UMD — `window.AgentCommands` in the browser, `require()` in Node). It depends
on `studio-core.js` only, so it is testable without a DOM
(`tests/agent-commands.test.js`).

### 8.1 A batch

```json
{
  "schema": "layer-studio/agent-commands/v2",
  "sceneId": "the-physician-flyer",
  "baseRevision": 4,
  "formatId": "master",
  "label": "E · Motion",
  "rationale": "Full-bleed photo with a slow drift.",
  "atomic": true,
  "commands": [ … ]
}
```

`baseRevision` is the revision the plan was made against. If the scene has
moved on, the batch is rejected with `STALE_REVISION` and a
`suggestion: "baseRevision=<now>"`. `atomic: false` applies the valid commands
and reports the rest; the default (`true`) is all-or-nothing.

### 8.2 The twelve commands

| Type | Fields | Effect |
|---|---|---|
| `set-variable` | `variableId`, `value`, `locale?` | Sets the default value, or one locale |
| `set-layer` | `layerId`, `patch` | Patches box, z, opacity, text, font, colour, fit, outline, bindings… |
| `add-layer` | `layer`, `above?` | Adds a `shape`, `gradient`, `image` (via `assetRef`) or `text` layer |
| `remove-layer` | `layerId` | Deletes the layer |
| `duplicate-layer` | `layerId`, `newId`, `patch?` | Copy with a new id |
| `reorder-layer` | `layerId`, exactly one of `z` \| `above` \| `below` | Moves within the stack |
| `swap-asset` | `layerId`, `asset{catalog,name,variant?}`, `focus?` | Swaps by catalogue reference, not URL |
| `set-animation` | `layerId`, `preset`, `startMs?`, `durationMs?`, `easing?`, `loop?`, `intensity?` | Applies a preset (the same 20 the Inspector offers) |
| `set-keyframes` | `layerId`, `keyframes[{t, easing?, values{x,y,w,h,rotation,opacity,scale}}]` | 2–40 explicit frames, sorted by `t` |
| `clear-animation` | `layerId` | Removes keyframes |
| `set-format` | `formatId`, `label?`, `width?`, `height?`, `safeZone?`, `pinnedLayerIds?`, `layerOverrides?` | Creates or updates a format |
| `set-scene-duration` | `durationMs` | Retimes the scene; rejected if a keyframe falls past the end |

There is no `params` field: a preset is a preset. Custom motion is expressed
with `set-keyframes`, where `scale` expands around the layer centre.

`add-layer` desugars shapes and gradients into self-contained
`data:image/svg+xml` layers drawn with `fit: "fill"`, so every exporter already
works. New layers default to `role: "foreground"`, which puts them inside the
safe zone — a full-bleed decoration must declare `role: "background"`.

Colours may be a hex string, `rgb()`/`rgba()`, or a palette **name**
(`"Vermilion"`); names resolve to the brand kit's hex before applying.

### 8.3 Guardrails

Guardrails judge the *result*, not the command. Codes: `SAFE_ZONE`,
`TEXT_OVERFLOW`, `BRAND_COLOR`, `BRAND_FONT`, `CONTRAST`, `MIN_TEXT_SIZE`,
`LOGO_INTEGRITY`, `LOCKED_LAYER`, `NO_INVENTED_FACTS`. Defaults —
`SAFE_ZONE`, `TEXT_OVERFLOW`, `BRAND_FONT`, `LOGO_INTEGRITY`, `LOCKED_LAYER`
and `NO_INVENTED_FACTS` **block**; `BRAND_COLOR`, `CONTRAST` and
`MIN_TEXT_SIZE` **warn**. A composition's own `guardrails` object and the
caller's overrides are merged on top.

Two rules are regression checks rather than absolute ones:

- `TEXT_OVERFLOW` only fires when a layer that fitted *before* the batch no
  longer fits. Pre-existing clipping is not attributed to the agent.
- `NO_INVENTED_FACTS` compares new phone numbers, URLs and e-mail addresses
  against `sourceFacts`; anything the operator did not supply is refused.

Non-blocking mode reports the same codes as warnings and applies anyway.

### 8.4 Result

```json
{
  "status": "applied-to-sandbox",
  "sceneRevision": 5,
  "sandboxId": "sandbox-m1k2j3",
  "errors": [],
  "warnings": [{ "code": "BRAND_COLOR", "message": "…", "layerId": "flyer-headline", "suggestion": "use a palette colour" }]
}
```

`status` is `applied-to-sandbox` or `rejected`. Issues carry `code`,
`message` and, where useful, `layerId`, `commandIndex` and `suggestion`.
Schema issues are reported **before** `STALE_REVISION`.

### 8.5 Sandbox, revision and undo

A batch applies to a sandbox copy of the composition. The scene's `revision`
is part of the document: autosave bumps it, and applying a batch commits
`baseRevision + 1`, so the number the agent quotes is never ambiguous. The
studio keeps one undo step for the last agent batch (`agentUndoAvailable()`,
`revertAgentBatch()`), and the status bar reports what landed.

### 8.6 Snapshots

**Export → Agent snapshot** (or `exportAgentSnapshot()`) writes
`<name>-agent-snapshot-r<revision>.json` with:

| Field | Contents |
|---|---|
| `revision` | The revision the snapshot was taken at |
| `scene` | The resolved composition (layers, formats, variables, brand kit) |
| `render` | `formatId`, canvas size, per-layer `rect`, `clipped`, `textLines`, `naturalHeightPct`, `contrastRatio` |
| `assets` | The catalogue the agent may reference: `logos`, `photography`, `uploads` |
| `brandKit` | Palette, fonts, logo count |
| `guardrails` | Effective rules and thresholds |
| `sourceFacts` | The facts the operator supplied, for `NO_INVENTED_FACTS` |

The agent quotes `revision` as `baseRevision` and refers to assets by
catalogue name — never by URL.

### 8.7 Layout alternatives

**Layouts…** in the Export bar asks the local planner for five layout
concepts (`proposeLayoutVariants()`) and shows them as painted thumbnails with
their command lists. Each concept is a *complete alternative* planned against
the same revision: pressing Apply rewinds to the scene captured when the
dialog opened and then applies that concept, so B does not inherit A's scrim.
**Revert** restores the captured scene, and **Regenerate** re-plans from the
current one.

The five concepts (photo-led, ink night, framed editorial, type poster,
motion) are ordinary v2 batches, so anything an outside model returns through
the same dialog behaves identically.
