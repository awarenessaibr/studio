#!/usr/bin/env node
'use strict';
/**
 * render-samples.js — produce sample collateral by driving Asset Studio itself.
 *
 * Samples are not drawn by this script. It boots the real server, opens the real
 * Asset Studio for a venue, selects designs and presses Download PNG, so every
 * file is the studio's own render of that brand's templates with that brand's
 * assets. If the print gate blocks a design, the render fails instead of
 * producing a picture of something the gate would refuse.
 *
 * Usage
 *   node scripts/render-samples.js --pack <packId> --venue <venueId> --out <dir>
 *                                  [--design "Menus:Classic"] [--design "Flyers:Night photo"]
 *
 * Default selection: one design each from menus, flyers, social, vouchers,
 * table cards, signage and stationery.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DEFAULT_DESIGNS = [
    'Menus:Classic',
    'Flyers:Night photo',
    'Social posts:Brand accent',
    'Gift vouchers:Brand accent',
    'Table cards:Brand accent',
    'Signage:Digital menu board',
    'Stationery:Letterhead',
];

function arg(name, fallback = '') {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = process.argv[index + 1];
    return next && !next.startsWith('--') ? next : true;
}

function args(name) {
    const out = [];
    process.argv.forEach((value, index) => {
        if (value === `--${name}` && process.argv[index + 1]) out.push(process.argv[index + 1]);
    });
    return out;
}

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(port, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (response.ok) return true;
        } catch {
            /* not up yet */
        }
        await sleep(250);
    }
    return false;
}

async function main() {
    const packId = String(arg('pack', ''));
    const venueId = String(arg('venue', ''));
    const outDir = String(arg('out', 'deliverables'));
    const designs = args('design');
    if (!packId || !venueId) {
        console.error('Usage: node scripts/render-samples.js --pack <packId> --venue <venueId> --out <dir> [--design "Category:Design"]');
        process.exit(2);
    }
    const selection = designs.length ? designs : DEFAULT_DESIGNS;

    let chromium;
    try {
        ({ chromium } = require(PLAYWRIGHT));
    } catch {
        console.error(`Playwright not found at ${PLAYWRIGHT}. Set PLAYWRIGHT_PATH.`);
        process.exit(2);
    }

    const port = 8460 + Math.floor(Math.random() * 120);
    const server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    if (!(await waitForServer(port))) {
        server.kill();
        console.error('Server did not start.');
        process.exit(1);
    }

    const dir = path.resolve(ROOT, outDir);
    fs.mkdirSync(dir, { recursive: true });

    let browser;
    const written = [];
    try {
        browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
        const context = await browser.newContext({ viewport: { width: 1680, height: 1100 }, acceptDownloads: true });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}/asset-studio.html?pack=${encodeURIComponent(packId)}`,
            { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        await page.locator('.gate-card').filter({ hasText: new RegExp(venueId.split('-').join(' '), 'i') })
            .first().click().catch(async () => {
                await page.locator('.gate-card').first().click();
            });
        await page.waitForTimeout(1200);

        for (const [index, entry] of selection.entries()) {
            const [category, wanted] = String(entry).split(':');
            const label = `${String(index + 1).padStart(2, '0')}-${slug(`${category}-${wanted || 'default'}`)}`;
            try {
                await page.locator('.category-tab').filter({ hasText: new RegExp(category, 'i') }).first().click();
                await page.waitForTimeout(500);
                const tiles = page.locator('.design-tile');
                const count = await tiles.count();
                if (!count) throw new Error(`no designs in ${category}`);
                let chosen = 0;
                if (wanted) {
                    const labels = await tiles.allTextContents();
                    const found = labels.findIndex((text) => text.toLowerCase().includes(wanted.toLowerCase()));
                    chosen = found === -1 ? 0 : found;
                }
                await tiles.nth(chosen).click();
                await page.waitForTimeout(1600);

                const downloadPromise = page.waitForEvent('download', { timeout: 25000 });
                await page.locator('#downloadBtn').click();
                const download = await downloadPromise;
                const file = path.join(dir, `${venueId}-${label}.png`);
                await download.saveAs(file);
                const bytes = fs.statSync(file).size;
                written.push({ file, bytes });
                console.log(`  ✓ ${path.basename(file)} (${Math.round(bytes / 1024)} kB)`);
            } catch (error) {
                console.error(`  ✗ ${category}${wanted ? ` / ${wanted}` : ''}: ${error.message.split('\n')[0]}`);
            }
        }
    } finally {
        if (browser) await browser.close();
        server.kill();
    }

    if (!written.length) {
        console.error('No samples were produced.');
        process.exit(1);
    }
    console.log(`\n${written.length} sample(s) in ${path.relative(ROOT, dir)}`);
}

main();
