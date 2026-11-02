'use strict';
/**
 * Browser smoke test for the brand Asset Studio.
 *
 * Boots the real server, opens asset-studio.html in Chromium, walks every brand,
 * every category and every design, then exercises the palette, type, image,
 * motif, text, save, drawer and download paths — plus the expansion features:
 * export profiles, die-cuts, carousels and tabular copy.
 *
 * Run with: node tests/asset-studio.test.js
 */
const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);

const ROOT = path.join(__dirname, '..');
const PORT = 8423 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const failures = [];
let checks = 0;

function ok(message) {
    checks += 1;
    console.log(`  ✓ ${message}`);
}

function fail(message) {
    failures.push(message);
    console.log(`  ✗ ${message}`);
}

async function waitForHealth(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE}/api/health`);
            if (response.ok) return;
        } catch {
            /* not up yet */
        }
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

    let browser = null;
    try {
        await waitForHealth();
        console.log(`server up at ${BASE}`);

        browser = await chromium.launch({
            executablePath: CHROME,
            args: ['--no-first-run', '--no-default-browser-check'],
        });
        const page = await browser.newPage({
            viewport: { width: 1600, height: 1100 },
            acceptDownloads: true,
        });
        const consoleErrors = [];
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() !== 'error') return;
            const url = message.location()?.url || '';
            consoleErrors.push(`console: ${message.text()}${url ? ` [${url}]` : ''}`);
        });

        console.log('\nBrand gate');
        await page.goto(`${BASE}/asset-studio.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.gate-card', { timeout: 20000 });
        const groupTabs = await page.locator('.group-tab').allTextContents();
        if (['Dalton family venues', 'Monteleone Group', 'Cawley Hotels', 'KitchenOS', 'Okja'].every((name) => groupTabs.includes(name))) {
            ok(`five brand groups are available: ${groupTabs.join(', ')}`);
        } else {
            fail(`unexpected brand groups: ${groupTabs.join(', ')}`);
        }
        // The newest pack (Okja) may be active first; choose the Dalton group
        // explicitly so this regression suite keeps exercising the original
        // three identities.
        await page.locator('.group-tab').filter({ hasText: 'Dalton family venues' }).click();
        await page.waitForTimeout(1800);
        const gateCards = await page.locator('.gate-card').count();
        if (gateCards === 3) ok('the Dalton group exposes all three brand identities');
        else fail(`expected 3 brand cards, found ${gateCards}`);
        const gateNames = await page.locator('.gate-card h3').allTextContents();
        if (['The Adamson', 'HATCH', 'The Physician'].every((name) => gateNames.includes(name))) {
            ok(`Dalton brand cards: ${gateNames.join(', ')}`);
        } else {
            fail(`unexpected brand names: ${gateNames.join(', ')}`);
        }

        await page.locator('.gate-card').filter({ hasText: 'The Physician' }).click();
        await page.waitForFunction(() => !document.getElementById('studio').hidden, null, { timeout: 10000 });
        await page.waitForTimeout(600);
        if (await page.locator('#previewCanvas').evaluate((canvas) => canvas.width > 0)) {
            ok('choosing The Physician opens a rendered workspace');
        } else {
            fail('the workspace opened but the preview is empty');
        }
        const tabs = await page.locator('.category-tab').count();
        if (tabs === 11) ok('eleven asset categories are available');
        else fail(`expected 11 categories, found ${tabs}`);

        console.log('\nEvery category and design');
        const categoryCount = await page.locator('.category-tab').count();
        let totalDesigns = 0;
        for (let category = 0; category < categoryCount; category += 1) {
            await page.locator('.category-tab').nth(category).click();
            await page.waitForTimeout(250);
            const label = (await page.locator('.category-tab').nth(category).innerText()).split('\n')[0];
            const designCount = await page.locator('.design-tile').count();
            let categoryOk = 0;
            for (let design = 0; design < designCount; design += 1) {
                const expected = (await page.locator('.design-tile span').nth(design).textContent()).trim();
                await page.locator('.design-tile').nth(design).click();
                await page.waitForTimeout(140);
                const state = await page.evaluate(() => ({
                    title: document.getElementById('previewTitle').textContent.trim(),
                    width: document.getElementById('previewCanvas').width,
                    height: document.getElementById('previewCanvas').height,
                }));
                if (state.title === expected && state.width > 0 && state.height > 0) categoryOk += 1;
                else fail(`${label} / ${expected} did not render (title “${state.title}”, ${state.width}×${state.height})`);
            }
            totalDesigns += designCount;
            if (categoryOk === designCount) ok(`${label}: all ${designCount} designs render`);
        }
        if (totalDesigns === 50) ok('fifty designs across eleven categories');
        else fail(`expected 50 designs, walked ${totalDesigns}`);

        // Back to the first flyer for the control checks.
        await page.locator('.category-tab').nth(0).click();
        await page.waitForTimeout(300);
        await page.locator('.design-tile').nth(0).click();
        await page.waitForTimeout(300);

        console.log('\nPalette');
        await page.getByRole('tab', { name: 'Colours' }).click();
        const beforePalette = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        await page.locator('.color-row input[type=color]').first().evaluate((input) => {
            input.value = '#f2e9dd';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(300);
        const afterPalette = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        if (beforePalette !== afterPalette) ok('a custom background colour repaints the preview');
        else fail('the custom background did not change the preview');

        console.log('\nTypography');
        await page.getByRole('tab', { name: 'Type' }).click();
        const beforeFont = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        const fontSelect = page.locator('#controlBody select').first();
        const fontCount = await fontSelect.locator('option').count();
        if (fontCount >= 10) ok(`${fontCount} font options are available on the display role`);
        else fail(`only ${fontCount} font options on the display role`);
        await fontSelect.selectOption({ index: Math.min(3, fontCount - 1) });
        await page.waitForTimeout(300);
        const afterFont = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        if (beforeFont !== afterFont) ok('changing the display font repaints the preview');
        else fail('the display font change did not repaint');

        console.log('\nImage, motif and copy');
        await page.locator('.category-tab').nth(0).click();
        await page.waitForTimeout(250);
        await page.locator('.design-tile').nth(1).click();
        await page.waitForTimeout(300);
        await page.getByRole('tab', { name: 'Image' }).click();
        const photoCount = await page.locator('.photo-tile').count();
        if (photoCount >= 2) ok(`${photoCount} brand photographs are offered for a photo design`);
        else fail(`expected at least 2 photographs, found ${photoCount}`);
        if (photoCount >= 2) {
            const beforePhoto = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
            await page.locator('.photo-tile').nth(1).click();
            await page.waitForTimeout(300);
            const afterPhoto = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
            if (beforePhoto !== afterPhoto) ok('swapping the photograph repaints the preview');
            else fail('the photograph swap did not repaint');
        }

        await page.locator('.category-tab').nth(5).click();
        await page.waitForTimeout(300);
        await page.locator('.design-tile').nth(0).click();
        await page.waitForTimeout(300);
        await page.getByRole('tab', { name: 'Motif' }).click();
        const motifCount = await page.locator('.motif-tile').count();
        if (motifCount >= 10) ok(`${motifCount} motif choices are available`);
        else fail(`expected at least 10 motifs, found ${motifCount}`);
        const beforeMotif = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        await page.locator('.motif-tile').filter({ hasText: 'Sun' }).click();
        await page.waitForTimeout(300);
        const afterMotif = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        if (beforeMotif !== afterMotif) ok('swapping the motif repaints the preview');
        else fail('the motif swap did not repaint');

        await page.locator('.category-tab').nth(0).click();
        await page.waitForTimeout(250);
        await page.locator('.design-tile').nth(0).click();
        await page.waitForTimeout(300);
        await page.getByRole('tab', { name: 'Text' }).click();
        const textInput = page.locator('#controlBody input[type=text], #controlBody textarea').first();
        const beforeCopy = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        await textInput.fill('A new headline');
        await page.waitForTimeout(300);
        const afterCopy = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        if (beforeCopy !== afterCopy) ok('editing copy repaints the preview');
        else fail('editing copy did not repaint');

        // ── expansion: profiles, die-cuts, carousels, tabular copy ──────
        console.log('\nExpansion features');
        const pickCategory = async (label) => {
            await page.locator('.category-tab').filter({ hasText: label }).first().click();
            await page.waitForTimeout(280);
        };
        const pickDesign = async (name) => {
            await page.locator('.design-tile').filter({ hasText: name }).first().click();
            await page.waitForTimeout(320);
        };

        await pickCategory('Social posts');
        await pickDesign('Carousel set');
        const carousel = await page.evaluate(() => ({
            navHidden: document.getElementById('slideNav').hidden,
            label: document.getElementById('slideLabel').textContent,
            printHidden: document.getElementById('printPackBtn').hidden,
            jpgHidden: document.getElementById('jpgBtn').hidden,
            note: document.getElementById('exportNote').textContent,
        }));
        if (!carousel.navHidden && /Slide 1 of \d+/.test(carousel.label)) {
            ok(`the carousel offers slide navigation (${carousel.label})`);
        } else {
            fail(`carousel navigation is missing: ${JSON.stringify(carousel)}`);
        }
        if (carousel.printHidden && !carousel.jpgHidden && /Screen design/.test(carousel.note)) {
            ok('a screen-only design hides the print pack and offers JPG');
        } else {
            fail(`screen profile gating is wrong: ${JSON.stringify(carousel)}`);
        }
        await page.locator('#slideNext').click();
        await page.waitForTimeout(250);
        const startedSlide = await page.locator('#slideLabel').innerText();
        if (/Slide 2 of/.test(startedSlide)) ok('the slide controls advance the carousel');
        else fail(`slide navigation did not advance: ${startedSlide}`);
        const slidesPromise = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('#slideDownload').click();
        const slidesDownload = await slidesPromise;
        if (/-slide-01\.png$/.test(slidesDownload.suggestedFilename())) {
            ok('carousel slides download as numbered PNGs');
        } else {
            fail(`unexpected slide filename: ${slidesDownload.suggestedFilename()}`);
        }
        // Let the remaining slides finish before switching designs.
        await page.waitForTimeout(3200);

        await pickCategory('Packaging');
        await pickDesign('Round sticker / bag seal');
        const sticker = await page.evaluate(() => ({
            w: document.getElementById('previewCanvas').width,
            h: document.getElementById('previewCanvas').height,
            printHidden: document.getElementById('printPackBtn').hidden,
        }));
        if (sticker.w === sticker.h && !sticker.printHidden) {
            ok(`a die-cut sticker renders on a square canvas (${sticker.w}×${sticker.h})`);
        } else {
            fail(`sticker canvas is wrong: ${JSON.stringify(sticker)}`);
        }
        await page.getByRole('button', { name: 'Print pack (PDF)' }).click();
        await page.waitForFunction(() => !document.getElementById('printDialog').hidden, null, { timeout: 10000 });
        const dieCutMeta = await page.locator('#printMeta').innerText();
        if (/Die-cut: circle/.test(dieCutMeta)) ok('the print pack reports the die-cut shape');
        else fail(`die-cut metadata missing: ${dieCutMeta}`);
        const diePdfPromise = page.waitForEvent('download', { timeout: 120000 });
        await page.locator('#printDownload').click();
        const diePdf = await diePdfPromise;
        const diePdfBytes = await fsp.readFile(await diePdf.path());
        const diePdfText = diePdfBytes.toString('latin1');
        if (diePdfText.includes('/DeviceCMYK') && diePdfText.includes('0 1 0 0 K')) {
            ok(`the print pack carries a vector cut line (${diePdfBytes.length} bytes)`);
        } else {
            fail(`no cut line in the die-cut PDF (${diePdfBytes.length} bytes)`);
        }
        await page.locator('#printClose').click();

        await pickCategory('Signage');
        await pickDesign('A-board special');
        await page.getByRole('button', { name: 'Print pack (PDF)' }).click();
        await page.waitForFunction(() => !document.getElementById('printDialog').hidden, null, { timeout: 10000 });
        const largeFormat = await page.evaluate(() => ({
            dpi: document.getElementById('printDpi').value,
            meta: document.getElementById('printMeta').innerText,
        }));
        if (largeFormat.dpi === '100' && /Large format/.test(largeFormat.meta)) {
            ok('a large-format size defaults to 100 dpi and says so');
        } else {
            fail(`large-format defaults are wrong: ${JSON.stringify(largeFormat)}`);
        }
        await page.locator('#printClose').click();

        await pickCategory('Menus');
        await pickDesign('Wine list');
        await page.getByRole('tab', { name: 'Text' }).click();
        await page.waitForTimeout(150);
        const wineField = page.locator('#controlBody textarea').first();
        const beforeWine = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        await wineField.fill('# By the glass\nPicpoul de Pinet | Languedoc | 7.5 | 32\n# Red\nChianti Classico | Tuscany | 10.5 | 44');
        await page.waitForTimeout(350);
        const afterWine = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        if (beforeWine !== afterWine) ok('the wine list reads tabular copy (name | region | glass | bottle)');
        else fail('editing the wine list copy did not repaint');

        await pickDesign('Kids menu');
        await page.getByRole('tab', { name: 'Size' }).click();
        await page.waitForTimeout(120);
        await page.locator('.size-option').filter({ hasText: 'A4 landscape' }).first().click();
        await page.waitForTimeout(300);
        const landscape = await page.evaluate(() => {
            const canvas = document.getElementById('previewCanvas');
            return { w: canvas.width, h: canvas.height };
        });
        if (landscape.w > landscape.h) ok('the kids menu offers a landscape activity layout');
        else fail(`kids landscape size did not render: ${JSON.stringify(landscape)}`);

        await pickCategory('Compliance');
        await pickDesign('Allergen matrix');
        await page.getByRole('tab', { name: 'Text' }).click();
        await page.waitForTimeout(150);
        const allergenField = page.locator('#controlBody textarea').first();
        const beforeAllergen = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        await allergenField.fill('Oysters, shallot vinegar | Molluscs\nCured salmon | Fish\nBeef | Milk, Sulphites');
        await page.waitForTimeout(350);
        const afterAllergen = await page.evaluate(() => document.getElementById('previewCanvas').toDataURL());
        if (beforeAllergen !== afterAllergen) ok('the allergen matrix parses dish | allergen rows');
        else fail('the allergen matrix did not repaint');

        await pickDesign('Prep / day-dot label');
        const thermal = await page.evaluate(() => ({
            note: document.getElementById('exportNote').textContent,
            download: document.getElementById('downloadBtn').textContent,
            printHidden: document.getElementById('printPackBtn').hidden,
            jpgHidden: document.getElementById('jpgBtn').hidden,
        }));
        if (/Thermal label/.test(thermal.note) && /greyscale/i.test(thermal.download)
            && thermal.printHidden && thermal.jpgHidden) {
            ok('a thermal label hides CMYK print and exports greyscale');
        } else {
            fail(`thermal profile gating is wrong: ${JSON.stringify(thermal)}`);
        }
        const thermalPromise = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('#downloadBtn').click();
        const thermalDownload = await thermalPromise;
        if (/-thermal\.png$/.test(thermalDownload.suggestedFilename())) {
            ok('the thermal download is named as a greyscale label');
        } else {
            fail(`unexpected thermal filename: ${thermalDownload.suggestedFilename()}`);
        }

        // Return to the flyer for the control checks below.
        await page.locator('.category-tab').nth(0).click();
        await page.waitForTimeout(250);
        await page.locator('.design-tile').nth(0).click();
        await page.waitForTimeout(300);

        console.log('\nBrand identity drawer');
        await page.getByRole('button', { name: 'Brand identity' }).click();
        await page.waitForTimeout(300);
        const drawerText = await page.locator('#drawerBody').innerText();
        if (/PALETTE/.test(drawerText) && /TYPOGRAPHY/.test(drawerText) && /GUIDELINES/.test(drawerText)) {
            ok('the drawer shows palette, typography and guidelines from the pack');
        } else {
            fail('the brand drawer is missing identity sections');
        }
        await page.getByRole('button', { name: 'Close brand identity' }).click();

        console.log('\nSave and export');
        page.once('dialog', (dialog) => dialog.accept('Smoke test flyer'));
        await page.getByRole('button', { name: 'Save asset' }).click();
        await page.waitForTimeout(500);
        const savedCards = await page.locator('.saved-card').count();
        if (savedCards === 1) ok('saving an asset adds it to the Saved tab');
        else fail(`expected 1 saved asset, found ${savedCards}`);
        const savedTab = await page.locator('.control-tab').filter({ hasText: 'Saved' }).innerText();
        if (/Saved \(1\)/.test(savedTab)) ok('the Saved tab shows the stored count');
        else fail(`the Saved tab count is wrong: ${savedTab}`);

        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
        await page.getByRole('button', { name: 'Download PNG' }).click();
        const download = await downloadPromise;
        const downloadPath = await download.path();
        const bytes = (await fsp.readFile(downloadPath)).length;
        if (download.suggestedFilename().endsWith('.png') && bytes > 1000) {
            ok(`full-resolution PNG downloaded (${bytes} bytes)`);
        } else {
            fail(`PNG export failed: ${download.suggestedFilename()} (${bytes} bytes)`);
        }

        console.log('\nPrint pack');
        await page.getByRole('button', { name: 'Print pack (PDF)' }).click();
        await page.waitForFunction(() => !document.getElementById('printDialog').hidden, null, { timeout: 10000 });
        const printState = await page.evaluate(() => ({
            meta: document.getElementById('printMeta').innerText,
            preview: [document.getElementById('printPreview').width, document.getElementById('printPreview').height],
            canCompress: window.AssetPrint.canCompress(),
            edge: window.AssetPrint.checkBoxes(
                [{ kind: 'text', text: 'Edge', x: 0, y: 0, w: 10, h: 10, side: 'f' }],
                85, 55, 1, 1, 4,
            ).length,
            centre: window.AssetPrint.checkBoxes(
                [{ kind: 'text', text: 'Centre', x: 30, y: 20, w: 20, h: 10, side: 'f' }],
                85, 55, 1, 1, 4,
            ).length,
        }));
        if (/Trim 210 × 297 mm/.test(printState.meta) && /Crop marks/.test(printState.meta) && printState.preview[0] > 0) {
            ok('the print dialog reports trim/bleed/crop marks and renders a preview');
        } else {
            fail(`unexpected print dialog state: ${JSON.stringify(printState)}`);
        }
        if (printState.edge > 0 && printState.centre === 0) ok('the safe-zone check flags edge boxes and clears centred boxes');
        else fail(`safe-zone check is wrong: ${JSON.stringify(printState)}`);
        if (printState.canCompress) ok('PDF streams can be compressed in this browser');
        else fail('CompressionStream is unavailable, so the print pack would be uncompressed');

        await page.selectOption('#printDpi', '150');
        const pdfPromise = page.waitForEvent('download', { timeout: 120000 });
        await page.getByRole('button', { name: 'Download print pack' }).click();
        const pdf = await pdfPromise;
        const pdfPath = await pdf.path();
        const pdfBytes = await fsp.readFile(pdfPath);
        const pdfText = pdfBytes.toString('latin1');
        if (pdf.suggestedFilename().endsWith('-print-pack.pdf')
            && pdfText.startsWith('%PDF')
            && pdfText.includes('/DeviceCMYK')
            && pdfText.includes('/TrimBox')
            && pdfText.includes('/BleedBox')) {
            ok(`CMYK print PDF downloaded (${pdfBytes.length} bytes, trim + bleed boxes)`);
        } else {
            fail(`print PDF is wrong: ${pdf.suggestedFilename()} (${pdfBytes.length} bytes)`);
        }
        await page.locator('#printClose').click();

        console.log('\nBrand groups');
        await page.selectOption('#groupSelect', { label: 'Monteleone Group' });
        await page.waitForTimeout(1800);
        const monteleone = await page.evaluate(() => ({
            group: document.getElementById('groupSelect').value,
            brand: document.getElementById('previewBrand').textContent,
            title: document.getElementById('previewTitle').textContent,
            canvas: [document.getElementById('previewCanvas').width, document.getElementById('previewCanvas').height],
        }));
        if (/The Butterfly and the Pig/.test(monteleone.brand) && monteleone.canvas[0] > 0) {
            ok(`Monteleone group opens its first brand (${monteleone.brand})`);
        } else {
            fail(`Monteleone group did not open: ${JSON.stringify(monteleone)}`);
        }
        await page.getByRole('tab', { name: 'Type' }).click();
        const monteleoneFont = await page.locator('#controlBody select').first().inputValue();
        if (/alegreya/i.test(monteleoneFont)) ok('Monteleone brand fonts are uploaded and active');
        else fail(`Monteleone display font is not Alegreya: ${monteleoneFont}`);

        await page.selectOption('#groupSelect', { label: 'Dalton family venues' });
        await page.waitForTimeout(1800);
        const dalton = await page.evaluate(() => ({
            group: document.getElementById('groupSelect').value,
            brand: document.getElementById('previewBrand').textContent,
        }));
        if (/The Physician/.test(dalton.brand)) ok('switching back restores the last Dalton brand');
        else fail(`Dalton group did not restore The Physician: ${JSON.stringify(dalton)}`);

        await page.selectOption('#groupSelect', { label: 'Cawley Hotels' });
        await page.waitForTimeout(1800);
        const cawley = await page.evaluate(() => ({
            group: document.getElementById('groupSelect').value,
            brand: document.getElementById('previewBrand').textContent,
            brands: document.querySelectorAll('#brandSwitch button').length,
            canvas: [document.getElementById('previewCanvas').width, document.getElementById('previewCanvas').height],
        }));
        if (/Boardwalk/.test(cawley.brand) && cawley.brands === 5 && cawley.canvas[0] > 0) {
            ok(`Cawley group opens Boardwalk with all five venues (${cawley.brands})`);
        } else {
            fail(`Cawley group did not open: ${JSON.stringify(cawley)}`);
        }
        await page.getByRole('tab', { name: 'Type' }).click();
        const cawleyFont = await page.locator('#controlBody select').first().inputValue();
        if (/mulish/i.test(cawleyFont)) ok('Cawley brand fonts are uploaded and active');
        else fail(`Cawley display font is not Mulish: ${cawleyFont}`);

        await page.selectOption('#groupSelect', { label: 'KitchenOS' });
        await page.waitForTimeout(1800);
        const kitchenos = await page.evaluate(() => ({
            group: document.getElementById('groupSelect').value,
            brand: document.getElementById('previewBrand').textContent,
            brands: document.querySelectorAll('#brandSwitch button').length,
            canvas: [document.getElementById('previewCanvas').width, document.getElementById('previewCanvas').height],
        }));
        if (/Kitchen OS/.test(kitchenos.brand) && kitchenos.brands === 5 && kitchenos.canvas[0] > 0) {
            ok(`KitchenOS group opens the masterbrand with all five identities (${kitchenos.brands})`);
        } else {
            fail(`KitchenOS group did not open: ${JSON.stringify(kitchenos)}`);
        }
        await page.getByRole('tab', { name: 'Type' }).click();
        const kitchenosFont = await page.locator('#controlBody select').first().inputValue();
        if (/atkinson/i.test(kitchenosFont)) ok('KitchenOS brand fonts are uploaded and active');
        else fail(`KitchenOS display font is not Atkinson: ${kitchenosFont}`);

        await page.selectOption('#groupSelect', { label: 'Okja' });
        await page.waitForTimeout(1800);
        const okja = await page.evaluate(() => ({
            group: document.getElementById('groupSelect').value,
            brand: document.getElementById('previewBrand').textContent,
            brands: document.querySelectorAll('#brandSwitch button').length,
            canvas: [document.getElementById('previewCanvas').width, document.getElementById('previewCanvas').height],
        }));
        if (/okja/i.test(okja.brand) && okja.brands === 1 && okja.canvas[0] > 0) {
            ok(`Okja group opens its single masterbrand (${okja.brand})`);
        } else {
            fail(`Okja group did not open: ${JSON.stringify(okja)}`);
        }
        await page.getByRole('tab', { name: 'Type' }).click();
        const okjaFont = await page.locator('#controlBody select').first().inputValue();
        if (/okja display/i.test(okjaFont)) ok('Okja brand fonts are uploaded and active');
        else fail(`Okja display font is not Okja Display: ${okjaFont}`);

        console.log('\nMotif');
        // Engine: any design accepts a motif, including the brand logo, and
        // motifOn/motifScale/motifX/motifY move it.
        const overlay = await page.evaluate(() => {
            const template = { n: 'No motif', draw() { /* deliberately empty */ } };
            const size = { w: 400, h: 300 };
            const base = {
                t: {},
                pal: { paper: '#ffffff', ink: '#111111', accent: '#cc0000' },
                fonts: { display: 'Georgia', serif: 'Georgia', sans: 'Arial' },
                photos: [],
            };
            const render = (extra) => window.AssetEngine.render(document.createElement('canvas'), size, template,
                { ...base, ...extra }, 400);
            const on = render({ motif: 'sprig', motifOn: true });
            const off = render({ motif: 'sprig', motifOn: false });
            const logo = render({ motif: 'logo', motifOn: true });
            const moved = render({ motif: 'sprig', motifOn: true, motifX: 0.2, motifScale: 2 });
            return {
                on: Boolean(on?.motif),
                off: Boolean(off?.motif),
                logo: Boolean(logo?.motif),
                moved: Boolean(moved?.motif) && Math.abs(moved.motif.x - on.motif.x) > 40 && moved.motif.size > on.motif.size,
            };
        });
        if (overlay.on) ok('a design without a motif slot accepts one');
        else fail('a design without a motif slot did not draw the motif');
        if (!overlay.off) ok('the motif toggle removes the element');
        else fail('the motif toggle did not remove the element');
        if (overlay.logo) ok('the brand logo can be used as a motif');
        else fail('the logo motif did not draw');
        if (overlay.moved) ok('motif position and size transform the element');
        else fail('motif transform did not move or scale the element');

        // UI: the Motif tab is available on every design, offers the logo and
        // placement controls, and saves the placement with the asset.
        await page.locator('.category-tab').filter({ hasText: 'Guest cards' }).click();
        await page.waitForTimeout(350);
        await page.locator('.design-tile').filter({ hasText: 'Door hanger' }).click();
        await page.waitForTimeout(500);
        await page.getByRole('tab', { name: 'Motif' }).click();
        await page.waitForTimeout(300);
        if (await page.locator('#controlBody .control-note').first().innerText().then((text) => /optional on every design/i.test(text))) {
            ok('the motif panel is available on a design without a decorative slot');
        } else {
            fail('the motif panel still refuses designs without a motif slot');
        }
        if (await page.locator('.motif-tile[data-motif="logo"]').count() === 1) ok('the logo appears as a motif option');
        else fail('the logo option is missing from the motif grid');
        if (await page.locator('.motif-controls input[type="range"]').count() === 3) ok('motif size and position sliders are present');
        else fail('motif placement sliders are missing');

        const motifBeforeLogo = await page.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        await page.locator('.motif-tile[data-motif="logo"]').click();
        await page.waitForTimeout(600);
        const motifWithLogo = await page.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        if (motifBeforeLogo !== motifWithLogo) ok('choosing the logo redraws the design');
        else fail('choosing the logo did not change the design');

        const sizeSlider = page.locator('.motif-slider input[type="range"]').first();
        await sizeSlider.evaluate((input) => { input.value = '180'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForTimeout(600);
        const motifResized = await page.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        if (motifResized !== motifWithLogo) ok('resizing the motif redraws the design');
        else fail('resizing the motif did not change the design');

        page.once('dialog', (dialog) => dialog.accept('Motif placement test'));
        await page.getByRole('button', { name: 'Save asset' }).click();
        await page.waitForTimeout(700);
        await page.getByRole('tab', { name: 'Saved' }).click();
        await page.waitForTimeout(300);
        const motifCard = page.locator('.saved-card').filter({ hasText: 'Motif placement test' }).first();
        if (await motifCard.count() === 1) ok('the motif version saves as a new asset');
        else fail('the motif version did not save');
        await motifCard.getByRole('button', { name: 'Open' }).click();
        await page.waitForTimeout(1100);
        await page.getByRole('tab', { name: 'Motif' }).click();
        await page.waitForTimeout(300);
        const restoredMotifSize = await page.locator('.motif-value').first().innerText();
        if (restoredMotifSize === '180%') ok('reopening the saved asset restores the motif size');
        else fail(`reopening restored the motif size as ${restoredMotifSize}`);

        console.log('\nZoom and logo');
        const zoomStageBox = await page.locator('.stage').boundingBox();
        const zoomBefore = await page.locator('.zoom-value').innerText();
        await page.mouse.move(zoomStageBox.x + zoomStageBox.width / 2, zoomStageBox.y + zoomStageBox.height / 2);
        await page.mouse.wheel(0, -420);
        await page.waitForTimeout(500);
        const zoomAfter = await page.locator('.zoom-value').innerText();
        if (Number.parseInt(zoomAfter, 10) > 100) ok(`scrolling the preview zooms in (${zoomBefore} → ${zoomAfter})`);
        else fail(`scrolling the preview did not zoom (${zoomAfter})`);
        if (await page.locator('.zoom-reset').isVisible()) ok('the zoom bar offers a reset');
        else fail('the zoom bar has no reset while zoomed');
        await page.locator('.zoom-reset').click();
        await page.waitForTimeout(400);
        if (await page.locator('.zoom-value').innerText() === '100%') ok('zoom reset returns the preview to 100%');
        else fail('zoom reset did not return to 100%');

        await page.getByRole('tab', { name: 'Logo' }).click();
        await page.waitForTimeout(300);
        if (await page.locator('.motif-toggle .btn').count() === 1
            && await page.locator('.motif-controls input[type="range"]').count() === 3) {
            ok('the logo panel offers a toggle and size/position sliders');
        } else {
            fail('the logo panel is missing its toggle or sliders');
        }
        const logoShown = await page.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        await page.locator('.motif-toggle .btn').click();
        await page.waitForTimeout(500);
        const logoHidden = await page.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        if (logoShown !== logoHidden) ok('hiding the logo redraws the design');
        else fail('hiding the logo did not change the design');
        await page.locator('.motif-toggle .btn').click();
        await page.waitForTimeout(500);
        const logoSized = page.locator('.motif-slider input[type="range"]').first();
        await logoSized.evaluate((input) => { input.value = '150'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForTimeout(500);
        const logoAfterSize = await page.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        if (logoAfterSize !== logoShown) ok('resizing the logo redraws the design');
        else fail('resizing the logo did not change the design');
        page.once('dialog', (dialog) => dialog.accept('Logo placement test'));
        await page.getByRole('button', { name: 'Save asset' }).click();
        await page.waitForTimeout(700);
        await page.getByRole('tab', { name: 'Saved' }).click();
        await page.waitForTimeout(300);
        const logoCard = page.locator('.saved-card').filter({ hasText: 'Logo placement test' }).first();
        if (await logoCard.count() === 1) ok('the logo version saves as a new asset');
        else fail('the logo version did not save');
        await logoCard.getByRole('button', { name: 'Open' }).click();
        await page.waitForTimeout(1100);
        await page.getByRole('tab', { name: 'Logo' }).click();
        await page.waitForTimeout(300);
        const logoRestored = await page.locator('.motif-value').first().innerText();
        if (logoRestored === '150%') ok('reopening the saved asset restores the logo size');
        else fail(`reopening restored the logo size as ${logoRestored}`);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (!overflow) ok('the workspace has no horizontal overflow at 1600px');
        else fail('the workspace overflows horizontally at 1600px');

        await fsp.mkdir(path.join(ROOT, '_dev', 'screenshots'), { recursive: true });
        await page.screenshot({ path: path.join(ROOT, '_dev', 'screenshots', 'asset-studio-smoke.png') });
        console.log('\nscreenshot: _dev/screenshots/asset-studio-smoke.png');

        // The gate is the entry point: a reload must not resume the workspace,
        // even though a brand session exists from the walk above.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.gate-card', { timeout: 20000 });
        const afterReload = await page.evaluate(() => ({
            gate: !document.getElementById('brandGate').hidden,
            studio: !document.getElementById('studio').hidden,
            cards: document.querySelectorAll('.gate-card').length,
            groups: document.querySelectorAll('.group-tab').length,
        }));
        if (afterReload.gate && !afterReload.studio && afterReload.cards > 0) {
            ok('a reload returns to the brand gate instead of resuming the workspace');
        } else {
            fail(`reload skipped the gate: ${JSON.stringify(afterReload)}`);
        }

        // Deep links are the deliberate way past the gate.
        const okjaPack = await page.evaluate(() => document.getElementById('groupSelect').value);
        await page.goto(`${BASE}/asset-studio.html?brand=okja&pack=${encodeURIComponent(okjaPack)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !document.getElementById('studio').hidden, null, { timeout: 15000 });
        const deepLinked = await page.evaluate(() => ({
            gate: !document.getElementById('brandGate').hidden,
            brand: document.getElementById('previewBrand').textContent,
        }));
        if (!deepLinked.gate && /okja/i.test(deepLinked.brand)) {
            ok('a ?brand= deep link opens that brand without the gate');
        } else {
            fail(`deep link did not open the brand: ${JSON.stringify(deepLinked)}`);
        }

        const relevantErrors = consoleErrors.filter((message) => !/favicon|net::ERR_|\/api\/fonts\b/i.test(message));
        if (relevantErrors.length) fail(`browser errors: ${relevantErrors.join(' | ')}`);
        else ok('no browser console errors or page errors');
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
        if (failures.length) {
            console.log(`\n${failures.length} failure(s):`);
            failures.forEach((message) => console.log(`  - ${message}`));
            if (serverLog.trim()) console.log(`\nserver log:\n${serverLog}`);
            process.exitCode = 1;
        } else {
            console.log(`\nall ${checks} asset-studio checks passed`);
        }
    }
}

main().catch((error) => {
    console.error('\nasset-studio test crashed:', error);
    process.exitCode = 1;
});
