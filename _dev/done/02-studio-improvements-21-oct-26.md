# Enabling the "not possible" list — a concrete plan

Every item below is **additive**: no existing `composition.json` breaks, no preset stops working. The engine already threads a single `getLayerStateAtTime` through DOM, PNG, MP4, GIF, and SVG export paths, so any feature that lands there automatically gets six surfaces for free.

---

## 1. Nonlinear easing — the cheapest win

**Where it's blocked:** `_.js` → `getLayerStateAtTime`:

```js
const amount = (time - previous.time) / (next.time - previous.time);
```

**Fix:** one field, one dispatcher.

```js
// keyframe shape (additive)
{ time, x, y, w, h, rotation, opacity, easing?: 'linear' | 'easeInOutSine' | ... }
```

```js
const EASING = {
  linear:      t => t,
  easeInSine:  t => 1 - Math.cos(t * Math.PI / 2),
  easeOutSine: t => Math.sin(t * Math.PI / 2),
  easeInOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInOutQuad: t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2,
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeOutBack: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  stepStart: t => t < 1 ? 0 : 1,
  stepEnd:   t => t > 0 ? 1 : 0,
};
const amount = (EASING[prev.easing] || EASING.linear)(raw);
```

**Files touched:** `_.js` (`getLayerStateAtTime`, `normalizeKeyframes` — preserve the field, `applyPreset`, `applyCharacterAnimationV3` — opt in for `breathe`/`pulse`/`fadeIn`), `server.js` (`normalizeDirectorProposals` — whitelist easing name, `normalizePresetParams` unchanged).

**Design choices:**
- Easing lives on the **outgoing** keyframe of each segment — that matches the common timeline-editor convention.
- `applyCharacterAnimationV3` should be **left alone** (its organic feel comes from non-uniform sampling, and 300 keyframes × easing would be wasteful). Only the *layer-level* presets opt in.
- Add a `presets easing` param — `{ preset: 'walk', params: { easing: 'easeInOutQuad' } }` — clamped by name lookup, not numeric range. `PARAM_RULES` doesn't fit; add `EASING_NAMES` array.

**LOC:** ~40 lines + 9-entry table. **Risk:** low. **Surface:** DOM, PNG, MP4, GIF, agent commands (`applyAgentCommands` passes `params` through untouched).

---

## 2. Animated color / opacity effects

**Where it's blocked:** `layerEffectFilterMarkup` emits static `<feFlood flood-color="…">`. The filter is generated once in `renderCanvas` and never updated.

**Fix:** parallel timelines, not mixed keyframes.

```js
// layer additions
recolorTimeline?: [{ time, color }]   // #rrggbb
outlineTimeline?: [{ time, color, width? }]
```

Mixing numbers and strings inside `keyframes[]` breaks `normalizeKeyframes`'s `every(Number.isFinite)` guard and every exporter. A separate array keeps interpolation in the right space (sRGB per-channel, or better: convert to Oklab once and lerp there — perceptually cleaner for crossfades).

**Interpolation:**

```js
function lerpHex(a, b, t) {
  const pa = [1,3,5].map(i => parseInt(a.slice(i, i+2), 16));
  const pb = [1,3,5].map(i => parseInt(b.slice(i, i+2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i]-v)*t).toString(16).padStart(2,'0')).join('');
}
```

**DOM renderer:** don't rebuild the filter per frame. Two options:
- **A (recommended):** make the filter reference CSS variables — `<feFlood flood-color="var(--ls-recolor-COLORID)"/>` — and `applyAnimationTime` sets `node.style.setProperty('--ls-recolor-COLORID', currentColor)`. Zero filter regeneration.
- **B:** update `feFlood` attributes on `applyAnimationTime` when the sampled color changes (compare-to-last cache avoids 30 redundant writes per frame).

**Export renderer:** two paths.
- If a layer has *static* effects → keep the existing `loadExportAssets` pre-rasterization.
- If a layer has *animated* effects → skip preprocessing; apply recolor (`source-in` fill on a temp canvas) and outline (`dilateAlpha`, already implemented) **inside `renderExportFrame`** per frame. Recolor is ~3 ms/layer at 1080p; outline is bounded by `outlineWidth` cap (32 px). Fine at 30 fps.

**SVG:** for PNG export this is irrelevant. For animated SVG export (a separate wish — see §7), the honest approach is SMIL: emit `<animate attributeName="flood-color" values="#…;#…" keyTimes="0;1"/>` on each `<feFlood>`. Browsers honor it; most SVG rasterizers do too.

**LLM:** add to `buildWriterPrompt` a `colorTimeline` command:
```json
{"layerId":"L03","colorTimeline":[{"time":0,"color":"#3a8"},{"time":5000,"color":"#a30"}]}
```
`normalizeDirectorProposals` validates each `#RRGGBB`, max 8 keyframes, monotonic time. Add a preset `tint` with `params: { from: '#…', to: '#…' }` so the LLM's most common ask ("slowly turn the sky golden") doesn't require raw timelines.

**Files touched:** `_.js` (`applyAnimationTime`, `renderExportFrame`, `layerEffectFilterMarkup`, `normalizeKeyframes`, presets), `server.js` (validation).

**LOC:** ~120. **Risk:** medium (rendering parity). **Surface:** DOM, PNG, MP4, GIF. SVG static only.

---

## 3. Masks / clipping — the most invasive, but very well-bounded

**Design choice: group masks over per-layer masks.** A `group` field already exists (`segmentGroup`), and the LLM already reasons about groups. Per-layer `maskLayerId` gives you a forest of 30 unique masks per scene with no editor UX. Group masks give you one reusable mask per effect ("spotlight over the campfire", "smoke silhouette cut by the mountain").

**Schema:**
```js
// on any layer:
{ role: 'mask', maskFor: 'campfire-group', invert?: false }
// or on a group's representative layer:
{ clipTo: 'layer-id' | 'group-key', mode?: 'alpha' | 'luma', invert?: boolean }
```

I'd ship **both**, with `clipTo` as the simple path and `role: 'mask'` as the compositor path:

- `clipTo` — the layer's `<img>` is drawn with CSS `mask-image: url(<target.url>)`. Simplest possible UX: "this layer is only visible inside that layer's shape." Works for one layer. Zero compositor changes.
- `role: 'mask'` — the renderer composites the `maskFor` group into a temporary buffer, then applies the mask with `destination-in`, then draws the result. Works for groups.

**Renderer changes:**

```js
// DOM
node.style.maskImage = `url(${maskLayer.url})`;
node.style.maskMode = maskLayer.mode === 'luma' ? 'luminance' : 'alpha';
node.style.maskRepeat = 'no-repeat';
node.style.maskSize = '100% 100%';
// WebKit prefix for Safari

// Canvas — inside renderExportFrame, per masked draw
if (layer.clipTo) {
  const buf = offscreen;           // cached per size
  buf.ctx.clearRect(...);
  buf.ctx.drawImage(image, ...);
  buf.ctx.globalCompositeOperation = 'destination-in';
  buf.ctx.drawImage(maskImage, ...);
  buf.ctx.globalCompositeOperation = 'source-over';
  context.drawImage(buf.canvas, ...);
}
```

For group masks, isolate the group into a buffer first (`exportIsolateGroups` already needs this for `exportSegmentGroup`, so the plumbing exists).

**LLM:** masks are a new command kind:
```json
{"layerId":"L12","preset":"fadeIn"},                              // layer motion
{"groupKey":"fireflies","mask":"misty-forest-background"},        // group-level mask
{"layerId":"L30","maskFor":"forest"},                             // layer acts as a mask
```
`normalizeDirectorProposals` needs to resolve `groupKey → layer ids` and emit one clip per layer. `applyAgentCommands` in `_.js` needs a new branch.

**Files touched:** `_.js` (`renderCanvas`, `applyAnimationTime`, `renderExportFrame`, new `resolveClip` helper, `applyAgentCommands`), `server.js` (`buildWriterPrompt`, `normalizeDirectorProposals`), `_.css` (mask-web-kit prefixes).

**LOC:** ~250. **Risk:** high (parity across DOM/SVG/canvas, Safari mask quirks). **Surface:** DOM, PNG, MP4, GIF. SVG is possible with `<clipPath>` or `filter` but skip for v1.

**Recommendation:** ship `clipTo` first (single-layer clip, ~60 LOC, no server changes). Ship `role: 'mask'` only if a demo project (the Curupira misty forest is a natural candidate — mask the fireflies to the fog) needs it.

---

## 4. Rigging non-character objects — channel presets, not new detection

**Root cause:** `applyCharacterAnimationV3` hardcodes the channel set (blink, gaze, viseme, breathe, headSway, pulse). `detectCharacters` hardcodes the part vocabulary.

**Design: a `rig.type` field and a channel dispatcher.**

```js
// character.json (bundle manifest) — extend, don't replace
{
  "character": {
    "rigVersion": 4,
    "type": "humanoid" | "bird" | "quadruped" | "fish" | "plant" | "flag" | "custom",
    "channels": { ... },      // optional: custom channel map
    "parts": {...},
    "settings": {...}
  }
}
```

Then in `_.js`:

```js
const RIG_CHANNELS = {
  humanoid: applyHumanoidRig,       // current v3 driver, renamed
  bird:     applyBirdRig,           // flap, tailBob, headTilt, breathe
  quadruped:applyQuadrupedRig,      // legCycle, tailWag, breathe, earFlick
  fish:     applyFishRig,           // tailWave, bodyWave, finFlutter
  plant:    applyPlantRig,          // sway, leafFlutter, breathe
  flag:     applyFlagRig,           // wavePhase, edgeRipple
};

function applyCharacterAnimation(character) {
  const rig = RIG_CHANNELS[character.type || 'humanoid'] || applyHumanoidRig;
  return rig.call(this, character);
}
```

Each new rig is **80–150 lines** of the same shape as `applyCharacterAnimationV3`:
- build base map
- generate a non-uniform sample set (edges of motion events)
- for each pose: compute channel offsets from settings
- clamp into keyframes

The `applyCharacterAnimationV3` machinery — saccade generator, blink events, viseme weights — is not reused for a bird. But the *settings normalization* (`normalizeCharacterSettings`, `CHARACTER_DEFAULTS`) needs per-type extensions:

```js
const CHARACTER_DEFAULTS_BY_TYPE = {
  humanoid: { blink:true, gazeX:0, speechText:'', ... },
  bird:     { flap:true, flapRate:3, tailBob:true, headTilt:0.5, pitch:0, ... },
  plant:    { sway:0.7, leafFlutter:true, gust:0.3, ... },
};
```

`updateCharacterSettings` becomes `{ ...defaults, ...patch }` with defaults selected by `type`.

**Detection:** `detectCharacters` (in `server.js`) already inspects layer names. Extend `CHARACTER_PART_MATCHERS` with:
```js
['wing-left',  /wing.*left|left.*wing/i],
['wing-right', /wing.*right|right.*wing/i],
['tail',       /tail/i],
['leg-left',   /leg.*left|left.*leg/i],
['leg-right',  /leg.*right|right.*leg/i],
['trunk',      /trunk|nose/i],
['fin',        /fin/i],
```
Then a heuristic:
```js
if (parts.wing) type = 'bird';
else if (parts.tail && parts.leg) type = 'quadruped';
else if (parts.leg && !parts.hands) type = 'plant';  // ambiguous
else type = 'humanoid';
```

**LLM:** add `rigType` to `buildWriterPrompt`'s character inventory. Add channel names per type to the vocabulary section:
```json
{"characterId":"character-1","settings":{"flapRate":3.5,"headTilt":0.4,"pitch":-0.1}}
```

**Files touched:** `_.js` (`applyCharacterAnimationV3` split into dispatcher + humanoid, `normalizeCharacters`, `characterPresetPatch`, `makeCharacterFieldset` — render controls per type), `server.js` (`detectCharacters`, `buildDirectorPrompt`, `normalizeProposalCharacters` — accept type-specific keys), character bundle schema.

**LOC:** ~600–800 (mostly the new rig drivers). **Risk:** medium-high (each rig is its own correctness surface). **Surface:** DOM, PNG, MP4, GIF, agent spec.

**Recommendation:** ship one new rig (`bird`) plus the dispatcher, then add rigs lazily as projects need them. The Beards project proves the pattern; a bird demo (`data/projects/Bird/compositions/`) proves the generalization.

---

## 5. Multi-character scenes — mostly done, needs UI and one demo

**Current state:** the engine *is* multi-character-ready.

| Mechanism | Status |
|---|---|
| `composition.characters[]` up to 12 | ✅ `normalizeCharacters` |
| `renderCharactersInto` loops all | ✅ `renderInspector` |
| `applyAgentCommands` loops all | ✅ `applyAgentCommands` |
| `normalizeProposalCharacters` dedups | ✅ `server.js` |
| `syncRigReferenceVisibility` hides ref if *any* v3 applied | ✅ |
| `updateCharacterSettings(id)` scoped per character | ✅ |
| LLM prompt includes all characters | ✅ `buildWriterPrompt` |

**Real blockers — both UI:**

1. **`renderInspector` stacking.** Three characters means three full fieldset blocks (each ~40 controls) above the layer fields. Scroll becomes unusable. Fix: a `<select>` "Editing character" at the top of the character region, defaulting to the first, and render only the selected one. Add per-character "applied" badge to the picker so users know which rigs are live.

2. **`makeCharacterFieldset` id collisions.** Ids like `data-character-panel="character-1"` are unique per character, but if two characters were auto-detected with the same `id` (the server's `addCharacter` dedups on *name*, not id — `character-${characters.length + 1}`), it's still safe because `characters.length` differs. No fix needed; just note it.

**LOC:** ~80 for the picker, ~10 for the badge. **Risk:** low. **Surface:** DOM only.

**Recommendation:** ship the picker, then add a demo project with two characters (a Curupira + a smaller fire-spirit, or reuse Beards alongside a second Beards variant). This is the highest *visible* ROI of the six.

---

## 6. Truly arbitrary animation from the LLM — two phases

**The safety contract:** the current code forbids arbitrary keyframes because it can't validate them cheaply. Two ways forward:

### Phase A — enrich the preset vocabulary (safe, immediate)

The LLM already picks presets. Give it more to pick. Ten new generators:

| Preset | Keyframes | Params |
|---|---|---|
| `orbit` | circular x + y over duration | `radius`, `angle` |
| `shake` | damped noise x + y | `amplitude`, `decay` |
| `hop` | parabolic y + squash at contact | `height`, `count` |
| `swing` | pendulum rotation about a pivot | `amplitude`, `period` |
| `tint` | (see §2) color timeline | `from`, `to` |
| `fadeOut` | reverse `fadeIn` | `start` |
| `blinkIn` | 3-step opacity | — |
| `zoom` | w/h scale over duration | `from`, `to` |
| `spin` | full rotation over duration | `turns`, `easing` |
| `nod` | rotation oscillation | `amplitude`, `cycles` |

Each is 10–20 lines in `applyPreset`. `PRESET_NAMES` grows; `PARAM_RULES` grows. `buildWriterPrompt`'s `PRESET_NAMES.join(', ')` grows automatically.

**LOC:** ~180. **Risk:** low. **Surface:** all.

This alone covers ~80% of what a creative LLM would ask for. It's the right first move.

### Phase B — allow raw keyframes (with strict validation)

Extend the proposal schema:

```json
{"commands":[
  {"layerId":"L05","preset":"custom","keyframes":[
    {"time":0,   "x":10,"y":50,"rotation":-5,"easing":"easeInOutSine"},
    {"time":400, "x":30,"y":40,"rotation": 5,"easing":"easeOutCubic"},
    {"time":1200,"x":10,"y":50,"rotation":-5}
  ]}
]}
```

Server-side validation in `normalizeDirectorProposals` (new branch):

```js
const keyframes = normalizeRawKeyframes(command.keyframes);
if (!keyframes) continue;  // reject silently, count as skipped
```

`normalizeRawKeyframes`:
- max 120 keyframes (a third of the human limit, so a single idea can't blow past the 400-frame cap when applied)
- monotonic `time` (sorted, no duplicates)
- `x,y` in [-100,200], `w,h` in [1,300], `rotation` in [-3600,3600], `opacity` in [0,1]
- `easing` in whitelist
- **reject any keyframe that isn't strictly within the layer's current rect ± 60%** — this is the new safety rail. It stops the LLM from teleporting a layer across the canvas without the user seeing it, which was the original reason for the preset-only design. Presets can move 100%; raw keyframes cannot.

Client-side `applyAgentCommands` (`_.js`): branch on `cmd.keyframes`:
```js
if (Array.isArray(cmd.keyframes)) {
  layer.keyframes = normalizeKeyframes(cmd.keyframes);
  applied++;
  return;
}
```

Prompt additions in `buildWriterPrompt`:
- new section "Custom keyframes — only if no preset fits"
- example with a 3-keyframe arc
- explicitly: "Custom keyframes must stay within the visible region of the layer's current box. Prefer presets."

**LOC:** ~120 server + ~40 client + prompt. **Risk:** medium (validation bugs → runaway layers). **Surface:** DOM, PNG, MP4, GIF.

**Recommendation:** **Phase A immediately; Phase B only after a demo proves the LLM asks for it.** The preset-based contract is the *reason* the director works reliably; break it only when the vocabulary genuinely can't express the intent.

---

## 7. Bonus: a seventh item worth adding to the list

The README and the code both admit it: **SVG export is static**. `exportSvg` writes `<image>` elements with no keyframes. That's a bigger gap than some of the six — SVG is the format that ships best in storybooks, EPUBs, and vector pipelines.

Fix path: emit SMIL for each keyframe-animated layer:

```xml
<animateTransform attributeName="transform" type="translate"
  values="0 0; 10 0; 0 0" keyTimes="0; .5; 1"
  dur="10s" repeatCount="indefinite"/>
```

`getLayerStateAtTime` already does the interpolation; you'd re-derive the `values` list from the keyframes. This is not in the wishlist, but it's the most coherent follow-up to §1 (easing needs SMIL `calcMode="spline"` with `keySplines`).

---

## Recommended order

| Step | Feature | LOC | Days | Unlocks |
|---|---|---|---|---|
| **1** | Easing | 40 | 0.5 | Video/GIF quality jump, `walk`/`orbit` become usable |
| **2** | Preset vocabulary expansion (§6A) | 180 | 1 | LLM expressiveness |
| **3** | Multi-character UI picker (§5) | 90 | 0.5 | The engine's existing power becomes reachable |
| **4** | `clipTo` single-layer masks (§3, partial) | 60 | 0.5 | Fireflies-in-fog demo |
| **5** | Animated color/outline (§2) | 120 | 2 | Slow day/night, magical outlines |
| **6** | `bird` rig + dispatcher (§4) | 500 | 3 | Non-humanoid demos |
| **7** | Group masks (§3, rest) | 200 | 2 | Compositor effects |
| **8** | Raw LLM keyframes (§6B) | 160 | 1.5 | Truly arbitrary direction |

Steps 1–3 are **"do this week"** and together they dramatically expand what both the user and the LLM can express — with almost no schema risk.

---

## Cross-cutting rules for every step

1. **Backward compatibility is non-negotiable.** Every new field defaults to current behavior. `composition.json` schema version stays `1`; new fields are additive.
2. **Server-side clamping is the real safety barrier.** The client can be trusted (it's local); the LLM cannot. Every new numeric range gets a `PARAM_RULES` entry or an equivalent; every new string gets a whitelist.
3. **Export parity is the acceptance test.** A feature is not done until a frame renders identically in DOM, PNG, and GIF. `tools/render-beards-preview.js` is the harness — add one still per feature.
4. **`CHARACTER_PART_KEYS`, `CHARACTER_DEFAULTS`, `PRESET_NAMES` are contracts** shared between `_.js`, `server.js`, the agent spec (`layer-studio/agent/v1`), and the LLM prompts. Any change to one needs a matching update in the other three, or the LLM will produce commands the client silently rejects.
5. **`normalizeCharacterSettings` is a single point of truth.** Adding a rig type means extending it *by type*, not adding a second normalizer — otherwise `applyAgentCommands` and `applyProposal` will diverge.