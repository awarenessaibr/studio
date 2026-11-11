'use strict';

/**
 * Contract tests for the Borders Web — Where I Work poster segmentation.
 *
 * The project's master poster composition stays untouched; the segmentation is
 * wired as a separate composition with 63 parts in 10 semantic groups. These
 * checks cover the exported data, the canonical pack, the z order, the project
 * reader/manifest and the layout that the project canvas expects.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ProjectManifest = require('../src/shared/project-manifest.js');
const ProjectCanvas = require('../src/server/project-canvas.js');

const ROOT = path.join(__dirname, '..');
const PROJECT_ID = 'borders-web-where-i-work-animated-02';
const COMPOSITION_ID = `${PROJECT_ID}-segmented`;
const PROJECT = path.join(ROOT, 'data', 'projects', PROJECT_ID);
const COMPOSITION_FILE = path.join(PROJECT, 'compositions', `${COMPOSITION_ID}.composition.json`);
const INDEX_FILE = path.join(PROJECT, 'images', 'segmentation', 'index.json');
const PACK = path.join(PROJECT, 'images', 'segmentation', 'poster-png');
const README_FILE = path.join(PROJECT, 'images', 'segmentation', 'README.md');
const HAS_WIRING = fs.existsSync(COMPOSITION_FILE) && fs.existsSync(INDEX_FILE);
const testWired = HAS_WIRING ? test : (name, fn) => test(name, { skip: 'run: node scripts/wire-borders-web-segmentation.js' }, fn);
const COMPOSITION_PREFIX = `/data/projects/${PROJECT_ID}/`;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const composition = HAS_WIRING ? readJson(COMPOSITION_FILE) : null;
const index = HAS_WIRING ? readJson(INDEX_FILE) : null;

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(target));
        else out.push(target);
    }
    return out;
}

function pngSize(file) {
    const buffer = fs.readFileSync(file);
    if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) {
        throw new Error(`Not a PNG: ${file}`);
    }
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function groupOf(layer) {
    return String(layer.segmentGroup || '').split(' / ').pop();
}

testWired('the segmented composition has 63 parts in 10 semantic groups', () => {
    assert.equal(composition.id, COMPOSITION_ID);
    assert.match(composition.id, /^[A-Za-z0-9_-]{1,80}$/, 'composition ids cannot contain dots');
    assert.equal(composition.width, 944);
    assert.equal(composition.height, 1130);
    assert.equal(composition.duration, 12000);
    assert.equal(composition.layers.length, 63);
    assert.equal(composition.meta.segmentation.counts.childLayers, 63);
    assert.equal(composition.meta.segmentation.counts.groups, 10);
    assert.equal(composition.meta.segmentation.counts.segmentedParents, 1);
    assert.equal(composition.meta.exactPoster, false);

    const groups = new Map();
    for (const layer of composition.layers) {
        const group = groupOf(layer);
        groups.set(group, (groups.get(group) || 0) + 1);
        assert.equal(layer.parentId, 'poster');
        assert.equal(layer.groupId, `poster--group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
        assert.match(layer.segmentGroup, /^Poster \(6s\) \/ /);
        assert.equal(layer.type, 'image');
        assert.equal(layer.visible, true);
        assert.equal(layer.fit, 'fill');
        assert.ok(layer.meta && layer.meta.segmentation, `${layer.id} has segmentation metadata`);
        assert.equal(layer.meta.segmentation.parentLayerId, 'poster');
        assert.equal(layer.meta.segmentation.parentName, 'Poster (6s)');
        assert.equal(layer.meta.segmentation.sourceWidth, 944);
        assert.equal(layer.meta.segmentation.sourceHeight, 1130);
        assert.ok(layer.meta.segmentation.objectLabel);
        assert.ok(layer.meta.segmentation.objectDescription);
        assert.ok(layer.meta.segmentation.localBox);
        assert.deepEqual(layer.keyframes.map((frame) => frame.time), [0, 12000]);
        assert.ok(layer.keyframes.every((frame) => frame.opacity === 1));
        assert.doesNotMatch(layer.meta.segmentation.objectLabel, /Line1|Line2/);
    }

    assert.deepEqual(Object.fromEntries(groups), {
        Background: 3,
        'Map Details': 3,
        Routes: 1,
        Kelso: 5,
        Markers: 17,
        Labels: 18,
        Icons: 5,
        Compass: 3,
        Header: 6,
        Footer: 2,
    });

    // The export's z put the background above the labels; the wired order is semantic.
    const zOrder = ['Background', 'Map Details', 'Routes', 'Kelso', 'Markers', 'Labels', 'Icons', 'Compass', 'Header', 'Footer'];
    let previous = -Infinity;
    for (const group of zOrder) {
        const zs = composition.layers.filter((layer) => groupOf(layer) === group).map((layer) => layer.z);
        assert.ok(Math.min(...zs) > previous, `${group} sits above the previous group`);
        previous = Math.max(...zs);
    }
});

testWired('every part file exists, is referenced once and matches its box', () => {
    assert.equal(pngSize(path.join(PROJECT, 'images', 'poster.png')).width, 944);
    const referenced = new Set();
    for (const layer of composition.layers) {
        assert.ok(layer.url.startsWith(`${COMPOSITION_PREFIX}images/segmentation/poster-png/images/`), layer.url);
        assert.doesNotMatch(path.basename(layer.url), /^\d+-/);
        const file = path.join(ROOT, layer.url.replace(/^\//, ''));
        assert.ok(fs.existsSync(file), `${layer.url} exists`);
        assert.ok(!referenced.has(file), `${layer.url} is referenced once`);
        referenced.add(file);
        const size = pngSize(file);
        const boxAspect = (layer.w / layer.h) * (944 / 1130);
        assert.ok(Math.abs(boxAspect - size.width / size.height) / (size.width / size.height) < 0.02,
            `${layer.id} box matches its PNG aspect`);
        assert.ok(layer.x >= 0 && layer.y >= 0 && layer.w > 0 && layer.h > 0);
        assert.ok(layer.x + layer.w <= 100.01 && layer.y + layer.h <= 100.01);
    }
    const files = walk(path.join(PACK, 'images')).filter((file) => file.toLowerCase().endsWith('.png'));
    assert.equal(files.length, 63);
    assert.equal(referenced.size, 63);
    for (const file of files) assert.ok(referenced.has(file), `${file} is referenced`);
    assert.equal(fs.existsSync(path.join(PROJECT, 'images', `${PROJECT_ID}-segmented`)), false, 'the raw export folder is gone');
});

testWired('the pack, the index and the composition agree', () => {
    const packLayers = readJson(path.join(PACK, 'layers.json'));
    const scene = readJson(path.join(PACK, 'scene.json'));
    const packComposition = readJson(path.join(PACK, 'compositions', 'poster-png.composition.json'));
    assert.equal(packLayers.width, 944);
    assert.equal(packLayers.height, 1130);
    assert.equal(packLayers.layers.length, 63);
    assert.equal(scene.objects.length, 63);
    assert.equal(packComposition.layers.length, 64, 'reference + 63 parts');
    const reference = packComposition.layers.find((layer) => layer.id === 'reference');
    assert.equal(reference.visible, false);
    assert.equal(reference.url, `${COMPOSITION_PREFIX}images/poster.png`);

    assert.equal(index.schema, 'studio/image-segmentation/1');
    assert.equal(index.projectId, PROJECT_ID);
    assert.equal(index.composition, `compositions/${COMPOSITION_ID}.composition.json`);
    assert.equal(index.parents.length, 1);
    assert.equal(index.parents[0].parentLayerId, 'poster');
    assert.equal(index.parents[0].childCount, 63);
    assert.equal(index.groups.length, 10);
    assert.equal(index.counts.childLayers, 63);
    assert.equal(index.corrections.length >= 5, true);

    const byId = new Map(composition.layers.map((layer) => [layer.id, layer]));
    for (const group of index.groups) {
        assert.equal(group.parts.length, group.objectCount);
        const memberIds = group.parts.map((part) => part.id);
        assert.deepEqual(new Set(memberIds), new Set(composition.layers.filter((layer) => layer.groupId === group.id).map((layer) => layer.id)));
        assert.ok(group.box && Number.isFinite(group.box.w) && Number.isFinite(group.box.h));
        for (const part of group.parts) {
            const layer = byId.get(part.id);
            assert.ok(layer, `${part.id} exists`);
            assert.deepEqual(layer.meta.segmentation.localBox, part.bbox);
        }
    }
    const packNames = new Set(packLayers.layers.map((layer) => layer.name));
    assert.equal(packNames.size, 63);
    for (const layer of composition.layers) {
        assert.ok(packNames.has(layer.meta.segmentation.objectName));
    }
});

testWired('the master poster and the editable archive are untouched', () => {
    const master = readJson(path.join(PROJECT, 'compositions', `${PROJECT_ID}.composition.json`));
    assert.equal(master.id, PROJECT_ID);
    assert.equal(master.layers.length, 1);
    assert.equal(master.layers[0].id, 'source-frame');
    assert.equal(master.layers[0].url, `${COMPOSITION_PREFIX}images/poster.png`);
    assert.equal(master.meta.exactPoster, true);
    assert.equal(master.sourceFacts.kind, 'html-stage-poster');

    const editable = readJson(path.join(PROJECT, 'compositions', `${PROJECT_ID}.editable.json`));
    assert.equal(editable.layers.length, 12);
    assert.equal(editable.duration, 12000);
    assert.equal(editable.layers[0].id, 'html-bg');
    assert.ok(editable.layers.every((layer) => !layer.parentId && !layer.meta?.segmentation));
});

testWired('the project canvas reads the segmented composition and builds its manifest', async () => {
    const loaded = await ProjectCanvas.readProject(PROJECT_ID, COMPOSITION_ID);
    assert.equal(loaded.project.compositionId, COMPOSITION_ID);
    assert.ok(loaded.project.compositions.includes(PROJECT_ID));
    assert.ok(loaded.project.compositions.includes(COMPOSITION_ID));
    assert.equal(loaded.composition.layers.length, 63);
    assert.equal(loaded.manifest.entities.length, 63);
    assert.equal(loaded.manifest.parents.length, 1);
    assert.equal(loaded.manifest.parents[0].id, 'poster');
    assert.equal(loaded.manifest.parents[0].name, 'Poster (6s)');
    assert.equal(loaded.manifest.parents[0].children.length, 63);
    assert.equal(loaded.manifest.groups.length, 10);

    const summary = ProjectManifest.summary(loaded.manifest);
    assert.equal(summary.layers, 63);
    assert.equal(summary.sources, 1);
    assert.equal(summary.groups, 10);
    assert.equal(summary.texts, 0);
    assert.equal(summary.segmented, 63);
    assert.equal(summary.durationMs, 12000);

    const context = ProjectManifest.context(loaded.manifest);
    for (const label of ['Poster (6s) / Background', 'Poster (6s) / Labels', 'Poster (6s) / Header', 'Poster (6s) / Footer']) {
        assert.ok(context.includes(label), `context includes ${label}`);
    }
    assert.ok(context.includes('Kaitleast Label'));
    assert.ok(ProjectManifest.find(loaded.manifest, 'compass needle', 3).some((hit) => /Compass Needle/i.test(hit.label)));
    assert.ok(ProjectManifest.find(loaded.manifest, 'kelso building', 4).some((hit) => /Kelso Building/i.test(hit.label)));
    assert.ok(ProjectManifest.find(loaded.manifest, 'kaitleast label', 4).some((hit) => /Kaitleast Label/i.test(hit.label)));

    // Explicitly requesting the base id still reads the untouched master.
    const master = await ProjectCanvas.readProject(PROJECT_ID, PROJECT_ID);
    assert.equal(master.project.compositionId, PROJECT_ID);
    assert.equal(master.composition.layers.length, 1);
});

testWired('the wiring script, index and human notes are in place', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'wire-borders-web-segmentation.js')));
    const readme = fs.readFileSync(README_FILE, 'utf8');
    assert.ok(readme.includes(`project=${PROJECT_ID}&composition=${COMPOSITION_ID}`));
    assert.ok(readme.includes('Review and corrections'));
    assert.ok(readme.includes('63 layers'));
    assert.equal(fs.existsSync(path.join(PROJECT, 'images', 'segmentation', '_source', 'README.md')), true);
});
