'use strict';
/**
 * Borders Web — Where I work, animated.
 *
 * Seven treatments of the same service-area map. Each is an exact-poster
 * design with a 25 fps source recording. The deck itself throws on its first
 * frame (negative t + spot's O[-1]); a capture copy clamps t to >= 0, while
 * the archived original is untouched.
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

test('Borders Web map: seven treatments with source recordings', () => {
    const designs = read(path.join(LIB, 'sources', 'borders-web-where.json')).designs;
    const index = read(path.join(LIB, 'index.json'));
    const byId = new Map(index.designs.map((design) => [design.id, design]));
    assert.equal(designs.length, 7);
    assert.deepEqual(designs.map((design) => design.id), [
        'borders-web-where-i-work-animated-01',
        'borders-web-where-i-work-animated-02',
        'borders-web-where-i-work-animated-03',
        'borders-web-where-i-work-animated-04',
        'borders-web-where-i-work-animated-05',
        'borders-web-where-i-work-animated-06',
        'borders-web-where-i-work-animated-07',
    ]);

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
        assert.equal(detail.sourceVideo, entry.sourceVideo);
    }

    assert.equal(new Set(designs.map((design) => design.name)).size, 7);
});

test('Borders Web map: original and fixed capture decks are archived', () => {
    const original = path.join(LIB, 'sources', 'html', 'borders-web-where-i-work-animated.html');
    const fixed = path.join(LIB, 'sources', 'html', 'borders-web-where-i-work-animated.fixed.html');
    assert.ok(fs.existsSync(original));
    assert.ok(fs.existsSync(fixed));
    assert.ok(fs.statSync(original).size > 1_000_000);
    assert.ok(fs.statSync(fixed).size > 1_000_000);
    assert.notEqual(sha(original), sha(fixed));
});
