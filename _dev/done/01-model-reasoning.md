The user wants to improve the system to enable the six limitations I listed. Let me think carefully about each one and what a realistic, minimally invasive implementation would be — given the codebase's constraints (zero-dependency, no bundler, keyframes are the single source of truth, v3 rig generates them).

Let me go through each and design a concrete implementation plan.

1. Nonlinear easing
Current: getLayerStateAtTime does prev + (next - prev) * amount — linear.

The keyframe schema is {time, x, y, w, h, rotation, opacity}. We need to add easing per-keyframe or per-segment.

Options:

Per-keyframe easing curve: add easing: 'easeInOut' (or params) to each keyframe, meaning "ease into this keyframe from the previous one". Simple and local.

Bezier control points: full cubic-bezier like CSS. More expressive.

Named easings: linear, easeIn, easeOut, easeInOut, backOut, elastic, bounce etc.

Best approach: per-keyframe easing specifier. Each keyframe's easing describes the interpolation from the previous keyframe to this one. This preserves backward compat (no easing = linear). Support a small named set plus cubic-bezier option.

Places to update:

ANIMATED_PROPERTIES interpolation in getLayerStateAtTime

normalizeKeyframes (validate easing)

upsertKeyframe and preset generators (they can pass easing)

Export renderer — already calls getLayerStateAtTime, so free.

SVG export — currently doesn't include keyframes, so no issue.

Agent spec / presets — presets can specify easing now.

Also useful: the presets themselves should use easing. E.g. sway should use a sine (already does via many samples), but fadeIn should use easeOut. pulse should use easeInOut. walk should use easeInOut for start/end.

Sampling size matters: for smooth easing with a single segment, we could either (a) keep the easing model and rely on per-frame interpolation at render time (linear between many keyframes would be wrong) — actually if keyframe spacing is large, easing applied at sample time won't help because the renderer interpolates linearly between sparse keyframes.

Wait — the renderer samples between adjacent keyframes at time t, and t lies between two keyframes. So easing per segment IS applied by the renderer. Good. The generator doesn't need to oversample as long as the easing curve is stored on the target keyframe. So we should:

Reduce reliance on dense sampling for eased presets.

Add easing field.

Implementation sketch:

js
function easeValue(kind, t) {
  // t in [0,1]
  switch (kind) {
    case 'easeIn': return t*t;
    case 'easeOut': return 1 - (1-t)*(1-t);
    case 'easeInOut': return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    case 'backOut': /* ... */;
    case 'elastic': /* ... */;
    case 'bounce': /* ... */;
    case 'bezier:0.4,0,0.2,1': /* parse */;
    default: return t;
  }
}
Then in getLayerStateAtTime:

js
const next = frames[nextIndex];
const previous = frames[nextIndex - 1];
const raw = (time - previous.time) / (next.time - previous.time);
const amount = easeValue(next.easing, raw);
The generator can emit easing on target keyframes. Presets:

breathe: easeInOut

idle: easeInOut

pulse: easeInOut

fadeIn: easeOut

drift, parallax: easeInOut

sway: sine — keep dense sampling OR use easeInOut with fewer frames

walk: easeInOut at both ends

float: easeInOut

For the v3 rig, the animation naturally oversamples (60ms steps), but adding easing on the sparse features like blink could smooth them further. Blink already uses smoothstep so it's fine.

Also add easing to UI inspector — a dropdown on each keyframe. That's more work but doable.

2. Animated color / opacity effects
Current: recolorEnabled/Color, outlineEnabled/Color/Width are static per layer. The DOM applies an SVG filter; canvas re-implements it.

Approach: add per-keyframe channels for these. But that's a lot of channels to interpolate. Simpler: add animated effect channels to keyframes.

Alternatively, animate recolor color's hue/saturation/brightness or just the alpha of the effect.

Best minimal path:

Add to keyframe schema: recolorAlpha (0..1), outlineAlpha (0..1), outlineWidth (in px), and recolorColor (interpolated by hex).

Or simpler: treat color animation as a separate effect layer — a "tint overlay" layer that has opacity animation and an adjustable fill color. This avoids touching the SVG filter — just add a div with a colored mask. But we already have recolorEnabled per layer, so extending it is natural.

Actually the cleanest incremental design: extend ANIMATED_PROPERTIES per layer with a new set of effect channels that only apply if the effect is enabled. Interpolation is still linear/eased, and it flows through the same getLayerStateAtTime. Then:

SVG filter regenerated per frame with the interpolated values (already re-rendered on each applyAnimationTime... wait, no — renderCanvas only runs on render(), not on applyAnimationTime).

Hmm, that's the crux: applyAnimationTime updates style.left/top/width/height/opacity and img.src — but not the SVG filter. So the filter is applied once during renderCanvas.

Fix: on each frame, update the filter attribute of the image (img.style.filter = url(#...) can't change values), or set CSS variables. We could use CSS filter: url() with SVG filter variables via CSS custom properties — but SVG filters don't read CSS vars.

Alternative: update the feFlood flood-color and feMorphology radius via setAttribute on the SVG in the filterDefs during applyAnimationTime. That's a DOM write per frame, but only when the effect is animated — cheap enough.

Or, use canvas-only effects: skip the SVG filter, and pre-render each layer to an offscreen canvas with the current effect. That's what loadExportAssets does, but for live preview it would be too expensive at 60fps unless cached.

Middle path: use CSS filter: brightness() saturate() interpolation on img and reserve the SVG filter for static effects. Hmm, not equivalent.

Best realistic path: add an overlay approach:

For recolor, animate the overlay div's background color and use mix-blend-mode: multiply or use SVG feColorMatrix.

For outline, animate the stroke radius by re-generating the SVG filter — or use filter: drop-shadow() (hacky but works for outlines).

Actually the cleanest, most canonical solution: write the effect values into CSS custom properties and use those inside the SVG feFlood flood-color via a style binding? No, SVG filter attributes are not CSS.

BUT: SVG filter attributes accept <animate> elements for real keyframe animation. However that requires baking into the SVG every render, which is the same cost.

The right answer for a studio like this is:

Keep the effects static and instead add an animation-capable "tint" and "glow" overlay layer type. Users add a new layer that is a colored region overlaid on a target using clip-path: url(#targetShape). The overlay's opacity/color is what animates.

But that's a big addition.

Simpler realistic proposal: extend keyframes to include effectOpacity (single scalar, 0..1). The layer's img gets opacity: layerEffect * effectOpacity. This gives fade-in/out of any effect (glow, outline) but not color animation. That's 80% of the value at 20% of the cost.

For color animation specifically, add hueRotate (degrees) which CSS supports natively:

text
img.style.filter = `url(#${filterId}) hue-rotate(${hue}deg) saturate(${sat}) brightness(${brightness})`;
This gives color animation for free through CSS filter composition. Hue shifts, saturation pulses, glow brightness. This is probably the most pragmatic win: animate CSS filter properties, not SVG filter internals.

So the plan:

Add to keyframes: hueRotate, saturate, brightness, blur, glow (scalars) that compose with the SVG filter in the DOM.

Same values exported to canvas via ctx.filter — but canvas ctx.filter doesn't support url(). So for canvas, we'd have to do: (a) draw the layer with the SVG filter applied through a temp canvas, then (b) apply ctx.filter = "hue-rotate(...) saturate(...)" around the drawImage. Canvas ctx.filter supports these string filters natively.

Actually we already pre-process recolor/outline into a temp canvas in loadExportAssets. We can bake the CSS filter parameters via ctx.filter at draw time, or via the temp canvas draw. Cleanest: in renderExportFrame, before drawImage, set context.filter = "hue-rotate(X) saturate(Y) ..." for that frame. This is supported in Chrome/Safari/Firefox.

So animated color/opacity effects become feasible.

3. Animated masks / clipping
Currently layers are always fully rectangular. Add a clip channel per keyframe.

Options:

clipPath via CSS: set a clip-path: polygon(...) or circle(...) or inset(...) on the layer item. Interpolate the parameters of the shape.

mask via SVG <mask>: more powerful, can use arbitrary alpha shapes.

"Text/reveal mask": use another layer's alpha as a mask — e.g., text layers being wiped by a shape.

Simplest scalable design: add per-keyframe clip object with a few primitive shapes:

js
clip: { shape: 'inset', top: 0, right: 0, bottom: 0, left: 0 } // percent of the layer
clip: { shape: 'circle', cx: 50, cy: 50, r: 0 }
clip: { shape: 'polygon', points: [[0,0],[100,0],[100,100]] }
Interpolate numeric fields when shapes match. If shape types differ, snap (or crossfade with mask on a temp layer).

CSS clip-path accepts inset(...), circle(...), polygon(...) natively. The layer-item applies it. Canvas can use context.clip() with the same path.

But the layer-item is the bounding box of the image. If we clip the bounding box, we're clipping the layer content. That works.

For masks driven by another layer's alpha ("X-ray" reveal), we'd use a CSS mask with an image reference:

text
-webkit-mask-image: url(#maskLayerURL);
But animated positions on the mask layer don't propagate without JS updates. Live linking is possible by re-writing the mask URL each frame. Feasible but heavier.

I'd propose clip-path primitives (inset/circle/polygon/ellipse) as the primary mode. That covers: wipes, iris transitions, text reveal, expanding reveals.

4. Rigging non-character objects
Current: detectCharacters looks for CHARACTER_PART_KEYS regex + geometry.

To enable generic rigging: introduce a generic "rig" schema that maps parent-child relationships with pivot points, and allow the user (or a detection hint) to assign part roles.

Simplest design that stays within the current codebase: a bone list on the character:

js
character = {
  id, name, parts: {...}, // part → layer ids
  bones: [
    { id: 'wing-left',  layerId: 'wing-left-1', parent: 'body', pivot: [x, y], motion: 'flap', amplitude: 0.4, freq: 1.2, phase: 0.0 },
    { id: 'tail',       layerId: 'tail',        parent: 'body', motion: 'sway', amplitude: 0.2, freq: 0.7 }
  ]
}
Then applyGenericRig(character) generates keyframes on each part, transforming around the pivot. Presets like flap, sway, nod, gaze-track become generic motions.

Detection: extend classifyCharacterPart to accept a role field on the layer, so any layer can opt into a rig part. Users can set it in the inspector.

This makes rigging a bird trivial: mark wing-left and wing-right layers with part: 'wing-left'/'wing-right' and click "Rig".

Or even simpler and more general — expose a "Bind layers to a rig template" dialog:

Template: bird (wings, tail, head), fish (fins, tail, body), tree (trunk, branches), water (waves).

Each template knows which part keys to look for, and what motions to apply.

Given the codebase, the cleanest path is:

Extend CHARACTER_PART_KEYS to be dynamic — the rig classifies by layer metadata (part field) as primary, geometry/regex as fallback.

Add new part motion generators: flap, tailSway, finWave, branchSway, waveRoll.

Add a "Rig" wizard in the sidebar where the user picks layers and assigns parts; the wizard uses part presets per role.

This is the most flexible design and requires minimal structural change.

5. Multi-character scenes
Current state:

characters[] array supports up to 12 (server-side).

normalizeCharacters supports 12 client-side.

applyProposalCharacters supports 8.

But the Inspector only renders one fieldset per character at the bottom of the inspector (actually renderCharactersInto loops all characters, so it does render multiple). Let me re-check...

Looking at renderCharactersInto:

js
renderCharactersInto(parent) {
    const characters = this.composition.characters || [];
    if (!characters.length) return;
    characters.forEach((character) => {
        parent.appendChild(this.makeCharacterFieldset(character));
    });
}
So it does render all characters. The limitation I noted was probably from the older state or from the sidebar UI. Let me verify what breaks:

applyCharacterAnimationV3 — uses character.parts per character; each has its own hidden list; no cross-character interference.

syncRigReferenceVisibility — hides reference if ANY v3 character applied. Correct for multi-character.

applyCharacterAnimation uses this.characterUsesRigV3(character). Correct.

clearCharacterAnimation — also loops per-character. Correct.

applyCharacterAnimation on one character should not touch another's layers — it doesn't.

However, syncRigReferenceVisibility disables the reference if any v3 character is applied. In multi-character scenarios, hiding the reference when only one character is rigged could be wrong if another relies on the reference. Actually since v3 rigged chars are self-contained, this is fine — but if a scene has one character rigged and one static reference, the reference should stay. Minor bug.

The bigger issue is composeCharacterCover: in v2 it creates a face plate from the reference. For multi-character scenes, the plate is sampled around a specific character's eyes; multiple plates from the same reference can look wrong. Not critical for v3 (v3 doesn't use cover layers).

So multi-character is already largely implemented; the remaining problems are:

The Inspector fieldset can get very tall with multiple characters (14+ groups). Add collapsible per-character sections (using <details> like the v3 advanced controls).

LLM prompts: buildWriterPrompt already lists all characters. Good.

applyProposal calls applyAgentCommands which handles many character commands. Good.

UI: sidebar/Inspector doesn't offer a "select active character" toggle for tools. Should add.

prepareCharacterCovers loops all characters — fine.

syncRigReferenceVisibility — should be smarter: hide the reference only if all characters that use the reference are rigged. Actually the rule should be: hide if any v3 character is applied AND every layer of that character is animated (so the reference isn't needed as fallback). Simplify: hide if any v3 character is applied; the user can unhide manually. But a better rule: hide if any character is applied AND no character has applied === false (i.e., all are rigged). Hmm.

Actually the true intent of hiding the reference is "the rig now covers everything, so showing the reference would double-expose the character." If character A is rigged but B is static, the reference is still needed to show B. So we need to composite the reference into a temp layer or only hide the reference if all visible characters are rigged.

Simplest correct rule: hide the reference if all characters are applied. If some are not, keep it. Change syncRigReferenceVisibility:

js
const chars = this.composition.characters || [];
const v3 = chars.filter(c => Number(c.rigVersion) >= 3);
const allRigged = v3.length > 0 && v3.every(c => c.applied);
const target = !allRigged;
But even that's not quite right — if there is no character or only v2, we want reference visible. So:

js
const v3 = (this.composition.characters || []).filter(c => Number(c.rigVersion) >= 3);
const target = v3.length === 0 || v3.some(c => !c.applied);
That's more correct.

Additionally: the export pipeline should handle multiple v3 characters with separate hidden sets. It already does because each layer has its own keyframes and hidden is folded into them (opacity 0 across all times).

So multi-character mostly needs:

UI grouping: <details> per character in the Inspector.

A character selector for the LLM prompt (it already sees all).

Fix syncRigReferenceVisibility.

A "select active character" so the inspector/tools focus.

Test that applyAgentCommands handles many character ids — it does.

The good news: most of it is already there, just unpolished.

6. Truly arbitrary animation from the LLM
Current: LLM picks presets + character settings; no raw keyframe emission.

Approach: extend the agent command schema to accept keyframes directly. Add a commands type { keyframes: [...] } or extend { preset: 'custom', keyframes: [...] }.

Security/validation:

Clamp times to 0..duration.

Clamp x/y to -100..200.

Clamp w/h to 1..300.

Clamp rotation, opacity.

Cap at e.g. 40 keyframes per command.

Validate easing enum.

Optional: keep the LLM from writing >N commands per proposal (already 12).

Also provide higher-level animation primitives that are still composable:

sequence: [{ layerId, at: ms, preset, params }] — schedule a preset later in the timeline.

repeat: { count, gap } around a preset.

parallel: group.

Actually the simplest useful extension: per-layer multi-preset with scheduling:

json
{"layerId": "L03", "preset": "drift", "params": {"distance": 2}, "start": 2000, "duration": 4000}
{"layerId": "L03", "preset": "fadeOut", "start": 8500}
And fadeOut becomes a new preset. This lets the LLM build narratives: "fade in at 0, sway until 4s, fade out at 8s."

For truly arbitrary motion, add a low-level command:

json
{"layerId": "L03", "keyframes": [
  {"time": 0, "x": 40, "y": 50, "w": 20, "h": 20, "opacity": 0, "easing": "easeOut"},
  {"time": 1000, "opacity": 1},
  {"time": 4000, "x": 60, "easing": "easeInOut"},
  {"time": 5000, "opacity": 0}
]}
Validation on the server: normalizeDirectorProposals should also accept this shape; clamp everything; require the layer exists in the catalog.

Then applyAgentCommands handles:

keyframes → replace the layer's keyframes with normalized versions.

preset (existing) — unchanged.

start, duration — merge into the existing keyframes (shift times).

Also, the writer prompt should be extended to accept these shapes and mention them.

Additionally: allow the LLM to target groups of layers by role rather than individual ids:

json
{"role": "effect", "preset": "flicker"}
This handles scenes with many similar layers (fireflies, ferns) without enumerating every alias.

And: allow named anchors — the LLM can say "fireflies" and the server resolves to any layer whose name or segmentGroup matches. Already partially handled by resolveLayer via name lookup, but let's expose it explicitly.

Concrete implementation plan
Let me structure this into deliverables with file-by-file changes.

A. Keyframe schema extension
Add to keyframes:

easing: string (linear, easeIn, easeOut, easeInOut, backOut, backIn, elastic, bounce, bezier:x1,y1,x2,y2)

hueRotate, saturate, brightness, blur, effectOpacity — scalar effect channels

clip: { shape, ... }

normalizeKeyframes extends to:

Validate easing.

Clamp scalar effect channels.

Validate clip primitives.

ANIMATED_PROPERTIES becomes a two-tier list:

Positional: x, y, w, h, rotation, opacity (existing).

Visual: hueRotate, saturate, brightness, blur, effectOpacity.

getLayerStateAtTime extends interpolation.

applyAnimationTime applies:

CSS filter: filter: url(#filterId) hue-rotate(..) saturate(..) brightness(..) blur(..).

clip-path: inset(...) / circle(...) / polygon(...).

img.style.opacity *= effectOpacity — combine with layer opacity? Use a separate wrapper div.

B. Presets + easing
applyPreset gains easing:

breathe, pulse, idle, float: easeInOut at each intermediate keyframe.

fadeIn, fadeOut: easeOut.

walk: easeInOut at start and end.

sway: use easeInOut between sine samples (finer control).

drift, parallax: easeInOut.

PARAM_RULES and PRESET_PARAM_KEYS unchanged.

Server side: normalizePresetParams unchanged, but normalizeDirectorProposals should validate easing on commands.

C. New presets to add
fadeOut (inverse of fadeIn)

zoomIn, zoomOut (scale around center)

shake (small oscillation)

spin (rotation 360°)

reveal (clip-path inset sweep)

iris (circle clip growing)

glow (animated brightness/blur)

tint (animated hueRotate/saturate)

These directly use the new channels.

D. Clip-path in canvas export
renderExportFrame needs to handle clip. Canvas supports ctx.clip() with a path. For interpolation between shapes, only interpolate when the shape matches; otherwise snap to the target.

For animated clip, getLayerStateAtTime returns a clip object. In renderExportFrame:

js
if (state.clip) {
  context.save();
  applyClipPath(context, state.clip, x, y, w, h, outputWidth, outputHeight);
  // draw the layer inside
  context.restore();
}
E. Multi-character polish
Inspector: wrap each character fieldset in <details> with the character name; add a "Select" radio to mark the active one.

syncRigReferenceVisibility fix as above.

UI: "Add character" button in the inspector to create a new character from the current selection (or from auto-detection).

F. Generic rig
New concept: rig kind per character. character.rigKind = 'character' | 'object' | 'creature' | 'plant'.

For object, applyCharacterAnimationV3 is bypassed; instead call applyObjectRig.

applyObjectRig uses a generic set of motions controlled by a small vocabulary of "bones":

sway, flap, wave, bend, pulse, shimmer.

Layer part can be any string; presets for common roles: wing-left, wing-right, tail, fin-top, fin-bottom, branch, trunk, water.

Users select layers and assign parts in the inspector.

Detection: extend detectCharacters to look for part metadata — if a layer has part set, group it with other layers of the same group (if group is set) as a "rig group". The group becomes a character-rig with rigKind = 'object'.

This is a nontrivial UI addition. Let me sketch the minimal viable version:

Users can mark up to N layers with a part field.

A new sidebar action "Build rig from selection" creates a character with rigKind = 'object' and those parts.

applyObjectRig reads character.settings.objectMotion (enum) and character.settings.amplitude, frequency.

That keeps the v3 face rig intact and adds a parallel path.

G. LLM raw-keyframe commands
Extend applyAgentCommands:

{ layerId, keyframes: [...] } — replace layer keyframes.

{ layerId, preset, params, start, duration } — schedule a preset.

{ role: 'effect', preset: 'flicker' } — apply to all layers with that role.

{ name: 'fireflies', preset: 'flicker' } — regex on name.

Server side: normalizeDirectorProposals must:

Validate keyframes array per command — clamp all values, cap length to 40, allow only known properties.

Resolve role/name group selectors to multiple layers, expand into per-layer commands.

Reject unknown properties.

buildWriterPrompt must be extended with the new command shapes and examples. E.g.:

text
COMMAND SHAPES (one command = one object):
  { "layerId": "L01", "preset": "sway", "params": {...} }
  { "layerId": "L01", "keyframes": [ {time, x, y, w, h, rotation, opacity, easing} ] }
  { "layerId": "L01", "preset": "fadeIn", "start": 2000 }
  { "role": "effect", "preset": "flicker" }
Also make sure the inventory includes role counts so the LLM can target by role.

What to change, file by file
_.js
Keyframe schema (normalizeKeyframes, makeLayer):

Add easing, hueRotate, saturate, brightness, blur, effectOpacity, clip.

Validate.

Interpolation (getLayerStateAtTime):

Apply easing.

Interpolate new channels (with fallback for missing values).

Interpolate clip primitives (snap on shape mismatch).

Apply (applyAnimationTime):

Apply CSS filter and clip-path on the image/DOM element.

effectOpacity multiplies img opacity.

Render (renderCanvas, renderInspector):

Add clip-path support to the initial render.

Add easing dropdown in the keyframe UI (optional but good).

Presets (applyPreset):

Emit easing per preset.

Add new presets: fadeOut, zoomIn, zoomOut, shake, spin, reveal, iris, glow, tint.

Export (loadExportAssets, renderExportFrame):

Pre-bake clip paths (only animated if shape is stable).

Apply ctx.filter = "hue-rotate(...) saturate(...)" per frame.

For animated clips, apply ctx.clip() inside the layer draw block.

Agent commands (applyAgentCommands):

Support keyframes, start, role, name.

Multi-character (syncRigReferenceVisibility, makeCharacterFieldset):

Wrap fieldsets in <details open> with a summary showing the character name.

Fix reference visibility.

Add "active character" state so tools focus on one.

Generic rig:

New methods: applyObjectRig, rigObjectsFromSelection.

character.rigKind in normalizeCharacters.

character.settings.objectMotion, objectAmplitude, objectFrequency.

Detection: extend detectCharacters (or add detectObjectRigs) to group layers by part when no character parts match.

A new sidebar action.

SVG export (exportSvg):

Support clip-path attributes.

Optionally bake animated states as SMIL (very cool but heavy).

Video/GIF — already use renderExportFrame, so they inherit the new features.

server.js
normalizeKeyframes (mirror client) — but the server doesn't currently do this. Actually server just stores what the client sends. But normalizeDirectorProposals validates presets. Add:

Validate easing, clip, effect channels on commands.

Support keyframes command shape.

Support role/name group selectors.

PRESET_PARAM_KEYS gains new presets.

buildWriterPrompt:

List available presets including new ones.

Show new command shapes.

Mention role/name grouping.

buildDirectorCatalog:

Include role counts.

Include which layers already have keyframes and a summary.

normalizeProposalCharacters:

Allow character settings like objectMotion for object rigs.

studio-v2.html
Sidebar actions: "Build rig from selection".

Inspector: per-character <details>.

Easing dropdown in the timeline controls (when a keyframe is selected).

New preset buttons in the preset grid (auto-populated from a shared list).

_.css
Styles for <details> character fieldsets.

Easing dropdown in the timeline.

Clip-path preview highlight (optional).

Presets list refactor
Currently the preset list is duplicated in several places. Extract to a single source of truth:

Client: window.LAYER_STUDIO_PRESETS = [...].

Server: mirror with PRESET_NAMES and PRESET_PARAM_KEYS.

Effort and risk
Let me be honest about scope.

Easy (1–2 days):

Nonlinear easing on keyframes + presets.

Fade out and a few new presets.

Multi-character UI polish + reference visibility fix.

LLM raw keyframes + role/name selectors (server-side).

studio-v2.html preset grid auto-generation.

Medium (3–5 days):

Effect channels (hue/saturate/brightness/blur/effectOpacity) with CSS filter + canvas ctx.filter in export. Testing across Chrome/Safari/Firefox matters.

Clip-path primitives: DOM clip + canvas clip + SVG export. Interpolation edge cases (shape mismatch).

Inspector UI for easing and clip.

Hard (1–2 weeks):

Generic object rigs: new motion generators, detection, UI, export pipeline.

Multi-character auto-detection from the ZIP (e.g., group layers by proximity into separate rigs).

Animated color (specifically recolor hex interpolation, not just hue shift) — needs per-channel color interpolation and canvas parity.

Risks:

CSS/SVG/canvas parity for filters and clip-paths.

Keyframe storage size: v3 characters already generate 200–380 keyframes per layer; adding 3D keyframes on every layer would bloat JSON. Mitigation: only store channels that actually change; use optional fields; the interpolation falls back to base values.

Performance: applying CSS filter + clip-path per frame is more expensive than left/top. But per-frame DOM writes are already done for x/y/w/h; adding filter and clipPath strings is a small bump. Batching via requestAnimationFrame is already present.

Suggested phased roadmap
Phase 1 — schema and easing (foundation):

Extend normalizeKeyframes with easing, clamp.

Update getLayerStateAtTime and applyAnimationTime.

Update presets to emit easing.

Add <select> for easing in inspector.

Update LLM writer prompt and applyAgentCommands for easing validation.

Phase 2 — visual channels:

Add hueRotate/saturate/brightness/blur/effectOpacity to keyframe schema.

DOM: img.style.filter = filterId + cssComposed.

Canvas: ctx.filter per frame.

New presets glow, tint.

Update director prompt and validation.

Phase 3 — clipping:

clip channel with inset|circle|polygon.

DOM: clip-path.

Canvas: ctx.clip.

New presets reveal, iris.

SVG: clip-path attribute.

Phase 4 — multi-character polish:

Inspector <details>.

Reference visibility rule.

"Active character" radio.

LLM prompt labels characters.

Phase 5 — raw-keyframe commands:

keyframes command shape.

start timing offsets.

role/name selectors.

Server-side validation + prompt extension.

Phase 6 — generic rigs:

rigKind.

applyObjectRig with sway, flap, wave, shimmer.

"Build rig from selection" action.

Inspector settings for object rigs.

Optionally: a couple of rig templates (bird, fish, tree).

Small illustrative code: easing
js
// _.js

const EASING_NAMES = [
    'linear', 'easeIn', 'easeOut', 'easeInOut',
    'backIn', 'backOut', 'backInOut',
    'elastic', 'bounce',
];

function easeValue(kind, t) {
    const k = String(kind || 'linear');
    if (k.startsWith('bezier:')) {
        const parts = k.slice(7).split(',').map(Number);
        if (parts.length === 4 && parts.every(Number.isFinite)) {
            return cubicBezier(parts[0], parts[1], parts[2], parts[3], t);
        }
        return t;
    }
    switch (k) {
        case 'easeIn':  return t * t;
        case 'easeOut': return 1 - (1 - t) * (1 - t);
        case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        case 'backOut': {
            const c1 = 1.70158, c3 = c1 + 1;
            return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        }
        case 'backIn': {
            const c1 = 1.70158, c3 = c1 + 1;
            return c3 * t * t * t - c1 * t * t;
        }
        case 'backInOut': {
            const c1 = 1.70158, c2 = c1 * 1.525;
            return t < 0.5
                ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
                : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
        }
        case 'elastic': {
            const c4 = (2 * Math.PI) / 3;
            if (t === 0 || t === 1) return t;
            return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
        }
        case 'bounce': {
            const n1 = 7.5625, d1 = 2.75;
            if (t < 1 / d1) return n1 * t * t;
            if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
            if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
            t -= 2.625 / d1;
            return n1 * t * t + 0.984375;
        }
        default: return t;
    }
}

function cubicBezier(x1, y1, x2, y2, t) {
    // Approximate using Newton's method.
    const sample = (a, b, u) => 3 * a * (1 - u) * (1 - u) * u + 3 * b * (1 - u) * u * u + u * u * u;
    const solve = (x) => {
        let u = x;
        for (let i = 0; i < 6; i += 1) {
            const dx = sample(x1, x2, u) - x;
            const d = 3 * x1 * (1 - u) * (1 - u) + 6 * (x2 - x1) * (1 - u) * u + 3 * (1 - x2) * u * u;
            if (Math.abs(dx) < 1e-4) break;
            u = Math.min(1, Math.max(0, u - dx / Math.max(1e-6, d)));
        }
        return u;
    };
    return sample(y1, y2, solve(t));
}
Then in getLayerStateAtTime:

js
const raw = (time - previous.time) / Math.max(1, next.time - previous.time);
const eased = easeValue(next.easing, raw);
ANIMATED_PROPERTIES.forEach((property) => {
    const a = previous[property] ?? layer[property];
    const b = next[property] ?? a;
    state[property] = a + (b - a) * eased;
});
Backward compatibility: missing easing → linear; missing property on a keyframe → inherit from layer's static value. This is important because v3 rigs emit every property per keyframe, but new effect channels will not.

For new channels specifically, the generator pattern is:

js
const all = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
// each channel falls back to the layer's static base value
Actually, to keep the schema lean, normalizeKeyframes should default missing visual channels to the layer's static values at save time. But that increases payload. Alternative: default to layer base at read time (in getLayerStateAtTime), which is what I wrote.

For presets that animate visuals:

js
glow: () => [
    kf(0,   { brightness: 1.0 }),
    kf(dur * 0.5, { brightness: 1.4, easing: 'easeInOut' }),
    kf(dur, { brightness: 1.0, easing: 'easeInOut' }),
],
But wait — kf in the current applyPreset builds a full keyframe object with all position fields. If brightness isn't in base, it needs to default from layer.brightness ?? 1. Let me think about the base defaults:

js
const base = {
    x, y, w, h, rotation, opacity,           // required
    hueRotate: 0, saturate: 1, brightness: 1, blur: 0,  // optional defaults
};
Add these to getLayerStateAtTime's fallback.

Clip-path sample
For SVG export, the <image> gets a clip-path="url(#...)" referencing a <clipPath> element that we build per layer:

svg
<clipPath id="clip-layer-id">
  <circle cx="150" cy="100" r="80" />
</clipPath>
For DOM, the div gets style.clipPath = 'circle(80px at 150px 100px)' — but our layers use percentage sizes, so we should use percentage clip:

js
style.clipPath = `circle(${r}% at ${cx}% ${cy}%)`;
style.clipPath = `inset(${t}% ${r}% ${b}% ${l}%)`;
style.clipPath = `polygon(${points.map(([x,y]) => `${x}% ${y}%`).join(', ')})`;
For canvas:

js
if (state.clip?.shape === 'circle') {
    const r = state.clip.r / 100 * Math.min(width, height);
    ctx.beginPath();
    ctx.arc(cx + width * state.clip.cx / 100, cy + height * state.clip.cy / 100, r, 0, Math.PI * 2);
    ctx.clip();
} else if (state.clip?.shape === 'inset') { /* ... */ }
else if (state.clip?.shape === 'polygon') { /* ... */ }
Object rig sketch
js
applyObjectRig(character) {
    const settings = character.settings;
    const duration = this.composition.duration;
    const parts = character.parts || {};
    const layers = this.characterLayersFor(character); // existing helper, but for object parts
    const motion = settings.objectMotion || 'sway';
    const amplitude = clamp(finite(settings.objectAmplitude, 0.4), 0, 2);
    const frequency = clamp(finite(settings.objectFrequency, 0.5), 0.1, 4);
    // For each layer in the rig, generate motion around its center or pivot.
    // Bone-based: each layer has `part` = e.g. 'wing-left', 'tail'.
    layers.forEach((layer) => {
        const part = layer.part || 'body';
        const pivot = this.pivotFor(layer, part);
        const rotation = this.motionValueFor(motion, part, frequency, duration, amplitude);
        layer.keyframes = rotation.map(({ time, value }) => {
            // rotate around pivot
            const angle = value * Math.PI / 180;
            const cx = layer.x + layer.w / 2;
            const cy = layer.y + layer.h / 2;
            const px = layer.x + layer.w * pivot[0] / 100;
            const py = layer.y + layer.h * pivot[1] / 100;
            const nx = px + (cx - px) * Math.cos(angle) - (cy - py) * Math.sin(angle);
            const ny = py + (cx - px) * Math.sin(angle) + (cy - py) * Math.cos(angle);
            return { time, x: nx - layer.w / 2, y: ny - layer.h / 2, w: layer.w, h: layer.h, rotation: value, opacity: layer.opacity };
        });
    });
}
motionValueFor returns [{time, value}] — angle samples. E.g. flap returns a sine on 'wing-*' parts (with opposite phase for left/right), sway on branch, etc.

The pivot can be inferred from the layer's part naming (e.g., a wing pivots at the body side). Or users specify character.settings.pivots = { 'wing-left': [100, 50] }.

Given the scope, this is genuinely a 1–2 week feature if done well. But it directly unlocks the "bird with wings" case.

Would I recommend all six?
Realistically:

1 (easing) — yes, cheap, high value. Do first.

2 (effect channels) — yes, medium cost, high value for magical effects (fireflies, glow, tint). Should focus on hueRotate/saturate/brightness rather than hex recolor interpolation.

3 (clip) — yes, medium, but a big payoff for reveals and spotlight effects.

4 (generic rig) — the highest-cost item; recommend scoping to a lightweight version: manual part assignment + a few named motions. Detection is overkill.

5 (multi-character) — mostly polish; the platform is already there. Recommend doing as a cleanup pass, not a redesign.

6 (LLM raw keyframes) — high value, low cost. The commands schema already normalizes everything; extending it to accept raw keyframes is a couple hundred lines on the server, plus a matching applyAgentCommands branch on the client, plus a prompt extension. Do this with phase 1.

The combined phase 1+2+3+6 covers most of the "expressive power" gap and is ~2 weeks of focused work. Phase 4 (generic rig) is the one true new subsystem — treat it as a separate milestone with its own design doc and tests.

Also worth mentioning: adding these features directly improves the LLM director. With easing, effect channels, clip channels, and raw keyframes, the writer prompt can describe much richer motion, and the LLM becomes genuinely creative rather than just picking preset names.

Let me go through each:

Nonlinear easing — getLayerStateAtTime in _.js:

js
const amount = (time - previous.time) / (next.time - previous.time);
ANIMATED_PROPERTIES.forEach((property) => {
  state[property] = previous[property] + (next[property] - previous[property]) * amount;
});
Trivially extendable: add an easing field per keyframe (or per segment), with a small library of cubic-bezier / step / ease-in-out functions. normalizeKeyframes needs to preserve it. The generators (applyPreset, applyCharacterAnimationV3) need to optionally set it. The getLayerStateAtTime becomes:

js
const raw = (time - prev.time) / (next.time - prev.time);
const amount = applyEasing(prev.easing || 'linear', raw);
Backwards compatible (missing easing = linear). This is a ~30 line change in _.js, plus a small easing table. The exporter and SVG writer both go through getLayerStateAtTime, so they auto-inherit. The character rig should be left alone (its non-uniform sampling is the source of the organic feel), but the presets could optionally use easing — breathe and pulse would benefit from easeInOutSine, fadeIn from easeOutCubic, walk from easeInOutQuad to avoid the robotic linear pan.

Also: presets could accept an easing param. Add it to PARAM_RULES? No — it's a string. Add a EASING_NAMES whitelist.

Animated color / opacity effects — Currently recolorColor and outlineColor are static per layer. To animate them:

Add to ANIMATED_PROPERTIES (or a parallel ANIMATED_COLOR_PROPERTIES): recolorColor, outlineColor, outlineWidth.

normalizeKeyframes needs to accept color fields (hex strings, not numbers). So the keyframe schema needs a parallel color timeline: recolorTimeline: [{time, color}] — cleaner than mixing types.

getLayerStateAtTime interpolates hex colors in RGB space (linear is fine, or use Oklab for perceptual).

layerEffectFilterMarkup becomes per-time — must be regenerated when the filter changes. In applyAnimationTime, we currently don't rebuild filters. Option A: use CSS custom properties on the layer element and let the SVG filter reference them via var(). Option B: re-generate the filter defs when the layer's color at currentTime changes. Option A is cheaper.

For SVG export: bake the color at currentTime OR emit SMIL <animate> elements. For PNG/MP4/GIF export: loadExportAssets must rasterize per keyframe — expensive. Better: implement color/outline in canvas directly at draw time in renderExportFrame (fill-and-composite for recolor, dilate-and-composite for outline) — this bypasses the need to preprocess per-keyframe images. Recolor is cheap: source-in fill on a temp canvas. Outline: dilateAlpha already exists; do it per-frame.

Actually the cleanest approach: keep loadExportAssets for static effects (unchanged), and when a layer has animated color/outline, use a per-frame canvas path. So the schema gains recolorTimeline/outlineTimeline and existing static fields stay for back-compat.

Animated masks / clipping — There is no mask layer type. To add:

New layer field: maskLayerId or mask: {layerId, mode: 'alpha' | 'luma', invert: boolean}. Or better: a clip field on any layer that references another layer's alpha as a CSS mask or SVG mask.

DOM renderer: SVG <clipPath> or CSS mask-image: url(data:) — CSS masks need alpha, so a separate mask layer as an <img> with mask-image: url(same) is the standard trick. Actually mask-image accepts a URL and uses alpha by default; luma needs mask-mode: luminance.

Export renderer: context.globalCompositeOperation = 'destination-in' after drawing the layer, drawing the mask image. For a group: use an offscreen canvas per masked layer.

LLM director: add a maskLayerId to the inventory and an applyMask command.

The auto-aligner already knows how to compare alpha; segmenting a mask from the reference is possible but out of scope.

A simpler MVP: group-level masks. A group field already exists on layers. Add a dedicated mask layer with role: 'mask' and a maskFor: <group>; the renderer composites that group into an offscreen buffer and applies the mask. This avoids a per-layer mask editor.

This is the most invasive of the six. Realistic scope: 1 new layer role, 1 new field, 3 renderer paths (DOM, SVG, canvas), 1 new preset vocabulary entry.

Rigging non-character objects — Currently detectCharacters uses CHARACTER_PART_KEYS regex. To generalize:

Rename to RIG_KEYS and add: wing-left, wing-right, tail, leg-left, leg-right, arm-left, arm-right, root.

Add a rig.type field: 'humanoid' | 'bird' | 'quadruped' | 'custom'. Default 'humanoid'.

Or: keep the part-name convention but make the driver generic. The current v3 driver bakes a very specific channel set (blink, gaze, viseme, breathe). For a bird, we want flap, tail-bob, head-tilt. So the driver itself needs to be data-driven.

Best design: channel presets. A rig defines channels: { flap: { parts: ['wing-left','wing-right'], motion: 'rotate', amount: [0, 35], pivot: 'shoulder' }, ... }. The current applyCharacterAnimationV3 becomes the humanoid channel preset; add bird, fish, quadruped, plant, flag, fire, water. Then updateCharacterSettings merges a channel-specific settings schema.

LLM: add rigPreset to the vocabulary.

This is a substantial refactor (~500 lines) but well-bounded. The Beards rig is proof that regex+geometry detection works; it just needs to be parameterized. The auto-detect heuristic can pick rig.type by sampling which part names exist (wings → bird, etc.).

MVP path: keep detection, add explicit rig.type to the bundle manifest (character.json in createCharacterImport — already read; just don't hard-require parts, allow rig object). Then applyCharacterAnimationV3 delegates to a channel dispatcher.

Multi-character scenes — The system already supports multiple characters in data (characters[] up to 12, normalizeProposalCharacters handles dedup, applyAgentCommands loops all characters). The blocker is UI:

renderCharactersInto renders all fieldset per character — that works.

But makeCharacterFieldset uses ids like character-1, character-2 — clicks route via dataset.characterId so selection works.

Problem: renderInspector only renders character fieldsets above the layer fields — so in a 3-character scene, all three fieldset blocks stack. That's fine but might be cramped.

Bigger problem: applyCharacterAnimationV3 calls syncRigReferenceVisibility — any applied v3 rig hides the reference. Fine.

Another: detectCharacters creates characters grouped by proximity, but addCharacter name-collides (Character, Character 2, …) — works.

Actually the real blocker is applyProposal — it applies to all characters in the proposal, so multi-character proposals work.

Testing gap: no multi-character demo. The fix is a character selector dropdown in the inspector and per-character collapsed sections. ~100 lines of UI.

Also: the LLM prompt's characterRules currently says "Use ONLY character ids from the character list" — works for multi. But buildDirectorCatalog excludes all character layer IDs from the layer catalog, so multi-character scenes can only animate characters via characters[]. Acceptable.

So multi-character is mostly done in the engine; it needs a UI pass and one demo. Lowest-effort of the six.

Truly arbitrary animation from the LLM — Two options:

A) Extend the preset vocabulary with more expressive generators. This is safe and cheap:

orbit — circular path around a point

shake — damped noise

flip — rotation 180° over time

zoom — w/h scale over time

fadeOut, blinkIn

swing — pendulum with gravity-impulse keyframes

hop — parabolic y + slight rotation

shrink — reverse pulse

shake/tremble

nod (rotation oscillation)

~10 new presets, each ~10 lines, added to PRESET_NAMES and PARAM_RULES. The LLM picks from a richer vocabulary without any new schema. This is the highest-ROI change.

B) Allow the LLM to emit raw keyframes. Add to the JSON schema:

json
{"commands": [
  {"layerId": "L05", "preset": "custom", "keyframes": [
    {"time": 0,   "x": 10, "y": 50, "rotation": -5, "easing": "easeInOutSine"},
    {"time": 500, "x": 30, "y": 40, "rotation":  5, "easing": "easeOutCubic"},
    {"time": 1000, "x": 10, "y": 50, "rotation": -5}
  ]}
]}
Enforce MAX_KEYFRAMES_PER_LAYER, monotonic time, animated properties only, clamped ranges. normalizeDirectorProposals needs a new branch. applyAgentCommands (_.js) needs to accept a keyframes array verbatim. The system prompt needs to explain the shape.

Recommendation: do A first (1–2 hours, big impact, no schema risk), then B (needs prompt engineering and a stricter validation layer, ~1 day). The safety principle in the current code — "the LLM must pick a preset" — is what stops hallucinated layer ids and out-of-range params; relaxing it needs per-field clamping to preserve that guarantee.

Let me also think about implementation order and cross-cutting concerns:

Migration/back-compat — All these features are additive. Missing fields default to current behavior. Existing composition.json files keep working.

Server-side validation — Every new field needs to be validated in server.js normalizeDirectorProposals / saveComposition to prevent a malicious or buggy client from writing 10M-character color strings or 5000 keyframes.

Export parity — Any new animation channel must land in DOM, canvas (renderExportFrame), GIF (through canvas), and SVG. The SVG writer is the thinnest — it currently doesn't emit keyframes at all, so animated SVG export is already a separate problem. That's a 7th "not possible" item worth mentioning.

Testing — tools/render-beards-preview.js and export-beards-animations.js are the test harness. Each feature should add a frame to a contact sheet.

Also worth calling out: getLayerStateAtTime returns a merged object with sprite info; adding easing is trivial but applyAnimationTime calls it once per layer per frame — 30 layers × 60 fps is fine, but the DOM path re-computes each frame. Adding easing is a pure function, no perf hit.

For animated color: the SVG filter uses <feFlood> — applyAnimationTime would need to update feFlood flood-color per frame. That's a DOM query per layer per frame; also fine at 30 layers.

For masks: mask-image on a <div> — but CSS masks on <img> are supported. On <div class="layer-item"> with an <img> child, the mask applies to the div. Fine. The reference layer must NOT be masked. Export: destination-in on a temp canvas.

Let me structure the answer:

Executive summary (what's cheap, what's deep)

Deep dive per wish: current state, design, files touched, LOC estimate, risk

Recommended order + milestone plan

Cross-cutting considerations (schema versioning, server validation, export parity, LLM safety)

A "what to do first" recipe

I should reference specific functions/files so the user knows the changes are concrete. Length: this is a substantial engineering doc, but I should be dense — no filler. Aim for ~1500-2000 words with tables and code snippets.