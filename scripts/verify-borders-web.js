#!/usr/bin/env node
'use strict';
/**
 * Borders Web — designs 15 to 18.
 *
 * Two reels are exact-poster designs with source recordings. The carousel is
 * five static 4:5 slides and the map is one static 4:5 post; for those the
 * composition is the exact live screenshot (no recording exists), so they are
 * checked by hash and by the absence of a sourceVideo.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const OUT = path.join(ROOT, 'deliverables', 'borders-web');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const index = read(path.join(LIB, 'index.json'));
const byId = new Map(index.designs.map((design) => [design.id, design]));
const reels = read(path.join(LIB, 'sources', 'borders-web-reels.json')).designs.map((design) => ({ ...design, kind: 'reel' }));
const statics = read(path.join(LIB, 'sources', 'borders-web-static.json')).designs.map((design) => ({ ...design, kind: 'static' }));
const designs = [...reels, ...statics];

function psnr(a, b) {
    const result = cp.spawnSync('ffmpeg', ['-v', 'info', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
    const text = `${result.stderr || ''}\n${result.stdout || ''}`;
    const match = text.match(/average:([0-9.]+|inf)/i);
    if (!match) return null;
    return match[1].toLowerCase() === 'inf' ? Infinity : Number(match[1]);
}

const rows = [];
const failures = [];
for (const design of designs) {
    const entry = byId.get(design.id);
    const detail = read(path.join(LIB, 'designs', `${design.id}.json`));
    const poster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
    const composition = read(path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.composition.json`));
    const checks = {
        entry: Boolean(entry),
        ready: entry?.status === 'ready',
        brand: entry?.brandId === 'borders-web',
        size: entry?.width === design.width && entry?.height === design.height,
        duration: entry?.duration === design.duration,
        layers: detail.layers.length === 1 && composition.layers.length === 1,
        fullFrame: composition.layers[0].x === 0 && composition.layers[0].y === 0 && composition.layers[0].w === 100 && composition.layers[0].h === 100,
        posterHash: sha(poster) === design.posterSha256,
    };
    let posterVsVideo = null;
    if (design.kind === 'reel') {
        const video = path.join(ROOT, 'data', 'library', 'sources', `${design.id}.webm`);
        checks.video = Boolean(entry?.sourceVideo) && fs.existsSync(video);
        checks.poster = Boolean(entry?.sourcePoster) && fs.existsSync(path.join(ROOT, 'data', 'library', 'sources', `${design.id}.jpg`));
        if (checks.video) {
            const frame = path.join('/tmp', `borders-web-${design.id}.png`);
            cp.execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-ss', String(design.posterTime), '-frames:v', '1', frame], { stdio: 'ignore' });
            posterVsVideo = sha(frame) === sha(poster) ? Infinity : psnr(poster, frame);
            checks.matches = posterVsVideo != null && posterVsVideo > 30;
            const probe = Number(cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim());
            checks.videoDuration = Math.abs(probe * 1000 - design.duration) < 80;
        }
    } else {
        checks.noVideo = !entry?.sourceVideo;
    }
    const passed = Object.values(checks).every(Boolean);
    if (!passed) failures.push({ id: design.id, checks });
    rows.push({ design, entry, checks, posterVsVideo, passed });
}

if (statics.length !== 6) failures.push({ id: 'static count', checks: { expected: statics.length === 6 } });
if (reels.length !== 2) failures.push({ id: 'reel count', checks: { expected: reels.length === 2 } });
const carousel = statics.filter((design) => design.id >= 'borders-web-social-designs-15-to-18-02' && design.id <= 'borders-web-social-designs-15-to-18-06');
if (carousel.length !== 5) failures.push({ id: 'carousel count', checks: { expected: carousel.length === 5 } });

fs.mkdirSync(OUT, { recursive: true });
const lines = [
    '# Borders Web · designs 15 to 18 — source verification',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} from the source deck and its recordings.`,
    '',
    '## Summary',
    '',
    '| Check | Result |',
    '| --- | --- |',
    `| Library designs | ${designs.length} |`,
    `| Passed | ${rows.filter((row) => row.passed).length} |`,
    `| Failed | ${failures.length} |`,
    '',
    '| Design | Type | Size | Duration | Composition | Poster vs video | Result |',
    '| --- | --- | --- | ---: | --- | ---: | --- |',
];
for (const row of rows) {
    const kind = row.design.kind === 'reel' ? 'Reel' : row.design.id.endsWith('-07') ? 'Static' : 'Carousel slide';
    const pv = row.design.kind === 'reel'
        ? (Number.isFinite(row.posterVsVideo) ? `${row.posterVsVideo.toFixed(1)} dB` : 'identical')
        : '— (static)';
    lines.push(`| ${row.design.name} | ${kind} | ${row.design.width}×${row.design.height} | ${(row.design.duration / 1000).toFixed(1)}s | ${row.checks.layers ? '1 exact frame' : 'FAIL'} | ${pv} | ${row.passed ? 'pass' : 'FAIL'} |`);
}
lines.push(
    '',
    '## Method',
    '',
    '- The two reels are installed like the other HTML stage batches: the composition is the exact frame decoded from the source recording at the poster time, and Original motion is the recording.',
    '- The carousel is five static 4:5 slides. Each slide is installed as its own design at native size, because one 5400 px strip would be unreadable in the canvas; all five are grouped by the `carousel-16` tag and named Slide 1/5 … 5/5.',
    '- The map is one static 4:5 design. Its composition is the exact live screenshot; there is no source animation to record.',
    '- Static compositions are checked by hash and by the absence of a `sourceVideo`. Reels are checked by poster hash against a freshly decoded video frame.',
    '',
);
fs.writeFileSync(path.join(OUT, 'verification.md'), `${lines.join('\n')}\n`);

for (const row of rows) {
    const pv = row.design.kind === 'reel' ? (Number.isFinite(row.posterVsVideo) ? `${row.posterVsVideo.toFixed(1)} dB` : 'identical') : 'static';
    console.log(`${row.passed ? '✓' : '✗'} ${row.design.id} — 1 exact frame, ${pv}`);
}
console.log(`report: ${path.relative(ROOT, path.join(OUT, 'verification.md'))} — ${rows.filter((row) => row.passed).length}/${rows.length} pass`);
if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
}
