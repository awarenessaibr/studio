# Full implementation

Below is the complete set of patches, new methods, and the generator script. Every patch names the function to modify and the exact code to find/replace so you can apply them with confidence. Then the two remaining deliverables — the generator script and the agent prompt — are complete as-is.

---

## 1. Extend `makeLayer` — add `role`, `frames`, sprite fields

**FIND** the `makeLayer` function's return object and **REPLACE** it entirely with:

```js
function makeLayer(values, index) {
    const id = typeof values.id === 'string' && LAYER_ID.test(values.id)
        ? values.id
        : `layer-${Date.now().toString(36)}-${index.toString(36)}`;

    const rawUrl = typeof values.url === 'string' ? values.url : '';
    const validFrames = Array.isArray(values.frames)
        ? values.frames.filter((u) => typeof u === 'string' && safeImageUrl(u)).slice(0, 60)
        : [];
    const frames = validFrames.length ? validFrames : (rawUrl ? [rawUrl] : []);
    const url = frames[0] || rawUrl;

    const layer = {
        id,
        url,
        frames,
        spriteFps: clamp(finite(values.spriteFps, 8), 1, 30),
        spriteMode: ['loop', 'pingpong', 'once'].includes(values.spriteMode) ? values.spriteMode : 'loop',
        role: typeof values.role === 'string'
            && /^(background|midground|ground|foreground|character|character-part|prop|effect)$/.test(values.role)
            ? values.role : 'prop',
        name: (typeof values.name === 'string' ? values.name.trim().slice(0, 160) : '') || `Layer ${index + 1}`,
        x: clamp(finite(values.x, 20), -100, 200),
        y: clamp(finite(values.y, 20), -100, 200),
        w: clamp(finite(values.w, 60), 1, 300),
        h: clamp(finite(values.h, 60), 1, 300),
        opacity: clamp(finite(values.opacity, 1), 0, 1),
        recolorEnabled: values.recolorEnabled === true,
        recolorColor: HEX_COLOR.test(values.recolorColor) ? values.recolorColor.toLowerCase() : '#ffffff',
        outlineEnabled: values.outlineEnabled === true,
        outlineColor: HEX_COLOR.test(values.outlineColor) ? values.outlineColor.toLowerCase() : '#000000',
        outlineWidth: Math.round(clamp(finite(values.outlineWidth, 3), 1, 16)),
        z: clamp(finite(values.z, index), -1000, 1000),
        rotation: clamp(finite(values.rotation, 0), -3600, 3600),
        fit: values.fit === 'cover' ? 'cover' : 'contain',
        visible: values.visible !== false,
        locked: values.locked === true,
        positionConfirmed: values.positionConfirmed === true,
    };
    layer.keyframes = normalizeKeyframes(values.keyframes);
    return layer;
}
```

Because `normalizeComposition` calls `makeLayer` for every layer, imported JSON is automatically upgraded — you don't need to change `normalizeComposition`.

---

## 2. Add sprite resolver — patch `getLayerStateAtTime`

**FIND** the `getLayerStateAtTime` method and **REPLACE** it entirely:

```js
_spriteState(layer, time) {
    const frames = Array.isArray(layer.frames) && layer.frames.length ? layer.frames : [layer.url];
    if (frames.length <= 1) return { frameIndex: 0, frameUrl: frames[0] || layer.url };
    const fps = layer.spriteFps || 8;
    const tick = Math.floor((time / 1000) * fps);
    let frameIndex;
    if (layer.spriteMode === 'once') {
        frameIndex = Math.min(frames.length - 1, Math.max(0, tick));
    } else if (layer.spriteMode === 'pingpong') {
        const period = frames.length * 2 - 2;
        const p = ((tick % period) + period) % period;
        frameIndex = p < frames.length ? p : period - p;
    } else {
        frameIndex = ((tick % frames.length) + frames.length) % frames.length;
    }
    return { frameIndex, frameUrl: frames[frameIndex] };
}

getLayerStateAtTime(layer, time) {
    const frames = layer.keyframes || [];
    const sprite = this._spriteState(layer, time);
    if (!frames.length) return { ...layer, ...sprite };
    if (time <= frames[0].time) return { ...layer, ...frames[0], ...sprite };
    if (time >= frames[frames.length - 1].time) {
        return { ...layer, ...frames[frames.length - 1], ...sprite };
    }
    const nextIndex = frames.findIndex((frame) => frame.time >= time);
    const previous = frames[nextIndex - 1];
    const next = frames[nextIndex];
    const amount = (time - previous.time) / (next.time - previous.time);
    const state = { ...layer };
    ANIMATED_PROPERTIES.forEach((property) => {
        state[property] = previous[property] + (next[property] - previous[property]) * amount;
    });
    return { ...state, ...sprite };
}
```

---

## 3. Patch `applyAnimationTime` — swap sprite frame at runtime

**FIND** the `this.composition.layers.forEach((layer) => { ... })` block inside `applyAnimationTime` and **REPLACE** it with:

```js
this.composition.layers.forEach((layer) => {
    const node = nodes.get(layer.id);
    if (!node) return;
    const state = this.getLayerStateAtTime(layer, position);
    Object.assign(node.style, {
        left: `${state.x}%`,
        top: `${state.y}%`,
        width: `${state.w}%`,
        height: `${state.h}%`,
        opacity: String(state.opacity),
        transform: `rotate(${state.rotation}deg)`,
    });
    const img = node.querySelector('img');
    if (img && state.frameUrl && img.dataset.frame !== state.frameUrl) {
        img.src = state.frameUrl;
        img.dataset.frame = state.frameUrl;
    }
});
```

---

## 4. Patch `renderCanvas` — set initial sprite frame

**FIND** this block inside `renderCanvas`:

```js
const image = document.createElement('img');
image.src = layer.url;
image.alt = layer.name;
image.draggable = false;
```

**REPLACE WITH**:

```js
const image = document.createElement('img');
const initialState = this.getLayerStateAtTime(layer, this.animation.currentTime);
image.src = initialState.frameUrl || layer.url;
image.dataset.frame = image.src;
image.alt = layer.name;
image.draggable = false;
```

---

## 5. Patch `renderInspector` — role, sprite fields, preset grid

**FIND** this line in `renderInspector` (near the beginning, after the `nameField` line):

```js
this.el.inspector.appendChild(nameField);
```

**INSERT AFTER IT**:

```js
// --- Role ---
const roleField = document.createElement('label');
roleField.className = 'layer-field';
roleField.append(document.createTextNode('Role'));
const role = document.createElement('select');
role.dataset.prop = 'role';
[['background','Background'],['midground','Midground'],['ground','Ground'],
 ['foreground','Foreground'],['character','Character'],
 ['character-part','Character part'],['prop','Prop'],['effect','Effect']]
    .forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        role.appendChild(o);
    });
role.value = layer.role || 'prop';
roleField.appendChild(role);
this.el.inspector.appendChild(roleField);

// --- Sprite controls (only if multiple frames) ---
if (Array.isArray(layer.frames) && layer.frames.length > 1) {
    const info = document.createElement('p');
    info.className = 'layer-sprite-info';
    info.textContent = `Sprite · ${layer.frames.length} frame${layer.frames.length === 1 ? '' : 's'}`;
    this.el.inspector.appendChild(info);

    const fpsField = this.makeField('Sprite FPS', 'spriteFps', layer.spriteFps, 'number');
    fpsField.querySelector('input').min = '1';
    fpsField.querySelector('input').max = '30';
    fpsField.querySelector('input').step = '1';
    this.el.inspector.appendChild(fpsField);

    const modeField = document.createElement('label');
    modeField.className = 'layer-field';
    modeField.append(document.createTextNode('Sprite mode'));
    const mode = document.createElement('select');
    mode.dataset.prop = 'spriteMode';
    [['loop','Loop'],['pingpong','Ping-pong'],['once','Once']].forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        mode.appendChild(o);
    });
    mode.value = layer.spriteMode;
    modeField.appendChild(mode);
    this.el.inspector.appendChild(modeField);
}

// --- Preset grid ---
const presetsGroup = document.createElement('fieldset');
presetsGroup.className = 'layer-effect-group';
const presetsLegend = document.createElement('legend');
presetsLegend.textContent = 'Animation presets';
presetsGroup.appendChild(presetsLegend);
const presetsGrid = document.createElement('div');
presetsGrid.className = 'layer-preset-grid';
['breathe','idle','sway','walk','float','flicker','drift','pulse','fadeIn','parallax']
    .forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = name;
        btn.addEventListener('click', () => this.applyPreset(name));
        presetsGrid.appendChild(btn);
    });
presetsGroup.appendChild(presetsGrid);
this.el.inspector.appendChild(presetsGroup);
```

---

## 6. Patch `applyInspectorValue` — handle new fields

**FIND** this line inside `applyInspectorValue`:

```js
} else if (['recolorEnabled', 'outlineEnabled'].includes(property)) {
```

**INSERT BEFORE IT**:

```js
} else if (property === 'role') {
    if (/^(background|midground|ground|foreground|character|character-part|prop|effect)$/.test(input.value)) {
        layer.role = input.value;
    }
} else if (property === 'spriteFps') {
    const value = Number(input.value);
    if (Number.isFinite(value)) layer.spriteFps = clamp(value, 1, 30);
} else if (property === 'spriteMode') {
    if (['loop', 'pingpong', 'once'].includes(input.value)) layer.spriteMode = input.value;
```

Then **FIND** the last line of `applyInspectorValue`:

```js
if (property === 'name' || property === 'fit' || property === 'locked') this.renderInspector();
```

**REPLACE WITH**:

```js
if (['name','fit','locked','role','spriteFps','spriteMode'].includes(property)) this.renderInspector();
```

---

## 7. Patch `loadExportAssets` — load every sprite frame

**FIND** the entire `loadExportAssets` method and **REPLACE** it with:

```js
async loadExportAssets(composition, maxAssetEdge, outputEdge, totalPixelBudget) {
    const visible = composition.layers.filter((layer) => layer.visible);
    if (!visible.length) throw new Error('Show at least one layer before exporting.');
    const perLayerPixelBudget = Math.max(1, Math.floor(totalPixelBudget / visible.length));
    const assets = new Map();
    for (let index = 0; index < visible.length; index += 1) {
        const layer = visible[index];
        const frameUrls = Array.isArray(layer.frames) && layer.frames.length ? layer.frames : [layer.url];
        const loadedFrames = [];
        for (const frameUrl of frameUrls) {
            const image = await loadImage(frameUrl);
            if (!image.naturalWidth || !image.naturalHeight) {
                throw new Error(`Layer "${layer.name}" has no usable image dimensions.`);
            }
            if (!hasLayerEffects(layer)) {
                loadedFrames.push(image);
                continue;
            }
            const sourceWidth = image.naturalWidth;
            const sourceHeight = image.naturalHeight;
            const scale = Math.min(
                1,
                maxAssetEdge / Math.max(sourceWidth, sourceHeight),
                Math.sqrt(perLayerPixelBudget / (sourceWidth * sourceHeight)),
            );
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = width;
            sourceCanvas.height = height;
            const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
            if (!sourceContext) throw new Error('This browser could not create an image-processing canvas.');
            sourceContext.drawImage(image, 0, 0, width, height);
            let sourceData;
            try {
                sourceData = sourceContext.getImageData(0, 0, width, height);
            } catch (error) {
                throw new Error(`Layer "${layer.name}" cannot be processed because its image blocks canvas access: ${error.message}`);
            }
            if (layer.recolorEnabled) {
                const color = layer.recolorColor.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16));
                for (let offset = 0; offset < sourceData.data.length; offset += 4) {
                    if (sourceData.data[offset + 3] === 0) continue;
                    sourceData.data[offset] = color[0];
                    sourceData.data[offset + 1] = color[1];
                    sourceData.data[offset + 2] = color[2];
                }
                sourceContext.putImageData(sourceData, 0, 0);
            }
            if (!layer.outlineEnabled) {
                loadedFrames.push(sourceCanvas);
                continue;
            }
            const alpha = new Uint8Array(width * height);
            for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = sourceData.data[pixel * 4 + 3];
            const outputScale = outputEdge / Math.max(composition.width, composition.height);
            const displayedWidth = layer.w * composition.width / 100;
            const radius = clamp(Math.round(layer.outlineWidth * outputScale * width / displayedWidth), 1, 32);
            const expanded = dilateAlpha(alpha, width, height, radius);
            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = width;
            outputCanvas.height = height;
            const outputContext = outputCanvas.getContext('2d');
            if (!outputContext) throw new Error('This browser could not create the outline canvas.');
            const outlineData = outputContext.createImageData(width, height);
            const outlineColor = layer.outlineColor.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16));
            for (let pixel = 0; pixel < expanded.length; pixel += 1) {
                const offset = pixel * 4;
                outlineData.data[offset] = outlineColor[0];
                outlineData.data[offset + 1] = outlineColor[1];
                outlineData.data[offset + 2] = outlineColor[2];
                outlineData.data[offset + 3] = expanded[pixel];
            }
            outputContext.putImageData(outlineData, 0, 0);
            outputContext.drawImage(sourceCanvas, 0, 0);
            loadedFrames.push(outputCanvas);
        }
        assets.set(layer.id, loadedFrames.length === 1 ? loadedFrames[0] : loadedFrames);
        this.setExportProgress(`Preparing layer assets (${index + 1}/${visible.length})…`);
    }
    return assets;
}
```

---

## 8. Patch `renderExportFrame` — resolve sprite frame

**FIND** these lines inside `renderExportFrame`:

```js
const image = assets.get(layer.id);
if (!image) return;
const state = this.getLayerStateAtTime(layer, time);
```

**REPLACE WITH**:

```js
const asset = assets.get(layer.id);
if (!asset) return;
const state = this.getLayerStateAtTime(layer, time);
const image = Array.isArray(asset) ? (asset[state.frameIndex] || asset[0]) : asset;
if (!image) return;
```

---

## 9. Add `applyPreset` method

**INSERT** this method inside `class LayerStudio`, right after the closing brace of `applyInspectorValue`:

```js
applyPreset(presetName, params = {}) {
    const layer = this.getLayer(this.selectedLayerId);
    if (!layer) {
        this.setStatus('Select a layer before applying a preset.', true);
        return;
    }
    const dur = this.composition.duration;
    const base = this.getLayerStateAtTime(layer, 0);
    const kf = (time, over = {}) => ({
        time: Math.round(clamp(time, 0, dur)),
        x: clamp(over.x ?? base.x, -100, 200),
        y: clamp(over.y ?? base.y, -100, 200),
        w: clamp(over.w ?? base.w, 1, 300),
        h: clamp(over.h ?? base.h, 1, 300),
        rotation: clamp(over.rotation ?? base.rotation, -3600, 3600),
        opacity: clamp(over.opacity ?? base.opacity, 0, 1),
    });
    const amp  = finite(params.amplitude, 2);
    const tilt = finite(params.tilt, 3);

    const presets = {
        breathe: () => [
            kf(0),
            kf(dur * 0.5, { w: base.w * 1.02, h: base.h * 1.02 }),
            kf(dur),
        ],
        idle: () => [
            kf(0),
            kf(dur * 0.33, { y: base.y - 0.5, rotation: base.rotation + 0.4 }),
            kf(dur * 0.66, { y: base.y + 0.5, rotation: base.rotation - 0.4 }),
            kf(dur),
        ],
        sway: () => Array.from({ length: 9 }, (_, i) => {
            const t = (i / 8) * dur;
            const phase = (i / 8) * Math.PI * 2;
            return kf(t, {
                x: base.x + Math.sin(phase) * amp,
                rotation: base.rotation + Math.sin(phase) * tilt,
            });
        }),
        walk: () => {
            const startX = finite(params.startX, base.x);
            const endX   = finite(params.endX, 100 - base.w);
            return [
                kf(0,          { x: startX }),
                kf(dur * 0.25, { x: startX + (endX - startX) * 0.25, rotation: base.rotation - 1.5 }),
                kf(dur * 0.5,  { x: startX + (endX - startX) * 0.5 }),
                kf(dur * 0.75, { x: startX + (endX - startX) * 0.75, rotation: base.rotation + 1.5 }),
                kf(dur,        { x: endX }),
            ];
        },
        float: () => {
            const d = finite(params.distance, 2);
            return [
                kf(0),
                kf(dur * 0.25, { y: base.y - d }),
                kf(dur * 0.5,  { y: base.y }),
                kf(dur * 0.75, { y: base.y + d }),
                kf(dur,        { y: base.y }),
            ];
        },
        flicker: () => Array.from({ length: 12 }, (_, i) =>
            kf((i / 11) * dur, { opacity: 0.55 + Math.random() * 0.45 })),
        drift: () => [
            kf(0,   { x: base.x }),
            kf(dur, { x: base.x + finite(params.distance, 15) }),
        ],
        pulse: () => {
            const s = finite(params.scale, 1.06);
            return [
                kf(0),
                kf(dur * 0.5, { w: base.w * s, h: base.h * s }),
                kf(dur),
            ];
        },
        fadeIn: () => [
            kf(0, { opacity: 0 }),
            kf(Math.min(dur, 800), { opacity: base.opacity }),
            kf(dur, { opacity: base.opacity }),
        ],
        parallax: () => [
            kf(0,         { x: base.x - finite(params.distance, 4) }),
            kf(dur * 0.5, { x: base.x }),
            kf(dur,       { x: base.x + finite(params.distance, 4) }),
        ],
    };
    if (!presets[presetName]) {
        this.setStatus(`Unknown preset: ${presetName}`, true);
        return;
    }
    layer.keyframes = normalizeKeyframes(presets[presetName]());
    this.applyAnimationTime(0);
    this.setStatus(`Preset "${presetName}" applied to ${layer.name} (${layer.keyframes.length} keyframes).`);
}
```

---

## 10. Add `applyAgentCommands` + `exportAgentSpec` methods

**INSERT** both methods after `applyPreset`:

```js
applyAgentCommands(commands) {
    const list = Array.isArray(commands) ? commands : (commands?.commands || []);
    let applied = 0, skipped = 0;
    list.forEach((cmd) => {
        if (!cmd || typeof cmd !== 'object' || !cmd.layerId) { skipped++; return; }
        const layer = this.getLayer(cmd.layerId);
        if (!layer) { skipped++; return; }
        this.selectedLayerId = cmd.layerId;
        const preset = typeof cmd.preset === 'string' ? cmd.preset : 'none';
        if (preset === 'none') {
            layer.keyframes = [];
            applied++;
            return;
        }
        this.applyPreset(preset, cmd.params || {});
        applied++;
    });
    this.render();
    this.setStatus(`Applied ${applied} agent command(s)${skipped ? `; ${skipped} skipped` : ''}.`);
}

exportAgentSpec() {
    const doc = {
        schema: 'layer-studio/agent/v1',
        scene: {
            id: this.composition.id,
            name: this.composition.name,
            width: this.composition.width,
            height: this.composition.height,
            duration: this.composition.duration,
        },
        reference: this.composition.referenceLayerId,
        presetVocabulary: [
            'breathe','idle','sway','walk','float','flicker','drift',
            'pulse','fadeIn','parallax','none',
        ],
        layers: this.composition.layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            role: layer.role || 'prop',
            z: layer.z,
            box: {
                x: +(layer.x ?? 0).toFixed(2),
                y: +(layer.y ?? 0).toFixed(2),
                w: +(layer.w ?? 0).toFixed(2),
                h: +(layer.h ?? 0).toFixed(2),
            },
            rotation: +(layer.rotation || 0).toFixed(2),
            opacity: +(layer.opacity ?? 1).toFixed(2),
            sprite: Array.isArray(layer.frames) && layer.frames.length > 1
                ? { frames: layer.frames.length, fps: layer.spriteFps, mode: layer.spriteMode }
                : null,
            keyframes: (layer.keyframes || []).length,
        })),
    };
    downloadFile(
        safeFilename(`${this.composition.name}-agent`, 'json'),
        'application/json',
        JSON.stringify(doc, null, 2),
    );
    this.setStatus(`Agent spec exported (${doc.layers.length} layers).`);
}
```

---

## 11. Wire `export-agent-spec` into `onClick`

**FIND** this case in `onClick`:

```js
case 'export-json':
    this.exportJson();
    break;
```

**INSERT AFTER IT**:

```js
case 'export-agent-spec':
    this.exportAgentSpec();
    break;
```

And add a button to the HTML (near the existing "Export JSON" button — find `data-action="export-json"` and add a sibling):

```html
<button type="button" data-action="export-agent-spec">Export agent spec</button>
```

---

## 12. CSS additions

**APPEND** to `.layer-view` CSS:

```css
.layer-sprite-info {
    margin: 0;
    color: var(--ls-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}

.layer-preset-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
}

.layer-preset-grid button {
    min-height: 28px;
    padding: 4px 6px;
    border: 1px solid var(--ls-line-hi);
    border-radius: 5px;
    background: var(--ls-raised);
    color: var(--ls-text);
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
}

.layer-preset-grid button:hover {
    border-color: var(--ls-accent);
}

.layer-preset-grid button:focus-visible {
    outline: 2px solid var(--ls-accent);
    outline-offset: 2px;
}
```

---

## 13. `composition-generator.js` — full script

Save as `composition-generator.js` next to your `segments/` folders.

```js
#!/usr/bin/env node
/**
 * composition-generator.js
 *
 * Walks a folder of PNG/JPEG/GIF sprite cutouts, classifies each by filename,
 * groups numbered variants into sprite-frame sequences, and emits a
 * LayerStudio-compatible .composition.json ready to import.
 *
 * Usage:
 *   node composition-generator.js <folder> "<Scene Name>" \
 *       [--reference atacama.png] \
 *       [--width 1080] [--height 1080] [--duration 10000] \
 *       [--out scene.composition.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ─── CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
        else flags[key] = true;
    } else positional.push(a);
}
const rootDir = positional[0];
const sceneName = positional[1] || path.basename(rootDir || 'scene');
if (!rootDir || !fs.existsSync(rootDir)) {
    console.error('usage: node composition-generator.js <folder> "<Scene Name>" [options]');
    process.exit(1);
}

// ─── Image dimension parsing (pure Node) ──────────────────────────────
function readImageSize(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
    }
    if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
        let offset = 2;
        while (offset < buf.length - 8) {
            if (buf[offset] !== 0xFF) { offset++; continue; }
            const marker = buf[offset + 1];
            if (marker === 0xD8 || marker === 0xD9) { offset += 2; continue; }
            if (marker >= 0xD0 && marker <= 0xD7) { offset += 2; continue; }
            if (marker === 0x01) { offset += 2; continue; }
            const length = buf.readUInt16BE(offset + 2);
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5), format: 'jpeg' };
            }
            offset += 2 + length;
        }
    }
    if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: 'gif' };
    }
    return null;
}

// ─── File walking ─────────────────────────────────────────────────────
const IMAGE_EXT = /\.(png|jpe?g|gif)$/i;
function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else if (IMAGE_EXT.test(entry.name)) out.push(p);
    }
    return out.sort();
}

// ─── Role classification ──────────────────────────────────────────────
const ROLE_RULES = [
    [/^(sky|blue-sky|watercolor-sky|soft-clouds|clouds|misty-forest-background)$/i, 'background'],
    [/(mountain|hills|distant)/i, 'background'],
    [/(translucent.*figure|translucent.*woman|translucent.*man|woman-in-water|^fairy$|^fairy-\d|^mermaid$|^dwarf$|^old-man$|^boy$)/i, 'character'],
    [/(terrain|ground|cracked|sand(y)?|shore|floor|earth)/i, 'ground'],
    [/(hair|beard|dress|vest|shirt|pants|shorts|boots|feet|bikini|skirt|crown|collar|hat|jacket|wings)/i, 'character-part'],
    [/(translucent.*figure|woman|man|figure|fairy|dwarf|mermaid|boy)/i, 'character'],
    [/.*/, 'prop'],
];
function classify(name) {
    for (const [re, role] of ROLE_RULES) if (re.test(name)) return role;
    return 'prop';
}

// ─── Z-order by role ──────────────────────────────────────────────────
const Z_BASE = {
    background: 0,
    ground: 100,
    midground: 200,
    character: 300,
    'character-part': 310,
    prop: 400,
    foreground: 500,
    effect: 600,
};

// ─── Position heuristics ──────────────────────────────────────────────
function placementFor(role, name) {
    const n = (name || '').toLowerCase();
    if (role === 'background') {
        if (/sky/.test(n)) return { x: 0, y: 0, w: 100, h: 60 };
        if (/(mountain|hills|distant)/.test(n)) return { x: 0, y: 30, w: 100, h: 40 };
        return { x: 0, y: 0, w: 100, h: 100 };
    }
    if (role === 'ground') return { x: 0, y: 50, w: 100, h: 50 };
    if (role === 'character') return { x: 35, y: 25, w: 30, h: 55 };
    if (role === 'character-part') {
        if (/hair/.test(n))       return { x: 35, y: 22, w: 30, h: 30 };
        if (/beard/.test(n))      return { x: 42, y: 40, w: 16, h: 15 };
        if (/crown/.test(n))      return { x: 42, y: 20, w: 16, h: 8 };
        if (/wings/.test(n))      return { x: 32, y: 30, w: 36, h: 40 };
        if (/(dress|shirt|vest|jacket|top|skirt|bikini)/.test(n)) return { x: 35, y: 40, w: 30, h: 35 };
        if (/(pants|shorts)/.test(n)) return { x: 38, y: 55, w: 24, h: 20 };
        if (/(feet|boots)/.test(n))   return { x: 40, y: 75, w: 20, h: 10 };
        return { x: 35, y: 25, w: 30, h: 55 };
    }
    return null;
}

// ─── Deterministic PRNG ───────────────────────────────────────────────
function makeRng(seedStr) {
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) | 0;
    let s = Math.abs(h) || 1;
    return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; };
}

// ─── Frame grouping ───────────────────────────────────────────────────
function groupByStem(files) {
    const groups = new Map();
    for (const f of files) {
        const base = path.basename(f).replace(IMAGE_EXT, '');
        const m = base.match(/^(.*?)-(\d+)$/);
        const key = m ? m[1] : base;
        const num = m ? parseInt(m[2], 10) : 0;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ file: f, num });
    }
    for (const list of groups.values()) list.sort((a, b) => a.num - b.num);
    return groups;
}

// ─── Main ─────────────────────────────────────────────────────────────
const allFiles = walk(rootDir);
if (!allFiles.length) { console.error('No images found in', rootDir); process.exit(1); }

const fileInfo = new Map();
for (const f of allFiles) fileInfo.set(f, readImageSize(f) || { width: 512, height: 512 });

// Reference resolution
let referenceFile = null;
if (flags.reference) {
    const wanted = path.basename(flags.reference);
    referenceFile = allFiles.find((f) => path.basename(f) === wanted) || null;
    if (!referenceFile) console.warn(`Reference "${wanted}" not found.`);
}
if (!referenceFile) {
    referenceFile = allFiles.find((f) => /atacama|reference|assembled|final/i.test(path.basename(f))) || null;
}
if (!referenceFile) {
    let best = null;
    for (const f of allFiles) {
        const s = fileInfo.get(f);
        const area = s.width * s.height;
        if (!best || area > best.area) best = { file: f, area };
    }
    referenceFile = best?.file || null;
}

const refSize = referenceFile ? fileInfo.get(referenceFile) : null;
const canvasWidth  = parseInt(flags.width, 10)  || refSize?.width  || 1080;
const canvasHeight = parseInt(flags.height, 10) || refSize?.height || 1080;
const duration     = parseInt(flags.duration, 10) || 10000;
const rand = makeRng(sceneName + '|' + canvasWidth + 'x' + canvasHeight);

const groups = groupByStem(allFiles);
const layers = [];
let layerZ = 0;
let idCounter = 0;

function readDataUrl(p) {
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
        : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
        : ext === '.gif' ? 'image/gif' : 'image/png';
    return `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
}

for (const [stem, entries] of groups) {
    const role = classify(stem);
    const fileList = entries.map((e) => e.file);
    const urls = fileList.map(readDataUrl);

    // Sprite: 2–8 sequential frames, character or character-part
    const isSprite = fileList.length > 1 && fileList.length <= 8
        && (role === 'character' || role === 'character-part')
        && entries.every((e, i) => e.num === i + 1 || i === 0);

    // Scatter: 3+ files, prop-like, not sprite
    const isScatter = fileList.length > 1 && !isSprite
        && ['prop', 'character-part'].includes(role)
        && fileList.length >= 3;

    if (!isScatter) {
        const base = placementFor(role, stem) || { x: 20, y: 20, w: 60, h: 60 };
        const isRef = referenceFile && fileList[0] === referenceFile;
        const box = isRef ? { x: 0, y: 0, w: 100, h: 100 } : base;
        layers.push({
            id: `layer-${(++idCounter).toString(36)}-${(stem.replace(/[^a-z0-9]+/gi, '-') || 'x').slice(0, 40)}`,
            name: stem,
            role,
            url: urls[0],
            frames: urls,
            spriteFps: isSprite ? 8 : 1,
            spriteMode: isSprite ? 'loop' : 'once',
            x: box.x, y: box.y, w: box.w, h: box.h,
            opacity: 1,
            z: (Z_BASE[role] ?? 400) + layerZ++,
            rotation: 0,
            fit: 'contain',
            visible: true,
            locked: !!isRef,
            positionConfirmed: !!isRef,
            keyframes: [],
        });
    } else {
        const refW = refSize?.width || canvasWidth;
        for (const entry of entries) {
            const info = fileInfo.get(entry.file);
            const pxW = (info.width / refW) * 100;
            const pxH = (info.height / refW) * 100;
            const w = Math.max(2, Math.min(15, pxW));
            const h = Math.max(2, Math.min(20, pxH * (canvasWidth / canvasHeight)));
            const x = 5 + rand() * (95 - w);
            const y = 20 + rand() * (75 - h);
            const rot = +(rand() * 40 - 20).toFixed(1);
            layers.push({
                id: `layer-${(++idCounter).toString(36)}-${path.basename(entry.file).replace(IMAGE_EXT, '').replace(/[^a-z0-9]+/gi, '-')}`,
                name: path.basename(entry.file).replace(IMAGE_EXT, ''),
                role: 'prop',
                url: readDataUrl(entry.file),
                frames: [readDataUrl(entry.file)],
                spriteFps: 1,
                spriteMode: 'once',
                x: +x.toFixed(2), y: +y.toFixed(2),
                w: +w.toFixed(2), h: +h.toFixed(2),
                opacity: 1,
                z: (Z_BASE.prop ?? 400) + layerZ++,
                rotation: rot,
                fit: 'contain',
                visible: true,
                locked: false,
                positionConfirmed: false,
                keyframes: [],
            });
        }
    }
}

// Reference layer placement
let referenceLayerId = null;
if (referenceFile) {
    const refName = path.basename(referenceFile).replace(IMAGE_EXT, '');
    const refLayer = layers.find((l) => l.name === refName);
    if (refLayer) {
        Object.assign(refLayer, { x: 0, y: 0, w: 100, h: 100, locked: true, positionConfirmed: true });
        refLayer.z = Z_BASE.background;
        referenceLayerId = refLayer.id;
    }
}

// Normalize z
layers.sort((a, b) => a.z - b.z).forEach((l, i) => { l.z = i * 10; });

const outId = (sceneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)) || 'scene';
const composition = {
    version: 1,
    id: outId,
    name: sceneName,
    width: canvasWidth,
    height: canvasHeight,
    duration,
    referenceLayerId,
    layers,
};

const outPath = flags.out || path.resolve(process.cwd(), `${outId}.composition.json`);
fs.writeFileSync(outPath, JSON.stringify(composition, null, 2));

const spriteCount = layers.filter((l) => l.frames.length > 1).length;
const charCount = layers.filter((l) => ['character', 'character-part'].includes(l.role)).length;
console.log(`✓ ${path.basename(outPath)}`);
console.log(`  ${layers.length} layers (${spriteCount} sprite groups, ${charCount} character parts)`);
console.log(`  canvas ${canvasWidth}×${canvasHeight}, ${duration} ms`);
console.log(`  reference: ${referenceFile ? path.basename(referenceFile) : '(none)'}`);
```

Run for each scene:

```bash
node composition-generator.js segments       "Scene 1 - Desert Woman" --reference atacama.png
node composition-generator.js "segments (2)" "Scene 3 - Old Man Room"
node composition-generator.js "segments (3)" "Scene 4 - Fairy Forest"
node composition-generator.js "segments (4)" "Scene 5 - Castle"
node composition-generator.js "segments (5)" "Scene 6 - Lake"
node composition-generator.js "segments (6)" "Scene 1 - Desert Woman v2"
node composition-generator.js "segments (7)" "Scene 8 - Night Walk"
```

---

## 14. Agent prompt template

Save as `agent-prompt.md` and paste it into Claude along with the exported agent spec.

````markdown
You are an animation director for a LayerStudio scene.

You will receive:
1. A scene JSON with `"schema": "layer-studio/agent/v1"`.
2. A user task describing the desired animation.

Your job: emit a JSON command list that LayerStudio can apply.

### Scene JSON shape

{
  "schema": "layer-studio/agent/v1",
  "scene": { "width": 1080, "height": 1080, "duration": 10000 },
  "presetVocabulary": ["breathe","idle","sway","walk","float","flicker",
                       "drift","pulse","fadeIn","parallax","none"],
  "layers": [
    {
      "id": "layer-abc-long-hair",
      "name": "long-hair",
      "role": "character-part",
      "z": 320,
      "box": { "x": 35, "y": 22, "w": 30, "h": 30 },
      "rotation": 0,
      "opacity": 1,
      "sprite": { "frames": 2, "fps": 8, "mode": "loop" } | null,
      "keyframes": 0
    }
  ]
}

### Output shape

Return ONLY valid JSON — no prose, no markdown fences:

{
  "commands": [
    { "layerId": "layer-abc-...", "preset": "breathe" },
    { "layerId": "layer-def-...", "preset": "sway",
      "params": { "amplitude": 1.5, "tilt": 2 } }
  ]
}

### Preset reference

| preset    | intent                                                   |
|-----------|----------------------------------------------------------|
| breathe   | characters, faces — subtle scale pulse                   |
| idle      | characters — tiny idle drift                             |
| sway      | hair, foliage, banners — oscillation                     |
| walk      | characters — horizontal traversal across the canvas      |
| float     | particles, floating props — vertical bob                 |
| flicker   | lights, flames, magic — random opacity                   |
| drift     | clouds, slow background pan                              |
| pulse     | glowing props, hearts, beats                             |
| fadeIn    | entrances — opacity ramp                                 |
| parallax  | backgrounds — subtle oscillation around a centre point   |
| none      | explicit no-animation (clears keyframes)                 |

### Rules

- Reference layers by their exact `id`.
- Use `preset` from the vocabulary. Never emit raw keyframes.
- `character` → `breathe` or `idle`; use `walk` only if the task says
  walking/running.
- `character-part` (hair, dress, wings) → `sway` or `idle` with gentle
  params so parts don't detach from the character.
- `background` → `parallax` or `none`.
- `ground` → usually `none`.
- Sprites (`sprite != null`) play automatically — do NOT also assign
  them presets unless the user explicitly wants extra motion.
- Scattered props: pick 3–8 near the character's path and animate; leave
  the rest static to keep render cost low.
- For "fade in", use `fadeIn` on foreground layers only, not on backgrounds.
- Cap the command list at ~25 entries.