'use strict';
/**
 * Browser smoke test for the Phase 1–3 work.
 *
 * Boots the real zero-dependency server, opens studio-v2.html in Chromium and
 * drives the new UI: text layers, DOM/canvas/SVG parity, formats, pinning,
 * contact sheet, variables and brand validation.
 *
 * Run with: node tests/smoke.js
 */
const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const path = require('node:path');
const assert = require('node:assert');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);

const ROOT = path.join(__dirname, '..');
const PORT = 8123 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;

const failures = [];
let step = 0;
let crashed = false;
const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function ok(message) {
    step += 1;
    console.log(`  ✓ ${message}`);
}

function fail(message) {
    failures.push(message);
    console.log(`  ✗ ${message}`);
}

/**
 * Make a control visible the way a person would. Actions now live in
 * one-at-a-time toolbar panels and the sidebar sections start collapsed,
 * so open the containing panel/section before touching the control.
 */
async function revealControl(page, selector) {
    const target = page.locator(selector).first();
    if (await target.isVisible()) return target;
    const owner = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) return null;
        const panel = element.closest('.bar-panel');
        if (panel && panel.id) return { kind: 'panel', id: panel.id };
        const section = element.closest('[data-section-content]');
        if (section?.dataset.sectionContent) {
            return { kind: 'section', name: section.dataset.sectionContent };
        }
        return null;
    }, selector);
    if (owner?.kind === 'panel') {
        await page.click(`[data-bar-toggle][aria-controls="${owner.id}"]`);
    } else if (owner?.kind === 'section') {
        await page.click(`[data-action="toggle-section"][data-section="${owner.name}"]`);
    }
    await target.waitFor({ state: 'visible', timeout: 5000 });
    return target;
}

async function clickAction(page, action) {
    const selector = `[data-action="${action}"]`;
    const target = await revealControl(page, selector);
    await target.click();
}

async function selectBarOption(page, selector, value) {
    await revealControl(page, selector);
    await page.selectOption(selector, value);
}

async function waitForHealth(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE}/api/health`);
            if (response.ok) return true;
        } catch {
            /* not up yet */
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('the studio server did not start');
}

/** Ink bounding box of dark pixels in a PNG rendered by the export path. */
const INK_BBOX = `
    (dataUrl) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, ink = 0;
            for (let y = 0; y < canvas.height; y += 1) {
                for (let x = 0; x < canvas.width; x += 1) {
                    const offset = (y * canvas.width + x) * 4;
                    // Anything clearly darker than the white background.
                    if (data[offset] < 128 && data[offset + 3] > 32) {
                        ink += 1;
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            resolve({ ink, width: canvas.width, height: canvas.height, minX, minY, maxX, maxY });
        };
        image.src = dataUrl;
    })
`;

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
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const consoleErrors = [];
        page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() !== 'error') return;
            const url = message.location()?.url || '';
            consoleErrors.push(`console: ${message.text()}${url ? ` [${url}]` : ''}`);
        });

        await page.goto(`${BASE}/studio-v2.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.layerStudio), null, { timeout: 10000 });

        console.log('\nPhase 0 — minimal toolbar');
        const initialBar = await page.evaluate(() => ({
            sections: [...document.querySelectorAll('.layer-sidebar [data-section-content]')]
                .filter((body) => !body.hidden)
                .map((body) => body.dataset.sectionContent),
            panels: [...document.querySelectorAll('.bar-panel')]
                .filter((panel) => !panel.hidden)
                .map((panel) => panel.id),
        }));
        if (initialBar.sections.length === 1 && initialBar.sections[0] === 'layers' && initialBar.panels.length === 0) {
            ok('only Layers starts open and every toolbar panel starts closed');
        } else {
            fail(`unexpected initial toolbar state: ${JSON.stringify(initialBar)}`);
        }

        const openPanels = async () => page.evaluate(() => [...document.querySelectorAll('.bar-panel')]
            .filter((panel) => !panel.hidden)
            .map((panel) => panel.id));
        await page.click('[data-bar-toggle][aria-controls="barCanvas"]');
        if (JSON.stringify(await openPanels()) === '["barCanvas"]') ok('Canvas opens its panel');
        else fail(`Canvas did not open alone: ${await openPanels()}`);
        await page.click('[data-bar-toggle][aria-controls="barCharacter"]');
        if (JSON.stringify(await openPanels()) === '["barCharacter"]') ok('opening Character closes Canvas (one panel at a time)');
        else fail(`Character did not replace Canvas: ${await openPanels()}`);
        await page.keyboard.press('Escape');
        if ((await openPanels()).length === 0) ok('Escape closes the open panel');
        else fail(`Escape left a panel open: ${await openPanels()}`);

        console.log('\nPhase 1 — text layers');
        await clickAction(page, 'add-text-layer');
        await page.waitForSelector('.layer-item[data-type="text"] .ls-text-inner');
        const lineCount = await page.evaluate(
            () => document.querySelectorAll('.layer-item[data-type="text"] .ls-text-line').length,
        );
        if (lineCount > 0) ok(`a text layer renders ${lineCount} DOM line(s)`);
        else fail('the text layer rendered no DOM lines');

        // Editing the copy re-lays the text out.
        await page.fill('#layerInspector textarea[data-prop="text"]', 'Fire up the grill tonight');
        await page.waitForTimeout(120);
        const editedText = await page.evaluate(
            () => [...document.querySelectorAll('.ls-text-line')].map((node) => node.textContent).join(' '),
        );
        if (editedText.includes('Fire up the grill')) ok('editing the textarea updates the canvas copy');
        else fail(`the canvas copy did not update (got "${editedText}")`);

        // Clean single-line copy for the parity check.
        await page.fill('#layerInspector textarea[data-prop="text"]', 'HEADLINE');
        await page.fill('#layerInspector input[data-prop="fontSizePct"]', '12');
        await page.waitForTimeout(120);

        // Text-specific inspector fields exist, image-only ones do not.
        const inspectorShape = await page.evaluate(() => ({
            font: Boolean(document.querySelector('#layerInspector select[data-prop="fontFamily"]')),
            align: Boolean(document.querySelector('#layerInspector select[data-prop="align"]')),
            fit: Boolean(document.querySelector('#layerInspector select[data-prop="fit"]')),
            outline: Boolean(document.querySelector('#layerInspector input[data-prop="outlineEnabled"]')),
            upload: Boolean(document.querySelector('#layerInspector [data-action="upload-font"]')),
            textarea: Boolean(document.querySelector('#layerInspector textarea[data-prop="text"]')),
        }));
        if (inspectorShape.font && inspectorShape.align && !inspectorShape.fit && !inspectorShape.outline) {
            ok('the inspector shows text fields and hides image-only fields');
        } else {
            fail(`unexpected inspector shape: ${JSON.stringify(inspectorShape)}`);
        }
        if (inspectorShape.textarea && inspectorShape.upload) ok('copy and the font upload are reachable from the inspector');
        else fail('the text inspector is missing the copy field or the font upload');

        const presetCoverage = await page.evaluate(() => {
            const canonical = window.AssetStudioAnimation.PRESETS;
            const studio = window.layerStudio;
            const available = new Set(window.LayerStudio.PRESET_NAMES);
            const buttons = [...document.querySelectorAll('#layerInspector .layer-preset-grid button')];
            const layer = studio.getLayer(studio.selectedLayerId);
            const originalKeyframes = structuredClone(layer.keyframes || []);
            const missing = canonical.filter(([id]) => !available.has(id) || !buttons.some(button => button.title === id));
            const invalid = [];
            canonical.forEach(([id]) => {
                studio.applyPreset(id);
                if (!Array.isArray(layer.keyframes) || layer.keyframes.length < 2
                    || layer.keyframes.some(frame => !Number.isFinite(frame.time)
                        || !['x', 'y', 'w', 'h', 'rotation', 'opacity'].every(property => Number.isFinite(frame[property])))) {
                    invalid.push(id);
                }
            });
            layer.keyframes = originalKeyframes;
            studio.applyAnimationTime(0);
            return { canonicalCount: canonical.length, buttonCount: buttons.length, missing, invalid };
        });
        if (!presetCoverage.missing.length && !presetCoverage.invalid.length) {
            ok(`all ${presetCoverage.canonicalCount} Studio Agent presets appear in Studio V2 and generate valid keyframes`);
        } else {
            fail(`Studio V2 preset coverage failed: ${JSON.stringify(presetCoverage)}`);
        }

        // System families are seeded, so the export gate must not block.
        const gate = await page.evaluate(() => {
            const studio = window.layerStudio;
            const snapshot = studio.createExportSnapshot();
            return { blocked: window.StudioCore === undefined, families: studio.composition.layers
                .filter((layer) => layer.type === 'text')
                .map((layer) => layer.font.family) };
        });
        const gateResult = await page.evaluate(async () => {
            try {
                await window.layerStudio.ensureFontsForExport(window.layerStudio.createExportSnapshot());
                return 'pass';
            } catch (error) {
                return `blocked: ${error.message}`;
            }
        });
        if (gateResult === 'pass') ok(`the font gate passes for ${gate.families.join(', ') || 'system families'}`);
        else fail(`the font gate blocked a system font: ${gateResult}`);

        // --- DOM vs canvas export parity -----------------------------------
        const parity = await page.evaluate(async () => {
            const studio = window.layerStudio;
            const snapshot = studio.createExportSnapshot();
            const assets = await studio.loadExportAssets(snapshot, 2048, 1080, 24_000_000);
            const canvas = document.createElement('canvas');
            canvas.width = 1080;
            canvas.height = 1080;
            const context = canvas.getContext('2d');
            studio.renderExportFrame(context, snapshot, assets, 0, 1080, 1080);
            const dataUrl = canvas.toDataURL('image/png');

            // Where the DOM thinks the text is, in format pixels.
            const canvasRect = studio.el.canvas.getBoundingClientRect();
            const lines = [...studio.el.canvas.querySelectorAll('.layer-item[data-type="text"] .ls-text-line')];
            const boxes = lines.map((node) => {
                const rect = node.getBoundingClientRect();
                return {
                    left: (rect.left - canvasRect.left) / canvasRect.width * 1080,
                    right: (rect.right - canvasRect.left) / canvasRect.width * 1080,
                    top: (rect.top - canvasRect.top) / canvasRect.height * 1080,
                    bottom: (rect.bottom - canvasRect.top) / canvasRect.height * 1080,
                };
            });
            const domBox = boxes.reduce((acc, box) => ({
                left: Math.min(acc.left, box.left),
                right: Math.max(acc.right, box.right),
                top: Math.min(acc.top, box.top),
                bottom: Math.max(acc.bottom, box.bottom),
            }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
            return { dataUrl, domBox, lineCount: lines.length };
        });

        const ink = await page.evaluate(([source, dataUrl]) => {
            // eslint-disable-next-line no-eval
            const measure = eval(`(${source})`);
            return measure(dataUrl);
        }, [INK_BBOX, parity.dataUrl]);
        if (ink.ink > 200) ok(`the canvas export draws text (${ink.ink} ink pixels)`);
        else fail(`the canvas export drew no text (${ink.ink} ink pixels)`);

        const domCenterX = (parity.domBox.left + parity.domBox.right) / 2;
        const domCenterY = (parity.domBox.top + parity.domBox.bottom) / 2;
        const inkCenterX = (ink.minX + ink.maxX) / 2;
        const inkCenterY = (ink.minY + ink.maxY) / 2;
        const dx = Math.abs(domCenterX - inkCenterX) / 1080;
        const dy = Math.abs(domCenterY - inkCenterY) / 1080;
        if (dx < 0.03 && dy < 0.03) {
            ok(`DOM and canvas agree on the text position (Δx ${(dx * 100).toFixed(1)}%, Δy ${(dy * 100).toFixed(1)}%)`);
        } else {
            fail(`DOM and canvas disagree on the text position (Δx ${(dx * 100).toFixed(1)}%, Δy ${(dy * 100).toFixed(1)}%)`);
        }

        const svg = await page.evaluate(() => window.layerStudio.svgString());
        if (svg.includes('<text') && svg.includes('HEADLINE')) ok('the SVG export contains portable <text>, not foreignObject');
        else fail('the SVG export is missing <text> element(s)');
        if (!svg.includes('foreignObject')) ok('the SVG export uses no foreignObject');
        else fail('the SVG export fell back to foreignObject');
        if (svg.includes('font-family=')) ok('the SVG export embeds the font family');
        else fail('the SVG export is missing font-family');

        // --- Round-trip through normalizeComposition ------------------------
        const roundTrip = await page.evaluate(() => {
            const studio = window.layerStudio;
            const serialized = studio.serializeComposition();
            const factory = window.LayerStudio;
            // normalizeComposition is internal; re-instantiating proves the file loads.
            return { serialized, hasText: serialized.layers.some((layer) => layer.type === 'text') };
        });
        if (roundTrip.hasText) ok('the persisted composition keeps the text layer');
        else fail('the persisted composition dropped the text layer');

        console.log('\nPhase 2 — formats');
        await page.click('[data-action="add-format"]');
        await page.waitForSelector('#layerFormatDialog[open]');
        ok('the add-format dialog opens');
        await page.selectOption('#layerFormatChannel', 'social');
        await page.selectOption('#layerFormatPreset', '1080x1920');
        await page.click('[data-action="submit-format"]');
        await page.waitForFunction(() => document.querySelectorAll('.layer-format-tab').length === 2, null, { timeout: 5000 });
        ok('adding a format creates a second tab');

        const activeRatio = await page.evaluate(() => {
            const format = window.layerStudio.activeFormat();
            return { id: format.id, width: format.width, height: format.height };
        });
        if (activeRatio.height === 1920) ok(`the new format is active (${activeRatio.width} × ${activeRatio.height})`);
        else fail(`the new format was not activated: ${JSON.stringify(activeRatio)}`);

        const canvasRatio = await page.evaluate(() => {
            const style = window.layerStudio.el.canvas.style.aspectRatio;
            return style;
        });
        if (canvasRatio.replace(/\s/g, '') === '1080/1920') ok('the canvas aspect ratio follows the active format');
        else fail(`the canvas aspect ratio did not follow the format (got "${canvasRatio}")`);

        // Pin the text layer to this format and move it.
        await page.click('#layerInspector [data-action="toggle-pin"]');
        // studio-v2 renders the visible list as the segment tree; #layerList is
        // hidden but still rendered, so both markers must appear.
        await page.waitForSelector('.layer-pin-badge', { state: 'attached' });
        await page.waitForSelector('.seg-pin', { timeout: 5000 });
        ok('pinning a layer shows the M badge in the layer list and the segment tree');

        const pinResult = await page.evaluate(() => {
            const studio = window.layerStudio;
            const layer = studio.composition.layers.find((item) => item.type === 'text');
            const format = studio.activeFormat();
            const before = format.layerOverrides[layer.id];
            studio.selectedLayerId = layer.id;
            studio.applyInspectorValue({ dataset: { prop: 'x' }, value: '30' });
            const master = studio.composition.formats.find((item) => item.isMaster);
            return {
                overrideX: format.layerOverrides[layer.id].x,
                baseX: layer.x,
                hadOverride: Boolean(before),
                masterPinned: Boolean(master.layerOverrides[layer.id]),
            };
        });
        if (pinResult.overrideX === 30 && pinResult.baseX !== 30 && !pinResult.masterPinned) {
            ok('a pinned edit writes the format override, not the base layer');
        } else {
            fail(`pinning wrote to the wrong place: ${JSON.stringify(pinResult)}`);
        }

        await page.click('#layerFormatTabs .layer-format-tab:first-child');
        await page.waitForTimeout(120);
        const masterX = await page.evaluate(() => {
            const studio = window.layerStudio;
            const layer = studio.composition.layers.find((item) => item.type === 'text');
            return studio.getLayerStateAtTime(layer, 0).x;
        });
        if (masterX !== 30) ok(`the master format keeps the base position (x=${masterX})`);
        else fail('the format override leaked into the master');

        // Contact sheet renders one cell per format via the export pipeline.
        await page.click('[data-action="open-contact-sheet"]');
        await page.waitForFunction(
            () => document.querySelectorAll('.layer-contact-cell').length >= 2,
            null,
            { timeout: 15000 },
        );
        const cells = await page.evaluate(() => [...document.querySelectorAll('.layer-contact-cell')].map((cell) => ({
            error: cell.dataset.error === 'true',
            caption: cell.querySelector('.layer-contact-caption')?.textContent || '',
        })));
        if (cells.every((cell) => !cell.error)) ok(`the contact sheet rendered ${cells.length} live previews`);
        else fail(`the contact sheet failed for ${cells.filter((cell) => cell.error).length} format(s)`);
        await page.click('[data-action="close-contact-sheet"]');

        // Locale is a real rendering dimension, not just a filename suffix.
        const locales = await page.evaluate(async () => {
            const studio = window.layerStudio;
            const textLayer = studio.composition.layers.find((layer) => layer.type === 'text');
            const previous = textLayer.text;
            textLayer.text = { en: 'Winter', 'pt-BR': 'Inverno' };
            studio.render();
            const read = () => [...document.querySelectorAll('.ls-text-line')]
                .map((node) => node.textContent).join(' ').trim();
            const domEn = read();
            studio.previewLocale = 'pt-BR';
            studio.render();
            const domPt = read();
            studio.previewLocale = null;
            textLayer.text = previous;
            studio.render();
            return { domEn, domPt, differs: domEn !== domPt };
        });
        if (locales.differs && locales.domPt.includes('Inverno')) {
            ok(`the DOM follows the locale ("${locales.domEn}" → "${locales.domPt}")`);
        } else {
            fail(`the DOM ignored the locale: ${JSON.stringify(locales)}`);
        }

        const exportLocales = await page.evaluate(async () => {
            const studio = window.layerStudio;
            const textLayer = studio.composition.layers.find((layer) => layer.type === 'text');
            const previous = textLayer.text;
            textLayer.text = { en: 'Winter', 'pt-BR': 'Inverno' };
            const format = studio.activeFormat();
            const inkFor = async (locale) => {
                const snapshot = studio.createExportSnapshot({ format, locale });
                const assets = await studio.loadExportAssets(snapshot, 1024, 540, 8_000_000);
                const canvas = document.createElement('canvas');
                canvas.width = 540;
                canvas.height = 540;
                const context = canvas.getContext('2d');
                studio.renderExportFrame(context, snapshot, assets, 0, 540, 540);
                const { data } = context.getImageData(0, 0, 540, 540);
                let ink = 0;
                for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 3] > 32) ink += 1;
                return ink;
            };
            const en = await inkFor('en');
            const pt = await inkFor('pt-BR');
            const svgEn = studio.exportSvg({ format, download: false });
            const svgPt = (() => {
                const previousLocale = studio.previewLocale;
                studio.previewLocale = 'pt-BR';
                const markup = studio.exportSvg({ format, download: false });
                studio.previewLocale = previousLocale;
                return markup;
            })();
            textLayer.text = previous;
            studio.render();
            return { en, pt, svgHasEn: svgEn.includes('Winter'), svgHasPt: svgPt.includes('Inverno') };
        });
        if (Math.abs(exportLocales.en - exportLocales.pt) > 50) {
            ok(`the canvas export follows the locale (en ${exportLocales.en} px vs pt-BR ${exportLocales.pt} px)`);
        } else {
            fail(`the canvas export ignored the locale: ${JSON.stringify(exportLocales)}`);
        }
        if (exportLocales.svgHasEn && exportLocales.svgHasPt) ok('the SVG export follows the locale');
        else fail(`the SVG export ignored the locale: ${JSON.stringify(exportLocales)}`);

        // The locale switcher is the UI for the dimension the checks above prove.
        await page.evaluate(() => {
            const studio = window.layerStudio;
            const textLayer = studio.composition.layers.find((layer) => layer.type === 'text');
            textLayer.text = { en: 'Winter', 'pt-BR': 'Inverno' };
            studio.render();
        });
        await selectBarOption(page, '#layerLocale', 'pt-BR');
        await page.waitForTimeout(150);
        const localeUi = await page.evaluate(() => ({
            lines: [...document.querySelectorAll('.ls-text-line')].map((node) => node.textContent).join(' ').trim(),
            activeLocale: window.layerStudio.composition.activeLocale,
            status: window.layerStudio.el.status.textContent,
            options: [...document.querySelectorAll('#layerLocale option')].map((option) => option.value),
        }));
        if (localeUi.lines.includes('Inverno') && localeUi.activeLocale === 'pt-BR') {
            ok(`the locale switcher re-renders the canvas (${localeUi.options.length} locales offered)`);
        } else {
            fail(`the locale switcher did not re-render: ${JSON.stringify(localeUi)}`);
        }
        if (/translated copy/.test(localeUi.status)) ok('the locale change reports how many layers are translated');
        else fail(`the locale status is unhelpful: ${localeUi.status}`);
        await selectBarOption(page, '#layerLocale', 'en');
        await page.waitForTimeout(100);
        const backToEn = await page.evaluate(() => ({
            lines: [...document.querySelectorAll('.ls-text-line')].map((node) => node.textContent).join(' ').trim(),
            activeLocale: window.layerStudio.composition.activeLocale,
        }));
        if (backToEn.activeLocale === 'en') ok('switching back restores the default copy');
        else fail(`switching back failed: ${JSON.stringify(backToEn)}`);

        // Real downloads: single PNG, then a batch ZIP.
        const pngDownload = page.waitForEvent('download', { timeout: 60000 });
        await clickAction(page, 'export-image');
        const png = await pngDownload;
        const pngPath = await png.path();
        const pngBytes = (await fsp.readFile(pngPath)).length;
        if (png.suggestedFilename().endsWith('.png') && pngBytes > 1000) {
            ok(`PNG export downloaded (${pngBytes} bytes)`);
        } else {
            fail(`PNG export failed: ${png.suggestedFilename()} (${pngBytes} bytes)`);
        }

        await clickAction(page, 'export-all-formats');
        await page.waitForSelector('#layerBatchDialog[open]');
        for (const output of ['gif', 'svg', 'video']) {
            await page.uncheck(`.layer-batch-outputs input[value="${output}"]`).catch(() => {});
        }
        await page.fill('#layerBatchLocales', 'en, pt-BR');
        const zipDownload = page.waitForEvent('download', { timeout: 120000 });
        await page.click('[data-action="submit-batch"]');
        const zip = await zipDownload;
        const zipPath = await zip.path();
        const zipBytes = await fsp.readFile(zipPath);
        const zipNames = zipBytes.toString('latin1');
        const expected = [
            'Untitled-Composition-Master-en.png',
            'Untitled-Composition-Master-pt-BR.png',
            'Untitled-Composition-Story-Reels-en.png',
        ];
        const found = expected.filter((name) => zipNames.includes(name));
        if (zip.suggestedFilename().endsWith('-formats.zip') && found.length === expected.length) {
            ok(`batch export zipped ${expected.length} files (${zipBytes.length} bytes, formats × locales)`);
        } else {
            fail(`batch ZIP missing entries (found ${found.length}/${expected.length}): ${zip.suggestedFilename()}`);
        }
        await page.waitForFunction(
            () => /Done —/.test(document.querySelector('#layerBatchStatus')?.textContent || ''),
            null,
            { timeout: 30000 },
        ).then(() => ok('the batch dialog reports completion')).catch(() => fail('the batch dialog never reported completion'));
        await page.click('[data-action="close-batch"]');

        const batch = await page.evaluate(async () => {
            const studio = window.layerStudio;
            // One format, PNG only, to prove the ZIP path without a long render.
            const format = studio.activeFormat();
            const snapshot = studio.createExportSnapshot({ format, locale: 'en' });
            const assets = await studio.loadExportAssets(snapshot, 2048, 1080, 24_000_000);
            const encoded = await studio.encodeSnapshot(snapshot, assets, 'png');
            return { size: encoded.blob.size, extension: encoded.extension };
        });
        if (batch.extension === 'png' && batch.size > 1000) ok(`batch encodeSnapshot produced a ${batch.size} byte PNG`);
        else fail(`batch encodeSnapshot failed: ${JSON.stringify(batch)}`);

        console.log('\nPhase 3 — variables + brand kit');
        await clickAction(page, 'add-variable');
        await page.waitForSelector('.layer-variable-row');
        ok('adding a variable creates a row in the variables panel');

        const binding = await page.evaluate(() => {
            const studio = window.layerStudio;
            const variable = studio.composition.variables[0];
            const layer = studio.composition.layers.find((item) => item.type === 'text');
            studio.selectedLayerId = layer.id;
            studio.applyInspectorValue({ dataset: { prop: 'bindText' }, value: variable.id });
            const bound = studio.composition.layers.find((item) => item.id === layer.id);
            // A short value keeps the assertion to a single, unclipped line.
            studio.setVariableValue(variable.id, 'Bound', { render: true });
            const resolved = studio.resolveLayer(studio.composition.layers.find((item) => item.id === layer.id));
            const rendered = [...document.querySelectorAll('.ls-text-line')].map((n) => n.textContent).join(' ');
            return { bindings: bound.bindings, resolvedText: resolved.text, rendered };
        });
        if (binding.bindings.text) ok('binding a text layer to a text variable stores layer.bindings.text');
        else fail('binding did not store layer.bindings.text');
        if (binding.rendered.includes('Bound')) ok('changing the variable updates the canvas');
        else fail(`the canvas did not follow the variable (rendered "${binding.rendered}")`);

        // Image variable → image layer url binding.
        const imageBinding = await page.evaluate(() => {
            const studio = window.layerStudio;
            const image = document.createElement('canvas');
            image.width = 80; image.height = 60;
            image.getContext('2d').fillRect(0, 0, 80, 60);
            const url = image.toDataURL('image/png');
            // Make sure there is an image layer to bind.
            if (!studio.composition.layers.some((item) => item.type === 'image')) {
                studio.composition.layers.push({
                    id: 'image-fixture', type: 'image', name: 'Hero image', role: 'prop',
                    url, frames: [url], x: 4, y: 4, w: 20, h: 20, z: 5, visible: true,
                    rotation: 0, opacity: 1, keyframes: [],
                });
                studio.render();
            }

            const variable = studio.addVariable({ name: 'Hero', kind: 'image', defaultValue: url });
            const layer = studio.composition.layers.find((item) => item.type === 'image');
            if (!layer) return { skipped: true };
            studio.selectedLayerId = layer.id;
            studio.applyInspectorValue({ dataset: { prop: 'bindUrl' }, value: variable.id });
            studio.setVariableValue(variable.id, url, { render: true });
            const resolved = studio.resolveLayer(studio.composition.layers.find((item) => item.id === layer.id));
            return { bindings: resolved.bindings, urlIsData: String(resolved.url).startsWith('data:image/png') };
        });
        if (imageBinding.skipped) {
            ok('image binding skipped: the composition has no image layer');
        } else if (imageBinding.bindings?.url && imageBinding.urlIsData) {
            ok('binding an image variable to an image layer resolves its url');
        } else {
            fail(`image variable binding failed: ${JSON.stringify(imageBinding)}`);
        }

        // Brand kit + validation.
        await clickAction(page, 'open-brand-kit');
        await page.waitForSelector('#layerBrandKitDialog[open]');
        ok('the brand kit dialog opens');
        await page.click('[data-action="save-brand-kit"]');
        await page.click('[data-action="close-brand-kit"]');
        const kit = await page.evaluate(() => window.layerStudio.composition.brandKit);
        if (kit && Array.isArray(kit.palette)) ok('saving the kit attaches it to the composition');
        else fail('the brand kit was not attached');

        // Force a drift: a colour outside the palette.
        await page.evaluate(() => {
            const studio = window.layerStudio;
            const layer = studio.composition.layers.find((item) => item.type === 'text');
            layer.color = '#3b7fbf';
            studio.render();
        });
        await clickAction(page, 'validate-brand');
        await page.waitForSelector('#layerValidationDialog[open]');
        const report = await page.evaluate(() => ({
            groups: document.querySelectorAll('#layerBrandValidation .layer-validation-group').length,
            failing: [...document.querySelectorAll('#layerBrandValidation .layer-validation-entry[data-ok="false"]')]
                .map((node) => node.textContent),
        }));
        if (report.groups >= 3) ok(`validation reports ${report.groups} groups`);
        else fail(`validation reported only ${report.groups} group(s)`);
        if (report.failing.some((line) => line.includes('#3b7fbf'))) ok('validation detects palette drift and names the colour');
        else fail(`validation did not flag the drift: ${JSON.stringify(report.failing)}`);
        await page.click('[data-action="close-validation"]');

        // --- Agent protocol --------------------------------------------------
        const agent = await page.evaluate(() => {
            const studio = window.layerStudio;
            const variable = studio.composition.variables[0];
            studio.applyAgentCommands([
                { type: 'set-variable', variableId: variable.id, value: 'Agent copy' },
                { type: 'set-variable', variableId: 'nope', value: 'x' },
            ]);
            const resolved = studio.resolveLayer(studio.composition.layers.find((item) => item.type === 'text'));
            return { text: resolved.text, status: studio.el.status.textContent };
        });
        if (agent.text === 'Agent copy') ok('applyAgentCommands applies a validated set-variable command');
        else fail(`set-variable did not apply: ${JSON.stringify(agent)}`);
        if (/skipped/.test(agent.status)) ok('an unknown variable id is skipped, not applied');
        else fail(`the unknown variable was not reported: ${agent.status}`);

        const spec = await page.evaluate(() => {
            const studio = window.layerStudio;
            const original = studio.exportAgentSpec;
            // Capture the document without triggering a download twice.
            let captured = null;
            studio.exportAgentSpec = function capture() {
                const result = original.call(this);
                return result;
            };
            captured = studio.exportAgentSpec();
            return {
                formats: captured.formats.length,
                variables: captured.variables.length,
                textLayer: captured.layers.find((layer) => layer.type === 'text'),
                hasBrandKit: Boolean(captured.brandKit),
            };
        });
        if (spec.formats >= 2 && spec.variables >= 1) ok('the agent spec includes formats and variables');
        else fail(`the agent spec is incomplete: ${JSON.stringify({ formats: spec.formats, variables: spec.variables })}`);
        if (spec.textLayer && spec.textLayer.text) ok('the agent spec describes text layers with their copy');
        else fail('the agent spec is missing the text layer payload');
        if (spec.hasBrandKit) ok('the agent spec summarises the brand kit');
        else fail('the agent spec is missing the brand kit');

        console.log('\nPhase 4 — safe zones, shared kits, guardrails');

        // Safe zones follow the channel and can be toggled off. Formats get
        // generated ids, so find the social one by channel.
        const socialFormatId = await page.evaluate(() => (
            window.layerStudio.composition.formats.find((format) => format.channel === 'social')?.id || null
        ));
        if (!socialFormatId) fail('the composition has no social format to test safe zones with');
        await page.evaluate((id) => window.layerStudio.setActiveFormat(id), socialFormatId);
        await page.waitForTimeout(120);
        const zoneShown = await page.evaluate(() => Boolean(document.querySelector('.ls-safe-zone')));
        if (zoneShown) ok('a social format draws the safe-area guide');
        else fail('the safe-area guide did not render for a social format');

        await clickAction(page, 'toggle-safe-zones');
        await page.waitForTimeout(100);
        const zoneHidden = await page.evaluate(() => !document.querySelector('.ls-safe-zone'));
        if (zoneHidden) ok('the safe-area guide can be hidden');
        else fail('the safe-area guide did not hide');
        await clickAction(page, 'toggle-safe-zones');
        await page.waitForTimeout(100);

        // The guide must never leak into an export.
        const exportHasGuide = await page.evaluate(() => {
            const studio = window.layerStudio;
            const snapshot = studio.createExportSnapshot();
            const svg = studio.exportSvg({ download: false, composition: snapshot });
            return /ls-safe-zone|safe-zone/i.test(svg);
        });
        if (!exportHasGuide) ok('the safe-area guide is absent from the SVG export');
        else fail('the safe-area guide leaked into the SVG export');

        // Shared brand kits: save this composition's kit, attach, then detach.
        await clickAction(page, 'open-brand-kit');
        await page.waitForSelector('#layerBrandKitDialog[open]');
        const kitsBefore = await page.evaluate(() => window.layerStudio.brandKits.length);
        await page.click('[data-action="save-shared-kit"]');
        await page.waitForFunction(
            () => Boolean(window.layerStudio.composition.brandKitId),
            null,
            { timeout: 20000 },
        );
        const attached = await page.evaluate(() => ({
            id: window.layerStudio.composition.brandKitId,
            effective: window.layerStudio.effectiveBrandKit()?.id,
            embedded: Boolean(window.layerStudio.composition.brandKit),
            sharedCount: window.layerStudio.brandKits.length,
            status: document.querySelector('#layerBrandKitSharedStatus')?.textContent || '',
        }));
        if (attached.sharedCount === kitsBefore + 1 && attached.effective === attached.id) {
            ok(`the kit was saved to the shared store and attached (${attached.id})`);
        } else {
            fail(`saving a shared kit failed: ${JSON.stringify(attached)}`);
        }
        if (attached.embedded) ok('attaching keeps a local snapshot as a fallback');
        else fail('attaching dropped the embedded kit, so deleting the shared one would orphan this composition');
        if (/shared kit/i.test(attached.status)) ok('the dialog explains that the kit is shared');
        else fail(`the shared-kit status is unclear: ${attached.status}`);

        await page.click('[data-action="detach-shared-kit"]');
        await page.waitForTimeout(150);
        const detached = await page.evaluate(() => ({
            id: window.layerStudio.composition.brandKitId,
            embedded: Boolean(window.layerStudio.composition.brandKit),
        }));
        if (detached.id === null && detached.embedded) ok('detaching keeps the local copy');
        else fail(`detaching failed: ${JSON.stringify(detached)}`);

        // Remove the kit we created so the repo stays clean.
        await page.evaluate(
            (id) => fetch(`/api/brand-kits/${encodeURIComponent(id)}`, { method: 'DELETE' }),
            attached.id,
        );
        await page.evaluate(() => window.layerStudio.loadBrandKits({ silent: true }));
        await page.click('[data-action="close-brand-kit"]');

        // Guardrails: enabling blocking must refuse an export that violates the safe area.
        await page.evaluate(() => {
            const studio = window.layerStudio;
            // Push the headline outside the story safe area, deliberately.
            const layer = studio.composition.layers.find((item) => item.type === 'text');
            const format = studio.activeFormat();
            format.layerOverrides[layer.id] = { x: 60, y: 20, w: 60, h: 20 };
            studio.render();
        });
        await clickAction(page, 'validate-brand');
        await page.waitForSelector('#layerValidationDialog[open]');
        await page.check('#layerGuardrailEnabled');
        await page.check('#layerGuardrailBlock');
        await page.click('[data-action="close-validation"]');
        await clickAction(page, 'validate-brand');
        await page.waitForSelector('#layerValidationDialog[open]');
        const guardLine = await page.evaluate(
            () => document.querySelector('#layerBrandValidation [data-guardrail="state"]')?.textContent || '',
        );
        if (/blocking issue/i.test(guardLine)) ok(`the report states the guardrail consequence ("${guardLine.trim()}")`);
        else fail(`the guardrail summary is missing or wrong: ${guardLine}`);
        await page.click('[data-action="close-validation"]');

        await clickAction(page, 'export-image');
        await page.waitForTimeout(800);
        const blocked = await page.evaluate(() => ({
            status: window.layerStudio.el.status.textContent,
            progress: document.querySelector('#layerExportProgress')?.textContent || '',
        }));
        if (/guardrail/i.test(`${blocked.status} ${blocked.progress}`)) {
            ok('a guardrail violation refuses the PNG export');
        } else {
            fail(`the export was not refused: ${JSON.stringify(blocked)}`);
        }

        // With blocking off the same export goes through.
        await page.evaluate(() => {
            const studio = window.layerStudio;
            studio.composition.guardrails = { enabled: true, block: false };
            studio.syncGuardrailControls();
        });
        const allowedDownload = page.waitForEvent('download', { timeout: 60000 });
        await clickAction(page, 'export-image');
        const allowed = await allowedDownload;
        if (allowed.suggestedFilename().endsWith('.png')) ok('with blocking off the same export succeeds');
        else fail('blocking off did not allow the export');
        await page.evaluate((id) => {
            const studio = window.layerStudio;
            studio.composition.guardrails = { enabled: false, block: false };
            const layer = studio.composition.layers.find((item) => item.type === 'text');
            const format = studio.composition.formats.find((item) => item.id === id);
            if (format) delete format.layerOverrides[layer.id];
            studio.render();
        }, socialFormatId);

        console.log('\nPhase 5 — brief ingestion');

        // A clean template: three variables, one text layer bound to two of them.
        await page.evaluate(() => {
            const studio = window.layerStudio;
            studio.openComposition({
                version: 3,
                id: 'brief-template',
                name: 'Winter campaign',
                width: 1080,
                height: 1080,
                duration: 4000,
                defaultLocale: 'en',
                activeLocale: null,
                referenceLayerId: null,
                characters: [],
                brandKit: null,
                formats: [{
                    id: 'master', isMaster: true, channel: 'custom', label: 'Master',
                    width: 1080, height: 1080, layerOverrides: {}, variableValues: {},
                }],
                activeFormatId: 'master',
                variables: [
                    { id: 'headline', name: 'Headline', kind: 'text', defaultValue: 'Template headline', locked: false },
                    { id: 'cta', name: 'CTA', kind: 'text', defaultValue: 'Template CTA', locked: false },
                    { id: 'accent', name: 'Accent', kind: 'color', defaultValue: '#111111', locked: true },
                ],
                layers: [{
                    id: 'headline', type: 'text', name: 'Headline', role: 'foreground',
                    text: 'Template headline', bindings: { text: 'headline', color: 'accent' },
                    color: '#111111', align: 'left', verticalAlign: 'middle', overflow: 'clip',
                    font: { family: 'Inter', weight: 700, style: 'normal', sizePct: 6, lineHeight: 1.15, letterSpacingEm: 0, transform: 'none' },
                    x: 8, y: 20, w: 84, h: 20, z: 10, opacity: 1, rotation: 0, visible: true,
                }],
            });
        });

        await clickAction(page, 'open-brief');
        await page.waitForSelector('#layerBriefDialog[open]');
        ok('the brief dialog opens');

        await page.setInputFiles('#layerBriefFile', path.join(ROOT, 'tests', 'fixtures', 'brief.xlsx'));
        await page.waitForFunction(
            () => /row\(s\) from sheet/.test(document.querySelector('#layerBriefStatus')?.textContent || ''),
            null,
            { timeout: 20000 },
        );
        const briefState = await page.evaluate(() => ({
            summary: document.querySelector('#layerBriefSummary')?.textContent || '',
            rows: document.querySelectorAll('.layer-brief-row').length,
            mapping: [...document.querySelectorAll('#layerBriefMapping select')]
                .map((select) => ({ id: select.dataset.briefVariable, value: select.value })),
        }));
        if (briefState.rows === 3 && /rows:\s*3/.test(briefState.summary)) {
            ok(`the .xlsx brief loads 3 rows (${briefState.summary.replace(/\s+/g, ' ').trim()})`);
        } else {
            fail(`the brief did not load as expected: ${JSON.stringify(briefState)}`);
        }
        const mappingOk = briefState.mapping.find((entry) => entry.id === 'headline')?.value === '1'
            && briefState.mapping.find((entry) => entry.id === 'cta')?.value === '2'
            && briefState.mapping.find((entry) => entry.id === 'accent')?.value === '3';
        if (mappingOk) ok('columns are matched to variables by name');
        else fail(`column mapping was wrong: ${JSON.stringify(briefState.mapping)}`);

        await page.click('[data-action="preview-brief-row"][data-index="1"]');
        await page.waitForTimeout(150);
        const preview = await page.evaluate(() => ({
            lines: [...document.querySelectorAll('.ls-text-line')].map((node) => node.textContent).join(' ').trim(),
            headline: window.layerStudio.composition.variables.find((v) => v.id === 'headline').defaultValue,
            accent: window.layerStudio.composition.variables.find((v) => v.id === 'accent').defaultValue,
            status: document.querySelector('#layerBriefStatus')?.textContent || '',
        }));
        if (preview.headline === 'Bloom & grow, gently' && /Bloom/.test(preview.lines)) {
            ok('previewing a row fills the variables and updates the canvas');
        } else {
            fail(`brief preview failed: ${JSON.stringify(preview)}`);
        }
        if (preview.accent === '#f0a35e') ok('a locked colour variable takes the row value');
        else fail(`the colour was not applied: ${preview.accent}`);
        if (/Not saved/.test(preview.status)) ok('the preview is explicitly marked as unsaved');
        else fail(`the preview status is unclear: ${preview.status}`);

        await page.click('[data-action="clear-brief-preview"]');
        await page.waitForTimeout(150);
        const cleared = await page.evaluate(() => ({
            headline: window.layerStudio.composition.variables.find((v) => v.id === 'headline').defaultValue,
            accent: window.layerStudio.composition.variables.find((v) => v.id === 'accent').defaultValue,
        }));
        if (cleared.headline === 'Template headline' && cleared.accent === '#111111') {
            ok('clearing the preview restores the template values');
        } else {
            fail(`clearing the preview did not restore: ${JSON.stringify(cleared)}`);
        }

        for (const output of ['gif', 'svg', 'video']) {
            await page.uncheck(`.layer-brief-outputs input[value="${output}"]`).catch(() => {});
        }
        await page.fill('#layerBriefLocales', 'en');
        const briefZip = page.waitForEvent('download', { timeout: 180000 });
        await page.click('[data-action="export-brief"]');
        const archive = await briefZip;
        const archivePath = await archive.path();
        const archiveBytes = await fsp.readFile(archivePath);
        const archiveText = archiveBytes.toString('latin1').toLowerCase();
        const expectedRows = ['winter-launch', 'spring-drop', 'summer'];
        const foundRows = expectedRows.filter((name) => archiveText.includes(`${name}-master-en.png`));
        if (archive.suggestedFilename().endsWith('-brief.zip') && foundRows.length === expectedRows.length) {
            ok(`exporting the brief zipped ${expectedRows.length} creatives (${archiveBytes.length} bytes)`);
        } else {
            fail(`brief ZIP missing entries (${foundRows.length}/${expectedRows.length}): ${archive.suggestedFilename()}`);
        }
        await page.click('[data-action="close-brief"]');

        // --- Regression: an image-only legacy composition still loads --------
        const legacy = await page.evaluate(() => {
            const studio = window.layerStudio;
            const serialized = {
                version: 1,
                id: 'legacy',
                name: 'Legacy scene',
                width: 1200,
                height: 800,
                duration: 2000,
                layers: [
                    { id: 'a', name: 'Backdrop', url: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 100, h: 100, z: 0 },
                    { id: 'b', name: 'Prop', url: 'data:image/png;base64,AAAA', x: 10, y: 10, w: 20, h: 20, z: 1, keyframes: [] },
                ],
            };
            const before = studio.composition;
            studio.openComposition(serialized);
            const loaded = studio.composition;
            const result = {
                layers: loaded.layers.length,
                types: loaded.layers.map((layer) => layer.type),
                formats: loaded.formats.length,
                activeFormatId: loaded.activeFormatId,
                masterWidth: loaded.formats[0].width,
                variables: loaded.variables.length,
                version: loaded.version,
                canvasRatio: studio.el.canvas.style.aspectRatio,
            };
            studio.openComposition(before);
            return result;
        });
        if (legacy.layers === 2 && legacy.types.every((type) => type === 'image')) {
            ok('a legacy image-only composition loads with every layer typed image');
        } else {
            fail(`legacy migration failed: ${JSON.stringify(legacy)}`);
        }
        if (legacy.formats === 1 && legacy.activeFormatId === 'master' && legacy.masterWidth === 1200) {
            ok('a legacy composition gains a single master format mirroring its size');
        } else {
            fail(`legacy format synthesis failed: ${JSON.stringify(legacy)}`);
        }
        if (legacy.variables === 0) ok('a legacy composition gains an empty variables list');
        else fail('legacy variables migration failed');

        console.log('\nPhase 6 — segment organization');
        const segmentIds = await page.evaluate(() => {
            const studio = window.layerStudio;
            const first = studio.composition.layers.find((layer) => layer.type === 'text');
            if (!first) throw new Error('the smoke composition has no text layer for the segment test');
            first.name = 'First segment';
            first.segmentGroup = 'First group';
            studio.addTextLayer();
            const second = studio.getLayer(studio.selectedLayerId);
            second.name = 'Second segment';
            second.segmentGroup = 'Second group';
            const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#f00"/></svg>')}`;
            studio.composition.layers.push({
                id: 'replace-image-fixture',
                type: 'image',
                name: 'Image segment',
                url: imageUrl,
                frames: [imageUrl],
                x: 31,
                y: 42,
                w: 17,
                h: 19,
                z: 50,
                rotation: 0,
                opacity: 1,
                visible: true,
                segmentGroup: 'First group',
                keyframes: [],
            });
            studio.render();
            return { first: first.id, second: second.id, image: 'replace-image-fixture' };
        });
        await page.waitForSelector('.seg-row[data-act="group"][data-key="first group"]', { state: 'attached' });
        await page.click('#segExpand');
        await page.waitForSelector(`.seg-row[data-id="${segmentIds.second}"]`);
        await page.waitForSelector(`.seg-row[data-id="${segmentIds.image}"]`);

        await page.locator(`.seg-row[data-id="${segmentIds.first}"]`).hover();
        await page.locator(`[data-act="rename-layer"][data-id="${segmentIds.first}"]`).click();
        await page.locator('.seg-rename-input').fill('Renamed segment');
        await page.locator('.seg-rename-input').press('Enter');
        const renamedSegment = await page.evaluate(
            (id) => window.layerStudio.getLayer(id).name,
            segmentIds.first,
        );
        if (renamedSegment === 'Renamed segment') ok('a segment can be renamed from its tree row');
        else fail(`segment rename failed: ${renamedSegment}`);

        await page.locator('.seg-row[data-act="group"][data-key="first group"]').hover();
        await page.locator('[data-act="rename-group"][data-key="first group"]').click();
        await page.locator('.seg-rename-input').fill('Renamed group');
        await page.locator('.seg-rename-input').press('Enter');
        const renamedGroup = await page.evaluate(
            (id) => window.layerStudio.getLayer(id).segmentGroup,
            segmentIds.first,
        );
        if (renamedGroup === 'Renamed group') ok('renaming a group updates its member layers');
        else fail(`group rename failed: ${renamedGroup}`);

        await page.locator(`.seg-row[data-id="${segmentIds.first}"]`)
            .dragTo(page.locator('.seg-row[data-act="group"][data-key="second group"]'));
        const movedGroup = await page.evaluate(
            (id) => window.layerStudio.getLayer(id).segmentGroup,
            segmentIds.first,
        );
        if (movedGroup === 'Second group') ok('dragging a segment onto a group moves it there');
        else fail(`moving a segment to another group failed: ${movedGroup}`);

        await page.locator(`.seg-row[data-id="${segmentIds.first}"]`)
            .dragTo(page.locator(`.seg-row[data-id="${segmentIds.second}"]`), { targetPosition: { x: 8, y: 1 } });
        const reordered = await page.evaluate(({ first, second }) => ({
            first: window.layerStudio.getLayer(first).z,
            second: window.layerStudio.getLayer(second).z,
        }), segmentIds);
        if (reordered.first > reordered.second) ok('dragging a segment above another changes its layer order');
        else fail(`segment reordering failed: ${JSON.stringify(reordered)}`);

        await page.evaluate((id) => { window.layerStudio.getLayer(id).z = 1000; }, segmentIds.image);
        await page.locator(`.seg-row[data-id="${segmentIds.image}"]`).hover();
        await page.locator(`[data-act="duplicate-layer"][data-id="${segmentIds.image}"]`).click();
        const duplicateId = await page.evaluate(() => window.layerStudio.selectedLayerId);
        const duplicate = await page.evaluate((id) => {
            const layer = window.layerStudio.getLayer(id);
            return {
                name: layer.name,
                segmentGroup: layer.segmentGroup,
                url: layer.url,
                x: layer.x,
                y: layer.y,
                w: layer.w,
                h: layer.h,
                z: layer.z,
                selected: window.layerStudio.selectedLayerId === id,
            };
        }, duplicateId);
        const originalForDuplicate = await page.evaluate((id) => {
            const layer = window.layerStudio.getLayer(id);
            return {
                name: layer.name,
                segmentGroup: layer.segmentGroup,
                url: layer.url,
                x: layer.x,
                y: layer.y,
                w: layer.w,
                h: layer.h,
                z: layer.z,
            };
        }, segmentIds.image);
        if (duplicateId !== segmentIds.image
            && duplicate.name === 'Image segment 2'
            && duplicate.segmentGroup === originalForDuplicate.segmentGroup
            && duplicate.selected
            && duplicate.z > originalForDuplicate.z
            && ['url', 'x', 'y', 'w', 'h'].every((key) => duplicate[key] === originalForDuplicate[key])) {
            ok('duplicating a segment copies its properties into the same group with a sequential name and selects it');
        } else {
            fail(`segment duplication failed: ${JSON.stringify({ duplicateId, duplicate, originalForDuplicate })}`);
        }
        await page.locator(`.seg-row[data-id="${duplicateId}"]`).hover();
        await page.locator(`[data-act="duplicate-layer"][data-id="${duplicateId}"]`).click();
        const thirdName = await page.evaluate(
            () => window.layerStudio.getLayer(window.layerStudio.selectedLayerId).name,
        );
        if (thirdName === 'Image segment 3') ok('repeated duplication increments the segment name sequence');
        else fail(`repeated duplication did not increment the name: ${thirdName}`);

        const beforeReplace = await page.evaluate((id) => {
            const layer = window.layerStudio.getLayer(id);
            return { x: layer.x, y: layer.y, w: layer.w, h: layer.h, z: layer.z, url: layer.url };
        }, segmentIds.image);
        await page.locator(`.seg-row[data-id="${segmentIds.image}"]`).hover();
        await page.locator(`[data-act="replace-image"][data-id="${segmentIds.image}"]`).click();
        await page.locator('#segmentReplaceInput').setInputFiles({
            name: 'replacement.svg',
            mimeType: 'image/svg+xml',
            buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="#00f"/></svg>'),
        });
        await page.waitForFunction(
            ({ id, previousUrl }) => window.layerStudio.getLayer(id)?.url !== previousUrl,
            { id: segmentIds.image, previousUrl: beforeReplace.url },
        );
        const afterReplace = await page.evaluate((id) => {
            const layer = window.layerStudio.getLayer(id);
            return {
                x: layer.x,
                y: layer.y,
                w: layer.w,
                h: layer.h,
                z: layer.z,
                url: layer.url,
                frames: layer.frames,
            };
        }, segmentIds.image);
        if (afterReplace.url !== beforeReplace.url
            && afterReplace.frames.length === 1
            && afterReplace.frames[0] === afterReplace.url
            && ['x', 'y', 'w', 'h', 'z'].every((key) => afterReplace[key] === beforeReplace[key])) {
            ok('replacing a segment image preserves its size, position, and stacking order');
        } else {
            fail(`segment image replacement changed geometry or did not replace the source: ${JSON.stringify({ beforeReplace, afterReplace })}`);
        }

        // Leave the toolbar closed for a clean final screenshot.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        await fsp.mkdir(path.join(ROOT, '_dev', 'screenshots'), { recursive: true });
        await page.screenshot({ path: path.join(ROOT, '_dev', 'screenshots', 'studio-smoke.png'), fullPage: false });
        console.log(`\nscreenshot: _dev/screenshots/studio-smoke.png`);

        const relevantErrors = consoleErrors.filter((message) => (
            !/favicon|net::ERR_|\/api\/fonts\b/i.test(message)
        ));
        if (relevantErrors.length) {
            fail(`browser errors: ${relevantErrors.join(' | ')}`);
        } else {
            ok('no browser console errors or page errors');
        }
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
        if (failures.length || crashed) {
            console.log(`\n${failures.length} failure(s):`);
            failures.forEach((message) => console.log(`  - ${message}`));
            if (serverLog.trim()) console.log(`\nserver log:\n${serverLog}`);
            process.exitCode = 1;
        } else {
            console.log(`\nall ${step} smoke checks passed`);
        }
    }
}

main().catch((error) => {
    crashed = true;
    console.error('\nsmoke test crashed:', error);
    process.exitCode = 1;
});
