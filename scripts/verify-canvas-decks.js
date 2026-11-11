#!/usr/bin/env node
'use strict';
/**
 * verify-canvas-decks.js — prove a canvas deck design is the source.
 *
 * For every design in a captured deck manifest:
 *   - the composition has the deck's native stage size and duration;
 *   - the poster re-renders byte-identically from the archived HTML;
 *   - the recording has the native size, frame rate, duration and frame count;
 *   - frames decoded from the WebM match fresh source renders (PSNR / MAE);
 *   - every embedded image and font is byte-identical to the source deck;
 *   - the library index, detail, brand and source attachments agree.
 *
 * Usage
 *   node scripts/verify-canvas-decks.js [manifest.json]
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
const manifestFile = path.resolve(process.argv[2] || path.join(ROOT, 'scripts', 'source-manifests', 'butterfly-chase-and-reels.json'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const metadataFile = path.join(ROOT, 'data', 'library', 'sources', manifest.metadata || 'canvas-reels.json');
const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
const library = path.join(ROOT, 'data', 'library');
const reportFile = path.join(ROOT, manifest.report || 'deliverables/butterfly-chase-and-reels/verification.md');
const contactSheet = path.join(path.dirname(reportFile), 'contact-sheet.jpg');
const tmp = fs.mkdtempSync(path.join('/tmp', 'canvas-deck-verify-'));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const python = fs.existsSync(path.join(ROOT, '.venv', 'bin', 'python'))
    ? path.join(ROOT, '.venv', 'bin', 'python')
    : 'python3';

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const results = [];
let failed = 0;

function ffprobe(file) {
    const data = JSON.parse(cp.execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }));
    const stream = (data.streams || [])[0] || {};
    const [numerator, denominator] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
    const frames = (data.streams || []).find((item) => item.nb_frames)?.nb_frames;
    return {
        width: Number(stream.width) || 0,
        height: Number(stream.height) || 0,
        fps: denominator ? numerator / denominator : numerator,
        duration: Number((data.format || {}).duration) || 0,
        frames: frames ? Number(frames) : null,
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

function pngSize(buffer) {
    if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
    }
    return null;
}

function imageSize(buffer) {
    return pngSize(buffer) || jpegSize(buffer) || { width: null, height: null };
}

function sourceAssets(html) {
    const assets = [];
    const script = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';
    const keyed = /["']?([A-Za-z0-9_]+)["']?\s*:\s*["'](data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+))["']/g;
    let match;
    const seen = new Set();
    while ((match = keyed.exec(script))) {
        const [, key, mime, , data] = match;
        if (seen.has(key)) continue;
        seen.add(key);
        const buffer = Buffer.from(data, 'base64');
        assets.push({ key, kind: 'image', mime, buffer, ...imageSize(buffer) });
    }
    const fontFace = /@font-face\s*\{([\s\S]*?)\}/g;
    while ((match = fontFace.exec(html))) {
        const block = match[1];
        const src = block.match(/url\(["']?(data:font\/(\w+);base64,([A-Za-z0-9+/=]+))["']?\)/);
        if (!src) continue;
        const family = (block.match(/font-family\s*:\s*([^;]+)/) || [])[1] || 'font';
        const weight = (block.match(/font-weight\s*:\s*([^;]+)/) || [])[1] || '400';
        const style = (block.match(/font-style\s*:\s*([^;]+)/) || [])[1] || 'normal';
        const buffer = Buffer.from(src[3], 'base64');
        assets.push({ key: `${family.trim()} ${weight.trim()} ${style.trim()}`, kind: 'font', mime: `font/${src[2]}`, buffer, width: null, height: null });
    }
    return assets;
}

async function renderReels(page, index, times, width, height) {
    const urls = await page.evaluate(({ index, times, width, height }) => {
        const state = window.__R[index];
        const canvas = state.rl.canvas;
        canvas.width = width;
        canvas.height = height;
        return times.map((time) => {
            state.rl.render(time, 1);
            return canvas.toDataURL('image/png');
        });
    }, { index, times, width, height });
    return urls;
}

async function renderSim(page, frameIndices, fps) {
    const urls = await page.evaluate(({ frameIndices, fps }) => {
        const sim = window.__sim;
        const canvas = document.getElementById('c') || document.querySelector('canvas');
        const wanted = new Map(frameIndices.map((frame, index) => [frame, index]));
        const max = Math.max(...frameIndices);
        const stepsPerFrame = Math.max(1, Math.round(60 / fps));
        const output = [];
        sim.reset();
        for (let frame = 0; frame <= max; frame += 1) {
            if (frame > 0) {
                for (let step = 0; step < stepsPerFrame; step += 1) sim.step();
            }
            if (wanted.has(frame)) {
                sim.draw();
                output[wanted.get(frame)] = canvas.toDataURL('image/png');
            }
        }
        return output;
    }, { frameIndices, fps });
    return urls;
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    const pages = new Map();
    try {
        for (const design of metadata.designs) {
            const id = design.id;
            const sourceEntry = manifest.sources.find((source) => id.startsWith(source.idPrefix));
            if (!sourceEntry) { results.push({ id, name: design.name, pass: false, notes: ['not in manifest'] }); failed += 1; continue; }
            const sourceFile = path.resolve(ROOT, design.source);
            const compositionFile = path.join(ROOT, 'data', 'projects', id, 'compositions', `${id}.composition.json`);
            const posterFile = path.join(ROOT, 'data', 'projects', id, 'images', 'poster.png');
            const video = path.join(library, 'sources', `${id}.webm`);
            const posterJpg = path.join(library, 'sources', `${id}.jpg`);
            const checks = { id, name: design.name, pass: true, notes: [] };
            const has = (file, label) => {
                if (!fs.existsSync(file)) { checks.pass = false; checks.notes.push(`${label} missing`); return false; }
                return true;
            };
            if (!has(compositionFile, 'composition') || !has(posterFile, 'poster') || !has(video, 'video') || !has(posterJpg, 'poster jpg') || !has(sourceFile, 'source deck')) {
                results.push(checks);
                failed += 1;
                continue;
            }

            // 1. The composition is one full-frame poster layer at the native size.
            const composition = readJson(compositionFile);
            const layer = (composition.layers || [])[0] || {};
            const expectedFrames = Math.round(design.duration / 1000 * design.fps);
            const compositionOk = composition.layers?.length === 1
                && layer.type === 'image'
                && layer.x === 0 && layer.y === 0 && layer.w === 100 && layer.h === 100
                && layer.url === `/data/projects/${id}/images/poster.png`
                && composition.width === design.width
                && composition.height === design.height
                && composition.duration === design.duration;
            if (!compositionOk) { checks.pass = false; checks.notes.push('composition is not the native full-frame poster layer'); }

            // 2. The poster must be byte-identical to a fresh source render.
            const pageFor = async (file) => {
                if (pages.has(file)) return pages.get(file);
                const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
                if (design.mode === 'sim') {
                    await page.addInitScript(() => { window.__S = 1; window.__manual = true; });
                }
                await page.goto(`file://${encodeURI(file)}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
                if (design.mode !== 'sim') {
                    await page.evaluate(() => {
                        document.querySelector('header')?.remove();
                        const grid = document.getElementById('grid');
                        if (grid) grid.style.display = 'none';
                        window.__R.forEach((state) => { state.playing = false; state.vis = false; state.dirty = false; });
                    });
                }
                pages.set(file, page);
                return page;
            };
            const page = await pageFor(sourceFile);
            const posterFrame = Math.round(design.posterTime * design.fps);
            const [freshPosterUrl] = design.mode === 'sim'
                ? await renderSim(page, [posterFrame], design.fps)
                : await renderReels(page, design.reelIndex, [design.posterTime], design.width, design.height);
            const freshPoster = Buffer.from(freshPosterUrl.split(',')[1], 'base64');
            const installedPoster = fs.readFileSync(posterFile);
            const freshSha = sha(freshPoster);
            checks.posterExact = freshSha === sha(installedPoster) && freshSha === design.posterSha256;
            if (!checks.posterExact) { checks.pass = false; checks.notes.push('poster differs from the fresh source render'); }

            // 3. Native size, rate, duration and frame count.
            const probe = ffprobe(video);
            checks.probe = probe;
            if (probe.width !== design.width || probe.height !== design.height) {
                checks.pass = false;
                checks.notes.push(`video is ${probe.width}×${probe.height}, expected ${design.width}×${design.height}`);
            }
            if (Math.abs(probe.fps - design.fps) > 0.01) {
                checks.pass = false;
                checks.notes.push(`video is ${probe.fps} fps, expected ${design.fps}`);
            }
            if (Math.abs(probe.duration - design.duration / 1000) > 0.05) {
                checks.pass = false;
                checks.notes.push(`video is ${probe.duration}s, expected ${design.duration / 1000}s`);
            }
            if (probe.frames != null && probe.frames !== expectedFrames) {
                checks.pass = false;
                checks.notes.push(`video has ${probe.frames} frames, expected ${expectedFrames}`);
            }

            // 4. Three decoded frames against fresh renders at the same frame number.
            checks.samples = [];
            const sampleFrames = [0.1, 0.5, 0.9].map((ratio) => Math.min(expectedFrames - 1, Math.max(0, Math.round(expectedFrames * ratio))));
            const sampleTimes = sampleFrames.map((frame) => frame / design.fps);
            const freshUrls = design.mode === 'sim'
                ? await renderSim(page, sampleFrames, design.fps)
                : await renderReels(page, design.reelIndex, sampleTimes, design.width, design.height);
            for (let index = 0; index < sampleFrames.length; index += 1) {
                const frameIndex = sampleFrames[index];
                const fromVideo = path.join(tmp, `${id}-${frameIndex}-video.png`);
                const fresh = path.join(tmp, `${id}-${frameIndex}-fresh.png`);
                if (!frameFromVideo(video, frameIndex, fromVideo)) {
                    checks.pass = false;
                    checks.notes.push(`cannot decode frame ${frameIndex}`);
                    continue;
                }
                fs.writeFileSync(fresh, Buffer.from(freshUrls[index].split(',')[1], 'base64'));
                const diff = compare(fromVideo, fresh);
                const good = diff.psnr > 36 && diff.mae < 4;
                if (!good) { checks.pass = false; checks.notes.push(`frame ${frameIndex}: PSNR ${diff.psnr.toFixed(1)} dB, MAE ${diff.mae.toFixed(2)}`); }
                checks.samples.push({ time: sampleTimes[index], frameIndex, psnr: diff.psnr, mae: diff.mae, good });
            }

            // 5. Every embedded image and font must match the archived source bytes.
            const slug = path.basename(sourceFile, '.html');
            const assetsDir = path.join(library, 'sources', 'assets', slug);
            const assetsFile = path.join(assetsDir, 'assets.json');
            const sourceAssetsOk = fs.existsSync(assetsFile);
            checks.assets = { count: 0, images: 0, fonts: 0, exact: 0 };
            if (!sourceAssetsOk) {
                checks.pass = false;
                checks.notes.push('source asset archive missing');
            } else {
                const record = readJson(assetsFile);
                const html = fs.readFileSync(sourceFile, 'utf8');
                const walked = sourceAssets(html);
                const byKey = new Map(walked.map((asset) => [asset.key, asset]));
                record.assets.forEach((asset) => {
                    const original = byKey.get(asset.key);
                    const file = path.join(ROOT, asset.file.replace(/^\//, ''));
                    const ok = Boolean(original)
                        && fs.existsSync(file)
                        && sha(fs.readFileSync(file)) === asset.sha256
                        && sha(original.buffer) === asset.sha256
                        && original.buffer.length === asset.bytes
                        && (asset.kind !== 'image' || (original.width === asset.width && original.height === asset.height));
                    checks.assets.count += 1;
                    if (asset.kind === 'image') checks.assets.images += 1;
                    if (asset.kind === 'font') checks.assets.fonts += 1;
                    if (ok) checks.assets.exact += 1;
                    else { checks.pass = false; checks.notes.push(`asset ${asset.name} is not byte-identical to the source`); }
                });
                if (walked.length !== record.assets.length) {
                    checks.pass = false;
                    checks.notes.push(`source has ${walked.length} assets, archive has ${record.assets.length}`);
                }
            }

            // 6. Library index/detail, brand and attachments.
            const index = readJson(path.join(library, 'index.json'));
            const entry = (index.designs || []).find((item) => item.id === id);
            const detailFile = path.join(library, 'designs', `${id}.json`);
            const detail = fs.existsSync(detailFile) ? readJson(detailFile) : {};
            const libOk = Boolean(entry)
                && entry.sourceVideo === `/data/library/sources/${id}.webm`
                && entry.sourcePoster === `/data/library/sources/${id}.jpg`
                && entry.thumbnail === entry.sourcePoster
                && entry.status === 'ready'
                && entry.brandId === 'the-butterfly-and-the-pig'
                && entry.width === design.width
                && entry.height === design.height
                && entry.duration === design.duration
                && detail.sourceVideo === entry.sourceVideo
                && detail.sourcePoster === entry.sourcePoster;
            if (!libOk) { checks.pass = false; checks.notes.push('library entry, brand or source attachment is not in place'); }

            checks.duration = design.duration;
            checks.frames = expectedFrames;
            checks.posterTime = design.posterTime;
            checks.videoMB = probe.size / 1024 / 1024;
            if (!checks.pass) failed += 1;
            results.push(checks);
            console.log(`${checks.pass ? '✓' : '✗'} ${id} — ${design.width}×${design.height} ${design.fps} fps, poster ${checks.posterExact ? 'exact' : 'DIFF'}, min PSNR ${Math.min(...checks.samples.map((sample) => sample.psnr)).toFixed(1)} dB, assets ${checks.assets.exact}/${checks.assets.count}`);
        }
    } finally {
        await browser.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Contact sheet of the installed posters.
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    const sheetPy = [
        'import sys, os',
        'from PIL import Image, ImageDraw',
        'out=sys.argv[1]; files=sys.argv[2:]',
        'cell_w=420; cell_h=460',
        'rows=(len(files)+2)//3',
        'sheet=Image.new("RGB",(cell_w*3,cell_h*rows),"#141210"); d=ImageDraw.Draw(sheet)',
        'for i,f in enumerate(files):',
        '    im=Image.open(f).convert("RGB"); im.thumbnail((cell_w-16,cell_h-40))',
        '    x=(i%3)*cell_w; y=(i//3)*cell_h',
        '    sheet.paste(im,(x+(cell_w-im.width)//2,y+8)); d.text((x+10,y+cell_h-26),os.path.basename(os.path.dirname(os.path.dirname(f))),fill="#e8d9bd")',
        'sheet.save(out, quality=88)',
    ].join('\n');
    const posterFiles = results.map((item) => path.join(ROOT, 'data', 'projects', item.id, 'images', 'poster.png')).filter((file) => fs.existsSync(file));
    try { cp.execFileSync(python, ['-c', sheetPy, contactSheet, ...posterFiles], { stdio: 'ignore' }); } catch { /* contact sheet is a convenience */ }

    const lines = [];
    lines.push('# Canvas deck verification — The Butterfly and the Pig');
    lines.push('');
    lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from the archived decks. Every check re-renders from the source HTML instead of trusting the installed files.`);
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
    lines.push('| Design | Size | Duration | Frames | Poster | 10% | 50% | 90% | Worst MAE | Images/fonts | Result |');
    lines.push('| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |');
    results.forEach((item) => {
        const psnr = (index) => {
            const sample = (item.samples || [])[index];
            return sample ? `${sample.psnr.toFixed(1)} dB` : '—';
        };
        const worstMae = item.samples && item.samples.length ? Math.max(...item.samples.map((sample) => sample.mae)) : NaN;
        const assets = item.assets ? `${item.assets.exact}/${item.assets.count}${item.assets.fonts ? ` (${item.assets.images} images, ${item.assets.fonts} fonts)` : ''}` : '—';
        lines.push(`| ${item.name} | ${item.probe.width}×${item.probe.height} | ${(item.duration / 1000).toFixed(1)}s | ${item.frames} | ${item.posterExact ? 'byte-identical' : '**differs**'} | ${psnr(0)} | ${psnr(1)} | ${psnr(2)} | ${Number.isFinite(worstMae) ? worstMae.toFixed(2) : '—'} | ${assets} | ${item.pass ? 'pass' : '**FAIL**'} |`);
    });
    lines.push('');
    if (results.some((item) => item.notes.length)) {
        lines.push('## Notes');
        lines.push('');
        results.filter((item) => item.notes.length).forEach((item) => lines.push(`- **${item.name}**: ${item.notes.join('; ')}`));
        lines.push('');
    }
    lines.push('## Method');
    lines.push('');
    lines.push('- The poster is rendered from the archived deck at the recorded time and must hash identically to the installed poster and the capture metadata.');
    lines.push('- Every recording frame is produced by the deck itself: `__R[i].rl.render(t, 1)` for reels, or the page\'s own `__sim.reset()/step()/draw()` at 1/60 s for the chase. VP9 CRF 20 is the only loss.');
    lines.push('- Composition is one full-frame image layer of that poster at the deck\'s native stage size, with a two-keyframe hold for the design duration.');
    lines.push('- Embedded images and fonts are re-decoded from the archived HTML and compared byte-for-byte with `data/library/sources/assets/<deck>/`.');
    lines.push('');
    fs.writeFileSync(reportFile, `${lines.join('\n')}\n`);
    console.log(`report: ${path.relative(ROOT, reportFile)} — ${results.length - failed}/${results.length} pass`);
    if (failed) process.exitCode = 1;
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
