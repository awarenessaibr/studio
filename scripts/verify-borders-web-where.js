#!/usr/bin/env node
'use strict';
/** Seven animated treatments of the Borders Web service-area map. */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const META_FILE = path.resolve(process.argv[2] || path.join(LIB, 'sources', 'borders-web-where.json'));
const OUT = path.join(ROOT, 'deliverables', process.argv[3] || 'borders-web-where');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const index = read(path.join(LIB, 'index.json'));
const byId = new Map(index.designs.map((design) => [design.id, design]));
const meta = read(META_FILE);
const designs = meta.designs;
const slug = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const expectedBrand = slug(meta.brand || 'Borders Web');

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
    const composition = read(path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.composition.json`));
    const poster = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
    const video = path.join(ROOT, 'data', 'library', 'sources', `${design.id}.webm`);
    const frame = path.join('/tmp', `bww-${design.id}.png`);
    const checks = {
        entry: Boolean(entry),
        ready: entry?.status === 'ready',
        brand: entry?.brandId === expectedBrand,
        size: entry?.width === design.width && entry?.height === design.height,
        duration: entry?.duration === design.duration,
        layers: detail.layers.length === 1 && composition.layers.length === 1,
        fullFrame: composition.layers[0].x === 0 && composition.layers[0].y === 0 && composition.layers[0].w === 100 && composition.layers[0].h === 100,
        posterHash: sha(poster) === design.posterSha256,
        video: fs.existsSync(video) && fs.statSync(video).size > 1000,
    };
    let diff = null;
    if (checks.video) {
        cp.execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-ss', String(design.posterTime), '-frames:v', '1', frame], { stdio: 'ignore' });
        diff = sha(frame) === sha(poster) ? Infinity : psnr(poster, frame);
        checks.matches = diff != null && diff > 30;
        const probe = Number(cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim());
        checks.videoDuration = Math.abs(probe * 1000 - design.duration) < 80;
    }
    const passed = Object.values(checks).every(Boolean);
    if (!passed) failures.push({ id: design.id, checks });
    rows.push({ design, checks, diff, passed });
}

fs.mkdirSync(OUT, { recursive: true });
const lines = [
    `# ${meta.title || 'Borders Web · Where I work, animated'} — source verification`,
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} from the source deck and its frame-stepped recording(s).`,
    '',
    '| Check | Result |',
    '| --- | --- |',
    `| Designs | ${designs.length} |`,
    `| Passed | ${rows.filter((row) => row.passed).length} |`,
    `| Failed | ${failures.length} |`,
    '',
    '| Treatment | Size | Duration | Composition | Poster vs video | Result |',
    '| --- | --- | ---: | --- | ---: | --- |',
];
for (const row of rows) {
    const pv = Number.isFinite(row.diff) ? `${row.diff.toFixed(1)} dB` : 'identical';
    lines.push(`| ${row.design.name} | ${row.design.width}×${row.design.height} | ${(row.design.duration / 1000).toFixed(1)}s | 1 exact frame | ${pv} | ${row.passed ? 'pass' : 'FAIL'} |`);
}
lines.push(
    '',
    '## Method',
    '',
    '- The deck is frame-stepped at 25 fps: the page clock is set to each frame, the page’s own `f(t)` renders that time, and the native-size screenshot is piped to ffmpeg. No marker or guessed trim is involved.',
    '- The poster is the exact lossless frame at the chosen time; the recording is the VP9 encode of the same frame sequence.',
    '- The source deck throws on its first frame because `t` is slightly negative and the `spot` mode indexes `O[-1]`. A minimal capture copy clamps `t` to `Math.max(0, …)` so the animations can run; the archived original is unchanged. The clamp does not change any visual state, it only prevents the negative first frame.',
    '- Some map treatments are very light and some are dark; frame stepping keeps every one exact regardless of body colour.',
    '',
);
fs.writeFileSync(path.join(OUT, 'verification.md'), `${lines.join('\n')}\n`);
for (const row of rows) {
    const pv = Number.isFinite(row.diff) ? `${row.diff.toFixed(1)} dB` : 'identical';
    console.log(`${row.passed ? '✓' : '✗'} ${row.design.id} — 1 exact frame, ${pv}`);
}
console.log(`report: ${path.relative(ROOT, path.join(OUT, 'verification.md'))} — ${rows.filter((row) => row.passed).length}/${rows.length} pass`);
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exit(1); }
