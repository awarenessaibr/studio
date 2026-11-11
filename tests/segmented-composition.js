'use strict';

/**
 * Browser check for the parented segmentation wiring in Agent Studio.
 * Loads the wired Giovannin reels 03 project, checks timeline groups and the
 * agent's segmentation context/report.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 9060 + Math.floor(Math.random() * 100);
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
        const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });

        await page.goto(`${BASE}/studio.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('boot').hidden, null, { timeout: 25000 });
        await page.locator('#impBtn').click();
        await page.waitForTimeout(1000);
        await page.fill('#impSearch', 'Giovannin');
        await page.waitForTimeout(700);
        await page.locator('.imp-row[data-cand*="06----giovannin-senza-paura-reels-03"]').first().click();
        await page.waitForFunction(() => document.querySelectorAll('#layers .lrow').length === 55, null, { timeout: 20000 });

        check(await page.locator('#layers .lrow').count() === 55, 'the wired project loads 55 layers');
        check(/55\/55 layers/.test(await page.locator('#tlStats').innerText()), 'the timeline reports all 55 child/parent layers');
        const groupLabels = await page.locator('.tg .tg-name').allInnerTexts();
        check(groupLabels.includes('Photo (m04) / Character'), 'the timeline exposes the parent/group label');
        check(groupLabels.includes('Photo (m15) / Subject'), 'the timeline exposes the second image source');
        check(groupLabels.includes('Background (html-bg) / Pattern Columns'), 'the timeline exposes the background pattern group');
        const publicIndex = await page.evaluate(async () => {
            const response = await fetch('/data/projects/06----giovannin-senza-paura-reels-03/images/segmentation/index.json');
            return { ok: response.ok, data: await response.json().catch(() => null) };
        });
        check(publicIndex.ok && publicIndex.data?.agentAwareness?.groups?.length === 8,
            'the segmentation index is public and carries agent awareness');

        const character = page.locator('.tg').filter({ hasText: 'Photo (m04) / Character' }).first();
        await character.locator('.tg-name').click();
        await page.waitForTimeout(500);
        const head = page.locator('.tr[data-layer-id]').filter({ hasText: 'Character Head' }).first();
        check(await head.count() === 1, 'expanding Character reveals the Character Head child');
        await head.locator('.n').click();
        await page.waitForTimeout(400);
        const context = await page.locator('#ctx').innerText();
        check(/Character \/ Character Head/.test(context), 'selected child context names the semantic group and object');
        check(/parent m04-photo-t-pby-sp-on/.test(context), 'selected child context names its parent layer');
        check(await page.locator('#chat .card').filter({ hasText: 'Segmented image part' }).count() === 1,
            'the selected child gets segmentation-aware suggestions instead of generic crop actions');

        await page.locator('#in').fill('segments');
        await page.locator('#f button').click();
        await page.waitForTimeout(600);
        const chat = await page.locator('#chat').innerText();
        check(/34 segmented image parts/.test(chat), 'the agent reports 34 segmented parts');
        check(/Photo \(m04\) \/ Character/.test(chat), 'the agent lists the semantic character group');
        check(/Each child inherits its parent's keyframe/.test(chat), 'the agent explains the parent animation inheritance');
        check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
        if (failures.length) {
            if (serverLog.trim()) console.log(`\nserver log:\n${serverLog}`);
            process.exitCode = 1;
        } else {
            console.log(`\nall ${checks} segmented-composition checks passed`);
        }
    }
}

main().catch((error) => {
    console.error('\nSegmented composition test crashed:', error);
    process.exitCode = 1;
});
