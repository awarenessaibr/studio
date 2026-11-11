'use strict';
/** Cotton Waves — one 3 s layered loop, frame-stepped at native 1672×941. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('Cotton Waves is one exact-poster loop', () => {
    const designs = read(path.join(LIB, 'sources', 'cotton-waves.json')).designs;
    assert.equal(designs.length, 1);
    const design = designs[0];
    const index = read(path.join(LIB, 'index.json'));
    const entry = index.designs.find((item) => item.id === design.id);
    assert.equal(entry.status, 'ready');
    assert.equal(entry.brandId, 'cotton-waves');
    assert.equal(entry.width, 1672);
    assert.equal(entry.height, 941);
    assert.equal(entry.duration, 3000);
    assert.equal(entry.sourceVideo, '/data/library/sources/cotton-waves-animated.webm');
    const video = path.join(ROOT, entry.sourceVideo.replace(/^\//, ''));
    assert.ok(fs.statSync(video).size > 1000);
    const detail = read(path.join(LIB, 'designs', `${design.id}.json`));
    assert.equal(detail.layers.length, 1);
    const poster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
    assert.equal(sha(poster), design.posterSha256);
    assert.ok(fs.existsSync(path.join(LIB, 'sources', 'html', 'cotton-waves-animated.html')));
});
