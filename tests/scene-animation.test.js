'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const sceneAnimation = require('../src/client/asset-studio/scene-animation');
const animation = require('../src/client/asset-studio/animation');

const projectDir = path.join(__dirname, '..', 'data', 'projects', 'Butterfly-The-Stairs');
const scene = JSON.parse(fs.readFileSync(
    path.join(projectDir, 'compositions', 'Butterfly-The-Stairs.composition.json'),
    'utf8',
));

test('scene animation manifests resolve all shipped scene layers and presets', () => {
    const dir = path.join(projectDir, 'animations');
    const files = fs.readdirSync(dir).filter((file) => {
        if (!file.endsWith('.animation.json')) return false;
        const value = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        return value.type === 'studio-scene-animation';
    });
    assert.equal(files.length, 3);

    files.forEach((file) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const normalized = sceneAnimation.validateManifest(manifest, scene);
        assert.ok(normalized.cues.length > 0, `${file} has cues`);
        const composed = sceneAnimation.applyManifest(scene, manifest);
        assert.equal(composed.duration, manifest.duration);
        assert.equal(composed.layers.length, scene.layers.length);
        assert.notStrictEqual(composed, scene);
    });
});

test('scene animation bakes delayed overlapping and looping cues without mutating the source', () => {
    const source = {
        id: 'test-scene',
        name: 'Test scene',
        duration: 3000,
        layers: [{
            id: 'lamp',
            x: 10,
            y: 20,
            w: 12,
            h: 18,
            rotation: 0,
            opacity: 1,
            keyframes: [],
        }],
    };
    const manifest = {
        version: 1,
        type: 'studio-scene-animation',
        id: 'lamp-motion',
        projectId: 'test-project',
        name: 'Lamp motion',
        sceneId: 'test-scene',
        duration: 4000,
        cues: [
            { layerId: 'lamp', preset: 'pulse', duration: 1000, delay: 500, loop: true },
            { layerId: 'lamp', preset: 'flicker', duration: 1200, delay: 500, loop: true },
        ],
    };

    const result = sceneAnimation.applyManifest(source, manifest);
    const layer = result.layers[0];
    assert.equal(result.duration, 4000);
    assert.equal(layer.keyframes.length, 101);
    assert.equal(layer.keyframes[0].time, 0);
    assert.equal(layer.keyframes.at(-1).time, 4000);
    assert.equal(layer.keyframes[0].x, 10);
    assert.equal(layer.keyframes[0].opacity, 1);
    assert.ok(layer.keyframes.some((frame) => frame.w > 12), 'pulse scales the base layer');
    assert.ok(layer.keyframes.some((frame) => frame.opacity < 1), 'flicker affects opacity');
    assert.deepEqual(source.layers[0].keyframes, [], 'the source scene remains untouched');
    assert.equal(source.duration, 3000);
});

test('scene animation manifests reject bad scene references, layers, presets, and timing', () => {
    const manifest = {
        version: 1,
        type: 'studio-scene-animation',
        id: 'valid-id',
        projectId: 'test-project',
        name: 'Valid animation',
        sceneId: 'test-scene',
        duration: 1000,
        cues: [{ layerId: 'lamp', preset: 'fadeIn', duration: 500 }],
    };
    const source = { id: 'test-scene', layers: [{ id: 'lamp' }] };
    assert.throws(() => sceneAnimation.validateManifest({ ...manifest, sceneId: 'other' }, source), /targets/);
    assert.throws(() => sceneAnimation.validateManifest({
        ...manifest,
        cues: [{ ...manifest.cues[0], layerId: 'missing' }],
    }, source), /missing layer/);
    assert.throws(() => sceneAnimation.validateManifest({
        ...manifest,
        cues: [{ ...manifest.cues[0], preset: 'not-a-preset' }],
    }, source), /unsupported preset/);
    assert.throws(() => sceneAnimation.validateManifest({
        ...manifest,
        cues: [{ ...manifest.cues[0], delay: 700 }],
    }, source), /ends after/);
});

test('flicker is a deterministic shared animation preset', () => {
    const event = { preset: 'flicker', start: 0, duration: 900 };
    assert.deepEqual(animation.at(event, 200), animation.at(event, 200));
    assert.ok(animation.at(event, 200).a < 1);
});
