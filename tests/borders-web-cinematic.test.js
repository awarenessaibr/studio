'use strict';
/**
 * Borders Web — Where I work, cinematic & minimal.
 *
 * Six frame-stepped treatments. The deck uses relative map JPGs; the six
 * images are archived next to the HTML so the capture page is complete.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('Borders Web cinematic/minimal: six frame-stepped treatments', () => {
    const designs = read(path.join(LIB, 'sources', 'borders-web-cinematic.json')).designs;
    const index = read(path.join(LIB, 'index.json'));
    const byId = new Map(index.designs.map((design) => [design.id, design]));
    assert.equal(designs.length, 6);

    for (const design of designs) {
        const entry = byId.get(design.id);
        assert.equal(entry.status, 'ready');
        assert.equal(entry.brandId, 'borders-web');
        assert.equal(entry.sourceVideo, `/data/library/sources/${design.id}.webm`);
        assert.equal(entry.width, design.width);
        assert.equal(entry.height, design.height);
        assert.equal(entry.duration, design.duration);
        const video = path.join(ROOT, entry.sourceVideo.replace(/^\//, ''));
        assert.ok(fs.statSync(video).size > 1000);
        const detail = read(path.join(LIB, 'designs', `${design.id}.json`));
        assert.equal(detail.layers.length, 1);
        const poster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
        assert.equal(sha(poster), design.posterSha256);
    }
    assert.equal(new Set(designs.map((design) => design.name)).size, 6);
});

test('Borders Web cinematic/minimal: deck and map JPGs are archived', () => {
    const html = path.join(LIB, 'sources', 'html', 'borders-web-where-cinematic.html');
    assert.ok(fs.existsSync(html));
    for (const image of [
        'image_da26ebfa.jpg', 'image_b7b9e3d9.jpg', 'image_d969e05e.jpg',
        'image_238b2eaa.jpg', 'image_ad17fff0.jpg', 'image_36ae8d8a.jpg',
    ]) {
        assert.ok(fs.existsSync(path.join(LIB, 'sources', 'html', image)), image);
    }
});

test('Borders Web cinematic/minimal: editable effect compositions and AFS animations', () => {
    const index = read(path.join(LIB, 'index.json'));
    for (const design of read(path.join(LIB, 'sources', 'borders-web-cinematic.json')).designs) {
        const entry = index.designs.find((item) => item.id === design.id);
        assert.ok(entry.editableComposition, `${design.id} has an explicit editable composition`);
        const composition = read(path.join(ROOT, entry.editableComposition.replace(/^\//, '')));
        assert.ok(composition.layers.length >= 12, `${design.id} has effect layers`);
        assert.equal(composition.width, design.width);
        assert.equal(composition.duration, design.duration);
        const editableAnim = entry.animations.find((animation) => animation.origin === 'extracted');
        assert.ok(editableAnim, `${design.id} has an editable animation`);
        const animation = read(path.join(ROOT, editableAnim.file.replace(/^\//, '')));
        assert.equal(animation.tracks.length, composition.layers.length);
    }
});
