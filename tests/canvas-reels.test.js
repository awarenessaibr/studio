'use strict';
/**
 * Canvas reel ingestion: the Butterfly & Pig canvas decks must stay installed
 * as exact source recordings with a byte-identical poster composition.
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
const META_FILE = path.join(LIB, 'sources', 'canvas-reels.json');
const hasIngest = fs.existsSync(META_FILE);

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('the canvas reel decks are installed as source-exact designs', { skip: !hasIngest }, () => {
    const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
    const byId = new Map((index.designs || []).map((design) => [design.id, design]));

    const unusual = meta.designs.filter((design) => design.id.startsWith('butterfly-the-pig-unusual-reels-'));
    const vouchers = meta.designs.filter((design) => design.id.startsWith('butterfly-the-pig-gift-voucher-reels-'));
    assert.equal(unusual.length, 5, 'five Unusually Sharp reels');
    assert.equal(vouchers.length, 5, 'five Gift Voucher reels');
    assert.deepEqual(
        unusual.map((design) => design.id),
        ['01', '02', '03', '04', '05'].map((n) => `butterfly-the-pig-unusual-reels-${n}`),
    );

    for (const design of meta.designs) {
        const entry = byId.get(design.id);
        assert.ok(entry, `${design.id} is in the library index`);
        assert.equal(entry.brandId, 'the-butterfly-and-the-pig');
        assert.equal(entry.status, 'ready');
        assert.equal(entry.sourceVideo, `/data/library/sources/${design.id}.webm`);
        assert.equal(entry.sourcePoster, `/data/library/sources/${design.id}.jpg`);
        assert.equal(entry.thumbnail, entry.sourcePoster);
        assert.ok(entry.duration >= 9000, `${design.id} keeps its duration`);

        const video = path.join(LIB, 'sources', `${design.id}.webm`);
        const poster = path.join(LIB, 'sources', `${design.id}.jpg`);
        assert.ok(fs.statSync(video).size > 1000, `${design.id} has a recording`);
        assert.ok(fs.statSync(poster).size > 1000, `${design.id} has a poster`);

        const detail = JSON.parse(fs.readFileSync(path.join(LIB, 'designs', `${design.id}.json`), 'utf8'));
        assert.equal(detail.sourceVideo, entry.sourceVideo);
        assert.equal(detail.sourcePoster, entry.sourcePoster);

        const projectPoster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
        assert.equal(sha(projectPoster), design.posterSha256, `${design.id} poster is the recorded source frame`);
        const composition = JSON.parse(fs.readFileSync(
            path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.composition.json`), 'utf8',
        ));
        assert.equal(composition.width, 1080);
        assert.equal(composition.height, 1920);
        assert.equal(composition.duration, design.duration);
        assert.equal(composition.layers.length, 1);
        assert.deepEqual(
            { x: composition.layers[0].x, y: composition.layers[0].y, w: composition.layers[0].w, h: composition.layers[0].h },
            { x: 0, y: 0, w: 100, h: 100 },
        );
        assert.equal(composition.layers[0].url, `/data/projects/${design.id}/images/poster.png`);
    }
});

test('the canvas source decks are archived beside their recordings', { skip: !hasIngest }, () => {
    for (const file of ['butterfly-unusual-reels.html', 'butterfly-gift-voucher-reels.html']) {
        const source = path.join(LIB, 'sources', 'html', file);
        assert.ok(fs.existsSync(source), `${file} is archived`);
        assert.ok(fs.statSync(source).size > 100_000, `${file} carries the full deck`);
    }
});
