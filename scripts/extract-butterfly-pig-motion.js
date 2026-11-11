#!/usr/bin/env node
'use strict';
/**
 * extract-butterfly-pig-motion.js — turn the chase deck's own simulation into
 * frame-exact editable sprite tracks.
 *
 * The deck draws two sprites kinds (pig, butterfly) with canvas transforms.
 * Instead of re-deriving those transforms from the source code, this script
 * instruments the page's own `draw()`: every `drawImage` call is recorded with
 * its current transform matrix, destination rectangle and global alpha. The
 * matrix is decomposed into centre, scale and rotation, which is exactly what
 * a Studio image layer keyframe stores.
 *
 * Output: src/client/studio/animations/butterfly-pig/motion-tracks.json
 * (schema butterfly-pig/motion/2, 60 fps, 24.6 s = the loop body before the
 * deck's 1.4 s fade-out).
 *
 * Usage
 *   node scripts/extract-butterfly-pig-motion.js
 */
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
    try { ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright')); }
    catch { throw new Error('Playwright is required.'); }
}

const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'data', 'library', 'sources', 'html', 'butterfly-chase.html');
const outFile = path.join(ROOT, 'src', 'client', 'studio', 'animations', 'butterfly-pig', 'motion-tracks.json');
const SPRITE_DIR = path.join(ROOT, 'src', 'client', 'studio', 'animations', 'butterfly-pig');
const FPS = 60;
const DURATION_MS = 24600;
const FRAMES = Math.round(DURATION_MS / 1000 * FPS) + 1;
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SPRITE_BY_SIZE = {
    '806x563': { kind: 'pig', facing: 'left', file: 'pig-left.png' },
    '717x549': { kind: 'pig', facing: 'right', file: 'pig-right.png' },
    '182x176': { kind: 'butterfly', facing: 'left', file: 'butterfly-left.png' },
    '205x174': { kind: 'butterfly', facing: 'right', file: 'butterfly-right.png' },
};

function pad(number) {
    return String(number).padStart(2, '0');
}

function round(value, places = 4) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}

(async () => {
    if (!fs.existsSync(source)) throw new Error(`Source deck missing: ${source}`);
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        await page.addInitScript(() => {
            window.__S = 1;
            window.__manual = true;
        });
        await page.goto(`file://${encodeURI(source)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

        const frames = await page.evaluate(({ frames, fps }) => {
            const sim = window.__sim;
            const canvas = document.getElementById('c');
            const ctx = canvas.getContext('2d');
            const proto = Object.getPrototypeOf(ctx);
            const originalDrawImage = proto.drawImage;
            const output = [];
            sim.reset();
            for (let frame = 0; frame < frames; frame += 1) {
                if (frame > 0) sim.step();
                const captured = [];
                proto.drawImage = function (image) {
                    if (image && image.naturalWidth) {
                        const args = Array.prototype.slice.call(arguments, 1);
                        let dx = 0;
                        let dy = 0;
                        let dw = image.naturalWidth;
                        let dh = image.naturalHeight;
                        if (args.length === 2) {
                            [dx, dy] = args;
                        } else if (args.length === 4) {
                            [dx, dy, dw, dh] = args;
                        } else if (args.length === 8) {
                            [dx, dy, dw, dh] = args.slice(4);
                        }
                        const matrix = this.getTransform();
                        const sx = Math.hypot(matrix.a, matrix.b);
                        const sy = Math.hypot(matrix.c, matrix.d);
                        const rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
                        const centerX = dx + dw / 2;
                        const centerY = dy + dh / 2;
                        captured.push({
                            iw: image.naturalWidth,
                            ih: image.naturalHeight,
                            x: matrix.a * centerX + matrix.c * centerY + matrix.e,
                            y: matrix.b * centerX + matrix.d * centerY + matrix.f,
                            dw,
                            dh,
                            sx,
                            sy,
                            rotation,
                            opacity: this.globalAlpha,
                        });
                    }
                    return originalDrawImage.apply(this, arguments);
                };
                try {
                    sim.draw();
                } finally {
                    proto.drawImage = originalDrawImage;
                }
                output.push({ timeMs: Math.round(frame / fps * 1000), sprites: captured });
            }
            return output;
        }, { frames: FRAMES, fps: FPS });

        // The stage's own field (the deck fills the canvas before drawing anything):
        // captured from the source at t=0, when no sprite exists yet.
        const stageUrl = await page.evaluate(() => {
            const sim = window.__sim;
            const canvas = document.getElementById('c');
            const context = canvas.getContext('2d');
            const proto = Object.getPrototypeOf(context);
            const originalDrawImage = proto.drawImage;
            const originalEllipse = proto.ellipse;
            // The field under the sprites: the deck's own background fill, with
            // sprite draws and the pig's contact shadow suppressed (both exist
            // at t=0, and the shadow is painted without drawImage).
            proto.drawImage = function () {};
            proto.ellipse = function () {};
            try {
                sim.reset();
                sim.draw();
            } finally {
                proto.drawImage = originalDrawImage;
                proto.ellipse = originalEllipse;
            }
            return canvas.toDataURL('image/png');
        });
        const stageBuffer = Buffer.from(stageUrl.split(',')[1], 'base64');
        const stageFile = path.join(SPRITE_DIR, 'stage.png');
        fs.writeFileSync(stageFile, stageBuffer);
        const stage = {
            url: '/src/client/studio/animations/butterfly-pig/stage.png',
            width: stageBuffer.readUInt32BE(16),
            height: stageBuffer.readUInt32BE(20),
            bytes: stageBuffer.length,
            sha256: require('node:crypto').createHash('sha256').update(stageBuffer).digest('hex'),
        };

        const subjects = new Map();
        subjects.set('pig', { id: 'pig', kind: 'pig', label: 'Pig', frames: [] });
        let butterflyCount = 0;

        frames.forEach((frame, index) => {
            frame.sprites.forEach((sprite, spriteIndex) => {
                const key = `${sprite.iw}x${sprite.ih}`;
                const meta = SPRITE_BY_SIZE[key];
                if (!meta) throw new Error(`Unexpected sprite ${key} in the chase deck.`);
                if (spriteIndex === 0 && meta.kind !== 'pig') throw new Error('The first sprite of a frame must be the pig.');
                if (spriteIndex > 0 && meta.kind !== 'butterfly') throw new Error('Only butterflies may follow the pig.');
                let subject;
                if (meta.kind === 'pig') {
                    subject = subjects.get('pig');
                } else {
                    const number = spriteIndex; // butterflies are drawn in stable spawn order
                    if (number > butterflyCount + 1) throw new Error('A butterfly appeared out of order.');
                    butterflyCount = Math.max(butterflyCount, number);
                    subject = subjects.get(`butterfly-${pad(number)}`);
                    if (!subject) {
                        subject = {
                            id: `butterfly-${pad(number)}`,
                            kind: 'butterfly',
                            label: `Butterfly ${pad(number)}`,
                            frames: [],
                        };
                        subjects.set(subject.id, subject);
                    }
                }
                subject.frames.push({
                    timeMs: frame.timeMs,
                    facing: meta.facing,
                    x: round(sprite.x),
                    y: round(sprite.y),
                    dw: round(sprite.dw),
                    dh: round(sprite.dh),
                    sx: round(sprite.sx, 6),
                    sy: round(sprite.sy, 6),
                    rotation: round(sprite.rotation),
                    opacity: round(sprite.opacity, 3),
                });
            });
        });

        const spriteSizes = {};
        Object.entries(SPRITE_BY_SIZE).forEach(([key, sprite]) => {
            const [width, height] = key.split('x').map(Number);
            const buffer = fs.readFileSync(path.join(SPRITE_DIR, sprite.file));
            const actualWidth = buffer.readUInt32BE(16);
            const actualHeight = buffer.readUInt32BE(20);
            if (actualWidth !== width || actualHeight !== height) {
                throw new Error(`${sprite.file} is ${actualWidth}×${actualHeight}, expected ${width}×${height}.`);
            }
            spriteSizes[sprite.kind] = spriteSizes[sprite.kind] || {};
            spriteSizes[sprite.kind][sprite.facing] = {
                width,
                height,
                bytes: buffer.length,
                sha256: require('node:crypto').createHash('sha256').update(buffer).digest('hex'),
            };
        });

        const ordered = [...subjects.values()].filter((subject) => subject.frames.length);
        ordered.sort((a, b) => {
            if (a.kind === 'pig') return -1;
            if (b.kind === 'pig') return 1;
            return a.label.localeCompare(b.label);
        });
        ordered.forEach((subject) => {
            if (subject.kind === 'butterfly') subject.spawnTimeMs = subject.frames[0].timeMs;
        });

        const tracks = {
            schema: 'butterfly-pig/motion/2',
            canvas: {
                width: 1004,
                height: 650,
                durationMs: DURATION_MS,
                fps: FPS,
                unit: 'px, origin top-left, element centres',
            },
            source: 'data/library/sources/html/butterfly-chase.html',
            sprites: spriteSizes,
            stage,
            subjects: ordered,
        };
        fs.writeFileSync(outFile, `${JSON.stringify(tracks)}\n`);
        const keyframes = ordered.reduce((sum, subject) => sum + subject.frames.length * 2, 0);
        console.log(`wrote ${path.relative(ROOT, outFile)} — ${ordered.length} subjects, ${keyframes} keyframe states, ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB`);
        console.log(`pig frames ${ordered.find((s) => s.kind === 'pig').frames.length}, butterflies ${ordered.length - 1}`);
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
