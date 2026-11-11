'use strict';
/**
 * segmentation-wiring.js — import an image-to-layers `<project>-segmented`
 * export into the Studio project it belongs to.
 *
 * Contract (produced by the image-to-layers "Project" output):
 *   data/projects/<target>-segmented/
 *     compositions/<target>-segmented.composition.json  (reference + parts)
 *     images/<folder>/<part>.png
 *     images/reference.png
 *     layers.json  { name, width, height, description, layers: [{name,file,group,label,description,role,bbox}] }
 *     scene.json   { description, style, objects: [...] }
 *
 * The importer validates the export, maps the parts into the target parent
 * layer, writes the canonical project segmentation pack, builds/updates the
 * target's `<target>-segmented` composition and `images/segmentation/index.json`,
 * and archives the provisional export under the target's `_source/`.
 *
 * The target composition (the exact poster) and the editable frame archive are
 * never changed.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS_DIR = path.join(ROOT, 'data', 'projects');
const PROJECT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SEGMENTED_SUFFIX = '-segmented';
const MAX_IMPORT_LAYERS = 500;

const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = (file) => fs.existsSync(file);
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
const slug = (value, max = 80) => String(value || 'part')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'part';
const titleCase = (value) => String(value || '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, 'utf8');
}

function projectDir(id) {
    if (!PROJECT_ID.test(String(id || ''))) throw fail(400, 'The project id is invalid.');
    return path.join(PROJECTS_DIR, id);
}

function fileSize(file) {
    const buffer = fs.readFileSync(file);
    const png = buffer.length > 24 && buffer.readUInt32BE(12) === 0x49484452;
    if (png) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2;
        while (offset < buffer.length - 8) {
            if (buffer[offset] !== 0xff) { offset += 1; continue; }
            const marker = buffer[offset + 1];
            if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
            const length = buffer.readUInt16BE(offset + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
            }
            offset += 2 + length;
        }
    }
    return null;
}

function urlToFile(projectId, url) {
    const raw = String(url || '').split(/[?#]/)[0];
    if (!raw) return null;
    const prefix = `/data/projects/${projectId}/`;
    if (!raw.startsWith(prefix)) return null;
    const relative = raw.slice(prefix.length);
    const target = path.join(projectDir(projectId), relative);
    const root = path.resolve(projectDir(projectId)) + path.sep;
    return path.resolve(target).startsWith(root) ? { file: target, relative } : null;
}

/* ------------------------------------------------------------------------- */
/* Semantic stack                                                             */
/* ------------------------------------------------------------------------- */

const GROUP_RANKS = [
    [/^background$/i, 1],
    [/^unassigned$/i, 1],
    [/^sky$/i, 1],
    [/^ground$/i, 2],
    [/^map[ -]?base$/i, 10],
    [/^map[ -]?background$/i, 10],
    [/^terrain$/i, 10],
    [/^routes?$/i, 20],
    [/^roads?$/i, 20],
    [/^paths?$/i, 20],
    [/^map[ -]?details$/i, 20],
    [/^water$/i, 22],
    [/^map[ -]?markers$/i, 30],
    [/^markers?$/i, 30],
    [/^pins?$/i, 32],
    [/^dots?$/i, 30],
    [/^map[ -]?labels$/i, 40],
    [/^labels?$/i, 40],
    [/^text$/i, 40],
    [/^kelso$/i, 45],
    [/^characters?$/i, 45],
    [/^subject$/i, 45],
    [/^map[ -]?icons$/i, 50],
    [/^icons?$/i, 50],
    [/^symbols?$/i, 50],
    [/^compass$/i, 55],
    [/^typography$/i, 60],
    [/^header$/i, 70],
    [/^branding$/i, 70],
    [/^logo$/i, 70],
    [/^footer$/i, 80],
    [/^other$/i, 35],
    [/^segments?$/i, 35],
];

function groupRank(group) {
    const name = String(group || '').trim();
    for (const [pattern, rank] of GROUP_RANKS) if (pattern.test(name)) return rank;
    const lower = name.toLowerCase();
    if (/background|backdrop|ground/.test(lower)) return 1;
    if (/base|terrain/.test(lower)) return 10;
    if (/route|road|river|path|street/.test(lower)) return 20;
    if (/marker|pin|dot|point/.test(lower)) return 30;
    if (/label|caption|text/.test(lower)) return 40;
    if (/icon|symbol|badge/.test(lower)) return 50;
    if (/brand|logo|header/.test(lower)) return 70;
    if (/footer/.test(lower)) return 80;
    return 35;
}

function parentLabel(parent) {
    const url = String(parent.url || '');
    if (/\/poster\.png$/i.test(url) || /^source[-_ ]?frame$/i.test(String(parent.name || ''))) return 'Poster';
    return String(parent.name || parent.id);
}

/* ------------------------------------------------------------------------- */
/* Export reading and validation                                              */
/* ------------------------------------------------------------------------- */

function findComposition(dir, id) {
    const preferred = path.join(dir, 'compositions', `${id}.composition.json`);
    if (exists(preferred)) return preferred;
    const comps = path.join(dir, 'compositions');
    if (!exists(comps)) return null;
    const file = fs.readdirSync(comps).find((name) => name.endsWith('.composition.json'));
    return file ? path.join(comps, file) : null;
}

function readExport(segId) {
    if (!PROJECT_ID.test(segId) || !segId.endsWith(SEGMENTED_SUFFIX)) {
        throw fail(400, `“${segId}” is not a <project>${SEGMENTED_SUFFIX} export.`);
    }
    const dir = projectDir(segId);
    if (!exists(dir)) throw fail(404, `Segmentation export “${segId}” was not found.`);
    const compositionFile = findComposition(dir, segId);
    if (!compositionFile) throw fail(404, `Segmentation export “${segId}” has no composition.`);
    const composition = readJson(compositionFile);
    if (!composition || !Array.isArray(composition.layers)) throw fail(400, 'The segmentation composition has no layers.');
    if (!(Number(composition.width) > 0) || !(Number(composition.height) > 0)) {
        throw fail(400, 'The segmentation composition has no canvas size.');
    }
    const layersFile = path.join(dir, 'layers.json');
    const layersDoc = exists(layersFile) ? readJson(layersFile) : { layers: [] };
    const sceneFile = path.join(dir, 'scene.json');
    const scene = exists(sceneFile) ? readJson(sceneFile) : null;
    const markerFile = path.join(dir, 'studio-target.json');
    const targetMarker = exists(markerFile) ? readJson(markerFile) : null;

    const reference = composition.layers.find((layer) => layer.id === 'reference')
        || composition.layers.find((layer) => layer.id === composition.referenceLayerId)
        || null;
    if (!reference) throw fail(400, 'The segmentation composition has no reference layer.');
    const referencePath = urlToFile(segId, reference.url);
    if (!referencePath || !exists(referencePath.file)) throw fail(400, 'The segmentation reference image is missing.');
    const referenceSize = fileSize(referencePath.file);
    if (!referenceSize) throw fail(400, 'The segmentation reference image size could not be read.');

    const layerDocByName = new Map((layersDoc.layers || []).map((layer) => [layer.name, layer]));
    const sceneByName = new Map(((scene && scene.objects) || []).map((object) => [object.name, object]));
    const parts = [];
    for (const layer of composition.layers) {
        if (layer === reference || layer.id === reference.id) continue;
        if ((layer.type && layer.type !== 'image') || !layer.url) continue;
        const located = urlToFile(segId, layer.url);
        if (!located) throw fail(400, `Layer ${layer.id} points outside the export.`);
        if (!exists(located.file)) throw fail(400, `Layer ${layer.name || layer.id} is missing its image.`);
        const size = fileSize(located.file);
        if (!size) throw fail(400, `Layer ${layer.name || layer.id} is not a readable image.`);
        const doc = layerDocByName.get(layer.name) || {};
        const object = sceneByName.get(layer.name) || {};
        const group = String(layer.segmentGroup || doc.group || object.group || 'Segments').trim() || 'Segments';
        const label = String(layer.label || doc.label || object.label || titleCase(layer.name)).trim();
        const description = String(layer.description || doc.description || object.description || '').trim();
        const local = {
            x: round(clamp(Number(layer.x ?? 0), 0, 100)),
            y: round(clamp(Number(layer.y ?? 0), 0, 100)),
            w: round(clamp(Number(layer.w ?? 0), 0, 100)),
            h: round(clamp(Number(layer.h ?? 0), 0, 100)),
        };
        if (!(local.w > 0 && local.h > 0)) throw fail(400, `Layer ${layer.name || layer.id} has an invalid box.`);
        const boxAspect = (local.w / local.h) * (composition.width / composition.height);
        const imageAspect = size.width / size.height;
        if (Math.abs(boxAspect - imageAspect) / imageAspect > 0.03) {
            throw fail(400, `Layer ${layer.name || layer.id} box does not match its image aspect.`);
        }
        parts.push({
            sourceId: layer.id,
            name: String(layer.name || layer.id),
            group,
            role: String(layer.role || doc.role || object.role || 'prop'),
            label,
            description,
            sourceZ: Number(layer.z) || 0,
            local,
            pixel: {
                x: Math.round(local.x / 100 * composition.width),
                y: Math.round(local.y / 100 * composition.height),
                w: Math.round(local.w / 100 * composition.width),
                h: Math.round(local.h / 100 * composition.height),
            },
            sourceFile: located.relative,
            sourcePath: located.file,
            imageSize: size,
        });
        if (parts.length > MAX_IMPORT_LAYERS) throw fail(413, `The export has more than ${MAX_IMPORT_LAYERS} parts.`);
    }
    if (!parts.length) throw fail(400, 'The segmentation export has no parts.');

    const names = new Set();
    for (const part of parts) {
        if (names.has(part.name)) throw fail(400, `The export repeats the layer name “${part.name}”.`);
        names.add(part.name);
    }

    return {
        segId,
        dir,
        compositionFile,
        composition,
        reference: { layer: reference, path: referencePath.file, relative: referencePath.relative, size: referenceSize },
        parts,
        layersDoc,
        scene,
        targetMarker,
    };
}

/* ------------------------------------------------------------------------- */
/* Target parent selection                                                    */
/* ------------------------------------------------------------------------- */

function readTargetMaster(targetId) {
    const dir = projectDir(targetId);
    if (!exists(dir)) throw fail(404, `Target project “${targetId}” was not found.`);
    const file = path.join(dir, 'compositions', `${targetId}.composition.json`);
    if (!exists(file)) throw fail(404, `Target project “${targetId}” has no master composition.`);
    const composition = readJson(file);
    if (!composition || !Array.isArray(composition.layers) || !(Number(composition.width) > 0)) {
        throw fail(400, `Target project “${targetId}” has an invalid master composition.`);
    }
    return { dir, file, composition };
}

function chooseParent(target, exportData, options) {
    const layers = target.composition.layers.filter((layer) => layer.type === 'image' && layer.url);
    let parent = null;
    if (options.layerId) {
        parent = layers.find((layer) => layer.id === options.layerId) || null;
        if (!parent) throw fail(400, `No image layer “${options.layerId}” in ${options.targetProjectId}.`);
    } else if (options.imagePath) {
        const wanted = String(options.imagePath).replace(/^\/+/, '');
        const matches = layers.filter((layer) => {
            const located = urlToFile(options.targetProjectId, layer.url);
            return located && (located.relative === wanted || located.relative.endsWith(`/${wanted}`));
        });
        if (matches.length !== 1) {
            throw fail(400, matches.length
                ? `“${options.imagePath}” matches more than one target layer. Choose a layer id.`
                : `“${options.imagePath}” is not an image layer in ${options.targetProjectId}.`);
        }
        parent = matches[0];
    } else {
        const marker = exportData.targetMarker || (exportData.composition.meta && exportData.composition.meta.studioTarget) || null;
        if (marker && marker.layerId) {
            parent = layers.find((layer) => layer.id === marker.layerId) || null;
        }
        if (!parent && marker && marker.imagePath) {
            const wanted = String(marker.imagePath).replace(/^\/+/, '');
            const matches = layers.filter((layer) => {
                const located = urlToFile(options.targetProjectId, layer.url);
                return located && located.relative === wanted;
            });
            if (matches.length === 1) parent = matches[0];
        }
        if (!parent) {
            const posters = layers.filter((layer) => /\/poster\.png$/i.test(String(layer.url)));
            if (posters.length === 1) parent = posters[0];
        }
        if (!parent) {
            const fullCanvas = layers.filter((layer) => Number(layer.x) === 0 && Number(layer.y) === 0
                && Number(layer.w) === 100 && Number(layer.h) === 100);
            if (fullCanvas.length === 1) parent = fullCanvas[0];
        }
        if (!parent) {
            throw fail(400, 'Could not tell which target image was segmented. Pass --image or --layer.');
        }
    }
    const located = urlToFile(options.targetProjectId, parent.url);
    if (!located || !exists(located.file)) throw fail(400, 'The target parent image is missing.');
    const size = fileSize(located.file);
    if (!size) throw fail(400, 'The target parent image size could not be read.');
    return { parent, image: { ...located, size } };
}

/* ------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* ------------------------------------------------------------------------- */

function parentFrames(parent, duration) {
    const frames = (Array.isArray(parent.keyframes) && parent.keyframes.length)
        ? parent.keyframes.slice()
        : [{
            time: 0,
            x: parent.x, y: parent.y, w: parent.w, h: parent.h,
            rotation: parent.rotation || 0, opacity: parent.opacity ?? 1, easing: 'linear',
        }];
    frames.sort((a, b) => Number(a.time) - Number(b.time));
    if (Number(frames[frames.length - 1].time) < duration) {
        const last = frames[frames.length - 1];
        frames.push({ ...last, time: duration });
    }
    return frames;
}

function renderedRect(frame, fit, canvasW, canvasH, imageW, imageH) {
    const boxW = Number(frame.w) / 100 * canvasW;
    const boxH = Number(frame.h) / 100 * canvasH;
    const fill = !fit || (fit !== 'contain' && fit !== 'cover');
    if (fill) {
        return { x: Number(frame.x), y: Number(frame.y), w: Number(frame.w), h: Number(frame.h) };
    }
    const imageAspect = imageW / imageH;
    const boxAspect = boxW / boxH;
    let width;
    let height;
    if (fit === 'contain' ? imageAspect >= boxAspect : imageAspect <= boxAspect) {
        width = boxW;
        height = boxW / imageAspect;
    } else {
        height = boxH;
        width = boxH * imageAspect;
    }
    return {
        x: Number(frame.x) + (boxW - width) / 2 / canvasW * 100,
        y: Number(frame.y) + (boxH - height) / 2 / canvasH * 100,
        w: width / canvasW * 100,
        h: height / canvasH * 100,
    };
}

function childKeyframes(parent, local, target, duration) {
    const frames = parentFrames(parent, duration);
    const canvasW = Number(target.composition.width);
    const canvasH = Number(target.composition.height);
    const imageW = parent.size.width;
    const imageH = parent.size.height;
    return frames.map((frame) => {
        const rect = renderedRect(frame, parent.fit, canvasW, canvasH, imageW, imageH);
        return {
            time: Number(frame.time) || 0,
            x: round(rect.x + local.x / 100 * rect.w),
            y: round(rect.y + local.y / 100 * rect.h),
            w: round(local.w / 100 * rect.w),
            h: round(local.h / 100 * rect.h),
            rotation: round(Number(frame.rotation) || 0, 2),
            opacity: round(clamp(Number(frame.opacity ?? 1), 0, 1), 3),
            easing: frame.easing || 'linear',
        };
    }).sort((a, b) => a.time - b.time);
}

/* ------------------------------------------------------------------------- */
/* Output bundle                                                              */
/* ------------------------------------------------------------------------- */

function placeParts(exportData) {
    const groups = new Map();
    for (const part of exportData.parts) {
        const group = part.group;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(part);
    }
    const orderedGroups = [...groups.entries()].map(([label, parts]) => ({
        label,
        rank: groupRank(label),
        parts: parts.slice().sort((a, b) => a.sourceZ - b.sourceZ || a.name.localeCompare(b.name)),
    })).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));

    const placed = [];
    for (const group of orderedGroups) {
        for (const part of group.parts) placed.push({ ...part, groupRank: group.rank });
    }
    return { orderedGroups, placed };
}


/* ------------------------------------------------------------------------- */
/* Main import                                                                */
/* ------------------------------------------------------------------------- */

function wireSegmentationExport(segId, options = {}) {
    const targetId = String(options.targetProjectId
        || (options.targetMarker && options.targetMarker.projectId)
        || segId.replace(new RegExp(`${SEGMENTED_SUFFIX}$`), '')).trim();
    if (!targetId || targetId === segId) {
        throw fail(400, 'Choose the Studio project this segmentation belongs to.');
    }
    if (!PROJECT_ID.test(targetId)) throw fail(400, 'The target project id is invalid.');
    const exportData = readExport(segId);
    const target = { id: targetId, ...readTargetMaster(targetId) };
    const chosen = chooseParent(target, exportData, { ...options, targetProjectId: targetId });
    const parent = chosen.parent;
    const image = chosen.image;
    if (image.size.width !== exportData.reference.size.width || image.size.height !== exportData.reference.size.height) {
        throw fail(400, `The segmentation reference is ${exportData.reference.size.width}×${exportData.reference.size.height} but the target image is ${image.size.width}×${image.size.height}.`);
    }

    const duration = Number(target.composition.duration) || 0;
    const { orderedGroups, placed } = placeParts(exportData);
    const parentZ = Number(parent.z) || 0;
    const nextZ = target.composition.layers
        .filter((layer) => layer !== parent && Number(layer.z) > parentZ)
        .map((layer) => Number(layer.z));
    const ceiling = nextZ.length ? Math.min(...nextZ) : parentZ + 1;
    const range = Math.max(0.001, ceiling - parentZ);
    const total = placed.length;
    const parentName = parentLabel(parent);
    const packFolder = `${parent.id}-png`;
    const packDir = path.join(target.dir, 'images', 'segmentation', packFolder);
    const packImages = path.join(packDir, 'images');
    const targetCompositionId = `${targetId}${SEGMENTED_SUFFIX}`;
    const targetCompositionFile = path.join(target.dir, 'compositions', `${targetCompositionId}.composition.json`);
    const indexFile = path.join(target.dir, 'images', 'segmentation', 'index.json');
    const existingIndex = exists(indexFile) ? readJson(indexFile) : null;
    const groupedOutput = orderedGroups.map((group) => ({
        label: group.label,
        slug: slug(group.label),
        rank: group.rank,
        parts: [],
    }));
    const groupByLabel = new Map(groupedOutput.map((group) => [group.label, group]));

    const usedFiles = new Set();
    const parts = placed.map((part, index) => {
        const group = groupByLabel.get(part.group);
        const groupSlug = group.slug;
        let base = path.basename(part.sourceFile);
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(base)) base = `${slug(part.name)}.png`;
        let fileName = base;
        let counter = 2;
        while (usedFiles.has(`${groupSlug}/${fileName}`)) {
            fileName = base.replace(/(\.[a-z0-9]+)$/i, `-${counter}$1`);
            counter += 1;
        }
        usedFiles.add(`${groupSlug}/${fileName}`);
        const packFile = `images/${groupSlug}/${fileName}`;
        const url = `/data/projects/${targetId}/images/segmentation/${packFolder}/${packFile}`;
        const id = `${parent.id}--seg-layer-${groupSlug}-${slug(part.name)}`;
        const groupId = `${parent.id}--group-${groupSlug}`;
        const z = round(parentZ + range * (0.001 + (index / Math.max(1, total - 1)) * 0.998), 6);
        const child = {
            id,
            sourceId: part.sourceId,
            name: part.name,
            group: part.group,
            groupLabel: part.group,
            groupSlug,
            groupId,
            label: part.label,
            description: part.description,
            role: part.role,
            local: part.local,
            pixel: part.pixel,
            sourceFile: part.sourceFile,
            sourcePath: part.sourcePath,
            file: packFile,
            url,
            z,
            sourceZ: part.sourceZ,
            keyframes: childKeyframes(
                { ...parent, size: image.size },
                part.local,
                { composition: target.composition },
                duration,
            ),
        };
        group.parts.push(child);
        return child;
    });

    const compositionLayers = parts.map((part) => ({
        id: part.id,
        parentId: parent.id,
        groupId: part.groupId,
        type: 'image',
        name: `${parentName} · ${part.label}`,
        role: part.role,
        z: part.z,
        x: part.keyframes[0].x,
        y: part.keyframes[0].y,
        w: part.keyframes[0].w,
        h: part.keyframes[0].h,
        rotation: part.keyframes[0].rotation,
        opacity: 1,
        url: part.url,
        fit: parent.fit === 'contain' ? 'contain' : 'fill',
        visible: part.visible !== false,
        locked: false,
        segmentGroup: `${parentName} / ${part.group}`,
        keyframes: part.keyframes,
        source: {
            type: 'image-to-layers',
            parent: parent.id,
            segmentation: {
                folder: packFolder,
                composition: `images/segmentation/${packFolder}/compositions/${packFolder}.composition.json`,
                object: part.name,
                sourceFile: part.sourceFile,
            },
        },
        meta: {
            segmentation: {
                parentLayerId: parent.id,
                parentName,
                parentUrl: parent.url,
                parentRole: parent.role || 'background',
                parentFit: parent.fit || 'fill',
                sourceFolder: packFolder,
                sourceImage: image.relative,
                sourceWidth: image.size.width,
                sourceHeight: image.size.height,
                sourceComposition: `images/segmentation/${packFolder}/compositions/${packFolder}.composition.json`,
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
                sceneDescription: (exportData.scene && exportData.scene.description) || '',
                sceneStyle: (exportData.scene && exportData.scene.style) || '',
                coordinateSpace: 'percent of the selected source image; mapped into the parent layer box at every parent keyframe',
                inheritedKeyframes: part.keyframes.length,
            },
        },
    }));

    const parentEntry = {
        parentLayerId: parent.id,
        parentName,
        parentRole: parent.role || 'background',
        parentZ,
        parentFit: parent.fit || 'fill',
        parentKeyframes: childKeyframes({ ...parent, size: image.size }, { x: 0, y: 0, w: 100, h: 100 }, { composition: target.composition }, duration).length,
        folder: packFolder,
        segmentationComposition: `images/segmentation/${packFolder}/compositions/${packFolder}.composition.json`,
        sourceImage: image.relative,
        sourceWidth: image.size.width,
        sourceHeight: image.size.height,
        description: (exportData.scene && exportData.scene.description) || '',
        style: (exportData.scene && exportData.scene.style) || '',
        sceneObjects: parts.length,
        groups: groupedOutput.map((group) => group.label),
        childCount: parts.length,
        sourceProjectId: segId,
    };

    const groups = groupedOutput.map((group) => ({
        id: `${parent.id}--group-${group.slug}`,
        label: `${parentName} / ${group.label}`,
        shortLabel: group.label,
        parentLayerId: parent.id,
        parentName,
        sourceFolder: packFolder,
        description: (GROUP_DESCRIPTIONS[group.label] || ''),
        objectCount: group.parts.length,
        box: unionBox(group.parts),
        parts: group.parts.map((part) => ({
            id: part.id,
            name: `${parentName} · ${part.label}`,
            label: part.label,
            description: part.description,
            role: part.role,
            bbox: part.local,
            pixel: part.pixel,
            z: part.z,
            url: part.url,
            sourceFile: part.sourceFile,
        })),
    }));

    const index = mergeIndex(existingIndex, parentEntry, groups, targetId, targetCompositionId, segId);
    const segmented = buildSegmentedComposition(target, parent, compositionLayers, index, targetCompositionId);
    const packComposition = buildPackComposition(parent, image, parts, exportData);
    const packLayers = buildPackLayers(parent, image, parts, exportData);
    const packScene = buildPackScene(exportData, parts);

    const report = {
        ok: true,
        targetProjectId: targetId,
        segmentedProjectId: segId,
        parent: { id: parent.id, name: parentName },
        image: { path: image.relative, width: image.size.width, height: image.size.height },
        packFolder,
        compositionId: targetCompositionId,
        compositionFile: `compositions/${targetCompositionId}.composition.json`,
        counts: { parts: parts.length, groups: groups.length },
        groups: groups.map((group) => ({ label: group.shortLabel, count: group.objectCount, z: [Math.min(...group.parts.map((p) => p.z)), Math.max(...group.parts.map((p) => p.z))] })),
        z: { parent: parentZ, ceiling, range },
        warnings: [],
        // Map the provisional export's layer ids to the canonical pack URLs so a
        // caller (the image-to-layers app) can keep rendering its result after
        // the provisional project has been archived.
        urls: Object.fromEntries(parts.map((part) => [part.sourceId, part.url])),
    };

    if (options.check) {
        report.check = true;
        return report;
    }

    // Copy the part images into the canonical pack.
    for (const part of parts) {
        const targetFile = path.join(packDir, part.file);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        if (options.keepSource) fs.copyFileSync(part.sourcePath, targetFile);
        else {
            try {
                fs.renameSync(part.sourcePath, targetFile);
            } catch (error) {
                if (error.code !== 'EXDEV') throw error;
                fs.copyFileSync(part.sourcePath, targetFile);
                fs.unlinkSync(part.sourcePath);
            }
        }
    }

    writeJson(path.join(packDir, 'compositions', `${packFolder}.composition.json`), packComposition);
    writeJson(path.join(packDir, 'layers.json'), packLayers);
    writeJson(path.join(packDir, 'scene.json'), packScene);
    writeJson(path.join(target.dir, 'compositions', `${targetCompositionId}.composition.json`), segmented);
    writeJson(indexFile, index);
    writeText(path.join(target.dir, 'images', 'segmentation', 'README.md'), buildReadme(target, index, parts, groups, segId));

    let archivedTo = null;
    if (!options.keepSource) {
        archivedTo = archiveExport(exportData, target, packFolder);
    }

    report.archivedTo = archivedTo;
    report.compositionUrl = `/project-canvas?project=${encodeURIComponent(targetId)}&composition=${encodeURIComponent(targetCompositionId)}`;
    return report;
}

const GROUP_DESCRIPTIONS = {
    Background: 'Leftover pixels that no scene object claimed, kept so nothing is lost.',
    'Map Base': 'The map canvas, land and water.',
    Routes: 'Dashed travel routes across the map.',
    'Map Icons': 'Small map symbols and illustrations.',
    'Map Labels': 'Place labels and captions.',
    'Map Markers': 'Marker dots and pins.',
    Typography: 'The headline and footer copy.',
    Branding: 'The logo, wordmark and brand accents.',
    Header: 'Header artwork.',
    Footer: 'Footer artwork.',
};

function unionBox(parts) {
    const boxes = parts.map((part) => part.local);
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const x1 = Math.max(...boxes.map((box) => box.x + box.w));
    const y1 = Math.max(...boxes.map((box) => box.y + box.h));
    return { x: round(x, 2), y: round(y, 2), w: round(x1 - x, 2), h: round(y1 - y, 2) };
}

function mergeIndex(existing, parentEntry, groups, targetId, compositionId, segId) {
    const parents = Array.isArray(existing && existing.parents) ? existing.parents.slice() : [];
    const existingGroups = Array.isArray(existing && existing.groups) ? existing.groups.slice() : [];
    const keptParents = parents.filter((entry) => entry.parentLayerId !== parentEntry.parentLayerId);
    const keptGroups = existingGroups.filter((entry) => entry.parentLayerId !== parentEntry.parentLayerId);
    const nextParents = [...keptParents, parentEntry];
    const nextGroups = [...keptGroups, ...groups];
    return {
        schema: 'studio/image-segmentation/1',
        version: 1,
        projectId: targetId,
        composition: `compositions/${compositionId}.composition.json`,
        generatedAt: new Date().toISOString(),
        method: 'image-to-layers',
        parents: nextParents,
        groups: nextGroups,
        counts: {
            segmentedParents: nextParents.length,
            childLayers: nextParents.reduce((sum, entry) => sum + Number(entry.childCount || 0), 0),
            groups: nextGroups.length,
            skippedParents: 0,
        },
        notes: [
            'Parent image layers are replaced by their segmented child layers in <project>-segmented.composition.json.',
            'Every child keyframe mirrors a parent keyframe; the local box is mapped into the parent image rectangle.',
            'Child z is semantic inside the parent slot; parts are exact cut-outs, so the still image is unchanged by the order.',
            'Reference layers are excluded; unassigned pixels are retained.',
            'The master composition and the editable frame archive are untouched.',
        ],
        warnings: [],
        corrections: [
            'Rebuilt every URL from the canonical images/segmentation/<parent>-png/images/<group>/<part>.png layout.',
            'Recomputed z from the semantic group order instead of the export insertion order.',
            'Used the target composition duration instead of the export default.',
            'Added parentId, groupId, segmentGroup and meta.segmentation to every part.',
            `Imported from the provisional project ${segId}.`,
        ],
        indexFile: 'images/segmentation/index.json',
    };
}

function buildSegmentedComposition(target, parent, layers, index, compositionId) {
    const master = target.composition;
    const existingFile = path.join(target.dir, 'compositions', `${compositionId}.composition.json`);
    let composition;
    if (exists(existingFile)) {
        composition = readJson(existingFile);
        const remove = new Set(layers.map((layer) => layer.id));
        const kept = composition.layers.filter((layer) => layer.parentId !== parent.id && !remove.has(layer.id));
        const firstOld = composition.layers.findIndex((layer) => layer.parentId === parent.id);
        const insertAt = firstOld >= 0 ? firstOld : kept.length;
        composition.layers = [...kept.slice(0, insertAt), ...layers, ...kept.slice(insertAt)];
    } else {
        composition = JSON.parse(JSON.stringify(master));
        const parentIndex = composition.layers.findIndex((layer) => layer.id === parent.id);
        if (parentIndex < 0) throw fail(400, 'The parent layer is not in the target master composition.');
        composition.layers = [...composition.layers.slice(0, parentIndex), ...layers, ...composition.layers.slice(parentIndex + 1)];
    }
    const duration = Number(master.duration) || 0;
    composition.id = compositionId;
    composition.name = `${master.name || target.id} — Segmented`;
    composition.referenceLayerId = null;
    composition.duration = duration;
    composition.meta = {
        ...(master.meta || {}),
        exactPoster: false,
        derivedFrom: `compositions/${target.id}.composition.json`,
        editableArchive: master.meta && master.meta.editableArchive,
        segmentation: {
            schema: 'studio/image-segmentation/1',
            method: 'image-to-layers',
            parents: index.parents,
            groups: index.groups.map((group) => ({
                id: group.id,
                label: group.label,
                parentLayerId: group.parentLayerId,
                members: group.parts.map((part) => part.id),
                objectCount: group.objectCount,
                box: group.box,
            })),
            counts: index.counts,
            mapping: {
                sourceSpace: 'percent of the selected source image',
                rule: 'child box = parent image rectangle at each parent keyframe + local box',
                zOrder: index.groups.map((group) => group.shortLabel).join(' → '),
            },
            indexFile: 'images/segmentation/index.json',
        },
        agentAwareness: {
            summary: `${index.counts.childLayers} cut-out parts in ${index.counts.groups} semantic groups, imported from image-to-layers.`,
            groups: index.groups.map((group) => ({
                id: group.id,
                label: group.label,
                parts: group.objectCount,
                description: group.description,
            })),
            howItWorks: [
                'Select a semantic group to move it as one unit, or a single part for detail.',
                'The segmented composition is static unless animated; the master poster is untouched.',
                'Parts are exact cut-outs; moving one exposes the transparent areas behind it.',
            ],
            instructions: [
                'Use the labels exactly as written; they come from the segmentation scene description.',
                'Do not reorder background, typography or branding groups before animating.',
            ],
            queryHints: index.groups.map((group) => group.shortLabel.toLowerCase()),
        },
    };
    composition.sourceFacts = {
        ...(master.sourceFacts || {}),
        kind: 'html-stage-poster-segmented',
        layerCount: composition.layers.length,
        warnings: [
            `Derived from the exact poster; ${index.counts.childLayers} parts in ${index.counts.groups} groups.`,
            'The master composition and the editable frame archive are untouched.',
        ],
    };
    return composition;
}

function buildPackComposition(parent, image, parts, exportData) {
    const reference = {
        id: 'reference',
        type: 'image',
        name: 'Final image',
        role: 'background',
        z: 0,
        x: 0, y: 0, w: 100, h: 100,
        rotation: 0, opacity: 1,
        url: parent.url,
        fit: parent.fit || 'fill',
        visible: false,
        locked: true,
        keyframes: [],
    };
    return {
        version: 1,
        id: `${parent.id}-png`,
        name: `${parentLabel(parent)} — segmentation pack`,
        width: image.size.width,
        height: image.size.height,
        duration: 3000,
        defaultLocale: 'en',
        activeLocale: null,
        referenceLayerId: 'reference',
        characters: [],
        formats: [{
            id: 'master', isMaster: true, channel: 'social', label: 'Master',
            width: image.size.width, height: image.size.height, layerOverrides: {}, variableValues: {},
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
            parent: { id: parent.id, label: parentLabel(parent) },
            scene: exportData.scene ? { description: exportData.scene.description, style: exportData.scene.style } : null,
        },
        layers: [
            reference,
            ...parts.map((part) => ({
                id: part.id,
                type: 'image',
                name: part.label,
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
                keyframes: [],
                segmentGroup: part.group,
                meta: {
                    segmentation: {
                        parentLayerId: parent.id,
                        parentName: parentLabel(parent),
                        objectName: part.name,
                        objectLabel: part.label,
                        objectDescription: part.description,
                        objectGroup: part.group,
                        objectRole: part.role,
                        localBox: part.local,
                        sourceZ: part.sourceZ,
                        sourceFile: part.sourceFile,
                    },
                },
            })),
        ],
    };
}

function buildPackLayers(parent, image, parts, exportData) {
    return {
        name: `${parent.id}-png`,
        sourceImage: image.relative,
        width: image.size.width,
        height: image.size.height,
        description: (exportData.scene && exportData.scene.description) || '',
        style: (exportData.scene && exportData.scene.style) || '',
        layers: parts.map((part) => ({
            name: part.name,
            file: part.file,
            folder: part.groupSlug,
            group: part.group,
            label: part.label,
            description: part.description,
            role: part.role,
            z: part.z,
            sourceZ: part.sourceZ,
            sourceFile: part.sourceFile,
            bbox: part.pixel,
            localBox: part.local,
        })),
    };
}

function buildPackScene(exportData, parts) {
    const byName = new Map(parts.map((part) => [part.name, part]));
    const objects = ((exportData.scene && exportData.scene.objects) || []).map((object) => {
        const part = byName.get(object.name);
        return {
            ...object,
            file: part ? part.file : undefined,
            localBox: part ? part.local : undefined,
        };
    });
    return {
        name: `${exportData.segId}`,
        description: (exportData.scene && exportData.scene.description) || (exportData.layersDoc && exportData.layersDoc.description) || '',
        style: (exportData.scene && exportData.scene.style) || '',
        objects,
    };
}

function archiveExport(exportData, target, packFolder) {
    const archiveDir = path.join(target.dir, 'images', 'segmentation', '_source', exportData.segId);
    // A re-import of the same provisional project replaces the previous archive.
    fs.rmSync(archiveDir, { recursive: true, force: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const name of ['layers.json', 'scene.json', 'studio-target.json', 'compositions']) {
        const source = path.join(exportData.dir, name);
        if (!exists(source)) continue;
        fs.renameSync(source, path.join(archiveDir, name));
    }
    const images = path.join(exportData.dir, 'images');
    if (exists(images)) {
        // The parts were moved into the canonical pack; whatever is left
        // (reference + any extras the exporter wrote) is provenance.
        fs.renameSync(images, path.join(archiveDir, 'images'));
    }
    writeText(path.join(archiveDir, 'README.md'), [
        '# Segmentation source',
        '',
        `Provisional image-to-layers project \`${exportData.segId}\`, imported into \`${packFolder}\`.`,
        'The part images now live in the canonical pack; this folder keeps the original composition,',
        'layers manifest, scene description and reference for provenance.',
        '',
    ].join('\n'));
    fs.rmSync(exportData.dir, { recursive: true, force: true });
    return `images/segmentation/_source/${exportData.segId}`;
}

function buildReadme(target, index, parts, groups, segId) {
    const rows = groups.map((group) => `| ${group.shortLabel} | ${group.objectCount} | ${group.description || ''} |`).join('\n');
    return `# ${target.composition.name} — segmentation

Imported from the provisional image-to-layers project \`${segId}\`.

| | |
|---|---|
| Target project | \`data/projects/${target.id}/\` |
| Segmented composition | \`compositions/${target.id}${SEGMENTED_SUFFIX}.composition.json\` |
| Master (unchanged) | \`compositions/${target.id}.composition.json\` |
| Editable archive (unchanged) | \`compositions/${target.id}.editable.json\` |
| Segmentation root | \`images/segmentation/\` |
| Index | \`images/segmentation/index.json\` |
| Pack | \`images/segmentation/${index.parents[index.parents.length - 1].folder}/\` |
| Source exports | \`images/segmentation/_source/\` |

Open the wired composition:

\`\`\`
/project-canvas?project=${target.id}&composition=${target.id}${SEGMENTED_SUFFIX}
\`\`\`

## Groups

| Group | Parts | What it is |
|---|---:|---|
${rows}

## What the importer did

- Validated ${parts.length} parts, their images, boxes and groups.
- Rebuilt every URL into the canonical \`images/segmentation/<parent>-png/images/<group>/<part>.png\` layout.
- Recomputed z from the group semantics instead of the export insertion order.
- Set the target composition duration instead of the export default.
- Added \`parentId\`, \`groupId\`, \`segmentGroup\` and \`meta.segmentation\` to every part.
- Wrote the pack composition/layers/scene, the \`${target.id}${SEGMENTED_SUFFIX}\` composition and the index.
- Archived the provisional export under \`_source/\` and removed it from the project list.

The master poster and the editable frame archive are untouched. The segmented
composition is static unless animated with the project canvas agent.

Rebuild: \`npm run wire:segmentation -- ${segId}\`
`;
}

/* ------------------------------------------------------------------------- */
/* Discovery                                                                  */
/* ------------------------------------------------------------------------- */

function listSegmentationExports() {
    if (!exists(PROJECTS_DIR)) return [];
    return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith(SEGMENTED_SUFFIX) && PROJECT_ID.test(entry.name))
        .map((entry) => {
            const segId = entry.name;
            const dir = path.join(PROJECTS_DIR, segId);
            const compositionFile = findComposition(dir, segId);
            let composition = null;
            try {
                composition = compositionFile ? readJson(compositionFile) : null;
            } catch { /* ignore malformed exports */ }
            const layers = composition && Array.isArray(composition.layers)
                ? composition.layers.filter((layer) => layer.id !== 'reference')
                : [];
            return {
                id: segId,
                targetProjectId: segId.replace(new RegExp(`${SEGMENTED_SUFFIX}$`), ''),
                parts: layers.length,
                groups: new Set(layers.map((layer) => layer.segmentGroup).filter(Boolean)).size,
                width: composition ? composition.width : null,
                height: composition ? composition.height : null,
                compositionFile: compositionFile ? path.relative(ROOT, compositionFile) : null,
            };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = {
    ROOT,
    PROJECTS_DIR,
    SEGMENTED_SUFFIX,
    groupRank,
    parentLabel,
    renderedRect,
    childKeyframes,
    placeParts,
    readExport,
    readTargetMaster,
    chooseParent,
    wireSegmentationExport,
    listSegmentationExports,
};
