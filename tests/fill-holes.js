'use strict';
/**
 * Browser check for "Fill holes" on a segment.
 *
 * Boots the real server, opens the Melano - Buriti repository project (its
 * paper-textured cut-outs have real occlusion holes), fills the hills
 * background through the UI, and verifies the dialog, the preview, and that
 * applying replaces the segment image without touching its geometry.
 *
 * Run with: node tests/fill-holes.js
 */
const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 8623 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCREENSHOTS = path.join(ROOT, '_dev', 'screenshots');

const PROJECT_ID = 'repo-Melano---Buriti';
const COMPOSITION_ID = 'Melano---Buriti';

const failures = [];
let checks = 0;

function check(condition, message) {
    checks += 1;
    if (condition) {
        console.log(`  ✓ ${message}`);
    } else {
        failures.push(message);
        console.log(`  ✗ ${message}`);
    }
}

async function waitForHealth() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${BASE}/api/health`)).ok) return;
        } catch { /* server still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('the studio server did not start');
}

async function expandGroup(page, label) {
    const row = page.locator('#segTree .seg-row[data-child="false"]', { hasText: label }).first();
    if (!(await row.count())) return false;
    if ((await row.getAttribute('data-open')) === 'true') return true;
    await row.locator('.seg-name').click();
    await page.waitForFunction(
        (text) => Array.from(document.querySelectorAll('#segTree .seg-row[data-child="false"]'))
            .some((element) => element.textContent.includes(text) && element.dataset.open === 'true'),
        label,
        { timeout: 5000 },
    );
    return true;
}

async function openFill(page, layerName) {
    const row = page.locator('#segTree .seg-row[data-child="true"]', { hasText: layerName }).first();
    await row.hover();
    const button = row.locator('[data-act="fill-holes"]');
    if (!(await button.count())) return { missing: true };
    await button.click();
    await page.waitForSelector('#segmentFillDialog[open]', { timeout: 5000 });
    return { missing: false };
}

async function waitForDialog(page, { expectError = false } = {}) {
    await page.waitForFunction((error) => {
        const status = document.getElementById('segmentFillStatus');
        const apply = document.getElementById('segmentFillApply');
        if (error) return status.dataset.error === 'true';
        return !apply.disabled || status.dataset.error === 'true';
    }, expectError, { timeout: 90000 });
}

async function main() {
    const server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverLog = '';
    server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
    server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

    let browser;
    try {
        await waitForHealth();
        const composition = await fetch(`${BASE}/api/projects/${PROJECT_ID}/compositions/${COMPOSITION_ID}`)
            .then((response) => response.json());
        check(Boolean(composition && Array.isArray(composition.layers) && composition.layers.length),
            `the Melano - Buriti project loads (${composition?.layers?.length || 0} layers)`);

        await fsp.mkdir(SCREENSHOTS, { recursive: true });
        browser = await chromium.launch({
            executablePath: CHROME,
            args: ['--no-first-run', '--no-default-browser-check'],
        });
        const errors = [];
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            // The "nothing in front" case is exercised on purpose; the dialog
            // reports it, and the engine logs why.
            if (message.type() === 'error' && !/segment hole fill failed: Error: No visible segment/i.test(message.text())) {
                errors.push(message.text());
            }
        });

        await page.goto(`${BASE}/studio-v2.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.layerStudio), null, { timeout: 30000 });
        await page.evaluate(async ({ projectId, compositionId }) => {
            const value = await fetch(`/api/projects/${projectId}/compositions/${compositionId}`)
                .then((response) => response.json());
            window.layerStudio.openComposition(value, {
                repositorySource: { projectId, compositionId },
            });
        }, { projectId: PROJECT_ID, compositionId: COMPOSITION_ID });
        await page.waitForTimeout(1200);
        check((await page.locator('#segTree .seg-row').count()) > 5, 'the segment tree lists the project layers');

        const expanded = await expandGroup(page, 'Landscape');
        check(expanded, 'the Landscape group expands');

        const opened = await openFill(page, 'hills-background');
        check(!opened.missing, 'every image segment offers a fill-holes action');
        if (opened.missing) throw new Error('the fill action is missing from the segment row');

        await waitForDialog(page);
        const error = await page.getAttribute('#segmentFillStatus', 'data-error');
        const status = (await page.textContent('#segmentFillStatus')) || '';
        const stats = (await page.textContent('#segmentFillStats')) || '';
        check(error === 'false', `the fill completes without an error (${status.trim()})`);
        check(/hidden pixels rebuilt/.test(stats), `the dialog reports what it rebuilt (${stats.trim()})`);
        check(!(await page.locator('#segmentFillApply').isDisabled()), 'the fill can be applied');

        const afterSrc = await page.getAttribute('#segmentFillImage', 'src');
        await page.click('#segmentFillShowBefore');
        const beforeSrc = await page.getAttribute('#segmentFillImage', 'src');
        check(Boolean(beforeSrc) && beforeSrc !== afterSrc, 'the Before/After tabs show different images');
        await page.click('#segmentFillShowAfter');
        await page.screenshot({ path: path.join(SCREENSHOTS, 'fill-holes-dialog.png') });

        const before = await page.evaluate(() => {
            const layer = window.layerStudio.composition.layers.find((item) => item.name === 'hills-background');
            return {
                url: layer.url,
                x: layer.x,
                y: layer.y,
                w: layer.w,
                h: layer.h,
                z: layer.z,
                frames: layer.frames?.length || 0,
            };
        });
        await page.click('#segmentFillApply');
        await page.waitForTimeout(500);
        const applied = await page.evaluate(() => {
            const layer = window.layerStudio.composition.layers.find((item) => item.name === 'hills-background');
            return {
                url: layer.url,
                x: layer.x,
                y: layer.y,
                w: layer.w,
                h: layer.h,
                z: layer.z,
                frames: layer.frames?.length || 0,
                dialogOpen: document.getElementById('segmentFillDialog').open,
            };
        });
        check(applied.url.startsWith('data:image/png;base64,'), 'applying writes a new PNG into the segment');
        check(applied.url !== before.url, 'the segment no longer uses the original cut-out');
        check(applied.x === before.x && applied.y === before.y && applied.w === before.w
            && applied.h === before.h && applied.z === before.z, 'size, position and stacking are untouched');
        check(applied.frames === 1, 'the segment keeps exactly one frame');
        check(!applied.dialogOpen, 'the dialog closes after applying');
        const statusAfter = (await page.textContent('#layerStudioStatus')) || '';
        check(/Filled [\d,]+ hidden pixels/.test(statusAfter), `the studio reports the fill (${statusAfter.trim()})`);

        const canvasLayers = await page.locator('#layerCanvas .layer-item').count();
        check(canvasLayers > 5, `the composition still renders (${canvasLayers} layer nodes)`);
        await page.screenshot({ path: path.join(SCREENSHOTS, 'fill-holes-applied.png') });

        // A segment with nothing above it has nothing to rebuild.
        await page.evaluate(() => {
            const studio = window.layerStudio;
            const layer = studio.composition.layers.find((item) => item.name === 'cloud-left');
            layer.z = 1000;
            studio.render();
        });
        await page.waitForTimeout(200);
        await expandGroup(page, 'Sky Elements');
        await openFill(page, 'cloud-left');
        await waitForDialog(page, { expectError: true });
        const guardStatus = (await page.textContent('#segmentFillStatus')) || '';
        check(/no visible segment sits in front/i.test(guardStatus), `a topmost segment explains why it has no holes (${guardStatus.trim()})`);
        check(await page.locator('#segmentFillApply').isDisabled(), 'an empty fill cannot be applied');
        await page.click('#segmentFillCancel');
        await page.waitForTimeout(150);
        check(!(await page.locator('#segmentFillDialog').getAttribute('open')), 'cancelling closes the dialog');

        check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ') || 'none'})`);
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (server.exitCode === null) server.kill('SIGKILL');
        if (failures.length) {
            console.log(`\n${failures.length} failure(s)`);
            if (serverLog) console.log(serverLog.slice(-3000));
        }
    }

    console.log(`\n${checks - failures.length}/${checks} checks passed`);
    if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
