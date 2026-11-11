'use strict';
/**
 * Browser checks for Studio Builder.
 *
 * Boots the real server, opens /studio-builder in Chromium, and verifies the
 * server catalog, live surface preview, local agent commands, rule fixes,
 * details, brief, resize handles and layout download. The model fallback is
 * not exercised here because it depends on a configured provider.
 *
 * Run with: node tests/studio-builder.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);

const ROOT = path.join(__dirname, '..');
const PORT = 8320 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const failures = [];
let step = 0;
let server = null;

function ok(message) {
    step += 1;
    console.log(`  ✓ ${message}`);
}
function fail(message) {
    failures.push(message);
    console.log(`  ✗ ${message}`);
}

async function waitForHealth(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE}/api/health`);
            if (response.ok) return;
        } catch { /* not listening yet */ }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('The studio server did not become healthy.');
}

async function startServer() {
    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    server.stderr.on('data', (chunk) => { stderr += String(chunk); });
    server.on('exit', (code) => {
        if (code && code !== 0) console.error('[server exit]', code, stderr.slice(-800));
    });
    await waitForHealth();
}

async function stopServer() {
    if (!server || server.killed) return;
    server.kill('SIGTERM');
    await new Promise((resolve) => {
        const timer = setTimeout(() => {
            server.kill('SIGKILL');
            resolve();
        }, 2500);
        server.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

async function waitForServerCatalog(page) {
    await page.waitForFunction(
        () => document.querySelector('#catalogStatus')?.textContent.includes('Server catalog'),
        null,
        { timeout: 20000 },
    );
}

async function usePreset(page, id) {
    await page.selectOption('#preset', id);
    await page.waitForTimeout(1200);
    await waitForPreview(page);
}

async function waitForPreview(page) {
    await page.waitForFunction(
        () => /real modules|preview error|not loaded/.test(document.querySelector('.preview-badge')?.textContent || ''),
        null,
        { timeout: 20000 },
    );
}

async function ask(page, text) {
    if (!(await page.locator('#in').isVisible())) await page.click('[data-t="agent"]');
    await page.fill('#in', text);
    await page.press('#in', 'Enter');
    await page.waitForTimeout(350);
}

(async () => {
    await startServer();
    const browser = await chromium.launch({ headless: true, executablePath: CHROME });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
        await page.goto(`${BASE}/studio-builder`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            localStorage.removeItem('sb.layout.v1');
            localStorage.removeItem('sb.sizes.v1');
            localStorage.removeItem('sb.drawers.v1');
            localStorage.removeItem('sb.catalog.v1');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        page.on('popup', (popup) => popup.close());
        await waitForServerCatalog(page);
        await waitForPreview(page);

        assert.equal(await page.title(), 'Studio Builder');
        ok('the builder page loads from /studio-builder');

        const status = await page.locator('#catalogStatus').innerText();
        assert.match(status, /Server catalog/);
        assert.match(status, /28 modules/);
        ok('the capability catalog is read from the server');

        assert.equal(await page.locator('#count').innerText(), '28 of 28');
        ok('the library lists all 28 capabilities');

        const leftDrawerBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).getPropertyValue('--sb-drawer-left'));
        const leftHandle = await page.locator('#drawerLeftResizer').boundingBox();
        assert.ok(leftHandle, 'the left drawer resize handle is present');
        await page.mouse.move(leftHandle.x + 5, leftHandle.y + leftHandle.height / 2);
        await page.mouse.down();
        await page.mouse.move(leftHandle.x + 45, leftHandle.y + leftHandle.height / 2, { steps: 4 });
        await page.mouse.up();
        const leftDrawerAfter = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).getPropertyValue('--sb-drawer-left'));
        assert.notEqual(leftDrawerBefore.trim(), leftDrawerAfter.trim());
        const drawerSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('sb.drawers.v1') || '{}'));
        assert.equal(`${drawerSettings.left.width}px`, leftDrawerAfter.trim());
        await page.locator('[data-drawer-toggle="left"]').click();
        assert.equal(await page.locator('.drawer[data-drawer="left"]').getAttribute('class'), 'drawer is-collapsed');
        assert.equal(await page.locator('[data-drawer-toggle="left"]').getAttribute('aria-expanded'), 'false');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForServerCatalog(page);
        assert.equal(await page.locator('.drawer[data-drawer="left"]').getAttribute('class'), 'drawer is-collapsed');
        const restoredLeftWidth = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).getPropertyValue('--sb-drawer-left'));
        assert.equal(restoredLeftWidth.trim(), '38px');
        await page.locator('[data-drawer-toggle="left"]').click();
        assert.equal(await page.locator('.drawer[data-drawer="left"]').getAttribute('class'), 'drawer');
        assert.equal(
            (await page.evaluate(() => getComputedStyle(document.querySelector('.app')).getPropertyValue('--sb-drawer-left'))).trim(),
            leftDrawerAfter.trim(),
        );
        ok('the left drawer resizes, collapses to a reopen handle, and restores its state');

        const rightDrawerBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).getPropertyValue('--sb-drawer-right'));
        const rightHandle = await page.locator('#drawerRightResizer').boundingBox();
        assert.ok(rightHandle, 'the right drawer resize handle is present');
        await page.mouse.move(rightHandle.x + 5, rightHandle.y + rightHandle.height / 2);
        await page.mouse.down();
        await page.mouse.move(rightHandle.x - 45, rightHandle.y + rightHandle.height / 2, { steps: 4 });
        await page.mouse.up();
        const rightDrawerAfter = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).getPropertyValue('--sb-drawer-right'));
        assert.notEqual(rightDrawerBefore.trim(), rightDrawerAfter.trim());
        await page.locator('[data-drawer-toggle="right"]').click();
        assert.equal(await page.locator('[data-drawer-toggle="right"]').getAttribute('aria-expanded'), 'false');
        await page.locator('[data-drawer-toggle="right"]').click();
        assert.equal(await page.locator('[data-drawer-toggle="right"]').getAttribute('aria-expanded'), 'true');
        ok('the right drawer resizes and collapses/reopens independently');

        await page.setViewportSize({ width: 900, height: 1000 });
        await page.locator('[data-drawer-toggle="left"]').click();
        assert.equal(await page.locator('[data-drawer-toggle="left"]').isVisible(), true);
        assert.equal(await page.locator('#q').isVisible(), false);
        assert.equal(await page.locator('#drawerLeftResizer').isVisible(), false);
        await page.locator('[data-drawer-toggle="left"]').click();
        assert.equal(await page.locator('#q').isVisible(), true);
        await page.setViewportSize({ width: 1440, height: 1000 });
        ok('collapsed drawers keep a usable reopen handle on narrow screens');

        assert.equal(await page.locator('#screen .reg').count(), 5);
        assert.equal(await page.locator('#runtime').count(), 1);
        ok('five screen regions and the runtime strip are rendered');

        assert.match(await page.locator('.preview-badge').innerText(), /real modules/);
        ok('the default Agent-first preset loads a real live surface');

        const previewState = await page.evaluate(() => {
            const frame = document.querySelector('.preview-frame iframe');
            return frame?.contentWindow?.__agentFirstQA?.state?.() || null;
        });
        assert.ok(previewState?.design, 'the Agent First preview selects a real design');
        ok('the Agent First preview selects a real library design');

        const startPages = await page.locator('#preset optgroup[label="Pages"] option').count();
        assert.ok(startPages >= 13, 'the Start from select lists every admin page');
        await usePreset(page, 'page:studio-v2');
        assert.equal(await page.locator('#app').getAttribute('class'), 'app is-stage-maximized');
        assert.equal(await page.locator('.drawer[data-drawer="right"]').isVisible(), true);
        assert.equal(await page.locator('#in').isVisible(), true);
        assert.equal(await page.locator('#screen .reg.top').isVisible(), false);
        assert.equal(await page.locator('#screen .reg.stage').isVisible(), true);
        assert.equal(await page.locator('[data-stage-expand]').getAttribute('aria-pressed'), 'true');
        await page.locator('.preview-head button:has-text("Inspect")').click();
        assert.equal(await page.locator('.stage-inspect').isVisible(), true);
        await page.locator('[data-stage-expand]').click();
        assert.equal(await page.locator('#app').getAttribute('class'), 'app');
        assert.equal(await page.locator('#in').isVisible(), true);
        await page.locator('[data-stage-expand]').click();
        assert.equal(await page.locator('#app').getAttribute('class'), 'app is-stage-maximized');
        assert.equal(await page.locator('#in').isVisible(), true);
        assert.equal(
            await page.locator('.preview-head button:not([data-stage-expand])[aria-pressed="true"]').innerText(),
            'Inspecting…',
        );
        await page.locator('[data-stage-expand]').click();
        assert.match((await page.locator('#screen .reg.stage .blk').allInnerTexts()).join(' '), /Scene renderer/);
        assert.match((await page.locator('#screen .reg.bottom .blk').allInnerTexts()).join(' '), /Timeline/);
        ok('start-page navigation maximizes the stage while keeping Agent and Inspect usable');

        await usePreset(page, 'classic');
        assert.match(await page.locator('.preview-scripts').innerText(), /studio-core\.js/);
        const globals = await page.evaluate(() => {
            const frame = document.querySelector('.preview-frame iframe');
            return {
                core: Boolean(frame?.contentWindow?.StudioCore),
                brand: Boolean(frame?.contentWindow?.StudioBrand),
                layer: Boolean(frame?.contentWindow?.LayerStudio),
            };
        });
        assert.deepEqual(globals, { core: true, brand: true, layer: true });
        ok('the Layer Studio preview loads studio-core, brand-pack and _.js');

        await page.click('.preview-head button:has-text("Inspect")');
        const overlay = page.locator('.stage-inspect');
        await overlay.waitFor({ state: 'visible', timeout: 5000 });
        const inspectBox = await overlay.boundingBox();
        assert.ok(inspectBox, 'the stage picker overlay is present');
        await page.mouse.move(inspectBox.x + 24, inspectBox.y + 24);
        await page.mouse.down();
        await page.mouse.move(inspectBox.x + 160, inspectBox.y + 120, { steps: 5 });
        await page.mouse.up();
        await page.waitForSelector('.pick-card', { timeout: 5000 });
        assert.match(await page.locator('.pick-card').innerText(), /Picked element/);
        await page.selectOption('#pickCapability', 'D4');
        await page.click('.pick-card button:has-text("to project plan")');
        await page.waitForTimeout(300);
        assert.equal(await page.locator('.plan-item').count(), 1);
        const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('sb.plan.v1') || 'null'));
        assert.equal(plan.entries.length, 1);
        assert.equal(plan.entries[0].capabilityId, 'D4');
        assert.equal(plan.entries[0].pageSource, 'studio-v2.html');
        ok('Inspect picks an element region and adds its capability to the project plan');

        await usePreset(page, 'afs');
        await ask(page, 'put the timeline at the bottom');
        assert.equal(await page.locator('#screen .reg.bottom .blk').count(), 1);
        assert.match(await page.locator('#screen .reg.bottom .blk').innerText(), /Timeline/);
        ok('local agent: "put the timeline at the bottom"');

        await ask(page, 'add guardrails');
        assert.match(await page.locator('#screen .reg.right').innerText(), /Guardrails/);
        ok('local agent: "add guardrails"');

        await ask(page, "what's missing?");
        assert.match((await page.locator('#log').innerText()).split('\n').slice(-3).join('\n'), /No issues|Open issues/);
        ok('local agent: "what’s missing?" returns the rule report');

        await ask(page, 'swap to the template renderer');
        assert.equal(await page.locator('#screen .reg.stage .blk').count(), 1);
        assert.match(await page.locator('#screen .reg.stage .blk').innerText(), /Brand template renderer/);
        assert.equal((await page.locator('#screen .reg.stage').innerText()).includes('Scene editor'), false);
        await page.waitForTimeout(1200);
        assert.match(await page.locator('.preview-badge').innerText(), /real modules|loading/);
        ok('local agent: "swap to the template renderer" also prunes the incompatible editor');

        await page.click('#screen .reg.stage .blk');
        await page.waitForTimeout(300);
        const detailText = await page.locator('#pane').innerText();
        const detailHtml = await page.locator('#pane').innerHTML();
        assert.match(detailText, /Source files/);
        assert.match(detailText, /Endpoints/);
        assert.match(detailText, /Requires/);
        assert.equal(detailHtml.includes('</dl>null'), false);
        ok('Details shows sources, endpoints and requirements without null artifacts');

        const before = await page.evaluate(() => getComputedStyle(document.querySelector('#screen')).getPropertyValue('--sb-left'));
        const box = await page.locator('.resizer[data-edge="left"]').boundingBox();
        assert.ok(box, 'the left resize handle is present');
        const handleY = box.y + box.height / 2;
        await page.mouse.move(box.x + 4, handleY);
        await page.mouse.down();
        await page.mouse.move(box.x + 60, handleY, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        const after = await page.evaluate(() => getComputedStyle(document.querySelector('#screen')).getPropertyValue('--sb-left'));
        assert.notEqual(before.trim(), after.trim());
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sb.sizes.v1') || '{}'));
        assert.ok(stored.left > 190);
        ok('dragging a separator resizes and persists a region');

        await page.click('[data-t="brief"]');
        await page.waitForTimeout(200);
        const brief = await page.locator('#pane pre').innerText();
        assert.match(brief, /# Page build brief/);
        assert.match(brief, /## Screen regions/);
        assert.match(brief, /## Live preview/);
        ok('the Brief tab collects layout, load order, sources and preview');

        await page.click('#copy');
        await page.waitForTimeout(350);
        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(clipboard, /# Page build brief/);
        ok('Copy build brief writes the brief to the clipboard');

        const downloadPromise = page.waitForEvent('download');
        await page.click('#dl');
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), 'studio-layout.json');
        const downloadPath = await download.path();
        const layout = JSON.parse(require('node:fs').readFileSync(downloadPath, 'utf8'));
        assert.equal(layout.schema, 'studio-builder/layout/1');
        assert.ok(Array.isArray(layout.regions.stage));
        assert.match(layout.basePage, /^\/[A-Za-z0-9._-]+\.html?$/);
        ok('Download layout saves the regions, sizes and preview state');

        await page.click('[data-t="addons"]');
        await page.waitForTimeout(200);
        const addons = await page.locator('#pane').innerText();
        assert.match(addons, /Live module preview/);
        assert.match(addons, /Server-owned capability catalog/);
        assert.match(addons, /Free-form agent fallback/);
        assert.match(addons, /Deploy as a running page/);
        assert.match(addons, /implemented/);
        ok('the Add-ons tab describes the wired follow-ups and remaining limits');

        await page.click('[data-t="deploy"]');
        await page.waitForTimeout(700);
        const deployName = `Browser deploy ${Date.now()}`;
        await page.fill('#deployName', deployName);
        await page.click('button:has-text("Deploy page")');
        await page.waitForSelector('.deploy-result', { timeout: 20000 });
        const deployedText = await page.locator('.deploy-result').innerText();
        assert.match(deployedText, /Open deployed page/);
        assert.match(deployedText, /Open full surface/);
        const deployedHref = await page.locator('.deploy-result a:has-text("Open deployed page")').getAttribute('href');
        assert.match(deployedHref, /^\/built\//);
        const deployedResponse = await page.request.get(`${BASE}${deployedHref}`);
        assert.equal(deployedResponse.status(), 200);
        const deployedHtml = await deployedResponse.text();
        assert.ok(deployedHtml.includes(deployName), 'the deployed page carries its name');
        assert.match(deployedHtml, /dp-stage-frame/);
        assert.match(deployedHtml, /Project plan/);
        assert.match(deployedHtml, /Timeline/);
        const surfaceResponse = await page.request.get(`${BASE}${deployedHref}/surface`);
        assert.equal(surfaceResponse.status(), 200);
        assert.match(await surfaceResponse.text(), /studio-agent\.html/);
        ok('Deploy writes a served page with the composed layout and a real stage surface');

        const deployedList = await (await page.request.get(`${BASE}/api/studio-builder/pages`)).json();
        const created = deployedList.pages.find((entry) => entry.name === deployName);
        assert.ok(created, 'the deployed page is listed by the API');
        assert.ok(created.planCount >= 1, 'the deployed page records the project plan');
        await page.request.delete(`${BASE}${created.url.replace(/\/built\//, '/api/studio-builder/pages/')}`);
        const afterDelete = await page.request.get(`${BASE}${deployedHref}`);
        assert.equal(afterDelete.status(), 404);
        ok('the deployed page can be listed and deleted, and its URL stops serving');

        assert.deepEqual(pageErrors, []);
        ok('no page errors were reported');
    } catch (error) {
        fail(error.stack || error.message);
    } finally {
        await browser.close();
        await stopServer();
    }

    console.log(`\n${step - failures.length}/${step} checks passed`);
    if (failures.length) {
        console.error(`\n${failures.length} failure(s):`);
        failures.forEach((message) => console.error(`- ${message}`));
        process.exit(1);
    }
})().catch(async (error) => {
    console.error(error);
    await stopServer();
    process.exit(1);
});
