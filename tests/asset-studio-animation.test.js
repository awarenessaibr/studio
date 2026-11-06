'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const animation = require('../src/client/asset-studio/animation');

test('timeline presets have unique IDs, groups, labels, and valid durations', () => {
    const ids = animation.PRESETS.map(([id]) => id);
    assert.equal(new Set(ids).size, ids.length);
    for (const [id, label, duration, group] of animation.PRESETS) {
        assert.ok(id);
        assert.ok(label);
        assert.ok(duration > 0 && duration <= animation.DURATION);
        assert.ok(animation.GROUPS.some(([groupId]) => groupId === group));
        assert.equal(animation.durationFor(id), duration);
        assert.equal(animation.groupOf(id), group);
    }
});

test('legacy single animations and new animation arrays normalize to ordered events', () => {
    const legacy = animation.events({ preset: 'fadeIn', start: 300, duration: 900 });
    assert.equal(legacy.length, 1);
    assert.match(legacy[0].id, /^legacy-/);

    const list = animation.events([
        { id: 'later', preset: 'fadeOut', start: 7000, duration: 900 },
        { id: 'first', preset: 'fadeIn', start: 300, duration: 900 },
    ]);
    assert.deepEqual(list.map(event => event.id), ['first', 'later']);
});

test('animation placement permits adjacent events and rejects overlaps', () => {
    const first = { id: 'first', preset: 'fadeIn', start: 0, duration: 900 };
    const second = { id: 'second', preset: 'fadeOut', start: 900, duration: 900 };
    assert.equal(animation.canPlace([first], second), true);
    assert.equal(animation.canPlace([first], { ...second, start: 899 }), false);
    assert.equal(animation.canPlace([first], { ...first, start: 0 }, 'first'), true);
});

test('one timeline event can be removed without clearing the rest of the track', () => {
    const track = [
        { id: 'enter', preset: 'fadeIn', start: 0, duration: 900 },
        { id: 'exit', preset: 'fadeOut', start: 7000, duration: 900 },
    ];
    assert.deepEqual(animation.withoutEvent(track, 'enter').map(event => event.id), ['exit']);
});

test('slot search finds open space forward and backward without overlap', () => {
    const events = [
        { id: 'a', preset: 'fadeIn', start: 0, duration: 1000 },
        { id: 'b', preset: 'fadeOut', start: 3000, duration: 1000 },
    ];
    assert.equal(animation.findSlot(events, 500, 1000), 1000);
    assert.equal(animation.findSlot(events, 3500, 1000, 8000, 'backward'), 2000);
    assert.equal(animation.findSlot(events, 0, 1000), 1000);
    assert.equal(animation.findSlot(events, 0, 8000), null);
});

test('an entrance followed by an exit plays sequentially on one track', () => {
    const track = [
        { id: 'enter', preset: 'fadeIn', start: 0, duration: 900 },
        { id: 'exit', preset: 'fadeOut', start: 7000, duration: 900 },
    ];
    assert.equal(animation.atTrack(track, 0).a, 0);
    assert.ok(animation.atTrack(track, 450).a > 0 && animation.atTrack(track, 450).a < 1);
    assert.equal(animation.atTrack(track, 4000).a, 1);
    assert.equal(animation.atTrack(track, 7000).a, 1);
    assert.equal(animation.atTrack(track, 7900).a, 0);
});

test('track evaluation handles one legacy event and unknown presets safely', () => {
    const legacy = { preset: 'fadeOut', start: 100, duration: 900 };
    assert.equal(animation.atTrack(legacy, 99).a, 1);
    assert.equal(animation.atTrack(legacy, 1000).a, 0);
    assert.deepEqual(animation.atTrack({ preset: 'unknown', start: 0, duration: 100 }, 50), { a: 1, dx: 0, dy: 0, s: 1 });
});
