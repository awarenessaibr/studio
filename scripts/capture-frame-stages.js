#!/usr/bin/env node
'use strict';
/**
 * Frame-step a DOM stage that cannot be captured reliably with recordVideo.
 *
 * The page exposes its clock through `o` and its config array `S`. For each
 * frame we set `o[id]` so the page's own `f(t)` renders exactly that time,
 * wait two rAFs, and pipe the native-size screenshot straight into ffmpeg.
 * No marker, no guessed trim, no dropped frames.
 *
 * Usage:
 *   node scripts/capture-frame-stages.js <manifest.json>
 *   node scripts/capture-frame-stages.js <manifest.json> --poster-only
 *
 * Manifest item: {file,id,stage,width,height,duration,posterTime?}
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
const posterOnly = process.argv.includes('--poster-only');
if (!manifestFile) {
    console.error('Usage: node scripts/capture-frame-stages.js <manifest.json> [--poster-only]');
    process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const items = Array.isArray(manifest) ? manifest : manifest.stages || [];
const outDir = path.join(ROOT, 'data', 'library', 'sources');
fs.mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 25;

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    for (const item of items) {
        const file = path.resolve(ROOT, item.file);
        if (!fs.existsSync(file)) { console.warn('skip (missing source)', item.id); continue; }
        const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
        await page.goto(`file://${encodeURI(file)}`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(700);
        const pageId = await page.evaluate(({ stage, width, height }) => {
            const target = S[stage];
            S.length = 0;
            S.push(target);
            document.querySelectorAll('.col').forEach((col, i) => { if (i !== stage) col.remove(); });
            const el = target.st;
            document.body.innerHTML = '';
            document.documentElement.style.overflow = 'hidden';
            document.body.style.margin = '0';
            document.body.style.background = '#000';
            el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
            el.style.width = `${width}px`; el.style.height = `${height}px`;
            el.style.maxWidth = 'none'; el.style.borderRadius = '0'; el.style.boxShadow = 'none';
            el.style.zIndex = '1';
            document.body.append(el);
            return target.id;
        }, { stage: item.stage, width: item.width, height: item.height });

        const posterPath = path.join(ROOT, 'data', 'projects', item.id, 'images', 'poster.png');
        fs.mkdirSync(path.dirname(posterPath), { recursive: true });

        if (posterOnly) {
            const t = Number(item.posterTime);
            if (!Number.isFinite(t)) throw new Error(`missing posterTime for ${item.id}`);
            await page.evaluate(({ id, time }) => { o[id] = performance.now() - time * 1000; }, { id: pageId, time: t });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const buf = await page.screenshot({ clip: { x: 0, y: 0, width: item.width, height: item.height }, type: 'png' });
            fs.writeFileSync(posterPath, buf);
            await page.close();
            console.log(`poster ${item.id} at ${t}s (${(buf.length / 1e6).toFixed(1)} MB)`);
            continue;
        }

        const out = path.join(outDir, `${item.id}.webm`);
        const ff = cp.spawn('ffmpeg', [
            '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
            '-c:v', 'libvpx-vp9', '-b:v', '6M', '-pix_fmt', 'yuv420p', out,
        ], { stdio: ['pipe', 'ignore', 'inherit'] });
        const closed = new Promise((resolve, reject) => {
            ff.on('error', reject);
            ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
        });
        const total = Math.max(1, Math.round(item.duration / 1000 * FPS));
        const posterFrame = item.posterTime != null ? Math.round(item.posterTime * FPS) : -1;
        for (let frame = 0; frame < total; frame += 1) {
            const t = frame / FPS;
            await page.evaluate(({ id, time }) => { o[id] = performance.now() - time * 1000; }, { id: pageId, time: t });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const buf = await page.screenshot({ clip: { x: 0, y: 0, width: item.width, height: item.height }, type: 'png' });
            if (frame === posterFrame) fs.writeFileSync(posterPath, buf);
            if (!ff.stdin.write(buf)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
            if (frame % 50 === 0) process.stdout.write(`  ${item.id} frame ${frame}/${total}\n`);
        }
        ff.stdin.end();
        await closed;
        await page.close();
        const probe = cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
        console.log(`captured ${item.id} — ${total} frames, ${probe}s`);
    }
    await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
