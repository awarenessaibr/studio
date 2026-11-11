'use strict';
/**
 * Borders Web — designs 15 to 18.
 *
 * Two reels have source recordings and exact video frames. Design 16 is a
 * five-slide static carousel: each slide is installed at native 4:5 size so it
 * stays readable, rather than flattened into one 5400 px strip. Design 17 is a
 * single static map. Static slides have no sourceVideo and are checked by hash.
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

test('Borders Web: two reels, five carousel slides and one map', () => {
    const reels = read(path.join(LIB, 'sources', 'borders-web-reels.json')).designs;
    const statics = read(path.join(LIB, 'sources', 'borders-web-static.json')).designs;
    const index = read(path.join(LIB, 'index.json'));
    const byId = new Map(index.designs.map((design) => [design.id, design]));

    assert.equal(reels.length, 2);
    assert.equal(statics.length, 6);
    assert.equal(new Set([...reels, ...statics].map((design) => design.id)).size, 8);

    for (const design of reels) {
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
        assert.equal(detail.sourceVideo, entry.sourceVideo);
    }

    for (const design of statics) {
        const entry = byId.get(design.id);
        assert.equal(entry.status, 'ready');
        assert.equal(entry.brandId, 'borders-web');
        assert.equal(entry.sourceVideo, undefined, `${design.id} is a static design`);
        assert.equal(entry.width, 1080);
        assert.equal(entry.height, 1350);
        assert.equal(entry.duration, design.duration);
        const detail = read(path.join(LIB, 'designs', `${design.id}.json`));
        assert.equal(detail.layers.length, 1);
        const poster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
        assert.equal(sha(poster), design.posterSha256);
    }

    const slides = statics.filter((design) => /Slide [1-5]\/5/.test(design.name));
    assert.equal(slides.length, 5);
    assert.deepEqual(slides.map((design) => design.name.match(/Slide ([1-5])\/5/)[1]), ['1', '2', '3', '4', '5']);
});

test('Borders Web: the source deck is archived', () => {
    const source = path.join(LIB, 'sources', 'html', 'borders-web-designs-15-to-18.html');
    assert.ok(fs.existsSync(source));
    assert.ok(fs.statSync(source).size > 200_000);
});
