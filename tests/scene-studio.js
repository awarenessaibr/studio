'use strict';

/**
 * Browser check for the Scene studio tab in pages/segments.html: the clean
 * canvas, the documented build, data-quality notes and the missing-car path.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 8950 + Math.floor(Math.random() * 100);
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

async function waitForHealth() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${BASE}/api/health`)).ok) return;
        } catch { /* server is starting */ }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('the studio server did not start');
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
        browser = await chromium.launch({
            executablePath: CHROME,
            args: ['--no-first-run', '--no-default-browser-check'],
        });
        const page = await browser.newPage({ viewport: { width: 1600, height: 1500 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });

        await page.goto(`${BASE}/segments#scene`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelectorAll('.scene-layer').length >= 20, null, { timeout: 25000 });

        check(await page.locator('#view-scene').isVisible(), 'the Scene studio tab opens from #scene');
        check(await page.locator('.scene-layer').count() === 21, 'the documented café build places 21 clean parts');
        check(/21 parts · 9 groups/.test(await page.locator('#sceneCanvasBadge').innerText()), 'the canvas badge reports parts and groups');
        check(await page.locator('#sceneQuality li').count() >= 5, 'the data-quality findings are visible next to the canvas');
        check(/21 documented parts/.test(await page.locator('#sceneCaption').innerText()), 'the caption explains the build');
        check(await page.locator('#scenePlay').innerText() === 'Play', 'the clean canvas opens on a still composition');
        await page.locator('#scenePlay').click();
        await page.waitForTimeout(150);
        check(await page.locator('#scenePlay').innerText() === 'Pause', 'Play starts the observed scene animation');
        await page.locator('#scenePlay').click();

        const missingExample = page.locator('.scene-example.is-missing').first();
        check(await missingExample.count() === 1, 'the cars example is marked as a missing vocabulary case');
        await missingExample.click();
        await page.waitForFunction(() => document.querySelector('.scene-chip.is-missing'), null, { timeout: 10000 });
        check(/Cars & vehicles/.test(await page.locator('.scene-chip.is-missing').innerText()), 'the agent reports cars as missing instead of inventing them');
        check(/No car, van or other vehicle/.test(await page.locator('#sceneNotes').innerText()), 'the notes explain the closest available subject');
        check(await page.locator('.scene-layer').count() === 14, 'the fallback build still has a usable clean scene');

        check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
        if (failures.length) {
            if (serverLog.trim()) console.log(`\nserver log:\n${serverLog}`);
            process.exitCode = 1;
        } else {
            console.log(`\nall ${checks} Scene studio checks passed`);
        }
    }
}

main().catch((error) => {
    console.error('\nScene studio test crashed:', error);
    process.exitCode = 1;
});
