#!/usr/bin/env node
'use strict';
/**
 * Frame-sample the runtime JS effects of the Borders Web cinematic/minimal
 * deck into editable effect layers. Each layer is one transparent SVG frame;
 * its opacity window makes the sequence play as the source animation.
 */
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'data/library/sources/html/borders-web-where-cinematic.html');
const N = 24;
const items = [
    { id: 'borders-web-where-i-work-cinematic-minimal-01', stage: 0, w: 975, h: 1104, d: 14000, name: 'Borders Web · Where I Work — Night · Soft Aurora' },
    { id: 'borders-web-where-i-work-cinematic-minimal-02', stage: 1, w: 944, h: 1130, d: 11000, name: 'Borders Web · Where I Work — Parchment · Quiet Ink-Wash' },
    { id: 'borders-web-where-i-work-cinematic-minimal-03', stage: 2, w: 928, h: 1143, d: 13000, name: 'Borders Web · Where I Work — Woven Linen · Glowing Filament' },
    { id: 'borders-web-where-i-work-cinematic-minimal-04', stage: 3, w: 960, h: 1096, d: 10000, name: 'Borders Web · Where I Work — Light Linen · Breathing Pulse' },
    { id: 'borders-web-where-i-work-cinematic-minimal-05', stage: 4, w: 1101, h: 960, d: 14000, name: 'Borders Web · Where I Work — Tartan Peach · Cinematic Bokeh' },
    { id: 'borders-web-where-i-work-cinematic-minimal-06', stage: 5, w: 1101, h: 960, d: 9000, name: 'Borders Web · Where I Work — Tartan Blue · Minimal Radial Pulse' },
];

function kf(time, opacity) {
    return { time, x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity, easing: 'linear' };
}

(async () => {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    for (const item of items) {
        const dir = path.join(ROOT, 'data/projects', item.id);
        const images = path.join(dir, 'images');
        fs.mkdirSync(images, { recursive: true });
        const page = await browser.newPage({ viewport: { width: item.w, height: item.h } });
        await page.goto(`file://${encodeURI(SOURCE)}`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(800);
        const pageId = await page.evaluate(({ stage, w, h }) => {
            const target = S[stage];
            S.length = 0;
            S.push(target);
            document.querySelectorAll('.col').forEach((col, i) => { if (i !== stage) col.remove(); });
            const el = target.st;
            document.body.innerHTML = '';
            document.body.style.background = 'transparent';
            el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
            el.style.width = `${w}px`; el.style.height = `${h}px`;
            el.style.maxWidth = 'none'; el.style.background = 'transparent';
            el.querySelector('img').style.visibility = 'hidden';
            el.querySelector('.fade').style.display = 'none';
            el.querySelector('.bar').style.display = 'none';
            document.body.append(el);
            return target.id;
        }, { stage: item.stage, w: item.w, h: item.h });

        const svg = page.locator('.stage svg');
        const files = [];
        for (let i = 0; i < N; i += 1) {
            const t = item.d * (i + 0.5) / N / 1000;
            await page.evaluate(({ id, time }) => { o[id] = performance.now() - time * 1000; }, { id: pageId, time: t });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const file = `images/fx-${String(i).padStart(2, '0')}.png`;
            await svg.screenshot({ path: path.join(dir, file), omitBackground: true });
            files.push(file);
        }
        await page.close();

        const layers = [{
            id: 'html-bg', name: 'Background photo', type: 'image',
            url: `/data/projects/${item.id}/images/html-bg.jpg`, frames: [],
            x: 0, y: 0, w: 100, h: 100, z: 0, opacity: 1, rotation: 0, fit: 'fill',
            visible: true, locked: false,
            keyframes: [kf(0, 1), kf(item.d, 1)],
            animation: { id: 'legacy', preset: 'keyframes', start: 0, duration: item.d, keyframes: [kf(0, 1), kf(item.d, 1)] },
        }];
        const slice = item.d / N;
        files.forEach((file, i) => {
            const start = i * slice;
            const end = (i + 1) * slice;
            const fade = slice * 0.18;
            const keys = [];
            if (start > 0) keys.push(kf(0, 0));
            keys.push(kf(Math.max(start, 0), i === 0 ? 1 : 0));
            keys.push(kf(Math.min(end, item.d), 1));
            keys.push(kf(Math.min(item.d, end + fade), 0));
            if (end + fade < item.d) keys.push(kf(item.d, 0));
            const unique = [];
            const seen = new Set();
            keys.forEach((frame) => {
                const key = `${frame.time}`;
                if (seen.has(key)) return;
                seen.add(key); unique.push(frame);
            });
            unique.sort((a, b) => a.time - b.time);
            layers.push({
                id: `m${String(i + 1).padStart(2, '0')}-fx`, name: 'Drawing (animated)', type: 'image',
                url: `/data/projects/${item.id}/${file}`, frames: [],
                x: 0, y: 0, w: 100, h: 100, z: i + 1, opacity: 1, rotation: 0, fit: 'fill',
                visible: true, locked: false,
                meta: { tag: 'svg', rasterized: true, animated: true, frame: i, measured: true },
                source: { type: 'html-raster', tag: 'svg' },
                keyframes: unique,
                animation: { id: 'legacy', preset: 'keyframes', start: 0, duration: item.d, keyframes: unique },
            });
        });
        const composition = {
            name: item.name, width: item.w, height: item.h, duration: item.d, layers,
            meta: {
                source: 'frame-sampled-effects', editable: true,
                sourceVideo: `/data/library/sources/${item.id}.webm`,
                poster: `/data/projects/${item.id}/images/poster.png`,
                brandName: 'Borders Web',
            },
        };
        fs.writeFileSync(path.join(dir, 'compositions', `${item.id}.editable.json`), `${JSON.stringify(composition, null, 2)}\n`);
        console.log(`built ${item.id} — ${layers.length} layers, ${N} effect frames`);
    }
    await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
