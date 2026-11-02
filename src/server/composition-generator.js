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
 *       [--text "Headline copy"] [--locale en] [--out scene.composition.json]
 *
 * Or, from a brief (one row per creative — CSV or .xlsx):
 *
 *   node composition-generator.js <folder> "<Scene Name>" --brief rows.csv [--out-dir out]
 *   node composition-generator.js --brief rows.csv --template scene.composition.json
 *
 * Each row fills the template's variables and is written as its own
 * .composition.json, ready for the studio or a batch export.
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
// Argument validation happens in Main: brief mode needs no folder.

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
const Core = require('../shared/studio-core.js');

const briefPath = typeof flags.brief === 'string' ? flags.brief : '';
const templatePath = typeof flags.template === 'string' ? flags.template : '';
const outDir = typeof flags['out-dir'] === 'string' ? flags['out-dir'] : '';

const outId = (sceneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)) || 'scene';

function usage() {
    console.error('usage: node composition-generator.js <folder> "<Scene Name>" [options]');
    console.error('       node composition-generator.js --brief rows.csv --template scene.composition.json [--out-dir out]');
}

function readDataUrl(p) {
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
        : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
        : ext === '.gif' ? 'image/gif' : 'image/png';
    return `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
}

/** Walks the folder and assembles one scaffolded composition. */
function buildFromFolder() {
    const allFiles = walk(rootDir);
    if (!allFiles.length) {
        console.error('No images found in', rootDir);
        process.exit(1);
    }

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
        referenceFile = best ? best.file : null;
    }

    const refSize = referenceFile ? fileInfo.get(referenceFile) : null;
    const canvasWidth = parseInt(flags.width, 10) || (refSize ? refSize.width : 0) || 1080;
    const canvasHeight = parseInt(flags.height, 10) || (refSize ? refSize.height : 0) || 1080;
    const duration = parseInt(flags.duration, 10) || 10000;
    const locale = typeof flags.locale === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(flags.locale)
        ? flags.locale
        : 'en';
    const rand = makeRng(sceneName + '|' + canvasWidth + 'x' + canvasHeight);

    const groups = groupByStem(allFiles);
    const layers = [];
    let layerZ = 0;
    let idCounter = 0;

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
                z: (Z_BASE[role] === undefined ? 400 : Z_BASE[role]) + layerZ++,
                rotation: 0,
                fit: 'contain',
                visible: true,
                locked: !!isRef,
                positionConfirmed: !!isRef,
                keyframes: [],
            });
        } else {
            const refW = refSize ? refSize.width : canvasWidth;
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
                    z: (Z_BASE.prop === undefined ? 400 : Z_BASE.prop) + layerZ++,
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

    // Optional scaffolded headline layer (Phase 1 text support).
    if (flags.text) {
        const copy = typeof flags.text === 'string' ? flags.text : 'Your headline here';
        layers.push({
            id: `text-${(++idCounter).toString(36)}-headline`,
            type: 'text',
            name: 'Headline',
            role: 'foreground',
            text: copy,
            font: {
                family: 'Inter',
                weight: 700,
                style: 'normal',
                sizePct: 9,
                lineHeight: 1.15,
                letterSpacingEm: 0,
                transform: 'none',
            },
            color: '#111111',
            align: 'center',
            verticalAlign: 'middle',
            overflow: 'clip',
            x: 8, y: 62, w: 84, h: 16,
            opacity: 1,
            z: (Z_BASE.foreground === undefined ? 500 : Z_BASE.foreground) + layerZ++,
            rotation: 0,
            fit: 'contain',
            visible: true,
            locked: false,
            positionConfirmed: false,
            keyframes: [],
        });
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

    return {
        version: 3,
        id: outId,
        name: sceneName,
        width: canvasWidth,
        height: canvasHeight,
        duration,
        defaultLocale: locale,
        referenceLayerId,
        // Emitting the master format explicitly avoids a silent upgrade on load.
        formats: [{
            id: 'master',
            isMaster: true,
            channel: 'custom',
            label: 'Master',
            width: canvasWidth,
            height: canvasHeight,
            layerOverrides: {},
            variableValues: {},
        }],
        activeFormatId: 'master',
        variables: [],
        brandKit: null,
        characters: [],
        layers,
    };
}

/** `--template` wins; otherwise scaffold from the folder. */
function loadTemplate() {
    if (!templatePath) return buildFromFolder();
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    } catch (error) {
        console.error(`Could not read the template ${templatePath}: ${error.message}`);
        process.exit(1);
    }
    // Accept a bare composition or a wrapper such as { composition: … }.
    const composition = raw && typeof raw === 'object' && raw.composition ? raw.composition : raw;
    if (!composition || !Array.isArray(composition.layers)) {
        console.error(`Template ${templatePath} has no layers array.`);
        process.exit(1);
    }
    return composition;
}

function readBriefTable(file) {
    const buffer = fs.readFileSync(file);
    if (buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
        // Reuse the server's dependency-free XLSX reader.
        const { parseBriefFile } = require('../../server.js');
        return parseBriefFile(path.basename(file), buffer);
    }
    return Object.assign({ source: 'csv', sheet: null, sheets: [] }, Core.parseDelimitedTable(buffer.toString('utf8')));
}

function briefSlug(value, fallback) {
    const stem = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return stem || fallback;
}

function writeBrief() {
    if (!fs.existsSync(briefPath)) {
        console.error(`Brief not found: ${briefPath}`);
        process.exit(1);
    }
    const template = loadTemplate();
    if (!Array.isArray(template.variables) || !template.variables.length) {
        console.error('The template has no variables, so there is nothing for the brief to fill.');
        process.exit(1);
    }

    let brief;
    try {
        brief = readBriefTable(briefPath);
    } catch (error) {
        console.error(`Could not read the brief: ${error.message}`);
        process.exit(1);
    }
    if (!brief.headers.length) {
        console.error('The brief has no header row.');
        process.exit(1);
    }
    if (!brief.rows.length) {
        console.error('The brief has no data rows.');
        process.exit(1);
    }

    const mapping = Core.suggestBriefMapping(template, brief.headers);
    const unmapped = template.variables.filter((variable) => mapping[variable.id] === undefined);
    if (unmapped.length) {
        console.warn(`No column matched: ${unmapped.map((v) => v.name).join(', ')} (kept the template value).`);
    }
    if (!Object.keys(mapping).length) {
        console.error('No brief column matches a template variable. Rename a column to match (e.g. "Headline").');
        process.exit(1);
    }

    const dir = outDir || process.cwd();
    fs.mkdirSync(dir, { recursive: true });

    const written = [];
    let skipped = 0;
    brief.rows.forEach((row, index) => {
        const resolved = Core.resolveBriefRow(template, mapping, row);
        if (!resolved.ok) {
            skipped += 1;
            console.warn(`row ${index + 2} skipped: ${resolved.errors.map((e) => `${e.variable}: ${e.error}`).join('; ')}`);
            return;
        }
        const label = Core.briefRowLabel(row, brief.headers, mapping, index);
        const composition = Core.composeBriefRow(template, resolved.values, { label });
        const file = path.join(dir, `${briefSlug(label, `row-${index + 1}`)}.composition.json`);
        fs.writeFileSync(file, JSON.stringify(composition, null, 2));
        written.push({ file, label });
    });

    console.log(`✓ ${written.length} composition${written.length === 1 ? '' : 's'} from ${path.basename(briefPath)} (${String(brief.source).toUpperCase()})`);
    if (skipped) console.log(`  ${skipped} row${skipped === 1 ? '' : 's'} skipped`);
    console.log(`  template: ${templatePath || `scanned from ${path.basename(rootDir)}`}`);
    console.log(`  columns: ${brief.headers.join(' | ')}`);
    console.log(`  mapped: ${Object.keys(mapping).map((id) => {
        const variable = template.variables.find((item) => item.id === id);
        return `${variable ? variable.name : id} ← ${brief.headers[mapping[id]]}`;
    }).join(', ')}`);
    console.log(`  output: ${path.resolve(dir)}`);
    written.slice(0, 10).forEach((entry) => console.log(`    ${path.basename(entry.file)}  ← ${entry.label}`));
    if (written.length > 10) console.log(`    … and ${written.length - 10} more`);
    if (!written.length) process.exit(1);
}

function writeScaffold() {
    const composition = buildFromFolder();
    const outPath = flags.out || path.resolve(process.cwd(), `${composition.id}.composition.json`);
    fs.writeFileSync(outPath, JSON.stringify(composition, null, 2));

    // Text layers have no frames; the summary must not assume images.
    const spriteCount = composition.layers.filter((l) => Array.isArray(l.frames) && l.frames.length > 1).length;
    const charCount = composition.layers.filter((l) => ['character', 'character-part'].includes(l.role)).length;
    const textCount = composition.layers.filter((l) => l.type === 'text').length;
    console.log(`✓ ${path.basename(outPath)}`);
    console.log(`  ${composition.layers.length} layers (${spriteCount} sprite groups, ${charCount} character parts${textCount ? `, ${textCount} text` : ''})`);
    console.log(`  canvas ${composition.width}×${composition.height}, ${composition.duration} ms, locale ${composition.defaultLocale}`);
    console.log(`  reference: ${composition.referenceLayerId ? 'yes' : '(none)'}`);
}

if (!rootDir && !(briefPath && templatePath)) {
    usage();
    process.exit(1);
}
if (rootDir && !fs.existsSync(rootDir)) {
    usage();
    process.exit(1);
}

if (briefPath) writeBrief();
else writeScaffold();
