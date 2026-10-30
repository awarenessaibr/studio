#!/usr/bin/env node
'use strict';

/**
 * Place a baked character composition into a scene composition.
 *
 * The character project compositions (Giovannino / Omone) carry percent-based
 * layer rects and keyframes on a transparent character canvas. This tool
 * scales the whole character to a target height, positions it by centre-x and
 * bottom-y, offsets every keyframe the same way and merges the layers into the
 * scene. The result is a normal standalone composition with baked animation.
 *
 * Usage:
 *   node tools/place-character.js \
 *     --scene data/projects/Giovanni-Senza-Paura/compositions/scene-1-road-at-dusk.composition.json \
 *     --character data/projects/Giovannino/compositions/giovannino-walk.composition.json \
 *     --out /tmp/scene-1-with-giovannino.json \
 *     --height 26 --x 48 --bottom 78 --z 30 --prefix gio
 *
 * Options:
 *   --height   character height, percent of scene height (default 50)
 *   --x        horizontal centre, percent of scene width (default 50)
 *   --bottom   baseline, percent of scene height (default 90)
 *   --z        base z-index for the character layers (default 50)
 *   --prefix   id prefix (default derived from the character composition id)
 *   --replace  remove existing layers whose id starts with the prefix
 *   --no-keyframes  place the static base pose only
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);
const scenePath = value('--scene');
const characterPath = value('--character');
const outPath = value('--out');
if (!scenePath || !characterPath || !outPath) {
  console.error('usage: node tools/place-character.js --scene <scene.json> --character <clip.json> --out <out.json> [--height 50 --x 50 --bottom 90 --z 50 --prefix gio --replace]');
  process.exit(1);
}
const heightPct = Number(value('--height', '50'));
const centerXPct = Number(value('--x', '50'));
const bottomPct = Number(value('--bottom', '90'));
const baseZ = Number(value('--z', '50'));
const replace = has('--replace');
const keepKeyframes = !has('--no-keyframes');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const scene = readJson(scenePath);
const character = readJson(characterPath);
const cw = Number(character.width);
const ch = Number(character.height);
const sw = Number(scene.width);
const sh = Number(scene.height);
if (![cw, ch, sw, sh].every((n) => Number.isFinite(n) && n > 0)) {
  throw new Error('Both compositions need positive width/height values.');
}
if (!Array.isArray(character.layers) || !character.layers.length) {
  throw new Error('The character composition has no layers.');
}
if (!Array.isArray(scene.layers)) {
  throw new Error('The scene composition has no layers array.');
}

const prefix = value('--prefix', String(character.id || 'character').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'character');
const schema = /^[A-Za-z0-9_-]{1,80}$/;

// Character bounding box from the static rects.
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (const layer of character.layers) {
  const x = Number(layer.x);
  const y = Number(layer.y);
  const w = Number(layer.w);
  const h = Number(layer.h);
  if (![x, y, w, h].every(Number.isFinite)) continue;
  minX = Math.min(minX, x);
  minY = Math.min(minY, y);
  maxX = Math.max(maxX, x + w);
  maxY = Math.max(maxY, y + h);
}
if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error('Could not compute the character bbox.');
const charBBoxPx = {
  x: minX / 100 * cw,
  y: minY / 100 * ch,
  w: (maxX - minX) / 100 * cw,
  h: (maxY - minY) / 100 * ch,
};
const targetHeight = heightPct / 100 * sh;
const scale = targetHeight / charBBoxPx.h;
const targetCenterX = centerXPct / 100 * sw;
const targetBottom = bottomPct / 100 * sh;
const sourceCenterX = charBBoxPx.x + charBBoxPx.w / 2;
const sourceBottom = charBBoxPx.y + charBBoxPx.h;
const offsetX = targetCenterX - sourceCenterX * scale;
const offsetY = targetBottom - sourceBottom * scale;

const toScene = (xPct, yPct, wPct, hPct) => ({
  x: (xPct / 100 * cw * scale + offsetX) / sw * 100,
  y: (yPct / 100 * ch * scale + offsetY) / sh * 100,
  w: (wPct / 100 * cw * scale) / sw * 100,
  h: (hPct / 100 * ch * scale) / sh * 100,
});

let minZ = Infinity;
for (const layer of character.layers) minZ = Math.min(minZ, Number(layer.z) || 0);
const usedIds = new Set(scene.layers.map((l) => l.id));
if (replace) {
  scene.layers = scene.layers.filter((l) => !String(l.id).startsWith(prefix + '-'));
  usedIds.clear();
  scene.layers.forEach((l) => usedIds.add(l.id));
}

const newLayers = [];
for (const layer of character.layers) {
  if (!layer || !layer.url) continue;
  const rect = toScene(Number(layer.x), Number(layer.y), Number(layer.w), Number(layer.h));
  let id = `${prefix}-${layer.id}`.slice(0, 80);
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${prefix}-${layer.id}-${suffix}`.slice(0, 80);
    suffix += 1;
  }
  if (!schema.test(id)) throw new Error(`Could not build a valid layer id from ${layer.id}`);
  usedIds.add(id);
  const next = {
    ...layer,
    id,
    name: layer.name || layer.id,
    x: Number(rect.x.toFixed(4)),
    y: Number(rect.y.toFixed(4)),
    w: Number(rect.w.toFixed(4)),
    h: Number(rect.h.toFixed(4)),
    z: Number((baseZ + (Number(layer.z) || 0) - minZ).toFixed(3)),
    group: layer.group ? `${prefix}:${layer.group}` : prefix,
    keyframes: keepKeyframes
      ? (layer.keyframes || []).map((frame) => {
          const r = toScene(Number(frame.x), Number(frame.y), Number(frame.w), Number(frame.h));
          return {
            time: Math.round(Number(frame.time)),
            x: Number(r.x.toFixed(4)),
            y: Number(r.y.toFixed(4)),
            w: Number(r.w.toFixed(4)),
            h: Number(r.h.toFixed(4)),
            rotation: Number(frame.rotation) || 0,
            opacity: Number(frame.opacity) === undefined ? 1 : Number(frame.opacity),
          };
        })
      : [],
  };
  newLayers.push(next);
}

scene.layers.push(...newLayers);
if (scene.layers.length > 500) throw new Error(`The merged scene has ${scene.layers.length} layers (max 500).`);
scene.meta = scene.meta && typeof scene.meta === 'object' ? scene.meta : {};
scene.meta.placedCharacters = Array.isArray(scene.meta.placedCharacters) ? scene.meta.placedCharacters : [];
scene.meta.placedCharacters.push({
  prefix,
  character: character.meta?.character || character.name,
  clip: character.meta?.clip || character.id,
  source: path.relative(process.cwd(), characterPath).split(path.sep).join('/'),
  heightPct,
  centerXPct,
  bottomPct,
  baseZ,
  scale: Number(scale.toFixed(4)),
  layers: newLayers.length,
});
scene.meta.updatedAt = new Date().toISOString();

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(scene, null, 2) + '\n');
console.log(`Placed ${newLayers.length} layers from ${path.basename(characterPath)} into ${path.basename(scenePath)}.`);
console.log(`  scale ${scale.toFixed(4)}  target height ${heightPct}%  centre-x ${centerXPct}%  bottom ${bottomPct}%  z ${baseZ}+`);
console.log(`  wrote ${outPath} (${scene.layers.length} layers)`);
