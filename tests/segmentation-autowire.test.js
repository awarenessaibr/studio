'use strict';

/**
 * Contract tests for the automatic image-to-layers → Studio segmentation import.
 *
 * The reference case is borders-web-where-i-work-animated-03, whose provisional
 * `<project>-segmented` project was imported into the target and archived.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ProjectManifest = require('../src/shared/project-manifest.js');
const ProjectCanvas = require('../src/server/project-canvas.js');
const Wiring = require('../src/server/segmentation-wiring.js');

const ROOT = path.join(__dirname, '..');
const PROJECT_ID = 'borders-web-where-i-work-animated-03';
const COMPOSITION_ID = `${PROJECT_ID}-segmented`;
const SOURCE_ID = `${PROJECT_ID}-segmented`;
const PROJECT = path.join(ROOT, 'data', 'projects', PROJECT_ID);
const COMPOSITION_FILE = path.join(PROJECT, 'compositions', `${COMPOSITION_ID}.composition.json`);
const INDEX_FILE = path.join(PROJECT, 'images', 'segmentation', 'index.json');
const PACK = path.join(PROJECT, 'images', 'segmentation', 'source-frame-png');
const ARCHIVE = path.join(PROJECT, 'images', 'segmentation', '_source', SOURCE_ID);
const HAS_IMPORT = fs.existsSync(COMPOSITION_FILE) && fs.existsSync(INDEX_FILE);
const testImported = HAS_IMPORT ? test : (name, fn) => test(name, { skip: 'run: npm run wire:segmentation -- <target>-segmented' }, fn);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const composition = HAS_IMPORT ? readJson(COMPOSITION_FILE) : null;
const index = HAS_IMPORT ? readJson(INDEX_FILE) : null;

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
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function groupOf(layer) {
    return String(layer.segmentGroup || '').split(' / ').pop();
}

test('the semantic stack orders common segmentation groups', () => {
    assert.equal(Wiring.groupRank('Background'), 1);
    assert.equal(Wiring.groupRank('Map Base'), 10);
    assert.equal(Wiring.groupRank('Routes'), 20);
    assert.equal(Wiring.groupRank('Map Markers'), 30);
    assert.equal(Wiring.groupRank('Map Labels'), 40);
    assert.equal(Wiring.groupRank('Map Icons'), 50);
    assert.equal(Wiring.groupRank('Typography'), 60);
    assert.equal(Wiring.groupRank('Branding'), 70);
    assert.ok(Wiring.groupRank('Unheard-of Group') < Wiring.groupRank('Footer'));
});

test('a local part box maps into the parent image rectangle', () => {
    const parent = {
        x: 10, y: 10, w: 20, h: 20, fit: 'fill',
        size: { width: 100, height: 100 },
        keyframes: [{ time: 0, x: 10, y: 10, w: 20, h: 20, rotation: 0, opacity: 1 }],
    };
    const frames = Wiring.childKeyframes(parent, { x: 50, y: 50, w: 50, h: 50 }, { composition: { width: 100, height: 100 } }, 1000);
    assert.equal(frames.length, 2);
    assert.deepEqual(
        { x: frames[0].x, y: frames[0].y, w: frames[0].w, h: frames[0].h },
        { x: 20, y: 20, w: 10, h: 10 },
    );
    assert.equal(frames[1].time, 1000);
    assert.deepEqual(
        { x: frames[1].x, y: frames[1].y, w: frames[1].w, h: frames[1].h },
        { x: 20, y: 20, w: 10, h: 10 },
    );

    const contain = Wiring.renderedRect({ x: 0, y: 0, w: 100, h: 100 }, 'contain', 1000, 1000, 1000, 500);
    assert.deepEqual(contain, { x: 0, y: 25, w: 100, h: 50 });
});

testImported('the import replaced the poster layer with 55 parts in 8 groups', () => {
    assert.equal(composition.id, COMPOSITION_ID);
    assert.equal(composition.duration, 13000);
    assert.equal(composition.width, 928);
    assert.equal(composition.height, 1143);
    assert.equal(composition.layers.length, 55);
    assert.equal(composition.meta.segmentation.counts.childLayers, 55);
    assert.equal(composition.meta.segmentation.counts.groups, 8);
    assert.equal(composition.meta.segmentation.parents.length, 1);
    assert.equal(composition.meta.segmentation.parents[0].parentLayerId, 'source-frame');
    assert.equal(composition.meta.segmentation.parents[0].parentName, 'Poster');
    assert.equal(composition.meta.exactPoster, false);
    assert.match(composition.name, /— Segmented$/);

    const groups = new Map();
    for (const layer of composition.layers) {
        const group = groupOf(layer);
        groups.set(group, (groups.get(group) || 0) + 1);
        assert.equal(layer.parentId, 'source-frame');
        assert.equal(layer.groupId, `source-frame--group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
        assert.match(layer.segmentGroup, /^Poster \/ /);
        assert.equal(layer.type, 'image');
        assert.ok(layer.meta.segmentation.objectLabel);
        assert.ok(layer.meta.segmentation.objectDescription);
        assert.ok(layer.meta.segmentation.localBox);
        assert.deepEqual(layer.keyframes.map((frame) => frame.time), [0, 13000]);
        assert.ok(layer.keyframes.every((frame) => frame.opacity === 1));
        assert.ok(layer.z > 0 && layer.z < 1, `${layer.id} z is in the parent slot`);
    }
    assert.deepEqual(Object.fromEntries(groups), {
        Background: 1,
        'Map Base': 3,
        Routes: 6,
        'Map Markers': 19,
        'Map Labels': 19,
        'Map Icons': 2,
        Typography: 2,
        Branding: 3,
    });

    const order = ['Background', 'Map Base', 'Routes', 'Map Markers', 'Map Labels', 'Map Icons', 'Typography', 'Branding'];
    let previous = -Infinity;
    for (const group of order) {
        const zs = composition.layers.filter((layer) => groupOf(layer) === group).map((layer) => layer.z);
        assert.ok(Math.min(...zs) > previous, `${group} is above the previous group`);
        previous = Math.max(...zs);
    }
});

testImported('every part has a canonical file, URL and matching aspect', () => {
    const referenced = new Set();
    for (const layer of composition.layers) {
        assert.ok(layer.url.startsWith(`/data/projects/${PROJECT_ID}/images/segmentation/source-frame-png/images/`), layer.url);
        const file = path.join(ROOT, layer.url.replace(/^\//, ''));
        assert.ok(fs.existsSync(file), `${layer.url} exists`);
        assert.ok(!referenced.has(file));
        referenced.add(file);
        const size = pngSize(file);
        const boxAspect = (layer.w / layer.h) * (928 / 1143);
        assert.ok(Math.abs(boxAspect - size.width / size.height) / (size.width / size.height) < 0.03);
    }
    const files = walk(path.join(PACK, 'images')).filter((file) => file.endsWith('.png'));
    assert.equal(files.length, 55);
    assert.equal(referenced.size, 55);
    for (const file of files) assert.ok(referenced.has(file));
});

testImported('the pack, index and composition agree', () => {
    const packLayers = readJson(path.join(PACK, 'layers.json'));
    const scene = readJson(path.join(PACK, 'scene.json'));
    const packComposition = readJson(path.join(PACK, 'compositions', 'source-frame-png.composition.json'));
    assert.equal(packLayers.width, 928);
    assert.equal(packLayers.height, 1143);
    assert.equal(packLayers.layers.length, 55);
    assert.equal(scene.objects.length, 54, 'the scene describes 54 objects; unassigned pixels are the extra part');
    assert.equal(packComposition.layers.length, 56, 'reference + 55 parts');
    const reference = packComposition.layers.find((layer) => layer.id === 'reference');
    assert.equal(reference.visible, false);
    assert.equal(reference.url, `/data/projects/${PROJECT_ID}/images/poster.png`);

    assert.equal(index.schema, 'studio/image-segmentation/1');
    assert.equal(index.composition, `compositions/${COMPOSITION_ID}.composition.json`);
    assert.equal(index.parents.length, 1);
    assert.equal(index.parents[0].childCount, 55);
    assert.equal(index.groups.length, 8);
    assert.equal(index.counts.childLayers, 55);
    const memberIds = new Set(composition.layers.map((layer) => layer.id));
    for (const group of index.groups) {
        assert.equal(group.parts.length, group.objectCount);
        assert.ok(group.box && Number.isFinite(group.box.w));
        for (const part of group.parts) {
            assert.ok(memberIds.has(part.id));
            const layer = composition.layers.find((entry) => entry.id === part.id);
            assert.deepEqual(layer.meta.segmentation.localBox, part.bbox);
        }
    }
});

testImported('the master, editable archive and source export are handled correctly', () => {
    const master = readJson(path.join(PROJECT, 'compositions', `${PROJECT_ID}.composition.json`));
    assert.equal(master.layers.length, 1);
    assert.equal(master.layers[0].id, 'source-frame');
    assert.equal(master.meta.exactPoster, true);
    const editable = readJson(path.join(PROJECT, 'compositions', `${PROJECT_ID}.editable.json`));
    assert.equal(editable.layers.length, 12);
    assert.ok(editable.layers.every((layer) => !layer.parentId && !layer.meta?.segmentation));
    assert.equal(fs.existsSync(path.join(ROOT, 'data', 'projects', SOURCE_ID)), false, 'the provisional project is removed');
    assert.ok(fs.existsSync(path.join(ARCHIVE, 'layers.json')));
    assert.ok(fs.existsSync(path.join(ARCHIVE, 'scene.json')));
    assert.ok(fs.existsSync(path.join(ARCHIVE, 'images', 'reference.png')));
});

testImported('the project canvas reads the imported composition and its manifest', async () => {
    const loaded = await ProjectCanvas.readProject(PROJECT_ID, COMPOSITION_ID);
    assert.equal(loaded.project.compositionId, COMPOSITION_ID);
    assert.ok(loaded.project.compositions.includes(PROJECT_ID));
    assert.ok(loaded.project.compositions.includes(COMPOSITION_ID));
    assert.equal(loaded.composition.layers.length, 55);
    assert.equal(loaded.manifest.entities.length, 55);
    assert.equal(loaded.manifest.parents.length, 1);
    assert.equal(loaded.manifest.parents[0].name, 'Poster');
    assert.equal(loaded.manifest.parents[0].children.length, 55);
    assert.equal(loaded.manifest.groups.length, 8);

    const summary = ProjectManifest.summary(loaded.manifest);
    assert.equal(summary.layers, 55);
    assert.equal(summary.sources, 1);
    assert.equal(summary.groups, 8);
    assert.equal(summary.durationMs, 13000);

    const context = ProjectManifest.context(loaded.manifest);
    assert.ok(context.includes('Poster / Map Labels'));
    assert.ok(context.includes('Poster / Branding'));
    assert.ok(ProjectManifest.find(loaded.manifest, 'hawick label', 3).some((hit) => /hawick/i.test(hit.label)));
    assert.ok(ProjectManifest.find(loaded.manifest, 'main title', 3).some((hit) => /title/i.test(hit.label)));
    assert.ok(ProjectManifest.find(loaded.manifest, 'brand orange dot', 3).some((hit) => /brand/i.test(hit.label)));

    const master = await ProjectCanvas.readProject(PROJECT_ID, PROJECT_ID);
    assert.equal(master.composition.layers.length, 1);
});

testImported('the wiring script and generated README are in place', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'wire-segmentation-project.js')));
    const readme = fs.readFileSync(path.join(PROJECT, 'images', 'segmentation', 'README.md'), 'utf8');
    assert.ok(readme.includes(`project=${PROJECT_ID}&composition=${COMPOSITION_ID}`));
    assert.ok(readme.includes('55 parts'));
    assert.ok(readme.includes('Group'));
});
