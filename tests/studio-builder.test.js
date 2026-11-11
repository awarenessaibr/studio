'use strict';
/**
 * Studio Builder: server-owned catalog, layout rules, action contract and the
 * page wiring. The browser-level checks live in tests/studio-builder.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const server = require('../server.js');
const StudioBuilder = require('../src/server/studio-builder.js');

const ROOT = path.join(__dirname, '..');

test('the catalog is valid and complete', () => {
    const catalog = StudioBuilder.readCatalog();
    assert.equal(catalog.schema, 'studio-builder/catalog/1');
    assert.equal(catalog.modules.length, 28);
    assert.deepEqual(catalog.domains, [
        'Foundation', 'Models', 'Renderers', 'Editors', 'Agent',
        'Assets', 'Output', 'Audio', 'Cross-cutting',
    ]);
    assert.equal(new Set(catalog.modules.map((module) => module.id)).size, catalog.modules.length);
    const regions = new Set(catalog.regions.map((region) => region.id));
    for (const module of catalog.modules) {
        assert.ok(regions.has(module.region), `${module.id} has a known default region`);
        assert.ok(Array.isArray(module.sources) && module.sources.length, `${module.id} has sources`);
        assert.ok(Array.isArray(module.endpoints), `${module.id} has endpoints`);
        assert.ok(Array.isArray(module.requires), `${module.id} has requirements`);
        for (const dependency of module.requires) {
            assert.ok(catalog.modules.some((entry) => entry.id === dependency), `${module.id} requires a known module`);
        }
    }
    assert.deepEqual(catalog.core, ['A1', 'A2', 'A3']);
    assert.deepEqual(catalog.presets.map((preset) => preset.id), ['afs', 'classic', 'template', 'blank']);
    assert.equal(catalog.addOns.length, 7);
    assert.ok(catalog.limitations.length >= 3);
});

test('module discovery supports ids, names and aliases', () => {
    const catalog = StudioBuilder.readCatalog();
    assert.equal(StudioBuilder.resolveModule('D4', catalog).name, 'Timeline');
    assert.equal(StudioBuilder.resolveModule('timeline', catalog).id, 'D4');
    assert.equal(StudioBuilder.resolveModule('template renderer', catalog).id, 'C2');
    assert.equal(StudioBuilder.resolveModule('guardrails', catalog).id, 'I1');
    assert.equal(StudioBuilder.resolveModule('not a capability', catalog), null);
});

test('layout normalisation drops unknown and duplicate modules', () => {
    const catalog = StudioBuilder.readCatalog();
    const layout = StudioBuilder.normaliseLayout({
        top: ['G1', 'G1', 'ZZ'],
        stage: ['C1', 'C2', 'C1'],
        left: 'not-a-list',
        runtime: ['A1'],
    }, catalog);
    assert.deepEqual(layout.top, ['G1']);
    assert.deepEqual(layout.stage, ['C1', 'C2']);
    assert.deepEqual(layout.left, []);
    assert.deepEqual(layout.runtime, ['A1']);
    assert.deepEqual(layout.bottom, []);
});

test('rules catch renderers, incompatible editors, requirements and missing core', () => {
    const catalog = StudioBuilder.readCatalog();
    const issues = StudioBuilder.findIssues({
        top: ['G1'],
        left: ['F1'],
        stage: ['C1', 'C2'],
        right: ['D1', 'D2'],
        bottom: ['D4'],
        runtime: [],
    }, catalog);
    const ids = issues.map((issue) => issue.ruleId);
    assert.ok(ids.includes('single-renderer'));
    assert.ok(ids.includes('editor-exclusive'));
    assert.ok(issues.some((issue) => /Timeline/.test(issue.message) && /Motion editor/.test(issue.message)));
    assert.ok(issues.some((issue) => /Studio core/.test(issue.message)));
    assert.ok(issues.every((issue) => issue.fix && issue.fix.type));

    const clean = StudioBuilder.findIssues({
        top: ['G1'],
        left: ['F1'],
        stage: ['C1'],
        right: ['E1', 'I1'],
        bottom: ['D4'],
        runtime: ['A1', 'A2', 'A3', 'B1', 'B3', 'D3'],
    }, catalog);
    assert.deepEqual(clean, []);
});

test('agent responses only keep known modules, regions and presets', () => {
    const catalog = StudioBuilder.readCatalog();
    const layout = { stage: ['C1'], right: ['E1'], runtime: ['A1', 'A2', 'A3', 'B1'] };
    const response = StudioBuilder.normaliseAgentResponse({
        reply: 'A short plan.',
        actions: [
            { type: 'add', moduleId: 'I1', region: 'right' },
            { type: 'move', moduleId: 'D4', region: 'bottom', index: 0 },
            { type: 'move', moduleId: 'D4' },
            { type: 'remove', moduleId: 'E1' },
            { type: 'preset', presetId: 'classic' },
            { type: 'explain', moduleId: 'H1' },
            { type: 'add', moduleId: 'ZZ' },
            { type: 'add', name: 'guardrails', region: 'right' },
        ],
    }, catalog, layout);
    assert.equal(response.reply, 'A short plan.');
    assert.deepEqual(response.actions, [
        { type: 'add', moduleId: 'I1', region: 'right' },
        { type: 'move', moduleId: 'D4', region: 'bottom', index: 0 },
        { type: 'remove', moduleId: 'E1' },
        { type: 'preset', presetId: 'classic' },
        { type: 'explain', moduleId: 'H1' },
    ]);

    const text = StudioBuilder.normaliseAgentResponse('Plain prose only.', catalog, layout);
    assert.deepEqual(text, { reply: 'Plain prose only.', actions: [] });
});

test('agent actions apply in order and presets reset the layout', () => {
    const catalog = StudioBuilder.readCatalog();
    const next = StudioBuilder.applyActions({
        stage: ['D4'],
        runtime: ['A1'],
    }, [
        { type: 'preset', presetId: 'classic' },
        { type: 'add', moduleId: 'I1', region: 'right' },
        { type: 'move', moduleId: 'D4', region: 'bottom' },
        { type: 'remove', moduleId: 'G1' },
    ], catalog);
    assert.ok(next.stage.includes('C1'));
    assert.ok(next.right.includes('I1'));
    assert.ok(next.bottom.includes('D4'));
    assert.equal(next.top.includes('G1'), false);
    assert.ok(next.runtime.includes('A1'));
});

test('agent requests reject missing or oversized messages', () => {
    const catalog = StudioBuilder.readCatalog();
    assert.throws(() => StudioBuilder.normaliseAgentRequest({ message: '' }, catalog), /no message/);
    assert.throws(() => StudioBuilder.normaliseAgentRequest({ message: 'x'.repeat(5000) }, catalog), /longer/);
    const request = StudioBuilder.normaliseAgentRequest({
        mode: 'studio-builder',
        message: 'put the timeline at the bottom',
        layout: { stage: ['C1'], unknown: ['NOPE'] },
        history: [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'ok' }, { role: 'tool' }],
    }, catalog);
    assert.equal(request.message, 'put the timeline at the bottom');
    assert.deepEqual(request.layout.stage, ['C1']);
    assert.equal(request.layout.unknown, undefined);
    assert.deepEqual(request.history, [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'ok' }]);
});

test('the agent prompt carries the catalog, the current layout and the request', () => {
    const catalog = StudioBuilder.readCatalog();
    const messages = StudioBuilder.buildAgentMessages({
        message: 'swap to the template renderer',
        layout: { stage: ['C1'], runtime: ['A1', 'A2', 'A3'] },
        history: [],
    }, catalog);
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /CATALOG/);
    assert.match(messages[0].content, /D4 \| Timeline/);
    assert.match(messages[0].content, /C2 \| Brand template renderer/);
    assert.match(messages[0].content, /RESPONSE SHAPE/);
    assert.match(messages[1].content, /swap to the template renderer/);
    assert.match(messages[1].content, /"stage":\["C1"\]/);
});

test('every admin studio page is a start-from layout with the admin label and link', () => {
    const catalog = StudioBuilder.readCatalog();
    const pages = StudioBuilder.startPages(catalog);
    assert.deepEqual(pages.map((page) => page.source), [
        'studio-v2.html', 'agent-first-studio.html', 'studio-agent.html', 'studio.html',
        'studio-bkup.html', 'studio-import.html', 'asset-studio.html', 'crawler.html',
        'library.html', 'segments.html', 'voice.html', 'social.html', 'afs.html',
    ]);
    assert.deepEqual(pages.map((page) => page.label), [
        'Studio', 'Agent-first', 'Studio Agent', 'Classic', 'Studio backup', 'Import',
        'Asset Studio', 'Brand intake', 'Library', 'Segments', 'Voice', 'Social', 'AFS',
    ]);
    for (const page of pages) {
        assert.ok(page.id);
        assert.ok(page.moduleCount > 0);
        assert.ok(page.regions.runtime.includes('A1'));
        assert.ok(page.surface, `${page.source} has a live surface`);
        for (const id of page.modules) assert.ok(catalog.modules.some((module) => module.id === id));
    }
    const layerStudio = pages.find((page) => page.source === 'studio-v2.html');
    assert.ok(layerStudio.regions.stage.includes('C1'));
    assert.ok(layerStudio.regions.bottom.includes('D4'));
    const classic = pages.find((page) => page.source === 'studio.html');
    assert.equal(classic.label, 'Classic');
    assert.ok(classic.regions.stage.includes('C1'));
});

test('the start pages mirror the admin navigation labels and links', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'pages', 'admin.html'), 'utf8');
    const nav = admin.match(/<nav class="admin-nav"[\s\S]*?<\/nav>/)[0];
    const links = [...nav.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)]
        .map(([, href, label]) => ({ href: href.replace(/^\/+/, ''), label }));
    const expected = links.filter((link) => ![
        'admin.html', 'studio-builder', 'studio-builder-v0', 'segments-canvas', 'project-canvas',
    ].includes(link.href));
    const actual = StudioBuilder.readCatalog().pages.map((page) => ({
        href: page.url.replace(/^\/+/, ''),
        label: page.label,
    }));
    assert.deepEqual(actual, expected);
});

test('deploy requests choose a base page and normalise sizes', () => {
    const catalog = StudioBuilder.readCatalog();
    const request = StudioBuilder.normaliseDeployRequest({
        name: 'Test page',
        basePage: '/studio.html',
        layout: { stage: ['C1'], bottom: ['D4'], runtime: ['A1', 'A2', 'A3', 'B1', 'B3', 'D3'] },
        sizes: { left: 999, right: 20, top: 10, bottom: 999 },
        plan: [
            {
                capabilityId: 'C1',
                pageSource: 'studio-v2.html',
                rect: { x: 10, y: 20, width: 300, height: 200 },
                element: { tag: 'canvas', selector: '#layerCanvas', text: 'canvas' },
            },
            { capabilityId: 'ZZ', pageSource: 'studio-v2.html' },
            { capabilityId: 'C1', pageSource: 'not-a-page.html' },
        ],
    }, catalog);
    assert.equal(request.basePage, '/studio.html');
    assert.equal(request.plan.length, 1);
    assert.equal(request.plan[0].capabilityName, 'Scene renderer');
    assert.equal(request.plan[0].pageLabel, 'Studio');
    assert.equal(request.surfaceUrl, '/studio.html');
    assert.deepEqual(request.sizes, { left: 420, right: 110, top: 52, bottom: 280 });
    assert.equal(request.schema, 'studio-builder/page/1');
    const planOnly = StudioBuilder.normaliseDeployRequest({
        name: 'Plan only',
        layout: {},
        plan: [{
            capabilityId: 'D4',
            pageSource: 'studio-v2.html',
            rect: { x: 1, y: 2, width: 3, height: 4 },
            element: { selector: '#layerTimeline' },
        }],
    }, catalog);
    assert.equal(planOnly.plan.length, 1);
    assert.equal(planOnly.plan[0].capabilityId, 'D4');
    assert.equal(planOnly.basePage, '/studio-v2.html');
    assert.throws(() => StudioBuilder.normaliseDeployRequest({ name: 'Empty', layout: {} }, catalog), /at least one/);
});

test('the deployed shell contains the composed regions and a real stage', () => {
    const catalog = StudioBuilder.readCatalog();
    const request = StudioBuilder.normaliseDeployRequest({
        name: 'Shell test',
        basePage: '/studio-v2.html',
        layout: {
            top: ['G1'], left: ['F1'], stage: ['C1'],
            right: ['E1', 'I1'], bottom: ['D4'],
            runtime: ['A1', 'A2', 'A3', 'B1', 'B3', 'D3'],
        },
        plan: [{
            capabilityId: 'D4',
            pageSource: 'studio-v2.html',
            rect: { x: 12, y: 640, width: 420, height: 90 },
            element: { tag: 'div', selector: '#layerTimeline .tl', text: 'Timeline' },
        }],
    }, catalog);
    const record = { ...request, id: 'shell-test-20260101000000-0000', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const html = StudioBuilder.renderDeployedPage(record, catalog);
    assert.match(html, /class="dp-stage-frame"/);
    assert.match(html, /src="\/studio-v2\.html\?deployed=shell-test-20260101000000-0000"/);
    assert.match(html, /data-module="F1"/);
    assert.match(html, /data-live-for="brandPacks"/);
    assert.match(html, /data-stage-reload/);
    assert.match(html, /\/src\/client\/studio-builder\/deployed\.js/);
    assert.match(html, /Project plan/);
    assert.match(html, /#layerTimeline \.tl/);
    assert.match(html, /Timeline/);
});

test('deploy writes, lists, reads and deletes a served page', async () => {
    const name = `Studio Builder test ${Date.now()}`;
    let deployed = null;
    try {
        deployed = await server.deployStudioBuilderPage({
            name,
            basePage: '/studio-v2.html',
            layout: {
                top: ['G1'], left: ['F1'], stage: ['C1'],
                right: ['E1', 'I1'], bottom: ['D4'],
                runtime: ['A1', 'A2', 'A3', 'B1', 'B3', 'D3'],
            },
            sizes: { left: 200, right: 200, top: 80, bottom: 100 },
            plan: [{
                capabilityId: 'D4',
                pageSource: 'studio-v2.html',
                rect: { x: 12, y: 640, width: 420, height: 90 },
                element: { tag: 'div', selector: '#layerTimeline .tl', text: 'Timeline' },
            }],
        });
        assert.equal(deployed.ok, true);
        assert.match(deployed.page.url, /^\/built\//);
        assert.equal(deployed.page.basePage, '/studio-v2.html');
        const dir = path.join(server.STUDIO_BUILDER_PAGES_DIR, deployed.page.id);
        const html = await fsp.readFile(path.join(dir, 'index.html'), 'utf8');
        assert.match(html, /class="dp-stage-frame"/);
        assert.match(html, /Project plan/);
        const redirect = await fsp.readFile(path.join(dir, 'surface.html'), 'utf8');
        assert.match(redirect, /\/studio-v2\.html/);
        const listed = await server.listStudioBuilderPages();
        assert.ok(listed.pages.some((page) => page.id === deployed.page.id));
        const read = await server.readStudioBuilderPage(deployed.page.id);
        assert.equal(read.name, name);
        assert.equal(read.plan.length, 1);
        assert.equal(read.plan[0].capabilityId, 'D4');
        assert.ok(server.builderPublicFile(deployed.page.url));
        assert.ok(server.builderPublicFile(`${deployed.page.url}/surface`));
        await server.deleteStudioBuilderPage(deployed.page.id);
        assert.equal(server.builderPublicFile(deployed.page.url), path.join(server.STUDIO_BUILDER_PAGES_DIR, deployed.page.id, 'index.html'));
        deployed = null;
    } finally {
        if (deployed) await server.deleteStudioBuilderPage(deployed.page.id).catch(() => {});
    }
});

test('the server catalog includes live data and the builder page route', async () => {
    assert.equal(server.PAGE_ROUTES['/studio-builder'], 'Studio Builder.html');
    assert.equal(server.PAGE_ROUTES['/studio-builder.html'], 'Studio Builder.html');
    assert.equal(server.PAGE_ROUTES['/builder'], 'Studio Builder.html');
    assert.equal(server.PAGE_ROUTES['/studio-bkup.html'], 'studio-bkup.html');
    assert.equal(server.PAGE_ROUTES['/studio-builder-v0'], 'Studio Builder-v0.html');
    assert.equal(server.PAGE_ROUTES['/segments-canvas'], 'segments-canvas.html');
    assert.equal(server.PAGE_ROUTES['/segments-canvas/'], 'segments-canvas.html');
    const canvasPage = fs.readFileSync(path.join(ROOT, 'pages', 'segments-canvas.html'), 'utf8');
    assert.match(canvasPage, /J\(IDX\+'index\.json'\)/);
    assert.match(canvasPage, /\/data\/library\/segment-groups\//);
    const catalog = await server.buildStudioBuilderCatalog();
    assert.equal(catalog.source, 'server');
    assert.equal(catalog.modules.length, 28);
    assert.equal(typeof catalog.live.brandPacks.count, 'number');
    assert.equal(typeof catalog.live.fonts.count, 'number');
    assert.equal(typeof catalog.live.animations.count, 'number');
    assert.equal(typeof catalog.live.assets.total, 'number');
    assert.equal(catalog.agent.endpoint, '/api/agent-first/chat');
});

test('the builder shell loads its external client and styles', () => {
    const page = fs.readFileSync(path.join(ROOT, 'pages', 'Studio Builder.html'), 'utf8');
    assert.match(page, /\/src\/client\/studio-builder\/builder\.js/);
    assert.match(page, /\/src\/client\/studio-builder\/builder\.css/);
    assert.match(page, /id="catalogStatus"/);
    assert.match(page, /id="liveToggle"/);
    assert.match(page, /data-t="addons"/);
    assert.match(page, /data-t="deploy"/);
    assert.match(page, /id="deploy"/);
});
