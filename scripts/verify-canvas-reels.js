#!/usr/bin/env node
'use strict';
/**
 * verify-canvas-reels.js — prove a canvas reel design is the source.
 *
 * For every captured reel:
 *   - the poster is re-rendered from the archived HTML and must be byte-identical;
 *   - the composition is the full-frame poster layer at the recorded time;
 *   - three frames decoded from the WebM are compared with fresh canvas renders
 *     at the same frame numbers (PSNR / MAE; encoding is the only difference);
 *   - the library entry, detail and source attachments agree.
 *
 * Usage
 *   node scripts/verify-canvas-reels.js [manifest.json]
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
    try { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright')); }
    catch { throw new Error('Playwright is required.'); }
}

const ROOT = path.resolve(__dirname, '..');
const manifestFile = path.resolve(process.argv[2] || path.join(ROOT, 'scripts', 'source-manifests', 'butterfly-canvas-reels.json'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'library', 'sources', 'canvas-reels.json'), 'utf8'));
const library = path.join(ROOT, 'data', 'library');
const outDir = path.join(ROOT, 'deliverables', 'butterfly-reels');
const tmp = fs.mkdtempSync(path.join('/tmp', 'canvas-verify-'));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const python = fs.existsSync(path.join(ROOT, '.venv', 'bin', 'python'))
    ? path.join(ROOT, '.venv', 'bin', 'python')
    : 'python3';

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const results = [];
let failed = 0;

function ffprobe(file) {
    const out = cp.execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
    const data = JSON.parse(out);
    const stream = (data.streams || [])[0] || {};
    return {
        width: Number(stream.width) || 0,
        height: Number(stream.height) || 0,
        fps: stream.r_frame_rate || '',
        duration: Number((data.format || {}).duration) || 0,
        size: Number((data.format || {}).size) || 0,
    };
}

function frameFromVideo(video, frameIndex, out) {
    cp.execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf', `select=eq(n\\,${frameIndex})`, '-vsync', '0', '-frames:v', '1', out], { stdio: 'ignore' });
    return fs.existsSync(out) && fs.statSync(out).size > 1000;
}

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
    if (out === 'IDENTICAL') return { psnr: Infinity, mae: 0, identical: true };
    if (out === 'SIZE') return { psnr: 0, mae: 999, identical: false, size: true };
    const [psnr, mae] = out.split(/\s+/).map(Number);
    return { psnr, mae, identical: false };
}

function renderPng(page, reelIndex, time, out) {
    const data = page.evaluate(({ index, t }) => {
        const state = window.__R[index];
        const canvas = state.rl.canvas;
        canvas.width = 1080;
        canvas.height = 1920;
        state.rl.render(t, 1);
        return canvas.toDataURL('image/png');
    }, { index: reelIndex, t: time });
    return data.then((url) => {
        fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
        return out;
    });
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    const pages = new Map();
    try {
        for (const design of metadata.designs) {
            const id = design.id;
            const compositionFile = path.join(ROOT, 'data', 'projects', id, 'compositions', `${id}.composition.json`);
            const posterFile = path.join(ROOT, 'data', 'projects', id, 'images', 'poster.png');
            const video = path.join(library, 'sources', `${id}.webm`);
            const posterJpg = path.join(library, 'sources', `${id}.jpg`);
            const checks = { id, name: design.name, pass: true, notes: [] };

            const has = (file, label) => {
                if (!fs.existsSync(file)) { checks.pass = false; checks.notes.push(`${label} missing`); return false; }
                return true;
            };
            if (!has(compositionFile, 'composition') || !has(posterFile, 'poster') || !has(video, 'video') || !has(posterJpg, 'poster jpg')) {
                results.push(checks);
                failed += 1;
                continue;
            }

            // 1. The composition is exactly one full-frame poster layer.
            const composition = readJson(compositionFile);
            const layer = (composition.layers || [])[0] || {};
            const layerOk = composition.layers.length === 1
                && layer.type === 'image'
                && layer.x === 0 && layer.y === 0 && layer.w === 100 && layer.h === 100
                && layer.url === `/data/projects/${id}/images/poster.png`
                && composition.duration === design.duration
                && composition.width === 1080 && composition.height === 1920;
            if (!layerOk) { checks.pass = false; checks.notes.push('composition is not the full-frame poster layer'); }

            // 2. The poster is byte-identical to a fresh source render.
            if (!pages.has(design.source)) {
                const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
                await page.goto(`file://${encodeURI(path.resolve(ROOT, design.source))}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
                await page.evaluate(() => {
                    document.querySelector('header')?.remove();
                    const grid = document.getElementById('grid');
                    if (grid) grid.style.display = 'none';
                    window.__R.forEach((state) => { state.playing = false; state.vis = false; state.dirty = false; });
                });
                pages.set(design.source, page);
            }
            const page = pages.get(design.source);
            const freshPoster = path.join(tmp, `${id}-poster.png`);
            await renderPng(page, design.reelIndex, design.posterTime, freshPoster);
            const posterSha = sha(fs.readFileSync(posterFile));
            const freshSha = sha(fs.readFileSync(freshPoster));
            checks.posterExact = posterSha === freshSha && posterSha === design.posterSha256;
            if (!checks.posterExact) { checks.pass = false; checks.notes.push('poster differs from the source render'); }

            // 3. The recording: exact stage size, frame rate and duration.
            const probe = ffprobe(video);
            checks.probe = probe;
            const expectedFrames = Math.round(design.duration / 1000 * design.fps);
            const fpsParts = String(probe.fps || '0/1').split('/').map(Number);
            const fpsNumber = fpsParts[1] ? fpsParts[0] / fpsParts[1] : fpsParts[0] || 0;
            if (probe.width !== 1080 || probe.height !== 1920) { checks.pass = false; checks.notes.push(`video is ${probe.width}×${probe.height}`); }
            if (Math.abs(fpsNumber - design.fps) > 0.01) {
                checks.pass = false;
                checks.notes.push(`video is ${probe.fps} fps`);
            }
            if (Math.abs(probe.duration - design.duration / 1000) > 0.05) {
                checks.pass = false;
                checks.notes.push(`video is ${probe.duration}s, expected ${design.duration / 1000}s`);
            }

            // 4. Three decoded frames against fresh renders at the same frame number.
            checks.samples = [];
            for (const ratio of [0.1, 0.5, 0.9]) {
                const frameIndex = Math.min(expectedFrames - 1, Math.max(0, Math.round(expectedFrames * ratio)));
                const time = frameIndex / design.fps;
                const fromVideo = path.join(tmp, `${id}-${frameIndex}-video.png`);
                const fresh = path.join(tmp, `${id}-${frameIndex}-fresh.png`);
                if (!frameFromVideo(video, frameIndex, fromVideo)) {
                    checks.pass = false;
                    checks.notes.push(`cannot decode frame ${frameIndex}`);
                    continue;
                }
                await renderPng(page, design.reelIndex, time, fresh);
                const diff = compare(fromVideo, fresh);
                const good = diff.psnr > 36 && diff.mae < 4;
                if (!good) { checks.pass = false; checks.notes.push(`frame ${frameIndex}: PSNR ${diff.psnr.toFixed(1)} dB, MAE ${diff.mae.toFixed(2)}`); }
                checks.samples.push({ time, frameIndex, psnr: diff.psnr, mae: diff.mae, good });
            }

            // 5. Library index/detail and attachments.
            const index = readJson(path.join(library, 'index.json'));
            const entry = (index.designs || []).find((item) => item.id === id);
            const detail = readJson(path.join(library, 'designs', `${id}.json`));
            const libOk = Boolean(entry)
                && entry.sourceVideo === `/data/library/sources/${id}.webm`
                && entry.sourcePoster === `/data/library/sources/${id}.jpg`
                && entry.thumbnail === entry.sourcePoster
                && entry.status === 'ready'
                && entry.brandId === 'the-butterfly-and-the-pig'
                && detail.sourceVideo === entry.sourceVideo
                && detail.sourcePoster === entry.sourcePoster;
            if (!libOk) { checks.pass = false; checks.notes.push('library entry or source attachment is not in place'); }

            checks.duration = design.duration;
            checks.frames = expectedFrames;
            checks.posterTime = design.posterTime;
            checks.videoMB = probe.size / 1024 / 1024;
            if (!checks.pass) failed += 1;
            results.push(checks);
            console.log(`${checks.pass ? '✓' : '✗'} ${id} — poster ${checks.posterExact ? 'exact' : 'DIFF'}, min PSNR ${Math.min(...checks.samples.map((s) => s.psnr)).toFixed(1)} dB, ${checks.videoMB.toFixed(1)} MB`);
        }
    } finally {
        await browser.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Contact sheet for the owner-facing summary.
    fs.mkdirSync(outDir, { recursive: true });
    const sheetFile = path.join(outDir, 'reels-contact-sheet.jpg');
    const sheetPy = [
        'import sys, os',
        'from PIL import Image, ImageDraw',
        'out=sys.argv[1]; files=sys.argv[2:]',
        'cols=5; tw=304; th=540; rows=(len(files)+cols-1)//cols',
        'sheet=Image.new("RGB",(cols*tw,rows*th),"#0e1210"); d=ImageDraw.Draw(sheet)',
        'for i,f in enumerate(files):',
        '    im=Image.open(f).convert("RGB"); im.thumbnail((tw-8,th-26))',
        '    x=(i%cols)*tw; y=(i//cols)*th',
        '    sheet.paste(im,(x+4,y+4)); d.text((x+6,y+th-18),os.path.basename(os.path.dirname(os.path.dirname(f))),fill="#e8d9bd")',
        'sheet.save(out, quality=88)',
    ].join('\n');
    const posterFiles = results.map((r) => path.join(ROOT, 'data', 'projects', r.id, 'images', 'poster.png'));
    try { cp.execFileSync(python, ['-c', sheetPy, sheetFile, ...posterFiles], { stdio: 'ignore' }); } catch { /* the sheet is a convenience */ }

    const lines = [];
    lines.push('# Canvas reel verification — The Butterfly and the Pig');
    lines.push('');
    lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from the archived HTML decks. Each design is checked against a fresh canvas render, not against itself.`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Check | Result |');
    lines.push('| --- | --- |');
    lines.push(`| Designs verified | ${results.length} |`);
    lines.push(`| Passed | ${results.length - failed} |`);
    lines.push(`| Failed | ${failed} |`);
    lines.push('');
    lines.push('## Per design');
    lines.push('');
    lines.push('| Design | Duration | Frames | Poster | 10% | 50% | 90% | Worst MAE | Result |');
    lines.push('| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |');
    results.forEach((r) => {
        const psnr = (index) => {
            const sample = (r.samples || [])[index];
            return sample ? `${sample.psnr.toFixed(1)} dB` : '—';
        };
        const worstMae = r.samples && r.samples.length ? Math.max(...r.samples.map((sample) => sample.mae)) : NaN;
        lines.push(`| ${r.name} | ${(r.duration / 1000).toFixed(1)}s | ${r.frames} | ${r.posterExact ? 'byte-identical' : '**differs**'} | ${psnr(0)} | ${psnr(1)} | ${psnr(2)} | ${Number.isFinite(worstMae) ? worstMae.toFixed(2) : '—'} | ${r.pass ? 'pass' : '**FAIL**'} |`);
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
    lines.push('- The poster is rendered at the recorded time from `window.__R[i].rl.render(t, 1)` at 1080×1920 and must hash identically to the installed poster.');
    lines.push('- Every recording frame is produced by the same `render(t, 1)` call at 30 fps, then encoded with VP9 CRF 20. The only difference from a fresh render is video compression, measured here.');
    lines.push('- A composition is one full-frame image layer of that poster, with a two-keyframe hold for the design duration.');
    lines.push('- Source decks are archived at `data/library/sources/html/`.');
    lines.push('');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'reels-verification.md'), `${lines.join('\n')}\n`);
    console.log(`report: deliverables/butterfly-reels/reels-verification.md — ${results.length - failed}/${results.length} pass`);
    if (failed) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
