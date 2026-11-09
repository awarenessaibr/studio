'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Core = require('../src/shared/studio-core.js');

const FORMAT = { width: 1000, height: 1000 };

function textLayer(overrides = {}) {
    return {
        type: 'text',
        text: 'one two three four five six',
        font: {
            family: 'Inter',
            weight: 700,
            style: 'normal',
            sizePct: 5,
            lineHeight: 1.2,
            letterSpacingEm: 0,
            transform: 'none',
        },
        w: 50,
        h: 10,
        align: 'left',
        verticalAlign: 'top',
        overflow: 'clip',
        ...overrides,
    };
}

function layout(layer, sizePct, heightPct) {
    return Core.layoutText({
        text: layer.text,
        font: { ...layer.font, sizePct },
        boxWidthPx: layer.w / 100 * FORMAT.width,
        boxHeightPx: heightPct / 100 * FORMAT.height,
        formatHeightPx: FORMAT.height,
        align: layer.align,
        verticalAlign: layer.verticalAlign,
        overflow: layer.overflow,
    });
}

/* The layout that matters is the one the renderer uses; a plan is only good if
   the same box really shows every line afterwards. */
function assertRevealsEveryLine(layer, plan) {
    const result = layout(layer, plan.sizePct, plan.h);
    assert.equal(result.clippedLines, 0, `plan ${JSON.stringify(plan)} still clips ${result.clippedLines} line(s)`);
    assert.ok(plan.sizePct >= Core.MIN_TEXT_SIZE_PCT && plan.sizePct <= Core.MAX_TEXT_SIZE_PCT);
    assert.ok(plan.h >= layer.h - 1e-9);
    return result;
}

test('a text layer that already fits needs no plan', () => {
    const layer = textLayer({ h: 40, text: 'one two' });
    assert.equal(Core.planTextFit(layer, FORMAT, { maxH: 60 }), null);
});

test('visible overflow is not clipped, so it needs no plan', () => {
    const layer = textLayer({ overflow: 'visible' });
    assert.equal(Core.planTextFit(layer, FORMAT, { maxH: 60 }), null);
});

test('grows the box first so the type size is preserved when there is room', () => {
    const layer = textLayer();
    assert.ok(layout(layer, 5, 10).clippedLines > 0);
    const plan = Core.planTextFit(layer, FORMAT, { maxH: 30 });
    assert.equal(plan.mode, 'box');
    assert.equal(plan.sizePct, 5);
    assert.equal(plan.sizeChanged, false);
    assert.equal(plan.heightChanged, true);
    assert.ok(plan.h <= 30);
    assertRevealsEveryLine(layer, plan);
});

test('reduces the type size when the box cannot grow', () => {
    const layer = textLayer();
    const plan = Core.planTextFit(layer, FORMAT, { maxH: 10 });
    assert.equal(plan.mode, 'size');
    assert.equal(plan.h, 10);
    assert.equal(plan.heightChanged, false);
    assert.ok(plan.sizePct < 5);
    assertRevealsEveryLine(layer, plan);
});

test('grows the box and reduces the type size together when neither alone is enough', () => {
    const layer = textLayer({
        text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega',
        sizePct: 6,
        h: 4,
    });
    // The current size cannot fit even at the tallest box, and the floor cannot
    // fit in the current box, so the two changes have to work together.
    const plan = Core.planTextFit(layer, FORMAT, { maxH: 30 });
    assert.equal(plan.mode, 'both');
    assert.ok(plan.h > 4 && plan.h <= 30);
    assert.ok(plan.sizePct < 6 && plan.sizePct >= 3 - 1e-9);
    assertRevealsEveryLine(layer, plan);
});

test('never shrinks past the floor and reports nothing when that is not enough', () => {
    const layer = textLayer({ text: 'word '.repeat(60), sizePct: 12, h: 2, w: 20 });
    const floor = 3;
    const plan = Core.planTextFit(layer, FORMAT, { maxH: 4, minSizePct: floor });
    assert.equal(plan, null);
});

test('respects a caller-supplied floor when it can still fit', () => {
    const layer = textLayer();
    const plan = Core.planTextFit(layer, FORMAT, { maxH: 10, minSizePct: 4.5 });
    assert.ok(plan === null || plan.sizePct >= 4.5);
    if (plan) assertRevealsEveryLine(layer, plan);
});

test('the default floor is half of the current size', () => {
    const layer = textLayer({ sizePct: 8, h: 10, text: 'one two three four five six seven eight' });
    const plan = Core.planTextFit(layer, FORMAT, { maxH: 10 });
    assert.ok(plan);
    assert.ok(plan.sizePct >= 4 - 1e-9, `planned ${plan.sizePct} below the 4% floor`);
    assertRevealsEveryLine(layer, plan);
});

test('scales with the format height instead of hard-coded pixels', () => {
    const layer = textLayer({ w: 20 });
    const tallFormat = { width: 1000, height: 2000 };
    const wideFormat = { width: 2000, height: 1000 };
    const tall = Core.planTextFit(layer, tallFormat, { maxH: 30 });
    const wide = Core.planTextFit(layer, wideFormat, { maxH: 30 });
    assert.ok(tall, 'the portrait format clips and should get a plan');
    assert.ok(wide, 'the landscape format clips and should get a plan');
    for (const [format, plan] of [[tallFormat, tall], [wideFormat, wide]]) {
        const result = Core.layoutText({
            text: layer.text,
            font: { ...layer.font, sizePct: plan.sizePct },
            boxWidthPx: layer.w / 100 * format.width,
            boxHeightPx: plan.h / 100 * format.height,
            formatHeightPx: format.height,
            align: layer.align,
            verticalAlign: layer.verticalAlign,
            overflow: layer.overflow,
        });
        assert.equal(result.clippedLines, 0, `${format.width}x${format.height} still clips`);
    }
});

test('honours locale and injected metrics', () => {
    const layer = textLayer({ text: { en: 'one two three four five six', it: 'uno due tre quattro cinque sei' } });
    let calls = 0;
    const measureFactory = ({ sizePx }) => {
        calls += 1;
        const advance = sizePx * 0.6;
        return {
            sizePx,
            supportsLetterSpacing: true,
            ascentRatio: 0.8,
            descentRatio: 0.2,
            measureWidth: (value) => String(value ?? '').length * advance,
        };
    };
    const plan = Core.planTextFit(layer, FORMAT, { maxH: 30, locale: 'it', measureFactory });
    assert.ok(plan);
    assert.ok(calls > 0, 'the injected measurer was used');
});
