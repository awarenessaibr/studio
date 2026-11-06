'use strict';
/**
 * Browser smoke test for brand-template integration in Studio Agent.
 *
 * Run with: node tests/agent-studio.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 8623 + Math.floor(Math.random() * 200);
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
        } catch { /* wait for server startup */ }
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('the studio server did not start');
}

async function main() {
    const server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let serverLog = '';
    server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
    server.stderr.on('data', chunk => { serverLog += chunk.toString(); });
    let browser;
    try {
        await waitForHealth();
        browser = await chromium.launch({
            executablePath: CHROME,
            args: ['--no-first-run', '--no-default-browser-check']
        });
        const page = await browser.newPage({
            viewport: { width: 1600, height: 1100 },
            acceptDownloads: true
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`${BASE}/studio-agent.html?brand=boardwalk`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !document.getElementById('studio').hidden, null, { timeout: 20000 });
        const expected = await page.evaluate(async () => {
            const { packs } = await fetch('/api/brand-packs').then(response => response.json());
            for (const summary of packs || []) {
                const { pack } = await fetch(`/api/brand-packs/${encodeURIComponent(summary.id)}`).then(response => response.json());
                const brand = pack?.brands?.find(entry => entry.id === 'boardwalk');
                if (brand) return window.StudioBrand.templateCatalog(brand).length;
            }
            return 0;
        });

        const categoryResults = [];
        for (const tab of await page.locator('.category-tab').all()) {
            await tab.click();
            await page.waitForTimeout(100);
            const count = await page.locator('.is-brand-template').count();
            const category = await tab.innerText();
            categoryResults.push({ category, count });
            for (let index = 0; index < count; index += 1) {
                const card = page.locator('.is-brand-template').nth(index);
                await card.click();
                await page.waitForTimeout(80);
                const rendered = await page.locator('#previewCanvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0);
                check(rendered, `brand design in ${category} renders in Studio Agent`);
            }
        }
        const total = categoryResults.reduce((sum, entry) => sum + entry.count, 0);
        check(expected > 0 && total === expected, `all ${expected} catalog templates appear in their design categories`);

        const copyInput = page.locator('#controlBody input, #controlBody textarea').first();
        const hasCopy = await copyInput.count();
        check(hasCopy > 0, 'brand templates expose editable copy fields');
        if (hasCopy) {
            const before = await page.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
            await copyInput.fill('Agent Studio edited copy');
            await page.waitForTimeout(180);
            const after = await page.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
            check(before !== after, 'editing brand-template copy repaints the canvas');
        }
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#downloadBtn').click()
        ]);
        check(download.suggestedFilename().endsWith('.png'), 'brand templates export as PNG from Studio Agent');

        const relevantErrors = errors.filter(message => !/favicon|net::ERR_/i.test(message));
        check(relevantErrors.length === 0, `no browser page errors${relevantErrors.length ? `: ${relevantErrors.join(' | ')}` : ''}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise(resolve => server.once('exit', resolve));
        if (failures.length) {
            if (serverLog.trim()) console.log(`\nserver log:\n${serverLog}`);
            process.exitCode = 1;
        } else {
            console.log(`\nall ${checks} Studio Agent checks passed`);
        }
    }
}

main().catch(error => {
    console.error('\nStudio Agent test crashed:', error);
    process.exitCode = 1;
});
