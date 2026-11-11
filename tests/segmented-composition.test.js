'use strict';

/**
 * Contract tests for the parented image-segmentation wiring in
 * data/projects/06----giovannin-senza-paura-reels-03.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const PROJECT = path.join(ROOT, 'data', 'projects', '06----giovannin-senza-paura-reels-03');
const COMPOSITION_FILE = path.join(PROJECT, 'compositions', '06----giovannin-senza-paura-reels-03.composition.json');
const BACKUP_FILE = path.join(PROJECT, 'compositions', '06----giovannin-senza-paura-reels-03.pre-segmentation.json.bak');
const INDEX_FILE = path.join(PROJECT, 'images', 'segmentation', 'index.json');
const HAS_WIRING = fs.existsSync(COMPOSITION_FILE) && fs.existsSync(BACKUP_FILE) && fs.existsSync(INDEX_FILE);
const nodeTest = require('node:test');
const testWired = HAS_WIRING
    ? nodeTest
    : (name, fn) => nodeTest(name, { skip: 'run: node scripts/wire-segmented-layers.js' }, fn);

const composition = HAS_WIRING ? JSON.parse(fs.readFileSync(COMPOSITION_FILE, 'utf8')) : null;
const backup = HAS_WIRING ? JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')) : null;
const index = HAS_WIRING ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) : null;

function childrenOf(parentId) {
    return composition.layers.filter((layer) => layer.parentId === parentId);
}

function parentById(id) {
    return backup.layers.find((layer) => layer.id === id);
}

testWired('the wired composition replaces four parents with 34 child layers', () => {
    assert.equal(backup.layers.length, 25);
    assert.equal(composition.layers.length, 55);
    assert.equal(composition.meta.segmentation.counts.segmentedParents, 4);
    assert.equal(composition.meta.segmentation.counts.childLayers, 34);
    assert.equal(composition.meta.segmentation.counts.groups, 8);
    assert.equal(composition.meta.agentAwareness.groups.length, 8);
    assert.equal(composition.meta.segmentation.indexFile, 'images/segmentation/index.json');
    assert.equal(composition.layers.some((layer) => layer.id === 'reference'), false);
    assert.equal(composition.layers.some((layer) => layer.id === 'm13-photo-t-sp-me-on'), true);
});

testWired('every child is linked to a parent and a semantic segment group', () => {
    const parents = ['html-bg', 'm04-photo-t-pby-sp-on', 'm05-shape-gradient', 'm15-photo-t-pop2-sp-mf-on'];
    const expected = new Map([
        ['html-bg', 10],
        ['m04-photo-t-pby-sp-on', 15],
        ['m05-shape-gradient', 2],
        ['m15-photo-t-pop2-sp-mf-on', 7],
    ]);
    for (const parentId of parents) {
        const children = childrenOf(parentId);
        assert.equal(children.length, expected.get(parentId), parentId);
        for (const child of children) {
            assert.match(child.id, /--seg-/);
            assert.equal(child.type, 'image');
            assert.equal(child.parentId, parentId);
            assert.ok(child.groupId);
            assert.ok(child.segmentGroup);
            assert.equal(child.fit, 'fill');
            assert.ok(child.meta.segmentation);
            assert.equal(child.meta.segmentation.parentLayerId, parentId);
            assert.ok(child.meta.segmentation.objectLabel);
            assert.ok(child.meta.segmentation.objectGroup);
            assert.ok(child.keyframes.length >= 2);
            assert.ok(child.z > parentById(parentId).z);
            assert.ok(child.z < parentById(parentId).z + 0.1);
            const file = path.join(ROOT, child.url.replace(/^\//, ''));
            assert.equal(fs.existsSync(file), true, `${child.name} asset exists`);
        }
    }
});

testWired('child keyframes preserve parent timing and stay inside the parent box', () => {
    for (const parent of [
        'html-bg',
        'm04-photo-t-pby-sp-on',
        'm05-shape-gradient',
        'm15-photo-t-pop2-sp-mf-on',
    ]) {
        const source = parentById(parent);
        const sourceTimes = source.keyframes.map((frame) => frame.time);
        for (const child of childrenOf(parent)) {
            assert.deepEqual(child.keyframes.map((frame) => frame.time), sourceTimes, `${child.id} times`);
            child.keyframes.forEach((frame, index) => {
                const parentFrame = source.keyframes[index];
                assert.ok(frame.x >= parentFrame.x - 0.002, `${child.id} x inside parent`);
                assert.ok(frame.y >= parentFrame.y - 0.002, `${child.id} y inside parent`);
                assert.ok(frame.x + frame.w <= parentFrame.x + parentFrame.w + 0.002, `${child.id} right edge`);
                assert.ok(frame.y + frame.h <= parentFrame.y + parentFrame.h + 0.002, `${child.id} bottom edge`);
                assert.equal(frame.opacity, parentFrame.opacity, `${child.id} opacity at ${frame.time}`);
                assert.equal(frame.easing, parentFrame.easing);
            });
        }
    }
});

testWired('the character head maps through the parent keyframe box', () => {
    const head = composition.layers.find((layer) => layer.id.includes('character-head'));
    assert.ok(head);
    assert.equal(head.parentId, 'm04-photo-t-pby-sp-on');
    assert.equal(head.segmentGroup, 'Photo (m04) / Character');
    const parent = parentById(head.parentId);
    const parentFrame = parent.keyframes[0];
    const local = head.meta.segmentation.localBox;
    assert.ok(Math.abs(head.keyframes[0].x - (parentFrame.x + local.x / 100 * parentFrame.w)) < 0.001);
    assert.ok(Math.abs(head.keyframes[0].w - (local.w / 100 * parentFrame.w)) < 0.001);
    assert.equal(head.meta.segmentation.objectDescription, "The peach-colored block forming the character's face.");
});

testWired('the segmentation index mirrors the composition map', () => {
    assert.equal(index.schema, 'studio/image-segmentation/1');
    assert.equal(index.counts.segmentedParents, 4);
    assert.equal(index.counts.childLayers, 34);
    assert.equal(index.counts.groups, 8);
    assert.equal(index.parents.length, 4);
    assert.equal(index.groups.length, 8);
    assert.ok(index.agentAwareness);
    assert.match(index.agentAwareness.summary, /34 semantic layers/);
    assert.ok(index.warnings.length === 0);
    assert.equal(index.parents.find((parent) => parent.parentLayerId === 'm04-photo-t-pby-sp-on').childCount, 15);
});

testWired('the wired composition keeps the full source layer inventory', () => {
    assert.equal(backup.layers.length - 4 + 34, composition.layers.length);
    assert.equal(composition.layers.filter((layer) => layer.parentId).length, 34);
    const groups = new Set(composition.layers.map((layer) => layer.segmentGroup).filter(Boolean));
    assert.equal(groups.size, 8);
    assert.ok(groups.has('Photo (m04) / Character'));
    assert.ok(groups.has('Photo (m15) / Subject'));
    assert.ok(groups.has('Background (html-bg) / Pattern Columns'));
});
