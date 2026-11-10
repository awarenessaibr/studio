#!/usr/bin/env node
'use strict';
/**
 * poster-compositions.js — replace an extracted DOM composition with the exact
 * source frame, while keeping the extraction archived beside it.
 *
 * The HTML extractor is useful, but its layer rendering is not guaranteed to
 * match the page: a webfont can fall back and a crop can drift. For a design
 * that must be 100% source, this script waits for the isolated stage to reach
 * a chosen time, screenshots that exact frame at native size, and writes a
 * one-layer composition (the poster) with a hold. The extracted, multi-layer
 * composition is kept as `<id>.editable.json` for future refinement.
 *
 * Usage
 *   node scripts/poster-compositions.js scripts/source-manifests/<manifest>.json
 *
 * Manifest item: {id,file,stage,width,height,duration,posterTime,name}
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
const manifestFile = process.argv[2];
if (!manifestFile) {
    console.error('Usage: node scripts/poster-compositions.js <manifest.json>');
    process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestFile), 'utf8'));
const items = Array.isArray(manifest) ? manifest : manifest.stages || [];
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fromVideo = process.argv.includes('--from-video');

function compositionFor(item, posterTime) {
    const duration = Math.round(item.duration);
    return {
        version: 1,
        id: item.id,
        name: item.name,
        width: item.width,
        height: item.height,
        duration,
        defaultLocale: 'en',
        activeLocale: null,
        referenceLayerId: null,
        characters: [],
        formats: [{
            id: 'master', isMaster: true, channel: 'social', label: 'Master',
            width: item.width, height: item.height, layerOverrides: {}, variableValues: {},
        }],
        activeFormatId: 'master',
        variables: [],
        brandKit: null,
        brandKitId: null,
        guardrails: { enabled: false, block: false },
        showSafeZones: true,
        revision: 0,
        meta: {
            brandName: 'The Butterfly and the Pig',
            htmlSource: item.file,
            posterTime,
            exactPoster: true,
            editableArchive: `compositions/${item.id}.editable.json`,
        },
        sourceFacts: {
            htmlSource: item.name,
            stageMetadata: {
                aspectRatio: `${item.width}/${item.height}`,
                backgroundResolved: true,
                textLayers: 0,
                imageLayers: 1,
                stageClasses: ['stage'],
                layout: 'rasterized',
                fonts: 'baked',
            },
            layerCount: 1,
            warnings: [
                `HTML stage rasterized to its exact poster frame at ${posterTime.toFixed(2)}s; the extracted multi-layer composition is archived at compositions/${item.id}.editable.json. Original motion is the source recording.`,
            ],
            kind: 'html-stage-poster',
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
            url: `/data/projects/${item.id}/images/poster.png`,
            visible: true,
            opacity: 1,
            keyframes: [
                { time: 0, x: 0, y: 0, w: 100, h: 100, opacity: 1 },
                { time: duration, x: 0, y: 0, w: 100, h: 100, opacity: 1 },
            ],
        }],
    };
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    const records = [];
    try {
        for (const item of items) {
            const file = path.resolve(ROOT, item.file);
            if (!fs.existsSync(file)) { console.warn('skip (missing source)', item.id); continue; }
            const projectDir = path.join(ROOT, 'data', 'projects', item.id);
            fs.mkdirSync(path.join(projectDir, 'images'), { recursive: true });
            fs.mkdirSync(path.join(projectDir, 'compositions'), { recursive: true });
            const posterPath = path.join(projectDir, 'images', 'poster.png');
            let png;
            if (fromVideo) {
                // Extract the frame from the source recording itself. This
                // guarantees the composition still and the recording are the
                // same moment; a live render can drift by a frame.
                const video = path.join(ROOT, 'data', 'library', 'sources', `${item.id}.webm`);
                cp.execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-ss', String(item.posterTime), '-frames:v', '1', posterPath], { stdio: 'ignore' });
                png = fs.readFileSync(posterPath);
            } else {
                const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
                await page.goto(`file://${encodeURI(file)}`, { waitUntil: 'load', timeout: 60000 });
                await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 20000 }).catch(() => {});
                await page.waitForTimeout(1200);
                const ok = await page.evaluate(({ stage, width, height }) => {
                    const el = document.querySelectorAll('.stage')[stage];
                    if (!el) return false;
                    document.documentElement.style.overflow = 'hidden';
                    document.body.style.overflow = 'hidden';
                    document.body.style.margin = '0';
                    document.body.style.background = '#000';
                    document.body.innerHTML = '';
                    el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
                    el.style.width = `${width}px`; el.style.height = `${height}px`;
                    el.style.maxWidth = 'none'; el.style.borderRadius = '0'; el.style.boxShadow = 'none';
                    document.body.append(el);
                    S.forEach((stageEl) => { o[stageEl.id] = performance.now(); });
                    document.getAnimations().forEach((animation) => { try { animation.currentTime = 0; } catch {} });
                    return true;
                }, { stage: item.stage, width: item.width, height: item.height });
                if (!ok) { console.warn('skip (stage missing)', item.id); await page.close(); continue; }
                await page.waitForTimeout(item.posterTime * 1000);
                png = await page.screenshot({ type: 'png' });
                await page.close();
                fs.writeFileSync(posterPath, png);
            }
            fs.mkdirSync(path.join(ROOT, 'data', 'library', 'sources'), { recursive: true });
            cp.execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', posterPath, '-q:v', '2', path.join(ROOT, 'data', 'library', 'sources', `${item.id}.jpg`)], { stdio: 'ignore' });

            const compositionPath = path.join(projectDir, 'compositions', `${item.id}.composition.json`);
            if (fs.existsSync(compositionPath)) {
                const existing = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
                if ((existing.layers || []).length > 1) {
                    fs.writeFileSync(path.join(projectDir, 'compositions', `${item.id}.editable.json`), `${JSON.stringify(existing, null, 2)}\n`);
                }
            }
            fs.writeFileSync(compositionPath, `${JSON.stringify(compositionFor(item, item.posterTime), null, 2)}\n`);
            const record = {
                id: item.id,
                name: item.name,
                source: item.file,
                stage: item.stage,
                width: item.width,
                height: item.height,
                duration: item.duration,
                posterTime: item.posterTime,
                posterSha256: sha(png),
                posterBytes: png.length,
                composition: `data/projects/${item.id}/compositions/${item.id}.composition.json`,
                editableArchive: `data/projects/${item.id}/compositions/${item.id}.editable.json`,
                sourceVideo: `/data/library/sources/${item.id}.webm`,
                sourcePoster: `/data/library/sources/${item.id}.jpg`,
            };
            records.push(record);
            console.log(`✓ ${item.id} — poster at ${item.posterTime}s (${(png.length / 1024 / 1024).toFixed(1)} MB), composition replaced`);
        }
    } finally {
        await browser.close();
    }
    const metaFile = path.join(ROOT, 'data', 'library', 'sources', 'new-posts.json');
    const previous = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : { designs: [] };
    const merged = (previous.designs || []).filter((design) => !records.some((record) => record.id === design.id));
    fs.writeFileSync(metaFile, `${JSON.stringify({
        schema: 'agent-studio/html-posts/1',
        capturedAt: new Date().toISOString(),
        designs: merged.concat(records),
    }, null, 2)}\n`);
    console.log(`recorded ${records.length} poster composition(s)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
