'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const animation = require('../src/client/asset-studio/animation');

/* Baked tracks are how Layer Studio motion reaches Studio Agent: sampled frames
   exported from the other engine and replayed as-is. */
function baked(overrides = {}) {
    return {
        id: 'imported',
        preset: animation.BAKED,
        label: 'Slow Zoom',
        start: 0,
        duration: 1000,
        frames: [
            { t: 0, a: 0.2, s: 1 },
            { t: 500, a: 0.6, s: 1.1 },
            { t: 1000, a: 1, s: 1.2 },
        ],
        ...overrides,
    };
}

test('baked tracks survive normalization where unknown preset names do not', () => {
    assert.equal(animation.isBaked(baked()), true);
    assert.equal(animation.events([baked()]).length, 1);
    assert.equal(animation.events([baked()])[0].id, 'imported');
    // A preset the engine does not know is still dropped: that is how an old
    // Layer Studio file used to lose parallax and clip animation silently.
    assert.equal(animation.events([{ preset: 'parallax', start: 0, duration: 1000 }]).length, 0);
    assert.equal(animation.events([{ preset: 'clipIris', start: 0, duration: 1000 }]).length, 0);
});

test('baked tracks reject empty frame lists and invalid timing', () => {
    assert.equal(animation.events([baked({ frames: [] })]).length, 0);
    assert.equal(animation.events([baked({ frames: undefined })]).length, 0);
    assert.equal(animation.events([baked({ duration: 0 })]).length, 0);
    assert.equal(animation.events([baked({ start: NaN })]).length, 0);
});

test('baked frames interpolate linearly, clamp outside the event, and default missing keys', () => {
    const event = baked();
    const at = time => animation.at(event, time);
    assert.deepEqual(
        { a: at(0).a, s: at(0).s, dx: at(0).dx, sy: at(0).sy },
        { a: 0.2, s: 1, dx: 0, sy: 1 },
    );
    assert.ok(Math.abs(at(250).a - 0.4) < 1e-9);
    assert.ok(Math.abs(at(250).s - 1.05) < 1e-9);
    assert.ok(Math.abs(at(750).a - 0.8) < 1e-9);
    // Before the start and after the end the first/last frame holds, which is
    // the `animation-fill-mode: both` behaviour of the source stage.
    assert.equal(at(-500).a, 0.2);
    assert.equal(at(5000).a, 1);
    assert.equal(at(5000).s, 1.2);
});

test('baked tracks respect their own start offset inside a track', () => {
    const event = baked({ start: 400 });
    const list = [event];
    assert.equal(animation.atTrack(list, 0).a, 0.2);
    assert.ok(Math.abs(animation.atTrack(list, 400).a - 0.2) < 1e-9);
    assert.ok(Math.abs(animation.atTrack(list, 900).a - 0.6) < 1e-9);
    assert.ok(Math.abs(animation.atTrack(list, 1400).a - 1) < 1e-9);
});

test('baked clip shapes interpolate point by point and circle by radius', () => {
    const poly = animation.at({
        preset: animation.BAKED,
        start: 0,
        duration: 100,
        frames: [
            { t: 0, clip: { shape: 'poly', points: [[0, 0], [0, 0], [0, 1], [0, 1]] } },
            { t: 100, clip: { shape: 'poly', points: [[0, 0], [1, 0], [1, 1], [0, 1]] } },
        ],
    }, 50);
    assert.deepEqual(poly.clip, { shape: 'poly', points: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] });

    const circle = animation.at({
        preset: animation.BAKED,
        start: 0,
        duration: 100,
        frames: [
            { t: 0, clip: { shape: 'circle', cx: .5, cy: .5, r: 0 } },
            { t: 100, clip: { shape: 'circle', cx: .5, cy: .5, r: .5 } },
        ],
    }, 25);
    assert.ok(Math.abs(circle.clip.r - 0.125) < 1e-9);
    assert.equal(circle.clip.shape, 'circle');
});

test('baked events sort with preset events and can be placed, removed and measured', () => {
    const list = animation.events([
        baked({ id: 'baked-late', start: 2000 }),
        { id: 'preset-first', preset: 'fadeIn', start: 0, duration: 900 },
    ]);
    assert.deepEqual(list.map(event => event.id), ['preset-first', 'baked-late']);
    assert.equal(animation.bakedDuration(baked()), 1000);
    assert.equal(animation.withoutEvent(list, 'baked-late').length, 1);
    assert.equal(animation.canPlace([{ id: 'x', preset: 'fadeIn', start: 0, duration: 900 }], { start: 900, duration: 1000 }, null), true);
    assert.equal(animation.canPlace([{ id: 'x', preset: 'fadeIn', start: 0, duration: 900 }], { start: 899, duration: 1000 }, null), false);
});

test('a baked track is labelled and grouped without breaking the preset UI helpers', () => {
    assert.equal(animation.groupOf(animation.BAKED), 'in');
    assert.equal(animation.durationFor(animation.BAKED), animation.DURATION);
    const kept = animation.events([baked()])[0];
    assert.equal(kept.label, 'Slow Zoom');
    assert.equal(kept.frames.length, 3);
});
