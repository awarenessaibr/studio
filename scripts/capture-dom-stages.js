#!/usr/bin/env node
'use strict';
/**
 * capture-dom-stages.js — record a CSS/JS stage from its own page, with a
 * marker that removes the load-in prefix exactly.
 *
 * The stage is isolated, a solid green overlay is shown for 250 ms, then the
 * page's animation clock is reset and the overlay is removed. The raw
 * Playwright recording is scanned for the last green frame, trimmed one frame
 * after it, and encoded for the stage's real duration. No guessed 2 s prefix.
 *
 * Usage
 *   node scripts/capture-dom-stages.js scripts/source-manifests/<manifest>.json
 *
 * Manifest item: {file,id,stage,width,height,duration,selector?}
 * Output: data/library/sources/<id>.webm and <id>.jpg (50% poster).
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
    try { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright')); }
    catch { throw new Error('Playwright is required.'); }
}

const ROOT = path.resolve(__dirname, '..');
const manifestFile = process.argv[2];
if (!manifestFile) {
    console.error('Usage: node scripts/capture-dom-stages.js <manifest.json>');
    process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const items = Array.isArray(manifest) ? manifest : manifest.stages || [];
const outDir = path.join(ROOT, 'data', 'library', 'sources');
fs.mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 25;

function greenFrameIndices(file) {
    // Decode the raw recording at 25 fps to tiny RGB frames; the marker is a
    // solid green overlay, so no image library is needed.
    const width = 32;
    const height = 18;
    const buffer = cp.execFileSync('ffmpeg', [
        '-v', 'error', '-i', file, '-vf', `fps=${FPS},scale=${width}:${height}`,
        '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-',
    ], { maxBuffer: 256 * 1024 * 1024 });
    const frameSize = width * height * 3;
    const out = [];
    for (let offset = 0, index = 0; offset + frameSize <= buffer.length; offset += frameSize, index += 1) {
        let r = 0, g = 0, b = 0;
        for (let i = offset; i < offset + frameSize; i += 3) {
            r += buffer[i]; g += buffer[i + 1]; b += buffer[i + 2];
        }
        const pixels = frameSize / 3;
        r /= pixels; g /= pixels; b /= pixels;
        if (g > 170 && r < 90 && b < 90) out.push(index);
    }
    return out;
}

function firstDarkFrame(file) {
    // Fallback for pages with a light body: the isolated stage is usually a
    // dark full-bleed frame. Used only when the green marker was not captured.
    const width = 32;
    const height = 18;
    const buffer = cp.execFileSync('ffmpeg', [
        '-v', 'error', '-i', file, '-vf', 'fps=10,scale=32:18',
        '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-',
    ], { maxBuffer: 256 * 1024 * 1024 });
    const frameSize = width * height * 3;
    for (let offset = 0, index = 0; offset + frameSize <= buffer.length; offset += frameSize, index += 1) {
        let sum = 0;
        for (let i = offset; i < offset + frameSize; i += 3) sum += (buffer[i] + buffer[i + 1] + buffer[i + 2]) / 3;
        if (sum / (frameSize / 3) < 90) return index / 10;
    }
    return null;
}

(async () => {
    const browser = await chromium.launch({
        headless: true, executablePath: chrome,
        // Narrated stages start their own <audio> from the capture hook; a
        // headless run has no user gesture to satisfy the autoplay policy.
        args: ['--autoplay-policy=no-user-gesture-required'],
    });
    for (const item of items) {
        const file = path.resolve(ROOT, item.file);
        if (!fs.existsSync(file)) { console.warn('skip (missing source)', item.id); continue; }
        const dir = fs.mkdtempSync(path.join('/tmp', `dom-stage-${item.id}-`));
        const context = await browser.newContext({
            viewport: { width: item.width, height: item.height },
            recordVideo: { dir, size: { width: item.width, height: item.height } },
        });
        const page = await context.newPage();
        await page.goto(item.url || `file://${encodeURI(file)}`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const ok = await page.evaluate(({ stage, width, height, selector }) => {
            const el = document.querySelectorAll(selector || '.stage')[stage];
            if (!el) return false;
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';
            document.body.style.margin = '0';
            document.body.style.background = '#000';
            document.body.innerHTML = '';
            el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
            el.style.width = `${width}px`; el.style.height = `${height}px`;
            el.style.maxWidth = 'none'; el.style.borderRadius = '0'; el.style.boxShadow = 'none';
            el.style.zIndex = '1';
            document.body.append(el);
            const marker = document.createElement('div');
            marker.id = '__stage_marker';
            marker.style.cssText = `position:fixed;inset:0;background:#00ff00;z-index:2147483647;pointer-events:none`;
            document.body.append(marker);
            return true;
        }, { stage: item.stage, width: item.width, height: item.height, selector: item.selector });
        if (!ok) { console.warn('skip (stage missing)', item.id); await context.close(); continue; }
        await page.waitForTimeout(1000);
        await page.evaluate(async () => {
            document.getElementById('__stage_marker')?.remove();
            if (typeof o !== 'undefined' && typeof S !== 'undefined') {
                S.forEach((stage) => { o[stage.id] = performance.now(); });
            }
            document.getAnimations().forEach((animation) => { try { animation.currentTime = 0; } catch {} });
            // A narrated stage owns a single clock: audio + animation start on
            // the same marker frame, so the muxed track needs no offset.
            if (typeof window.__narratedStart === 'function') await window.__narratedStart();
        });
        await page.waitForTimeout(item.duration + 1200);
        const raw = await page.video().path();
        await context.close();
        const green = greenFrameIndices(raw);
        if (!green.length) {
            console.warn('warn: no marker found; using 2 s trim', item.id);
        }
        const lastGreen = green.length ? green[green.length - 1] : -1;
        let trim = green.length ? (lastGreen + 1) / FPS : null;
        if (trim == null) {
            const dark = firstDarkFrame(raw);
            trim = dark != null && dark > 0.3 ? dark : 2;
        }
        const out = path.join(outDir, `${item.id}.webm`);
        // Seek after the input: an input-side -ss lands on a keyframe and the
        // output then starts early, cutting the end of the animation.
        cp.execFileSync('ffmpeg', [
            '-y', '-v', 'error', '-i', raw, '-ss', String(trim), '-t', String(item.duration / 1000),
            '-c:v', 'libvpx-vp9', '-b:v', '6M', '-pix_fmt', 'yuv420p', out,
        ], { stdio: 'ignore' });
        if (item.audio) {
            const track = path.resolve(ROOT, item.audio);
            if (!fs.existsSync(track)) throw new Error(`missing audio track: ${track}`);
            const muxed = `${out}.mux.webm`;
            // Copy the video bitstream: the picture is already encoded, only
            // the narration is added, so the recording stays byte-for-byte.
            cp.execFileSync('ffmpeg', [
                '-y', '-v', 'error', '-i', out, '-i', track,
                '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
                '-c:a', 'libopus', '-b:a', '192k', '-shortest', muxed,
            ], { stdio: 'ignore' });
            fs.renameSync(muxed, out);
        }
        const posterAt = item.posterAt != null ? item.posterAt : item.duration / 2000;
        cp.execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', out, '-ss', String(posterAt), '-frames:v', '1', '-q:v', '2', path.join(outDir, `${item.id}.jpg`)], { stdio: 'ignore' });
        const probe = cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
        console.log(`captured ${item.id} — trim ${trim.toFixed(2)}s, ${probe}s`);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
