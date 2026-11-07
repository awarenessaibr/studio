'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    SPRITE_URLS,
    createCyclistAnimation,
    createLayeredAnimation,
} = require('../src/client/studio/layered-animation.js');

const tracks = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../src/client/studio/animations/butterfly-pig/motion-tracks.json'),
    'utf8',
));
const cyclistTracks = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../src/client/studio/animations/cyclist/motion-tracks.json'),
    'utf8',
));

test('creates all butterfly and pig motion as editable scene layers', () => {
    const { duration, layers } = createLayeredAnimation(
        tracks,
        { width: tracks.canvas.width, height: tracks.canvas.height },
        { zStart: 10, idPrefix: 'test-butterfly-pig' },
    );

    assert.equal(duration, 24600);
    assert.equal(layers.length, 30);
    assert.equal(new Set(layers.map((layer) => layer.id)).size, layers.length);
    assert.equal(layers.filter((layer) => layer.segmentGroup === 'Pig').length, 2);
    assert.equal(layers.filter((layer) => layer.segmentGroup.startsWith('Butterfly ')).length, 28);
    assert.equal(layers.find((layer) => layer.name === 'Pig (right-facing)').keyframes.length, 296);
    assert.deepEqual(
        layers.find((layer) => layer.name === 'Pig (right-facing)').keyframes[0],
        {
            time: 0,
            x: (250 - (135 * 1.043 * 717 / 549) / 2) / 1004 * 100,
            y: (470 - 135 * 1.043) / 650 * 100,
            w: (135 * 1.043 * 717 / 549) / 1004 * 100,
            h: 135 * 1.043 / 650 * 100,
            rotation: 0,
            opacity: 1,
        },
    );
    assert.ok(layers.every((layer) => layer.keyframes.length > 1
        && layer.keyframes.every((frame) => ['time', 'x', 'y', 'w', 'h', 'rotation', 'opacity']
            .every((property) => Number.isFinite(frame[property])))));
});

test('keeps butterflies hidden before their spawn time and switches facing variants', () => {
    const { layers } = createLayeredAnimation(
        tracks,
        { width: 1004, height: 650 },
        { idPrefix: 'test-butterfly-pig' },
    );
    const left = layers.find((layer) => layer.name === 'Butterfly 01 (left-facing)');
    const right = layers.find((layer) => layer.name === 'Butterfly 01 (right-facing)');

    assert.equal(left.url, SPRITE_URLS.butterfly.left);
    assert.equal(right.url, SPRITE_URLS.butterfly.right);
    assert.equal(left.keyframes[0].time, 0);
    assert.equal(left.keyframes[0].opacity, 0);
    assert.equal(right.keyframes[0].opacity, 0);
    assert.equal(left.keyframes[1].time, 833);
    assert.equal(left.keyframes[1].opacity, 0);
    assert.equal(right.keyframes[1].opacity, 1);
    assert.equal(layers.find((layer) => layer.name === 'Pig (left-facing)').url, SPRITE_URLS.pig.left);
});

test('fits the animation to the scene without distorting its aspect ratio', () => {
    const { layers } = createLayeredAnimation(
        tracks,
        { width: 1080, height: 1080 },
        { idPrefix: 'test-butterfly-pig' },
    );
    const rightPig = layers.find((layer) => layer.name === 'Pig (right-facing)');
    const frame = rightPig.keyframes[0];
    const originalRatio = (717 / 549);
    const fittedRatio = (frame.w / 100 * 1080) / (frame.h / 100 * 1080);

    assert.ok(Math.abs(originalRatio - fittedRatio) < 1e-10);
    assert.ok(frame.y > 0);
});

test('rejects invalid animation dimensions and layer identifiers', () => {
    assert.throws(
        () => createLayeredAnimation(tracks, { width: 0, height: 1080 }),
        /dimensions must be positive/,
    );
    assert.throws(
        () => createLayeredAnimation(tracks, { width: 1080, height: 1080 }, { idPrefix: 'bad id' }),
        /ID prefix is invalid/,
    );
});

test('imports the complete sidewalk-aligned cyclist ride as editable layers', () => {
    const { duration, layers } = createCyclistAnimation(
        cyclistTracks,
        { width: cyclistTracks.canvas.width, height: cyclistTracks.canvas.height },
        { zStart: 40, idPrefix: 'test-cyclist-ride' },
    );
    const frontWheel = layers.find((layer) => layer.name === 'bicycle-front-wheel');
    const torso = layers.find((layer) => layer.name === 'cyclist-torso');

    assert.equal(duration, 8000);
    assert.equal(layers.length, 6);
    assert.equal(new Set(layers.map((layer) => layer.id)).size, 6);
    assert.equal(frontWheel.keyframes.length, 81);
    assert.ok(Math.abs(frontWheel.keyframes[0].y - 59.479) < 1e-8);
    assert.ok(Math.abs(frontWheel.keyframes.at(-1).y - 65.164) < 1e-8);
    assert.ok(Math.abs(torso.keyframes[0].y - 53.381) < 1e-8);
    assert.ok(layers.every((layer) => layer.keyframes.length === 81
        && layer.keyframes.every((frame) => ['time', 'x', 'y', 'w', 'h', 'rotation', 'opacity']
            .every((property) => Number.isFinite(frame[property])))));
});

test('fits the cyclist ride to the target canvas without distorting layer geometry', () => {
    const { layers } = createCyclistAnimation(
        cyclistTracks,
        { width: 1080, height: 1080 },
        { zStart: 0, idPrefix: 'test-cyclist-ride' },
    );
    const frontWheel = layers.find((layer) => layer.name === 'bicycle-front-wheel');
    const frame = frontWheel.keyframes[0];
    const expectedRatio = (2.448 / 100 * cyclistTracks.canvas.width)
        / (4.254 / 100 * cyclistTracks.canvas.height);
    const actualRatio = (frame.w / 100 * 1080) / (frame.h / 100 * 1080);

    assert.ok(Math.abs(expectedRatio - actualRatio) < 1e-10);
    assert.ok(frame.y < frontWheel.keyframes.at(-1).y);
});
