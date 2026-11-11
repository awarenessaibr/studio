#!/usr/bin/env node
'use strict';
/**
 * capture-canvas-reels.js — turn a canvas HTML deck into projects and
 * frame-exact source recordings.
 *
 * Two deck shapes are supported:
 *
 * - `reels` (default): a deck exposing `window.__R[i].rl.render(t, scale)` and
 *   a duration per reel. Every reel is a pure function of time.
 * - `sim`: a single canvas exposing `window.__sim = {reset, step, draw}`. The
 *   page's own 1/60 s simulation is replayed from `reset()` and sampled at the
 *   requested frame rate; nothing is reimplemented here.
 *
 * In both cases there is no DOM layer tree to measure, so the editable
 * composition is the exact source frame at a chosen time (the frame with the
 * most visible text, or the manifest's posterTime), while Original motion is
 * recorded by stepping the canvas at the manifest's native size and frame rate
 * and encoding those exact frames. No CSS sampling, no approximation, no
 * timestamp trimming.
 *
 * Usage
 *   node scripts/capture-canvas-reels.js <manifest.json>
 *   node scripts/capture-canvas-reels.js <manifest> --only=<design-id>
 *
 * Output
 *   data/projects/<id>/compositions/<id>.composition.json
 *   data/projects/<id>/images/poster.png
 *   data/library/sources/<id>.webm
 *   data/library/sources/<id>.jpg
 *   data/library/sources/<manifest.metadata || canvas-reels.json>
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
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const manifestFile = process.argv[2];
if (!manifestFile) {
    console.error('Usage: node scripts/capture-canvas-reels.js <manifest.json> [--only=<id>] [--force]');
    process.exit(2);
}
const only = (process.argv.find((arg) => arg.startsWith('--only=')) || '').split('=')[1] || '';
const force = process.argv.includes('--force');
const postersOnly = process.argv.includes('--posters-only');
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const metadataFile = path.join(ROOT, 'data', 'library', 'sources', manifest.metadata || 'canvas-reels.json');
const sourcesDir = path.join(ROOT, 'data', 'library', 'sources');
const projectsDir = path.join(ROOT, 'data', 'projects');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const pad = (n) => String(n).padStart(2, '0');

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sourceFor(source) {
    return {
        file: source.file,
        idPrefix: source.idPrefix,
        name: source.name,
        namePrefix: source.namePrefix,
        relative: source.file,
        collection: source.collection,
        title: String(source.file).split('/').pop(),
        tags: source.tags || [],
        mode: source.mode || 'reels',
        width: Number(source.width) || DEFAULT_WIDTH,
        height: Number(source.height) || DEFAULT_HEIGHT,
        fps: Number(source.fps) || Number(manifest.fps) || 30,
        duration: source.duration != null ? Number(source.duration) : null,
        posterTime: source.posterTime != null ? Number(source.posterTime) : null,
        posterTimes: Array.isArray(source.posterTimes) ? source.posterTimes.map(Number) : null,
    };
}

function compositionFor({ id, name, title, source, reelIndex, durationSec, posterTime, tags, width, height, fps, mode }) {
    const duration = Math.round(durationSec * 1000);
    return {
        version: 1,
        id,
        name,
        width,
        height,
        duration,
        defaultLocale: 'en',
        activeLocale: null,
        referenceLayerId: null,
        characters: [],
        formats: [{
            id: 'master', isMaster: true, channel: 'social', label: 'Master',
            width, height, layerOverrides: {}, variableValues: {},
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
            deckMode: mode,
            tags,
        },
        sourceFacts: {
            htmlSource: title,
            stageMetadata: {
                aspectRatio: `${width}/${height}`,
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

function ensureDirs(id) {
    const projectDir = path.join(projectsDir, id);
    fs.mkdirSync(path.join(projectDir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'compositions'), { recursive: true });
    fs.mkdirSync(sourcesDir, { recursive: true });
    return projectDir;
}

function encodeFrames(framesDir, fps, videoPath) {
    cp.execFileSync('ffmpeg', [
        '-y', '-framerate', String(fps), '-i', path.join(framesDir, 'frame-%04d.jpg'),
        '-c:v', 'libvpx-vp9', '-crf', '20', '-b:v', '0', '-pix_fmt', 'yuv420p',
        '-row-mt', '1', '-cpu-used', '4', '-deadline', 'good', videoPath,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function writeLibraryPoster(posterPath, libraryPoster) {
    cp.execFileSync('ffmpeg', ['-y', '-i', posterPath, '-q:v', '2', libraryPoster], { stdio: 'ignore' });
}

function metadataRecord({ design, source, reelIndex, reelTitle, durationSec, fps, frames, posterTime, poster, videoPath }) {
    return {
        id: design.id,
        name: design.name,
        source: source.relative,
        sourceCollection: source.collection,
        sourceTitle: source.title,
        mode: source.mode,
        width: design.width,
        height: design.height,
        reelIndex,
        reelTitle,
        duration: Math.round(durationSec * 1000),
        fps,
        frames,
        posterTime,
        posterSha256: sha(poster),
        posterBytes: poster.length,
        videoBytes: fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0,
        composition: `data/projects/${design.id}/compositions/${design.id}.composition.json`,
        sourceVideo: `/data/library/sources/${design.id}.webm`,
        sourcePoster: `/data/library/sources/${design.id}.jpg`,
        tags: source.tags || [],
    };
}

function readPreviousMetadata(id) {
    try {
        return JSON.parse(fs.readFileSync(metadataFile, 'utf8')).designs.find((entry) => entry.id === id) || null;
    } catch {
        return null;
    }
}

/**
 * Rebuild a metadata record from files already on disk. Used when a capture is
 * skipped because the recording and poster exist but the metadata file itself
 * was never written (for example a capture interrupted after encoding).
 */
function recordFromDisk(design) {
    const projectDir = path.join(projectsDir, design.id);
    const posterPath = path.join(projectDir, 'images', 'poster.png');
    const compositionPath = path.join(projectDir, 'compositions', `${design.id}.composition.json`);
    if (!fs.existsSync(posterPath) || !fs.existsSync(compositionPath)) return null;
    const composition = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
    const meta = composition.meta || {};
    const fps = Number(meta.fps) || design.fps;
    const durationSec = composition.duration / 1000;
    const source = {
        relative: meta.source,
        collection: meta.sourceCollection,
        tags: meta.tags || [],
        mode: meta.deckMode || 'reels',
        title: String(meta.source || '').split('/').pop(),
    };
    const resolved = { ...design, width: composition.width, height: composition.height, fps };
    return metadataRecord({
        design: resolved,
        source,
        reelIndex: meta.reelIndex || 0,
        reelTitle: meta.reelTitle || design.name,
        durationSec,
        fps,
        frames: Math.round(durationSec * fps),
        posterTime: Number(meta.posterTime),
        poster: fs.readFileSync(posterPath),
        videoPath: path.join(sourcesDir, `${design.id}.webm`),
    });
}

async function captureReel(page, source, reel, design) {
    const { id, name, width, height, fps } = design;
    const durationSec = Number(reel.duration);
    const projectDir = ensureDirs(id);

    // 1. The most informative still: the moment with the most visible text.
    const requestedPoster = source.posterTimes && Number.isFinite(source.posterTimes[reel.index])
        ? source.posterTimes[reel.index]
        : source.posterTime;
    const posterTime = requestedPoster != null ? requestedPoster : await page.evaluate(({ index, duration, width, height }) => {
        const reelState = window.__R[index];
        const canvas = reelState.rl.canvas;
        const previousWidth = canvas.width;
        const previousHeight = canvas.height;
        const previewScale = 0.4;
        canvas.width = Math.round(width * previewScale);
        canvas.height = Math.round(height * previewScale);
        const originalT = window.T;
        let log = [];
        if (typeof originalT === 'function') {
            window.T = function (ctx, text, x, y, options) {
                const alpha = options && options.a != null ? options.a : 1;
                if (text && alpha > 0.04) log.push(alpha);
                return originalT.apply(this, arguments);
            };
        }
        let best = Math.min(0.5, duration / 2);
        let bestScore = -1;
        const start = Math.min(0.5, duration / 2);
        for (let t = start; t <= duration - 0.4; t += 0.2) {
            log = [];
            reelState.rl.render(t, previewScale);
            const strong = log.filter((alpha) => alpha > 0.55).length;
            const score = log.reduce((sum, alpha) => sum + alpha, 0) + strong * 0.5;
            if (score >= bestScore) {
                bestScore = score;
                best = t;
            }
        }
        if (typeof originalT === 'function') window.T = originalT;
        canvas.width = previousWidth;
        canvas.height = previousHeight;
        return Math.round(best * 1000) / 1000;
    }, { index: reel.index, duration: durationSec, width, height });

    // 2. The poster is the exact canvas at that time, at native size.
    const posterData = await page.evaluate(({ index, time, width, height }) => {
        const reelState = window.__R[index];
        const canvas = reelState.rl.canvas;
        canvas.width = width;
        canvas.height = height;
        reelState.rl.render(time, 1);
        return canvas.toDataURL('image/png');
    }, { index: reel.index, time: posterTime, width, height });
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
        frameCount = await page.evaluate(async ({ index, duration, fps: rate, width, height }) => {
            const reelState = window.__R[index];
            const canvas = reelState.rl.canvas;
            canvas.width = width;
            canvas.height = height;
            const count = Math.round(duration * rate);
            for (let frame = 0; frame < count; frame += 1) {
                reelState.rl.render(frame / rate, 1);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                await window.__saveCanvasFrame(frame, dataUrl);
            }
            return count;
        }, { index: reel.index, duration: durationSec, fps, width, height });
        frameTarget = '';

        // 4. Encode those exact frames. VP9, constant quality, no timestamp trim.
        encodeFrames(tmp, fps, videoPath);
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    // 5. The UI poster, and the project composition that points at the exact still.
    const libraryPoster = path.join(sourcesDir, `${id}.jpg`);
    writeLibraryPoster(posterPath, libraryPoster);
    const composition = compositionFor({
        id, name, title: reel.title, source, reelIndex: reel.index,
        durationSec, posterTime, tags: source.tags || [], width, height, fps, mode: source.mode,
    });
    writeJson(path.join(projectDir, 'compositions', `${id}.composition.json`), composition);

    const previous = readPreviousMetadata(id);
    return metadataRecord({
        design, source, reelIndex: reel.index, reelTitle: reel.title,
        durationSec, fps, frames: postersOnly && previous ? previous.frames : frameCount, posterTime,
        poster, videoPath,
    });
}

async function captureSim(page, source, design) {
    const { id, name, width, height, fps } = design;
    const durationSec = Number(source.duration);
    const posterTime = source.posterTime;
    if (!(durationSec > 0)) throw new Error(`Simulation deck ${id} needs a positive duration in the manifest.`);
    if (posterTime == null) throw new Error(`Simulation deck ${id} needs a posterTime in the manifest.`);
    const frameCount = Math.round(durationSec * fps);
    const posterFrame = Math.round(posterTime * fps);
    const projectDir = ensureDirs(id);

    const canvasSize = await page.evaluate(() => {
        const canvas = document.getElementById('c') || document.querySelector('canvas');
        return { width: canvas.width, height: canvas.height };
    });
    if (canvasSize.width !== width || canvasSize.height !== height) {
        throw new Error(`Simulation canvas is ${canvasSize.width}×${canvasSize.height}, the manifest says ${width}×${height}.`);
    }

    let posterData = null;
    const videoPath = path.join(sourcesDir, `${id}.webm`);
    if (!postersOnly) {
        const tmp = path.join('/tmp', `canvas-sim-${id}-${Date.now()}`);
        fs.mkdirSync(tmp, { recursive: true });
        frameTarget = tmp;
        const count = await page.evaluate(async ({ frames, rate }) => {
            const sim = window.__sim;
            const canvas = document.getElementById('c') || document.querySelector('canvas');
            const stepsPerFrame = Math.round(60 / rate);
            sim.reset();
            for (let frame = 0; frame < frames; frame += 1) {
                if (frame > 0) {
                    for (let step = 0; step < stepsPerFrame; step += 1) sim.step();
                }
                sim.draw();
                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                await window.__saveCanvasFrame(frame, dataUrl);
            }
            return frames;
        }, { frames: frameCount, rate: fps });
        frameTarget = '';
        encodeFrames(tmp, fps, videoPath);
        fs.rmSync(tmp, { recursive: true, force: true });
        if (count !== frameCount) throw new Error(`Captured ${count} frames, expected ${frameCount}.`);
    }

    // The poster is replayed on its own (reset, exact number of simulation
    // steps, one draw). Drawing the intermediate frames first can leave the
    // rasteriser a couple of least-significant bits away on rotated sprite
    // edges, so the poster is rendered with the same call the verifier uses.
    const posterUrl = await page.evaluate(({ frame }) => {
        const sim = window.__sim;
        const canvas = document.getElementById('c') || document.querySelector('canvas');
        sim.reset();
        for (let step = 0; step < frame; step += 1) sim.step();
        sim.draw();
        return canvas.toDataURL('image/png');
    }, { frame: posterFrame });
    posterData = Buffer.from(posterUrl.split(',')[1], 'base64');

    const posterPath = path.join(projectDir, 'images', 'poster.png');
    fs.writeFileSync(posterPath, posterData);
    const poster = fs.readFileSync(posterPath);
    const libraryPoster = path.join(sourcesDir, `${id}.jpg`);
    writeLibraryPoster(posterPath, libraryPoster);
    const composition = compositionFor({
        id, name, title: name, source, reelIndex: 0,
        durationSec, posterTime, tags: source.tags || [], width, height, fps, mode: source.mode,
    });
    writeJson(path.join(projectDir, 'compositions', `${id}.composition.json`), composition);

    const previous = readPreviousMetadata(id);
    return metadataRecord({
        design, source, reelIndex: 0, reelTitle: name,
        durationSec, fps, frames: postersOnly && previous ? previous.frames : frameCount, posterTime,
        poster, videoPath,
    });
}

let frameTarget = '';

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    const records = [];
    const previous = fs.existsSync(metadataFile) ? JSON.parse(fs.readFileSync(metadataFile, 'utf8')) : { designs: [] };
    try {
        for (const rawSource of manifest.sources) {
            const source = sourceFor(rawSource);
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
            if (source.mode === 'sim') {
                await page.addInitScript(() => {
                    window.__S = 1;
                    window.__manual = true;
                });
            }
            await page.goto(`file://${encodeURI(file)}`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

            if (source.mode === 'sim') {
                const id = source.idPrefix;
                if (only && id !== only) { await page.close(); continue; }
                const design = {
                    id,
                    name: rawSource.name || `${rawSource.namePrefix} — ${rawSource.collection}`,
                    width: source.width,
                    height: source.height,
                    fps: source.fps,
                };
                if (!force && !postersOnly && fs.existsSync(path.join(sourcesDir, `${id}.webm`))
                    && fs.existsSync(path.join(projectsDir, id, 'images', 'poster.png'))) {
                    const existing = readPreviousMetadata(id) || recordFromDisk(design);
                    if (existing) records.push(existing);
                    console.log('· skip (exists)', id);
                    await page.close();
                    continue;
                }
                process.stdout.write(`capturing ${id} (${source.duration}s, ${Math.round(source.duration * source.fps)} frames at ${source.width}×${source.height})… `);
                const record = await captureSim(page, source, design);
                records.push(record);
                console.log(`poster @ ${record.posterTime}s, ${(record.videoBytes / 1024 / 1024).toFixed(1)} MB`);
                await page.close();
                continue;
            }

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
                const name = `${rawSource.namePrefix} — ${pad(reel.index + 1)} · ${String(reel.title).replace(/^Post\s*\d+\s*·\s*/, '')}`;
                const design = { id, name, width: source.width, height: source.height, fps: source.fps };
                if (!force && !postersOnly && fs.existsSync(path.join(sourcesDir, `${id}.webm`)) && fs.existsSync(path.join(projectsDir, id, 'images', 'poster.png'))) {
                    const existing = readPreviousMetadata(id) || recordFromDisk(design);
                    if (existing) records.push(existing);
                    console.log('· skip (exists)', id);
                    continue;
                }
                process.stdout.write(`capturing ${id} (${reel.duration}s, ${Math.round(reel.duration * source.fps)} frames at ${source.width}×${source.height})… `);
                const record = await captureReel(page, source, reel, design);
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
        capturedAt: new Date().toISOString(),
        designs: merged.concat(records),
    });
    console.log(`captured ${records.length} design(s) · ${metadataFile}`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
