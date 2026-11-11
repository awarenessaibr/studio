#!/usr/bin/env node
'use strict';
/**
 * Cotton Waves is a 3 s layered CSS animation driven by draw(ms), not a
 * .stage deck. Frame-step it at 25 fps at the source's native 1672×941.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const file = path.join(ROOT, 'data/library/sources/html/cotton-waves-animated.html');
const id = 'cotton-waves-animated';
const W = 1672;
const H = 941;
const DURATION = 3000;
const FPS = 25;
const posterTime = 1.5;
const out = path.join(ROOT, 'data/library/sources', `${id}.webm`);
const poster = path.join(ROOT, 'data/projects', id, 'images', 'poster.png');

(async () => {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(`file://${encodeURI(file)}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(800);
    await page.evaluate(({ width, height }) => {
        const stage = document.getElementById('stage');
        document.body.style.margin = '0';
        document.body.style.background = '#000';
        document.documentElement.style.overflow = 'hidden';
        document.getElementById('bar').style.display = 'none';
        stage.style.position = 'fixed';
        stage.style.left = '0';
        stage.style.top = '0';
        stage.style.width = `${width}px`;
        stage.style.height = `${height}px`;
        stage.style.maxWidth = 'none';
        stage.style.borderRadius = '0';
    }, { width: W, height: H });

    const ff = cp.spawn('ffmpeg', [
        '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
        '-c:v', 'libvpx-vp9', '-b:v', '6M', '-pix_fmt', 'yuv420p', out,
    ], { stdio: ['pipe', 'ignore', 'inherit'] });
    const closed = new Promise((resolve, reject) => {
        ff.on('error', reject);
        ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    });
    const total = Math.round(DURATION / 1000 * FPS);
    for (let frame = 0; frame < total; frame += 1) {
        const ms = frame / FPS * 1000;
        // Freeze the page's own clock at this frame. The existing tick keeps
        // drawing `cur`, so the source's draw() is what gets captured.
        await page.evaluate(({ time }) => { play = false; cur = time; }, { time: ms });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H }, type: 'png' });
        if (Math.abs(ms - posterTime * 1000) < 1000 / FPS / 2) fs.writeFileSync(poster, buf);
        if (!ff.stdin.write(buf)) await new Promise((resolve) => ff.stdin.once('drain', resolve));
        if (frame % 25 === 0) process.stdout.write(`  frame ${frame}/${total}\n`);
    }
    ff.stdin.end();
    await closed;
    await browser.close();
    const probe = cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
    console.log(`captured ${id} — ${total} frames, ${probe}s`);
})().catch((error) => { console.error(error); process.exit(1); });
