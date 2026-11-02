'use strict';
/** Pure contract tests for Business Asset Intelligence. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Intel = require('../src/shared/asset-intel.js');

const photo = (overrides = {}) => Intel.normalizeAsset({
    id: 'ast_test-photo-1',
    name: 'Test photo',
    class: 'food-product',
    role: 'photo',
    identity: { width: 2000, height: 1600, sha256: 'a'.repeat(64), format: 'jpg' },
    source: { kind: 'pack', packId: 'pack-1', brandId: 'brand-1', path: 'assets/photography/photo.jpg' },
    usage: { profile: 'print-and-screen', printMinDpi: 150, rights: 'brand-owned' },
    review: { state: 'verified' },
    ...overrides,
});

test('normalizeAsset clamps names, tags and unknown classes', () => {
    const asset = Intel.normalizeAsset({
        id: 'ast_clamp-test',
        name: `  ${'x'.repeat(200)}  `,
        class: 'not-a-class',
        tags: Array.from({ length: 30 }, (_, index) => `tag-${index}`),
        usage: { notes: 'y'.repeat(500), printMinDpi: 9999 },
    });
    assert.equal(asset.class, 'unclassified');
    assert.equal(asset.name.length, 120);
    assert.equal(asset.tags.length, 12);
    assert.equal(asset.usage.notes.length, 280);
    assert.equal(asset.usage.printMinDpi, 600);
});

test('operationsFor never returns an unexecutable operation', () => {
    assert.deepEqual(Intel.operationsFor('brand-identity'), ['resize', 'recolour', 'compose', 'preflight']);
    assert.ok(!Intel.operationsFor('content').includes('transcribe'));
    assert.ok(!Intel.operationsFor('business-document').includes('compose'));
});

test('evaluateUsage blocks missing consent for people and allows it when not applicable', () => {
    const person = photo({ class: 'people', role: 'photo', usage: { consent: 'missing', profile: 'print-and-screen' } });
    const missing = Intel.evaluateUsage(person, { profile: 'print', surface: 'print', size: { n: 'A4' }, spec: { w: 210, h: 297 } });
    assert.ok(missing.blockers.some((entry) => entry.code === 'CONSENT_MISSING'));
    const general = photo({ class: 'food-product', usage: { consent: 'not-applicable' } });
    const ok = Intel.evaluateUsage(general, { profile: 'print', surface: 'print', size: { n: 'A4' }, spec: { w: 210, h: 297 } });
    assert.ok(!ok.blockers.some((entry) => entry.code === 'CONSENT_MISSING'));
});

test('a screen-only asset is blocked for print but allowed for PNG', () => {
    const asset = photo({ usage: { profile: 'screen-only', rights: 'brand-owned' } });
    const print = Intel.evaluateUsage(asset, { profile: 'print', surface: 'print', size: { n: 'A4' }, spec: { w: 210, h: 297 } });
    assert.ok(print.blockers.some((entry) => entry.code === 'USAGE_PROFILE_BLOCK'));
    const screen = Intel.evaluateUsage(asset, { profile: 'screen', surface: 'export', size: { n: 'Square' } });
    assert.equal(screen.blockers.length, 0);
});

test('the DPI rule warns at 0.9x page resolution and blocks below half', () => {
    const page = { profile: 'print', surface: 'print', size: { n: 'A4 portrait', dpi: 150 }, spec: { w: 210, h: 297 } };
    const near = Intel.evaluateUsage(photo({ identity: { width: 1241, height: 1000 } }), page);
    assert.ok(near.warnings.some((entry) => entry.code === 'PRINT_DPI'));
    assert.ok(!near.blockers.some((entry) => entry.code === 'MIN_WIDTH'));
    const tiny = Intel.evaluateUsage(photo({ identity: { width: 500, height: 400 } }), page);
    assert.ok(tiny.blockers.some((entry) => entry.code === 'MIN_WIDTH'));
});

test('brandFit rewards an exact palette and flags a foreign one', () => {
    const exact = Intel.brandFit(photo({ identity: { width: 2000, height: 1600, palette: ['#eb5b3c'] }, role: 'logo' }), { palette: [{ hex: '#eb5b3c' }] });
    assert.ok(exact.score > 0.9);
    assert.equal(exact.paletteDelta, 0);
    const foreign = Intel.brandFit(photo({ identity: { width: 800, height: 600, palette: ['#00ff00'] }, role: 'photo' }), { palette: [{ hex: '#101040' }] });
    assert.ok(foreign.score < 0.55);
    assert.ok(foreign.warnings.includes('PALETTE_DRIFT'));
});

test('phashDistance groups a four-bit difference and separates a distant pair', () => {
    assert.equal(Intel.phashDistance('0000000000000000', '000000000000000f'), 4);
    assert.equal(Intel.phashDistance('ffffffffffffffff', '0000000000000000'), 64);
});

test('extractRowsFromText emits the studio tabular syntax', () => {
    const rows = Intel.extractRowsFromText('SMALL PLATES\nOlives | citrus | 4.50\nSourdough | butter | 5.00');
    assert.ok(rows.includes('# SMALL PLATES'));
    assert.ok(rows.some((row) => row.includes('| 4.50')));
});
