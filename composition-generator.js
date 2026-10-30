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
