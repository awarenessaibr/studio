'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const INDEX = JSON.parse(fs.readFileSync(path.join(LIB, 'index.json'), 'utf8'));

test('every source-derived design exposes a source poster and recording', () => {
  const sourced = INDEX.designs.filter((design) => design.sourceVideo || design.sourcePoster);
  assert.ok(sourced.length >= 31, `expected at least 31 source designs, found ${sourced.length}`);
  for (const entry of sourced) {
    assert.match(entry.sourceVideo, /^\/data\/library\/sources\/.+\.webm$/);
    assert.match(entry.sourcePoster, /^\/data\/library\/sources\/.+\.jpg$/);
    assert.ok(fs.statSync(path.join(LIB, 'sources', `${entry.id}.webm`)).size > 1000, `${entry.id} has a recording`);
    assert.ok(fs.statSync(path.join(LIB, 'sources', `${entry.id}.jpg`)).size > 1000, `${entry.id} has a poster`);
    const detail = JSON.parse(fs.readFileSync(path.join(LIB, 'designs', `${entry.id}.json`), 'utf8'));
    assert.equal(detail.sourceVideo, entry.sourceVideo);
    assert.equal(detail.sourcePoster, entry.sourcePoster);
  }
});
