#!/usr/bin/env node
'use strict';
/**
 * render-narrated-video.js — render a narrated stage frame by frame, then mux
 * the narration at sample zero.
 *
 * Why not the screen recorder: Playwright's video writer stamps frames on a
 * fixed 25 fps grid while the page renders at ~21 fps under a 1080×1920 blur
 * and grain load, so a 34 s recording played back 15 % slow and every card
 * drifted behind its line. Here each frame is asked for by timestamp
 * (`window.__renderAt(ms)`), screenshotted, and piped to ffmpeg. Frame N is
 * exactly N/25 s, so the picture and the narration cannot drift.
 *
 * Usage
 *   node scripts/render-narrated-video.js <render-manifest.json>
 *
 * Manifest
 *   { file, durationMs, fps, audio, outMp4, outWebm?, posterAt?, poster? }
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
    console.error('Usage: node scripts/render-narrated-video.js <manifest.json>');
    process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const fps = Number(manifest.fps) || 25;
const durationMs = Number(manifest.durationMs);
const frames = Math.round((durationMs * fps) / 1000);
const limit = Number(process.env.RENDER_LIMIT) || frames;
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const file = path.resolve(ROOT, manifest.file);
    const audio = path.resolve(ROOT, manifest.audio);
    if (!fs.existsSync(file)) throw new Error(`missing stage: ${file}`);
    if (!fs.existsSync(audio)) throw new Error(`missing audio: ${audio}`);
    const outMp4 = path.resolve(ROOT, manifest.outMp4);
    fs.mkdirSync(path.dirname(outMp4), { recursive: true });

    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    const page = await browser.newPage({ viewport: { width: manifest.width || 1080, height: manifest.height || 1920 } });
    await page.goto(`file://${encodeURI(file)}${manifest.query || '?capture=1'}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
    });
    const meta = await page.evaluate(() => window.__narratedMeta);
    if (!meta || !meta.durationMs) throw new Error('the stage has no __narratedMeta / __renderAt hook');

    const ffmpeg = cp.spawn('ffmpeg', [
        '-y', '-v', 'error',
        '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
        '-i', audio,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
        outMp4,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const finished = new Promise((resolve, reject) => {
        ffmpeg.on('error', reject);
        ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });

    const started = Date.now();
    for (let i = 0; i < limit; i += 1) {
        const ms = Math.round((i * 1000) / fps);
        await page.evaluate(t => window.__renderAt(t), ms);
        const shot = await page.screenshot({ type: 'png' });
        await new Promise((resolve) => {
            if (ffmpeg.stdin.write(shot)) resolve();
            else ffmpeg.stdin.once('drain', resolve);
        });
        if (i % 50 === 0 || i === limit - 1) {
            const elapsed = (Date.now() - started) / 1000;
            console.log(`frame ${i + 1}/${limit}  ${elapsed.toFixed(0)}s  (${(elapsed / (i + 1) * 1000).toFixed(0)} ms/frame)`);
        }
    }
    ffmpeg.stdin.end();
    await finished;
    await browser.close();
    if (limit !== frames) { console.log(`partial render (${limit} frames) → ${outMp4}`); return; }

    console.log(`wrote ${path.relative(ROOT, outMp4)} (${(fs.statSync(outMp4).size / 1024 / 1024).toFixed(1)} MB)`);
    if (manifest.outWebm) {
        const outWebm = path.resolve(ROOT, manifest.outWebm);
        fs.mkdirSync(path.dirname(outWebm), { recursive: true });
        cp.execFileSync('ffmpeg', [
            '-y', '-v', 'error', '-i', outMp4,
            '-c:v', 'libvpx-vp9', '-b:v', '6M', '-pix_fmt', 'yuv420p',
            '-c:a', 'libopus', '-b:a', '192k', '-shortest', outWebm,
        ], { stdio: 'ignore' });
        console.log(`wrote ${path.relative(ROOT, outWebm)} (${(fs.statSync(outWebm).size / 1024 / 1024).toFixed(1)} MB)`);
    }
    if (manifest.poster) {
        const poster = path.resolve(ROOT, manifest.poster);
        fs.mkdirSync(path.dirname(poster), { recursive: true });
        cp.execFileSync('ffmpeg', [
            '-y', '-v', 'error', '-i', outMp4, '-ss', String(manifest.posterAt || 0),
            '-frames:v', '1', '-q:v', '2', poster,
        ], { stdio: 'ignore' });
        console.log(`wrote ${path.relative(ROOT, poster)}`);
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
