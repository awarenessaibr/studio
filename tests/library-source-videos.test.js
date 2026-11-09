'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const INDEX = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));

test('the 13 source-derived designs expose a source poster and recording', () => {
  const expected = [
    'butterfly-the-pig---cinematic-01', 'butterfly-the-pig---cinematic-02',
    'butterfly-the-pig---cinematic-03', 'butterfly-the-pig---cinematic-04',
    'posts---tarantella-01', 'posts---tarantella-02', 'posts---tarantella-03',
    'reels---before-after-01', 'reels---before-after-02', 'reels---before-after-03',
    'reels---news-bulletin-reel-01', 'reels---news-bulletin-reel-02', 'reels---news-bulletin-reel-03',
  ];
  for (const id of expected) {
    const entry = INDEX.designs.find((design) => design.id === id);
    assert.ok(entry, `${id} is in the library index`);
    assert.equal(entry.sourceVideo, `/data/library/sources/${id}.webm`);
    assert.equal(entry.sourcePoster, `/data/library/sources/${id}.jpg`);
    assert.ok(fs.statSync(path.join(LIB, 'sources', `${id}.webm`)).size > 1000, `${id} has a recording`);
    assert.ok(fs.statSync(path.join(LIB, 'sources', `${id}.jpg`)).size > 1000, `${id} has a poster`);
    const detail = JSON.parse(fs.readFileSync(path.join(LIB, 'designs', `${id}.json`), 'utf8'));
    assert.equal(detail.sourceVideo, entry.sourceVideo);
    assert.equal(detail.sourcePoster, entry.sourcePoster);
  }
});
