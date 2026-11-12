'use strict';
/**
 * Regression tests for importing a project composition into Studio.
 *
 * The project files store absolute layer poses in keyframes; the layer-level
 * opacity is the frame-0 value (often 0 for a reveal). Studio used to keep it as
 * a multiplier, so every later opacity became 0 × 1 = 0 and the artwork never
 * appeared. Project scenes also need the same neutral stage as Project canvas
 * and Studio Agent instead of the white brand paper.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'studio.html'), 'utf8');

test('imported keyframes use absolute opacity, not the frame-0 multiplier', () => {
    const block = page.match(/function compositionToScene\(record\)\{[\s\S]*?\n\}/);
    assert.ok(block, 'compositionToScene is present');
    assert.match(block[0], /layer\.opacity=1;\s*\n\s*layer\.kf=keys;/);
    assert.match(block[0], /Imported keyframes are absolute poses/);
});

test('project compositions get the neutral project stage, templates keep their paper', () => {
    assert.match(page, /const fromProject=Boolean\(source&&\(source\.projectId\|\|source\.repositorySource\|\|source\.compositionId\)\);/);
    assert.match(page, /stage\.style\.background=fromProject\?'#111111':'';/);
});
