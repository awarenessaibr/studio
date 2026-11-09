'use strict';
/**
 * Browser round-trip test for "export the animation from Layer Studio, import it
 * into Studio Agent" — the flow where the motion has to survive unchanged.
 *
 * Run with: node tests/animation-roundtrip.js
 *
 * It drives the real export menu in pages/studio.html, takes the file the
 * browser produced, feeds it to the real file input in pages/studio-agent.html,
 * and then compares Layer Studio's own evaluation of the motion with Studio
 * Agent's playback, sample by sample.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 8823 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const failures = [];
let checks = 0;
function check(condition, message) {
    checks += 1;
    if (condition) console.log(`  ✓ ${message}`);
    else {
        failures.push(message);
        console.log(`  ✗ ${message}`);
    }
}
function close(actual, expected, tolerance = 1e-4) {
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return actual === expected;
    return Math.abs(actual - expected) <= tolerance;
}

async function waitForHealth() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${BASE}/api/health`)).ok) return;
        } catch { /* server still starting */ }
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('the studio server did not start');
}

/* Layers animated on the Layer Studio side. Together they cover every preset
   family that actually moves on the stage: entrance, ambient push/drift,
   emphasis loop, and both clip-path families. */
const SOURCE_ANIMATIONS = [
    ['ground', 'zoom', 0, 10000],
    ['photo', 'parallax', 0, 10000],
    ['headline', 'fadeIn', 300, 900],
    ['subhead', 'clipIris', 0, 1400],
    ['cta', 'clipChevron', 1200, 1000],
    ['footer', 'pulse', 2800, 2400],
];

async function main() {
    const server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverLog = '';
    server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
    server.stderr.on('data', chunk => { serverLog += chunk.toString(); });
    let browser;
    let tempFile = '';
    try {
        await waitForHealth();
        const packs = await fetch(`${BASE}/api/brand-packs`).then(response => response.json());
        const pack = packs.packs[0];
        const brand = pack.brands[0];
        const query = `pack=${encodeURIComponent(pack.id)}&brand=${encodeURIComponent(brand.id)}`;

        browser = await chromium.launch({ executablePath: CHROME, args: ['--no-first-run', '--no-default-browser-check'] });
        const studio = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        const agent = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        const pageErrors = [];
        studio.on('pageerror', error => pageErrors.push(`studio: ${error.message}`));
        agent.on('pageerror', error => pageErrors.push(`agent: ${error.message}`));

        /* ---- 1. build an animation in Layer Studio ---- */
        await studio.goto(`${BASE}/studio.html?${query}`, { waitUntil: 'domcontentloaded' });
        await studio.waitForFunction(() => !!window.__layerStudioAnimation, null, { timeout: 25000 });
        await studio.waitForTimeout(600);
        const appliedOnSource = await studio.evaluate(animations => {
            const api = window.__layerStudioAnimation;
            api.clearAnimations();
            animations.forEach(([id, preset, start, duration]) => api.setAnimation(id, preset, start, duration));
            /* A second event on the same layer: the import has to keep both, in
               their own windows, not collapse them into one track. */
            api.addAnimation('headline', 'zoom', 8000, 900);
            return api.scene().filter(layer => layer.anims.length).map(layer => layer.id);
        }, SOURCE_ANIMATIONS);
        check(appliedOnSource.length === SOURCE_ANIMATIONS.length, 'Layer Studio has animation on every test layer');
        const sourceScene = await studio.evaluate(() => window.__layerStudioAnimation.scene());
        check(SOURCE_ANIMATIONS.every(([id]) => sourceScene.some(layer => layer.id === id && layer.anims.length)),
            'each test layer reports its animation event');

        /* ---- 2. export through the real Export → Animation JSON menu ---- */
        const exported = await studio.evaluate(async () => {
            const captured = [];
            const createObjectURL = URL.createObjectURL.bind(URL);
            URL.createObjectURL = blob => { captured.push(blob); return createObjectURL(blob); };
            const anchorClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function noDownload() { /* keep the file in memory */ };
            try {
                document.querySelector('#expBtn').click();
                const item = document.querySelector('button[data-export="animation"]');
                if (!item) throw new Error('the Export menu has no Animation JSON item');
                item.click();
                for (let i = 0; i < 80 && !captured.length; i += 1) await new Promise(resolve => setTimeout(resolve, 25));
            } finally {
                URL.createObjectURL = createObjectURL;
                HTMLAnchorElement.prototype.click = anchorClick;
            }
            if (!captured.length) throw new Error('Export → Animation JSON produced no file');
            return captured[0].text();
        });
        check(typeof exported === 'string' && exported.length > 100, 'Export → Animation JSON produced a file');
        const payload = JSON.parse(exported);
        check(payload.schema === 'agent-studio/animation/2', `the file declares the baked schema (${payload.schema})`);
        check(payload.tracks.length === SOURCE_ANIMATIONS.length, `the file carries all ${SOURCE_ANIMATIONS.length} animated layers`);
        check(payload.duration === 10000, `the file records the timeline duration (${payload.duration} ms)`);
        check(payload.tracks.every(track => Array.isArray(track.segments) && track.segments.length
            && track.segments.every(segment => Array.isArray(segment.frames) && segment.frames.length > 1)),
        'every track carries sampled segments');
        const sourceTrack = payload.tracks.find(track => track.layerId === 'headline');
        const fadeSegment = sourceTrack.segments[0];
        check(sourceTrack.segments.length === 2, 'a layer with two animations exports two segments');
        check(fadeSegment.start === 300 && fadeSegment.duration === 900,
            `the baked fadeIn keeps its own timeline window (${fadeSegment.start}–${fadeSegment.start + fadeSegment.duration} ms)`);
        check(fadeSegment.frames[0].t === 0 && fadeSegment.frames[fadeSegment.frames.length - 1].t === 900,
            'segment frames are relative to the segment start');
        const fadeFrame = fadeSegment.frames.find(frame => frame.a !== undefined);
        check(!!fadeFrame, 'the baked fadeIn segment records opacity');

        tempFile = path.join(os.tmpdir(), `studio-animation-${process.pid}-${Date.now()}.json`);
        fs.writeFileSync(tempFile, exported, 'utf8');

        /* ---- 3. import into Studio Agent through the real file input ---- */
        await agent.goto(`${BASE}/studio-agent.html?${query}`, { waitUntil: 'domcontentloaded' });
        await agent.waitForFunction(() => !document.getElementById('studio').hidden, null, { timeout: 25000 });
        await agent.waitForFunction(() => !!window.__assetStudioAnimation, null, { timeout: 25000 });
        await agent.waitForTimeout(400);
        const elements = await agent.evaluate(() => window.__assetStudioAnimation.elements());
        check(elements.some(element => element.id === 'art'), 'Studio Agent has a background element to receive the ambient push');

        await agent.setInputFiles('#agentAnimationInput', tempFile);
        await agent.waitForFunction(() => Object.keys(window.__assetStudioAnimation.tracks()).length > 0, null, { timeout: 15000 });
        const importedTracks = await agent.evaluate(() => window.__assetStudioAnimation.tracks());
        check(Object.keys(importedTracks).length > 0, `the file input imported ${Object.keys(importedTracks).length} layer(s)`);
        const toastText = await agent.evaluate(() => document.querySelector('#toast').textContent);
        check(/Imported the animation onto/.test(toastText), `the import reports what it did (“${toastText}”)`);

        /* Re-run in memory to read the mapping the same decision produced. */
        const mapping = await agent.evaluate(text => window.__assetStudioAnimation.import(JSON.parse(text)), exported);
        console.log('\n  mapping:');
        mapping.assignment.forEach(entry => console.log(`    ${entry.layerId.padEnd(9)} → ${entry.targetId.padEnd(6)} ${entry.targetName || ''}`));
        if (mapping.unmatched.length) console.log(`    unmatched: ${mapping.unmatched.join(', ')}`);

        check(mapping.assignment.some(entry => entry.layerId === 'ground' && entry.targetId === 'art'),
            'the background motion lands on the background element');
        const textMapped = ['headline', 'subhead', 'cta', 'footer'].filter(id => mapping.assignment.some(entry => entry.layerId === id));
        check(textMapped.length === 4, 'all four animated text layers found a text element');
        check(new Set(mapping.assignment.map(entry => entry.targetId)).size === mapping.assignment.length,
            'no two layers were stacked onto the same element');
        const ctaEntry = mapping.assignment.find(entry => entry.layerId === 'cta');
        check(!!ctaEntry && /book|order|shop|buy|reserve/i.test(ctaEntry.targetName || ''),
            `the call to action landed on the call-to-action text (${ctaEntry && ctaEntry.targetName})`);
        check(mapping.unmatched.includes('Hero photograph') || mapping.unmatched.some(name => /photo/i.test(name)),
            'the animated photo is reported as unmatched instead of being silently dropped (this design has no image element)');

        /* ---- 4. compare Layer Studio's motion with Studio Agent's playback ---- */
        check(await agent.evaluate(() => window.__assetStudioAnimation.duration()) === 10000,
            'the timeline grew to fit the imported 10 s animation');

        let comparisons = 0;
        let worstValue = 0;
        let worstValueWhere = '';
        let worstClip = 0;
        let worstClipWhere = '';
        for (const entry of mapping.assignment) {
            const track = payload.tracks.find(item => item.layerId === entry.layerId);
            const storedEvents = importedTracks[entry.targetId] || [];
            check(storedEvents.length === track.segments.length && storedEvents.every(event => event.preset === 'baked'),
                `${entry.layerId} was stored as ${track.segments.length} baked event(s), not preset guesses`);
            const frameShapes = track.segments.every(segment => {
                const stored = storedEvents.find(event => Math.abs(event.start - segment.start) < 1e-6);
                if (!stored) return false;
                const storedByTime = new Map(stored.frames.map(frame => [frame.t, frame]));
                return segment.frames.every(frame => {
                    const copied = storedByTime.get(frame.t);
                    if (!copied) return false;
                    return ['a', 'dx', 'dy', 's', 'sx', 'sy'].every(key => close(copied[key] === undefined ? 1 : copied[key], frame[key] === undefined ? 1 : frame[key], 1e-6));
                });
            });
            check(frameShapes, `${entry.layerId}: every exported frame arrived unchanged`);
            const times = [];
            for (let t = 0; t <= payload.duration; t += 100) times.push(t);
            const [sourceSamples, agentSamples] = await Promise.all([
                studio.evaluate(({ id, times }) => times.map(t => window.__layerStudioAnimation.sample(id, t)), { id: entry.layerId, times }),
                agent.evaluate(({ id, times }) => times.map(t => window.__assetStudioAnimation.sample(id, t)), { id: entry.targetId, times }),
            ]);
            sourceSamples.forEach((source, index) => {
                const played = agentSamples[index];
                comparisons += 1;
                ['a', 'dx', 'dy', 's', 'sx', 'sy'].forEach(key => {
                    const delta = Math.abs((source[key] ?? 1) - (played[key] ?? 1));
                    if (delta > worstValue) {
                        worstValue = delta;
                        worstValueWhere = `${entry.layerId}/${key} at ${times[index]}ms`;
                    }
                });
                const sourcePoints = source.clip && source.clip.shape === 'poly' ? source.clip.points : null;
                const playedPoints = played.clip && played.clip.shape === 'poly' ? played.clip.points : null;
                if (sourcePoints && playedPoints) {
                    sourcePoints.forEach((point, pointIndex) => {
                        const other = playedPoints[pointIndex] || [0, 0];
                        const delta = Math.max(Math.abs(point[0] - other[0]), Math.abs(point[1] - other[1]));
                        if (delta > worstClip) {
                            worstClip = delta;
                            worstClipWhere = `${entry.layerId} at ${times[index]}ms`;
                        }
                    });
                } else if (!!source.clip !== !!played.clip) {
                    worstClip = Math.max(worstClip, 1);
                    worstClipWhere = `${entry.layerId} at ${times[index]}ms (clip present on one side only)`;
                }
            });
        }
        check(comparisons > 0 && worstValue <= 0.005,
            `Studio Agent replays the same transform and opacity values (worst Δ ${worstValue.toFixed(5)}${worstValueWhere ? ` — ${worstValueWhere}` : ''})`);
        check(worstClip <= 0.01,
            `Studio Agent replays the same clip-path reveal (worst Δ ${worstClip.toFixed(5)}${worstClipWhere ? ` — ${worstClipWhere}` : ''})`);

        /* ---- 5. the timeline shows the imported motion ---- */
        const timeline = await agent.evaluate(() => ({
            open: !document.getElementById('timeline').hidden,
            time: document.getElementById('tlTime').textContent,
            bars: [...document.querySelectorAll('#tlBody .tl-bar')].map(bar => bar.textContent.trim()),
            rows: [...document.querySelectorAll('#tlBody .tl-row')].map(row => ({
                name: (row.querySelector('.n') || {}).textContent || '',
                bars: [...row.querySelectorAll('.tl-bar')].map(bar => ({
                    label: bar.textContent.trim(),
                    left: Number.parseFloat(bar.style.left) || 0,
                    width: Number.parseFloat(bar.style.width) || 0,
                })),
            })),
        }));
        check(timeline.open, 'the timeline opened on import');
        check(/10\.00 s$/.test(timeline.time), `the timeline duration reads 10.00 s (${timeline.time})`);
        check(timeline.bars.some(label => /Fade In/i.test(label)), 'the timeline shows the imported entrance');
        check(timeline.bars.some(label => /Iris|Chevron|Pulse|Slow zoom|Parallax/i.test(label)), 'the timeline shows the imported clip and ambient tracks');
        const fadeRow = timeline.rows.find(row => row.bars.some(bar => /Fade In/i.test(bar.label)));
        const fadeBar = fadeRow && fadeRow.bars.find(bar => /Fade In/i.test(bar.label));
        check(!!fadeBar && Math.abs(fadeBar.left - 3) < 0.2 && Math.abs(fadeBar.width - 9) < 0.2,
            `the Fade In bar keeps its 0.3–1.2 s window on a 10 s timeline (left ${fadeBar && fadeBar.left.toFixed(2)}%, width ${fadeBar && fadeBar.width.toFixed(2)}%)`);
        const secondBar = fadeRow && fadeRow.bars.find(bar => /Slow Zoom/i.test(bar.label));
        check(!!secondBar && Math.abs(secondBar.left - 80) < 0.2 && Math.abs(secondBar.width - 9) < 0.2,
            `the second animation on the same layer keeps its own 8.0–8.9 s window (left ${secondBar && secondBar.left.toFixed(2)}%, width ${secondBar && secondBar.width.toFixed(2)}%)`);

        /* ---- 6. an old preset-only file is refused, not guessed ---- */
        const legacy = await agent.evaluate(() => {
            try {
                window.__assetStudioAnimation.import({
                    schema: 'agent-studio/animation/1',
                    duration: 10000,
                    tracks: [{ layerId: 'photo', layerName: 'Photo', event: { preset: 'parallax', start: 0, duration: 10000 } }],
                });
                return { threw: false, message: '' };
            } catch (error) {
                return { threw: true, message: error.message };
            }
        });
        check(legacy.threw && /old preset-only format/i.test(legacy.message),
            'an old preset-only file is refused with an explanation instead of being remapped');

        check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        if (tempFile) { try { fs.unlinkSync(tempFile); } catch { /* ignore */ } }
        if (failures.length) {
            console.log(`\n  server log tail:\n${serverLog.split('\n').slice(-8).join('\n')}`);
        }
    }
    console.log(`\n${checks - failures.length}/${checks} checks passed`);
    if (failures.length) {
        console.log('FAILED:');
        failures.forEach(failure => console.log(`  - ${failure}`));
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
