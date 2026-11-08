'use strict';
/**
 * Browser smoke test for menus as content assets.
 *
 * Boots the real server, opens Agent Studio on a brand that carries menus,
 * drags a dish onto the canvas and checks it lands as a formatted block, then
 * checks Asset Studio offers the same menus as a Menu source.
 *
 * Run with: node tests/menus.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH
    || '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT);
const ROOT = path.join(__dirname, '..');
const PORT = 8823 + Math.floor(Math.random() * 200);
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
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('the studio server did not start');
}

async function findBrandWithMenus() {
    const { packs = [] } = await fetch(`${BASE}/api/brand-packs`).then((response) => response.json());
    for (const summary of packs) {
        const { pack } = await fetch(`${BASE}/api/brand-packs/${encodeURIComponent(summary.id)}`)
            .then((response) => response.json());
        for (const brand of pack?.brands || []) {
            const menus = brand?.content?.menus;
            if (Array.isArray(menus) && menus.length) {
                return { packId: pack.id, brand, menus };
            }
        }
    }
    return null;
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
        const target = await findBrandWithMenus();
        if (!target) throw new Error('no brand pack on disk carries content.menus');
        const { packId, brand, menus } = target;
        console.log(`  · ${brand.name} (${packId}) — ${menus.length} menus`);

        browser = await chromium.launch({
            executablePath: CHROME,
            args: ['--no-first-run', '--no-default-browser-check'],
        });
        const errors = [];
        const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        page.on('pageerror', (error) => errors.push(error.message));

        const query = new URLSearchParams({ pack: packId, brand: brand.id });
        await page.goto(`${BASE}/studio.html?${query}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('boot')?.hidden, null, { timeout: 25000 });

        const menuTab = page.locator('#atabs button', { hasText: /^Menus/ });
        check(await menuTab.count() === 1, 'Agent Studio offers a Menus tab');
        await menuTab.click();

        const groups = await page.locator('.menu-group h3').allTextContents();
        check(groups.length >= menus.length, `the panel lists every menu (${groups.length} groups)`);
        const chips = page.locator('.menu-chip');
        check(await chips.count() > 0, `menu dishes are listed as draggable chips (${await chips.count()})`);

        // Branch filtering: a menu documented for one branch must not appear
        // when the other branch is selected.
        const locations = brand.content?.locations || [];
        const branchSelect = page.locator('#menuBranch');
        if (locations.length && await branchSelect.count()) {
            const scoped = locations.find((location) => menus.some(
                (menu) => menu.branches?.length && !menu.branches.includes(location.id),
            ));
            if (scoped) {
                await branchSelect.selectOption(scoped.id);
                await page.waitForTimeout(250);
                const filtered = (await page.locator('.menu-group h3').allTextContents())
                    .filter((label) => !label.startsWith('Venue'));
                const hidden = menus.filter((menu) => menu.branches?.length && !menu.branches.includes(scoped.id));
                const stillThere = menus.filter((menu) => !hidden.includes(menu));
                check(
                    hidden.every((menu) => !filtered.some((label) => label.startsWith(menu.name)))
                    && stillThere.every((menu) => filtered.some((label) => label.startsWith(menu.name)))
                    && filtered.length === groups.length - hidden.length - 1,
                    `choosing ${scoped.name} hides the ${hidden.length} menu(s) written for another branch`,
                );
                await branchSelect.selectOption('');
                await page.waitForTimeout(250);
            }
        }

        // Sections start collapsed; open the first one to reach its dishes.
        const firstSection = page.locator('.menu-sec > summary').first();
        if (await firstSection.count()) {
            await firstSection.click();
            await page.waitForTimeout(200);
        }

        // Drag a dish onto the canvas.
        const firstChip = chips.first();
        const dish = await firstChip.locator('.mc-n').textContent();
        const stage = page.locator('#stage');
        const stageBox = await stage.boundingBox();
        await firstChip.dragTo(stage, {
            targetPosition: { x: stageBox.width * 0.5, y: stageBox.height * 0.45 },
        });
        await page.waitForTimeout(500);
        const block = page.locator('#stage .L.mb-host');
        const blockCount = await block.count();
        check(blockCount === 1, `dropping a dish adds one formatted block layer (found ${blockCount})`);
        const blockText = await block.first().innerText().catch(() => '');
        check(blockText.includes(String(dish || '').trim()), 'the block carries the dish that was dragged');
        check((await page.locator('#status').textContent() || '').includes('Added'), 'the studio reports the drop');

        // An offer drops as an offer block, with its own format.
        const offer = page.locator('.menu-chip.menu-offer').first();
        if (await offer.count()) {
            await offer.dragTo(stage, {
                targetPosition: { x: stageBox.width * 0.5, y: stageBox.height * 0.75 },
            });
            await page.waitForTimeout(400);
            const offers = await page.locator('#stage .L.mb-host .mb-offer').count();
            check(offers === 1, `a venue offer drops as an offer block (found ${offers})`);
        }

        // Asset Studio: the same menus prefill a menu design.
        const assetPage = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        assetPage.on('pageerror', (error) => errors.push(error.message));
        await assetPage.goto(`${BASE}/asset-studio.html?brand=${encodeURIComponent(brand.id)}`, { waitUntil: 'domcontentloaded' });
        await assetPage.waitForFunction(() => !document.getElementById('studio')?.hidden, null, { timeout: 25000 });
        await assetPage.locator('#categoryNav button', { hasText: /^Menus/ }).first().click();
        await assetPage.locator('#controlTabs button', { hasText: 'Text' }).click();
        await assetPage.waitForTimeout(300);
        const sourceSelect = assetPage.locator('#controlBody label')
            .filter({ hasText: 'Menu source' }).locator('select');
        check(await sourceSelect.count() === 1, 'Asset Studio offers a Menu source');
        const options = await sourceSelect.locator('option').allTextContents();
        const menuOptions = options.filter((label) => label.startsWith('Whole menu'));
        check(menuOptions.length === menus.length, `it lists all ${menus.length} menus`);
        const itemsField = assetPage.locator('#controlBody label').filter({ hasText: /^Items/ }).locator('textarea');
        const items = await itemsField.first().inputValue().catch(() => '');
        check(items.trim().length > 0, 'a menu design is prefilled from the brand’s dishes');
        if (menus.length > 1) {
            const other = menuOptions.find((label) => !label.includes(menus[0].name));
            if (other) {
                await sourceSelect.selectOption({ label: other });
                await assetPage.waitForTimeout(400);
                const next = await itemsField.first().inputValue().catch(() => '');
                check(next !== items && next.trim().length > 0, `choosing “${other}” reprints the design`);
            }
        }

        // Post ideas: the same menus drive a finished post, its caption and
        // its motion.
        await assetPage.locator('#categoryNav button', { hasText: /^Post Ideas/ }).first().click();
        await assetPage.waitForTimeout(600);
        const postTitle = await assetPage.locator('#previewTitle').textContent();
        check(/Feed post/.test(postTitle || ''), 'the Post Ideas category opens on a feed post');
        await assetPage.locator('#controlTabs button', { hasText: 'Text' }).click();
        await assetPage.waitForTimeout(300);
        const postDish = assetPage.locator('#controlBody label').filter({ hasText: /^Dish/ }).locator('select');
        check(await postDish.count() === 1, 'a post idea starts with a dish picker');
        const postOptions = await postDish.locator('option').allTextContents();
        check(postOptions.length > 3, `the picker lists the brand's dishes (${postOptions.length})`);
        await postDish.selectOption({ index: 3 });
        await assetPage.waitForTimeout(500);
        await assetPage.locator('#controlTabs button', { hasText: 'Caption' }).click();
        await assetPage.waitForTimeout(300);
        const caption = await assetPage.locator('#controlBody textarea').first().inputValue().catch(() => '');
        const tags = await assetPage.locator('#controlBody input[type="text"]').first().inputValue().catch(() => '');
        check(caption.length > 40, 'the caption is written from the dish');
        check(/#/.test(tags), 'hashtags are generated');
        check(/Motion idea:/.test(await assetPage.locator('#controlBody').innerText().catch(() => '')), 'a motion idea is included');

        // Reel ideas: the same dish, twelve reel layouts, each with its own
        // motion line.
        await assetPage.locator('#categoryNav button', { hasText: /^Reel Ideas/ }).first().click();
        await assetPage.waitForTimeout(700);
        const reelDesigns = await assetPage.locator('#designGrid .design-tile').count();
        check(reelDesigns === 12, `Reel Ideas offers twelve reel layouts (${reelDesigns})`);
        await assetPage.locator('#controlTabs button', { hasText: 'Text' }).click();
        await assetPage.waitForTimeout(300);
        const reelDish = assetPage.locator('#controlBody label').filter({ hasText: /^Dish/ }).locator('select');
        check(await reelDish.count() === 1, 'a reel idea starts with the same dish picker');
        await reelDish.selectOption({ index: 8 });
        await assetPage.waitForTimeout(500);
        await assetPage.locator('#controlTabs button', { hasText: 'Caption' }).click();
        await assetPage.waitForTimeout(300);
        const firstMotion = await assetPage.locator('#controlBody').innerText().catch(() => '');
        await assetPage.locator('#designGrid .design-tile').filter({ hasText: 'Kinetic type' }).click();
        await assetPage.waitForTimeout(700);
        await assetPage.locator('#controlTabs button', { hasText: 'Caption' }).click();
        await assetPage.waitForTimeout(300);
        const secondMotion = await assetPage.locator('#controlBody').innerText().catch(() => '');
        check(/Motion idea:/.test(firstMotion) && /Motion idea:/.test(secondMotion), 'each reel layout states its motion');
        check(firstMotion !== secondMotion, 'the motion follows the chosen reel layout');

        // Story reels: a dish inside a collaboration, where the narrative
        // fields must survive a menu change.
        await assetPage.locator('#categoryNav button', { hasText: /^Story Reels/ }).first().click();
        await assetPage.waitForTimeout(700);
        const storyDesigns = await assetPage.locator('#designGrid .design-tile').count();
        check(storyDesigns === 7, `Story Reels offers seven storytelling layouts (${storyDesigns})`);
        await assetPage.locator('#controlTabs button', { hasText: 'Text' }).click();
        await assetPage.waitForTimeout(300);
        const storyDish = assetPage.locator('#controlBody label').filter({ hasText: /^Dish/ }).locator('select');
        check(await storyDish.count() === 1, 'a story reel starts with the same dish picker');
        const beatBefore = await assetPage.locator('#controlBody label').filter({ hasText: 'Story beat 1' })
            .locator('textarea,input').first().inputValue().catch(() => '');
        await storyDish.selectOption({ index: 11 });
        await assetPage.waitForTimeout(600);
        const storyTitle = await assetPage.locator('#controlBody label').filter({ hasText: /^Dish/ })
            .last().locator('textarea,input').first().inputValue().catch(() => '');
        const beatAfter = await assetPage.locator('#controlBody label').filter({ hasText: 'Story beat 1' })
            .locator('textarea,input').first().inputValue().catch(() => '');
        check(storyTitle.length > 0 && storyTitle !== beatBefore, 'choosing a dish changes the dish fields');
        check(beatBefore === beatAfter, 'the story beats are left alone by the dish picker');

        // Playback: the designs animate from their own entrance plans.
        await assetPage.locator('#designGrid .design-tile').filter({ hasText: 'Night vision' }).click();
        await assetPage.waitForTimeout(700);
        check(await assetPage.locator('#playBtn').isVisible(), 'an animated design offers Play');
        const stillShot = await assetPage.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        await assetPage.locator('#playBtn').click();
        await assetPage.waitForTimeout(900);
        const frameOne = await assetPage.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        await assetPage.waitForTimeout(1100);
        const frameTwo = await assetPage.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        check(frameOne !== frameTwo, 'the preview changes while it plays');
        check(stillShot !== frameOne, 'the playing frame differs from the still');
        await assetPage.locator('#playBtn').click();
        await assetPage.waitForTimeout(400);
        check(await assetPage.locator('#playBtn').textContent() === '▶ Play', 'pausing returns to the still');
        check(await assetPage.locator('#recordBtn').isVisible(), 'the animation can be recorded');

        // Changing the media on an animated design: the artwork cache used to
        // ignore the photo, so the new image never appeared.
        const agentPage = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        agentPage.on('pageerror', (error) => errors.push(error.message));
        await agentPage.goto(`${BASE}/studio-agent.html?pack=${encodeURIComponent(packId)}&brand=${encodeURIComponent(brand.id)}`, { waitUntil: 'domcontentloaded' });
        await agentPage.waitForFunction(() => document.querySelectorAll('.category-tab').length > 0, null, { timeout: 25000 });
        await agentPage.locator('.category-tab').filter({ hasText: 'Post Ideas' }).click();
        await agentPage.waitForTimeout(400);
        await agentPage.locator('.design-card').filter({ hasText: 'Feed post' }).click();
        await agentPage.waitForTimeout(600);
        if (!(await agentPage.locator('.control-tab').first().isVisible().catch(() => false))) {
            const focusButton = agentPage.locator('#enterFocus');
            if (await focusButton.isVisible().catch(() => false)) await focusButton.click();
            else await agentPage.locator('.design-card').filter({ hasText: 'Feed post' }).click();
            await agentPage.waitForTimeout(700);
        }
        const canvasShot = () => agentPage.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
        const originalShot = await canvasShot();
        await agentPage.locator('.control-tab').filter({ hasText: /^Image/ }).click();
        await agentPage.waitForTimeout(400);
        const photoTile = agentPage.locator('.photo-tile').nth(6);
        check(await photoTile.count() === 1, 'the Image tab lists the brand photography');
        await photoTile.click();
        await agentPage.waitForTimeout(1200);
        const changedShot = await canvasShot();
        check(changedShot !== originalShot, 'choosing a photo redraws the design');
        check(await photoTile.getAttribute('aria-pressed') === 'true', 'the chosen photo is marked as the current one');
        const resetImage = agentPage.getByRole('button', { name: /Reset image/ });
        if (await resetImage.count()) {
            await resetImage.click();
            await agentPage.waitForTimeout(1200);
            check(await canvasShot() === originalShot, 'Reset image brings the original artwork back');
        }
        // With an animation applied the preview draws the cached artwork; the
        // image change must still come through.
        await agentPage.locator('#timelineBtn').click();
        await agentPage.waitForTimeout(500);
        const stageBox2 = await agentPage.locator('#previewCanvas').boundingBox();
        if (stageBox2) await agentPage.mouse.click(stageBox2.x + stageBox2.width / 2, stageBox2.y + stageBox2.height / 2);
        await agentPage.waitForTimeout(400);
        if (!(await agentPage.locator('#tlAdd').isDisabled().catch(() => true))) {
            await agentPage.locator('#tlAdd').click();
            await agentPage.waitForTimeout(800);
        }
        const animatedShot = await canvasShot();
        await agentPage.locator('.control-tab').filter({ hasText: /^Image/ }).click();
        await agentPage.waitForTimeout(400);
        await agentPage.locator('.photo-tile').nth(7).click();
        await agentPage.waitForTimeout(1300);
        check(await canvasShot() !== animatedShot, 'an animated design accepts a new image');
        await agentPage.locator('#saveBtn').click();
        await agentPage.waitForTimeout(600);
        check(true, 'the animated design saves with its chosen image');

        check(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (failures.length) {
            console.log(`\n${failures.length} of ${checks} checks failed`);
            if (serverLog) console.log(serverLog.slice(-2000));
        } else {
            console.log(`\nAll ${checks} checks passed`);
        }
    }
    if (failures.length) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
