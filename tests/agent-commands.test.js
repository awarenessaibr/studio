'use strict';
/**
 * Contract tests for agent-commands.js (layer-studio/agent-commands/v2).
 *
 * The module is DOM-free by design, so every rule in the schema — validation,
 * sandboxed apply, measurement, guardrails, snapshots and the five layout
 * concepts — can be exercised without a browser.
 */
const test = require('node:test');
const assert = require('node:assert');
const commands = require('../src/shared/agent-commands.js');

const SCHEMA = 'layer-studio/agent-commands/v2';

/** Monospace measurer: every character is half the font size wide. */
const monoFactory = ({ sizePx }) => ({
    sizePx,
    ascentRatio: 0.8,
    descentRatio: 0.2,
    measureWidth: (value) => String(value ?? '').length * sizePx * 0.5,
});

function textLayer(id, overrides = {}) {
    return {
        id,
        type: 'text',
        name: id,
        x: 8,
        y: 10,
        w: 84,
        h: 12,
        z: 10,
        opacity: 1,
        rotation: 0,
        visible: true,
        locked: false,
        bleed: false,
        role: 'background',
        text: 'Sample headline',
        font: { family: 'Georgia', weight: 300, sizePct: 6.2, lineHeight: 1.02, letterSpacingEm: 0, transform: 'none', style: 'normal' },
        color: '#17162e',
        align: 'left',
        overflow: 'clip',
        keyframes: [],
        ...overrides,
    };
}

function imageLayer(id, url, overrides = {}) {
    return {
        id,
        type: 'image',
        name: id,
        x: 0,
        y: 0,
        w: 100,
        h: 48,
        z: 2,
        opacity: 1,
        rotation: 0,
        visible: true,
        locked: false,
        bleed: true,
        role: 'background',
        url,
        frames: [url],
        fit: 'cover',
        keyframes: [],
        ...overrides,
    };
}

/** A small, deterministic stand-in for a real flyer. */
function flyer(overrides = {}) {
    return {
        id: 'test-flyer',
        name: 'Test flyer',
        width: 1000,
        height: 1400,
        duration: 10000,
        defaultLocale: 'en',
        revision: 0,
        activeFormatId: 'master',
        formats: [{
            id: 'master',
            isMaster: true,
            label: 'Master',
            channel: 'print',
            width: 1000,
            height: 1400,
            layerOverrides: {},
            variableValues: {},
        }],
        variables: [
            { id: 'headline', label: 'Headline', defaultValue: 'A table worth crossing town for' },
            { id: 'cta', label: 'Call to action', defaultValue: 'Book a table' },
        ],
        brandKit: {
            palette: [
                { name: 'Ink', hex: '#17162e' },
                { name: 'Vermilion', hex: '#eb5b3c' },
                { name: 'Bone', hex: '#ebe6e0' },
                { name: 'Chalk', hex: '#ffffff' },
                { name: 'Sand', hex: '#e8b58e' },
                { name: 'Umber', hex: '#6b4c35' },
            ],
            fonts: [{ family: 'Georgia' }, { family: 'Helvetica Neue' }],
            logos: [{ name: 'Wordmark', url: '/brand/logos/wordmark-white.svg' }],
        },
        guardrails: { enabled: true, block: true },
        showSafeZones: false,
        sourceFacts: {},
        layers: [
            imageLayer('ground', '/assets/ground.svg', { w: 100, h: 100, z: 0, fit: 'fill' }),
            imageLayer('photo', '/assets/photography/evening-food.jpg', { z: 2, h: 48 }),
            imageLayer('logo', '/brand/logos/wordmark-white.svg', { x: 37, y: 6, w: 26, h: 9, z: 8, fit: 'contain', bleed: false }),
            textLayer('headline', { y: 53, h: 16, z: 12, bindings: { text: 'headline' } }),
            textLayer('subhead', { y: 69.5, h: 5.5, z: 12, text: 'Find your cure.', font: { family: 'Georgia', weight: 400, sizePct: 2.4, lineHeight: 1.2, letterSpacingEm: 0.06 } }),
            textLayer('body', { y: 76, h: 8.5, z: 12, opacity: 0.78, text: 'Seasonal plates and a considered drinks list.', font: { family: 'Georgia', weight: 300, sizePct: 1.6, lineHeight: 1.45, letterSpacingEm: 0 } }),
            textLayer('cta', { y: 88.5, h: 3.1, z: 12, text: 'Book a table', font: { family: 'Helvetica Neue', weight: 400, sizePct: 1.7, lineHeight: 1.2, letterSpacingEm: 0.18, transform: 'uppercase' } }),
            textLayer('footer', { y: 85.2, h: 2.2, z: 12, opacity: 0.6, text: '129 South Street, St Andrews', font: { family: 'Helvetica Neue', weight: 400, sizePct: 1.05, lineHeight: 1.2, letterSpacingEm: 0.05 } }),
        ],
        ...overrides,
    };
}

function batchOf(list, overrides = {}, composition = flyer()) {
    return {
        schema: SCHEMA,
        sceneId: composition.id,
        baseRevision: commands.revisionOf(composition),
        formatId: 'master',
        commands: list,
        ...overrides,
    };
}

function codes(issues) {
    return (issues || []).map((entry) => entry.code);
}

const layerById = (composition, id) => composition.layers.find((layer) => layer.id === id);

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------
test('validateBatch accepts a well-formed batch', () => {
    const issues = commands.validateBatch(batchOf([{ type: 'set-layer', layerId: 'headline', patch: { y: 60 } }]));
    assert.deepStrictEqual(issues, []);
});

test('validateBatch rejects batch-level schema mistakes', () => {
    const missing = commands.validateBatch({ commands: [] });
    assert.ok(missing.length > 0);
    assert.ok(codes(missing).every((code) => code === 'SCHEMA'));
    assert.ok(missing.some((entry) => /"schema" must be/.test(entry.message)));
    assert.ok(missing.some((entry) => /"baseRevision"/.test(entry.message)));
    assert.ok(missing.some((entry) => /non-empty array/.test(entry.message)));

    const unknownField = commands.validateBatch(batchOf([{ type: 'set-scene-duration', durationMs: 5000 }], { surprise: true }));
    assert.ok(unknownField.some((entry) => /Unknown batch field "surprise"/.test(entry.message)));
});

test('validateBatch caps the command count (LIMIT_EXCEEDED)', () => {
    // The schema allows at most 100 commands per batch.
    const many = Array.from({ length: 101 }, () => ({ type: 'set-scene-duration', durationMs: 5000 }));
    const issues = commands.validateBatch(batchOf(many));
    assert.ok(codes(issues).includes('LIMIT_EXCEEDED'));
});

test('validateBatch rejects fields the schema does not allow', () => {
    // Regression: set-animation has no custom "params" field — custom motion must use set-keyframes.
    const withParams = commands.validateBatch(batchOf([{ type: 'set-animation', layerId: 'photo', preset: 'zoom', params: { from: 1.1 } }]));
    assert.ok(withParams.some((entry) => /Unknown field "params"/.test(entry.message)));

    const badPreset = commands.validateBatch(batchOf([{ type: 'set-animation', layerId: 'photo', preset: 'wobble' }]));
    assert.ok(badPreset.some((entry) => /"preset" must be one of/.test(entry.message)));

    const badReorder = commands.validateBatch(batchOf([{ type: 'reorder-layer', layerId: 'headline', z: 3, above: 'photo' }]));
    assert.ok(badReorder.some((entry) => /exactly one of z, above or below/.test(entry.message)));
});

test('validateBatch enforces keyframe rules', () => {
    const oneFrame = commands.validateBatch(batchOf([{ type: 'set-keyframes', layerId: 'photo', keyframes: [{ t: 0, values: { x: 1 } }] }]));
    assert.ok(oneFrame.some((entry) => /2-40 frames/.test(entry.message)));

    const unsorted = commands.validateBatch(batchOf([{
        type: 'set-keyframes',
        layerId: 'photo',
        keyframes: [{ t: 500, values: { x: 1 } }, { t: 100, values: { x: 2 } }],
    }]));
    assert.ok(unsorted.some((entry) => /sorted by t/.test(entry.message)));

    const badValue = commands.validateBatch(batchOf([{
        type: 'set-keyframes',
        layerId: 'photo',
        keyframes: [{ t: 0, values: { colour: 2 } }, { t: 100, values: { opacity: 2 } }],
    }]));
    assert.ok(badValue.some((entry) => /values\.colour" is not animatable/.test(entry.message)));
    assert.ok(badValue.some((entry) => /values\.opacity" must be 0-1/.test(entry.message)));
});

// ---------------------------------------------------------------------------
// Apply — every command type
// ---------------------------------------------------------------------------
test('applyBatch never mutates the composition it is given', () => {
    const composition = flyer();
    const before = JSON.parse(JSON.stringify(composition));
    const { composition: next } = commands.applyBatch(composition, batchOf([
        { type: 'set-layer', layerId: 'headline', patch: { y: 60 } },
    ], {}, composition), {});
    assert.deepStrictEqual(composition, before);
    assert.notStrictEqual(next, composition);
    assert.strictEqual(next.revision, 1);
});

test('set-variable writes the default and locale values', () => {
    const { result, composition: next } = commands.applyBatch(flyer(), batchOf([
        { type: 'set-variable', variableId: 'headline', value: 'A table worth staying for' },
        { type: 'set-variable', variableId: 'headline', value: 'Uma mesa que vale a pena', locale: 'pt-BR' },
    ]), {});
    assert.strictEqual(result.status, 'applied-to-sandbox');
    const variable = next.variables.find((entry) => entry.id === 'headline');
    assert.strictEqual(variable.defaultValue, 'A table worth staying for');
    assert.strictEqual(variable.values['pt-BR'], 'Uma mesa que vale a pena');
});

test('set-layer resolves palette names to hex', () => {
    const { result, composition: next } = commands.applyBatch(flyer(), batchOf([
        { type: 'set-layer', layerId: 'headline', patch: { color: 'Vermilion', y: 60, h: 15, opacity: 0.9 } },
    ]), {});
    assert.strictEqual(result.status, 'applied-to-sandbox');
    const layer = layerById(next, 'headline');
    assert.strictEqual(layer.color, '#eb5b3c');
    assert.strictEqual(layer.y, 60);
    assert.strictEqual(layer.h, 15);
    assert.strictEqual(layer.opacity, 0.9);
});

test('set-layer rejects out-of-range numbers instead of clamping them', () => {
    const { result, composition } = commands.applyBatch(flyer(), batchOf([
        { type: 'set-layer', layerId: 'headline', patch: { opacity: 4 } },
    ]), {});
    assert.strictEqual(result.status, 'rejected');
    assert.strictEqual(composition, null);
    assert.ok(result.errors.some((entry) => /"opacity" must be a number/.test(entry.message)));
});

test('add-layer desugars shapes and gradients into renderable layers', () => {
    const { composition: next } = commands.applyBatch(flyer(), batchOf([
        // A full-bleed decoration must say it is background, or SAFE_ZONE blocks it.
        { type: 'add-layer', layer: { id: 'scrim', type: 'gradient', role: 'background', box: { x: 0, y: 36, w: 100, h: 30 }, gradient: { angleDeg: 180, stops: [{ at: 0, color: 'rgba(107,76,53,0)' }, { at: 1, color: 'Umber' }] } } },
        { type: 'add-layer', layer: { id: 'rule', type: 'shape', shape: 'rect', fill: 'Vermilion', box: { x: 8, y: 44, w: 20, h: 0.6 } } },
    ]), {});
    const scrim = layerById(next, 'scrim');
    assert.strictEqual(scrim.type, 'image');
    assert.ok(/^data:image\/svg\+xml/.test(scrim.url));
    assert.strictEqual(scrim.fit, 'fill');
    assert.strictEqual(layerById(next, 'rule').type, 'image');
    assert.strictEqual(next.layers.length, 10);

    const bleedDrift = commands.applyBatch(flyer(), batchOf([
        { type: 'add-layer', layer: { id: 'wash', type: 'shape', fill: 'Bone', box: { x: 0, y: 0, w: 100, h: 20 } } },
    ]), {});
    assert.deepStrictEqual(codes(bleedDrift.result.errors), ['SAFE_ZONE'], 'new layers default to foreground');
});

test('duplicate-layer, reorder-layer and remove-layer edit the stack', () => {
    const { composition: next } = commands.applyBatch(flyer(), batchOf([
        { type: 'duplicate-layer', layerId: 'headline', newId: 'headline-copy', patch: { y: 20 } },
        { type: 'reorder-layer', layerId: 'headline-copy', below: 'photo' },
        { type: 'remove-layer', layerId: 'subhead' },
    ]), {});
    const copy = layerById(next, 'headline-copy');
    assert.ok(copy, 'the duplicate exists');
    assert.strictEqual(copy.y, 20);
    assert.ok(copy.z < layerById(next, 'photo').z);
    assert.strictEqual(layerById(next, 'subhead'), undefined);
});

test('swap-asset resolves a catalogue entry and a focus point', () => {
    const { composition: next } = commands.applyBatch(flyer(), batchOf([
        { type: 'swap-asset', layerId: 'photo', asset: { catalog: 'photography', name: 'evening food' }, focus: { x: 30, y: 60 } },
    ]), {});
    const photo = layerById(next, 'photo');
    assert.strictEqual(photo.focusX, 30);
    assert.strictEqual(photo.focusY, 60);
    assert.deepStrictEqual(photo.frames, ['/assets/photography/evening-food.jpg']);
});

test('set-animation expands a preset and clear-animation removes it', () => {
    const animated = commands.applyBatch(flyer(), batchOf([
        { type: 'set-animation', layerId: 'photo', preset: 'zoom', startMs: 0, durationMs: 10000 },
    ]), {}).composition;
    const frames = layerById(animated, 'photo').keyframes;
    assert.strictEqual(frames.length, 2);
    assert.strictEqual(frames[0].time, 0);
    assert.strictEqual(frames[1].time, 10000);
    assert.ok(frames[1].w > frames[0].w, 'zoom widens the layer');

    const cleared = commands.applyBatch(animated, batchOf([
        { type: 'clear-animation', layerId: 'photo' },
    ], {}, animated), {}).composition;
    assert.deepStrictEqual(layerById(cleared, 'photo').keyframes, []);
});

test('set-keyframes expands scale around the layer centre', () => {
    const { composition: next } = commands.applyBatch(flyer(), batchOf([
        {
            type: 'set-keyframes',
            layerId: 'headline',
            keyframes: [
                { t: 0, values: { scale: 1.1 } },
                { t: 10000, easing: 'ease-in-out', values: { scale: 1, opacity: 0.5 } },
            ],
        },
    ]), {});
    const [first, last] = layerById(next, 'headline').keyframes;
    assert.strictEqual(first.w, 84 * 1.1);
    assert.strictEqual(first.x, 8 - (84 * 1.1 - 84) / 2);
    assert.strictEqual(last.w, 84);
    assert.strictEqual(last.opacity, 0.5);
    assert.strictEqual(last.easing, 'easeInOut');
});

test('set-format creates a format with overrides and set-scene-duration retimes', () => {
    const { composition: next } = commands.applyBatch(flyer(), batchOf([
        { type: 'set-format', formatId: 'story', label: 'Story', channel: 'social', width: 1080, height: 1920, layerOverrides: { headline: { font: { sizePct: 8 }, y: 20 } } },
        { type: 'set-scene-duration', durationMs: 6000 },
    ]), {});
    const story = next.formats.find((format) => format.id === 'story');
    assert.strictEqual(next.activeFormatId, 'story');
    assert.strictEqual(story.width, 1080);
    assert.strictEqual(story.layerOverrides.headline.fontSizePct, 8);
    assert.strictEqual(story.layerOverrides.headline.y, 20);
    assert.strictEqual(next.duration, 6000);
});

// ---------------------------------------------------------------------------
// Atomicity, revision guard and layer guards
// ---------------------------------------------------------------------------
test('a failing command rejects the whole batch unless atomic is false', () => {
    const list = [
        { type: 'set-layer', layerId: 'headline', patch: { y: 60 } },
        { type: 'set-layer', layerId: 'ghost', patch: { y: 10 } },
    ];
    const atomic = commands.applyBatch(flyer(), batchOf(list), {});
    assert.strictEqual(atomic.result.status, 'rejected');
    assert.strictEqual(atomic.composition, null);
    assert.deepStrictEqual(codes(atomic.result.errors), ['UNKNOWN_LAYER']);

    const partial = commands.applyBatch(flyer(), batchOf(list, { atomic: false }), {});
    assert.strictEqual(partial.result.status, 'applied-to-sandbox');
    assert.deepStrictEqual(codes(partial.result.errors), ['UNKNOWN_LAYER']);
    assert.strictEqual(layerById(partial.composition, 'headline').y, 60, 'the valid command still applied');
});

test('stale revisions are rejected and ignoreRevision bypasses the check', () => {
    const composition = flyer({ revision: 4 });
    const stale = commands.applyBatch(composition, batchOf([{ type: 'set-scene-duration', durationMs: 6000 }], { baseRevision: 2 }, composition), {});
    assert.strictEqual(stale.result.status, 'rejected');
    assert.deepStrictEqual(codes(stale.result.errors), ['STALE_REVISION']);
    assert.match(stale.result.errors[0].suggestion, /baseRevision=4/);

    const forced = commands.applyBatch(composition, batchOf([{ type: 'set-scene-duration', durationMs: 6000 }], { baseRevision: 2 }, composition), { ignoreRevision: true });
    assert.strictEqual(forced.result.status, 'applied-to-sandbox');
    assert.strictEqual(forced.composition.revision, 5);
});

test('schema issues take precedence over STALE_REVISION', () => {
    const composition = flyer({ revision: 4 });
    const result = commands.applyBatch(composition, { schema: SCHEMA, sceneId: composition.id, baseRevision: 0, commands: [{ type: 'nope' }] }, {});
    assert.strictEqual(result.result.status, 'rejected');
    assert.ok(codes(result.result.errors).every((code) => code === 'SCHEMA'));
});

test('locked and protected layers cannot be patched', () => {
    const composition = flyer();
    layerById(composition, 'headline').locked = true;
    const locked = commands.applyBatch(composition, batchOf([{ type: 'set-layer', layerId: 'headline', patch: { y: 40 } }], {}, composition), {});
    assert.deepStrictEqual(codes(locked.result.errors), ['LOCKED_LAYER']);

    const protectedRun = commands.applyBatch(flyer(), batchOf([{ type: 'set-layer', layerId: 'logo', patch: { w: 30 } }]), {
        guardrails: { protectedLayerIds: ['logo'] },
    });
    assert.deepStrictEqual(codes(protectedRun.result.errors), ['PROTECTED_LAYER']);
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------
test('SAFE_ZONE blocks a layer pushed into the margin', () => {
    const { result } = commands.applyBatch(flyer(), batchOf([
        { type: 'set-layer', layerId: 'headline', patch: { x: 2 } },
    ]), {});
    assert.strictEqual(result.status, 'rejected');
    assert.ok(codes(result.errors).includes('SAFE_ZONE'));
});

test('guardrails report instead of blocking when the composition is non-blocking', () => {
    const composition = flyer({ guardrails: { enabled: true, block: false } });
    const { result, composition: next } = commands.applyBatch(composition, batchOf([
        { type: 'set-layer', layerId: 'headline', patch: { x: 2 } },
    ], {}, composition), {});
    assert.strictEqual(result.status, 'applied-to-sandbox');
    assert.deepStrictEqual(codes(result.errors), []);
    assert.ok(codes(result.warnings).includes('SAFE_ZONE'));
    assert.strictEqual(layerById(next, 'headline').x, 2);
});

test('BRAND_COLOR warns about a colour outside the palette', () => {
    const { result } = commands.applyBatch(flyer(), batchOf([
        { type: 'set-layer', layerId: 'headline', patch: { color: '#123456' } },
    ]), {});
    assert.strictEqual(result.status, 'applied-to-sandbox');
    assert.ok(codes(result.warnings).includes('BRAND_COLOR'));
    assert.ok(!codes(result.errors).includes('BRAND_COLOR'));
});

test('BRAND_FONT blocks a family outside the brand kit', () => {
    const { result } = commands.applyBatch(flyer(), batchOf([
        { type: 'set-layer', layerId: 'headline', patch: { font: { family: 'Comic Sans' } } },
    ]), {});
    assert.strictEqual(result.status, 'rejected');
    assert.ok(codes(result.errors).includes('BRAND_FONT'));
});

test('TEXT_OVERFLOW blocks a regression but tolerates pre-existing clipping', () => {
    const shrinkBatchOf = (composition) => batchOf([{ type: 'set-layer', layerId: 'headline', patch: { h: 3 } }], {}, composition);

    const finalize = (composition, batch) => {
        const applied = commands.applyBatch(composition, batch, { skipGuardrails: true });
        return commands.finalizeBatch(composition, batch, applied.composition, {
            measureFactory: monoFactory,
            touched: applied.touched,
            touchedVariables: applied.touchedVariables,
        });
    };

    const clean = flyer();
    const blocked = finalize(clean, shrinkBatchOf(clean));
    assert.strictEqual(blocked.result.status, 'rejected');
    assert.ok(codes(blocked.result.errors).includes('TEXT_OVERFLOW'));

    const alreadyClipped = flyer();
    layerById(alreadyClipped, 'headline').h = 3;
    const tolerance = finalize(alreadyClipped, batchOf([{ type: 'set-layer', layerId: 'headline', patch: { y: 54 } }], {}, alreadyClipped));
    assert.ok(!codes(tolerance.result.errors).includes('TEXT_OVERFLOW'), 'a layer that already clipped is not a regression');
});

test('NO_INVENTED_FACTS blocks new facts unless sourceFacts allows them', () => {
    const claim = 'Call 01334 555 123 or visit https://example.com';
    const blocked = commands.applyBatch(flyer(), batchOf([
        { type: 'set-layer', layerId: 'footer', patch: { text: claim } },
    ]), {});
    assert.strictEqual(blocked.result.status, 'rejected');
    assert.ok(codes(blocked.result.errors).includes('NO_INVENTED_FACTS'));

    const sourced = flyer({ sourceFacts: { phone: '01334 555 123', url: 'https://example.com' } });
    const allowed = commands.applyBatch(sourced, batchOf([
        { type: 'set-layer', layerId: 'footer', patch: { text: claim } },
    ], {}, sourced), {});
    assert.strictEqual(allowed.result.status, 'applied-to-sandbox');
    assert.ok(!codes(allowed.result.errors).includes('NO_INVENTED_FACTS'));
});

// ---------------------------------------------------------------------------
// Measurement + snapshot
// ---------------------------------------------------------------------------
test('measureBounds reports clipped text and natural height', () => {
    const composition = flyer();
    layerById(composition, 'headline').h = 2;
    const bounds = commands.measureBounds(composition, { measureFactory: monoFactory });
    const headline = bounds.find((entry) => entry.layerId === 'headline');
    assert.strictEqual(headline.clipped, true);
    assert.ok(headline.naturalHeightPct > 2);
    assert.strictEqual(bounds.find((entry) => entry.layerId === 'photo').clipped, false);
});

test('createSnapshot carries scene, render, assets, guardrails and facts', () => {
    const composition = flyer({ revision: 7, sourceFacts: { phone: '01334 555 123' } });
    const snapshot = commands.createSnapshot(composition, { measureFactory: monoFactory });
    assert.strictEqual(snapshot.revision, 7);
    assert.strictEqual(snapshot.scene.id, 'test-flyer');
    assert.strictEqual(snapshot.render.formatId, 'master');
    assert.strictEqual(snapshot.render.layerBounds.length, composition.layers.length);
    assert.deepStrictEqual(snapshot.assets.photography.map((entry) => entry.name), ['evening food']);
    assert.deepStrictEqual(snapshot.sourceFacts, { phone: '01334 555 123' });
    assert.strictEqual(snapshot.guardrails.rules.SAFE_ZONE, 'block');
    assert.strictEqual(snapshot.brandKit.palette.length, 6);
    assert.notStrictEqual(snapshot.scene, composition, 'the scene is a copy');
});

// ---------------------------------------------------------------------------
// Layout concepts
// ---------------------------------------------------------------------------
test('proposeLayoutVariants returns five schema-valid batches for the scene', () => {
    const composition = flyer();
    const variants = commands.proposeLayoutVariants(composition);
    assert.strictEqual(variants.length, 5);

    const ids = new Set(composition.layers.map((layer) => layer.id));
    variants.forEach((variant) => {
        assert.ok(variant.label, 'every concept has a label');
        assert.ok(variant.rationale, 'every concept explains itself');
        assert.ok(Array.isArray(variant.commands) && variant.commands.length > 0);
        assert.deepStrictEqual(commands.validateBatch(variant), [], `${variant.label} must validate`);
        assert.strictEqual(variant.baseRevision, commands.revisionOf(composition));
        variant.commands.forEach((command) => {
            const target = command.layerId || command.newId;
            if (target && command.type !== 'add-layer') assert.ok(ids.has(target), `${variant.label} targets ${target}`);
        });
    });
});

test('every layout concept applies cleanly to the scene', () => {
    const composition = flyer();
    commands.proposeLayoutVariants(composition).forEach((variant) => {
        const { result } = commands.applyBatch(composition, variant, { skipGuardrails: true });
        assert.strictEqual(result.status, 'applied-to-sandbox', `${variant.label}: ${JSON.stringify(result.errors)}`);
        assert.deepStrictEqual(codes(result.errors), []);
    });
});
