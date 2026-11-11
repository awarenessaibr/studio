'use strict';
/**
 * Canvas deck installs: the chase (1004×650, 60 fps) and the November reels
 * (1080×1920, 30 fps) must stay source-exact — native dimensions, the exact
 * still, the exact recording, and the deck's own images and fonts.
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
const META_FILE = path.join(LIB, 'sources', 'canvas-decks.json');
const hasIngest = fs.existsSync(META_FILE);
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const EXPECTED = [
    { id: 'butterfly-the-pig-chase', width: 1004, height: 650, fps: 60, duration: 26000, frames: 1560, posterTime: 19, assets: 4 },
    { id: 'butterfly-the-pig-november-reels-01', width: 1080, height: 1920, fps: 30, duration: 19600, frames: 588, posterTime: 9, assets: 11 },
    { id: 'butterfly-the-pig-november-reels-02', width: 1080, height: 1920, fps: 30, duration: 17900, frames: 537, posterTime: 9, assets: 11 },
    { id: 'butterfly-the-pig-november-reels-03', width: 1080, height: 1920, fps: 30, duration: 21500, frames: 645, posterTime: 11, assets: 11 },
    { id: 'butterfly-the-pig-november-reels-04', width: 1080, height: 1920, fps: 30, duration: 18000, frames: 540, posterTime: 4, assets: 11 },
];

test('the chase and November reels keep their native dimensions and timing', { skip: !hasIngest }, () => {
    const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    assert.equal(meta.designs.length, EXPECTED.length);
    for (const expected of EXPECTED) {
        const design = meta.designs.find((item) => item.id === expected.id);
        assert.ok(design, `${expected.id} was captured`);
        assert.equal(design.width, expected.width, `${expected.id} width`);
        assert.equal(design.height, expected.height, `${expected.id} height`);
        assert.equal(design.fps, expected.fps, `${expected.id} fps`);
        assert.equal(design.duration, expected.duration, `${expected.id} duration`);
        assert.equal(design.frames, expected.frames, `${expected.id} frame count`);
        assert.equal(design.posterTime, expected.posterTime, `${expected.id} poster time`);
    }
});

test('each canvas deck design is installed as its exact source still and recording', { skip: !hasIngest }, () => {
    const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    const index = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));
    const byId = new Map((index.designs || []).map((design) => [design.id, design]));

    for (const expected of EXPECTED) {
        const design = meta.designs.find((item) => item.id === expected.id);
        const entry = byId.get(expected.id);
        assert.ok(entry, `${expected.id} is in the library index`);
        assert.equal(entry.brandId, 'the-butterfly-and-the-pig');
        assert.equal(entry.status, 'ready');
        assert.equal(entry.width, expected.width);
        assert.equal(entry.height, expected.height);
        assert.equal(entry.duration, expected.duration);
        assert.equal(entry.sourceVideo, `/data/library/sources/${expected.id}.webm`);
        assert.equal(entry.sourcePoster, `/data/library/sources/${expected.id}.jpg`);
        assert.equal(entry.thumbnail, entry.sourcePoster);

        const detail = JSON.parse(fs.readFileSync(path.join(LIB, 'designs', `${expected.id}.json`), 'utf8'));
        assert.equal(detail.sourceVideo, entry.sourceVideo);
        assert.equal(detail.sourcePoster, entry.sourcePoster);

        const posterFile = path.join(ROOT, 'data', 'projects', expected.id, 'images', 'poster.png');
        const poster = fs.readFileSync(posterFile);
        assert.equal(sha(poster), design.posterSha256, `${expected.id} poster is the recorded source frame`);
        assert.equal(poster.readUInt32BE(16), expected.width, `${expected.id} poster width`);
        assert.equal(poster.readUInt32BE(20), expected.height, `${expected.id} poster height`);

        const composition = JSON.parse(fs.readFileSync(
            path.join(ROOT, 'data', 'projects', expected.id, 'compositions', `${expected.id}.composition.json`), 'utf8',
        ));
        assert.equal(composition.width, expected.width);
        assert.equal(composition.height, expected.height);
        assert.equal(composition.duration, expected.duration);
        assert.equal(composition.layers.length, 1);
        assert.deepEqual(
            {
                x: composition.layers[0].x, y: composition.layers[0].y,
                w: composition.layers[0].w, h: composition.layers[0].h,
            },
            { x: 0, y: 0, w: 100, h: 100 },
        );
        assert.equal(composition.layers[0].url, `/data/projects/${expected.id}/images/poster.png`);

        assert.ok(fs.statSync(path.join(LIB, 'sources', `${expected.id}.webm`)).size > 1000, `${expected.id} has a recording`);
        assert.ok(fs.statSync(path.join(LIB, 'sources', `${expected.id}.jpg`)).size > 1000, `${expected.id} has a library poster`);
    }
});

test('the decks and their embedded images and fonts are archived byte-for-byte', { skip: !hasIngest }, () => {
    const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    for (const expected of EXPECTED) {
        const design = meta.designs.find((item) => item.id === expected.id);
        const source = path.join(ROOT, design.source);
        assert.ok(fs.existsSync(source), `${design.source} is archived`);
        assert.ok(fs.statSync(source).size > 100_000, `${design.source} carries the full deck`);

        const slug = path.basename(design.source, '.html');
        const archiveFile = path.join(LIB, 'sources', 'assets', slug, 'assets.json');
        const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
        assert.equal(archive.source, design.source);
        assert.equal(archive.sourceSha256, sha(fs.readFileSync(source)), `${slug} archive points at this exact deck`);
        assert.equal(archive.assets.length, expected.assets, `${slug} assets`);
        for (const asset of archive.assets) {
            const file = path.join(ROOT, asset.file.replace(/^\//, ''));
            assert.ok(fs.existsSync(file), `${asset.name} is archived`);
            assert.equal(sha(fs.readFileSync(file)), asset.sha256, `${asset.name} is byte-identical`);
            assert.ok(asset.bytes > 0);
        }
    }
});
