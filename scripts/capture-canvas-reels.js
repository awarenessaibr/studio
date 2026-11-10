#!/usr/bin/env node
'use strict';
/**
 * capture-canvas-reels.js — turn a canvas-reel HTML deck into projects and
 * frame-exact source recordings.
 *
 * The decks are plain canvas: every reel is a `draw(ctx, t)` function exposed
 * on `window.__R`. There is no DOM layer tree to measure, so the editable
 * composition is the exact source frame at a chosen time (the frame with the
 * most visible text), while the Original motion is recorded by stepping the
 * canvas at 30 fps and encoding those exact frames. No CSS sampling, no
 * approximation, no timestamp trimming.
 *
 * Usage
 *   node scripts/capture-canvas-reels.js scripts/source-manifests/butterfly-canvas-reels.json
 *   node scripts/capture-canvas-reels.js <manifest> --only=<design-id>
 *
 * Output
 *   data/projects/<id>/compositions/<id>.composition.json
 *   data/projects/<id>/images/poster.png
 *   data/library/sources/<id>.webm
 *   data/library/sources/<id>.jpg
 *   data/library/sources/canvas-reels.json          (provenance + hashes)
 *
 * Requires Playwright, Chrome and ffmpeg with libvpx-vp9.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
    try { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright')); }
    catch { throw new Error('Playwright is required (npm i -g playwright or the MCP copy).'); }
}

const ROOT = path.resolve(__dirname, '..');
const W = 1080;
const H = 1920;
const manifestFile = process.argv[2];
if (!manifestFile) {
    console.error('Usage: node scripts/capture-canvas-reels.js <manifest.json> [--only=<id>] [--force]');
    process.exit(2);
}
const only = (process.argv.find((arg) => arg.startsWith('--only=')) || '').split('=')[1] || '';
const force = process.argv.includes('--force');
const postersOnly = process.argv.includes('--posters-only');
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const fps = Number(manifest.fps) || 30;
const sourcesDir = path.join(ROOT, 'data', 'library', 'sources');
const projectsDir = path.join(ROOT, 'data', 'projects');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const pad = (n) => String(n).padStart(2, '0');

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function compositionFor({ id, name, title, source, reelIndex, durationSec, posterTime, tags }) {
    const duration = Math.round(durationSec * 1000);
    return {
        version: 1,
        id,
        name,
        width: W,
        height: H,
        duration,
        defaultLocale: 'en',
        activeLocale: null,
        referenceLayerId: null,
        characters: [],
        formats: [{
            id: 'master', isMaster: true, channel: 'social', label: 'Master',
            width: W, height: H, layerOverrides: {}, variableValues: {},
        }],
        activeFormatId: 'master',
        variables: [],
        brandKit: null,
        brandKitId: null,
        guardrails: { enabled: false, block: false },
        showSafeZones: true,
        revision: 0,
        meta: {
            brandName: manifest.brand,
            source: source.relative,
            sourceCollection: source.collection,
            reelIndex,
            reelTitle: title,
            posterTime,
            fps,
            canvasSource: true,
            tags,
        },
        sourceFacts: {
            htmlSource: title,
            stageMetadata: {
                aspectRatio: `${W}/${H}`,
                backgroundResolved: true,
                textLayers: 0,
                imageLayers: 1,
                stageClasses: ['canvas'],
                layout: 'rasterized',
                fonts: 'baked',
            },
            layerCount: 1,
            warnings: [
                `Canvas source: the editable composition is the exact source frame at ${posterTime.toFixed(2)}s; Original motion is the frame-exact ${fps} fps recording.`,
            ],
            kind: 'canvas-raster',
        },
        layers: [{
            id: 'source-frame',
            type: 'image',
            name: 'Source frame',
            role: 'background',
            z: 0,
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            url: `/data/projects/${id}/images/poster.png`,
            visible: true,
            opacity: 1,
            keyframes: [
                { time: 0, x: 0, y: 0, w: 100, h: 100, opacity: 1 },
                { time: duration, x: 0, y: 0, w: 100, h: 100, opacity: 1 },
            ],
        }],
    };
}

async function captureReel(page, source, reel, design) {
    const { id, name } = design;
    const durationSec = Number(reel.duration);
    const projectDir = path.join(projectsDir, id);
    fs.mkdirSync(path.join(projectDir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'compositions'), { recursive: true });
    fs.mkdirSync(sourcesDir, { recursive: true });

    // 1. The most informative still: the moment with the most visible text.
    const posterTime = await page.evaluate(({ index, duration }) => {
        const reelState = window.__R[index];
        const canvas = reelState.rl.canvas;
        const previousWidth = canvas.width;
        const previousHeight = canvas.height;
        canvas.width = 432;
        canvas.height = 768;
        const originalT = window.T;
        let log = [];
        window.T = function (ctx, text, x, y, options) {
            const alpha = options && options.a != null ? options.a : 1;
            if (text && alpha > 0.04) log.push(alpha);
            return originalT.apply(this, arguments);
        };
        let best = Math.min(0.5, duration / 2);
        let bestScore = -1;
        const start = Math.min(0.5, duration / 2);
        for (let t = start; t <= duration - 0.4; t += 0.2) {
            log = [];
            reelState.rl.render(t, 432 / 1080);
            const strong = log.filter((alpha) => alpha > 0.55).length;
            const score = log.reduce((sum, alpha) => sum + alpha, 0) + strong * 0.5;
            if (score >= bestScore) {
                bestScore = score;
                best = t;
            }
        }
        window.T = originalT;
        canvas.width = previousWidth;
        canvas.height = previousHeight;
        return Math.round(best * 1000) / 1000;
    }, { index: reel.index, duration: durationSec });

    // 2. The poster is the exact canvas at that time, at native size.
    const posterData = await page.evaluate(({ index, time }) => {
        const reelState = window.__R[index];
        const canvas = reelState.rl.canvas;
        canvas.width = 1080;
        canvas.height = 1920;
        reelState.rl.render(time, 1);
        return canvas.toDataURL('image/png');
    }, { index: reel.index, time: posterTime });
    const poster = Buffer.from(posterData.split(',')[1], 'base64');
    const posterPath = path.join(projectDir, 'images', 'poster.png');
    fs.writeFileSync(posterPath, poster);

    // 3. Step every frame at the source time, no page clock involved.
    let frameCount = 0;
    const videoPath = path.join(sourcesDir, `${id}.webm`);
    if (!postersOnly) {
    const tmp = path.join('/tmp', `canvas-reel-${id}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    frameTarget = tmp;
    frameCount = await page.evaluate(async ({ index, duration, fps: rate }) => {
        const reelState = window.__R[index];
        const canvas = reelState.rl.canvas;
        canvas.width = 1080;
        canvas.height = 1920;
        const count = Math.round(duration * rate);
        for (let frame = 0; frame < count; frame += 1) {
            reelState.rl.render(frame / rate, 1);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            await window.__saveCanvasFrame(frame, dataUrl);
        }
        return count;
    }, { index: reel.index, duration: durationSec, fps });
    frameTarget = '';

    // 4. Encode those exact frames. VP9, constant quality, no timestamp trim.
    cp.execFileSync('ffmpeg', [
        '-y', '-framerate', String(fps), '-i', path.join(tmp, 'frame-%04d.jpg'),
        '-c:v', 'libvpx-vp9', '-crf', '20', '-b:v', '0', '-pix_fmt', 'yuv420p',
        '-row-mt', '1', '-cpu-used', '4', '-deadline', 'good', videoPath,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    fs.rmSync(tmp, { recursive: true, force: true });
    }

    // 5. The UI poster, and the project composition that points at the exact still.
    const libraryPoster = path.join(sourcesDir, `${id}.jpg`);
    cp.execFileSync('ffmpeg', ['-y', '-i', posterPath, '-q:v', '2', libraryPoster], { stdio: 'ignore' });
    const composition = compositionFor({
        id, name, title: reel.title, source, reelIndex: reel.index,
        durationSec, posterTime, tags: source.tags || [],
    });
    writeJson(path.join(projectDir, 'compositions', `${id}.composition.json`), composition);

    const previous = (() => {
        try { return JSON.parse(fs.readFileSync(path.join(sourcesDir, 'canvas-reels.json'), 'utf8')).designs.find((entry) => entry.id === id); }
        catch { return null; }
    })();
    return {
        id,
        name,
        source: source.relative,
        sourceCollection: source.collection,
        sourceTitle: source.title,
        reelIndex: reel.index,
        reelTitle: reel.title,
        duration: Math.round(durationSec * 1000),
        fps,
        frames: postersOnly && previous ? previous.frames : frameCount,
        posterTime,
        posterSha256: sha(poster),
        posterBytes: poster.length,
        videoBytes: fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0,
        composition: `data/projects/${id}/compositions/${id}.composition.json`,
        sourceVideo: `/data/library/sources/${id}.webm`,
        sourcePoster: `/data/library/sources/${id}.jpg`,
        tags: source.tags || [],
    };
}

let frameTarget = '';
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    const records = [];
    const metadataFile = path.join(sourcesDir, 'canvas-reels.json');
    const previous = fs.existsSync(metadataFile) ? JSON.parse(fs.readFileSync(metadataFile, 'utf8')) : { designs: [] };
    try {
        for (const source of manifest.sources) {
            const file = path.resolve(ROOT, source.file);
            if (!fs.existsSync(file)) throw new Error(`Source not found: ${file}`);
            const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
            await page.exposeBinding('__saveCanvasFrame', (binding, frame, dataUrl) => {
                if (!frameTarget) return;
                fs.writeFileSync(
                    path.join(frameTarget, `frame-${String(frame).padStart(4, '0')}.jpg`),
                    Buffer.from(dataUrl.split(',')[1], 'base64'),
                );
            });
            await page.goto(`file://${encodeURI(file)}`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
            const reels = await page.evaluate(() => window.__R.map((state, index) => ({
                index, duration: state.d.dur, title: state.d.title, sub: state.d.sub,
            })));
            // The deck's own clock must not paint over the frame we are stepping.
            await page.evaluate(() => {
                document.querySelector('header')?.remove();
                const grid = document.getElementById('grid');
                if (grid) grid.style.display = 'none';
                window.__R.forEach((state) => { state.playing = false; state.vis = false; state.dirty = false; });
            });
            for (const reel of reels) {
                const id = `${source.idPrefix}-${pad(reel.index + 1)}`;
                if (only && id !== only) continue;
                if (!force && !postersOnly && fs.existsSync(path.join(sourcesDir, `${id}.webm`)) && fs.existsSync(path.join(projectsDir, id, 'images', 'poster.png'))) {
                    console.log('· skip (exists)', id);
                    continue;
                }
                const name = `${source.namePrefix} — ${pad(reel.index + 1)} · ${String(reel.title).replace(/^Post\s*\d+\s*·\s*/, '')}`;
                process.stdout.write(`capturing ${id} (${reel.duration}s, ${Math.round(reel.duration * fps)} frames)… `);
                const record = await captureReel(page, {
                    file: source.file,
                    relative: source.file,
                    collection: source.collection,
                    title: String(source.file).split('/').pop(),
                    tags: source.tags || [],
                }, reel, { id, name });
                records.push(record);
                console.log(`poster @ ${record.posterTime}s, ${(record.videoBytes / 1024 / 1024).toFixed(1)} MB`);
            }
            await page.close();
        }
    } finally {
        await browser.close();
    }

    const merged = (previous.designs || []).filter((design) => !records.some((record) => record.id === design.id));
    writeJson(metadataFile, {
        schema: 'agent-studio/canvas-reels/1',
        brand: manifest.brand,
        fps,
        width: W,
        height: H,
        capturedAt: new Date().toISOString(),
        designs: merged.concat(records),
    });
    console.log(`captured ${records.length} reel(s) · ${metadataFile}`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
