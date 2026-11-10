'use strict';
/**
 * Three new posts: each design is a single exact-poster composition, the
 * source recording is attached, and the multi-layer extraction is archived.
 *
 * Run with: node --test "tests/*.test.js"
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const META_FILE = path.join(LIB, 'sources', 'new-posts.json');
const hasIngest = fs.existsSync(META_FILE);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('the three new posts are exact-poster designs with source recordings', { skip: !hasIngest }, () => {
    const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
    const byId = new Map((index.designs || []).map((design) => [design.id, design]));
    assert.equal(meta.designs.length, 3);
    assert.deepEqual(meta.designs.map((design) => design.id), [
        'the-butterfly-and-the-pig-new-posts-01',
        'the-butterfly-and-the-pig-new-posts-02',
        'the-butterfly-and-the-pig-new-posts-03',
    ]);

    for (const design of meta.designs) {
        const entry = byId.get(design.id);
        assert.ok(entry, `${design.id} is in the library index`);
        assert.equal(entry.status, 'ready');
        assert.equal(entry.brandId, 'the-butterfly-and-the-pig');
        assert.equal(entry.sourceVideo, `/data/library/sources/${design.id}.webm`);
        assert.equal(entry.sourcePoster, `/data/library/sources/${design.id}.jpg`);
        assert.equal(entry.thumbnail, entry.sourcePoster);
        assert.equal(entry.width, design.width);
        assert.equal(entry.height, design.height);
        assert.equal(entry.duration, design.duration);

        const video = path.join(LIB, 'sources', `${design.id}.webm`);
        const poster = path.join(LIB, 'sources', `${design.id}.jpg`);
        assert.ok(fs.statSync(video).size > 1000, `${design.id} has a recording`);
        assert.ok(fs.statSync(poster).size > 1000, `${design.id} has a poster`);

        const detail = JSON.parse(fs.readFileSync(path.join(LIB, 'designs', `${design.id}.json`), 'utf8'));
        assert.equal(detail.layers.length, 1, 'composition is one exact source frame');
        assert.equal(detail.sourceVideo, entry.sourceVideo);
        assert.equal(detail.sourcePoster, entry.sourcePoster);

        const projectPoster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
        assert.equal(sha(projectPoster), design.posterSha256, `${design.id} poster is the recorded frame`);
        const composition = JSON.parse(fs.readFileSync(
            path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.composition.json`), 'utf8',
        ));
        assert.equal(composition.layers.length, 1);
        assert.equal(composition.duration, design.duration);
        assert.equal(composition.layers[0].x, 0);
        assert.equal(composition.layers[0].y, 0);
        assert.equal(composition.layers[0].w, 100);
        assert.equal(composition.layers[0].h, 100);
        assert.equal(composition.layers[0].url, `/data/projects/${design.id}/images/poster.png`);

        const archive = JSON.parse(fs.readFileSync(
            path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.editable.json`), 'utf8',
        ));
        assert.ok(archive.layers.length > 10, `${design.id} keeps the extracted layer composition`);
    }
});

test('the three-new-posts source deck is archived', { skip: !hasIngest }, () => {
    const source = path.join(LIB, 'sources', 'html', 'butterfly-three-new-posts.html');
    assert.ok(fs.existsSync(source));
    assert.ok(fs.statSync(source).size > 1_000_000);
});
