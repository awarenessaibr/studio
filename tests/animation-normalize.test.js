'use strict';
/**
 * Composition-style motion files (layer.keyframes) must produce the same track
 * shape as `agent-studio/animation/2`, so every surface can play them.
 */
const test = require('node:test');
const assert = require('node:assert');
const Normalize = require('../src/shared/animation-normalize.js');

function composition() {
    return {
        id: 'Butterfly-The-Stairs-gallery-reveal',
        name: 'Gallery reveal',
        width: 750,
        height: 1000,
        duration: 8000,
        layers: [
            {
                id: 'reference', type: 'image', x: 0, y: 0, w: 100, h: 100, opacity: 1, rotation: 0,
                keyframes: [],
            },
            {
                id: 'wall-art', type: 'image', x: 20, y: 30, w: 10, h: 12, opacity: 0, rotation: 0,
                keyframes: [
                    { time: 0, x: 20, y: 30, w: 10, h: 12, opacity: 0, rotation: 0 },
                    { time: 800, x: 25, y: 40, w: 12, h: 14, opacity: 1, rotation: 4 },
                    { time: 4000, x: 30, y: 50, w: 14, h: 16, opacity: 1, rotation: -2 },
                ],
            },
            {
                id: 'nested', type: 'image', x: 50, y: 50, w: 4, h: 4, opacity: 1, rotation: 10,
                animation: {
                    duration: 8000,
                    keyframes: [
                        { time: 0, x: 50, y: 50, w: 4, h: 4, opacity: 1, rotation: 10 },
                        { time: 2000, x: 52, y: 51, w: 5, h: 4, opacity: 0.5, rotation: 14 },
                    ],
                },
            },
        ],
    };
}

test('derives tracks from layer keyframes with the base geometry removed', () => {
    const normal = Normalize.normalize(composition(), { id: 'x', name: 'x' });
    assert.equal(normal.kind, 'composition');
    assert.equal(normal.duration, 8000);
    assert.equal(normal.tracks.length, 2, 'only animated layers produce tracks');
    const wall = normal.tracks.find((track) => track.layerId === 'wall-art');
    assert.ok(wall);
    const frames = wall.segments[0].frames;
    assert.equal(frames.length, 3);
    assert.deepEqual(frames[0], { t: 0, dx: 0, dy: 0, sx: 1, sy: 1, a: 0, r: 0 });
    assert.equal(frames[1].t, 800);
    assert.equal(frames[1].a, 1);
    assert.ok(Math.abs(frames[1].dx - 0.05) < 1e-9);
    assert.ok(Math.abs(frames[1].dy - 0.10) < 1e-9);
    assert.ok(Math.abs(frames[1].sx - 1.2) < 1e-9);
    assert.ok(Math.abs(frames[1].sy - (14 / 12)) < 1e-9);
    assert.equal(frames[1].r, 4);
    assert.equal(wall.segments[0].duration, 8000);
    assert.equal(normal.animation.tracks.length, 2);
    assert.equal(normal.composition.id, 'Butterfly-The-Stairs-gallery-reveal');
});

test('supports nested animation.keyframes and keeps track payloads untouched', () => {
    const nested = Normalize.normalize(composition(), {});
    const track = nested.tracks.find((item) => item.layerId === 'nested');
    assert.equal(track.segments[0].frames.length, 2);
    assert.equal(track.segments[0].frames[1].r, 4);

    const tracks = {
        id: 'a', name: 'A', duration: 5000,
        tracks: [{ layerId: 'x', segments: [{ start: 0, duration: 5000, frames: [{ t: 0 }, { t: 5000 }] }] }],
    };
    const normal = Normalize.normalize(tracks, {});
    assert.equal(normal.kind, 'tracks');
    assert.deepEqual(normal.animation, tracks);
    assert.equal(normal.tracks.length, 1);
});

test('empty motion stays empty and source video is playable', () => {
    assert.equal(Normalize.normalize({ id: 'x', layers: [] }, {}).kind, 'empty');
    assert.equal(Normalize.normalize({ id: 'x', tracks: [] }, {}).kind, 'empty');
    assert.equal(Normalize.isPlayable({ tracks: [] }, { sourceVideo: '/x.webm' }), true);
    assert.equal(Normalize.isPlayable({ layers: composition().layers }, {}), true);
});
