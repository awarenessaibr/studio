'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildHoleMask,
    countMask,
    growMask,
    inpaintRGBA,
} = require('../src/client/studio/segment-fill.js');

/**
 * A deterministic "paper" surface: a colour gradient plus high-frequency
 * grain, which is what the studio's cut-out artwork looks like. Flat fills
 * would let a blurry result pass as good.
 */
function texturedSurface(width, height) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    let state = 7;
    const random = () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            const grain = Math.floor(random() * 46) - 23;
            rgba[offset] = 132 + Math.round((x / width) * 44) + grain;
            rgba[offset + 1] = 74 + Math.round((y / height) * 32) + grain;
            rgba[offset + 2] = 96 + grain;
            rgba[offset + 3] = 255;
        }
    }
    return rgba;
}

function punchHole(rgba, width, mask, box) {
    for (let y = box.top; y < box.bottom; y += 1) {
        for (let x = box.left; x < box.right; x += 1) {
            const index = y * width + x;
            rgba[index * 4 + 3] = 0;
            mask[index] = 1;
        }
    }
}

test('buildHoleMask keeps only pixels a segment in front covers', () => {
    const width = 6;
    const height = 4;
    const target = new Uint8Array(width * height);
    const front = new Uint8Array(width * height);
    target[0] = 0;      // empty and covered -> hole
    front[0] = 255;
    target[1] = 0;      // empty but not covered -> kept
    front[1] = 10;
    target[2] = 120;    // visible artwork -> kept
    front[2] = 255;
    target[3] = 0;      // softly covered -> hole
    front[3] = 60;
    const { mask, count } = buildHoleMask(target, front, width, height);
    assert.equal(count, 2);
    assert.equal(mask[0], 1);
    assert.equal(mask[1], 0);
    assert.equal(mask[2], 0);
    assert.equal(mask[3], 1);
});

test('buildHoleMask honours coverage and custom thresholds', () => {
    const width = 4;
    const height = 1;
    const target = new Uint8Array(4);
    const front = new Uint8Array([255, 255, 255, 255]);
    const coverage = new Uint8Array([1, 0, 1, 0]);
    const { mask, count } = buildHoleMask(target, front, width, height, {
        coverage,
        frontThreshold: 200,
        targetThreshold: 8,
    });
    assert.equal(count, 2);
    assert.deepEqual(Array.from(mask), [1, 0, 1, 0]);
});

test('growMask only grows into allowed pixels', () => {
    const width = 5;
    const height = 1;
    const mask = new Uint8Array([0, 1, 0, 0, 0]);
    const allowed = new Uint8Array([1, 1, 1, 0, 1]);
    const grown = growMask(mask, width, height, allowed);
    assert.deepEqual(Array.from(grown), [1, 1, 1, 0, 0]);
});

test('inpaintRGBA fills the hole from the surrounding artwork', () => {
    const width = 120;
    const height = 90;
    const rgba = texturedSurface(width, height);
    const mask = new Uint8Array(width * height);
    punchHole(rgba, width, mask, { left: 40, right: 80, top: 30, bottom: 60 });
    const before = rgba.slice();
    const result = inpaintRGBA(rgba, width, height, mask, { iterations: 3 });

    assert.equal(result.filled, 40 * 30);
    assert.equal(result.data.length, rgba.length);

    // Every hole pixel is rebuilt, with no transparency left behind.
    let holeAlpha = 0;
    for (let i = 0; i < mask.length; i += 1) {
        if (mask[i]) holeAlpha += result.data[i * 4 + 3];
    }
    assert.equal(holeAlpha, 40 * 30 * 255);

    // Visible pixels are byte-identical: the fill must never repaint artwork.
    for (let i = 0; i < mask.length; i += 1) {
        if (mask[i]) continue;
        for (let channel = 0; channel < 4; channel += 1) {
            assert.equal(result.data[i * 4 + channel], before[i * 4 + channel], `pixel ${i} channel ${channel}`);
        }
    }

    // The fill matches the surrounding tone instead of inventing a colour.
    let ringSum = 0;
    let ringCount = 0;
    for (let y = 20; y < 70; y += 1) {
        for (let x = 30; x < 90; x += 1) {
            const index = y * width + x;
            if (mask[index]) continue;
            if (x >= 36 && x < 84 && y >= 26 && y < 64) continue;
            ringSum += result.data[index * 4 + 1];
            ringCount += 1;
        }
    }
    let fillSum = 0;
    let fillCount = 0;
    for (let y = 35; y < 55; y += 1) {
        for (let x = 45; x < 75; x += 1) {
            fillSum += result.data[(y * width + x) * 4 + 1];
            fillCount += 1;
        }
    }
    const ringMean = ringSum / ringCount;
    const fillMean = fillSum / fillCount;
    assert.ok(Math.abs(fillMean - ringMean) < 18, `expected the fill tone near the surroundings (${fillMean.toFixed(1)} vs ${ringMean.toFixed(1)})`);

    // And it keeps grain: a flat wash would have near-zero variance.
    let sum = 0;
    let sumSquares = 0;
    let count = 0;
    for (let y = 35; y < 55; y += 1) {
        for (let x = 45; x < 75; x += 1) {
            const value = result.data[(y * width + x) * 4 + 1];
            sum += value;
            sumSquares += value * value;
            count += 1;
        }
    }
    const variance = sumSquares / count - (sum / count) ** 2;
    assert.ok(variance > 8, `expected textured fill, variance was ${variance.toFixed(2)}`);
});

test('inpaintRGBA is deterministic and leaves the input buffer alone', () => {
    const width = 80;
    const height = 60;
    const rgba = texturedSurface(width, height);
    const mask = new Uint8Array(width * height);
    punchHole(rgba, width, mask, { left: 20, right: 50, top: 15, bottom: 40 });
    const original = rgba.slice();

    const first = inpaintRGBA(rgba, width, height, mask, { iterations: 3 });
    const second = inpaintRGBA(rgba, width, height, mask, { iterations: 3 });
    assert.deepEqual(Array.from(first.data), Array.from(second.data));
    assert.deepEqual(Array.from(rgba), Array.from(original));
});

test('inpaintRGBA returns a copy when there is nothing to fill', () => {
    const width = 8;
    const height = 8;
    const rgba = texturedSurface(width, height);
    const result = inpaintRGBA(rgba, width, height, new Uint8Array(width * height));
    assert.equal(result.filled, 0);
    assert.deepEqual(Array.from(result.data), Array.from(rgba));
    assert.notEqual(result.data, rgba);
});

test('inpaintRGBA rejects malformed buffers instead of drawing garbage', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    assert.throws(() => inpaintRGBA(rgba, 4, 4, new Uint8Array(4)), /one mask byte per pixel/i);
    assert.throws(() => inpaintRGBA(new Uint8ClampedArray(8), 4, 4, new Uint8Array(16)), /smaller than its stated/i);
    assert.throws(() => inpaintRGBA(rgba, 0, 4, new Uint8Array(16)), /positive width and height/i);
    assert.throws(() => buildHoleMask(new Uint8Array(4), new Uint8Array(4), 8, 8), /one alpha byte per pixel/i);
});

test('countMask counts holes', () => {
    assert.equal(countMask(new Uint8Array([0, 1, 1, 0, 1])), 3);
    assert.equal(countMask(new Uint8Array(0)), 0);
});
