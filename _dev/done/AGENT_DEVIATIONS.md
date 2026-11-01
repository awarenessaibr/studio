# AGENT_DEVIATIONS.md

This document records deviations, adjustments, and runtime observations encountered while implementing the tasks in `AGENT.md` based on `_dev/01-layers-implementation.md`.

---

## 1. Patches Applied to `_.js` (Sections 1–11)

All 11 sections in `_dev/01-layers-implementation.md` matched the anchor strings in `_.js` and applied cleanly:
- **§1 (`makeLayer`)**: Extended layer object with `role`, `frames`, `spriteFps`, and `spriteMode`.
- **§2 (`getLayerStateAtTime` & `_spriteState`)**: Added sprite frame index resolver and integrated with animated layer state.
- **§3 (`applyAnimationTime`)**: Added dynamic sprite frame swapping using `img.src` and `img.dataset.frame`.
- **§4 (`renderCanvas`)**: Set initial sprite frame at layer creation.
- **§5 (`renderInspector`)**: Added role dropdown, sprite FPS/mode controls, and the preset grid.
- **§6 (`applyInspectorValue`)**: Added handlers for `role`, `spriteFps`, and `spriteMode`.
- **§7 (`loadExportAssets`)**: Loaded all frames for sprite layers into memory for offline rendering.
- **§8 (`renderExportFrame`)**: Resolved current sprite frame during multi-frame export.
- **§9 (`applyPreset`)**: Added 10 animation presets (`breathe`, `idle`, `sway`, `walk`, `float`, `flicker`, `drift`, `pulse`, `fadeIn`, `parallax`, `none`).
- **§10 (`applyAgentCommands` & `exportAgentSpec`)**: Added agent animation command executor and agent specification exporter.
- **§11 (`onClick`)**: Wired `export-agent-spec` toolbar button.

### Minor Adjustment in §10 (`exportAgentSpec`)
- **What differed**: In the canonical spec, `exportAgentSpec()` builds `doc`, triggers `downloadFile(...)`, and updates status, but returns `undefined`.
- **Adjustment**: Added `return doc;` at the end of `exportAgentSpec()`.
- **Why**: Allows programmatic invocation (e.g. browser console, automated test runners, or API callers) to retrieve the exported specification object directly while still triggering the browser download.

---

## 2. `studio.html` Initial Class Initialization

- **What differed**: `studio.html` declared `<div id="layerStudioView" class="layer-view active" aria-label="Layer studio">`.
- **Issue**: `layerStudioShowView()` in `_.js` has an early-return guard: `if (!root || root.classList.contains('active')) return;`. Because the element was already marked with the `active` class in the static HTML, calling `layerStudioShowView()` on `DOMContentLoaded` exited immediately before constructing `studio = new LayerStudio(root)` and setting `window.layerStudio = studio`.
- **Resolution**: Updated `studio.html` to declare `<div id="layerStudioView" class="layer-view" aria-label="Layer studio">`. On `DOMContentLoaded`, `layerStudioShowView()` executes, initializes `window.layerStudio`, adds the `active` class, and renders the three-column studio UI.

---

## 3. Scene 1 / 1b Reference Image Dimensions

- **Observation**: `_dev/01-layers-implementation.md` instructed:
  `node composition-generator.js "data/layered-images/segments" "Scene 1 — Desert Woman" --reference atacama.png`
  In `data/layered-images/segments`, `atacama.png` is a 103×26 logo/crop rather than a full scene background.
- **Behavior**: The generator faithfully parsed `atacama.png` (103×26). When loaded into LayerStudio, reference alignment safely reports 0 aligned layers requiring manual review without throwing errors. Other scenes (scenes 3, 4, 5, 6, 8) use full image dimensions (e.g., 627×642, 795×583, 1564×323, 1568×670, 1280×591).

---

## 4. ZIP + final-image import and backend persistence (post-plan addition)

- **Request**: add an import flow that accepts a segments ZIP plus the final assembled image, aligns the segments, and saves the project in the backend.
- **Backend**: added `server.js`, a zero-dependency Node HTTP server. It serves the studio and stores imports under `data/imports/<project-id>/` (`source.zip`, `reference.*`, extracted `segments/`, `composition.json`). It parses ZIP central directories directly and supports `stored`/`deflate` entries; no npm packages were added.
- **Segment semantics**: the segmentation archives contain one distinct cut-out per numbered file (e.g. ten different flying swans), not animation frames. The importer therefore creates one layer per image rather than grouping numbered files into a sprite. The existing sprite controls remain available for compositions that already have multi-frame layers.
- **Reference z-order**: the reference layer is assigned `z: 0` and segments start at `z: 2`. An initial `z: -1000` put the reference behind the canvas's white background, making holes between cut-outs render white. Positive z keeps the final image visible beneath the aligned segments.
- **Alignment behavior for imports**: the import flow calls `alignToReference({ applyAmbiguous: true, confirmExact: true })`. Exact matches are marked confirmed; ambiguous matches use the best candidate and remain flagged for manual review instead of staying at their initial placement. The manual "Use as final image and align layers" button keeps the previous strict behavior.
- **Persistence**: after alignment the composition is saved automatically via `PUT /api/imports/:id/composition.json`; later edits autosave, and the explicit **Save project** button is enabled only for projects that exist in the backend.

---

## 5. Local vision LLM animation director (post-plan addition)

- **Request**: after importing/aligning a project, let an LLM with vision propose project-specific animations and populate them in the sidebar; support project context such as a book story.
- **Backend**: added a local Ollama pipeline to `server.js`. It uses `granite3.2-vision:2b` to analyze a downscaled copy of the project's final image, then `qwen3.5:9b` (thinking disabled) to produce four structured proposals.
- **Validation**: proposals are mapped through short aliases (`L01`…), filtered to real project layer IDs, restricted to the existing preset vocabulary, deduplicated per layer, and parameter-normalized per preset. Invalid output is retried once before failing.
- **Persistence**: context and selected models live in the composition `meta`; generated ideas live in `data/imports/<project-id>/proposals.json`. A context-only save uses `PUT /api/imports/:id/context`; generation uses `POST /api/imports/:id/proposals`.
- **UI**: added an Animation ideas panel (proposal cards, Apply/Reset, context preview), a director dialog (story context, vision/writing model selects), and autosave for context.
- **No new npm dependencies**: server-to-Ollama calls use native `fetch`; the app remains zero-build.

---

## 6. Character rigs (post-plan addition)

- **Request**: when characters are identified after import/alignment, show editable character settings in the right sidebar (blink, talk, move eyes, happy/sad, etc.), allow agents to edit them, and save them in the backend.
- **Detection**: `server.js` detects characters from layer names/geometry. Eye variants are deduplicated: the combined eye layer and separate pupil duplicates are listed in `character.hidden`, while the individual eye cutouts become the rig's eyes. `character.rigVersion = 2` lets existing projects re-detect once.
- **Model**: characters live in `composition.characters` with `parts`, `hidden`, `settings`, `applied`, and `coverLayerId`. Settings persist through the normal composition save.
- **Manual UI**: the Inspector now renders a Character fieldset for every detected character with expression buttons, blink/talk/wander/breathe toggles, gaze X/Y, fine controls, and Animate/Clear actions. Changes generate layer keyframes for the rig parts.
- **Ghosting fix**: a `rig-cover-*` face-base layer is generated client-side from the facial cutouts and the sampled skin color, filling the reference image's static eyes/brows/mouth with skin so animated features do not double-expose the reference. The cover is hidden from the layer list and toggled with `character.applied`.
- **Agents**: `exportAgentSpec()` now includes `characters` and `characterPresetVocabulary`; `applyAgentCommands()` accepts `{ characterId, preset }` or `{ characterId, settings }`. LLM proposals can include character settings, and the server validates/filters them.
