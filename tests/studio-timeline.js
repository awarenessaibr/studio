'use strict';
/**
 * Browser check for the role-grouped keyframe timeline in `pages/studio.html`.
 * It imports the checked-in 06 Giovannin project and exercises grouping,
 * keyframe editing and the timeline agent cards.
 *
 * Run with: node tests/studio-timeline.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 8830 + Math.floor(Math.random() * 120);
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
        } catch { /* server still starting */ }
        await new Promise(resolve => setTimeout(resolve, 150));
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
    server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
    server.stderr.on('data', chunk => { serverLog += chunk.toString(); });
    let browser;
    try {
        await waitForHealth();
        browser = await chromium.launch({
            executablePath: CHROME,
            args: ['--no-first-run', '--no-default-browser-check'],
        });
        const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });

        await page.goto(`${BASE}/studio.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('boot').hidden, null, { timeout: 25000 });
        await page.locator('#impBtn').click();
        await page.waitForSelector('.imp-row');
        await page.fill('#impSearch', 'Giovannin');
        await page.waitForTimeout(500);
        await page.locator('.imp-row').first().click();
        await page.waitForFunction(
            () => /53\/53 layers/.test(document.getElementById('tlStats')?.textContent || ''),
            null,
            { timeout: 20000 },
        );

        check(await page.locator('.tg').count() === 3, 'the project timeline groups 53 layers into three roles');
        check(/604 keys/.test(await page.locator('#tlStats').innerText()), 'the timeline reports all 604 imported keyframes');
        check(await page.locator('.tg').filter({ hasText: 'Foreground' }).first().getAttribute('data-open') === 'false',
            'large role groups start collapsed');

        const foreground = page.locator('.tg').filter({ hasText: 'Foreground' }).first();
        await foreground.locator('.tg-name').click();
        await page.waitForTimeout(400);
        const photoRow = page.locator('.tr[data-layer-id]').filter({ hasText: 'Photo' }).first();
        check(await photoRow.count() === 1, 'expanding Foreground reveals the Photo layer');
        check(await page.locator('.kf').count() >= 604, 'the expanded project shows individual keyframe diamonds');

        const marker = photoRow.locator('.kf').nth(2);
        await marker.click();
        await page.waitForTimeout(300);
        check(await page.locator('[data-kf-field="x"]').inputValue() === '-7.5',
            'selecting a keyframe opens its interpolated geometry');
        const context = await page.locator('#ctx').innerText();
        check(/key 3\/18/.test(context) && /src 7\.00s–end/.test(context),
            'the agent context carries the keyframe index and the source window');

        const before = await photoRow.locator('.kf').count();
        await page.locator('[data-kf-action="duplicate"]').click();
        await page.waitForTimeout(400);
        check(await photoRow.locator('.kf').count() === before + 1, 'duplicating a keyframe adds one diamond');
        await page.locator('[data-kf-action="delete"]').click();
        await page.waitForTimeout(400);
        check(await photoRow.locator('.kf').count() === before, 'deleting a keyframe removes one diamond');

        await page.locator('[data-kf-field="x"]').fill('12');
        await page.locator('[data-kf-field="x"]').dispatchEvent('change');
        await page.waitForTimeout(300);
        check(await page.locator('[data-kf-field="x"]').inputValue() === '12', 'keyframe geometry edits apply');

        const props = page.locator('.tg').filter({ hasText: 'Props' }).first();
        await props.locator('[data-tg-select]').click();
        await page.waitForTimeout(400);
        check(await page.locator('.tr[data-s="1"]').count() === 14, 'group Select selects all 14 prop layers');

        await page.locator('#in').fill('timeline');
        await page.locator('#f button').click();
        await page.waitForTimeout(600);
        check((await page.locator('#chat').innerText()).includes('Keyframe at playhead'),
            'the agent offers timeline actions for the selected layer');
        check((await page.locator('#chat').innerText()).includes('Fade selected layers in'),
            'the agent offers a group fade action');

        check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise(resolve => server.once('exit', resolve));
        if (failures.length) {
            if (serverLog.trim()) console.log(`\nserver log:\n${serverLog}`);
            process.exitCode = 1;
        } else {
            console.log(`\nall ${checks} Studio timeline checks passed`);
        }
    }
}

main().catch(error => {
    console.error('\nStudio timeline test crashed:', error);
    process.exitCode = 1;
});
