'use strict';
/**
 * Library motion availability: no animation may be archived under a stale
 * status, and composition-style motion (layer keyframes) must play.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { auditLibrary } = require('../src/server/library-validation.js');
const Normalize = require('../src/shared/animation-normalize.js');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const PROJECTS = path.join(ROOT, 'data', 'projects');
const hasLibrary = fs.existsSync(path.join(LIB, 'index.json'));

test('library animation statuses match a fresh validation', { skip: !hasLibrary }, async () => {
    const { changes, index } = await auditLibrary({ root: ROOT, libraryDir: LIB, projectsDir: PROJECTS });
    assert.deepEqual(changes, [], `stale statuses: ${changes.map((change) => `${change.design}/${change.animation} ${change.from}→${change.to}`).join(', ')}`);
    assert.equal(index.schema, 'agent-studio/library/1');
});

test('composition-style motion normalises to playable tracks', { skip: !hasLibrary }, () => {
    const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
    const design = index.designs.find((entry) => entry.id === 'Butterfly-The-Stairs');
    assert.ok(design, 'the composition-style design is installed');
    const playable = design.animations.filter((entry) => {
        const payload = JSON.parse(fs.readFileSync(path.join(ROOT, entry.file.replace(/^\//, '')), 'utf8'));
        const normal = Normalize.normalize(payload, entry);
        return normal.tracks.length > 0 || entry.sourceVideo;
    });
    assert.ok(playable.length >= 3, `expected at least 3 playable motions, got ${playable.length}`);
    assert.ok(playable.every((entry) => entry.status === 'ok'));
    const gallery = playable.find((entry) => entry.id.includes('gallery-reveal'));
    assert.ok(gallery, 'gallery reveal is one of them');
    const payload = JSON.parse(fs.readFileSync(path.join(ROOT, gallery.file.replace(/^\//, '')), 'utf8'));
    const normal = Normalize.normalize(payload, gallery);
    assert.equal(normal.kind, 'composition');
    assert.ok(normal.tracks.length >= 60);
});
