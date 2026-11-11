#!/usr/bin/env node
'use strict';

/**
 * Wire the Borders Web — Where I Work poster segmentation into the project.
 *
 * Source export (image-to-layers, a single whole-poster composition):
 *   images/borders-web-where-i-work-animated-02-segmented/
 *     <Group>/<NNN>-<part>.png
 *     borders-web-where-i-work-animated-02-segmented.json      (the editor composition)
 *     borders-web-where-i-work-animated-02-segmented-agent.json
 *     borders-web-where-i-work-animated-02-segmented-agent-snapshot-r0.json
 *     borders-web-where-i-work-animated-02-segmented.png       (composite, identical to poster.png)
 *     vincent-hovorka-…-composition.json                       (another project's export)
 *
 * Output:
 *   images/segmentation/
 *     index.json
 *     README.md
 *     poster-png/
 *       compositions/poster-png.composition.json
 *       layers.json
 *       scene.json
 *       images/<group>/<part>.png
 *   compositions/borders-web-where-i-work-animated-02.segmented.composition.json
 *
 * The master poster composition and the editable frame archive are never changed.
 * The segmented composition is a static, fully selectable decomposition of the
 * exact 6s poster; the original motion remains the source recording.
 *
 * Usage:
 *   node scripts/wire-borders-web-segmentation.js
 *   node scripts/wire-borders-web-segmentation.js --check
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const PROJECT_ID = 'borders-web-where-i-work-animated-02';
const PROJECT_DIR = path.join(ROOT, 'data', 'projects', PROJECT_ID);
const IMAGES_DIR = path.join(PROJECT_DIR, 'images');
const COMPOSITIONS_DIR = path.join(PROJECT_DIR, 'compositions');
const POSTER_FILE = path.join(IMAGES_DIR, 'poster.png');
const MASTER_FILE = path.join(COMPOSITIONS_DIR, `${PROJECT_ID}.composition.json`);
const SEGMENTED_ID = `${PROJECT_ID}-segmented`;
const SEGMENTED_FILE = path.join(COMPOSITIONS_DIR, `${SEGMENTED_ID}.composition.json`);
const SEGMENTATION_ROOT = path.join(IMAGES_DIR, 'segmentation');
const PACK_FOLDER = 'poster-png';
const PACK_DIR = path.join(SEGMENTATION_ROOT, PACK_FOLDER);
const PACK_IMAGES = path.join(PACK_DIR, 'images');
const SOURCE_DIR = path.join(IMAGES_DIR, `${PROJECT_ID}-segmented`);
const SOURCE_COMPOSITION = path.join(SOURCE_DIR, `${PROJECT_ID}-segmented.json`);
const ARCHIVE_DIR = path.join(SEGMENTATION_ROOT, '_source');
const INDEX_FILE = path.join(SEGMENTATION_ROOT, 'index.json');
const README_FILE = path.join(SEGMENTATION_ROOT, 'README.md');

const PARENT = { id: 'poster', name: 'Poster (6s)' };
const SCENE = {
    description: 'An illustrated survey map of the Scottish Borders in a parchment and ink style: sea and land, route lines, town marker dots and labels, small travel icons, the Kelso feature, a compass rose, the Borders Web header and the footer. The reference is the exact 6s poster frame of the animated page.',
    style: 'hand-drawn parchment map, ink survey, muted beige with red and blue accents',
};

// Semantic stack. The export's z was the order layers were added, which put the
// background above the labels. Parts are exact cut-outs, so the still image is
// identical in any order; this order is for animation (a moved part must not
// cover the labels or the header).
const GROUP_ORDER = [
    { group: 'Background', base: 10, parts: ['unassigned', 'sea-water', 'land-mass'] },
    { group: 'Map Details', base: 20, parts: ['road-network', 'river-tweed-line', 'small-loch'] },
    { group: 'Routes', base: 30, parts: ['route-lines-network'] },
    {
        group: 'Kelso',
        base: 40,
        parts: ['kelso-brown-buildings-cluster', 'kelso-building-illustration', 'kelso-central-dot', 'kelso-orange-marker-icon', 'kelso-label'],
    },
    { group: 'Markers', base: 50, parts: [] },
    { group: 'Labels', base: 60, parts: [] },
    { group: 'Icons', base: 70, parts: [] },
    { group: 'Compass', base: 80, parts: ['compass-rose', 'compass-needle', 'compass-north-label'] },
    {
        group: 'Header',
        base: 90,
        parts: ['borders-web-logo-square', 'borders-web-logo-w', 'borders-web-title', 'borders-web-red-dot', 'main-title-where-i-work', 'top-red-accent-line'],
    },
    { group: 'Footer', base: 100, parts: ['footer-text-line1', 'footer-text-line2'] },
];

const GROUP_DESCRIPTIONS = {
    Background: 'The land, sea and leftover pixels behind the map.',
    'Map Details': 'Roads, the River Tweed line and a small loch.',
    Routes: 'The blue route-line network across the map.',
    Kelso: 'The Kelso feature: building cluster, illustration, marker and label.',
    Markers: 'Marker dots for each town and place on the map.',
    Labels: 'Town and feature labels on the map.',
    Icons: 'Small travel icons: castle, airport, cars, bed and camping.',
    Compass: 'The compass rose, needle and north label.',
    Header: 'The Borders Web header and the Where I Work title.',
    Footer: 'The footer attribution lines.',
};

const GROUP_SLUG = {
    Background: 'background',
    'Map Details': 'map-details',
    Routes: 'routes',
    Kelso: 'kelso',
    Markers: 'markers',
    Labels: 'labels',
    Icons: 'icons',
    Compass: 'compass',
    Header: 'header',
    Footer: 'footer',
};

const ROLE_BY_GROUP = {
    Background: 'background',
    'Map Details': 'prop',
    Routes: 'prop',
    Kelso: 'prop',
    Markers: 'prop',
    Labels: 'prop',
    Icons: 'prop',
    Compass: 'prop',
    Header: 'foreground',
    Footer: 'foreground',
};

const CHECK = process.argv.includes('--check');

/* ── helpers ─────────────────────────────────────────────────────── */

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

function writeJson(file, value) {
    if (CHECK) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(file, value) {
    if (CHECK) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, 'utf8');
}

function slug(value, max = 90) {
    return String(value || 'part')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, max);
}

function titleCase(value) {
    return String(value || '')
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function labelFor(name) {
    if (name === 'unassigned') return 'Unassigned Pixels';
    if (name === 'footer-text-line1') return 'Footer Text Line 1';
    if (name === 'footer-text-line2') return 'Footer Text Line 2';
    return titleCase(name);
}

function descriptionFor(name, group, label) {
    if (name === 'unassigned') return 'Leftover poster pixels that did not match a semantic object.';
    switch (group) {
        case 'Markers': return `Marker dot for ${label.replace(/ Dot$/, '')}.`;
        case 'Labels': return `Map label for ${label.replace(/ Label$/, '')}.`;
        case 'Icons': return `Map icon: ${label.replace(/ (Icon|Pin|Plane)$/, '')}.`;
        case 'Background': return `Backdrop cut-out: ${label}.`;
        case 'Map Details': return `Map detail: ${label}.`;
        case 'Routes': return 'The route-line network drawn across the map.';
        case 'Compass': return `Compass part: ${label}.`;
        case 'Kelso': return `Kelso feature: ${label.replace(/^Kelso /, '')}.`;
        case 'Header': return `Header artwork: ${label}.`;
        case 'Footer': return `Footer artwork: ${label}.`;
        default: return `${label} — a ${group.toLowerCase()} cut-out of the 6s poster.`;
    }
}

function pngSize(file) {
    const buffer = fs.readFileSync(file);
    if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) {
        throw new Error(`Not a PNG: ${file}`);
    }
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function moveFile(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.renameSync(from, to);
    } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
    }
}

function canonicalGroup(value) {
    const wanted = slug(value);
    const match = GROUP_ORDER.find((entry) => slug(entry.group) === wanted);
    return match ? match.group : String(value || '').trim();
}

/* ── ingest the export ───────────────────────────────────────────── */

function filesIn(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...filesIn(target));
        else out.push(target);
    }
    return out;
}

function ingestExport() {
    if (!fs.existsSync(SOURCE_COMPOSITION)) return null;
    const exportComposition = readJson(SOURCE_COMPOSITION);
    const exportLayers = (exportComposition.layers || []).filter((layer) => layer.id !== 'reference');
    const allFiles = filesIn(SOURCE_DIR).filter((file) => file.toLowerCase().endsWith('.png'));
    // Exclude the composite preview; it is verified separately.
    const partFiles = allFiles.filter((file) => path.basename(file) !== `${PROJECT_ID}-segmented.png`);
    const byName = new Map();
    for (const file of partFiles) {
        const name = path.basename(file).replace(/^\d+-/, '').replace(/\.png$/i, '');
        if (byName.has(name)) throw new Error(`Duplicate part file for ${name}: ${byName.get(name)} and ${file}`);
        byName.set(name, file);
    }

    const parts = [];
    const problems = [];
    for (const layer of exportLayers) {
        const file = byName.get(layer.name);
        if (!file) { problems.push(`No file for layer ${layer.name}`); continue; }
        byName.delete(layer.name);
        const size = pngSize(file);
        const local = {
            x: round(clamp(Number(layer.x ?? 0), 0, 100)),
            y: round(clamp(Number(layer.y ?? 0), 0, 100)),
            w: round(clamp(Number(layer.w ?? 0), 0, 100)),
            h: round(clamp(Number(layer.h ?? 0), 0, 100)),
        };
        if (!(local.w > 0 && local.h > 0)) { problems.push(`Invalid box for ${layer.name}`); continue; }
        const boxAspect = (local.w / local.h) * (exportComposition.width / exportComposition.height);
        const pngAspect = size.width / size.height;
        if (Math.abs(boxAspect - pngAspect) / pngAspect > 0.02) {
            problems.push(`Aspect mismatch for ${layer.name}: box ${boxAspect.toFixed(3)} vs png ${pngAspect.toFixed(3)}`);
        }
        const group = canonicalGroup(layer.segmentGroup || 'Segments');
        parts.push({
            name: layer.name,
            group,
            sourceZ: Number(layer.z) || 0,
            sourceRole: layer.role || ROLE_BY_GROUP[group] || 'prop',
            sourceFile: path.basename(file),
            local,
            pixel: {
                x: Math.round(local.x / 100 * exportComposition.width),
                y: Math.round(local.y / 100 * exportComposition.height),
                w: Math.round(local.w / 100 * exportComposition.width),
                h: Math.round(local.h / 100 * exportComposition.height),
            },
            png: size,
            sourcePath: file,
        });
    }
    for (const [name, file] of byName) problems.push(`No layer for file ${path.basename(file)} (${name})`);
    if (problems.length) throw new Error(`The segmentation export has problems:\n- ${problems.join('\n- ')}`);

    return {
        composition: exportComposition,
        parts,
        composite: path.join(SOURCE_DIR, `${PROJECT_ID}-segmented.png`),
    };
}

/* ── resolve the pack (fresh ingest or an existing pack) ─────────── */

function packParts() {
    const layersFile = path.join(PACK_DIR, 'layers.json');
    if (!fs.existsSync(layersFile)) return null;
    const doc = readJson(layersFile);
    return (doc.layers || []).map((layer) => {
        const file = path.join(PACK_DIR, layer.file);
        if (!fs.existsSync(file)) throw new Error(`Missing pack image: ${layer.file}`);
        const size = pngSize(file);
        return {
            name: layer.name,
            group: layer.group,
            sourceZ: Number(layer.sourceZ ?? layer.z) || 0,
            sourceRole: layer.role,
            sourceFile: layer.sourceFile || layer.file.split('/').pop(),
            local: layer.localBox,
            pixel: layer.bbox,
            png: size,
            sourcePath: file,
            packFile: layer.file,
        };
    });
}

function canonicalParts(rawParts) {
    const present = new Set(rawParts.map((part) => part.group));
    const unknown = [...present].filter((group) => !GROUP_ORDER.some((entry) => entry.group === group));
    if (unknown.length) throw new Error(`Unknown segmentation groups: ${unknown.join(', ')}`);

    const byName = new Map(rawParts.map((part) => [part.name, part]));
    const ordered = [];
    for (const entry of GROUP_ORDER) {
        const explicit = entry.parts.length
            ? entry.parts.map((name) => {
                const part = byName.get(name);
                if (!part) throw new Error(`Missing ${name} in group ${entry.group}`);
                return part;
            })
            : rawParts.filter((part) => part.group === entry.group).sort((a, b) => a.sourceZ - b.sourceZ);
        for (const part of explicit) byName.delete(part.name);
        explicit.forEach((part, index) => {
            ordered.push({ ...part, group: entry.group, z: round(entry.base + (index + 1) / 100, 3) });
        });
    }
    if (byName.size) throw new Error(`Unplaced parts: ${[...byName.keys()].join(', ')}`);

    return ordered.map((part) => {
        const groupSlug = GROUP_SLUG[part.group];
        const label = labelFor(part.name);
        const description = descriptionFor(part.name, part.group, label);
        const id = `${PARENT.id}--seg-layer-${groupSlug}-${slug(part.name)}`;
        const groupId = `${PARENT.id}--group-${groupSlug}`;
        const packFile = `images/${groupSlug}/${slug(part.name)}.png`;
        const url = `/data/projects/${PROJECT_ID}/images/segmentation/${PACK_FOLDER}/${packFile}`;
        return {
            ...part,
            label,
            description,
            groupSlug,
            groupId,
            id,
            segmentGroup: `${PARENT.name} / ${part.group}`,
            role: ROLE_BY_GROUP[part.group] || part.sourceRole || 'prop',
            packFile,
            url,
        };
    });
}

/* ── composition builders ────────────────────────────────────────── */

function keyframesFor(part, duration) {
    return [0, duration].map((time) => ({
        time,
        x: part.local.x,
        y: part.local.y,
        w: part.local.w,
        h: part.local.h,
        rotation: 0,
        opacity: 1,
        easing: 'linear',
    }));
}

function childLayer(part, duration) {
    return {
        id: part.id,
        parentId: PARENT.id,
        groupId: part.groupId,
        type: 'image',
        name: `${PARENT.name} · ${part.label}`,
        role: part.role,
        z: part.z,
        x: part.local.x,
        y: part.local.y,
        w: part.local.w,
        h: part.local.h,
        rotation: 0,
        opacity: 1,
        url: part.url,
        fit: 'fill',
        visible: true,
        locked: false,
        segmentGroup: part.segmentGroup,
        keyframes: keyframesFor(part, duration),
        source: {
            type: 'image-to-layers',
            parent: PARENT.id,
            segmentation: {
                folder: PACK_FOLDER,
                composition: `images/segmentation/${PACK_FOLDER}/compositions/${PACK_FOLDER}.composition.json`,
                object: part.name,
                sourceFile: part.sourceFile,
            },
        },
        meta: {
            segmentation: {
                parentLayerId: PARENT.id,
                parentName: PARENT.name,
                parentUrl: `/data/projects/${PROJECT_ID}/images/poster.png`,
                parentRole: 'background',
                parentFit: 'fill',
                sourceFolder: PACK_FOLDER,
                sourceImage: 'poster.png',
                sourceWidth: 944,
                sourceHeight: 1130,
                sourceComposition: `images/segmentation/${PACK_FOLDER}/compositions/${PACK_FOLDER}.composition.json`,
                objectName: part.name,
                objectLabel: part.label,
                objectDescription: part.description,
                objectGroup: part.group,
                objectRole: part.role,
                bbox: part.pixel,
                localBox: part.local,
                sourceZ: part.sourceZ,
                sourceVisible: true,
                sourceFile: part.sourceFile,
                sceneDescription: SCENE.description,
                sceneStyle: SCENE.style,
                coordinateSpace: 'percent of the 944×1130 poster; the poster is the full canvas, so the local box is the composition box',
                inheritedKeyframes: 2,
            },
        },
    };
}

function groupsFor(parts) {
    const groups = new Map();
    for (const part of parts) {
        const group = groups.get(part.groupId) || {
            id: part.groupId,
            label: part.segmentGroup,
            shortLabel: part.group,
            parentLayerId: PARENT.id,
            parentName: PARENT.name,
            sourceFolder: PACK_FOLDER,
            description: GROUP_DESCRIPTIONS[part.group] || '',
            objectCount: 0,
            parts: [],
        };
        group.objectCount += 1;
        group.parts.push({
            id: part.id,
            name: `${PARENT.name} · ${part.label}`,
            label: part.label,
            description: part.description,
            role: part.role,
            bbox: part.local,
            z: part.z,
            url: part.url,
        });
        groups.set(part.groupId, group);
    }
    return [...groups.values()].map((group) => {
        const xs = group.parts.map((part) => part.bbox.x);
        const ys = group.parts.map((part) => part.bbox.y);
        const x1 = group.parts.map((part) => part.bbox.x + part.bbox.w);
        const y1 = group.parts.map((part) => part.bbox.y + part.bbox.h);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return {
            ...group,
            box: {
                x: round(x, 2),
                y: round(y, 2),
                w: round(Math.max(...x1) - x, 2),
                h: round(Math.max(...y1) - y, 2),
            },
        };
    });
}

function compositionMeta() {
    return {
        brandName: 'Borders Web',
        htmlSource: 'data/library/sources/html/borders-web-where-i-work-animated.fixed.html',
        posterTime: 6,
        exactPoster: false,
        derivedFrom: `compositions/${PROJECT_ID}.composition.json`,
        editableArchive: `compositions/${PROJECT_ID}.editable.json`,
        referencePoster: `/data/projects/${PROJECT_ID}/images/poster.png`,
    };
}

function agentAwareness(groups) {
    return {
        summary: `The 6s poster is decomposed into ${groups.reduce((n, group) => n + group.objectCount, 0)} exact cut-out parts in ${groups.length} semantic groups. The parts reproduce the poster pixel-for-pixel.`,
        groups: groups.map((group) => ({
            id: group.id,
            label: group.label,
            parts: group.objectCount,
            description: group.description,
        })),
        howItWorks: [
            'Select a semantic group to move it as one unit, or a single part for detail.',
            'This composition is static from 0 to 12s; the original motion is the source recording.',
            'Background parts are at the bottom of the stack and the header/footer on top, so a moved part never hides the labels.',
            'Every box is in percent of the 944×1130 poster, which is the full canvas.',
        ],
        instructions: [
            'Use the labels exactly as written: "the Hawick label", "the Kelso building", "the compass needle", "the footer line 1".',
            'Do not reorder the Background, Header or Footer groups before animating; the current order is deliberate.',
        ],
        queryHints: ['town markers', 'town labels', 'travel icons', 'route lines', 'compass', 'header', 'footer', 'Kelso'],
    };
}

function segmentationMeta(groups, parts) {
    return {
        schema: 'studio/image-segmentation/1',
        method: 'image-to-layers',
        parent: {
            id: PARENT.id,
            name: PARENT.name,
            role: 'background',
            z: 0,
            fit: 'fill',
            box: { x: 0, y: 0, w: 100, h: 100 },
            url: `/data/projects/${PROJECT_ID}/images/poster.png`,
            sourceWidth: 944,
            sourceHeight: 1130,
            keyframes: 2,
        },
        parents: [{
            parentLayerId: PARENT.id,
            parentName: PARENT.name,
            parentRole: 'background',
            parentZ: 0,
            parentFit: 'fill',
            parentKeyframes: 2,
            folder: PACK_FOLDER,
            segmentationComposition: `images/segmentation/${PACK_FOLDER}/compositions/${PACK_FOLDER}.composition.json`,
            sourceImage: 'poster.png',
            sourceWidth: 944,
            sourceHeight: 1130,
            description: SCENE.description,
            style: SCENE.style,
            sceneObjects: parts.length,
            groups: [...new Set(parts.map((part) => part.group))],
            childCount: parts.length,
        }],
        groups: groups.map((group) => ({
            id: group.id,
            label: group.label,
            parentLayerId: PARENT.id,
            members: group.parts.map((part) => part.id),
            objectCount: group.objectCount,
            box: group.box,
        })),
        counts: { segmentedParents: 1, childLayers: parts.length, groups: groups.length, skippedParents: 0 },
        mapping: {
            sourceSpace: 'percent of the 944×1130 poster',
            rule: 'the poster is the full canvas, so child box = local segmentation box; every child holds the same box for the whole 12s',
            zOrder: GROUP_ORDER.map((entry) => `${entry.group} ${entry.base}+`).join(' → '),
        },
        reference: `/data/projects/${PROJECT_ID}/images/poster.png`,
        indexFile: 'images/segmentation/index.json',
        corrections: [
            'Repaired every URL: the export pointed at /data/projects/borders-web-where-i-work-animated-02-segmented/ with numbered, case-sensitive file names that did not exist.',
            'Canonicalised the assets to images/segmentation/poster-png/images/<group>/<part>.png and stripped the export numeric prefixes.',
            'Recomputed z: the export had the background (z 41–56) above the town labels (z ≤ 40); the new order is Background → Map Details → Routes → Kelso → Markers → Labels → Icons → Compass → Header → Footer.',
            'Set the project duration (12000) instead of the export\'s 3000.',
            'Pointed the reference at the project poster.png (the export reference was missing).',
            'Added parentId, groupId, segmentGroup and meta.segmentation to every child.',
            'Normalised the group label "Map details" to "Map Details".',
            'Kept the artwork spelling "Kaitleast" (the label image reads Kaitleast; an earlier 55-layer export used Kaitleat).',
            'Archived the redundant editor/agent/snapshot exports under images/segmentation/_source; the editor composite PNG is pixel-identical to poster.png (PNG bytes differ) and is kept there only as provenance.',
        ],
    };
}

function buildPackComposition(parts, groups, duration) {
    return {
        version: 1,
        id: PACK_FOLDER,
        name: 'Borders Web · Where I Work — poster segmentation pack',
        width: 944,
        height: 1130,
        duration,
        defaultLocale: 'en',
        activeLocale: null,
        referenceLayerId: 'reference',
        characters: [],
        formats: [{
            id: 'master', isMaster: true, channel: 'social', label: 'Master',
            width: 944, height: 1130, layerOverrides: {}, variableValues: {},
        }],
        activeFormatId: 'master',
        variables: [],
        brandKit: null,
        brandKitId: null,
        guardrails: { enabled: false, block: false },
        showSafeZones: true,
        revision: 0,
        meta: {
            source: 'image-to-layers',
            schema: 'studio/composition/1',
            projectId: PROJECT_ID,
            parent: PARENT,
            scene: SCENE,
            counts: { childLayers: parts.length, groups: groups.length },
        },
        layers: [
            {
                id: 'reference',
                type: 'image',
                name: 'Final image',
                role: 'background',
                z: 0,
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                rotation: 0,
                opacity: 1,
                url: `/data/projects/${PROJECT_ID}/images/poster.png`,
                fit: 'fill',
                visible: false,
                locked: true,
                keyframes: [],
                meta: { reference: true },
            },
            ...parts.map((part) => childLayer(part, duration)),
        ],
    };
}

function buildSegmentedComposition(parts, groups, master) {
    const duration = Number(master.duration) || 12000;
    return {
        ...master,
        id: SEGMENTED_ID,
        name: `${master.name} — Segmented`,
        referenceLayerId: null,
        meta: {
            ...compositionMeta(),
            segmentation: segmentationMeta(groups, parts),
            agentAwareness: agentAwareness(groups),
        },
        sourceFacts: {
            ...(master.sourceFacts || {}),
            kind: 'html-stage-poster-segmented',
            layerCount: parts.length,
            warnings: [
                `Derived from the exact 6s poster (944×1130). ${parts.length} cut-out parts in ${groups.length} semantic groups reproduce the poster pixel-for-pixel.`,
                'This composition is static from 0 to 12s; the original motion remains the source recording and the editable frame archive.',
                'The master poster composition is untouched.',
            ],
        },
        layers: parts.map((part) => childLayer(part, duration)),
    };
}

/* ── index + readme ──────────────────────────────────────────────── */

function buildIndex(parts, groups) {
    const parent = {
        parentLayerId: PARENT.id,
        parentName: PARENT.name,
        parentRole: 'background',
        parentZ: 0,
        parentFit: 'fill',
        parentKeyframes: 2,
        folder: PACK_FOLDER,
        segmentationComposition: `images/segmentation/${PACK_FOLDER}/compositions/${PACK_FOLDER}.composition.json`,
        sourceImage: 'poster.png',
        sourceWidth: 944,
        sourceHeight: 1130,
        description: SCENE.description,
        style: SCENE.style,
        sceneObjects: parts.length,
        groups: [...new Set(parts.map((part) => part.group))],
        childCount: parts.length,
    };
    return {
        schema: 'studio/image-segmentation/1',
        version: 1,
        projectId: PROJECT_ID,
        composition: `compositions/${SEGMENTED_ID}.composition.json`,
        generatedAt: new Date().toISOString(),
        method: 'image-to-layers',
        parents: [parent],
        groups,
        counts: { segmentedParents: 1, childLayers: parts.length, groups: groups.length, skippedParents: 0 },
        notes: [
            'The reference is the exact 6s poster; the poster is the full canvas, so local boxes equal composition boxes.',
            'Every child holds its box for the whole 12s; there is no independent animation in this composition.',
            'Part cut-outs are disjoint, so the composite reproduces the poster exactly. The z order is semantic for later animation.',
            'reference layers are excluded; unassigned pixels are kept so no pixels are lost.',
            'The master poster composition and the editable frame archive are untouched.',
        ],
        warnings: [
            'The artwork spells the place "Kaitleast"; the earlier 55-layer export used "Kaitleat". The artwork spelling was kept.',
        ],
        corrections: segmentationMeta(groups, parts).corrections,
        indexFile: 'images/segmentation/index.json',
    };
}

function buildReadme(parts, groups) {
    const rows = groups.map((group) => `| ${group.shortLabel} | ${group.objectCount} | ${group.description} |`).join('\n');
    const corrections = segmentationMeta(groups, parts).corrections.map((line) => `- ${line}`).join('\n');
    return `# Borders Web · Where I Work — poster segmentation

The **exact 6s poster** of \`${PROJECT_ID}\` decomposed into
**${parts.length} cut-out parts** in **${groups.length} semantic groups**, wired as a
separate project composition. The master poster composition is untouched.

| | |
|---|---|
| Project | \`data/projects/${PROJECT_ID}/\` |
| Reference / parent | \`images/poster.png\` — 944×1130, the full canvas |
| Segmentation root | \`images/segmentation/\` |
| Pack | \`images/segmentation/${PACK_FOLDER}/\` |
| Map / index | \`images/segmentation/index.json\` |
| Wired composition | \`compositions/${SEGMENTED_ID}.composition.json\` |
| Master (unchanged) | \`compositions/${PROJECT_ID}.composition.json\` |
| Editable archive (unchanged) | \`compositions/${PROJECT_ID}.editable.json\` |
| Source exports | \`images/segmentation/_source/\` |
| Wiring script | \`scripts/wire-borders-web-segmentation.js\` |
| Test | \`tests/segmentation-borders.test.js\` |

Open the wired composition directly:

\`\`\`
/project-canvas?project=${PROJECT_ID}&composition=${SEGMENTED_ID}
\`\`\`

## Groups

| Group | Parts | What it is |
|---|---:|---|
${rows}

## Coordinates and animation

The reference is the poster, which fills the whole 944×1130 canvas. Every child's
box is therefore the local segmentation box, and the child holds that box for the
whole 12s composition:

\`\`\`
child.x = local.x    child.y = local.y
child.w = local.w    child.h = local.h
keyframes: { time: 0, … } and { time: 12000, … }
\`\`\`

This composition is static. The page's original motion is the source recording;
\`compositions/${PROJECT_ID}.editable.json\` keeps the extracted 11-frame
approximation. The segmented composition is the interaction surface: select a
group or a part and animate it with the project canvas agent.

## Z order

The export numbered the layers in the order they were added, which put the
background above the town labels. The cut-outs are disjoint, so the still image is
identical in any order, but the stack now reads correctly for animation:

\`\`\`
Background → Map Details → Routes → Kelso → Markers → Labels → Icons → Compass → Header → Footer
\`\`\`

## Review and corrections

${corrections}

## Data checks

- 63 layers ↔ 63 PNG files, no missing or extra parts.
- Every box aspect matches its PNG within 2%.
- The 63 parts composited in the composition's z order reproduce \`poster.png\` with
  **0 differing pixels** (exact RGB match).
- The export's own composite PNG is pixel-for-pixel the poster (PNG bytes differ),
  so it is archived under \`_source/\` as provenance, not used at runtime.
- The unrelated \`vincent-hovorka-…\` composition, the agent manifest and the snapshot
  were archived under \`_source/\`; they are provenance, not project data.

## HTML background

\`images/html-bg.jpg\` is the 900×1077 background photo used by the editable frame
archive. The segmentation was taken from the 944×1130 poster at 6s, so it is in
poster space; \`html-bg.jpg\` is not part of the pack and does not need to be.

## Re-run

\`\`\`bash
npm run wire:borders-segmentation                       # rebuild
node scripts/wire-borders-web-segmentation.js --check   # verify only
\`\`\`

Use this script, not the generic \`npm run wire:segments\`: that script expects a
parent image layer inside a project composition and would skip this pack with
warnings. The parent here is the master poster itself, which is why the pack is
wired as a separate composition.

The script is idempotent: after the first run it rebuilds from the canonical pack.
`;
}

/* ── main ────────────────────────────────────────────────────────── */

function main() {
    const master = readJson(MASTER_FILE);
    const duration = Number(master.duration) || 12000;
    const poster = pngSize(POSTER_FILE);
    if (poster.width !== 944 || poster.height !== 1130) {
        throw new Error(`poster.png is ${poster.width}×${poster.height}, expected 944×1130`);
    }

    const ingested = CHECK ? null : ingestExport();
    let rawParts;
    let mode;
    if (ingested) {
        mode = 'export';
        rawParts = ingested.parts;
    } else {
        mode = 'pack';
        rawParts = packParts();
        if (!rawParts) {
            throw new Error(CHECK
                ? `No canonical pack at ${PACK_DIR}; run the wiring script first.`
                : `No export at ${SOURCE_DIR} and no pack at ${PACK_DIR}`);
        }
    }
    const parts = canonicalParts(rawParts);
    const groups = groupsFor(parts);
    if (parts.length !== 63) throw new Error(`Expected 63 parts, got ${parts.length}`);
    if (new Set(parts.map((part) => part.id)).size !== parts.length) throw new Error('Duplicate child ids');

    // First run: move the cut-outs into the canonical pack and archive the rest.
    if (ingested && !CHECK) {
        const moved = new Map();
        for (const part of parts) {
            const target = path.join(PACK_DIR, part.packFile);
            if (!fs.existsSync(target)) moveFile(part.sourcePath, target);
            moved.set(part.sourcePath, target);
        }
        // Verify every PNG was accounted for.
        const leftovers = filesIn(SOURCE_DIR).filter((file) => file.toLowerCase().endsWith('.png')
            && path.basename(file) !== `${PROJECT_ID}-segmented.png`
            && !moved.has(file));
        if (leftovers.length) throw new Error(`Unhandled part files: ${leftovers.join(', ')}`);

        if (fs.existsSync(ingested.composite) && sha256(ingested.composite) !== sha256(POSTER_FILE)) {
            moveFile(ingested.composite, path.join(ARCHIVE_DIR, 'composite.png'));
        } else if (fs.existsSync(ingested.composite)) {
            fs.unlinkSync(ingested.composite);
        }
        for (const file of fs.readdirSync(SOURCE_DIR)) {
            const source = path.join(SOURCE_DIR, file);
            if (file === '.DS_Store') { fs.unlinkSync(source); continue; }
            if (fs.statSync(source).isDirectory()) continue;
            if (file.endsWith('.json')) moveFile(source, path.join(ARCHIVE_DIR, file));
        }
        // Everything that matters has moved; drop the export folder (and .DS_Store).
        fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
    }

    const packComposition = buildPackComposition(parts, groups, duration);
    const segmented = buildSegmentedComposition(parts, groups, master);
    const index = buildIndex(parts, groups);
    const packLayers = {
        name: 'poster',
        sourceImage: 'poster.png',
        width: 944,
        height: 1130,
        layers: parts.map((part) => ({
            name: part.name,
            file: part.packFile,
            folder: part.groupSlug,
            role: part.role,
            group: part.group,
            label: part.label,
            description: part.description,
            z: part.z,
            sourceZ: part.sourceZ,
            sourceFile: part.sourceFile,
            bbox: part.pixel,
            localBox: part.local,
        })),
    };
    const scene = {
        name: PARENT.name,
        description: SCENE.description,
        style: SCENE.style,
        objects: parts.map((part) => ({
            name: part.name,
            label: part.label,
            description: part.description,
            group: part.group,
            role: part.role,
            file: part.packFile,
            bbox: part.pixel,
            localBox: part.local,
        })),
    };

    writeJson(path.join(PACK_DIR, 'compositions', `${PACK_FOLDER}.composition.json`), packComposition);
    writeJson(path.join(PACK_DIR, 'layers.json'), packLayers);
    writeJson(path.join(PACK_DIR, 'scene.json'), scene);
    writeJson(SEGMENTED_FILE, segmented);
    writeJson(INDEX_FILE, index);
    writeText(README_FILE, buildReadme(parts, groups));

    // The archive folder only gets a small note; the JSON exports were moved above.
    if (ingested && !CHECK) writeText(path.join(ARCHIVE_DIR, 'README.md'), [
        '# Source exports',
        '',
        'Raw exports from the image-to-layers segmentation editor, kept for provenance.',
        'The canonical, renderable copy is `../poster-png/`; the wired composition is',
        `\`compositions/${SEGMENTED_ID}.composition.json\`.`,
        '',
        '- `borders-web-where-i-work-animated-02-segmented.json` — the editor composition (its URLs pointed at a project folder that does not exist).',
        '- `borders-web-where-i-work-animated-02-segmented-agent.json` — the editor agent manifest (redundant with the composition).',
        '- `borders-web-where-i-work-animated-02-segmented-agent-snapshot-r0.json` — the editor snapshot.',
        '- `vincent-hovorka-…-composition.json` — an export from a different project; archived, not used here.',
        '',
        'The editor composite PNG is pixel-identical to `images/poster.png` (PNG bytes differ); it is archived as composite.png and is not used at runtime.',
        '',
    ].join('\n'));

    // Post-write validation.
    const checks = [];
    for (const part of parts) {
        const file = path.join(PACK_DIR, part.packFile);
        if (!fs.existsSync(file)) checks.push(`missing ${part.packFile}`);
    }
    const filesOnDisk = filesIn(PACK_IMAGES).filter((file) => file.toLowerCase().endsWith('.png'));
    if (filesOnDisk.length !== parts.length) checks.push(`pack has ${filesOnDisk.length} PNGs, expected ${parts.length}`);
    const zGroups = groups.map((group) => ({
        group: group.shortLabel,
        min: Math.min(...group.parts.map((part) => part.z)),
        max: Math.max(...group.parts.map((part) => part.z)),
    }));
    for (let index = 1; index < zGroups.length; index += 1) {
        if (zGroups[index].min <= zGroups[index - 1].max) checks.push(`z order overlaps ${zGroups[index - 1].group} → ${zGroups[index].group}`);
    }
    if (checks.length) throw new Error(`Post-write validation failed:\n- ${checks.join('\n- ')}`);

    console.log(`[borders] mode: ${mode}${ingested ? ' (export ingested)' : ' (rebuilt from pack)'}`);
    console.log(`[borders] ${parts.length} parts in ${groups.length} groups`);
    console.log(`[borders] pack: images/segmentation/${PACK_FOLDER}/`);
    console.log(`[borders] composition: compositions/${SEGMENTED_ID}.composition.json`);
    console.log(`[borders] index: images/segmentation/index.json`);
    console.log(`[borders] z: ${zGroups.map((group) => `${group.group} ${group.min}-${group.max}`).join(' · ')}`);
    console.log(`[borders] ${CHECK ? 'check passed (nothing written)' : 'written'}`);
}

main();
