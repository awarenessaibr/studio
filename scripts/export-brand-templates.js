#!/usr/bin/env node
'use strict';
/**
 * export-brand-templates.js — render published brand templates to PNG.
 *
 * Opens the Agent Studio, loads each named saved template for one brand and
 * screenshots the artboard at 2× device scale, then resizes to the template's
 * exact pixel size. No design is re-drawn here: the studio renders it.
 *
 * Usage
 *   node scripts/export-brand-templates.js --pack=<packId> --brand=<brandId> \
 *     --out=<dir> [--templates="Menu,Flavour spotlight,Premium post"] [--scale=2]
 *
 * Without --templates every saved template for the brand is exported.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function arg(name, fallback = '') {
    const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = process.argv[index + 1];
    return next && !next.startsWith('--') ? next : true;
}

const packId = String(arg('pack', ''));
const brandId = String(arg('brand', ''));
const outDir = path.resolve(ROOT, String(arg('out', 'deliverables/brand-templates')));
const only = String(arg('templates', ''))
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
const scale = Math.max(1, Math.min(3, Number(arg('scale', 2)) || 2));

if (!packId || !brandId) {
    console.error('Usage: node scripts/export-brand-templates.js --pack=<packId> --brand=<brandId> [--out=<dir>] [--templates="a,b"] [--scale=2]');
    process.exit(2);
}

const slug = (value) => String(value).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

function resize(file, width, height) {
    if (!width || !height) return;
    const magick = spawnSync('magick', [file, '-resize', `${width}x${height}!`, file], { stdio: 'ignore' });
    if (!magick.error && magick.status === 0) return;
    if (process.platform === 'darwin') {
        spawnSync('sips', ['-z', String(height), String(width), file], { stdio: 'ignore' });
    }
}

async function waitForServer(base, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${base}/api/brand-packs`);
            if (response.ok) return;
        } catch { /* not up yet */ }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('The studio server did not start.');
}

async function main() {
    const port = 8430 + Math.floor(Math.random() * 300);
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    const { chromium } = require(PLAYWRIGHT);
    let browser;
    try {
        await waitForServer(base);
        browser = await chromium.launch({ executablePath: CHROME, headless: true });
        const page = await browser.newPage({
            viewport: { width: 1400, height: 1500 },
            deviceScaleFactor: scale,
        });
        await page.goto(`${base}/studio.html?pack=${encodeURIComponent(packId)}&brand=${encodeURIComponent(brandId)}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(3500);
        await page.locator('button', { hasText: 'Templates' }).first().click();
        await page.waitForTimeout(2500);
        const cards = await page.locator('[data-saved]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title') || ''));
        if (!cards.length) throw new Error('No published templates found for that brand.');
        fs.mkdirSync(outDir, { recursive: true });
        let written = 0;
        for (const title of cards) {
            const name = title.split(' · ')[0].replace(/^.*? — /, '');
            const size = /·\s*(\d+)×(\d+)px/.exec(title);
            const width = size ? Number(size[1]) : 0;
            const height = size ? Number(size[2]) : 0;
            if (only.length && !only.some((label) => name.toLowerCase().includes(label))) continue;
            const card = page.locator('[data-saved]', { hasText: name }).first();
            await card.click();
            await page.waitForTimeout(1600);
            const stage = page.locator('#stage');
            if (!await stage.count()) continue;
            {
                const file = path.join(outDir, `${String(written + 1).padStart(2, '0')}-${slug(name)}.png`);
                await stage.screenshot({ path: file });
                resize(file, width, height);
                written += 1;
                console.log(`✓ ${name} → ${path.relative(ROOT, file)} (${width}×${height})`);
            }
        }
        console.log(`Exported ${written} template${written === 1 ? '' : 's'} to ${path.relative(ROOT, outDir)}`);
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
