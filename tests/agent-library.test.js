'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildAgentLibrary, summaryOf } = require('../src/server/agent-library.js');

test('agent library maps business, menu, groups, assets and animations', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-library-test-'));
    const projects = path.join(root, 'projects');
    const packDir = path.join(root, 'brand-packs', 'pack-1');
    const compDir = path.join(projects, 'test-project', 'compositions');
    await fsp.mkdir(compDir, { recursive: true });
    await fsp.mkdir(packDir, { recursive: true });
    await fsp.writeFile(path.join(packDir, 'pack.json'), JSON.stringify({
        pack: { id: 'pack-1', name: 'Test pack' },
        brands: [{ id: 'brand-test', name: 'Test Cafe', tagline: 'Testing' }],
    }));
    const composition = {
        version: 3, id: 'test-project-01', name: 'Test Cafe · Menu — 01',
        width: 1080, height: 1920, duration: 2000,
        sourceFacts: { htmlSource: 'Test Cafe · Menu', stageMetadata: {}, kind: 'html-stage', warnings: [] },
        layers: [
            { id: 'html-bg', type: 'image', name: 'Background', role: 'background', x: 0, y: 0, w: 100, h: 100, z: 0, url: '/data/projects/test-project/images/bg.jpg', keyframes: [{ time: 0, x: 0, y: 0, w: 100, h: 100, opacity: 1 }, { time: 2000, x: -2, y: -2, w: 104, h: 104, opacity: 1 }] },
            { id: 'headline', type: 'text', name: 'Menu', role: 'foreground', x: 8, y: 10, w: 84, h: 10, z: 1, text: 'Menu', font: { sizePct: 16 }, meta: { cssClasses: ['title'] } },
            { id: 'item', type: 'text', name: 'Eggs on toast', role: 'foreground', x: 10, y: 40, w: 50, h: 5, z: 2, text: 'Eggs on toast', font: { sizePct: 6 }, keyframes: [{ time: 0, x: 0, y: 40, w: 50, h: 5, opacity: 0 }, { time: 500, x: 10, y: 40, w: 50, h: 5, opacity: 1 }], meta: { cssClasses: ['dish'] } },
            { id: 'price', type: 'text', name: '£7.50', role: 'foreground', x: 65, y: 40, w: 20, h: 5, z: 3, text: '£7.50', font: { sizePct: 6 }, keyframes: [{ time: 0, x: 65, y: 40, w: 20, h: 5, opacity: 0 }, { time: 600, x: 65, y: 40, w: 20, h: 5, opacity: 1 }], meta: { cssClasses: ['dish'] } },
            { id: 'photo', type: 'image', name: 'Dish photo', role: 'foreground', x: 10, y: 50, w: 80, h: 30, z: 4, url: '/data/projects/test-project/images/dish.jpg', meta: { cssClasses: ['dish'] } },
        ],
    };
    await fsp.writeFile(path.join(compDir, 'test-project-01.composition.json'), JSON.stringify(composition));
    try {
        const library = await buildAgentLibrary({ projectsDir: projects, brandPacksDir: path.join(root, 'brand-packs') });
        assert.strictEqual(library.schema, 'agent-studio/library/1');
        assert.strictEqual(library.counts.compositions, 1);
        assert.strictEqual(library.businesses[0].id, 'brand-test');
        assert.strictEqual(library.compositions[0].businessId, 'brand-test');
        assert.ok(library.compositions[0].groups.some((group) => group.kind === 'menu'));
        assert.ok(library.compositions[0].groups.some((group) => group.kind === 'prices'));
        assert.ok(library.compositions[0].groups.some((group) => group.kind === 'photos'));
        assert.ok(library.compositions[0].animations.layer.length >= 3);
        assert.ok(library.compositions[0].animations.original);
        const menu = library.menuItems.find((item) => item.text === 'Eggs on toast');
        assert.ok(menu);
        assert.strictEqual(menu.price, '£7.50');
        assert.ok(library.assets.some((asset) => asset.layerId === 'photo'));
        assert.ok(library.mappings.compositionGroups['test-project-01'].length > 0);
        assert.strictEqual(library.mappings.businessCompositions['brand-test'][0], 'test-project-01');
        const summary = summaryOf(library);
        assert.strictEqual(summary.compositions[0].id, 'test-project-01');
        assert.strictEqual(summary.businesses[0].menuItemCount, 2);
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});
