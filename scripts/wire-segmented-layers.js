#!/usr/bin/env node
'use strict';

/**
 * Wire image-to-layers segmentation packs into a Studio composition.
 *
 * The segmentation folders live at:
 *   images/segmentation/<parent-id>-png/
 *     compositions/<parent-id>-png.composition.json
 *     layers.json
 *     scene.json                 (optional)
 *     images/<group>/<part>.png
 *
 * A parent image layer (e.g. m04-photo-t-pby-sp-on) is replaced by its child
 * cut-outs. Each child keeps the parent's animation by remapping its local
 * segmentation box into the parent's box at every parent keyframe. Child z is
 * fractional so it stays between the old parent layer and the next sibling.
 *
 * Usage:
 *   node scripts/wire-segmented-layers.js [projectDir]
 *   node scripts/wire-segmented-layers.js --restore [projectDir]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PROJECT = 'data/projects/06----giovannin-senza-paura-reels-03';

function slug(value, max = 90) {
    return String(value || 'part')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, max);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sourceRect(parentKeyframe, sourceWidth, sourceHeight, composition, fit) {
    const box = {
        x: Number(parentKeyframe.x ?? 0),
        y: Number(parentKeyframe.y ?? 0),
        w: Number(parentKeyframe.w ?? 100),
        h: Number(parentKeyframe.h ?? 100),
    };
    if (fit !== 'contain' && fit !== 'cover') return box;
    const canvasW = Number(composition.width) || 1;
    const canvasH = Number(composition.height) || 1;
    const boxW = box.w / 100 * canvasW;
    const boxH = box.h / 100 * canvasH;
    const sourceAspect = sourceWidth / sourceHeight;
    const boxAspect = boxW / boxH;
    let imageW;
    let imageH;
    if (fit === 'contain' ? sourceAspect >= boxAspect : sourceAspect <= boxAspect) {
        imageW = boxW;
        imageH = boxW / sourceAspect;
    } else {
        imageH = boxH;
        imageW = boxH * sourceAspect;
    }
    return {
        x: box.x + (boxW - imageW) / 2 / canvasW * 100,
        y: box.y + (boxH - imageH) / 2 / canvasH * 100,
        w: imageW / canvasW * 100,
        h: imageH / canvasH * 100,
    };
}

function mapLocal(local, rect) {
    return {
        x: rect.x + local.x * rect.w,
        y: rect.y + local.y * rect.h,
        w: local.w * rect.w,
        h: local.h * rect.h,
    };
}

function childKeyframes(parent, local, sourceWidth, sourceHeight, composition) {
    const frames = Array.isArray(parent.keyframes) && parent.keyframes.length
        ? parent.keyframes
        : [{
            time: 0,
            x: parent.x,
            y: parent.y,
            w: parent.w,
            h: parent.h,
            rotation: parent.rotation || 0,
            opacity: parent.opacity ?? 1,
            easing: 'linear',
        }];
    return frames
        .map((frame) => {
            const rect = sourceRect(frame, sourceWidth, sourceHeight, composition, parent.fit);
            const box = mapLocal(local, rect);
            return {
                time: Number(frame.time) || 0,
                ...box,
                rotation: Number(frame.rotation) || 0,
                opacity: clamp(Number(frame.opacity ?? 1), 0, 1),
                easing: frame.easing || 'linear',
            };
        })
        .sort((a, b) => a.time - b.time);
}

function shortParent(parent) {
    const match = String(parent.id || '').match(/^m\d+/i);
    return `${parent.name || parent.id} (${match ? match[0] : parent.id})`;
}

function segmentationFolders(projectDir) {
    const root = path.join(projectDir, 'images', 'segmentation');
    if (!fs.existsSync(root)) return { root, folders: [] };
    const folders = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => fs.existsSync(path.join(root, name, 'compositions')));
    return { root, folders };
}

function findSegmentationComposition(folderDir, folderName) {
    const directory = path.join(folderDir, 'compositions');
    const preferred = path.join(directory, `${folderName}.composition.json`);
    if (fs.existsSync(preferred)) return preferred;
    const file = fs.readdirSync(directory).find((name) => name.endsWith('.composition.json'));
    return file ? path.join(directory, file) : null;
}

function build(projectArg) {
    const projectDir = path.resolve(ROOT, projectArg || DEFAULT_PROJECT);
    const projectId = path.basename(projectDir);
    const compositionsDir = path.join(projectDir, 'compositions');
    const compositionFile = fs.readdirSync(compositionsDir)
        .filter((name) => name.endsWith('.composition.json'))
        .map((name) => path.join(compositionsDir, name))[0];
    if (!compositionFile) throw new Error(`No composition in ${compositionsDir}`);
    const backupFile = compositionFile.replace(/\.composition\.json$/, '.pre-segmentation.json.bak');
    const sourceFile = fs.existsSync(backupFile) ? backupFile : compositionFile;
    const composition = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    if (!fs.existsSync(backupFile)) fs.copyFileSync(compositionFile, backupFile);

    const { root: segmentationRoot, folders } = segmentationFolders(projectDir);
    if (!folders.length) throw new Error(`No segmentation packs under ${segmentationRoot}`);

    const layers = [...composition.layers];
    const parents = [];
    const groups = [];
    let childCount = 0;
    const warnings = [];
    const skippedParents = [];

    for (const folder of folders) {
        const folderDir = path.join(segmentationRoot, folder);
        const parentId = folder.replace(/-png$/, '');
        const parentIndex = layers.findIndex((layer) => layer.id === parentId);
        if (parentIndex < 0) {
            warnings.push(`No main layer for segmentation folder ${folder} (expected ${parentId})`);
            skippedParents.push(parentId);
            continue;
        }
        const parent = layers[parentIndex];
        const segCompositionFile = findSegmentationComposition(folderDir, folder);
        if (!segCompositionFile) {
            warnings.push(`No segmentation composition for ${folder}`);
            continue;
        }
        const segComposition = readJson(segCompositionFile);
        const layersDocFile = path.join(folderDir, 'layers.json');
        const layersDoc = fs.existsSync(layersDocFile) ? readJson(layersDocFile) : { layers: [] };
        const sceneFile = path.join(folderDir, 'scene.json');
        const sceneDoc = fs.existsSync(sceneFile) ? readJson(sceneFile) : null;
        const layerByName = new Map((layersDoc.layers || []).map((layer) => [layer.name, layer]));
        const sourceWidth = Number(segComposition.width || layersDoc.width);
        const sourceHeight = Number(segComposition.height || layersDoc.height);
        if (!(sourceWidth > 0 && sourceHeight > 0)) {
            warnings.push(`Invalid source size for ${folder}`);
            continue;
        }
        const parentLabel = shortParent(parent);
        const childLayers = [];
        const groupMap = new Map();
        const objectByName = new Map((sceneDoc?.objects || []).map((object) => [object.name, object]));

        for (const segLayer of segComposition.layers || []) {
            if (segLayer.id === 'reference') continue;
            const layerMeta = layerByName.get(segLayer.name) || {};
            const object = objectByName.get(segLayer.name) || {};
            const local = {
                x: Number(segLayer.x ?? 0) / 100,
                y: Number(segLayer.y ?? 0) / 100,
                w: Number(segLayer.w ?? 100) / 100,
                h: Number(segLayer.h ?? 100) / 100,
            };
            if (!(local.w > 0 && local.h > 0)) continue;
            const file = String(layerMeta.file || '');
            if (!file) {
                warnings.push(`No file for ${folder}/${segLayer.name}`);
                continue;
            }
            const group = String(layerMeta.group || object.group || 'Segments');
            const label = String(layerMeta.label || object.label || segLayer.name);
            const description = String(layerMeta.description || object.description || '');
            const role = String(layerMeta.role || object.role || segLayer.role || parent.role || 'foreground');
            const keyframes = childKeyframes(parent, local, sourceWidth, sourceHeight, composition);
            const base = keyframes[0];
            const z = Number(parent.z || 0) + Number(segLayer.z || 0) / 1000;
            const id = `${parent.id}--seg-${slug(segLayer.id || segLayer.name)}`;
            const url = `/data/projects/${projectId}/images/segmentation/${folder}/${file}`;
            const segmentGroup = `${parentLabel} / ${group}`;
            const groupId = `${parent.id}--group-${slug(group)}`;
            const child = {
                id,
                parentId: parent.id,
                groupId,
                type: 'image',
                name: `${parentLabel} · ${label}`,
                role,
                z,
                x: +base.x.toFixed(4),
                y: +base.y.toFixed(4),
                w: +base.w.toFixed(4),
                h: +base.h.toFixed(4),
                rotation: +base.rotation.toFixed(2),
                opacity: 1,
                url,
                fit: parent.fit === 'contain' ? 'contain' : 'fill',
                visible: parent.visible !== false && segLayer.visible !== false,
                locked: Boolean(parent.locked),
                segmentGroup,
                keyframes,
                meta: {
                    ...(parent.meta || {}),
                    segmentation: {
                        parentLayerId: parent.id,
                        parentName: parentLabel,
                        parentUrl: parent.url || '',
                        parentRole: parent.role || '',
                        parentFit: parent.fit || 'fill',
                        sourceFolder: folder,
                        sourceImage: layersDoc.name || segComposition.name || '',
                        sourceWidth,
                        sourceHeight,
                        sourceComposition: path.relative(projectDir, segCompositionFile),
                        objectName: segLayer.name,
                        objectLabel: label,
                        objectDescription: description,
                        objectGroup: group,
                        objectRole: role,
                        bbox: layerMeta.bbox || null,
                        localBox: {
                            x: +(local.x * 100).toFixed(4),
                            y: +(local.y * 100).toFixed(4),
                            w: +(local.w * 100).toFixed(4),
                            h: +(local.h * 100).toFixed(4),
                        },
                        sourceZ: segLayer.z,
                        sourceVisible: segLayer.visible !== false,
                        sceneDescription: sceneDoc?.description || '',
                        sceneStyle: sceneDoc?.style || '',
                        coordinateSpace: 'percent of source image; mapped into the parent keyframe box',
                        inheritedKeyframes: keyframes.length,
                    },
                },
                source: {
                    type: 'image-to-layers',
                    parent: parent.source || null,
                    segmentation: {
                        folder,
                        composition: path.relative(projectDir, segCompositionFile),
                        object: segLayer.name,
                    },
                },
            };
            childLayers.push(child);
            childCount += 1;
            if (!groupMap.has(group)) groupMap.set(group, []);
            groupMap.get(group).push(child);
        }

        for (const [group, members] of groupMap) {
            const groupId = `${parent.id}--group-${slug(group)}`;
            groups.push({
                id: groupId,
                label: `${parentLabel} / ${group}`,
                shortLabel: group,
                parentLayerId: parent.id,
                parentName: parentLabel,
                sourceFolder: folder,
                description: members[0]?.meta?.segmentation?.sceneDescription || '',
                objectCount: members.length,
                parts: members.map((member) => ({
                    id: member.id,
                    name: member.name,
                    label: member.meta.segmentation.objectLabel,
                    description: member.meta.segmentation.objectDescription,
                    role: member.role,
                    bbox: member.meta.segmentation.localBox,
                })),
            });
        }

        parents.push({
            parentLayerId: parent.id,
            parentName: parentLabel,
            parentRole: parent.role || '',
            parentZ: parent.z,
            parentFit: parent.fit || 'fill',
            parentKeyframes: Array.isArray(parent.keyframes) ? parent.keyframes.length : 0,
            folder,
            segmentationComposition: path.relative(projectDir, segCompositionFile),
            sourceImage: layersDoc.name || segComposition.name || '',
            sourceWidth,
            sourceHeight,
            description: sceneDoc?.description || '',
            style: sceneDoc?.style || '',
            sceneObjects: sceneDoc?.objects?.length || 0,
            groups: [...groupMap.keys()],
            childCount: childLayers.length,
        });

        layers.splice(parentIndex, 1, ...childLayers);
    }

    const sourceIndex = {
        schema: 'studio/image-segmentation/1',
        version: 1,
        projectId,
        composition: path.relative(ROOT, compositionFile),
        generatedAt: new Date().toISOString(),
        method: 'image-to-layers',
        parents,
        groups,
        counts: {
            segmentedParents: parents.length,
            childLayers: childCount,
            groups: groups.length,
            skippedParents: skippedParents.length,
        },
        notes: [
            'Parent image layers are replaced by their segmented child layers.',
            'Every child keyframe mirrors its parent keyframe time and opacity; the local box is mapped into the parent box.',
            'Child z is parent.z + source z / 1000 so segmented parts keep their order between the parent and the next sibling.',
            'reference layers are excluded; unassigned layers are retained so no pixels are lost.',
            'Segmentation packs without a parent layer are skipped and listed in warnings.',
        ],
        warnings,
    };

    const segmentationMeta = {
        ...sourceIndex,
        indexFile: 'images/segmentation/index.json',
        parentIds: parents.map((parent) => parent.parentLayerId),
        skippedParents,
        mapping: {
            sourceSpace: 'percent of source image',
            parentSpace: 'percent of composition canvas',
            rule: 'child = parentKeyframeBox + localSegmentationBox * parentKeyframeBox',
            animation: 'child keyframes copy parent keyframe times, easing, rotation and opacity',
            z: 'parent.z + source z / 1000',
        },
    };

    composition.layers = layers;
    const agentAwareness = {
        summary: `Four source images in this composition have been decomposed into ${childCount} semantic layers across ${parents.length} parent image layers.`,
        groups: groups.map((group) => ({
            id: group.id,
            label: group.label,
            parentLayerId: group.parentLayerId,
            description: group.description,
            objectCount: group.objectCount,
        })),
        howItWorks: [
            'A segmented child belongs to exactly one parent image layer.',
            'The child keyframe times match the parent; positions are the local object box inside the parent box.',
            'Move or retime the whole image by editing the shared parent-derived keyframes, not by treating a child as an independent object.',
            'Use segmentGroup to select all parts of one semantic group.',
            'The Timeline groups segmented children by their segmentGroup; the layer context shows the parent, object label, description and source scene.',
        ],
        instructions: [
            'When asked about a part, read meta.segmentation on the selected layer and its segmentGroup.',
            'Do not recolour or crop segmented art; it is the original cut-out.',
            'Text layers remain real text; only image layers were segmented.',
            'm13-photo-t-sp-me-on has no segmentation pack and remains a single SVG image layer.',
        ],
        queryHints: [
            'background pattern dots',
            'character head eyes hair shirt legs shoes',
            'gradient strip',
            'pixel art photo brown block edges',
        ],
    };

    sourceIndex.agentAwareness = agentAwareness;
    segmentationMeta.agentAwareness = agentAwareness;
    composition.meta = {
        ...(composition.meta || {}),
        segmentation: segmentationMeta,
        agentAwareness,
    };

    writeJson(compositionFile, composition);
    writeJson(path.join(segmentationRoot, 'index.json'), segmentationMeta);

    const readme = [
        '# Image segmentation map',
        '',
        `Generated by \`node scripts/wire-segmented-layers.js\` for \`${projectId}\`.`,
        '',
        '## What changed',
        '',
        ...parents.map((parent) => `- **${parent.parentName}** — \`${parent.parentLayerId}\` → ${parent.childCount} child layers (${parent.groups.join(', ')}).`),
        '',
        '## Workings',
        '',
        '- Each segmentation folder is named after its parent image layer (`<parent-id>-png`).',
        '- The folder composition is in source-image pixels; its layer boxes are percentages of that source image.',
        '- Each child keyframe copies the parent keyframe time, easing, rotation and opacity.',
        '- Child x/y/w/h = parent keyframe box + local segmentation box × parent keyframe box.',
        '- Child z = parent.z + source z / 1000.',
        '- Reference layers are excluded; unassigned layers are kept.',
        '- `m13-photo-t-sp-me-on` has no segmentation folder and remains one SVG image layer.',
        '',
        '## Groups',
        '',
        ...groups.map((group) => `- **${group.label}** — ${group.parts.map((part) => part.label).join(', ')}`),
        '',
        '## Files',
        '',
        '- `index.json` — machine-readable map for agents.',
        '- `<parent>-png/compositions/...` — source segmentation composition.',
        '- `<parent>-png/layers.json` — object boxes and file paths.',
        '- `<parent>-png/scene.json` — semantic descriptions where available.',
        '',
        'The composition also contains `meta.segmentation` and `meta.agentAwareness`.',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(segmentationRoot, 'README.md'), `${readme}\n`, 'utf8');

    console.log(`wired ${parents.length} parents → ${childCount} child layers · ${groups.length} groups`);
    console.log(`composition: ${path.relative(ROOT, compositionFile)}`);
    console.log(`index: ${path.relative(ROOT, path.join(segmentationRoot, 'index.json'))}`);
    if (warnings.length) warnings.forEach((warning) => console.warn(`warning: ${warning}`));
    return { composition, sourceIndex, parents, groups, childCount };
}

function restore(projectArg) {
    const projectDir = path.resolve(ROOT, projectArg || DEFAULT_PROJECT);
    const compositionsDir = path.join(projectDir, 'compositions');
    const compositionFile = fs.readdirSync(compositionsDir)
        .filter((name) => name.endsWith('.composition.json'))
        .map((name) => path.join(compositionsDir, name))[0];
    const backupFile = compositionFile.replace(/\.composition\.json$/, '.pre-segmentation.json.bak');
    if (!fs.existsSync(backupFile)) throw new Error(`No backup at ${backupFile}`);
    fs.copyFileSync(backupFile, compositionFile);
    console.log(`restored ${path.relative(ROOT, compositionFile)} from backup`);
}

const args = process.argv.slice(2);
const restoreMode = args.includes('--restore');
const projectArg = args.find((arg) => !arg.startsWith('--'));
if (restoreMode) restore(projectArg);
else build(projectArg);
