#!/usr/bin/env node
/**
 * Attach source-exact original-motion recordings to library designs.
 *
 * Recordings live in data/library/sources/<design-id>.webm with a .jpg poster.
 * Run after build-library.py so the index/detail carry sourceVideo/sourcePoster.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const library = path.join(root, 'data', 'library');
const sources = path.join(library, 'sources');
const indexFile = path.join(library, 'index.json');
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
let count = 0;

for (const entry of index.designs || []) {
  const video = path.join(sources, `${entry.id}.webm`);
  const poster = path.join(sources, `${entry.id}.jpg`);
  if (!fs.existsSync(video) || !fs.existsSync(poster)) continue;
  const detailFile = path.join(library, 'designs', `${entry.id}.json`);
  if (!fs.existsSync(detailFile)) continue;
  const detail = JSON.parse(fs.readFileSync(detailFile, 'utf8'));
  const source = {
    sourceVideo: `/data/library/sources/${entry.id}.webm`,
    sourcePoster: `/data/library/sources/${entry.id}.jpg`,
    sourceDuration: Number(detail.duration) || 10000,
  };
  Object.assign(detail, source);
  Object.assign(entry, source, { thumbnail: source.sourcePoster });
  fs.writeFileSync(detailFile, JSON.stringify(detail, null, 2) + '\n');
  count++;
}
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
console.log(`Attached source playback to ${count} design(s).`);
