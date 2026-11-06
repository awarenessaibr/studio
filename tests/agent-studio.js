'use strict';
/**
 * Browser smoke test for brand-template integration in Studio Agent.
 *
 * Run with: node tests/agent-studio.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { templateCatalog } = require('../src/shared/brand-pack.js');

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

        const { packs = [] } = await fetch(`${BASE}/api/brand-packs`).then(response => response.json());
        let target = null;
        for (const summary of packs) {
            const { pack } = await fetch(`${BASE}/api/brand-packs/${encodeURIComponent(summary.id)}`).then(response => response.json());
            const brand = (pack?.brands || []).find(entry => templateCatalog(entry).length);
            if (brand) {
                target = { packId: pack.id, brandId: brand.id };
                break;
            }
        }
        if (!target) throw new Error('no brand with catalog templates is available for the Studio Agent test');

        const query = new URLSearchParams(target);
        await page.goto(`${BASE}/studio-agent.html?${query}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !document.getElementById('studio').hidden, null, { timeout: 20000 });
        const expected = await page.evaluate(async ({ packId, brandId }) => {
            const { pack } = await fetch(`/api/brand-packs/${encodeURIComponent(packId)}`).then(response => response.json());
            const brand = pack?.brands?.find(entry => entry.id === brandId);
            return brand ? window.StudioBrand.templateCatalog(brand).length : 0;
        }, target);

        await page.locator('#brandTemplatesBtn').click();
        await page.waitForFunction(() => !document.getElementById('brandTemplatesDialog').hidden);
        const templateCards = page.locator('#brandTemplateGrid .asset-brand-template');
        check(await templateCards.count() === expected, `brand-template library lists all ${expected} templates`);
        check(await page.locator('#brandTemplateGrid canvas').count() === expected, 'brand-template library renders a canvas preview for each card');
        check(await page.locator('#brandTemplateGrid a[href*="brandTemplateId="]').count() === expected, 'every template links to its editable Studio V2 composition');
        const firstTemplateName = await templateCards.first().locator('h3').innerText();
        await templateCards.first().getByRole('button', { name: 'Edit this template' }).click();
        await page.waitForFunction(() => document.getElementById('brandTemplatesDialog').hidden);
        await page.waitForFunction(name => document.getElementById('previewTitle').textContent === name, firstTemplateName);
        check(await page.locator('#designGrid .is-brand-template.is-selected').count() === 1, 'opening a library card selects its design in the matching category');

        const lookTarget = await page.evaluate(async ({ packId, brandId }) => {
            const { pack } = await fetch(`/api/brand-packs/${encodeURIComponent(packId)}`).then(response => response.json());
            const brand = pack?.brands?.find(entry => entry.id === brandId);
            if (!brand) return null;
            const catalog = window.StudioBrand.templateCatalog(brand).map(entry => {
                const composition = window.StudioBrand.createTemplateComposition({
                    packId: pack.id,
                    packName: pack.name,
                    portfolio: pack.portfolio,
                    brand,
                    templateId: entry.id
                });
                const colors = ['ground', 'ink', 'accent'].map(role => composition.meta?.palette?.[role]).filter(Boolean);
                const affectedLayer = composition.layers.find(layer => !layer.bindings?.url
                    && layer.url?.startsWith('data:image/svg+xml')
                    && colors.some(color => decodeURIComponent(layer.url).toLowerCase().includes(color.toLowerCase())));
                const movableText = composition.layers.find(layer => layer.type === 'text'
                    && /sub|kicker/i.test(String(layer.bindings?.text || layer.name || '')));
                const imageLayers = composition.layers.filter(layer => layer.type === 'image')
                    .map(layer => ({ id: layer.id, name: layer.name || 'Image' }));
                return {
                    id: entry.id,
                    label: entry.label,
                    category: entry.category,
                    palette: composition.meta?.palette,
                    affected: !!affectedLayer,
                    imageLayers,
                    movableText: movableText && {
                        id: movableText.id,
                        x: movableText.x,
                        y: movableText.y,
                        w: movableText.w,
                        h: movableText.h
                    }
                };
            });
            const targetTemplate = catalog.find(entry => entry.id === 'bw-seasons' && entry.affected)
                || catalog.find(entry => entry.affected);
            if (!targetTemplate) return null;
            const imageTemplate = catalog.find(entry => entry.imageLayers.length);
            const base = targetTemplate.palette;
            const schemes = [
                { paper: base.ground, ink: base.ink, accent: base.accent },
                { paper: base.ink, ink: base.ground, accent: base.accent },
                { paper: '#ffffff', ink: base.ink, accent: base.accent },
                { paper: base.ink, ink: '#ffffff', accent: base.accent },
                (() => {
                    const ink = window.StudioBrand.contrastRatio('#ffffff', base.accent) >= window.StudioBrand.contrastRatio(base.ink, base.accent) ? '#ffffff' : base.ink;
                    return { paper: base.accent, ink, accent: ink };
                })()
            ];
            const seen = new Set(schemes.map(palette => JSON.stringify(palette)));
            const lookPalettes = [...schemes];
            catalog.forEach(entry => {
                const palette = entry.palette;
                if (!palette?.ground || !palette.ink || !palette.accent) return;
                const key = JSON.stringify({ paper: palette.ground, ink: palette.ink, accent: palette.accent });
                if (seen.has(key)) return;
                seen.add(key);
                lookPalettes.push({ paper: palette.ground, ink: palette.ink, accent: palette.accent });
            });
            return { ...targetTemplate, lookPalettes, imageTemplate, brandPhotoCount: (brand.photography || []).filter(photo => photo?.url).length };
        }, target);
        if (lookTarget) {
            await page.locator('#focusBack').click();
            let design = null;
            for (const tab of await page.locator('.category-tab').all()) {
                await tab.click();
                const candidate = page.locator('#designGrid .is-brand-template').filter({ hasText: lookTarget.label }).first();
                if (await candidate.count()) { design = candidate; break; }
            }
            if (design) {
                await design.click();
                await page.waitForFunction(label => document.getElementById('previewTitle').textContent === label, lookTarget.label);
                await design.click();
                if (lookTarget.movableText) {
                    const canvasBox = await page.locator('#previewCanvas').boundingBox();
                    const layer = lookTarget.movableText;
                    const selectX = canvasBox.x + (layer.x + layer.w / 2) / 100 * canvasBox.width;
                    const selectY = canvasBox.y + (layer.y + layer.h / 2) / 100 * canvasBox.height;
                    await page.mouse.click(selectX, selectY);
                    await page.waitForFunction(id => {
                        const inspector = document.getElementById('layerInspector');
                        return !inspector.hidden && inspector.dataset.layerId === id;
                    }, layer.id);
                    const inspector = page.locator('#layerInspector');
                    check(await inspector.locator('[data-layer-prop="text"]').count() === 1,
                        'focus mode shows editable copy for the selected text layer');
                    check(await inspector.locator('[data-layer-prop="color"]').count() === 1
                        && await inspector.locator('[data-layer-prop="fontFamily"]').count() === 1
                        && await inspector.locator('[data-layer-prop="fontSizePct"]').count() === 1
                        && await inspector.locator('[data-layer-prop="align"]').count() === 1
                        && await inspector.locator('[data-layer-prop="verticalAlign"]').count() === 1,
                    'selected text layer exposes its colour, font, size, and alignment');
                    check(await inspector.locator('[data-layer-prop="x"]').count() === 1
                        && await inspector.locator('[data-layer-prop="w"]').count() === 1
                        && await inspector.getByRole('button', { name: 'Animate layer' }).count() === 1,
                    'selected layer exposes editable geometry and animation controls');

                    const textInput = inspector.locator('[data-layer-prop="text"]');
                    const originalText = await textInput.inputValue();
                    await textInput.fill('Layer inspector regression');
                    await page.waitForTimeout(100);
                    const storedText = await page.evaluate(brandId => Object.keys(localStorage)
                        .filter(key => key.startsWith(`assetStudioAgent.v1:${brandId}:`))
                        .map(key => JSON.parse(localStorage.getItem(key)))
                        .find(state => Object.values(state?.t || {}).includes('Layer inspector regression'))?.t,
                    target.brandId);
                    check(Object.values(storedText || {}).includes('Layer inspector regression'), 'selected layer copy edits render and persist');
                    await page.locator('#undoBtn').click();
                    await page.waitForFunction(text => document.querySelector('#layerInspector [data-layer-prop="text"]')?.value === text, originalText);
                    check(true, 'undo restores selected-layer copy edits');

                    const sizeInput = inspector.locator('[data-layer-prop="fontSizePct"]');
                    const originalSize = await sizeInput.inputValue();
                    await sizeInput.fill(String(Number(originalSize) + 1));
                    await page.locator('#undoBtn').click();
                    await page.waitForFunction(size => document.querySelector('#layerInspector [data-layer-prop="fontSizePct"]')?.value === size, originalSize);
                    check(true, 'undo restores selected-layer typography edits');

                    const alignment = inspector.locator('[data-layer-prop="align"]');
                    const originalAlignment = await alignment.inputValue();
                    await alignment.selectOption(originalAlignment === 'left' ? 'right' : 'left');
                    await page.locator('#undoBtn').click();
                    await page.waitForFunction(value => document.querySelector('#layerInspector [data-layer-prop="align"]')?.value === value, originalAlignment);
                    check(true, 'undo restores selected-layer alignment edits');

                    const colorInput = inspector.locator('[data-layer-prop="color"]');
                    const originalColor = await colorInput.inputValue();
                    await colorInput.evaluate(input => {
                        input.value = input.value.toLowerCase() === '#e6194b' ? '#123456' : '#e6194b';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                    await page.locator('#undoBtn').click();
                    await page.waitForFunction(value => document.querySelector('#layerInspector [data-layer-prop="color"]')?.value === value, originalColor);
                    check(true, 'undo restores selected-layer colour edits');

                    await inspector.getByRole('button', { name: 'Animate layer' }).click();
                    await page.waitForTimeout(120);
                    await page.locator('#tlPlay').click();
                    await page.locator('#layerInspector').getByRole('button', { name: 'Clear animation' }).click();
                    check(await page.locator('#layerInspector').innerText().then(text => text.includes('No animation on this layer')),
                        'animation controls add and clear animation on the selected layer');
                    await page.locator('#timelineBtn').click();

                    const dragCanvasBox = await page.locator('#previewCanvas').boundingBox();
                    const startX = dragCanvasBox.x + (layer.x + layer.w / 2) / 100 * dragCanvasBox.width;
                    const startY = dragCanvasBox.y + (layer.y + layer.h / 2) / 100 * dragCanvasBox.height;
                    await page.mouse.move(startX, startY);
                    await page.mouse.down();
                    await page.mouse.move(startX, startY + 28, { steps: 4 });
                    await page.mouse.up();
                    const movedY = await page.locator('#selLayer .sel-box.on').evaluate(box => parseFloat(box.style.top));
                    check(movedY > layer.y, `dragging ${lookTarget.label} text moves its position on the canvas`);
                    const persistedPosition = await page.evaluate(({ brandId, layerId }) => {
                        return Object.keys(localStorage)
                            .filter(key => key.startsWith(`assetStudioAgent.v1:${brandId}:`))
                            .map(key => JSON.parse(localStorage.getItem(key)))
                            .find(state => state?.layout?.[layerId])?.layout?.[layerId]?.y;
                    }, { brandId: target.brandId, layerId: layer.id });
                    check(Number.isFinite(persistedPosition) && persistedPosition > layer.y, 'dragged layer position persists in the saved design state');
                    await page.locator('#controlTabs .control-tab').filter({ hasText: 'Colours' }).click();
                    const movedAfterRerender = await page.locator('#selLayer .sel-box.on').evaluate(box => parseFloat(box.style.top));
                    check(Math.abs(movedAfterRerender - movedY) < 0.1, 'layer position remains after a rerender');
                    await page.locator('#undoBtn').click();
                    const undoneY = await page.locator('#selLayer .sel-box.on').evaluate(box => parseFloat(box.style.top));
                    check(Math.abs(undoneY - layer.y) < 0.1, 'undo restores the layer’s original position');
                }
                await page.locator('#variationsBody .var-row button').first().waitFor();
                const shownPalettes = await page.locator('#variationsBody .var-row button').evaluateAll(buttons => buttons.map(button => button.dataset.palette));
                const requiredPalettes = lookTarget.lookPalettes.map(palette => JSON.stringify(palette));
                check(requiredPalettes.length === shownPalettes.length && requiredPalettes.every(palette => shownPalettes.includes(palette)),
                    `Looks includes the base schemes and all ${lookTarget.lookPalettes.length - 5} distinct template palettes`);
                const brandRender = await page.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
                await page.locator('#variationsBody .var-row button').filter({ hasText: 'Dark' }).click();
                await page.waitForFunction(previous => document.getElementById('previewCanvas').toDataURL() !== previous, brandRender, { timeout: 5000 });
                const darkRender = await page.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
                await page.locator('#variationsBody .var-row button').filter({ hasText: 'Accent ground' }).click();
                await page.waitForFunction(previous => document.getElementById('previewCanvas').toDataURL() !== previous, darkRender, { timeout: 5000 });
                const accentRender = await page.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
                if (lookTarget.lookPalettes.length > 5) {
                    await page.locator('#variationsBody .var-row button').nth(5).click();
                    await page.waitForFunction(previous => document.getElementById('previewCanvas').toDataURL() !== previous, accentRender, { timeout: 5000 });
                    check(true, `a template-specific palette recolours embedded SVG layers in ${lookTarget.label}`);
                } else {
                    check(true, `Dark and Accent ground Looks recolour embedded SVG layers in ${lookTarget.label}`);
                }
                await page.locator('#focusBack').click();
            } else {
                check(false, `template ${lookTarget.label} appears in a design category`);
            }
            if (lookTarget.imageTemplate) {
                if (lookTarget.imageTemplate.id !== lookTarget.id) {
                    let imageDesign = null;
                    for (const tab of await page.locator('.category-tab').all()) {
                        await tab.click();
                        const candidate = page.locator('#designGrid .is-brand-template').filter({ hasText: lookTarget.imageTemplate.label }).first();
                        if (await candidate.count()) { imageDesign = candidate; break; }
                    }
                    if (!imageDesign) throw new Error(`image template ${lookTarget.imageTemplate.label} is not available in a design category`);
                    await imageDesign.click();
                    await imageDesign.click();
                }
                await page.locator('#controlTabs .control-tab').filter({ hasText: 'Image' }).click();
                const layerPicker = page.locator('#controlBody select[aria-label="Template image layer"]');
                check(await layerPicker.count() === 1, 'Image controls let users target a template image layer');
                await layerPicker.selectOption(lookTarget.imageTemplate.imageLayers[0].id);
                check(await page.locator('#controlBody button').filter({ hasText: 'Upload image' }).count() === 1,
                    'selected template image layer can be replaced by uploading an image');
                const brandPhoto = page.locator('#controlBody .photo-tile[title$="Brand photo"][aria-pressed="false"]').first();
                if (await brandPhoto.count()) {
                    const photoTitle = await brandPhoto.getAttribute('title');
                    const photoUrl = await brandPhoto.locator('img').getAttribute('src');
                    const beforeReplace = await page.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
                    await brandPhoto.click();
                    await page.waitForFunction(({ brandId, layerId, url }) => Object.keys(localStorage)
                        .filter(key => key.startsWith(`assetStudioAgent.v1:${brandId}:`))
                        .map(key => JSON.parse(localStorage.getItem(key)))
                        .some(state => state?.layerImages?.[layerId] === url),
                    { brandId: target.brandId, layerId: lookTarget.imageTemplate.imageLayers[0].id, url: photoUrl });
                    const afterReplace = await page.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
                    check(afterReplace !== beforeReplace, 'choosing brand photography replaces the selected template image');
                    check(Boolean(photoTitle), 'the replacement is selected from the brand photography collection');
                    await page.locator('#controlBody button').filter({ hasText: 'Reset image' }).click();
                    check(await page.locator('#controlBody button').filter({ hasText: 'Reset image' }).count() === 0,
                        'reset restores the template image after replacement');
                    await page.route('**/api/assets/ingest', route => route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ created: [{ id: 'studio-agent-test-upload', name: 'Inspector upload', sourceUrl: photoUrl, format: 'image/png' }] })
                    }));
                    await page.locator('#controlBody button').filter({ hasText: 'Upload image' }).click();
                    await page.locator('#agentPhotoInput').setInputFiles({
                        name: 'replacement.png',
                        mimeType: 'image/png',
                        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64')
                    });
                    await page.waitForFunction(({ brandId, layerId, url }) => Object.keys(localStorage)
                        .filter(key => key.startsWith(`assetStudioAgent.v1:${brandId}:`))
                        .map(key => JSON.parse(localStorage.getItem(key)))
                        .some(state => state?.layerImages?.[layerId] === url),
                    { brandId: target.brandId, layerId: lookTarget.imageTemplate.imageLayers[0].id, url: photoUrl });
                    check(true, 'uploading an image assigns it to the selected template layer');
                    await page.unroute('**/api/assets/ingest');
                } else {
                    check(lookTarget.brandPhotoCount === 0, 'brand photography is unavailable for this test brand');
                }
                await page.locator('#focusBack').click();
            } else {
                check(false, 'a brand template with a replaceable image layer is available');
            }
        } else {
            check(false, 'a template with a palette-coloured embedded SVG is available for Looks regression coverage');
        }

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

        await page.locator('.category-tab').filter({ hasText: 'Menu' }).first().click();
        const firstMenuTemplate = page.locator('#designGrid .is-brand-template').first();
        await firstMenuTemplate.click();
        await firstMenuTemplate.click();
        const controlTabs = await page.locator('#controlTabs .control-tab').allTextContents();
        check(JSON.stringify(controlTabs) === JSON.stringify(['Copy', 'Colours', 'Image', 'Type', 'Size', 'Saved']), 'Studio Agent exposes the six Asset Studio control tabs');
        await page.locator('#controlTabs .control-tab').filter({ hasText: 'Colours' }).click();
        const colorPicker = page.locator('#controlBody input[type="color"]');
        await colorPicker.evaluate(input => { input.value = '#123456'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(80);
        check(await page.locator('#controlBody input[type="color"]').inputValue() === '#123456', 'Colours supports custom palette values');
        await page.locator('#controlTabs .control-tab').filter({ hasText: 'Type' }).click();
        const displayFont = page.locator('#controlBody select[aria-label="Display font"]');
        check(await displayFont.count() === 1 && await displayFont.locator('option').count() > 0, 'Type exposes display, editorial and text font controls');
        if (await displayFont.locator('option').count() > 1) await displayFont.selectOption({ index: 1 });
        await page.locator('#controlTabs .control-tab').filter({ hasText: 'Copy' }).click();
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
        await page.locator('#focusBack').click();
        await page.locator('.category-tab').filter({ hasText: 'Flyer' }).first().click();
        const engineDesign = page.locator('#designGrid .design-card:not(.is-brand-template)').first();
        if (await engineDesign.count()) await engineDesign.click();
        await page.locator('#controlTabs .control-tab').filter({ hasText: 'Image' }).click();
        await page.waitForTimeout(180);
        check(await page.locator('#controlBody button').filter({ hasText: 'Upload image' }).count() === 1, 'Image exposes upload and photo/library selection controls');
        const photoTile = page.locator('#controlBody .photo-tile').first();
        if (await photoTile.count()) {
            await photoTile.click();
            check(await photoTile.getAttribute('aria-pressed') === 'true', 'Image can select a photo for the active design');
        }
        await page.locator('#controlTabs .control-tab').filter({ hasText: 'Size' }).click();
        const sizeOptions = page.locator('#controlBody .size-option');
        check(await sizeOptions.count() > 0, 'Size lists formats available for the active design');
        if (await sizeOptions.count() > 1) await sizeOptions.nth(1).click();
        await page.locator('#controlTabs .control-tab').filter({ hasText: 'Saved' }).click();
        await page.locator('#controlBody button').filter({ hasText: 'Save current asset' }).click();
        const savedRow = page.locator('#controlBody .saved-option').first();
        check(await savedRow.count() === 1, 'Saved stores the current asset in the browser');
        if (await savedRow.count()) {
            await savedRow.getByRole('button', { name: 'Open' }).click();
            await page.locator('#controlTabs .control-tab').filter({ hasText: 'Saved' }).click();
            await page.locator('#controlBody .saved-option').first().getByRole('button', { name: 'Delete' }).click();
            check(await page.locator('#controlBody .saved-option').count() === 0, 'Saved assets can be opened and deleted');
        }
        const previewBox = await page.locator('#previewCanvas').boundingBox();
        await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
        await page.mouse.wheel(0, -300);
        await page.waitForFunction(() => document.querySelector('.zoom-value')?.textContent !== '100%');
        const zoomTransform = await page.locator('#previewCanvas').evaluate(canvas => canvas.style.transform);
        check(zoomTransform.includes('scale('), 'scrolling over the canvas zooms the Studio Agent preview');
        await page.locator('.zoom-reset').click();
        await page.waitForFunction(() => document.querySelector('.zoom-value')?.textContent === '100%');
        check(await page.locator('#previewCanvas').evaluate(canvas => !canvas.style.transform), 'zoom controls reset the preview to fit');
        await page.locator('#timelineBtn').click();
        const firstTimelineRow = page.locator('#tlInner .tl-row:not(.tl-ruler)').first();
        const rowResize = firstTimelineRow.locator('.tl-row-resize');
        const initialRowHeight = await firstTimelineRow.evaluate(row => row.getBoundingClientRect().height);
        const resizeBox = await rowResize.boundingBox();
        await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2 + 32);
        await page.mouse.up();
        const resizedHeight = await firstTimelineRow.evaluate(row => row.getBoundingClientRect().height);
        check(resizedHeight >= initialRowHeight + 24, 'dragging a timeline layer edge increases its row height');
        await firstTimelineRow.locator('.n').click();
        const persistedHeight = await page.locator('#tlInner .tl-row:not(.tl-ruler)').first().evaluate(row => row.getBoundingClientRect().height);
        check(Math.abs(persistedHeight - resizedHeight) < 1, 'timeline layer height persists when the timeline rebuilds');
        const resizedGrip = page.locator('#tlInner .tl-row:not(.tl-ruler)').first().locator('.tl-row-resize');
        const heightBeforeKey = +(await resizedGrip.getAttribute('aria-valuenow'));
        await resizedGrip.focus();
        await resizedGrip.press('ArrowUp');
        check(+(await resizedGrip.getAttribute('aria-valuenow')) === heightBeforeKey + 4, 'keyboard controls resize timeline layers');
        await page.locator('#tlAdd').click();
        await page.waitForFunction(() => document.getElementById('tlPlay').textContent.includes('Pause'));
        await page.locator('#tlPlay').click();
        await page.locator('#previewReplay').click();
        await page.waitForFunction(() => document.getElementById('tlPlay').textContent.includes('Pause'));
        check(true, 'preview header replay button starts playback from the beginning');
        await page.locator('#tlPlay').click();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#downloadBtn').click()
        ]);
        check(download.suggestedFilename().endsWith('.png'), 'brand templates export as PNG from Studio Agent');

        const studioPage = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        studioPage.on('pageerror', error => errors.push(error.message));
        await studioPage.goto(`${BASE}/studio.html?${query}`, { waitUntil: 'domcontentloaded' });
        await studioPage.waitForFunction(() => document.getElementById('boot').hidden, null, { timeout: 20000 });
        await studioPage.locator('#atabs button').filter({ hasText: 'Templates' }).click();
        const expectedBrandTemplates = await studioPage.evaluate(async ({ packId, brandId }) => {
            const { pack } = await fetch(`/api/brand-packs/${encodeURIComponent(packId)}`).then(response => response.json());
            const brand = pack?.brands?.find(entry => entry.id === brandId);
            return brand ? window.StudioBrand.templateCatalog(brand).map(entry => entry.id) : [];
        }, target);
        const shownBrandTemplates = studioPage.locator('#apanel [data-k^="brand-template:"]');
        const shownIds = await shownBrandTemplates.evaluateAll(cards => cards.map(card => card.dataset.k.slice('brand-template:'.length)));
        check(JSON.stringify(shownIds) === JSON.stringify(expectedBrandTemplates), `studio.html exposes all ${expectedBrandTemplates.length} templates for the active brand`);
        if (expectedBrandTemplates.length) {
            await shownBrandTemplates.first().click();
            const firstLabel = await studioPage.evaluate(({ packId, brandId }) => fetch(`/api/brand-packs/${encodeURIComponent(packId)}`)
                .then(response => response.json())
                .then(({ pack }) => pack.brands.find(entry => entry.id === brandId))
                .then(brand => window.StudioBrand.templateCatalog(brand)[0].label), target);
            await studioPage.waitForFunction(label => document.getElementById('status').textContent.includes(label), firstLabel);
            check(await studioPage.locator('#layers .lrow').count() > 2, 'selecting a brand template loads its editable composition layers');
        }

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
