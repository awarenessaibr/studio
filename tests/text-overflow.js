'use strict';
/**
 * Browser test for the hidden-line repair offered on studio-v2.html.
 *
 * Run with: node tests/text-overflow.js
 *
 * A clipping text box drops whole lines on export. Loading a composition with
 * any must offer a one-click fit that keeps every line visible, report what it
 * changed, and be undoable.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 9023 + Math.floor(Math.random() * 200);
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
const close = (a, b, tolerance = 0.05) => Math.abs(Number(a) - Number(b)) <= tolerance;

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

/* Two clipping layers, so both repair strategies are exercised:
   `roomy` may grow its box; `tight` is boxed in by the layer below it and can
   only shrink its type. `below` and `fits` must not be touched. */
function fixtureLayer(id, y, h, sizePct, text, z) {
    return {
        id,
        name: id,
        type: 'text',
        text,
        x: 8,
        y,
        w: 60,
        h,
        z,
        opacity: 1,
        color: '#ffffff',
        role: 'foreground',
        font: {
            family: 'Inter',
            weight: 700,
            style: 'normal',
            sizePct,
            lineHeight: 1.2,
            letterSpacingEm: 0,
            transform: 'none',
        },
        align: 'left',
        verticalAlign: 'top',
        overflow: 'clip',
    };
}
const FIXTURE = {
    version: 3,
    id: 'overflow-fixture',
    name: 'Overflow fixture',
    width: 1080,
    height: 1920,
    duration: 3000,
    defaultLocale: 'en',
    referenceLayerId: null,
    formats: [{ id: 'master', isMaster: true, channel: 'custom', label: 'Master', width: 1080, height: 1920 }],
    layers: [
        fixtureLayer('roomy', 10, 3, 10, 'one two three four five six seven eight', 1),
        fixtureLayer('tight', 40, 7, 10, 'Tight line', 2),
        fixtureLayer('below', 48, 10, 3, 'Neighbour', 3),
        fixtureLayer('fits', 70, 12, 4, 'one two three', 4),
    ],
};

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
    try {
        await waitForHealth();
        browser = await chromium.launch({ executablePath: CHROME, args: ['--no-first-run', '--no-default-browser-check'] });
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${BASE}/studio-v2.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.layerStudio, null, { timeout: 25000 });
        await page.waitForTimeout(400);

        const state = () => page.evaluate(() => window.layerStudio.composition.layers.map(layer => ({
            id: layer.id,
            sizePct: layer.font && layer.font.sizePct,
            h: layer.h,
            text: layer.text,
        })));
        const banner = () => page.evaluate(() => {
            const node = document.getElementById('layerTextOverflowBanner');
            return {
                hidden: node.hidden,
                mode: node.dataset.mode || '',
                title: document.getElementById('layerTextOverflowTitle').textContent,
                detail: document.getElementById('layerTextOverflowDetail').textContent,
                undoHidden: document.getElementById('layerTextOverflowUndo').hidden,
                fixHidden: document.getElementById('layerTextOverflowFix').hidden,
                reviewHidden: document.getElementById('layerTextOverflowReview').hidden,
            };
        });
        const report = () => page.evaluate(() => window.layerStudio.textOverflowLayers());

        /* ---- 1. loading a composition with clipping offers the repair ---- */
        const opened = await page.evaluate(fixture => {
            window.layerStudio.openComposition(fixture);
            return window.layerStudio.textOverflowLayers().map(entry => entry.layerId).sort();
        }, FIXTURE);
        await page.waitForTimeout(500);
        check(opened.join(',') === 'roomy,tight', `loading reports exactly the clipping layers (${opened.join(', ')})`);
        const emptyBefore = await banner();
        check(!emptyBefore.hidden && emptyBefore.mode === 'fix', 'the hidden-line banner appears on load');
        check(/2 text layers have 10 hidden lines/.test(emptyBefore.title), `the banner counts layers and lines (“${emptyBefore.title}”)`);
        check(!emptyBefore.fixHidden && !emptyBefore.reviewHidden, 'the banner offers Fix all and Review');
        check(emptyBefore.undoHidden, 'no undo is offered before anything changed');

        const before = await state();
        const roomyBefore = before.find(layer => layer.id === 'roomy');
        const tightBefore = before.find(layer => layer.id === 'tight');

        /* ---- 2. Review selects the layer and the inspector offers a local fix ---- */
        await page.locator('#layerTextOverflowReview').click();
        await page.waitForTimeout(400);
        const reviewed = await page.evaluate(() => ({
            selected: window.layerStudio.selectedLayerId,
            fixButtons: [...document.querySelectorAll('#layerInspector .layer-overflow-fix')].map(button => button.textContent.trim()),
            warnings: [...document.querySelectorAll('#layerInspector [data-text-overflow]')].map(node => node.textContent.trim()),
        }));
        check(['roomy', 'tight'].includes(reviewed.selected), `Review selects a clipping layer (${reviewed.selected})`);
        check(reviewed.fixButtons.length === 1 && /Fit \d+ hidden line/.test(reviewed.fixButtons[0]),
            `the inspector offers a per-layer fit (“${reviewed.fixButtons[0] || 'missing'}”)`);
        check(reviewed.warnings.length === 1, 'the inspector still explains the overflow');

        /* ---- 3. the inspector button fixes just that layer, and that is undoable ---- */
        await page.locator('#layerInspector .layer-overflow-fix').click();
        await page.waitForTimeout(600);
        const afterOne = await report();
        check(afterOne.length === 1, `the per-layer fit leaves the other layer alone (${afterOne.map(entry => entry.layerId).join(',')})`);
        const oneFixed = await banner();
        check(!oneFixed.hidden && !oneFixed.undoHidden, 'a partial repair still offers Undo');
        await page.locator('#layerTextOverflowUndo').click();
        await page.waitForTimeout(600);
        const undoneOnce = await report();
        const restoredOnce = await state();
        check(undoneOnce.length === 2, 'undo after a partial repair brings the layer back into the report');
        check(restoredOnce.every(layer => {
            const original = before.find(item => item.id === layer.id);
            return original && close(original.sizePct, layer.sizePct) && close(original.h, layer.h);
        }), 'undo restores every layer exactly');

        /* ---- 4. Fix all repairs both strategies, keeping the copy ---- */
        await page.locator('#layerTextOverflowFix').click();
        await page.waitForTimeout(800);
        const fixedReport = await report();
        const after = await state();
        check(fixedReport.length === 0, 'Fix all leaves no hidden lines');
        const roomyAfter = after.find(layer => layer.id === 'roomy');
        const tightAfter = after.find(layer => layer.id === 'tight');
        check(roomyAfter.h > roomyBefore.h + 0.1, `the roomy layer grew its box (${roomyBefore.h}% → ${roomyAfter.h}%)`);
        check(tightAfter.h === tightBefore.h, `the boxed-in layer kept its box (${tightBefore.h}%)`);
        check(tightAfter.sizePct < tightBefore.sizePct, `the boxed-in layer reduced its type (${tightBefore.sizePct}% → ${tightAfter.sizePct}%)`);
        check(after.every(layer => {
            const original = before.find(item => item.id === layer.id);
            return original && original.text === layer.text;
        }), 'the copy itself is never edited');
        const untouched = after.filter(layer => ['below', 'fits'].includes(layer.id));
        check(untouched.every(layer => {
            const original = before.find(item => item.id === layer.id);
            return original && original.sizePct === layer.sizePct && original.h === layer.h;
        }), 'layers without hidden lines are untouched');
        const fixedBanner = await banner();
        check(!fixedBanner.hidden && fixedBanner.mode === 'fixed' && !fixedBanner.undoHidden,
            `the banner confirms the fit and offers undo (“${fixedBanner.title}”)`);
        check(/Fitted 2 text layers/.test(await page.evaluate(() => document.getElementById('layerStudioStatus').textContent)),
            'the status bar reports what changed');

        /* ---- 5. undo restores the pre-fix composition ---- */
        await page.locator('#layerTextOverflowUndo').click();
        await page.waitForTimeout(700);
        const undone = await state();
        check((await report()).length === 2, 'undo puts the hidden lines back');
        check(undone.every(layer => {
            const original = before.find(item => item.id === layer.id);
            return original && close(original.sizePct, layer.sizePct) && close(original.h, layer.h) && original.text === layer.text;
        }), 'undo restores every size, height and copy');

        /* ---- 6. dismissing hides the offer until something changes ---- */
        await page.locator('#layerTextOverflowDismiss').click();
        await page.waitForTimeout(300);
        check((await banner()).hidden, 'dismissing hides the banner');
        await page.evaluate(() => window.layerStudio.render());
        await page.waitForTimeout(300);
        check((await banner()).hidden, 'it stays dismissed across renders of the same report');
        const engineFix = await page.evaluate(() => window.layerStudio.repairTextOverflow().fixed.length);
        await page.waitForTimeout(500);
        check(engineFix === 2, 'the engine API still fits every layer after the banner was dismissed');
        check((await report()).length === 0, 'the programmatic repair also clears the report');

        const canvasRendered = await page.evaluate(() => document.querySelectorAll('#layerCanvas > *').length);
        check(canvasRendered > 0, 'the canvas still renders after the repairs');
        check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ') || 'none'})`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        if (failures.length) console.log(`\n  server log tail:\n${serverLog.split('\n').slice(-8).join('\n')}`);
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
