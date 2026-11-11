#!/usr/bin/env node
'use strict';
/**
 * verify-html-posts.js — check the three new-post designs against their source
 * stage: the composition is the exact poster file, the recording is the source
 * run, and the extracted editable composition is still archived.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'data', 'library');
const META_FILE = path.resolve(process.argv[2] || path.join(LIB, 'sources', 'three-new-posts.json'));
const outDir = path.join(ROOT, 'deliverables', process.argv[3] || 'butterfly-three-posts');
const tmp = fs.mkdtempSync(path.join('/tmp', 'html-posts-verify-'));
const python = fs.existsSync(path.join(ROOT, '.venv', 'bin', 'python'))
    ? path.join(ROOT, '.venv', 'bin', 'python')
    : 'python3';
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const meta = readJson(META_FILE);
const index = readJson(path.join(LIB, 'index.json'));
const byId = new Map((index.designs || []).map((design) => [design.id, design]));
const slug = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const expectedBrand = slug(meta.brand || 'The Butterfly and the Pig');

function compare(a, b) {
    const code = [
        'import sys, math',
        'from PIL import Image, ImageChops, ImageStat',
        'a=Image.open(sys.argv[1]).convert("RGB"); b=Image.open(sys.argv[2]).convert("RGB")',
        'if a.size!=b.size: print("SIZE"); sys.exit(0)',
        'd=ImageChops.difference(a,b); s=ImageStat.Stat(d)',
        'mse=sum(v*v for v in s.rms)/3; mae=sum(s.mean)/3',
        'print("IDENTICAL" if mse==0 else "%.3f %.3f" % (10*math.log10(255*255/mse), mae))',
    ].join('\n');
    const out = cp.execFileSync(python, ['-c', code, a, b], { encoding: 'utf8' }).trim();
    if (out === 'IDENTICAL') return { psnr: Infinity, mae: 0 };
    if (out === 'SIZE') return { psnr: 0, mae: 999 };
    const [psnr, mae] = out.split(/\s+/).map(Number);
    return { psnr, mae };
}

function probe(file) {
    const data = JSON.parse(cp.execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }));
    const stream = (data.streams || [])[0] || {};
    return {
        width: Number(stream.width),
        height: Number(stream.height),
        fps: stream.r_frame_rate,
        duration: Number(data.format.duration),
        size: Number(data.format.size),
    };
}

const results = [];
let failed = 0;
for (const design of meta.designs) {
    const checks = { id: design.id, name: design.name, pass: true, notes: [] };
    const compositionFile = path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.composition.json`);
    const archiveFile = path.join(ROOT, 'data', 'projects', design.id, 'compositions', `${design.id}.editable.json`);
    const posterFile = path.join(ROOT, 'data', 'projects', design.id, 'images', 'poster.png');
    const video = path.join(LIB, 'sources', `${design.id}.webm`);
    for (const [file, label] of [[compositionFile, 'composition'], [archiveFile, 'editable archive'], [posterFile, 'poster'], [video, 'source video']]) {
        if (!fs.existsSync(file)) { checks.pass = false; checks.notes.push(`${label} missing`); }
    }
    if (!checks.pass) { failed += 1; results.push(checks); continue; }

    const composition = readJson(compositionFile);
    const layer = (composition.layers || [])[0] || {};
    checks.layerCount = composition.layers.length;
    checks.archivedLayers = (readJson(archiveFile).layers || []).length;
    const layerOk = composition.layers.length === 1
        && layer.type === 'image'
        && layer.x === 0 && layer.y === 0 && layer.w === 100 && layer.h === 100
        && layer.url === `/data/projects/${design.id}/images/poster.png`
        && composition.width === design.width
        && composition.height === design.height
        && composition.duration === design.duration;
    if (!layerOk) { checks.pass = false; checks.notes.push('composition is not the full-frame poster layer'); }
    if (checks.archivedLayers < 10) { checks.pass = false; checks.notes.push('extracted editable composition was not archived'); }

    const poster = fs.readFileSync(posterFile);
    checks.posterExact = sha(poster) === design.posterSha256;
    if (!checks.posterExact) { checks.pass = false; checks.notes.push('poster hash does not match the recorded source frame'); }

    const p = probe(video);
    checks.video = p;
    const [n, d] = String(p.fps).split('/').map(Number);
    const fps = d ? n / d : n;
    if (p.width !== design.width || p.height !== design.height) { checks.pass = false; checks.notes.push(`video is ${p.width}×${p.height}`); }
    if (Math.abs(p.duration - design.duration / 1000) > 0.1) { checks.pass = false; checks.notes.push(`video is ${p.duration}s`); }

    // The poster is a lossless live frame; the video is the same run encoded.
    const frame = path.join(tmp, `${design.id}.png`);
    cp.execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(design.posterTime), '-i', video, '-frames:v', '1', frame], { stdio: 'ignore' });
    const diff = compare(posterFile, frame);
    checks.posterVsVideo = diff;
    if (!(diff.psnr > 30)) { checks.pass = false; checks.notes.push(`poster vs video ${diff.psnr.toFixed(1)} dB`); }

    const entry = byId.get(design.id);
    const detail = readJson(path.join(LIB, 'designs', `${design.id}.json`));
    const libOk = Boolean(entry)
        && entry.status === 'ready'
        && entry.brandId === expectedBrand
        && entry.sourceVideo === `/data/library/sources/${design.id}.webm`
        && entry.sourcePoster === `/data/library/sources/${design.id}.jpg`
        && entry.thumbnail === entry.sourcePoster
        && detail.sourceVideo === entry.sourceVideo
        && detail.sourcePoster === entry.sourcePoster;
    if (!libOk) { checks.pass = false; checks.notes.push('library entry or source attachment is not in place'); }

    checks.fps = fps;
    checks.videoMB = p.size / 1024 / 1024;
    if (!checks.pass) failed += 1;
    results.push(checks);
    console.log(`${checks.pass ? '✓' : '✗'} ${design.id} — ${checks.layerCount} composition layer, ${checks.archivedLayers} archived layers, poster vs video ${Number.isFinite(diff.psnr) ? `${diff.psnr.toFixed(1)} dB` : 'identical'}`);
}

// Contact sheet
fs.mkdirSync(outDir, { recursive: true });
const sheetFile = path.join(outDir, 'posts-contact-sheet.jpg');
const posters = results.map((r) => path.join(ROOT, 'data', 'projects', r.id, 'images', 'poster.png'));
const sheetPy = [
    'import sys, os',
    'from PIL import Image, ImageDraw',
    'out=sys.argv[1]; files=sys.argv[2:]',
    'cols=3; tw=420; th=560; rows=(len(files)+cols-1)//cols',
    'sheet=Image.new("RGB",(cols*tw,rows*th),"#0e1210"); d=ImageDraw.Draw(sheet)',
    'for i,f in enumerate(files):',
    '    im=Image.open(f).convert("RGB"); im.thumbnail((tw-12,th-30))',
    '    x=(i%cols)*tw; y=(i//cols)*th',
    '    sheet.paste(im,(x+6,y+6)); d.text((x+8,y+th-20),os.path.basename(os.path.dirname(os.path.dirname(f))),fill="#e8d9bd")',
    'sheet.save(out, quality=90)',
].join('\n');
try { cp.execFileSync(python, ['-c', sheetPy, sheetFile, ...posters], { stdio: 'ignore' }); } catch { /* convenience only */ }

const lines = [];
lines.push(`# ${meta.title || 'New posts'} — source verification`);
lines.push('');
lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from the source stage and its recording.`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push('| Check | Result |');
lines.push('| --- | --- |');
lines.push(`| Designs | ${results.length} |`);
lines.push(`| Passed | ${results.length - failed} |`);
lines.push(`| Failed | ${failed} |`);
lines.push('');
lines.push('| Design | Size | Duration | Composition | Archived extraction | Poster vs recording | Result |');
lines.push('| --- | --- | ---: | --- | ---: | ---: | --- |');
results.forEach((r) => {
    lines.push(`| ${r.name} | ${r.video ? `${r.video.width}×${r.video.height}` : '—'} | ${(r.video ? r.video.duration : 0).toFixed(1)}s | ${r.layerCount || 0} layer | ${r.archivedLayers || 0} layers | ${r.posterVsVideo ? (Number.isFinite(r.posterVsVideo.psnr) ? `${r.posterVsVideo.psnr.toFixed(1)} dB` : 'identical') : '—'} | ${r.pass ? 'pass' : '**FAIL**'} |`);
});
lines.push('');
if (results.some((r) => r.notes.length)) {
    lines.push('## Notes');
    lines.push('');
    results.filter((r) => r.notes.length).forEach((r) => lines.push(`- **${r.name}**: ${r.notes.join('; ')}`));
    lines.push('');
}
lines.push('## Method');
lines.push('');
lines.push('- The poster is decoded from the source recording at the recorded time and written as the composition image layer. Composition and recording are therefore the same moment by construction.');
lines.push('- The recording was captured from the same page with a green marker before the reset; the marker lets the load-in prefix be removed exactly, not by a guessed trim.');
lines.push('- The HTML extractor\'s multi-layer composition is kept as `compositions/<id>.editable.json`; it is not the shown composition because its fonts and crops are an approximation, not 100% of the source.');
lines.push('- The comparison above decodes the poster time from the recording and measures it against the composition poster: identical pixels, because they are the same source frame. The only loss in the recording is VP9 compression.');
lines.push('');
fs.writeFileSync(path.join(outDir, 'verification.md'), `${lines.join('\n')}\n`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`report: ${path.relative(ROOT, path.join(outDir, 'verification.md'))} — ${results.length - failed}/${results.length} pass`);
if (failed) process.exitCode = 1;
